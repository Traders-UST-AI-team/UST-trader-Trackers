// Telegram analytics: cross-check against news, aggregates for the dashboard, media manifest. All deterministic.
import type { Express } from 'express';
import { db, tx } from './db.ts';
import { tokens } from './story.ts';
import { ENTITIES, extractEntities } from './geo.ts';
import { NEWS_SOURCES } from './registry.ts';

type Row = Record<string, any>;
const parse = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };

// ---- cross-check: Telegram post ↔ news items (TF-IDF cosine + shared entity + time window) ----
const WINDOW_H = 36;
// strong: [(≥2 shared entities and similarity ≥ 0.40) or similarity ≥ 0.50] AND ≥2 shared non-entity words (country names alone never make a match).  weak: similarity ≥ 0.35 with ≥1 shared entity (shown, never counted as a match).
const SIM_MIN = 0.35;
const ENTITY_WORDS = new Set(ENTITIES.flatMap((e) => tokens(e.name)).concat(['saudi', 'arabia', 'emirate', 'yemeni', 'iranian', 'israeli', 'iraqi', 'lebanese', 'syrian', 'saudi', 'houthi', 'ansarallah', 'american', 'u.s', 'riyadh', 'tehran', 'jerusalem', 'beirut', 'baghdad', 'sanaa', 'aden']));
const POST_DAYS = 2; // assess only the last 48 h: the span every news feed reliably covers (older posts would show spurious "no match")

/** Strip the channel's furniture (flags, handles, "BREAKING") so it does not dominate similarity. */
export function cleanPostText(t: string): string {
  return t.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, ' ').replace(/[\p{Extended_Pictographic}‍️]/gu, ' ').replace(/@\w+/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\W*(BREAKING|NEW|URGENT|UPDATE|ALERT|JUST IN)\b[:\-– ]*/i, '').trim();
}

export function matchTelegramToEvents(): { posts: number; matched: number } {
  const since = new Date(Date.now() - POST_DAYS * 86400_000).toISOString();
  const posts = db.prepare("SELECT channel, post_id, posted_at, text, entities FROM tg_posts WHERE posted_at >= ? AND length(text) >= 40").all(since) as unknown as { channel: string; post_id: number; posted_at: string; text: string; entities: string }[];
  const events = db.prepare('SELECT id, published_at, title, summary, entities FROM events WHERE relevant = 1 AND published_at >= ?').all(new Date(Date.now() - (POST_DAYS + 2) * 86400_000).toISOString()) as unknown as { id: string; published_at: string; title: string; summary: string; entities: string }[];
  if (!posts.length || !events.length) { tx(() => db.prepare('DELETE FROM tg_matches').run()); return { posts: posts.length, matched: 0 }; }
  // Word tokens plus canonical entity tokens (counted twice), so "Yemeni missiles hit Riyadh" can meet "Houthis claim attack on Riyadh".
  const entToks = (j: string) => parse<string[]>(j, []).flatMap((e) => [`ent_${e.replace(/\W+/g, '')}`, `ent_${e.replace(/\W+/g, '')}`]);
  const docs = [...posts.map((p) => [...tokens(cleanPostText(p.text)), ...entToks(p.entities)]), ...events.map((e) => [...tokens(`${e.title} ${e.title} ${e.summary}`), ...entToks(e.entities)])];
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const vec = (toks: string[]) => { const tf = new Map<string, number>(); for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1); const v = new Map<string, number>(); let n = 0; for (const [t, c] of tf) { const w = (1 + Math.log(c)) * Math.log(1 + N / (df.get(t) ?? 1)); v.set(t, w); n += w * w; } return { v, n: Math.sqrt(n) }; };
  const pv = posts.map((p, i) => ({ p, ...vec(docs[i]), ents: new Set([...parse<string[]>(p.entities, [])].filter((x) => extractEntities(x).me.length || true)) }));
  const ev = events.map((e, i) => ({ e, ...vec(docs[posts.length + i]), ents: new Set(parse<string[]>(e.entities, [])) }));
  let matched = 0;
  tx(() => {
    db.prepare('DELETE FROM tg_matches').run();
    const ins = db.prepare('INSERT INTO tg_matches (channel, post_id, event_id, similarity, delta_min, strength) VALUES (?,?,?,?,?,?)');
    for (const a of pv) {
      const cands: { id: string; sim: number; delta: number; strength: 'strong' | 'weak' }[] = [];
      const aWords = new Set(tokens(cleanPostText(a.p.text)).filter((t) => !ENTITY_WORDS.has(t)));
      for (const b of ev) {
        const delta = (Date.parse(b.e.published_at) - Date.parse(a.p.posted_at)) / 60000;
        if (Math.abs(delta) > WINDOW_H * 60) continue;
        let shared = 0; for (const x of a.ents) if (b.ents.has(x)) shared++;
        if (!shared) continue;
        let dot = 0; const [s, l] = a.v.size < b.v.size ? [a.v, b.v] : [b.v, a.v];
        for (const [t, w] of s) { const o = l.get(t); if (o) dot += w * o; }
        const sim = dot / ((a.n * b.n) || 1) + Math.min(0.06, 0.02 * shared);
        if (sim < SIM_MIN) continue;
        let sharedWords = 0; for (const w of new Set(tokens(`${b.e.title} ${b.e.summary}`))) if (aWords.has(w)) sharedWords++;
        cands.push({ id: b.e.id, sim, delta, strength: ((shared >= 2 && sim >= 0.4) || sim >= 0.5) && sharedWords >= 2 ? 'strong' : 'weak' });
      }
      cands.sort((x, y) => y.sim - x.sim);
      for (const c of cands.slice(0, 5)) ins.run(a.p.channel, a.p.post_id, c.id, c.sim, c.delta, c.strength);
      if (cands.some((c) => c.strength === 'strong')) matched++;
    }
  });
  return { posts: posts.length, matched };
}

