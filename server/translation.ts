// English reading aid for public Arabic and Persian news only. Never feeds matching, claims or Telegram processing.
// Machine translation (MyMemory free tier, ~5,000 characters per day without an account): headlines are translated automatically in the
// background, newest and linked-to-a-contract first, until the day's budget is used; the rest stay in their original language, labelled.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NewsTranslation } from '../shared/translation.ts';
import { registerJob } from './scheduler.ts';

export type SourceLang = 'ar' | 'fa';
export const translatable = (language: string | null | undefined): language is SourceLang => language === 'ar' || language === 'fa';
const DAILY_CHARS = 4500;

export function translationHash(title: string, excerpt: string, lang: SourceLang = 'ar') {
  return createHash('sha256').update(JSON.stringify([lang, 'en', title, excerpt])).digest('hex');
}
/** Headline-only translations are cached under their own key so the background job never pays for a summary nobody opened. */
export const headlineHash = (title: string, lang: SourceLang) => createHash('sha256').update(JSON.stringify(['headline', lang, 'en', title])).digest('hex');
/** Provider segments are limited to 500 UTF-8 bytes; keep words together where possible. */
export function translationSegments(text: string): string[] {
  const out: string[] = []; let part = '';
  for (const token of text.match(/\S+\s*|\s+/gu) ?? []) {
    if (Buffer.byteLength(part + token) <= 480) { part += token; continue; }
    if (part) { out.push(part); part = ''; }
    for (const c of token) {
      if (Buffer.byteLength(part + c) > 480) { out.push(part); part = ''; }
      part += c;
    }
  }
  if (part) out.push(part);
  return out;
}
/** MyMemory returns HTML-escaped text (&#39; &quot; …); decode what it escapes so headlines read normally. */
export function decodeEntities(t: string): string {
  return t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
export async function translateText(text: string, request: typeof fetch = fetch, lang: SourceLang = 'ar'): Promise<string> {
  if (!text.trim()) return '';
  const out: string[] = [];
  for (const segment of translationSegments(text)) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', segment.trim()); url.searchParams.set('langpair', `${lang}|en`);
    const r = await request(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`English translation unavailable (provider HTTP ${r.status}).`);
    const j = await r.json() as { responseStatus?: number | string; responseData?: { translatedText?: string }; quotaFinished?: boolean };
    const translated = j.responseData?.translatedText;
    if (Number(j.responseStatus) !== 200 || j.quotaFinished || typeof translated !== 'string' || !translated.trim() || /QUERY LENGTH LIMIT|MYMEMORY WARNING|YOU USED ALL AVAILABLE/i.test(translated)) {
      throw new Error('English translation unavailable: provider quota or response error. Try again later.');
    }
    out.push(decodeEntities(translated.trim()));
  }
  return out.join(' ');
}
export function createNewsTranslator(db: DatabaseSync, options: { seed: boolean; request?: typeof fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_translations (source_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_budget (day TEXT PRIMARY KEY, characters INTEGER NOT NULL DEFAULT 0);`);
  // Serialize and deduplicate requests; reserve budget before network I/O, including unsuccessful attempts.
  let queue = Promise.resolve();
  const pending = new Map<string, Promise<NewsTranslation>>();
  return async (eventId: string): Promise<NewsTranslation> => {
    const e = db.prepare('SELECT title, summary, language FROM events WHERE id = ?').get(eventId) as { title: string; summary: string; language: string } | undefined;
    if (!e) throw new Error('Unknown news item.');
    if (!translatable(e.language)) throw new Error('English translation is available for Arabic and Persian news items only.');
    const lang = e.language;
    const hash = translationHash(e.title, e.summary, lang);
    const cached = db.prepare('SELECT payload FROM news_translations WHERE source_hash = ?').get(hash) as { payload: string } | undefined;
    if (cached) return { ...JSON.parse(cached.payload), event_id: eventId };
    if (options.seed) throw new Error('English translation is not cached in this offline snapshot. No network request was made.');
    if (pending.has(hash)) return { ...await pending.get(hash)!, event_id: eventId };
    const task = queue.then(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const chars = [...e.title, ...e.summary].length;
      db.prepare('INSERT OR IGNORE INTO translation_budget(day, characters) VALUES (?, 0)').run(day);
      const reservation = db.prepare('UPDATE translation_budget SET characters = characters + ? WHERE day = ? AND characters + ? <= ?').run(chars, day, chars, DAILY_CHARS);
      if (!reservation.changes) throw new Error('Daily free translation budget reached. Cached English versions remain available; retry tomorrow (UTC).');
      const title = await translateText(e.title, options.request, lang);
      const excerpt = await translateText(e.summary, options.request, lang);
      const value: NewsTranslation = { event_id: eventId, title, excerpt, provider: 'MyMemory', translated_at: new Date().toISOString(), source_hash: hash, machine_translated: true };
      db.prepare('INSERT OR REPLACE INTO news_translations VALUES (?, ?)').run(hash, JSON.stringify(value));
      return value;
    });
    queue = task.then(() => {}, () => {}); pending.set(hash, task);
    try { return await task; } finally { pending.delete(hash); }
  };
}

/** Read-through cache only: this path never reserves quota or contacts a provider. */
export function cachedNewsTranslation(db: DatabaseSync, eventId: string): NewsTranslation | null {
  const event = db.prepare('SELECT title, summary, language FROM events WHERE id = ?').get(eventId) as { title: string; summary: string; language: string } | undefined;
  if (!event || !translatable(event.language)) return null;
  const row = db.prepare('SELECT payload FROM news_translations WHERE source_hash = ?').get(translationHash(event.title, event.summary, event.language)) as { payload: string } | undefined;
  return row ? { ...JSON.parse(row.payload), event_id: eventId } : null;
}


// ───────────── headline translation for the news list ─────────────

/** Translates one headline (title only). Reserves budget before any network call, serialises requests and never runs in seed mode. */
export function createHeadlineTranslator(db: DatabaseSync, options: { seed: boolean; request?: typeof fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_translations (source_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_budget (day TEXT PRIMARY KEY, characters INTEGER NOT NULL DEFAULT 0);`);
  let queue = Promise.resolve();
  return async (eventId: string): Promise<string | null> => {
    const e = db.prepare('SELECT title, language FROM events WHERE id = ?').get(eventId) as { title: string; language: string } | undefined;
    if (!e || !translatable(e.language)) return null;
    const hash = headlineHash(e.title, e.language);
    const cached = db.prepare('SELECT payload FROM news_translations WHERE source_hash = ?').get(hash) as { payload: string } | undefined;
    if (cached) return decodeEntities((JSON.parse(cached.payload) as { title: string }).title);
    if (options.seed) return null;
    const lang = e.language;
    const task = queue.then(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const chars = [...e.title].length;
      db.prepare('INSERT OR IGNORE INTO translation_budget(day, characters) VALUES (?, 0)').run(day);
      const reservation = db.prepare('UPDATE translation_budget SET characters = characters + ? WHERE day = ? AND characters + ? <= ?').run(chars, day, chars, DAILY_CHARS);
      if (!reservation.changes) throw new Error('Daily free translation budget reached.');
      const title = await translateText(e.title, options.request, lang);
      db.prepare('INSERT OR REPLACE INTO news_translations VALUES (?, ?)').run(hash, JSON.stringify({ kind: 'headline', title, provider: 'MyMemory', translated_at: new Date().toISOString(), machine_translated: true }));
      return title;
    });
    queue = task.then(() => {}, () => {});
    return task;
  };
}

