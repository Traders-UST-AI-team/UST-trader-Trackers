// Daily change briefing: rule-built, cited, honest about gaps. No network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-brief-')), 't.sqlite');
const { db } = await import('./db.ts');
const B = await import('./briefing.ts');

const H = 3600;
const NOW = 1_790_000_000 - (1_790_000_000 % H) + 1800;      // 30 min into an hour
const nowIso = new Date(NOW * 1000).toISOString();
const ago = (h: number) => new Date((NOW - h * H) * 1000).toISOString();

function market(id: string, points: [number, number][]) {
  db.prepare(`INSERT OR REPLACE INTO markets (condition_id, venue, event_id, event_slug, event_title, question, outcome_label, observed_at, is_open, price, quote_basis, best_bid, best_ask, liquidity, volume_24h)
    VALUES (?,?,?,?,?,?,?,?,1,?,?,0.4,0.42,5000,100)`).run(id, 'polymarket', 'e', 'e', 'Event', `Will ${id} happen?`, 'Yes', nowIso, points.at(-1)![1], 'midpoint');
  const ins = db.prepare('INSERT OR REPLACE INTO price_history (condition_id, t, p) VALUES (?,?,?)');
  for (const [t, p] of points) ins.run(id, t, p);
  db.prepare('INSERT OR REPLACE INTO history_meta (condition_id, fetched_at, fidelity, error) VALUES (?,?,?,NULL)').run(id, nowIso, 60);
}
const flat = (p: number) => Array.from({ length: 60 }, (_, i) => [NOW - (59 - i) * H - 1800 + 30, p] as [number, number]);
// "moves": 40 % until 24 h ago, then 48 % → +8 pp over the 24 h window
market('mv', flat(0.40).map(([t, p]) => [t, t > NOW - 24 * H ? 0.48 : p] as [number, number]));
market('still', flat(0.30));
market('thin', [[NOW - 2 * H, 0.2], [NOW - H, 0.21]]);   // too little history → not computable, must be reported with a reason

function ev(id: string, source: string, outlet: string, title: string, hoursAgo: number, story?: string, lang = 'en') {
  db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, language, entities, topics, relevant, first_seen_at, last_seen_at, outlet)
    VALUES (?,?,?,?,?,?,?,?,'[]','[]',1,?,?,?)`).run(id, source, `x-${id}`, ago(hoursAgo), title, `${title} summary`, `https://news.test/${id}`, lang, ago(hoursAgo), ago(hoursAgo), outlet);
  if (story) db.prepare('INSERT INTO stories (event_id, story_id, size) VALUES (?,?,2)').run(id, story);
}
ev('a1', 'bbc-me', 'bbc', 'Tanker diverted near Hormuz', 3, 's1');
ev('a2', 'guardian-me', 'guardian', 'Tanker diverted near Hormuz, officials say', 2, 's1');
ev('b1', 'irna-fa', 'irna', 'گزارش آزمایشی', 5, undefined, 'fa');
ev('old', 'bbc-me', 'bbc', 'Published two days ago', 50);
db.prepare("UPDATE events SET first_seen_at = ? WHERE id = 'old'").run(ago(1));   // collected inside the window but published before it
for (const [e, m, s] of [['a1', 'mv', 2], ['a2', 'mv', 3], ['a1', 'still', 1], ['b1', 'thin', 1]] as const) db.prepare("INSERT INTO event_market_links (event_id, condition_id, score, matched_entities, matched_topics) VALUES (?,?,?,'[]','[]')").run(e, m, s);

test('briefing: stories grouped, items cited, independence stated, late-collected counted not listed', () => {
  const b = B.buildBriefing({ now: NOW * 1000, hours: 24 });
  assert.equal(b.stories.length, 2);
  const s = b.stories.find((x) => x.items.length === 2)!;
  assert.equal(s.single_outlet, false);
  assert.ok(s.independence_groups >= 1 && s.independence_groups <= 2);
  assert.ok(s.items.every((i) => b.citations[i.n - 1].url?.startsWith('https://news.test/')), 'every item cites its original URL');
  assert.equal(b.late_collected, 1, 'item published before the window is counted separately');
  assert.ok(!b.stories.some((x) => x.items.some((i) => i.title === 'Published two days ago')));
  const fa = b.stories.flatMap((x) => x.items).find((i) => i.language === 'fa')!;
  assert.equal(fa.untranslated, true);
  b.citations.forEach((c, i) => assert.equal(c.n, i + 1, 'citation numbers are sequential'));
});

test('briefing: contract listed only when it moved; the move carries its measurement times; uncomputable ones give a reason, never 0', () => {
  const b = B.buildBriefing({ now: NOW * 1000, hours: 24 });
  const k = b.contracts.find((x) => x.condition_id === 'mv')!;
  assert.ok(k, 'the +8 pp contract is listed');
  assert.ok(Math.abs((k.change_24h_pp as number) - 8) < 1e-6);
  assert.ok(k.change_from_t && k.change_to_t && k.change_to_t > k.change_from_t);
  assert.ok(k.items.length === 2 && k.items.every((i) => b.citations[i.n - 1].kind === 'item'));
  assert.ok(!b.contracts.some((x) => x.condition_id === 'still'), 'an unmoved contract is not listed');
  const nc = b.contracts_not_computable.reduce((s, x) => s + x.count, 0);
  assert.equal(nc, 1);
  assert.match(b.contracts_not_computable[0].reason, /warming up|gap|stale/);
});

