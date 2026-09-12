'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CandleChart } from '@/components/CandleChart';
import { CostBadge } from '@/components/CostBadge';
import { OrderTicket } from '@/components/OrderTicket';
import { RiskWarning } from '@/components/RiskWarning';
import { ScoreBreakdown } from '@/components/ScoreBreakdown';
import { SettingsPanel, type GuardInput, type Settings } from '@/components/SettingsPanel';
import { SignalPanel } from '@/components/SignalPanel';
import { computeIndicators } from '@/lib/indicators';
import { useLocalStorage } from '@/lib/use-local-storage';
import { TIMEFRAMES, timeframeSpec, type Timeframe } from '@/lib/timeframe';
import { TIME_ZONE_LABEL, formatTime } from '@/lib/format';
import { SCORE_ITEM_COUNT } from '@/lib/signal/score';
import { costRatePerSide as costRate, DEFAULT_ACCOUNT } from '@/lib/risk/sizing';
import type { AccountParamsResponse } from '@/app/api/account-params/route';
import type { SignalResponse } from '@/app/api/signal/route';
import type { Candle } from '@/types';

const POLL_MS = 5000;

const DEFAULT_SETTINGS: Settings = {
  equity: 5000,
  leverage: 50,
  feeRatePerSide: 0.0004,
  slippageRatePerSide: 0.0002,
  riskPctHigh: 0.02,
  riskPctMedium: 0.01,
  atrStopMultiple: 1.2,
  targetRMultiple: 1.38,
};

const DEFAULT_GUARD: GuardInput = { consecutiveLosses: 0, dailyPnlPct: 0 };
const DEFAULT_TF: { timeframe: Timeframe } = { timeframe: '5m' };