const tierOf = (sourceId: string, tier: string | null) => tier ?? NEWS_SOURCES.find((s) => s.id === sourceId)?.tier ?? 'Tier-3';

function postsOut(rows: Row[]): Row[] {
  const ids = rows.map((r) => `${r.channel}/${r.post_id}`);
  const matches = new Map<string, Row[]>();
  if (rows.length) {
    const ms = db.prepare(`SELECT m.channel, m.post_id, m.similarity, m.delta_min, m.strength, e.id AS event_id, e.title, e.published_at, e.source_id, e.publisher, e.tier, e.raw_url
      FROM tg_matches m JOIN events e ON e.id = m.event_id WHERE (m.channel || '/' || m.post_id) IN (${ids.map(() => '?').join(',')}) ORDER BY m.similarity DESC`).all(...ids) as Row[];
    for (const m of ms) { const k = `${m.channel}/${m.post_id}`; matches.set(k, [...(matches.get(k) ?? []), m]); }
  }
  return rows.map((r) => {
    const ms = (matches.get(`${r.channel}/${r.post_id}`) ?? []).map((m) => ({
      event_id: m.event_id, title: m.title, published_at: m.published_at, outlet: m.publisher ?? NEWS_SOURCES.find((s) => s.id === m.source_id)?.name.split(' — ')[0] ?? m.source_id,
      tier: tierOf(m.source_id, m.tier), strength: m.strength as 'strong' | 'weak', similarity: Math.round(m.similarity * 100) / 100, delta_min: Math.round(m.delta_min), url: m.raw_url,
    }));
    return { ...r, edited: !!r.edited, media: parse(r.media, []), link_preview: parse(r.link_preview, null), entities: parse(r.entities, []), topics: parse(r.topics, []), flags: parse(r.flags, []),
      claim_kinds: parse(r.claim_kinds, []), attributions: parse(r.attributions, []), hashtags: parse(r.hashtags, []), domains: parse(r.domains, []),
      location: r.loc_name ? { name: r.loc_name, lat: r.lat, lng: r.lng, precision: r.loc_precision } : null, corroboration: corroboration(r, ms), matches: ms };
  });
}

/** Descriptive only. "no_match" means no similar news item was found in our feeds — it says nothing about truth. */
function corroboration(r: Row, all: { tier: string; strength: string }[]): 'matched_tier12' | 'matched_tier3_only' | 'weak_match' | 'no_match' | 'not_assessed' {
  const ms = all.filter((m) => m.strength === 'strong');
  if ((r.text ?? '').length < 40) return 'not_assessed';
  if (new Date(r.posted_at).getTime() < Date.now() - POST_DAYS * 86400_000) return 'not_assessed';
  if (ms.some((m) => m.tier === 'Tier-1' || m.tier === 'Tier-2')) return 'matched_tier12';
  if (ms.length) return 'matched_tier3_only';
  return all.length ? 'weak_match' : 'no_match';
}

