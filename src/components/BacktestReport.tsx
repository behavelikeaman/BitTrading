'use client';

import type { BacktestResult, TradeMetricsSummary } from '@/types';
import { SETUP_LABEL, type SetupKind } from '@/lib/signal/setup';
import { BAND_STATE_LABEL, type BandState } from '@/lib/signal/band-state';
import {
  TIME_ZONE_LABEL,
  formatDateTime,
  formatPct,
  formatProfitFactor,
  formatR,
  formatSignedUsd,
  formatPrice,
  formatUsd,
} from '@/lib/format';

interface Props {
  result: BacktestResult;
  /** 이론 손익분기 승률. 전량 체결·목표 도달을 가정한 값이다. */
  breakEvenWinRate: number | null;
  /** 이론 손익비 (목표 R배수). 실측 손익비와 나란히 놓는다. */
  targetRMultiple: number;
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
      <div className="text-xs font-medium text-neutral-400">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      {hint !== undefined && (
        <div className="mt-0.5 text-[11px] text-neutral-500">{hint}</div>
      )}
    </div>
  );
}

/**
 * 한 기준으로 쪼갠 성적표.
 *
 * 셋업·밴드 폭 상태·교차 횟수가 같은 열을 쓰도록 한 곳에 둔다. 표마다 열이
 * 다르면 나란히 읽을 수 없다.
 */
