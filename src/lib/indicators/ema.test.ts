import { describe, expect, it } from 'vitest';
import { ema } from '@/lib/indicators/ema';
import { sma } from '@/lib/indicators/sma';

describe('ema', () => {
  it('첫 유효값은 SMA(period)로 시드한다', () => {
    const values = [1, 2, 3, 4, 5, 6];
    const out = ema(values, 3);
    const seed = sma(values, 3)[2];
    expect(out[2]).toBeCloseTo(seed as number, 10);
  });

  it('시드 이후는 k = 2/(period+1)로 갱신한다', () => {
    const values = [1, 2, 3, 4, 5];
    const out = ema(values, 3);
    const k = 2 / (3 + 1);
    // 시드 = (1+2+3)/3 = 2, 다음 = 4*k + 2*(1-k) = 2 + 0.5*2 = 3
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(4 * k + 2 * (1 - k), 10);
    expect(out[4]).toBeCloseTo(5 * k + (4 * k + 2 * (1 - k)) * (1 - k), 10);
  });

  it('워밍업 구간은 null이고 길이는 보존된다', () => {
    const out = ema([1, 2, 3, 4], 3);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it('입력이 period보다 짧으면 전부 null이다', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});
