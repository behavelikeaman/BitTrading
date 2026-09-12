import { describe, expect, it } from 'vitest';
import { describeShape, parseDeepcoinCandles, parseTradeFee, toRows } from '@/lib/parse-deepcoin';

const MS_5M = 300_000;

/** docs/DEEPCOIN-API.md 의 실제 응답 예시 — 내림차순(최신 우선), 전부 문자열 */
const REAL_ROWS: string[][] = [
  ['1760221800000', '3739.08', '3741.95', '3737.75', '3740.1', '2849', '1065583.744'],
  ['1760221740000', '3742.36', '3743.01', '3736.83', '3739.08', '2723', '1018290.723'],
];

/** 두 캔들 모두 확정되는 시각 */
const AFTER_BOTH = 1760221800000 + MS_5M + 1;

describe('parseDeepcoinCandles — 내림차순 입력 (함정 1)', () => {
  it('오름차순으로 뒤집어 반환한다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    expect(out).toHaveLength(2);
    expect(out[0].openTime).toBe(1760221740000);
    expect(out[1].openTime).toBe(1760221800000);
    expect(out[1].openTime).toBeGreaterThan(out[0].openTime);
  });

  it('뒤집지 않으면 지표가 거꾸로 계산된다 — 순서를 명시적으로 검증한다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].openTime).toBeGreaterThan(out[i - 1].openTime);
    }
  });
});

describe('parseDeepcoinCandles — 문자열 파싱 (함정 2)', () => {
  it('모든 숫자 필드가 number 타입이다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    for (const c of out) {
      expect(typeof c.openTime).toBe('number');
      expect(typeof c.open).toBe('number');
      expect(typeof c.high).toBe('number');
      expect(typeof c.low).toBe('number');
      expect(typeof c.close).toBe('number');
      expect(typeof c.volume).toBe('number');
    }
  });

  it('값이 정확히 파싱된다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    const older = out[0];
    expect(older.open).toBeCloseTo(3742.36, 10);
    expect(older.high).toBeCloseTo(3743.01, 10);
    expect(older.low).toBeCloseTo(3736.83, 10);
    expect(older.close).toBeCloseTo(3739.08, 10);
    expect(older.volume).toBeCloseTo(2723, 10);
  });

  it('문자열 연결이 아니라 덧셈이 된다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    const sum = out[0].close + 1;
    expect(sum).toBeCloseTo(3740.08, 10);
    expect(typeof sum).toBe('number');
  });
});

describe('parseDeepcoinCandles — 미확정봉 제외 (ADR-006)', () => {
  it('마지막 캔들이 아직 진행 중이면 제외한다', () => {
    // 최신 캔들(1760221800000)이 아직 끝나지 않은 시각
    const during = 1760221800000 + MS_5M - 1;
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, during);
    expect(out).toHaveLength(1);
    expect(out[0].openTime).toBe(1760221740000);
  });

  it('반환된 캔들은 전부 closed가 true다', () => {
    const out = parseDeepcoinCandles(REAL_ROWS, MS_5M, AFTER_BOTH);
    expect(out.every((c) => c.closed)).toBe(true);
  });

  it('경계 시각(정확히 끝나는 순간)은 확정으로 본다', () => {
    const exact = 1760221800000 + MS_5M;
    expect(parseDeepcoinCandles(REAL_ROWS, MS_5M, exact)).toHaveLength(2);
  });
});

