/**
 * 과거 5분봉·15분봉을 내려받아 data/ 에 저장한다.
 *
 * 거래소 도메인 접근이 필요하므로 **로컬에서 실행**한다. 네트워크가 제한된
 * CI·클라우드 환경에서는 차단된다.
 *
 *   npm run fetch-history -- --from 2025-01-01 --to 2025-06-30
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchHistoricalCandles } from '../src/services/binance';
import { parseTimeframe, timeframeSpec } from '../src/lib/timeframe';
import { candleFileName } from '../src/lib/data-files';

interface Args {
  from: string;
  to: string;
  symbol: string;
  timeframe: '5m' | '15m';
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const from = get('from');
  const to = get('to');
  if (from === undefined || to === undefined) {
    throw new Error(
      '사용법: npm run fetch-history -- --from 2025-01-01 --to 2025-06-30 [--timeframe 5m|15m] [--symbol BTCUSDT]',
    );
  }
  return {
    from,
    to,
    symbol: get('symbol') ?? 'BTCUSDT',
    timeframe: parseTimeframe(get('timeframe')),
  };
}

function toMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`날짜 형식이 잘못됐다: ${date}`);
  return ms;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startTime = toMs(args.from);
  const endTime = toMs(args.to);
  if (endTime <= startTime) throw new Error('--to 는 --from 보다 뒤여야 한다');

  const outDir = path.resolve(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });

  const spec = timeframeSpec(args.timeframe);
  // 기준봉과 상위봉 둘 다 있어야 백테스트가 돈다.
  const intervals = [spec.binanceInterval, spec.binanceHigherInterval] as const;
  process.stderr.write(
    `\n${spec.label} 기준 (상위 ${spec.higher}) · ${args.from} ~ ${args.to}\n`,
  );

  for (const interval of intervals) {
    process.stderr.write(`\n${args.symbol} ${interval}\n`);

    const candles = await fetchHistoricalCandles({
      symbol: args.symbol,
      interval,
      startTime,
      endTime,
      onProgress: (fetched, lastOpenTime) => {
        const at = new Date(lastOpenTime).toISOString().slice(0, 16);
        process.stderr.write(`\r  ${fetched.toLocaleString()}개 수집 · ${at}   `);
      },
    });

    const name = candleFileName(args.symbol, interval, args.from, args.to);
    const file = path.join(outDir, name);
    await writeFile(file, JSON.stringify(candles), 'utf8');
    process.stderr.write(`\r  ${candles.length.toLocaleString()}개 -> data/${name}\n`);
  }

  process.stderr.write(
    `\n완료. 백테스트 화면에서 이 기간과 ${spec.label}을 선택하면 된다.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`\n오류: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
