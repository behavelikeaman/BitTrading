import type { Direction, LadderLeg } from '@/types';

export interface LadderPlanInput {
  /** 물타기 횟수. 확신 1회, 약간의 확신 2회 */
  addCount: number;
  /** 물타기 간격 (ATR 배수). 기본 0.6 */
  addSpacingAtr: number;
  /** 각 레그 비중. 합이 1이어야 한다. 예: [0.5, 0.5] 또는 [0.25, 0.25, 0.5] */
  weights: number[];
}

export const DEFAULT_LADDER_HIGH: LadderPlanInput = {
  addCount: 1,
  addSpacingAtr: 0.6,
  weights: [0.5, 0.5],
};

export const DEFAULT_LADDER_MEDIUM: LadderPlanInput = {
  addCount: 2,
  addSpacingAtr: 0.6,
  weights: [0.25, 0.25, 0.5],
};

function assertPlan(plan: LadderPlanInput): void {
  const expected = plan.addCount + 1;
  if (plan.weights.length !== expected) {
    throw new Error(
      `래더 비중 개수가 레그 수와 다르다: weights ${plan.weights.length}개, 필요 ${expected}개`,
    );
  }
  const sum = plan.weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`래더 비중 합이 1이 아니다: ${sum}`);
  }
  if (plan.weights.some((w) => w <= 0)) {
    throw new Error('래더 비중은 모두 0보다 커야 한다');
  }
}

/**
 * 래더 각 레그의 진입가.
 *
 * 롱은 진입가에서 아래로, 숏은 위로 addSpacingAtr × ATR 간격으로 내려간다.
 */
export function ladderPrices(input: {
  direction: Direction;
  entryPrice: number;
  atr: number;
  plan: LadderPlanInput;
}): number[] {
  assertPlan(input.plan);
  const { direction, entryPrice, atr, plan } = input;
  const sign = direction === 'long' ? -1 : 1;
  return plan.weights.map(
    (_, i) => entryPrice + sign * i * plan.addSpacingAtr * atr,
  );
}

/**
 * 래더 전체 공통 손절가.
 *
 * 1차 진입가가 아니라 **마지막 레그보다 더 먼 곳**에 둔다. 1차 기준으로
 * 잡으면 물타기 레그가 체결되자마자 손절에 닿는다.
 */
export function ladderStopPrice(input: {
  direction: Direction;
  prices: number[];
  atr: number;
  atrStopMultiple: number;
}): number {
  const { direction, prices, atr, atrStopMultiple } = input;
  const lastPrice = prices[prices.length - 1];
  const width = atr * atrStopMultiple;
  return direction === 'long' ? lastPrice - width : lastPrice + width;
}

/**
 * 총명목가를 비중대로 쪼개 레그를 만든다.
 *
 * qtyStep이 주어지면 수량을 거래소 최소 단위로 내림한 뒤 명목가를 다시 계산한다.
 * 반올림 후 값으로 리스크를 재검증해야 예산 초과를 놓치지 않는다.
 */
export function buildLadder(input: {
  direction: Direction;
  entryPrice: number;
  atr: number;
  totalNotional: number;
  leverage: number;
  plan: LadderPlanInput;
  qtyStep?: number;
}): LadderLeg[] {
  const { direction, entryPrice, atr, totalNotional, leverage, plan, qtyStep } = input;
  const prices = ladderPrices({ direction, entryPrice, atr, plan });

  return prices.map((price, i) => {
    const targetNotional = totalNotional * plan.weights[i];
    let qty = targetNotional / price;
    if (qtyStep !== undefined && qtyStep > 0) {
      qty = Math.floor(qty / qtyStep) * qtyStep;
    }
    const notional = qty * price;
    return { index: i, price, qty, notional, margin: notional / leverage };
  });
}

/**
 * 래더 전체가 손절에 닿았을 때의 총손실 (USDT, 왕복 체결비용 포함).
 *
 * 각 레그의 손절까지 거리가 다르므로 레그별로 따로 계산해 합산해야 한다.
 * 단일 진입 공식을 레그에 그대로 적용하면 실제 손실이 예산을 초과한다.
 */
export function ladderLossAtStop(
  legs: LadderLeg[],
  stopPrice: number,
  costRatePerSide: number,
): number {
  let loss = 0;
  for (const leg of legs) {
    if (leg.notional === 0) continue;
    loss += (leg.notional * Math.abs(leg.price - stopPrice)) / leg.price;
    loss += leg.notional * costRatePerSide * 2;
  }
  return loss;
}
