// Fault injection: a real local HTTP server misbehaves the way production feeds do; we assert the client/parsers fail safely.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-fault-')), 't.sqlite');
process.env.HTTP_MIN_GAP_MS = '0';
process.env.HTTP_BACKOFF_MS = '5';
const { fetchText, HttpError } = await import('./http.ts');
const { storeFeed, parseFeed } = await import('./sources/rss.ts');
const { db } = await import('./db.ts');
const { NEWS_SOURCES } = await import('./registry.ts');
const breaker = await import('./breaker.ts');
import { readFileSync } from 'node:fs';

type Handler = (req: IncomingMessage, res: ServerResponse, n: number) => void;
let handler: Handler = (_q, r) => r.end('ok');
let hits = 0;
const server = createServer((req, res) => handler(req, res, ++hits));
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); });
const serve = (h: Handler) => { handler = h; hits = 0; };

const GOOD = `<rss><channel><item><title>Iran strikes tanker near Hormuz</title><link>https://x.test/a</link><pubDate>Thu, 08 Oct 2026 12:00:00 GMT</pubDate><description>Details.</description></item>
<item><title>Houthi missile hits Riyadh airport</title><link>https://x.test/b</link><pubDate>Thu, 08 Oct 2026 13:00:00 GMT</pubDate></item></channel></rss>`;
const SRC = NEWS_SOURCES.find((s) => s.id === 'bbc-me')!;
const count = () => (db.prepare("SELECT COUNT(*) c FROM events WHERE source_id = 'bbc-me'").get() as { c: number }).c;

test('429 then success: backs off and recovers within the retry budget', async () => {
  serve((_q, r, n) => { if (n < 3) { r.statusCode = 429; r.end('slow down'); } else r.end('recovered'); });
  assert.equal(await fetchText(`${base}/x`, { retries: 3 }), 'recovered');
  assert.equal(hits, 3);
});

test('persistent 500: gives up after the retry budget with the status in the error', async () => {
  serve((_q, r) => { r.statusCode = 503; r.end('down'); });
  await assert.rejects(fetchText(`${base}/x`, { retries: 2 }), (e: Error) => e instanceof HttpError && e.status === 503);
  assert.equal(hits, 3);
});

test('403/404 are final: no retries, so blocks are never hammered or evaded', async () => {
  for (const code of [403, 404, 406]) {
    serve((_q, r) => { r.statusCode = code; r.end('no'); });
    await assert.rejects(fetchText(`${base}/x`, { retries: 3 }), (e: Error) => e instanceof HttpError && e.status === code);
    assert.equal(hits, 1, `status ${code} must not be retried`);
  }
});

test('hanging server: request times out instead of blocking the cycle', async () => {
  serve(() => { /* never respond */ });
  const t0 = Date.now();
  await assert.rejects(fetchText(`${base}/x`, { retries: 0, timeoutMs: 150 }));
  assert.ok(Date.now() - t0 < 2000);
});

test('HTML challenge page instead of XML: fails loudly, stores nothing', () => {
  const before = count();
  assert.throws(() => storeFeed(SRC, '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'), /zero usable items/);
  assert.equal(count(), before);
});

test('truncated XML: never crashes the process and never stores a half item', () => {
  const truncated = GOOD.slice(0, GOOD.indexOf('Houthi') + 8); // cut mid-title of the 2nd item
  const before = count();
  let threw = false;
  try { storeFeed(SRC, truncated); } catch { threw = true; }
  const stored = db.prepare("SELECT title FROM events WHERE source_id = 'bbc-me'").all() as { title: string }[];
  assert.ok(threw || stored.every((r) => !/^Houthi missile hits Riy?$/.test(r.title)), 'a half-parsed item must not be stored');
  assert.ok(count() >= before);
});

test('feed with items but no dates: items are dropped, not given invented times', () => {
  const noDates = '<rss><channel><item><title>Undated item</title><link>https://x.test/c</link></item></channel></rss>';
  assert.equal(parseFeed(noDates).length, 0);
  assert.throws(() => storeFeed(SRC, noDates), /zero usable items/);
});

