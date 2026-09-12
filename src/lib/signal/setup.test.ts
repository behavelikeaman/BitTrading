import { describe, expect, it } from 'vitest';
import { classifySetup, DEFAULT_SETUP_CONFIG } from '@/lib/signal/setup';
import type { IndicatorSnapshot } from '@/types';

/**
 * 스냅샷을 직접 만든다. 캔들에서 SMMA 배열을 원하는 모양으로 유도하려면
 * 135봉 이상을 정교하게 깎아야 하는데, 그건 분류 규칙이 아니라 지표 계산을
 * 테스트하는 꼴이 된다. 분류 규칙만 검증한다.
 */
function snap(over: {
  ema12: number;
  sma20: number;
  /** SMMA20 - SMMA135 (부호가 배열 방향) */
  spread: number;
  atr?: number;
  price?: number;
}): IndicatorSnapshot {
  const atr = over.atr ?? 10;
  const price = over.price ?? 1000;
  // 스택을 spread만큼 균등하게 벌린다. 부호가 +면 정배열, -면 역배열.
  const step = over.spread / 3;
  return {
    ema12: over.ema12,
    sma20: over.sma20,
    bbUpper: price + 20,
    bbLower: price - 20,
    bbWidth: 40 / price,
    atr14: atr,
    adx14: 25,
    volumeSma20: 1000,
    stack: {
      smma20: price + step * 3,
      smma55: price + step * 2,
      smma95: price + step,
      smma135: price,
    },
  };
}

/** 과이격 판정의 기준이 되는 과거 이격 시리즈 */
function history(spread: number, count = DEFAULT_SETUP_CONFIG.spreadLookback) {
  return Array.from({ length: count }, () =>
    snap({ ema12: 1000, sma20: 1000, spread }),
  );
}

