import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKTEST_PARAMS, runBacktest } from '@/lib/backtest/engine';
import { scenario, testParams, TEST_ACCOUNT } from '@/lib/backtest/fixtures';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';

/**
 * 시나리오 픽스처는 워밍업으로 롱 진입을 하나 만든다.
 * 진입가 128.00, 신호봉 ATR 2.16506, 확신 등급.
 *   leg0 128.0000 / leg1 126.7010 / stop 124.1029
 *   목표폭 3.5853 (leg0만 체결 시 TP 131.5853)
 *   청산가 50배 126.0800 / 10배 115.8400
 */
const ENTRY = 128.0;

/** 청산이 멀어 손절·물타기 경로를 검증할 수 있는 파라미터 */
function lowLeverage(over = {}) {
  return testParams({
    account: { ...TEST_ACCOUNT, leverage: 10 },
    ...over,
  });
}

function bar(open: number, high: number, low: number, close: number) {
  return { open, high, low, close };
}

/** 진입 직전 워밍업이 만드는 첫 트레이드를 제외하고 마지막 트레이드를 본다 */
function lastTrade(result: ReturnType<typeof runBacktest>) {
  return result.trades[result.trades.length - 1];
}

describe('체결 경로 — 시장가', () => {
  it('다음 캔들 시가에 체결된다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.5, ENTRY - 0.5, ENTRY),
      bar(ENTRY, 132.0, ENTRY - 0.5, 131.8),
    ]);
    const r = runBacktest({ ...s, params: lowLeverage() });
    const t = lastTrade(r);
    expect(t.direction).toBe('long');
    expect(t.averageEntryPrice).toBeCloseTo(ENTRY, 6);
  });

  it('슬리피지는 항상 불리한 방향이다 — 롱 진입가가 시가보다 높다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.5, ENTRY - 0.5, ENTRY),
      bar(ENTRY, 132.0, ENTRY - 0.5, 131.8),
    ]);
    const r = runBacktest({
      ...s,
      params: testParams({
        account: { ...TEST_ACCOUNT, leverage: 10, slippageRatePerSide: 0.001 },
      }),
    });
    expect(lastTrade(r).averageEntryPrice).toBeGreaterThan(ENTRY);
  });

  it('목표가에 닿으면 take-profit으로 청산된다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.5, ENTRY - 0.5, ENTRY),
      bar(ENTRY, 132.5, ENTRY - 0.2, 132.0),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.exitReason).toBe('take-profit');
    expect(t.netPnl).toBeGreaterThan(0);
    // leg0만 체결됐으므로 목표는 진입가 + 3.5853
    expect(t.exitPrice).toBeCloseTo(131.5853, 3);
  });

  it('손절가에 닿으면 stop-loss로 청산된다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 123.0, 123.5),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.exitReason).toBe('stop-loss');
    expect(t.netPnl).toBeLessThan(0);
  });

  it('같은 캔들에서 손절과 익절이 모두 닿으면 손절을 택한다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      // 고가가 목표(131.59)를 넘고 저가가 손절(124.10)을 깬다
      bar(ENTRY, 133.0, 123.0, 130.0),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.exitReason).toBe('stop-loss');
  });

  it('청산가에 닿으면 liquidation으로 청산되고 손실이 증거금을 넘지 않는다', () => {
    // 물타기 체결 후 평단 127.347, 청산가 125.437. 그 아래로 내려간다.
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 125.0, 125.3),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: testParams() }));
    expect(t.exitReason).toBe('liquidation');
    const margin = t.legs.reduce((sum, l) => sum + l.margin, 0);
    expect(t.netPnl).toBeGreaterThanOrEqual(-margin - 1e-6);
  });

  it('maxHoldBars를 넘기면 timeout으로 청산된다', () => {
    const flat = bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY);
    const s = scenario([flat, ...new Array(40).fill(flat)]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage({ maxHoldBars: 5 }) }));
    expect(t.exitReason).toBe('timeout');
  });

  it('데이터가 끝나도 포지션이 남아 있으면 end-of-data로 정리한다', () => {
    const flat = bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY);
    const s = scenario([flat, flat, flat]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.exitReason).toBe('end-of-data');
  });
});

