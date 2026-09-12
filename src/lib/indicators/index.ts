import type { Candle, IndicatorSnapshot, MaStack } from '@/types';
import { adx } from '@/lib/indicators/adx';
import { atr } from '@/lib/indicators/atr';
import { bollinger } from '@/lib/indicators/bollinger';
import { ema } from '@/lib/indicators/ema';
import { smma } from '@/lib/indicators/smma';
import { volumeSma } from '@/lib/indicators/volume';

export { sma } from '@/lib/indicators/sma';
export { ema } from '@/lib/indicators/ema';
export { bollinger } from '@/lib/indicators/bollinger';
export { atr, trueRange } from '@/lib/indicators/atr';
export { adx } from '@/lib/indicators/adx';
export { smma } from '@/lib/indicators/smma';
export { volumeSma } from '@/lib/indicators/volume';

/**
 * 캔들 배열을 받아 인덱스별 지표 스냅샷을 만든다.
 *
 * 어느 한 지표라도 워밍업이 끝나지 않은 인덱스는 null이다. 부분적으로 채워진
 * 스냅샷을 내보내면 호출부가 일부 지표만 보고 진입을 판정할 수 있어 위험하다.
 */
export function computeIndicators(candles: Candle[]): (IndicatorSnapshot | null)[] {
  const closes = candles.map((c) => c.close);
  const ema12 = ema(closes, 12);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(candles, 14);
  const adx14 = adx(candles, 14);
  const volSma = volumeSma(candles, 20);
  // 사용자 차트와 같은 이평선 스택 (빨강 20 · 파랑 55 · 흰색 95 · 노랑 135)
  const s20 = smma(closes, 20);
  const s55 = smma(closes, 55);
  const s95 = smma(closes, 95);
  const s135 = smma(closes, 135);

  return candles.map((_, i) => {
    const e = ema12[i];
    const mid = bb.middle[i];
    const up = bb.upper[i];
    const low = bb.lower[i];
    const width = bb.width[i];
    const a = atr14[i];
    const dx = adx14.adx[i];
    const v = volSma[i];

    if (
      e === null ||
      mid === null ||
      up === null ||
      low === null ||
      width === null ||
      a === null ||
      dx === null ||
      v === null
    ) {
      return null;
    }

    const stack: MaStack | null =
      s20[i] !== null && s55[i] !== null && s95[i] !== null && s135[i] !== null
        ? {
            smma20: s20[i]!,
            smma55: s55[i]!,
            smma95: s95[i]!,
            smma135: s135[i]!,
          }
        : null;

    return {
      ema12: e,
      sma20: mid,
      bbUpper: up,
      bbLower: low,
      bbWidth: width,
      atr14: a,
      adx14: dx,
      volumeSma20: v,
      stack,
    };
  });
}
