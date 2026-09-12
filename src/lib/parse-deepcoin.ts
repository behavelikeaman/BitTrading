import type { Candle } from '@/types';

/**
 * Deepcoin 캔들 응답을 Candle[]로 바꾼다.
 *
 * 이 함수가 막는 함정 세 가지 (docs/DEEPCOIN-API.md):
 *
 * 1. **응답이 내림차순(최신 우선)이다.** src/lib/의 모든 함수는 오름차순을
 *    가정한다. 뒤집지 않아도 예외가 나지 않고 지표만 조용히 거꾸로 계산된다.
 * 2. **모든 값이 문자열이다.** JS에서 `"100" + 1 === "1001"`이라 파싱하지
 *    않으면 지표가 문자열 연결로 망가진다.
 * 3. **마지막 캔들이 미확정일 수 있다.** 진행 중인 캔들로 판정하면
 *    리페인팅이 발생한다 (ADR-006).
 *
 * 행 형식: [타임스탬프(ms), 시가, 고가, 저가, 종가, 거래량(base), 거래량(quote)]
 */
export function parseDeepcoinCandles(
  rows: string[][],
  intervalMs: number,
  nowMs: number,
): Candle[] {
  const byOpenTime = new Map<number, Candle>();

  for (const row of rows) {
    if (row.length < 6) continue;

    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);

    if (
      !Number.isFinite(openTime) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }

    // 캔들이 끝난 시각이 현재 시각을 넘으면 아직 진행 중이다.
    if (openTime + intervalMs > nowMs) continue;

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
