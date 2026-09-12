/**
 * 페이퍼 트레이딩 티커.
 *
 * 새 확정봉이 나올 때마다 체결 상태 기계를 한 스텝 진행시킨다.
 * 백테스트와 같은 함수를 쓰므로 두 경로가 어긋날 수 없다 (ADR-016).
 *
 * 시간을 진행시키는 주체는 이 프로세스 하나뿐이다. 브라우저가 진행시키면
 * 탭을 닫는 순간 손절을 놓친다 (ADR-018).
 *
 *   npm run paper
 *   npm run paper -- --reset --equity 5000 --interval 20
 */
import { DEFAULT_ACCOUNT } from '../src/lib/risk/sizing';
import { DEFAULT_ENTRY_CONFIG } from '../src/lib/signal/entry';
import { DEFAULT_BACKTEST_PARAMS, toExecutionConfig } from '../src/lib/backtest/engine';
import { createPendingOrder, stepExecution } from '../src/lib/execution/machine';
import { evaluateEntry } from '../src/lib/signal/entry';
import { resetDaily, updateGuard } from '../src/lib/risk/guard';
import {
  createInitialState,
  pendingCandles,
  type PaperState,
} from '../src/lib/paper/state';
import {
  appendJournal,
  loadState,
  resetPaper,
  saveState,
  statePath,
} from '../src/services/paper-store';
import { fetchFundingRate, fetchRecentCandles } from '../src/services/deepcoin';
import { parseTimeframe, timeframeSpec } from '../src/lib/timeframe';

const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const FAILURE_ALERT_THRESHOLD = 10;

