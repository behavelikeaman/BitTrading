'use client';

import type { PositionPlan, Signal } from '@/types';
import {
  formatPct,
  formatPrice,
  formatQty,
  formatSignedUsd,
  formatUsd,
} from '@/lib/format';

interface Props {
  signal: Signal;
  plan: PositionPlan | null;
  equity: number;
  costEstimated: boolean;
}

function Row({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: 'long' | 'short' | 'warn' | 'muted';
  big?: boolean;
}) {
  const color =
    tone === 'long'
      ? 'text-[var(--color-long)]'
      : tone === 'short'
        ? 'text-[var(--color-short)]'
        : tone === 'warn'
          ? 'text-[var(--color-warn)]'
          : tone === 'muted'
            ? 'text-neutral-500'
            : '';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className={`${big ? 'text-lg font-semibold' : 'text-sm'} ${color}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * 주문을 넣기 전에 확인해야 할 숫자만 크게 보여준다.
 *
 * 진입 불가 상태에서는 계획 대신 차단 사유를 크게 띄운다. "왜 진입하면
 * 안 되는지"가 이 화면의 핵심 가치다.
 */
export function OrderTicket({ signal, plan, equity, costEstimated }: Props) {
  if (plan === null) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">진입 불가</h2>
        {signal.blockers.length > 0 ? (
          <ul className="space-y-1">
            {signal.blockers.map((blocker) => (
              <li key={blocker} className="text-base text-[var(--color-warn)]">
                • {blocker}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-neutral-400">
            점수 {signal.score}/8 — 확신도 기준 미달
          </p>
        )}
      </section>
    );
  }

  const isLong = plan.direction === 'long';
  const tone = isLong ? 'long' : 'short';
  const lossPctOfEquity = equity > 0 ? plan.riskBudget / equity : 0;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">주문 티켓</h2>
        <span
          className={`rounded px-2 py-0.5 text-sm font-bold ${
            isLong
              ? 'bg-[var(--color-long)]/15 text-[var(--color-long)]'
              : 'bg-[var(--color-short)]/15 text-[var(--color-short)]'
          }`}
        >
          {isLong ? '롱' : '숏'} · {plan.conviction === 'high' ? '확신' : '약간의 확신'}
        </span>
      </div>

      <div className="mb-3 border-b border-neutral-800 pb-2">
        {plan.legs.map((leg) => (
          <Row
            key={leg.index}
            label={leg.index === 0 ? '1차 진입' : `물타기 ${leg.index}`}
            value={`${formatPrice(leg.price)}  ×  ${formatQty(leg.qty)} BTC`}
            tone={tone}
            big={leg.index === 0}
          />
        ))}
      </div>

      <Row label="손절가" value={formatPrice(plan.stopPrice)} tone="short" big />
      <Row label="익절가" value={formatPrice(plan.takeProfitPrice)} tone="long" big />
      <Row label="본전가 (물타기 탈출)" value={formatPrice(plan.breakEvenPrice)} />
      <Row label="평단 (전량 체결 시)" value={formatPrice(plan.averageEntryPrice)} />
      <Row label="청산가" value={formatPrice(plan.liquidationPrice)} tone="warn" big />

      <div className="mt-3 border-t border-neutral-800 pt-2">
        <Row label="총증거금" value={`${formatUsd(plan.totalMargin)} USDT`} />
        <Row label="총명목가" value={`${formatUsd(plan.totalNotional)} USDT`} />
        <Row
          label="손절 시 손실"
          value={`${formatSignedUsd(-plan.riskBudget)} USDT (자본 ${formatPct(lossPctOfEquity)})`}
          tone="short"
        />
        <Row
          label="목표 도달 시 이익"
          value={`${formatSignedUsd(plan.rewardAtTarget)} USDT`}
          tone="long"
        />
        <Row
          label="손익분기 승률"
          value={`${formatPct(plan.breakEvenWinRate)}${costEstimated ? '  (체결비용 추정 기준)' : ''}`}
          tone={plan.breakEvenWinRate > 0.6 ? 'warn' : undefined}
          big
        />
        <Row
          label="증거금 대비 목표"
          value={formatPct(plan.targetNetReturnOnMargin)}
          tone="muted"
        />
      </div>
    </section>
  );
}
