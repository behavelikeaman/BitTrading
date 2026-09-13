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

/**
 * 2번 케이스 — 눌림목 재진입 롱.
 *
 * 스택이 정배열로 자리잡을 만큼 완만히 오른 뒤(135봉 워밍업), 눌림에서
 * EMA12가 BB중앙선 아래로 내려갔다가 마지막 봉에서 다시 위로 교차한다.
 * 이격은 평소 수준을 유지해 "과이격 추격"으로 분류되지 않아야 한다.
 */
export function trendPullbackLong(): number[] {
  const closes: number[] = [];
  let p = 100;
  // 스택 형성 — 빠른 선이 느린 선 위로 자리잡을 만큼 길게 간다.
  for (let i = 0; i < 160; i++) {
    p += 0.3 + (i % 4 === 0 ? -0.12 : 0.05);
    closes.push(p);
  }
  // 눌림 — EMA12가 중앙선 아래로
  for (let i = 0; i < 6; i++) {
    p -= 0.9;
    closes.push(p);
  }
  // 재개 — 마지막 봉에서 상향 교차
  for (const step of [2.0, 2.6, 3.2]) {
    p += step;
    closes.push(p);
  }
  return closes;
}

/**
 * 1번 케이스 — 과이격 후 되돌림 숏.
 *
 * 정배열 상태에서 급한 상승으로 스택 간격이 평소보다 크게 벌어진 뒤,
 * EMA12가 BB중앙선을 하향 교차한다. 배열은 아직 정배열이라 "추세 반대"
 * 교차이며, 벌어진 간격이 되돌림의 근거다.
 */
export function overextendedReversionShort(): number[] {
  const closes: number[] = [];
  let p = 100;
  // 평소 이격 수준을 만드는 완만한 상승
  for (let i = 0; i < 150; i++) {
    p += 0.12 + (i % 4 === 0 ? -0.05 : 0.02);
    closes.push(p);
  }
  // 급등 — 빠른 선만 끌어올려 간격을 벌린다. 평소 이격의 1.8배를 넘겨야
  // "벌어졌다"로 분류되므로 충분히 길게 간다.
  for (let i = 0; i < 30; i++) {
    p += 0.8;
    closes.push(p);
  }
  // 꺾임 — 마지막 봉에서 하향 교차
  for (const step of [5, 6, 7]) {
    p -= step;
    closes.push(p);
  }
  return closes;
}

/**
 * 과이격 추격 — 진입하면 안 되는 자리.
 *
 * 급등으로 간격이 벌어진 뒤 잠깐 눌렸다가 추세 방향으로 다시 교차한다.
 * 모양만 보면 눌림목 재진입과 똑같지만, 스택이 이미 벌어져 있어서
 * 되돌림을 정면으로 맞는 자리다.
 */
export function overextendedChaseLong(): number[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 150; i++) {
    p += 0.12 + (i % 4 === 0 ? -0.05 : 0.02);
    closes.push(p);
  }
  for (let i = 0; i < 30; i++) {
    p += 0.8;
    closes.push(p);
  }
  for (let i = 0; i < 4; i++) {
    p -= 3;
    closes.push(p);
  }
  for (const step of [3, 4, 6]) {
    p += step;
    closes.push(p);
  }
  return closes;
}

/**
 * 교차는 났는데 종가가 그 자리를 만들지 못한 시리즈 (밴드 돌파 셋업, 종가가 밴드 안).
 *
 * 고정 시드 난수 보행이다. 손으로 그린 매끈한 시리즈로는 이 상태가 재현되지
 * 않았다 — 교차 시점에 종가가 거의 항상 밴드 밖이나 중앙선 반대편에 있었다.
 * 시드를 바꾸면 다른 상황이 되므로 값을 고정한다.
 */
export function crossWithoutPosition(): number[] {
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < 200; i++) {
    p += (rnd() - 0.5) * 1.2;
    out.push(p);
  }
  return out;
}