const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pctl = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function overview(days: number, channel?: string) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const ch = channel ?? (db.prepare('SELECT channel FROM tg_channels ORDER BY fetched_at DESC LIMIT 1').get() as { channel: string } | undefined)?.channel ?? null;
  const info = ch ? (db.prepare('SELECT * FROM tg_channels WHERE channel = ?').get(ch) as Row | undefined) ?? null : null;
  const rows = ch ? (db.prepare('SELECT * FROM tg_posts WHERE channel = ? AND posted_at >= ? ORDER BY posted_at').all(ch, since) as Row[]) : [];
  const out = postsOut(rows);
  const perDay = new Map<string, number>(), perHour = Array<number>(24).fill(0), topics = new Map<string, number>(), kinds = new Map<string, number>(), ents = new Map<string, number>(), flags = new Map<string, number>(), attrs = new Map<string, number>(), places = new Map<string, { n: number; lat: number; lng: number; precision: string }>(), langs = new Map<string, number>(), claims = new Map<string, number>();
  const pair = new Map<string, number>();
  const media = { photo: 0, video: 0, round_video: 0, voice: 0, document: 0, text_only: 0, forward: 0, reply: 0, with_link: 0 };
  const viewsByKind = new Map<string, number[]>();
  const funnel = { matched_tier12: 0, matched_tier3_only: 0, weak_match: 0, no_match: 0, not_assessed: 0 };
  const lead: number[] = [];
  let withText = 0, attributed = 0;
  for (const p of out) {
    const d = new Date(p.posted_at);
    const day = d.toISOString().slice(0, 10); perDay.set(day, (perDay.get(day) ?? 0) + 1); perHour[d.getUTCHours()]++;
    for (const t of p.topics) topics.set(t, (topics.get(t) ?? 0) + 1);
    kinds.set(p.report_kind, (kinds.get(p.report_kind) ?? 0) + 1);
    langs.set(p.lang ?? 'und', (langs.get(p.lang ?? 'und') ?? 0) + 1);
    for (const c of p.claim_kinds) claims.set(c, (claims.get(c) ?? 0) + 1);
    const es: string[] = [...new Set<string>(p.entities)].filter((x) => x !== 'United States' || true);
    for (const e of es) ents.set(e, (ents.get(e) ?? 0) + 1);
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) { const k = [es[i], es[j]].sort().join('|'); pair.set(k, (pair.get(k) ?? 0) + 1); }
    for (const f of p.flags) flags.set(f, (flags.get(f) ?? 0) + 1);
    for (const a of p.attributions) attrs.set(a, (attrs.get(a) ?? 0) + 1);
    if (p.location) { const k = `${p.location.name}|${p.location.precision}`; const cur = places.get(k) ?? { n: 0, lat: p.location.lat, lng: p.location.lng, precision: p.location.precision }; cur.n++; places.set(k, cur); }
    const types = new Set(p.media.map((m: { type: string }) => m.type));
    for (const t of ['photo', 'video', 'round_video', 'voice', 'document'] as const) if (types.has(t)) media[t]++;
    if (!p.media.length && p.text) media.text_only++;
    if (p.forwarded_from) media.forward++; if (p.reply_to) media.reply++; if (p.domains.length) media.with_link++;
    if (p.text.length >= 40) { withText++; if (['breaking_claim', 'report'].includes(p.report_kind)) { /* denominators for attribution below */ } }
    if (['breaking_claim', 'report'].includes(p.report_kind)) { if (p.attributions.length) attributed++; }
    if (p.views) viewsByKind.set(p.report_kind, [...(viewsByKind.get(p.report_kind) ?? []), p.views]);
    funnel[p.corroboration as keyof typeof funnel]++;
    // minutes by which the post preceded the EARLIEST matching news item (positive = Telegram first, negative = news first)
    const strongM = p.matches.filter((m: { strength: string }) => m.strength === 'strong');
    if (strongM.length) lead.push(strongM.reduce((a: number, m: { delta_min: number }) => Math.min(a, m.delta_min), Infinity));
  }
  const claimPosts = out.filter((p) => ['breaking_claim', 'report'].includes(p.report_kind)).length;
  const top = (m: Map<string, number>, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
  const entTop = top(ents, 24).map((x) => x.name);
  return {
    channel: ch, info: info ? { title: info.title, description: info.description, subscribers: info.subscribers, counters: parse(info.counters, []), fetched_at: info.fetched_at, last_attempt_at: info.last_attempt_at ?? null, last_error: info.last_error ?? null, gap_note: info.gap_note ?? null } : null,
    window_days: days, posts: out.length, with_text: withText,
    per_day: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })), per_hour_utc: perHour,
    topics: top(topics), report_kinds: top(kinds), languages: top(langs), claim_kinds: top(claims), media, top_entities: top(ents, 20), top_flags: top(flags, 12), top_attributions: top(attrs, 12),
    attribution: { claim_posts: claimPosts, with_attribution: attributed },
    places: [...places.entries()].map(([k, v]) => ({ name: k.split('|')[0], ...v })).sort((a, b) => b.n - a.n).slice(0, 40),
    network: { nodes: entTop.map((name) => ({ name, count: ents.get(name)! })), edges: [...pair.entries()].filter(([k]) => k.split('|').every((x) => entTop.includes(x))).map(([k, w]) => ({ a: k.split('|')[0], b: k.split('|')[1], weight: w })).filter((e) => e.weight >= 2).sort((a, b) => b.weight - a.weight).slice(0, 80) },
    views: [...viewsByKind.entries()].map(([kind, v]) => ({ kind, n: v.length, median: median(v), p90: pctl(v, 0.9) })),
    corroboration: funnel, lead_minutes: /* positive = Telegram first */ { n: lead.length, median: median(lead), samples: lead.slice(0, 400) },
    notes: ['Counts come from fixed dictionaries/regexes; nothing here is a model judgement.', 'Views are reach, not accuracy. "No match" means no similar item in our news feeds, not that the claim is false.', 'The channel describes itself as "Independent, but not unbiased" with a focus on Iran and the Resistance Axis; treat it as a viewpoint-labelled discovery source.'],
  };
}

