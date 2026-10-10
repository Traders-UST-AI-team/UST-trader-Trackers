import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import L from 'leaflet';
import type { TgChannel, TgCorroboration, TgOverview, TgPost } from '../../shared/types';
import { api } from '../api';
import { absTime, ago } from '../format';
import { BarMini } from './charts';
import { css, esc, makeBaseMap } from './baseMap';
import { TierBadge } from './EventList';

const CORR_LABEL: Record<TgCorroboration, string> = {
  matched_tier12: 'Similar item in Tier-1/2 news', matched_tier3_only: 'Similar item only in Tier-3 (state-affiliated) news', weak_match: 'Only weakly similar news items (not counted as a match)', no_match: 'No similar news item found yet', not_assessed: 'Not assessed (short/old/media-only)',
};
const CORR_SHORT: Record<TgCorroboration, string> = { matched_tier12: 'news match T1/T2', matched_tier3_only: 'match: Tier-3 only', weak_match: 'weak similarity only', no_match: 'no news match yet', not_assessed: 'not assessed' };
const KIND_LABEL: Record<string, string> = { breaking_claim: 'breaking claim', report: 'report', commentary: 'commentary', forward: 'forward', media_only: 'media only', empty: 'empty' };
const TOPICS = ['all', 'security', 'shipping', 'energy', 'sanctions', 'diplomacy', 'nuclear', 'humanitarian', 'politics'];

function MediaBadges({ p }: { p: TgPost }) {
  const c: Record<string, number> = {};
  for (const m of p.media) c[m.type] = (c[m.type] ?? 0) + 1;
  const dur = p.media.find((m) => m.duration)?.duration;
  return <>
    {c.photo && <span className="chip">photo{c.photo > 1 ? ` ×${c.photo}` : ''}</span>}
    {(c.video || c.round_video) && <span className="chip">video{(c.video ?? 0) + (c.round_video ?? 0) > 1 ? ` ×${(c.video ?? 0) + (c.round_video ?? 0)}` : ''}{dur ? ` ${dur}` : ''}</span>}
    {c.voice && <span className="chip">voice</span>}
    {c.document && <span className="chip">file</span>}
    {c.unsupported && !c.photo && !c.video && <span className="chip warn" title="Telegram’s preview does not expose this media; open the post in Telegram">media not in preview</span>}
  </>;
}

function Thumb({ p }: { p: TgPost }) {
  const t = p.media.find((m) => m.thumb)?.thumb;
  const [bad, setBad] = useState(false);
  if (!t || bad) return null;
  return <img className="thumb" src={t} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
}

function Network({ ov, onNode, active }: { ov: TgOverview; onNode: (n: string) => void; active: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const ink = css('--text-primary'), muted = css('--muted'), accent = css('--accent'), line = css('--land-line'), ev = css('--event');
    const max = Math.max(1, ...ov.network.nodes.map((n) => n.count)), maxW = Math.max(1, ...ov.network.edges.map((e) => e.weight));
    const cy = cytoscape({
      container: el.current, userZoomingEnabled: true, minZoom: 0.4, maxZoom: 2.5,
      elements: [
        ...ov.network.nodes.map((n) => ({ data: { id: n.name, label: n.name, count: n.count, size: 16 + 34 * Math.sqrt(n.count / max) } })),
        ...ov.network.edges.map((e, i) => ({ data: { id: `e${i}`, source: e.a, target: e.b, weight: e.weight, w: 1 + 5 * (e.weight / maxW) } })),
      ],
      style: [
        { selector: 'node', style: { 'background-color': accent, 'background-opacity': 0.75, 'border-width': 2, 'border-color': css('--surface-1'), label: 'data(label)', color: ink, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 3, width: 'data(size)', height: 'data(size)' } },
        { selector: 'edge', style: { width: 'data(w)', 'line-color': line, opacity: 0.7, 'curve-style': 'haystack' } },
        { selector: 'node:selected, node.active', style: { 'background-color': ev, 'border-color': ev } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 90, padding: 20, randomize: false },
    });
    cy.on('tap', 'node', (e) => onNode(e.target.id()));
    cy.nodes().forEach((n) => { if (n.id() === active) n.addClass('active'); });
    void muted;
    return () => cy.destroy();
  }, [ov, active, onNode]);
  return <div ref={el} className="cy" role="img" aria-label="Entity co-mention network" />;
}

