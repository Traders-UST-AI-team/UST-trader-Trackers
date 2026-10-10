import { useEffect, useMemo, useState } from 'react';
import type { HistoryPoint, LargeTrade, Market, TrackerEvent, WatchCard } from '../../shared/types';
import { groupMarkets, isThin, rankMovers, type MarketGroup } from '../../shared/movers';
import { api } from '../api';
import { useWatchlist } from '../store';
import { useDraft } from '../workspace';
import { absTime, ago, pct, shortDate, usdc, vol, VENUE_NAME } from '../format';
import { ProbChart, type Range } from './ProbChart';
import { WalletsView } from './WalletsView';

type Tab = 'movers' | 'all' | 'trades';
const RANGES: Range[] = ['24h', '7d', '30d'];
const LADDER_SHOWN = 8;
const outlet = (e: TrackerEvent) => e.publisher ?? e.source_name.split(' — ')[0];
const BASIS: Record<string, string> = { venue: '24h change reported by the venue', observed: '24h change from this tracker\'s own observations (the venue reports none)' };

function Move({ m, big = false }: { m: Market; big?: boolean }) {
  const d = m.change_24h;
  if (d == null) return <span className="mk-mv muted" title="No 24h change: the venue reports none and this tracker has no observation from 24 h ago">—</span>;
  return <span className={`mk-mv ${d > 0 ? 'up' : d < 0 ? 'down' : ''} ${big ? 'big' : ''}`} title={BASIS[m.change_basis ?? ''] ?? ''}>{d > 0 ? '▲' : d < 0 ? '▼' : '–'} {Math.abs(d * 100).toFixed(1)}{big && <small> pp 24h</small>}</span>;
}

function GroupRow({ g, sel, onPick }: { g: MarketGroup; sel: boolean; onPick: () => void }) {
  const lead = g.lead;
  return (
    <li><button className={`mk-row ${sel ? 'sel' : ''}`} aria-pressed={sel} onClick={onPick}>
      <span className="body">
        <span className="hl">{g.title}</span>
        <span className="sub">
          {g.contracts.length > 1 && <span className="lbl">{g.labels.get(lead.condition_id)}</span>}
          <b>{pct(lead.price)}</b>
          <span>{vol(lead.volume_24h, lead.volume_unit)} 24h</span>
          {g.news.length > 0 && <span className="news" title={g.news[0].title_en ?? g.news[0].title}>{g.news.length} news</span>}
          {lead.venue === 'kalshi' && <span>Kalshi</span>}
        </span>
      </span>
      <Move m={lead} />
    </button></li>
  );
}

function PinnedRow({ c, onPick }: { c: WatchCard; onPick: () => void }) {
  const ch = c.change;
  const v = c.latest.value == null ? '—' : c.unit === '%' || c.kind === 'market' ? `${c.latest.value.toFixed(1)}%` : c.latest.value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <li><button className="mk-row pinned" onClick={onPick} title={`${c.subtitle}\nobserved ${absTime(c.latest.observed_at)}`}>
      <span className="body"><span className="hl">{c.title}</span></span>
      <span className="mk-pin-val"><b>{v}</b>{ch && ch.value != null && <span className={`mk-mv ${ch.value > 0 ? 'up' : ch.value < 0 ? 'down' : ''}`}>{ch.value > 0 ? '▲' : ch.value < 0 ? '▼' : '–'} {Math.abs(ch.value).toFixed(1)}{ch.unit === 'pp' ? '' : '%'}</span>}</span>
    </button></li>
  );
}

