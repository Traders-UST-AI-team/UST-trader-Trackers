import type { Axis } from './ProbChart';

/** Fixed colour per indicator id (never re-assigned by position), so a line keeps its colour when others are toggled. */
export const OVERLAYS: { id: string; label: string; colorVar: string; dashed: boolean; help: string }[] = [
  { id: 'sma24', label: 'SMA 24h', colorVar: '--series-2', dashed: false, help: 'Mean of the last 24 completed-hour samples' },
  { id: 'ema24', label: 'EMA 24h', colorVar: '--series-3', dashed: true, help: 'Exponential average, alpha = 2/25, seeded by the first 24-hour SMA' },
  { id: 'sma72', label: 'SMA 72h', colorVar: '--series-4', dashed: false, help: 'Mean of the last 72 completed-hour samples' },
  { id: 'ema72', label: 'EMA 72h', colorVar: '--series-5', dashed: true, help: 'Exponential average, alpha = 2/73, seeded by the first 72-hour SMA' },
  { id: 'bollinger', label: 'Bands 20,2', colorVar: '--muted', dashed: true, help: 'SMA 20 ± 2 population standard deviations. Raw bands can cross 0–100%; they are not confidence intervals' },
];

/** Optional sub-plots (package G). They describe the sampled series; they are not signals. */
export const PANES: { id: string; label: string; help: string }[] = [
  { id: 'rsi14', label: 'RSI 14', help: 'Wilder smoothing over 14 hourly differences; 30/70 are descriptive reference lines, not signals' },
  { id: 'macd', label: 'MACD 12/26/9', help: 'EMA12 − EMA26 with a 9-period signal line, in percentage points; complete after 34 consecutive hourly points' },
];

interface Props { panes: string[]; onPanes: (ids: string[]) => void; paneStatuses: Record<string, { status: string; reason: string | null }>; selected: string[]; onChange: (ids: string[]) => void; axis: Axis; onAxis: (a: Axis) => void; saveError: string | null; statuses: Record<string, { status: string; reason: string | null }> }

export function IndicatorControl({ panes, onPanes, paneStatuses, selected, onChange, axis, onAxis, saveError, statuses }: Props) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="indctl" role="group" aria-label="Chart indicators">
      <span className="muted small">Overlays</span>
      {OVERLAYS.map((o) => {
        const st = statuses[o.id];
        const note = st && st.status !== 'ok' ? ` — ${st.status.replace('_', ' ')}${st.reason ? `: ${st.reason}` : ''}` : '';
        return (
          <label key={o.id} className={`indopt ${selected.includes(o.id) ? 'on' : ''}`} title={`${o.help}. Computed on the server from stored provider history; null during warm-up or after a gap > 90 min${note}`}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            <i className={o.dashed ? 'dash' : ''} style={{ background: o.dashed ? undefined : `var(${o.colorVar})`, borderColor: `var(${o.colorVar})` }} />
            {o.label}{selected.includes(o.id) && st && st.status !== 'ok' && <span className="chip warn">{st.status.replace('_', ' ')}</span>}
          </label>
        );
      })}
      <span className="muted small" title="Optional sub-plots below the chart. They describe the sampled series only and are not trading signals.">Sub-plots</span>
      {PANES.map((q) => (
        <label key={q.id} className={`indopt ${panes.includes(q.id) ? 'on' : ''}`} title={q.help}>
          <input type="checkbox" checked={panes.includes(q.id)} onChange={() => onPanes(panes.includes(q.id) ? panes.filter((x) => x !== q.id) : [...panes, q.id])} />
          {q.label}{panes.includes(q.id) && paneStatuses[q.id] && paneStatuses[q.id].status !== 'ok' && <span className="chip warn">{paneStatuses[q.id].status.replace('_', ' ')}</span>}
        </label>
      ))}
      <span className="grow" />
      <span className="muted small">Axis</span>
      <div className="seg" role="radiogroup" aria-label="Y axis">
        <button role="radio" aria-checked={axis === 'auto'} className={axis === 'auto' ? 'on' : ''} onClick={() => onAxis('auto')} title="Fits the visible price and overlays; small moves look large">Auto</button>
        <button role="radio" aria-checked={axis === 'fixed'} className={axis === 'fixed' ? 'on' : ''} onClick={() => onAxis('fixed')} title="Full 0–100% probability scale">0–100%</button>
      </div>
      {saveError && <span className="chip warn" title={saveError}>not saved</span>}
    </div>
  );
}
