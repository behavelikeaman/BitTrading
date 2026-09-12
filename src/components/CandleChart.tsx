'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, IndicatorSnapshot, PositionPlan } from '@/types';

interface Props {
  candles: Candle[];
  snapshots: (IndicatorSnapshot | null)[];
  plan: PositionPlan | null;
}

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

/**
 * 5분봉 + 볼린저 밴드 + EMA12, 계획가를 수평선으로 표시한다.
 *
 * lightweight-charts v5는 addCandlestickSeries가 아니라
 * addSeries(CandlestickSeries, ...) 형태다.
 */
export function CandleChart({ candles, snapshots, plan }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const upperRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const midRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const lowerRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const emaRef = useRef<ISeriesApi<'Line', Time> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const chart = createChart(container, {
      layout: {
        background: { color: '#0a0a0b' },
        textColor: '#9ca3af',
        fontFamily: 'ui-monospace, monospace',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale: { borderColor: '#1f2937', timeVisible: true },
      height: 360,
      autoSize: true,
    });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    const thinLine = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };
    upperRef.current = chart.addSeries(LineSeries, { color: '#6b7280', ...thinLine });
    midRef.current = chart.addSeries(LineSeries, { color: '#9ca3af', ...thinLine });
    lowerRef.current = chart.addSeries(LineSeries, { color: '#6b7280', ...thinLine });
    emaRef.current = chart.addSeries(LineSeries, { color: '#eab308', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (candleRef.current === null || candles.length === 0) return;

    candleRef.current.setData(
      candles.map((c) => ({
        time: toTime(c.openTime),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    const line = (pick: (s: IndicatorSnapshot) => number) =>
      candles
        .map((c, i) => {
          const s = snapshots[i];
          return s === null || s === undefined
            ? null
            : { time: toTime(c.openTime), value: pick(s) };
        })
        .filter((p): p is { time: UTCTimestamp; value: number } => p !== null);

    upperRef.current?.setData(line((s) => s.bbUpper));
    midRef.current?.setData(line((s) => s.sma20));
    lowerRef.current?.setData(line((s) => s.bbLower));
    emaRef.current?.setData(line((s) => s.ema12));

    // 호출하지 않으면 캔들이 오른쪽 끝에만 몰리고 왼쪽이 비어 보인다.
    chartRef.current?.timeScale().fitContent();
  }, [candles, snapshots]);

  useEffect(() => {
    const series = candleRef.current;
    if (series === null) return;

    const lines = plan
      ? [
          { price: plan.legs[0]?.price ?? 0, color: '#e5e7eb', title: '진입' },
          { price: plan.stopPrice, color: '#ef4444', title: '손절' },
          { price: plan.takeProfitPrice, color: '#22c55e', title: '익절' },
          { price: plan.liquidationPrice, color: '#eab308', title: '청산' },
        ].filter((l) => Number.isFinite(l.price) && l.price > 0)
      : [];

    const created = lines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        axisLabelVisible: true,
        title: l.title,
      }),
    );

    return () => {
      for (const priceLine of created) series.removePriceLine(priceLine);
    };
  }, [plan]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
      <div ref={containerRef} className="h-[360px] w-full" />
    </section>
  );
}
