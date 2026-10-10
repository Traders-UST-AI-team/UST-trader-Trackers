// K1 — vessel watchlist and identity model. IMO is the durable identity when known; MMSI is a radio identity that can change;
// names are not unique. Identifiers carry their source and validity period and are never invented. Two records are never merged
// on a name; an IMO/MMSI already held by another record is a conflict to resolve by hand. Source-reported type/cargo/owner stay
// separate from reviewed company relationships. News is linked to a vessel only on explicit identifying evidence: an IMO or MMSI
// in the text is proposed for review; a name match alone stays "unresolved".
import { db, tx } from '../db.ts';
import { audit, newId, text } from '../research/refs.ts';
import type { Result } from '../research/claims.ts';
import type { VesselView } from '../../shared/maritime.ts';
export type { VesselView };

type Row = Record<string, any>;
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
export const ID_KINDS = ['imo', 'mmsi', 'name', 'callsign', 'flag'] as const;
export const ATTRS = ['ship_type_reported', 'cargo_reported', 'owner_reported', 'operator_reported', 'dwt_reported'] as const;

/** IMO ship number: 7 digits whose last digit is (Σ digit_i × (7 − i), i = 0..5) mod 10. */
export function validImo(v: string): boolean {
  if (!/^\d{7}$/.test(v)) return false;
  const s = [...v.slice(0, 6)].reduce((a, d, i) => a + Number(d) * (7 - i), 0);
  return s % 10 === Number(v[6]);
}
/** Ship-station MMSI: 9 digits beginning with a maritime identification digit 2–7. */
export const validMmsi = (v: string) => /^[2-7]\d{8}$/.test(v);

function checkIdentifier(kind: string, value: string): string | null {
  if (!ID_KINDS.includes(kind as never)) return `kind must be one of ${ID_KINDS.join(', ')}`;
  if (kind === 'imo' && !validImo(value)) return 'IMO must be 7 digits with a valid check digit';
  if (kind === 'mmsi' && !validMmsi(value)) return 'MMSI must be 9 digits starting with 2–7';
  if (kind === 'name' && (value.length < 2 || value.length > 100)) return 'name must be 2–100 characters';
  return null;
}
const urlOk = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/\S+$/.test(u) && u.length <= 1000;

