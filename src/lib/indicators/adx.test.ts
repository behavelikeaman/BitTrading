import { describe, expect, it } from 'vitest';
import { adx } from '@/lib/indicators/adx';
import type { Candle } from '@/types';

function candle(open: number, high: number, low: number, close: number): Candle {
  return { openTime: 0, open, high, low, close, volume: 0, closed: true };
}

/** 매 봉 고가·저가가 step씩 오르는 단조 상승 추세 */
function uptrend(count: number, step = 2): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + i * step;
    out.push(candle(base, base + 1, base - 1, base + 0.5));
  }
  return out;
}

function downtrend(count: number, step = 2): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 - i * step;
    out.push(candle(base, base + 1, base - 1, base - 0.5));
  }
  return out;
}

describe('adx', () => {
  it('단조 상승 추세에서 plusDi가 minusDi보다 크다', () => {
    const out = adx(uptrend(40), 14);
    const last = out.plusDi.length - 1;
    expect(out.plusDi[last] as number).toBeGreaterThan(out.minusDi[last] as number);
  });

  it('단조 하락 추세에서 minusDi가 plusDi보다 크다', () => {
    const out = adx(downtrend(40), 14);
    const last = out.minusDi.length - 1;
    expect(out.minusDi[last] as number).toBeGreaterThan(out.plusDi[last] as number);
  });

  it('횡보 뒤 추세가 시작되면 ADX가 상승한다', () => {
    // 완벽한 단조 추세는 DX가 처음부터 100으로 고정되므로 상승을 볼 수 없다.
    // 횡보 구간을 먼저 두어 ADX가 낮게 시작하도록 만든다.
    const chop: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + (i % 2 === 0 ? 0 : 0.5);
      chop.push(candle(base, base + 1, base - 1, base));
    }
    const trending = uptrend(40).map((c) =>
      candle(c.open + 20, c.high + 20, c.low + 20, c.close + 20),
    );
    const out = adx([...chop, ...trending], 14);
    const duringChop = out.adx[39] as number;
    const afterTrend = out.adx[out.adx.length - 1] as number;
    expect(duringChop).not.toBeNull();
    expect(afterTrend).toBeGreaterThan(duringChop);
  });

  it('세 계열 모두 입력 길이를 보존하고 워밍업은 null이다', () => {
    const out = adx(uptrend(40), 14);
    for (const series of [out.plusDi, out.minusDi, out.adx]) {
      expect(series).toHaveLength(40);
      expect(series[0]).toBeNull();
    }
    // ADX는 DI보다 늦게 확정된다
    const firstDi = out.plusDi.findIndex((v) => v !== null);
    const firstAdx = out.adx.findIndex((v) => v !== null);
    expect(firstAdx).toBeGreaterThan(firstDi);
  });

  it('입력이 짧으면 전부 null이고 예외를 던지지 않는다', () => {
    const out = adx(uptrend(5), 14);
    expect(out.adx.every((v) => v === null)).toBe(true);
  });
});
