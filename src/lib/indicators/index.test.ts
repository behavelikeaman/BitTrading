import { describe, expect, it } from 'vitest';
import { computeIndicators } from '@/lib/indicators';
import type { Candle } from '@/types';

function series(count: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i / 3) * 5 + i * 0.1;
    out.push({
      openTime: i * 300_000,
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.2,
      volume: 1000 + (i % 7) * 100,
      closed: true,
    });
  }
  return out;
}

describe('computeIndicators', () => {
  it('입력과 같은 길이를 반환한다', () => {
    const candles = series(60);
    expect(computeIndicators(candles)).toHaveLength(60);
  });

  it('워밍업 구간은 null이고 이후는 스냅샷이 채워진다', () => {
    const out = computeIndicators(series(60));
    expect(out[0]).toBeNull();
    const last = out[out.length - 1];
    expect(last).not.toBeNull();
    expect(Number.isFinite(last!.ema12)).toBe(true);
    expect(Number.isFinite(last!.sma20)).toBe(true);
    expect(Number.isFinite(last!.atr14)).toBe(true);
    expect(Number.isFinite(last!.adx14)).toBe(true);
    expect(Number.isFinite(last!.volumeSma20)).toBe(true);
  });

  it('sma20은 볼린저 중심선과 같은 값이다', () => {
    const out = computeIndicators(series(60));
    const last = out[out.length - 1]!;
    const mid = (last.bbUpper + last.bbLower) / 2;
    expect(last.sma20).toBeCloseTo(mid, 8);
  });

  it('bbWidth는 (upper - lower) / sma20 이다', () => {
    const out = computeIndicators(series(60));
    const last = out[out.length - 1]!;
    expect(last.bbWidth).toBeCloseTo((last.bbUpper - last.bbLower) / last.sma20, 10);
  });

  it('데이터가 부족하면 전부 null이고 예외를 던지지 않는다', () => {
    const out = computeIndicators(series(5));
    expect(out).toHaveLength(5);
    expect(out.every((v) => v === null)).toBe(true);
  });

  it('빈 배열은 빈 배열을 반환한다', () => {
    expect(computeIndicators([])).toEqual([]);
  });

  it('SMMA 스택은 135봉 워밍업 전까지 null이다', () => {
    // 스택은 가장 느린 선(SMMA135)이 확정돼야 배열을 판정할 수 있다.
    // 나머지 지표는 그대로 쓰므로 스냅샷 자체를 null로 만들지는 않는다.
    const out = computeIndicators(series(60));
    const last = out[out.length - 1]!;
    expect(last.stack).toBeNull();
  });

  it('135봉이 넘으면 스택이 채워지고 빠른 선일수록 최근 가격에 가깝다', () => {
    const out = computeIndicators(series(200));
    const stack = out[out.length - 1]!.stack!;
    expect(stack).not.toBeNull();
    for (const v of [stack.smma20, stack.smma55, stack.smma95, stack.smma135]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // 완만한 상승 시리즈이므로 빠른 선이 느린 선보다 위에 있다 (정배열).
    expect(stack.smma20).toBeGreaterThan(stack.smma55);
    expect(stack.smma55).toBeGreaterThan(stack.smma95);
    expect(stack.smma95).toBeGreaterThan(stack.smma135);
  });
})
