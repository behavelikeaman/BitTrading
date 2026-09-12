import type {
  Direction,
  IndicatorSnapshot,
  ScoreItem,
  SignalContext,
} from '@/types';
import { computeIndicators, ema } from '@/lib/indicators';
import {
  classifySetup,
  DEFAULT_SETUP_CONFIG,
  type SetupConfig,
  type SetupResult,
} from '@/lib/signal/setup';
import {
  classifyBandState,
  countRecentCrosses,
  DEFAULT_BAND_STATE_CONFIG,
  type BandStateConfig,
  type BandStateResult,
} from '@/lib/signal/band-state';

export interface ScoreConfig extends SetupConfig, BandStateConfig {
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
  /** 교차 노이즈를 셀 구간. 기본 12봉 */
  crossLookback: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  ...DEFAULT_SETUP_CONFIG,
  ...DEFAULT_BAND_STATE_CONFIG,
  crossLookback: 12,
  volumeMultiple: 1.5,
  adxMin: 20,
  fundingLimit: 0.0003,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 21,
  bbWidthLookback: 20,
};

/** 상위 프레임 기울기 판정에 쓰는 EMA 기간 */
const HTF_EMA_PERIOD = 50;

/** 채점 항목 수. 화면과 확신도 임계값이 이 값을 기준으로 한다. */
export const SCORE_ITEM_COUNT = 10;

export interface ScoreResult {
  direction: Direction | null;
  items: ScoreItem[];
  indicators: IndicatorSnapshot | null;
  /** 지표 시계열. entry.ts가 변동성 이상치 판정에 쓴다. */
  snapshots: (IndicatorSnapshot | null)[];
  /** 어떤 셋업인지. 같은 교차라도 배열·이격에 따라 의미가 다르다. */
  setup: SetupResult;
  /**
   * 밴드 폭 상태와 최근 교차 횟수.
   *
   * 아직 채점에 반영하지 않는다. 트레이드에 기록해 성적을 쪼개 보고,
   * 데이터가 경험칙을 뒷받침할 때만 조건으로 승격한다.
   */
  bandState: BandStateResult;
  /** 최근 crossLookback봉 안의 EMA12 × BB중앙선 교차 횟수 */
  crossCount: number;
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
 * 10개 컨플루언스 항목을 **셋업 종류에 맞춰** 채점한다.
 *
 * 핵심은 같은 항목이라도 셋업마다 통과 조건이 다르다는 점이다. 예를 들어
 * 가격 위치는 밴드 돌파 셋업에서 "밴드 밖"을 요구하지만, 과이격 되돌림에서는
 * "중앙선을 반대로 이탈"을 요구한다. 하나의 조건으로 전부 재면, 실제로
 * 수익이 난 되돌림·눌림목 셋업이 구조적으로 감점당한다 (ADR-022).
 *
 * emaCross가 여전히 필수 트리거지만, 방향은 교차가 아니라 셋업이 정한다.
 * 정배열에서 하향 교차가 나면 교차 방향은 숏이고 셋업도 숏이지만, 이격이
 * 벌어지지 않았다면 셋업은 진입을 내지 않는다.
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
  const lastCandle = lastIndex >= 0 ? closed5m[lastIndex] : null;

  const setup = classifySetup(snapshots, lastIndex, cfg);
  const direction = setup.direction;

  const items: ScoreItem[] = [];
  const push = (
    key: ScoreItem['key'],
    label: string,
    passed: boolean,
    detail: string,
  ) => {
    items.push({ key, label, passed, detail });
  };

  // 1. emaCross — 필수 트리거
  push(
    'emaCross',
    'EMA12 × BB중앙선 교차',
    setup.cross !== null,
    setup.cross !== null
      ? `${setup.cross === 'long' ? '상향' : '하향'} 교차`
      : setup.detail,
  );

  // 2. stackAlignment — 이평선이 줄을 섰는가 (SMMA 20·55·95·135)
  // 스택이 아직 없으면 "혼조"가 아니라 "모름"이다. 같은 문구로 보여주면
  // 워밍업 중인 화면을 보고 추세가 없다고 읽게 된다.
  const alignText = !setup.stackReady
    ? '이평선 스택 워밍업 중 (135봉 필요) — 판정 불가'
    : setup.alignment === 'bull'
      ? '정배열 (20>55>95>135)'
      : setup.alignment === 'bear'
        ? '역배열 (20<55<95<135)'
        : '혼조 — 추세 없음';
  push(
    'stackAlignment',
    '이평선 배열',
    setup.stackReady && setup.alignment !== 'mixed',
    alignText,
  );

  // 3. stackSpread — 셋업이 요구하는 이격 상태인가
  //    되돌림은 벌어져 있어야 하고, 눌림목·돌파는 벌어져 있으면 추격이다.
  const spreadText =
    setup.spreadPct === null
      ? '스택 워밍업 중 (135봉 필요)'
      : `이격 ${fmt(Math.abs(setup.spreadPct) * 100)}% vs 최근 중앙값 ${fmt(setup.medianSpreadPct * 100)}% (표본 ${setup.spreadSampleCount}봉)`;
  const spreadPassed =
    setup.kind === 'overextended-reversion'
      ? setup.extended
      : setup.kind === 'trend-pullback' || setup.kind === 'band-breakout'
        ? !setup.extended
        : false;
  push(
    'stackSpread',
    '이격 상태',
    spreadPassed,
    setup.kind === 'overextended-reversion'
      ? `${spreadText} — 되돌림 근거`
      : setup.kind === 'overextended-chase'
        ? `${spreadText} — 이미 벌어져 추격 자리`
        : spreadText,
  );

