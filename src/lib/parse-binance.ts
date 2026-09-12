import type { Candle } from '@/types';

/**
 * Binance Futures klines 응답을 Candle[]로 바꾼다.
 *
 * Deepcoin과 달리 오름차순이지만 값은 마찬가지로 문자열이고 마지막 캔들이
 * 미확정일 수 있다. 파싱을 순수 함수로 빼 테스트로 고정한다.
 *
 * 행 형식: [openTime, open, high, low, close, volume, closeTime, ...]
 */
export function parseBinanceKlines(
  rows: (string | number)[][],
  nowMs: number,
): Candle[] {
  const byOpenTime = new Map<number, Candle>();

  for (const row of rows) {
    if (row.length < 7) continue;

    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const closeTime = Number(row[6]);

    if (
      ![openTime, open, high, low, close, volume, closeTime].every(Number.isFinite)
    ) {
      continue;
    }

    // closeTime은 캔들의 마지막 밀리초다. 그 시각을 지나야 확정이다.
    if (closeTime > nowMs) continue;

    byOpenTime.set(openTime, {
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closed: true,
    });
  }

  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}
