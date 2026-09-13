/**
 * 타임프레임 정의.
 *
 * 전략은 **기준 봉 하나**로 돌아간다. 상위 프레임 봉은 어떤 판정도 읽지
 * 않게 되어 경로째로 걷어냈다 — SMMA135가 이미 상위 프레임 정보 그 자체다
 * (ADR-025, ADR-026).
 */
export type Timeframe = '5m' | '15m';

/** 이 프로젝트가 다루는 봉 길이 전체 */
export type BarInterval = Timeframe;

export interface TimeframeSpec {
  primary: Timeframe;
  /** 봉 길이 (ms) */
  barMs: number;
  /** Deepcoin `bar` 파라미터 */
  deepcoinBar: string;
  /** Binance `interval` 파라미터 */
  binanceInterval: BarInterval;
  /** 타임아웃 기본값. 두 프레임 모두 약 3시간이 되도록 맞춘다. */
  defaultMaxHoldBars: number;
  /** 화면 표시용 */
  label: string;
}

const MS_MIN = 60_000;

const SPECS: Record<Timeframe, TimeframeSpec> = {
  '5m': {
    primary: '5m',
    barMs: 5 * MS_MIN,
    deepcoinBar: '5m',
    binanceInterval: '5m',
    defaultMaxHoldBars: 36,
    label: '5분봉',
  },
  '15m': {
    primary: '15m',
    barMs: 15 * MS_MIN,
    deepcoinBar: '15m',
    binanceInterval: '15m',
    defaultMaxHoldBars: 12,
    label: '15분봉',
  },
};

export const TIMEFRAMES: Timeframe[] = ['5m', '15m'];

export function timeframeSpec(tf: Timeframe): TimeframeSpec {
  return SPECS[tf];
}

/** 문자열을 Timeframe으로 좁힌다. 알 수 없으면 기본값 5m. */
export function parseTimeframe(raw: string | null | undefined): Timeframe {
  return raw === '15m' ? '15m' : '5m';
}
