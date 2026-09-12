'use client';

import { formatPct } from '@/lib/format';

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

/**
 * 목표 R배수를 현재 레버리지 기준 증거금 대비 순수익으로 환산한다 (ADR-013).
 *
 * 손절폭 = ATR × atrStopMultiple, 목표폭 = 손절폭 × targetRMultiple 이므로
 * ATR과 현재가가 있어야 계산할 수 있다.
 */
function targetReturnOnMargin(
  settings: Settings,
  atr: number,
  price: number,
): number {
  const targetWidth = atr * settings.atrStopMultiple * settings.targetRMultiple;
  const roundTrip = (settings.feeRatePerSide + settings.slippageRatePerSide) * 2;
  return (targetWidth / price) * settings.leverage - roundTrip * settings.leverage;
}

function Field({
  label,
  value,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
        />
        {suffix !== undefined && (
          <span className="shrink-0 text-xs text-neutral-500">{suffix}</span>
        )}
      </div>
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

  const roundTripCost = (settings.feeRatePerSide + settings.slippageRatePerSide) * 2;
  const canConvert =
    typeof atr === 'number' && atr > 0 && typeof price === 'number' && price > 0;
  const onMargin = canConvert ? targetReturnOnMargin(settings, atr, price) : null;

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
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        목표 {settings.targetRMultiple}R ={' '}
        {onMargin === null ? (
          <span className="text-neutral-600">증거금 대비 환산 대기 (ATR 필요)</span>
        ) : (
          <>
            증거금 대비 순수익{' '}
            <span className="text-neutral-300">{formatPct(onMargin)}</span>
          </>
        )}
        {' · '}왕복 총마찰 {formatPct(roundTripCost, 4)} (증거금 대비{' '}
        {formatPct(roundTripCost * settings.leverage)})
      </p>

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
