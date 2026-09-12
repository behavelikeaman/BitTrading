import type { Trade } from '@/types';
import type { PaperSignalRecord } from '@/lib/paper/state';

export interface JournalEntry {
  type: 'trade' | 'signal' | 'note';
  at: number;
  trade?: Trade;
  /** 진입하지 못한 신호도 기록한다. 체결률을 계산해야 한다. */
  signal?: PaperSignalRecord;
  note?: string;
}

export function toJsonl(entries: JournalEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
}

/**
 * JSONL을 파싱한다.
 *
 * **깨진 줄은 건너뛰고 나머지를 살린다.** 프로세스가 쓰는 도중 죽으면
 * 마지막 줄이 잘릴 수 있는데, 그것 때문에 전체 일지를 잃으면 안 된다.
 */
export function parseJsonl(raw: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as JournalEntry;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.at === 'number' &&
        (parsed.type === 'trade' || parsed.type === 'signal' || parsed.type === 'note')
      ) {
        out.push(parsed);
      }
    } catch {
      // 잘린 줄. 건너뛴다.
    }
  }
  return out;
}

/** 일지에서 체결된 트레이드만 뽑는다. */
export function tradesFromJournal(entries: JournalEntry[]): Trade[] {
  return entries
    .filter((e) => e.type === 'trade' && e.trade !== undefined)
    .map((e) => e.trade as Trade);
}

/** 일지에 기록된 신호 수. 체결률 계산에 쓴다. */
export function signalCountFromJournal(entries: JournalEntry[]): number {
  return entries.filter((e) => e.type === 'signal').length;
}
