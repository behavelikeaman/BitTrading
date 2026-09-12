import type {
  AccountConfig,
  BacktestResult,
  Candle,
  GuardState,
  Trade,
} from '@/types';
import { evaluateEntry, type EntryConfig } from '@/lib/signal/entry';
import {
  DEFAULT_LADDER_HIGH,
  DEFAULT_LADDER_MEDIUM,
  type LadderPlanInput,
} from '@/lib/risk/ladder';
import { INITIAL_GUARD, resetDaily, updateGuard } from '@/lib/risk/guard';
import { computeMetrics, metricsBySetup } from '@/lib/backtest/metrics';
import {
  createPendingOrder,
  forceClose,
  stepExecution,
} from '@/lib/execution/machine';
import { timeframeSpec, type Timeframe } from '@/lib/timeframe';
import type {
  ExecutionConfig,
  OpenPosition,
  PendingOrder,
} from '@/lib/execution/types';

const MS_DAY = 24 * 60 * 60 * 1000;

export interface BacktestParams {
  account: AccountConfig;
  entry: EntryConfig;
  /** 기준 타임프레임. 상위 프레임은 자동으로 한 단계 위가 된다. */
  timeframe: Timeframe;
  ladderHigh: LadderPlanInput;
  ladderMedium: LadderPlanInput;
  /** 시장가는 다음 캔들 시가 체결, 지정가는 되돌림 대기 (ADR-015) */
  entryType: 'market' | 'limit';
  /** entryType='limit'일 때 지정가 유효 캔들 수 */
  limitValidBars: number;
  /** 8시간당 펀딩비 */
  fundingRatePerInterval: number;
  /** 타임아웃 청산까지의 보유 캔들 수 */
  maxHoldBars: number;
  /** 거래소 최소 수량 단위 */
  qtyStep: number;
  /** 시그널 평가에 쓸 캔들 창 크기. 실시간과 같은 창을 써야 결과가 일치한다. */
  signalWindowBars: number;
  mmrTiers: { maxNotional: number; mmr: number }[] | null;
}

export const DEFAULT_BACKTEST_PARAMS: Omit<BacktestParams, 'account' | 'entry'> = {
  timeframe: '5m',
  ladderHigh: DEFAULT_LADDER_HIGH,
  ladderMedium: DEFAULT_LADDER_MEDIUM,
  entryType: 'market',
  limitValidBars: 3,
  fundingRatePerInterval: 0.0001,
  maxHoldBars: 36,
  qtyStep: 0.001,
  signalWindowBars: 200,
  mmrTiers: null,
};

/** BacktestParams에서 체결 상태 기계가 쓰는 부분만 뽑는다. */
export function toExecutionConfig(params: BacktestParams): ExecutionConfig {
  return {
    account: params.account,
    barMs: timeframeSpec(params.timeframe).barMs,
    ladderHigh: params.ladderHigh,
    ladderMedium: params.ladderMedium,
    entryType: params.entryType,
    fundingRatePerInterval: params.fundingRatePerInterval,
    maxHoldBars: params.maxHoldBars,
    qtyStep: params.qtyStep,
    mmrTiers: params.mmrTiers,
  };
}

/**
 * 5분봉 백테스트.
 *
 * 체결·청산 판정은 src/lib/execution/machine.ts의 상태 기계가 맡고, 여기서는
 * 루프·시그널 평가·가드 갱신·자본 복리·집계만 한다. 페이퍼 트레이더가 같은
 * 상태 기계를 쓰므로 두 경로가 어긋날 수 없다 (ADR-016).
 *
 * 룩어헤드 금지 규칙:
 * - 캔들 i의 시그널은 캔들 i의 종가까지만 쓴다 (창은 [i-signalWindowBars+1, i]).
 * - 15분봉은 캔들 i가 끝난 시각까지 이미 종료된 것만 넘긴다.
 * - 체결은 캔들 i+1부터 일어난다.
 */
