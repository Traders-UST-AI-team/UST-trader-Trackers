// Telegram PUBLIC channel preview (https://t.me/s/<channel>) — no API, no login, 1.5 s between requests.
// Media is stored as URLs only (never downloaded). Analysis is rule-based (server/telegram-analysis.ts).
import { parse, type HTMLElement } from 'node-html-parser';
import { fetchText } from '../http.ts';
import { db, tx } from '../db.ts';
import { bump } from '../versions.ts';
import { recordSourceSetChange } from '../runlog.ts';
import { analyzePost } from '../telegram-analysis.ts';
import { decodeEntities } from './rss.ts';

/** Base URL of the public preview; overridable so fault-injection tests can point at a local server. */
const tgBase = () => process.env.TELEGRAM_BASE ?? 'https://t.me/s';
export const DEFAULT_CHANNELS = (process.env.TELEGRAM_CHANNELS ?? 'Middle_East_Spectator').split(',').map((s) => s.trim()).filter(Boolean);

export interface TgMedia { type: 'photo' | 'video' | 'round_video' | 'voice' | 'document' | 'unsupported'; url: string | null; thumb: string | null; duration: string | null; note?: string }
export interface TgPost {
  channel: string; post_id: number; posted_at: string; edited: boolean; text: string; views: number | null; forwarded_from: string | null; forwarded_url: string | null;
  reply_to: number | null; media: TgMedia[]; link_preview: { url: string; title: string; site: string; description: string } | null; url: string; links: string[];
}
export interface TgChannelInfo { title: string | null; description: string | null; subscribers: number | null; counters: string[] }

const bgUrl = (el: HTMLElement | null) => /url\(['"]?([^'")]+)['"]?\)/.exec(el?.getAttribute('style') ?? '')?.[1] ?? null;
export function parseCount(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /([\d.,]+)\s*([KkMm]?)/.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1));
}