/** English headlines already cached (headline-only or full translation). Reads only; costs no quota. */
export function cachedHeadlines(db: DatabaseSync, rows: { id: string; title: string; summary: string; language: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  db.exec('CREATE TABLE IF NOT EXISTS news_translations (source_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);');
  const want = rows.filter((r) => translatable(r.language));
  if (!want.length) return out;
  const keys = new Map<string, string[]>();   // hash → event ids
  const add = (h: string, id: string) => (keys.get(h) ?? keys.set(h, []).get(h)!).push(id);
  for (const r of want) { add(headlineHash(r.title, r.language as SourceLang), r.id); add(translationHash(r.title, r.summary, r.language as SourceLang), r.id); }
  const hashes = [...keys.keys()];
  for (let i = 0; i < hashes.length; i += 400) {
    const part = hashes.slice(i, i + 400);
    for (const row of db.prepare(`SELECT source_hash, payload FROM news_translations WHERE source_hash IN (${part.map(() => '?').join(',')})`).all(...part) as { source_hash: string; payload: string }[]) {
      const raw = (JSON.parse(row.payload) as { title?: string }).title;
      const title = raw === undefined ? undefined : decodeEntities(raw);   // older cached rows may still carry escapes
      if (title) for (const id of keys.get(row.source_hash) ?? []) out.set(id, title);
    }
  }
  return out;
}

/** Picks the next untranslated Arabic/Persian headlines: items linked to a contract first, then newest. */
export function untranslatedHeadlineIds(db: DatabaseSync, limit: number, now = Date.now()): string[] {
  const since = new Date(now - 72 * 3600e3).toISOString();
  const rows = db.prepare(`SELECT e.id, e.title, e.summary, e.language, e.published_at, (SELECT COUNT(*) FROM event_market_links l WHERE l.event_id = e.id) AS links
    FROM events e WHERE e.relevant = 1 AND e.language IN ('ar','fa') AND e.published_at >= ? ORDER BY links > 0 DESC, e.published_at DESC LIMIT 300`).all(since) as { id: string; title: string; summary: string; language: string }[];
  const have = cachedHeadlines(db, rows);
  return rows.filter((r) => !have.has(r.id)).slice(0, limit).map((r) => r.id);
}

export function registerHeadlineJob(db: DatabaseSync, options: { seed: boolean; request?: typeof fetch }) {
  const translate = createHeadlineTranslator(db, options);
  registerJob({
    id: 'headline-translation', maxRunMs: 120_000,
    run: async () => {
      if (options.seed) return null;
      let done = 0;
      for (const id of untranslatedHeadlineIds(db, 4)) {
        try { if (await translate(id)) done++; } catch { break; }   // budget or provider error: stop until the next tick
      }
      return done ? `translated ${done} headline(s)` : null;
    },
  });
  return translate;
}
