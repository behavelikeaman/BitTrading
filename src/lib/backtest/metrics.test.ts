import { describe, expect, it } from 'vitest';
import { computeMetrics } from '@/lib/backtest/metrics';
import type { Trade } from '@/types';

function trade(netPnl: number, over: Partial<Trade> = {}): Trade {
  return {
    entryTime: 0,
    exitTime: 1,
    direction: 'long',
    conviction: 'high',
    score: 8,
    legs: [],
    averageEntryPrice: 100,
    exitPrice: 100,
    exitReason: netPnl >= 0 ? 'take-profit' : 'stop-loss',
    grossPnl: netPnl,
    fees: 0,
    funding: 0,
    netPnl,
    netPnlPct: netPnl / 5000,
    ...over,
  };
}

describe('computeMetrics — 빈 입력', () => {
  it('트레이드가 0개면 전 지표가 0이고 예외를 던지지 않는다', () => {
    const m = computeMetrics([], 5000);
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.expectancy).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.finalEquity).toBe(5000);
    expect(m.equityCurve).toEqual([]);
  });
});

describe('computeMetrics — 기본 지표', () => {
  const trades = [trade(100), trade(-50), trade(100), trade(-50)];

  it('승률은 순손익이 양수인 비율이다', () => {
    expect(computeMetrics(trades, 5000).winRate).toBeCloseTo(0.5, 10);
  });

  it('손익비는 총이익 / |총손실| 이다', () => {
    expect(computeMetrics(trades, 5000).profitFactor).toBeCloseTo(200 / 100, 10);
  });

  it('기대값은 트레이드당 평균 순손익이다', () => {
    expect(computeMetrics(trades, 5000).expectancy).toBeCloseTo(100 / 4, 10);
  });

  it('최종 자본은 시작 자본에 순손익 합을 더한 값이다', () => {
    expect(computeMetrics(trades, 5000).finalEquity).toBeCloseTo(5100, 10);
  });

  it('손실이 하나도 없으면 손익비는 무한대다', () => {
    expect(computeMetrics([trade(10), trade(20)], 5000).profitFactor).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('computeMetrics — 낙폭과 연속 손실', () => {
  it('최대 낙폭은 고점 대비 최대 하락 비율이다', () => {
    // 5000 -> 6000 -> 4800 : 고점 6000에서 20% 하락
    const m = computeMetrics([trade(1000), trade(-1200)], 5000);
    expect(m.maxDrawdown).toBeCloseTo(0.2, 10);
  });

  it('최대 연속 손실을 센다', () => {
    const m = computeMetrics(
      [trade(-10), trade(-10), trade(50), trade(-10), trade(-10), trade(-10)],
      5000,
    );
    expect(m.maxConsecutiveLosses).toBe(3);
  });

  it('이익이 끼면 연속 손실이 끊긴다', () => {
    const m = computeMetrics([trade(-10), trade(50), trade(-10)], 5000);
    expect(m.maxConsecutiveLosses).toBe(1);
  });
});

describe('computeMetrics — 비용과 청산 집계', () => {
  it('수수료·펀딩을 합산한다', () => {
    const m = computeMetrics(
      [trade(10, { fees: 2, funding: 0.5 }), trade(-5, { fees: 3, funding: -0.2 })],
      5000,
    );
    expect(m.totalFees).toBeCloseTo(5, 10);
    expect(m.totalFunding).toBeCloseTo(0.3, 10);
  });

  it('청산 횟수를 센다', () => {
    const m = computeMetrics(
      [trade(-100, { exitReason: 'liquidation' }), trade(50), trade(-100, { exitReason: 'liquidation' })],
      5000,
    );
    expect(m.liquidationCount).toBe(2);
  });
});

describe('computeMetrics — 자본 곡선', () => {
  it('트레이드마다 한 점씩 쌓이고 마지막이 최종 자본과 같다', () => {
    const m = computeMetrics([trade(100), trade(-50)], 5000);
    expect(m.equityCurve).toHaveLength(2);
    expect(m.equityCurve[0].equity).toBeCloseTo(5100, 10);
    expect(m.equityCurve[1].equity).toBeCloseTo(5050, 10);
    expect(m.equityCurve[1].equity).toBeCloseTo(m.finalEquity, 10);
  });
});