describe('물타기 레그', () => {
  it('가격이 레그에 닿지 않으면 leg는 1개다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, 132.5, 127.5, 132.0),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.legs).toHaveLength(1);
  });

  it('레그 가격(126.70)에 닿으면 체결되어 평단이 내려간다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 126.0, 127.0),
      bar(127.0, 132.0, 126.9, 131.5),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.legs).toHaveLength(2);
    expect(t.averageEntryPrice).toBeLessThan(ENTRY);
    expect(t.averageEntryPrice).toBeGreaterThan(126.7);
  });

  it('레그 체결로 평단이 내려가면 청산가도 함께 내려가 청산을 피한다', () => {
    // 레그 체결 전 청산가는 126.08, 체결 후 평단 127.347 기준 125.437로 내려간다.
    // 저가 125.5는 체결 전 기준으로는 청산이지만 체결 후 기준으로는 아니다.
    // 캔들 진입 시점에 청산가를 한 번만 계산하면 이 차이를 놓친다.
    const survives = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 125.5, 125.8),
    ]);
    const liquidated = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 125.0, 125.3),
    ]);
    const a = lastTrade(runBacktest({ ...survives, params: testParams() }));
    const b = lastTrade(runBacktest({ ...liquidated, params: testParams() }));
    expect(a.legs).toHaveLength(2);
    expect(a.exitReason).not.toBe('liquidation');
    expect(b.exitReason).toBe('liquidation');
  });

  it('레그 체결로 평단이 내려가면 목표가도 함께 내려간다', () => {
    const withLeg = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, ENTRY + 0.2, 126.0, 127.0),
      bar(127.0, 132.0, 126.9, 131.5),
    ]);
    const withoutLeg = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, 132.5, 127.5, 132.0),
    ]);
    const a = lastTrade(runBacktest({ ...withLeg, params: lowLeverage() }));
    const b = lastTrade(runBacktest({ ...withoutLeg, params: lowLeverage() }));
    expect(a.exitPrice).toBeLessThan(b.exitPrice);
  });
});

describe('물타기 on/off (ladderEnabled)', () => {
  // 6개월 백테스트에서 실측 손익비가 이론의 25~30%에 그쳤다. 가설은 물타기의
  // 비대칭이다 — 이기는 거래는 1차 진입만 체결된 채 익절하고, 지는 거래는
  // 물타기까지 전량 체결된 뒤 손절난다. 레그 1개로 돌려야 가설을 검증할 수 있다.
  const touchesLeg = scenario([
    bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
    bar(ENTRY, ENTRY + 0.2, 126.0, 127.0),
    bar(127.0, 132.0, 126.9, 131.5),
  ]);

  it('기본값은 물타기 사용이다', () => {
    expect(DEFAULT_BACKTEST_PARAMS.ladderEnabled).toBe(true);
  });

  it('끄면 레그 가격에 닿아도 레그가 하나뿐이다', () => {
    const on = lastTrade(runBacktest({ ...touchesLeg, params: lowLeverage() }));
    const off = lastTrade(
      runBacktest({ ...touchesLeg, params: lowLeverage({ ladderEnabled: false }) }),
    );
    expect(on.legs).toHaveLength(2);
    expect(off.legs).toHaveLength(1);
  });

  it('끄면 평단이 1차 진입가 그대로다', () => {
    const off = lastTrade(
      runBacktest({ ...touchesLeg, params: lowLeverage({ ladderEnabled: false }) }),
    );
    expect(off.averageEntryPrice).toBeCloseTo(ENTRY, 6);
  });

  it('끄면 1차 진입만으로 익절한 거래의 순이익이 더 크다', () => {
    // 비대칭의 정체. 물타기를 켜면 리스크 예산이 레그들에 나뉘어 1차 진입
    // 명목가가 작아진다. 2차가 안 채워진 채 익절하면 절반짜리로 버는데,
    // 손절은 전량 체결된 뒤에 맞으므로 온전히 잃는다.
    const onlyFirstLegFills = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, 132.5, 127.5, 132.0),
    ]);
    const on = lastTrade(runBacktest({ ...onlyFirstLegFills, params: lowLeverage() }));
    const off = lastTrade(
      runBacktest({
        ...onlyFirstLegFills,
        params: lowLeverage({ ladderEnabled: false }),
      }),
    );
    expect(on.exitReason).toBe('take-profit');
    expect(off.exitReason).toBe('take-profit');
    expect(off.netPnl).toBeGreaterThan(on.netPnl);
  });
});

describe('지정가 진입 (ADR-015)', () => {
  /** 지정가는 신호봉 종가(128.00)에 걸린다. 롱은 가격이 내려와야 체결된다. */
  it('되돌림이 오지 않으면 체결되지 않고 트레이드가 생기지 않는다', () => {
    const s = scenario([
      bar(129.0, 131.0, 128.5, 130.5),
      bar(130.5, 133.0, 130.0, 132.5),
      bar(132.5, 135.0, 132.0, 134.5),
      bar(134.5, 137.0, 134.0, 136.5),
    ]);
    const r = runBacktest({
      ...s,
      params: lowLeverage({ entryType: 'limit', limitValidBars: 3 }),
    });
    // 워밍업이 만든 첫 트레이드만 남고, 이번 신호는 미체결이다
    expect(r.signalCount).toBeGreaterThan(0);
    expect(r.fillRate).toBeLessThan(1);
    const entered = r.trades.some((t) => Math.abs(t.averageEntryPrice - ENTRY) < 0.01);
    expect(entered).toBe(false);
  });

  it('되돌림이 오면 지정가 그대로 체결되고 슬리피지가 없다', () => {
    const s = scenario([
      bar(129.0, 130.0, 127.5, 128.5),
      bar(128.5, 133.0, 128.0, 132.5),
    ]);
    const r = runBacktest({
      ...s,
      params: testParams({
        account: { ...TEST_ACCOUNT, leverage: 10, slippageRatePerSide: 0.001 },
        entryType: 'limit',
        limitValidBars: 3,
      }),
    });
    const t = lastTrade(r);
    // 슬리피지를 켰는데도 정확히 지정가에 체결된다
    expect(t.averageEntryPrice).toBeCloseTo(ENTRY, 6);
  });

  it('시장가와 지정가는 signalCount가 같고 fillRate만 다르다', () => {
    const s = scenario([
      bar(129.0, 131.0, 128.5, 130.5),
      bar(130.5, 133.0, 130.0, 132.5),
      bar(132.5, 135.0, 132.0, 134.5),
      bar(134.5, 137.0, 134.0, 136.5),
    ]);
    const market = runBacktest({ ...s, params: lowLeverage({ entryType: 'market' }) });
    const limit = runBacktest({
      ...s,
      params: lowLeverage({ entryType: 'limit', limitValidBars: 3 }),
    });
    expect(limit.signalCount).toBe(market.signalCount);
    expect(limit.fillRate).toBeLessThan(market.fillRate);
  });
});

