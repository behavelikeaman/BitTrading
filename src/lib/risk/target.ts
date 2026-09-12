/**
 * 목표 R배수 ↔ 증거금 대비 순수익 환산 (ADR-013).
 *
 * 전략의 목표는 R배수로 정의한다. 레버리지에 종속되지 않기 때문이다. 다만
 * 사용자는 "증거금 대비 몇 %"로 생각하므로 양방향 환산이 필요하다.
 *
 * 주의: 같은 R배수라도 ATR이 바뀌면 % 목표가 달라진다. R은 변동성에 비례해
 * 목표폭을 조절하는 정의이고, %는 고정 폭을 요구하는 정의라서 그렇다.
 */

export interface TargetConversionInput {
  /** ATR(14) 절대값 (가격 단위) */
  atr: number;
  price: number;
  atrStopMultiple: number;
  leverage: number;
  /** 편도 체결비용 = 수수료 + 슬리피지 (ADR-014) */
  costRatePerSide: number;
}

function stopWidth(input: TargetConversionInput): number | null {
  const { atr, price, atrStopMultiple, leverage } = input;
  if (!(atr > 0) || !(price > 0) || !(atrStopMultiple > 0) || !(leverage > 0)) {
    return null;
  }
  return atr * atrStopMultiple;
}

/** 목표 R배수 -> 증거금 대비 순수익 비율 (마찰 차감 후) */
export function returnOnMarginForR(
  input: TargetConversionInput & { targetRMultiple: number },
): number | null {
  const width = stopWidth(input);
  if (width === null) return null;

  const targetWidth = width * input.targetRMultiple;
  const roundTrip = input.costRatePerSide * 2;
  return (targetWidth / input.price) * input.leverage - roundTrip * input.leverage;
}

/** 원하는 증거금 대비 순수익 -> 그에 필요한 목표 R배수 */
export function rMultipleForReturnOnMargin(
  input: TargetConversionInput & { netReturnOnMargin: number },
): number | null {
  const width = stopWidth(input);
  if (width === null) return null;

  const roundTrip = input.costRatePerSide * 2;
  const requiredWidth =
    (input.netReturnOnMargin / input.leverage + roundTrip) * input.price;
  return requiredWidth / width;
}

/**
 * 왕복 마찰을 겨우 상쇄하는 R배수 — 이 아래로는 목표에 닿아도 손해다.
 *
 * 레버리지와 무관하다. 목표 이익도 마찰도 같은 배수로 증폭되기 때문이다.
 */
export function breakEvenRMultiple(input: TargetConversionInput): number | null {
  return rMultipleForReturnOnMargin({ ...input, netReturnOnMargin: 0 });
}
