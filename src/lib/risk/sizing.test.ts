import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT, planPosition } from '@/lib/risk/sizing';
import { DEFAULT_LADDER_HIGH, DEFAULT_LADDER_MEDIUM } from '@/lib/risk/ladder';
import type { AccountConfig } from '@/types';

/** 슬리피지 0 — PRD 기준 수치표(수수료만)와 맞추기 위한 계정 */
const FEE_ONLY: AccountConfig = {
  ...DEFAULT_ACCOUNT,
  slippageRatePerSide: 0,
  costSource: 'measured',
};

const ENTRY = 100_000;
/** 손절 0.42% = ATR × 1.2 이므로 ATR = 350 */
const ATR = 350;

function plan(over: Partial<AccountConfig> = {}, rest: Partial<Parameters<typeof planPosition>[0]> = {}) {
  return planPosition({
    direction: 'long',
    conviction: 'high',
    entryPrice: ENTRY,
    atr: ATR,
    account: { ...FEE_ONLY, ...over },
    qtyStep: 0, // 반올림 영향 없이 공식을 검증한다
    ...rest,
  });
}

describe('planPosition — 기준 수치 (PRD 표와 일치)', () => {
  it('손절폭은 ATR × 1.2 = 0.42%다', () => {
    const p = plan();
    expect(Math.abs(ENTRY - p.stopPrice) / ENTRY).toBeCloseTo(0.0042, 8);
  });

  it('targetRMultiple 1.38 -> 목표가 100,579.6 (가격 0.5796% ≈ 0.58%)', () => {
    const p = plan();
    // 손절폭 420 × 1.38 = 579.6. 문서의 "0.58%"는 이 값의 반올림 표기다.
    expect(p.takeProfitPrice).toBeCloseTo(100_579.6, 6);
    expect((p.takeProfitPrice - ENTRY) / ENTRY).toBeCloseTo(0.005796, 8);
  });

  it('50배·수수료 0.04%/side -> 증거금 대비 순수익 약 25%', () => {
    expect(plan().targetNetReturnOnMargin).toBeCloseTo(0.2498, 4);
  });

  it('손절 0.42% / 목표 0.5796% / 왕복 마찰 0.08% -> 손익분기 승률 약 50%', () => {
    expect(plan().breakEvenWinRate).toBeCloseTo(0.5002, 4);
  });

  it('목표를 0.28%로 낮추면 손익분기 승률이 71.4%로 올라간다', () => {
    // 0.28% / 0.42% = 0.6667
    const p = plan({ targetRMultiple: 0.0028 / 0.0042 });
    expect((p.takeProfitPrice - ENTRY) / ENTRY).toBeCloseTo(0.0028, 8);
    expect(p.breakEvenWinRate).toBeCloseTo(0.714, 3);
  });

  it('수수료를 0.06%/side로 올리면 손익분기 승률이 54%가 된다', () => {
    const p = plan({ feeRatePerSide: 0.0006 });
    expect(p.breakEvenWinRate).toBeCloseTo(0.5402, 4);
  });

  it('편도 슬리피지 0.02%를 더하면 손익분기 승률이 54%가 된다 (ADR-014)', () => {
    const p = plan({ slippageRatePerSide: 0.0002 });
    expect(p.breakEvenWinRate).toBeCloseTo(0.5402, 4);
  });

  it('수수료와 슬리피지는 왕복 총마찰로 동일하게 들어간다', () => {
    // 수수료 0.06%/슬리피지 0 과 수수료 0.04%/슬리피지 0.02% 는 둘 다 왕복 0.12%다.
    const feeOnly = plan({ feeRatePerSide: 0.0006, slippageRatePerSide: 0 });
    const mixed = plan({ feeRatePerSide: 0.0004, slippageRatePerSide: 0.0002 });
    expect(mixed.breakEvenWinRate).toBeCloseTo(feeOnly.breakEvenWinRate, 10);
    expect(mixed.totalNotional).toBeCloseTo(feeOnly.totalNotional, 6);
  });

  it('왕복 총마찰이 커질수록 필요 승률이 단조 증가한다', () => {
    const rates = [0.0002, 0.0004, 0.0006, 0.0008];
    const wrs = rates.map((f) => plan({ feeRatePerSide: f }).breakEvenWinRate);
    expect(wrs[0]).toBeCloseTo(0.46, 2);
    expect(wrs[1]).toBeCloseTo(0.5, 2);
    expect(wrs[2]).toBeCloseTo(0.54, 2);
    expect(wrs[3]).toBeCloseTo(0.58, 2);
    for (let i = 1; i < wrs.length; i++) expect(wrs[i]).toBeGreaterThan(wrs[i - 1]);
  });
});

