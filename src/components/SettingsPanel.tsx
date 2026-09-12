'use client';

import { formatPct } from '@/lib/format';
import {
  breakEvenRMultiple,
  rMultipleForReturnOnMargin,
  returnOnMarginForR,
} from '@/lib/risk/target';

export interface Settings {
  equity: number;
  leverage: number;
  feeRatePerSide: number;
  slippageRatePerSide: number;
  riskPctHigh: number;
  riskPctMedium: number;
  atrStopMultiple: number;
  targetRMultiple: number;
}

export interface GuardInput {
  consecutiveLosses: number;
  dailyPnlPct: number;
}

interface Props {
  settings: Settings;
  guard: GuardInput;
  onSettings: (next: Settings) => void;
  onGuard: (next: GuardInput) => void;
  /** 증거금 대비 환산에 필요하다. 없으면 환산을 생략한다. */
  atr?: number | null;
  price?: number | null;
}

function Field({
  label,
  value,
  step,
  onChange,
  suffix,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (n: number) => void;
  suffix?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-400">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          disabled={disabled === true}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 disabled:opacity-40"
        />
        {suffix !== undefined && (
          <span className="shrink-0 text-xs text-neutral-400">{suffix}</span>
        )}
      </div>
      {hint !== undefined && (
        <span className="text-[11px] text-neutral-500">{hint}</span>
      )}
    </label>
  );
}

/**
 * 계좌·전략 설정. localStorage에 저장한다.
 *
 * 목표는 R배수로 입력받고 증거금 대비 환산값을 옆에 보여준다 (ADR-013).
 * 증거금 대비 %는 레버리지 종속값이라 그것만 보면 레버리지를 바꿨을 때
 * 전략이 통째로 달라진 것을 알아채지 못한다.
 */
export function SettingsPanel({
  settings,
  guard,
  onSettings,
  onGuard,
  atr,
  price,
}: Props) {
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) =>
    onSettings({ ...settings, [key]: value });

  const costRatePerSide = settings.feeRatePerSide + settings.slippageRatePerSide;
  const roundTripCost = costRatePerSide * 2;
  const canConvert =
    typeof atr === 'number' && atr > 0 && typeof price === 'number' && price > 0;

  // 환산은 전부 lib이 한다. 화면에서 다시 계산하면 정의가 두 곳이 된다.
  const conversion = canConvert
    ? {
        atr,
        price,
        atrStopMultiple: settings.atrStopMultiple,
        leverage: settings.leverage,
        costRatePerSide,
      }
    : null;
  const onMargin =
    conversion === null
      ? null
      : returnOnMarginForR({ ...conversion, targetRMultiple: settings.targetRMultiple });
  const minR = conversion === null ? null : breakEvenRMultiple(conversion);

  /** 증거금 대비 목표 %를 입력하면 R배수로 되돌려 저장한다 (ADR-013) */
  const setTargetByMargin = (pct: number) => {
    if (conversion === null) return;
    const r = rMultipleForReturnOnMargin({
      ...conversion,
      netReturnOnMargin: pct / 100,
    });
    if (r === null || !Number.isFinite(r)) return;
    // 소수점 둘째 자리까지만 — 그 아래는 ATR이 조금만 변해도 의미가 없다.
    onSettings({ ...settings, targetRMultiple: Math.round(r * 100) / 100 });
  };

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-300">설정</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="자본금" value={settings.equity} step={100} onChange={set('equity')} suffix="USDT" />
        <Field label="레버리지" value={settings.leverage} step={1} onChange={set('leverage')} suffix="x" />
        <Field label="편도 수수료" value={settings.feeRatePerSide} step={0.0001} onChange={set('feeRatePerSide')} />
        <Field label="편도 슬리피지" value={settings.slippageRatePerSide} step={0.0001} onChange={set('slippageRatePerSide')} />
        <Field label="리스크 (확신)" value={settings.riskPctHigh} step={0.005} onChange={set('riskPctHigh')} />
        <Field label="리스크 (약간)" value={settings.riskPctMedium} step={0.005} onChange={set('riskPctMedium')} />
        <Field label="ATR 손절 배수" value={settings.atrStopMultiple} step={0.1} onChange={set('atrStopMultiple')} />
        <Field label="목표 R배수" value={settings.targetRMultiple} step={0.01} onChange={set('targetRMultiple')} />
        {/* 형님은 "증거금 대비 몇 %"로 생각한다. 둘 중 아무거나 고치면 나머지가 따라온다. */}
        <Field
          label="목표 (증거금 대비)"
          value={onMargin === null ? 0 : Math.round(onMargin * 10000) / 100}
          step={1}
          onChange={setTargetByMargin}
          suffix="%"
          disabled={conversion === null}
          hint={conversion === null ? 'ATR 대기' : undefined}
        />
      </div>

      <p className="mt-2 text-xs text-neutral-400">
        목표 {settings.targetRMultiple}R ={' '}
        {onMargin === null ? (
          <span className="text-neutral-500">증거금 대비 환산 대기 (ATR 필요)</span>
        ) : (
          <>
            증거금 대비 순수익{' '}
            <span
              className={
                onMargin <= 0
                  ? 'font-semibold text-[var(--color-short)]'
                  : 'text-neutral-200'
              }
            >
              {formatPct(onMargin)}
            </span>
          </>
        )}
        {' · '}왕복 총마찰 {formatPct(roundTripCost, 4)} (증거금 대비{' '}
        {formatPct(roundTripCost * settings.leverage)})
      </p>

      {onMargin !== null && onMargin <= 0 && minR !== null && (
        // 목표가 마찰보다 작으면 익절해도 손해다. ATR이 줄어든 구간에서
        // 고정 R배수를 쓰면 실제로 이 상태가 된다.
        <p className="mt-1 rounded border border-[var(--color-short)]/50 bg-[var(--color-short)]/10 px-2 py-1.5 text-xs text-[var(--color-short)]">
          이 목표는 도달해도 손해다. 현재 ATR에서 마찰을 넘으려면 최소{' '}
          <span className="font-semibold">{minR.toFixed(2)}R</span> 이상이어야 한다.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-neutral-800 pt-3 md:grid-cols-4">
        <Field
          label="연속 손실"
          value={guard.consecutiveLosses}
          step={1}
          onChange={(n) => onGuard({ ...guard, consecutiveLosses: n })}
          suffix="회"
        />
        <Field
          label="당일 손익률"
          value={guard.dailyPnlPct}
          step={0.01}
          onChange={(n) => onGuard({ ...guard, dailyPnlPct: n })}
        />
        <button
          type="button"
          onClick={() => onGuard({ consecutiveLosses: 0, dailyPnlPct: 0 })}
          className="self-end rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
        >
          서킷브레이커 초기화
        </button>
      </div>
    </section>
  );
}
