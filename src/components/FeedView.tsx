import { RequestGeneration, useDraft } from '../workspace';
import { NewsTranslation } from './NewsTranslation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem, SourcesResponse } from '../../shared/types';
import { api } from '../api';
import { absTime, agoP } from '../format';
import { TierBadge } from './EventList';

const KINDS = [['all', 'All'], ['news', 'News'], ['official', 'Official'], ['maritime', 'Maritime'], ['telegram', 'Telegram']] as const;
const TOPICS = ['security', 'shipping', 'energy', 'sanctions', 'diplomacy', 'nuclear', 'humanitarian', 'politics', 'military'];
const VIA: Record<string, [string, string]> = {
  backfill: ['backfilled', 'Collected by history backfill, not as a new arrival'],
  gap: ['gap-recovered', 'Collected while recovering a coverage gap, not as a new arrival'],
  late_find: ['late find', 'First collected more than 24 h after its stated publication'],
};
const LANGS = [['en', 'English'], ['ar', 'Arabic'], ['fa', 'Persian'], ['he', 'Hebrew'], ['ru', 'Russian']] as const;

interface Props { now: number; versionKey: string; seedMode: boolean; onOpenEvent: (id: string) => void }

export function FeedView({ now, versionKey, seedMode, onOpenEvent }: Props) {
  const [kind, setKind] = useDraft<string>('feed-kind', 'all');
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
  const [unread, setUnread] = useState<{ marker: string | null; counts: Record<string, number> } | null>(null);
  const [srcs, setSrcs] = useState<SourcesResponse | null>(null);
  const requests = useRef(new RequestGeneration());
  const currentQuery = useRef('');
  const pageQuery = useRef('');
  const moreBusy = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ kind, limit: '40' });
    if (source) p.set('source', source); if (topic) p.set('topic', topic); if (place.trim()) p.set('place', place.trim()); if (lang) p.set('lang', lang); if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [kind, source, topic, place, lang, q]);

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
    setItems([]); setCursor(null); setSnapshot(null); setPending(0); setLoading(true);
    const timer = setTimeout(loadFirst, 250);
    return () => { clearTimeout(timer); requests.current.next(); };
  }, [loadFirst]);
  useEffect(() => { api.sources().then(setSrcs).catch(() => { /* filter list is optional */ }); }, []);
  // New arrivals never move the list: they are counted behind a button until the reader asks for them.
  useEffect(() => {
    if (!snapshot) return;
    let live = true;
    api.feedNew(qs, snapshot).then((r) => { if (live) setPending(r.count); }).catch(() => { /* keep current count */ });
    api.feedUnread().then((r) => { if (live) setUnread(r); }).catch(() => { /* optional */ });
    return () => { live = false; };
  }, [versionKey, snapshot, qs]);

  const more = async () => {
    if (!cursor || moreBusy.current || pageQuery.current !== qs) return;
    const generation = requests.current.next(); moreBusy.current = true; setLoading(true);
    try {
      const r = await api.feed(`${qs}&cursor=${encodeURIComponent(cursor)}`);
      if (!requests.current.isCurrent(generation)) return;
      setItems((x) => [...x, ...r.items]); setCursor(r.next_cursor); setErr(null);
    } catch (e) { if (requests.current.isCurrent(generation)) setErr((e as Error).message); }
    finally { moreBusy.current = false; if (requests.current.isCurrent(generation)) setLoading(false); }
  };
  const showNew = async () => { await loadFirst(); listRef.current?.scrollTo({ top: 0 }); };
  const markRead = async () => { try { setUnread(await api.markFeedRead()); setErr(null); } catch (e) { setErr((e as Error).message); } };
  const isUnread = (it: FeedItem) => !it.backfill && (!unread?.marker || it.collected_at > unread.marker);

  return (
    <main className="feedview">
      <div className="feedbar">
        <div className="tabs" role="tablist" aria-label="Feed type">
          {KINDS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setSource(''); }}>
              {label}{unread && (unread.counts[k] ?? 0) > 0 && <span className="badge" title="Unread arrivals since you last marked the feed read (backfilled items excluded)">{unread.counts[k]}</span>}
            </button>
          ))}
          <button className="linkbtn small grow" onClick={markRead} title="Everything collected up to now counts as read">Mark all read</button>
        </div>
        <div className="row2 feedfilters">
          <div className="search-wrap">
            <input type="search" placeholder="Search text…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            {q && <button className="clear-btn" onClick={() => setQ('')} aria-label="Clear feed search" title="Clear">×</button>}
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source or channel">
            <option value="">All sources</option>
            {kind !== 'telegram' && srcs?.sources.filter((s) => !['prediction_market', 'sensor', 'social', 'wallet'].includes(s.health.kind) && (kind === 'all' || (kind === 'news' ? ['news', 'analysis'].includes(s.health.kind) : s.health.kind === kind))).map((s) => <option key={s.health.source_id} value={s.health.source_id}>{s.health.name}</option>)}
            {(kind === 'all' || kind === 'telegram') && srcs?.telegram.channels.map((c) => <option key={c.channel} value={`telegram:${c.channel}`}>Telegram @{c.channel}</option>)}
          </select>
          <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic"><option value="">All topics</option>{TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <input type="search" placeholder="Place…" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Place" />
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language"><option value="">All languages</option>{LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
        </div>
      </div>
      {pending > 0 && <button className="newitems" onClick={showNew}>{pending} new item{pending === 1 ? '' : 's'} — show</button>}
      {notes.map((n, i) => <div key={i} className="banner seed small">{n}</div>)}
      {err && <div className="banner" role="alert">{err} <button onClick={loadFirst}>Retry feed</button></div>}
      {loading && !items.length && <p role="status" className="muted">Loading matching items…</p>}
      <div className="feedlist" ref={listRef}>
        {items.length === 0 && !loading && <p className="muted empty">No items match these filters.</p>}
        {items.map((it) => (
          <article key={it.key} className={`feeditem ${it.kind} ${isUnread(it) ? 'unread' : ''}`}>
            <div className="meta">
              <span className={`chip kind ${it.kind}`}>{it.kind}</span>
              {it.tier ? <TierBadge tier={it.tier} /> : it.viewpoint_label && <span className="chip warn" title={it.viewpoint_label}>viewpoint-labelled</span>}
              <b>{it.source_name}</b>
              <span className="muted small grow" title={`Published ${absTime(it.published_at)}${it.time_precision === 'date' ? ' (date only)' : ''}\nCollected ${absTime(it.collected_at)}`}>{agoP(it.published_at, it.time_precision, now)}</span>
            </div>
            <h3>{it.event_id ? <button className="linkbtn ftitle" onClick={() => onOpenEvent(it.event_id!)}>{it.title}</button> : <a href={it.url} target="_blank" rel="noreferrer">{it.title}</a>}</h3>
            {it.text && it.text !== it.title && <p className="small ftext" dir="auto">{it.text.length > 280 ? `${it.text.slice(0, 280)}…` : it.text}</p>}
            {it.platform === 'web' && it.language === 'ar' && it.event_id && <NewsTranslation key={`${it.event_id}:${it.title}:${it.text}`} eventId={it.event_id} automatic={false} />}
            <div className="chips small">
              {it.place && <span className="chip loc">{it.place}</span>}
              {it.topics.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>)}
              {it.language && it.language !== 'en' && <span className="chip">{it.language}</span>}
              {it.forward_origin && <span className="chip" title="Forwarded from another channel">fwd: {it.forward_origin}</span>}
              {VIA[it.collected_via] && <span className="chip" title={VIA[it.collected_via][1]}>{VIA[it.collected_via][0]}</span>}
              {it.revised && <span className="chip" title={it.platform === 'telegram' ? 'Telegram marks this post as edited' : 'Revised by the publisher after first collection'}>{it.platform === 'telegram' ? 'edited' : 'revised'}</span>}
              {it.publisher_time_raw && <span className="chip warn" title={`Feed stated ${it.publisher_time_raw}, later than first collection`}>time corrected</span>}
              {it.matches.length > 0 && <button className="chipbtn" onClick={() => onOpenEvent(it.matches[0].event_id)} title="Similar wording to a collected news item — a similarity pointer, not corroboration">similar news ({it.matches[0].strength})</button>}
              <a className="small" href={it.url} target="_blank" rel="noreferrer">original ↗</a>
            </div>
          </article>
        ))}
        {cursor && <button className="loadmore" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Load older items'}</button>}
        {!cursor && items.length > 0 && <p className="muted small center">End of stored items for these filters.{seedMode ? ' (offline seed)' : ''}</p>}
      </div>
    </main>
  );
}
