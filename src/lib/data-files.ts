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

/** 한 타임프레임을 돌리는 데 필요한 두 파일(기준봉·상위봉) */
export function candleFileNames(
  symbol: string,
  timeframe: Timeframe,
  from: string,
  to: string,
): { primary: string; higher: string } {
  const spec = timeframeSpec(timeframe);
  return {
    primary: candleFileName(symbol, spec.binanceInterval, from, to),
    higher: candleFileName(symbol, spec.binanceHigherInterval, from, to),
  };
}