test('good feed after failures stores normally and is idempotent', () => {
  storeFeed(SRC, GOOD); // the truncated feed earlier may already have stored the first, complete item — that is fine
  assert.equal(count(), 2);
  assert.equal(storeFeed(SRC, GOOD).inserted, 0, 'second run adds nothing');
  assert.equal(count(), 2);
});

test('circuit breaker: opens at 3 consecutive failures, cool-down doubles, persists, closes on success', () => {
  const id = 'fault-src';
  const t0 = Date.parse('2026-10-09T00:00:00Z');
  assert.equal(breaker.recordFailure(id, 15, 'e1', t0).open_until, null);
  assert.equal(breaker.recordFailure(id, 15, 'e2', t0).open_until, null);
  const third = breaker.recordFailure(id, 15, 'e3', t0);
  assert.equal(third.fails, 3);
  assert.equal(Date.parse(third.open_until!) - t0, 15 * 60_000);
  assert.equal(breaker.isOpen(id, t0 + 60_000), true);
  assert.equal(breaker.isOpen(id, t0 + 16 * 60_000), false, 'cool-down elapsed → one probe allowed');
  const fourth = breaker.recordFailure(id, 15, 'e4', t0);
  assert.equal(Date.parse(fourth.open_until!) - t0, 30 * 60_000, 'cool-down doubles');
  for (let i = 0; i < 12; i++) breaker.recordFailure(id, 15, 'again', t0);
  assert.equal(Date.parse(breaker.getBreaker(id).open_until!) - t0, 6 * 3600_000, 'capped at 6 h');
  assert.equal(breaker.getBreaker(id).fails, 16, 'state read back from the database');
  breaker.recordSuccess(id);
  assert.deepEqual(breaker.getBreaker(id), { fails: 0, open_until: null, last_error: null });
});

