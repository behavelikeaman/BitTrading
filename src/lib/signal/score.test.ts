import { describe, expect, it } from 'vitest';
import { scoreSignal, SCORE_ITEM_COUNT, GATE_COUNT } from '@/lib/signal/score';
import {
  candlesFromCloses,
  crossWithoutPosition,
  overextendedChaseLong,
  overextendedReversionShort,
  risingHtf,
  trendPullbackLong,
} from '@/lib/signal/fixtures';
import type { SignalContext } from '@/types';

/** UTC 12시 — 세션 게이트를 통과하는 시각 */
const NOON_UTC = Date.UTC(2026, 0, 5, 12, 0, 0);

/** 신호봉에 거래량을 실어준다 (거래량 항목 통과용) */
function withVolumeSpike(closes: number[]) {
  const volumes = closes.map((_, i) => (i === closes.length - 1 ? 5000 : 1000));
  return candlesFromCloses(closes, { volume: volumes, spread: 0.4 });
}

/** 2번 케이스 — 정배열 눌림목 재진입 롱 */
function pullbackCtx(over: Partial<SignalContext> = {}): SignalContext {
  return {
    candles5m: withVolumeSpike(trendPullbackLong()),
    candles15m: candlesFromCloses(risingHtf()),
    fundingRate: 0,
    nowMs: NOON_UTC,
    ...over,
  };
}

/** 1번 케이스 — 정배열 과이격 되돌림 숏 */
function reversionCtx(over: Partial<SignalContext> = {}): SignalContext {
  return {
    candles5m: withVolumeSpike(overextendedReversionShort()),
    candles15m: candlesFromCloses(risingHtf()),
    fundingRate: 0,
    nowMs: NOON_UTC,
    ...over,
  };
}

const gate = (ctx: SignalContext, key: string, over = {}) =>
  scoreSignal(ctx, over).gates.find((g) => g.key === key)!;

const item = (ctx: SignalContext, key: string, over = {}) =>
  scoreSignal(ctx, over).items.find((i) => i.key === key)!;

describe('scoreSignal — 셋업 분류가 방향을 정한다', () => {
  it('정배열 눌림목 재교차는 롱이다 (2번 케이스)', () => {
    const result = scoreSignal(pullbackCtx());
    expect(result.setup.kind).toBe('trend-pullback');
    expect(result.direction).toBe('long');
  });

  it('정배열 과이격 후 하향 교차는 숏이다 (1번 케이스)', () => {
    // 배열은 여전히 정배열인데 방향은 숏이다. 예전 규칙(상위 추세와
    // 방향 일치 요구)으로는 나올 수 없던 진입이다.
    const result = scoreSignal(reversionCtx());
    expect(result.setup.kind).toBe('overextended-reversion');
    expect(result.setup.alignment).toBe('bull');
    expect(result.direction).toBe('short');
  });

  it('교차가 없는 횡보는 방향이 없다', () => {
    const c = pullbackCtx({ candles5m: candlesFromCloses(new Array(200).fill(100)) });
    expect(scoreSignal(c).direction).toBeNull();
  });
});

describe('scoreSignal — 1단계 트리거 (ADR-025)', () => {
  it('교차 + 가격 위치가 모두 서면 통과한다', () => {
    const trigger = scoreSignal(pullbackCtx()).trigger;
    expect(trigger.passed).toBe(true);
    expect(trigger.cross).toBe('long');
    expect(trigger.positionConfirmed).toBe(true);
    expect(trigger.blocker).toBeNull();
  });

  it('교차가 없으면 "진입 트리거 없음"을 사유로 남긴다', () => {
    const c = pullbackCtx({ candles5m: candlesFromCloses(new Array(200).fill(100)) });
    const trigger = scoreSignal(c).trigger;
    expect(trigger.passed).toBe(false);
    expect(trigger.cross).toBeNull();
    expect(trigger.blocker).toBe('진입 트리거 없음');
  });

  it('과이격 추격은 교차가 있어도 트리거가 서지 않는다', () => {
    const c = pullbackCtx({ candles5m: withVolumeSpike(overextendedChaseLong()) });
    const trigger = scoreSignal(c).trigger;
    expect(trigger.cross).not.toBeNull();
    expect(trigger.passed).toBe(false);
    expect(trigger.blocker).toBe('과이격 추격 자리');
  });

  it('가격 위치는 셋업마다 다른 자리를 본다 — 눌림목은 SMMA20 회복', () => {
    expect(scoreSignal(pullbackCtx()).trigger.detail).toContain('SMMA20');
  });

  it('가격 위치는 셋업마다 다른 자리를 본다 — 되돌림은 중앙선 반대 이탈', () => {
    const trigger = scoreSignal(reversionCtx()).trigger;
    expect(trigger.detail).toContain('BB중앙선');
    expect(trigger.detail).toContain('반대 이탈');
  });

  it('종가가 자리를 만들지 못했으면 "가격 위치 미확인"이다', () => {
    // 교차는 났지만 밴드 돌파 셋업의 종가가 밴드 안에 머문 경우.
    const result = scoreSignal(
      pullbackCtx({ candles5m: withVolumeSpike(crossWithoutPosition()) }),
    );
    expect(result.trigger.cross).not.toBeNull();
    expect(result.trigger.positionConfirmed).toBe(false);
    expect(result.trigger.blocker).toBe('가격 위치 미확인');
  });
});

