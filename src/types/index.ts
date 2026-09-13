import type { SetupKind, SetupResult } from '@/lib/signal/setup';
import type { BandState, BandStateResult } from '@/lib/signal/band-state';

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

/**
 * 점수 항목 (2단계). 3개뿐이다 (ADR-025).
 *
 * "이 자리가 좋은가"를 세는 항목만 남겼다. "거래를 해도 되는 환경인가"는
 * 통과/불통과일 뿐 점수가 아니므로 차단 조건(GateKey)으로 옮겼고, 필수
 * 트리거는 없으면 어차피 진입이 없으므로 점수에서 뺐다.
 */
export type ScoreKey = 'stackAlignment' | 'stackSpread' | 'volume';

/**
 * 차단 게이트 (0단계). 점수가 아니라 통과/불통과다.
 *
 * 세션이 좋다고 나쁜 자리가 좋은 자리가 되지 않는다. 이것들에 점수를 주면
 * 거의 항상 통과하는 항목이 모든 점수를 같이 밀어올려 확신 문턱을 왜곡한다.
 */
export type GateKey = 'bandWidth' | 'session' | 'funding';

/** 컨플루언스 항목 하나. 실패해도 목록에서 빼지 않는다 — 왜 진입 못 하는지가 핵심 정보다. */
export interface ScoreItem {
  key: ScoreKey;
  /** 화면 표시용 한국어 라벨 */
  label: string;
  passed: boolean;
  /** 왜 통과/실패했는지 한 줄 (예: "정배열 (20>55>95>135)") */
  detail: string;
}

/**
 * 트리거 판정 (1단계).
 *
 * 교차와 가격 위치를 한 덩어리로 본다. 둘을 따로 점수로 세면 같은 사건을
 * 두 번 세는 셈이라, 트리거가 완성됐다는 사실만으로 점수가 2점 올랐다.
 */
export interface TriggerState {
  passed: boolean;
  /** 트리거 자체의 방향. 셋업이 진입을 막아도 남는다. */
  cross: Direction | null;
  /** 셋업이 요구한 자리를 종가가 실제로 만들었는가 */
  positionConfirmed: boolean;
  /** 화면 표시용 한 줄 */
  detail: string;
  /** 통과하지 못한 이유. 그대로 blockers에 들어간다. 통과했으면 null */
  blocker: string | null;
}

/** 차단 게이트 하나. 실패하면 그 문구가 그대로 blockers에 들어간다. */
export interface GateItem {
  key: GateKey;
  /** 화면 표시용 한국어 라벨 */
  label: string;
  passed: boolean;
  detail: string;
  /** 실패 시 blockers에 실릴 문구 */
  blocker: string;
}

