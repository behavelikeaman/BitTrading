import { describe, expect, it } from 'vitest';
import { bollinger } from '@/lib/indicators/bollinger';

describe('bollinger', () => {
  it('상수 배열이면 표준편차가 0이라 상·중·하단이 같고 width는 0이다', () => {
    const out = bollinger([5, 5, 5, 5, 5], 3, 2);
    expect(out.middle[4]).toBeCloseTo(5, 10);
    expect(out.upper[4]).toBeCloseTo(5, 10);
    expect(out.lower[4]).toBeCloseTo(5, 10);
    expect(out.width[4]).toBeCloseTo(0, 10);
  });

  it('모집단 표준편차(n으로 나눔)를 쓴다', () => {
    // [2,4,6] 평균 4, 모집단 분산 = ((-2)^2+0+2^2)/3 = 8/3, 표준편차 = 1.632993...
    const out = bollinger([2, 4, 6], 3, 2);
    const sd = Math.sqrt(8 / 3);
    expect(out.middle[2]).toBeCloseTo(4, 10);
    expect(out.upper[2]).toBeCloseTo(4 + 2 * sd, 10);
    expect(out.lower[2]).toBeCloseTo(4 - 2 * sd, 10);
  });

  it('width는 (upper - lower) / middle 이다', () => {
    const out = bollinger([2, 4, 6], 3, 2);
    const expected =
      ((out.upper[2] as number) - (out.lower[2] as number)) / (out.middle[2] as number);
    expect(out.width[2]).toBeCloseTo(expected, 10);
  });

  it('워밍업 구간은 네 계열 모두 null이고 길이가 보존된다', () => {
    const out = bollinger([1, 2, 3, 4], 3, 2);
    for (const series of [out.middle, out.upper, out.lower, out.width]) {
      expect(series).toHaveLength(4);
      expect(series[0]).toBeNull();
      expect(series[1]).toBeNull();
    }
  });

  it('입력이 period보다 짧으면 전부 null이다', () => {
    const out = bollinger([1, 2], 5, 2);
    expect(out.middle).toEqual([null, null]);
    expect(out.width).toEqual([null, null]);
  });
});
