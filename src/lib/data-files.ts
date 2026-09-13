import { timeframeSpec, type Timeframe } from '@/lib/timeframe';

/**
 * 과거 캔들 파일명 규칙.
 *
 * fetch-history CLI와 백테스트·괴리검사 라우트가 같은 이름을 써야 하므로
 * 한 곳에 모은다. 어긋나면 사용자는 404만 보고 원인을 알 수 없다.
 */
export function candleFileName(
  symbol: string,
  interval: string,
  from: string,
  to: string,
): string {
  return `${symbol.toLowerCase()}-${interval}-${from}-${to}.json`;
}

/**
 * 한 타임프레임을 돌리는 데 필요한 파일. 기준봉 하나다.
 *
 * 예전에는 상위봉 파일까지 둘이 필요했다. 상위 프레임이 판정에서 빠지면서
 * 백테스트는 기준봉 파일 하나만 있으면 돈다 (ADR-026).
 */
export function candleFileFor(
  symbol: string,
  timeframe: Timeframe,
  from: string,
  to: string,
): string {
  return candleFileName(symbol, timeframeSpec(timeframe).binanceInterval, from, to);
}
