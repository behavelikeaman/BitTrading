import type { SetupKind, SetupResult } from '@/lib/signal/setup';

/** 확정 여부를 포함한 OHLCV 캔들. 배열은 항상 오름차순(과거 -> 최근)이다. */
export interface Candle {
  /** ms epoch, 캔들 시작 시각 */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 확정봉 여부 (ADR-006). 미확정봉으로 시그널을 판정하면 리페인팅이 발생한다. */
  closed: boolean;
}

export type Direction = 'long' | 'short';

/**
 * 사용자 차트의 이평선 스택 (SMMA 20·55·95·135).
 *
 * 화면의 빨강·파랑·흰색·노랑 선과 같은 값이어야 한다. 배열(정/역)과
 * 이격도 판정의 기준선이며, 과이격 되돌림 셋업의 목표가(스택 하단)도
 * 여기서 나온다.
 */
export interface MaStack {
  /** 빨강 — 가장 빠른 선 */
  smma20: number;
  /** 파랑 */
  smma55: number;
  /** 흰색 */
  smma95: number;
  /** 노랑 — 가장 느린 선. 정배열에서 스택 하단이다. */
  smma135: number;
}

/** 한 캔들 시점의 지표 묶음. 워밍업이 끝나지 않은 구간에서는 null이 된다. */
export interface IndicatorSnapshot {
  ema12: number;
  /** 볼린저 중심선과 동일한 값 */
  sma20: number;
  bbUpper: number;
  bbLower: number;
  /** (upper - lower) / middle — 가격 수준에 무관하게 비교하기 위한 정규화 */
  bbWidth: number;
  atr14: number;
  adx14: number;
  volumeSma20: number;
  /**
   * 이평선 스택. SMMA135가 확정되기 전(135봉 미만)에는 null이다.
   *
   * 스냅샷 전체를 null로 만들지 않는 이유는, 나머지 지표만으로도 화면에
   * 현재 상태를 보여줄 수 있기 때문이다. 다만 셋업 분류는 스택이 있어야
   * 가능하므로 null이면 진입 판정이 나지 않는다.
   */
  stack: MaStack | null;
}

/** 확신도 등급. 리스크 예산을 결정한다 (ADR-009). */
export type Conviction = 'high' | 'medium' | 'none';

export type ScoreKey =
  | 'bbPosition'
  | 'emaCross'
  | 'stackAlignment'
  | 'stackSpread'
  | 'bandExpansion'
  | 'volume'
  | 'higherTimeframe'
  | 'trendStrength'
  | 'funding'
  | 'session';

/** 컨플루언스 항목 하나. 실패해도 목록에서 빼지 않는다 — 왜 진입 못 하는지가 핵심 정보다. */
export interface ScoreItem {
  key: ScoreKey;
  /** 화면 표시용 한국어 라벨 */
  label: string;
  passed: boolean;
  /** 왜 통과/실패했는지 한 줄 (예: "ADX 24.1 >= 20") */
  detail: string;
}

export interface SignalContext {
  /** 오름차순. 미확정봉이 섞여 있어도 판정에서 제외된다 (ADR-006). */
  candles5m: Candle[];
  /** 상위 프레임 정렬 판정용 */
  candles15m: Candle[];
  /** 현재 펀딩비 (0.0001 = 0.01%) */
  fundingRate: number;
  /** 세션 판정 기준 시각. src/lib/은 Date.now()를 쓰지 않고 주입받는다. */
  nowMs: number;
  /** 지표 발표 등 사용자가 켜는 수동 무효 스위치 */
  blackout?: boolean;
}

export interface Signal {
  direction: Direction | null;
  conviction: Conviction;
  /** 통과한 항목 수 (0~10) */
  score: number;
  /** 10개 전부. 실패 항목도 이유와 함께 남긴다. */
  items: ScoreItem[];
  /** 무효 필터에 걸린 사유. 비어 있어야 진입 가능. */
  blockers: string[];
  indicators: IndicatorSnapshot | null;
  /** 어떤 자리인지 — 눌림목·과이격 되돌림·밴드 돌파 (ADR-022) */
  setup: SetupResult;
}

/** 서킷브레이커 상태. 백테스트에도 그대로 반영된다. */
export interface GuardState {
  consecutiveLosses: number;
  /** 당일 누적 손익률 (-0.03 = -3%) */
  dailyPnlPct: number;
}

/**
 * 계좌·전략 설정.
 *
 * 목표는 증거금 대비 %가 아니라 손절폭의 배수(targetRMultiple)로 정의한다.
 * 증거금 대비 %는 레버리지 종속값이라, 레버리지를 바꾸는 순간 같은 이름의
 * 목표가 완전히 다른 전략이 된다 (ADR-013).
 */