export function registerTelegramRoutes(app: Express) {
  app.get('/api/telegram/channels', (_req, res) => res.json(db.prepare('SELECT channel, title, subscribers, fetched_at, last_attempt_at, last_error, gap_note, (SELECT COUNT(*) FROM tg_posts p WHERE p.channel = c.channel) AS posts FROM tg_channels c ORDER BY channel').all()));
  app.get('/api/telegram/overview', (req, res) => res.json(overview(Math.min(30, Math.max(1, Number(req.query.days ?? 7))), req.query.channel as string | undefined)));
  app.get('/api/telegram/posts', (req, res) => {
    const ch = (req.query.channel as string) ?? (db.prepare('SELECT channel FROM tg_channels ORDER BY fetched_at DESC LIMIT 1').get() as { channel: string } | undefined)?.channel;
    if (!ch) return res.json([]);
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    res.json(postsOut(db.prepare('SELECT * FROM tg_posts WHERE channel = ? ORDER BY posted_at DESC LIMIT ?').all(ch, limit) as Row[]));
  });
  // Media manifest: URLs only, for analysis in other tools. Nothing is downloaded by this server.
  app.get('/api/telegram/media-manifest', (req, res) => {
    const rows = db.prepare("SELECT channel, post_id, posted_at, url, text, media FROM tg_posts WHERE media != '[]' ORDER BY posted_at DESC").all() as Row[];
    const items = rows.flatMap((r) => parse<{ type: string; url: string | null; thumb: string | null; duration: string | null; note?: string }[]>(r.media, []).map((m, i) => ({
      post_url: r.url, channel: r.channel, post_id: r.post_id, posted_at: r.posted_at, index: i, type: m.type, media_url: m.url, thumb_url: m.thumb, duration: m.duration, note: m.note ?? null, caption: (r.text as string).slice(0, 280),
    })));
    if (req.query.format === 'csv') {
      const cols = ['post_url', 'posted_at', 'type', 'media_url', 'thumb_url', 'duration', 'note', 'caption'];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      res.type('text/csv').send([cols.join(','), ...items.map((it) => cols.map((c) => esc((it as Record<string, unknown>)[c])).join(','))].join('\n'));
    } else res.json({ note: 'URLs only. Telegram media links may expire; downloading and any AI/ML analysis are your responsibility under Telegram’s terms (see docs/TELEGRAM.md).', count: items.length, items });
  });
}