describe('planPosition — 사이징 (ADR-009)', () => {
  it('equity 5,000 / 리스크 2% -> 예산 100 USDT, 명목가 약 20,000', () => {
    const p = plan();
    expect(p.riskBudget).toBeCloseTo(100, 6);
    expect(p.totalNotional).toBeCloseTo(20_000, 0);
  });

  it('medium은 리스크 1%라 포지션이 절반이다', () => {
    const high = plan();
    const medium = planPosition({
      direction: 'long',
      conviction: 'medium',
      entryPrice: ENTRY,
      atr: ATR,
      account: FEE_ONLY,
      qtyStep: 0,
    });
    expect(medium.riskBudget).toBeCloseTo(50, 6);
    expect(medium.totalNotional).toBeCloseTo(high.totalNotional / 2, 0);
  });

  it('증거금은 결과값이다 — 50배에서 명목가 20,000의 1/50', () => {
    const p = plan();
    expect(p.totalMargin).toBeCloseTo(p.totalNotional / 50, 6);
    // 자본금 5,000의 8% 수준이지 50%가 아니다
    expect(p.totalMargin / FEE_ONLY.equity).toBeLessThan(0.1);
  });
});

describe('planPosition — 레버리지 독립성 (ADR-013)', () => {
  it('레버리지만 50 -> 25로 바꿔도 목표가·손절가·명목가가 변하지 않는다', () => {
    const a = plan({ leverage: 50 });
    const b = plan({ leverage: 25 });
    expect(b.takeProfitPrice).toBeCloseTo(a.takeProfitPrice, 8);
    expect(b.stopPrice).toBeCloseTo(a.stopPrice, 8);
    expect(b.totalNotional).toBeCloseTo(a.totalNotional, 6);
    expect(b.riskBudget).toBeCloseTo(a.riskBudget, 6);
    expect(b.rewardAtTarget).toBeCloseTo(a.rewardAtTarget, 6);
    expect(b.breakEvenWinRate).toBeCloseTo(a.breakEvenWinRate, 8);
  });

  it('레버리지를 낮추면 증거금은 늘고 청산가는 멀어진다', () => {
    const a = plan({ leverage: 50 });
    const b = plan({ leverage: 25 });
    expect(b.totalMargin).toBeGreaterThan(a.totalMargin);
    expect(b.liquidationPrice).toBeLessThan(a.liquidationPrice); // 롱이므로 더 아래
  });
});

describe('planPosition — 물타기 래더 (가장 중요)', () => {
  it('확신 래더: 각 레그가 손절에 닿았을 때 총손실이 예산과 일치한다', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH });
    // 레그별로 직접 합산해 검증한다 — 구현을 다시 부르지 않는다
    let loss = 0;
    for (const leg of p.legs) {
      loss += (leg.notional * Math.abs(leg.price - p.stopPrice)) / leg.price;
      loss += leg.notional * 0.0004 * 2;
    }
    expect(loss).toBeCloseTo(100, 0); // 1 USDT 이내
    expect(p.riskBudget).toBeCloseTo(100, 0);
  });

  it('약간의 확신 래더(2회, 25/25/50)도 예산을 넘지 않는다', () => {
    const p = planPosition({
      direction: 'long',
      conviction: 'medium',
      entryPrice: ENTRY,
      atr: ATR,
      account: FEE_ONLY,
      ladder: DEFAULT_LADDER_MEDIUM,
      qtyStep: 0,
    });
    let loss = 0;
    for (const leg of p.legs) {
      loss += (leg.notional * Math.abs(leg.price - p.stopPrice)) / leg.price;
      loss += leg.notional * 0.0004 * 2;
    }
    expect(loss).toBeCloseTo(50, 0);
    expect(p.legs).toHaveLength(3);
  });

  it('단일 진입 공식을 래더에 그대로 쓰면 예산을 초과한다 — 회귀 방지', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH });
    // 1차 진입가 기준 손절 거리로만 계산한 "틀린" 손실
    const naiveDistance = Math.abs(ENTRY - p.stopPrice) / ENTRY;
    const naiveLoss = p.totalNotional * (naiveDistance + 0.0008);
    // 실제 예산(100)보다 크다 = 단일 공식은 과소평가한 명목가를 내놓는다
    expect(naiveLoss).toBeGreaterThan(p.riskBudget * 1.1);
  });

  it('손절가는 마지막 레그보다 더 멀리 있다', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH });
    const lastLeg = p.legs[p.legs.length - 1];
    expect(p.stopPrice).toBeLessThan(lastLeg.price);
  });

  it('평단은 1차 진입가와 마지막 레그 사이에 있다', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH });
    expect(p.averageEntryPrice).toBeLessThan(p.legs[0].price);
    expect(p.averageEntryPrice).toBeGreaterThan(p.legs[p.legs.length - 1].price);
  });

  it('본전가는 평단보다 왕복 체결비용만큼 위다 (롱)', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH });
    expect(p.breakEvenPrice).toBeCloseTo(p.averageEntryPrice * 1.0008, 4);
  });
});

