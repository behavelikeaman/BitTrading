import { describe, expect, it } from 'vitest';
import { runBacktest } from '@/lib/backtest/engine';
import {
  breakoutVolumes,
  candles5m,
  repeatingBreakouts,
  testParams,
} from '@/lib/backtest/fixtures';

/**
 * 룩어헤드 검증 — 이 테스트가 통과하지 않으면 엔진은 쓸모가 없다.
 *
 * 캔들 배열의 뒷부분을 잘라내거나 바꿔도 앞부분에서 나온 트레이드는
 * 동일해야 한다. 달라진다면 어딘가에서 미래 데이터를 보고 있다는 뜻이다.
 */
describe('룩어헤드 편향', () => {
  // 스택 워밍업(135봉) 뒤로도 트레이드가 여러 번 나와야 절단 비교가 의미 있다.
  const closes = repeatingBreakouts(12);
  const volumes = breakoutVolumes(closes);
  const full5m = candles5m(closes, { volume: volumes });

  it('뒷부분을 잘라내도 앞부분 트레이드가 동일하다', () => {
    const full = runBacktest({
      candles: full5m,
      params: testParams(),
    });
    expect(full.trades.length).toBeGreaterThan(1);

    const cut = Math.floor(full5m.length * 0.6);
    const partial = runBacktest({
      candles: full5m.slice(0, cut),
      params: testParams(),
    });

    // 잘린 지점 이전에 완결된 트레이드만 비교한다.
    const cutoffTime = full5m[cut - 1].openTime;
    const fullBefore = full.trades.filter((t) => t.exitTime <= cutoffTime);
    const partialBefore = partial.trades.filter((t) => t.exitTime <= cutoffTime);

    expect(partialBefore.length).toBe(fullBefore.length);
    expect(partialBefore.length).toBeGreaterThan(0);

    for (let i = 0; i < fullBefore.length; i++) {
      expect(partialBefore[i].entryTime).toBe(fullBefore[i].entryTime);
      expect(partialBefore[i].exitTime).toBe(fullBefore[i].exitTime);
      expect(partialBefore[i].direction).toBe(fullBefore[i].direction);
      expect(partialBefore[i].exitReason).toBe(fullBefore[i].exitReason);
      expect(partialBefore[i].netPnl).toBeCloseTo(fullBefore[i].netPnl, 8);
      expect(partialBefore[i].averageEntryPrice).toBeCloseTo(
        fullBefore[i].averageEntryPrice,
        8,
      );
    }
  });

  it('뒷부분 가격을 완전히 바꿔도 앞부분 트레이드가 동일하다', () => {
    const base = runBacktest({
      candles: full5m,
      params: testParams(),
    });

    const cut = Math.floor(full5m.length * 0.6);
    const mutated = full5m.map((c, i) =>
      i < cut ? c : { ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3 },
    );
    const after = runBacktest({
      candles: mutated,
      params: testParams(),
    });

    const cutoffTime = full5m[cut - 1].openTime;
    const baseBefore = base.trades.filter((t) => t.exitTime <= cutoffTime);
    const afterBefore = after.trades.filter((t) => t.exitTime <= cutoffTime);

    expect(afterBefore.length).toBe(baseBefore.length);
    for (let i = 0; i < baseBefore.length; i++) {
      expect(afterBefore[i].entryTime).toBe(baseBefore[i].entryTime);
      expect(afterBefore[i].netPnl).toBeCloseTo(baseBefore[i].netPnl, 8);
    }
  });

  it('체결은 신호 캔들의 다음 캔들부터 일어난다', () => {
    const result = runBacktest({
      candles: full5m,
      params: testParams(),
    });
    const MS_5M = 300_000;
    for (const trade of result.trades) {
      // 진입 시각은 캔들 경계 위에 있고, 청산은 진입보다 뒤다.
      expect((trade.entryTime - full5m[0].openTime) % MS_5M).toBe(0);
      expect(trade.exitTime).toBeGreaterThan(trade.entryTime);
    }
  });
});
