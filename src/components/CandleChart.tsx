'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { findCrosses } from '@/lib/signal/crosses';
import type { Candle, IndicatorSnapshot, PositionPlan } from '@/types';

const COLOR_LONG = '#22c55e';
const COLOR_SHORT = '#ef4444';
/** BB 중심선(SMA20) */
const COLOR_BB_MID = '#3b82f6';
/** EMA12 */
const COLOR_EMA = '#ffffff';
/** BB 상·하단 */
const COLOR_BB_BAND = '#4b5563';

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
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

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
      timeScale: {
        borderColor: '#1f2937',
        timeVisible: true,
        // 마지막 봉을 오른쪽 끝에 붙이면 최신 신호 삼각형이 잘린다.
        // 가장 중요한 마커가 안 보이는 것이므로 여백을 둔다.
        rightOffset: 6,
      },
      height: 360,
      autoSize: true,
    });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COLOR_LONG,
      downColor: COLOR_SHORT,
      borderVisible: false,
      wickUpColor: COLOR_LONG,
      wickDownColor: COLOR_SHORT,
    });
    const thinLine = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };
    upperRef.current = chart.addSeries(LineSeries, { color: COLOR_BB_BAND, ...thinLine });
    midRef.current = chart.addSeries(LineSeries, {
      color: COLOR_BB_MID,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lowerRef.current = chart.addSeries(LineSeries, { color: COLOR_BB_BAND, ...thinLine });
    emaRef.current = chart.addSeries(LineSeries, {
      color: COLOR_EMA,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // 진입 신호 삼각형. 캔들 시리즈에 붙여야 봉 위치에 정렬된다.
    markersRef.current = createSeriesMarkers(candleRef.current, []);

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

    // EMA12 × SMA20 교차 지점에 삼각형을 찍는다.
    // 롱은 봉 아래(위를 가리키는 삼각형), 숏은 봉 위(아래를 가리키는 삼각형).
    const markers: SeriesMarker<Time>[] = findCrosses(candles, snapshots).map((c) => ({
      time: toTime(c.time),
      position: c.direction === 'long' ? ('belowBar' as const) : ('aboveBar' as const),
      shape: c.direction === 'long' ? ('arrowUp' as const) : ('arrowDown' as const),
      color: c.direction === 'long' ? COLOR_LONG : COLOR_SHORT,
      text: c.direction === 'long' ? '롱' : '숏',
    }));
    markersRef.current?.setMarkers(markers);

    // 호출하지 않으면 캔들이 오른쪽 끝에만 몰리고 왼쪽이 비어 보인다.
    // fitContent는 rightOffset을 덮어쓰므로 스크롤로 여백을 되돌린다.
    const timeScale = chartRef.current?.timeScale();
    timeScale?.fitContent();
    timeScale?.scrollToPosition(6, false);
  }, [candles, snapshots]);

  useEffect(() => {
    const series = candleRef.current;
    if (series === null) return;

    const lines = plan
      ? [
          { price: plan.legs[0]?.price ?? 0, color: '#e5e7eb', title: '진입' },
          { price: plan.stopPrice, color: COLOR_SHORT, title: '손절' },
          { price: plan.takeProfitPrice, color: COLOR_LONG, title: '익절' },
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
