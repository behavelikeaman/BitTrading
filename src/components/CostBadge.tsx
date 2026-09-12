'use client';

import { formatRate } from '@/lib/format';
import type { AccountParamsResponse } from '@/app/api/account-params/route';

interface Props {
  params: AccountParamsResponse | null;
}

/**
 * 수수료·슬리피지가 실측인지 추정인지 표시한다 (ADR-012, ADR-014).
 *
 * 시장가 매매에서 슬리피지는 손익분기 승률을 몇 %p씩 움직이므로,
 * 추정치로 보고 있다는 사실 자체가 중요한 정보다.
 */
export function CostBadge({ params }: Props) {
  if (params === null) {
    return <span className="text-xs text-neutral-400">체결비용 불러오는 중…</span>;
  }

  const roundTrip = (params.taker + params.slippageRate) * 2;
  const estimated =
    params.feeSource === 'default' || params.slippageSource === 'default';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={
          params.feeSource === 'measured'
            ? 'text-[var(--color-long)]'
            : 'text-[var(--color-warn)]'
        }
      >
        수수료 {formatRate(params.taker)}/편도{' '}
        {params.feeSource === 'measured' ? '(실측)' : '(추정)'}
      </span>
      <span className="text-neutral-700">|</span>
      <span
        className={
          params.slippageSource === 'measured'
            ? 'text-[var(--color-long)]'
            : 'text-[var(--color-warn)]'
        }
      >
        슬리피지 {formatRate(params.slippageRate)}/편도{' '}
        {params.slippageSource === 'measured'
          ? `(실측 · 표본 ${params.slippageSampleCount}건)`
          : '(추정)'}
      </span>
      <span className="text-neutral-700">|</span>
      <span className="text-neutral-300">
        왕복 총마찰 {formatRate(roundTrip)} (명목가)
      </span>
      {estimated && (
        <span className="rounded bg-[var(--color-warn)]/15 px-1.5 py-0.5 text-[var(--color-warn)]">
          체결비용 추정 기준
        </span>
      )}
      {/* 왜 실측이 안 되는지 — 이게 없으면 "(추정)"이 영원히 안 바뀌는 이유를
          알 수 없다. 실측 수수료·슬리피지는 손익분기 승률을 수십 %p 움직인다. */}
      {params.credential !== undefined && !params.credential.ok && (
        <span className="basis-full text-neutral-400">
          읽기 전용 키: {params.credential.message}
        </span>
      )}
    </div>
  );
}
