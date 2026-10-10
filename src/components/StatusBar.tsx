import { useEffect, useRef, useState } from 'react';
import type { SourceHealth, Status } from '../../shared/types';
import { absTime, ago } from '../format';

const KIND: Record<string, string> = { prediction_market: 'Prediction markets', news: 'News', official: 'Official', maritime: 'Maritime', analysis: 'Analysis', sensor: 'Sensors', social: 'Social (viewpoint-labelled)', wallet: 'Wallet activity' };
const ORDER = ['prediction_market', 'wallet', 'sensor', 'official', 'maritime', 'news', 'social', 'analysis'];

type Cls = 'ok' | 'stale' | 'err' | 'never' | 'blocked';
const clsOf = (s: SourceHealth): Cls => (s.status === 'blocked' ? 'blocked' : s.status === 'never' ? 'never' : s.status === 'error' ? 'err' : s.stale ? 'stale' : 'ok');
const LABEL: Record<Cls, string> = { ok: 'OK', stale: 'STALE', err: 'FAILED', never: 'PENDING', blocked: 'NOT CONNECTED' };

function Pill({ s, now }: { s: SourceHealth; now: number }) {
  const cls = clsOf(s);
  const tip = [`${s.name} (${KIND[s.kind] ?? s.kind})`, `Last success: ${absTime(s.last_success_at)}`, `Newest data: ${absTime(s.freshness?.newest_at ?? null)} (${s.freshness?.assessment ?? 'unknown'}; ${s.freshness?.note ?? ''})`, `Next attempt: ${absTime(s.next_attempt_at)} · every ${s.expected_interval_min} min`, s.items != null ? `Items: ${s.items}` : '', s.error ? `Note: ${s.error}` : '', s.consecutive_failures > 0 ? `Consecutive failures: ${s.consecutive_failures}${s.breaker_open_until ? ` — automatic retries paused until ${absTime(s.breaker_open_until)}; Refresh now still retries` : ''}` : ''].filter(Boolean).join('\n');
  return (
    <span className={`pill ${cls}`} title={tip}>
      <i /> {s.name.split(' — ')[0].replace(/ \(.*\)/, '')}
      <b>{LABEL[cls]}{cls === 'ok' || cls === 'stale' ? ` · ${ago(s.last_success_at, now)}` : ''}</b>
    </span>
  );
}

export type View = 'dashboard' | 'feed' | 'telegram' | 'wallets' | 'alerts' | 'research' | 'sources';
export function StatusBar({ status, onRefresh, now, view, setView, unread, alerts, onOpenShortcuts }: { status: Status | null; onRefresh: () => void; now: number; view: View; setView: (v: View) => void; unread?: number; alerts?: number; onOpenShortcuts?: () => void }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('war-tracker-theme') ?? 'system');
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem('war-tracker-theme', theme);
  }, [theme]);
  const [open, setOpen] = useState(false);
  const health = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!health.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const refreshing = status?.refreshing ?? false;
  const srcs = status?.sources ?? [];
  const count = (c: Cls) => srcs.filter((s) => clsOf(s) === c).length;

  const problems = count('stale') + count('err') + count('never');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  return (
    <header className="topbar slim">
      <div className="brand"><span className="logo" aria-hidden /><h1>War Tracker</h1></div>

      <nav className="viewnav" aria-label="View">
          <button className={view === 'dashboard' ? 'on' : ''} onClick={() => setView('dashboard')} title="Items → contracts → price → save (1)">Monitor</button>
          <button className={view === 'feed' || view === 'telegram' ? 'on' : ''} onClick={() => setView('feed')} title="All sources, including Telegram (2)">Feed{unread ? <span className="badge" title="Unread arrivals (backfill excluded)">{unread > 99 ? '99+' : unread}</span> : null}</button>
          <button className={view === 'wallets' ? 'on' : ''} onClick={() => setView('wallets')} title="Pilot markets, large trades, watched wallets (3)">Markets</button>
          <button className={view === 'research' ? 'on' : ''} onClick={() => setView('research')} title="Briefing, dossiers, hypotheses (4)">Research</button>
          <button className={view === 'sources' || view === 'alerts' ? 'on' : ''} onClick={() => setView('sources')} title="Collection health and alerts (5)">Sources &amp; alerts{alerts ? <span className="badge" title="Unacknowledged in-app alerts">{alerts > 99 ? '99+' : alerts}</span> : null}</button>
      </nav>

      <div ref={health} className="sources" aria-label="Source health">
        <button className={`healthsum ${problems ? 'warn' : 'good'}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Show every source">
          {problems === 0 ? <span className="ok">● all sources OK</span> : <>
            {count('err') > 0 && <span className="err">✕ {count('err')} failed</span>}
            {count('stale') > 0 && <span className="stale">◐ {count('stale')} stale</span>}
            {count('never') > 0 && <span className="never">○ {count('never')} pending</span>}
          </>}
        </button>
        {open && (
          <div className="healthpanel" role="region" aria-label="All sources">
            <p className="small"><b>{srcs.length} sources</b> · {count('ok')} OK{count('blocked') > 0 ? ` · ${count('blocked')} not connected` : ''} · last refresh {ago(status?.last_refresh_finished_at ?? null, now)}</p>
            {ORDER.filter((k) => srcs.some((s) => s.kind === k)).map((k) => (
              <div key={k}>
                <h5>{KIND[k]}</h5>
                <div className="pills">{srcs.filter((s) => s.kind === k).map((s) => <Pill key={s.source_id} s={s} now={now} />)}</div>
              </div>
            ))}
            <p className="muted small">Hover a source for its last success and notes. NOT CONNECTED = known unavailable (see docs); a failed or stale source keeps its previous data on screen.</p>
          </div>
        )}
      </div>

      <div className="topactions">
        <button className="iconbtn primary" onClick={onRefresh} disabled={refreshing || status?.mode === 'seed'} aria-label="Refresh now" title={status?.mode === 'seed' ? 'Disabled in offline seed mode' : `Refresh now (r) — last refresh ${ago(status?.last_refresh_finished_at ?? null, now)}`}>{refreshing ? '…' : '⟳'}</button>
        <div ref={menuRef} className="menuwrap">
          <button className="iconbtn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="More" title="Theme, keyboard shortcuts">⋯</button>
          {menu && (
            <div className="menupop" role="menu">
              <label className="small">Theme <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
              {onOpenShortcuts && <button role="menuitem" onClick={() => { setMenu(false); onOpenShortcuts(); }}>Keyboard shortcuts <span className="kbd-badge">?</span></button>}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
