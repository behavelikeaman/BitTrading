'use client';

import type { IndicatorSnapshot } from '@/types';
import {
  TIME_ZONE_LABEL,
  formatPct,
  formatPrice,
  formatRate,
  formatTime,
} from '@/lib/format';

interface Props {
  indicators: IndicatorSnapshot | null;
  lastPrice: number;
  lastClosedAt: number;
  fundingRate: number;
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-neutral-400">{label}</div>
      <div className="text-base font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
    </div>
  );
}

/** 현재 지표값. 언제 기준인지 명확히 보이도록 확정봉 시각을 함께 띄운다. */
export function SignalPanel({
  indicators,
  lastPrice,
  lastClosedAt,
  fundingRate,
}: Props) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">지표</h2>
        <span className="text-xs text-neutral-400">
          확정봉 {formatTime(lastClosedAt)} {TIME_ZONE_LABEL} 기준
        </span>
      </div>

      {indicators === null ? (
        <p className="text-sm text-neutral-400">데이터가 모자라 지표를 낼 수 없다</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Cell label="종가" value={formatPrice(lastPrice)} />
          <Cell label="EMA12" value={formatPrice(indicators.ema12)} />
          <Cell label="SMA20 (BB 중심)" value={formatPrice(indicators.sma20)} />
          <Cell label="BB 상단" value={formatPrice(indicators.bbUpper)} />
          <Cell label="BB 하단" value={formatPrice(indicators.bbLower)} />
          <Cell label="BB 폭" value={formatPct(indicators.bbWidth, 3)} />
          <Cell label="ATR14" value={formatPrice(indicators.atr14)} />
          <Cell label="ADX14" value={indicators.adx14.toFixed(1)} />
          <Cell label="거래량 평균" value={indicators.volumeSma20.toFixed(0)} />
          <Cell label="펀딩비" value={formatRate(fundingRate)} />
        </div>
      )}
    </section>
  );
}