describe('classifySetup — 배열과 이격이 교차의 의미를 바꾼다', () => {
  it('정배열 + 상향교차 + 정상이격 = 눌림목 재진입 롱 (2번 케이스)', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 999, sma20: 1000, spread: 20 }),
      snap({ ema12: 1001, sma20: 1000, spread: 20 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.kind).toBe('trend-pullback');
    expect(setup.direction).toBe('long');
    expect(setup.alignment).toBe('bull');
    expect(setup.extended).toBe(false);
  });

  it('정배열 + 하향교차 + 과대이격 = 과이격 되돌림 숏 (1번 케이스)', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 1001, sma20: 1000, spread: 60 }),
      snap({ ema12: 999, sma20: 1000, spread: 60 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.kind).toBe('overextended-reversion');
    expect(setup.direction).toBe('short');
    expect(setup.alignment).toBe('bull');
    expect(setup.extended).toBe(true);
  });

  it('과이격 되돌림의 목표가는 스택 반대편 끝(가장 느린 선)이다', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 1001, sma20: 1000, spread: 60, price: 1000 }),
      snap({ ema12: 999, sma20: 1000, spread: 60, price: 1000 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    // 정배열에서 하단은 SMMA135. snap()이 price를 SMMA135에 둔다.
    expect(setup.structureTarget).toBe(1000);
  });

  it('정배열 + 상향교차 + 과대이격 = 추격이므로 진입하지 않는다', () => {
    // 이미 3 ATR 넘게 벌어진 상태에서 추세 방향으로 더 들어가는 것은
    // 되돌림을 정면으로 맞는 자리다.
    const snaps = [
      ...history(20),
      snap({ ema12: 999, sma20: 1000, spread: 60 }),
      snap({ ema12: 1001, sma20: 1000, spread: 60 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.kind).toBe('overextended-chase');
    expect(setup.direction).toBeNull();
  });

  it('정배열 + 하향교차 + 정상이격은 판단을 보류한다', () => {
    // 벌어지지 않은 상태의 하향 교차는 추세 이탈 초기인지 잡음인지
    // 구분되지 않는다. 1번 케이스의 전제(벌어진 간격)가 없다.
    const snaps = [
      ...history(20),
      snap({ ema12: 1001, sma20: 1000, spread: 20 }),
      snap({ ema12: 999, sma20: 1000, spread: 20 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.kind).toBe('none');
    expect(setup.direction).toBeNull();
  });

  it('역배열은 방향만 뒤집힌 같은 규칙이다', () => {
    const pullback = classifySetup(
      [
        ...history(-20),
        snap({ ema12: 1001, sma20: 1000, spread: -20 }),
        snap({ ema12: 999, sma20: 1000, spread: -20 }),
      ],
      DEFAULT_SETUP_CONFIG.spreadLookback + 1,
    );
    expect(pullback.kind).toBe('trend-pullback');
    expect(pullback.direction).toBe('short');
    expect(pullback.alignment).toBe('bear');

    const reversion = classifySetup(
      [
        ...history(-20),
        snap({ ema12: 999, sma20: 1000, spread: -60 }),
        snap({ ema12: 1001, sma20: 1000, spread: -60 }),
      ],
      DEFAULT_SETUP_CONFIG.spreadLookback + 1,
    );
    expect(reversion.kind).toBe('overextended-reversion');
    expect(reversion.direction).toBe('long');
    expect(reversion.alignment).toBe('bear');
  });

  it('혼조 배열에서는 밴드 돌파 셋업으로 본다', () => {
    const mixed = snap({ ema12: 1001, sma20: 1000, spread: 20 });
    // 배열을 깨뜨린다: 빠른 선이 중간 선 아래로
    const broken: IndicatorSnapshot = {
      ...mixed,
      stack: { ...mixed.stack!, smma20: mixed.stack!.smma95 - 1 },
    };
    const prev = snap({ ema12: 999, sma20: 1000, spread: 20 });
    const snaps = [...history(20), prev, broken];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.kind).toBe('band-breakout');
    expect(setup.direction).toBe('long');
    expect(setup.alignment).toBe('mixed');
  });

  it('교차가 없으면 셋업이 없다', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 1001, sma20: 1000, spread: 20 }),
      snap({ ema12: 1002, sma20: 1000, spread: 20 }),
    ];
    expect(classifySetup(snaps, snaps.length - 1).kind).toBe('none');
  });

  it('표본이 모자라면 과이격 판정을 하지 않는다', () => {
    // 중앙값을 3~4개로 내면 "평소보다 벌어졌는가"가 우연에 좌우된다.
    // 특히 표본이 0이면 중앙값이 0이 되어 모든 이격이 과이격으로 통과한다.
    const snaps = [
      ...history(20, 5),
      snap({ ema12: 1001, sma20: 1000, spread: 60 }),
      snap({ ema12: 999, sma20: 1000, spread: 60 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.extended).toBe(false);
    expect(setup.kind).toBe('none');
    expect(setup.detail).toContain('표본');
  });

  it('이격 표본 개수를 함께 보고한다', () => {
    const snaps = [
      ...history(20, 40),
      snap({ ema12: 1001, sma20: 1000, spread: 60 }),
      snap({ ema12: 999, sma20: 1000, spread: 60 }),
    ];
    // 과거 40개 + 직전 봉 1개 + 현재 봉 1개
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.spreadSampleCount).toBe(42);
  });

  it('스택이 없으면 배열을 "혼조"로 단정하지 않는다', () => {
    // 혼조(추세 없음)와 데이터 부족(모름)은 다른 상태다. 같은 이름으로
    // 보여주면 워밍업 중인 화면을 보고 "추세가 없구나"라고 읽게 된다.
    const noStack: IndicatorSnapshot = {
      ...snap({ ema12: 1001, sma20: 1000, spread: 20 }),
      stack: null,
    };
    const setup = classifySetup([noStack, noStack], 1);
    expect(setup.stackReady).toBe(false);
  });

  it('스택이 있으면 stackReady가 참이다', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 999, sma20: 1000, spread: 20 }),
      snap({ ema12: 1001, sma20: 1000, spread: 20 }),
    ];
    expect(classifySetup(snaps, snaps.length - 1).stackReady).toBe(true);
  });

  it('스택 워밍업 전에는 셋업을 내지 않는다', () => {
    const noStack: IndicatorSnapshot = {
      ...snap({ ema12: 1001, sma20: 1000, spread: 20 }),
      stack: null,
    };
    const snaps = [snap({ ema12: 999, sma20: 1000, spread: 20 }), noStack];
    const setup = classifySetup(snaps, 1);
    expect(setup.kind).toBe('none');
    expect(setup.detail).toContain('스택');
  });

  it('과거 이격이 지금보다 크면 과대이격이 아니다', () => {
    // 절대값이 커도 최근 평소 수준이면 "벌어졌다"고 볼 수 없다.
    const snaps = [
      ...history(60),
      snap({ ema12: 1001, sma20: 1000, spread: 60 }),
      snap({ ema12: 999, sma20: 1000, spread: 60 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.extended).toBe(false);
    expect(setup.kind).toBe('none');
  });

  it('이격은 가격 대비 비율이라 가격 수준에 좌우되지 않는다', () => {
    // 같은 비율이면 100달러짜리든 100,000달러짜리든 같은 판정이어야 한다.
    const cheap = classifySetup(
      [
        ...history(20),
        snap({ ema12: 1001, sma20: 1000, spread: 60, price: 1000 }),
        snap({ ema12: 999, sma20: 1000, spread: 60, price: 1000 }),
      ],
      DEFAULT_SETUP_CONFIG.spreadLookback + 1,
    );
    const expensive = classifySetup(
      [
        ...Array.from({ length: DEFAULT_SETUP_CONFIG.spreadLookback }, () =>
          snap({ ema12: 100_000, sma20: 100_000, spread: 2000, price: 100_000 }),
        ),
        snap({ ema12: 100_100, sma20: 100_000, spread: 6000, price: 100_000 }),
        snap({ ema12: 99_900, sma20: 100_000, spread: 6000, price: 100_000 }),
      ],
      DEFAULT_SETUP_CONFIG.spreadLookback + 1,
    );
    expect(cheap.kind).toBe('overextended-reversion');
    expect(expensive.kind).toBe('overextended-reversion');
    expect(expensive.spreadPct).toBeCloseTo(cheap.spreadPct!, 10);
  });

  it('spreadPct는 스택 하단 대비 부호 있는 간격이다', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 999, sma20: 1000, spread: 30, price: 1000 }),
      snap({ ema12: 1001, sma20: 1000, spread: 30, price: 1000 }),
    ];
    const setup = classifySetup(snaps, snaps.length - 1);
    expect(setup.spreadPct).toBeCloseTo(0.03, 10);
  });

  it('spreadAtr도 함께 보고한다 — 목표까지 거리가 현실적인지 볼 때 쓴다', () => {
    const snaps = [
      ...history(20),
      snap({ ema12: 999, sma20: 1000, spread: 30, atr: 10 }),
      snap({ ema12: 1001, sma20: 1000, spread: 30, atr: 10 }),
    ];
    expect(classifySetup(snaps, snaps.length - 1).spreadAtr).toBeCloseTo(3, 10);
  });
});