interface Args {
  reset: boolean;
  equity: number;
  intervalSec: number;
  timeframe: '5m' | '15m';
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const equity = Number(get('equity') ?? DEFAULT_ACCOUNT.equity);
  const intervalSec = Number(get('interval') ?? 20);
  return {
    reset: argv.includes('--reset'),
    equity: Number.isFinite(equity) ? equity : DEFAULT_ACCOUNT.equity,
    intervalSec: Number.isFinite(intervalSec) ? Math.max(5, intervalSec) : 20,
    timeframe: parseTimeframe(get('timeframe')),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const log = (line: string) => process.stdout.write(`${line}\n`);
const status = (line: string) => process.stderr.write(`\r${line.padEnd(100)}`);

function ts(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    log('사용법: npm run paper -- [--reset] [--equity 5000] [--interval 20] [--timeframe 5m|15m]');
    log('  --reset      기존 상태를 지우고 새로 시작');
    log('  --equity     시작 자본 (USDT)');
    log('  --interval   폴링 간격 (초, 최소 5)');
    log('  --timeframe  기준 봉 (5m 또는 15m)');
    return;
  }

  if (args.reset) {
    await resetPaper();
    log('기존 상태와 일지를 지웠다.');
  }

  let state: PaperState | null = await loadState();
  if (state === null) {
    state = createInitialState(args.equity, Date.now());
    await saveState(state);
    log(`새로 시작한다. 자본 ${args.equity} USDT · ${statePath()}`);
  } else {
    log(
      `이어서 진행한다. 자본 ${state.equity.toFixed(2)} USDT · 마지막 봉 ${ts(state.lastCandleTime)}` +
        (state.position !== null ? ' · 포지션 보유 중' : ''),
    );
  }

  log('');
  log('  ⚠ 슬리피지는 가정값이다. 실거래 성적은 이보다 나쁘다.');
  log('    이 도구의 목적은 수익 확인이 아니라 백테스트와의 정합성 검증이다.');
  log('');

  const spec = timeframeSpec(args.timeframe);
  log(`기준 봉 ${spec.label} (상위 ${spec.higher})`);
  log('');

  const execConfig = toExecutionConfig({
    ...DEFAULT_BACKTEST_PARAMS,
    timeframe: args.timeframe,
    maxHoldBars: spec.defaultMaxHoldBars,
    account: { ...DEFAULT_ACCOUNT, equity: state.equity },
    entry: DEFAULT_ENTRY_CONFIG,
  });

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    process.stderr.write('\n종료 중… 상태를 저장한다.\n');
  });

  let consecutiveFailures = 0;

  while (!stopping) {
    try {
      const [candles5m, candles15m, fundingRate] = await Promise.all([
        fetchRecentCandles({ bar: spec.primary, limit: 300 }),
        fetchRecentCandles({ bar: spec.higher, limit: 200 }),
        fetchFundingRate().catch(() => 0),
      ]);
      consecutiveFailures = 0;

      // 밀린 캔들을 전부 순서대로 소화한다. 마지막 봉만 처리하면
      // 그 사이의 손절을 통째로 건너뛴다.
      const todo = pendingCandles(state, candles5m);

      for (const candle of todo) {
        const day = Math.floor(candle.openTime / MS_DAY);
        if (state.currentDay !== -1 && day !== state.currentDay) {
          state = { ...state, guard: resetDaily() };
        }
        state = { ...state, currentDay: day };

        const stepped = stepExecution({
          candle,
          pending: state.pending,
          position: state.position,
          equity: state.equity,
          config: { ...execConfig, account: { ...execConfig.account, equity: state.equity } },
        });

        state = { ...state, pending: stepped.pending, position: stepped.position };

        if (stepped.trade !== null) {
          const t = stepped.trade;
          state = {
            ...state,
            equity: state.equity + t.netPnl,
            guard: updateGuard(state.guard, t.netPnlPct),
          };
          await appendJournal({ type: 'trade', at: t.exitTime, trade: t });
          log(
            `[${ts(t.exitTime)}] 청산 ${t.direction === 'long' ? '롱' : '숏'} ` +
              `${t.exitReason} @ ${t.exitPrice.toFixed(1)} · ${t.netPnl >= 0 ? '+' : ''}${t.netPnl.toFixed(2)} USDT ` +
              `· 자본 ${state.equity.toFixed(2)}`,
          );
        }

        // 플랫이면 이 캔들 종가로 시그널을 평가한다.
        if (state.position === null && state.pending === null) {
          const upTo = candles5m.filter((c) => c.openTime <= candle.openTime);
          const htfUpTo = candles15m.filter(
            (c) => c.openTime + spec.higherMs <= candle.openTime + spec.barMs,
          );
          const signal = evaluateEntry(
            {
              candles5m: upTo.slice(-DEFAULT_BACKTEST_PARAMS.signalWindowBars),
              candles15m: htfUpTo.slice(-DEFAULT_BACKTEST_PARAMS.signalWindowBars),
              fundingRate,
              nowMs: candle.openTime,
            },
            state.guard,
            DEFAULT_ENTRY_CONFIG,
          );

          const order = createPendingOrder({
            signal,
            candle,
            limitValidBars: DEFAULT_BACKTEST_PARAMS.limitValidBars,
            barMs: execConfig.barMs,
          });
          if (order !== null && signal.direction !== null) {
            state = { ...state, pending: order, signalCount: state.signalCount + 1 };
            // 체결 여부와 무관하게 신호를 남긴다. 체결률 계산에 필요하다.
            await appendJournal({
              type: 'signal',
              at: candle.openTime,
              signal: {
                direction: signal.direction,
                conviction: signal.conviction,
                score: signal.score,
                price: candle.close,
              },
            });
            log(
              `[${ts(candle.openTime)}] 신호 ${signal.direction === 'long' ? '롱' : '숏'} ` +
                `${signal.conviction} ${signal.score}/8 @ ${candle.close.toFixed(1)}`,
            );
          }
        }

        // 매 캔들마다 저장한다. 종료 시점에만 저장하면 강제 종료 시 잃는다.
        state = { ...state, lastCandleTime: candle.openTime, updatedAt: Date.now() };
        await saveState(state);
      }

      if (todo.length === 0) {
        state = { ...state, updatedAt: Date.now() };
        await saveState(state);
      }

      status(
        `자본 ${state.equity.toFixed(2)} · ${state.position === null ? '포지션 없음' : '보유 중'} ` +
          `· 마지막 봉 ${ts(state.lastCandleTime)} · 신호 ${state.signalCount}건`,
      );
    } catch (error) {
      // 조회 실패로 프로세스를 죽이지 않는다. 24시간 돌아야 한다.
      consecutiveFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n조회 실패 (${consecutiveFailures}회): ${message}\n`);

      if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
        process.stderr.write(
          `\n⚠ ${consecutiveFailures}회 연속 실패했다. 네트워크나 API 설정을 확인하라.\n`,
        );
      }

      const backoff = Math.min(
        args.intervalSec * 1000 * 2 ** Math.min(consecutiveFailures, 5),
        MAX_BACKOFF_MS,
      );
      await sleep(backoff);
      continue;
    }

    await sleep(args.intervalSec * 1000);
  }

  await saveState({ ...state, updatedAt: Date.now() });
  process.stderr.write('저장 완료.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\n오류: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
