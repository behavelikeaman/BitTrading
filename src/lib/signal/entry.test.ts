import { describe, expect, it } from 'vitest';
import { evaluateEntry } from '@/lib/signal/entry';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import {
  candlesFromCloses,
  flatThenJump,
  overextendedChaseLong,
  overextendedReversionShort,
  risingHtf,
  trendPullbackLong,
} from '@/lib/signal/fixtures';
import type { GuardState, SignalContext } from '@/types';

const NOON_UTC = Date.UTC(2026, 0, 5, 12, 0, 0);
const CLEAN_GUARD: GuardState = { consecutiveLosses: 0, dailyPnlPct: 0 };

function withVolumeSpike(closes: number[]) {
  const volumes = closes.map((_, i) => (i === closes.length - 1 ? 5000 : 1000));
  return candlesFromCloses(closes, { volume: volumes, spread: 0.4 });
}

function ctxOf(closes: number[], over: Partial<SignalContext> = {}): SignalContext {
  return {
    candles5m: withVolumeSpike(closes),
    candles15m: candlesFromCloses(risingHtf()),
    fundingRate: 0,
    nowMs: NOON_UTC,
    ...over,
  };
}

/** 2번 케이스 — 정배열 눌림목 재진입 롱 */
const pullbackCtx = (over: Partial<SignalContext> = {}) =>
  ctxOf(trendPullbackLong(), over);

/** 1번 케이스 — 정배열 과이격 되돌림 숏 */
const reversionCtx = (over: Partial<SignalContext> = {}) =>
  ctxOf(overextendedReversionShort(), over);

/** 교차가 없는 횡보 */
const flatCtx = (over: Partial<SignalContext> = {}) =>
  ctxOf(new Array(200).fill(100), over);

describe('evaluateEntry — 실전 셋업 두 가지', () => {
  it('눌림목 재진입(2번)은 9/10으로 확신 등급이다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.blockers).toEqual([]);
    expect(signal.score).toBe(9);
    expect(signal.direction).toBe('long');
    expect(signal.conviction).toBe('high');
    expect(signal.setup.kind).toBe('trend-pullback');
  });

  it('과이격 되돌림(1번)은 정배열인데도 숏으로 확신 등급이 나온다', () => {
    // 이 테스트가 이번 변경의 핵심이다. 예전 규칙에서는 상위 추세와
    // 방향이 반대라 상위 프레임·가격 위치 항목이 구조적으로 실패해
    // 확신 등급이 나올 수 없었다 (ADR-022).
    const signal = evaluateEntry(reversionCtx(), CLEAN_GUARD);
    expect(signal.blockers).toEqual([]);
    expect(signal.score).toBe(9);
    expect(signal.direction).toBe('short');
    expect(signal.setup.alignment).toBe('bull');
    expect(signal.conviction).toBe('high');
    expect(signal.setup.kind).toBe('overextended-reversion');
  });

  it('과이격 추격은 모양이 눌림목과 같아도 진입하지 않는다', () => {
    const signal = evaluateEntry(ctxOf(overextendedChaseLong()), CLEAN_GUARD);
    expect(signal.setup.kind).toBe('overextended-chase');
    expect(signal.direction).toBeNull();
    expect(signal.conviction).toBe('none');
    expect(signal.blockers).toContain('과이격 추격 자리');
  });

  it('되돌림 셋업은 스택 하단을 구조 목표가로 들고 있다', () => {
    const signal = evaluateEntry(reversionCtx(), CLEAN_GUARD);
    expect(signal.setup.structureTarget).not.toBeNull();
    expect(signal.setup.structureTarget).toBe(signal.indicators!.stack!.smma135);
  });
});

describe('evaluateEntry — 등급 임계값', () => {
  it('임계값을 올리면 같은 점수라도 등급이 내려간다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD, {
      highConvictionScore: 10,
      mediumConvictionScore: 9,
    });
    expect(signal.score).toBe(9);
    expect(signal.conviction).toBe('medium');
  });

  it('점수가 medium 기준에 못 미치면 none이다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD, {
      highConvictionScore: 99,
      mediumConvictionScore: 99,
    });
    expect(signal.conviction).toBe('none');
  });
});

describe('evaluateEntry — 무효 필터', () => {
  it('blackout이면 점수가 높아도 conviction은 none이다', () => {
    const signal = evaluateEntry(pullbackCtx({ blackout: true }), CLEAN_GUARD);
    expect(signal.score).toBe(9);
    expect(signal.conviction).toBe('none');
    expect(signal.blockers).toContain('지표 발표 블랙아웃');
  });

  it('연속 손실이 한도에 닿으면 차단된다', () => {
    const signal = evaluateEntry(pullbackCtx(), {
      consecutiveLosses: 3,
      dailyPnlPct: 0,
    });
    expect(signal.blockers).toContain('연속 손실 한도');
    expect(signal.conviction).toBe('none');
  });

  it('일일 손실 한도에 닿으면 차단된다', () => {
    const signal = evaluateEntry(pullbackCtx(), {
      consecutiveLosses: 0,
      dailyPnlPct: -0.06,
    });
    expect(signal.blockers).toContain('일일 손실 한도');
    expect(signal.conviction).toBe('none');
  });

  it('한도 직전에는 차단되지 않는다', () => {
    const signal = evaluateEntry(pullbackCtx(), {
      consecutiveLosses: 2,
      dailyPnlPct: -0.059,
    });
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
    expect(signal.items).toHaveLength(SCORE_ITEM_COUNT);
  });

  it('횡보 뒤 급등하는 시리즈는 이상 변동성으로 차단된다', () => {
    const signal = evaluateEntry(
      ctxOf(flatThenJump(60, 100, 130)),
      CLEAN_GUARD,
    );
    expect(signal.blockers).toContain('이상 변동성');
    expect(signal.conviction).toBe('none');
  });

  it('여러 사유가 동시에 걸리면 전부 기록된다', () => {
    const signal = evaluateEntry(flatCtx({ blackout: true }), {
      consecutiveLosses: 5,
      dailyPnlPct: -0.1,
    });
    expect(signal.blockers).toContain('지표 발표 블랙아웃');
    expect(signal.blockers).toContain('연속 손실 한도');
    expect(signal.blockers).toContain('일일 손실 한도');
    expect(signal.blockers).toContain('진입 트리거 없음');
  });
});

describe('evaluateEntry — 반환 구조', () => {
  it(`항상 ${SCORE_ITEM_COUNT}개 항목을 담고 score는 통과 개수와 일치한다`, () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.items).toHaveLength(SCORE_ITEM_COUNT);
    expect(signal.score).toBe(signal.items.filter((i) => i.passed).length);
  });

  it('blockers가 비어 있을 때만 conviction이 none이 아니다', () => {
    const blocked = evaluateEntry(pullbackCtx({ blackout: true }), CLEAN_GUARD);
    const clean = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(blocked.conviction).toBe('none');
    expect(clean.blockers).toEqual([]);
    expect(clean.conviction).not.toBe('none');
  });
});
