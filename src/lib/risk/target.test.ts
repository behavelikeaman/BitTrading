import { describe, expect, it } from 'vitest';
import {
  breakEvenRMultiple,
  rMultipleForReturnOnMargin,
  returnOnMarginForR,
} from '@/lib/risk/target';

/** 실제 BTC 5분봉에 가까운 값 — ATR 36 / 가격 77,000 (가격의 0.047%) */
const BASE = {
  atr: 36,
  price: 77_000,
  atrStopMultiple: 1.2,
  leverage: 50,
  costRatePerSide: 0.0006,
};

describe('returnOnMarginForR — R배수를 증거금 대비 순수익으로', () => {
  it('손으로 계산한 값과 맞는다', () => {
    // 목표폭 = 36 × 1.2 × 1.38 = 59.616 -> 가격의 0.07742%
    // 50배: +3.871%. 왕복 마찰 0.12% × 50 = 6% -> 순수익 -2.13%
    const r = returnOnMarginForR({ ...BASE, targetRMultiple: 1.38 });
    expect(r).toBeCloseTo(-0.021287, 5);
  });

  it('기본값 1.38R은 현재 변동성에서 마이너스다', () => {
    // ADR-013의 1.38은 ATR이 가격의 0.35%라는 가정에서 나왔다.
    // 실제 5분봉 ATR은 그 1/7 수준이라 목표가 마찰보다 작아진다.
    expect(returnOnMarginForR({ ...BASE, targetRMultiple: 1.38 })!).toBeLessThan(0);
  });

  it('ATR이 커지면 같은 R배수라도 목표 %가 커진다', () => {
    const small = returnOnMarginForR({ ...BASE, targetRMultiple: 2 })!;
    const large = returnOnMarginForR({ ...BASE, atr: 270, targetRMultiple: 2 })!;
    expect(large).toBeGreaterThan(small);
  });

  it('ATR이나 가격이 없으면 null이다', () => {
    expect(returnOnMarginForR({ ...BASE, atr: 0, targetRMultiple: 2 })).toBeNull();
    expect(returnOnMarginForR({ ...BASE, price: 0, targetRMultiple: 2 })).toBeNull();
  });
});

describe('rMultipleForReturnOnMargin — 원하는 % 에서 R배수를 역산', () => {
  it('환산과 역산이 서로를 되돌린다', () => {
    const r = returnOnMarginForR({ ...BASE, targetRMultiple: 3.5 })!;
    const back = rMultipleForReturnOnMargin({ ...BASE, netReturnOnMargin: r })!;
    expect(back).toBeCloseTo(3.5, 10);
  });

  it('증거금 대비 10%를 원하면 필요한 R배수를 낸다', () => {
    // 필요한 목표폭 = (0.10/50 + 0.0012) × 77,000 = 246.4
    // R = 246.4 / (36 × 1.2) = 5.7037
    const r = rMultipleForReturnOnMargin({ ...BASE, netReturnOnMargin: 0.1 })!;
    expect(r).toBeCloseTo(5.7037, 3);
  });

  it('레버리지를 낮추면 같은 % 목표에 더 큰 R배수가 필요하다', () => {
    const at50 = rMultipleForReturnOnMargin({ ...BASE, netReturnOnMargin: 0.1 })!;
    const at25 = rMultipleForReturnOnMargin({
      ...BASE,
      leverage: 25,
      netReturnOnMargin: 0.1,
    })!;
    expect(at25).toBeGreaterThan(at50);
  });

  it('ATR이 없으면 null이다', () => {
    expect(
      rMultipleForReturnOnMargin({ ...BASE, atr: 0, netReturnOnMargin: 0.1 }),
    ).toBeNull();
  });
});

describe('breakEvenRMultiple — 마찰을 겨우 넘는 지점', () => {
  it('이 R배수에서 증거금 대비 순수익이 0이다', () => {
    const r = breakEvenRMultiple(BASE)!;
    expect(returnOnMarginForR({ ...BASE, targetRMultiple: r })).toBeCloseTo(0, 12);
  });

  it('현재 변동성에서는 2.1배 근처다', () => {
    // 왕복 마찰 0.12% × 77,000 = 92.4 -> 92.4 / (36 × 1.2) = 2.1389
    expect(breakEvenRMultiple(BASE)).toBeCloseTo(2.1389, 3);
  });

  it('레버리지와 무관하다 — 마찰도 목표도 같은 배수로 증폭되기 때문이다', () => {
    expect(breakEvenRMultiple({ ...BASE, leverage: 10 })).toBeCloseTo(
      breakEvenRMultiple(BASE)!,
      10,
    );
  });

  it('ATR이 없으면 null이다', () => {
    expect(breakEvenRMultiple({ ...BASE, atr: 0 })).toBeNull();
  });
});
