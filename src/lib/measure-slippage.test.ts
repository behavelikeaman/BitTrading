import { describe, expect, it } from 'vitest';
import { measureSlippage, type Fill, type IntendedPrice } from '@/lib/measure-slippage';

function pair(
  n: number,
  side: 'buy' | 'sell',
  rate: number,
): { fills: Fill[]; intended: IntendedPrice[] } {
  const fills: Fill[] = [];
  const intended: IntendedPrice[] = [];
  for (let i = 0; i < n; i++) {
    const ts = i;
    const price = 100_000;
    // 불리한 방향으로 rate만큼 체결된 것으로 만든다
    const fillPrice = side === 'buy' ? price * (1 + rate) : price * (1 - rate);
    fills.push({ ts, side, fillPrice, qty: 0.1 });
    intended.push({ ts, price });
  }
  return { fills, intended };
}

describe('measureSlippage — 부호 규약', () => {
  it('매수를 의도가보다 비싸게 체결하면 양수다', () => {
    const { fills, intended } = pair(12, 'buy', 0.0002);
    const m = measureSlippage(fills, intended)!;
    expect(m.medianRate).toBeCloseTo(0.0002, 10);
  });

  it('매도를 의도가보다 싸게 체결하면 양수다', () => {
    const { fills, intended } = pair(12, 'sell', 0.0002);
    const m = measureSlippage(fills, intended)!;
    expect(m.medianRate).toBeCloseTo(0.0002, 10);
  });

  it('유리하게 체결되면 음수가 나온다', () => {
    const { fills, intended } = pair(12, 'buy', -0.0001);
    const m = measureSlippage(fills, intended)!;
    expect(m.medianRate).toBeCloseTo(-0.0001, 10);
  });
});

describe('measureSlippage — 중앙값', () => {
  it('이상 체결 한 건이 결과를 왜곡하지 않는다', () => {
    const { fills, intended } = pair(20, 'buy', 0.0002);
    // 급변동으로 100배 밀린 체결 하나를 섞는다
    fills[0] = { ...fills[0], fillPrice: 100_000 * 1.02 };
    const m = measureSlippage(fills, intended)!;
    expect(m.medianRate).toBeCloseTo(0.0002, 10);
  });

  it('평균이었다면 크게 흔들렸을 입력이다 — 대비 검증', () => {
    const { fills, intended } = pair(20, 'buy', 0.0002);
    fills[0] = { ...fills[0], fillPrice: 100_000 * 1.02 };
    const rates = fills.map((f) => (f.fillPrice - 100_000) / 100_000);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(mean).toBeGreaterThan(0.001); // 평균은 5배 이상 부풀려진다
    expect(measureSlippage(fills, intended)!.medianRate).toBeCloseTo(0.0002, 10);
  });
});

describe('measureSlippage — 표본 부족', () => {
  it('10건 미만이면 null을 반환한다', () => {
    const { fills, intended } = pair(9, 'buy', 0.0002);
    expect(measureSlippage(fills, intended)).toBeNull();
  });

  it('정확히 10건이면 측정한다', () => {
    const { fills, intended } = pair(10, 'buy', 0.0002);
    expect(measureSlippage(fills, intended)?.sampleCount).toBe(10);
  });

  it('의도 가격이 없는 체결은 표본에서 빠진다', () => {
    const { fills, intended } = pair(12, 'buy', 0.0002);
    const m = measureSlippage(fills, intended.slice(0, 10))!;
    expect(m.sampleCount).toBe(10);
  });

  it('짝이 맞는 표본이 모자라면 null이다', () => {
    const { fills, intended } = pair(12, 'buy', 0.0002);
    expect(measureSlippage(fills, intended.slice(0, 5))).toBeNull();
  });
});

describe('measureSlippage — 방어', () => {
  it('빈 입력은 null이다', () => {
    expect(measureSlippage([], [])).toBeNull();
  });

  it('0 이하 가격은 표본에서 제외한다', () => {
    const { fills, intended } = pair(12, 'buy', 0.0002);
    fills[0] = { ...fills[0], fillPrice: 0 };
    intended[1] = { ...intended[1], price: -1 };
    expect(measureSlippage(fills, intended)!.sampleCount).toBe(10);
  });
});
