export interface Fill {
  ts: number;
  side: 'buy' | 'sell';
  fillPrice: number;
  qty: number;
}

export interface IntendedPrice {
  ts: number;
  price: number;
}

export interface SlippageMeasurement {
  /** 편도 슬리피지 비율의 중앙값. 불리한 방향이 양수다. */
  medianRate: number;
  sampleCount: number;
}

/** 표본이 이보다 적으면 추정치보다 나을 게 없다 */
const MIN_SAMPLES = 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 실제 체결가와 의도 가격을 비교해 편도 슬리피지를 실측한다 (ADR-014).
 *
 * 사용자는 시장가로 매매하므로 체결 비용은 수수료 + 슬리피지다. 슬리피지를
 * 추정치로 두면 손익분기 승률이 몇 %p씩 어긋나 백테스트가 무의미해진다.
 *
 * - **불리한 방향을 양수로** 정의한다. 매수는 비싸게 산 만큼, 매도는 싸게 판
 *   만큼이 양수다. 유리하게 체결됐다면 음수가 나온다.
 * - 평균이 아니라 **중앙값**을 쓴다. 급변동 구간의 이상 체결 한두 건이
 *   평균을 크게 왜곡하기 때문이다.
 * - 표본이 MIN_SAMPLES 미만이면 null을 반환한다. 호출부는 기본값으로
 *   폴백하고 화면에 "추정치"로 표시한다.
 */
export function measureSlippage(
  fills: Fill[],
  intendedPrices: IntendedPrice[],
): SlippageMeasurement | null {
  const intendedByTs = new Map(intendedPrices.map((p) => [p.ts, p.price]));
  const rates: number[] = [];

  for (const fill of fills) {
    const intended = intendedByTs.get(fill.ts);
    if (intended === undefined || !Number.isFinite(intended) || intended <= 0) {
      continue;
    }
    if (!Number.isFinite(fill.fillPrice) || fill.fillPrice <= 0) continue;

    const rate =
      fill.side === 'buy'
        ? (fill.fillPrice - intended) / intended
        : (intended - fill.fillPrice) / intended;
    rates.push(rate);
  }

  if (rates.length < MIN_SAMPLES) return null;

  return { medianRate: median(rates), sampleCount: rates.length };
}
