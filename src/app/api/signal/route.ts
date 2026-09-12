import { NextResponse } from 'next/server';
import { fetchFundingRate, fetchRecentCandles } from '@/services/deepcoin';
import { DEFAULT_ENTRY_CONFIG, evaluateEntry } from '@/lib/signal/entry';
import { DEFAULT_ACCOUNT, planPosition } from '@/lib/risk/sizing';
import { DEFAULT_LADDER_HIGH, DEFAULT_LADDER_MEDIUM } from '@/lib/risk/ladder';
import { parseTimeframe, timeframeSpec } from '@/lib/timeframe';
import type { AccountConfig, PositionPlan, Signal } from '@/types';

export const runtime = 'nodejs';

export interface SignalResponse {
  timeframe: '5m' | '15m';
  signal: Signal;
  plan: PositionPlan | null;
  lastPrice: number;
  lastClosedAt: number;
  fundingRate: number;
  updatedAt: number;
}

function numberParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 현재 시그널과 주문 계획.
 *
 * ARCHITECTURE.md의 실시간 흐름을 조립만 한다. 지표·점수·사이징은 전부
 * src/lib/의 함수가 계산하며 여기서 새로 계산하는 값은 없다.
 *
 * GuardState는 v1에 DB가 없으므로 클라이언트가 보유한 값을 쿼리로 받는다.
 */
export async function GET(
  request: Request,
): Promise<NextResponse<SignalResponse | { error: string }>> {
  const params = new URL(request.url).searchParams;

  const guard = {
    consecutiveLosses: numberParam(params, 'consecutiveLosses', 0),
    dailyPnlPct: numberParam(params, 'dailyPnlPct', 0),
  };

  const account: AccountConfig = {
    ...DEFAULT_ACCOUNT,
    equity: numberParam(params, 'equity', DEFAULT_ACCOUNT.equity),
    leverage: numberParam(params, 'leverage', DEFAULT_ACCOUNT.leverage),
    feeRatePerSide: numberParam(params, 'feeRatePerSide', DEFAULT_ACCOUNT.feeRatePerSide),
    slippageRatePerSide: numberParam(
      params,
      'slippageRatePerSide',
      DEFAULT_ACCOUNT.slippageRatePerSide,
    ),
    riskPctHigh: numberParam(params, 'riskPctHigh', DEFAULT_ACCOUNT.riskPctHigh),
    riskPctMedium: numberParam(params, 'riskPctMedium', DEFAULT_ACCOUNT.riskPctMedium),
    atrStopMultiple: numberParam(
      params,
      'atrStopMultiple',
      DEFAULT_ACCOUNT.atrStopMultiple,
    ),
    targetRMultiple: numberParam(
      params,
      'targetRMultiple',
      DEFAULT_ACCOUNT.targetRMultiple,
    ),
    costSource: params.get('costSource') === 'measured' ? 'measured' : 'default',
  };

  const timeframe = parseTimeframe(params.get('timeframe'));
  const spec = timeframeSpec(timeframe);

  try {
    const [candles5m, candles15m, fundingRate] = await Promise.all([
      fetchRecentCandles({ bar: spec.primary, limit: 300 }),
      fetchRecentCandles({ bar: spec.higher, limit: 200 }),
      fetchFundingRate().catch(() => 0),
    ]);

    if (candles5m.length === 0) {
      return NextResponse.json(
        { error: `확정된 ${spec.label}이 없다` },
        { status: 502 },
      );
    }

    // 시각은 서버가 주입한다. src/lib/은 Date.now()를 읽지 않는다.
    const signal = evaluateEntry(
      { candles5m, candles15m, fundingRate, nowMs: Date.now() },
      guard,
      DEFAULT_ENTRY_CONFIG,
    );

    const last = candles5m[candles5m.length - 1];

    const plan =
      signal.conviction !== 'none' &&
      signal.direction !== null &&
      signal.indicators !== null
        ? planPosition({
            direction: signal.direction,
            conviction: signal.conviction,
            entryPrice: last.close,
            atr: signal.indicators.atr14,
            account,
            ladder:
              signal.conviction === 'high' ? DEFAULT_LADDER_HIGH : DEFAULT_LADDER_MEDIUM,
          })
        : null;

    return NextResponse.json({
      timeframe,
      signal,
      plan,
      lastPrice: last.close,
      lastClosedAt: last.openTime,
      fundingRate,
      updatedAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '시그널 계산 실패';
    const status = message.includes('DEEPCOIN_API') ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
