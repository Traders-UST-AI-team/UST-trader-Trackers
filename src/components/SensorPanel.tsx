import { useChartTheme } from './useChartTheme';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SensorSeries, TrackerEvent } from '../../shared/types';
import type { IndicatorResult } from '../../shared/indicators';
import { api } from '../api';
import { useWatchlist } from '../store';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const GROUPS: { id: SensorSeries['group']; title: string; blurb: string }[] = [
  { id: 'chokepoint', title: 'Chokepoint traffic', blurb: 'Daily vessel transit calls estimated from satellite AIS (IMF PortWatch). The same data family Kalshi’s Hormuz traffic contracts settle on.' },
  { id: 'price', title: 'Crude oil spot prices', blurb: 'Daily spot assessments, delayed by a few days; shown with their last observation date.' },
  { id: 'airspace', title: 'Air traffic', blurb: 'Aircraft heard by volunteer ADS-B receivers. Our own series — it starts when this tracker first polled.' },
  { id: 'connectivity', title: 'Internet routing visibility', blurb: 'Routed prefixes visible per country; drops indicate connectivity disruption, not its cause.' },
];

function Mini({ s, marker }: { s: SensorSeries; marker: number | null }) {
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
    const line = css('--series-1'), ink = css('--text-secondary'), grid = css('--grid'), surface = css('--surface-1'), ev = css('--event');
    const data = s.points.map(([t, v]) => [t * 1000, v]);
    const first = data[0]?.[0], last = data[data.length - 1]?.[0];
    const inRange = marker !== null && first !== undefined && marker >= first && marker <= last + 86400e3;
    const vals = s.points.map((p) => p[1]);
    c.setOption({
      animation: false, grid: { left: 44, right: 10, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: surface, borderColor: grid, textStyle: { color: css('--text-primary'), fontSize: 12 },
        formatter: (p: any) => { const it = Array.isArray(p) ? p[0] : p; return `<div style="color:${ink}">${new Date(it.value[0]).toLocaleString(undefined, { dateStyle: 'medium', ...(s.id.startsWith('opensky') || s.id.startsWith('ioda') ? { timeStyle: 'short' } : {}) })}</div><b>${Number(it.value[1]).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> ${s.unit}`; } },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: ink, fontSize: 10 }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: s.style === 'line' && s.group !== 'airspace' ? true : false, min: s.style === 'bar' || s.group === 'airspace' ? 0 : undefined, axisLabel: { color: ink, fontSize: 10 }, splitLine: { lineStyle: { color: grid } }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: s.style, data, showSymbol: s.points.length < 3, symbolSize: 7, barMaxWidth: 8, large: false,
        itemStyle: s.style === 'bar' ? { color: line, borderRadius: [3, 3, 0, 0] } : { color: line, borderColor: surface, borderWidth: 2 },
        lineStyle: { width: 2, color: line }, ...(s.style === 'bar' ? {} : { sampling: 'lttb' }),
        markLine: inRange ? { silent: true, symbol: 'none', animation: false, data: [{ xAxis: marker!, label: { show: true, formatter: 'Published', color: ev, fontSize: 10, position: 'insideEndTop' }, lineStyle: { color: ev, width: 2 } }] } : undefined,
      }],
    }, true);
    void vals;
  }, [s, marker, theme]);
  return <div ref={el} className="mini" role="img" aria-label={s.title} />;
}