// ---- Telegram: per-channel isolation and coverage-gap state (the server below fakes t.me/s) ----
const TG_FIXTURE = readFileSync(new URL('./fixtures/telegram_channel.html', import.meta.url), 'utf8');
const msg = (ch: string, id: number) => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${ch}/${id}"><div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text">Post ${id} Iran Hormuz tanker</div><div class="tgme_widget_message_footer"><a class="tgme_widget_message_date"><time datetime="2026-10-08T12:00:00+00:00"></time></a></div></div></div></div>`;
const page = (ch: string, hi: number, n: number, more: number | null) => `<html><body><div class="tgme_channel_info_header_title">${ch}</div>${more ? `<a class="tme_messages_more" href="/s/${ch}?before=${more}"></a>` : ''}${Array.from({ length: n }, (_, i) => msg(ch, hi - n + 1 + i)).join('')}</body></html>`;

test('telegram: a failing channel never stops the others; its error is recorded on the channel', async () => {
  process.env.TELEGRAM_BASE = base;
  const tg = await import('./sources/telegram.ts');
  serve((req, res) => {
    if (req.url?.startsWith('/bad')) { res.statusCode = 500; res.end('boom'); return; }
    res.end(TG_FIXTURE);
  });
  // 'bad' is first, so a naive loop would abort before reaching 'good'
  const out = await tg.ingestTelegramChannels(['bad', 'good']);
  assert.equal(out.errors.length, 1); assert.equal(out.errors[0].channel, 'bad');
  assert.equal(out.results.length, 1); assert.equal(out.results[0].channel, 'good');
  assert.ok(out.results[0].inserted > 0, 'good channel stored its posts');
  const bad = db.prepare("SELECT last_error FROM tg_channels WHERE channel = 'bad'").get() as { last_error: string };
  assert.match(bad.last_error, /503|500|HTTP/);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM tg_posts WHERE channel = 'bad'").get() as { c: number }).c, 0);
});

// A channel holding posts 1..N, newest first, 5 per page, like t.me/s pagination.
const busyChannel = (ch: string, newest: () => number) => (req: IncomingMessage, res: ServerResponse) => {
  const b = /before=(\d+)/.exec(req.url ?? '')?.[1];
  const hi = b ? Number(b) - 1 : newest();
  const n = Math.min(5, Math.max(0, hi));
  res.end(page(ch, hi, n, hi - n >= 1 ? hi - n + 1 : null));
};
const ids = (ch: string) => (db.prepare('SELECT post_id FROM tg_posts WHERE channel = ? ORDER BY post_id').all(ch) as { post_id: number }[]).map((r) => r.post_id);

test('telegram gaps: a capped catch-up opens a DURABLE gap; a later newest-page poll does not clear it; only recovery of that interval does', async () => {
  process.env.TELEGRAM_BASE = base;
  const tg = await import('./sources/telegram.ts');
  const ch = 'busy';
  db.prepare("INSERT INTO tg_channels (channel, title, fetched_at) VALUES (?, 'Busy', ?)").run(ch, new Date().toISOString());
  db.prepare("INSERT INTO tg_posts (channel, post_id, posted_at, text, url, first_seen_at, fetched_at) VALUES (?, 1, '2026-10-08T00:00:00Z', 'old stored post', 'https://t.me/busy/1', 'x', 'x')").run(ch);
  let newest = 60;
  serve(busyChannel(ch, () => newest));
  // run 1: latest walks 4 pages (60..41) without reaching #1 → gap (1, 41) opens; the rest of the 8-page budget recovers 40..21
  const r1 = await tg.ingestTelegramChannel(ch, { budgetPages: 8 });
  assert.deepEqual(r1.pages_by_phase, { latest: 4, gap: 4, history: 0 });
  let g = tg.openGaps(ch);
  assert.equal(g.length, 1); assert.equal(g[0].low_id, 1); assert.equal(g[0].high_id, 41); assert.equal(g[0].cursor_before, 21);
  assert.match((db.prepare('SELECT gap_note FROM tg_channels WHERE channel = ?').get(ch) as { gap_note: string }).gap_note, /after #1 and before #41.*may be missing/);
  // run 2 with a 1-page budget: the newest page now touches stored posts — that must NOT clear the gap
  newest = 62;
  await tg.ingestTelegramChannel(ch, { budgetPages: 1 });
  g = tg.openGaps(ch);
  assert.equal(g.length, 1, 'gap stays open until its own interval is recovered');
  // run 3: recovery continues from the cursor (20..1), reaches the lower bound → resolved; every id 1..62 is now stored
  const r3 = await tg.ingestTelegramChannel(ch, { budgetPages: 8 });
  assert.equal(r3.gaps_resolved, 1);
  assert.equal(tg.openGaps(ch).length, 0);
  assert.equal((db.prepare('SELECT gap_note FROM tg_channels WHERE channel = ?').get(ch) as { gap_note: string | null }).gap_note, null);
  assert.deepEqual(ids(ch), Array.from({ length: 62 }, (_, i) => i + 1));
  const via = db.prepare("SELECT seen_via, COUNT(*) c FROM tg_posts WHERE channel = ? GROUP BY seen_via ORDER BY seen_via").all(ch) as { seen_via: string; c: number }[];
  assert.ok(via.some((v) => v.seen_via === 'gap' && v.c === 39), `posts 2..40 recovered via gap: ${JSON.stringify(via)}`);
  // restart idempotence: running again re-reads the newest page only and stores nothing new
  const r4 = await tg.ingestTelegramChannel(ch, { budgetPages: 8 });
  assert.equal(r4.inserted, 0);
  assert.equal(ids(ch).length, 62);
});

test('telegram: history deepening stays contiguous across budget-limited runs and respects the per-run page budget', async () => {
  process.env.TELEGRAM_BASE = base;
  const tg = await import('./sources/telegram.ts');
  const ch = 'deepch';
  serve(busyChannel(ch, () => 40));
  const r1 = await tg.ingestTelegramChannel(ch, { budgetPages: 3 }); // first contact: 1 latest page + 2 history pages
  assert.equal(r1.pages, 3);
  assert.deepEqual(ids(ch), Array.from({ length: 15 }, (_, i) => 26 + i));
  await tg.ingestTelegramChannel(ch, { budgetPages: 3 }); // 1 latest page (touches stored) + 2 deeper pages
  assert.deepEqual(ids(ch), Array.from({ length: 25 }, (_, i) => 16 + i), 'no intermediate hole');
  assert.equal(tg.openGaps(ch).length, 0);
});

test('telegram allowlist: validated, persisted, removal keeps stored posts', async () => {
  const tg = await import('./sources/telegram.ts');
  assert.equal(tg.setChannelConfig([{ channel: 'bad name!' }]).ok, false);
  assert.equal(tg.setChannelConfig([{ channel: 'Valid_one' }, { channel: 'valid_ONE' }]).ok, false, 'case-insensitive duplicate');
  assert.equal(tg.setChannelConfig(Array.from({ length: 21 }, (_, i) => ({ channel: `chan_${i}xx` }))).ok, false);
  assert.equal(tg.setChannelConfig([{ channel: 'busy' }]).ok, false, 'public usernames have at least 5 characters');
  const r = tg.setChannelConfig([{ channel: 'deepch', enabled: true }, { channel: 'other_ch', enabled: false }]);
  assert.ok(r.ok);
  assert.deepEqual(tg.configuredChannels(), ['deepch']);
  tg.setChannelConfig([{ channel: 'other_ch' }]);
  assert.deepEqual(tg.configuredChannels(), ['other_ch']);
  assert.ok(ids('deepch').length > 0, 'posts of a removed channel are history and stay stored');
});

test('request budget: every attempt counts, the run stops at the budget, and the stop is distinguishable from a failure', async () => {
  const { withBudget, BudgetExceeded } = await import('./http.ts');
  serve((_q, r) => r.end('ok'));
  const ok = await withBudget('t', 3, async () => { await fetchText(`${base}/a`); await fetchText(`${base}/b`); return 'done'; });
  assert.deepEqual([ok.value, ok.used, ok.exhausted], ['done', 2, false]);
  serve((_q, r) => { r.statusCode = 503; r.end('down'); });
  await assert.rejects(withBudget('t', 2, () => fetchText(`${base}/c`, { retries: 5 })), (e: unknown) => e instanceof BudgetExceeded && (e as { budgetUsed?: number }).budgetUsed === 2);
});

test('budget: a stop swallowed by an adapter\'s per-item error handling still labels the run partial', async () => {
  const { runSourceJob } = await import('./sourcejob.ts');
  const { configOf } = await import('./sourceconfig.ts');
  serve((_q, r) => r.end('ok'));
  const budget = configOf('bbc-me')!.request_budget;
  const r = await runSourceJob('bbc-me', async () => {
    let done = 0;
    for (let i = 0; i < budget + 5; i++) { try { await fetchText(`${base}/p${i}`, { retries: 0 }); done++; } catch { /* adapter isolates per-item failures */ } }
    return `${done} pages`;
  }, { force: true });
  assert.ok(r.ok);
  assert.match(r.detail, /partial run: request budget of \d+ exhausted/);
  const u = db.prepare("SELECT requests, budget_exhausted FROM source_runs WHERE source_id = 'bbc-me'").get() as { requests: number; budget_exhausted: number };
  assert.deepEqual([u.requests, u.budget_exhausted], [budget, 1]);
});

test('leases: a second holder cannot start the same job until the first releases or expires', async () => {
  const { acquireLease, releaseLease } = await import('./lease.ts');
  const now = Date.now();
  assert.equal(acquireLease('job', 60_000, 'A', now), true);
  assert.equal(acquireLease('job', 60_000, 'B', now + 1000), false);
  assert.equal(acquireLease('job', 60_000, 'A', now + 1000), true, 'holder may renew');
  releaseLease('job', 'B'); // not the holder: no effect
  assert.equal(acquireLease('job', 60_000, 'B', now + 2000), false);
  assert.equal(acquireLease('job', 60_000, 'B', now + 61_001 + 1000), true, 'expired lease can be taken over');
  releaseLease('job', 'B');
  assert.equal(acquireLease('job', 1000, 'C', now), true);
});

test('leases: one left behind by a dead process is taken over at once; a live other holder is still honoured', async () => {
  const { acquireLease, releaseLease } = await import('./lease.ts');
  const dead = '999999-deadbeef'; // pid that does not exist on this machine
  assert.equal(acquireLease('orphan', 60_000, dead), true);
  assert.equal(acquireLease('orphan', 60_000), true, 'orphaned lease taken over before expiry');
  releaseLease('orphan');
  assert.equal(acquireLease('busy', 60_000, `${process.ppid}-live`), true); // the parent process is alive
  assert.equal(acquireLease('busy', 60_000), false);
  releaseLease('busy', `${process.ppid}-live`);
});

test('telegram scheduler: a channel whose run is in progress (lease held) is skipped, not double-polled', async () => {
  process.env.TELEGRAM_BASE = base;
  const tg = await import('./sources/telegram.ts');
  const sched = await import('./tgscheduler.ts');
  const { acquireLease, releaseLease } = await import('./lease.ts');
  tg.setChannelConfig([{ channel: 'deepch' }]);
  serve(busyChannel('deepch', () => 40));
  acquireLease('tg:deepch', 60_000, 'other-process');
  const c = await sched.runTelegramCycle({ force: true });
  assert.equal(c.ran.length, 0);
  assert.match(c.skipped[0].why, /in progress/);
  releaseLease('tg:deepch', 'other-process');
  const c2 = await sched.runTelegramCycle({ force: true });
  assert.equal(c2.ran.length, 1); assert.ok(c2.ran[0].ok);
});

test('polymarket history: refetch REPLACES the stored series (no accumulated off-grid points); an empty response never wipes it', async () => {
  process.env.POLYMARKET_CLOB_BASE = base;
  const pm = await import('./sources/polymarket.ts');
  db.prepare("INSERT OR REPLACE INTO markets (condition_id, event_id, event_slug, event_title, question, outcome_label, token_id, observed_at, is_open) VALUES ('c1','e','e','E','Q','Yes','tok1','x',1)").run();
  let body = { history: [{ t: 1000, p: 0.1 }, { t: 4600, p: 0.2 }, { t: 5100, p: 0.25 }] }; // 5100 = a trailing "now" point
  serve((_q, res) => res.end(JSON.stringify(body)));
  assert.equal(await pm.ensureHistory('c1', { maxAgeMin: 0 }), 'fetched');
  assert.equal((db.prepare("SELECT COUNT(*) c FROM price_history WHERE condition_id='c1'").get() as { c: number }).c, 3);
  // next refetch: the trailing point is gone and an old point was revised → stored series must equal the new response exactly
  body = { history: [{ t: 1000, p: 0.11 }, { t: 4600, p: 0.2 }, { t: 8200, p: 0.3 }] };
  assert.equal(await pm.ensureHistory('c1', { maxAgeMin: 0 }), 'fetched');
  const rows = db.prepare("SELECT t, p FROM price_history WHERE condition_id='c1' ORDER BY t").all() as { t: number; p: number }[];
  assert.deepEqual(rows.map((r) => [r.t, r.p]), [[1000, 0.11], [4600, 0.2], [8200, 0.3]]);
  // provider returns nothing → keep what we have, report error
  body = { history: [] };
  assert.equal(await pm.ensureHistory('c1', { maxAgeMin: 0 }), 'error');
  assert.equal((db.prepare("SELECT COUNT(*) c FROM price_history WHERE condition_id='c1'").get() as { c: number }).c, 3);
});
