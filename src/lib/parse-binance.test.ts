import { describe, expect, it } from 'vitest';
import { parseBinanceKlines } from '@/lib/parse-binance';

const MS_5M = 300_000;
const T0 = 1_700_000_000_000;

function row(openTime: number, close: number): (string | number)[] {
  return [
    openTime,
    String(close - 1),
    String(close + 2),
    String(close - 3),
    String(close),
    '1234.5',
    openTime + MS_5M - 1,
    '0',
    0,
    '0',
    '0',
    '0',
  ];
}

describe('parseBinanceKlines', () => {
  const rows = [row(T0, 100), row(T0 + MS_5M, 101), row(T0 + 2 * MS_5M, 102)];
  const afterAll = T0 + 3 * MS_5M;

  it('오름차순을 유지하고 모든 값을 숫자로 파싱한다', () => {
    const out = parseBinanceKlines(rows, afterAll);
    expect(out).toHaveLength(3);
    expect(out[0].openTime).toBe(T0);
    expect(out[2].openTime).toBe(T0 + 2 * MS_5M);
    for (const c of out) {
      expect(typeof c.open).toBe('number');
      expect(typeof c.volume).toBe('number');
    }
    expect(out[0].close).toBeCloseTo(100, 10);
    expect(out[0].volume).toBeCloseTo(1234.5, 10);
  });

  it('closeTime이 현재 시각을 넘는 미확정봉을 제외한다', () => {
    const during = T0 + 2 * MS_5M + 10;
    const out = parseBinanceKlines(rows, during);
    expect(out).toHaveLength(2);
  });

  it('중복 openTime을 제거한다 — 페이지네이션 경계에서 겹친다', () => {
    const out = parseBinanceKlines([...rows, row(T0 + MS_5M, 101)], afterAll);
    expect(out).toHaveLength(3);
  });

  it('빈 배열과 깨진 행을 안전하게 처리한다', () => {
    expect(parseBinanceKlines([], afterAll)).toEqual([]);
    expect(parseBinanceKlines([['x'], ...rows], afterAll)).toHaveLength(3);
  });
});
