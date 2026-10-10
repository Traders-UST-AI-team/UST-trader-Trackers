import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { QuarterlyAggregation } from '../../../shared/review-types';
import { SIGNALS } from '../../../shared/review-signals';
import { useChartTheme } from '../useChartTheme';

/**
 * The two charts of the reviews workspace. Both read their colours from the app's theme tokens at
 * draw time and redraw when the theme changes, so the workspace follows light/dark like every other
 * view instead of being permanently dark.
 */

const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function palette() {
  return {
    text: token('--text-primary', '#111315'),
    muted: token('--muted', '#5a626a'),
    grid: token('--grid', '#e6e7e0'),
    border: token('--border', '#dcddd6'),
    surface: token('--surface-1', '#ffffff'),
    tone: token('--series-1', '#0a5fc2'),
    revenue: token('--series-3', '#138a72'),
    bad: token('--bad', '#b42318'),
    warn: token('--warn', '#8a5a00'),
    ok: token('--ok', '#0a7a3d'),
  };
}

const short = (q: QuarterlyAggregation) => {
  const [fy, qq] = (q.quarter_label || q.calendar_quarter).split(' ');
  return qq ? `${qq}\n${fy}` : q.quarter_label;
};

const fmt = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

function useEChart(build: (p: ReturnType<typeof palette>) => echarts.EChartsOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const themeVersion = useChartTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chart.setOption(build(palette()));
    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeVersion, ...deps]);
  return ref;
}

/** Mean tone against its own 4-quarter baseline (top), and the gap between them (bottom). */
export function ToneSignalChart({ quarters }: { quarters: QuarterlyAggregation[] }) {
  const ref = useEChart((p) => {
    const labels = quarters.map(short);
    const lowest = Math.min(0, ...quarters.map((q) => q.avg_tone ?? 0), ...quarters.map((q) => q.baseline_tone ?? 0));
    const axisLabel = { color: p.muted, fontSize: 11 };
    return {
      animation: false,
      textStyle: { fontFamily: 'inherit' },
      grid: [
        { left: 44, right: 16, top: 34, height: '46%' },
        { left: 44, right: 16, top: '66%', bottom: 40 },
      ],
      legend: { top: 0, left: 40, itemWidth: 18, itemHeight: 8, itemGap: 22, textStyle: { color: p.muted, fontSize: 11.5 }, data: ['Mean tone', '4-quarter baseline', 'Δ tone'] },
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.surface,
        borderColor: p.border,
        textStyle: { color: p.text, fontSize: 12 },
        formatter: (items: any) => {
          const q = quarters[(Array.isArray(items) ? items[0] : items).dataIndex];
          const n = q.tone_review_count ?? q.product_review_count ?? q.review_count;
          return [
            `<b>${q.quarter_label}</b> · ${q.calendar_quarter}`,
            `Mean tone ${fmt(q.avg_tone, 3)} (n = ${n}${q.is_sparse ? ', sparse' : ''})`,
            `Baseline ${fmt(q.baseline_tone, 3)} · Δ ${fmt(q.delta_tone, 3)}`,
            q.is_negative_swing ? `<span style="color:${p.bad}">Negative swing${q.outcome ? ` · ${q.outcome}` : ''}</span>` : '',
          ].filter(Boolean).join('<br/>');
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [
        { type: 'category', data: labels, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: p.border } } },
        { type: 'category', data: labels, gridIndex: 1, axisLabel: { ...axisLabel, lineHeight: 13 }, axisTick: { show: false }, axisLine: { lineStyle: { color: p.border } } },
      ],
      yAxis: [
        // Tone lives on −2…+2; the lower bound only reaches −2 when some quarter goes below −1.
        { type: 'value', gridIndex: 0, min: lowest < -1 ? -2 : -1, max: 2, interval: 1, axisLabel, splitLine: { lineStyle: { color: p.grid } } },
        { type: 'value', gridIndex: 1, axisLabel, splitLine: { lineStyle: { color: p.grid } }, splitNumber: 3 },
      ],
      series: [
        {
          name: 'Mean tone', type: 'line', xAxisIndex: 0, yAxisIndex: 0, connectNulls: false,
          data: quarters.map((q) => ({
            value: q.avg_tone,
            // A thin quarter is drawn hollow: its mean rests on few reviews.
            itemStyle: { color: q.is_sparse ? p.surface : p.tone, borderColor: p.tone, borderWidth: 2 },
          })),
          symbol: 'circle', symbolSize: 7, lineStyle: { color: p.tone, width: 2 }, itemStyle: { color: p.tone },
        },
        {
          name: '4-quarter baseline', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
          data: quarters.map((q) => q.baseline_tone), symbol: 'none', lineStyle: { color: p.muted, width: 1.5, type: 'dashed' }, itemStyle: { color: p.muted },
        },
        {
          name: 'Δ tone', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 22, itemStyle: { color: p.muted },
          data: quarters.map((q) => ({
            value: q.delta_tone,
            itemStyle: { color: q.is_negative_swing ? p.bad : (q.delta_tone ?? 0) < 0 ? p.warn : p.ok, opacity: q.is_sparse ? 0.45 : 1 },
          })),
          markLine: {
            silent: true, symbol: 'none',
            label: { formatter: `θ = ${SIGNALS.negativeSwingDelta}`, color: p.bad, fontSize: 10.5, position: 'insideStartBottom' },
            lineStyle: { color: p.bad, type: 'dotted' },
            data: [{ yAxis: SIGNALS.negativeSwingDelta }],
          },
        },
      ],
    };
  }, [quarters]);
  return <div ref={ref} className="rv-chart" role="img" aria-label="Quarterly mean review tone against its four-quarter baseline, and the difference" />;
}

