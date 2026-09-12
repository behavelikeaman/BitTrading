import type { AccountConfig, Candle } from '@/types';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { DEFAULT_BACKTEST_PARAMS, type BacktestParams } from '@/lib/backtest/engine';

const MS_5M = 300_000;
const MS_15M = 900_000;

/** 세션 필터를 통과하는 UTC 12시 기준 시작 시각 */
export const START_MS = Date.UTC(2026, 0, 5, 9, 0, 0);

export const TEST_ACCOUNT: AccountConfig = {
  ...DEFAULT_ACCOUNT,
  slippageRatePerSide: 0,
  costSource: 'measured',
};

export function testParams(over: Partial<BacktestParams> = {}): BacktestParams {
  return {
    ...DEFAULT_BACKTEST_PARAMS,
    account: TEST_ACCOUNT,
    entry: DEFAULT_ENTRY_CONFIG,
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

/** 5분봉과 시각 축을 맞춘 15분봉 */
export function candles15m(closes: number[], startMs = START_MS): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      openTime: startMs + i * MS_15M,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000,
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

/** 15분봉 상승 시리즈 (5분봉 개수에 맞춰 1/3 길이) */
export function risingHtfFor(count5m: number): number[] {
  const n = Math.ceil(count5m / 3) + 60;
  return Array.from({ length: n }, (_, i) => 100 + i * 0.5);
}

export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** 워밍업 구간(진입 신호가 정확히 여기서 나도록 잘라둔 것)의 종가 */
const WARMUP_CLOSES = repeatingBreakouts(1).slice(0, 74);

/**
 * 워밍업으로 진입을 하나 만들고, **진입 이후 캔들을 직접 지정**한다.
 *
 * 합성 캔들은 open이 항상 이전 close와 같아 지정가가 100% 체결되고
 * 손절·청산·물타기 경로를 밟지 않는다. 각 경로를 정확히 검증하려면
 * 진입 이후를 손으로 지정해야 한다.
 *
 * 진입은 워밍업 마지막 캔들의 신호로 `after[0]`의 시가에 체결된다.
 */
export function scenario(after: Bar[]): {
  candles5m: Candle[];
  candles15m: Candle[];
} {
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
  const total = WARMUP_CLOSES.length + after.length;
  return {
    candles5m: [...warmup, ...tail],
    candles15m: candles15m(risingHtfFor(total)),
  };
}

/** 워밍업 마지막 종가 — 진입 캔들을 여기서부터 설계한다. */
export const WARMUP_LAST_CLOSE = WARMUP_CLOSES[WARMUP_CLOSES.length - 1];