export interface SignalContext {
  /**
   * 판정에 쓰는 기준 봉. 오름차순이며 미확정봉은 판정에서 제외된다 (ADR-006).
   *
   * 프레임은 하나뿐이다. 상위 프레임 캔들은 어떤 규칙도 읽지 않게 되어
   * 경로째로 걷어냈다 — SMMA135가 이미 상위 프레임 정보 그 자체다
   * (ADR-025, ADR-026).
   */
  candles: Candle[];
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
  /**
   * 통과한 점수 항목 수 (0~3).
   *
   * **아직 포지션 크기를 바꾸지 않는다.** 점수가 결과를 예측한다는 증거가
   * 없으므로 당분간 기록만 하고, 점수별 평균 R이 단조 증가할 때 사이징에
   * 연결한다 (ADR-025).
   */
  score: number;
  /** 점수 항목 3개 전부. 실패 항목도 이유와 함께 남긴다. */
  items: ScoreItem[];
  /**
   * 1단계 트리거. 없으면 점수와 무관하게 진입이 없다.
   *
   * 교차와 가격 위치를 함께 본다 — "교차했고, 셋업 조건대로 종가가 실제로
   * 그 자리를 만들었는가"가 트리거의 정의다 (ADR-025).
   */
  trigger: TriggerState;
  /** 0단계 차단 게이트 판정 전체. 실패한 것은 blockers에도 들어간다. */
  gates: GateItem[];
  /** 무효 필터에 걸린 사유. 비어 있어야 진입 가능. */
  blockers: string[];
  indicators: IndicatorSnapshot | null;
  /** 어떤 자리인지 — 눌림목·과이격 되돌림·밴드 돌파 (ADR-022) */
  setup: SetupResult;
  /** 신호봉의 밴드 폭 상태 (좁은 관 / 재확장 / 확장 지속 / 수축) */
  bandState: BandStateResult;
  /** 최근 12봉 안의 EMA12 × BB중앙선 교차 횟수. 클수록 휩소 구간이다. */
  crossCount: number;
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
  /**
   * 신호봉의 밴드 폭 상태. 성적을 이 상태로 쪼개기 위해 끝까지 들고 간다.
   *
   * 사용자의 관찰("좁은 관 다음의 재확장에 올라탄 교차가 수익이었다")이
   * 데이터에 있는지 재기 위한 진단 값이다. 아직 진입 조건이 아니다.
   */
  bandState: BandState;
  /** 신호봉 기준 최근 12봉 안의 교차 횟수. 3회 이상이면 휩소 구간이다. */
  crossCount: number;
  /**
   * 진입 시점에 계획한 손실 (USDT, 체결비용 포함). R의 분모다.
   *
   * 이게 없으면 트레이드를 R로 환산할 수 없다. USDT 손익만으로는 자본이
   * 복리로 변하는 구간끼리 비교가 안 되고, 점수별 평균 R도 낼 수 없다
   * (ADR-025).
   */
  plannedRisk: number;
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
  | 'trades'
  | 'signalCount'
  | 'fillRate'
  | 'bySetup'
  | 'byBandState'
  | 'byCrossCount'
  | 'byScore'
  | 'haltedBars'
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
  /** 이긴 트레이드의 평균 순이익 (USDT). 승이 없으면 0 */
  averageWin: number;
  /** 진 트레이드의 평균 순손실 (USDT, 양수). 패가 없으면 0 */
  averageLoss: number;
  /**
   * 실측 손익비 = 평균 승 / 평균 패.
   *
   * 목표 R배수(이론 손익비)와 다른 숫자다. 이론값은 전량 체결 뒤 목표에
   * 닿는 경우만 세지만, 실제로는 이기는 거래가 1차 진입만으로 익절되고
   * 지는 거래는 물타기까지 체결된 뒤 손절난다. 잴 수 없으면 null.
   */
  payoffRatio: number | null;
  /**
   * 실측 손익비로 역산한 필요 승률 = 1 / (1 + payoffRatio).
   *
   * 실제 승률이 이 값과 같으면 기대값이 정확히 0이다. 이론 손익분기 승률은
   * 체결 가정이 들어가 실전보다 15~20%p 낙관적이었다 — 이쪽이 진짜 숫자다.
   */
  requiredWinRate: number | null;
  /** 트레이드당 평균 순손익 (USDT) */
  expectancy: number;
  /**
   * 트레이드당 평균 R (순손익 / 진입 시점 계획 손실).
   *
   * USDT 기대값은 자본이 복리로 변하면 구간끼리 비교가 안 되고, 리스크
   * 예산이 다른 트레이드를 같은 저울에 올린다. R은 그 둘을 정규화한다.
   * 계획 손실이 0인 트레이드뿐이면 null이다.
   */
  averageR: number | null;
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
  /**
   * 밴드 폭 상태별 성적 (진단용).
   *
   * "좁은 관 다음의 재확장에 올라탄 교차가 수익이었고, 관 안의 교차는
   * 노이즈였다"는 관찰이 데이터에 있는지 재기 위한 표다. 아직 진입 조건이
   * 아니다 — 필터를 먼저 걸면 표본이 무너져 우연과 구분되지 않는다.
   */
  byBandState: Partial<Record<BandState, TradeMetricsSummary>>;
  /** 신호봉 기준 최근 교차 횟수별 성적. 클수록 휩소 구간의 교차다. */
  byCrossCount: Partial<Record<string, TradeMetricsSummary>>;
  /**
   * 점수(0~3)별 성적. **채점 체계가 작동하는지를 가르는 표다** (ADR-025).
   *
   * 점수가 올라갈수록 평균 R이 단조 증가하면 그때 사이징에 연결한다.
   * 들쭉날쭉하면 점수 체계를 폐기하고 트리거 + 차단 조건만 남긴다.
   * 구간이 4개뿐이라 구간당 30건, 총 120건이면 판정할 수 있다 — 10항목
   * 시절의 11개 구간(330건 이상, 조합 1,024가지)은 애초에 측정이 불가능했다.
   */
  byScore: Partial<Record<string, TradeMetricsSummary>>;
  /**
   * 서킷브레이커(연속 손실·일일 손실 한도)로 진입 판정이 막힌 캔들 수.
   *
   * 이 값이 크면 백테스트가 실제로는 기간의 일부만 검증한 것이다. 보고하지
   * 않으면 "신호가 없었다"와 "막혀서 못 봤다"가 구분되지 않는다.
   */
  haltedBars: number;
}
