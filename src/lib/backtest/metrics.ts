import type { BacktestResult, Trade } from '@/types';
import type { SetupKind } from '@/lib/signal/setup';

/** 신호 수·체결률은 엔진만 알 수 있으므로 여기서는 트레이드에서 나오는 지표만 낸다. */
export type TradeMetrics = Omit<
  BacktestResult,
  'trades' | 'signalCount' | 'fillRate' | 'bySetup' | 'haltedBars'
>;

/**
 * 트레이드 목록에서 성과 지표를 계산한다.
 *
 * 트레이드가 0개여도 예외를 던지지 않고 전 지표 0을 반환한다.
 */
export function computeMetrics(
  trades: Trade[],
  startingEquity: number,
): TradeMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: null,
      expectancy: 0,
      maxDrawdown: 0,
      maxConsecutiveLosses: 0,
      totalFees: 0,
      totalFunding: 0,
      finalEquity: startingEquity,
      liquidationCount: 0,
      equityCurve: [],
    };
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let totalFees = 0;
  let totalFunding = 0;
  let wins = 0;
  let liquidationCount = 0;
  let consecutive = 0;
  let maxConsecutiveLosses = 0;

  let equity = startingEquity;
  let peak = startingEquity;
  let maxDrawdown = 0;
  const equityCurve: { time: number; equity: number }[] = [];

  for (const trade of trades) {
    if (trade.netPnl > 0) {
      grossProfit += trade.netPnl;
      wins += 1;
      consecutive = 0;
    } else {
      grossLoss += Math.abs(trade.netPnl);
      consecutive += 1;
      if (consecutive > maxConsecutiveLosses) maxConsecutiveLosses = consecutive;
    }

    totalFees += trade.fees;
    totalFunding += trade.funding;
    if (trade.exitReason === 'liquidation') liquidationCount += 1;

    equity += trade.netPnl;
    equityCurve.push({ time: trade.exitTime, equity });

    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  const totalNet = grossProfit - grossLoss;

  return {
    totalTrades: trades.length,
    winRate: wins / trades.length,
    // 손실이 없으면 손익비가 정의되지 않는다. Infinity는 JSON에서 null이
    // 되어버리므로 명시적으로 null을 반환하고 화면이 ∞로 그린다.
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    expectancy: totalNet / trades.length,
    maxDrawdown,
    maxConsecutiveLosses,
    totalFees,
    totalFunding,
    finalEquity: equity,
    liquidationCount,
    equityCurve,
  };
}

/**
 * 셋업별로 성과를 따로 낸다.
 *
 * 전체 평균은 서로 다른 자리를 섞어버린다. 눌림목 재진입과 과이격 되돌림은
 * 방향도 목표도 다른 매매라, 하나가 다른 하나의 성적을 가릴 수 있다.
 * 사용자의 경험칙("이 두 자리가 잘 먹힌다")을 검증하려면 자리별로 승률과
 * 기대값을 봐야 한다 (ADR-022).
 *
 * 각 셋업은 같은 시작 자본에서 출발한다. 순서에 따라 출발 자본이 달라지면
 * 먼저 나온 셋업이 유리해져 비교가 무의미해진다.
 */
export function metricsBySetup(
  trades: Trade[],
  startingEquity: number,
): Partial<Record<SetupKind, TradeMetrics>> {
  const grouped = new Map<SetupKind, Trade[]>();
  for (const trade of trades) {
    const list = grouped.get(trade.setup);
    if (list === undefined) grouped.set(trade.setup, [trade]);
    else list.push(trade);
  }

  const out: Partial<Record<SetupKind, TradeMetrics>> = {};
  for (const [setup, list] of grouped) {
    out[setup] = computeMetrics(list, startingEquity);
  }
  return out;
}
