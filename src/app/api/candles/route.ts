import { NextResponse } from 'next/server';
import { fetchRecentCandles } from '@/services/deepcoin';
import type { Candle } from '@/types';

export const runtime = 'nodejs';

/** 차트용 실시간 캔들. 계산 없이 그대로 전달한다. */
export async function GET(
  request: Request,
): Promise<NextResponse<{ candles: Candle[] } | { error: string }>> {
  const params = new URL(request.url).searchParams;
  const raw = params.get('bar');
  const bar = raw === '15m' ? '15m' : raw === '1h' ? '1h' : '5m';
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