describe('parseDeepcoinCandles — 방어', () => {
  it('빈 배열은 빈 배열을 반환한다', () => {
    expect(parseDeepcoinCandles([], MS_5M, AFTER_BOTH)).toEqual([]);
  });

  it('필드가 모자란 행은 건너뛴다', () => {
    const rows = [['1760221800000', '1', '2'], ...REAL_ROWS];
    expect(parseDeepcoinCandles(rows, MS_5M, AFTER_BOTH)).toHaveLength(2);
  });

  it('숫자로 파싱되지 않는 행은 건너뛴다', () => {
    const rows = [['abc', 'x', 'y', 'z', 'w', 'v', 'u'], ...REAL_ROWS];
    expect(parseDeepcoinCandles(rows, MS_5M, AFTER_BOTH)).toHaveLength(2);
  });

  it('같은 openTime이 중복되면 하나만 남는다', () => {
    const rows = [...REAL_ROWS, REAL_ROWS[1]];
    const out = parseDeepcoinCandles(rows, MS_5M, AFTER_BOTH);
    expect(out).toHaveLength(2);
  });
});

describe('parseTradeFee — 응답이 배열로 감싸여 와도 읽는다', () => {
  it('객체로 오면 그대로 읽는다', () => {
    expect(parseTradeFee({ maker: '0.0002', taker: '0.0004' })).toEqual({
      maker: 0.0002,
      taker: 0.0004,
    });
  });

  it('배열로 감싸여 오면 첫 원소를 읽는다', () => {
    // Deepcoin은 OKX 계열이라 data가 배열로 오는 엔드포인트가 있다.
    // 방어하지 않으면 undefined -> NaN -> null이 되어 "실측 실패"로 조용히
    // 넘어간다. 인증은 통과했는데 화면은 "(추정)"에 머무는 상태가 된다.
    expect(parseTradeFee([{ maker: '0.0002', taker: '0.0004' }])).toEqual({
      maker: 0.0002,
      taker: 0.0004,
    });
  });

  it('수수료가 음수로 와도 절대값으로 정규화한다', () => {
    expect(parseTradeFee([{ maker: '-0.0002', taker: '-0.0005' }])).toEqual({
      maker: 0.0002,
      taker: 0.0005,
    });
  });

  it('빈 배열·null·숫자 아님은 전부 null이다', () => {
    expect(parseTradeFee([])).toBeNull();
    expect(parseTradeFee(null)).toBeNull();
    expect(parseTradeFee(undefined)).toBeNull();
    expect(parseTradeFee({ maker: 'x', taker: '0.0004' })).toBeNull();
    expect(parseTradeFee({ taker: '0.0004' })).toBeNull();
  });
});

describe('toRows — 목록 응답의 배열을 꺼낸다', () => {
  it('배열이면 그대로', () => {
    expect(toRows([1, 2])).toEqual([1, 2]);
  });

  it('배열을 품은 객체면 그 배열을 꺼낸다', () => {
    expect(toRows({ list: [1, 2] })).toEqual([1, 2]);
    expect(toRows({ data: [3] })).toEqual([3]);
    expect(toRows({ items: [4] })).toEqual([4]);
  });

  it('배열이 없으면 빈 배열이다', () => {
    expect(toRows(null)).toEqual([]);
    expect(toRows({})).toEqual([]);
    expect(toRows(42)).toEqual([]);
  });
});

describe('describeShape — 응답 모양만 짧게 적는다', () => {
  it('값은 담지 않고 키 이름만 적는다', () => {
    const s = describeShape({ level: 'Lv1', taker: '-0.0005', maker: '-0.0002' });
    expect(s).toContain('level');
    expect(s).toContain('taker');
    expect(s).not.toContain('0.0005');
    expect(s).not.toContain('Lv1');
  });

  it('배열이면 길이와 첫 원소의 키를 적는다', () => {
    const s = describeShape([{ taker: '0.0004' }, { taker: '0.0004' }]);
    expect(s).toContain('배열(2)');
    expect(s).toContain('taker');
  });

  it('빈 배열·null도 구분해서 적는다', () => {
    expect(describeShape([])).toBe('빈 배열');
    expect(describeShape(null)).toBe('null');
    expect(describeShape(undefined)).toBe('없음');
  });

  it('원시값은 타입만 적는다', () => {
    expect(describeShape(42)).toBe('number');
    expect(describeShape('abc')).toBe('string');
  });
})
