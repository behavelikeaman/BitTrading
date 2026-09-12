import type { Direction, IndicatorSnapshot, MaStack } from '@/types';

/**
 * 셋업 종류.
 *
 * 같은 "EMA12 × BB중앙선 교차"라도 이평선 배열과 이격 상태에 따라 의미가
 * 정반대다. 사용자의 실전 경험에서 나온 분류다:
 *
 * - trend-pullback: 정배열에서 눌렸다가 추세 방향으로 재교차. 추세 재진입.
 * - overextended-reversion: 정배열인데 간격이 과하게 벌어진 상태에서
 *   추세 반대로 교차. 스택 하단까지 되돌리는 자리.
 * - overextended-chase: 이미 벌어진 상태에서 추세 방향으로 또 교차.
 *   되돌림을 정면으로 맞는 자리라 진입하지 않는다.
 * - band-breakout: 배열이 혼조일 때의 밴드 돌파. 추세가 없는 구간의 교차다.
 * - none: 진입 근거 없음.
 */
export type SetupKind =
  | 'trend-pullback'
  | 'overextended-reversion'
  | 'overextended-chase'
  | 'band-breakout'
  | 'none';

/** 이평선 스택의 배열 상태 */
export type StackAlignment = 'bull' | 'bear' | 'mixed';

export interface SetupConfig {
  /** 이격 중앙값을 낼 과거 봉 수. 기본 100 */
  spreadLookback: number;
  /**
   * 최근 이격 중앙값의 이 배수를 넘으면 "벌어졌다"고 본다. 기본 1.8
   *
   * 절대 기준을 쓰지 않는 이유는 레짐마다 평소 이격이 다르기 때문이다.
   * 조용한 장의 3 ATR과 추세장의 3 ATR은 다른 사건이다.
   */
  extendedMedianMultiple: number;
  /**
   * 그래도 이 비율(가격 대비) 미만이면 과대이격으로 보지 않는다. 기본 0.0015 (0.15%)
   *
   * 스퀴즈 구간에서는 중앙값이 0에 가까워져 배수 조건이 무의미해진다.
   * 절대 하한이 없으면 눌린 구간의 미세한 벌어짐이 전부 "과이격"이 된다.
   */
  extendedMinPct: number;
  /**
   * 이격 중앙값을 신뢰하기 위한 최소 표본 수. 기본 30
   *
   * 표본이 0이면 중앙값이 0이 되어 배수 조건이 항상 참이 된다. 몇 개뿐이면
   * "평소보다 벌어졌는가"가 우연에 좌우된다. 판정을 못 하는 것과 판정해서
   * 통과시키는 것은 다르다.
   */
  minSpreadSamples: number;
}

/**
 * 기본값은 전부 **추정치다.** 사용자 로컬 데이터로 백테스트해 보정해야 한다.
 * 이 값들이 1번 셋업의 빈도를 직접 좌우한다.
 */
export const DEFAULT_SETUP_CONFIG: SetupConfig = {
  spreadLookback: 100,
  extendedMedianMultiple: 1.8,
  extendedMinPct: 0.0015,
  minSpreadSamples: 30,
};

export interface SetupResult {
  kind: SetupKind;
  /** 진입 방향. 진입하지 않는 셋업은 null */
  direction: Direction | null;
  /** 트리거 자체(EMA12 × BB중앙선 교차) 방향. 셋업이 진입을 막아도 남는다. */
  cross: Direction | null;
  alignment: StackAlignment;
  /**
   * (SMMA20 - SMMA135) / SMMA135. 부호가 배열 방향, 절대값이 벌어진 정도.
   *
   * 화면에서 눈으로 보는 "선 간격"이 이 값이다. ATR로 정규화하지 않는
   * 이유는, 급등하면 ATR도 같이 커져서 간격이 벌어질수록 비율이 오히려
   * 줄어드는 역전이 생기기 때문이다.
   */
  spreadPct: number | null;
  /** 같은 간격을 ATR 단위로 본 값. 목표가까지의 거리가 현실적인지 볼 때 쓴다. */
  spreadAtr: number | null;
  /** 최근 spreadLookback봉의 |이격| 중앙값. 지금이 평소보다 벌어졌는지의 기준 */
  medianSpreadPct: number;
  /** 중앙값 산출에 실제로 쓰인 표본 수 (현재 봉 포함). 적으면 판정을 보류한다. */
  spreadSampleCount: number;
  /** 이평선 스택이 확정됐는가. 거짓이면 배열은 "혼조"가 아니라 "모름"이다. */
  stackReady: boolean;
  extended: boolean;
  /**
   * 과이격 되돌림의 구조 목표가 — 스택 반대편 끝(SMMA135).
   *
   * 사용자가 1번 케이스에서 실제로 먹은 자리다. 다른 셋업은 null이며
   * 고정 R배수 목표를 쓴다.
   */
  structureTarget: number | null;
  /** 화면 표시용 한국어 이름 */
  label: string;
  /** 왜 이 셋업인지 한 줄 */
  detail: string;
}