export function parseChannelPage(html: string, channel: string): { info: TgChannelInfo; posts: TgPost[]; nextBefore: number | null } {
  const root = parse(html);
  const counters = root.querySelectorAll('.tgme_channel_info_counter').map((c) => c.text.replace(/\s+/g, ' ').trim());
  const info: TgChannelInfo = {
    title: root.querySelector('.tgme_channel_info_header_title')?.text.trim() ?? null,
    description: root.querySelector('.tgme_channel_info_description')?.text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() ?? null,
    subscribers: parseCount(counters.find((c) => /subscribers/i.test(c))), counters,
  };
  const posts: TgPost[] = [];
  for (const m of root.querySelectorAll('.tgme_widget_message')) {
    const dp = m.getAttribute('data-post') ?? '';
    const [ch, idStr] = dp.split('/');
    const id = Number(idStr);
    const datetime = m.querySelector('.tgme_widget_message_date time')?.getAttribute('datetime');
    if (!ch || !Number.isFinite(id) || !datetime || !Number.isFinite(Date.parse(datetime))) continue;
    const replyEl = m.querySelector('.tgme_widget_message_reply');
    const replyHref = replyEl?.getAttribute('href') ?? null;
    replyEl?.remove(); // its quoted text must not be read as this post's text
    const fwdEl = m.querySelector('.tgme_widget_message_forwarded_from_name');
    const textEl = m.querySelector('.tgme_widget_message_text');
    const links = (textEl?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href') ?? '').filter((h) => /^https?:/i.test(h));
    const text = textEl ? decodeEntities(textEl.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trim() : '';
    const media: TgMedia[] = [];
    for (const p of m.querySelectorAll('.tgme_widget_message_photo_wrap')) media.push({ type: 'photo', url: bgUrl(p), thumb: bgUrl(p), duration: null });
    for (const v of m.querySelectorAll('.tgme_widget_message_video_wrap, .tgme_widget_message_roundvideo_wrap')) {
      const round = v.classList.contains('tgme_widget_message_roundvideo_wrap');
      media.push({ type: round ? 'round_video' : 'video', url: v.querySelector('video')?.getAttribute('src') ?? null, thumb: bgUrl(v.querySelector('.tgme_widget_message_video_thumb, .tgme_widget_message_roundvideo_thumb')), duration: v.querySelector('.message_video_duration')?.text.trim() ?? null });
    }
    for (const a of m.querySelectorAll('audio.tgme_widget_message_voice, .tgme_widget_message_voice')) { const src = a.getAttribute('src') ?? a.querySelector('audio')?.getAttribute('src') ?? null; if (src) media.push({ type: 'voice', url: src, thumb: null, duration: m.querySelector('.tgme_widget_message_voice_duration')?.text.trim() ?? null }); }
    for (const d of m.querySelectorAll('.tgme_widget_message_document_title')) media.push({ type: 'document', url: null, thumb: null, duration: null, note: d.text.trim() });
    const unsupported = m.querySelector('.message_media_not_supported_label, .message_media_not_supported')?.text.replace(/\s+/g, ' ').trim();
    if (unsupported && !media.some((x) => x.url)) media.push({ type: 'unsupported', url: null, thumb: null, duration: null, note: unsupported.slice(0, 80) });
    const lp = m.querySelector('.tgme_widget_message_link_preview');
    posts.push({
      channel: ch, post_id: id, posted_at: new Date(datetime).toISOString(), edited: /edited/i.test(m.querySelector('.tgme_widget_message_meta')?.text ?? ''), text,
      views: parseCount(m.querySelector('.tgme_widget_message_views')?.text), forwarded_from: fwdEl?.text.trim() ?? null, forwarded_url: m.querySelector('.tgme_widget_message_forwarded_from_name')?.getAttribute('href') ?? null,
      reply_to: replyHref ? Number(/\/(\d+)$/.exec(replyHref)?.[1]) || null : null, media,
      link_preview: lp ? { url: lp.getAttribute('href') ?? '', title: lp.querySelector('.link_preview_title')?.text.trim() ?? '', site: lp.querySelector('.link_preview_site_name')?.text.trim() ?? '', description: lp.querySelector('.link_preview_description')?.text.trim().slice(0, 300) ?? '' } : null,
      url: `https://t.me/${ch}/${id}`, links,
    });
  }
  const more = root.querySelector('a.tme_messages_more')?.getAttribute('href') ?? '';
  const nextBefore = Number(/before=(\d+)/.exec(more)?.[1]) || null;
  return { info, posts, nextBefore };
}

export type SeenVia = 'latest' | 'backfill' | 'gap';
function upsertPosts(posts: TgPost[], via: SeenVia): { inserted: number } {
  const now = new Date().toISOString();
  let inserted = 0;
  tx(() => {
    const exists = db.prepare('SELECT 1 FROM tg_posts WHERE channel = ? AND post_id = ?');
    const up = db.prepare(`INSERT INTO tg_posts (channel, post_id, posted_at, edited, text, views, forwarded_from, forwarded_url, reply_to, media, link_preview, url, lang, entities, topics, flags,
        loc_name, lat, lng, loc_precision, report_kind, claim_kinds, attributions, hashtags, domains, first_seen_at, fetched_at, seen_via)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(channel, post_id) DO UPDATE SET edited=excluded.edited, text=excluded.text, views=excluded.views, media=excluded.media, link_preview=excluded.link_preview,
        lang=excluded.lang, entities=excluded.entities, topics=excluded.topics, flags=excluded.flags, loc_name=excluded.loc_name, lat=excluded.lat, lng=excluded.lng, loc_precision=excluded.loc_precision,
        report_kind=excluded.report_kind, claim_kinds=excluded.claim_kinds, attributions=excluded.attributions, hashtags=excluded.hashtags, domains=excluded.domains, fetched_at=excluded.fetched_at`);
    for (const p of posts) {
      if (!exists.get(p.channel, p.post_id)) inserted++;
      const a = analyzePost(p.text, { hasMedia: p.media.length > 0, isForward: !!p.forwarded_from, links: p.links });
      up.run(p.channel, p.post_id, p.posted_at, p.edited ? 1 : 0, p.text, p.views, p.forwarded_from, p.forwarded_url, p.reply_to, JSON.stringify(p.media), p.link_preview ? JSON.stringify(p.link_preview) : null, p.url,
        a.lang, JSON.stringify(a.entities), JSON.stringify(a.topics), JSON.stringify(a.flags), a.loc?.name ?? null, a.loc?.lat ?? null, a.loc?.lng ?? null, a.loc?.precision ?? null,
        a.reportKind, JSON.stringify(a.claimKinds), JSON.stringify(a.attributions), JSON.stringify(a.hashtags), JSON.stringify(a.domains), now, now, via);
    }
  });
  if (posts.length) bump('telegram'); // views, edits and new posts all change what a reader sees
  return { inserted };
}

export interface TgResult {
  channel: string; pages: number; fetched: number; inserted: number; oldest: string | null; stoppedBecause: string;
  pages_by_phase: { latest: number; gap: number; history: number }; gaps_opened: number; gaps_resolved: number;
}

/** Latest-poll page cap (a busy channel posting faster than this many pages per run opens a durable coverage gap). */
export const LATEST_PAGE_CAP = 4;

// ── channel allowlist (configurable; seeded once from TELEGRAM_CHANNELS) ──
export const CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
export const MAX_CHANNELS = 20;
export interface TgChannelConfig { channel: string; enabled: boolean; added_at: string; added_by: string; note: string | null }

export function channelConfig(): TgChannelConfig[] {
  const n = (db.prepare('SELECT COUNT(*) c FROM tg_channel_config').get() as { c: number }).c;
  if (n === 0) { // first use: the env allowlist becomes the stored configuration (later env changes do not silently override user edits)
    const now = new Date().toISOString();
    for (const ch of DEFAULT_CHANNELS) if (CHANNEL_RE.test(ch)) db.prepare("INSERT OR IGNORE INTO tg_channel_config (channel, enabled, added_at, added_by) VALUES (?, 1, ?, 'env')").run(ch, now);
  }
  return (db.prepare('SELECT * FROM tg_channel_config ORDER BY added_at, channel').all() as Record<string, any>[]).map((r) => ({ channel: r.channel, enabled: !!r.enabled, added_at: r.added_at, added_by: r.added_by, note: r.note ?? null }));
}
export const configuredChannels = (): string[] => channelConfig().filter((c) => c.enabled).map((c) => c.channel);

/** Replace the allowlist. Usernames are validated; removing a channel keeps its stored posts (they are history, not configuration). */
export function setChannelConfig(items: unknown): { ok: true; channels: TgChannelConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length > MAX_CHANNELS) return { ok: false, error: `channels must be an array of at most ${MAX_CHANNELS}` };
  const seen = new Set<string>();
  for (const it of items) {
    const ch = (it as { channel?: unknown })?.channel;
    if (typeof ch !== 'string' || !CHANNEL_RE.test(ch)) return { ok: false, error: `invalid public channel username: ${JSON.stringify(ch)} (5–32 chars, letters/digits/underscore, starting with a letter)` };
    if (seen.has(ch.toLowerCase())) return { ok: false, error: `duplicate channel ${ch}` };
    seen.add(ch.toLowerCase());
    const en = (it as { enabled?: unknown }).enabled;
    if (en !== undefined && typeof en !== 'boolean') return { ok: false, error: `enabled must be boolean for ${ch}` };
  }
  const now = new Date().toISOString();
  const before = channelConfig().map((c) => `${c.channel}${c.enabled ? '' : '(off)'}`).sort().join(', ');
  tx(() => {
    const keep = (items as { channel: string; enabled?: boolean; note?: string }[]);
    db.prepare(`DELETE FROM tg_channel_config WHERE channel NOT IN (${keep.map(() => '?').join(',') || "''"})`).run(...keep.map((k) => k.channel));
    for (const k of keep) db.prepare(`INSERT INTO tg_channel_config (channel, enabled, added_at, added_by, note) VALUES (?,?,?,'user',?)
      ON CONFLICT(channel) DO UPDATE SET enabled = excluded.enabled, note = COALESCE(excluded.note, tg_channel_config.note)`).run(k.channel, k.enabled === false ? 0 : 1, now, typeof k.note === 'string' ? k.note.slice(0, 200) : null);
  });
  bump('telegram');
  const after = channelConfig().map((c) => `${c.channel}${c.enabled ? '' : '(off)'}`).sort().join(', ');
  if (after !== before) recordSourceSetChange('telegram_channels', `${before || 'none'} → ${after || 'none'}`);
  return { ok: true, channels: channelConfig() };
}

// ── durable coverage gaps ──
export interface TgGap { id: number; channel: string; low_id: number; high_id: number; cursor_before: number; opened_at: string; resolved_at: string | null; pages_used: number; recovered_posts: number; last_progress_at: string | null }
export const openGaps = (channel: string): TgGap[] => db.prepare('SELECT * FROM tg_gaps WHERE channel = ? AND resolved_at IS NULL ORDER BY high_id DESC').all(channel) as unknown as TgGap[];

function refreshGapNote(channel: string) {
  const g = openGaps(channel);
  const note = g.length ? g.map((x) => `posts after #${x.low_id} and before #${x.high_id} not yet collected (gap opened ${x.opened_at}: catch-up hit its ${LATEST_PAGE_CAP}-page cap; recovery ${x.pages_used ? `in progress, ${x.pages_used} page(s), ${x.recovered_posts} post(s) recovered so far` : 'pending'})`).join('; ') + ' — posts in between may be missing until recovered' : null;
  db.prepare('UPDATE tg_channels SET gap_note = ? WHERE channel = ?').run(note, channel);
}

/**
 * One bounded run for one channel, in three phases sharing `budgetPages`:
 *  1. latest — newest page backwards until a stored post is reached (≤ LATEST_PAGE_CAP pages). Hitting the cap opens a DURABLE gap
 *     (low = newest stored id, high = oldest id reached, cursor = where to continue).
 *  2. gap recovery — continue each open gap from its cursor; a gap is resolved ONLY when its own walk reaches a post at or below its
 *     low bound (a later newest-page poll touching stored posts never clears it).
 *  3. history — deepen from the oldest stored post toward the horizon (always contiguous with what is stored).
 */
export async function ingestTelegramChannel(channel: string, opts: { backfillDays?: number; budgetPages?: number } = {}): Promise<TgResult> {
  const horizonDays = opts.backfillDays ?? 8;
  const sinceMs = Date.now() - horizonDays * 86400_000;
  let budget = Math.max(1, opts.budgetPages ?? 8);
  const known = db.prepare('SELECT COUNT(*) c, MAX(post_id) maxId, MIN(post_id) minId, MIN(posted_at) oldest FROM tg_posts WHERE channel = ?').get(channel) as { c: number; maxId: number | null; minId: number | null; oldest: string | null };
  let pages = 0, fetched = 0, inserted = 0, oldest: string | null = known.oldest, gapsOpened = 0, gapsResolved = 0;
  const byPhase = { latest: 0, gap: 0, history: 0 };
  const notes: string[] = [];

  /** Walk older pages from `startBefore`; returns why it stopped and the lowest post id it saw. */
  const walk = async (startBefore: number | null, maxPages: number, via: SeenVia, phase: keyof typeof byPhase, stop: (posts: TgPost[]) => string | null) => {
    let before = startBefore, minSeen: number | null = null;
    for (let i = 0; i < maxPages; i++) {
      if (budget <= 0) return { why: 'run budget used', minSeen };
      const html = await fetchText(`${tgBase()}/${encodeURIComponent(channel)}${before ? `?before=${before}` : ''}`, { retries: 2, headers: { accept: 'text/html' } });
      budget--; pages++; byPhase[phase]++;
      const { info, posts, nextBefore } = parseChannelPage(html, channel);
      if (!before) {
        if (!info.title && posts.length === 0) throw new Error('channel page had no channel info and no posts (not public, renamed, or page layout changed)');
        db.prepare(`INSERT INTO tg_channels (channel, title, description, subscribers, counters, fetched_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(channel) DO UPDATE SET title = excluded.title, description = excluded.description, subscribers = excluded.subscribers, counters = excluded.counters, fetched_at = excluded.fetched_at`)
          .run(channel, info.title, info.description, info.subscribers, JSON.stringify(info.counters), new Date().toISOString());
      }
      if (!posts.length) return { why: 'no more posts', minSeen };
      fetched += posts.length;
      const ins = upsertPosts(posts, via).inserted; inserted += ins;
      const pageMin = Math.min(...posts.map((p) => p.post_id));
      minSeen = minSeen === null ? pageMin : Math.min(minSeen, pageMin);
      const pageOldest = posts.reduce((a, p) => (p.posted_at < a ? p.posted_at : a), posts[0].posted_at);
      if (!oldest || pageOldest < oldest) oldest = pageOldest;
      const s = stop(posts); if (s) return { why: s, minSeen, inserted: ins };
      if (!nextBefore) return { why: 'no earlier page', minSeen };
      before = nextBefore;
    }
    return { why: 'page limit', minSeen };
  };

  // Phase 1 — latest.
  const first = known.c === 0;
  const r1 = await walk(null, first ? 1 : Math.min(LATEST_PAGE_CAP, budget), first ? 'backfill' : 'latest', 'latest', (posts) => (known.maxId !== null && Math.min(...posts.map((p) => p.post_id)) <= known.maxId ? 'reached stored posts' : null));
  notes.push('new: ' + r1.why);
  if (!first && known.maxId !== null && r1.minSeen !== null && r1.minSeen > known.maxId + 1 && (r1.why === 'page limit' || r1.why === 'run budget used')) {
    db.prepare('INSERT INTO tg_gaps (channel, low_id, high_id, cursor_before, opened_at) VALUES (?,?,?,?,?)').run(channel, known.maxId, r1.minSeen, r1.minSeen, new Date().toISOString());
    gapsOpened++;
  }

  // Phase 2 — recover open gaps (newest gap first: readers care most about the recent past).
  for (const g of openGaps(channel)) {
    if (budget <= 0) break;
    const pagesBefore = byPhase.gap;
    const r2 = await walk(g.cursor_before, budget, 'gap', 'gap', (posts) => (Math.min(...posts.map((p) => p.post_id)) <= g.low_id ? 'reached the gap\'s lower bound' : null));
    const recovered = (db.prepare("SELECT COUNT(*) c FROM tg_posts WHERE channel = ? AND post_id > ? AND post_id < ? AND seen_via = 'gap'").get(channel, g.low_id, g.high_id) as { c: number }).c;
    const resolved = r2.why === "reached the gap's lower bound" || r2.why === 'no more posts' || r2.why === 'no earlier page';
    db.prepare('UPDATE tg_gaps SET cursor_before = ?, pages_used = pages_used + ?, recovered_posts = ?, last_progress_at = ?, resolved_at = ? WHERE id = ?')
      .run(r2.minSeen ?? g.cursor_before, byPhase.gap - pagesBefore, recovered, new Date().toISOString(), resolved ? new Date().toISOString() : null, g.id);
    if (resolved) gapsResolved++;
    notes.push(`gap #${g.id}: ${r2.why}`);
  }
  refreshGapNote(channel);

  // Phase 3 — history toward the horizon, from the oldest stored post (contiguous by construction).
  const after = db.prepare('SELECT MIN(post_id) minId, MIN(posted_at) oldest FROM tg_posts WHERE channel = ?').get(channel) as { minId: number | null; oldest: string | null };
  if (budget > 0 && after.minId !== null && after.oldest && Date.parse(after.oldest) > sinceMs) {
    notes.push('history: ' + (await walk(after.minId, budget, 'backfill', 'history', () => (oldest && Date.parse(oldest) < sinceMs ? `reached ${horizonDays}-day horizon` : null))).why);
  }
  return { channel, pages, fetched, inserted, oldest, stoppedBecause: notes.join('; '), pages_by_phase: byPhase, gaps_opened: gapsOpened, gaps_resolved: gapsResolved };
}

/** Publication-to-collection delay for posts first collected by the latest poll (not backfill/gap), over the last `hours`. */
export function collectionLag(channel: string | null, hours = 24): { n: number; median_s: number | null; p90_s: number | null; note: string } {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const rows = db.prepare(`SELECT (julianday(first_seen_at) - julianday(posted_at)) * 86400 AS lag FROM tg_posts
    WHERE seen_via = 'latest' AND first_seen_at >= ? ${channel ? 'AND channel = ?' : ''}`).all(...(channel ? [since, channel] : [since])) as { lag: number }[];
  const lags = rows.map((r) => r.lag).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const q = (p: number) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(p * (lags.length - 1) + 0.5))] : null);
  return { n: lags.length, median_s: q(0.5), p90_s: q(0.9), note: 'Measured from the post\'s own timestamp to our first collection; includes the polling interval. Backfilled and gap-recovered posts are excluded.' };
}

