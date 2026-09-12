import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  DEFAULT_BACKTEST_PARAMS,
  runBacktest,
  type BacktestParams,
} from '@/lib/backtest/engine';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';
import { candleFileNames } from '@/lib/data-files';
import { parseTimeframe } from '@/lib/timeframe';
import type { BacktestResult, Candle } from '@/types';

export const runtime = 'nodejs';
/** 수만 캔들을 도는 루프라 기본 타임아웃으로는 모자랄 수 있다. */
export const maxDuration = 300;

interface BacktestRequestBody {
  from?: string;
  to?: string;
  symbol?: string;
  params?: Partial<BacktestParams>;
}

async function loadCandles(file: string): Promise<Candle[] | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Candle[];
  } catch {
    return null;
  }
}

/**
 * 백테스트 실행.
 *
 * 엔진은 src/lib/backtest/의 순수 함수이고 여기서는 파일을 읽어 넘기기만 한다.
 * 과거 데이터는 로컬에서 `npm run fetch-history`로 받아야 한다 (거래소 도메인
 * 접근이 필요하므로 제한된 환경에서는 차단된다).
 */
export async function POST(
  request: Request,
): Promise<NextResponse<BacktestResult | { error: string; hint?: string }>> {
  let body: BacktestRequestBody;
  try {
    body = (await request.json()) as BacktestRequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON 본문을 읽을 수 없다' }, { status: 400 });
  }

  const { from, to } = body;
  const symbol = body.symbol ?? 'BTCUSDT';
  if (!from || !to) {
    return NextResponse.json({ error: 'from·to가 필요하다' }, { status: 400 });
  }

  const timeframe = parseTimeframe(body.params?.timeframe);
  const names = candleFileNames(symbol, timeframe, from, to);
  const dir = path.resolve(process.cwd(), 'data');
  const [candles5m, candles15m] = await Promise.all([
    loadCandles(path.join(dir, names.primary)),
    loadCandles(path.join(dir, names.higher)),
  ]);

  if (candles5m === null || candles15m === null) {
    const missing = candles5m === null ? names.primary : names.higher;
    return NextResponse.json(
      {
        error: `과거 데이터가 없다: ${missing}`,
        hint: `npm run fetch-history -- --from ${from} --to ${to} --timeframe ${timeframe}${symbol === 'BTCUSDT' ? '' : ` --symbol ${symbol}`}`,
      },
      { status: 404 },
    );
  }

  // account·entry는 중첩 객체라 얕은 병합으로는 사용자가 보낸 일부 필드만
  // 남고 나머지 기본값이 날아간다. 각각 따로 병합한다.
  const { account: accountOverride, entry: entryOverride, ...rest } = body.params ?? {};
  const params: BacktestParams = {
    ...DEFAULT_BACKTEST_PARAMS,
    ...rest,
    account: { ...DEFAULT_ACCOUNT, ...accountOverride },
    entry: { ...DEFAULT_ENTRY_CONFIG, ...entryOverride },
  };

  try {
    return NextResponse.json(runBacktest({ candles5m, candles15m, params }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '백테스트 실패' },
      { status: 500 },
    );
  }
}
