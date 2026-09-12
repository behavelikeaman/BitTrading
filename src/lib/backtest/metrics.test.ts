import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  crossBucket,
  metricsByBandState,
  metricsByCrossCount,
  metricsByScore,
  metricsBySetup,
  scoreBucket,
} from '@/lib/backtest/metrics';
import type { Trade } from '@/types';

function trade(netPnl: number, over: Partial<Trade> = {}): Trade {
  return {
    entryTime: 0,
    exitTime: 1,
    direction: 'long',
    conviction: 'medium',
    score: 3,
    setup: 'trend-pullback',
    bandState: 'expanded',
    crossCount: 1,
    legs: [],
    plannedRisk: 100,
    averageEntryPrice: 100,
    exitPrice: 100,
    exitReason: netPnl >= 0 ? 'take-profit' : 'stop-loss',
    grossPnl: netPnl,
    fees: 0,
    funding: 0,
    netPnl,
    netPnlPct: netPnl / 5000,
    ...over,
  };
}

describe('computeMetrics — 빈 입력', () => {
  it('트레이드가 0개면 전 지표가 0이고 예외를 던지지 않는다', () => {
    const m = computeMetrics([], 5000);
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.profitFactor).toBeNull();
    expect(m.expectancy).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.finalEquity).toBe(5000);
    expect(m.equityCurve).toEqual([]);
  });
});

describe('computeMetrics — 기본 지표', () => {
  const trades = [trade(100), trade(-50), trade(100), trade(-50)];

  it('승률은 순손익이 양수인 비율이다', () => {
    expect(computeMetrics(trades, 5000).winRate).toBeCloseTo(0.5, 10);
  });

  it('손익비는 총이익 / |총손실| 이다', () => {
    expect(computeMetrics(trades, 5000).profitFactor).toBeCloseTo(200 / 100, 10);
  });

  it('기대값은 트레이드당 평균 순손익이다', () => {
    expect(computeMetrics(trades, 5000).expectancy).toBeCloseTo(100 / 4, 10);
  });

  it('최종 자본은 시작 자본에 순손익 합을 더한 값이다', () => {
    expect(computeMetrics(trades, 5000).finalEquity).toBeCloseTo(5100, 10);
  });

  it('손실이 하나도 없으면 손익비는 null이다 (JSON 직렬화 안전)', () => {
    expect(computeMetrics([trade(10), trade(20)], 5000).profitFactor).toBeNull();
  });

  it('profitFactor가 JSON 왕복 후에도 보존된다', () => {
    // Infinity는 JSON.stringify에서 null이 되어 "무한대"와 "값 없음"이
    // 구분되지 않는다. null을 쓰면 왕복해도 의미가 유지된다.
    const m = computeMetrics([trade(10), trade(20)], 5000);
    const roundTripped = JSON.parse(JSON.stringify(m)) as typeof m;
    expect(roundTripped.profitFactor).toBe(m.profitFactor);
  });
});

describe('computeMetrics — 낙폭과 연속 손실', () => {
  it('최대 낙폭은 고점 대비 최대 하락 비율이다', () => {
    // 5000 -> 6000 -> 4800 : 고점 6000에서 20% 하락
    const m = computeMetrics([trade(1000), trade(-1200)], 5000);
    expect(m.maxDrawdown).toBeCloseTo(0.2, 10);
  });

  it('최대 연속 손실을 센다', () => {
    const m = computeMetrics(
      [trade(-10), trade(-10), trade(50), trade(-10), trade(-10), trade(-10)],
      5000,
    );
    expect(m.maxConsecutiveLosses).toBe(3);
  });

  it('이익이 끼면 연속 손실이 끊긴다', () => {
    const m = computeMetrics([trade(-10), trade(50), trade(-10)], 5000);
    expect(m.maxConsecutiveLosses).toBe(1);
  });
});