export default function Home() {
  const [settings, setSettings] = useLocalStorage('bt.settings', DEFAULT_SETTINGS);
  const [guard, setGuard] = useLocalStorage('bt.guard', DEFAULT_GUARD);
  const [tf, setTf] = useLocalStorage('bt.timeframe', DEFAULT_TF);

  const [data, setData] = useState<SignalResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [accountParams, setAccountParams] = useState<AccountParamsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);

  /** 직전 확신도. none -> high/medium 전이일 때만 알린다. */
  const prevConviction = useRef<string>('none');

  const poll = useCallback(async () => {
    const query = new URLSearchParams({
      timeframe: tf.timeframe,
      consecutiveLosses: String(guard.consecutiveLosses),
      dailyPnlPct: String(guard.dailyPnlPct),
      equity: String(settings.equity),
      leverage: String(settings.leverage),
      feeRatePerSide: String(settings.feeRatePerSide),
      slippageRatePerSide: String(settings.slippageRatePerSide),
      riskPctHigh: String(settings.riskPctHigh),
      riskPctMedium: String(settings.riskPctMedium),
      atrStopMultiple: String(settings.atrStopMultiple),
      targetRMultiple: String(settings.targetRMultiple),
      costSource:
        accountParams?.feeSource === 'measured' &&
        accountParams?.slippageSource === 'measured'
          ? 'measured'
          : 'default',
    });

    try {
      const [signalRes, candleRes] = await Promise.all([
        fetch(`/api/signal?${query}`, { cache: 'no-store' }),
        fetch(`/api/candles?bar=${tf.timeframe}&limit=200`, { cache: 'no-store' }),
      ]);

      if (!signalRes.ok) {
        const body = (await signalRes.json()) as { error?: string };
        throw new Error(body.error ?? `시그널 조회 실패 (${signalRes.status})`);
      }

      const signalData = (await signalRes.json()) as SignalResponse;
      setData(signalData);
      setError(null);

      if (candleRes.ok) {
        const body = (await candleRes.json()) as { candles: Candle[] };
        setCandles(body.candles);
      }

      // 진입 조건이 새로 충족된 순간에만 알린다.
      if (
        prevConviction.current === 'none' &&
        signalData.signal.conviction !== 'none' &&
        notifyEnabled
      ) {
        const dir = signalData.signal.direction === 'long' ? '롱' : '숏';
        new Notification(
          `${dir} · ${signalData.signal.setup.label} (${signalData.signal.score}/${SCORE_ITEM_COUNT})`,
          {
            body: `진입 ${signalData.lastPrice} · 손절 ${signalData.plan?.stopPrice.toFixed(1)}`,
          },
        );
      }
      prevConviction.current = signalData.signal.conviction;
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, [guard, settings, accountParams, notifyEnabled, tf]);

  // 체결 비용은 자주 바뀌지 않으므로 진입 시 1회만 읽는다.
  useEffect(() => {
    fetch('/api/account-params', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p: AccountParamsResponse) => setAccountParams(p))
      .catch(() => setAccountParams(null));
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => {
      // 백그라운드 탭에서는 폴링을 멈춘다.
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const snapshots = computeIndicators(candles);

  const requestCommentary = async () => {
    if (data?.signal.indicators == null) return;
    setCommentaryLoading(true);
    try {
      const res = await fetch('/api/commentary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          indicators: data.signal.indicators,
          items: data.signal.items,
          lastPrice: data.lastPrice,
          fundingRate: data.fundingRate,
        }),
      });
      const body = (await res.json()) as { commentary?: string; error?: string };
      setCommentary(body.commentary ?? body.error ?? '해설을 받지 못했다');
    } catch (e) {
      setCommentary(e instanceof Error ? e.message : '해설 요청 실패');
    } finally {
      setCommentaryLoading(false);
    }
  };

  const enableNotifications = async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotifyEnabled(permission === 'granted');
  };

  // 편도 체결비용은 lib의 정의를 그대로 쓴다 (ADR-014). 화면에서 다시
  // 더하면 정의가 두 곳이 된다.
  const costRatePerSide = costRate({
    ...DEFAULT_ACCOUNT,
    feeRatePerSide: settings.feeRatePerSide,
    slippageRatePerSide: settings.slippageRatePerSide,
  });

  const costEstimated =
    accountParams === null ||
    accountParams.feeSource === 'default' ||
    accountParams.slippageSource === 'default';

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">BitTrading</h1>
          <p className="text-xs text-neutral-400">
            BTC-USDT 무기한 · {timeframeSpec(tf.timeframe).label} · 알림 전용 (주문은 직접 넣는다)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <div className="flex rounded border border-neutral-800">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTf({ timeframe: t })}
                className={`px-2 py-1 ${
                  tf.timeframe === t
                    ? 'bg-neutral-200 font-semibold text-neutral-900'
                    : 'text-neutral-400 hover:bg-neutral-900'
                }`}
              >
                {timeframeSpec(t).label}
              </button>
            ))}
          </div>
          <Link href="/backtest" className="hover:text-neutral-300">백테스트</Link>
          <Link href="/paper" className="hover:text-neutral-300">페이퍼</Link>
          {data && (
            <span>
              갱신 {formatTime(data.updatedAt)} {TIME_ZONE_LABEL}
            </span>
          )}
          {!notifyEnabled && (
            <button
              type="button"
              onClick={() => void enableNotifications()}
              className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-900"
            >
              알림 켜기
            </button>
          )}
        </div>
      </header>

      <CostBadge params={accountParams} />

      {error !== null && (
        <p className="rounded border border-[var(--color-short)]/50 bg-[var(--color-short)]/10 px-3 py-2 text-sm text-[var(--color-short)]">
          {error}
        </p>
      )}

      {data !== null && (
        <>
          <OrderTicket
            signal={data.signal}
            plan={data.plan}
            equity={settings.equity}
            costEstimated={costEstimated}
            costRatePerSide={costRatePerSide}
            atrStopMultiple={settings.atrStopMultiple}
          />
          <RiskWarning warnings={data.plan?.warnings ?? []} />
          <ScoreBreakdown items={data.signal.items} score={data.signal.score} />
          <SignalPanel
            indicators={data.signal.indicators}
            lastPrice={data.lastPrice}
            lastClosedAt={data.lastClosedAt}
            fundingRate={data.fundingRate}
          />
        </>
      )}

      {candles.length > 0 && (
        <CandleChart candles={candles} snapshots={snapshots} plan={data?.plan ?? null} />
      )}

      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-300">레짐 해설</h2>
          <button
            type="button"
            onClick={() => void requestCommentary()}
            disabled={commentaryLoading || data?.signal.indicators == null}
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
          >
            {commentaryLoading ? '생성 중…' : '해설 요청'}
          </button>
        </div>
        <p className="text-sm leading-relaxed text-neutral-400">
          {commentary ?? '버튼을 눌러야 호출한다 (요청당 비용이 든다).'}
        </p>
      </section>

      <SettingsPanel
        settings={settings}
        guard={guard}
        onSettings={setSettings}
        onGuard={setGuard}
        atr={data?.signal.indicators?.atr14 ?? null}
        price={data?.lastPrice ?? null}
      />

      <footer className="pb-8 text-center text-xs text-neutral-500">
        이 도구는 매매 판단을 보조할 뿐 수익을 보장하지 않는다. 레버리지 거래는 원금 전액을 잃을 수 있다.
      </footer>
    </main>
  );
}
