import { describe, expect, it } from 'vitest';
import { slippageNote } from '@/lib/slippage-note';

describe('slippageNote — 슬리피지가 왜 추정에 머무는지 설명한다', () => {
  it('실측되면 설명이 필요 없다', () => {
    expect(slippageNote({ fillCount: 12, matchedCount: 9, candleCount: 300 })).toBeNull();
  });

  it('체결 내역을 못 읽으면 그렇게 말한다', () => {
    const note = slippageNote({ fillCount: null, matchedCount: 0, candleCount: 300 });
    expect(note).toContain('체결 내역');
  });

  it('체결이 아예 없으면 매매 이력이 없다고 말한다', () => {
    const note = slippageNote({ fillCount: 0, matchedCount: 0, candleCount: 300 });
    expect(note).toContain('없다');
  });

  it('체결은 있는데 구간이 안 겹치면 기간 문제임을 알린다', () => {
    // 최근 300봉(약 25시간) 안의 체결만 의도가와 대조할 수 있다.
    // 이걸 안 알려주면 "왜 실측이 안 되지"를 또 추측하게 된다.
    const note = slippageNote({ fillCount: 40, matchedCount: 0, candleCount: 300 });
    expect(note).toContain('40건');
    expect(note).toContain('25시간');
  });

  it('캔들이 없으면 대조할 기준이 없다고 말한다', () => {
    const note = slippageNote({ fillCount: 40, matchedCount: 0, candleCount: 0 });
    expect(note).toContain('캔들');
  });
});
