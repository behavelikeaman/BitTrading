/** 5분봉 하나의 길이 (ms) */
const MS_5M = 300_000;

export interface SlippageNoteInput {
  /** 읽어온 체결 건수. 읽기 자체가 실패했으면 null */
  fillCount: number | null;
  /** 의도가와 대조에 성공한 건수 */
  matchedCount: number;
  /** 대조 기준이 된 캔들 수 */
  candleCount: number;
}

/**
 * 슬리피지가 실측되지 않은 이유를 한 줄로 적는다. 실측됐으면 null.
 *
 * 슬리피지 추정치 하나가 손익분기 승률을 수십 %p 움직인다(ADR-014). 왜
 * 실측이 안 되는지 모르면 그 추정 위에서 계속 매매하게 된다.
 */
export function slippageNote(input: SlippageNoteInput): string | null {
  const { fillCount, matchedCount, candleCount } = input;
  if (matchedCount > 0) return null;

  if (fillCount === null) {
    return '체결 내역을 읽지 못해 슬리피지를 실측할 수 없다.';
  }
  if (fillCount === 0) {
    return '최근 체결 내역이 없다. 실거래가 쌓이면 슬리피지가 실측된다.';
  }
  if (candleCount === 0) {
    return '대조할 캔들이 없어 슬리피지를 실측할 수 없다.';
  }

  const hours = Math.round((candleCount * MS_5M) / 3_600_000);
  return `체결 ${fillCount}건을 읽었지만 최근 ${candleCount}봉(약 ${hours}시간) 구간과 겹치지 않는다. 그 안에서 매매하면 실측된다.`;
}