describe('비용 반영 (ADR-007)', () => {
  it('수수료가 트레이드마다 부과된다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, 132.5, ENTRY - 0.2, 132.0),
    ]);
    const t = lastTrade(runBacktest({ ...s, params: lowLeverage() }));
    expect(t.fees).toBeGreaterThan(0);
    expect(t.netPnl).toBeCloseTo(t.grossPnl - t.fees - t.funding, 6);
  });

  it('8시간 경계를 넘겨 보유하면 펀딩이 부과된다', () => {
    const flat = bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY);
    // 진입은 15:10 UTC. 16:00 경계를 넘기려면 10봉 이상 보유해야 한다.
    const s = scenario(new Array(20).fill(flat));
    const t = lastTrade(
      runBacktest({ ...s, params: lowLeverage({ fundingRatePerInterval: 0.001 }) }),
    );
    expect(t.funding).not.toBe(0);
  });

  it('경계를 넘지 않으면 펀딩이 0이다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY),
      bar(ENTRY, 132.5, ENTRY - 0.2, 132.0),
    ]);
    const t = lastTrade(
      runBacktest({ ...s, params: lowLeverage({ fundingRatePerInterval: 0.001 }) }),
    );
    expect(t.funding).toBe(0);
  });

  it('롱은 펀딩이 양수일 때 지불한다 (funding > 0 = 비용)', () => {
    const flat = bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY);
    const s = scenario(new Array(20).fill(flat));
    const t = lastTrade(
      runBacktest({ ...s, params: lowLeverage({ fundingRatePerInterval: 0.001 }) }),
    );
    expect(t.direction).toBe('long');
    expect(t.funding).toBeGreaterThan(0);
  });
});

describe('서킷브레이커', () => {
  it('연속 손실 한도에 걸린 봉 수를 보고한다', () => {
    // 막힌 구간을 세지 않으면 "신호가 없었다"와 "막혀서 못 봤다"가
    // 구분되지 않는다. 6개월 백테스트가 3일치만 돌고 조용히 끝난 적이 있다.
    const flat = bar(ENTRY, ENTRY + 0.3, ENTRY - 0.3, ENTRY);
    const s = scenario(new Array(40).fill(flat));
    const r = runBacktest({
      ...s,
      params: lowLeverage({ entry: { ...DEFAULT_ENTRY_CONFIG, consecutiveLossLimit: 0 } }),
    });
    expect(r.haltedBars).toBeGreaterThan(0);
  });

  it('정상 구간에서는 막힌 봉이 없다', () => {
    const s = scenario([
      bar(ENTRY, ENTRY + 0.5, ENTRY - 0.5, ENTRY),
      bar(ENTRY, 132.0, ENTRY - 0.5, 131.8),
    ]);
    expect(runBacktest({ ...s, params: lowLeverage() }).haltedBars).toBe(0);
  });
});

describe('반환 구조', () => {
  it('신호가 없으면 트레이드도 없고 예외가 나지 않는다', () => {
    const flat = Array.from({ length: 100 }, (_, i) => ({
      openTime: i * 300_000,
      open: 100,
      high: 100.1,
      low: 99.9,
      close: 100,
      volume: 1000,
      closed: true,
    }));
    const r = runBacktest({
      candles5m: flat,
      candles15m: flat,
      params: testParams(),
    });
    expect(r.totalTrades).toBe(0);
    expect(r.signalCount).toBe(0);
    expect(r.fillRate).toBe(0);
    expect(r.finalEquity).toBe(TEST_ACCOUNT.equity);
  });

  it('빈 입력에서도 예외가 나지 않는다', () => {
    const r = runBacktest({ candles5m: [], candles15m: [], params: testParams() });
    expect(r.totalTrades).toBe(0);
    expect(r.equityCurve).toEqual([]);
  });
});
