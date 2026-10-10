// Typed source references and immutable, prospectively captured versions (W0).
// A reference is the unified feed's stable key; the original rows stay in `events` / `tg_posts`. Versions are captured when an
// item is first referenced by research and re-checked after each collection; nothing earlier than the first capture is invented.
import { createHash } from 'node:crypto';
import { db } from '../db.ts';
import { SOURCE_META } from '../registry.ts';
import { originGroupOf } from '../story.ts';
import type { SourceItemRef, SourceVersion } from '../../shared/research.ts';

type Row = Record<string, any>;
export const REF_RE = /^(web):([a-z0-9-]+):(.{1,2000})$|^(telegram):([A-Za-z][A-Za-z0-9_]{3,31}):(\d{1,12})$/;
export const isRef = (r: unknown): r is string => typeof r === 'string' && REF_RE.test(r);
const srcMeta = SOURCE_META;

/** Resolve a reference to its current original record, or null when it no longer exists (shown as unavailable, never guessed). */
export function resolveRef(ref: string): SourceItemRef | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  if (m[1] === 'web') {
    const r = db.prepare('SELECT * FROM events WHERE source_id = ? AND external_id = ?').get(m[2], m[3]) as Row | undefined;
    if (!r) return null;
    const meta = srcMeta.get(r.source_id);
    return {
      ref, platform: 'web', event_id: r.id, source_id: r.source_id, source_name: r.publisher ? `${r.publisher} (via ${meta?.name ?? r.source_id})` : meta?.name ?? r.source_id,
      title: r.title, text: r.summary, url: r.raw_url, published_at: r.published_at, time_precision: r.time_precision ?? 'instant', collected_at: r.first_seen_at,
      source_modified_at: r.modified_at ?? null, language: r.language, tier: r.tier ?? meta?.tier ?? null, viewpoint_label: null,
      origin_group: originGroupOf(`${r.title}. ${r.summary}`, r.outlet ?? r.source_id, meta?.name ?? ''), place: r.location_name ?? null,
    };
  }
  const r = db.prepare('SELECT * FROM tg_posts WHERE channel = ? AND post_id = ?').get(m[5], Number(m[6])) as Row | undefined;
  if (!r) return null;
  const text = String(r.text ?? '');
  return {
    ref, platform: 'telegram', event_id: null, source_id: `telegram:${r.channel}`, source_name: `@${r.channel}`, title: text.split('\n')[0].slice(0, 160) || '(media or link only)',
    text, url: r.url, published_at: r.posted_at, time_precision: 'instant', collected_at: r.first_seen_at, source_modified_at: r.edited ? 'edited (time not published)' : null,
    language: r.lang, tier: null, viewpoint_label: 'Telegram channel — viewpoint-labelled discovery source', origin_group: r.forwarded_from ? `fwd:${r.forwarded_from}` : `tg:${r.channel}`, place: r.loc_name ?? null,
  };
}

const hashOf = (i: SourceItemRef) => createHash('sha256').update([i.title, i.text, i.url].join('␟')).digest('hex');
const toVersion = (r: Row): SourceVersion => ({
  id: r.id, ref: r.ref, content_hash: r.content_hash, title: r.title, excerpt: r.excerpt, url: r.url, published_at: r.published_at, time_precision: r.time_precision,
  source_modified_at: r.source_modified_at, collected_at: r.collected_at, captured_at: r.captured_at, kind: r.kind,
});
export const latestVersion = (ref: string): SourceVersion | null => { const r = db.prepare('SELECT * FROM source_item_versions WHERE ref = ? ORDER BY id DESC LIMIT 1').get(ref) as Row | undefined; return r ? toVersion(r) : null; };
export const versionsOf = (ref: string): SourceVersion[] => (db.prepare('SELECT * FROM source_item_versions WHERE ref = ? ORDER BY id').all(ref) as Row[]).map(toVersion);
export const versionById = (id: number): SourceVersion | null => { const r = db.prepare('SELECT * FROM source_item_versions WHERE id = ?').get(id) as Row | undefined; return r ? toVersion(r) : null; };

/**
 * Capture the current state of a referenced item. Returns the latest version (new or unchanged).
 *  first_capture — first time research references it; publisher_revision — content changed and the source reports a modification;
 *  content_changed — content changed without a source-reported modification (a local observation, not a declared correction);
 *  unavailable — the record is gone from our store (NOT a confirmed retraction); restored — it came back.
 */
export function captureVersion(ref: string, now = new Date().toISOString()): SourceVersion | null {
  const cur = resolveRef(ref), last = latestVersion(ref);
  if (!cur) {
    if (!last || last.kind === 'unavailable') return last;
    db.prepare("INSERT INTO source_item_versions (ref, content_hash, captured_at, kind) VALUES (?, ?, ?, 'unavailable')").run(ref, last.content_hash, now);
    return latestVersion(ref);
  }
  const h = hashOf(cur);
  if (last && last.kind !== 'unavailable' && last.content_hash === h) return last;
  const kind = !last ? 'first_capture' : last.kind === 'unavailable' && last.content_hash === h ? 'restored'
    : cur.source_modified_at && cur.source_modified_at !== last.source_modified_at ? 'publisher_revision' : 'content_changed';
  db.prepare(`INSERT INTO source_item_versions (ref, content_hash, title, excerpt, url, published_at, time_precision, source_modified_at, collected_at, captured_at, kind)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(ref, h, cur.title, cur.text.slice(0, 600), cur.url, cur.published_at, cur.time_precision, cur.source_modified_at, cur.collected_at, now, kind);
  return latestVersion(ref);
}

/** Every reference research currently depends on (re-checked after each collection run; bounded by what the user attached). */
export function attachedRefs(): string[] {
  return (db.prepare(`SELECT source_ref r FROM dossier_items WHERE detached_at IS NULL UNION SELECT source_ref FROM claims
    UNION SELECT source_ref FROM claim_evidence WHERE removed_at IS NULL UNION SELECT ref FROM hypothesis_evidence WHERE removed_at IS NULL AND ref NOT LIKE 'claim:%'`).all() as { r: string }[]).map((x) => x.r);
}
export function recaptureAttached(): { checked: number; changed: number } {
  let changed = 0;
  const refs = attachedRefs();
  for (const r of refs) { const before = latestVersion(r)?.id; const after = captureVersion(r)?.id; if (after !== before) changed++; }
  return { checked: refs.length, changed };
}

export function audit(entity: string, id: string, action: string, before: unknown, after: unknown, actor = 'me') {
  db.prepare('INSERT INTO research_audit (at, actor, entity, entity_id, action, before, after) VALUES (?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), actor, entity, id, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
}
export const auditOf = (entity: string, id: string) => (db.prepare('SELECT at, actor, action, before, after FROM research_audit WHERE entity = ? AND entity_id = ? ORDER BY id').all(entity, id) as Row[])
  .map((r) => ({ at: r.at, actor: r.actor, action: r.action, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null }));

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
/** Plain-text research input: trimmed, bounded, never interpreted as markup (React escapes on render). */
export function text(v: unknown, field: string, max: number, required = true): string | null | { error: string } {
  if (v === undefined || v === null || v === '') return required ? { error: `${field} is required` } : null;
  if (typeof v !== 'string') return { error: `${field} must be text` };
  const t = v.trim();
  if (required && !t) return { error: `${field} is required` };
  if (t.length > max) return { error: `${field} must be at most ${max} characters` };
  return t || null;
}
