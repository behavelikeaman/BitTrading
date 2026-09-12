import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatPct,
  formatPrice,
  formatQty,
  formatRate,
  formatProfitFactor,
  formatRatio,
  formatSignedUsd,
  formatTime,
  formatUsd,
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
  it('두 자리로 채운다', () => {
    const ms = new Date(2026, 0, 5, 9, 7, 3).getTime();
    expect(formatTime(ms)).toBe('09:07:03');
    expect(formatDateTime(ms)).toBe('2026-01-05 09:07');
  });
  it('값이 없으면 대시다', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
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
