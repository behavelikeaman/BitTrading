import type {
  AccountConfig,
  Conviction,
  Direction,
  LadderLeg,
} from '@/types';
import type { LadderPlanInput } from '@/lib/risk/ladder';
import type { SetupKind } from '@/lib/signal/setup';

/**
 * 대기 중인 진입 주문.
 *
 * 배열 인덱스가 아니라 **시각**을 쓴다. 페이퍼 트레이더는 프로세스가
 * 재시작되면 인덱스의 의미를 잃기 때문이다 (ADR-016).
 */
export interface PendingOrder {
  direction: Direction;
  conviction: Conviction;
  score: number;
  /** 어떤 자리에서 난 신호인지. 셋업별 성적을 따로 재기 위해 끝까지 들고 간다. */
  setup: SetupKind;
  /** 체결 시도를 시작할 캔들의 openTime */
  fromTime: number;
  limitPrice: number;
  /** 지정가 만료 캔들의 openTime (포함) */
  expiresAtTime: number;
  /** 신호 시점 ATR. 체결 시점 사이징에 쓴다. */
  atrAtSignal: number;
}

/**
 * 보유 중인 포지션.
 *
 * JSON 직렬화 가능해야 한다. 페이퍼가 파일에 저장하고 복원하므로
 * 함수·Map·Set·Date 인스턴스를 필드에 두면 안 된다 (ADR-017).
 */
export interface OpenPosition {
  direction: Direction;
  conviction: Conviction;
  score: number;
  setup: SetupKind;
  entryTime: number;
  /** 체결된 레그 */
  filled: LadderLeg[];
  /** 아직 가격에 닿지 않은 물타기 레그 */
  pending: LadderLeg[];
  stopPrice: number;
  targetWidth: number;
  fees: number;
  funding: number;
  equityAtEntry: number;
  /** 마지막으로 펀딩을 부과한 8시간 경계 */
  lastFundingBoundary: number;
}

export interface ExecutionConfig {
  account: AccountConfig;
  /** 기준 봉 길이 (ms). 5분봉 300000, 15분봉 900000 */
  barMs: number;
  ladderHigh: LadderPlanInput;
  ladderMedium: LadderPlanInput;
  /** 시장가는 다음 캔들 시가 체결, 지정가는 되돌림 대기 (ADR-015) */
  entryType: 'market' | 'limit';
  /** 8시간당 펀딩비 */
  fundingRatePerInterval: number;
  /** 타임아웃 청산까지의 보유 캔들 수 */
  maxHoldBars: number;
  qtyStep: number;
  mmrTiers: { maxNotional: number; mmr: number }[] | null;
}