describe('computeMetrics — 비용과 청산 집계', () => {
  it('수수료·펀딩을 합산한다', () => {
    const m = computeMetrics(
      [trade(10, { fees: 2, funding: 0.5 }), trade(-5, { fees: 3, funding: -0.2 })],
      5000,
    );
    expect(m.totalFees).toBeCloseTo(5, 10);
    expect(m.totalFunding).toBeCloseTo(0.3, 10);
  });

  it('청산 횟수를 센다', () => {
    const m = computeMetrics(
      [trade(-100, { exitReason: 'liquidation' }), trade(50), trade(-100, { exitReason: 'liquidation' })],
      5000,
    );
    expect(m.liquidationCount).toBe(2);
  });
});

describe('computeMetrics — 자본 곡선', () => {
  it('트레이드마다 한 점씩 쌓이고 마지막이 최종 자본과 같다', () => {
    const m = computeMetrics([trade(100), trade(-50)], 5000);
    expect(m.equityCurve).toHaveLength(2);
    expect(m.equityCurve[0].equity).toBeCloseTo(5100, 10);
    expect(m.equityCurve[1].equity).toBeCloseTo(5050, 10);
    expect(m.equityCurve[1].equity).toBeCloseTo(m.finalEquity, 10);
  });
});

describe('metricsBySetup — 셋업별로 따로 재야 경험칙이 검증된다', () => {
  function t(setup: Trade['setup'], netPnl: number, over: Partial<Trade> = {}): Trade {
    return { ...trade(netPnl, over), setup };
  }

  it('셋업별로 나눠 각각의 지표를 낸다', () => {
    const trades = [
      t('trend-pullback', 100),
      t('trend-pullback', -50),
      t('overextended-reversion', 300),
      t('overextended-reversion', 200),
    ];
    const by = metricsBySetup(trades, 5000);
    expect(by['trend-pullback']!.totalTrades).toBe(2);
    expect(by['trend-pullback']!.winRate).toBe(0.5);
    expect(by['overextended-reversion']!.totalTrades).toBe(2);
    expect(by['overextended-reversion']!.winRate).toBe(1);
  });

  it('트레이드가 없는 셋업은 결과에 담지 않는다', () => {
    const by = metricsBySetup([t('trend-pullback', 100)], 5000);
    expect(Object.keys(by)).toEqual(['trend-pullback']);
  });

  it('각 셋업의 자본곡선은 같은 시작 자본에서 출발한다', () => {
    // 셋업끼리 비교하려면 같은 출발점이어야 한다. 한쪽이 먼저 번 돈을
    // 다른 쪽 출발 자본에 얹으면 순서가 성적을 만든다.
    const by = metricsBySetup(
      [t('trend-pullback', 100), t('overextended-reversion', 100)],
      5000,
    );
    expect(by['trend-pullback']!.finalEquity).toBe(5100);
    expect(by['overextended-reversion']!.finalEquity).toBe(5100);
  });

  it('전체 지표와 셋업별 지표의 트레이드 수 합이 같다', () => {
    const trades = [
      t('trend-pullback', 100),
      t('overextended-reversion', -40),
      t('band-breakout', 10),
    ];
    const by = metricsBySetup(trades, 5000);
    const sum = Object.values(by).reduce((acc, m) => acc + m!.totalTrades, 0);
    expect(sum).toBe(computeMetrics(trades, 5000).totalTrades);
  });

  it('빈 목록은 빈 객체다', () => {
    expect(metricsBySetup([], 5000)).toEqual({});
  });
});

