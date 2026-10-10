import { RequestGeneration, useDraft } from '../workspace';
import { NewsTranslation } from './NewsTranslation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem, SourcesResponse } from '../../shared/types';
import { api } from '../api';
import { absTime, agoP } from '../format';
import { TIER_LABEL } from './EventList';

const KINDS = [['all', 'All'], ['news', 'News'], ['official', 'Official'], ['maritime', 'Maritime'], ['telegram', 'Telegram']] as const;
const KIND_TAG: Record<string, string> = { official: 'Official', maritime: 'Maritime', telegram: 'Telegram' };
const TOPICS = ['security', 'shipping', 'energy', 'sanctions', 'diplomacy', 'nuclear', 'humanitarian', 'politics', 'military'];
const VIA: Record<string, string> = {
  backfill: 'Collected by history backfill, not as a new arrival',
  gap: 'Collected while recovering a coverage gap, not as a new arrival',
  late_find: 'First collected more than 24 h after its stated publication',
};
const LANGS = [['en', 'English'], ['ar', 'Arabic'], ['fa', 'Persian'], ['he', 'Hebrew'], ['ru', 'Russian']] as const;

/** Outlet as a reader names it: the publisher for aggregated headlines, the outlet without its feed section otherwise. */
const outletOf = (it: FeedItem) => it.source_name.replace(/ \(via .*\)$/, '').split(' — ')[0];
const clock = (it: FeedItem) => (it.time_precision === 'date' ? '—' : new Date(it.published_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }));
function dayLabel(iso: string, now: number): string {
  const d = new Date(iso), today = new Date(now);
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(today)) return 'Today';
  if (key(d) === key(new Date(now - 86400_000))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

interface Props { now: number; versionKey: string; seedMode: boolean; onOpenEvent: (id: string) => void; deskMarks: ReadonlyMap<string, string> }

/** The full stream as a wire: one line per item, newest first, details on demand. Signal view by default. */
export function FeedView({ now, versionKey, seedMode, onOpenEvent, deskMarks }: Props) {
  const [kind, setKind] = useDraft<string>('feed-kind', 'all');
  const [signal, setSignal] = useDraft('feed-signal', true);
  const [source, setSource] = useDraft('feed-source', '');
  const [topic, setTopic] = useDraft('feed-topic', '');
  const [place, setPlace] = useDraft('feed-place', '');
  const [lang, setLang] = useDraft('feed-lang', '');
  const [q, setQ] = useDraft('feed-q', '');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [unread, setUnread] = useState<{ marker: string | null; counts: Record<string, number> } | null>(null);
  const [srcs, setSrcs] = useState<SourcesResponse | null>(null);
  const requests = useRef(new RequestGeneration());
  const currentQuery = useRef('');
  const pageQuery = useRef('');
  const moreBusy = useRef(false);
  const listRef = useRef<HTMLOListElement>(null);
  const endRef = useRef<HTMLLIElement>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ kind, limit: '60' });
    if (signal) p.set('signal', '1');
    if (source) p.set('source', source); if (topic) p.set('topic', topic); if (place.trim()) p.set('place', place.trim()); if (lang) p.set('lang', lang); if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [kind, signal, source, topic, place, lang, q]);

  if (currentQuery.current !== qs) { currentQuery.current = qs; requests.current.next(); }

  const loadFirst = useCallback(async () => {
    const generation = requests.current.next();
    setLoading(true);
    try {
      const r = await api.feed(qs);
      if (!requests.current.isCurrent(generation)) return;
      pageQuery.current = qs;
      setItems(r.items); setCursor(r.next_cursor); setSnapshot(r.snapshot_at); setNotes(r.notes); setPending(0); setErr(null);
    } catch (e) { if (requests.current.isCurrent(generation)) setErr((e as Error).message); }
    finally { if (requests.current.isCurrent(generation)) setLoading(false); }
  }, [qs]);
  useEffect(() => {
    setItems([]); setCursor(null); setSnapshot(null); setPending(0); setLoading(true); setOpen(null);
    const timer = setTimeout(loadFirst, 250);
    return () => { clearTimeout(timer); requests.current.next(); };
  }, [loadFirst]);
  useEffect(() => { api.sources().then(setSrcs).catch(() => { /* filter list is optional */ }); }, []);
  // New arrivals never move the list: they are counted behind a button until the reader asks for them.
  useEffect(() => {
    if (!snapshot) return;
    let live = true;
    api.feedNew(qs, snapshot).then((r) => { if (live) setPending(r.count); }).catch(() => { /* keep current count */ });
    api.feedUnread(signal).then((r) => { if (live) setUnread(r); }).catch(() => { /* optional */ });
    return () => { live = false; };
  }, [versionKey, snapshot, qs, signal]);

  const more = useCallback(async () => {
    if (!cursor || moreBusy.current || pageQuery.current !== qs) return;
    const generation = requests.current.next(); moreBusy.current = true; setLoading(true);
    try {
      const r = await api.feed(`${qs}&cursor=${encodeURIComponent(cursor)}`);
      if (!requests.current.isCurrent(generation)) return;
      setItems((x) => [...x, ...r.items]); setCursor(r.next_cursor); setErr(null);
    } catch (e) { if (requests.current.isCurrent(generation)) setErr((e as Error).message); }
    finally { moreBusy.current = false; if (requests.current.isCurrent(generation)) setLoading(false); }
  }, [cursor, qs]);
  // Older items load as the reader reaches the end; the button stays as a fallback.
  useEffect(() => {
    const el = endRef.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void more(); }, { root: listRef.current, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, more]);

  const showNew = async () => { await loadFirst(); listRef.current?.scrollTo({ top: 0 }); };
  const markRead = async () => { try { setUnread(await api.markFeedRead(signal)); setErr(null); } catch (e) { setErr((e as Error).message); } };
  const isUnread = (it: FeedItem) => !it.backfill && (!unread?.marker || it.collected_at > unread.marker);
  const filtersOn = [source, topic, place.trim(), lang].filter(Boolean).length;
  const unreadHere = unread?.counts[kind] ?? 0;

  let lastDay = '';
  return (
    <main className="feedview wire">
      <div className="wire-head">
        <div className="wire-top">
          <h1>Feed</h1>
          <div className="search-wrap">
            <input type="search" placeholder="Search text…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the feed" />
            {q && <button className="clear-btn" onClick={() => setQ('')} aria-label="Clear feed search" title="Clear">×</button>}
          </div>
        </div>
        <div className="wire-controls">
          <div className="seg" role="tablist" aria-label="Item type">
            {KINDS.map(([k, label]) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setSource(''); }}>{label}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Which items">
            <button className={signal ? 'on' : ''} aria-pressed={signal} onClick={() => setSignal(true)} title="Leaves out features, items with no market topic, untranslated headlines and repeat copies of one article">Signal</button>
            <button className={!signal ? 'on' : ''} aria-pressed={!signal} onClick={() => setSignal(false)} title="Every stored item">Everything</button>
          </div>
          <details className="wire-filters">
            <summary>Filters{filtersOn ? ` · ${filtersOn}` : ''}</summary>
            <div className="wire-filter-panel">
              <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source or channel">
                <option value="">All sources</option>
                {kind !== 'telegram' && srcs?.sources.filter((s) => !['prediction_market', 'sensor', 'social', 'wallet'].includes(s.health.kind) && (kind === 'all' || (kind === 'news' ? ['news', 'analysis'].includes(s.health.kind) : s.health.kind === kind))).map((s) => <option key={s.health.source_id} value={s.health.source_id}>{s.health.name}</option>)}
                {(kind === 'all' || kind === 'telegram') && srcs?.telegram.channels.map((c) => <option key={c.channel} value={`telegram:${c.channel}`}>Telegram @{c.channel}</option>)}
              </select>
              <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic"><option value="">All topics</option>{TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <input type="search" placeholder="Place…" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Place" />
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language"><option value="">All languages</option>{LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
              {filtersOn > 0 && <button className="quiet-button" onClick={() => { setSource(''); setTopic(''); setPlace(''); setLang(''); }}>Clear filters</button>}
            </div>
          </details>
          <span className="wire-unread">{unreadHere > 0 ? <>{unreadHere} unread · <button className="quiet-button" onClick={markRead} title="Everything collected up to now counts as read">Mark read</button></> : <span className="muted">All read</span>}</span>
        </div>
      </div>
      {pending > 0 && <button className="newitems" onClick={showNew}>{pending} new — show</button>}
      {notes.map((n, i) => <div key={i} className="banner seed small">{n}</div>)}
      {err && <div className="banner" role="alert">{err} <button onClick={loadFirst}>Retry feed</button></div>}

      <ol className="wire-list" ref={listRef}>
        {loading && !items.length && <li className="muted wire-empty" role="status">Loading…</li>}
        {items.length === 0 && !loading && <li className="muted wire-empty">No items match{signal ? ' in the signal view. Try Everything.' : ' these filters.'}</li>}
        {items.map((it) => {
          const day = dayLabel(it.published_at, now);
          const header = day !== lastDay ? <li key={`d:${day}`} className="wire-day">{day}</li> : null;
          lastDay = day;
          const isOpen = open === it.key;
          const mark = it.event_id ? deskMarks.get(it.event_id) : undefined;
          const head = it.title_en ?? it.title;
          return [header, (
            <li key={it.key} className={`wire-item ${isOpen ? 'open' : ''}`}>
              <button className={`wire-row ${isUnread(it) ? 'unread' : ''} ${it.low_signal ? 'low' : ''}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.key)}>
                <time title={`Published ${absTime(it.published_at)}${it.time_precision === 'date' ? ' (date only)' : ''}\nCollected ${absTime(it.collected_at)}`}>{clock(it)}</time>
                <span className="o" title={it.source_name}>{outletOf(it)}{it.tier === 'Tier-3' && <i title="State-affiliated publisher"> · state</i>}</span>
                <span className="t" dir={it.title_en ? 'ltr' : 'auto'}>
                  {KIND_TAG[it.kind] && <em className={`k ${it.kind}`}>{KIND_TAG[it.kind]}</em>}
                  {head}
                </span>
                {mark && <span className="on-monitor" title="This item is part of a story on the Monitor">{mark}</span>}
              </button>
              {isOpen && <div className="wire-detail">
                {it.title_en && <p className="orig" dir="auto" lang={it.language ?? undefined}>{it.title}</p>}
                {it.text && it.text !== it.title && <p className="x" dir="auto">{it.text}</p>}
                {it.platform === 'web' && it.language === 'ar' && it.event_id && <NewsTranslation key={`${it.event_id}:${it.title}:${it.text}`} eventId={it.event_id} automatic={false} />}
                <p className="facts">
                  <span>{it.source_name}</span>
                  {it.tier ? <span title="Publisher-level prior, not a verdict on this claim">{TIER_LABEL[it.tier] ?? it.tier}</span> : it.viewpoint_label && <span title={it.viewpoint_label}>viewpoint-labelled</span>}
                  <span>{agoP(it.published_at, it.time_precision, now)}</span>
                  {it.place && <span>{it.place}</span>}
                  {it.topics.length > 0 && <span>{it.topics.slice(0, 3).join(', ')}</span>}
                  {it.forward_origin && <span title="Forwarded from another channel">fwd: {it.forward_origin}</span>}
                  {VIA[it.collected_via] && <span title={VIA[it.collected_via]}>{it.collected_via.replace('_', ' ')}</span>}
                  {it.revised && <span>{it.platform === 'telegram' ? 'edited' : 'revised'}</span>}
                  {it.publisher_time_raw && <span title={`Feed stated ${it.publisher_time_raw}, later than first collection`}>time corrected</span>}
                  {it.low_signal && <span className="warn" title="Hidden in the signal view">low signal: {it.low_signal}</span>}
                </p>
                <div className="acts">
                  {it.event_id && <button className="source-link" onClick={() => onOpenEvent(it.event_id!)}>Open in Monitor</button>}
                  <a className="quiet-button" href={it.url} target="_blank" rel="noreferrer">Original ↗</a>
                  {it.matches.length > 0 && <button className="quiet-button" onClick={() => onOpenEvent(it.matches[0].event_id)} title="Similar wording to a collected news item — a similarity pointer, not corroboration">Similar news ({it.matches[0].strength})</button>}
                </div>
              </div>}
            </li>
          )];
        })}
        <li ref={endRef} className="wire-end">
          {cursor ? <button className="quiet-button" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Load older'}</button>
            : items.length > 0 && <span className="muted small">End of stored items{seedMode ? ' (offline seed)' : ''}.</span>}
        </li>
      </ol>
    </main>
  );
}
