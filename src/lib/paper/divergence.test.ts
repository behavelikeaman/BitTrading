import { describe, expect, it } from 'vitest';
import { compareTrades } from '@/lib/paper/divergence';
import type { Trade } from '@/types';

function trade(over: Partial<Trade> = {}): Trade {
  return {
    entryTime: 1000,
    exitTime: 2000,
    direction: 'long',
    conviction: 'high',
    score: 3,
    setup: 'trend-pullback',
    bandState: 'expanded',
    crossCount: 1,
    plannedRisk: 100,
    legs: [],
    averageEntryPrice: 100,
    exitPrice: 101,
    exitReason: 'take-profit',
    grossPnl: 1,
    fees: 0,
    funding: 0,
    netPnl: 1,
    netPnlPct: 0.001,
    ...over,
  };
}

describe('compareTrades — 일치', () => {
  it('완전히 같으면 불일치 0, matchRate 1', () => {
    const t = [trade(), trade({ entryTime: 3000 })];
    const r = compareTrades(t, t);
    expect(r.divergences).toHaveLength(0);
    expect(r.matchRate).toBe(1);
    expect(r.comparedTrades).toBe(2);
  });

  it('양쪽 모두 비어 있으면 불일치 0, 예외 없음', () => {
    const r = compareTrades([], []);
    expect(r.divergences).toHaveLength(0);
    expect(r.comparedTrades).toBe(0);
    expect(r.matchRate).toBe(1);
  });
});

describe('compareTrades — 진입 시각으로 짝을 맞춘다', () => {
  it('배열 순서가 달라도 짝이 맞는다', () => {
    const a = [trade({ entryTime: 1000 }), trade({ entryTime: 2000 })];
    const b = [trade({ entryTime: 2000 }), trade({ entryTime: 1000 })];
    expect(compareTrades(a, b).divergences).toHaveLength(0);
  });

  it('한쪽에 하나 더 있어도 나머지는 밀리지 않는다', () => {
    const paper = [
      trade({ entryTime: 1000 }),
      trade({ entryTime: 2000 }),
      trade({ entryTime: 3000 }),
    ];
    const backtest = [trade({ entryTime: 2000 }), trade({ entryTime: 3000 })];
    const r = compareTrades(paper, backtest);
    // 1000만 빠지고 나머지 둘은 정상 일치해야 한다
    expect(r.divergences).toHaveLength(1);
    expect(r.divergences[0].kind).toBe('missing-in-backtest');
    expect(r.divergences[0].at).toBe(1000);
  });
});

describe('compareTrades — 누락', () => {
  it('페이퍼에만 있으면 missing-in-backtest', () => {
    const r = compareTrades([trade()], []);
    expect(r.divergences[0].kind).toBe('missing-in-backtest');
    expect(r.matchRate).toBe(0);
  });

  it('백테스트에만 있으면 missing-in-paper', () => {
    const r = compareTrades([], [trade()]);
    expect(r.divergences[0].kind).toBe('missing-in-paper');
  });
});

describe('compareTrades — 로직 불일치 (허용오차 없음)', () => {
  it('방향이 다르면 direction', () => {
    const r = compareTrades([trade({ direction: 'long' })], [trade({ direction: 'short' })]);
    expect(r.divergences.some((d) => d.kind === 'direction')).toBe(true);
  });

  it('확신도가 다르면 conviction', () => {
    const r = compareTrades(
      [trade({ conviction: 'high' })],
      [trade({ conviction: 'medium' })],
    );
    expect(r.divergences.some((d) => d.kind === 'conviction')).toBe(true);
  });

  it('청산 사유가 다르면 exit-reason', () => {
    const r = compareTrades(
      [trade({ exitReason: 'take-profit' })],
      [trade({ exitReason: 'stop-loss' })],
    );
    expect(r.divergences.some((d) => d.kind === 'exit-reason')).toBe(true);
  });
});

describe('compareTrades — 가격 허용오차', () => {
  it('허용오차 안이면 불일치가 아니다', () => {
    // 0.02% 차이 < 기본 허용오차 0.05%
    const r = compareTrades(
      [trade({ averageEntryPrice: 100 })],
      [trade({ averageEntryPrice: 100.02 })],
    );
    expect(r.divergences).toHaveLength(0);
  });

  it('허용오차 밖이면 entry-price와 deltaPct를 기록한다', () => {
    const r = compareTrades(
      [trade({ averageEntryPrice: 100 })],
      [trade({ averageEntryPrice: 101 })],
    );
    const d = r.divergences.find((x) => x.kind === 'entry-price')!;
    expect(d).toBeDefined();
    expect(d.deltaPct).toBeGreaterThan(0.009);
  });

  it('청산가 차이도 잡는다', () => {
    const r = compareTrades([trade({ exitPrice: 101 })], [trade({ exitPrice: 105 })]);
    expect(r.divergences.some((d) => d.kind === 'exit-price')).toBe(true);
  });

  it('허용오차를 설정으로 조절할 수 있다', () => {
    const strict = compareTrades(
      [trade({ averageEntryPrice: 100 })],
      [trade({ averageEntryPrice: 100.02 })],
      { pricePct: 0.0001 },
    );
    expect(strict.divergences.some((d) => d.kind === 'entry-price')).toBe(true);
  });
});

describe('compareTrades — 정렬', () => {
  it('불일치를 시각순으로 정렬한다', () => {
    const r = compareTrades(
      [trade({ entryTime: 3000 }), trade({ entryTime: 1000 })],
      [],
    );
    expect(r.divergences.map((d) => d.at)).toEqual([1000, 3000]);
  });
});
