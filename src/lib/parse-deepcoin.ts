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

/** 목록 응답에서 배열을 꺼낸다. 배열 자체일 수도, 배열을 품은 객체일 수도 있다. */
export function toRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null) {
    for (const key of ['list', 'data', 'items']) {
      const value = (raw as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/**
 * 수수료율 응답을 읽는다.
 *
 * Deepcoin은 OKX 계열이라 `data`가 배열로 오는 엔드포인트가 있다. 방어하지
 * 않으면 undefined -> NaN -> null이 되어 "실측 실패"로 조용히 넘어가고,
 * 인증은 통과했는데 화면은 "(추정)"에 머문다. 원인을 찾기 어려운 실패다.
 *
 * 수수료는 음수로 오는 경우가 있어 절대값으로 정규화한다.
 */
export function parseTradeFee(raw: unknown): { maker: number; taker: number } | null {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (typeof entry !== 'object' || entry === null) return null;

  const row = entry as { maker?: unknown; taker?: unknown };
  const maker = Math.abs(Number(row.maker));
  const taker = Math.abs(Number(row.taker));
  if (!Number.isFinite(maker) || !Number.isFinite(taker)) return null;
  if (row.maker === undefined || row.taker === undefined) return null;
  return { maker, taker };
}

/**
 * 응답의 **모양만** 한 줄로 적는다. 값은 절대 담지 않는다.
 *
 * 파싱이 실패했을 때 "무엇이 왔길래 실패했나"를 알 수 없으면 추측만 반복하게
 * 된다. 키 이름만 보면 필드명이 다른지, 배열로 감싸여 왔는지 바로 안다.
 */
export function describeShape(raw: unknown): string {
  if (raw === undefined) return '없음';
  if (raw === null) return 'null';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '빈 배열';
    return `배열(${raw.length}) 첫 원소 ${describeShape(raw[0])}`;
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw as Record<string, unknown>);
    return keys.length === 0 ? '빈 객체' : `객체 키: ${keys.join(',')}`;
  }
  return typeof raw;
}
