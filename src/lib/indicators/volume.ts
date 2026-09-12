import { sma } from '@/lib/indicators/sma';
import type { Candle } from '@/types';

/** 거래량의 단순이동평균. 신호봉 거래량이 평균 대비 몇 배인지 판정하는 데 쓴다. */
export function volumeSma(candles: Candle[], period = 20): (number | null)[] {
  return sma(
    candles.map((c) => c.volume),
    period,
  );
}
