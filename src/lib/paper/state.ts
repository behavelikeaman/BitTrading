import type { Candle, Conviction, Direction, GuardState } from '@/types';
import type { OpenPosition, PendingOrder } from '@/lib/execution/types';

/**
 * 저장 형식이 바뀌면 올린다. 다르면 parseState가 null을 반환한다.
 *
 * v2: 포지션에 setup(셋업 종류)이 추가됐다 (ADR-022). 채점 기준 자체가
 * 바뀌었으므로 v1 상태를 이어서 쓰면 이전 규칙으로 잡은 포지션을 새 규칙의
 * 성적에 섞게 된다. 버리고 새로 시작하는 편이 맞다.
 */
export const PAPER_STATE_VERSION = 2;

export interface PaperState {
  version: number;
  startedAt: number;
  equity: number;
  startingEquity: number;
  guard: GuardState;
  pending: PendingOrder | null;
  position: OpenPosition | null;
  /** 마지막으로 소화한 확정봉 openTime. 중복 처리를 막는다. */
  lastCandleTime: number;
  signalCount: number;
  /** UTC 일자. 바뀌면 guard의 일손익을 초기화한다. */
  currentDay: number;
  /** 마지막으로 상태를 저장한 시각. 티커가 멈췄는지 판단용. */
  updatedAt: number;
}

export function createInitialState(equity: number, nowMs: number): PaperState {
  return {
    version: PAPER_STATE_VERSION,
    startedAt: nowMs,
    equity,
    startingEquity: equity,
    guard: { consecutiveLosses: 0, dailyPnlPct: 0 },
    pending: null,
    position: null,
    lastCandleTime: 0,
    signalCount: 0,
    currentDay: -1,
    updatedAt: nowMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 저장된 JSON을 검증해 PaperState로 만든다.
 *
 * **throw 하지 않는다.** 파일이 깨졌을 때 앱이 죽으면 복구 수단이 없어진다.
 * null을 돌려주면 호출부가 "새로 시작"으로 폴백할 수 있다.
 */
export function parseState(raw: unknown): PaperState | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== PAPER_STATE_VERSION) return null;

  const required = [
    'startedAt',
    'equity',
    'startingEquity',
    'lastCandleTime',
    'signalCount',
    'currentDay',
  ] as const;
  for (const key of required) {
    if (!num(raw[key])) return null;
  }

  const guard = raw.guard;
  if (!isRecord(guard) || !num(guard.consecutiveLosses) || !num(guard.dailyPnlPct)) {
    return null;
  }

  const pending = raw.pending === null ? null : (raw.pending as PendingOrder);
  const position = raw.position === null ? null : (raw.position as OpenPosition);
  if (pending !== null && (!isRecord(pending) || !num(pending.fromTime))) return null;
  if (position !== null && (!isRecord(position) || !num(position.entryTime))) {
    return null;
  }

  return {
    version: PAPER_STATE_VERSION,
    startedAt: raw.startedAt as number,
    equity: raw.equity as number,
    startingEquity: raw.startingEquity as number,
    guard: {
      consecutiveLosses: guard.consecutiveLosses,
      dailyPnlPct: guard.dailyPnlPct,
    },
    pending,
    position,
    lastCandleTime: raw.lastCandleTime as number,
    signalCount: raw.signalCount as number,
    currentDay: raw.currentDay as number,
    updatedAt: num(raw.updatedAt) ? raw.updatedAt : (raw.startedAt as number),
  };
}

/**
 * 이 캔들을 처리해야 하는가.
 *
 * 폴링이 같은 캔들을 여러 번 가져오거나 거래소가 과거 캔들을 다시 주는
 * 경우를 막는다. 미확정봉도 여기서 걸러낸다 (ADR-006).
 */
export function shouldProcess(state: PaperState, candle: Candle): boolean {
  return candle.closed && candle.openTime > state.lastCandleTime;
}

/** 아직 소화하지 않은 캔들만 오름차순으로 골라낸다. */
export function pendingCandles(state: PaperState, candles: Candle[]): Candle[] {
  return candles
    .filter((c) => shouldProcess(state, c))
    .sort((a, b) => a.openTime - b.openTime);
}

export interface PaperSignalRecord {
  direction: Direction;
  conviction: Conviction;
  score: number;
  price: number;
}
