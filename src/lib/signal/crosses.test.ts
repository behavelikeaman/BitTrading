import { describe, expect, it } from 'vitest';
import { findCrosses } from '@/lib/signal/crosses';
import { computeIndicators } from '@/lib/indicators';
import { candlesFromCloses, flatThenJump, realisticBreakout } from '@/lib/signal/fixtures';
import type { Candle, IndicatorSnapshot } from '@/types';

function snap(ema12: number, sma20: number): IndicatorSnapshot {
  return {
    ema12,
    sma20,
    bbUpper: sma20 + 2,
    bbLower: sma20 - 2,
    bbWidth: 0.04,
    atr14: 1,
    adx14: 25,
    volumeSma20: 1000,
    stack: null,
  };
}

function candle(openTime: number, close: number): Candle {
  return { openTime, open: close, high: close, low: close, close, volume: 1, closed: true };
}

describe('findCrosses — 판정 규칙', () => {
  it('EMA가 SMA 아래에서 위로 가면 롱이다', () => {
    const candles = [candle(0, 100), candle(300_000, 101)];
    const out = findCrosses(candles, [snap(99, 100), snap(101, 100)]);
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('long');
    expect(out[0].time).toBe(300_000);
    expect(out[0].price).toBe(101);
  });

  it('EMA가 SMA 위에서 아래로 가면 숏이다', () => {
    const candles = [candle(0, 100), candle(300_000, 99)];
    const out = findCrosses(candles, [snap(101, 100), snap(99, 100)]);
    expect(out[0].direction).toBe('short');
  });

  it('같은 쪽에 머물면 교차가 아니다', () => {
    const candles = [candle(0, 100), candle(300_000, 101)];
    expect(findCrosses(candles, [snap(101, 100), snap(102, 100)])).toHaveLength(0);
  });

  it('정확히 겹쳤다가 위로 가면 롱으로 센다', () => {
    const candles = [candle(0, 100), candle(300_000, 101)];
    expect(findCrosses(candles, [snap(100, 100), snap(101, 100)])[0].direction).toBe('long');
  });
});

describe('findCrosses — 방어', () => {
  it('워밍업(null) 구간은 건너뛴다', () => {
    const candles = [candle(0, 100), candle(300_000, 101), candle(600_000, 102)];
    const out = findCrosses(candles, [null, null, snap(101, 100)]);
    expect(out).toHaveLength(0);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(findCrosses([], [])).toEqual([]);
  });

  it('스냅샷이 캔들보다 많아도 예외가 없다', () => {
    expect(() => findCrosses([candle(0, 100)], [snap(99, 100), snap(101, 100)])).not.toThrow();
  });
});

describe('findCrosses — scoreSignal과 같은 판정', () => {
  it('상향 돌파 시리즈의 마지막 교차는 롱이다', () => {
    const closes = realisticBreakout();
    const candles = candlesFromCloses(closes, { spread: 0.4 });
    const out = findCrosses(candles, computeIndicators(candles));
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1].direction).toBe('long');
    expect(out[out.length - 1].time).toBe(candles[candles.length - 1].openTime);
  });

  it('하락 점프 시리즈의 마지막 교차는 숏이다', () => {
    const candles = candlesFromCloses(flatThenJump(60, 100, 70));
    const out = findCrosses(candles, computeIndicators(candles));
    expect(out[out.length - 1].direction).toBe('short');
  });
});
