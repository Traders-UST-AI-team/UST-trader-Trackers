import { useDraft } from '../workspace';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Counterpart, HistoryPoint, Market, ReactionResult, TrackerEvent } from '../../shared/types';
import type { IndicatorResult } from '../../shared/indicators';
import { api, type IndResponse } from '../api';
import { absTime, absTimeP, ago, pct, pp, shortDate, usd, vol, VENUE_NAME } from '../format';
import { usePrefs, useWatchlist } from '../store';
import { ProbChart, type EventMarker, type Overlay, type Range, type TradeMark } from './ProbChart';
import { IndicatorControl, OVERLAYS, PANES } from './IndicatorControl';
import { SubPane, type PaneSpec, type ViewWindow } from './SubPane';
import { NewsTranslation } from './NewsTranslation';
import { ResearchActions } from './research/ResearchActions';
import { TierBadge } from './EventList';
import { MapPanel } from './MapPanel';
import { SensorPanel } from './SensorPanel';
import { AssetGraph } from './AssetGraph';
import { toast } from '../toast';
import { copyToClipboard } from '../clipboard';
import { downloadCsv, formatHistoryCsv } from '../export';

const BASIS: Record<string, string> = {
  midpoint: 'Order-book midpoint (best bid + best ask) ÷ 2',
  last_trade: 'Last trade price (no valid two-sided quote)',
  provider_price: 'Provider-reported price (no bid/ask or last trade)',
};

