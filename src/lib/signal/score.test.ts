import { describe, expect, it } from 'vitest';
import { scoreSignal } from '@/lib/signal/score';
import { candlesFromCloses, flatThenJump } from '@/lib/signal/fixtures';
import type { SignalContext } from '@/types';

/** UTC 12시 — 세션 필터를 통과하는 시각 */
const NOON_UTC = Date.UTC(2026, 0, 5, 12, 0, 0);

function ctx(over: Partial<SignalContext> = {}): SignalContext {
  return {
    candles5m: candlesFromCloses(flatThenJump(60, 100, 130)),
    candles15m: candlesFromCloses(new Array(60).fill(100)),
    fundingRate: 0,
    nowMs: NOON_UTC,
    ...over,
  };
}

describe('scoreSignal — 방향 판정', () => {
  it('EMA12가 SMA20을 위로 교차하면 long이다', () => {
    expect(scoreSignal(ctx()).direction).toBe('long');
  });

  it('EMA12가 SMA20을 아래로 교차하면 short이다', () => {
    const c = ctx({ candles5m: candlesFromCloses(flatThenJump(60, 100, 70)) });
    expect(scoreSignal(c).direction).toBe('short');
  });

  it('교차가 없는 횡보 배열이면 direction이 null이다', () => {
    const c = ctx({ candles5m: candlesFromCloses(new Array(60).fill(100)) });
    expect(scoreSignal(c).direction).toBeNull();
  });
});

