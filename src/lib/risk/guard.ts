import type { GuardState } from '@/types';

export interface GuardConfig {
  consecutiveLossLimit: number;
  dailyLossLimitPct: number;
}

export const INITIAL_GUARD: GuardState = {
  consecutiveLosses: 0,
  dailyPnlPct: 0,
};

/**
 * 트레이드 결과를 반영해 서킷브레이커 상태를 갱신한다.
 *
 * tradePnlPct는 자본 대비 손익률이다 (-0.02 = -2%).
 * 이익이 한 번 나면 연속 손실 카운터는 초기화된다.
 */
export function updateGuard(prev: GuardState, tradePnlPct: number): GuardState {
  return {
    consecutiveLosses: tradePnlPct < 0 ? prev.consecutiveLosses + 1 : 0,
    dailyPnlPct: prev.dailyPnlPct + tradePnlPct,
  };
}

/** 하루가 바뀔 때 일손익만 초기화한다. 연속 손실은 날짜와 무관하게 이어진다. */
export function resetDaily(guard: GuardState): GuardState {
  return { ...guard, dailyPnlPct: 0 };
}

/**
 * 매매를 멈춰야 하는지 판정한다.
 *
 * 연속 손실은 전략이 현재 레짐과 맞지 않는다는 신호이고, 일일 손실 한도는
 * 하루에 잃을 수 있는 최대치를 고정한다. 50배에서 이 둘이 없으면 나쁜 하루가
 * 계좌를 지운다.
 */
export function isHalted(
  guard: GuardState,
  config: GuardConfig,
): { halted: boolean; reason: string | null } {
  if (guard.consecutiveLosses >= config.consecutiveLossLimit) {
    return {
      halted: true,
      reason: `연속 ${guard.consecutiveLosses}회 손실 (한도 ${config.consecutiveLossLimit})`,
    };
  }
  if (guard.dailyPnlPct <= -config.dailyLossLimitPct) {
    return {
      halted: true,
      reason: `일일 손실 ${(guard.dailyPnlPct * 100).toFixed(1)}% (한도 -${(config.dailyLossLimitPct * 100).toFixed(1)}%)`,
    };
  }
  return { halted: false, reason: null };
}
