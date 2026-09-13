import type {
  Direction,
  GateItem,
  IndicatorSnapshot,
  ScoreItem,
  SignalContext,
  TriggerState,
} from '@/types';
import { computeIndicators } from '@/lib/indicators';
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
  /** 펀딩 과열 한계. 기본 0.0003 (0.03%) */
  fundingLimit: number;
  /** 세션 시작 UTC 시(포함). 기본 7 */
  sessionStartUtcHour: number;
  /** 세션 종료 UTC 시(제외). 기본 21 */
  sessionEndUtcHour: number;
  /**
   * 왕복 체결 마찰 (명목가 대비). 기본 0.0012 = 수수료 0.08% + 슬리피지 0.04%.
   *
   * BB 폭 최소 요구치의 기준선이다. 계좌 설정의 실측 수수료·슬리피지가
   * 이 값과 다르면 호출부가 덮어쓴다.
   */
  roundTripCostRate: number;
  /**
   * BB 폭이 왕복 마찰의 이 배수 미만이면 진입하지 않는다. 기본 3
   *
   * **추정 기본값이다.** 좁은 관 안에서는 목표가 마찰을 못 넘으므로 이건
   * 확신의 문제가 아니라 진입 가능 여부다 (ADR-025). 실제 임계는 백테스트의
   * 점수별·밴드 폭 상태별 표로 보정해야 한다.
   */
  minBbWidthCostMultiple: number;
  /** 교차 노이즈를 셀 구간. 기본 12봉 */
  crossLookback: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  ...DEFAULT_SETUP_CONFIG,
  ...DEFAULT_BAND_STATE_CONFIG,
  crossLookback: 12,
  volumeMultiple: 1.5,
  fundingLimit: 0.0003,
  sessionStartUtcHour: 7,
  sessionEndUtcHour: 21,
  roundTripCostRate: 0.0012,
  minBbWidthCostMultiple: 3,
};

/** 점수 항목 수 (2단계). 화면과 확신도 임계값이 이 값을 기준으로 한다. */
export const SCORE_ITEM_COUNT = 3;

/** 차단 게이트 수 (0단계 중 시그널이 판정하는 것). */
export const GATE_COUNT = 3;

