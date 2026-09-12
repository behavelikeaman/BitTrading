import type { AccountConfig, Conviction, Direction, PositionPlan } from '@/types';
import {
  buildLadder,
  ladderLossAtStop,
  ladderPrices,
  ladderStopPrice,
  type LadderPlanInput,
} from '@/lib/risk/ladder';
import {
  averagePrice,
  breakEvenPrice,
  liquidationPrice,
  resolveMmr,
} from '@/lib/risk/liquidation';

export const DEFAULT_ACCOUNT: AccountConfig = {
  equity: 5000,
  leverage: 50,
  feeRatePerSide: 0.0004,
  slippageRatePerSide: 0.0002,
  maintenanceMarginRate: 0.005,
  riskPctHigh: 0.02,
  riskPctMedium: 0.01,
  atrStopMultiple: 1.2,
  targetRMultiple: 1.38,
  costSource: 'default',
};

/** 단일 진입(물타기 없음) */
const SINGLE_LEG: LadderPlanInput = {
  addCount: 0,
  addSpacingAtr: 0,
  weights: [1],
};

/** 시장가 매매의 편도 체결비용 = 수수료 + 슬리피지 (ADR-014) */
export function costRatePerSide(account: AccountConfig): number {
  return account.feeRatePerSide + account.slippageRatePerSide;
}

export interface PlanPositionInput {
  direction: Direction;
  conviction: Conviction;
  entryPrice: number;
  /** ATR(14) 절대값 (가격 단위) */
  atr: number;
  account: AccountConfig;
  /** 없으면 단일 진입 */
  ladder?: LadderPlanInput;
  /** Deepcoin step-margin 구간표 (ADR-012). 없으면 account 기본값 사용 */
  mmrTiers?: { maxNotional: number; mmr: number }[] | null;
  /** 거래소 최소 수량 단위. 기본 0.001 BTC */
  qtyStep?: number;
}

/**
 * 포지션 계획을 세운다.
 *
 * 계산 순서는 **리스크 예산 -> 명목가 -> 수량 -> 증거금**이며 절대 뒤집지 않는다
 * (ADR-009). 증거금 비율에서 출발하면 실제 리스크를 모르는 채 포지션을 잡게 된다.
 *
 * 목표는 손절폭의 배수로 정의하므로 레버리지를 바꿔도 목표가·손절가·명목가가
 * 변하지 않는다. 레버리지는 증거금과 청산가에만 영향을 준다 (ADR-013).
 */
export function planPosition(input: PlanPositionInput): PositionPlan {
  const {
    direction,
    conviction,
    entryPrice,
    atr,
    account,
    ladder = SINGLE_LEG,
    mmrTiers = null,
    qtyStep = 0.001,
  } = input;

  const cost = costRatePerSide(account);
  const roundTripCost = cost * 2;

  // 1. 리스크 예산
  const riskPct =
    conviction === 'high' ? account.riskPctHigh : account.riskPctMedium;
  const budget = account.equity * riskPct;

  // 2. 손절폭 (ATR 기반, 청산가가 아니다 — ADR-008)
  const stopWidth = atr * account.atrStopMultiple;

  // 3. 목표 가격폭 = 손절폭 × 배수 (레버리지 무관 — ADR-013)
  const targetWidth = stopWidth * account.targetRMultiple;

  // 4. 총명목가 역산. 레그마다 손절까지 거리가 다르므로 가중합으로 푼다.
  const prices = ladderPrices({ direction, entryPrice, atr, plan: ladder });
  const stopPrice = ladderStopPrice({
    direction,
    prices,
    atr,
    atrStopMultiple: account.atrStopMultiple,
  });
  const weightedStopDistance = prices.reduce(
    (sum, price, i) =>
      sum + (ladder.weights[i] * Math.abs(price - stopPrice)) / price,
    0,
  );
  const denominator = weightedStopDistance + roundTripCost;
  const totalNotional = denominator > 0 ? budget / denominator : 0;

  // 5. 수량·증거금. 반올림 후 값으로 리스크를 다시 계산한다.
  const legs = buildLadder({
    direction,
    entryPrice,
    atr,
    totalNotional,
    leverage: account.leverage,
    plan: ladder,
    qtyStep,
  });

  const actualNotional = legs.reduce((s, l) => s + l.notional, 0);
  const totalMargin = legs.reduce((s, l) => s + l.margin, 0);
  const averageEntryPrice = averagePrice(legs);
  const riskBudget = ladderLossAtStop(legs, stopPrice, cost);

  const takeProfitPrice =
    direction === 'long'
      ? averageEntryPrice + targetWidth
      : averageEntryPrice - targetWidth;

  const mmr = resolveMmr(actualNotional, mmrTiers, account.maintenanceMarginRate);
  const liqPrice =
    averageEntryPrice > 0
      ? liquidationPrice({
          direction,
          averageEntryPrice,
          leverage: account.leverage,
          maintenanceMarginRate: mmr,
        })
      : 0;

  const bePrice =
    averageEntryPrice > 0
      ? breakEvenPrice({ direction, averageEntryPrice, costRatePerSide: cost })
      : 0;

  // 목표 도달 시 순이익: 가격 이득에서 왕복 체결비용을 뺀다.
  const grossReward =
    averageEntryPrice > 0 ? (actualNotional * targetWidth) / averageEntryPrice : 0;
  const rewardAtTarget = grossReward - actualNotional * roundTripCost;

  const breakEvenWinRate =
    riskBudget + rewardAtTarget > 0 ? riskBudget / (riskBudget + rewardAtTarget) : 1;

  // 표시용 환산값 (ADR-013)
  const targetNetReturnOnMargin =
    entryPrice > 0
      ? (targetWidth / entryPrice) * account.leverage -
        roundTripCost * account.leverage
      : 0;

  const warnings: string[] = [];

  const stopDistanceFromAvg = Math.abs(averageEntryPrice - stopPrice);
  const liqDistanceFromAvg = Math.abs(averageEntryPrice - liqPrice);
  if (averageEntryPrice > 0 && liqDistanceFromAvg <= stopDistanceFromAvg) {
    warnings.push(
      '청산가가 손절가보다 가깝다. 레버리지를 낮추거나 손절폭을 좁혀라.',
    );
  }
  if (totalMargin > account.equity) {
    warnings.push(
      `증거금 ${totalMargin.toFixed(0)} USDT가 자본금 ${account.equity.toFixed(0)} USDT를 초과한다.`,
    );
  }
  if (breakEvenWinRate > 0.6) {
    warnings.push(
      `손익분기 승률 ${(breakEvenWinRate * 100).toFixed(1)}%. 이 설정으로는 수익을 내기 어렵다.`,
    );
  }
  if (rewardAtTarget < riskBudget) {
    warnings.push('손익비가 1 미만이다.');
  }
  if (account.costSource === 'default') {
    warnings.push(
      '수수료·슬리피지가 추정치다. 실측값을 불러오면 계산이 정확해진다.',
    );
  }

  return {
    direction,
    conviction,
    legs,
    stopPrice,
    takeProfitPrice,
    breakEvenPrice: bePrice,
    averageEntryPrice,
    totalNotional: actualNotional,
    totalMargin,
    liquidationPrice: liqPrice,
    riskBudget,
    rewardAtTarget,
    breakEvenWinRate,
    targetNetReturnOnMargin,
    warnings,
  };
}
