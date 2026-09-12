import { sma } from '@/lib/indicators/sma';

export interface BollingerBands {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  /** (upper - lower) / middle — 가격 수준에 무관하게 비교하기 위한 정규화 */
  width: (number | null)[];
}

/**
 * 볼린저 밴드. 표준편차는 모집단 기준(n으로 나눔)이다.
 *
 * 중심선은 SMA(period)이며 EMA12 교차 판정에서 그대로 쓰인다.
 */
export function bollinger(closes: number[], period = 20, mult = 2): BollingerBands {
  const n = closes.length;
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const width: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const mean = middle[i];
    if (mean === null) continue;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);

    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
    width[i] = mean === 0 ? 0 : ((upper[i] as number) - (lower[i] as number)) / mean;
  }

  return { middle, upper, lower, width };
}
