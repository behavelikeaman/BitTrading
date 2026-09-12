import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { loadJournal } from '@/services/paper-store';
import { tradesFromJournal } from '@/lib/paper/journal';
import { compareTrades, type DivergenceReport } from '@/lib/paper/divergence';
import { DEFAULT_BACKTEST_PARAMS, runBacktest } from '@/lib/backtest/engine';
import { DEFAULT_ACCOUNT } from '@/lib/risk/sizing';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import type { Candle } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function loadCandles(file: string): Promise<Candle[] | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Candle[];
  } catch {
    return null;
  }
}

export interface DivergenceResponse extends DivergenceReport {
  from: string;
  to: string;
  paperTrades: number;
  backtestTrades: number;
}

/** 페이퍼 구간을 백테스트로 재생해 대조한다 (ADR-020). */
export async function POST(): Promise<
  NextResponse<DivergenceResponse | { error: string; hint?: string }>
> {
  const paperTrades = tradesFromJournal(await loadJournal());
  if (paperTrades.length === 0) {
    return NextResponse.json(
      { error: '페이퍼 트레이드가 없다', hint: 'npm run paper' },
      { status: 404 },
    );
  }

  const from = dayString(paperTrades[0].entryTime);
  const to = dayString(paperTrades[paperTrades.length - 1].exitTime + 86_400_000);
  const dir = path.resolve(process.cwd(), 'data');
  const [candles5m, candles15m] = await Promise.all([
    loadCandles(path.join(dir, `btcusdt-5m-${from}-${to}.json`)),
    loadCandles(path.join(dir, `btcusdt-15m-${from}-${to}.json`)),
  ]);

  if (candles5m === null || candles15m === null) {
    return NextResponse.json(
      {
        error: `페이퍼가 커버한 구간(${from} ~ ${to})의 과거 캔들이 없다`,
        hint: `npm run fetch-history -- --from ${from} --to ${to}`,
      },
      { status: 404 },
    );
  }

  const result = runBacktest({
    candles5m,
    candles15m,
    params: {
      ...DEFAULT_BACKTEST_PARAMS,
      account: DEFAULT_ACCOUNT,
      entry: DEFAULT_ENTRY_CONFIG,
    },
  });

  return NextResponse.json({
    ...compareTrades(paperTrades, result.trades),
    from,
    to,
    paperTrades: paperTrades.length,
    backtestTrades: result.trades.length,
  });
}
