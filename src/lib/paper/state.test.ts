import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  parseState,
  pendingCandles,
  shouldProcess,
  PAPER_STATE_VERSION,
} from '@/lib/paper/state';
import type { Candle } from '@/types';

const NOW = Date.UTC(2026, 0, 5, 12, 0, 0);
const MS_5M = 300_000;

function candle(openTime: number, closed = true): Candle {
  return { openTime, open: 100, high: 101, low: 99, close: 100, volume: 1, closed };
}

describe('createInitialState', () => {
  it('자본과 시각으로 초기 상태를 만든다', () => {
    const s = createInitialState(5000, NOW);
    expect(s.version).toBe(PAPER_STATE_VERSION);
    expect(s.equity).toBe(5000);
    expect(s.startingEquity).toBe(5000);
    expect(s.position).toBeNull();
    expect(s.pending).toBeNull();
    expect(s.lastCandleTime).toBe(0);
  });
});

describe('shouldProcess', () => {
  const state = { ...createInitialState(5000, NOW), lastCandleTime: NOW };

  it('미확정봉은 처리하지 않는다', () => {
    expect(shouldProcess(state, candle(NOW + MS_5M, false))).toBe(false);
  });

  it('이미 처리한 시각은 건너뛴다', () => {
    expect(shouldProcess(state, candle(NOW))).toBe(false);
  });

  it('과거 캔들은 건너뛴다', () => {
    expect(shouldProcess(state, candle(NOW - MS_5M))).toBe(false);
  });

  it('다음 확정봉은 처리한다', () => {
    expect(shouldProcess(state, candle(NOW + MS_5M))).toBe(true);
  });
});

describe('pendingCandles', () => {
  it('밀린 캔들을 오름차순으로 전부 돌려준다', () => {
    const state = { ...createInitialState(5000, NOW), lastCandleTime: NOW };
    const input = [
      candle(NOW + 3 * MS_5M),
      candle(NOW),
      candle(NOW + MS_5M),
      candle(NOW + 2 * MS_5M),
    ];
    const out = pendingCandles(state, input);
    expect(out.map((c) => c.openTime)).toEqual([
      NOW + MS_5M,
      NOW + 2 * MS_5M,
      NOW + 3 * MS_5M,
    ]);
  });

  it('미확정봉을 제외한다', () => {
    const state = createInitialState(5000, NOW);
    const out = pendingCandles(state, [candle(NOW), candle(NOW + MS_5M, false)]);
    expect(out).toHaveLength(1);
  });
});

describe('parseState — 방어 (throw 금지)', () => {
  it('정상 상태를 JSON 왕복해도 보존된다', () => {
    const s = createInitialState(5000, NOW);
    const round = parseState(JSON.parse(JSON.stringify(s)));
    expect(round).toEqual(s);
  });

  it('버전이 다르면 null이다', () => {
    const s = { ...createInitialState(5000, NOW), version: 999 };
    expect(parseState(s)).toBeNull();
  });

  it('필수 필드가 없으면 null이다', () => {
    const s = createInitialState(5000, NOW) as Record<string, unknown>;
    delete s.equity;
    expect(parseState(s)).toBeNull();
  });

  it('guard가 깨져 있으면 null이다', () => {
    const s = { ...createInitialState(5000, NOW), guard: { consecutiveLosses: 'x' } };
    expect(parseState(s)).toBeNull();
  });

  it('null·문자열·배열·숫자 입력에도 throw하지 않고 null을 반환한다', () => {
    for (const bad of [null, undefined, 'x', 42, [], true]) {
      expect(() => parseState(bad)).not.toThrow();
      expect(parseState(bad)).toBeNull();
    }
  });

  it('position이 깨져 있으면 null이다', () => {
    const s = { ...createInitialState(5000, NOW), position: { direction: 'long' } };
    expect(parseState(s)).toBeNull();
  });

  it('updatedAt이 없는 구버전 형태도 startedAt으로 보정한다', () => {
    const s = createInitialState(5000, NOW) as Record<string, unknown>;
    delete s.updatedAt;
    expect(parseState(s)?.updatedAt).toBe(NOW);
  });
});
