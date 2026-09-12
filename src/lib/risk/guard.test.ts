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
  it('일손익만 초기화하고 연속 손실은 유지한다', () => {
    const g = resetDaily({ consecutiveLosses: 2, dailyPnlPct: -0.05 });
    expect(g.dailyPnlPct).toBe(0);
    expect(g.consecutiveLosses).toBe(2);
  });
});