describe('scoreSignal — 항목 구조', () => {
  it('항상 8개 항목을 반환하며 실패 항목도 남는다', () => {
    const result = scoreSignal(ctx());
    expect(result.items).toHaveLength(8);
    for (const item of result.items) {
      expect(item.detail.length).toBeGreaterThan(0);
      expect(typeof item.passed).toBe('boolean');
    }
  });

  it('8개 키가 중복 없이 전부 나온다', () => {
    const keys = scoreSignal(ctx()).items.map((i) => i.key);
    expect(new Set(keys).size).toBe(8);
    expect(keys).toEqual(
      expect.arrayContaining([
        'emaCross',
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

  it('방향이 없으면 방향 의존 항목은 "방향 미정"으로 실패한다', () => {
    const c = ctx({ candles5m: candlesFromCloses(new Array(60).fill(100)) });
    const items = scoreSignal(c).items;
    for (const key of ['bbPosition', 'higherTimeframe', 'funding'] as const) {
      const item = items.find((i) => i.key === key)!;
      expect(item.passed).toBe(false);
      expect(item.detail).toContain('방향 미정');
    }
  });
});

describe('scoreSignal — 개별 항목', () => {
  it('bbPosition: 롱은 종가가 상단밴드 위여야 통과한다', () => {
    const pass = scoreSignal(ctx()).items.find((i) => i.key === 'bbPosition')!;
    expect(pass.passed).toBe(true);
  });

  it('volume: 거래량이 기준 미만이면 실패한다', () => {
    const volumes = new Array(61).fill(1000);
    const c = ctx({
      candles5m: candlesFromCloses(flatThenJump(60, 100, 130), { volume: volumes }),
    });
    const item = scoreSignal(c).items.find((i) => i.key === 'volume')!;
    expect(item.passed).toBe(false);
  });

  it('volume: 신호봉 거래량이 평균의 1.5배 이상이면 통과한다', () => {
    const volumes = new Array(61).fill(1000);
    volumes[60] = 5000;
    const c = ctx({
      candles5m: candlesFromCloses(flatThenJump(60, 100, 130), { volume: volumes }),
    });
    const item = scoreSignal(c).items.find((i) => i.key === 'volume')!;
    expect(item.passed).toBe(true);
  });

  it('funding: 롱인데 펀딩이 한계 이상이면 실패한다', () => {
    const item = scoreSignal(ctx({ fundingRate: 0.001 })).items.find(
      (i) => i.key === 'funding',
    )!;
    expect(item.passed).toBe(false);
  });

  it('funding: 롱이고 펀딩이 음수면 통과한다', () => {
    const item = scoreSignal(ctx({ fundingRate: -0.0005 })).items.find(
      (i) => i.key === 'funding',
    )!;
    expect(item.passed).toBe(true);
  });

  it('session: UTC 03시는 세션 밖이라 실패한다', () => {
    const c = ctx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) });
    const item = scoreSignal(c).items.find((i) => i.key === 'session')!;
    expect(item.passed).toBe(false);
  });

  it('session: 설명에 KST 시각을 함께 적는다', () => {
    // 화면의 다른 시각이 전부 KST이므로 이 칸만 UTC면 잘못 읽는다.
    // 판정 기준(세션 창)은 UTC 그대로다.
    const c = ctx({ nowMs: Date.UTC(2026, 0, 5, 10, 0, 0) });
    const item = scoreSignal(c).items.find((i) => i.key === 'session')!;
    expect(item.detail).toBe('KST 19시 (UTC 10시) vs UTC 7~21시');
  });

  it('session: KST 환산이 자정을 넘어가도 맞다', () => {
    const c = ctx({ nowMs: Date.UTC(2026, 0, 5, 16, 0, 0) });
    const item = scoreSignal(c).items.find((i) => i.key === 'session')!;
    expect(item.detail).toBe('KST 1시 (UTC 16시) vs UTC 7~21시');
  });

  it('session: 임계값을 config로 덮어쓸 수 있다', () => {
    const c = ctx({ nowMs: Date.UTC(2026, 0, 5, 3, 0, 0) });
    const item = scoreSignal(c, { sessionStartUtcHour: 0, sessionEndUtcHour: 24 }).items.find(
      (i) => i.key === 'session',
    )!;
    expect(item.passed).toBe(true);
  });

  it('higherTimeframe: 15분봉이 상승 중이면 롱에서 통과한다', () => {
    const rising = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const item = scoreSignal(
      ctx({ candles15m: candlesFromCloses(rising) }),
    ).items.find((i) => i.key === 'higherTimeframe')!;
    expect(item.passed).toBe(true);
  });

  it('higherTimeframe: 15분봉이 하락 중이면 롱에서 실패한다', () => {
    const falling = Array.from({ length: 80 }, (_, i) => 100 - i * 0.5);
    const item = scoreSignal(
      ctx({ candles15m: candlesFromCloses(falling) }),
    ).items.find((i) => i.key === 'higherTimeframe')!;
    expect(item.passed).toBe(false);
  });

  it('trendStrength: adxMin을 config로 낮추면 통과한다', () => {
    const item = scoreSignal(ctx(), { adxMin: 0 }).items.find(
      (i) => i.key === 'trendStrength',
    )!;
    expect(item.passed).toBe(true);
  });
});

describe('scoreSignal — 확정봉 처리 (ADR-006)', () => {
  it('미확정봉은 판정에서 제외된다', () => {
    const closed = candlesFromCloses(flatThenJump(60, 100, 130));
    const withOpen = [
      ...closed,
      { ...closed[closed.length - 1], openTime: 61 * 300_000, close: 999, closed: false },
    ];
    const a = scoreSignal(ctx({ candles5m: closed }));
    const b = scoreSignal(ctx({ candles5m: withOpen }));
    expect(b.direction).toBe(a.direction);
    expect(b.indicators?.ema12).toBeCloseTo(a.indicators!.ema12, 10);
  });
});

describe('scoreSignal — 데이터 부족', () => {
  it('짧은 캔들 배열에서도 예외 없이 8개 항목을 반환한다', () => {
    const c = ctx({ candles5m: candlesFromCloses([100, 101, 102]) });
    const result = scoreSignal(c);
    expect(result.items).toHaveLength(8);
    expect(result.indicators).toBeNull();
    expect(result.direction).toBeNull();
  });

  it('빈 배열에서도 예외를 던지지 않는다', () => {
    const result = scoreSignal(ctx({ candles5m: [], candles15m: [] }));
    expect(result.items).toHaveLength(8);
    expect(result.indicators).toBeNull();
  });
});