const IND_IDS = ['change_1h', 'change_24h', 'hourly_movement', ...OVERLAYS.map((o) => o.id), ...PANES.map((q) => q.id)];
const ppv = (x: number | null | undefined) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} pp`);
const hm = (t: number | undefined) => (t == null ? '—' : new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
const LABEL: Record<string, string> = { within_ordinary: 'within its ordinary range', above_typical: 'above its typical hourly move (> 2× median)', above_p95: 'larger than 95% of its prior hourly moves', unavailable: 'no baseline' };

/** One server-computed change, with the two real timestamps it was measured between. Null is shown with its reason, never as 0. */
function ChangeStat({ r, title }: { r: IndicatorResult | undefined; title: string }) {
  if (!r) return <div><dt>{title}</dt><dd className="muted">…</dd></div>;
  const x = (r.extra ?? {}) as { reference?: { t: number } | null; latest?: { t: number } | null; actual_interval_s?: number | null; measured_on?: string };
  const v = r.latest?.value ?? null;
  const tip = r.status === 'ok' && x.reference && x.latest
    ? `100 × (latest − reference) on ${x.measured_on}\nReference ${absTime(x.reference.t * 1000)}\nLatest ${absTime(x.latest.t * 1000)}\nActual interval ${((x.actual_interval_s ?? 0) / 3600).toFixed(2)} h`
    : `${r.status.replace('_', ' ')}: ${r.reason ?? ''}`;
  return (
    <div title={tip}>
      <dt>{title} <span className="muted">(history)</span></dt>
      <dd>{r.status === 'ok' && v !== null ? <>{ppv(v)} <span className="muted small">{hm(x.reference?.t)} → {hm(x.latest?.t)}</span></> : <span className="muted small">{r.status.replace('_', ' ')}</span>}</dd>
    </div>
  );
}

interface Props {
  followMarket: boolean; setFollowMarket: (value: boolean) => void;
  sensorSelection: { id: string; request: number } | null;
  active: boolean;
  eventSelection: number;
  onSelectEvent: (e: TrackerEvent) => void; mapEvents: TrackerEvent[];
  markets: Market[]; events: TrackerEvent[]; event: TrackerEvent | null; contractId: string | null; setContractId: (id: string) => void; now: number;
  /** Change when the stored market / sensor data changes (from /api/status versions); views refetch on change. */
  marketVer: string; sensorVer: string; walletVer: string;
  onOpenDossier: (id: string) => void;
}

export function RightPanel({ followMarket, setFollowMarket, sensorSelection, active, eventSelection, marketVer, sensorVer, walletVer, onOpenDossier, onSelectEvent, mapEvents, markets, events, event, contractId, setContractId, now }: Props) {
  const [focusChart, setFocusChart] = useState(false);
  const [zoomRequest, setZoomRequest] = useState({ kind: 'reset' as 'reset' | 'publication', sequence: 0 });
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [reactionRetry, setReactionRetry] = useState(0);
  const chartPanel = useRef<HTMLDivElement>(null);
  const detailPanel = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useDraft<'event' | 'map' | 'sensors' | 'contracts'>('context-tab', 'event');
  const { prefs, update: updatePrefs, saveError } = usePrefs();
  const range: Range = prefs.range;
  const wl = useWatchlist();
  const [ind, setInd] = useState<IndResponse | null>(null);
  const [indErr, setIndErr] = useState<string | null>(null);
  const [reaction, setReaction] = useState<ReactionResult | null>(null);
  const [trades, setTrades] = useState<{ id: string; marks: TradeMark[] } | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  const [hist, setHist] = useState<{ id: string; points: HistoryPoint[]; fetchedAt: string | null; error: string | null; state: string; basis: string } | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [histLoading, setHistLoading] = useState(false);
  const [cps, setCps] = useState<Counterpart[]>([]);
  const [q, setQ] = useDraft('contract-search', '');
  const [venue, setVenue] = useState<'all' | 'polymarket' | 'kalshi'>('all');
  const byId = useMemo(() => new Map(markets.map((m) => [m.condition_id, m])), [markets]);
  const market = contractId ? byId.get(contractId) ?? null : null;
  const band = useMemo(() => event?.event_time ? { from: Date.parse(event.event_time.start), to: Date.parse(event.event_time.start) + 86400e3, label: 'Event day (as stated)' } : null, [event?.event_time?.start]);
  const visibleTrades = useMemo(() => showTrades && trades?.id === contractId ? trades.marks : [], [showTrades, trades, contractId]);

  // Selecting an event reveals its detail unless the user is looking at the map (which highlights the selection itself).
  useEffect(() => { if (event) { setTab((t) => (t === 'map' ? 'map' : 'event')); if (detailPanel.current) detailPanel.current.scrollTop = 0; } }, [event?.id, eventSelection]);

  useEffect(() => { if (sensorSelection) { setTab('sensors'); if (detailPanel.current) detailPanel.current.scrollTop = 0; } }, [sensorSelection]);

  useEffect(() => {
    if (!contractId) return;
    let live = true;
    setHistLoading(true);
    api.history(contractId)
      .then((h) => { if (live) setHist({ id: contractId, points: h.points, fetchedAt: h.fetched_at, error: h.error, state: h.fetch_state, basis: h.basis }); })
      .catch((e) => { if (live) setHist({ id: contractId, points: [], fetchedAt: null, error: String(e), state: 'error', basis: '' }); })
      .finally(() => { if (live) setHistLoading(false); });
    return () => { live = false; };
  }, [contractId, marketVer, historyRetry]);

  // Indicators are computed on the server from the same stored history; all overlays are fetched so toggling is instant.
  useEffect(() => {
    if (!contractId) return;
    let live = true;
    api.marketIndicators(contractId, IND_IDS)
      .then((r) => { if (live) { setInd(r); setIndErr(null); } })
      .catch((e) => { if (live) { setInd(null); setIndErr((e as Error).message); } });
    return () => { live = false; };
  }, [contractId, marketVer]);

  // Large trades exist only for pilot markets (bounded wallet pilot); other contracts simply have none.
  useEffect(() => {
    if (!contractId) return;
    let live = true;
    api.largeTrades(contractId).then((x) => { if (live) setTrades({ id: contractId, marks: x.map((t) => ({ ts: t.ts * 1000, notional: t.notional_usdc, side: t.side, outcome: t.outcome, price: t.price_usdc, wallet: t.wallet })) }); }).catch(() => { if (live) setTrades(null); });
    return () => { live = false; };
  }, [contractId, walletVer]);

  useEffect(() => {
    setReaction(null); setReactionError(null);
    if (!contractId || !event) return;
    let live = true;
    api.reaction(contractId, Date.parse(event.timestamp) / 1000, event.time_precision).then((r) => { if (live) setReaction(r); }).catch((e) => { if (live) setReactionError(e.message); });
    return () => { live = false; };
  }, [contractId, event?.id, marketVer, reactionRetry]);

  useEffect(() => {
    setCps([]);
    if (!contractId) return;
    let live = true;
    api.counterparts(contractId).then((c) => { if (live) setCps(c); }).catch(() => { /* optional panel */ });
    return () => { live = false; };
  }, [contractId]);

  const points = hist && hist.id === contractId ? hist.points : [];
  const markers: EventMarker[] = useMemo(() => {
    const linked = events.filter((e) => e.linked_contracts.some((c) => c.condition_id === contractId));
    // Selected item always shown; only the 8 most recent other linked items get faint ticks, to keep the chart readable.
    const others = linked.filter((e) => e.id !== event?.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8);
    const out = others.map((e) => ({ ts: Date.parse(e.timestamp), title: e.title, selected: false }));
    if (event) out.push({ ts: Date.parse(event.timestamp), title: event.title, selected: true });
    return out;
  }, [events, contractId, event]);

  const indFor = ind && ind.target === contractId ? ind : null;
  const byInd = useMemo(() => new Map((indFor?.indicators ?? []).map((r) => [r.id, r])), [indFor]);
  const overlays: Overlay[] = useMemo(() => OVERLAYS.filter((o) => prefs.indicators.includes(o.id) && byInd.has(o.id)).flatMap((o) => {
    const r = byInd.get(o.id)!;
    const base = { colorVar: o.colorVar, dashed: o.dashed };
    if (o.id !== 'bollinger') return [{ id: o.id, label: o.label, ...base, points: r.points }];
    const ex = (r.extra ?? {}) as { upper?: Overlay['points']; lower?: Overlay['points'] };
    return [{ id: 'bollinger', label: 'Bands mid (SMA 20)', ...base, points: r.points }, { id: 'bollinger_upper', label: 'Band upper (+2σ)', ...base, points: ex.upper ?? [] }, { id: 'bollinger_lower', label: 'Band lower (−2σ)', ...base, points: ex.lower ?? [] }];
  }), [prefs.indicators, byInd]);
  const bandExcursions = (byInd.get('bollinger')?.extra as { excursions_outside_0_100?: number } | undefined)?.excursions_outside_0_100 ?? 0;
  const panes = prefs.panes ?? [];
  const [paneWindow, setPaneWindow] = useState<ViewWindow | null>(null);
  const paneSpecs: PaneSpec[] = useMemo(() => panes.flatMap((id): PaneSpec[] => {
    const r = byInd.get(id);
    if (!r) return [{ id, title: PANES.find((q) => q.id === id)?.label ?? id, unit: '', lines: [], status: 'unsupported', reason: indErr ?? 'not loaded', note: '' }];
    const ex = (r.extra ?? {}) as { signal?: Overlay['points']; histogram?: Overlay['points'] };
    if (id === 'rsi14') return [{ id, title: 'RSI 14 (0–100)', unit: '', lines: [{ id, label: 'RSI 14', colorVar: '--series-4', points: r.points }], reference: [30, 70], yMin: 0, yMax: 100, status: r.status, reason: r.reason, note: 'Describes the sampled series; not a signal' }];
    return [{ id, title: 'MACD 12/26/9 (pp)', unit: 'pp', lines: [{ id: 'macd_hist', label: 'Histogram', colorVar: '--muted', bars: true, points: ex.histogram ?? [] }, { id, label: 'MACD', colorVar: '--series-1', points: r.points }, { id: 'macd_signal', label: 'Signal (9)', colorVar: '--series-2', dashed: true, points: ex.signal ?? [] }], zeroLine: true, status: r.status, reason: r.reason, note: 'Needs 34 consecutive hourly points; not a signal' }];
  }), [panes, byInd, indErr]);
  const paneStatuses = useMemo(() => Object.fromEntries(PANES.map((q) => [q.id, byInd.get(q.id) ? { status: byInd.get(q.id)!.status, reason: byInd.get(q.id)!.reason } : { status: 'unsupported', reason: indErr ?? 'not loaded' }])), [byInd, indErr]);
  const statuses = useMemo(() => Object.fromEntries(OVERLAYS.map((o) => [o.id, byInd.get(o.id) ? { status: byInd.get(o.id)!.status, reason: byInd.get(o.id)!.reason } : { status: 'unsupported', reason: indErr ?? 'not loaded' }])), [byInd, indErr]);
  const mv = byInd.get('hourly_movement');
  const mvx = (mv?.extra ?? {}) as { current?: { abs_pp: number; t: number } | null; baseline?: { n: number; median_pp: number; p95_pp: number } | null; label?: string; caution?: string | null };
  const evTs = event ? Date.parse(event.timestamp) / 1000 : null;
  const reactionFor = reaction && evTs !== null && Math.abs(reaction.event_t - Math.floor(evTs)) < 2 ? reaction : null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return markets.filter((m) => (venue === 'all' || m.venue === venue) && (!s || `${m.question} ${m.event_title}`.toLowerCase().includes(s)));
  }, [markets, q, venue]);

  const togglePin = () => {
    if (!market) return;
    const pinned = wl.isPinned('market', market.condition_id);
    wl.toggle('market', market.condition_id);
    toast(pinned ? 'Unpinned contract from watchlist' : 'Pinned contract to watchlist', 'info');
  };

  const shareMarket = async () => {
    if (!market) return;
    const base = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
    const url = `${base}#dashboard?market=${encodeURIComponent(market.condition_id)}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      toast('Copied contract link to clipboard', 'success');
    } else {
      toast(`Direct link: ${url}`, 'info', 6000);
    }
  };

  const shareEvent = async () => {
    if (!event) return;
    const params = new URLSearchParams();
    params.set('event', event.id);
    if (contractId) params.set('market', contractId);
    const base = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
    const url = `${base}#dashboard?${params}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      toast('Copied event link to clipboard', 'success');
    } else {
      toast(`Direct link: ${url}`, 'info', 6000);
    }
  };

  const exportCsv = () => {
    if (!market || !points.length) return;
    const paneCols = panes.flatMap((id) => {
      const r = byInd.get(id); if (!r) return [];
      const ex = (r.extra ?? {}) as { signal?: Overlay['points']; histogram?: Overlay['points'] };
      return id === 'rsi14' ? [{ id: 'rsi14', unit: '0_100', points: r.points }] : [{ id: 'macd', unit: 'pp', points: r.points }, { id: 'macd_signal', unit: 'pp', points: ex.signal ?? [] }, { id: 'macd_histogram', unit: 'pp', points: ex.histogram ?? [] }];
    });
    const csv = formatHistoryCsv({ market, points, overlays, panes: paneCols });
    const filename = `${market.venue}_${market.condition_id.replace(/[^a-zA-Z0-9_-]/g, '_')}_history.csv`;
    downloadCsv(filename, csv);
    toast('Exported contract history as CSV', 'success');
  };

  const picker = (
        <details className="changecontract pop" open={!market}><summary>Contract</summary><div className="popbody">
        <div className="marketpicker"><label htmlFor="active-market">Market workspace</label>
          <div className="search-wrap">
            <input type="search" aria-label="Find a contract" placeholder="Find a contract…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button className="clear-btn" onClick={() => setQ('')} aria-label="Clear contract search" title="Clear">×</button>}
          </div>
          <select id="active-market" value={contractId ?? ''} onChange={(e) => setContractId(e.target.value)}><option value="" disabled>Select a contract…</option>{[...new Map([...(market ? [market] : []), ...filtered].map((m) => [m.condition_id, m])).values()].map((m) => <option key={m.condition_id} value={m.condition_id}>{VENUE_NAME[m.venue]} · {m.question}</option>)}</select>
        </div>
        <div className="chart-actions small"><label><input type="checkbox" checked={followMarket} onChange={(e) => setFollowMarket(e.target.checked)} /> Follow linked contract on news selection</label><button onClick={() => setFocusChart(!focusChart)}>{focusChart ? 'Restore panes' : 'Expand chart'}</button></div>
        {!followMarket && <p className="small muted">Current contract locked; select another contract to change it.</p>}
        {event && !event.linked_contracts.some((c) => c.condition_id === contractId) && <p className="context-notice small" role="status">Context only — this news item has no relevance link to the selected contract.</p>}
        {market?.is_open === false && <p className="context-notice small">Provider marks this stored contract as not open. Rules and available history remain accessible.</p>}
        </div></details>
  );

  return (
    <section className={`right ${focusChart ? 'chart-focused' : ''}`}>
      <div className="panel chartpanel" ref={chartPanel}>
        {!market && picker}
        {market ? (
          <>
            {event && event.linked_contracts.length > 0 && (
              <div className="touches" role="group" aria-label="Contracts this item touches">
                <span className="small muted" title="Matched on shared entities and topics. A link is not evidence that the item affected the price.">Touches</span>
                {event.linked_contracts.slice(0, 3).map((c) => (
                  <button key={c.condition_id} className={c.condition_id === contractId ? 'on' : ''} onClick={() => setContractId(c.condition_id)} title={c.question}>
                    <span className="tq">{c.question.length > 40 ? `${c.question.slice(0, 39)}…` : c.question}</span> <b>{pct(c.price)}</b>
                  </button>
                ))}
                {event.linked_contracts.length > 3 && <span className="small muted">+{event.linked_contracts.length - 3} more in “All contracts”</span>}
              </div>
            )}
            <div className="mhead">
              <div>
                <h2 title={market.event_title}><span className={`venue ${market.venue}`}>{VENUE_NAME[market.venue]}</span> {market.question}</h2>
              </div>
              <div className="mhead-actions">
                <button className={`pinbtn ${wl.isPinned('market', market.condition_id) ? 'on' : ''}`} onClick={togglePin} title={wl.isPinned('market', market.condition_id) ? 'Remove from the watchlist' : `Pin to the watchlist (max 8; ${wl.items.length} pinned)`} disabled={!wl.isPinned('market', market.condition_id) && wl.items.length >= 8}>{wl.isPinned('market', market.condition_id) ? '★ Pinned' : '☆ Pin'}</button>
                <button className="sharebtn" onClick={shareMarket} title="Copy direct link to this contract">⎘ Share</button>
              </div>
              <div className="big" title={BASIS[market.quote_basis ?? ''] ?? 'No valid quote'}>
                <b>{pct(market.price)}</b>
                <span className="muted small">{market.outcome_label} · {market.quote_basis ? market.quote_basis.replace('_', ' ') : 'no quote'}</span>
              </div>
            </div>
            {cps.length > 0 && (
              <details className="cps" open={cps.some((c) => c.verified)}>
                <summary><b>Same question on the other venue?</b> <span className="muted small">{cps.length} {cps.some((c) => c.verified) ? 'verified / ' : ''}candidate{cps.length > 1 ? 's' : ''} — not merged, not averaged</span></summary>
                {cps.map((c) => (
                  <div key={c.condition_id} className="cp">
                    <div className="cphead">
                      <span className={`venue ${c.venue}`}>{VENUE_NAME[c.venue]}</span> <button className="linkbtn" onClick={() => setContractId(c.condition_id)}>{c.question}</button>
                      {c.verified ? <span className="chip link" title={c.rules_note ?? ''}>verified equivalent · {c.verified_by}</span> : <span className="chip warn">unverified candidate</span>}
                    </div>
                    <div className="small">
                      Here <b>{pct(market.price)}</b> ({market.quote_basis?.replace('_', ' ') ?? '—'}) · there <b>{pct(c.price)}</b> ({c.quote_basis?.replace('_', ' ') ?? '—'}) · text similarity {c.score.toFixed(2)} · shares {c.shared_entities.join(', ')} · deadlines {c.end_delta_days === null ? 'unknown' : `${c.end_delta_days} d apart`}
                      {c.verified && market.price !== null && c.price !== null && <> · <b>difference {pp(market.price - c.price)}</b> <span className="muted">(two separate prices; not a blended probability)</span></>}
                    </div>
                    {c.verified && c.rules_note && <div className="small muted">Reviewer’s note: {c.rules_note}</div>}
                    <ul className="small muted warnlist">{c.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    <details className="small"><summary>Their rules (excerpt)</summary><p className="muted">{c.rules_excerpt || 'none provided'}</p></details>
                  </div>
                ))}
              </details>
            )}
            <div className="ctrlrow">
            <div className="rangebar" role="group" aria-label="Time range">
              {(['24h', '7d', '30d', 'all'] as Range[]).map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => updatePrefs({ range: r })}>{r === 'all' ? 'All' : r}</button>)}
            </div>
            <details className="marketstats pop"><summary>Details</summary><div className="popbody"><dl className="stats">
              <ChangeStat r={byInd.get('change_1h')} title="1h change" />
              <ChangeStat r={byInd.get('change_24h')} title="24h change" />
              <div title={mv ? (mv.status === 'ok' ? `Latest adjacent-hour move vs ${mvx.baseline?.n} prior adjacent-hour pairs (type-7 quantiles). ${mvx.caution ?? ''}` : `${mv.status.replace('_', ' ')}: ${mv.reason ?? ''}`) : ''}>
                <dt>Hourly move vs its history</dt>
                <dd>{mv?.status === 'ok' && mvx.current && mvx.baseline ? <>{mvx.current.abs_pp.toFixed(1)} pp <span className="muted small">median {mvx.baseline.median_pp.toFixed(1)} · P95 {mvx.baseline.p95_pp.toFixed(1)}</span>{mvx.label?.startsWith('above_p95') && <span className="chip warn">above P95{mvx.caution ? ' · wide spread' : ''}</span>}</> : <span className="muted small">{mv ? mv.status.replace('_', ' ') : '…'}</span>}</dd>
              </div>
              <div title="Reported by the venue's own API; its window and reference point are not documented, so it is not comparable to the history-based changes."><dt>Provider-reported 24h / 7d</dt><dd>{market.one_day_change == null && market.one_week_change == null ? <span className="muted small">not provided</span> : <>{pp(market.one_day_change ?? null)} / {pp(market.one_week_change ?? null)}</>}</dd></div>
              <div><dt>Bid / Ask</dt><dd>{market.best_bid != null && market.best_ask != null ? `${pct(market.best_bid, 1)} / ${pct(market.best_ask, 1)}` : '—'}{market.wide_spread && <span className="chip warn" title="Spread above 10 points: the midpoint is a weak estimate">wide</span>}</dd></div>
              <div><dt>Volume 24h / total</dt><dd title={market.volume_unit === 'USD' ? 'US dollars' : 'Contracts traded (each pays $1 max); not comparable to USD volume'}>{vol(market.volume_24h, market.volume_unit)} / {vol(market.volume_total, market.volume_unit)}</dd></div>
              <div><dt>{market.venue === 'kalshi' ? 'Open interest' : 'Liquidity'}</dt><dd>{market.venue === 'kalshi' ? vol(market.open_interest, 'contracts') : usd(market.liquidity)}</dd></div>
              <div><dt>Provider end date</dt><dd>{shortDate(market.end_date)}</dd></div>
              <div><dt>Observed</dt><dd title={absTime(market.observed_at)}>{ago(market.observed_at, now)}</dd></div>
              <div><dt>Rules</dt><dd><a href={market.resolution_url} target="_blank" rel="noreferrer">{market.venue === 'kalshi' ? 'Market & rules' : 'Resolution criteria'} ↗</a></dd></div>
            </dl></div></details>
            <details className="chartoptions pop"><summary>Options{(prefs.indicators.length + panes.length + (showTrades && trades?.id === contractId && trades.marks.length > 0 ? 1 : 0)) ? ` · ${prefs.indicators.length + panes.length + (showTrades && trades?.id === contractId && trades.marks.length > 0 ? 1 : 0)}` : ''}</summary>
            <div className="popbody">
            {trades?.id === contractId && trades.marks.length > 0 && (
              <label className="small tradetoggle" title="Single trades on this pilot market that met the screening criterion (≥ threshold or ≥ this market's P95). ▲ buy, ▼ sell; each marker's own outcome and price are in the tooltip.">
                <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} /> Large trades ({trades.marks.length})
              </label>
            )}
            <IndicatorControl panes={panes} onPanes={(ids) => updatePrefs({ panes: ids })} paneStatuses={paneStatuses} selected={prefs.indicators} onChange={(ids) => updatePrefs({ indicators: ids })} axis={prefs.axis} onAxis={(a) => updatePrefs({ axis: a })} saveError={saveError} statuses={statuses} />
            <div className="chart-actions small">
              <button onClick={() => setZoomRequest((r) => ({ kind: 'reset', sequence: r.sequence + 1 }))}>Reset zoom</button>
              <button disabled={!event || !points.length || Date.parse(event.timestamp) < points[0].t * 1000 || Date.parse(event.timestamp) > points[points.length - 1].t * 1000} onClick={() => setZoomRequest((r) => ({ kind: 'publication', sequence: r.sequence + 1 }))}>Center on publication</button>
              <button disabled={points.length === 0} onClick={exportCsv} title="Export historical points and overlays to CSV">Export CSV</button>
            </div>
            </div></details>
              {picker}
            </div>
            <div className="chartwrap">
              <ProbChart onWindow={setPaneWindow} contextKey={contractId ?? ''} zoomRequest={zoomRequest} publication={event ? Date.parse(event.timestamp) : null} overlays={overlays} axis={prefs.axis} trades={visibleTrades} points={points} markers={markers} range={range} label={`${market.outcome_label} probability`} band={band} />
              {histLoading && points.length === 0 && <div className="overlay" role="status">Loading history…</div>}
              {!histLoading && points.length === 0 && (
                <div className="overlay">No price history available{hist?.error ? ` (provider error: ${hist.error.slice(0, 80)})` : ''}. Nothing is interpolated or invented. <button onClick={() => setHistoryRetry((n) => n + 1)}>Retry history</button></div>
              )}
            </div>
            {bandExcursions > 0 && prefs.indicators.includes('bollinger') && <p className="small muted">Raw bands leave 0–100% at {bandExcursions} point(s); the axis stays within 0–100%, so those band segments are cut off. Bands are not confidence intervals.</p>}
            {paneSpecs.map((q) => <SubPane key={q.id} spec={q} window={paneWindow} />)}
            <p className="muted small caption">
              {histLoading ? 'Loading history… ' : points.length ? `${points.length} points · fetched ${ago(hist?.fetchedAt ?? null, now)}. ` : ''}History basis: {hist?.basis || '—'}. The headline figure above uses the {market.quote_basis ? BASIS[market.quote_basis].toLowerCase() : 'n/a'}; the two can differ slightly.
              {event && <> Vertical line = publication time of the selected item.{!event.linked_contracts.some((c) => c.condition_id === contractId) && <span className="chip warn">Context only: no relevance link to this contract; previous market selection retained.</span>}</>}
            </p>
            {event && (reactionError ? <p className="small" role="alert">Price around publication failed: {reactionError} <button onClick={() => setReactionRetry((n) => n + 1)}>Retry comparison</button></p> : <Reaction r={reactionFor} />)}
          </>
        ) : <div className="empty">Select a contract. {markets.length === 0 && 'No contracts loaded yet — the first refresh may still be running.'}</div>}
      </div>

      <div className="panel lower" ref={detailPanel}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'event'} className={tab === 'event' ? 'on' : ''} onClick={() => setTab('event')}>Selected event</button>
          <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>Map</button>
          <button role="tab" aria-selected={tab === 'sensors'} className={tab === 'sensors' ? 'on' : ''} onClick={() => setTab('sensors')}>Sensors</button>
          <button role="tab" aria-selected={tab === 'contracts'} className={tab === 'contracts' ? 'on' : ''} onClick={() => setTab('contracts')}>All contracts ({markets.length})</button>
        </div>
        {tab === 'event' && (event ? (
          <article className="detail">
            <div className="detail-head">
              <h2 dir="auto">{event.title}</h2>
              <button className="sharebtn" onClick={shareEvent} title="Copy direct link to this event">⎘ Share</button>
            </div>
            <div className="meta">
              <TierBadge tier={event.reliability_tier} />
              <b>{event.source_name}</b>
              <span className="muted">{event.source_affiliation}</span>
            </div>
            <details className="sourcefacts"><summary>Publication, collection &amp; source details</summary><dl className="kv">
              <div><dt>Published</dt><dd>{absTimeP(event.timestamp, event.time_precision)}{event.publisher_time_note && <> <span className="chip warn">time corrected</span> <span className="muted">{event.publisher_time_note}</span></>}</dd></div>
              {event.modified_at && <div><dt>Revised</dt><dd>{absTime(event.modified_at)} <span className="muted">(publisher edited this item {event.revision_count > 0 ? `${event.revision_count}× since first collected` : 'after publication'}; text shown is the latest version)</span></dd></div>}
              {event.event_time && <div><dt>Reported event time</dt><dd>{new Date(event.event_time.start).toLocaleDateString(undefined, { dateStyle: 'full', timeZone: 'UTC' })} <span className="muted">· day only, from {event.event_time.basis} in the text; the hour is unknown. Shaded on the chart.</span></dd></div>}
              <div><dt>Collected</dt><dd>{absTime(event.collected_at)}</dd></div>
              {event.source_scope && <div><dt>Scope</dt><dd><span className="chip warn">scope limit</span> {event.source_scope}</dd></div>}
              <div><dt>Status</dt><dd>{event.claim_status} <span className="muted">(single source; not independently corroborated)</span></dd></div>
              {event.originating_source && <div><dt>Originating source</dt><dd>{event.originating_source}</dd></div>}
              <div><dt>Place named in text</dt><dd>{event.location ? <>{event.location.name} <span className="muted">· {event.location.precision}{event.location.precision === 'country' ? ' centroid (approximate)' : ''} · {event.location.lat.toFixed(2)}, {event.location.lng.toFixed(2)}</span></> : <span className="muted">unknown</span>}</dd></div>
              {event.vessel_types.length > 0 && <div><dt>Vessel types named</dt><dd>{event.vessel_types.map((v) => <span className="chip" key={v.type} title={`Words used: “${v.span}”. Wording only — not cargo, owner or status.`}>{v.label}</span>)} <span className="muted small">(as worded in the item)</span></dd></div>}
              <div><dt>Entities</dt><dd>{event.entities.length ? event.entities.map((x) => <span className="chip" key={x}>{x}</span>) : <span className="muted">none matched</span>}</dd></div>
            </dl></details>
            <h4>Source text <span className="muted small">(feed excerpt; full article at the publisher)</span></h4>
            <blockquote>{event.summary || <span className="muted">The feed supplied a headline only.</span>}</blockquote>
            <p><a className="btn" href={event.raw_url} target="_blank" rel="noreferrer">Open original at {new URL(event.raw_url).hostname.replace('www.', '')} ↗</a></p>
            {event.language === 'ar' && <NewsTranslation key={`${event.id}:${event.title}:${event.summary}`} eventId={event.id} />}
            <ResearchActions active={active} feedKey={event.feed_key} title={event.title} onOpenDossier={onOpenDossier} />
            {event.assets.length > 0 && (
              <>
                <h4>Mapped reference assets <span className="muted small">(named in the item or located there; not evidence of damage or disruption)</span></h4>
                <table className="mini-table assets">
                  <thead><tr><th>Asset</th><th>Why linked</th><th>Documented relationships (cited, unreviewed)</th></tr></thead>
                  <tbody>{event.assets.map((a) => (
                    <tr key={a.asset_id}>
                      <td><b>{a.name}</b><div className="muted small">{a.type}</div></td>
                      <td><span className="chip">{a.relation === 'explicitly_named' ? 'explicitly named' : 'same reported location'}</span><div className="muted small">{a.evidence}</div></td>
                      <td>{a.relations.length ? a.relations.map((r, i) => <div key={i} className="small"><b>{r.company}</b> — {r.relation.replace(/_/g, ' ')} <a href={r.source_url} target="_blank" rel="noreferrer">source ↗</a> <span className="muted">(as of {r.valid_as_of})</span></div>) : <span className="muted small">no sourced company relationship on file</span>}</td>
                    </tr>))}</tbody>
                </table>
                <AssetGraph title={event.title} links={event.assets} />
              </>
            )}
            {event.story && (
              <>
                <h4>Related coverage <span className="muted small">({event.story.size} items · {event.story.independence_groups} independence group{event.story.independence_groups === 1 ? '' : 's'} assumed{event.story.state_only ? ' · state-affiliated outlets only' : ''})</span></h4>
                <ul className="related">
                  {event.story.publishers.map((p) => (
                    <li key={p.event_id}><TierBadge tier={p.tier} /> <b>{p.name}</b> <span className="muted small">{ago(p.timestamp, now)}</span> — {p.title}</li>
                  ))}
                </ul>
                <p className="muted small">{event.story.note}</p>
              </>
            )}
            <h4>Linked contracts <span className="muted small">(shared named entity + topic; relevance pointer, not causation)</span></h4>
            {event.linked_contracts.length === 0 ? <p className="muted">No explicit match. No link is invented.</p> : (
              <ul className="links">
                {event.linked_contracts.map((c) => (
                  <li key={c.condition_id}>
                    <button className={contractId === c.condition_id ? 'on' : ''} onClick={() => setContractId(c.condition_id)}>
                      <span className="q"><span className={`venue ${c.venue}`}>{VENUE_NAME[c.venue]}</span> {c.question}</span>
                      <span className="why">matched: {c.matched_entities.join(', ')} · {c.matched_topics.join(', ')}</span>
                      <b>{pct(c.price)}</b>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ) : <div className="empty">Click an event on the left.</div>)}
        {tab === 'map' && <MapPanel events={mapEvents} selected={event} onSelect={onSelectEvent} now={now} />}
        {tab === 'sensors' && <SensorPanel selection={sensorSelection} event={event} now={now} versionKey={sensorVer} />}
        {tab === 'contracts' && (
          <div className="contracts">
            <div className="row2">
              <input type="search" placeholder="Filter contracts…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={venue} onChange={(e) => setVenue(e.target.value as typeof venue)} aria-label="Venue">
                <option value="all">All venues</option><option value="polymarket">Polymarket</option><option value="kalshi">Kalshi</option>
              </select>
            </div>
            <ul>
              {filtered.map((m) => (
                <li key={m.condition_id}>
                  <button className={contractId === m.condition_id ? 'on' : ''} onClick={() => { setContractId(m.condition_id); if (chartPanel.current) chartPanel.current.scrollTop = 0; }}>
                    <span className="q">{m.question}<small><span className={`venue ${m.venue}`}>{VENUE_NAME[m.venue]}</span> {m.event_title} · ends {shortDate(m.end_date)}</small></span>
                    <span className="num"><b>{pct(m.price, 0)}</b><small className={m.one_day_change == null ? '' : m.one_day_change >= 0 ? 'up' : 'down'}>{pp(m.one_day_change)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && <p className="empty">No contracts match these filters.</p>}
            <p className="muted small">{filtered.length} contracts. Contracts are never averaged or merged: each row is one venue-specific contract with its own rules.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Price around a selected item's publication, from completed-hour samples and a point-in-time baseline (computed on the server). */
function Reaction({ r }: { r: ReactionResult | null }) {
  if (!r) return <p className="small muted reaction">Loading price around publication…</p>;
  if (r.status !== 'ok') return <p className="small muted reaction">Price around publication unavailable: {r.reason}.</p>;
  const row = (name: string, p: { t: number; p_pct: number } | null) => <tr><th>{name}</th><td>{p ? `${p.p_pct.toFixed(1)}%` : '—'}</td><td className="muted">{p ? hm(p.t) : 'not available'}</td></tr>;
  return (
    <div className="small reaction coincident">
      <b>Price around publication</b> <span className="muted">(final sample of each completed UTC hour)</span>
      <table><tbody>
        {row('Hour before', r.prev)}{row('Publication hour', r.in_hour)}{row('Next hour', r.next)}{row('24 h later', r.day_after)}
      </tbody></table>
      <div>
        Publication-hour move <b>{ppv(r.move_event_hour_pp)}</b>{r.move_event_hour_pp !== null && r.baseline && <> — {LABEL[r.label_event_hour]}</>}
        {' · '}next-hour move <b>{ppv(r.move_next_hour_pp)}</b>{r.move_next_hour_pp !== null && r.baseline && <> — {LABEL[r.label_next_hour]}</>}
        {' · '}level 24 h later vs hour before <b>{ppv(r.level_change_24h_pp)}</b>
      </div>
      <div className="muted">
        {r.baseline ? <>Baseline: {r.baseline.n} adjacent-hour moves before the item (median {r.baseline.median_pp.toFixed(1)} pp, P95 {r.baseline.p95_pp.toFixed(1)} pp). </> : <>{r.reason ?? 'No baseline.'} </>}
        {r.caveats.join(' ')}
      </div>
    </div>
  );
}