  // 4. bbPosition — 셋업마다 "좋은 위치"가 다르다
  if (indicators === null || lastCandle === null) {
    push('bbPosition', '가격 위치', false, '데이터 부족');
  } else if (direction === null) {
    push('bbPosition', '가격 위치', false, '진입 셋업 없음');
  } else {
    const close = lastCandle.close;
    const isLong = direction === 'long';
    if (setup.kind === 'band-breakout') {
      const passed = isLong ? close > indicators.bbUpper : close < indicators.bbLower;
      push(
        'bbPosition',
        '가격 위치',
        passed,
        isLong
          ? `종가 ${fmt(close)} vs BB상단 ${fmt(indicators.bbUpper)} (돌파 필요)`
          : `종가 ${fmt(close)} vs BB하단 ${fmt(indicators.bbLower)} (돌파 필요)`,
      );
    } else if (setup.kind === 'trend-pullback' && indicators.stack !== null) {
      // 눌림에서 실제로 회복했는가 — 빠른 선(SMMA20)을 되찾았는지로 본다.
      const fast = indicators.stack.smma20;
      const passed = isLong ? close > fast : close < fast;
      push(
        'bbPosition',
        '가격 위치',
        passed,
        `종가 ${fmt(close)} vs SMMA20 ${fmt(fast)} (눌림 회복 확인)`,
      );
    } else {
      // 과이격 되돌림 — 중앙선을 반대쪽으로 이탈했는가
      const passed = isLong ? close > indicators.sma20 : close < indicators.sma20;
      push(
        'bbPosition',
        '가격 위치',
        passed,
        `종가 ${fmt(close)} vs BB중앙선 ${fmt(indicators.sma20)} (반대 이탈 확인)`,
      );
    }
  }

  // 5. bandExpansion — 스퀴즈 구간 진입 차단
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

  // 6. volume
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

  // 7. higherTimeframe — 되돌림 셋업에서는 기준이 뒤집힌다.
  //    되돌림은 상위 추세가 살아 있어야 스택 하단에서 멈출 근거가 생긴다.
  //    상위 추세까지 꺾였다면 그건 되돌림이 아니라 추세 전환이고, 목표가
  //    스택 하단에서 지지받는다는 전제가 사라진다.
  const htfCloses = closed15m.map((c) => c.close);
  const htfEma = ema(htfCloses, HTF_EMA_PERIOD);
  const htfLast = htfEma[htfEma.length - 1] ?? null;
  const htfPrev = htfEma.length >= 2 ? htfEma[htfEma.length - 2] : null;
  if (htfLast === null || htfPrev === null) {
    push('higherTimeframe', '상위 프레임 정렬', false, '15분봉 데이터 부족');
  } else if (direction === null) {
    push('higherTimeframe', '상위 프레임 정렬', false, '진입 셋업 없음');
  } else {
    const slope = htfLast - htfPrev;
    const slopeText = `15분 EMA50 기울기 ${slope > 0 ? '+' : ''}${fmt(slope, 3)}`;
    if (setup.kind === 'overextended-reversion') {
      const trendUp = setup.alignment === 'bull';
      const passed = trendUp ? slope > 0 : slope < 0;
      push(
        'higherTimeframe',
        '상위 프레임 정렬',
        passed,
        `${slopeText} — 상위 추세 유지 여부 (되돌림의 전제)`,
      );
    } else {
      const passed = direction === 'long' ? slope > 0 : slope < 0;
      push('higherTimeframe', '상위 프레임 정렬', passed, slopeText);
    }
  }

  // 8. trendStrength
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

  // 9. funding — 방향 의존. 과열된 쪽으로 따라 들어가는 것을 막는다.
  if (direction === null) {
    push('funding', '펀딩비', false, '진입 셋업 없음');
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

  // 10. session
  // 판정은 UTC 창으로 한다(설정이 UTC 기준). 설명에는 화면의 다른 시각과
  // 맞추기 위해 KST를 먼저 적는다.
  const hour = new Date(ctx.nowMs).getUTCHours();
  const kstHour = (hour + 9) % 24;
  push(
    'session',
    '세션',
    hour >= cfg.sessionStartUtcHour && hour < cfg.sessionEndUtcHour,
    `KST ${kstHour}시 (UTC ${hour}시) vs UTC ${cfg.sessionStartUtcHour}~${cfg.sessionEndUtcHour}시`,
  );

  return {
    direction,
    items,
    indicators,
    snapshots,
    setup,
    bandState: classifyBandState(snapshots, lastIndex, cfg),
    crossCount: countRecentCrosses(snapshots, lastIndex, cfg.crossLookback),
  };
}
