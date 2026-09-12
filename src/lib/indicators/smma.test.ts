import { describe, expect, it } from 'vitest';
import { smma } from '@/lib/indicators/smma';

describe('smma', () => {
  it('첫 유효값은 단순평균이고 이후는 Wilder 평활이다', () => {
    // period 3, [1,2,3,4,5]
    // i=2: (1+2+3)/3 = 2
    // i=3: (2*2 + 4)/3 = 2.666...
    // i=4: (2.666...*2 + 5)/3 = 3.444...
    const out = smma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(8 / 3, 10);
    expect(out[4]).toBeCloseTo(10 / 3 + 1 / 9, 10);
  });

  it('상수 시리즈는 그 값을 유지한다', () => {
    const out = smma(new Array(10).fill(42), 4);
    expect(out[9]).toBe(42);
  });

  it('EMA보다 느리게 반응한다', () => {
    // SMMA(n)의 평활계수는 1/n, EMA(n)은 2/(n+1)이라 항상 더 느리다.
    const values = [...new Array(20).fill(100), 200];
    const s = smma(values, 10)!;
    const last = s[s.length - 1]!;
    expect(last).toBeGreaterThan(100);
    expect(last).toBeLessThan(120); // 100 + 100/10 = 110 근처
    expect(last).toBeCloseTo(110, 6);
  });

  it('데이터가 기간보다 짧으면 전부 null이다', () => {
    expect(smma([1, 2], 5)).toEqual([null, null]);
  });

  it('기간이 0 이하면 전부 null이다', () => {
    expect(smma([1, 2, 3], 0)).toEqual([null, null, null]);
  });

  it('길이는 입력과 같다', () => {
    expect(smma(new Array(7).fill(1), 3)).toHaveLength(7);
  });
});
