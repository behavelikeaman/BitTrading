import type { Trade } from '@/types';

export type DivergenceKind =
  | 'missing-in-backtest'
  | 'missing-in-paper'
  | 'direction'
  | 'conviction'
  | 'entry-price'
  | 'exit-reason'
  | 'exit-price';

export interface Divergence {
  kind: DivergenceKind;
  at: number;
  paper: string;
  backtest: string;
  /** 가격 불일치일 때의 상대 차이 */
  deltaPct?: number;
}

export interface DivergenceReport {
  comparedTrades: number;
  divergences: Divergence[];
  /** 양쪽에 모두 있는 트레이드 비율 */
  matchRate: number;
}

export interface DivergenceTolerance {
  /** 가격 허용오차 (비율). 기본 0.0005 = 0.05% */
  pricePct?: number;
}

const DEFAULT_PRICE_TOLERANCE = 0.0005;

function relDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? 0 : Math.abs(a - b) / base;
}

/**
 * 페이퍼와 백테스트의 트레이드를 대조한다.
 *
 * **진입 시각으로 짝을 맞춘다.** 배열 순서로 맞추면 한쪽에 트레이드가 하나만
 * 더 있어도 그 뒤가 전부 밀려 실제와 무관한 불일치가 쏟아진다.
 *
 * 가격은 허용오차를 둔다. 페이퍼는 Deepcoin, 백테스트는 Binance 데이터라
 * 미세한 차이가 정상이다 (ADR-003). 그러나 **방향·확신도·청산 사유는 허용오차
 * 없이 정확히 비교한다.** 이 값들이 다르면 가격 차이가 아니라 로직이 갈라진
 * 것이고, 그게 바로 이 검사가 찾는 대상이다 (ADR-020).
 */
export function compareTrades(
  paper: Trade[],
  backtest: Trade[],
  tolerance: DivergenceTolerance = {},
): DivergenceReport {
  const pricePct = tolerance.pricePct ?? DEFAULT_PRICE_TOLERANCE;
  const divergences: Divergence[] = [];

  const byEntry = new Map<number, Trade>();
  for (const t of backtest) byEntry.set(t.entryTime, t);

  let matched = 0;

  for (const p of paper) {
    const b = byEntry.get(p.entryTime);
    if (b === undefined) {
      divergences.push({
        kind: 'missing-in-backtest',
        at: p.entryTime,
        paper: `${p.direction} ${p.conviction} @ ${p.averageEntryPrice.toFixed(2)}`,
        backtest: '없음',
      });
      continue;
    }
    matched += 1;
    byEntry.delete(p.entryTime);

    if (p.direction !== b.direction) {
      divergences.push({
        kind: 'direction',
        at: p.entryTime,
        paper: p.direction,
        backtest: b.direction,
      });
    }
    if (p.conviction !== b.conviction) {
      divergences.push({
        kind: 'conviction',
        at: p.entryTime,
        paper: p.conviction,
        backtest: b.conviction,
      });
    }
    if (p.exitReason !== b.exitReason) {
      divergences.push({
        kind: 'exit-reason',
        at: p.entryTime,
        paper: p.exitReason,
        backtest: b.exitReason,
      });
    }

    const entryDelta = relDiff(p.averageEntryPrice, b.averageEntryPrice);
    if (entryDelta > pricePct) {
      divergences.push({
        kind: 'entry-price',
        at: p.entryTime,
        paper: p.averageEntryPrice.toFixed(2),
        backtest: b.averageEntryPrice.toFixed(2),
        deltaPct: entryDelta,
      });
    }

    const exitDelta = relDiff(p.exitPrice, b.exitPrice);
    if (exitDelta > pricePct) {
      divergences.push({
        kind: 'exit-price',
        at: p.entryTime,
        paper: p.exitPrice.toFixed(2),
        backtest: b.exitPrice.toFixed(2),
        deltaPct: exitDelta,
      });
    }
  }

  for (const b of byEntry.values()) {
    divergences.push({
      kind: 'missing-in-paper',
      at: b.entryTime,
      paper: '없음',
      backtest: `${b.direction} ${b.conviction} @ ${b.averageEntryPrice.toFixed(2)}`,
    });
  }

  const total = paper.length + byEntry.size;
  divergences.sort((a, b) => a.at - b.at);

  return {
    comparedTrades: total,
    divergences,
    matchRate: total === 0 ? 1 : matched / total,
  };
}
