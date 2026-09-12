import type { Conviction, GuardState, Signal, SignalContext } from '@/types';
import {
  DEFAULT_SCORE_CONFIG,
  scoreSignal,
  type ScoreConfig,
} from '@/lib/signal/score';

export interface EntryConfig extends ScoreConfig {
  /**
   * 점수가 포지션 크기를 정하는가. **기본 false** (ADR-025).
   *
   * 점수가 결과를 예측한다는 증거가 아직 없다. 증거 없이 3점에 2%를 걸고
   * 2점에 1%를 거는 것은 근거 없이 분산만 키우는 일이다. 당분간 점수는
   * 기록만 하고 포지션 크기는 전 거래 동일하게 간다. 트레이드 100~150건에서
   * 점수별 평균 R이 단조 증가하면 그때 이 스위치를 켠다.
   */
  scoreDrivesSizing: boolean;
  /**
   * scoreDrivesSizing=false일 때 모든 진입에 쓰는 등급. 기본 'medium'.
   *
   * 등급은 리스크 예산과 물타기 레그 수를 정한다. 전 거래 동일하게 두려면
   * 값 하나로 고정해야 한다.
   */
  uniformConviction: Exclude<Conviction, 'none'>;
  /** 확신 등급 최소 점수 (3점 만점). scoreDrivesSizing=true일 때만 쓴다. 기본 3 */
  highConvictionScore: number;
  /** 약간의 확신 최소 점수 (3점 만점). scoreDrivesSizing=true일 때만 쓴다. 기본 2 */
  mediumConvictionScore: number;
  /**
   * 진입에 요구하는 최소 점수. 기본 0 — 점수로 거르지 않는다.
   *
   * 0이어야 하는 이유는 측정 때문이다. 점수 낮은 자리를 아예 안 들어가면
   * 점수별 평균 R 곡선에 그 구간이 비어, 점수가 결과를 예측하는지 영영
   * 알 수 없다. 곡선이 나온 뒤에 올려라.
   */
  minScoreToEnter: number;
  /** ATR이 최근 평균의 이 배수를 넘으면 이상 변동성으로 본다. 기본 2.0 */
  atrSpikeMultiple: number;
  /** 연속 손실 한도. 기본 3 */
  consecutiveLossLimit: number;
  /** 일일 손실 한도. 기본 0.06 (-6%) */
  dailyLossLimitPct: number;
  /** ATR 평균 산출에 쓸 과거 봉 수. 기본 20 */
  atrLookback: number;
}

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  ...DEFAULT_SCORE_CONFIG,
  scoreDrivesSizing: false,
  uniformConviction: 'medium',
  highConvictionScore: 3,
  mediumConvictionScore: 2,
  minScoreToEnter: 0,
  atrSpikeMultiple: 2.0,
  consecutiveLossLimit: 3,
  dailyLossLimitPct: 0.06,
  atrLookback: 20,
};

/**
 * 차단 조건 · 트리거 · 점수를 합쳐 최종 진입 판정을 낸다 (ADR-025).
 *
 * 판정 순서가 곧 구조다:
 *
 * 1. **0단계 차단** — 데이터 부족 · 이상 변동성 · 연속 손실 · 일일 손실 ·
 *    지표 발표 블랙아웃 · BB 폭(수수료 타당성) · 세션 · 펀딩 극단값.
 *    하나라도 걸리면 나머지를 보지 않는다.
 * 2. **1단계 트리거** — EMA12 × BB중앙선 교차 + 가격 위치. 없으면 끝이다.
 * 3. **2단계 점수** — 3점 만점. 현재는 **기록만 한다.** 점수가 낮다고
 *    진입을 막지도(minScoreToEnter=0), 포지션을 줄이지도(scoreDrivesSizing=false)
 *    않는다.
 *
 * 점수를 진입·사이징에서 떼어낸 것이 이번 변경의 핵심이다. 점수 구간별
 * 평균 R이 단조 증가한다는 증거가 나오기 전에는, 점수로 크기를 바꾸는 것이
 * 근거 없이 분산만 키운다.
 */
export function evaluateEntry(
  ctx: SignalContext,
  guard: GuardState,
  config?: Partial<EntryConfig>,
): Signal {
  const cfg = { ...DEFAULT_ENTRY_CONFIG, ...config };
  const {
    direction,
    trigger,
    items,
    gates,
    indicators,
    snapshots,
    setup,
    bandState,
    crossCount,
  } = scoreSignal(ctx, cfg);

  const blockers: string[] = [];

  if (ctx.blackout === true) {
    blockers.push('지표 발표 블랙아웃');
  }

  if (indicators === null) {
    // 데이터가 없으면 게이트도 트리거도 판정할 수 없다. 판정 불가를
    // 여러 사유로 쪼개 적으면 무엇이 진짜 문제인지 흐려진다.
    blockers.push('데이터 부족');
  } else {
    // 이상 변동성 — 최근 ATR 평균 대비 급등하면 5분봉 전략의 전제가 깨진다.
    const lastIndex = snapshots.length - 1;
    const history: number[] = [];
    for (let i = lastIndex - cfg.atrLookback; i < lastIndex; i++) {
      const s = i >= 0 ? snapshots[i] : null;
      if (s !== null) history.push(s.atr14);
    }
    if (history.length > 0) {
      const avg = history.reduce((a, b) => a + b, 0) / history.length;
      if (avg > 0 && indicators.atr14 > avg * cfg.atrSpikeMultiple) {
        blockers.push('이상 변동성');
      }
    }

    // 0단계 게이트 — 점수가 아니라 통과/불통과다.
    for (const gate of gates) {
      if (!gate.passed) blockers.push(gate.blocker);
    }
  }

  if (guard.consecutiveLosses >= cfg.consecutiveLossLimit) {
    blockers.push('연속 손실 한도');
  }

  if (guard.dailyPnlPct <= -cfg.dailyLossLimitPct) {
    blockers.push('일일 손실 한도');
  }

  // 1단계 트리거. 왜 진입하지 않는지가 이 화면의 핵심 정보라 사유를 구분한다 —
  // "교차가 없다"와 "교차는 났지만 추격 자리라 들어가지 않는다"는 다르다.
  if (!trigger.passed && trigger.blocker !== null) {
    if (!blockers.includes(trigger.blocker)) blockers.push(trigger.blocker);
  }

  const score = items.filter((i) => i.passed).length;

  let conviction: Conviction = 'none';
  if (blockers.length === 0 && direction !== null && score >= cfg.minScoreToEnter) {
    if (cfg.scoreDrivesSizing) {
      if (score >= cfg.highConvictionScore) conviction = 'high';
      else if (score >= cfg.mediumConvictionScore) conviction = 'medium';
    } else {
      conviction = cfg.uniformConviction;
    }
  }

  return {
    direction,
    conviction,
    score,
    items,
    trigger,
    gates,
    blockers,
    indicators,
    setup,
    bandState,
    crossCount,
  };
}
