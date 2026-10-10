// W4 — contract deadlines and known events. Provider end dates keep the provider's meaning ("provider end date": not verified as
// a trading cutoff or a resolution time; resolution may be later and is unknown here). Manual entries carry a source URL, an
// explicit IANA zone and their precision; a date-only entry stays a whole local day, never an invented midnight deadline.
// Changes are kept as revisions with the time they were first seen.
import { db, tx } from '../db.ts';
import type { CalendarEntryView, CalendarStatus } from '../../shared/research.ts';
import { audit, newId, text } from './refs.ts';
import type { Result } from './claims.ts';

type Row = Record<string, any>;
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
export const DEFAULT_TZ = 'Asia/Hong_Kong';
const STATUSES: CalendarStatus[] = ['scheduled', 'revised', 'postponed', 'cancelled', 'unknown', 'closed'];
export const PROVIDER_BASIS: Record<string, string> = {
  polymarket: 'Polymarket Gamma `endDate` — provider end date; not verified as the trading cutoff or the resolution time',
  kalshi: 'Kalshi `close_time` (or `expected_expiration_time` when absent) — provider close; settlement can follow later',
};

export function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
/** Offset (ms) of `tz` at the UTC instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** UTC instant of a wall-clock time in `tz` (handles DST: the offset is re-evaluated at the candidate instant). */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return t;
}
/** A date-only entry is the whole local day [00:00, next day 00:00) in its zone. */
export function dayInterval(dateLocal: string, tz: string): { start: string; end: string } {
  const [y, m, d] = dateLocal.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: new Date(zonedToUtc(dateLocal, '00:00', tz)).toISOString(), end: new Date(zonedToUtc(next, '00:00', tz)).toISOString() };
}

function revise(id: string, field: string, before: string | null, after: string | null, basis: string, at: string) {
  db.prepare('INSERT INTO calendar_revisions (entry_id, at, field, before, after, basis) VALUES (?,?,?,?,?,?)').run(id, at, field, before, after, basis);
}

/** Mirror provider end dates (idempotent). A changed date is a revision; a closed market is 'closed'; one no longer returned is 'unknown'. */
export function syncProviderDates(now = new Date().toISOString()): { added: number; revised: number; closed: number } {
  let added = 0, revised = 0, closed = 0;
  tx(() => {
    const markets = db.prepare('SELECT condition_id, venue, question, end_date, is_open, url, event_slug FROM markets WHERE end_date IS NOT NULL').all() as Row[];
    const seen = new Set<string>();
    for (const m of markets) {
      const id = `pe:${m.condition_id}`; seen.add(id);
      const cur = db.prepare('SELECT * FROM calendar_entries WHERE id = ?').get(id) as Row | undefined;
      const start = new Date(m.end_date).toISOString(), status: CalendarStatus = m.is_open ? 'scheduled' : 'closed';
      const url = m.url ?? (m.venue === 'polymarket' ? `https://polymarket.com/event/${m.event_slug}` : null);
      if (!cur) {
        db.prepare(`INSERT INTO calendar_entries (id, kind, condition_id, title, start_utc, date_local, time_precision, tz, basis, source_url, status, first_known_at, updated_at)
          VALUES (?, 'provider_end_date', ?, ?, ?, NULL, 'instant', 'UTC', ?, ?, ?, ?, ?)`).run(id, m.condition_id, m.question, start, PROVIDER_BASIS[m.venue] ?? 'provider end date', url, status, now, now);
        added++; continue;
      }
      if (cur.start_utc !== start) { revise(id, 'start_utc', cur.start_utc, start, 'provider changed its end date', now); revised++; }
      const nextStatus: CalendarStatus = !m.is_open ? 'closed' : cur.start_utc !== start ? 'revised' : cur.status === 'unknown' ? 'scheduled' : cur.status;
      if (nextStatus !== cur.status) { revise(id, 'status', cur.status, nextStatus, !m.is_open ? 'market closed at the provider' : 'provider data', now); if (nextStatus === 'closed') closed++; }
      if (cur.start_utc !== start || nextStatus !== cur.status || cur.title !== m.question)
        db.prepare('UPDATE calendar_entries SET start_utc = ?, status = ?, title = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(start, nextStatus, m.question, now, id);
    }
    for (const r of db.prepare("SELECT id, status FROM calendar_entries WHERE kind = 'provider_end_date' AND status NOT IN ('unknown', 'closed')").all() as Row[]) {
      if (seen.has(r.id)) continue;
      revise(r.id, 'status', r.status, 'unknown', 'contract no longer returned by the provider', now);
      db.prepare("UPDATE calendar_entries SET status = 'unknown', updated_at = ?, version = version + 1 WHERE id = ?").run(now, r.id);
    }
  });
  return { added, revised, closed };
}

/** Manual entry: `date` (YYYY-MM-DD) with optional `time` (HH:MM) in `tz`; without a time it is date-only. A source URL is required. */
export function createEntry(input: Record<string, unknown>): Result<CalendarEntryView> {
  const title = text(input.title, 'title', 200);
  if (typeof title !== 'string') return fail(400, 'title is required');
  const tz = input.tz ?? DEFAULT_TZ;
  if (!validZone(tz)) return fail(400, 'tz must be an IANA time-zone name such as Asia/Hong_Kong or America/New_York');
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date))) return fail(400, 'date must be YYYY-MM-DD');
  if (input.time !== undefined && input.time !== null && input.time !== '' && (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))) return fail(400, 'time must be HH:MM (24 h) or omitted for a date-only entry');
  if (typeof input.source_url !== 'string' || !/^https?:\/\/\S+$/.test(input.source_url) || input.source_url.length > 1000) return fail(400, 'source_url (http/https) is required: where this date was announced');
  const notes = text(input.notes, 'notes', 2000, false);
  if (notes && typeof notes === 'object') return fail(400, notes.error);
  const hasTime = typeof input.time === 'string' && input.time !== '';
  const id = newId('ce'), now = new Date().toISOString();
  const start = hasTime ? new Date(zonedToUtc(input.date, input.time as string, tz)).toISOString() : null;
  db.prepare(`INSERT INTO calendar_entries (id, kind, condition_id, title, start_utc, date_local, time_precision, tz, basis, source_url, status, first_known_at, updated_at, notes)
    VALUES (?, 'manual', NULL, ?, ?, ?, ?, ?, 'manual entry from the linked source', ?, 'scheduled', ?, ?, ?)`).run(id, title, start, hasTime ? null : input.date, hasTime ? 'instant' : 'date', tz, input.source_url, now, now, (notes as string | null) ?? '');
  audit('calendar', id, 'create', undefined, { title, date: input.date, time: input.time ?? null, tz, source_url: input.source_url });
  return { ok: true, value: entryView(id)! };
}

