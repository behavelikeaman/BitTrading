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
}

/** 확신도 등급. 리스크 예산을 결정한다 (ADR-009). */
export type Conviction = 'high' | 'medium' | 'none';

export type ScoreKey =
  | 'bbPosition'
  | 'emaCross'
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
  /** 통과한 항목 수 (0~8) */
  score: number;
  /** 8개 전부. 실패 항목도 이유와 함께 남긴다. */
  items: ScoreItem[];
  /** 무효 필터에 걸린 사유. 비어 있어야 진입 가능. */
  blockers: string[];
  indicators: IndicatorSnapshot | null;
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
  /** 수수료·슬리피지·펀딩 차감 전 가격 손익 */
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  /** 진입 시점 자본 대비 */
  netPnlPct: number;
}

export interface BacktestResult {
  trades: Trade[];
  totalTrades: number;
  winRate: number;
  profitFactor: number;
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
}
