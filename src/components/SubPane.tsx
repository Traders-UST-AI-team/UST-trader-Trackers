import { escapeHtml } from '../html';
import { useChartTheme } from './useChartTheme';
import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { IndPoint } from '../../shared/indicators';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export interface PaneLine { id: string; label: string; colorVar: string; dashed?: boolean; bars?: boolean; points: IndPoint[] }
export interface PaneSpec {
  id: string; title: string; unit: string; lines: PaneLine[]; reference?: number[]; zeroLine?: boolean; yMin?: number; yMax?: number;
  status: string; reason: string | null; note: string;
}
export interface ViewWindow { startValue: number; endValue: number }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An optional indicator sub-plot sharing the main chart's time window. Gaps (warm-up, data gaps) are drawn as breaks, never as zero. */
export function SubPane({ spec, window }: { spec: PaneSpec; window: ViewWindow | null }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const theme = useChartTheme();
  const data = useMemo(() => spec.lines.map((l) => ({ ...l, data: l.points.map((p) => [p.t * 1000, p.value === null ? null : +p.value.toFixed(2)] as [number, number | null]) })), [spec]);

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const ink = css('--text-secondary'), grid = css('--grid'), surface = css('--surface-1');
    const first = data.flatMap((l) => l.data.map((d) => d[0])).reduce((a, b) => Math.min(a, b), Infinity);
    const last = data.flatMap((l) => l.data.map((d) => d[0])).reduce((a, b) => Math.max(a, b), -Infinity);
    const x0 = window?.startValue ?? (Number.isFinite(first) ? first : undefined), x1 = window?.endValue ?? (Number.isFinite(last) ? last : undefined);
    const inView = data.flatMap((l) => l.data.filter((d) => d[1] !== null && (x0 === undefined || (d[0] >= x0 && d[0] <= (x1 ?? Infinity)))).map((d) => d[1] as number));
    const lo = spec.yMin ?? (inView.length ? Math.min(...inView, 0) : -1), hi = spec.yMax ?? (inView.length ? Math.max(...inView, 0) : 1);
    const pad = spec.yMin === undefined ? (hi - lo || 1) * 0.1 : 0;
    const colors = Object.fromEntries(data.map((l) => [l.id, css(l.colorVar)]));
    c.setOption({
      animation: false,
      grid: { left: 44, right: 16, top: 10, bottom: 22 },
      tooltip: {
        trigger: 'axis', confine: true, backgroundColor: surface, borderColor: grid, textStyle: { color: css('--text-primary'), fontSize: 12 }, axisPointer: { type: 'line', lineStyle: { color: ink } },
        formatter: (raw: any) => {
          const items: any[] = Array.isArray(raw) ? raw : [raw];
          const rows = [`<div style="color:${ink}">${fmtTime(items[0]?.value[0])}</div>`];
          for (const l of data) {
            const it = items.find((i) => i.seriesId === l.id);
            const v = it?.value[1];
            rows.push(`<div><span style="display:inline-block;width:10px;height:2px;background:${colors[l.id]};vertical-align:middle;margin-right:6px"></span>${escapeHtml(l.label)}: ${v === null || v === undefined ? `<span style="color:${ink}">warming up / gap</span>` : `<b>${Number(v).toFixed(2)}</b> ${escapeHtml(spec.unit)}`}</div>`);
          }
          return rows.join('');
        },
      },
      xAxis: { type: 'time', min: x0, max: x1, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 10 }, splitLine: { show: false } },
      yAxis: { type: 'value', min: spec.yMin ?? lo - pad, max: spec.yMax ?? hi + pad, axisLabel: { color: ink, fontSize: 10 }, splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, axisTick: { show: false }, splitNumber: 3 },
      series: data.map((l, i) => ({
        id: l.id, name: l.label, type: l.bars ? 'bar' : 'line', data: l.data, showSymbol: false, connectNulls: false, silent: true, z: 2,
        ...(l.bars ? { itemStyle: { color: colors[l.id], opacity: 0.55 }, barMaxWidth: 5 } : { lineStyle: { width: 1.5, color: colors[l.id], type: l.dashed ? [6, 3] : 'solid' }, itemStyle: { color: colors[l.id] } }),
        ...(i === 0 && (spec.reference?.length || spec.zeroLine) ? { markLine: { silent: true, symbol: 'none', animation: false, label: { color: ink, fontSize: 10, formatter: '{c}' }, lineStyle: { color: ink, type: 'dotted', width: 1, opacity: 0.8 }, data: (spec.zeroLine ? [0] : spec.reference!).map((y) => ({ yAxis: y })) } } : {}),
      })),
    }, true);
  }, [data, window, theme, spec]);

  return (
    <div className="subpane">
      <div className="subpane-head small">
        <b>{spec.title}</b>
        {spec.status !== 'ok' && <span className="chip warn" title={spec.reason ?? ''}>{spec.status.replace('_', ' ')}{spec.reason ? `: ${spec.reason}` : ''}</span>}
        <span className="muted grow">{spec.note}</span>
      </div>
      <div ref={el} className="subpane-chart" role="img" aria-label={`${spec.title} sub-plot, ${spec.status === 'ok' ? 'values available' : spec.status.replace('_', ' ')}`} />
    </div>
  );
}