function PlaceMap({ places, onPlace }: { places: TgOverview['places']; onPlace: (n: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const cb = useRef(onPlace); cb.current = onPlace;
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = makeBaseMap(el.current); layer.current = L.layerGroup().addTo(m); map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const lg = layer.current; if (!lg) return;
    lg.clearLayers();
    const accent = css('--accent');
    for (const p of places) {
      const r = Math.min(26, 6 + Math.sqrt(p.n) * 4);
      const approx = p.precision === 'country';
      const cm = L.circleMarker([p.lat, p.lng], { radius: approx ? r + 3 : r, color: accent, weight: 2, fillColor: accent, fillOpacity: approx ? 0.06 : p.precision === 'region' ? 0.14 : 0.5, dashArray: approx ? '4 4' : undefined }).addTo(lg);
      cm.bindTooltip(`${esc(p.name)} — ${p.n} post${p.n > 1 ? 's' : ''} (${p.precision === 'country' ? 'country-level, approximate' : p.precision})`);
    }
  }, [places]);
  return <div ref={el} className="map" role="application" aria-label="Places named in Telegram posts" />;
}

function Funnel({ c }: { c: Record<TgCorroboration, number> }) {
  const order: TgCorroboration[] = ['matched_tier12', 'matched_tier3_only', 'weak_match', 'no_match', 'not_assessed'];
  const color: Record<TgCorroboration, string> = { matched_tier12: 'var(--series-1)', matched_tier3_only: 'var(--series-2)', weak_match: 'color-mix(in srgb, var(--series-1) 35%, var(--surface-1))', no_match: 'var(--muted)', not_assessed: 'var(--grid)' };
  const total = order.reduce((a, k) => a + c[k], 0) || 1;
  return (
    <div>
      <div className="funnel" role="img" aria-label="Cross-check against news">{order.map((k) => c[k] > 0 && <span key={k} style={{ width: `${(100 * c[k]) / total}%`, background: color[k] }} title={`${CORR_LABEL[k]}: ${c[k]}`} />)}</div>
      <ul className="legend2">{order.map((k) => <li key={k}><i style={{ background: color[k] }} /> {CORR_LABEL[k]} <b>{c[k]}</b></li>)}</ul>
    </div>
  );
}

const BUCKETS: [string, (m: number) => boolean][] = [['news >6h earlier', (m) => m < -360], ['news 1–6h earlier', (m) => m >= -360 && m < -60], ['news <1h earlier', (m) => m >= -60 && m < 0], ['TG <1h earlier', (m) => m >= 0 && m < 60], ['TG 1–6h earlier', (m) => m >= 60 && m < 360], ['TG >6h earlier', (m) => m >= 360]];

