import type { Direction, LadderLeg } from '@/types';
import { ladderLossAtStop, ladderStopPrice } from '@/lib/risk/ladder';

export interface StopScenario {
  /** 화면 표시용 이름 (예: "ATR×2.0") */
  label: string;
  /** 이 시나리오의 ATR 배수. 청산까지 버티는 줄은 null */
  atrMultiple: number | null;
  stopPrice: number;
  /** 손절 도달 시 손실 (USDT, 왕복 체결비용 포함) */
  loss: number;
  /** 증거금 대비 손실 비율 */
  lossPctOfMargin: number;
  /** 이 손절을 쓸 때 본전이 되는 승률 */
  breakEvenWinRate: number;
  /**
   * 청산이 이 손절보다 가까운가.
   *
   * 그렇다면 손절 주문은 영영 체결되지 않고 실제 손실은 증거금 전액이다.
   * 계산상의 손실을 그대로 보여주면 실제보다 큰 숫자가 나와 오히려 덜
   * 위험해 보이는 역설이 생기므로, 손실을 증거금으로 묶는다 (ADR-008).
   */
  beyondLiquidation: boolean;
}

export interface StopScenarioInput {
  direction: Direction;
  /** 계획된 레그 전량. 손실은 레그별 거리로 잰다. */
  legs: LadderLeg[];
  atr: number;
  liquidationPrice: number;
  totalMargin: number;
  /** 목표 도달 시 순이익 (USDT). 목표는 시나리오마다 바뀌지 않는다. */
  rewardAtTarget: number;
  costRatePerSide: number;
  /** 비교할 ATR 배수들. 오름차순으로 넣는다. */
  atrMultiples: number[];
}

/**
 * "손절을 여기 두면 승률이 몇 %는 나와야 한다"를 자리별로 계산한다.
 *
 * 재량으로 손절하는 사람에게 필요한 정보는 손절가 자체가 아니라 **그 자리의
 * 대가**다. 같은 목표를 두고도 손절을 두 배 멀리 두면 필요 승률이 10%p씩
 * 뛴다. 진입 전에 그 숫자를 보면 "조금만 더 보자"가 얼마짜리 결정인지
 * 알 수 있다.
 *
 * 마지막 줄은 손절 없이 청산까지 버티는 경우다. 증거금 전액을 잃는다.
 */
export function stopScenarios(input: StopScenarioInput): StopScenario[] {
  const {
    direction,
    legs,
    atr,
    liquidationPrice,
    totalMargin,
    rewardAtTarget,
    costRatePerSide,
    atrMultiples,
  } = input;

  if (legs.length === 0) return [];

  const prices = legs.map((l) => l.price);

  /** 청산가보다 먼 손절인가 — 롱이면 손절가가 청산가 이하일 때 */
  const isBeyondLiquidation = (stopPrice: number) =>
    direction === 'long' ? stopPrice <= liquidationPrice : stopPrice >= liquidationPrice;

  const toScenario = (
    label: string,
    atrMultiple: number | null,
    stopPrice: number,
    rawLoss: number,
  ): StopScenario => {
    const beyond = isBeyondLiquidation(stopPrice);
    // 청산이 먼저 닿으면 실제 손실은 증거금 전액이다.
    const loss = beyond ? totalMargin : rawLoss;
    const denominator = loss + rewardAtTarget;
    return {
      label,
      atrMultiple,
      stopPrice,
      loss,
      lossPctOfMargin: totalMargin > 0 ? loss / totalMargin : 0,
      breakEvenWinRate: denominator > 0 ? loss / denominator : 1,
      beyondLiquidation: beyond,
    };
  };

  const rows = atrMultiples.map((atrStopMultiple) => {
    const stopPrice = ladderStopPrice({ direction, prices, atr, atrStopMultiple });
    return toScenario(
      `ATR×${atrStopMultiple}`,
      atrStopMultiple,
      stopPrice,
      ladderLossAtStop(legs, stopPrice, costRatePerSide),
    );
  });

  rows.push(toScenario('손절 없이 청산까지', null, liquidationPrice, totalMargin));

  return rows;
}
