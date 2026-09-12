import { describe, expect, it } from 'vitest';
import { parseTimeframe, TIMEFRAMES, timeframeSpec } from '@/lib/timeframe';

describe('timeframeSpec', () => {
  it('5분봉의 상위는 15분봉이다', () => {
    const s = timeframeSpec('5m');
    expect(s.higher).toBe('15m');
    expect(s.barMs).toBe(300_000);
    expect(s.higherMs).toBe(900_000);
  });

  it('15분봉의 상위는 1시간봉이다', () => {
    const s = timeframeSpec('15m');
    expect(s.higher).toBe('1h');
    expect(s.barMs).toBe(900_000);
    expect(s.higherMs).toBe(3_600_000);
  });

  it('Deepcoin은 1시간 이상을 대문자로 쓴다', () => {
    expect(timeframeSpec('5m').deepcoinHigherBar).toBe('15m');
    expect(timeframeSpec('15m').deepcoinHigherBar).toBe('1H');
  });

  it('Binance는 전부 소문자다', () => {
    expect(timeframeSpec('15m').binanceHigherInterval).toBe('1h');
  });

  it('상위 프레임은 기준 봉의 정수배다', () => {
    for (const tf of TIMEFRAMES) {
      const s = timeframeSpec(tf);
      expect(s.higherMs % s.barMs).toBe(0);
      expect(s.higherMs / s.barMs).toBeGreaterThan(1);
    }
  });

  it('타임아웃 기본값은 두 프레임 모두 약 3시간이다', () => {
    for (const tf of TIMEFRAMES) {
      const s = timeframeSpec(tf);
      const hours = (s.defaultMaxHoldBars * s.barMs) / 3_600_000;
      expect(hours).toBeCloseTo(3, 1);
    }
  });
});

describe('parseTimeframe', () => {
  it('15m을 인식한다', () => {
    expect(parseTimeframe('15m')).toBe('15m');
  });

  it('알 수 없는 값은 5m으로 폴백한다', () => {
    for (const bad of ['1h', '', null, undefined, 'abc']) {
      expect(parseTimeframe(bad)).toBe('5m');
    }
  });
});
