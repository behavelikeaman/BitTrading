import { describe, expect, it } from 'vitest';
import { INITIAL_GUARD, isHalted, resetDaily, updateGuard } from '@/lib/risk/guard';

const CONFIG = { consecutiveLossLimit: 3, dailyLossLimitPct: 0.06 };

describe('updateGuard', () => {
  it('손실이면 연속 손실이 증가하고 일손익에 누적된다', () => {
    const g = updateGuard(INITIAL_GUARD, -0.02);
    expect(g.consecutiveLosses).toBe(1);
    expect(g.dailyPnlPct).toBeCloseTo(-0.02, 10);
  });

  it('이익이 한 번 나면 연속 손실이 0으로 초기화된다', () => {
    let g = updateGuard(INITIAL_GUARD, -0.02);
    g = updateGuard(g, -0.02);
    expect(g.consecutiveLosses).toBe(2);
    g = updateGuard(g, 0.03);
    expect(g.consecutiveLosses).toBe(0);
    expect(g.dailyPnlPct).toBeCloseTo(-0.01, 10);
  });

  it('손익 0은 손실로 세지 않는다', () => {
    const g = updateGuard({ consecutiveLosses: 2, dailyPnlPct: -0.01 }, 0);
    expect(g.consecutiveLosses).toBe(0);
  });

  it('원본 상태를 변경하지 않는다', () => {
    const prev = { ...INITIAL_GUARD };
    updateGuard(prev, -0.02);
    expect(prev).toEqual(INITIAL_GUARD);
  });
});

describe('isHalted', () => {
  it('3연속 손실이면 중단한다', () => {
    let g = INITIAL_GUARD;
    for (let i = 0; i < 3; i++) g = updateGuard(g, -0.01);
    const result = isHalted(g, CONFIG);
    expect(result.halted).toBe(true);
    expect(result.reason).toContain('연속');
  });

  it('2연속 손실에서는 중단하지 않는다', () => {
    let g = INITIAL_GUARD;
    for (let i = 0; i < 2; i++) g = updateGuard(g, -0.01);
    expect(isHalted(g, CONFIG).halted).toBe(false);
  });

  it('일일 손실 한도에 닿으면 중단한다', () => {
    const g = { consecutiveLosses: 1, dailyPnlPct: -0.06 };
    const result = isHalted(g, CONFIG);
    expect(result.halted).toBe(true);
    expect(result.reason).toContain('일일');
  });

  it('한도 직전에는 중단하지 않는다', () => {
    expect(isHalted({ consecutiveLosses: 2, dailyPnlPct: -0.059 }, CONFIG).halted).toBe(
      false,
    );
  });

  it('중단이 아니면 reason은 null이다', () => {
    expect(isHalted(INITIAL_GUARD, CONFIG).reason).toBeNull();
  });
});

describe('resetDaily', () => {
  it('일손익을 0으로 되돌린다', () => {
    const next = resetDaily({ consecutiveLosses: 2, dailyPnlPct: -0.04 });
    expect(next.dailyPnlPct).toBe(0);
  });

  it('연속 손실 카운터도 함께 초기화한다', () => {
    // 서킷브레이커는 사람이 풀어주는 장치다. 백테스트·페이퍼에는 그 사람이
    // 없어서, 날짜가 바뀌어도 안 풀리면 한 번 걸린 뒤 남은 기간 전체가
    // 통째로 막힌다. 실제로 6개월 백테스트가 3일치만 돌고 멈췄다.
    const next = resetDaily({ consecutiveLosses: 3, dailyPnlPct: -0.06 });
    expect(next.consecutiveLosses).toBe(0);
  });
});
