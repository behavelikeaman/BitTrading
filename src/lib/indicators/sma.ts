/**
 * 단순이동평균.
 *
 * 반환 배열은 입력과 같은 길이이며, 값이 정의되지 않는 워밍업 구간(period - 1개)은
 * null로 채운다. 인덱스가 캔들 인덱스와 1:1로 맞아야 백테스트에서 [0..i]를
 * 슬라이스할 때 룩어헤드가 생기지 않는다.
 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
