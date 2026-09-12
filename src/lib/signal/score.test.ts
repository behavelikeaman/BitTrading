import { describe, expect, it } from 'vitest';
import { scoreSignal, SCORE_ITEM_COUNT } from '@/lib/signal/score';
import {
  candlesFromCloses,
  overextendedReversionShort,
  risingHtf,
  trendPullbackLong,
} from '@/lib/signal/fixtures';
import type { SignalContext } from '@/types';

/** UTC 12시 — 세션 필터를 통과하는 시각 */
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

describe('scoreSignal — 셋업마다 통과 조건이 다르다 (ADR-022)', () => {
  it('과이격 되돌림은 상위 추세가 살아 있어야 상위 프레임 항목을 통과한다', () => {
    // 숏인데 15분봉은 상승 중이다. 이전 규칙에서는 무조건 실패였지만,
    // 되돌림은 상위 추세가 유지돼야 스택 하단에서 멈출 근거가 생긴다.
    const item = scoreSignal(reversionCtx()).items.find(
      (i) => i.key === 'higherTimeframe',
    )!;
    expect(item.passed).toBe(true);
    expect(item.detail).toContain('되돌림의 전제');
  });

  it('과이격 되돌림인데 상위 추세까지 꺾였으면 실패한다', () => {
    // 추세 전환이라면 스택 하단이 지지선이라는 전제가 사라진다.
    const falling = Array.from({ length: 80 }, (_, i) => 100 - i * 0.5);
    const item = scoreSignal(
      reversionCtx({ candles15m: candlesFromCloses(falling) }),
    ).items.find((i) => i.key === 'higherTimeframe')!;
    expect(item.passed).toBe(false);
  });

  it('되돌림은 벌어진 이격이 통과 조건이다', () => {
    const item = scoreSignal(reversionCtx()).items.find((i) => i.key === 'stackSpread')!;
    expect(item.passed).toBe(true);
    expect(item.detail).toContain('되돌림 근거');
  });

  it('눌림목은 벌어지지 않은 이격이 통과 조건이다', () => {
    const item = scoreSignal(pullbackCtx()).items.find((i) => i.key === 'stackSpread')!;
    expect(item.passed).toBe(true);
  });

  it('가격 위치 항목은 되돌림에서 중앙선 반대 이탈을 본다', () => {
    const item = scoreSignal(reversionCtx()).items.find((i) => i.key === 'bbPosition')!;
    expect(item.detail).toContain('BB중앙선');
    expect(item.detail).toContain('반대 이탈');
  });

  it('가격 위치 항목은 눌림목에서 SMMA20 회복을 본다', () => {
    const item = scoreSignal(pullbackCtx()).items.find((i) => i.key === 'bbPosition')!;
    expect(item.detail).toContain('SMMA20');
  });
});

describe('scoreSignal — 항목 구조', () => {
  it(`항상 ${SCORE_ITEM_COUNT}개 항목을 반환하며 실패 항목도 남는다`, () => {
    const result = scoreSignal(pullbackCtx());
    expect(result.items).toHaveLength(SCORE_ITEM_COUNT);
    for (const item of result.items) {
      expect(item.detail.length).toBeGreaterThan(0);
      expect(typeof item.passed).toBe('boolean');
    }
  });

  it('키가 중복 없이 전부 나온다', () => {
    const keys = scoreSignal(pullbackCtx()).items.map((i) => i.key);
    expect(new Set(keys).size).toBe(SCORE_ITEM_COUNT);
    expect(keys).toEqual(
      expect.arrayContaining([
        'emaCross',
        'stackAlignment',
        'stackSpread',
        'bbPosition',
        'bandExpansion',
        'volume',
        'higherTimeframe',
        'trendStrength',
        'funding',
        'session',
      ]),
    );
  });

  it('진입 셋업이 없으면 방향 의존 항목은 그 사유를 남긴다', () => {
    const c = pullbackCtx({ candles5m: candlesFromCloses(new Array(200).fill(100)) });
    const items = scoreSignal(c).items;
    for (const key of ['bbPosition', 'higherTimeframe', 'funding'] as const) {
      const item = items.find((i) => i.key === key)!;
      expect(item.passed).toBe(false);
      expect(item.detail).toContain('진입 셋업 없음');
    }
  });

  it('이평선 배열 항목은 혼조일 때만 실패한다', () => {
    expect(
      scoreSignal(pullbackCtx()).items.find((i) => i.key === 'stackAlignment')!.passed,
    ).toBe(true);
    const flat = pullbackCtx({ candles5m: candlesFromCloses(new Array(200).fill(100)) });
    const item = scoreSignal(flat).items.find((i) => i.key === 'stackAlignment')!;
    expect(item.passed).toBe(false);
    expect(item.detail).toContain('혼조');
  });
});

