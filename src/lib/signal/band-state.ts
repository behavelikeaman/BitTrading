import type { IndicatorSnapshot } from '@/types';

/**
 * 신호봉의 밴드 폭 상태.
 *
 * 사용자의 실전 관찰: 밴드가 확장 → 수축(좁은 관) → **재확장**할 때 올라탄
 * 교차가 수익이 됐고, 좁은 관 안에서 골든·데드를 반복한 교차들은 전부
 * 노이즈였다. 지금 채점의 `bandExpansion`은 "현재 폭 > 최근 중앙값" 하나라
 * 그 둘을 구분하지 못한다. 먼저 트레이드를 이 상태로 쪼개 성적을 재고,
 * 데이터가 경험칙을 뒷받침할 때만 채점·필터에 반영한다.
 */
export type BandState =
  /** 좁은 관 직후의 재확장 — 사용자가 지목한 자리 */
  | 'squeeze-release'
  /** 스퀴즈 없이 이미 넓은 채로 더 벌어지는 중 */
  | 'expanded'
  /** 아직 관 안 — 교차 노이즈가 쏟아지는 구간 */
  | 'squeezed'
  /** 넓다가 좁아지는 중 */
  | 'contracting'
  /** 표본 부족 (워밍업) */
  | 'unknown';

export const BAND_STATE_LABEL: Record<BandState, string> = {
  'squeeze-release': '좁은 관 직후 재확장',
  expanded: '확장 지속',
  squeezed: '좁은 관 안',
  contracting: '수축 중',
  unknown: '판정 불가',
};

export interface BandStateConfig {
  /** 분위수를 낼 과거 bbWidth 표본 수. 기본 100봉 */
  squeezeLookback: number;
  /** 하위 몇 분위까지를 "좁은 관"으로 볼지. 기본 0.2 */
  squeezePercentile: number;
  /**
   * 좁은 관으로 인정할 최소 연속 봉 수. 기본 3봉.
   *
   * 한 봉만 좁은 것은 관이 아니다. 하위 20%를 임계로 쓰면 어떤 구간에서도
   * 봉의 20%가 걸리므로, 연속을 요구하지 않으면 "스퀴즈 직후"가 거의 항상
   * 참이 되어 상태 분류가 무의미해진다.
   */
  minSqueezeBars: number;
  /** 관에서 벗어난 지 몇 봉 안이어야 "직후"인지. 기본 12봉 (5분봉 1시간) */
  releaseWithinBars: number;
  /** 분위수 판정에 필요한 최소 표본. 기본 30봉 */
  minSamples: number;
}

export const DEFAULT_BAND_STATE_CONFIG: BandStateConfig = {
  squeezeLookback: 100,
  squeezePercentile: 0.2,
  minSqueezeBars: 3,
  releaseWithinBars: 12,
  minSamples: 30,
};

export interface BandStateResult {
  state: BandState;
  /** 최근 표본 안에서 현재 폭의 위치 (0=가장 좁음, 1=가장 넓음). 표본 부족이면 null */
  percentile: number | null;
  /**
   * 마지막 좁은 관(연속 minSqueezeBars봉)이 끝난 뒤 지난 봉 수.
   * 0이면 지금도 관 안이고, 표본 안에 관이 없으면 null이다.
   */
  barsSinceSqueeze: number | null;
  detail: string;
}

/** 정렬된 배열에서 p분위 경계값 (선형 보간 없이 가장 가까운 아래 값) */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/**
 * index 시점의 밴드 폭 상태를 분류한다.
 *
 * **index보다 뒤의 스냅샷은 절대 보지 않는다** (ADR-006). 분위수도 과거 창
 * 안에서만 낸다. 전 구간에서 분위수를 내면 "나중에 더 좁은 구간이 나왔다"는
 * 이유로 과거 판정이 바뀌어, 백테스트가 미래를 아는 상태가 된다.
 */