export function TelegramView({ onOpenEvent, refreshKey, now, seedMode }: { onOpenEvent: (id: string) => void; refreshKey: string | null; now: number; seedMode?: boolean }) {
  const [ov, setOv] = useState<TgOverview | null>(null);
  const [posts, setPosts] = useState<TgPost[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'network' | 'map' | 'post' | 'media'>('overview');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [kind, setKind] = useState('all'); const [mediaF, setMediaF] = useState('all'); const [corr, setCorr] = useState('all'); const [topic, setTopic] = useState('all');
  const [entity, setEntity] = useState(''); const [place, setPlace] = useState(''); const [thumbs, setThumbs] = useState(true);
  const [days, setDays] = useState(7);
  const [channels, setChannels] = useState<TgChannel[]>([]);
  const [channel, setChannel] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [o, p, ch] = await Promise.all([api.tgOverview(days, channel), api.tgPosts(channel ?? undefined), api.tgChannels()]);
      setOv(o); setPosts(p); setChannels(ch); setErr(null);
      if (!sel && p.length) setSel(`${p[0].channel}/${p[0].post_id}`);
    }
    catch (e) { setErr(String(e)); }
  }, [days, sel, channel]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const horizon = Date.now() - days * 86400_000;
    return posts.filter((p) => Date.parse(p.posted_at) >= horizon
      && (kind === 'all' || p.report_kind === kind)
      && (mediaF === 'all' || (mediaF === 'photo' && p.media.some((m) => m.type === 'photo')) || (mediaF === 'video' && p.media.some((m) => m.type === 'video' || m.type === 'round_video')) || (mediaF === 'text' && !p.media.length) || (mediaF === 'forward' && !!p.forwarded_from))
      && (corr === 'all' || p.corroboration === corr) && (topic === 'all' || p.topics.includes(topic))
      && (!entity || p.entities.includes(entity)) && (!place || p.location?.name === place)
      && (!s || `${p.text} ${p.entities.join(' ')} ${p.attributions.join(' ')}`.toLowerCase().includes(s)));
  }, [posts, q, kind, mediaF, corr, topic, entity, place, days]);

  const cur = posts.find((p) => `${p.channel}/${p.post_id}` === sel) ?? null;
  const pick = (p: TgPost) => { setSel(`${p.channel}/${p.post_id}`); setTab('post'); };
  const nodeClick = useCallback((n: string) => { setEntity((e) => (e === n ? '' : n)); }, []);

  if (err && !ov) return <div className="banner">Telegram data unavailable: {err}</div>;
  if (!ov) return <div className="empty">Loading Telegram data…</div>;
  if (seedMode && (!ov.channel || ov.posts === 0)) return <div className="empty"><b>Telegram data is not part of the demo seed.</b> The seed is a shareable snapshot and deliberately excludes third-party Telegram text. Run the live dashboard (<code>npm run dev</code>) to see it, or export a private seed with <code>SEED_WITH_TELEGRAM=1 npm run seed:export</code>.</div>;
  if (!ov.channel || ov.posts === 0) return <div className="empty">No Telegram posts collected yet. The collector runs with each refresh (public preview, 1.5 s between requests); the first backfill can take a couple of minutes.</div>;

  const claimPosts = ov.attribution.claim_posts || 1;
  const assessed = ov.corroboration.matched_tier12 + ov.corroboration.matched_tier3_only + ov.corroboration.weak_match + ov.corroboration.no_match || 1;
  const withMedia = ov.posts - ov.media.text_only;
  const leadBuckets = BUCKETS.map(([name, f]) => ({ name, value: ov.lead_minutes.samples.filter(f).length }));

  return (
    <main className="split tg">
      <section className="events" aria-label="Telegram posts">
        <div className="filters">
          <input type="search" placeholder="Search posts, entities, attributions…" value={q} onChange={(e) => setQ(e.target.value)} />
          {channels.length > 1 && (
            <div className="row"><select value={channel ?? ov.channel ?? ''} onChange={(e) => { setChannel(e.target.value); setSel(null); }} aria-label="Channel">
              {channels.map((c) => <option key={c.channel} value={c.channel}>{c.title ?? c.channel} ({c.posts}){c.last_error ? ' ⚠' : ''}</option>)}
            </select></div>
          )}
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Post kind"><option value="all">All kinds</option>{Object.entries(KIND_LABEL).filter(([k]) => k !== 'empty').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={mediaF} onChange={(e) => setMediaF(e.target.value)} aria-label="Media"><option value="all">Any media</option><option value="photo">Photo</option><option value="video">Video</option><option value="text">Text only</option><option value="forward">Forwards</option></select>
            <select value={corr} onChange={(e) => setCorr(e.target.value)} aria-label="Cross-check"><option value="all">Any cross-check</option>{(Object.keys(CORR_SHORT) as TgCorroboration[]).map((k) => <option key={k} value={k}>{CORR_SHORT[k]}</option>)}</select>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">{TOPICS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All topics' : t}</option>)}</select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">{[1, 3, 7, 14].map((d) => <option key={d} value={d}>last {d} d</option>)}</select>
            <label className="check" title="Thumbnails load directly from Telegram’s CDN in your browser"><input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} /> thumbnails</label>
          </div>
          {(entity || place) && <div className="small">Filtered by {entity && <button className="chipbtn" onClick={() => setEntity('')}>entity: {entity} ✕</button>} {place && <button className="chipbtn" onClick={() => setPlace('')}>place: {place} ✕</button>}</div>}
          <div className="muted small">{shown.length} shown of {posts.length} collected · newest first</div>
        </div>
        <ol className="cards">
          {shown.map((p) => {
            const key = `${p.channel}/${p.post_id}`;
            return (
              <li key={key}>
                <button className={`card ${sel === key ? 'sel' : ''}`} onClick={() => pick(p)}>
                  <div className="meta">
                    <span className="chip">{KIND_LABEL[p.report_kind] ?? p.report_kind}</span>
                    {p.forwarded_from && <span className="chip" title="Forwarded; upstream attribution is the original source, not this channel">fwd: {p.forwarded_from}</span>}
                    <time title={absTime(p.posted_at)}>{ago(p.posted_at, now)}</time>
                  </div>
                  <div className="tgrow">
                    {thumbs && <Thumb p={p} />}
                    <p className="tgtext">{p.text || <span className="muted">(no text)</span>}</p>
                  </div>
                  <div className="chips">
                    <MediaBadges p={p} />
                    {p.attributions.length ? <span className="chip">cites: {p.attributions.slice(0, 2).join(', ')}</span> : p.report_kind === 'breaking_claim' || p.report_kind === 'report' ? <span className="chip warn" title="No named source near a reporting verb">unattributed</span> : null}
                    <span className={`chip ${p.corroboration === 'matched_tier12' ? 'link' : p.corroboration === 'no_match' ? 'warn' : ''}`} title={CORR_LABEL[p.corroboration]}>{CORR_SHORT[p.corroboration]}</span>
                    {p.location && <span className="chip loc">{p.location.name}{p.location.precision === 'country' ? ' · approx.' : ''}</span>}
                  </div>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="empty">No posts match these filters.</li>}
        </ol>
      </section>

      <section className="right">
        <div className="panel">
          <div className="tabs" role="tablist">
            {(['overview', 'network', 'map', 'post', 'media'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ overview: 'Overview', network: 'Entity network', map: 'Places', post: 'Selected post', media: 'Media & export' }[t]}</button>)}
          </div>

          {tab === 'overview' && (
            <div className="tgov">
              <div className="viewpoint">
                <b>{ov.info?.title ?? ov.channel}</b> · {ov.info?.subscribers ? `${(ov.info.subscribers / 1000).toFixed(0)}K subscribers` : ''}
                <p className="small desc">Channel’s own description, verbatim: “{(ov.info?.description ?? '').slice(0, 420)}”</p>
                {ov.info?.last_error && <p className="small"><span className="chip warn">last attempt failed</span> {ov.info.last_error.slice(0, 140)} — showing the data collected earlier.</p>}
                {ov.info?.gap_note && <p className="small"><span className="chip warn">possible coverage gap</span> {ov.info.gap_note}.</p>}
                <p className="small"><span className="chip warn">viewpoint-labelled discovery source</span> It states a bias and a focus; its posts are claims to check, not established facts. Collected from the public web preview ({ov.posts} posts in the last {ov.window_days} d; last fetched {ago(ov.info?.fetched_at ?? null, now)}).</p>
              </div>
              <dl className="kpis">
                <div><dt>Posts</dt><dd>{ov.posts}</dd></div>
                <div><dt>With media</dt><dd>{Math.round((100 * withMedia) / Math.max(1, ov.posts))}%</dd></div>
                <div><dt>Claims citing a named source</dt><dd>{Math.round((100 * ov.attribution.with_attribution) / claimPosts)}%</dd></div>
                <div><dt>Matched in Tier-1/2 news</dt><dd>{Math.round((100 * ov.corroboration.matched_tier12) / assessed)}%</dd></div>
              </dl>
              <div className="minis">
                <figure className="minicard"><figcaption><b>Posts per day</b><span className="muted small"> · UTC</span></figcaption><BarMini label="Posts per day" data={ov.per_day.map((d) => ({ name: d.day.slice(5), value: d.count }))} height={150} /></figure>
                <figure className="minicard"><figcaption><b>Posts by hour of day</b><span className="muted small"> · UTC, all days</span></figcaption><BarMini label="Posts by hour" data={ov.per_hour_utc.map((v, h) => ({ name: String(h), value: v }))} height={150} /></figure>
                <figure className="minicard"><figcaption><b>Topics</b><span className="muted small"> · dictionary match, a post can have several</span></figcaption><BarMini horizontal label="Topics" data={ov.topics.map((t) => ({ name: t.name, value: t.count }))} height={Math.max(120, ov.topics.length * 22)} /></figure>
                <figure className="minicard"><figcaption><b>Claim types</b><span className="muted small"> · regex match</span></figcaption><BarMini horizontal label="Claim kinds" data={ov.claim_kinds.map((t) => ({ name: t.name.replace('_', ' '), value: t.count }))} height={Math.max(120, ov.claim_kinds.length * 22)} /></figure>
                <figure className="minicard"><figcaption><b>Countries tagged by the channel’s flags</b></figcaption><BarMini horizontal label="Flags" data={ov.top_flags.map((t) => ({ name: t.name, value: t.count }))} height={Math.max(120, ov.top_flags.length * 22)} /></figure>
                <figure className="minicard"><figcaption><b>Named sources in posts</b><span className="muted small"> · only near a reporting verb</span></figcaption>{ov.top_attributions.length ? <BarMini horizontal label="Attributions" data={ov.top_attributions.map((t) => ({ name: t.name, value: t.count }))} height={Math.max(120, ov.top_attributions.length * 22)} /> : <p className="muted small">None detected.</p>}</figure>
              </div>
              <h4>Cross-check against our news feeds</h4>
              <Funnel c={ov.corroboration} />
              <p className="muted small">Only posts from the last 48 hours are assessed (the span all our news feeds cover). Strong match = text similarity plus ≥2 shared entities, or very high similarity, within ±36 h; weaker similarity is listed but not counted. <b>“No similar news item” does not mean a claim is false</b> — it may be too new, unreported by the outlets we ingest, or phrased differently. Matches do not verify a claim either; outlets may be repeating the same claim.</p>
              <figure className="minicard"><figcaption><b>Who was first? (matched posts only)</b><span className="muted small"> · n = {ov.lead_minutes.n}; median {ov.lead_minutes.median !== null ? `${ov.lead_minutes.median} min (positive = Telegram first)` : '—'}</span></figcaption>
                <BarMini label="Lead/lag" data={leadBuckets} height={150} /></figure>
              <p className="muted small">Descriptive only: first-seen ordering in our data, not who had the story first anywhere. Small n.</p>
              <h4>Reach (views) by post kind</h4>
              <table className="mini-table"><thead><tr><th>kind</th><th>posts</th><th>median views</th><th>p90 views</th></tr></thead><tbody>{ov.views.map((v) => <tr key={v.kind}><td>{KIND_LABEL[v.kind] ?? v.kind}</td><td>{v.n}</td><td>{v.median?.toLocaleString()}</td><td>{v.p90?.toLocaleString()}</td></tr>)}</tbody></table>
              <p className="muted small">Views measure reach, not accuracy. {ov.notes.slice(0, 1)[0]}</p>
            </div>
          )}

          {tab === 'network' && (
            <div>
              <p className="muted small">Entities mentioned together in posts (edge = co-mentioned in ≥2 posts; node size = number of posts). Click a node to filter the feed. Layout is force-directed, so position carries no meaning.</p>
              <Network ov={ov} onNode={nodeClick} active={entity} />
            </div>
          )}

          {tab === 'map' && (
            <div>
              <p className="muted small">Places named in post text (first-line place preferred). Dashed = country-level, approximate. A place named is not a verified strike location.</p>
              <PlaceMap places={ov.places} onPlace={setPlace} />
              <ul className="placelist">{ov.places.slice(0, 12).map((p) => <li key={p.name}><button className="chipbtn" onClick={() => setPlace(p.name)}>{p.name}</button> <span className="muted small">{p.n}</span></li>)}</ul>
            </div>
          )}

          {tab === 'post' && (cur ? (
            <article className="detail">
              <div className="meta"><span className="chip">{KIND_LABEL[cur.report_kind] ?? cur.report_kind}</span> <b>{ov.info?.title ?? cur.channel}</b> <span className="muted">{absTime(cur.posted_at)}{cur.edited ? ' · edited' : ''}</span></div>
              <blockquote className="pre">{cur.text || '(no text)'}</blockquote>
              <p><a className="btn" href={cur.url} target="_blank" rel="noreferrer">Open on Telegram ↗</a></p>
              <dl className="kv">
                <div><dt>Reach</dt><dd>{cur.views?.toLocaleString() ?? '—'} views <span className="muted">(not accuracy)</span></dd></div>
                <div><dt>Language</dt><dd>{cur.lang}</dd></div>
                <div><dt>Named sources</dt><dd>{cur.attributions.length ? cur.attributions.map((a) => <span className="chip" key={a}>{a}</span>) : <span className="muted">none near a reporting verb — unattributed</span>}</dd></div>
                {cur.forwarded_from && <div><dt>Forwarded from</dt><dd>{cur.forwarded_from}</dd></div>}
                <div><dt>Entities</dt><dd>{cur.entities.map((e) => <span className="chip" key={e}>{e}</span>)}</dd></div>
                <div><dt>Channel flags</dt><dd>{cur.flags.join(', ') || '—'}</dd></div>
                <div><dt>Topics / claim types</dt><dd>{[...cur.topics, ...cur.claim_kinds.map((c) => `(${c.replace('_', ' ')})`)].join(' · ') || '—'}</dd></div>
                <div><dt>Place named</dt><dd>{cur.location ? `${cur.location.name} · ${cur.location.precision}${cur.location.precision === 'country' ? ' (approximate)' : ''}` : 'unknown'}</dd></div>
                {cur.hashtags.length > 0 && <div><dt>Hashtags</dt><dd>{cur.hashtags.map((h) => `#${h}`).join(' ')}</dd></div>}
              </dl>
              {cur.media.length > 0 && (
                <>
                  <h4>Media <span className="muted small">(links only; nothing is downloaded by this tool)</span></h4>
                  <ul className="medialist">{cur.media.map((m, i) => (
                    <li key={i}>{m.thumb && <img className="thumb" src={m.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                      <span><b>{m.type.replace('_', ' ')}</b>{m.duration ? ` · ${m.duration}` : ''}{m.note ? ` · ${m.note}` : ''}{' '}
                        {m.url ? <a href={m.url} target="_blank" rel="noreferrer">direct file ↗</a> : <span className="muted">no direct URL in the preview — open the post</span>}</span></li>
                  ))}</ul>
                </>
              )}
              <h4>Cross-check <span className="muted small">(text similarity; not verification)</span></h4>
              <p className="small"><span className={`chip ${cur.corroboration === 'matched_tier12' ? 'link' : cur.corroboration === 'no_match' ? 'warn' : ''}`}>{CORR_LABEL[cur.corroboration]}</span></p>
              {cur.matches.length > 0 && (
                <ul className="links">{cur.matches.map((m) => (
                  <li key={m.event_id}><button onClick={() => onOpenEvent(m.event_id)}>
                    <span className="q"><TierBadge tier={m.tier} /> <b>{m.outlet}</b> — {m.title}</span>
                    <span className="why"><b>{m.strength === 'strong' ? 'match' : 'weak similarity'}</b> {m.similarity.toFixed(2)} · {m.delta_min >= 0 ? `news item appeared ${Math.round(m.delta_min)} min after this post` : `news item was ${Math.round(-m.delta_min)} min before this post`} · open in dashboard</span>
                    <b>↗</b></button></li>
                ))}</ul>
              )}
            </article>
          ) : <div className="empty">Pick a post on the left.</div>)}

          {tab === 'media' && (
            <div>
              <p className="small">For analysing video/images in other tools: this server exposes a <b>manifest of media URLs</b> and never downloads or analyses media itself.</p>
              <p><a className="btn" href="/api/telegram/media-manifest" target="_blank" rel="noreferrer">Media manifest (JSON)</a> <a className="btn" href="/api/telegram/media-manifest?format=csv" target="_blank" rel="noreferrer">CSV</a></p>
              <dl className="kpis">
                <div><dt>Posts with photo</dt><dd>{ov.media.photo}</dd></div><div><dt>Posts with video</dt><dd>{ov.media.video + ov.media.round_video}</dd></div>
                <div><dt>Forwards</dt><dd>{ov.media.forward}</dd></div><div><dt>Posts with an external link</dt><dd>{ov.media.with_link}</dd></div>
              </dl>
              <p className="muted small">Telegram’s terms (§1.5) restrict AI/ML use of Telegram platform data, and a separate content-licensing/AI-scraping policy exists that this tool could not read. Everything this dashboard computes from Telegram text is rule-based (dictionaries, regexes, counting, TF-IDF similarity). Running models on the media is your decision and responsibility — check those terms first. Media links can expire.</p>
              <div className="thumbgrid">{posts.filter((p) => p.media.some((m) => m.thumb)).slice(0, 36).map((p) => <button key={p.post_id} className="tgthumb" onClick={() => pick(p)} title={p.text.slice(0, 120)}><Thumb p={p} /></button>)}</div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
