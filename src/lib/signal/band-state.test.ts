import { describe, expect, it } from 'vitest';
import {
  classifyBandState,
  countRecentCrosses,
  DEFAULT_BAND_STATE_CONFIG,
} from '@/lib/signal/band-state';
import type { IndicatorSnapshot } from '@/types';

function snap(over: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    ema12: 100,
    sma20: 100,
    bbUpper: 101,
    bbLower: 99,
    bbWidth: 0.02,
    atr14: 1,
    adx14: 25,
    volumeSma20: 1000,
    stack: null,
    ...over,
  };
}

/** bbWidth 배열을 스냅샷 배열로 */
function widths(values: number[]): IndicatorSnapshot[] {
  return values.map((bbWidth) => snap({ bbWidth }));
}

/**
 * 평범한 배경 구간 n봉.
 *
 * 폭이 일정한 배열을 배경으로 쓰면 하위 20% 경계값이 그 값과 같아져 전 구간이
 * 스퀴즈로 판정된다. 실제 밴드 폭은 늘 흔들리므로 배경도 흔들려야 한다.
 */
function background(n: number): number[] {
  const cycle = [0.018, 0.022, 0.026, 0.020, 0.030, 0.017, 0.024, 0.028];
  return Array.from({ length: n }, (_, i) => cycle[i % cycle.length]);
}

/** 좁은 관 n봉 */
function tube(n: number): number[] {
  return Array.from({ length: n }, () => 0.006);
}

describe('classifyBandState — 좁은 관과 확장을 구분한다', () => {
  it('좁은 관 직후 폭이 벌어지면 squeeze-release다', () => {
    // 넓은 구간 → 좁은 관 → 확장 전환. 사용자가 차트에서 지목한 자리다.
    const series = [...background(90), ...tube(8), 0.012, 0.024];
    const r = classifyBandState(widths(series), series.length - 1);
    expect(r.state).toBe('squeeze-release');
    expect(r.barsSinceSqueeze).toBe(1);
  });

  it('아직 관 안에 있으면 squeezed다 — 교차 노이즈가 나오는 구간', () => {
    const series = [...background(90), ...tube(10)];
    expect(classifyBandState(widths(series), series.length - 1).state).toBe('squeezed');
  });

  it('스퀴즈 없이 넓은 채로 커지면 expanded다', () => {
    const series = [...background(98), 0.026, 0.032];
    expect(classifyBandState(widths(series), series.length - 1).state).toBe('expanded');
  });

  it('넓다가 좁아지는 중이면 contracting이다', () => {
    const series = [...background(98), 0.032, 0.026];
    expect(classifyBandState(widths(series), series.length - 1).state).toBe('contracting');
  });

  it('스퀴즈가 오래전이면 squeeze-release가 아니다', () => {
    // 좁은 관 뒤로 releaseWithinBars보다 더 지났다. 이미 확장이 끝난 자리다.
    const gap = DEFAULT_BAND_STATE_CONFIG.releaseWithinBars + 5;
    const series = [...background(60), ...tube(8), ...background(gap), 0.026, 0.032];
    expect(classifyBandState(widths(series), series.length - 1).state).toBe('expanded');
  });

  it('좁은 봉 하나는 관이 아니다 — 연속 minSqueezeBars봉을 요구한다', () => {
    // 하위 20%를 임계로 쓰면 어떤 구간에서도 봉의 20%가 걸린다. 연속을
    // 요구하지 않으면 "스퀴즈 직후"가 거의 항상 참이 되어 분류가 무의미해진다.
    const series = [...background(96), 0.006, 0.020, 0.026, 0.032];
    expect(classifyBandState(widths(series), series.length - 1).state).toBe('expanded');
  });

  it('표본이 모자라면 unknown이다', () => {
    expect(classifyBandState(widths([0.02, 0.021]), 1).state).toBe('unknown');
  });

  it('미래 캔들을 보지 않는다 (ADR-006 · 룩어헤드 금지)', () => {
    // 판정 지점 뒤를 아무리 바꿔도 결과가 같아야 한다. 분위수를 전 구간에서
    // 재면 이 테스트가 깨진다.
    const head = [...background(90), ...tube(8), 0.012, 0.024];
    const at = head.length - 1;
    const a = classifyBandState(widths(head), at);
    const b = classifyBandState(widths([...head, 0.05, 0.001, 0.09]), at);
    expect(b).toEqual(a);
  });

  it('백분위는 0~1이고 좁을수록 낮다', () => {
    const series = [...background(90), ...tube(8), 0.010, 0.012];
    const r = classifyBandState(widths(series), series.length - 1);
    expect(r.percentile).not.toBeNull();
    expect(r.percentile!).toBeGreaterThanOrEqual(0);
    expect(r.percentile!).toBeLessThan(0.3);
  });
});

describe('countRecentCrosses — 휩소 구간을 센다', () => {
  /** ema12 - sma20 부호 배열에서 스냅샷을 만든다 */
  function diffs(values: number[]): IndicatorSnapshot[] {
    return values.map((d) => snap({ ema12: 100 + d, sma20: 100 }));
  }

  it('한 번만 뚫고 올라가면 1이다', () => {
    const s = diffs([-3, -2, -1, 0.5, 1, 2]);
    expect(countRecentCrosses(s, s.length - 1, 12)).toBe(1);
  });

  it('골든·데드를 반복하면 그만큼 센다', () => {
    // 좁은 관 안에서 EMA가 중앙선을 오가는 모양. 3시간짜리 노이즈가 이것이다.
    const s = diffs([-1, 1, -1, 1, -1, 1]);
    expect(countRecentCrosses(s, s.length - 1, 12)).toBe(5);
  });

  it('lookback 밖의 교차는 세지 않는다', () => {
    const s = diffs([-1, 1, -1, 1, 2, 3, 4, 5]);
    expect(countRecentCrosses(s, s.length - 1, 3)).toBe(0);
  });

  it('교차가 없으면 0이다', () => {
    const s = diffs([1, 2, 3, 4]);
    expect(countRecentCrosses(s, s.length - 1, 12)).toBe(0);
  });

  it('미래 캔들을 보지 않는다', () => {
    const head = [-1, 1, -1, 1, 2];
    const a = countRecentCrosses(diffs(head), head.length - 1, 12);
    const b = countRecentCrosses(diffs([...head, -5, 5]), head.length - 1, 12);
    expect(b).toBe(a);
  });
});
