import type { Candle } from '@/types';

/**
 * True Range. 첫 캔들은 이전 종가가 없으므로 null이다.
 *
 * TR = max(고가 - 저가, |고가 - 전봉종가|, |저가 - 전봉종가|)
 * 갭을 반영해야 5분봉 변동성을 과소평가하지 않는다.
 */
export function trueRange(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  }
  return out;
}

/**
 * Average True Range (Wilder 평활).
 *
 * 첫 유효값은 TR period개의 단순평균이고, 이후는 (prev * (period - 1) + TR) / period.
 * 단순이동평균 대신 Wilder를 쓰는 이유는 손절폭이 변동성 변화에 과민하게
 * 반응하지 않도록 하기 위함이다.
 */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period <= 0) return out;

  const tr = trueRange(candles);
  // TR은 인덱스 1부터 유효하므로 첫 ATR은 인덱스 period에서 확정된다.
  const firstIndex = period;
  if (n <= firstIndex) return out;

  let sum = 0;
  for (let i = 1; i <= firstIndex; i++) sum += tr[i] as number;
  let prev = sum / period;
  out[firstIndex] = prev;

  for (let i = firstIndex + 1; i < n; i++) {
    prev = (prev * (period - 1) + (tr[i] as number)) / period;
    out[i] = prev;
  }
  return out;
}
