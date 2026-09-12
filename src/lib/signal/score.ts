import type {
  Direction,
  IndicatorSnapshot,
  ScoreItem,
  SignalContext,
} from '@/types';
import { computeIndicators, ema } from '@/lib/indicators';

export interface ScoreConfig {
  /** 신호봉 거래량 / 20봉 평균 거래량의 하한. 기본 1.5 */
  volumeMultiple: number;
  /** 추세 강도 하한. 기본 20 */
  adxMin: number;
  /** 펀딩 과열 한계. 기본 0.0003 (0.03%) */
  fundingLimit: number;
  /** 세션 시작 UTC 시(포함). 기본 7 */
  sessionStartUtcHour: number;
  /** 세션 종료 UTC 시(제외). 기본 21 */
  sessionEndUtcHour: number;
  /** 밴드 확장 비교에 쓸 과거 bbWidth 개수. 기본 20 */
  bbWidthLookback: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  volumeMultiple: 1.5,
  adxMin: 20,
  fundingLimit: 0.0003,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 21,
  bbWidthLookback: 20,
};

/** 상위 프레임 기울기 판정에 쓰는 EMA 기간 */
const HTF_EMA_PERIOD = 50;

export interface ScoreResult {
  direction: Direction | null;
  items: ScoreItem[];
  indicators: IndicatorSnapshot | null;
  /** 지표 시계열. entry.ts가 변동성 이상치 판정에 쓴다. */
  snapshots: (IndicatorSnapshot | null)[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/**
 * 8개 컨플루언스 항목을 채점한다.
 *
 * emaCross가 필수 트리거다. 교차가 없으면 direction이 null이고, 방향에
 * 의존하는 항목(bbPosition, higherTimeframe, funding)은 "방향 미정"으로
 * 실패 처리된다. 나머지 항목은 그대로 채점해 화면에 현재 상태를 보여준다.
 *
 * 확정봉만 사용한다 (ADR-006).
 */
export function scoreSignal(
  ctx: SignalContext,
  config?: Partial<ScoreConfig>,
): ScoreResult {
  const cfg = { ...DEFAULT_SCORE_CONFIG, ...config };
  const closed5m = ctx.candles5m.filter((c) => c.closed);
  const closed15m = ctx.candles15m.filter((c) => c.closed);

  const snapshots = computeIndicators(closed5m);
  const lastIndex = snapshots.length - 1;
  const indicators = lastIndex >= 0 ? snapshots[lastIndex] : null;
  const prev = lastIndex >= 1 ? snapshots[lastIndex - 1] : null;
  const lastCandle = lastIndex >= 0 ? closed5m[lastIndex] : null;

  const items: ScoreItem[] = [];
  const push = (
    key: ScoreItem['key'],
    label: string,
    passed: boolean,
    detail: string,
  ) => {
    items.push({ key, label, passed, detail });
  };

  // 1. emaCross — 필수 트리거. 방향을 결정한다.
  let direction: Direction | null = null;
  if (indicators === null || prev === null) {
    push('emaCross', 'EMA12 × SMA20 교차', false, '데이터 부족');
  } else {
    const prevDiff = prev.ema12 - prev.sma20;
    const currDiff = indicators.ema12 - indicators.sma20;
    if (prevDiff <= 0 && currDiff > 0) direction = 'long';
    else if (prevDiff >= 0 && currDiff < 0) direction = 'short';

    push(
      'emaCross',
      'EMA12 × SMA20 교차',
      direction !== null,
      direction !== null
        ? `${direction === 'long' ? '상향' : '하향'} 교차 (이전 ${fmt(prevDiff)} → 현재 ${fmt(currDiff)})`
        : `교차 없음 (이전 ${fmt(prevDiff)} → 현재 ${fmt(currDiff)})`,
    );
  }

  // 2. bbPosition — 방향 의존
  if (indicators === null || lastCandle === null) {
    push('bbPosition', 'BB 위치', false, '데이터 부족');
  } else if (direction === null) {
    push('bbPosition', 'BB 위치', false, '방향 미정');
  } else {
    const close = lastCandle.close;
    const passed =
      direction === 'long' ? close > indicators.bbUpper : close < indicators.bbLower;
    push(
      'bbPosition',
      'BB 위치',
      passed,
      direction === 'long'
        ? `종가 ${fmt(close)} vs 상단 ${fmt(indicators.bbUpper)}`
        : `종가 ${fmt(close)} vs 하단 ${fmt(indicators.bbLower)}`,
    );
  }

  // 3. bandExpansion — 스퀴즈 구간 진입 차단
  const widthHistory: number[] = [];
  for (let i = lastIndex - cfg.bbWidthLookback; i < lastIndex; i++) {
    const s = i >= 0 ? snapshots[i] : null;
    if (s !== null) widthHistory.push(s.bbWidth);
  }
  if (indicators === null || widthHistory.length === 0) {
    push('bandExpansion', 'BB 폭 확장', false, '데이터 부족');
  } else {
    const med = median(widthHistory);
    push(
      'bandExpansion',
      'BB 폭 확장',
      indicators.bbWidth > med,
      `현재 ${fmt(indicators.bbWidth * 100, 3)}% vs 최근 중앙값 ${fmt(med * 100, 3)}%`,
    );
  }

  // 4. volume
  if (indicators === null || lastCandle === null) {
    push('volume', '거래량', false, '데이터 부족');
  } else {
    const threshold = indicators.volumeSma20 * cfg.volumeMultiple;
    push(
      'volume',
      '거래량',
      lastCandle.volume >= threshold,
      `${fmt(lastCandle.volume, 0)} vs 기준 ${fmt(threshold, 0)} (평균×${cfg.volumeMultiple})`,
    );
  }

  // 5. higherTimeframe — 방향 의존
  const htfCloses = closed15m.map((c) => c.close);
  const htfEma = ema(htfCloses, HTF_EMA_PERIOD);
  const htfLast = htfEma[htfEma.length - 1] ?? null;
  const htfPrev = htfEma.length >= 2 ? htfEma[htfEma.length - 2] : null;
  if (htfLast === null || htfPrev === null) {
    push('higherTimeframe', '상위 프레임 정렬', false, '15분봉 데이터 부족');
  } else if (direction === null) {
    push('higherTimeframe', '상위 프레임 정렬', false, '방향 미정');
  } else {
    const slope = htfLast - htfPrev;
    const passed = direction === 'long' ? slope > 0 : slope < 0;
    push(
      'higherTimeframe',
      '상위 프레임 정렬',
      passed,
      `15분 EMA50 기울기 ${slope > 0 ? '+' : ''}${fmt(slope, 3)}`,
    );
  }

  // 6. trendStrength
  if (indicators === null) {
    push('trendStrength', '추세 강도', false, '데이터 부족');
  } else {
    push(
      'trendStrength',
      '추세 강도',
      indicators.adx14 >= cfg.adxMin,
      `ADX ${fmt(indicators.adx14)} vs 하한 ${cfg.adxMin}`,
    );
  }

  // 7. funding — 방향 의존. 과열된 쪽으로 따라 들어가는 것을 막는다.
  if (direction === null) {
    push('funding', '펀딩비', false, '방향 미정');
  } else {
    const passed =
      direction === 'long'
        ? ctx.fundingRate < cfg.fundingLimit
        : ctx.fundingRate > -cfg.fundingLimit;
    push(
      'funding',
      '펀딩비',
      passed,
      `${fmt(ctx.fundingRate * 100, 4)}% vs 한계 ${direction === 'long' ? '' : '-'}${fmt(cfg.fundingLimit * 100, 4)}%`,
    );
  }

  // 8. session
  const hour = new Date(ctx.nowMs).getUTCHours();
  push(
    'session',
    '세션',
    hour >= cfg.sessionStartUtcHour && hour < cfg.sessionEndUtcHour,
    `UTC ${hour}시 vs ${cfg.sessionStartUtcHour}~${cfg.sessionEndUtcHour}시`,
  );

  return { direction, items, indicators, snapshots };
}
