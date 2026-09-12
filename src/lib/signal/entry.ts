import type { Conviction, GuardState, Signal, SignalContext } from '@/types';
import type { SetupResult } from '@/lib/signal/setup';
import {
  DEFAULT_SCORE_CONFIG,
  scoreSignal,
  type ScoreConfig,
} from '@/lib/signal/score';

export interface EntryConfig extends ScoreConfig {
  /** 확신 등급 최소 점수 (10점 만점). 기본 7 */
  highConvictionScore: number;
  /** 약간의 확신 최소 점수 (10점 만점). 기본 5 */
  mediumConvictionScore: number;
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
  highConvictionScore: 7,
  mediumConvictionScore: 5,
  atrSpikeMultiple: 2.0,
  consecutiveLossLimit: 3,
  dailyLossLimitPct: 0.06,
  atrLookback: 20,
};

/**
 * 컨플루언스 점수와 무효 필터를 합쳐 최종 진입 판정을 낸다.
 *
 * blockers가 하나라도 있으면 점수와 무관하게 conviction은 'none'이다.
 * 점수가 8점이어도 지표 발표 블랙아웃이나 서킷브레이커가 걸려 있으면
 * 진입하지 않는다.
 */
export function evaluateEntry(
  ctx: SignalContext,
  guard: GuardState,
  config?: Partial<EntryConfig>,
): Signal {
  const cfg = { ...DEFAULT_ENTRY_CONFIG, ...config };
  const { direction, items, indicators, snapshots, setup, bandState, crossCount } =
    scoreSignal(ctx, cfg);

  const blockers: string[] = [];

  if (ctx.blackout === true) {
    blockers.push('지표 발표 블랙아웃');
  }

  if (indicators === null) {
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
  }

  if (guard.consecutiveLosses >= cfg.consecutiveLossLimit) {
    blockers.push('연속 손실 한도');
  }

  if (guard.dailyPnlPct <= -cfg.dailyLossLimitPct) {
    blockers.push('일일 손실 한도');
  }

  if (direction === null) {
    // 왜 진입하지 않는지가 이 화면의 핵심 정보다. "교차가 없다"와 "교차는
    // 났지만 추격 자리라 들어가지 않는다"는 전혀 다른 상황이다.
    blockers.push(blockerForSetup(setup));
  }

  const score = items.filter((i) => i.passed).length;

  let conviction: Conviction = 'none';
  if (blockers.length === 0) {
    if (score >= cfg.highConvictionScore) conviction = 'high';
    else if (score >= cfg.mediumConvictionScore) conviction = 'medium';
  }

  return {
    direction,
    conviction,
    score,
    items,
    blockers,
    indicators,
    setup,
    bandState,
    crossCount,
  };
}

/** 셋업이 진입을 내지 않은 이유를 한 줄로 */
function blockerForSetup(setup: SetupResult): string {
  if (setup.kind === 'overextended-chase') return '과이격 추격 자리';
  if (setup.cross === null) return '진입 트리거 없음';
  return '셋업 조건 미충족';
}
