import type { Candle } from '@/types';
import { parseBinanceKlines } from '@/lib/parse-binance';

const BASE_URL = 'https://fapi.binance.com';
/** 1회 최대 개수. 이보다 긴 구간은 페이지네이션한다. */
const MAX_LIMIT = 1500;

const INTERVAL_MS: Record<'5m' | '15m', number> = {
  '5m': 300_000,
  '15m': 900_000,
};

/** 레이트리밋 회피용 최소 간격 */
const REQUEST_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Binance Futures 과거 캔들. 공개 엔드포인트라 키가 필요 없다 (ADR-003).
 *
 * startTime을 밀며 페이지네이션하고, 반환 배열은 오름차순·중복 제거·
 * 미확정봉 제외다. 파싱은 src/lib/parse-binance.ts의 순수 함수가 맡는다.
 */
export async function fetchHistoricalCandles(input: {
  symbol?: string;
  interval: '5m' | '15m';
  startTime: number;
  endTime: number;
  /** 진행률 보고용 (선택) */
  onProgress?: (fetched: number, lastOpenTime: number) => void;
}): Promise<Candle[]> {
  const symbol = input.symbol ?? 'BTCUSDT';
  const intervalMs = INTERVAL_MS[input.interval];
  const collected = new Map<number, Candle>();

  let cursor = input.startTime;
  while (cursor < input.endTime) {
    const url = new URL('/fapi/v1/klines', BASE_URL);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', input.interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(input.endTime));
    url.searchParams.set('limit', String(MAX_LIMIT));

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(
        `Binance klines 조회 실패 (${response.status}): ${await response.text()}`,
      );
    }

    const rows = (await response.json()) as (string | number)[][];
    if (rows.length === 0) break;

    const parsed = parseBinanceKlines(rows, input.endTime);
    for (const candle of parsed) collected.set(candle.openTime, candle);

    const lastOpenTime = Number(rows[rows.length - 1][0]);
    input.onProgress?.(collected.size, lastOpenTime);

    // 마지막 캔들 다음부터 이어 받는다. 진행이 없으면 무한 루프를 막는다.
    const next = lastOpenTime + intervalMs;
    if (next <= cursor) break;
    cursor = next;

    if (rows.length < MAX_LIMIT) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return [...collected.values()].sort((a, b) => a.openTime - b.openTime);
}