function Breakdown({
  title,
  note,
  firstColumn,
  rows,
}: {
  title: string;
  note: string;
  firstColumn: string;
  rows: [string, TradeMetricsSummary][];
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-1 text-sm font-semibold text-neutral-300">{title}</h2>
      <p className="mb-3 text-xs text-neutral-400">{note}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">트레이드가 없다</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1 text-left">{firstColumn}</th>
                <th className="py-1 text-right">건수</th>
                <th className="py-1 text-right">승률</th>
                <th className="py-1 text-right">필요 승률</th>
                <th className="py-1 text-right">손익비</th>
                <th className="py-1 text-right">기대값/건</th>
                <th className="py-1 text-right">평균 R</th>
                <th className="py-1 text-right">최대 낙폭</th>
                <th className="py-1 text-right">청산</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, m]) => (
                <tr key={label} className="border-t border-neutral-900">
                  <td className="py-1.5 font-medium text-neutral-100">{label}</td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {m.totalTrades}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {formatPct(m.winRate)}
                  </td>
                  <td
                    className={`text-right tabular-nums ${
                      m.requiredWinRate !== null && m.winRate < m.requiredWinRate
                        ? 'text-[var(--color-short)]'
                        : 'text-neutral-400'
                    }`}
                  >
                    {formatPct(m.requiredWinRate)}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {formatProfitFactor(m.profitFactor, m.totalTrades > 0)}
                  </td>
                  <td
                    className={`text-right tabular-nums ${
                      m.expectancy >= 0
                        ? 'text-[var(--color-long)]'
                        : 'text-[var(--color-short)]'
                    }`}
                  >
                    {formatSignedUsd(m.expectancy)}
                  </td>
                  <td
                    className={`text-right tabular-nums ${
                      m.averageR !== null && m.averageR >= 0
                        ? 'text-[var(--color-long)]'
                        : 'text-[var(--color-short)]'
                    }`}
                  >
                    {formatR(m.averageR)}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {formatPct(m.maxDrawdown)}
                  </td>
                  <td className="text-right tabular-nums text-neutral-300">
                    {m.liquidationCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const REASON_LABEL: Record<string, string> = {
  'take-profit': '익절',
  'stop-loss': '손절',
  liquidation: '청산',
  timeout: '타임아웃',
  'end-of-data': '데이터 끝',
};

export function BacktestReport({
  result,
  breakEvenWinRate,
  targetRMultiple,
  startingEquity,
}: Props) {
  const netPnl = result.finalEquity - startingEquity;
  // 건수 많은 셋업부터. 표본이 큰 쪽이 먼저 읽혀야 한다.
  const rowsOf = (
    group: Partial<Record<string, TradeMetricsSummary>> | undefined,
    label: (key: string) => string,
  ): [string, TradeMetricsSummary][] =>
    Object.entries(group ?? {})
      .filter((e): e is [string, TradeMetricsSummary] => e[1] !== undefined)
      .sort((a, b) => b[1].totalTrades - a[1].totalTrades)
      .map(([key, m]) => [label(key), m]);

  const setupRows = rowsOf(result.bySetup, (k) => SETUP_LABEL[k as SetupKind] ?? k);
  const bandRows = rowsOf(result.byBandState, (k) => BAND_STATE_LABEL[k as BandState] ?? k);
  // 교차 횟수는 '1회' < '2회' < '3회+' 순으로 읽는 게 자연스럽다.
  const crossRows = rowsOf(result.byCrossCount, (k) => k).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  // 점수는 낮은 쪽부터 읽어야 단조 증가 여부가 눈에 들어온다.
  const scoreRows = rowsOf(result.byScore, (k) => k).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const grossProfit = result.trades
    .filter((t) => t.netPnl > 0)
    .reduce((s, t) => s + t.netPnl, 0);
  // 판정 기준은 **실측** 필요 승률이다. 이론 손익분기 승률은 전량 체결 뒤
  // 목표에 닿는 경우만 세기 때문에 실전보다 15~20%p 낙관적이었다. 그 값으로
  // 초록불을 켜는 동안 6개월 백테스트의 계좌는 97% 녹았다.
  const required = result.requiredWinRate;
  const beatsRequired = required === null ? null : result.winRate >= required;
  // 이론이 실측보다 얼마나 낙관적인가. 이 간극이 위 사고의 정체다.
  const optimismGap =
    required === null || breakEvenWinRate === null
      ? null
      : required - breakEvenWinRate;

  return (
    <div className="space-y-4">
      {/* 이 설정으로 돈을 벌 수 있는가 — 가장 직접적인 답 */}
      <section
        className={`rounded-lg border p-4 ${
          beatsRequired === false
            ? 'border-[var(--color-short)]/50 bg-[var(--color-short)]/5'
            : 'border-neutral-800 bg-neutral-950'
        }`}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">
          실제 승률 vs 필요 승률
        </h2>
        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <div className="text-xs font-medium text-neutral-400">
              실제 승률
            </div>
            <div className="text-3xl font-bold">{formatPct(result.winRate)}</div>
          </div>
          <div className="text-2xl text-neutral-500">vs</div>
          <div>
            <div className="text-xs font-medium text-neutral-400">
              필요 승률 (실측)
            </div>
            <div className="text-3xl font-bold text-neutral-200">
              {formatPct(required)}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-500">
              평균 승 {formatUsd(result.averageWin)} / 평균 패{' '}
              {formatUsd(result.averageLoss)} = 실측 손익비{' '}
              {formatProfitFactor(result.payoffRatio, result.totalTrades > 0)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-neutral-500">
              손익분기 승률 (이론)
            </div>
            <div className="text-xl font-semibold text-neutral-500">
              {formatPct(breakEvenWinRate)}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-600">
              전량 체결 후 목표({targetRMultiple}R) 도달 가정
            </div>
          </div>
        </div>
        {beatsRequired === false && (
          <p className="mt-3 text-sm text-[var(--color-short)]">
            실제 승률이 필요 승률에 못 미친다. 이 설정으로는 장기적으로 손실이다.
          </p>
        )}
        {beatsRequired === true && (
          <p className="mt-3 text-sm text-[var(--color-long)]">
            실측 기준으로 손익분기를 넘겼다. 다만 표본이 {result.totalTrades}건이라는
            점을 감안하라.
          </p>
        )}
        {optimismGap !== null && optimismGap > 0.02 && (
          <p className="mt-2 text-xs text-[var(--color-warn)]">
            이론 손익분기 승률이 실측보다 {formatPct(optimismGap, 1)}p 낙관적이다.
            이론값은 목표 {targetRMultiple}R을 손익비로 쓰지만 실제로 잰 손익비는{' '}
            {formatProfitFactor(result.payoffRatio, result.totalTrades > 0)}였다 —
            이기는 거래는 1차 진입만 체결된 채 익절하고 지는 거래는 물타기까지
            체결된 뒤 손절나기 때문이다. 판단은 실측값으로 하라.
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
          label="실측 손익비 (평균승/평균패)"
          value={formatProfitFactor(result.payoffRatio, result.totalTrades > 0)}
          hint={`이론 ${targetRMultiple}R`}
          tone={
            result.payoffRatio !== null && result.payoffRatio < targetRMultiple * 0.7
              ? 'warn'
              : undefined
          }
        />
        <Stat
          label="기대값 / 트레이드"
          value={`${formatSignedUsd(result.expectancy)} USDT`}
          tone={result.expectancy >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="평균 R / 트레이드"
          value={formatR(result.averageR)}
          hint="순손익 ÷ 진입 시점 계획 손실"
          tone={result.averageR !== null && result.averageR >= 0 ? 'good' : 'bad'}
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

      {/* 서킷브레이커로 막힌 구간이 크면 이 백테스트는 기간의 일부만 검증한 것이다 */}
      {result.haltedBars > 0 && (
        <section className="rounded-lg border border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10 p-3">
          <p className="text-sm font-semibold text-[var(--color-warn)]">
            서킷브레이커로 {result.haltedBars.toLocaleString()}봉 동안 진입이 막혔다
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            그 구간은 검증되지 않았다. 연속 손실·일일 손실 한도를 늘리거나, 이 결과를
            &quot;막히기 전까지의 성적&quot;으로 읽어라.
          </p>
        </section>
      )}

      {/* 점수별 성적 — 채점 체계가 작동하는지를 가르는 표다 (ADR-025) */}
      <Breakdown
        title="점수별 성적 — 점수가 결과를 예측하는가"
        note="0 → 1 → 2 → 3점으로 평균 R이 단조 증가하면 그때 점수를 포지션 크기에 연결한다. 들쭉날쭉하면 점수 체계를 폐기하고 트리거 + 차단 조건만 남긴다. 구간이 4개뿐이라 구간당 30건(총 120건)이면 판정할 수 있다 — 지금은 점수가 크기를 바꾸지 않으므로 이 표가 순수하게 '자리의 질' 효과만 잰다."
        firstColumn="점수"
        rows={scoreRows}
      />

      {/* 셋업별 성적 — 전체 평균은 서로 다른 자리를 섞어버린다 (ADR-022) */}
      <Breakdown
        title="셋업별 성적 — 어느 자리가 돈을 벌었나"
        note="표본이 적은 셋업의 승률은 우연과 구분되지 않는다. 30건 미만은 참고만 하라."
        firstColumn="셋업"
        rows={setupRows}
      />

      {/* 진단: 좁은 관 → 재확장 가설. 아직 진입 조건이 아니다. */}
      <Breakdown
        title="밴드 폭 상태별 성적 — 좁은 관 다음의 재확장이 다른가"
        note="신호봉의 BB 폭 상태로 쪼갠 표다. 진입 조건이 아니라 진단이다. '좁은 관 직후 재확장'만 기대값이 뚜렷하게 낫다면 그때 채점·필터에 반영한다. 여기서도 30건 미만은 우연과 구분되지 않는다."
        firstColumn="밴드 폭 상태"
        rows={bandRows}
      />

      <Breakdown
        title="교차 노이즈별 성적 — 몇 번째 교차에 들어갔나"
        note="신호봉 기준 최근 12봉(1시간) 안의 EMA12 × BB중앙선 교차 횟수다. 1회는 조용하던 구간을 한 번에 뚫은 교차, 3회+는 좁은 관 안에서 골든·데드를 반복하던 휩소 구간의 교차다."
        firstColumn="최근 12봉 교차"
        rows={crossRows}
      />

      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">
          트레이드 ({result.trades.length}건)
        </h2>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
            <thead className="sticky top-0 bg-neutral-950 text-neutral-400">
              <tr>
                <th className="py-1 text-left">진입 ({TIME_ZONE_LABEL})</th>
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
                  <td className="py-1 tabular-nums text-neutral-400">
                    {formatDateTime(t.entryTime)}
                  </td>
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
