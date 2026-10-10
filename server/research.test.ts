// Claim review (H1) and research workspace (W0–W5) domain behaviour on a temporary database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-research-')), 't.sqlite');
const { db } = await import('./db.ts');
const { migrateResearch } = await import('./research/schema.ts');
const R = await import('./research/refs.ts');
const CL = await import('./research/claims.ts');
const DS = await import('./research/dossiers.ts');
const HY = await import('./research/hypotheses.ts');
const CA = await import('./research/calendar.ts');
const CO = await import('./research/coverage.ts');
const TG = await import('./research/targets.ts');

const iso = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
function ev(id: string, src: string, title: string, summary: string, opts: { hoursAgo?: number; precision?: string; place?: string; modified?: string } = {}) {
  db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, entities, topics, relevant, first_seen_at, last_seen_at, time_precision, location_name, modified_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, src, `x-${id}`, iso(opts.hoursAgo ?? 2), title, summary, `https://news.test/${id}`, 'en', '["Iran"]', '["shipping"]', 1, iso(1), iso(1), opts.precision ?? 'instant', opts.place ?? null, opts.modified ?? null);
  return `web:${src}:x-${id}`;
}
const st = (r: { ok: boolean }) => (r as { status?: number }).status ?? 200;
const ok = <T>(r: { ok: boolean; value?: T; error?: string; status?: number }): T => { assert.ok(r.ok, `expected ok, got ${r.status}: ${r.error}`); return r.value as T; };

const aBbc = ev('a1', 'bbc-me', 'Tanker struck near Hormuz, Reuters reports', 'A tanker was struck 20 miles off Fujairah, Reuters reported, citing a maritime security firm.', { place: 'Fujairah' });
const aGuard = ev('a2', 'guardian-me', 'Oil tanker hit off UAE coast', 'According to Reuters, a tanker was hit off Fujairah early on Thursday.', { place: 'Fujairah' });
const aIrna = ev('a3', 'irna-en', 'No vessel attacked, Iranian navy says', 'The navy said no vessel was attacked near the Strait of Hormuz on Thursday.', { place: 'Strait of Hormuz' });
const aDate = ev('a4', 'maersk-advisories', 'Maersk advisory update', 'Maersk pauses Hormuz transits until further notice.', { precision: 'date', hoursAgo: 30 });
const unrelated = ev('a5', 'bbc-me', 'Iran holds parliamentary session on budget', 'Iran parliament debated the budget.');

test('migration is repeatable and keeps existing rows', () => {
  const before = (db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c;
  migrateResearch(db); migrateResearch(db);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c, before);
});

test('claims: anchored to an exact excerpt; copied wire reports are one origin group; assessment rules enforced; history traceable', () => {
  assert.equal(CL.createClaim({ source_ref: aBbc, quote: 'a tanker exploded' }).ok, false, 'paraphrase is not an anchor');
  const c = ok(CL.createClaim({ source_ref: aBbc, quote: 'A tanker was struck 20 miles off Fujairah', place: 'off Fujairah', attribution: 'Reuters citing a maritime security firm' }));
  assert.equal(c.workflow_state, 'unreviewed'); assert.equal(c.assessment, 'insufficient');
  assert.equal(c.actor, null, 'unknown fields stay explicitly null');
  // two outlets re-telling the same Reuters report: two links, ONE origin group
  ok(CL.addClaimEvidence(c.id, { source_ref: aGuard, relationship: 'supporting', rationale: 'same incident, same location' }));
  let v = ok(CL.addClaimEvidence(c.id, { source_ref: aBbc, relationship: 'supporting', rationale: 'original item' }));
  assert.equal(v.evidence.length, 2); assert.equal(v.origin_groups.supporting, 1, 'both cite Reuters');
  assert.equal(CL.reviewClaim(c.id, { expected_version: v.version, reviewer: 'analyst', rationale: 'x', workflow_state: 'in_review', assessment: 'supported' }).ok, false, 'non-default needs reviewed');
  assert.equal(CL.reviewClaim(c.id, { expected_version: v.version, reviewer: 'analyst', rationale: 'x', workflow_state: 'reviewed', assessment: 'contested' }).ok, false, 'contested needs both kinds');
  assert.equal(CL.reviewClaim(c.id, { expected_version: v.version, reviewer: 'analyst', workflow_state: 'reviewed', assessment: 'supported' }).ok, false, 'rationale required');
  v = ok(CL.reviewClaim(c.id, { expected_version: v.version, reviewer: 'analyst', rationale: 'one upstream origin only; location consistent', workflow_state: 'reviewed', assessment: 'supported' }));
  assert.equal(st(CL.reviewClaim(c.id, { expected_version: v.version - 1, reviewer: 'b', rationale: 'r', assessment: 'insufficient' })), 409, 'stale edit is a conflict');
  ok(CL.addClaimEvidence(c.id, { source_ref: aIrna, relationship: 'contradicting', rationale: 'Iranian navy denies any attack' }));
  v = ok(CL.reviewClaim(c.id, { expected_version: v.version, reviewer: 'analyst', rationale: 'official denial from a party to the conflict', workflow_state: 'reviewed', assessment: 'contested' }));
  assert.equal(v.history.length, 2);
  assert.equal(v.history[1].evidence_versions.length, 3, 'review records the exact evidence versions');
  assert.equal(v.reviewer, 'analyst');
});

