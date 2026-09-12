import { NextResponse } from 'next/server';
import {
  checkCredentials,
  fetchFills,
  fetchRecentCandles,
  fetchStepMargin,
  fetchTradeFee,
} from '@/services/deepcoin';
import type { CredentialStatus } from '@/lib/credential-status';
import { measureSlippage } from '@/lib/measure-slippage';

export const runtime = 'nodejs';

const MS_5M = 300_000;
const DEFAULT_SLIPPAGE = 0.0002;

export interface AccountParamsResponse {
  feeSource: 'measured' | 'default';
  maker: number;
  taker: number;
  mmrTiers: { maxNotional: number; mmr: number }[] | null;
  slippageRate: number;
  slippageSource: 'measured' | 'default';
  slippageSampleCount: number;
  /** 읽기 전용 키 상태. 왜 실측이 안 되는지 화면이 설명할 수 있어야 한다. */
  credential: CredentialStatus;
}

/**
 * 수수료율·유지증거금률·슬리피지를 거래소에서 읽는다 (ADR-012, ADR-014).
 *
 * 읽기 전용 키가 없거나 호출이 실패해도 500을 내지 않는다. 기본값으로
 * 동작하고 화면이 "추정치" 배지를 띄우면 되기 때문이다. 여기서 500을 내면
 * 키 없는 사용자는 앱을 전혀 쓸 수 없게 된다.
 */
export async function GET(): Promise<NextResponse<AccountParamsResponse>> {
  const [fee, stepMargin, fills, candles, credential] = await Promise.all([
    fetchTradeFee().catch(() => null),
    fetchStepMargin().catch(() => null),
    fetchFills({ limit: 200 }).catch(() => null),
    fetchRecentCandles({ bar: '5m', limit: 300 }).catch(() => []),
    checkCredentials(),
  ]);

  // 시장가 진입의 의도 가격은 체결이 속한 5분봉의 시가다.
  const intendedPrices = candles.map((c) => ({ ts: c.openTime, price: c.open }));
  const alignedFills = (fills ?? []).map((f) => ({
    ...f,
    ts: Math.floor(f.ts / MS_5M) * MS_5M,
  }));
  const slippage =
    alignedFills.length > 0 ? measureSlippage(alignedFills, intendedPrices) : null;

  return NextResponse.json({
    feeSource: fee === null ? 'default' : 'measured',
    maker: fee?.maker ?? 0.0002,
    taker: fee?.taker ?? 0.0004,
    mmrTiers: stepMargin?.tiers ?? null,
    slippageRate: slippage?.medianRate ?? DEFAULT_SLIPPAGE,
    slippageSource: slippage === null ? 'default' : 'measured',
    slippageSampleCount: slippage?.sampleCount ?? 0,
    credential,
  });
}
