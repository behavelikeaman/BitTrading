import type { Candle, Direction, IndicatorSnapshot } from '@/types';

export interface CrossPoint {
  /** 교차가 확정된 캔들의 openTime */
  time: number;
  direction: Direction;
  price: number;
}

/**
 * EMA12가 SMA20(볼린저 중심선)을 교차한 지점을 전부 찾는다.
 *
 * 차트에 진입 신호를 삼각형으로 찍기 위한 것이며, 판정 규칙은
 * `scoreSignal`의 emaCross 항목과 동일하다 — 직전 봉의 차이가 0 이하였다가
 * 이번 봉에서 양수가 되면 상향(롱), 반대면 하향(숏).
 *
 * 여기서 다시 계산하는 것은 지표가 아니라 "이미 계산된 스냅샷 사이의 부호
 * 변화"뿐이다. 지표 자체는 computeIndicators가 만든 값을 그대로 쓴다.
 */
export function findCrosses(
  candles: Candle[],
  snapshots: (IndicatorSnapshot | null)[],
): CrossPoint[] {
  const out: CrossPoint[] = [];

  for (let i = 1; i < snapshots.length && i < candles.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    if (prev === null || curr === null) continue;

    const prevDiff = prev.ema12 - prev.sma20;
    const currDiff = curr.ema12 - curr.sma20;

    let direction: Direction | null = null;
    if (prevDiff <= 0 && currDiff > 0) direction = 'long';
    else if (prevDiff >= 0 && currDiff < 0) direction = 'short';
    if (direction === null) continue;

    out.push({ time: candles[i].openTime, direction, price: candles[i].close });
  }

  return out;
}
