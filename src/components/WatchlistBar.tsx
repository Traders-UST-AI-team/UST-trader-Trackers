import { useDraft } from '../workspace';
import { useEffect } from 'react';
import type { WatchCard } from '../../shared/types';
import { useWatchlist } from '../store';
import { ago, absTime } from '../format';

function Spark({ pts }: { pts: [number, number][] }) {
  if (pts.length < 2) return <svg className="spark" viewBox="0 0 100 28" aria-hidden><text x="50" y="17" textAnchor="middle" className="sparkempty">no series</text></svg>;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x: number) => (x1 === x0 ? 50 : ((x - x0) / (x1 - x0)) * 98 + 1);
  const sy = (y: number) => (y1 === y0 ? 14 : 26 - ((y - y0) / (y1 - y0)) * 24);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  return <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden><path d={d} /></svg>;
}

const fmtVal = (c: WatchCard) => {
  const v = c.latest.value;
  if (v === null) return '—';
  return c.unit === '%' || c.kind === 'market' ? `${v.toFixed(1)}%` : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
const fmtChange = (c: WatchCard) => {
  const ch = c.change;
  if (!ch) return null;
  if (ch.value === null) return <span className="muted" title={ch.reason ?? ''}>{ch.window}: {ch.status.replace('_', ' ')}</span>;
  // Direction is shown with an arrow in neutral ink: up is not "good" and down is not "bad" for these series.
  const arrow = ch.value > 0 ? '▲' : ch.value < 0 ? '▼' : '■';
  const v = ch.unit === 'pp' ? `${Math.abs(ch.value).toFixed(1)} pp` : `${Math.abs(ch.value).toFixed(1)}%`;
  return <span title={`${ch.detail}${ch.interval_s ? ` · measured over ${(ch.interval_s / 3600).toFixed(ch.interval_s < 7200 ? 2 : 0)} h` : ''}`}>{arrow} {v} <span className="muted">{ch.window}</span></span>;
};

export function WatchlistBar({ versionKey, now, onOpenMarket, onOpenSensor }: { versionKey: string; now: number; onOpenMarket: (id: string) => void; onOpenSensor: (id: string) => void }) {
  const [collapsed, setCollapsed] = useDraft('watchlist-collapsed', true);
  const wl = useWatchlist();
  useEffect(() => { wl.reload(); }, [versionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!wl.loaded) return <div className="watchbar"><span className="muted small">Loading watchlist…</span></div>;
  return (
    <section className={`watchsection ${collapsed ? 'collapsed' : ''}`}><div className="watchheading small"><b>Watchlist ({wl.cards.length})</b><button aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? 'Show watchlist' : 'Collapse watchlist'}</button></div><div className="watchbar" hidden={collapsed} aria-label="Pinned watchlist">
      {wl.cards.length === 0 && <span className="muted small">Nothing pinned. Use “Pin” on a contract or sensor to keep it here (up to 8).</span>}
      {wl.cards.map((c) => (
        <article key={c.key} className={`wcard ${c.status}`}>
          <header>
            {c.kind === 'market'
              ? <button className="linkbtn wtitle" onClick={() => onOpenMarket(c.id)} title={c.title}>{c.title}</button>
              : <button className="linkbtn wtitle" onClick={() => onOpenSensor(c.id)} title={c.title}>{c.title}</button>}
            <button className="unpin" onClick={() => wl.toggle(c.kind, c.id)} aria-label={`Unpin ${c.title}`} title="Unpin">×</button>
          </header>
          <div className="small muted wsub">{c.subtitle}</div>
          <div className="wrow"><b className="wval" title={c.latest.label}>{fmtVal(c)}</b><span className="small">{fmtChange(c)}</span></div>
          <Spark pts={c.sparkline} />
          <div className="small muted wtimes" title={`Observed (the data's own time): ${absTime(c.latest.observed_at)}\nFetched by this tracker: ${absTime(c.latest.fetched_at)}`}>
            obs {ago(c.latest.observed_at, now)} · fetched {ago(c.latest.fetched_at, now)}{c.status !== 'ok' && <span className="chip warn">{c.status.replace('_', ' ')}</span>}
          </div>
        </article>
      ))}
      {wl.error && <span className="chip warn" title={wl.error}>watchlist error</span>}
    </div></section>
  );
}
