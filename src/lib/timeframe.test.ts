import { describe, expect, it } from 'vitest';
import { parseTimeframe, TIMEFRAMES, timeframeSpec } from '@/lib/timeframe';

describe('timeframeSpec', () => {
  it('봉 길이를 ms로 준다', () => {
    expect(timeframeSpec('5m').barMs).toBe(300_000);
    expect(timeframeSpec('15m').barMs).toBe(900_000);
  });

  it('거래소별 파라미터 표기를 한 곳에서 매핑한다', () => {
    expect(timeframeSpec('5m').deepcoinBar).toBe('5m');
    expect(timeframeSpec('15m').binanceInterval).toBe('15m');
  });

  it('상위 프레임 필드를 들고 있지 않다 (ADR-026)', () => {
    // 어떤 판정도 읽지 않는 값을 스펙에 남겨두면 다시 그 경로가 자란다.
    for (const tf of TIMEFRAMES) {
      const keys = Object.keys(timeframeSpec(tf));
      expect(keys.filter((k) => k.toLowerCase().includes('higher'))).toEqual([]);
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
