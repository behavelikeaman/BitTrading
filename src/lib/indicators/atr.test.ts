import { describe, expect, it } from 'vitest';
import { atr, trueRange } from '@/lib/indicators/atr';
import type { Candle } from '@/types';

function candle(open: number, high: number, low: number, close: number): Candle {
  return { openTime: 0, open, high, low, close, volume: 0, closed: true };
}

describe('trueRange', () => {
  it('첫 캔들은 이전 종가가 없으므로 null이다', () => {
    expect(trueRange([candle(10, 12, 8, 11)])[0]).toBeNull();
  });

  it('갭 상승에서 전봉 종가를 반영한다', () => {
    // 전봉 종가 10, 이번 봉 고가 20 저가 18 -> TR = max(2, 10, 8) = 10
    const out = trueRange([candle(9, 11, 9, 10), candle(19, 20, 18, 19)]);
    expect(out[1]).toBeCloseTo(10, 10);
  });

  it('갭 하락에서 전봉 종가를 반영한다', () => {
    // 전봉 종가 20, 이번 봉 고가 12 저가 10 -> TR = max(2, 8, 10) = 10
    const out = trueRange([candle(21, 22, 20, 20), candle(11, 12, 10, 11)]);
    expect(out[1]).toBeCloseTo(10, 10);
  });

  it('갭이 없으면 고가-저가가 TR이다', () => {
    const out = trueRange([candle(10, 11, 9, 10), candle(10, 13, 9, 12)]);
    expect(out[1]).toBeCloseTo(4, 10);
  });
});

describe('atr', () => {
  it('Wilder 평활을 쓴다 — 첫 유효값은 TR의 단순평균, 이후는 (prev*(n-1)+TR)/n', () => {
    // TR이 전부 2가 되도록 구성: 고가-저가 = 2, 갭 없음
    const candles: Candle[] = [];
    for (let i = 0; i < 6; i++) candles.push(candle(10, 11, 9, 10));
    const out = atr(candles, 3);
    // index 0 TR=null, 1..5 TR=2 -> 첫 ATR은 index 3 (TR 3개 평균 = 2)
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).toBeCloseTo(2, 10);
    expect(out[4]).toBeCloseTo(2, 10);
  });

  it('손계산 기대값과 일치한다', () => {
    // TR: null, 4, 6, 2 -> period 3 첫 ATR(index 3) = (4+6+2)/3 = 4
    const candles = [
      candle(10, 11, 9, 10),
      candle(10, 14, 10, 12),
      candle(12, 18, 12, 16),
      candle(16, 17, 15, 16),
    ];
    const tr = trueRange(candles);
    expect(tr[1]).toBeCloseTo(4, 10);
    expect(tr[2]).toBeCloseTo(6, 10);
    expect(tr[3]).toBeCloseTo(2, 10);
    expect(atr(candles, 3)[3]).toBeCloseTo(4, 10);
  });

  it('길이가 보존되고 짧은 입력은 전부 null이다', () => {
    const candles = [candle(10, 11, 9, 10), candle(10, 11, 9, 10)];
    const out = atr(candles, 14);
    expect(out).toHaveLength(2);
    expect(out.every((v) => v === null)).toBe(true);
  });
});
