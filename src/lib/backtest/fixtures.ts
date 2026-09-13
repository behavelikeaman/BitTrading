import type { AccountConfig, Candle } from '@/types';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { DEFAULT_BACKTEST_PARAMS, type BacktestParams } from '@/lib/backtest/engine';

const MS_5M = 300_000;

/**
 * 시나리오의 진입 신호가 UTC 15:10(세션 안)에 떨어지도록 맞춘 시작 시각.
 *
 * 스택 워밍업 120봉이 앞에 붙으면서 신호봉이 10시간 뒤로 밀렸다. 펀딩
 * 경계(00·08·16시) 통과 여부를 검증하는 테스트가 진입 시각에 의존하므로
 * 시작점을 그만큼 당겨 신호 시각을 유지한다.
 */
export const START_MS = Date.UTC(2026, 0, 4, 23, 0, 0);

export const TEST_ACCOUNT: AccountConfig = {
  ...DEFAULT_ACCOUNT,
  slippageRatePerSide: 0,
  costSource: 'measured',
};

/**
 * 체결 경로 검증용 파라미터.
 *
 * 확신 등급을 'high'로 고정한다. 기본값은 'medium'(전 거래 동일 등급,
 * ADR-025)이지만 등급마다 래더 레그 수가 달라 진입가·손절가가 통째로
 * 바뀐다. 아래 시나리오의 가격들은 high 래더(2레그)로 손계산된 값이라,
 * 등급을 떠다니게 두면 체결 경로 테스트가 시그널 기본값 변경마다 깨진다.
 * 점수·등급 자체의 판정은 signal 쪽 테스트가 맡는다.
 */
export function testParams(over: Partial<BacktestParams> = {}): BacktestParams {
  return {
    ...DEFAULT_BACKTEST_PARAMS,
    account: TEST_ACCOUNT,
    entry: { ...DEFAULT_ENTRY_CONFIG, uniformConviction: 'high' },
    ...over,
  };
}

/** 종가 배열에서 5분봉을 만든다. 고가·저가는 시가·종가 바깥으로 spread만큼 벌린다. */
export function candles5m(
  closes: number[],
  opts: { volume?: number | number[]; spread?: number; startMs?: number } = {},
): Candle[] {
  const spread = opts.spread ?? 0.4;
  const start = opts.startMs ?? START_MS;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const volume = Array.isArray(opts.volume) ? opts.volume[i] : (opts.volume ?? 1000);
    return {
      openTime: start + i * MS_5M,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume,
      closed: true,
    };
  });
}

/**
 * 진입 신호가 반복적으로 나오는 시리즈.
 *
 * 상승 추세 -> 눌림 -> 재개를 cycles번 반복해 여러 트레이드를 만든다.
 * 봉당 변동성이 일정해 ATR 이상치 필터에 걸리지 않는다.
 */
export function repeatingBreakouts(cycles: number): number[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 60; i++) {
    p += 0.35 + (i % 3 === 0 ? -0.15 : 0.1);
    closes.push(p);
  }
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 10; i++) {
      p -= 0.8;
      closes.push(p);
    }
    for (const step of [2, 3, 4, 5]) {
      p += step;
      closes.push(p);
    }
    for (let i = 0; i < 12; i++) {
      p += 0.3 + (i % 3 === 0 ? -0.1 : 0.05);
      closes.push(p);
    }
  }
  return closes;
}

/** 신호가 날 만한 지점마다 거래량을 띄운 배열 */
export function breakoutVolumes(closes: number[]): number[] {
  return closes.map((c, i) => (i > 0 && c - closes[i - 1] > 1.5 ? 5000 : 1000));
}

export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * 이평선 스택(SMMA135)이 확정될 때까지 끌고 가는 도입부.
 *
 * 스택이 없으면 셋업 분류가 되지 않아 진입 자체가 나오지 않는다 (ADR-022).
 * repeatingBreakouts의 첫 구간과 같은 기울기로 이어붙여 추세를 끊지 않는다.
 */
function stackWarmup(count = 120, endPrice = 100): number[] {
  const slope = 0.3;
  const start = endPrice - count * slope;
  return Array.from({ length: count }, (_, i) => start + i * slope);
}

/** 워밍업 구간(진입 신호가 정확히 여기서 나도록 잘라둔 것)의 종가 */
const WARMUP_CLOSES = [...stackWarmup(), ...repeatingBreakouts(1).slice(0, 74)];

/**
 * 워밍업으로 진입을 하나 만들고, **진입 이후 캔들을 직접 지정**한다.
 *
 * 합성 캔들은 open이 항상 이전 close와 같아 지정가가 100% 체결되고
 * 손절·청산·물타기 경로를 밟지 않는다. 각 경로를 정확히 검증하려면
 * 진입 이후를 손으로 지정해야 한다.
 *
 * 진입은 워밍업 마지막 캔들의 신호로 `after[0]`의 시가에 체결된다.
 */
export function scenario(after: Bar[]): { candles: Candle[] } {
  const warmup = candles5m(WARMUP_CLOSES, {
    volume: breakoutVolumes(WARMUP_CLOSES),
  });
  const tail: Candle[] = after.map((bar, i) => ({
    openTime: START_MS + (WARMUP_CLOSES.length + i) * MS_5M,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 1000,
    closed: true,
  }));
  return { candles: [...warmup, ...tail] };
}

/** 워밍업 마지막 종가 — 진입 캔들을 여기서부터 설계한다. */
export const WARMUP_LAST_CLOSE = WARMUP_CLOSES[WARMUP_CLOSES.length - 1];