export function addIdentifier(vesselId: string, input: Record<string, unknown>): Result<VesselView> {
  if (!db.prepare('SELECT 1 FROM vessels WHERE id = ?').get(vesselId)) return fail(404, 'unknown vessel');
  const kind = String(input.kind ?? ''), value = String(input.value ?? '').trim().toUpperCase() === '' ? '' : String(input.value).trim();
  const err = checkIdentifier(kind, kind === 'name' ? value : value.replace(/\s/g, ''));
  if (err) return fail(400, err);
  if (!urlOk(input.source_url)) return fail(400, 'source_url (http/https) is required: identifiers are never recorded without their source');
  const v = kind === 'name' ? value : value.replace(/\s/g, '');
  if (kind === 'imo' || kind === 'mmsi') {
    const other = db.prepare('SELECT vessel_id FROM vessel_identifiers WHERE kind = ? AND value = ? AND vessel_id != ? AND valid_to IS NULL').get(kind, v, vesselId) as Row | undefined;
    if (other) return fail(409, `${kind.toUpperCase()} ${v} is already recorded for another vessel (${other.vessel_id}); records are never merged automatically`);
  }
  if (kind === 'imo' && db.prepare("SELECT 1 FROM vessel_identifiers WHERE vessel_id = ? AND kind = 'imo' AND value != ? AND valid_to IS NULL").get(vesselId, v))
    return fail(409, 'this vessel already has a different current IMO number — an IMO is permanent; check whether this is a different ship');
  const note = text(input.source_note, 'source_note', 300, false);
  if (note && typeof note === 'object') return fail(400, note.error);
  const vf = typeof input.valid_from === 'string' && Number.isFinite(Date.parse(input.valid_from)) ? input.valid_from : null;
  const vt = typeof input.valid_to === 'string' && Number.isFinite(Date.parse(input.valid_to)) ? input.valid_to : null;
  const now = new Date().toISOString();
  tx(() => {
    if (kind === 'mmsi' || kind === 'name' || kind === 'callsign' || kind === 'flag') // a new current value closes the previous one (history kept)
      if (!vt) db.prepare('UPDATE vessel_identifiers SET valid_to = ? WHERE vessel_id = ? AND kind = ? AND valid_to IS NULL AND value != ?').run(vf ?? now, vesselId, kind, v);
    db.prepare('INSERT INTO vessel_identifiers (id, vessel_id, kind, value, valid_from, valid_to, source_url, source_note, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(newId('vi'), vesselId, kind, v, vf, vt, input.source_url as string, (note as string | null) ?? null, now);
    db.prepare('UPDATE vessels SET updated_at = ?, version = version + 1 WHERE id = ?').run(now, vesselId);
  });
  audit('vessel', vesselId, 'identifier', undefined, { kind, value: v, source_url: input.source_url });
  return { ok: true, value: vesselView(vesselId)! };
}

export function createVessel(input: Record<string, unknown>): Result<VesselView> {
  const name = text(input.name, 'name', 100);
  if (typeof name !== 'string') return fail(400, 'name is required');
  if (!urlOk(input.source_url)) return fail(400, 'source_url is required for the identity you are recording');
  for (const k of ['imo', 'mmsi'] as const) if (input[k] !== undefined && input[k] !== '' && checkIdentifier(k, String(input[k]).replace(/\s/g, ''))) return fail(400, checkIdentifier(k, String(input[k]).replace(/\s/g, ''))!);
  const id = newId('vs'), now = new Date().toISOString();
  db.prepare('INSERT INTO vessels (id, display_name, notes, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, name, typeof input.notes === 'string' ? input.notes.slice(0, 1000) : '', now, now);
  const r = addIdentifier(id, { kind: 'name', value: name, source_url: input.source_url, source_note: input.source_note });
  for (const k of ['imo', 'mmsi'] as const) if (input[k]) {
    const x = addIdentifier(id, { kind: k, value: String(input[k]), source_url: input.source_url, source_note: input.source_note });
    if (!x.ok) { db.prepare('DELETE FROM vessel_identifiers WHERE vessel_id = ?').run(id); db.prepare('DELETE FROM vessels WHERE id = ?').run(id); return x; }
  }
  audit('vessel', id, 'create', undefined, { name, imo: input.imo ?? null, mmsi: input.mmsi ?? null });
  return r.ok ? { ok: true, value: vesselView(id)! } : r;
}

export function addAttribute(vesselId: string, input: Record<string, unknown>): Result<VesselView> {
  if (!db.prepare('SELECT 1 FROM vessels WHERE id = ?').get(vesselId)) return fail(404, 'unknown vessel');
  if (!ATTRS.includes(input.attr as never)) return fail(400, `attr must be one of ${ATTRS.join(', ')} (source-reported values; reviewed company relationships live with the assets)`);
  const v = text(input.value, 'value', 200);
  if (typeof v !== 'string') return fail(400, 'value is required');
  if (!urlOk(input.source_url)) return fail(400, 'source_url is required');
  db.prepare('INSERT INTO vessel_attributes (id, vessel_id, attr, value, source_url, as_of, recorded_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('va'), vesselId, input.attr as string, v, input.source_url, typeof input.as_of === 'string' ? input.as_of : null, new Date().toISOString());
  audit('vessel', vesselId, 'attribute', undefined, { attr: input.attr, value: v, source_url: input.source_url });
  return { ok: true, value: vesselView(vesselId)! };
}

/** Propose links from collected news: IMO/MMSI in the text → 'proposed'; the vessel's current name in the text → 'unresolved'. */
export function scanMentions(sinceDays = 30): { proposed: number; unresolved: number } {
  const since = new Date(Date.now() - sinceDays * 86400e3).toISOString();
  const ids = db.prepare("SELECT vessel_id, kind, value FROM vessel_identifiers WHERE valid_to IS NULL AND kind IN ('imo', 'mmsi', 'name')").all() as Row[];
  if (!ids.length) return { proposed: 0, unresolved: 0 };
  const evs = db.prepare('SELECT source_id, external_id, title, summary FROM events WHERE published_at >= ?').all(since) as Row[];
  let proposed = 0, unresolved = 0;
  const ins = db.prepare("INSERT OR IGNORE INTO vessel_mentions (id, vessel_id, source_ref, basis, evidence, status, created_at) VALUES (?,?,?,?,?,?,?)");
  for (const e of evs) {
    const t = `${e.title}. ${e.summary}`;
    for (const i of ids) {
      let m: RegExpExecArray | null = null, basis = '';
      if (i.kind === 'imo') { m = new RegExp(`\\bIMO(?:\\s*(?:No\\.?|number|:))?\\s*${i.value}\\b`, 'i').exec(t); basis = 'imo_in_text'; }
      else if (i.kind === 'mmsi') { m = new RegExp(`\\bMMSI(?:\\s*(?:No\\.?|number|:))?\\s*${i.value}\\b`, 'i').exec(t); basis = 'mmsi_in_text'; }
      else if (i.value.length >= 4) { m = new RegExp(`\\b${i.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(t); basis = 'name_in_text'; }
      if (!m) continue;
      const s = Math.max(0, m.index - 60), ev = t.slice(s, m.index + m[0].length + 60);
      const r = ins.run(newId('vm'), i.vessel_id, `web:${e.source_id}:${e.external_id}`, basis, ev, basis === 'name_in_text' ? 'unresolved' : 'proposed', new Date().toISOString());
      if (Number(r.changes)) { if (basis === 'name_in_text') unresolved++; else proposed++; }
    }
  }
  return { proposed, unresolved };
}

export function reviewMention(id: string, input: Record<string, unknown>): Result<VesselView> {
  const m = db.prepare('SELECT * FROM vessel_mentions WHERE id = ?').get(id) as Row | undefined;
  if (!m) return fail(404, 'unknown mention');
  if (!['accepted', 'rejected', 'unresolved'].includes(input.status as string)) return fail(400, 'status must be accepted, rejected or unresolved');
  const reviewer = text(input.reviewer, 'reviewer', 100), note = text(input.note, 'note', 500);
  if (typeof reviewer !== 'string') return fail(400, 'reviewer is required');
  if (input.status === 'accepted' && m.basis === 'name_in_text' && typeof note !== 'string') return fail(400, 'accepting a name-only match needs a note with the identifying evidence (names are not unique)');
  db.prepare('UPDATE vessel_mentions SET status = ?, reviewer = ?, reviewed_at = ?, note = ? WHERE id = ?').run(input.status as string, reviewer, new Date().toISOString(), typeof note === 'string' ? note : null, id);
  audit('vessel', m.vessel_id, 'mention_review', { status: m.status }, { status: input.status, reviewer, note });
  return { ok: true, value: vesselView(m.vessel_id)! };
}

export function vesselView(id: string): VesselView | null {
  const v = db.prepare('SELECT * FROM vessels WHERE id = ?').get(id) as Row | undefined;
  if (!v) return null;
  const identifiers = (db.prepare('SELECT kind, value, valid_from, valid_to, source_url, source_note, recorded_at FROM vessel_identifiers WHERE vessel_id = ? ORDER BY recorded_at').all(id) as Row[]).map((r) => ({ ...r })) as VesselView['identifiers'];
  const current: Record<string, string | null> = { imo: null, mmsi: null, name: null, callsign: null, flag: null };
  for (const i of identifiers) if (!i.valid_to) current[i.kind] = i.value;
  return {
    id, display_name: v.display_name, notes: v.notes, watched: !!v.watched, created_at: v.created_at, version: v.version, current, identifiers,
    attributes: (db.prepare('SELECT attr, value, source_url, as_of, recorded_at FROM vessel_attributes WHERE vessel_id = ? ORDER BY recorded_at').all(id) as Row[]).map((r) => ({ ...r })) as VesselView['attributes'],
    mentions: (db.prepare('SELECT id, source_ref, basis, evidence, status, reviewer, reviewed_at, note FROM vessel_mentions WHERE vessel_id = ? ORDER BY created_at DESC LIMIT 50').all(id) as Row[]).map((r) => ({ ...r })) as VesselView['mentions'],
    position: { status: 'unavailable', reason: 'No authorized AIS feed is configured (K2 gated); positions and tracks are not shown and never interpolated.' },
  };
}
export const listVessels = (): VesselView[] => (db.prepare('SELECT id FROM vessels ORDER BY display_name').all() as Row[]).map((r) => vesselView(r.id)!);