test('briefing: wording stays "coincident, not causal"; limits are always stated; markdown cites every numbered source', () => {
  const b = B.buildBriefing({ now: NOW * 1000, hours: 24 });
  const md = B.toMarkdown(b);
  assert.match(md, /coincident, not causal/i);
  assert.doesNotMatch(md, /\b(caused by|because of|due to|drove|triggered|led to|resulted in|as a result of)\b/i);
  assert.ok(b.limits.some((l) => /independen/i.test(l)) && b.limits.some((l) => /publication time/i.test(l)));
  const used = new Set([...md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  for (const n of used) assert.ok(b.citations[n - 1], `[${n}] exists in the sources list`);
  assert.match(md, /## Sources/);
  assert.match(md, /not translated/);
});

test('briefing: empty window says so instead of inventing content; hours are bounded; snapshots round-trip', async () => {
  const empty = B.buildBriefing({ now: (NOW - 400 * H) * 1000, hours: 24 });
  assert.equal(empty.stories.length, 0);
  assert.match(empty.summary[0], /No new relevant items/);

  const app = express(); app.use(express.json()); B.registerBriefingRoutes(app, { seed: false });
  const server = createServer(app); await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/api/briefing?hours=0`)).status, 400);
  assert.equal((await fetch(`${base}/api/briefing?hours=999`)).status, 400);
  assert.equal((await fetch(`${base}/api/briefing?hours=abc`)).status, 400);
  const live = await fetch(`${base}/api/briefing?hours=24`);
  assert.equal(live.status, 200);
  const md = await fetch(`${base}/api/briefing.md?hours=24`);
  assert.match(md.headers.get('content-disposition') ?? '', /attachment; filename="briefing_\d{4}-\d{2}-\d{2}\.md"/);
  const saved = await fetch(`${base}/api/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hours: 24, note: 'morning check' }) });
  assert.equal(saved.status, 201);
  const row = await saved.json() as { id: string; note: string };
  assert.equal(row.note, 'morning check');
  const back = await (await fetch(`${base}/api/briefings/${row.id}`)).json() as { version: string; citations: unknown[] };
  assert.equal(back.version, 'briefing-1.0');
  assert.equal((await fetch(`${base}/api/briefings/${row.id}.md`)).status, 200);
  assert.equal((await fetch(`${base}/api/briefings/nope`)).status, 404);
  const list = await (await fetch(`${base}/api/briefings`)).json() as unknown[];
  assert.equal(list.length, 1);
});

test('briefing: a contract without stored history uses the venue-reported 24h change, labelled as such; large story groups list a bounded number of items', () => {
  db.prepare(`INSERT OR REPLACE INTO markets (condition_id, venue, event_id, event_slug, event_title, question, outcome_label, observed_at, is_open, price, quote_basis, one_day_change)
    VALUES ('prov','kalshi','e','e','Event','Will prov happen?','Yes',?,1,0.5,'midpoint',0.07)`).run(nowIso);
  db.prepare("INSERT INTO event_market_links (event_id, condition_id, score, matched_entities, matched_topics) VALUES ('a1','prov',1,'[]','[]')").run();
  for (let i = 0; i < 9; i++) { ev(`big${i}`, 'bbc-me', `outlet${i}`, `Big story item ${i}`, 4, 'sbig'); }
  const b = B.buildBriefing({ now: NOW * 1000, hours: 24 });
  const k = b.contracts.find((x) => x.condition_id === 'prov')!;
  assert.ok(k, 'listed from the venue-reported change');
  assert.equal(k.change_basis, 'provider_reported');
  assert.match(k.reasons[0], /as reported by the venue/);
  assert.equal(k.change_from_t, null, 'no measurement times are invented');
  const big = b.stories.find((s) => s.items_total === 9)!;
  assert.equal(big.items.length, 6);
  assert.match(B.toMarkdown(b), /…and 3 more item\(s\) in this group, not listed\./);
});

test('automatic morning snapshot: once per day after 07:00, switchable, never before 07:00', () => {
  assert.equal(B.autoEnabled(), false, 'off by default');
  B.setAutoEnabled(true);
  const day = new Date(NOW * 1000); day.setHours(8, 0, 0, 0);
  const early = new Date(day); early.setHours(6, 0, 0, 0);
  assert.equal(B.autoSnapshotIfDue(early), null, 'before 07:00 nothing is saved');
  const first = B.autoSnapshotIfDue(day);
  assert.match(first ?? '', /^saved b_/);
  assert.equal(B.autoSnapshotIfDue(new Date(day.getTime() + 3600e3)), null, 'not again within 20 h');
  assert.ok(B.listSaved().some((r) => r.note === 'Automatic morning snapshot'));
  B.setAutoEnabled(false);
  assert.equal(B.autoSnapshotIfDue(new Date(day.getTime() + 30 * 3600e3)), null, 'switched off');
  B.setAutoEnabled(true);
  assert.match(B.autoSnapshotIfDue(new Date(day.getTime() + 30 * 3600e3)) ?? '', /^saved b_/, 'next day it saves again');
});
