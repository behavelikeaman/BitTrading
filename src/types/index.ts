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
