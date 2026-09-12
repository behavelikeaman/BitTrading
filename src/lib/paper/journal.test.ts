import { describe, expect, it } from 'vitest';
import {
  parseJsonl,
  signalCountFromJournal,
  toJsonl,
  tradesFromJournal,
  type JournalEntry,
} from '@/lib/paper/journal';
import type { Trade } from '@/types';

function trade(netPnl: number): Trade {
  return {
    entryTime: 1,
    exitTime: 2,
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
    grossPnl: netPnl,
    fees: 0,
    funding: 0,
    netPnl,
    netPnlPct: 0.01,
  };
}

const ENTRIES: JournalEntry[] = [
  { type: 'signal', at: 1, signal: { direction: 'long', conviction: 'high', score: 3, price: 100 } },
  { type: 'trade', at: 2, trade: trade(10) },
  { type: 'note', at: 3, note: '티커 재시작' },
];

describe('toJsonl / parseJsonl', () => {
  it('왕복해도 보존된다', () => {
    expect(parseJsonl(toJsonl(ENTRIES))).toEqual(ENTRIES);
  });

  it('빈 배열은 빈 문자열이고 다시 빈 배열이다', () => {
    expect(toJsonl([])).toBe('');
    expect(parseJsonl('')).toEqual([]);
  });
});

describe('parseJsonl — 손상 복구', () => {
  it('마지막 줄이 잘려도 앞줄들을 살린다', () => {
    const raw = toJsonl(ENTRIES) + '{"type":"trade","at":4,"tra';
    const out = parseJsonl(raw);
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe('signal');
  });

  it('중간에 깨진 줄이 있어도 나머지를 살린다', () => {
    const lines = toJsonl(ENTRIES).split('\n');
    lines.splice(1, 0, '{{{깨진줄');
    const out = parseJsonl(lines.join('\n'));
    expect(out).toHaveLength(3);
  });

  it('형식이 맞지 않는 JSON은 걸러낸다', () => {
    const raw = '{"foo":1}\n{"type":"note","at":5,"note":"ok"}';
    const out = parseJsonl(raw);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('ok');
  });

  it('공백 줄을 건너뛴다', () => {
    expect(parseJsonl('\n\n  \n')).toEqual([]);
  });
});

describe('집계', () => {
  it('트레이드만 뽑는다', () => {
    expect(tradesFromJournal(ENTRIES)).toHaveLength(1);
  });

  it('신호 수를 센다 — 체결되지 않은 신호도 포함한다', () => {
    expect(signalCountFromJournal(ENTRIES)).toBe(1);
  });
});