export interface AccountConfig {
  /** 총자본 (USDT) */
  equity: number;
  /** 기본 50 */
  leverage: number;
  /** 명목가 대비 편도 수수료. 기본 0.0004 (0.04%) */
  feeRatePerSide: number;
  /** 명목가 대비 편도 슬리피지. 시장가 매매 전제 (ADR-014). 기본 0.0002 */
  slippageRatePerSide: number;
  /** 유지증거금률. 기본 0.005 */
  maintenanceMarginRate: number;
  /** 확신 시 리스크 예산 비율. 기본 0.02 */
  riskPctHigh: number;
  /** 약간의 확신. 기본 0.01 */
  riskPctMedium: number;
  /** 손절폭 = ATR × 이 배수. 기본 1.2 */
  atrStopMultiple: number;
  /** 목표 = 손절폭 × 이 배수. 기본 1.38 (ADR-013) */
  targetRMultiple: number;
  /** 수수료·슬리피지가 실측인지 추정인지 (ADR-012, ADR-014) */
  costSource: 'measured' | 'default';
}

export interface LadderLeg {
  /** 0 = 1차 진입 */
  index: number;
  price: number;
  /** BTC 수량 */
  qty: number;
  notional: number;
  margin: number;
}

export interface PositionPlan {
  direction: Direction;
  conviction: Conviction;
  /** 물타기 포함 전량. 진입 전에 확정된다. */
  legs: LadderLeg[];
  /** 래더 전체 공통 손절가 */
  stopPrice: number;
  /** 평단 기준 목표가 */
  takeProfitPrice: number;
  /** 평단 + 체결비용 회수 가격 (물타기 탈출 목표) */
  breakEvenPrice: number;
  /** 전량 체결 가정 평단 */
  averageEntryPrice: number;
  totalNotional: number;
  totalMargin: number;
  /** 전량 체결 가정 청산가 */
  liquidationPrice: number;
  /** 손절 도달 시 예상 손실 (USDT, 체결비용 포함) */
  riskBudget: number;
  /** 목표 도달 시 예상 순이익 (USDT) */
  rewardAtTarget: number;
  /** 이 손익비의 손익분기 승률 */
  breakEvenWinRate: number;
  /**
   * 이 계획으로 진입해도 되는가.
   *
   * 청산가가 손절가보다 가까우면 손절이 영영 체결될 수 없고, 실제 손실은
   * riskBudget이 아니라 증거금 전액이 된다. 그 상태의 수치를 주문 티켓에
   * 띄우면 사용자가 틀린 숫자를 보고 주문한다. 그래서 차단한다 (ADR-008).
   */
  tradable: boolean;
  /** 현재 레버리지 기준 증거금 대비 순수익 환산값 (표시용, ADR-013) */
  targetNetReturnOnMargin: number;
  warnings: string[];
}

export type ExitReason =
  | 'take-profit'
  | 'stop-loss'
  | 'liquidation'
  | 'timeout'
  | 'end-of-data';

export interface Trade {
  entryTime: number;
  exitTime: number;
  direction: Direction;
  conviction: Conviction;
  score: number;
  /** 실제 체결된 레그만. 닿지 않은 물타기 레그는 들어가지 않는다. */
  legs: LadderLeg[];
  averageEntryPrice: number;
  exitPrice: number;
  exitReason: ExitReason;
  /** 어떤 셋업에서 들어간 트레이드인지 (ADR-022). 셋업별 성적 비교에 쓴다. */
  setup: SetupKind;
  /** 수수료·슬리피지·펀딩 차감 전 가격 손익 */
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  /** 진입 시점 자본 대비 */
  netPnlPct: number;
}

/** 셋업별 요약. BacktestResult에서 트레이드 목록·신호수를 뺀 지표만 */
export type TradeMetricsSummary = Omit<
  BacktestResult,
  'trades' | 'signalCount' | 'fillRate' | 'bySetup'
>;

export interface BacktestResult {
  trades: Trade[];
  totalTrades: number;
  winRate: number;
  /**
   * 총이익 / |총손실|. 손실 트레이드가 하나도 없으면 null이다.
   *
   * Infinity를 쓰면 JSON 직렬화에서 조용히 null이 되어 화면에 "—"로
   * 표시된다. 무한대인지 값이 없는 것인지 구분되지 않으므로 명시적으로
   * null을 쓰고 화면에서 ∞로 그린다.
   */
  profitFactor: number | null;
  /** 트레이드당 평균 순손익 (USDT) */
  expectancy: number;
  /** 자본 대비 최대 낙폭 비율 */
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  totalFees: number;
  totalFunding: number;
  finalEquity: number;
  liquidationCount: number;
  /** 진입 신호가 난 횟수 */
  signalCount: number;
  /** signalCount 대비 실제 체결 비율. 지정가 진입의 역선택 크기 (ADR-015) */
  fillRate: number;
  equityCurve: { time: number; equity: number }[];
  /**
   * 셋업별 성적 (ADR-022).
   *
   * 전체 평균은 서로 다른 자리를 섞는다. 어느 자리가 실제로 돈을 벌어주는지는
   * 여기서만 보인다. 트레이드가 없는 셋업은 키 자체가 없다.
   */
  bySetup: Partial<Record<SetupKind, TradeMetricsSummary>>;
}
