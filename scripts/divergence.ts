/**
 * 페이퍼 vs 백테스트 괴리 검사 (ADR-020).
 *
 * 페이퍼가 기록한 구간을 백테스트로 재생해 같은 판단을 내렸는지 대조한다.
 * 산출물은 수익률이 아니라 **불일치 목록**이다. 불일치가 있으면 종료 코드 1로
 * 끝나므로 스크립트로 게이트를 걸 수 있다.
 *
 *   npm run divergence
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadJournal } from '../src/services/paper-store';
import { tradesFromJournal } from '../src/lib/paper/journal';
import { compareTrades } from '../src/lib/paper/divergence';
import { runBacktest, DEFAULT_BACKTEST_PARAMS } from '../src/lib/backtest/engine';
import { DEFAULT_ACCOUNT } from '../src/lib/risk/sizing';
import { DEFAULT_ENTRY_CONFIG } from '../src/lib/signal/entry';
import type { Candle } from '../src/types';

const log = (line = '') => process.stdout.write(`${line}\n`);

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

async function main(): Promise<void> {
  const journal = await loadJournal();
  const paperTrades = tradesFromJournal(journal);

  if (paperTrades.length === 0) {
    log('페이퍼 트레이드가 없다. 먼저 티커를 돌려 기록을 쌓아라:');
    log('  npm run paper');
    return;
  }

  const from = dayString(paperTrades[0].entryTime);
  const to = dayString(paperTrades[paperTrades.length - 1].exitTime + 86_400_000);

  const dir = path.resolve(process.cwd(), 'data');
  const file = path.join(dir, `btcusdt-5m-${from}-${to}.json`);
  const candles = await loadCandles(file);

  if (candles === null) {
    log(`페이퍼가 커버한 구간(${from} ~ ${to})의 과거 캔들이 없다.`);
    log('먼저 내려받아라 (로컬에서 실행):');
    log(`  npm run fetch-history -- --from ${from} --to ${to}`);
    return;
  }

  const result = runBacktest({
    candles,
    params: {
      ...DEFAULT_BACKTEST_PARAMS,
      account: DEFAULT_ACCOUNT,
      entry: DEFAULT_ENTRY_CONFIG,
    },
  });

  const report = compareTrades(paperTrades, result.trades);

  log('');
  log(`구간        ${from} ~ ${to}`);
  log(`페이퍼      ${paperTrades.length}건`);
  log(`백테스트    ${result.trades.length}건`);
  log(`짝 일치율   ${(report.matchRate * 100).toFixed(1)}%`);
  log('');

  if (report.divergences.length === 0) {
    log('불일치 0건 — 페이퍼와 백테스트가 같은 판단을 내렸다.');
    log('');
    log('주의: 이것은 "배선이 맞다"는 뜻이지 "엣지가 있다"는 뜻이 아니다.');
    return;
  }

  const byKind = new Map<string, typeof report.divergences>();
  for (const d of report.divergences) {
    const list = byKind.get(d.kind) ?? [];
    list.push(d);
    byKind.set(d.kind, list);
  }

  for (const [kind, list] of byKind) {
    log(`[${kind}] ${list.length}건`);
    for (const d of list.slice(0, 20)) {
      const delta = d.deltaPct === undefined ? '' : ` (${(d.deltaPct * 100).toFixed(3)}%)`;
      log(`  ${new Date(d.at).toISOString().slice(0, 16)}  페이퍼 ${d.paper}  vs  백테스트 ${d.backtest}${delta}`);
    }
    if (list.length > 20) log(`  … 외 ${list.length - 20}건`);
    log('');
  }

  log(`불일치 ${report.divergences.length}건 — 실거래를 논하기 전에 원인을 찾아야 한다.`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n오류: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
