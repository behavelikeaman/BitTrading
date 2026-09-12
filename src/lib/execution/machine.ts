import type {
  Candle,
  Direction,
  ExitReason,
  LadderLeg,
  Signal,
  Trade,
} from '@/types';
import { costRatePerSide, planPosition } from '@/lib/risk/sizing';
import { averagePrice, liquidationPrice, resolveMmr } from '@/lib/risk/liquidation';
import type {
  ExecutionConfig,
  OpenPosition,
  PendingOrder,
} from '@/lib/execution/types';

const MS_8H = 8 * 60 * 60 * 1000;

export interface StepInput {
  candle: Candle;
  pending: PendingOrder | null;
  position: OpenPosition | null;
  equity: number;
  config: ExecutionConfig;
}

export interface StepOutput {
  pending: PendingOrder | null;
  position: OpenPosition | null;
  /** 이 캔들에서 종료된 트레이드. 없으면 null. */
  trade: Trade | null;
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
  config: ExecutionConfig,
): number {
  const avg = averagePrice(position.filled);
  if (avg === 0) return 0;
  const mmr = resolveMmr(
    totalNotional(position.filled),
    config.mmrTiers,
    config.account.maintenanceMarginRate,
  );
  return liquidationPrice({
    direction: position.direction,
    averageEntryPrice: avg,
    leverage: config.account.leverage,
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

function buildTrade(
  position: OpenPosition,
  exitPrice: number,
  exitTime: number,
  reason: ExitReason,
  config: ExecutionConfig,
): Trade {
  const cost = costRatePerSide(config.account);
  const avg = averagePrice(position.filled);
  const notional = totalNotional(position.filled);
  const qty = position.filled.reduce((s, l) => s + l.qty, 0);

  const grossPnl =
    position.direction === 'long'
      ? (exitPrice - avg) * qty
      : (avg - exitPrice) * qty;

  // 청산이면 손실은 투입 증거금 전액을 넘지 않는다.
  const margin = position.filled.reduce((s, l) => s + l.margin, 0);
  const exitFee = notional * cost;
  const fees = position.fees + exitFee;
  let netPnl = grossPnl - fees - position.funding;
  if (reason === 'liquidation' && netPnl < -margin) netPnl = -margin;

  return {
    entryTime: position.entryTime,
    exitTime,
    direction: position.direction,
    conviction: position.conviction,
    score: position.score,
    legs: position.filled,
    averageEntryPrice: avg,
    exitPrice,
    exitReason: reason,
    grossPnl,
    fees,
    funding: position.funding,
    netPnl,
    netPnlPct: position.equityAtEntry > 0 ? netPnl / position.equityAtEntry : 0,
  };
}

/** 데이터가 끝났거나 강제 종료할 때 현재가로 정리한다. */
export function forceClose(
  position: OpenPosition,
  candle: Candle,
  config: ExecutionConfig,
  reason: ExitReason,
): Trade {
  return buildTrade(position, candle.close, candle.openTime + config.barMs, reason, config);
}

/** 신호에서 대기 주문을 만든다. 진입 불가 신호면 null. */
export function createPendingOrder(input: {
  signal: Signal;
  candle: Candle;
  limitValidBars: number;
  /** 기준 봉 길이 (ms) */
  barMs: number;
}): PendingOrder | null {
  const { signal, candle, limitValidBars, barMs } = input;
  if (
    signal.conviction === 'none' ||
    signal.direction === null ||
    signal.indicators === null
  ) {
    return null;
  }
  return {
    direction: signal.direction,
    conviction: signal.conviction,
    score: signal.score,
    fromTime: candle.openTime + barMs,
    limitPrice: candle.close,
    expiresAtTime: candle.openTime + limitValidBars * barMs,
    atrAtSignal: signal.indicators.atr14,
  };
}

/**
 * 확정봉 하나를 소화해 상태를 전이시킨다.
 *
 * 순수 함수이며 입력 객체를 변경하지 않는다. 페이퍼가 상태를 파일에
 * 저장·복원하므로 변이는 저장 시점과 실제 상태를 어긋나게 만든다.
 *
 * 백테스트와 페이퍼가 이 함수 하나를 공유한다 (ADR-016).
 */
export function stepExecution(input: StepInput): StepOutput {
  const { candle, config, equity } = input;
  const { account } = config;
  const cost = costRatePerSide(account);

  let pending = input.pending;
  let position = input.position;

  // --- 1. 보유 중이면 8시간 경계를 넘은 만큼 펀딩을 부과한다 ---
  if (position !== null) {
    const boundary = Math.floor(candle.openTime / MS_8H);
    if (boundary > position.lastFundingBoundary) {
      const notional = totalNotional(position.filled);
      // 롱은 펀딩이 양수일 때 지불, 숏은 수령.
      const sign = position.direction === 'long' ? 1 : -1;
      const periods = boundary - position.lastFundingBoundary;
      position = {
        ...position,
        funding:
          position.funding + sign * notional * config.fundingRatePerInterval * periods,
        lastFundingBoundary: boundary,
      };
    }
  }

  // --- 2. 대기 주문 체결 시도 ---
  if (position === null && pending !== null && candle.openTime >= pending.fromTime) {
    let fillPrice: number | null = null;

    if (config.entryType === 'market') {
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
          pending.conviction === 'high' ? config.ladderHigh : config.ladderMedium,
        mmrTiers: config.mmrTiers,
        qtyStep: config.qtyStep,
      });

      const [first, ...rest] = plan.legs;
      if (first !== undefined && first.qty > 0) {
        position = {
          direction: pending.direction,
          conviction: pending.conviction,
          score: pending.score,
          entryTime: candle.openTime,
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
    } else if (candle.openTime >= pending.expiresAtTime) {
      // 유효 기간 안에 닿지 않았다. 트레이드를 만들지 않는다 (ADR-015).
      pending = null;
    }
  }

  // --- 3. 보유 중이면 이 캔들에서 체결·청산 판정 ---
  if (position !== null) {
    let pos = position;
    let closedTrade: Trade | null = null;

    // 가격은 가까운 레벨을 먼저 통과한다. 롱이 내려갈 때는 높은 가격부터,
    // 숏이 올라갈 때는 낮은 가격부터다.
    //
    // 물타기 레그가 체결되면 평단이 내려가 청산가도 함께 내려간다.
    // 따라서 레그를 하나 체결할 때마다 청산가를 다시 계산해야 한다.
    for (;;) {
      const liqPrice = currentLiquidation(pos, config);

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
        pos = {
          ...pos,
          filled: [...pos.filled, next.leg],
          pending: pos.pending.filter((l) => l.index !== next.leg.index),
          fees: pos.fees + next.leg.notional * cost,
        };
        continue;
      }

      if (next.kind === 'stop') {
        const exit =
          pos.direction === 'long'
            ? next.price * (1 - account.slippageRatePerSide)
            : next.price * (1 + account.slippageRatePerSide);
        closedTrade = buildTrade(pos, exit, candle.openTime + config.barMs, 'stop-loss', config);
      } else {
        closedTrade = buildTrade(
          pos,
          next.price,
          candle.openTime + config.barMs,
          'liquidation',
          config,
        );
      }
      break;
    }

    if (closedTrade !== null) {
      return { pending, position: null, trade: closedTrade };
    }

    // 손절·청산이 닿지 않은 경우에만 익절을 본다. 같은 캔들에서 둘 다
    // 닿으면 순서를 알 수 없으므로 불리한 쪽을 택한다 (낙관적 가정 금지).
    const tpNow = currentTakeProfit(pos);
    if (touchedFavorable(pos.direction, candle, tpNow)) {
      return {
        pending,
        position: null,
        trade: buildTrade(pos, tpNow, candle.openTime + config.barMs, 'take-profit', config),
      };
    }

    // 보유 기간은 인덱스가 아니라 시각으로 잰다. 캔들이 빠져도 올바른
    // 시점에 타임아웃되어야 한다.
    const heldBars = (candle.openTime - pos.entryTime) / config.barMs;
    if (heldBars >= config.maxHoldBars) {
      return {
        pending,
        position: null,
        trade: buildTrade(pos, candle.close, candle.openTime + config.barMs, 'timeout', config),
      };
    }

    position = pos;
  }

  return { pending, position, trade: null };
}