const OUTCOME_COLOR = (p: ReturnType<typeof palette>, outcome: QuarterlyAggregation['outcome']) =>
  outcome === 'hit' ? p.bad : outcome === 'miss' ? p.muted : p.warn;

/** Δ tone (bars, left axis) against reported revenue growth (line, right axis), swings marked by outcome. */
export function ToneRevenueChart({ quarters }: { quarters: QuarterlyAggregation[] }) {
  const ref = useEChart((p) => {
    const axisLabel = { color: p.muted, fontSize: 11 };
    return {
      animation: false,
      textStyle: { fontFamily: 'inherit' },
      grid: { left: 48, right: 52, top: 40, bottom: 44 },
      legend: { top: 0, left: 44, itemWidth: 18, itemHeight: 8, itemGap: 22, textStyle: { color: p.muted, fontSize: 11.5 }, data: ['Δ tone', 'Revenue YoY %'] },
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.surface,
        borderColor: p.border,
        textStyle: { color: p.text, fontSize: 12 },
        formatter: (items: any) => {
          const q = quarters[(Array.isArray(items) ? items[0] : items).dataIndex];
          const f = q.financial;
          return [
            `<b>${q.quarter_label}</b>`,
            `Δ tone ${fmt(q.delta_tone, 3)}`,
            f ? `Revenue ${f.revenue_usd != null ? `$${(f.revenue_usd / 1e6).toFixed(0)}M` : '—'} · YoY ${fmt(f.revenue_yoy_growth, 1)}%` : 'No filing for this quarter',
            q.outcome ? `Swing outcome: <b>${q.outcome}</b>${q.outcome_filing ? ` (${q.outcome_filing.fiscal_label}, YoY ${fmt(q.outcome_filing.revenue_yoy_growth, 1)}%)` : ''}` : '',
          ].filter(Boolean).join('<br/>');
        },
      },
      xAxis: { type: 'category', data: quarters.map(short), axisLabel: { ...axisLabel, lineHeight: 13 }, axisTick: { show: false }, axisLine: { lineStyle: { color: p.border } } },
      yAxis: [
        { type: 'value', name: 'Δ tone', nameTextStyle: { color: p.muted, fontSize: 11 }, axisLabel, splitLine: { lineStyle: { color: p.grid } } },
        { type: 'value', name: 'YoY %', nameTextStyle: { color: p.muted, fontSize: 11 }, axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Δ tone', type: 'bar', barMaxWidth: 22, itemStyle: { color: p.tone },
          data: quarters.map((q) => ({ value: q.delta_tone, itemStyle: { color: q.is_negative_swing ? OUTCOME_COLOR(p, q.outcome) : p.tone, opacity: q.is_negative_swing ? 1 : 0.55 } })),
          markPoint: {
            symbol: 'pin', symbolSize: 34,
            label: { color: '#fff', fontSize: 9.5, fontWeight: 600 },
            data: quarters.flatMap((q, i) => (q.is_negative_swing && q.delta_tone != null
              ? [{ name: q.quarter_label, coord: [i, q.delta_tone], label: { formatter: q.outcome === 'hit' ? 'HIT' : q.outcome === 'miss' ? 'MISS' : '…' }, itemStyle: { color: OUTCOME_COLOR(p, q.outcome) } }]
              : [])),
          },
        },
        {
          name: 'Revenue YoY %', type: 'line', yAxisIndex: 1, connectNulls: true, symbol: 'circle', symbolSize: 6,
          data: quarters.map((q) => q.financial?.revenue_yoy_growth ?? null), lineStyle: { color: p.revenue, width: 2 }, itemStyle: { color: p.revenue },
        },
      ],
    };
  }, [quarters]);
  return <div ref={ref} className="rv-chart" role="img" aria-label="Change in review tone against reported revenue growth, with negative swings marked by outcome" />;
}

/** A tiny tone trend for the watchlist: tone is on a fixed −2…+2 scale, so lines compare across rows. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 84;
  const h = 24;
  const pts = values.map((v, i) => (v == null ? null : [values.length === 1 ? w / 2 : (i / (values.length - 1)) * w, h / 2 - (v / 2) * (h / 2 - 2)] as const));
  const drawn = pts.filter((p): p is readonly [number, number] => p !== null);
  if (drawn.length === 0) return <span className="rv-muted">—</span>;
  const last = drawn.at(-1)!;
  return (
    <svg className="rv-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="rv-spark-zero" />
      <polyline points={drawn.map((p) => p.join(',')).join(' ')} />
      <circle cx={last[0]} cy={last[1]} r="2.5" />
    </svg>
  );
}