export interface ScoreResult {
  direction: Direction | null;
  /** 1단계 트리거 — 교차 + 가격 위치 */
  trigger: TriggerState;
  /** 2단계 점수 항목 3개 */
  items: ScoreItem[];
  /** 0단계 차단 게이트 3개. 실패한 것은 entry.ts가 blockers로 올린다. */
  gates: GateItem[];
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

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/**
 * 판정을 **차단 · 트리거 · 점수** 세 단계로 나눠 계산한다 (ADR-025).
 *
 * 이전 구조는 성격이 다른 열 가지를 한 줄에 세워 1점씩 매겼다. 그 안에는
 * "이 자리가 좋은가"(점수로 셀 수 있는 것)와 "거래를 해도 되는 환경인가"
 * (통과/불통과일 뿐인 것)가 섞여 있었고, 세션이나 펀딩처럼 거의 항상
 * 통과하는 항목이 공짜 1점을 주면서 확신 문턱을 통째로 왜곡했다. 세션이
 * 좋다고 나쁜 자리가 좋은 자리가 되지는 않는다.
 *
 * - 0단계 게이트: BB 폭(수수료 타당성) · 세션 · 펀딩 → 걸리면 진입 불가
 * - 1단계 트리거: EMA12 × BB중앙선 교차 + 가격 위치 → 없으면 진입 불가
 * - 2단계 점수: 이평선 배열 · 이격 · 거래량 → 3점 만점, **기록용**
 *
 * 항목이 셋업마다 다른 조건으로 판정되는 것은 그대로다 (ADR-022). 같은
 * 교차라도 눌림목과 과이격 되돌림은 요구하는 자리가 정반대다.
 *
 * 확정봉만 사용한다 (ADR-006).
 */
export function scoreSignal(
  ctx: SignalContext,
  config?: Partial<ScoreConfig>,
): ScoreResult {
  const cfg = { ...DEFAULT_SCORE_CONFIG, ...config };
  const closed = ctx.candles.filter((c) => c.closed);

  const snapshots = computeIndicators(closed);
  const lastIndex = snapshots.length - 1;
  const indicators = lastIndex >= 0 ? snapshots[lastIndex] : null;
  const lastCandle = lastIndex >= 0 ? closed[lastIndex] : null;

  const setup = classifySetup(snapshots, lastIndex, cfg);
  const direction = setup.direction;

  // --- 1단계 트리거 — 교차했고, 셋업 조건대로 종가가 그 자리를 만들었는가 ---
  const trigger = evaluateTrigger(setup, indicators, lastCandle?.close ?? null);

  // --- 2단계 점수 — 3항목 ---
  const items: ScoreItem[] = [];
  const push = (
    key: ScoreItem['key'],
    label: string,
    passed: boolean,
    detail: string,
  ) => {
    items.push({ key, label, passed, detail });
  };

  // 1. stackAlignment — 이평선이 줄을 섰는가 (SMMA 20·55·95·135)
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

  // 2. stackSpread — 셋업이 요구하는 이격 상태인가
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

  // 3. volume — 점수 3항목 중 **가격에서 파생되지 않은 유일한 정보**다.
  //    이걸 빼면 점수가 100% 가격의 함수가 된다.
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

  return {
    direction,
    trigger,
    items,
    gates: evaluateGates(ctx, indicators, direction, cfg),
    indicators,
    snapshots,
    setup,
    bandState: classifyBandState(snapshots, lastIndex, cfg),
    crossCount: countRecentCrosses(snapshots, lastIndex, cfg.crossLookback),
  };
}

/**
 * 1단계 트리거.
 *
 * 교차와 가격 위치를 한 덩어리로 본다. 둘을 따로 1점씩 세면 같은 사건을
 * 두 번 세는 셈이고, 트리거가 완성됐다는 사실만으로 점수가 2점 올라간다.
 * "이 자리가 얼마나 좋은가"는 그다음 문제다.
 */
function evaluateTrigger(
  setup: SetupResult,
  indicators: IndicatorSnapshot | null,
  close: number | null,
): TriggerState {
  const base = { cross: setup.cross, positionConfirmed: false };

  if (setup.cross === null) {
    return {
      ...base,
      passed: false,
      detail: setup.detail,
      blocker: '진입 트리거 없음',
    };
  }

  const crossText = setup.cross === 'long' ? '상향 교차' : '하향 교차';

  if (setup.direction === null) {
    // 교차는 났지만 셋업이 진입을 내지 않는다. "교차가 없다"와 전혀 다른
    // 상황이므로 사유를 구분해 남긴다.
    return {
      ...base,
      passed: false,
      detail: `${crossText} — ${setup.detail}`,
      blocker:
        setup.kind === 'overextended-chase' ? '과이격 추격 자리' : '셋업 조건 미충족',
    };
  }

  if (indicators === null || close === null) {
    return {
      ...base,
      passed: false,
      detail: `${crossText} — 데이터 부족으로 가격 위치 판정 불가`,
      blocker: '데이터 부족',
    };
  }

  const isLong = setup.direction === 'long';
  let confirmed: boolean;
  let positionText: string;

  if (setup.kind === 'band-breakout') {
    confirmed = isLong ? close > indicators.bbUpper : close < indicators.bbLower;
    positionText = isLong
      ? `종가 ${fmt(close)} vs BB상단 ${fmt(indicators.bbUpper)} (돌파 필요)`
      : `종가 ${fmt(close)} vs BB하단 ${fmt(indicators.bbLower)} (돌파 필요)`;
  } else if (setup.kind === 'trend-pullback' && indicators.stack !== null) {
    // 눌림에서 실제로 회복했는가 — 빠른 선(SMMA20)을 되찾았는지로 본다.
    const fast = indicators.stack.smma20;
    confirmed = isLong ? close > fast : close < fast;
    positionText = `종가 ${fmt(close)} vs SMMA20 ${fmt(fast)} (눌림 회복 확인)`;
  } else {
    // 과이격 되돌림 — 중앙선을 반대쪽으로 이탈했는가
    confirmed = isLong ? close > indicators.sma20 : close < indicators.sma20;
    positionText = `종가 ${fmt(close)} vs BB중앙선 ${fmt(indicators.sma20)} (반대 이탈 확인)`;
  }

  return {
    cross: setup.cross,
    positionConfirmed: confirmed,
    passed: confirmed,
    detail: `${crossText} · ${positionText}`,
    blocker: confirmed ? null : '가격 위치 미확인',
  };
}

/**
 * 0단계 차단 게이트.
 *
 * 셋 다 "이 자리가 좋은가"가 아니라 "거래를 해도 되는 환경인가"를 묻는다.
 * 점수로 세면 안 되는 이유는 서로 다르다:
 *
 * - BB 폭: 관이 좁으면 목표가 왕복 마찰을 못 넘는다. 확신의 문제가 아니라
 *   산수의 문제다.
 * - 세션: 스케줄이지 신호가 아니다.
 * - 펀딩: BTC 평상시 펀딩(0.005~0.015%)은 한계(±0.03%)의 절반도 안 돼
 *   90% 이상 그냥 통과한다. 공짜 1점이 모든 점수를 1씩 부풀렸다.
 */
function evaluateGates(
  ctx: SignalContext,
  indicators: IndicatorSnapshot | null,
  direction: Direction | null,
  cfg: ScoreConfig,
): GateItem[] {
  const gates: GateItem[] = [];

  // 1. bandWidth — 수수료 타당성
  const minBbWidth = cfg.roundTripCostRate * cfg.minBbWidthCostMultiple;
  const widthText = `최소 ${fmt(minBbWidth * 100, 3)}% (왕복 마찰 ${fmt(cfg.roundTripCostRate * 100, 3)}% × ${cfg.minBbWidthCostMultiple})`;
  gates.push({
    key: 'bandWidth',
    label: 'BB 폭 (수수료 타당성)',
    passed: indicators !== null && indicators.bbWidth >= minBbWidth,
    detail:
      indicators === null
        ? `데이터 부족 — ${widthText}`
        : `현재 ${fmt(indicators.bbWidth * 100, 3)}% vs ${widthText}`,
    blocker: 'BB 폭 부족 (수수료 타당성)',
  });

  // 2. session
  // 판정은 UTC 창으로 한다(설정이 UTC 기준). 설명에는 화면의 다른 시각과
  // 맞추기 위해 KST를 먼저 적는다.
  const hour = new Date(ctx.nowMs).getUTCHours();
  const kstHour = (hour + 9) % 24;
  gates.push({
    key: 'session',
    label: '세션',
    passed: hour >= cfg.sessionStartUtcHour && hour < cfg.sessionEndUtcHour,
    detail: `KST ${kstHour}시 (UTC ${hour}시) vs UTC ${cfg.sessionStartUtcHour}~${cfg.sessionEndUtcHour}시`,
    blocker: '세션 밖',
  });

  // 3. funding — 과열된 쪽으로 따라 들어가는 것을 막는다. 방향이 정해지기
  //    전에는 어느 쪽으로도 극단이면 막아야 하므로 절대값으로 잰다.
  const limitText = fmt(cfg.fundingLimit * 100, 4);
  const fundingText = fmt(ctx.fundingRate * 100, 4);
  const fundingPassed =
    direction === null
      ? Math.abs(ctx.fundingRate) <= cfg.fundingLimit
      : direction === 'long'
        ? ctx.fundingRate < cfg.fundingLimit
        : ctx.fundingRate > -cfg.fundingLimit;
  const sign = direction === null ? '±' : direction === 'long' ? '+' : '-';
  gates.push({
    key: 'funding',
    label: '펀딩비',
    passed: fundingPassed,
    detail: `${fundingText}% vs 한계 ${sign}${limitText}%`,
    blocker: '펀딩 극단값',
  });

  return gates;
}
