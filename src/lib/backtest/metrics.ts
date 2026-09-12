import type { BacktestResult, Trade } from '@/types';

/** 신호 수·체결률은 엔진만 알 수 있으므로 여기서는 트레이드에서 나오는 지표만 낸다. */
export type TradeMetrics = Omit<
  BacktestResult,
  'trades' | 'signalCount' | 'fillRate'
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
      profitFactor: 0,
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
    // 손실이 전혀 없으면 무한대. UI가 별도 표기한다.
    profitFactor: grossLoss === 0 ? Number.POSITIVE_INFINITY : grossProfit / grossLoss,
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