describe('scoreSignal — 2단계 점수는 3항목뿐이다 (ADR-025)', () => {
  it(`항상 ${SCORE_ITEM_COUNT}개 항목을 반환하며 실패 항목도 남는다`, () => {
    const result = scoreSignal(pullbackCtx());
    expect(result.items).toHaveLength(SCORE_ITEM_COUNT);
    for (const i of result.items) {
      expect(i.detail.length).toBeGreaterThan(0);
      expect(typeof i.passed).toBe('boolean');
    }
  });

  it('점수 항목은 이평선 배열·이격·거래량 셋뿐이다', () => {
    const keys = scoreSignal(pullbackCtx()).items.map((i) => i.key);
    expect(keys).toEqual(['stackAlignment', 'stackSpread', 'volume']);
  });

  it('트리거·차단 조건은 점수 항목에 들어 있지 않다', () => {
    // 세션·펀딩·BB폭은 통과해도 점수를 올리면 안 된다. 거의 항상 통과하는
    // 항목이 점수를 같이 밀어올리면 확신 문턱이 통째로 왜곡된다.
    const keys: string[] = scoreSignal(pullbackCtx()).items.map((i) => i.key);
    for (const dropped of [
      'emaCross',
      'bbPosition',
      'bandExpansion',
      'session',
      'funding',
      'trendStrength',
      'higherTimeframe',
    ]) {
      expect(keys).not.toContain(dropped);
    }
  });

  it('세션 밖이어도 점수는 그대로다 — 세션은 점수가 아니다', () => {
    const inSession = scoreSignal(pullbackCtx());
    const outSession = scoreSignal(pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) }));
    const passed = (r: typeof inSession) => r.items.filter((i) => i.passed).length;
    expect(passed(outSession)).toBe(passed(inSession));
  });

  it('이평선 배열 항목은 혼조일 때만 실패한다', () => {
    expect(item(pullbackCtx(), 'stackAlignment').passed).toBe(true);
    const flat = pullbackCtx({ candles5m: candlesFromCloses(new Array(200).fill(100)) });
    const alignment = item(flat, 'stackAlignment');
    expect(alignment.passed).toBe(false);
    expect(alignment.detail).toContain('혼조');
  });

  it('되돌림은 벌어진 이격이 통과 조건이다', () => {
    const spread = item(reversionCtx(), 'stackSpread');
    expect(spread.passed).toBe(true);
    expect(spread.detail).toContain('되돌림 근거');
  });

  it('눌림목은 벌어지지 않은 이격이 통과 조건이다', () => {
    expect(item(pullbackCtx(), 'stackSpread').passed).toBe(true);
  });

  it('volume: 거래량이 기준 미만이면 실패한다', () => {
    const c = pullbackCtx({
      candles5m: candlesFromCloses(trendPullbackLong(), { volume: 1000, spread: 0.4 }),
    });
    expect(item(c, 'volume').passed).toBe(false);
  });

  it('volume: 신호봉 거래량이 평균의 1.5배 이상이면 통과한다', () => {
    expect(item(pullbackCtx(), 'volume').passed).toBe(true);
  });

  it('거래량은 가격에서 파생되지 않은 유일한 항목이라 남겨둔다', () => {
    // 이 항목을 빼면 점수가 100% 가격의 함수가 된다. 문서가 아니라 코드로
    // 고정해 두는 이유는, 셋 중 가장 빼고 싶어지는 항목이기 때문이다.
    const keys = scoreSignal(pullbackCtx()).items.map((i) => i.key);
    expect(keys).toContain('volume');
  });
});

