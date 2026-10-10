// J1 vessel-type extraction and K1 vessel identity (no external calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-maritime-')), 't.sqlite');
const { db } = await import('./db.ts');
const T = await import('./maritime/types.ts');
const V = await import('./maritime/vessels.ts');

const types = (s: string) => T.extractVesselTypes(s).map((h) => `${h.type}:${h.span}`);

test('vessel types: explicit wording only, with evidence spans; generic words never become a tanker', () => {
  assert.deepEqual(types('An oil tanker was hit off Fujairah'), ['tanker:oil tanker']);
  assert.deepEqual(types('A VLCC and a product tanker were diverted'), ['crude_tanker:VLCC', 'product_tanker:product tanker']);
  assert.deepEqual(types('Houthis fired at a container ship and a bulk carrier'), ['container_ship:container ship', 'bulk_carrier:bulk carrier']);
  assert.deepEqual(types('LNG carriers waited at anchor'), ['lng_carrier:LNG carriers']);
  assert.deepEqual(types('A merchant vessel reported an explosion nearby'), ['unspecified:merchant vessel']);
  assert.deepEqual(types('The ship changed course'), ['unspecified:ship']);
  assert.deepEqual(types('Navy destroyer escorted the tanker'), ['naval:destroyer', 'tanker:tanker']);
  assert.deepEqual(types('Oil prices rose'), []);
  const h = T.extractVesselTypes('Iran seized a crude oil tanker')[0];
  assert.equal('Iran seized a crude oil tanker'.slice(h.start, h.end), h.span, 'span offsets point at the words used');
});

test('identifiers: IMO check digit and MMSI shape validated; identifiers need a source', () => {
  assert.equal(V.validImo('9074729'), true);
  assert.equal(V.validImo('9074728'), false);
  assert.equal(V.validMmsi('636092932'), true);
  assert.equal(V.validMmsi('123456789'), false, 'MID must start with 2–7');
  assert.equal(V.createVessel({ name: 'Example Star', imo: '9074729' }).ok, false, 'no source → rejected');
  assert.equal(V.createVessel({ name: 'Example Star', imo: '9074728', source_url: 'https://registry.test/1' }).ok, false, 'bad check digit');
});

test('identity: never merged on a name; an IMO held by another record is a conflict; MMSI changes keep history', () => {
  const a = V.createVessel({ name: 'Example Star', imo: '9074729', mmsi: '636092932', source_url: 'https://registry.test/a' });
  assert.ok(a.ok);
  const b = V.createVessel({ name: 'Example Star', source_url: 'https://news.test/b' }); // same name, no identifiers: a separate record
  assert.ok(b.ok);
  assert.equal(V.listVessels().filter((x) => x.display_name === 'Example Star').length, 2);
  const conflict = V.addIdentifier(b.ok ? b.value.id : '', { kind: 'imo', value: '9074729', source_url: 'https://x.test' });
  assert.equal(conflict.ok ? 0 : conflict.status, 409);
  const id = a.ok ? a.value.id : '';
  const other = V.addIdentifier(id, { kind: 'imo', value: '9176187', source_url: 'https://x.test' });
  assert.equal(other.ok ? 0 : other.status, 409, 'an IMO is permanent');
  const m = V.addIdentifier(id, { kind: 'mmsi', value: '538007655', source_url: 'https://registry.test/reflag', valid_from: '2026-09-01' });
  assert.ok(m.ok);
  const v = V.vesselView(id)!;
  assert.equal(v.current.mmsi, '538007655');
  const old = v.identifiers.find((i) => i.kind === 'mmsi' && i.value === '636092932')!;
  assert.equal(old.valid_to, '2026-09-01', 'previous MMSI closed, not deleted');
  assert.equal(v.position.status, 'unavailable');
  assert.equal(V.addAttribute(id, { attr: 'owner', value: 'X', source_url: 'https://x.test' }).ok, false, 'only source-reported attributes');
  assert.ok(V.addAttribute(id, { attr: 'cargo_reported', value: 'crude oil', source_url: 'https://x.test/c', as_of: '2026-10-01' }).ok);
});

test('mentions: IMO/MMSI in the text is proposed; a name alone stays unresolved and needs evidence to accept', () => {
  const ins = (id: string, title: string, summary: string) => db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, entities, topics, relevant, first_seen_at, last_seen_at)
    VALUES (?, 'gcaptain', ?, ?, ?, ?, 'https://x', 'en', '[]', '[]', 1, ?, ?)`).run(id, `x-${id}`, new Date().toISOString(), title, summary, new Date().toISOString(), new Date().toISOString());
  ins('m1', 'Tanker detained', 'Authorities detained the tanker (IMO 9074729) off the coast.');
  ins('m2', 'Example Star calls at Jebel Ali', 'The Example Star berthed on Tuesday.');
  const r = V.scanMentions();
  assert.equal(r.proposed, 1);
  assert.ok(r.unresolved >= 2, 'the name matches both same-name records and stays unresolved for each');
  assert.equal(V.scanMentions().proposed, 0, 'idempotent');
  const id = V.listVessels().find((x) => x.current.imo === '9074729')!.id;
  const nameOnly = V.vesselView(id)!.mentions.find((m) => m.basis === 'name_in_text')!;
  assert.equal(V.reviewMention(nameOnly.id, { status: 'accepted', reviewer: 'analyst' }).ok, false, 'name-only acceptance needs evidence');
  assert.ok(V.reviewMention(nameOnly.id, { status: 'accepted', reviewer: 'analyst', note: 'port call notice lists IMO 9074729' }).ok);
});