describe('scoreSignal — 개별 항목', () => {
  it('volume: 거래량이 기준 미만이면 실패한다', () => {
    const c = pullbackCtx({
      candles5m: candlesFromCloses(trendPullbackLong(), { volume: 1000, spread: 0.4 }),
    });
    expect(scoreSignal(c).items.find((i) => i.key === 'volume')!.passed).toBe(false);
  });

  it('volume: 신호봉 거래량이 평균의 1.5배 이상이면 통과한다', () => {
    expect(
      scoreSignal(pullbackCtx()).items.find((i) => i.key === 'volume')!.passed,
    ).toBe(true);
  });

  it('funding: 롱인데 펀딩이 한계 이상이면 실패한다', () => {
    const item = scoreSignal(pullbackCtx({ fundingRate: 0.001 })).items.find(
      (i) => i.key === 'funding',
    )!;
    expect(item.passed).toBe(false);
  });

  it('funding: 롱이고 펀딩이 음수면 통과한다', () => {
    const item = scoreSignal(pullbackCtx({ fundingRate: -0.0005 })).items.find(
      (i) => i.key === 'funding',
    )!;
    expect(item.passed).toBe(true);
  });

  it('session: UTC 03시는 세션 밖이라 실패한다', () => {
    const c = pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) });
    expect(scoreSignal(c).items.find((i) => i.key === 'session')!.passed).toBe(false);
  });

  it('session: 설명에 KST 시각을 함께 적는다', () => {
    // 화면의 다른 시각이 전부 KST이므로 이 칸만 UTC면 잘못 읽는다.
    // 판정 기준(세션 창)은 UTC 그대로다.
    const c = pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 10, 0, 0) });
    const item = scoreSignal(c).items.find((i) => i.key === 'session')!;
    expect(item.detail).toBe('KST 19시 (UTC 10시) vs UTC 7~21시');
  });

  it('session: KST 환산이 자정을 넘어가도 맞다', () => {
    const c = pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 16, 0, 0) });
    const item = scoreSignal(c).items.find((i) => i.key === 'session')!;
    expect(item.detail).toBe('KST 1시 (UTC 16시) vs UTC 7~21시');
  });

  it('session: 임계값을 config로 덮어쓸 수 있다', () => {
    const c = pullbackCtx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) });
    const item = scoreSignal(c, {
      sessionStartUtcHour: 0,
      sessionEndUtcHour: 24,
    }).items.find((i) => i.key === 'session')!;
    expect(item.passed).toBe(true);
  });

  it('higherTimeframe: 눌림목 롱은 15분봉이 상승 중이어야 통과한다', () => {
    const item = scoreSignal(pullbackCtx()).items.find(
      (i) => i.key === 'higherTimeframe',
    )!;
    expect(item.passed).toBe(true);
  });

  it('higherTimeframe: 눌림목 롱인데 15분봉이 하락 중이면 실패한다', () => {
    const falling = Array.from({ length: 80 }, (_, i) => 100 - i * 0.5);
    const item = scoreSignal(
      pullbackCtx({ candles15m: candlesFromCloses(falling) }),
    ).items.find((i) => i.key === 'higherTimeframe')!;
    expect(item.passed).toBe(false);
  });

  it('trendStrength: adxMin을 config로 낮추면 통과한다', () => {
    const item = scoreSignal(pullbackCtx(), { adxMin: 0 }).items.find(
      (i) => i.key === 'trendStrength',
    )!;
    expect(item.passed).toBe(true);
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
    expect(result.indicators).toBeNull();
    expect(result.direction).toBeNull();
  });

  it('빈 배열에서도 예외를 던지지 않는다', () => {
    const result = scoreSignal(pullbackCtx({ candles5m: [], candles15m: [] }));
    expect(result.items).toHaveLength(SCORE_ITEM_COUNT);
    expect(result.indicators).toBeNull();
  });
});
