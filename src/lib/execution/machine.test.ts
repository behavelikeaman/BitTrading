import { describe, expect, it } from 'vitest';
import {
  createPendingOrder,
  forceClose,
  stepExecution,
} from '@/lib/execution/machine';

const MS_5M = 300_000;
import { toExecutionConfig } from '@/lib/backtest/engine';
import { testParams, TEST_ACCOUNT } from '@/lib/backtest/fixtures';
import type { ExecutionConfig, OpenPosition } from '@/lib/execution/types';
import type { Candle, Signal } from '@/types';

const CONFIG: ExecutionConfig = toExecutionConfig(
  testParams({ account: { ...TEST_ACCOUNT, leverage: 10 } }),
);

const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

function candle(
  openTime: number,
  o: number,
  h: number,
  l: number,
  c: number,
): Candle {
  return { openTime, open: o, high: h, low: l, close: c, volume: 1000, closed: true };
}

/** 진입가 100, 손절 96, 목표폭 6, 물타기 레그 98 */
function position(over: Partial<OpenPosition> = {}): OpenPosition {
  return {
    direction: 'long',
    conviction: 'high',
    score: 8,
    entryTime: T0,
    filled: [
      { index: 0, price: 100, qty: 1, notional: 100, margin: 10 },
    ],
    pending: [{ index: 1, price: 98, qty: 1, notional: 98, margin: 9.8 }],
    stopPrice: 96,
    targetWidth: 6,
    fees: 0.04,
    funding: 0,
    equityAtEntry: 5000,
    lastFundingBoundary: Math.floor(T0 / (8 * 60 * 60 * 1000)),
    ...over,
  };
}

