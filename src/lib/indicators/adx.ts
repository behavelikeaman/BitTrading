import type { Candle } from '@/types';
import { trueRange } from '@/lib/indicators/atr';

export interface AdxResult {
  plusDi: (number | null)[];
  minusDi: (number | null)[];
  adx: (number | null)[];
}

/**
 * Wilder 방식 +DI / -DI / ADX.
 *
 * 방향성 이동(DM)을 Wilder 평활한 뒤 TR 평활값으로 나눠 DI를 구하고,
 * DX = |+DI - -DI| / (+DI + -DI) * 100을 다시 평활해 ADX를 얻는다.
 *
 * ADX는 추세의 "강도"만 말하고 방향은 말하지 않는다. 방향은 DI 비교로 본다.
 */
export function adx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const plusDi: (number | null)[] = new Array(n).fill(null);
  const minusDi: (number | null)[] = new Array(n).fill(null);
  const adxOut: (number | null)[] = new Array(n).fill(null);
  if (period <= 0 || n <= period) return { plusDi, minusDi, adx: adxOut };

  const tr = trueRange(candles);
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  // Wilder 시드: 인덱스 1..period 합계. 첫 DI는 인덱스 period에서 확정된다.
  let trSum = 0;
  let plusSum = 0;
  let minusSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i] as number;
    plusSum += plusDm[i];
    minusSum += minusDm[i];
  }

  const dx: (number | null)[] = new Array(n).fill(null);

  const writeDi = (i: number) => {
    const p = trSum === 0 ? 0 : (plusSum / trSum) * 100;
    const m = trSum === 0 ? 0 : (minusSum / trSum) * 100;
    plusDi[i] = p;
    minusDi[i] = m;
    const denom = p + m;
    dx[i] = denom === 0 ? 0 : (Math.abs(p - m) / denom) * 100;
  };

  writeDi(period);

  for (let i = period + 1; i < n; i++) {
    trSum = trSum - trSum / period + (tr[i] as number);
    plusSum = plusSum - plusSum / period + plusDm[i];
    minusSum = minusSum - minusSum / period + minusDm[i];
    writeDi(i);
  }

  // ADX 시드: DX period개의 평균. DI보다 period만큼 늦게 확정된다.
  const firstAdxIndex = period * 2 - 1;
  if (n <= firstAdxIndex) return { plusDi, minusDi, adx: adxOut };

  let dxSum = 0;
  for (let i = period; i <= firstAdxIndex; i++) dxSum += dx[i] as number;
  let prevAdx = dxSum / period;
  adxOut[firstAdxIndex] = prevAdx;

  for (let i = firstAdxIndex + 1; i < n; i++) {
    prevAdx = (prevAdx * (period - 1) + (dx[i] as number)) / period;
    adxOut[i] = prevAdx;
  }

  return { plusDi, minusDi, adx: adxOut };
}
