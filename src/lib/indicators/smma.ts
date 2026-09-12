import { sma } from '@/lib/indicators/sma';

/**
 * 평활이동평균 (SMMA = Wilder RMA).
 *
 * 첫 유효값은 SMA(period)로 시드하고 이후 (prev * (period - 1) + value) / period.
 * 평활계수가 1/period라 EMA(2/(period+1))보다 항상 느리게 반응한다.
 *
 * 사용자의 실제 차트가 이 이평선(SMMA 20·55·95·135)으로 배열과 이격을
 * 판정하므로, 화면과 시스템이 같은 선을 봐야 판단이 어긋나지 않는다.
 * ATR의 Wilder 평활과 같은 식이다.
 */
export function smma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const seed = sma(values, period)[period - 1];
  if (seed === null) return out;

  out[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}
