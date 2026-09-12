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

/**
 * 하루가 바뀌면 서킷브레이커를 푼다 — 일손익과 **연속 손실 카운터 둘 다**.
 *
 * 연속 손실을 날짜와 무관하게 이어가면 백테스트·페이퍼에서는 한 번 걸린 뒤
 * 영영 안 풀린다. 실거래에서는 사람이 버튼을 눌러 초기화하지만 그 사람이
 * 없기 때문이다. 실제로 6개월 백테스트가 3일치만 돌고 나머지 전 구간에서
 * 진입이 막힌 채 조용히 끝났다.
 *
 * "3연패하면 그날은 쉬고 다음 날 다시 본다"가 이 장치가 모사하려던 행동이고,
 * 일자 초기화가 그것과 맞는다.
 */
export function resetDaily(): GuardState {
  return { consecutiveLosses: 0, dailyPnlPct: 0 };
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