export function updateEntry(id: string, input: Record<string, unknown>): Result<CalendarEntryView> {
  const cur = db.prepare('SELECT * FROM calendar_entries WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return fail(404, 'unknown entry');
  if (cur.kind !== 'manual') return fail(400, 'provider end dates mirror the provider and cannot be edited here');
  if (input.expected_version !== cur.version) return fail(409, `edit conflict: the entry is at version ${cur.version}`);
  if (input.status !== undefined && !STATUSES.includes(input.status as CalendarStatus)) return fail(400, `status must be one of ${STATUSES.join(', ')}`);
  const basis = text(input.basis, 'basis', 500);
  if (typeof basis !== 'string') return fail(400, 'basis is required: why the entry changed (e.g. "postponement announced at <url>")');
  const now = new Date().toISOString();
  let start = cur.start_utc, dateLocal = cur.date_local, precision = cur.time_precision;
  if (input.date !== undefined) {
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail(400, 'date must be YYYY-MM-DD');
    const hasTime = typeof input.time === 'string' && input.time !== '';
    if (hasTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time as string)) return fail(400, 'time must be HH:MM');
    start = hasTime ? new Date(zonedToUtc(input.date, input.time as string, cur.tz)).toISOString() : null;
    dateLocal = hasTime ? null : input.date; precision = hasTime ? 'instant' : 'date';
  }
  const status = (input.status as string | undefined) ?? (input.date !== undefined ? 'revised' : cur.status);
  tx(() => {
    if (start !== cur.start_utc) revise(id, 'start_utc', cur.start_utc, start, basis, now);
    if (dateLocal !== cur.date_local) revise(id, 'date_local', cur.date_local, dateLocal, basis, now);
    if (status !== cur.status) revise(id, 'status', cur.status, status, basis, now);
    db.prepare('UPDATE calendar_entries SET start_utc = ?, date_local = ?, time_precision = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(start, dateLocal, precision, status, now, id);
  });
  audit('calendar', id, 'update', { start_utc: cur.start_utc, date_local: cur.date_local, status: cur.status }, { start_utc: start, date_local: dateLocal, status, basis });
  return { ok: true, value: entryView(id)! };
}

export function entryView(id: string): CalendarEntryView | null {
  const r = db.prepare('SELECT c.*, m.venue FROM calendar_entries c LEFT JOIN markets m ON m.condition_id = c.condition_id WHERE c.id = ?').get(id) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id, kind: r.kind, condition_id: r.condition_id, venue: r.venue ?? null, title: r.title, start_utc: r.start_utc, date_local: r.date_local, time_precision: r.time_precision, tz: r.tz,
    basis: r.basis, source_url: r.source_url, status: r.status, first_known_at: r.first_known_at, updated_at: r.updated_at, notes: r.notes, version: r.version,
    revisions: (db.prepare('SELECT at, field, before, after, basis FROM calendar_revisions WHERE entry_id = ? ORDER BY id').all(id) as Row[]).map((x) => ({ at: x.at, field: x.field, before: x.before, after: x.after, basis: x.basis })),
  };
}

/** Entries overlapping [from, to). Date-only entries are compared as whole local days in their own zone. */
export function listEntries(fromIso: string, toIso: string, opts: { includeClosed?: boolean } = {}): CalendarEntryView[] {
  const rows = db.prepare(`SELECT id, start_utc, date_local, tz FROM calendar_entries ${opts.includeClosed ? '' : "WHERE status NOT IN ('closed')"}`).all() as Row[];
  const hits = rows.filter((r) => {
    if (r.start_utc) return r.start_utc >= fromIso && r.start_utc < toIso;
    if (r.date_local) { const iv = dayInterval(r.date_local, r.tz); return iv.end > fromIso && iv.start < toIso; }
    return false;
  });
  const key = (e: CalendarEntryView) => e.start_utc ?? (e.date_local ? dayInterval(e.date_local, e.tz).start : '');
  return hits.map((r) => entryView(r.id)!).sort((a, b) => key(a).localeCompare(key(b)));
}