export interface TgChannelsOutcome { results: TgResult[]; errors: { channel: string; error: string }[] }

/** Each channel is isolated: one failing channel never stops the others. Per-channel attempt/error state is stored on tg_channels. */
export async function pollChannel(ch: string, budgetPages?: number): Promise<{ ok: true; result: TgResult } | { ok: false; error: string }> {
  const at = new Date().toISOString();
  db.prepare('INSERT INTO tg_runs (channel, started_at) VALUES (?, ?)').run(ch, at);
  try {
    const result = await ingestTelegramChannel(ch, { budgetPages });
    db.prepare('UPDATE tg_channels SET last_attempt_at = ?, last_error = NULL WHERE channel = ?').run(at, ch);
    db.prepare('UPDATE tg_runs SET finished_at = ?, pages_latest = ?, pages_gap = ?, pages_history = ?, inserted = ? WHERE channel = ? AND started_at = ?')
      .run(new Date().toISOString(), result.pages_by_phase.latest, result.pages_by_phase.gap, result.pages_by_phase.history, result.inserted, ch, at);
    return { ok: true, result };
  } catch (e) {
    const error = (e as Error).message;
    db.prepare('INSERT INTO tg_channels (channel, fetched_at, last_attempt_at, last_error) VALUES (?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error').run(ch, at, at, error.slice(0, 300));
    db.prepare('UPDATE tg_runs SET finished_at = ?, error = ? WHERE channel = ? AND started_at = ?').run(new Date().toISOString(), error.slice(0, 300), ch, at);
    return { ok: false, error };
  }
}

export async function ingestTelegramChannels(channels: string[] = configuredChannels(), budgetPages?: number): Promise<TgChannelsOutcome> {
  const out: TgChannelsOutcome = { results: [], errors: [] };
  for (const ch of channels) {
    const r = await pollChannel(ch, budgetPages);
    if (r.ok) out.results.push(r.result); else out.errors.push({ channel: ch, error: r.error });
  }
  return out;
}
