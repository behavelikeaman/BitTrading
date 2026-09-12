import type {
  AccountConfig,
  BacktestResult,
  Candle,
  Conviction,
  Direction,
  ExitReason,
  GuardState,
  LadderLeg,
  Trade,
} from '@/types';
import { evaluateEntry, type EntryConfig } from '@/lib/signal/entry';
import {
  DEFAULT_LADDER_HIGH,
  DEFAULT_LADDER_MEDIUM,
  type LadderPlanInput,
} from '@/lib/risk/ladder';
import { costRatePerSide, planPosition } from '@/lib/risk/sizing';
import { averagePrice, liquidationPrice, resolveMmr } from '@/lib/risk/liquidation';
import { INITIAL_GUARD, resetDaily, updateGuard } from '@/lib/risk/guard';
import { computeMetrics } from '@/lib/backtest/metrics';

const MS_5M = 300_000;
const MS_15M = 900_000;
const MS_8H = 8 * 60 * 60 * 1000;

export interface BacktestParams {
  account: AccountConfig;
  entry: EntryConfig;
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

interface PendingOrder {
  direction: Direction;
  conviction: Conviction;
  score: number;
  /** 체결 시도를 시작할 캔들 인덱스 */
  fromIndex: number;
  /** 지정가일 때만 의미가 있다 */
  limitPrice: number;
  /** 지정가 만료 인덱스(포함) */
  expiresAtIndex: number;
  /** 신호 시점 ATR. 체결 시점 사이징에 쓴다. */
  atrAtSignal: number;
}

interface OpenPosition {
  direction: Direction;
  conviction: Conviction;
  score: number;
  entryTime: number;
  entryIndex: number;
  filled: LadderLeg[];
  pending: LadderLeg[];
  stopPrice: number;
  targetWidth: number;
  fees: number;
  funding: number;
  equityAtEntry: number;
  /** 마지막으로 펀딩을 부과한 8시간 경계 */
  lastFundingBoundary: number;
}

function totalNotional(legs: LadderLeg[]): number {
  return legs.reduce((sum, l) => sum + l.notional, 0);
}

/** 캔들이 해당 가격에 닿았는지 — 불리한 방향(롱은 저가, 숏은 고가) */
function touchedAdverse(direction: Direction, candle: Candle, level: number): boolean {
  return direction === 'long' ? candle.low <= level : candle.high >= level;
}

/** 캔들이 해당 가격에 닿았는지 — 유리한 방향 */
function touchedFavorable(
  direction: Direction,
  candle: Candle,
  level: number,
): boolean {
  return direction === 'long' ? candle.high >= level : candle.low <= level;
}

function currentLiquidation(
  position: OpenPosition,
  account: AccountConfig,
  mmrTiers: BacktestParams['mmrTiers'],
): number {
  const avg = averagePrice(position.filled);
  if (avg === 0) return 0;
  const mmr = resolveMmr(
    totalNotional(position.filled),
    mmrTiers,
    account.maintenanceMarginRate,
  );
  return liquidationPrice({
    direction: position.direction,
    averageEntryPrice: avg,
    leverage: account.leverage,
    maintenanceMarginRate: mmr,
  });
}

/** 현재 체결분 기준 목표가. 물타기로 평단이 내려가면 목표도 따라 내려간다. */
function currentTakeProfit(position: OpenPosition): number {
  const avg = averagePrice(position.filled);
  return position.direction === 'long'
    ? avg + position.targetWidth
    : avg - position.targetWidth;
}

/**
 * 5분봉 백테스트.
 *
 * 룩어헤드 금지 규칙:
 * - 캔들 i의 시그널은 캔들 i의 종가까지만 쓴다 (창은 [i-signalWindowBars+1, i]).
 * - 15분봉은 캔들 i가 끝난 시각까지 이미 종료된 것만 넘긴다.
 * - 체결은 캔들 i+1부터 일어난다.
 *
 * 시그널·사이징은 실시간과 동일한 함수를 호출한다 (ADR-001).
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
  const cost = costRatePerSide(account);

  const trades: Trade[] = [];
  let equity = account.equity;
  let guard: GuardState = INITIAL_GUARD;
  let currentDay = -1;
  let signalCount = 0;

  let pending: PendingOrder | null = null;
  let position: OpenPosition | null = null;

  /** 15분봉 포인터 — 매 캔들 필터링하면 O(n*m)이 된다 */
  let htfCursor = 0;