test('versions: captured prospectively; a publisher revision and an unavailable record are distinct, and neither changes an assessment', () => {
  const c = CL.listClaims({ source_refs: [aBbc] })[0];
  db.prepare("UPDATE events SET summary = 'A tanker was struck 20 miles off Fujairah; the crew is safe, Reuters reported.', modified_at = ? WHERE id = 'a2'").run(new Date().toISOString());
  const r = R.recaptureAttached();
  assert.ok(r.changed >= 1);
  assert.equal(R.latestVersion(aGuard)!.kind, 'publisher_revision');
  const v = CL.claimView(c.id)!;
  assert.equal(v.assessment, 'contested', 'assessment unchanged');
  assert.match(v.review_needed ?? '', /publisher_revision/);
  db.prepare("DELETE FROM events WHERE id = 'a3'").run();
  R.recaptureAttached();
  assert.equal(R.latestVersion(aIrna)!.kind, 'unavailable', 'a missing record is "unavailable", not a confirmed retraction');
  assert.equal(R.versionsOf(aIrna)[0].kind, 'first_capture', 'old versions stay');
  ev('a3', 'irna-en', 'No vessel attacked, Iranian navy says', 'The navy said no vessel was attacked near the Strait of Hormuz on Thursday.', { place: 'Strait of Hormuz' });
  R.recaptureAttached();
  assert.equal(R.latestVersion(aIrna)!.kind, 'restored');
});

test('dossiers: idempotent attach, audited detach/reattach, pending suggestions with reasons, countries alone never suggest, disagreements side by side', () => {
  const d = ok(DS.createDossier({ title: 'Fujairah tanker incident', from_ref: aBbc }));
  assert.equal(d.timeline.length, 1);
  ok(DS.attachItem(d.dossier.id, { source_ref: aBbc }));
  assert.equal(DS.dossierDetail(d.dossier.id)!.timeline.length, 1, 'duplicate attachment is a no-op');
  // story cluster: a1 + a2 in one automatic story; the unrelated Iran budget item shares the country only
  db.prepare("INSERT INTO stories (event_id, story_id, size) VALUES ('a1', 's1', 2), ('a2', 's1', 2), ('a5', 's2', 1)").run();
  const sug = DS.suggestions(d.dossier.id);
  assert.deepEqual(sug.map((s) => s.source_ref), [aGuard]);
  assert.match(sug[0].reason, /story cluster.*not confirmation/);
  assert.ok(!sug.some((s) => s.source_ref === unrelated), 'shared country/topic alone never suggests');
  assert.equal(DS.dossierDetail(d.dossier.id)!.timeline.length, 1, 'suggestions stay pending');
  ok(DS.attachItem(d.dossier.id, { source_ref: aGuard, basis: 'accepted_suggestion', relationship: 'report' }));
  ok(DS.attachItem(d.dossier.id, { source_ref: aIrna, relationship: 'report', rationale: 'competing account' }));
  ok(DS.attachItem(d.dossier.id, { source_ref: aDate, relationship: 'context' }));
  ok(DS.detachItem(d.dossier.id, aDate));
  ok(DS.attachItem(d.dossier.id, { source_ref: aDate, relationship: 'context' }));
  const det = DS.dossierDetail(d.dossier.id)!;
  assert.deepEqual(det.audit.map((a) => a.action), ['create', 'attach', 'attach', 'attach', 'attach', 'detach', 'reattach']);
  const dateItem = det.timeline.find((t) => t.source_ref === aDate)!;
  assert.equal(dateItem.source!.time_precision, 'date', 'date-only stays date-only');
  ok(CL.createClaim({ source_ref: aIrna, quote: 'no vessel was attacked near the Strait of Hormuz', place: 'near the Strait of Hormuz', attribution: 'Iranian navy' }));
  const dis = DS.dossierDetail(d.dossier.id)!.disagreements.find((x) => x.field === 'place')!;
  assert.equal(dis.values.length, 2, 'different stated places shown side by side, no verdict');
  assert.equal(st(DS.updateDossier(d.dossier.id, { expected_version: 99, title: 'x' })), 409);
});

