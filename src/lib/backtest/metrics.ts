import type { BacktestResult, Trade } from '@/types';
import type { SetupKind } from '@/lib/signal/setup';
import type { BandState } from '@/lib/signal/band-state';

/** 신호 수·체결률은 엔진만 알 수 있으므로 여기서는 트레이드에서 나오는 지표만 낸다. */
export type TradeMetrics = Omit<
  BacktestResult,
  | 'trades'
  | 'signalCount'
  | 'fillRate'
  | 'bySetup'
  | 'byBandState'
  | 'byCrossCount'
  | 'haltedBars'
>;

/** 최근 교차 횟수 묶음. 3회 이상은 한 칸으로 합친다 — 그 아래는 표본이 흩어진다. */
export type CrossBucket = '1회' | '2회' | '3회+';

export function crossBucket(count: number): CrossBucket {
  if (count <= 1) return '1회';
  if (count === 2) return '2회';
  return '3회+';
}

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
      averageWin: 0,
      averageLoss: 0,
      payoffRatio: null,
      requiredWinRate: null,
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
  const losses = trades.length - wins;

  // 실측 손익비 = 평균 승 / 평균 패. 목표 R배수(이론 손익비)와 달리 "전량
  // 체결 뒤 목표에 닿는다"를 가정하지 않는다. 실제로는 이기는 거래가 1차
  // 진입만으로 익절되고 지는 거래는 물타기까지 전량 체결된 뒤 손절나서 둘이
  // 크게 벌어진다. 6개월 백테스트에서 실측 손익비는 이론의 25~30%였다.
  const averageWin = wins === 0 ? 0 : grossProfit / wins;
  const averageLoss = losses === 0 ? 0 : grossLoss / losses;
  // 진 거래가 없거나 평균 패가 0이면 잴 기준이 없다. Infinity는 JSON에서
  // null이 되어 "무한대"와 "측정 불가"가 섞이므로 명시적으로 null을 쓴다.
  const payoffRatio = averageLoss > 0 ? averageWin / averageLoss : null;

  return {
    totalTrades: trades.length,
    winRate: wins / trades.length,
    // 손실이 없으면 손익비가 정의되지 않는다. Infinity는 JSON에서 null이
    // 되어버리므로 명시적으로 null을 반환하고 화면이 ∞로 그린다.
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    averageWin,
    averageLoss,
    payoffRatio,
    // 실측 손익비로 역산한 필요 승률. 이 값과 실제 승률이 같으면 기대값이
    // 정확히 0이다 — 가정이 들어가지 않은 진짜 손익분기점이다.
    requiredWinRate: payoffRatio === null ? null : 1 / (1 + payoffRatio),
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
 * 트레이드를 임의의 키로 묶어 각각의 지표를 낸다.
 *
 * 전체 평균은 서로 다른 자리를 섞어버린다. 눌림목 재진입과 과이격 되돌림은
 * 방향도 목표도 다른 매매라, 하나가 다른 하나의 성적을 가릴 수 있다.
 * 사용자의 경험칙("이 두 자리가 잘 먹힌다")을 검증하려면 자리별로 승률과
 * 기대값을 봐야 한다 (ADR-022). 밴드 폭 상태·교차 노이즈도 같은 이유로
 * 같은 방식으로 쪼갠다.
 *
 * 각 묶음은 같은 시작 자본에서 출발한다. 순서에 따라 출발 자본이 달라지면
 * 먼저 나온 묶음이 유리해져 비교가 무의미해진다.
 */
export function metricsByGroup<K extends string>(
  trades: Trade[],
  startingEquity: number,
  keyOf: (trade: Trade) => K,
): Partial<Record<K, TradeMetrics>> {
  const grouped = new Map<K, Trade[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [trade]);
    else list.push(trade);
  }

  const out: Partial<Record<K, TradeMetrics>> = {};
  for (const [key, list] of grouped) {
    out[key] = computeMetrics(list, startingEquity);
  }
  return out;
}

/** 셋업별 성적 (ADR-022) */
export function metricsBySetup(
  trades: Trade[],
  startingEquity: number,
): Partial<Record<SetupKind, TradeMetrics>> {
  return metricsByGroup(trades, startingEquity, (t) => t.setup);
}

/**
 * 밴드 폭 상태별 성적.
 *
 * 사용자의 관찰: 밴드가 좁은 관을 만든 뒤 재확장할 때 올라탄 교차가 수익이었고,
 * 관 안에서 골든·데드를 반복한 교차는 노이즈였다. 그 경험칙이 데이터에 있는지
 * 여기서 잰다. 필터를 먼저 걸면 표본이 무너져 우연과 구분되지 않는다.
 */
export function metricsByBandState(
  trades: Trade[],
  startingEquity: number,
): Partial<Record<BandState, TradeMetrics>> {
  return metricsByGroup(trades, startingEquity, (t) => t.bandState);
}

/** 신호봉 기준 최근 교차 횟수별 성적. 클수록 휩소 구간의 교차다. */
export function metricsByCrossCount(
  trades: Trade[],
  startingEquity: number,
): Partial<Record<CrossBucket, TradeMetrics>> {
  return metricsByGroup(trades, startingEquity, (t) => crossBucket(t.crossCount));
}
