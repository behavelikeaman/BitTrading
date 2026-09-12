import { describe, expect, it } from 'vitest';
import { requiredSamples, winRateInterval } from '@/lib/paper/confidence';

describe('winRateInterval', () => {
  it('100건 표본의 승률 55%는 ±약 9.8%p다', () => {
    const i = winRateInterval(0.55, 100, null)!;
    expect(i.marginOfError).toBeCloseTo(0.0975, 3);
    expect(i.low).toBeCloseTo(0.4525, 3);
    expect(i.high).toBeCloseTo(0.6475, 3);
  });

  it('표본이 커지면 구간이 좁아진다', () => {
    const small = winRateInterval(0.55, 100, null)!;
    const large = winRateInterval(0.55, 400, null)!;
    expect(large.marginOfError).toBeLessThan(small.marginOfError);
    expect(large.marginOfError).toBeCloseTo(small.marginOfError / 2, 3);
  });

  it('신뢰구간이 손익분기를 걸치면 결론을 낼 수 없다', () => {
    // 100건, 승률 55%, 손익분기 54% -> 구간 45~65%로 손익분기를 포함한다
    expect(winRateInterval(0.55, 100, 0.54)!.conclusive).toBe(false);
  });

  it('구간 전체가 손익분기 위면 결론을 낼 수 있다', () => {
    expect(winRateInterval(0.7, 400, 0.54)!.conclusive).toBe(true);
  });

  it('표본이 0이면 null이다', () => {
    expect(winRateInterval(0, 0, 0.5)).toBeNull();
  });
});

describe('requiredSamples', () => {
  it('5%p를 구분하려면 400건이 필요하다', () => {
    expect(requiredSamples(0.05)).toBe(400);
  });

  it('10%p는 100건이다', () => {
    expect(requiredSamples(0.1)).toBe(100);
  });

  it('차이가 작을수록 급격히 늘어난다', () => {
    expect(requiredSamples(0.03)).toBeGreaterThan(1000);
  });
});
