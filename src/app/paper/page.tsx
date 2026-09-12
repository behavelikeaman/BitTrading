'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { winRateInterval } from '@/lib/paper/confidence';
import {
  TIME_ZONE_LABEL,
  formatDateTime,
  formatPct,
  formatPrice,
  formatProfitFactor,
  formatSignedPct,
  formatSignedUsd,
  formatUsd,
} from '@/lib/format';
import type { PaperResponse } from '@/app/api/paper/route';
import type { DivergenceResponse } from '@/app/api/paper/divergence/route';

const POLL_MS = 20_000;
/** 기본 설정(손절 0.42%, 목표 1.38R, 왕복 마찰 0.12%)의 손익분기 승률 */
const DEFAULT_BREAK_EVEN = 0.54;

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn';
  hint?: string;
}) {
  const color =
    tone === 'good'
      ? 'text-[var(--color-long)]'
      : tone === 'bad'
        ? 'text-[var(--color-short)]'
        : tone === 'warn'
          ? 'text-[var(--color-warn)]'
          : 'text-neutral-200';
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="text-xs font-medium text-neutral-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${color}`}>{value}</div>
      {hint !== undefined && (
        <div className="mt-0.5 text-[11px] text-neutral-500">{hint}</div>
      )}
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  'take-profit': '익절',
  'stop-loss': '손절',
  liquidation: '청산',
  timeout: '타임아웃',
  'end-of-data': '데이터 끝',
};

