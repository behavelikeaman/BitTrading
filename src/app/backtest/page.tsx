'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DEFAULT_ENTRY_CONFIG } from '@/lib/signal/entry';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import { BacktestReport } from '@/components/BacktestReport';
import { useLocalStorage } from '@/lib/use-local-storage';
import { formatPct, formatProfitFactor, formatUsd } from '@/lib/format';
import { TIMEFRAMES, timeframeSpec, type Timeframe } from '@/lib/timeframe';
import type { BacktestResult } from '@/types';

interface Params {
  from: string;
  to: string;
  timeframe: Timeframe;
  equity: number;
  leverage: number;
  feeRatePerSide: number;
  slippageRatePerSide: number;
  riskPctHigh: number;
  riskPctMedium: number;
  atrStopMultiple: number;
  targetRMultiple: number;
  scoreDrivesSizing: boolean;
  highConvictionScore: number;
  mediumConvictionScore: number;
  entryType: 'market' | 'limit';
  limitValidBars: number;
  maxHoldBars: number;
  ladderEnabled: boolean;
}

const DEFAULTS: Params = {
  from: '2025-01-01',
  to: '2025-06-30',
  timeframe: '5m',
  equity: 5000,
  leverage: 50,
  feeRatePerSide: 0.0004,
  slippageRatePerSide: 0.0002,
  riskPctHigh: 0.02,
  riskPctMedium: 0.01,
  atrStopMultiple: 1.2,
  targetRMultiple: 1.38,
  // 시그널 기본값을 그대로 쓴다. 여기에 숫자를 다시 적으면 백테스트와
  // 실시간이 다른 기준으로 판정하게 된다 (채점 항목이 10개로 늘어났을 때
  // 실제로 6/4가 남아 백테스트만 느슨해졌다).
  scoreDrivesSizing: DEFAULT_ENTRY_CONFIG.scoreDrivesSizing,
  highConvictionScore: DEFAULT_ENTRY_CONFIG.highConvictionScore,
  mediumConvictionScore: DEFAULT_ENTRY_CONFIG.mediumConvictionScore,
  entryType: 'market',
  limitValidBars: 3,
  maxHoldBars: 36,
  ladderEnabled: true,
};

/**
 * 손익분기 승률 = (손절폭 + 왕복마찰) / (목표폭 + 손절폭).
 *
 * 목표를 R배수로 정의했으므로 손절폭을 1로 두면 ATR 없이도 계산된다.
 * 다만 마찰은 가격 대비 비율이라 손절폭의 가격 비율이 필요하다. 여기서는
 * 기준값 0.42%(ATR 1.2배)를 쓰고, 실제 값은 대시보드 주문 티켓이 낸다.
 */
function theoreticalBreakEven(p: Params): number {
  const stopPct = 0.0042 * (p.atrStopMultiple / 1.2);
  const targetPct = stopPct * p.targetRMultiple;
  const friction = (p.feeRatePerSide + p.slippageRatePerSide) * 2;
  return (stopPct + friction) / (targetPct + stopPct);
}

function buildBody(
  p: Params,
  over: { entryType?: 'market' | 'limit'; ladderEnabled?: boolean } = {},
) {
  return {
    from: p.from,
    to: p.to,
    params: {
      timeframe: p.timeframe,
      entryType: over.entryType ?? p.entryType,
      ladderEnabled: over.ladderEnabled ?? p.ladderEnabled,
      limitValidBars: p.limitValidBars,
      maxHoldBars: p.maxHoldBars,
      account: {
        equity: p.equity,
        leverage: p.leverage,
        feeRatePerSide: p.feeRatePerSide,
        slippageRatePerSide: p.slippageRatePerSide,
        riskPctHigh: p.riskPctHigh,
        riskPctMedium: p.riskPctMedium,
        atrStopMultiple: p.atrStopMultiple,
        targetRMultiple: p.targetRMultiple,
      },
      entry: {
        scoreDrivesSizing: p.scoreDrivesSizing,
        highConvictionScore: p.highConvictionScore,
        mediumConvictionScore: p.mediumConvictionScore,
      },
    },
  };
}

function Field({
  label,
  value,
  step,
  onChange,
  type = 'number',
}: {
  label: string;
  value: string | number;
  step?: number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
      />
    </label>
  );
}

