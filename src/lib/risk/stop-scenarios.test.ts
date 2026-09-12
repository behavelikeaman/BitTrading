import { describe, expect, it } from 'vitest';
import { stopScenarios } from '@/lib/risk/stop-scenarios';
import type { LadderLeg } from '@/types';

/** 레그 하나짜리 단순 포지션. 진입 100, 명목가 1000 */
function legs(price = 100, notional = 1000): LadderLeg[] {
  return [{ index: 0, price, qty: notional / price, notional, margin: notional / 50 }];
}

const BASE = {
  direction: 'long' as const,
  legs: legs(),
  atr: 1,
  liquidationPrice: 98.5,
  totalMargin: 20,
  rewardAtTarget: 10,
  costRatePerSide: 0.0004,
  atrMultiples: [1.2, 2, 3],
};

describe('stopScenarios — 손절 자리가 필요 승률을 정한다', () => {
  it('ATR 배수마다 손절가·손실·필요 승률을 낸다', () => {
    const rows = stopScenarios(BASE);
    // ATR 배수 3개 + 청산까지 버팀 1개
    expect(rows).toHaveLength(4);
    expect(rows[0].stopPrice).toBeCloseTo(98.8, 10); // 100 - 1 * 1.2
    expect(rows[1].stopPrice).toBeCloseTo(98.0, 10);
  });

  it('손절이 멀수록 손실도 필요 승률도 커진다', () => {
    const rows = stopScenarios(BASE);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].loss).toBeGreaterThanOrEqual(rows[i - 1].loss);
      expect(rows[i].breakEvenWinRate).toBeGreaterThanOrEqual(
        rows[i - 1].breakEvenWinRate,
      );
    }
  });

  it('필요 승률 = 손실 / (손실 + 목표이익)', () => {
    // 진입 100, 명목가 1000, 손절 98.8 -> 가격손실 1000*1.2/100 = 12
    // 왕복 체결비용 1000*0.0004*2 = 0.8 -> 총 12.8
    // 목표이익 10 -> 12.8 / 22.8 = 0.5614
    const row = stopScenarios(BASE)[0];
    expect(row.loss).toBeCloseTo(12.8, 10);
    expect(row.breakEvenWinRate).toBeCloseTo(12.8 / 22.8, 10);
  });

  it('증거금 대비 손실 비율도 함께 낸다', () => {
    const row = stopScenarios(BASE)[0];
    expect(row.lossPctOfMargin).toBeCloseTo(12.8 / 20, 10);
  });

  it('청산까지 버티는 줄은 증거금 전액을 잃는다', () => {
    const last = stopScenarios(BASE)[3];
    expect(last.beyondLiquidation).toBe(true);
    expect(last.loss).toBe(BASE.totalMargin);
    expect(last.lossPctOfMargin).toBe(1);
    expect(last.stopPrice).toBe(BASE.liquidationPrice);
  });

  it('청산보다 먼 손절은 실제로 체결되지 않으므로 손실을 증거금 전액으로 묶는다', () => {
    // 청산 98.5보다 아래(98.0)인 ATR×3 손절은 영영 닿지 않는다.
    // 계산상 손실(30.8)을 그대로 보여주면 실제(증거금 20)보다 크게 나와
    // 오히려 덜 위험해 보이는 역설이 생긴다 (ADR-008과 같은 이유).
    const rows = stopScenarios(BASE);
    const far = rows[2];
    expect(far.beyondLiquidation).toBe(true);
    expect(far.loss).toBe(BASE.totalMargin);
  });

  it('청산 안쪽 손절은 체결 가능한 자리로 표시한다', () => {
    expect(stopScenarios(BASE)[0].beyondLiquidation).toBe(false);
  });

  it('숏은 손절가가 진입 위로 간다', () => {
    const rows = stopScenarios({
      ...BASE,
      direction: 'short',
      liquidationPrice: 101.5,
    });
    expect(rows[0].stopPrice).toBeCloseTo(101.2, 10);
    expect(rows[0].loss).toBeCloseTo(12.8, 10);
  });

  it('목표 이익이 0이면 필요 승률은 100%다', () => {
    const rows = stopScenarios({ ...BASE, rewardAtTarget: 0 });
    expect(rows[0].breakEvenWinRate).toBe(1);
  });

  it('물타기 레그가 있으면 평단이 아니라 레그별 거리로 손실을 잰다', () => {
    // 레그 2개(100, 99)를 각 명목가 1000씩. 손절 97.8(마지막 레그 -1.2ATR)
    // leg0: 1000*2.2/100 = 22, leg1: 1000*1.2/99 = 12.121
    // 비용: 2000*0.0004*2 = 1.6 -> 합계 35.72
    const two: LadderLeg[] = [
      { index: 0, price: 100, qty: 10, notional: 1000, margin: 20 },
      { index: 1, price: 99, qty: 10.1, notional: 1000, margin: 20 },
    ];
    const rows = stopScenarios({
      ...BASE,
      legs: two,
      totalMargin: 40,
      liquidationPrice: 97,
    });
    expect(rows[0].stopPrice).toBeCloseTo(97.8, 10);
    expect(rows[0].loss).toBeCloseTo(22 + (1000 * 1.2) / 99 + 1.6, 6);
  });

  it('레그가 없으면 빈 배열을 반환한다', () => {
    expect(stopScenarios({ ...BASE, legs: [] })).toEqual([]);
  });
});