export default function PaperPage() {
  const [data, setData] = useState<PaperResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [divergence, setDivergence] = useState<DivergenceResponse | null>(null);
  const [divError, setDivError] = useState<{ message: string; hint?: string } | null>(null);
  const [divLoading, setDivLoading] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/paper', { cache: 'no-store' });
      if (!res.ok) throw new Error(`페이퍼 상태 조회 실패 (${res.status})`);
      setData((await res.json()) as PaperResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const reset = async () => {
    if (!window.confirm('페이퍼 상태와 매매 일지를 전부 지운다. 되돌릴 수 없다.')) return;
    await fetch('/api/paper/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    void poll();
  };

  const runDivergence = async () => {
    setDivLoading(true);
    setDivError(null);
    setDivergence(null);
    try {
      const res = await fetch('/api/paper/divergence', { method: 'POST' });
      const body = (await res.json()) as DivergenceResponse | { error: string; hint?: string };
      if (!res.ok) {
        const err = body as { error: string; hint?: string };
        setDivError({ message: err.error, hint: err.hint });
      } else {
        setDivergence(body as DivergenceResponse);
      }
    } catch (e) {
      setDivError({ message: e instanceof Error ? e.message : '괴리 검사 실패' });
    } finally {
      setDivLoading(false);
    }
  };

  const metrics = data?.metrics ?? null;
  const interval =
    metrics !== null && metrics.totalTrades > 0
      ? winRateInterval(metrics.winRate, metrics.totalTrades, DEFAULT_BREAK_EVEN)
      : null;
  const stale = data?.staleMs !== null && data?.staleMs !== undefined && !data.running;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">페이퍼 트레이딩</h1>
          <p className="text-xs text-neutral-500">
            백테스트와 같은 판단을 실시간에서도 내리는지 검증한다
          </p>
        </div>
        <nav className="flex gap-3 text-xs text-neutral-400">
          <Link href="/" className="hover:text-neutral-200">대시보드</Link>
          <Link href="/backtest" className="hover:text-neutral-200">백테스트</Link>
        </nav>
      </header>

      {/* 닫을 수 없는 경고 — 접히면 안 보이고, 안 보이면 착각한다 (ADR-019) */}
      <section className="rounded-lg border border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 p-3">
        <p className="text-sm text-[var(--color-warn)]">
          슬리피지는 가정값이다. 실거래 성적은 이보다 나쁘다.
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          이 화면의 목적은 수익 확인이 아니라 백테스트와의 정합성 검증이다. 표본이 모자라
          수익성을 판정할 수 없다 — 승률 5%p 차이를 구분하려면 400트레이드가 필요하다.
        </p>
      </section>

      {error !== null && (
        <p className="rounded border border-[var(--color-short)]/50 bg-[var(--color-short)]/10 px-3 py-2 text-sm text-[var(--color-short)]">
          {error}
        </p>
      )}

      {data !== null && data.state === null && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-sm text-neutral-300">아직 시작하지 않았다.</p>
          <p className="mt-2 text-xs text-neutral-500">로컬 터미널에서 티커를 띄운다:</p>
          <code className="mt-1 block select-all rounded bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200">
            npm run paper
          </code>
        </section>
      )}

      {stale && data?.state !== null && (
        <section className="rounded-lg border border-[var(--color-short)]/50 bg-[var(--color-short)]/10 p-3">
          <p className="text-sm font-semibold text-[var(--color-short)]">
            티커가 멈춘 것 같다 — 마지막 갱신 이후{' '}
            {Math.round((data?.staleMs ?? 0) / 60_000)}분 경과
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            멈춘 티커는 화면상 &quot;신호가 없는 것&quot;과 구분되지 않는다. 다시 띄운다:
          </p>
          <code className="mt-1 block select-all rounded bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200">
            npm run paper
          </code>
        </section>
      )}

      {data?.state != null && (
        <>
          <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-300">열린 포지션</h2>
              <span className={`text-xs ${data.running ? 'text-[var(--color-long)]' : 'text-neutral-500'}`}>
                {data.running ? '티커 동작 중' : '티커 중단'}
              </span>
            </div>
            {data.state.position === null ? (
              <p className="text-sm text-neutral-500">포지션 없음</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat
                  label="방향"
                  value={data.state.position.direction === 'long' ? '롱' : '숏'}
                  tone={data.state.position.direction === 'long' ? 'good' : 'bad'}
                />
                <Stat label="확신도" value={data.state.position.conviction} />
                <Stat label="체결 레그" value={`${data.state.position.filled.length}개`} />
                <Stat label="손절가" value={formatPrice(data.state.position.stopPrice)} tone="bad" />
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="자본"
              value={`${formatUsd(data.state.equity)} USDT`}
              hint={`시작 ${formatUsd(data.state.startingEquity)}`}
              tone={data.state.equity >= data.state.startingEquity ? 'good' : 'bad'}
            />
            <Stat label="트레이드" value={String(metrics?.totalTrades ?? 0)} />
            <Stat
              label="체결률"
              value={formatPct(data.fillRate)}
              hint={`신호 ${data.signalCount}건`}
            />
            <Stat
              label="청산 횟수"
              value={`${metrics?.liquidationCount ?? 0}회`}
              tone={(metrics?.liquidationCount ?? 0) > 0 ? 'bad' : 'good'}
            />
          </section>

          {/* 이 화면에서 가장 중요한 숫자는 불일치 건수다. 수익률보다 위에 둔다 (ADR-020) */}
          <section
            className={`rounded-lg border p-4 ${
              divergence === null
                ? 'border-neutral-800 bg-neutral-950'
                : divergence.divergences.length === 0
                  ? 'border-[var(--color-long)]/50 bg-[var(--color-long)]/5'
                  : 'border-[var(--color-short)]/50 bg-[var(--color-short)]/5'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-300">
                괴리 검사 — 백테스트와 같은 판단을 내렸는가
              </h2>
              <button
                type="button"
                onClick={() => void runDivergence()}
                disabled={divLoading}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
              >
                {divLoading ? '대조 중…' : '검사 실행'}
              </button>
            </div>

            {divError !== null && (
              <>
                <p className="text-sm text-[var(--color-warn)]">{divError.message}</p>
                {divError.hint !== undefined && (
                  <code className="mt-1 block select-all rounded bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200">
                    {divError.hint}
                  </code>
                )}
              </>
            )}

            {divergence !== null && (
              <>
                <div className="flex flex-wrap items-baseline gap-4">
                  <span
                    className={`text-3xl font-bold ${
                      divergence.divergences.length === 0
                        ? 'text-[var(--color-long)]'
                        : 'text-[var(--color-short)]'
                    }`}
                  >
                    불일치 {divergence.divergences.length}건
                  </span>
                  <span className="text-xs text-neutral-500">
                    {divergence.from} ~ {divergence.to} · 페이퍼 {divergence.paperTrades}건 vs
                    백테스트 {divergence.backtestTrades}건 · 짝 일치율{' '}
                    {formatPct(divergence.matchRate)}
                  </span>
                </div>

                {divergence.divergences.length === 0 ? (
                  <p className="mt-2 text-sm text-neutral-400">
                    배선이 맞다. 다만 이것은 &quot;엣지가 있다&quot;는 뜻이 아니다.
                  </p>
                ) : (
                  <div className="mt-3 max-h-64 overflow-auto">
                    <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
                      <thead className="sticky top-0 bg-neutral-950 text-neutral-400">
                        <tr>
                          <th className="py-1 text-left">종류</th>
                          <th className="py-1 text-left">시각 ({TIME_ZONE_LABEL})</th>
                          <th className="py-1 text-left">페이퍼</th>
                          <th className="py-1 text-left">백테스트</th>
                        </tr>
                      </thead>
                      <tbody>
                        {divergence.divergences.map((d, i) => (
                          <tr key={`${d.at}-${d.kind}-${i}`} className="border-t border-neutral-900">
                            <td className="py-1 text-[var(--color-short)]">{d.kind}</td>
                            <td className="tabular-nums text-neutral-400">{formatDateTime(d.at)}</td>
                            <td className="text-neutral-300">{d.paper}</td>
                            <td className="text-neutral-300">{d.backtest}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {divergence === null && divError === null && !divLoading && (
              <p className="text-sm text-neutral-500">
                페이퍼 구간을 백테스트로 재생해 진입 시각·방향·확신도·체결가를 대조한다.
                불일치가 0건이어야 실거래를 논할 수 있다.
              </p>
            )}
          </section>

          {/* 승률은 신뢰구간과 함께가 아니면 없는 확신을 만든다 (ADR-020) */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <h2 className="mb-3 text-sm font-semibold text-neutral-300">승률</h2>
            {interval === null ? (
              <p className="text-sm text-neutral-500">트레이드가 아직 없다</p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-4">
                  <span className="text-3xl font-bold">{formatPct(metrics!.winRate)}</span>
                  <span className="text-sm text-neutral-400">
                    95% 신뢰구간 {formatPct(interval.low)} ~ {formatPct(interval.high)}
                    {' '}(±{formatPct(interval.marginOfError)})
                  </span>
                </div>
                <p
                  className={`mt-2 text-sm ${
                    interval.conclusive ? 'text-[var(--color-long)]' : 'text-[var(--color-warn)]'
                  }`}
                >
                  {interval.conclusive
                    ? `신뢰구간 전체가 손익분기 ${formatPct(DEFAULT_BREAK_EVEN)} 위에 있다.`
                    : `표본 ${metrics!.totalTrades}건으로는 손익분기 ${formatPct(DEFAULT_BREAK_EVEN)}를 넘었는지 판정할 수 없다.`}
                </p>
              </>
            )}
          </section>

          {metrics !== null && metrics.totalTrades > 0 && (
            <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="손익비" value={formatProfitFactor(metrics.profitFactor, true)} />
              <Stat
                label="기대값 / 트레이드"
                value={`${formatSignedUsd(metrics.expectancy)} USDT`}
                tone={metrics.expectancy >= 0 ? 'good' : 'bad'}
              />
              <Stat label="최대 낙폭" value={formatPct(metrics.maxDrawdown)} />
              <Stat label="총 수수료" value={`${formatUsd(metrics.totalFees)} USDT`} tone="warn" />
            </section>
          )}

          <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-300">
                매매 일지 ({data.journal.length}건)
              </h2>
              <button
                type="button"
                onClick={() => void reset()}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
              >
                초기화
              </button>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
                <thead className="sticky top-0 bg-neutral-950 text-neutral-400">
                  <tr>
                    <th className="py-1 text-left">시각 ({TIME_ZONE_LABEL})</th>
                    <th className="py-1 text-left">유형</th>
                    <th className="py-1 text-left">방향</th>
                    <th className="py-1 text-right">점수</th>
                    <th className="py-1 text-right">가격</th>
                    <th className="py-1 text-right">손익 (자본 대비)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.journal].reverse().map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-t border-neutral-900">
                      <td className="py-1 tabular-nums text-neutral-400">
                        {formatDateTime(e.at)}
                      </td>
                      <td className="text-neutral-300">
                        {e.type === 'trade'
                          ? (REASON_LABEL[e.trade?.exitReason ?? ''] ?? '체결')
                          : e.type === 'signal'
                            ? '신호'
                            : '메모'}
                      </td>
                      <td
                        className={
                          (e.trade?.direction ?? e.signal?.direction) === 'long'
                            ? 'text-[var(--color-long)]'
                            : (e.trade?.direction ?? e.signal?.direction) === 'short'
                              ? 'text-[var(--color-short)]'
                              : 'text-neutral-600'
                        }
                      >
                        {(e.trade?.direction ?? e.signal?.direction) === 'long'
                          ? '롱'
                          : (e.trade?.direction ?? e.signal?.direction) === 'short'
                            ? '숏'
                            : '—'}
                      </td>
                      <td className="text-right text-neutral-400">
                        {e.trade?.score ?? e.signal?.score ?? '—'}
                      </td>
                      <td className="text-right text-neutral-300">
                        {formatPrice(e.trade?.exitPrice ?? e.signal?.price)}
                      </td>
                      <td
                        className={`text-right ${
                          (e.trade?.netPnl ?? 0) >= 0
                            ? 'text-[var(--color-long)]'
                            : 'text-[var(--color-short)]'
                        }`}
                      >
                        {e.trade === undefined ? (
                          '—'
                        ) : (
                          <>
                            <span className="font-semibold tabular-nums">
                              {formatSignedPct(e.trade.netPnlPct)}
                            </span>
                            <span className="ml-1 tabular-nums text-neutral-500">
                              ({formatSignedUsd(e.trade.netPnl)})
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