describe('planPosition — 경고', () => {
  it('청산가가 손절가보다 가까우면 경고한다', () => {
    // 100배 + 넓은 손절 -> 청산이 손절보다 가깝다
    const p = plan({ leverage: 100, atrStopMultiple: 5 });
    expect(p.warnings.some((w) => w.includes('청산가가 손절가보다 가깝다'))).toBe(true);
  });

  it('정상 설정에서는 청산 경고가 없다', () => {
    const p = plan();
    expect(p.warnings.some((w) => w.includes('청산가가 손절가보다 가깝다'))).toBe(false);
  });

  it('손익분기 승률이 60%를 넘으면 경고한다', () => {
    const p = plan({ targetRMultiple: 0.4 });
    expect(p.breakEvenWinRate).toBeGreaterThan(0.6);
    expect(p.warnings.some((w) => w.includes('손익분기 승률'))).toBe(true);
  });

  it('costSource가 default면 추정치 경고를 단다 (ADR-012)', () => {
    const p = plan({ costSource: 'default' });
    expect(p.warnings.some((w) => w.includes('추정치'))).toBe(true);
  });

  it('costSource가 measured면 추정치 경고가 없다', () => {
    expect(plan().warnings.some((w) => w.includes('추정치'))).toBe(false);
  });

  it('증거금이 자본금을 초과하면 경고한다', () => {
    const p = plan({ leverage: 1, riskPctHigh: 0.5 });
    expect(p.warnings.some((w) => w.includes('자본금'))).toBe(true);
  });

  it('목표가 왕복 마찰보다 작으면 "도달해도 손해"라고 경고한다', () => {
    // R배수가 너무 낮으면 목표폭이 체결비용조차 못 넘는다. 화면에는
    // 증거금 대비 목표가 음수로 조용히 떠 있을 뿐이라 놓치기 쉽다.
    const p = plan({ targetRMultiple: 0.15 });
    expect(p.targetNetReturnOnMargin).toBeLessThan(0);
    expect(p.warnings.some((w) => w.includes('도달해도 손해'))).toBe(true);
  });

  it('목표가 마찰을 넘으면 그 경고가 없다', () => {
    const p = plan({ targetRMultiple: 3 });
    expect(p.targetNetReturnOnMargin).toBeGreaterThan(0);
    expect(p.warnings.some((w) => w.includes('도달해도 손해'))).toBe(false);
  });
});

describe('planPosition — 수량 반올림 (ADR-009)', () => {
  it('반올림 후 값으로 리스크를 재계산해 예산을 넘지 않는다', () => {
    const p = plan({}, { ladder: DEFAULT_LADDER_HIGH, qtyStep: 0.001 });
    for (const leg of p.legs) {
      // 수량이 최소 단위의 배수다
      expect(Math.abs(leg.qty / 0.001 - Math.round(leg.qty / 0.001))).toBeLessThan(1e-6);
      // 명목가가 반올림된 수량에서 나왔다
      expect(leg.notional).toBeCloseTo(leg.qty * leg.price, 6);
    }
    // 내림했으므로 실제 리스크는 예산 이하다
    expect(p.riskBudget).toBeLessThanOrEqual(100 + 1e-6);
  });
});

describe('planPosition — 숏', () => {
  it('숏은 손절이 위, 목표가 아래, 청산이 위다', () => {
    const p = planPosition({
      direction: 'short',
      conviction: 'high',
      entryPrice: ENTRY,
      atr: ATR,
      account: FEE_ONLY,
      ladder: DEFAULT_LADDER_HIGH,
      qtyStep: 0,
    });
    expect(p.stopPrice).toBeGreaterThan(ENTRY);
    expect(p.takeProfitPrice).toBeLessThan(p.averageEntryPrice);
    expect(p.liquidationPrice).toBeGreaterThan(p.averageEntryPrice);
    expect(p.breakEvenPrice).toBeLessThan(p.averageEntryPrice);
    expect(p.riskBudget).toBeCloseTo(100, 0);
  });
});

describe('planPosition — 진입 차단 (ADR-008)', () => {
  it('정상 설정은 tradable이다', () => {
    expect(plan().tradable).toBe(true);
  });

  it('청산가가 손절가보다 가까우면 차단한다', () => {
    // 손절이 청산보다 멀면 손절은 영영 체결되지 않는다
    const p = plan({ leverage: 100, atrStopMultiple: 5 });
    expect(p.tradable).toBe(false);
    expect(p.warnings.some((w) => w.includes('청산되기'))).toBe(false);
    expect(p.warnings.some((w) => w.includes('청산가가 손절가보다 가깝다'))).toBe(true);
  });

  it('증거금이 자본금을 초과해도 차단한다', () => {
    expect(plan({ leverage: 1, riskPctHigh: 0.5 }).tradable).toBe(false);
  });

  it('차단 여부는 레버리지를 낮추면 해제된다', () => {
    const blocked = plan({ leverage: 100, atrStopMultiple: 5 });
    const ok = plan({ leverage: 5, atrStopMultiple: 5 });
    expect(blocked.tradable).toBe(false);
    expect(ok.tradable).toBe(true);
  });
});
