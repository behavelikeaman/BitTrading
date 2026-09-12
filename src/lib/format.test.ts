import { describe, expect, it } from 'vitest';
import {
  formatDateShort,
  formatDateTime,
  formatHourMinute,
  formatPct,
  formatPrice,
  formatQty,
  formatRate,
  formatProfitFactor,
  formatRatio,
  formatSignedUsd,
  formatSignedPct,
  formatTime,
  formatUsd,
  formatYear,
} from '@/lib/format';

describe('formatPrice', () => {
  it('소수점 1자리에 천단위 구분을 넣는다', () => {
    expect(formatPrice(100_000)).toBe('100,000.0');
    expect(formatPrice(98_765.432)).toBe('98,765.4');
  });
  it('값이 없으면 대시를 반환한다', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice(Number.NaN)).toBe('—');
  });
});

describe('formatQty', () => {
  it('소수점 4자리로 고정한다', () => {
    expect(formatQty(0.12345)).toBe('0.1235');
    expect(formatQty(1)).toBe('1.0000');
  });
});

describe('formatUsd / formatSignedUsd', () => {
  it('소수점 2자리에 천단위 구분을 넣는다', () => {
    expect(formatUsd(1234.5)).toBe('1,234.50');
  });
  it('부호를 항상 표시한다', () => {
    expect(formatSignedUsd(100)).toBe('+100.00');
    expect(formatSignedUsd(-100)).toBe('-100.00');
    expect(formatSignedUsd(0)).toBe('0.00');
  });
});

describe('formatPct / formatRate', () => {
  it('비율을 퍼센트로 바꾼다', () => {
    expect(formatPct(0.5002)).toBe('50.02%');
    expect(formatPct(0.0042, 2)).toBe('0.42%');
  });
  it('작은 비율은 4자리로 본다', () => {
    expect(formatRate(0.0004)).toBe('0.0400%');
    expect(formatRate(0.0002)).toBe('0.0200%');
  });
});

describe('formatRatio', () => {
  it('무한대를 기호로 표시한다', () => {
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe('∞');
  });
  it('일반 값은 소수점 2자리다', () => {
    expect(formatRatio(2)).toBe('2.00');
  });
  it('값이 없으면 대시다', () => {
    expect(formatRatio(null)).toBe('—');
  });
});

describe('formatTime / formatDateTime', () => {
  it('UTC epoch를 한국 표준시(UTC+9)로 그린다', () => {
    // 2026-01-05 00:07:03 UTC = 같은 날 09:07:03 KST
    const ms = Date.UTC(2026, 0, 5, 0, 7, 3);
    expect(formatTime(ms)).toBe('09:07:03');
    expect(formatDateTime(ms)).toBe('2026-01-05 09:07');
  });
  it('KST로 날짜가 넘어가는 시각을 다음 날로 그린다', () => {
    // 2026-01-05 15:30:00 UTC = 2026-01-06 00:30:00 KST
    const ms = Date.UTC(2026, 0, 5, 15, 30, 0);
    expect(formatTime(ms)).toBe('00:30:00');
    expect(formatDateTime(ms)).toBe('2026-01-06 00:30');
  });
  it('브라우저 시간대와 무관하게 같은 값을 낸다', () => {
    // getHours() 대신 고정 오프셋을 쓰므로 TZ 환경변수에 좌우되지 않는다.
    const ms = Date.UTC(2026, 6, 1, 12, 0, 0);
    expect(formatTime(ms)).toBe('21:00:00');
  });
  it('값이 없으면 대시다', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('formatSignedPct', () => {
  it('이익에 + 부호를 붙인다', () => {
    expect(formatSignedPct(0.0123)).toBe('+1.23%');
  });
  it('손실은 - 부호를 그대로 쓴다', () => {
    expect(formatSignedPct(-0.0456)).toBe('-4.56%');
  });
  it('0은 부호를 붙이지 않는다', () => {
    expect(formatSignedPct(0)).toBe('0.00%');
  });
  it('값이 없으면 대시다', () => {
    expect(formatSignedPct(null)).toBe('—');
  });
});

describe('formatProfitFactor', () => {
  it('손실이 없어 null이면 무한대 기호로 그린다', () => {
    expect(formatProfitFactor(null, true)).toBe('∞');
  });
  it('트레이드가 없으면 대시다', () => {
    expect(formatProfitFactor(null, false)).toBe('—');
  });
  it('일반 값은 소수점 2자리다', () => {
    expect(formatProfitFactor(2.5, true)).toBe('2.50');
  });
});

describe('차트 축 눈금 포맷', () => {
  it('KST 기준 날짜·시각·연도를 낸다', () => {
    // 2026-01-05 15:30:00 UTC = 2026-01-06 00:30 KST
    const ms = Date.UTC(2026, 0, 5, 15, 30, 0);
    expect(formatDateShort(ms)).toBe('01-06');
    expect(formatHourMinute(ms)).toBe('00:30');
    expect(formatYear(ms)).toBe('2026');
  });
  it('값이 없으면 대시다', () => {
    expect(formatDateShort(null)).toBe('—');
    expect(formatHourMinute(undefined)).toBe('—');
    expect(formatYear(Number.NaN)).toBe('—');
  });
});
