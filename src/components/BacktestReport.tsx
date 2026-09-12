'use client';

import type { BacktestResult } from '@/types';
import {
  formatDateTime,
  formatPct,
  formatProfitFactor,
  formatSignedUsd,
  formatPrice,
  formatUsd,
} from '@/lib/format';

interface Props {
  result: BacktestResult;
  /** 이론 손익분기 승률. 실제 승률과 나란히 놓는다. */
  breakEvenWinRate: number | null;
  startingEquity: number;
}

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
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      {hint !== undefined && (
        <div className="mt-0.5 text-[10px] text-neutral-600">{hint}</div>
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

export function BacktestReport({ result, breakEvenWinRate, startingEquity }: Props) {
  const netPnl = result.finalEquity - startingEquity;
  const grossProfit = result.trades
    .filter((t) => t.netPnl > 0)
    .reduce((s, t) => s + t.netPnl, 0);
  const beatsBreakEven =
    breakEvenWinRate === null ? null : result.winRate >= breakEvenWinRate;

  return (
    <div className="space-y-4">
      {/* 이 설정으로 돈을 벌 수 있는가 — 가장 직접적인 답 */}
      <section
        className={`rounded-lg border p-4 ${
          beatsBreakEven === false
            ? 'border-[var(--color-short)]/50 bg-[var(--color-short)]/5'
            : 'border-neutral-800 bg-neutral-950'
        }`}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">
          실제 승률 vs 손익분기 승률
        </h2>
        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              실제 승률
            </div>
            <div className="text-3xl font-bold">{formatPct(result.winRate)}</div>
          </div>
          <div className="text-2xl text-neutral-600">vs</div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              손익분기 승률
            </div>
            <div className="text-3xl font-bold text-neutral-400">
              {breakEvenWinRate === null ? '—' : formatPct(breakEvenWinRate)}
            </div>
          </div>
        </div>
        {beatsBreakEven === false && (
          <p className="mt-3 text-sm text-[var(--color-short)]">
            실제 승률이 손익분기에 못 미친다. 이 설정으로는 장기적으로 손실이다.
          </p>
        )}
        {beatsBreakEven === true && (
          <p className="mt-3 text-sm text-[var(--color-long)]">
            손익분기를 넘겼다. 다만 표본이 {result.totalTrades}건이라는 점을 감안하라.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="총 트레이드" value={String(result.totalTrades)} />
        <Stat
          label="체결률"
          value={formatPct(result.fillRate)}
          hint={`신호 ${result.signalCount}건`}
          tone={result.fillRate < 0.9 ? 'warn' : undefined}
        />
        <Stat
          label="순손익"
          value={`${formatSignedUsd(netPnl)} USDT`}
          tone={netPnl >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="최종 자본"
          value={`${formatUsd(result.finalEquity)} USDT`}
          hint={`시작 ${formatUsd(startingEquity)}`}
        />
        <Stat label="손익비 (PF)" value={formatProfitFactor(result.profitFactor, result.totalTrades > 0)} />
        <Stat
          label="기대값 / 트레이드"
          value={`${formatSignedUsd(result.expectancy)} USDT`}
          tone={result.expectancy >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="최대 낙폭 (MDD)"
          value={formatPct(result.maxDrawdown)}
          tone={result.maxDrawdown > 0.3 ? 'bad' : undefined}
        />
        <Stat label="최대 연속 손실" value={`${result.maxConsecutiveLosses}회`} />
        <Stat
          label="총 수수료"
          value={`${formatUsd(result.totalFees)} USDT`}
          hint={grossProfit > 0 ? `총이익의 ${formatPct(result.totalFees / grossProfit)}` : undefined}
          tone="warn"
        />
        <Stat
          label="총 펀딩"
          value={`${formatSignedUsd(result.totalFunding)} USDT`}
        />
        <Stat
          label="청산 횟수"
          value={`${result.liquidationCount}회`}
          tone={result.liquidationCount > 0 ? 'bad' : 'good'}
        />
        <Stat label="총이익" value={`${formatUsd(grossProfit)} USDT`} tone="good" />
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">
          트레이드 ({result.trades.length}건)
        </h2>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
            <thead className="sticky top-0 bg-neutral-950 text-neutral-500">
              <tr>
                <th className="py-1 text-left">진입</th>
                <th className="py-1 text-left">방향</th>
                <th className="py-1 text-right">점수</th>
                <th className="py-1 text-right">평단</th>
                <th className="py-1 text-right">청산가</th>
                <th className="py-1 text-left">사유</th>
                <th className="py-1 text-right">순손익</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.map((t, i) => (
                <tr key={`${t.entryTime}-${i}`} className="border-t border-neutral-900">
                  <td className="py-1 text-neutral-400">{formatDateTime(t.entryTime)}</td>
                  <td
                    className={
                      t.direction === 'long'
                        ? 'text-[var(--color-long)]'
                        : 'text-[var(--color-short)]'
                    }
                  >
                    {t.direction === 'long' ? '롱' : '숏'}
                  </td>
                  <td className="text-right text-neutral-400">{t.score}</td>
                  <td className="text-right text-neutral-300">
                    {formatPrice(t.averageEntryPrice)}
                  </td>
                  <td className="text-right text-neutral-300">
                    {formatPrice(t.exitPrice)}
                  </td>
                  <td
                    className={
                      t.exitReason === 'liquidation'
                        ? 'text-[var(--color-short)] font-semibold'
                        : t.exitReason === 'take-profit'
                          ? 'text-[var(--color-long)]'
                          : 'text-neutral-400'
                    }
                  >
                    {REASON_LABEL[t.exitReason] ?? t.exitReason}
                  </td>
                  <td
                    className={`text-right ${
                      t.netPnl >= 0
                        ? 'text-[var(--color-long)]'
                        : 'text-[var(--color-short)]'
                    }`}
                  >
                    {formatSignedUsd(t.netPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