test('tasks: closing needs a note or evidence; reopening is possible', () => {
  const d = DS.listDossiers()[0];
  const t = ok(DS.createTask({ dossier_id: d.id, question: 'Did any operator confirm damage?' }));
  assert.equal(DS.updateTask(t.id, { expected_version: 1, status: 'resolved' }).ok, false);
  const r = ok(DS.updateTask(t.id, { expected_version: 1, status: 'resolved', evidence_refs: [aGuard] }));
  assert.ok(r.resolved_at);
  const o = ok(DS.updateTask(t.id, { expected_version: 2, status: 'open' }));
  assert.equal(o.resolved_at, null);
  assert.equal(DS.createTask({ question: 'orphan' }).ok, false);
});

test('hypotheses: invalidation conditions required; only "insufficient" without evidence; decisions trace evidence versions; revisions cue a review, never a change', () => {
  assert.equal(HY.createHypothesis({ title: 'Hormuz traffic', statement: 'Tanker transits fall this week', scope: 'Strait of Hormuz' }).ok, false);
  const h = ok(HY.createHypothesis({ title: 'Hormuz traffic', statement: 'Tanker transits fall this week', scope: 'Strait of Hormuz', invalidation_conditions: 'PortWatch tanker calls stay within ±10 % of the 28-day mean', targets: ['pw:hormuz'] }));
  assert.equal(h.assessment, 'insufficient');
  assert.equal(HY.reviewHypothesis(h.id, { expected_version: h.version, assessment: 'strengthened', rationale: 'r' }).ok, false);
  assert.equal(HY.updateHypothesis(h.id, { expected_version: h.version, assessment: 'strengthened' }).ok, false, 'assessment only via review');
  const claim = CL.listClaims({ source_refs: [aBbc] })[0];
  ok(HY.addHypothesisEvidence(h.id, { ref: aDate, relationship: 'supporting', rationale: 'operator paused transits' }));
  let v = ok(HY.addHypothesisEvidence(h.id, { ref: `claim:${claim.id}`, relationship: 'unclear', rationale: 'incident, contested' }));
  assert.equal(HY.addHypothesisEvidence(h.id, { ref: aBbc, relationship: 'supports' }).ok, false, 'relationship vocabulary enforced');
  v = ok(HY.reviewHypothesis(h.id, { expected_version: v.version, assessment: 'strengthened', rationale: 'operator pause' }));
  assert.equal(v.decisions.length, 1);
  assert.deepEqual(v.decisions[0].evidence_versions.map((e) => e.ref).sort(), [aDate, `claim:${claim.id}`].sort());
  assert.equal(st(HY.updateHypothesis(h.id, { expected_version: v.version - 1, statement: 'x' })), 409);
  db.prepare("UPDATE events SET summary = 'Maersk resumes some Hormuz transits.', modified_at = ? WHERE id = 'a4'").run(new Date().toISOString());
  R.recaptureAttached();
  const after = HY.hypothesisView(h.id)!;
  assert.equal(after.assessment, 'strengthened', 'no automatic change of belief');
  assert.ok(after.review_needed.some((c) => /publisher revision/.test(c)));
});

