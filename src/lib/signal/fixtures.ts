import type { Candle } from '@/types';

/** 테스트 전용 캔들 생성기. 종가 배열에서 캔들을 만든다. */
export function candlesFromCloses(
  closes: number[],
  opts: { volume?: number | number[]; intervalMs?: number; spread?: number } = {},
): Candle[] {
  const interval = opts.intervalMs ?? 300_000;
  const spread = opts.spread ?? 0.5;
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const volume = Array.isArray(opts.volume)
      ? opts.volume[i]
      : (opts.volume ?? 1000);
    return {
      openTime: i * interval,
      open: prev,
      high: Math.max(prev, close) + spread,
      low: Math.min(prev, close) - spread,
      close,
      volume,
      closed: true,
    };
  });
}

/** 평평한 구간 뒤 마지막 봉만 크게 움직이는 시리즈 — EMA12가 SMA20을 확실히 교차한다. */
export function flatThenJump(flatCount: number, base: number, jumpTo: number): number[] {
  return [...new Array(flatCount).fill(base), jumpTo];
}

/**
 * 현실적인 돌파 시리즈: 상승 추세 -> 눌림 -> 재개.
 *
 * 눌림에서 EMA12가 SMA20 아래로 내려갔다가 재개 구간에서 위로 교차하고
 * 상단밴드를 돌파한다. 변동성이 봉마다 일정해 ATR 이상치 필터에 걸리지 않는다.
 *
 * 횡보 후 갑자기 급등하는 시리즈로는 이 테스트를 만들 수 없다. 그런 시리즈는
 * ATR이 평균 대비 2배를 넘어 "이상 변동성"으로 정상 차단되기 때문이다.
 */
export function realisticBreakout(): number[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 60; i++) {
    p += 0.35 + (i % 3 === 0 ? -0.15 : 0.1);
    closes.push(p);
  }
  for (let i = 0; i < 10; i++) {
    p -= 0.8;
    closes.push(p);
  }
  for (const step of [2, 3, 4, 5]) {
    p += step;
    closes.push(p);
  }
  return closes;
}

/** 15분봉 상승 시리즈 (EMA50 기울기 양수) */
export function risingHtf(count = 80): number[] {
  return Array.from({ length: count }, (_, i) => 100 + i * 0.5);
}