export function runBacktest(input: {
  candles5m: Candle[];
  candles15m: Candle[];
  params: BacktestParams;
}): BacktestResult {
  const { params } = input;
  const { account, entry } = params;
  const candles = input.candles5m.filter((c) => c.closed);
  const htf = input.candles15m.filter((c) => c.closed);
  const execConfig = toExecutionConfig(params);
  const { barMs, higherMs } = timeframeSpec(params.timeframe);

  const trades: Trade[] = [];
  let equity = account.equity;
  let guard: GuardState = INITIAL_GUARD;
  let currentDay = -1;
  /** 서킷브레이커 때문에 진입 판정을 못 한 캔들 수 */
  let haltedBars = 0;
  let signalCount = 0;

  let pending: PendingOrder | null = null;
  let position: OpenPosition | null = null;

  /** 15분봉 포인터 — 매 캔들 필터링하면 O(n*m)이 된다 */
  let htfCursor = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // 하루가 바뀌면 일손익만 초기화한다.
    const day = Math.floor(candle.openTime / MS_DAY);
    if (day !== currentDay) {
      if (currentDay !== -1) guard = resetDaily();
      currentDay = day;
    }

    // --- 체결·청산 판정은 상태 기계에 위임한다 ---
    const stepped = stepExecution({
      candle,
      pending,
      position,
      equity,
      config: execConfig,
    });
    pending = stepped.pending;
    position = stepped.position;

    if (stepped.trade !== null) {
      trades.push(stepped.trade);
      equity += stepped.trade.netPnl;
      guard = updateGuard(guard, stepped.trade.netPnlPct);
    }

    // --- 플랫이면 이 캔들 종가로 시그널을 평가한다 ---
    if (position === null && pending === null && i + 1 < candles.length) {
      const windowStart = Math.max(0, i + 1 - params.signalWindowBars);
      const window5m = candles.slice(windowStart, i + 1);

      // 캔들 i가 끝난 시각까지 이미 종료된 상위 프레임 봉만 넘긴다.
      const htfDeadline = candle.openTime + barMs;
      while (
        htfCursor < htf.length &&
        htf[htfCursor].openTime + higherMs <= htfDeadline
      ) {
        htfCursor += 1;
      }
      const window15m = htf.slice(
        Math.max(0, htfCursor - params.signalWindowBars),
        htfCursor,
      );

      const signal = evaluateEntry(
        {
          candles5m: window5m,
          candles15m: window15m,
          fundingRate: params.fundingRatePerInterval,
          nowMs: candle.openTime,
        },
        guard,
        entry,
      );

      // 서킷브레이커로 막힌 봉을 센다. 세지 않으면 "신호가 없었다"와
      // "막혀서 못 봤다"가 화면에서 구분되지 않는다. 실제로 6개월 백테스트가
      // 3일치만 돌고 조용히 끝난 적이 있다.
      if (
        signal.blockers.includes('연속 손실 한도') ||
        signal.blockers.includes('일일 손실 한도')
      ) {
        haltedBars += 1;
      }

      const order = createPendingOrder({
        signal,
        candle,
        limitValidBars: params.limitValidBars,
        barMs,
      });
      if (order !== null) {
        signalCount += 1;
        pending = order;
      }
    }
  }

  // 데이터가 끝났는데 포지션이 남아 있으면 마지막 종가로 정리한다.
  if (position !== null && candles.length > 0) {
    const last = candles[candles.length - 1];
    const trade = forceClose(position, last, execConfig, 'end-of-data');
    trades.push(trade);
    equity += trade.netPnl;
    position = null;
  }

  const metrics = computeMetrics(trades, account.equity);

  return {
    ...metrics,
    trades,
    signalCount,
    fillRate: signalCount === 0 ? 0 : trades.length / signalCount,
    bySetup: metricsBySetup(trades, account.equity),
    haltedBars,
  };
}
