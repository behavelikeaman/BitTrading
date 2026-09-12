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

/** 거래량이 실리지 않아 점수 한 칸이 빠지는 눌림목 */
const lowVolumePullbackCtx = () =>
  pullbackCtx({
    candles5m: candlesFromCloses(trendPullbackLong(), { volume: 1000, spread: 0.4 }),
  });

describe('evaluateEntry — 실전 셋업 두 가지', () => {
  it('눌림목 재진입(2번)은 3/3으로 진입한다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.blockers).toEqual([]);
    expect(signal.score).toBe(3);
    expect(signal.direction).toBe('long');
    expect(signal.setup.kind).toBe('trend-pullback');
    expect(signal.trigger.passed).toBe(true);
  });

  it('과이격 되돌림(1번)은 정배열인데도 숏으로 진입한다', () => {
    const signal = evaluateEntry(reversionCtx(), CLEAN_GUARD);
    expect(signal.blockers).toEqual([]);
    expect(signal.score).toBe(3);
    expect(signal.direction).toBe('short');
    expect(signal.setup.alignment).toBe('bull');
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

describe('evaluateEntry — 점수는 사이징을 바꾸지 않는다 (ADR-025)', () => {
  it('기본값에서 등급은 점수와 무관하게 전 거래 동일하다', () => {
    const full = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    const partial = evaluateEntry(lowVolumePullbackCtx(), CLEAN_GUARD);
    expect(full.score).toBe(3);
    expect(partial.score).toBe(2);
    expect(partial.blockers).toEqual([]);
    expect(partial.conviction).toBe(full.conviction);
    expect(full.conviction).toBe('medium');
  });

  it('점수가 낮아도 진입한다 — 점수 구간별 성적을 재려면 전 구간을 밟아야 한다', () => {
    // 낮은 점수를 아예 안 들어가면 점수별 평균 R 곡선에 그 구간이 비고,
    // 점수가 결과를 예측하는지 영영 알 수 없다.
    const signal = evaluateEntry(lowVolumePullbackCtx(), CLEAN_GUARD);
    expect(signal.conviction).not.toBe('none');
  });

  it('uniformConviction으로 그 고정 등급을 바꿀 수 있다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD, {
      uniformConviction: 'high',
    });
    expect(signal.conviction).toBe('high');
  });

  it('scoreDrivesSizing을 켜면 3점은 확신, 2점은 약간의 확신이다', () => {
    const full = evaluateEntry(pullbackCtx(), CLEAN_GUARD, { scoreDrivesSizing: true });
    const partial = evaluateEntry(lowVolumePullbackCtx(), CLEAN_GUARD, {
      scoreDrivesSizing: true,
    });
    expect(full.conviction).toBe('high');
    expect(partial.conviction).toBe('medium');
  });

  it('minScoreToEnter를 올리면 그 아래 점수는 진입하지 않는다', () => {
    const signal = evaluateEntry(lowVolumePullbackCtx(), CLEAN_GUARD, {
      minScoreToEnter: 3,
    });
    expect(signal.score).toBe(2);
    expect(signal.conviction).toBe('none');
  });
});

describe('evaluateEntry — 0단계 차단 조건', () => {
  it('BB 폭이 수수료 타당성 기준에 못 미치면 차단된다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD, {
      minBbWidthCostMultiple: 1000,
    });
    expect(signal.blockers).toContain('BB 폭 부족 (수수료 타당성)');
    expect(signal.conviction).toBe('none');
  });

  it('세션 밖이면 점수와 무관하게 차단된다', () => {
    const signal = evaluateEntry(
      pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) }),
      CLEAN_GUARD,
    );
    expect(signal.score).toBe(3);
    expect(signal.blockers).toContain('세션 밖');
    expect(signal.conviction).toBe('none');
  });

  it('펀딩이 극단값이면 차단된다', () => {
    const signal = evaluateEntry(pullbackCtx({ fundingRate: 0.001 }), CLEAN_GUARD);
    expect(signal.blockers).toContain('펀딩 극단값');
    expect(signal.conviction).toBe('none');
  });

  it('평상시 펀딩(0.01%)은 아무 영향도 주지 않는다', () => {
    const normal = evaluateEntry(pullbackCtx({ fundingRate: 0.0001 }), CLEAN_GUARD);
    const zero = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(normal.blockers).toEqual([]);
    expect(normal.score).toBe(zero.score);
  });

  it('blackout이면 점수가 만점이어도 conviction은 none이다', () => {
    const signal = evaluateEntry(pullbackCtx({ blackout: true }), CLEAN_GUARD);
    expect(signal.score).toBe(3);
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
    expect(signal.conviction).not.toBe('none');
  });

  it('데이터가 부족하면 "데이터 부족" 하나로만 차단된다', () => {
    // 판정 불가를 여러 사유로 쪼개 적으면 무엇이 진짜 문제인지 흐려진다.
    const signal = evaluateEntry(
      flatCtx({ candles5m: candlesFromCloses([100, 101, 102]) }),
      CLEAN_GUARD,
    );
    expect(signal.blockers).toContain('데이터 부족');
    expect(signal.blockers).not.toContain('BB 폭 부족 (수수료 타당성)');
    expect(signal.conviction).toBe('none');
    expect(signal.items).toHaveLength(SCORE_ITEM_COUNT);
  });

  it('횡보 뒤 급등하는 시리즈는 이상 변동성으로 차단된다', () => {
    const signal = evaluateEntry(ctxOf(flatThenJump(60, 100, 130)), CLEAN_GUARD);
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

describe('evaluateEntry — 1단계 트리거', () => {
  it('교차가 없으면 "진입 트리거 없음"으로 차단된다', () => {
    const signal = evaluateEntry(flatCtx(), CLEAN_GUARD);
    expect(signal.blockers).toContain('진입 트리거 없음');
    expect(signal.conviction).toBe('none');
    expect(signal.direction).toBeNull();
  });

  it('트리거 판정을 신호에 그대로 실어 보낸다', () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.trigger.cross).toBe('long');
    expect(signal.trigger.positionConfirmed).toBe(true);
    expect(signal.trigger.blocker).toBeNull();
  });
});

describe('evaluateEntry — 반환 구조', () => {
  it(`항상 ${SCORE_ITEM_COUNT}개 항목을 담고 score는 통과 개수와 일치한다`, () => {
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.items).toHaveLength(SCORE_ITEM_COUNT);
    expect(signal.score).toBe(signal.items.filter((i) => i.passed).length);
  });

  it('게이트 판정은 차단되지 않았을 때도 전부 남는다', () => {
    // 왜 통과했는지 보이지 않으면 화면이 "막히지 않았다"는 사실만 말한다.
    const signal = evaluateEntry(pullbackCtx(), CLEAN_GUARD);
    expect(signal.gates.map((g) => g.key)).toEqual(['bandWidth', 'session', 'funding']);
    expect(signal.gates.every((g) => g.passed)).toBe(true);
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