describe('computeMetrics — 실측 손익비와 필요 승률', () => {
  // 이론 손익비(목표 R배수)는 "전량 체결 뒤 목표에 닿는다"를 가정한다. 실제로는
  // 이기는 거래가 1차 진입만으로 익절되고 지는 거래는 물타기까지 다 맞고 손절나서
  // 평균 승과 평균 패가 비대칭이 된다. 그 비대칭을 반영한 필요 승률이 진짜 숫자다.
  it('평균 승·평균 패를 각각 낸다 (평균 패는 양수)', () => {
    const m = computeMetrics([trade(100), trade(200), trade(-50)], 5000);
    expect(m.averageWin).toBeCloseTo(150, 10);
    expect(m.averageLoss).toBeCloseTo(50, 10);
  });

  it('실측 손익비는 평균 승 / 평균 패다', () => {
    const m = computeMetrics([trade(100), trade(200), trade(-50)], 5000);
    expect(m.payoffRatio).toBeCloseTo(3, 10);
  });

  it('필요 승률은 1 / (1 + 실측 손익비)다', () => {
    const m = computeMetrics([trade(100), trade(200), trade(-50)], 5000);
    expect(m.requiredWinRate).toBeCloseTo(1 / 4, 10);
  });

  it('필요 승률과 실제 승률이 같으면 기대값이 0이다', () => {
    // 이 성질이 이 지표의 존재 이유다. 실제 승률이 이 값을 넘으면 벌고,
    // 못 미치면 잃는다 — 이론 손익분기 승률과 달리 가정이 들어가지 않는다.
    const trades = [trade(300), trade(-100), trade(-100), trade(-100)];
    const m = computeMetrics(trades, 5000);
    expect(m.requiredWinRate).toBeCloseTo(m.winRate, 10);
    expect(m.expectancy).toBeCloseTo(0, 10);
  });

  it('실제 승률이 필요 승률에 못 미치면 기대값이 음수다', () => {
    // 6개월 백테스트가 이 자리였다. 이론 손익분기(54%)는 넘겼는데 계좌는 녹았다.
    const trades = [trade(60), trade(60), trade(-100), trade(-100)];
    const m = computeMetrics(trades, 5000);
    expect(m.winRate).toBeCloseTo(0.5, 10);
    expect(m.requiredWinRate!).toBeGreaterThan(m.winRate);
    expect(m.expectancy).toBeLessThan(0);
  });

  it('진 트레이드가 없으면 실측할 수 없으므로 null이다', () => {
    const m = computeMetrics([trade(10), trade(20)], 5000);
    expect(m.payoffRatio).toBeNull();
    expect(m.requiredWinRate).toBeNull();
  });

  it('이긴 트레이드가 없으면 필요 승률은 100%다', () => {
    const m = computeMetrics([trade(-10), trade(-20)], 5000);
    expect(m.payoffRatio).toBe(0);
    expect(m.requiredWinRate).toBe(1);
  });

  it('트레이드가 0개면 null이다', () => {
    const m = computeMetrics([], 5000);
    expect(m.payoffRatio).toBeNull();
    expect(m.requiredWinRate).toBeNull();
  });

  it('JSON 왕복 후에도 보존된다', () => {
    // Infinity를 쓰면 JSON에서 null이 되어 "무한대"와 "측정 불가"가 섞인다.
    const m = computeMetrics([trade(10), trade(20)], 5000);
    const roundTripped = JSON.parse(JSON.stringify(m)) as typeof m;
    expect(roundTripped.payoffRatio).toBe(m.payoffRatio);
    expect(roundTripped.requiredWinRate).toBe(m.requiredWinRate);
  });
});

