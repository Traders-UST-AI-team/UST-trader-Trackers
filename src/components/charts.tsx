import { useChartTheme } from './useChartTheme';
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export interface Datum { name: string; value: number; color?: string }

/** One-series bar chart (vertical or horizontal) following the data-viz rules: single hue, rounded data-end, recessive grid, tooltip, no value on every bar. */
export function BarMini({ data, horizontal = false, unit = '', height = 160, label }: { data: Datum[]; horizontal?: boolean; unit?: string; height?: number; label: string }) {
  const theme = useChartTheme();
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.current?.dispose(); };
  }, []);
  useEffect(() => {
    const c = chart.current; if (!c) return;
    const series1 = css('--series-1'), ink = css('--text-secondary'), grid = css('--grid'), surface = css('--surface-1');
    const cat = { type: 'category' as const, data: horizontal ? [...data].reverse().map((d) => d.name) : data.map((d) => d.name), axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 10, interval: horizontal ? 0 : 'auto' as const, hideOverlap: true, width: horizontal ? 90 : undefined, overflow: 'truncate' as const } };
    const val = { type: 'value' as const, axisLabel: { color: ink, fontSize: 10 }, splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, axisTick: { show: false }, minInterval: 1 };
    const vals = (horizontal ? [...data].reverse() : data).map((d) => ({ value: d.value, itemStyle: { color: d.color ?? series1, borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] } }));
    c.setOption({
      animation: false, grid: { left: horizontal ? 96 : 34, right: 14, top: 8, bottom: horizontal ? 18 : 28 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: surface, borderColor: grid, textStyle: { color: css('--text-primary'), fontSize: 12 }, valueFormatter: (v: unknown) => `${v}${unit}` },
      xAxis: horizontal ? val : cat, yAxis: horizontal ? cat : val,
      series: [{ type: 'bar', data: vals, barMaxWidth: 18 }],
    }, true);
  }, [data, horizontal, unit, theme]);
  return <div ref={el} style={{ width: '100%', height }} role="img" aria-label={label} />;
}