describe('scoreSignal — 0단계 차단 게이트', () => {
  it(`게이트는 ${GATE_COUNT}개다 — BB 폭·세션·펀딩`, () => {
    const keys = scoreSignal(pullbackCtx()).gates.map((g) => g.key);
    expect(keys).toEqual(['bandWidth', 'session', 'funding']);
  });

  it('BB 폭: 왕복 마찰 대비 최소치를 못 넘으면 실패한다', () => {
    // 목표가 마찰을 못 넘는 관 안이면 확신의 문제가 아니라 진입 불가다.
    const g = gate(pullbackCtx(), 'bandWidth', { minBbWidthCostMultiple: 1000 });
    expect(g.passed).toBe(false);
    expect(g.blocker).toBe('BB 폭 부족 (수수료 타당성)');
  });

  it('BB 폭: 기준을 낮추면 통과한다', () => {
    expect(gate(pullbackCtx(), 'bandWidth', { minBbWidthCostMultiple: 0 }).passed).toBe(
      true,
    );
  });

  it('BB 폭: 설명에 최소 요구치와 왕복 마찰이 함께 보인다', () => {
    const g = gate(pullbackCtx(), 'bandWidth');
    expect(g.detail).toContain('최소');
    expect(g.detail).toContain('왕복 마찰');
  });

  it('세션: UTC 03시는 세션 밖이라 차단된다', () => {
    const g = gate(pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) }), 'session');
    expect(g.passed).toBe(false);
    expect(g.blocker).toBe('세션 밖');
  });

  it('세션: 설명에 KST 시각을 함께 적는다', () => {
    // 화면의 다른 시각이 전부 KST이므로 이 칸만 UTC면 잘못 읽는다.
    // 판정 기준(세션 창)은 UTC 그대로다.
    const g = gate(pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 10, 0, 0) }), 'session');
    expect(g.detail).toBe('KST 19시 (UTC 10시) vs UTC 7~21시');
  });

  it('세션: KST 환산이 자정을 넘어가도 맞다', () => {
    const g = gate(pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 16, 0, 0) }), 'session');
    expect(g.detail).toBe('KST 1시 (UTC 16시) vs UTC 7~21시');
  });

  it('세션: 임계값을 config로 덮어쓸 수 있다', () => {
    const g = gate(pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) }), 'session', {
      sessionStartUtcHour: 0,
      sessionEndUtcHour: 24,
    });
    expect(g.passed).toBe(true);
  });

  it('펀딩: 롱인데 펀딩이 한계 이상이면 차단된다', () => {
    const g = gate(pullbackCtx({ fundingRate: 0.001 }), 'funding');
    expect(g.passed).toBe(false);
    expect(g.blocker).toBe('펀딩 극단값');
  });

  it('펀딩: 롱이고 펀딩이 음수면 통과한다', () => {
    expect(gate(pullbackCtx({ fundingRate: -0.0005 }), 'funding').passed).toBe(true);
  });

  it('펀딩: 평상시 값(0.01%)은 그냥 통과한다 — 그래서 점수가 아니다', () => {
    // BTC 평상시 펀딩은 0.005~0.015%이고 한계는 ±0.03%다. 90% 이상이
    // 통과하는 조건에 1점을 주면 모든 점수가 1씩 부풀어 문턱이 왜곡된다.
    expect(gate(pullbackCtx({ fundingRate: 0.0001 }), 'funding').passed).toBe(true);
  });

  it('펀딩: 방향이 없으면 절대값으로 잰다', () => {
    const flat = pullbackCtx({
      candles5m: candlesFromCloses(new Array(200).fill(100)),
      fundingRate: -0.001,
    });
    const g = gate(flat, 'funding');
    expect(g.passed).toBe(false);
    expect(g.detail).toContain('±');
  });
});

describe('scoreSignal — 확정봉 처리 (ADR-006)', () => {
  it('미확정봉은 판정에서 제외된다', () => {
    const closed = withVolumeSpike(trendPullbackLong());
    const withOpen = [
      ...closed,
      {
        ...closed[closed.length - 1],
        openTime: closed.length * 300_000,
        close: 999,
        closed: false,
      },
    ];
    const a = scoreSignal(pullbackCtx({ candles5m: closed }));
    const b = scoreSignal(pullbackCtx({ candles5m: withOpen }));
    expect(b.direction).toBe(a.direction);
    expect(b.setup.kind).toBe(a.setup.kind);
    expect(b.indicators?.ema12).toBeCloseTo(a.indicators!.ema12, 10);
  });
});

describe('scoreSignal — 데이터 부족', () => {
  it('스택 워밍업 전에는 진입 셋업이 나오지 않는다', () => {
    // SMMA135가 확정되기 전에는 배열을 판정할 수 없다. 다른 지표가
    // 채워져 있어도 진입시키지 않는다.
    const short = candlesFromCloses(trendPullbackLong().slice(-60), { spread: 0.4 });
    const result = scoreSignal(pullbackCtx({ candles5m: short }));
    expect(result.indicators).not.toBeNull();
    expect(result.indicators!.stack).toBeNull();
    expect(result.direction).toBeNull();
    expect(result.setup.detail).toContain('스택');
  });

  it(`짧은 캔들 배열에서도 예외 없이 ${SCORE_ITEM_COUNT}개 항목을 반환한다`, () => {
    const c = pullbackCtx({ candles5m: candlesFromCloses([100, 101, 102]) });
    const result = scoreSignal(c);
    expect(result.items).toHaveLength(SCORE_ITEM_COUNT);
    expect(result.gates).toHaveLength(GATE_COUNT);
    expect(result.indicators).toBeNull();
    expect(result.direction).toBeNull();
  });

  it('빈 배열에서도 예외를 던지지 않는다', () => {
    const result = scoreSignal(pullbackCtx({ candles5m: [], candles15m: [] }));
    expect(result.items).toHaveLength(SCORE_ITEM_COUNT);
    expect(result.gates).toHaveLength(GATE_COUNT);
    expect(result.indicators).toBeNull();
  });
});
