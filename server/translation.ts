// English reading aid for public Arabic news only. Never feeds matching, claims or Telegram processing.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NewsTranslation } from '../shared/translation.ts';

export function translationHash(title: string, excerpt: string) {
  return createHash('sha256').update(JSON.stringify(['ar', 'en', title, excerpt])).digest('hex');
}
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
export async function translateText(text: string, request: typeof fetch = fetch): Promise<string> {
  if (!text.trim()) return '';
  const out: string[] = [];
  for (const segment of translationSegments(text)) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', segment.trim()); url.searchParams.set('langpair', 'ar|en');
    const r = await request(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`English translation unavailable (provider HTTP ${r.status}).`);
    const j = await r.json() as { responseStatus?: number | string; responseData?: { translatedText?: string }; quotaFinished?: boolean };
    const translated = j.responseData?.translatedText;
    if (Number(j.responseStatus) !== 200 || j.quotaFinished || typeof translated !== 'string' || !translated.trim() || /QUERY LENGTH LIMIT|MYMEMORY WARNING|YOU USED ALL AVAILABLE/i.test(translated)) {
      throw new Error('English translation unavailable: provider quota or response error. Try again later.');
    }
    out.push(translated.trim());
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
    if (e.language !== 'ar') throw new Error('English translation is available for Arabic news items only.');
    const hash = translationHash(e.title, e.summary);
    const cached = db.prepare('SELECT payload FROM news_translations WHERE source_hash = ?').get(hash) as { payload: string } | undefined;
    if (cached) return { ...JSON.parse(cached.payload), event_id: eventId };
    if (options.seed) throw new Error('English translation is not cached in this offline snapshot. No network request was made.');
    if (pending.has(hash)) return { ...await pending.get(hash)!, event_id: eventId };
    const task = queue.then(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const chars = [...e.title, ...e.summary].length;
      db.prepare('INSERT OR IGNORE INTO translation_budget(day, characters) VALUES (?, 0)').run(day);
      const reservation = db.prepare('UPDATE translation_budget SET characters = characters + ? WHERE day = ? AND characters + ? <= 4500').run(chars, day, chars);
      if (!reservation.changes) throw new Error('Daily free translation budget reached. Cached English versions remain available; retry tomorrow (UTC).');
      const title = await translateText(e.title, options.request);
      const excerpt = await translateText(e.summary, options.request);
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
  if (!event || event.language !== 'ar') return null;
  const row = db.prepare('SELECT payload FROM news_translations WHERE source_hash = ?').get(translationHash(event.title, event.summary)) as { payload: string } | undefined;
  return row ? { ...JSON.parse(row.payload), event_id: eventId } : null;
}
