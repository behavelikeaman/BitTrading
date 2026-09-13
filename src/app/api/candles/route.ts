import { NextResponse } from 'next/server';
import { fetchRecentCandles } from '@/services/deepcoin';
import { parseTimeframe } from '@/lib/timeframe';
import type { Candle } from '@/types';

export const runtime = 'nodejs';

/** 차트용 실시간 캔들. 계산 없이 그대로 전달한다. */
export async function GET(
  request: Request,
): Promise<NextResponse<{ candles: Candle[] } | { error: string }>> {
  const params = new URL(request.url).searchParams;
  // 차트도 기준 봉만 그린다. 상위 프레임 캔들을 받아오는 경로는 없앴다 (ADR-026).
  const bar = parseTimeframe(params.get('bar'));
  const limit = Number(params.get('limit') ?? 200);

  if (!Number.isFinite(limit) || limit <= 0) {
    return NextResponse.json({ error: 'limit이 잘못됐다' }, { status: 400 });
  }

  try {
    const candles = await fetchRecentCandles({ bar, limit });
    return NextResponse.json({ candles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '시세 조회 실패' },
      { status: 502 },
    );
  }
}
