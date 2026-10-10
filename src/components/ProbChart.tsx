import { escapeHtml } from '../html';
import { useChartTheme } from './useChartTheme';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { HistoryPoint } from '../../shared/types';
import type { IndPoint } from '../../shared/indicators';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, DataZoomComponent, CanvasRenderer]);

export interface EventMarker { ts: number; title: string; selected: boolean }
export interface Band { from: number; to: number; label: string }
/** A server-computed indicator drawn on the probability axis. Null values are gaps (warm-up, data gap), never zero. */
export interface Overlay { id: string; label: string; colorVar: string; dashed: boolean; points: IndPoint[] }
/** A large single trade (pilot markets). Drawn as a rug along the bottom of the plot — its own outcome and price are in the tooltip,
 *  because a NO trade's price is not a point on this outcome's line. */
export interface TradeMark { ts: number; notional: number; side: 'BUY' | 'SELL'; outcome: string; price: number; wallet: string }
export type Range = '24h' | '7d' | '30d' | 'all';
export type Axis = 'auto' | 'fixed';
const RANGE_MS: Record<Exclude<Range, 'all'>, number> = { '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface Props { onWindow?: (w: { startValue: number; endValue: number } | null) => void; contextKey?: string; zoomRequest?: { kind: 'reset' | 'publication'; sequence: number }; publication?: number | null; points: HistoryPoint[]; markers: EventMarker[]; range: Range; label: string; band?: Band | null; overlays?: Overlay[]; axis?: Axis; trades?: TradeMark[] }

export function ProbChart({ onWindow, contextKey = '', zoomRequest, publication, points, markers, range, label, band, overlays = [], axis = 'auto', trades = [] }: Props) {
  const [viewWindow, setViewWindow] = useState<{ startValue: number; endValue: number } | null>(null);
  const theme = useChartTheme();
  const el = useRef<HTMLDivElement>(null);
  const lastContext = useRef('');
  const lastZoomRequest = useRef(-1);
  const zoom = useRef<{ startValue: number; endValue: number } | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => { onWindow?.(viewWindow); }, [viewWindow]);

  const data = useMemo(() => points.map((x) => [x.t * 1000, +(x.p * 100).toFixed(2)] as [number, number]), [points]);
  const ovData = useMemo(() => overlays.map((o) => ({ ...o, data: o.points.map((p) => [p.t * 1000, p.value === null ? null : +p.value.toFixed(2)] as [number, number | null]) })), [overlays]);

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current.on('datazoom', () => {
      const option = chart.current?.getOption().dataZoom as { startValue: number; endValue: number }[] | undefined;
      if (option?.[0]) { zoom.current = { startValue: option[0].startValue, endValue: option[0].endValue }; setViewWindow(zoom.current); }
    });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const line = css('--series-1'), ink = css('--text-secondary'), grid = css('--grid'), surface = css('--surface-1'), accent = css('--event');
    const last = data.length ? data[data.length - 1][0] : Date.now();
    const first = data.length ? data[0][0] : last;
    const spanEnd = last === first ? last + 30 * 60e3 : last;
    const min = range === 'all' ? first : Math.max(first, last - RANGE_MS[range]);
    const visible = markers.filter((m) => m.ts >= first && m.ts <= last + 3600e3);
    // Auto axis fits the visible price AND visible overlay values, so an overlay is never clipped; fixed is the full 0–100% scale.
    const vals = [...data.filter((d) => d[0] >= min).map((d) => d[1]), ...ovData.flatMap((o) => o.data.filter((d) => d[0] >= min && d[1] !== null).map((d) => d[1] as number))];
    // The tick interval is chosen here and both bounds snap to it, so every label sits on a tick (no "15%"/"14%" edge collisions).
    const vMin = vals.length ? Math.min(...vals) - 1 : 0, vMax = vals.length ? Math.max(...vals) + 1 : 100;
    const step = axis === 'fixed' || !vals.length ? 20 : [1, 2, 5, 10, 20, 25].find((st) => (Math.ceil(vMax / st) - Math.floor(vMin / st)) <= 6) ?? 25;
    const lo = axis === 'fixed' || !vals.length ? 0 : Math.max(0, Math.floor(vMin / step) * step);
    const hi = axis === 'fixed' || !vals.length ? 100 : Math.min(100, Math.ceil(vMax / step) * step);
    const key = `${contextKey}:${range}`;
    if (key !== lastContext.current) { zoom.current = null; lastContext.current = key; }
    if (zoomRequest && zoomRequest.sequence !== lastZoomRequest.current) {
      lastZoomRequest.current = zoomRequest.sequence;
      zoom.current = zoomRequest.kind === 'publication' && publication != null ? { startValue: Math.max(first, publication - 12 * 3600e3), endValue: Math.min(spanEnd, publication + 12 * 3600e3) } : null;
    }
    const end = Math.max(spanEnd, ...visible.map((m) => m.ts));
    const window = zoom.current ?? { startValue: min, endValue: end };
    setViewWindow(window);
    const colors = Object.fromEntries(ovData.map((o) => [o.id, css(o.colorVar)]));

    c.setOption({
      animation: false,
      grid: { left: 44, right: 16, top: 24, bottom: 34 },
      tooltip: {
        trigger: 'axis', confine: true, backgroundColor: surface, borderColor: grid, textStyle: { color: css('--text-primary'), fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: ink, width: 1 } },
        formatter: (raw: any) => {
          const items: any[] = Array.isArray(raw) ? raw : [raw];
          const main = items.find((i) => i.seriesId === 'price');
          const t0 = main ? main.value[0] : items[0]?.value[0];
          const rows = [`<div style="color:${ink}">${fmtTime(t0)}</div>`];
          if (main) rows.push(`<div><b>${Number(main.value[1]).toFixed(1)}%</b> ${escapeHtml(label)}</div>`);
          // Each overlay reports its OWN nearest hourly sample; its time is shown when it differs from the price point's.
          for (const o of ovData) {
            const it = items.find((i) => i.seriesId === o.id);
            const swatch = `<span style="display:inline-block;width:10px;height:2px;background:${colors[o.id]};vertical-align:middle;margin-right:6px"></span>`;
            if (!it) { rows.push(`<div>${swatch}${escapeHtml(o.label)}: <span style="color:${ink}">no value here</span></div>`); continue; }
            const v = it.value[1];
            const when = Math.abs(it.value[0] - t0) > 30 * 60e3 ? ` <span style="color:${ink}">(${fmtTime(it.value[0])})</span>` : '';
            rows.push(`<div>${swatch}${escapeHtml(o.label)}: ${v === null || v === undefined ? `<span style="color:${ink}">warming up / gap</span>` : `<b>${Number(v).toFixed(1)}%</b>`}${when}</div>`);
          }
          for (const it of items.filter((i) => i.seriesId === 'trades' && Math.abs(i.value[0] - t0) <= 45 * 60e3)) {
            const t = it.data.trade as TradeMark;
            rows.push(`<div>▲ Large trade ${fmtTime(t.ts)}: <b>${escapeHtml(t.side)} ${escapeHtml(t.outcome)}</b> ${Math.round(t.notional).toLocaleString('en-US')} USDC at ${(t.price * 100).toFixed(1)}¢ <span style="color:${ink}">(${escapeHtml(t.wallet.slice(0, 6))}…)</span></div>`);
          }
          return rows.join('');
        },
      },
      xAxis: {
        type: 'time', min: first, max: end,
        axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 11 }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: lo, max: hi, interval: step, axisLabel: { color: ink, fontSize: 11, formatter: '{value}%' },
        name: axis === 'fixed' ? 'fixed 0–100%' : 'auto-scaled', nameTextStyle: { color: ink, fontSize: 10, align: 'left' }, nameGap: 8,
        splitLine: { lineStyle: { color: grid, width: 1 } }, axisLine: { show: false }, axisTick: { show: false },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none', ...window }],
      series: [{
        id: 'price', name: label, type: 'line', data, showSymbol: data.length < 3, symbol: 'circle', symbolSize: 8, sampling: 'lttb', z: 3,
        lineStyle: { width: 2, color: line, cap: 'round', join: 'round' }, itemStyle: { color: line, borderColor: surface, borderWidth: 2 },
        emphasis: { disabled: false },
        markArea: band && band.to >= first && band.from <= last + 86400e3 ? { silent: true, itemStyle: { color: accent, opacity: 0.10 }, label: { show: true, formatter: band.label, color: accent, fontSize: 10, position: 'insideTop' }, data: [[{ xAxis: band.from }, { xAxis: band.to }]] } : undefined,
        markLine: {
          silent: false, symbol: 'none', animation: false,
          data: visible.map((m) => ({
            xAxis: m.ts, name: m.title,
            lineStyle: { color: m.selected ? accent : ink, width: m.selected ? 2 : 1, type: m.selected ? 'solid' : 'dashed', opacity: m.selected ? 1 : 0.55 },
            label: { show: m.selected, formatter: 'Published', position: 'insideEndTop', color: accent, fontSize: 11, fontWeight: 600 },
          })),
          tooltip: { formatter: (p: any) => `<div style="max-width:260px;white-space:normal">${escapeHtml(p.name)}</div>` },
        },
      }, ...ovData.map((o) => ({
        id: o.id, name: o.label, type: 'line', data: o.data, showSymbol: data.length < 3, connectNulls: false, z: 2, silent: true,
        lineStyle: { width: 1.5, color: colors[o.id], type: o.dashed ? [6, 3] : 'solid' }, itemStyle: { color: colors[o.id] },
      })), ...(trades.length ? [{
        id: 'trades', name: 'Large trades', type: 'scatter', z: 4, silent: true,
        data: trades.filter((t) => t.ts >= min).map((t) => ({ value: [t.ts, lo + (hi - lo) * 0.035], symbolRotate: t.side === 'SELL' ? 180 : 0, symbolSize: Math.max(7, Math.min(16, 6 + 3 * Math.log10(Math.max(1, t.notional / 1000)))), trade: t })),
        symbol: 'triangle', itemStyle: { color: ink, opacity: 0.75 },
      }] : [])],
    }, true);
  }, [data, ovData, markers, range, label, band, axis, trades, theme, contextKey, zoomRequest, publication]);

  const desc = overlays.length ? ` with ${overlays.map((o) => o.label).join(', ')}` : '';
  return <><div ref={el} className="chart" role="img" aria-label={`Probability history for ${label}${desc}`} />{viewWindow && <p className="small muted chart-window">Viewing {fmtTime(viewWindow.startValue)} — {fmtTime(viewWindow.endValue)}</p>}</>;
}