const n1 = (x: number | null | undefined, d = 1) => (x == null ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: d }));
const sgn = (x: number | null | undefined, unit = '') => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${n1(Math.abs(x))}${unit}`);

/** One-line summary of the server-computed default indicator for a series; a null value says why instead of showing 0. */
function IndSummary({ r, unit }: { r: IndicatorResult | undefined; unit: string }) {
  if (!r) return null;
  const x = (r.extra ?? {}) as Record<string, any>;
  if (r.status !== 'ok' && r.id !== 'observed_change') return <div className="indsum muted" title={r.reason ?? ''}>{r.id === 'baseline_28d' ? 'vs 28-day mean' : 'vs previous published'}: {r.status.replace('_', ' ')}{r.reason ? ` — ${r.reason}` : ''}</div>;
  if (r.id === 'baseline_28d') return <div className="indsum" title={`Latest daily value vs mean of ${x.window}; ${x.valid_days} valid days`}>vs 28-day mean <b>{sgn(x.pct_change, '%')}</b> <span className="muted">({sgn(x.abs_change)} {unit}; mean {n1(x.baseline_mean)})</span></div>;
  if (r.id === 'published_change') return <div className="indsum" title="Change vs the preceding actual observation; no weekend/holiday zeros">vs previous published <b>{sgn(x.pct_change, '%')}</b> <span className="muted">({sgn(x.abs_change)} {unit}; {x.days_between ?? '?'} d apart)</span></div>;
  if (r.id === 'observed_change') return (
    <div className="indsum" title={x.baseline_reason ?? ''}>
      vs previous <b>{sgn(x.change_vs_previous)}</b> · vs ~24 h <b>{x.change_24h ? sgn(x.change_24h.value) : 'n/a'}</b>
      <span className="muted"> · no anomaly baseline ({n1(x.coverage_days, 1)} of 14 days of coverage; controls not yet defined)</span>
    </div>
  );
  return null;
}

export function SensorPanel({ selection, event, now, versionKey }: { selection: { id: string; request: number } | null; event: TrackerEvent | null; now: number; versionKey: string }) {
  const [series, setSeries] = useState<SensorSeries[] | null>(null);
  const [inds, setInds] = useState<Map<string, IndicatorResult[]>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const wl = useWatchlist();
  // Re-read only when a sensor source's stored data actually changes (per-source versions), not on every news refresh.
  useEffect(() => {
    api.sensors().then((x) => { setSeries(x); setErr(null); }).catch((e) => setErr(String(e)));
    api.sensorIndicators().then((x) => setInds(new Map(x.series.map((s) => [s.id, s.indicators])))).catch(() => { /* summaries are optional */ });
  }, [versionKey]);
  useEffect(() => {
    if (selection && series) document.getElementById(`sensor-${selection.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [selection, series]);
  const marker = event ? Date.parse(event.timestamp) : null;
  const by = useMemo(() => (series ?? []).filter((x) => x.points.length > 0), [series]);
  if (err) return <p className="muted">Sensors unavailable: {err}</p>;
  if (!series) return <p className="muted">Loading sensors…</p>;
  return (
    <div className="sensors">
      <p className="muted small">Sensors are <b>context</b>, not event reports. Each panel names its provider, its latest observation and its caveat. A red line marks the selected item’s publication time where the series covers it — coincident timing only, never evidence of cause.</p>
      {GROUPS.map((g) => {
        const list = by.filter((s) => s.group === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h4>{g.title}</h4>
            <p className="muted small">{g.blurb}</p>
            <div className="minis">
              {list.map((s) => {
                const asOf = s.as_of ? new Date(s.as_of * 1000) : null;
                const ageD = asOf ? Math.round((now - asOf.getTime()) / 86400e3) : null;
                const last = s.points[s.points.length - 1]?.[1];
                return (
                  <figure key={s.id} id={`sensor-${s.id}`} className={`minicard ${selection?.id === s.id ? 'selected-sensor' : ''}`}>
                    <figcaption><span><b>{s.title}</b><span className="muted small"> · {s.unit}</span></span>
                      <button className={`pinbtn ${wl.isPinned('sensor', s.id) ? 'on' : ''}`} onClick={() => wl.toggle('sensor', s.id)} disabled={!wl.isPinned('sensor', s.id) && wl.items.length >= 8} title={wl.isPinned('sensor', s.id) ? 'Remove from the watchlist' : 'Pin to the watchlist (max 8)'}>{wl.isPinned('sensor', s.id) ? '★' : '☆'}</button>
                    </figcaption>
                    <Mini s={s} marker={marker} />
                    <IndSummary r={inds.get(s.id)?.[0]} unit={s.unit} />
                    <div className="small meta2">
                      <span>Latest: <b>{last !== undefined ? last.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</b></span>
                      <span className="muted" title={asOf?.toISOString()}>as of {asOf ? asOf.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}{ageD !== null && ageD > 1 ? ` (${ageD} d old)` : ''}</span>
                      <a href={s.source_url} target="_blank" rel="noreferrer">{s.provider} ↗</a>
                    </div>
                    <details className="small"><summary>Caveat</summary><p className="muted">{s.caveat}</p></details>
                  </figure>
                );
              })}
            </div>
          </section>
        );
      })}
      {by.length === 0 && <p className="muted">No sensor data yet — it arrives with the first refresh.</p>}
    </div>
  );
}