  const closeTrade = (
    pos: OpenPosition,
    exitPrice: number,
    exitTime: number,
    reason: ExitReason,
  ) => {
    const avg = averagePrice(pos.filled);
    const notional = totalNotional(pos.filled);
    const qty = pos.filled.reduce((s, l) => s + l.qty, 0);

    const grossPnl =
      pos.direction === 'long' ? (exitPrice - avg) * qty : (avg - exitPrice) * qty;

    // 청산이면 손실은 투입 증거금 전액을 넘지 않는다.
    const margin = pos.filled.reduce((s, l) => s + l.margin, 0);
    const exitFee = notional * cost;
    const fees = pos.fees + exitFee;
    let netPnl = grossPnl - fees - pos.funding;
    if (reason === 'liquidation' && netPnl < -margin) netPnl = -margin;

    const netPnlPct = pos.equityAtEntry > 0 ? netPnl / pos.equityAtEntry : 0;

    trades.push({
      entryTime: pos.entryTime,
      exitTime,
      direction: pos.direction,
      conviction: pos.conviction,
      score: pos.score,
      legs: pos.filled,
      averageEntryPrice: avg,
      exitPrice,
      exitReason: reason,
      grossPnl,
      fees,
      funding: pos.funding,
      netPnl,
      netPnlPct,
    });

    equity += netPnl;
    guard = updateGuard(guard, netPnlPct);
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // 하루가 바뀌면 일손익만 초기화한다.
    const day = Math.floor(candle.openTime / (24 * 60 * 60 * 1000));
    if (day !== currentDay) {
      if (currentDay !== -1) guard = resetDaily(guard);
      currentDay = day;
    }

    // --- 1. 보유 중이면 8시간 경계를 넘은 만큼 펀딩을 부과한다 ---
    if (position !== null) {
      const boundary = Math.floor(candle.openTime / MS_8H);
      if (boundary > position.lastFundingBoundary) {
        const notional = totalNotional(position.filled);
        // 롱은 펀딩이 양수일 때 지불, 숏은 수령.
        const sign = position.direction === 'long' ? 1 : -1;
        const periods = boundary - position.lastFundingBoundary;
        position.funding += sign * notional * params.fundingRatePerInterval * periods;
        position.lastFundingBoundary = boundary;
      }
    }

    // --- 2. 대기 주문 체결 시도 ---
    if (position === null && pending !== null && i >= pending.fromIndex) {
      let fillPrice: number | null = null;

      if (params.entryType === 'market') {
        // 다음 캔들 시가에 무조건 체결. 슬리피지는 항상 불리한 방향.
        fillPrice =
          pending.direction === 'long'
            ? candle.open * (1 + account.slippageRatePerSide)
            : candle.open * (1 - account.slippageRatePerSide);
      } else if (touchedAdverse(pending.direction, candle, pending.limitPrice)) {
        // 지정가는 되돌림이 와야 체결된다. 슬리피지 없음.
        fillPrice = pending.limitPrice;
      }

      if (fillPrice !== null) {
        const plan = planPosition({
          direction: pending.direction,
          conviction: pending.conviction,
          entryPrice: fillPrice,
          atr: pending.atrAtSignal,
          account: { ...account, equity },
          ladder:
            pending.conviction === 'high' ? params.ladderHigh : params.ladderMedium,
          mmrTiers: params.mmrTiers,
          qtyStep: params.qtyStep,
        });

        const [first, ...rest] = plan.legs;
        if (first !== undefined && first.qty > 0) {
          position = {
            direction: pending.direction,
            conviction: pending.conviction,
            score: pending.score,
            entryTime: candle.openTime,
            entryIndex: i,
            filled: [first],
            pending: rest,
            stopPrice: plan.stopPrice,
            targetWidth: Math.abs(plan.takeProfitPrice - plan.averageEntryPrice),
            fees: first.notional * cost,
            funding: 0,
            equityAtEntry: equity,
            lastFundingBoundary: Math.floor(candle.openTime / MS_8H),
          };
        }
        pending = null;
      } else if (i >= pending.expiresAtIndex) {
        // 유효 기간 안에 닿지 않았다. 트레이드를 만들지 않는다 (ADR-015).
        pending = null;
      }
    }

    // --- 3. 보유 중이면 이 캔들에서 체결·청산 판정 ---
    if (position !== null) {
      const pos = position;
      let closed = false;

      // 가격은 가까운 레벨을 먼저 통과한다. 롱이 내려갈 때는 높은 가격부터,
      // 숏이 올라갈 때는 낮은 가격부터다.
      //
      // 물타기 레그가 체결되면 평단이 내려가 청산가도 함께 내려간다.
      // 따라서 레그를 하나 체결할 때마다 청산가를 다시 계산해야 한다.
      // 캔들 진입 시점에 한 번만 계산하면 이미 사라진 청산가로 판정하게 된다.
      for (;;) {
        const liqPrice = currentLiquidation(pos, account, params.mmrTiers);

        type Level =
          | { kind: 'leg'; price: number; leg: LadderLeg }
          | { kind: 'stop'; price: number }
          | { kind: 'liq'; price: number };

        const candidates: Level[] = [
          ...pos.pending.map((leg) => ({ kind: 'leg' as const, price: leg.price, leg })),
          { kind: 'stop' as const, price: pos.stopPrice },
          { kind: 'liq' as const, price: liqPrice },
        ].filter((l) => touchedAdverse(pos.direction, candle, l.price));

        if (candidates.length === 0) break;

        candidates.sort((a, b) =>
          pos.direction === 'long' ? b.price - a.price : a.price - b.price,
        );
        const next = candidates[0];

        if (next.kind === 'leg') {
          pos.filled.push(next.leg);
          pos.pending = pos.pending.filter((l) => l.index !== next.leg.index);
          pos.fees += next.leg.notional * cost;
          continue;
        }

        if (next.kind === 'stop') {
          const exit =
            pos.direction === 'long'
              ? next.price * (1 - account.slippageRatePerSide)
              : next.price * (1 + account.slippageRatePerSide);
          closeTrade(pos, exit, candle.openTime + MS_5M, 'stop-loss');
        } else {
          closeTrade(pos, next.price, candle.openTime + MS_5M, 'liquidation');
        }
        closed = true;
        break;
      }

      if (closed) {
        position = null;
      } else {
        // 손절·청산이 닿지 않은 경우에만 익절을 본다. 같은 캔들에서 둘 다
        // 닿으면 순서를 알 수 없으므로 불리한 쪽을 택한다 (낙관적 가정 금지).
        const tpNow = currentTakeProfit(pos);
        if (touchedFavorable(pos.direction, candle, tpNow)) {
          closeTrade(pos, tpNow, candle.openTime + MS_5M, 'take-profit');
          position = null;
        } else if (i - pos.entryIndex >= params.maxHoldBars) {
          closeTrade(pos, candle.close, candle.openTime + MS_5M, 'timeout');
          position = null;
        }
      }
    }

    // --- 4. 플랫이면 이 캔들 종가로 시그널을 평가한다 ---
    if (position === null && pending === null && i + 1 < candles.length) {
      const windowStart = Math.max(0, i + 1 - params.signalWindowBars);
      const window5m = candles.slice(windowStart, i + 1);

      // 캔들 i가 끝난 시각까지 이미 종료된 15분봉만 넘긴다.
      const htfDeadline = candle.openTime + MS_5M;
      while (
        htfCursor < htf.length &&
        htf[htfCursor].openTime + MS_15M <= htfDeadline
      ) {
        htfCursor += 1;
      }
      const window15m = htf.slice(Math.max(0, htfCursor - params.signalWindowBars), htfCursor);

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

      if (signal.conviction !== 'none' && signal.direction !== null && signal.indicators !== null) {
        signalCount += 1;
        pending = {
          direction: signal.direction,
          conviction: signal.conviction,
          score: signal.score,
          fromIndex: i + 1,
          limitPrice: candle.close,
          expiresAtIndex: i + params.limitValidBars,
          atrAtSignal: signal.indicators.atr14,
        };
      }
    }
  }

  // 데이터가 끝났는데 포지션이 남아 있으면 마지막 종가로 정리한다.
  if (position !== null && candles.length > 0) {
    const last = candles[candles.length - 1];
    closeTrade(position, last.close, last.openTime + MS_5M, 'end-of-data');
    position = null;
  }

  const metrics = computeMetrics(trades, account.equity);

  return {
    ...metrics,
    trades,
    signalCount,
    fillRate: signalCount === 0 ? 0 : trades.length / signalCount,
  };
}
