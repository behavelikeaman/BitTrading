'use client';

import type { PositionPlan, Signal } from '@/types';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import { stopScenarios } from '@/lib/risk/stop-scenarios';
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
  /** 편도 체결비용(수수료 + 슬리피지). 손절 시나리오 손실 계산에 쓴다. */
  costRatePerSide: number;
  /** 현재 설정된 ATR 손절 배수. 시나리오 표에서 "현재 설정"을 표시한다. */
  atrStopMultiple: number;
}

/** 비교할 손절 자리 — 현재 설정보다 넓은 쪽으로 늘어놓는다 */
const SCENARIO_MULTIPLES = [2, 3, 5];

/**
 * "손절을 여기 두면 승률이 몇 %는 나와야 하는가".
 *
 * 재량으로 자르는 사람에게 필요한 건 손절가가 아니라 그 자리의 대가다.
 * "조금만 더 보자"가 필요 승률 몇 %p짜리 결정인지 진입 전에 보여준다.
 */
function StopScenarioTable({
  plan,
  atr,
  costRatePerSide,
  atrStopMultiple,
}: {
  plan: PositionPlan;
  atr: number;
  costRatePerSide: number;
  atrStopMultiple: number;
}) {
  const multiples = [
    atrStopMultiple,
    ...SCENARIO_MULTIPLES.filter((m) => m > atrStopMultiple),
  ];
  const rows = stopScenarios({
    direction: plan.direction,
    legs: plan.legs,
    atr,
    liquidationPrice: plan.liquidationPrice,
    totalMargin: plan.totalMargin,
    rewardAtTarget: plan.rewardAtTarget,
    costRatePerSide,
    atrMultiples: multiples,
  });
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 border-t border-neutral-800 pt-3">
      <h3 className="text-sm font-semibold text-neutral-300">
        손절을 어디 두느냐가 필요 승률을 정한다
      </h3>
      <p className="mt-0.5 mb-2 text-xs text-neutral-400">
        익절은 그대로 두고 손절 자리만 바꿨을 때. 재량으로 버틸수록 아래 줄로 내려간다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
          <thead className="text-neutral-400">
            <tr>
              <th className="py-1 text-left">손절 자리</th>
              <th className="py-1 text-right">손절가</th>
              <th className="py-1 text-right">손실</th>
              <th className="py-1 text-right">증거금 대비</th>
              <th className="py-1 text-right">필요 승률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrent = row.atrMultiple === atrStopMultiple;
              return (
                <tr
                  key={row.label}
                  className={`border-t border-neutral-900 ${
                    isCurrent ? 'bg-neutral-900/60' : ''
                  }`}
                >
                  <td className="py-1.5 text-neutral-200">
                    {row.label}
                    {isCurrent && (
                      <span className="ml-1 text-[11px] text-neutral-400">(현재 설정)</span>
                    )}
                    {row.beyondLiquidation && row.atrMultiple !== null && (
                      <span className="ml-1 text-[11px] text-[var(--color-warn)]">
                        청산이 먼저
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {formatPrice(row.stopPrice)}
                  </td>
                  <td className="text-right tabular-nums text-[var(--color-short)]">
                    {formatSignedUsd(-row.loss)}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {formatPct(row.lossPctOfMargin)}
                  </td>
                  <td
                    className={`text-right font-semibold tabular-nums ${
                      row.breakEvenWinRate > 0.6
                        ? 'text-[var(--color-short)]'
                        : 'text-[var(--color-long)]'
                    }`}
                  >
                    {formatPct(row.breakEvenWinRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
            ? 'text-neutral-400'
            : '';
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-neutral-300">{label}</span>
      <span
        className={`tabular-nums ${big ? 'text-lg font-semibold' : 'text-sm font-medium'} ${color}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 어떤 자리인지 한 줄로 띄운다.
 *
 * 점수만 보면 눌림목 재진입과 과이격 되돌림이 구분되지 않는다. 둘은
 * 방향도 목표도 다른 자리라, 같은 9점이라도 주문을 넣는 손이 달라야 한다.
 */
function SetupBanner({ setup }: { setup: Signal['setup'] }) {
  const tone =
    setup.kind === 'overextended-reversion'
      ? 'border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 text-[var(--color-warn)]'
      : setup.kind === 'overextended-chase'
        ? 'border-[var(--color-short)]/50 bg-[var(--color-short)]/10 text-[var(--color-short)]'
        : 'border-neutral-700 bg-neutral-900 text-neutral-200';
  return (
    <div className={`mb-3 rounded border px-3 py-2 ${tone}`}>
      <div className="text-sm font-semibold">{setup.label}</div>
      <div className="mt-0.5 text-xs text-neutral-400">{setup.detail}</div>
    </div>
  );
}

/**
 * 주문을 넣기 전에 확인해야 할 숫자만 크게 보여준다.
 *
 * 진입 불가 상태에서는 계획 대신 차단 사유를 크게 띄운다. "왜 진입하면
 * 안 되는지"가 이 화면의 핵심 가치다.
 */
export function OrderTicket({
  signal,
  plan,
  equity,
  costEstimated,
  costRatePerSide,
  atrStopMultiple,
}: Props) {
  // 진입이 차단된 계획은 수치를 보여주지 않는다. 청산이 손절보다 가까우면
  // 손절이 체결되지 않아 화면의 "손절 시 손실"이 실제와 다르기 때문이다 (ADR-008).
  if (plan !== null && !plan.tradable) {
    return (
      <section className="rounded-lg border border-[var(--color-short)]/60 bg-[var(--color-short)]/10 p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-short)]">
          진입 차단 — 이 설정으로는 주문하면 안 된다
        </h2>
        <ul className="space-y-1">
          {plan.warnings.map((w) => (
            <li key={w} className="text-base text-[var(--color-short)]">
              • {w}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          손절이 체결되기 전에 청산되므로 계산된 손실·손익비가 실제와 다르다. 아래 설정에서
          레버리지를 낮추거나 ATR 손절 배수를 줄여라.
        </p>
      </section>
    );
  }

  if (plan === null) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">진입 불가</h2>
        <SetupBanner setup={signal.setup} />
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
            점수 {signal.score}/{SCORE_ITEM_COUNT} — 확신도 기준 미달
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

      <SetupBanner setup={signal.setup} />

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
        {signal.setup.structureTarget !== null && (
          // 되돌림 셋업의 구조 목표(스택 하단). 지금 엔진의 익절은 고정 R배수라
          // 여기까지 들고 가지 않는다. 어느 쪽이 나은지는 백테스트로 정한다.
          <Row
            label="구조 목표 (스택 하단, 참고)"
            value={formatPrice(signal.setup.structureTarget)}
            tone="muted"
          />
        )}
      </div>

      {signal.indicators !== null && (
        <StopScenarioTable
          plan={plan}
          atr={signal.indicators.atr14}
          costRatePerSide={costRatePerSide}
          atrStopMultiple={atrStopMultiple}
        />
      )}
    </section>
  );
}