/** 화면 표시용 한국어 이름 */
export const SETUP_LABEL: Record<SetupKind, string> = {
  'trend-pullback': '눌림목 재진입',
  'overextended-reversion': '과이격 되돌림',
  'overextended-chase': '과이격 추격 (진입 금지)',
  'band-breakout': '밴드 돌파',
  none: '셋업 없음',
};

export function alignmentOf(stack: MaStack): StackAlignment {
  if (
    stack.smma20 > stack.smma55 &&
    stack.smma55 > stack.smma95 &&
    stack.smma95 > stack.smma135
  ) {
    return 'bull';
  }
  if (
    stack.smma20 < stack.smma55 &&
    stack.smma55 < stack.smma95 &&
    stack.smma95 < stack.smma135
  ) {
    return 'bear';
  }
  return 'mixed';
}

/** 가격 대비 부호 있는 이격. 정배열이면 양수다. 화면의 선 간격과 같다. */
export function spreadInPct(snapshot: IndicatorSnapshot): number | null {
  if (snapshot.stack === null || snapshot.stack.smma135 === 0) return null;
  return (snapshot.stack.smma20 - snapshot.stack.smma135) / snapshot.stack.smma135;
}

/** 같은 이격을 ATR 단위로. 되돌림 목표까지의 거리가 현실적인지 볼 때 쓴다. */
export function spreadInAtr(snapshot: IndicatorSnapshot): number | null {
  if (snapshot.stack === null || snapshot.atr14 <= 0) return null;
  return (snapshot.stack.smma20 - snapshot.stack.smma135) / snapshot.atr14;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function result(over: Partial<SetupResult> & { kind: SetupKind; detail: string }): SetupResult {
  return {
    direction: null,
    cross: null,
    alignment: 'mixed',
    spreadPct: null,
    spreadAtr: null,
    medianSpreadPct: 0,
    spreadSampleCount: 0,
    stackReady: false,
    extended: false,
    structureTarget: null,
    label: SETUP_LABEL[over.kind],
    ...over,
  };
}

/**
 * 교차 하나를 배열·이격과 함께 읽어 셋업으로 분류한다.
 *
 * 미래 데이터를 보지 않는다. index번 캔들의 확정 지표까지만 쓴다.
 */
export function classifySetup(
  snapshots: (IndicatorSnapshot | null)[],
  index: number,
  config?: Partial<SetupConfig>,
): SetupResult {
  const cfg = { ...DEFAULT_SETUP_CONFIG, ...config };
  const curr = index >= 0 ? snapshots[index] : null;
  const prev = index >= 1 ? snapshots[index - 1] : null;

  if (curr == null || prev == null) {
    return result({ kind: 'none', detail: '지표 데이터 부족' });
  }
  if (curr.stack === null) {
    return result({
      kind: 'none',
      stackReady: false,
      detail: '이평선 스택 워밍업 중 (135봉 필요)',
    });
  }

  // 트리거: EMA12가 BB 중앙선(SMA20)을 교차했는가
  const prevDiff = prev.ema12 - prev.sma20;
  const currDiff = curr.ema12 - curr.sma20;
  const cross: Direction | null =
    prevDiff <= 0 && currDiff > 0 ? 'long' : prevDiff >= 0 && currDiff < 0 ? 'short' : null;

  const alignment = alignmentOf(curr.stack);
  const spreadPct = spreadInPct(curr);
  const spreadAtr = spreadInAtr(curr);

  if (cross === null) {
    return result({
      kind: 'none',
      alignment,
      stackReady: true,
      spreadPct,
      spreadAtr,
      detail: `EMA12 × BB중앙선 교차 없음 (${fmt(prevDiff)} → ${fmt(currDiff)})`,
    });
  }

  // 이격이 "지금 벌어진 것"인지 "원래 이 정도인지"를 최근 분포와 비교한다.
  const historyValues: number[] = [];
  for (let i = index - cfg.spreadLookback; i < index; i++) {
    const s = i >= 0 ? snapshots[i] : null;
    if (s == null) continue;
    const v = spreadInPct(s);
    if (v !== null) historyValues.push(Math.abs(v));
  }
  const medianSpread = historyValues.length > 0 ? median(historyValues) : 0;
  const absSpread = spreadPct === null ? 0 : Math.abs(spreadPct);
  // 현재 봉을 포함한 표본 수. 중앙값을 믿을 수 있는지의 기준이다.
  const samples = historyValues.length + 1;
  const enoughSamples = samples >= cfg.minSpreadSamples;
  const extended =
    enoughSamples &&
    spreadPct !== null &&
    absSpread >= cfg.extendedMinPct &&
    absSpread >= medianSpread * cfg.extendedMedianMultiple;

  const spreadText = enoughSamples
    ? `이격 ${fmt(absSpread * 100, 2)}% (최근 중앙값 ${fmt(medianSpread * 100, 2)}%, 표본 ${samples})`
    : `이격 판정 표본 부족 (${samples}/${cfg.minSpreadSamples}봉) — 과이격 판정 보류`;

  if (alignment === 'mixed') {
    return result({
      kind: 'band-breakout',
      cross,
      stackReady: true,
      spreadSampleCount: samples,
      medianSpreadPct: medianSpread,
      direction: cross,
      alignment,
      spreadPct,
      spreadAtr,
      extended,
      detail: `배열 혼조 — 밴드 돌파로 본다 · ${spreadText}`,
    });
  }

  const trendDirection: Direction = alignment === 'bull' ? 'long' : 'short';
  const withTrend = cross === trendDirection;
  const alignText = alignment === 'bull' ? '정배열' : '역배열';

  if (withTrend) {
    if (extended) {
      return result({
        kind: 'overextended-chase',
        cross,
        stackReady: true,
        spreadSampleCount: samples,
        medianSpreadPct: medianSpread,
        alignment,
        spreadPct,
        spreadAtr,
        extended,
        detail: `${alignText}인데 이미 벌어진 상태에서 추세 방향 교차 — 추격 자리다 · ${spreadText}`,
      });
    }
    return result({
      kind: 'trend-pullback',
      cross,
      stackReady: true,
      spreadSampleCount: samples,
      medianSpreadPct: medianSpread,
      direction: cross,
      alignment,
      spreadPct,
      spreadAtr,
      extended,
      detail: `${alignText} + 추세 방향 재교차 — 눌림목 재진입 · ${spreadText}`,
    });
  }

  // 추세 반대 교차. 벌어져 있어야만 되돌림으로 본다.
  if (extended) {
    return result({
      kind: 'overextended-reversion',
      cross,
      stackReady: true,
      spreadSampleCount: samples,
      medianSpreadPct: medianSpread,
      direction: cross,
      alignment,
      spreadPct,
      spreadAtr,
      extended,
      structureTarget: curr.stack.smma135,
      detail: `${alignText}에서 과이격 후 반대 교차 — 스택 하단(${fmt(curr.stack.smma135)})까지 되돌림 · ${spreadText}`,
    });
  }

  return result({
    kind: 'none',
    cross,
    stackReady: true,
    spreadSampleCount: samples,
    medianSpreadPct: medianSpread,
    alignment,
    spreadPct,
    spreadAtr,
    extended,
    detail: `${alignText}의 반대 교차지만 벌어지지 않았다 — 추세 이탈인지 잡음인지 구분 불가 · ${spreadText}`,
  });
}
