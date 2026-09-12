import { describe, expect, it } from 'vitest';
import {
  averagePrice,
  breakEvenPrice,
  liquidationPrice,
  resolveMmr,
} from '@/lib/risk/liquidation';
import type { LadderLeg } from '@/types';

function leg(price: number, notional: number): LadderLeg {
  return { index: 0, price, qty: notional / price, notional, margin: notional / 50 };
}

describe('liquidationPrice', () => {
  it('롱 50배 MMR 0.5% -> 진입가의 1.5% 아래', () => {
    const p = liquidationPrice({
      direction: 'long',
      averageEntryPrice: 100_000,
      leverage: 50,
      maintenanceMarginRate: 0.005,
    });
    expect(p).toBeCloseTo(98_500, 6);
  });

  it('숏 50배 MMR 0.5% -> 진입가의 1.5% 위', () => {
    const p = liquidationPrice({
      direction: 'short',
      averageEntryPrice: 100_000,
      leverage: 50,
      maintenanceMarginRate: 0.005,
    });
    expect(p).toBeCloseTo(101_500, 6);
  });

  it('레버리지를 낮추면 청산이 멀어진다 — 10배는 9.5%', () => {
    const p = liquidationPrice({
      direction: 'long',
      averageEntryPrice: 100_000,
      leverage: 10,
      maintenanceMarginRate: 0.005,
    });
    expect(p).toBeCloseTo(90_500, 6);
  });
});

describe('resolveMmr', () => {
  const tiers = [
    { maxNotional: 50_000, mmr: 0.004 },
    { maxNotional: 250_000, mmr: 0.005 },
    { maxNotional: 1_000_000, mmr: 0.01 },
  ];

  it('명목가가 속한 구간의 유지증거금률을 고른다', () => {
    expect(resolveMmr(20_000, tiers, 0.005)).toBeCloseTo(0.004, 10);
    expect(resolveMmr(100_000, tiers, 0.005)).toBeCloseTo(0.005, 10);
    expect(resolveMmr(500_000, tiers, 0.005)).toBeCloseTo(0.01, 10);
  });

  it('구간 상한을 넘으면 마지막 구간을 쓴다', () => {
    expect(resolveMmr(5_000_000, tiers, 0.005)).toBeCloseTo(0.01, 10);
  });

  it('구간표가 없으면 기본값을 그대로 쓴다', () => {
    expect(resolveMmr(20_000, null, 0.005)).toBeCloseTo(0.005, 10);
    expect(resolveMmr(20_000, [], 0.005)).toBeCloseTo(0.005, 10);
  });
});

describe('averagePrice', () => {
  it('명목가 가중 평단을 구한다', () => {
    // 100,000에 10,000 / 99,000에 10,000 -> 수량 가중 평단
    const legs = [leg(100_000, 10_000), leg(99_000, 10_000)];
    const totalQty = legs.reduce((s, l) => s + l.qty, 0);
    const expected = 20_000 / totalQty;
    expect(averagePrice(legs)).toBeCloseTo(expected, 6);
  });

  it('레그가 하나면 그 가격이 평단이다', () => {
    expect(averagePrice([leg(100_000, 10_000)])).toBeCloseTo(100_000, 6);
  });

  it('빈 배열은 0을 반환하고 예외를 던지지 않는다', () => {
    expect(averagePrice([])).toBe(0);
  });
});

describe('breakEvenPrice', () => {
  it('롱은 평단 + 왕복 체결비용만큼 위다', () => {
    // 수수료 0.04% + 슬리피지 0.02% -> 편도 0.06%, 왕복 0.12%
    const p = breakEvenPrice({
      direction: 'long',
      averageEntryPrice: 100_000,
      costRatePerSide: 0.0006,
    });
    expect(p).toBeCloseTo(100_000 * 1.0012, 4);
  });

  it('숏은 평단 - 왕복 체결비용만큼 아래다', () => {
    const p = breakEvenPrice({
      direction: 'short',
      averageEntryPrice: 100_000,
      costRatePerSide: 0.0006,
    });
    expect(p).toBeCloseTo(100_000 * 0.9988, 4);
  });

  it('수수료만(0.04%/side) 기준이면 왕복 0.08%다', () => {
    const p = breakEvenPrice({
      direction: 'long',
      averageEntryPrice: 100_000,
      costRatePerSide: 0.0004,
    });
    expect(p).toBeCloseTo(100_080, 4);
  });
});