export function classifyBandState(
  snapshots: (IndicatorSnapshot | null)[],
  index: number,
  config?: Partial<BandStateConfig>,
): BandStateResult {
  const cfg = { ...DEFAULT_BAND_STATE_CONFIG, ...config };
  const curr = index >= 0 ? snapshots[index] : null;
  const prev = index >= 1 ? snapshots[index - 1] : null;

  if (curr === null || prev === null) {
    return {
      state: 'unknown',
      percentile: null,
      barsSinceSqueeze: null,
      detail: '지표 워밍업 중',
    };
  }

  const from = Math.max(0, index - cfg.squeezeLookback + 1);
  const window: { offset: number; width: number }[] = [];
  for (let i = from; i <= index; i++) {
    const s = snapshots[i];
    if (s !== null) window.push({ offset: index - i, width: s.bbWidth });
  }

  if (window.length < cfg.minSamples) {
    return {
      state: 'unknown',
      percentile: null,
      barsSinceSqueeze: null,
      detail: `밴드 폭 표본 ${window.length}봉 (최소 ${cfg.minSamples}봉 필요)`,
    };
  }

  const values = window.map((w) => w.width);
  const sorted = [...values].sort((a, b) => a - b);
  const threshold = quantile(sorted, cfg.squeezePercentile);
  const below = sorted.filter((v) => v < curr.bbWidth).length;
  const percentile = below / sorted.length;

  // 같은 임계값으로 과거 봉도 재야 "그때 좁았는가"가 일관된다. 봉마다 임계값을
  // 다시 내면 창이 밀리면서 판정이 흔들린다.
  //
  // 관은 **연속**이어야 한다. 창을 과거에서 현재 방향으로 훑으며 임계 아래
  // 연속 구간을 세고, minSqueezeBars를 채운 마지막 구간이 끝난 지점을 잡는다.
  const chronological = [...window].sort((a, b) => b.offset - a.offset);
  let run = 0;
  let barsSinceSqueeze: number | null = null;
  for (const w of chronological) {
    if (w.width <= threshold) {
      run += 1;
      if (run >= cfg.minSqueezeBars) barsSinceSqueeze = w.offset;
    } else {
      run = 0;
    }
  }

  // 지금 봉이 임계 아래면 관 안이다 (관이 아직 minSqueezeBars를 못 채웠어도
  // 확장으로 읽으면 안 된다 — 폭이 좁다는 사실 자체는 같다).
  const squeezedNow = curr.bbWidth <= threshold;
  const widening = curr.bbWidth > prev.bbWidth;
  const pctText = `폭 ${(curr.bbWidth * 100).toFixed(3)}% (하위 ${(percentile * 100).toFixed(0)}%)`;

  if (squeezedNow) {
    return {
      state: 'squeezed',
      percentile,
      barsSinceSqueeze,
      detail: `${pctText} — 좁은 관 안`,
    };
  }
  if (
    widening &&
    barsSinceSqueeze !== null &&
    barsSinceSqueeze <= cfg.releaseWithinBars
  ) {
    return {
      state: 'squeeze-release',
      percentile,
      barsSinceSqueeze,
      detail: `${pctText} — ${barsSinceSqueeze}봉 전 좁은 관에서 벗어나 확장 중`,
    };
  }
  return {
    state: widening ? 'expanded' : 'contracting',
    percentile,
    barsSinceSqueeze,
    detail: `${pctText} — ${widening ? '확장 지속' : '수축 중'}`,
  };
}

/**
 * 최근 lookback봉 안에서 EMA12가 BB 중앙선을 넘나든 횟수.
 *
 * 좁은 관 안에서는 이 값이 커진다. 같은 "상향 교차"라도 3시간 동안 골든·데드를
 * 반복한 끝의 교차와, 조용하던 구간에서 한 번에 뚫은 교차는 다른 사건이다.
 * 판정 기준은 setup.ts의 교차 판정과 같아야 한다 — 다르면 같은 봉을 두 곳이
 * 다르게 읽는다.
 */
export function countRecentCrosses(
  snapshots: (IndicatorSnapshot | null)[],
  index: number,
  lookback: number,
): number {
  let count = 0;
  const from = Math.max(1, index - lookback + 1);
  for (let i = from; i <= index; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    if (prev === null || curr === null || prev === undefined || curr === undefined) continue;
    const prevDiff = prev.ema12 - prev.sma20;
    const currDiff = curr.ema12 - curr.sma20;
    if ((prevDiff <= 0 && currDiff > 0) || (prevDiff >= 0 && currDiff < 0)) count += 1;
  }
  return count;
}
