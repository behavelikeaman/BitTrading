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
