/**
 * 타임프레임 정의.
 *
 * 전략은 "기준 봉 + 한 단계 위 봉"으로 돌아간다. 5분봉을 고르면 상위는
 * 15분봉, 15분봉을 고르면 상위는 1시간봉이다. 거래소마다 표기가 달라
 * (Deepcoin은 1H, Binance는 1h) 여기서 한 번에 매핑한다.
 */
export type Timeframe = '5m' | '15m';

/** 이 프로젝트가 다루는 봉 길이 전체 (기준봉 + 상위봉) */
export type BarInterval = '5m' | '15m' | '1h';

export interface TimeframeSpec {
  primary: Timeframe;
  /** 상위 프레임 정렬 판정에 쓰는 봉 */
  higher: '15m' | '1h';
  /** 기준 봉 길이 (ms) */
  barMs: number;
  /** 상위 봉 길이 (ms) */
  higherMs: number;
  /** Deepcoin `bar` 파라미터 — 1시간 이상은 대문자다 */
  deepcoinBar: string;
  deepcoinHigherBar: string;
  /** Binance `interval` 파라미터 — 전부 소문자 */
  binanceInterval: BarInterval;
  binanceHigherInterval: BarInterval;
  /** 타임아웃 기본값. 두 프레임 모두 약 3시간이 되도록 맞춘다. */
  defaultMaxHoldBars: number;
  /** 화면 표시용 */
  label: string;
}

const MS_MIN = 60_000;

const SPECS: Record<Timeframe, TimeframeSpec> = {
  '5m': {
    primary: '5m',
    higher: '15m',
    barMs: 5 * MS_MIN,
    higherMs: 15 * MS_MIN,
    deepcoinBar: '5m',
    deepcoinHigherBar: '15m',
    binanceInterval: '5m',
    binanceHigherInterval: '15m',
    defaultMaxHoldBars: 36,
    label: '5분봉',
  },
  '15m': {
    primary: '15m',
    higher: '1h',
    barMs: 15 * MS_MIN,
    higherMs: 60 * MS_MIN,
    deepcoinBar: '15m',
    deepcoinHigherBar: '1H',
    binanceInterval: '15m',
    binanceHigherInterval: '1h',
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
