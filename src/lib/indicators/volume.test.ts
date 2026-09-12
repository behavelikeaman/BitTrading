import { describe, expect, it } from 'vitest';
import { volumeSma } from '@/lib/indicators/volume';
import type { Candle } from '@/types';

function candle(volume: number): Candle {
  return { openTime: 0, open: 1, high: 1, low: 1, close: 1, volume, closed: true };
}

describe('volumeSma', () => {
  it('거래량의 단순이동평균이다', () => {
    const out = volumeSma([candle(10), candle(20), candle(30)], 3);
    expect(out).toEqual([null, null, 20]);
  });

  it('길이를 보존하고 워밍업은 null이다', () => {
    const out = volumeSma([candle(1), candle(2), candle(3), candle(4)], 2);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(1.5, 10);
  });
});
