import { describe, expect, it } from 'vitest';
import { sma } from '@/lib/indicators/sma';

describe('sma', () => {
  it('period 이전 구간은 null이고 이후는 단순평균이다', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('입력과 출력 길이가 같다', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toHaveLength(5);
  });

  it('워밍업 구간은 정확히 period - 1개다', () => {
    const out = sma([10, 20, 30, 40], 4);
    expect(out.filter((v) => v === null)).toHaveLength(3);
    expect(out[3]).toBeCloseTo(25, 10);
  });

  it('입력이 period보다 짧으면 전부 null이고 예외를 던지지 않는다', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('빈 배열은 빈 배열을 반환한다', () => {
    expect(sma([], 3)).toEqual([]);
  });
});
