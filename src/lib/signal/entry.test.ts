import { describe, expect, it } from 'vitest';
import { evaluateEntry } from '@/lib/signal/entry';
import {
  candlesFromCloses,
  flatThenJump,
  realisticBreakout,
  risingHtf,
} from '@/lib/signal/fixtures';
import type { GuardState, SignalContext } from '@/types';

const NOON_UTC = Date.UTC(2026, 0, 5, 12, 0, 0);
const CLEAN_GUARD: GuardState = { consecutiveLosses: 0, dailyPnlPct: 0 };

/** 8항목이 전부 통과하도록 구성한 컨텍스트 (현실적 변동성) */
function strongLongCtx(over: Partial<SignalContext> = {}): SignalContext {
  const closes = realisticBreakout();
  const volumes = closes.map((_, i) => (i === closes.length - 1 ? 5000 : 1000));
  return {
    candles5m: candlesFromCloses(closes, { volume: volumes, spread: 0.4 }),
    candles15m: candlesFromCloses(risingHtf()),
    fundingRate: -0.0001,
    nowMs: NOON_UTC,
    ...over,
  };
}

/** 교차가 없는 횡보 */
function flatCtx(over: Partial<SignalContext> = {}): SignalContext {
  return {
    candles5m: candlesFromCloses(new Array(60).fill(100)),
    candles15m: candlesFromCloses(new Array(60).fill(100)),
    fundingRate: 0,
    nowMs: NOON_UTC,
    ...over,
  };
}

describe('evaluateEntry — 점수와 등급', () => {
  it('adxMin을 낮추면 8항목이 전부 통과해 score 8, high가 된다', () => {
    const signal = evaluateEntry(strongLongCtx(), CLEAN_GUARD);
    expect(signal.blockers).toEqual([]);
    expect(signal.score).toBe(8);
    expect(signal.direction).toBe('long');
    expect(signal.conviction).toBe('high');
  });

  it('임계값을 올리면 같은 점수라도 등급이 내려간다', () => {
    const signal = evaluateEntry(strongLongCtx(), CLEAN_GUARD, {
      highConvictionScore: 9,
      mediumConvictionScore: 8,
    });
    expect(signal.score).toBe(8);
    expect(signal.conviction).toBe('medium');
  });

  it('점수가 medium 기준에 못 미치면 none이다', () => {
    const signal = evaluateEntry(strongLongCtx(), CLEAN_GUARD, {
      highConvictionScore: 99,
      mediumConvictionScore: 99,
    });
    expect(signal.conviction).toBe('none');
  });
});

describe('evaluateEntry — 무효 필터', () => {
  it('blackout이면 점수가 8이어도 conviction은 none이다', () => {
    const signal = evaluateEntry(strongLongCtx({ blackout: true }), CLEAN_GUARD);
    expect(signal.score).toBe(8);
    expect(signal.conviction).toBe('none');
    expect(signal.blockers).toContain('지표 발표 블랙아웃');
  });

  it('연속 손실이 한도에 닿으면 차단된다', () => {
    const signal = evaluateEntry(
      strongLongCtx(),
      { consecutiveLosses: 3, dailyPnlPct: 0 },
    );
    expect(signal.blockers).toContain('연속 손실 한도');
    expect(signal.conviction).toBe('none');
  });

  it('일일 손실 한도에 닿으면 차단된다', () => {
    const signal = evaluateEntry(
      strongLongCtx(),
      { consecutiveLosses: 0, dailyPnlPct: -0.06 },
    );
    expect(signal.blockers).toContain('일일 손실 한도');
    expect(signal.conviction).toBe('none');
  });

  it('한도 직전에는 차단되지 않는다', () => {
    const signal = evaluateEntry(
      strongLongCtx(),
      { consecutiveLosses: 2, dailyPnlPct: -0.059 },
    );
    expect(signal.blockers).toEqual([]);
    expect(signal.conviction).toBe('high');
  });

  it('교차가 없으면 "진입 트리거 없음"으로 차단된다', () => {
    const signal = evaluateEntry(flatCtx(), CLEAN_GUARD);
    expect(signal.blockers).toContain('진입 트리거 없음');
    expect(signal.conviction).toBe('none');
    expect(signal.direction).toBeNull();
  });

  it('데이터가 부족하면 "데이터 부족"으로 차단되고 예외가 없다', () => {
    const signal = evaluateEntry(
      flatCtx({ candles5m: candlesFromCloses([100, 101, 102]) }),
      CLEAN_GUARD,
    );
    expect(signal.blockers).toContain('데이터 부족');
    expect(signal.conviction).toBe('none');
    expect(signal.items).toHaveLength(8);
  });

  it('횡보 뒤 급등하는 시리즈는 이상 변동성으로 차단된다', () => {
    // 60봉 횡보 후 단숨에 +30%. 점수가 아무리 높아도 진입시키면 안 된다.
    const signal = evaluateEntry(
      strongLongCtx({
        candles5m: candlesFromCloses(flatThenJump(60, 100, 130), { volume: 5000 }),
      }),
      CLEAN_GUARD,
    );
    expect(signal.blockers).toContain('이상 변동성');
    expect(signal.conviction).toBe('none');
  });

  it('atrSpikeMultiple을 올리면 같은 시리즈가 통과한다', () => {
    const signal = evaluateEntry(
      strongLongCtx({
        candles5m: candlesFromCloses(flatThenJump(60, 100, 130), { volume: 5000 }),
      }),
      CLEAN_GUARD,
      { atrSpikeMultiple: 100 },
    );
    expect(signal.blockers).not.toContain('이상 변동성');
  });

  it('여러 사유가 동시에 걸리면 전부 기록된다', () => {
    const signal = evaluateEntry(
      flatCtx({ blackout: true }),
      { consecutiveLosses: 5, dailyPnlPct: -0.1 },
    );
    expect(signal.blockers).toContain('지표 발표 블랙아웃');
    expect(signal.blockers).toContain('연속 손실 한도');
    expect(signal.blockers).toContain('일일 손실 한도');
    expect(signal.blockers).toContain('진입 트리거 없음');
  });
});

describe('evaluateEntry — 반환 구조', () => {
  it('항상 8개 항목을 담고 score는 통과 개수와 일치한다', () => {
    const signal = evaluateEntry(strongLongCtx(), CLEAN_GUARD);
    expect(signal.items).toHaveLength(8);
    expect(signal.score).toBe(signal.items.filter((i) => i.passed).length);
  });

  it('blockers가 비어 있을 때만 conviction이 none이 아니다', () => {
    const blocked = evaluateEntry(strongLongCtx({ blackout: true }), CLEAN_GUARD);
    const clean = evaluateEntry(strongLongCtx(), CLEAN_GUARD);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(blocked.conviction).toBe('none');
    expect(clean.blockers).toEqual([]);
    expect(clean.conviction).not.toBe('none');
  });
});