export default function BacktestPage() {
  // 키에 v3을 붙인 이유: 채점 항목이 10개에서 3개로 줄어 점수 기준의 의미가
  // 또 달라졌다 (ADR-025). 예전 키를 그대로 쓰면 브라우저에 남은 7/5가 3점
  // 만점 위에 얹혀, 어떤 신호도 확신 등급을 받지 못하는 백테스트가 된다.
  const [params, setParams] = useLocalStorage('bt.backtest.v3', DEFAULTS);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [compare, setCompare] = useState<{
    title: string;
    labelA: string;
    labelB: string;
    a: BacktestResult;
    b: BacktestResult;
    note: string;
  } | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const num = (key: keyof Params) => (v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) setParams({ ...params, [key]: n });
  };

  const run = async (mode: 'single' | 'entry-type' | 'ladder') => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCompare(null);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 200);

    try {
      const call = async (
        over: { entryType?: 'market' | 'limit'; ladderEnabled?: boolean } = {},
      ) => {
        const res = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildBody(params, over)),
        });
        const body = (await res.json()) as
          | BacktestResult
          | { error: string; hint?: string };
        if (!res.ok) throw body as { error: string; hint?: string };
        return body as BacktestResult;
      };

      if (mode === 'single') {
        setResult(await call());
      } else if (mode === 'entry-type') {
        const [a, b] = await Promise.all([
          call({ entryType: 'market' }),
          call({ entryType: 'limit' }),
        ]);
        setCompare({
          title: '시장가 vs 지정가',
          labelA: '시장가',
          labelB: '지정가',
          a,
          b,
          note: '지정가는 수수료가 싸지만 되돌림을 기다리다 가장 크게 달아난 트레이드를 놓친다. 체결률과 순손익을 함께 봐야 그 역선택 크기가 보인다.',
        });
      } else {
        const [a, b] = await Promise.all([
          call({ ladderEnabled: true }),
          call({ ladderEnabled: false }),
        ]);
        setCompare({
          title: '물타기 on vs off',
          labelA: '물타기 사용',
          labelB: '1차 진입만',
          a,
          b,
          note: '실측 손익비가 물타기를 끈 쪽에서 이론(목표 R배수)에 가까워지면, 손익비가 무너진 원인은 물타기의 비대칭이다 — 이기는 거래는 1차 진입만 체결된 채 익절하고 지는 거래는 레그가 다 채워진 뒤 손절난다. 두 열의 평균 승·평균 패를 나란히 보라.',
        });
      }
    } catch (e) {
      const err = e as { error?: string; hint?: string; message?: string };
      setError({
        message: err.error ?? err.message ?? '백테스트 실패',
        hint: err.hint,
      });
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  };

  const breakEven = theoreticalBreakEven(params);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">백테스트</h1>
          <p className="text-xs text-neutral-500">
            이 규칙이 과거에 실제로 돈이 됐는지 확인한다
          </p>
        </div>
        <nav className="flex gap-3 text-xs text-neutral-400">
          <Link href="/" className="hover:text-neutral-200">대시보드</Link>
          <Link href="/paper" className="hover:text-neutral-200">페이퍼</Link>
        </nav>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">파라미터</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="시작일" type="date" value={params.from} onChange={(v) => setParams({ ...params, from: v })} />
          <Field label="종료일" type="date" value={params.to} onChange={(v) => setParams({ ...params, to: v })} />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              기준 봉
            </span>
            <select
              value={params.timeframe}
              onChange={(e) => {
                const t = e.target.value as Timeframe;
                setParams({
                  ...params,
                  timeframe: t,
                  maxHoldBars: timeframeSpec(t).defaultMaxHoldBars,
                });
              }}
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {timeframeSpec(t).label}
                </option>
              ))}
            </select>
          </label>
          <Field label="자본금" value={params.equity} step={100} onChange={num('equity')} />
          <Field label="레버리지" value={params.leverage} step={1} onChange={num('leverage')} />
          <Field label="목표 R배수" value={params.targetRMultiple} step={0.01} onChange={num('targetRMultiple')} />
          <Field label="ATR 손절 배수" value={params.atrStopMultiple} step={0.1} onChange={num('atrStopMultiple')} />
          <Field label="편도 수수료" value={params.feeRatePerSide} step={0.0001} onChange={num('feeRatePerSide')} />
          <Field label="편도 슬리피지" value={params.slippageRatePerSide} step={0.0001} onChange={num('slippageRatePerSide')} />
          <Field label="리스크 (확신)" value={params.riskPctHigh} step={0.005} onChange={num('riskPctHigh')} />
          <Field label="리스크 (약간)" value={params.riskPctMedium} step={0.005} onChange={num('riskPctMedium')} />
          {/* 점수로 크기를 바꾸는 것은 아직 근거가 없다 (ADR-025). 기본은 끔이고,
              켠 백테스트와 비교해 볼 수 있게만 남겨둔다. */}
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              점수 사이징
            </span>
            <select
              value={params.scoreDrivesSizing ? 'on' : 'off'}
              onChange={(e) =>
                setParams({ ...params, scoreDrivesSizing: e.target.value === 'on' })
              }
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
            >
              <option value="off">끔 (전 거래 동일)</option>
              <option value="on">켬 (점수별 리스크)</option>
            </select>
          </label>
          <Field
            label={`확신 점수 기준 (/${SCORE_ITEM_COUNT})`}
            value={params.highConvictionScore}
            step={1}
            onChange={num('highConvictionScore')}
          />
          <Field
            label={`약간 점수 기준 (/${SCORE_ITEM_COUNT})`}
            value={params.mediumConvictionScore}
            step={1}
            onChange={num('mediumConvictionScore')}
          />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              진입 방식
            </span>
            <select
              value={params.entryType}
              onChange={(e) =>
                setParams({ ...params, entryType: e.target.value as 'market' | 'limit' })
              }
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
            >
              <option value="market">시장가</option>
              <option value="limit">지정가</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              물타기
            </span>
            <select
              value={params.ladderEnabled ? 'on' : 'off'}
              onChange={(e) =>
                setParams({ ...params, ladderEnabled: e.target.value === 'on' })
              }
              className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
            >
              <option value="on">사용 (확신 1회 · 약간 2회)</option>
              <option value="off">끔 (1차 진입만)</option>
            </select>
          </label>
          <Field label="지정가 유효 봉" value={params.limitValidBars} step={1} onChange={num('limitValidBars')} />
          <Field label="최대 보유 봉" value={params.maxHoldBars} step={1} onChange={num('maxHoldBars')} />
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          기준 {timeframeSpec(params.timeframe).label} (상위{' '}
          {timeframeSpec(params.timeframe).higher}) · 이론 손익분기 승률{' '}
          <span className="text-neutral-200">{formatPct(breakEven)}</span> · 왕복 총마찰{' '}
          {formatPct((params.feeRatePerSide + params.slippageRatePerSide) * 2, 4)} (증거금 대비{' '}
          {formatPct((params.feeRatePerSide + params.slippageRatePerSide) * 2 * params.leverage)})
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void run('single')}
            disabled={loading}
            className="rounded bg-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white disabled:opacity-40"
          >
            {loading ? `실행 중… ${(elapsed / 1000).toFixed(1)}s` : '실행'}
          </button>
          <button
            type="button"
            onClick={() => void run('entry-type')}
            disabled={loading}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
          >
            시장가 vs 지정가 비교
          </button>
          <button
            type="button"
            onClick={() => void run('ladder')}
            disabled={loading}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
          >
            물타기 on/off 비교
          </button>
        </div>
      </section>

      {error !== null && (
        <section className="rounded-lg border border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 p-4">
          <p className="text-sm text-[var(--color-warn)]">{error.message}</p>
          {error.hint !== undefined && (
            <>
              <p className="mt-2 text-xs text-neutral-400">
                과거 데이터를 먼저 내려받아야 한다 (로컬에서 실행):
              </p>
              <code className="mt-1 block select-all rounded bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200">
                {error.hint}
              </code>
            </>
          )}
        </section>
      )}

      {compare !== null && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">
            {compare.title}
          </h2>
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 text-left text-xs">항목</th>
                <th className="py-1 text-right text-xs">{compare.labelA}</th>
                <th className="py-1 text-right text-xs">{compare.labelB}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['신호 수', String(compare.a.signalCount), String(compare.b.signalCount)],
                ['체결률', formatPct(compare.a.fillRate), formatPct(compare.b.fillRate)],
                ['트레이드', String(compare.a.totalTrades), String(compare.b.totalTrades)],
                ['승률', formatPct(compare.a.winRate), formatPct(compare.b.winRate)],
                // 물타기 가설은 이 세 줄에서 갈린다. 승률이 같아도 평균 승·패가
                // 벌어져 있으면 필요 승률이 올라가고 계좌는 녹는다.
                [
                  '필요 승률 (실측)',
                  formatPct(compare.a.requiredWinRate),
                  formatPct(compare.b.requiredWinRate),
                ],
                [
                  '실측 손익비',
                  formatProfitFactor(compare.a.payoffRatio, compare.a.totalTrades > 0),
                  formatProfitFactor(compare.b.payoffRatio, compare.b.totalTrades > 0),
                ],
                [
                  '평균 승 / 평균 패',
                  `${formatUsd(compare.a.averageWin)} / ${formatUsd(compare.a.averageLoss)}`,
                  `${formatUsd(compare.b.averageWin)} / ${formatUsd(compare.b.averageLoss)}`,
                ],
                [
                  '기대값/건',
                  formatUsd(compare.a.expectancy),
                  formatUsd(compare.b.expectancy),
                ],
                [
                  '순손익',
                  formatUsd(compare.a.finalEquity - params.equity),
                  formatUsd(compare.b.finalEquity - params.equity),
                ],
                ['총 수수료', formatUsd(compare.a.totalFees), formatUsd(compare.b.totalFees)],
                [
                  '청산',
                  `${compare.a.liquidationCount}회`,
                  `${compare.b.liquidationCount}회`,
                ],
              ].map(([label, a, b]) => (
                <tr key={label} className="border-t border-neutral-900">
                  <td className="py-1.5 text-neutral-400">{label}</td>
                  <td className="py-1.5 text-right text-neutral-200">{a}</td>
                  <td className="py-1.5 text-right text-neutral-200">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-neutral-500">{compare.note}</p>
          <p className="mt-2 text-xs text-neutral-500">
            이론 손익비는 목표 {params.targetRMultiple}R이다. 실측 손익비가 그보다
            한참 낮으면 화면의 이론 손익분기 승률을 믿고 매매 여부를 판단할 수 없다.
          </p>
        </section>
      )}

      {result !== null && (
        <BacktestReport
          result={result}
          breakEvenWinRate={breakEven}
          targetRMultiple={params.targetRMultiple}
          startingEquity={params.equity}
        />
      )}
    </main>
  );
}
