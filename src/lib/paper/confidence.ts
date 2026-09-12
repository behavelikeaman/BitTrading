/**
 * 승률 신뢰구간.
 *
 * 표본이 모자라면 관측 승률은 아무것도 말해주지 않는다. 100건이면
 * ±9.8%p라 55%와 45%를 구분할 수 없다. 이 폭을 보여주는 것 자체가
 * "아직 판단할 수 없다"는 메시지다 (ADR-020).
 */
export interface WinRateInterval {
  /** 95% 신뢰구간 반폭 (비율) */
  marginOfError: number;
  low: number;
  high: number;
  /** 이 표본으로 손익분기를 넘었다고 말할 수 있는가 */
  conclusive: boolean;
}

const Z_95 = 1.96;

export function winRateInterval(
  winRate: number,
  sampleSize: number,
  breakEvenWinRate: number | null,
): WinRateInterval | null {
  if (sampleSize <= 0) return null;
  const se = Math.sqrt((winRate * (1 - winRate)) / sampleSize);
  const margin = Z_95 * se;
  const low = Math.max(0, winRate - margin);
  const high = Math.min(1, winRate + margin);
  return {
    marginOfError: margin,
    low,
    high,
    // 신뢰구간 전체가 손익분기 위에 있어야 결론을 낼 수 있다.
    conclusive: breakEvenWinRate !== null && low > breakEvenWinRate,
  };
}

/** 어떤 차이를 구분하려면 몇 건이 필요한가 */
export function requiredSamples(differencePct: number): number {
  if (differencePct <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(0.25 / (differencePct / 2) ** 2);
}