describe('metricsByGroup — 임의 기준으로 쪼개 경험칙을 잰다', () => {
  function t(over: Partial<Trade>): Trade {
    return { ...trade(over.netPnl ?? 0), ...over };
  }

  it('밴드 폭 상태별로 나눈다', () => {
    const trades = [
      t({ netPnl: 100, bandState: 'squeeze-release' }),
      t({ netPnl: 50, bandState: 'squeeze-release' }),
      t({ netPnl: -80, bandState: 'squeezed' }),
    ];
    const by = metricsByBandState(trades, 5000);
    expect(by['squeeze-release']!.totalTrades).toBe(2);
    expect(by['squeeze-release']!.winRate).toBe(1);
    expect(by['squeezed']!.winRate).toBe(0);
  });

  it('교차 횟수는 3회 이상을 한 칸으로 묶는다', () => {
    // 3·4·5회를 따로 두면 표본이 흩어져 어느 칸도 판정이 안 된다.
    expect(crossBucket(1)).toBe('1회');
    expect(crossBucket(2)).toBe('2회');
    expect(crossBucket(3)).toBe('3회+');
    expect(crossBucket(7)).toBe('3회+');
  });

  it('교차 횟수별로 나눈다', () => {
    const trades = [
      t({ netPnl: 100, crossCount: 1 }),
      t({ netPnl: -40, crossCount: 4 }),
      t({ netPnl: -40, crossCount: 9 }),
    ];
    const by = metricsByCrossCount(trades, 5000);
    expect(by['1회']!.totalTrades).toBe(1);
    expect(by['3회+']!.totalTrades).toBe(2);
  });

  it('각 묶음은 같은 시작 자본에서 출발한다', () => {
    const by = metricsByBandState(
      [
        t({ netPnl: 100, bandState: 'squeeze-release' }),
        t({ netPnl: 100, bandState: 'expanded' }),
      ],
      5000,
    );
    expect(by['squeeze-release']!.finalEquity).toBe(5100);
    expect(by['expanded']!.finalEquity).toBe(5100);
  });
});


describe('computeMetrics — 평균 R (ADR-025)', () => {
  it('R은 순손익을 진입 시점 계획 손실로 나눈 값이다', () => {
    // +100/-50, 계획 손실 100 -> R은 +1과 -0.5, 평균 0.25
    const m = computeMetrics([trade(100), trade(-50)], 5000);
    expect(m.averageR).toBeCloseTo(0.25, 10);
  });

  it('리스크 예산이 다른 트레이드를 같은 저울에 올린다', () => {
    // USDT 기대값은 200과 100을 다르게 보지만, 둘 다 계획 손실의 1배를
    // 벌었으므로 R은 같다. 점수별 비교는 이 정규화 없이는 성립하지 않는다.
    const m = computeMetrics([trade(200, { plannedRisk: 200 }), trade(100)], 5000);
    expect(m.averageR).toBeCloseTo(1, 10);
    expect(m.expectancy).toBeCloseTo(150, 10);
  });

  it('계획 손실이 0인 트레이드는 R 계산에서 빠진다', () => {
    const m = computeMetrics([trade(100), trade(-999, { plannedRisk: 0 })], 5000);
    expect(m.averageR).toBeCloseTo(1, 10);
  });

  it('잴 수 있는 트레이드가 하나도 없으면 null이다', () => {
    expect(computeMetrics([trade(50, { plannedRisk: 0 })], 5000).averageR).toBeNull();
    expect(computeMetrics([], 5000).averageR).toBeNull();
  });
});

describe('metricsByScore — 점수 구간별 성적', () => {
  it('점수는 "N점" 한 칸씩 4구간으로 묶인다', () => {
    expect(scoreBucket(0)).toBe('0점');
    expect(scoreBucket(3)).toBe('3점');
  });

  it('점수별로 나눠 각각의 평균 R을 낸다', () => {
    const trades = [
      trade(-100, { score: 1 }),
      trade(-100, { score: 1 }),
      trade(100, { score: 3 }),
      trade(200, { score: 3 }),
    ];
    const byScore = metricsByScore(trades, 5000);
    expect(byScore['1점']!.totalTrades).toBe(2);
    expect(byScore['1점']!.averageR).toBeCloseTo(-1, 10);
    expect(byScore['3점']!.averageR).toBeCloseTo(1.5, 10);
  });

  it('트레이드가 없는 점수 칸은 키 자체가 없다', () => {
    const byScore = metricsByScore([trade(10, { score: 2 })], 5000);
    expect(Object.keys(byScore)).toEqual(['2점']);
  });

  it('각 구간은 같은 시작 자본에서 출발한다', () => {
    // 순서에 따라 출발 자본이 달라지면 먼저 나온 구간이 유리해져 비교가
    // 무의미해진다.
    const byScore = metricsByScore(
      [trade(1000, { score: 3 }), trade(-100, { score: 0 })],
      5000,
    );
    expect(byScore['0점']!.finalEquity).toBeCloseTo(4900, 10);
  });
});