function Detail({ g, contractId, setContractId, now, onOpenEvent, onBack }: { g: MarketGroup; contractId: string; setContractId: (id: string) => void; now: number; onOpenEvent: (id: string) => void; onBack: () => void }) {
  const m = g.contracts.find((c) => c.condition_id === contractId) ?? g.lead;
  const [range, setRange] = useState<Range>('7d');
  const [hist, setHist] = useState<{ id: string; points: HistoryPoint[] } | null>(null);
  const [trades, setTrades] = useState<{ id: string; rows: LargeTrade[] } | null>(null);
  const [allRungs, setAllRungs] = useState(false);
  const wl = useWatchlist();
  useEffect(() => setAllRungs(false), [g.id]);
  useEffect(() => {
    let live = true;
    api.history(m.condition_id).then((h) => { if (live) setHist({ id: m.condition_id, points: h.points }); }).catch(() => { if (live) setHist({ id: m.condition_id, points: [] }); });
    if (m.venue === 'polymarket') api.largeTrades(m.condition_id).then((rows) => { if (live) setTrades({ id: m.condition_id, rows }); }).catch(() => { if (live) setTrades({ id: m.condition_id, rows: [] }); });
    return () => { live = false; };
  }, [m.condition_id, m.venue]);
  const points = useMemo(() => (hist?.id === m.condition_id ? hist.points : []), [hist, m.condition_id]);
  // News linked to any contract in the event is marked on the chart: a ladder's rungs share their news.
  const markers = useMemo(() => g.news.slice(0, 12).map((e) => ({ ts: Date.parse(e.timestamp), title: e.title_en ?? e.title, selected: false })), [g.news]);
  // Collapsed, the ladder shows its top rungs plus the selected contract wherever it sits.
  const rungs = allRungs ? g.ladder : g.ladder.filter((c, i) => i < LADDER_SHOWN || c.condition_id === m.condition_id);
  const pinned = wl.isPinned('market', m.condition_id);
  const largeTrades = trades?.id === m.condition_id ? trades.rows.slice(0, 6) : [];

  return (
    <section className="mk-detail" aria-label="Selected market">
      <button className="back-stories" onClick={onBack}>← Markets</button>
      <p className="mk-kicker">{VENUE_NAME[m.venue] ?? m.venue}{m.end_date && <> · ends {shortDate(m.end_date)}</>}</p>
      <h2>{g.title}</h2>
      <div className="mk-quote">
        <div>
          {g.contracts.length > 1 && <p className="mk-which">{g.labels.get(m.condition_id)}</p>}
          <p><b className="mk-price">{pct(m.price)}</b><span className="muted small"> {m.outcome_label} · {m.quote_basis ? m.quote_basis.replace('_', ' ') : 'price'}</span></p>
        </div>
        <Move m={m} big />
      </div>
      <p className="mk-facts">
        <span>{vol(m.volume_24h, m.volume_unit)} traded 24h</span>
        {m.best_bid != null && m.best_ask != null && <span title="Best bid / ask">{(m.best_bid * 100).toFixed(1)} / {(m.best_ask * 100).toFixed(1)}¢</span>}
        {isThin(m) && <span className="warn" title="Little 24h volume: a small trade can move this price a lot">thin market</span>}
        <a href={m.resolution_url} target="_blank" rel="noreferrer">Resolution rules ↗</a>
        <button className="quiet-button" onClick={() => wl.toggle('market', m.condition_id)} disabled={!pinned && wl.items.length >= 8} title={pinned ? 'Remove from pinned' : 'Keep at the top of Markets (max 8)'}>{pinned ? '★ Pinned' : '☆ Pin'}</button>
      </p>

      {g.contracts.length > 1 && <div className="block">
        <div className="block-head"><span className="eyebrow">ALL CONTRACTS IN THIS EVENT</span><span className="small muted">price · 24h pp</span></div>
        <ul className="contract-rows">
          {rungs.map((c) => (
            <li key={c.condition_id}><button className={`${c.condition_id === m.condition_id ? 'on' : ''} ${isThin(c) ? 'thin' : ''}`} aria-pressed={c.condition_id === m.condition_id} onClick={() => setContractId(c.condition_id)}>
              <span className="q">{g.labels.get(c.condition_id)}</span><b>{pct(c.price)}</b><Move m={c} />
            </button></li>
          ))}
        </ul>
        {g.contracts.length > LADDER_SHOWN && <button className="quiet-button" onClick={() => setAllRungs((v) => !v)}>{allRungs ? 'Show fewer' : `Show all ${g.contracts.length}`}</button>}
      </div>}

      <div className="block">
        <div className="rangebar" role="group" aria-label="Time range">
          {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
          {markers.length > 0 && <span className="small muted chart-basis">dashed lines = linked news</span>}
        </div>
        <ProbChart contextKey={m.condition_id} points={points} markers={markers} range={range} label={`${m.outcome_label} probability`} axis="auto" />
      </div>

      {g.news.length > 0 && <div className="block">
        <div className="block-head"><span className="eyebrow">NEWS LINKED TO THIS EVENT</span><span className="small muted">coincident, not causal</span></div>
        <ul className="plain-rows">
          {g.news.slice(0, 6).map((e) => <li key={e.id}><button onClick={() => onOpenEvent(e.id)}><span className="o">{outlet(e)}</span><span className="t" dir="auto">{e.title_en ?? e.title}</span><time title={absTime(e.timestamp)}>{ago(e.timestamp, now)}</time></button></li>)}
        </ul>
      </div>}

      {largeTrades.length > 0 && <div className="block">
        <div className="block-head"><span className="eyebrow">LARGE TRADES</span><span className="small muted">screening rule, not a signal</span></div>
        <ul className="plain-rows">
          {largeTrades.map((t) => <li key={t.key}><a href={`https://polygonscan.com/tx/${t.tx_hash}`} target="_blank" rel="noreferrer" className="mk-trade" title={`${t.criteria.join('; ')}\nwallet ${t.wallet}`}>
            <span className="o">{t.side} {t.outcome}</span><span className="t"><b>{usdc(t.notional_usdc)}</b> at {(t.price_usdc * 100).toFixed(1)}¢</span><time title={absTime(t.at)}>{ago(t.at, now)}</time>
          </a></li>)}
        </ul>
      </div>}
    </section>
  );
}

interface Props {
  /** A contract another page asked to show; each new request selects it once. */
  focus?: { id: string; request: number } | null;
  now: number; markets: Market[]; events: TrackerEvent[]; walletVer: string;
  onOpenEvent: (id: string) => void; onOpenSensor: (id: string) => void;
}

/** Markets: what moved, grouped by event, with the news next to it. Lookup and wallet analysis are one tab away. */
export function MarketsView({ focus, now, markets, events, walletVer, onOpenEvent, onOpenSensor }: Props) {
  const [tab, setTab] = useDraft<Tab>('markets-tab', 'movers');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<{ group: string; contract: string } | null>(null);
  const [phoneDetail, setPhoneDetail] = useState(false); // phone width: list or detail, one at a time
  const wl = useWatchlist();
  useEffect(() => { void wl.reload(); }, [markets]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupMarkets(markets, events), [markets, events]);
  const { movers, thinOnly } = useMemo(() => rankMovers(groups), [groups]);
  const all = useMemo(() => {
    const s = q.trim().toLowerCase();
    return groups.filter((g) => !s || `${g.title} ${g.contracts.map((c) => c.question).join(' ')}`.toLowerCase().includes(s)).sort((a, b) => b.volume_24h - a.volume_24h);
  }, [groups, q]);
  const list = tab === 'movers' ? movers : all;
  const group = (sel && groups.find((g) => g.id === sel.group)) ?? list[0] ?? null;
  const contractId = sel && group && sel.group === group.id ? sel.contract : group?.lead.condition_id ?? '';
  const pick = (g: MarketGroup, contract = g.lead.condition_id) => { setSel({ group: g.id, contract }); setPhoneDetail(true); };
  const pickContract = (id: string) => { const g = groups.find((x) => x.contracts.some((c) => c.condition_id === id)); if (g) pick(g, id); };
  useEffect(() => {
    if (!focus) return;
    const g = groups.find((x) => x.contracts.some((c) => c.condition_id === focus.id));
    if (!g) return;
    if (!movers.includes(g)) setTab('all');
    else if (tab === 'trades') setTab('movers');
    pick(g, focus.id);
  }, [focus?.request, groups.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`mk ${tab === 'trades' ? 'wide' : ''} ${phoneDetail ? 'show-detail' : ''}`}>
      <section className="mk-list" aria-label="Markets">
        <div className="mk-head">
          <h1>Markets</h1>
          <div className="seg" role="tablist" aria-label="Markets view">
            {([['movers', 'Movers'], ['all', 'All'], ['trades', 'Trades & wallets']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'all' && <div className="search-wrap"><input type="search" placeholder="Find a contract…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a contract" />{q && <button className="clear-btn" onClick={() => setQ('')} aria-label="Clear" title="Clear">×</button>}</div>}
          {tab === 'movers' && <p className="mk-sum">{movers.length} events moved ≥ 3 pp in 24 h <span className="muted">of {groups.length}</span></p>}
        </div>
        {tab !== 'trades' && <ol className="mk-rows">
          {tab === 'movers' && wl.cards.length > 0 && <>
            <li className="desk-label">Pinned</li>
            {wl.cards.map((c) => <PinnedRow key={c.key} c={c} onPick={() => (c.kind === 'market' ? pickContract(c.id) : onOpenSensor(c.id))} />)}
            <li className="desk-label">Moved most</li>
          </>}
          {list.map((g) => <GroupRow key={g.id} g={g} sel={group?.id === g.id} onPick={() => pick(g)} />)}
          {list.length === 0 && <li className="empty">{tab === 'movers' ? 'Nothing moved 3 pp or more on a traded market in the last 24 h.' : 'No contract matches.'}</li>}
          {tab === 'movers' && thinOnly > 0 && <li className="desk-foot"><button onClick={() => setTab('all')}>{thinOnly} events moved only on thin markets · All ↗</button></li>}
        </ol>}
      </section>
      {tab === 'trades'
        ? <div className="mk-trades"><WalletsView now={now} versionKey={walletVer} onOpenMarket={(id) => { pickContract(id); setTab('all'); }} /></div>
        : group ? <Detail key={group.id} g={group} contractId={contractId} setContractId={(id) => pick(group, id)} now={now} onOpenEvent={onOpenEvent} onBack={() => { setPhoneDetail(false); window.scrollTo({ top: 0 }); }} />
          : <section className="mk-detail simple-empty"><h2>Pick a market on the left.</h2></section>}
    </div>
  );
}
