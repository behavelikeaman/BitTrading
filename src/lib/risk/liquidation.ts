import type { Direction, LadderLeg } from '@/types';

/** 명목가 가중 평단. 레그가 없으면 0. */
export function averagePrice(legs: LadderLeg[]): number {
  const totalQty = legs.reduce((sum, l) => sum + l.qty, 0);
  if (totalQty === 0) return 0;
  const totalNotional = legs.reduce((sum, l) => sum + l.notional, 0);
  return totalNotional / totalQty;
}

/**
 * Deepcoin step-margin 구간표에서 명목가에 해당하는 유지증거금률을 고른다.
 *
 * 구간표가 없으면(읽기 전용 키 미설정) 기본값을 그대로 반환한다 (ADR-012).
 */
export function resolveMmr(
  notional: number,
  tiers: { maxNotional: number; mmr: number }[] | null,
  fallback: number,
): number {
  if (tiers === null || tiers.length === 0) return fallback;
  const sorted = [...tiers].sort((a, b) => a.maxNotional - b.maxNotional);
  for (const tier of sorted) {
    if (notional <= tier.maxNotional) return tier.mmr;
  }
  return sorted[sorted.length - 1].mmr;
}

/**
 * 격리 증거금 청산가.
 *
 * 포지션 증거금 기준이며 계좌 전체 자본이 아니다. 롱은
 * avg * (1 - (1/leverage - mmr)), 숏은 부호를 뒤집는다.
 *
 * 50배·MMR 0.5%면 청산 거리는 1.5%다. 이 값을 손절로 쓰면 한 트레이드
 * 손실이 증거금 100%가 되어 손익분기 승률이 88.8%로 치솟는다 (ADR-008).
 */
export function liquidationPrice(input: {
  direction: Direction;
  averageEntryPrice: number;
  leverage: number;
  maintenanceMarginRate: number;
}): number {
  const { direction, averageEntryPrice, leverage, maintenanceMarginRate } = input;
  const distance = 1 / leverage - maintenanceMarginRate;
  return direction === 'long'
    ? averageEntryPrice * (1 - distance)
    : averageEntryPrice * (1 + distance);
}

/**
 * 평단에서 왕복 체결비용까지 회수하는 가격.
 *
 * 사용자 방침대로 물타기 후 "수수료 제하고 본전"에 나오는 목표가다.
 * costRatePerSide는 수수료 + 슬리피지다 (시장가 매매 전제, ADR-014).
 */
export function breakEvenPrice(input: {
  direction: Direction;
  averageEntryPrice: number;
  costRatePerSide: number;
}): number {
  const { direction, averageEntryPrice, costRatePerSide } = input;
  const roundTrip = costRatePerSide * 2;
  return direction === 'long'
    ? averageEntryPrice * (1 + roundTrip)
    : averageEntryPrice * (1 - roundTrip);
}