test('calendar: provider end dates keep provider meaning; changes are revisions; closed and vanished contracts are explicit; manual date-only entries are whole local days', () => {
  db.prepare("INSERT INTO markets (condition_id, event_id, event_slug, event_title, question, outcome_label, token_id, observed_at, is_open, venue, end_date) VALUES ('m1','e','e','E','Will X by Oct 31?','Yes','t','x',1,'polymarket','2026-10-31T23:59:00Z'), ('m2','e','e','E','Will Y?','Yes','t2','x',1,'kalshi','2026-11-01T14:59:00Z')").run();
  assert.equal(CA.syncProviderDates().added, 2);
  assert.equal(CA.syncProviderDates().added, 0, 'idempotent');
  const e1 = CA.entryView('pe:m1')!;
  assert.match(e1.basis, /not verified as the trading cutoff or the resolution time/);
  db.prepare("UPDATE markets SET end_date = '2026-11-15T23:59:00Z' WHERE condition_id = 'm1'").run();
  db.prepare("UPDATE markets SET is_open = 0 WHERE condition_id = 'm2'").run();
  CA.syncProviderDates();
  assert.equal(CA.entryView('pe:m1')!.status, 'revised');
  assert.deepEqual(CA.entryView('pe:m1')!.revisions.map((r) => [r.field, r.before, r.after]).slice(0, 1), [['start_utc', '2026-10-31T23:59:00.000Z', '2026-11-15T23:59:00.000Z']]);
  assert.equal(CA.entryView('pe:m2')!.status, 'closed');
  db.prepare("DELETE FROM markets WHERE condition_id = 'm1'").run();
  CA.syncProviderDates();
  assert.equal(CA.entryView('pe:m1')!.status, 'unknown');
  assert.equal(CA.createEntry({ title: 'OPEC meeting', date: '2026-12-03', tz: 'Mars/Olympus', source_url: 'https://x.test' }).ok, false);
  assert.equal(CA.createEntry({ title: 'OPEC meeting', date: '2026-12-03' }).ok, false, 'source required');
  const m = ok(CA.createEntry({ title: 'IMO session (date only)', date: '2026-03-08', tz: 'America/New_York', source_url: 'https://imo.test/session' }));
  assert.equal(m.time_precision, 'date'); assert.equal(m.start_utc, null, 'no invented midnight deadline');
  assert.deepEqual(CA.dayInterval('2026-03-08', 'America/New_York'), { start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' }, 'DST day is 23 h');
  const timed = ok(CA.createEntry({ title: 'Briefing', date: '2026-11-01', time: '09:30', tz: 'America/New_York', source_url: 'https://x.test/b' }));
  assert.equal(timed.start_utc, '2026-11-01T14:30:00.000Z', 'after DST ends, EST = UTC−5');
  assert.ok(CA.listEntries('2026-03-08T00:00:00Z', '2026-03-08T06:00:00Z').some((e) => e.id === m.id), 'a date-only day overlaps by its local interval');
  const up = ok(CA.updateEntry(m.id, { expected_version: 1, status: 'postponed', basis: 'postponement announced at https://imo.test/notice' }));
  assert.equal(up.status, 'postponed'); assert.equal(up.revisions.length, 1);
  assert.equal(CA.updateEntry('pe:m2', { expected_version: 1, status: 'cancelled', basis: 'x' }).ok, false, 'provider entries are not editable');
  // Leap year Feb 29 handling
  const leap = CA.dayInterval('2028-02-29', 'UTC');
  assert.deepEqual(leap, { start: '2028-02-29T00:00:00.000Z', end: '2028-03-01T00:00:00.000Z' });
  const leapEntry = ok(CA.createEntry({ title: 'Leap event', date: '2028-02-29', tz: 'UTC', source_url: 'https://leap.test' }));
  assert.equal(leapEntry.date_local, '2028-02-29');
  assert.ok(CA.listEntries('2028-02-01T00:00:00Z', '2028-03-05T00:00:00Z').some((e) => e.id === leapEntry.id));
});

test('coverage: success rate uses scheduled attempts only (manual separate); no telemetry is "unknown"; all-down says "no items observed within this coverage"', () => {
  const empty = CO.coverageReport(24);
  assert.equal(empty.telemetry_since, null);
  assert.ok(empty.sources.every((s) => s.attempts.rate === null));
  const at = new Date().toISOString();
  const ins = db.prepare('INSERT INTO collection_attempts (source_id, at, ok, partial, manual, error) VALUES (?,?,?,?,?,?)');
  ins.run('bbc-me', at, 1, 0, 0, null); ins.run('bbc-me', at, 1, 0, 0, null); ins.run('bbc-me', at, 0, 0, 0, 'HTTP 503'); ins.run('bbc-me', at, 1, 0, 1, null);
  const bbc = CO.coverageReport(24).sources.find((s) => s.source_id === 'bbc-me')!;
  assert.deepEqual([bbc.attempts.scheduled_ok, bbc.attempts.scheduled_total, bbc.attempts.manual], [2, 3, 1]);
  assert.ok(Math.abs(bbc.attempts.rate! - 2 / 3) < 1e-9);
  const rep = CO.coverageReport(24);
  assert.ok(rep.all_relevant_down, 'no source has ever succeeded in this test database');
  assert.match(rep.notes[0], /nothing observed within this coverage/);
});

test('observation cards: same-series change only with a non-zero prior; vessels unavailable without authorized AIS; pins validated', () => {
  const T = Math.floor(Date.now() / 86400e3) * 86400 - 3 * 86400;
  db.prepare("INSERT INTO series_points (series_id, t, v) VALUES ('pw:hormuz:total', ?, 40), ('pw:hormuz:total', ?, 30), ('pw:hormuz:tanker', ?, 0), ('pw:hormuz:tanker', ?, 3)").run(T - 86400, T, T - 86400, T);
  const hz = TG.observationTargets().find((t) => t.id === 'pw:hormuz')!;
  const total = hz.series.find((s) => s.id === 'pw:hormuz:total')!, tanker = hz.series.find((s) => s.id === 'pw:hormuz:tanker')!;
  assert.equal(total.change_pct, -25);
  assert.equal(tanker.change_pct, null); assert.match(tanker.change_basis, /percentage undefined/);
  assert.equal(total.status, 'delayed (normal for this provider)');
  assert.equal(hz.vessels.status, 'unavailable');
  assert.equal(TG.setPinnedTargets(['pw:nowhere']).ok, false);
  assert.ok(TG.setPinnedTargets(['pw:suez']).ok);
  assert.equal(TG.observationTargets()[0].id, 'pw:suez');
});

test('review and reschedule a hypothesis atomically; invalid schedule writes no decision', () => {
  const h = ok(HY.createHypothesis({ title: 'Review schedule', statement: 'Traffic may change', scope: 'Hormuz', invalidation_conditions: 'Traffic does not change', status: 'active', next_check_at: '2020-01-01T00:00:00Z' }));
  const next = '2030-01-01T12:00:00.000Z';
  const reviewed = ok(HY.reviewHypothesis(h.id, { expected_version: h.version, assessment: 'insufficient', rationale: 'Wait for the next release', next_check_at: next }));
  assert.equal(reviewed.next_check_at, next);
  assert.equal(reviewed.decisions.length, 1);
  assert.equal(reviewed.review_needed.some((x) => x.startsWith('next check was due')), false);
  const bad = HY.reviewHypothesis(h.id, { expected_version: reviewed.version, assessment: 'insufficient', rationale: 'Invalid schedule', next_check_at: 'invalid' });
  assert.equal(st(bad), 400);
  assert.equal(HY.hypothesisView(h.id)!.decisions.length, 1);
  const clear = ok(HY.reviewHypothesis(h.id, { expected_version: reviewed.version, assessment: 'insufficient', rationale: 'No further scheduled check', next_check_at: null }));
  assert.equal(clear.next_check_at, null);
});
