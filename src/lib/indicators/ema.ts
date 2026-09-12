import { sma } from '@/lib/indicators/sma';

/**
 * 지수이동평균.
 *
 * 첫 유효값은 SMA(period)로 시드하고 이후 k = 2/(period+1)로 갱신한다.
 * 워밍업 구간은 null이며 길이는 입력과 같다.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const seed = sma(values, period)[period - 1];
  if (seed === null) return out;

  const k = 2 / (period + 1);
  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