describe('stepExecution — 순수성', () => {
  it('같은 입력을 두 번 넣으면 같은 출력이 나온다', () => {
    const input = {
      candle: candle(T0 + MS_5M, 100, 101, 97.5, 99),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    };
    const a = stepExecution(input);
    const b = stepExecution(input);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('입력 객체를 변경하지 않는다', () => {
    const pos = position();
    const before = JSON.stringify(pos);
    stepExecution({
      candle: candle(T0 + MS_5M, 100, 101, 97.5, 99),
      pending: null,
      position: pos,
      equity: 5000,
      config: CONFIG,
    });
    expect(JSON.stringify(pos)).toBe(before);
  });

  it('레그가 체결돼도 원본 filled 배열이 변하지 않는다', () => {
    const pos = position();
    const originalLegCount = pos.filled.length;
    const out = stepExecution({
      candle: candle(T0 + MS_5M, 100, 101, 97.5, 99),
      pending: null,
      position: pos,
      equity: 5000,
      config: CONFIG,
    });
    expect(pos.filled).toHaveLength(originalLegCount);
    expect(out.position?.filled).toHaveLength(2);
  });
});

describe('stepExecution — 직렬화 안전성 (ADR-017)', () => {
  it('JSON 왕복한 상태를 넣어도 같은 결과가 나온다', () => {
    const pos = position();
    const c = candle(T0 + MS_5M, 100, 101, 97.5, 99);
    const direct = stepExecution({
      candle: c,
      pending: null,
      position: pos,
      equity: 5000,
      config: CONFIG,
    });
    const roundTripped = stepExecution({
      candle: c,
      pending: null,
      position: JSON.parse(JSON.stringify(pos)) as OpenPosition,
      equity: 5000,
      config: CONFIG,
    });
    expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(direct));
  });

  it('출력 상태가 JSON으로 손실 없이 왕복된다', () => {
    const out = stepExecution({
      candle: candle(T0 + MS_5M, 100, 101, 97.5, 99),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    });
    const round = JSON.parse(JSON.stringify(out.position)) as OpenPosition;
    expect(round).toEqual(out.position);
  });
});

describe('stepExecution — 시각 기반 판정 (ADR-016)', () => {
  it('보유 기간을 인덱스가 아니라 시각으로 잰다', () => {
    const config = { ...CONFIG, maxHoldBars: 5 };
    // 캔들이 중간에 빠져 5봉치 시간이 지난 상황
    const late = candle(T0 + 5 * MS_5M, 100, 100.5, 99.5, 100);
    const out = stepExecution({
      candle: late,
      pending: null,
      position: position(),
      equity: 5000,
      config,
    });
    expect(out.trade?.exitReason).toBe('timeout');
  });

  it('시간이 덜 지났으면 타임아웃되지 않는다', () => {
    const config = { ...CONFIG, maxHoldBars: 5 };
    const early = candle(T0 + 4 * MS_5M, 100, 100.5, 99.5, 100);
    const out = stepExecution({
      candle: early,
      pending: null,
      position: position(),
      equity: 5000,
      config,
    });
    expect(out.trade).toBeNull();
    expect(out.position).not.toBeNull();
  });
});

describe('stepExecution — 체결 규칙 보존', () => {
  it('손절과 익절이 같은 캔들에 닿으면 손절을 택한다', () => {
    const out = stepExecution({
      candle: candle(T0 + MS_5M, 100, 107, 95, 100),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    });
    expect(out.trade?.exitReason).toBe('stop-loss');
  });

  it('목표가에만 닿으면 익절한다', () => {
    const out = stepExecution({
      candle: candle(T0 + MS_5M, 100, 107, 99.5, 106),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    });
    expect(out.trade?.exitReason).toBe('take-profit');
    expect(out.trade?.netPnl).toBeGreaterThan(0);
  });

  it('레그 체결로 평단이 내려가면 목표가도 내려간다', () => {
    const withLeg = stepExecution({
      candle: candle(T0 + MS_5M, 100, 100.5, 97.5, 98.5),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    });
    expect(withLeg.position?.filled).toHaveLength(2);
    const avg = 198 / 2;
    // 평단 99, 목표폭 6 -> 105
    const exit = stepExecution({
      candle: candle(T0 + 2 * MS_5M, 98.5, 106, 98, 105),
      pending: null,
      position: withLeg.position,
      equity: 5000,
      config: CONFIG,
    });
    expect(exit.trade?.exitReason).toBe('take-profit');
    expect(exit.trade?.exitPrice).toBeCloseTo(avg + 6, 6);
  });

  it('아무 레벨에도 닿지 않으면 포지션이 유지된다', () => {
    const out = stepExecution({
      candle: candle(T0 + MS_5M, 100, 101, 99, 100),
      pending: null,
      position: position(),
      equity: 5000,
      config: CONFIG,
    });
    expect(out.trade).toBeNull();
    expect(out.position).not.toBeNull();
  });
});

describe('createPendingOrder', () => {
  function signal(over: Partial<Signal> = {}): Signal {
    return {
      direction: 'long',
      conviction: 'high',
      score: 8,
      items: [],
      blockers: [],
      indicators: {
        ema12: 100,
        sma20: 99,
        bbUpper: 102,
        bbLower: 96,
        bbWidth: 0.06,
        atr14: 2,
        adx14: 25,
        volumeSma20: 1000,
      },
      ...over,
    };
  }

  it('시각 기준 필드를 채운다', () => {
    const order = createPendingOrder({
      signal: signal(),
      candle: candle(T0, 99, 101, 98, 100),
      limitValidBars: 3,
      barMs: MS_5M,
    })!;
    expect(order.fromTime).toBe(T0 + MS_5M);
    expect(order.expiresAtTime).toBe(T0 + 3 * MS_5M);
    expect(order.limitPrice).toBe(100);
    expect(order.atrAtSignal).toBe(2);
  });

  it('진입 불가 신호면 null이다', () => {
    const c = candle(T0, 99, 101, 98, 100);
    const base = { candle: c, limitValidBars: 3, barMs: MS_5M };
    expect(createPendingOrder({ ...base, signal: signal({ conviction: 'none' }) })).toBeNull();
    expect(createPendingOrder({ ...base, signal: signal({ direction: null }) })).toBeNull();
    expect(createPendingOrder({ ...base, signal: signal({ indicators: null }) })).toBeNull();
  });
});

describe('forceClose', () => {
  it('현재 종가로 지정한 사유로 정리한다', () => {
    const trade = forceClose(
      position(),
      candle(T0 + MS_5M, 100, 101, 99, 100.5),
      CONFIG,
      'end-of-data',
    );
    expect(trade.exitReason).toBe('end-of-data');
    expect(trade.exitPrice).toBe(100.5);
    expect(trade.exitTime).toBe(T0 + 2 * MS_5M);
  });
});
