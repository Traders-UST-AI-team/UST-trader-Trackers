// Package E: Polymarket wallet activity — parsing of REAL v2 responses (server/fixtures/polymarket_v2_*.json, captured 2026-10-09),
// identity/dedupe, bounded incremental collection with coverage gaps (against a local fake of the v2 API), and the read model.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-wallets-')), 't.sqlite');
process.env.HTTP_MIN_GAP_MS = '0';
process.env.HTTP_BACKOFF_MS = '5';
const { db } = await import('./db.ts');
const P = await import('./wallets/parse.ts');
const S = await import('./wallets/store.ts');
const C = await import('./wallets/collect.ts');
const A = await import('./wallets/analytics.ts');

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/polymarket_v2_${n}.json`, import.meta.url), 'utf8'));

// ── fake v2 API: newest-first pages with opaque cursors ──
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_q, r) => r.end('{}');
let hits = 0;
const server = createServer((q, r) => { hits++; handler(q, r); });
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
process.env.POLYMARKET_DATA_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => { server.closeAllConnections(); server.close(); });

const W1 = '0x1111111111111111111111111111111111111111', W2 = '0x2222222222222222222222222222222222222222';
const COND = '0x' + 'c'.repeat(64);
const T0 = Math.floor(Date.now() / 1000);
const trade = (i: number, extra: Record<string, unknown> = {}) => ({ proxy_wallet: i % 2 ? W1 : W2, side: 'BUY', token_id: 'tokYES', condition_id: COND, size: 100 + i, price: 0.5, timestamp: T0 - 10_000 + i * 10, outcome: 'Yes', outcome_index: 0, transaction_hash: `0xtx${i}`, ...extra });
/** Serves `rows` (sorted newest first) in pages of `limit`; cursor = base64url(JSON{o: offset}) like the real opaque cursor. */
const OTHER = '0x' + 'e'.repeat(64);
/** Like the real v2 API: the cursor encodes position only; a request without the filter is answered from the GLOBAL feed. */
function servePages(getRows: () => Record<string, unknown>[], opts: { repeatFirstPage?: boolean; truncateAfter?: number } = {}) {
  handler = (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const filtered = u.searchParams.has('condition') || u.searchParams.has('user');
    const globalNoise = Array.from({ length: 500 }, (_, i) => ({ ...trade(5000 + i), condition_id: OTHER, proxy_wallet: '0x' + '7'.repeat(40), transaction_hash: `0xg${i}` }));
    const rows = [...(filtered ? getRows() : globalNoise)].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    const c = u.searchParams.get('cursor');
    const off = c ? (JSON.parse(Buffer.from(c, 'base64url').toString()) as { o: number }).o : 0;
    const limit = Number(u.searchParams.get('limit') ?? 100);
    const start = opts.repeatFirstPage && c ? 0 : off;
    const data = rows.slice(start, start + limit);
    const more = start + limit < rows.length;
    const truncated = opts.truncateAfter !== undefined && start + limit >= opts.truncateAfter;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data, pagination: { limit, offset: start, has_more: more, next_cursor: more && !truncated ? Buffer.from(JSON.stringify({ o: start + limit })).toString('base64url') : null } }));
  };
}

test('parse: real v2 trades/activity/positions/holders/leaderboard map to typed rows with units preserved', () => {
  const t = P.parseTrades(fx('trades').data);
  assert.equal(t.rejected, 0); assert.equal(t.rows.length, fx('trades').data.length);
  const r0 = fx('trades').data[0];
  assert.equal(t.rows[0].size_shares, r0.size); assert.equal(t.rows[0].price_usdc, r0.price);
  assert.ok(Math.abs(t.rows[0].notional_usdc - r0.size * r0.price) < 1e-9, 'notional = shares × USDC/share');
  assert.equal(t.rows[0].wallet, r0.proxy_wallet.toLowerCase());
  const a = P.parseActivity(fx('activity').data);
  assert.equal(a.rejected, 0);
  assert.ok(a.rows.every((r) => r.type !== 'TRADE' || (r.usdc_size !== null && r.side)));
  const p = P.parsePositions(fx('positions').data);
  assert.equal(p.rejected, 0); assert.ok(p.rows[0].realized_pnl_usdc !== undefined);
  const h = P.parseHolders(fx('holders').data);
  assert.ok(h.rows.length > 0 && h.rows[0].rank === 1);
  const l = P.parseLeaderboard(fx('leaderboard').data);
  assert.equal(l.rows[0].rank, 1); assert.match(l.rows[0].wallet, /^0x[0-9a-f]{40}$/);
  // the leaderboard cursor echoes the parameters the server applied (used to detect silently ignored params)
  assert.deepEqual(P.cursorParams(fx('leaderboard').pagination.next_cursor), { l: 10, o: 10, s: 'PNL', t: 'day', c: 'overall' });
});

test('identity: one transaction with several rows keeps every row; identical rows get ordinals; keys are deterministic', () => {
  const same = trade(1);
  const rows = [same, { ...same }, { ...same, token_id: 'tokNO', outcome: 'No', outcome_index: 1 }, { ...same, proxy_wallet: W2 }];
  const k1 = P.parseTrades(rows).rows.map((r) => r.key), k2 = P.parseTrades(rows).rows.map((r) => r.key);
  assert.deepEqual(k1, k2);
  assert.equal(new Set(k1).size, 4, 'same tx hash, four distinct fills');
  assert.ok(k1[0].endsWith('#0') && k1[1].endsWith('#1'));
  const bad = P.parseTrades([{ ...same, price: 1.4 }, { ...same, proxy_wallet: 'nope' }, { ...same, side: undefined }]);
  assert.equal(bad.rejected, 3, 'rows missing identity or money fields are rejected, never guessed');
});

test('collection: first sync, incremental poll, page-cap gap, recovery from the saved cursor, repeated pages', async () => {
  let rows = Array.from({ length: 250 }, (_, i) => trade(i));
  servePages(() => rows);
  const r1 = await C.syncNewest('trades', COND);
  assert.deepEqual([r1.pages, r1.inserted, r1.status], [3, 250, 'ok']);
  assert.equal(S.getSync(`trades:${COND}`)!.covered_since, 0, 'whole upstream window reached');
  assert.equal((db.prepare("SELECT COUNT(*) c FROM pm_market_trades WHERE seen_via = 'initial'").get() as { c: number }).c, 250);
  // 30 new trades: one page reaches stored rows; they are "poll" arrivals
  rows = [...rows, ...Array.from({ length: 30 }, (_, i) => trade(300 + i))];
  const r2 = await C.syncNewest('trades', COND);
  assert.deepEqual([r2.pages, r2.inserted, r2.status], [1, 30, 'ok']);
  // 400 new trades: the 3-page cap ends before stored rows → durable gap, continuous coverage restarts
  rows = [...rows, ...Array.from({ length: 400 }, (_, i) => trade(1000 + i))];
  const r3 = await C.syncNewest('trades', COND);
  assert.equal(r3.status, 'partial'); assert.equal(r3.inserted, 300);
  assert.equal(S.openGaps(`trades:${COND}`).length, 1);
  assert.ok(S.getSync(`trades:${COND}`)!.covered_since! > 0);
  const g = await C.recoverGaps('trades', COND, 3);
  assert.equal(g.resolved, 1); assert.equal(g.inserted, 100);
  assert.equal(S.openGaps(`trades:${COND}`).length, 0);
  assert.equal(S.getSync(`trades:${COND}`)!.covered_since, 0, 'coverage restored to where it was before the gap');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM pm_market_trades').get() as { c: number }).c, 680);
  // a broken upstream that repeats its first page for every cursor: nothing is duplicated
  servePages(() => rows, { repeatFirstPage: true });
  const r4 = await C.syncNewest('trades', COND);
  assert.equal(r4.inserted, 0);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM pm_market_trades').get() as { c: number }).c, 680);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM pm_market_trades WHERE condition_id != ?').get(COND) as { c: number }).c, 0, 'no global-feed rows stored');
});

test('collection: a page outside the requested filter aborts the walk and stores nothing from it', async () => {
  handler = (_req, res) => res.end(JSON.stringify({ data: [trade(1, { condition_id: OTHER, transaction_hash: '0xzz' })], pagination: { has_more: false, next_cursor: null } }));
  await assert.rejects(C.syncNewest('trades', '0x' + 'f'.repeat(64)), /outside the requested filter/);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM pm_market_trades WHERE condition_id = ?').get(OTHER) as { c: number }).c, 0);
});

test('collection: a truncated page (has_more without a cursor) leaves coverage incomplete', async () => {
  const cond2 = '0x' + 'd'.repeat(64);
  servePages(() => Array.from({ length: 150 }, (_, i) => trade(i, { condition_id: cond2, transaction_hash: `0xd${i}` })), { truncateAfter: 100 });
  const r = await C.syncNewest('trades', cond2);
  assert.equal(r.pages, 1);
  assert.ok(S.getSync(`trades:${cond2}`)!.covered_since! > 0, 'not marked as the whole window');
});

test('net trade value: per market AND outcome, maker+taker trades only, never summed across outcomes, partial coverage excluded', async () => {
  assert.equal(S.addWatch(W1, 'test', undefined).ok, true);
  assert.equal(S.addWatch(W2, null, 'leaderboard week PNL rank 3 on 2026-10-09').ok, true);
  const act = (w: string, i: number, type: string, side: string | null, outcome: string, oi: number, usdc: number, ago: number) =>
    ({ proxy_wallet: w, timestamp: T0 - ago, condition_id: COND, type, size: usdc * 2, usdc_size: usdc, transaction_hash: `0xa${w.slice(2, 4)}${i}`, price: 0.5, token_id: oi ? 'tokNO' : 'tokYES', side, outcome_index: oi, outcome, title: 'Test market' });
  const w1rows = [act(W1, 1, 'TRADE', 'BUY', 'No', 1, 100, 3600), act(W1, 2, 'TRADE', 'SELL', 'No', 1, 40, 1800), act(W1, 3, 'TRADE', 'BUY', 'Yes', 0, 10, 600),
    act(W1, 4, 'REDEEM', null, 'Yes', 0, 500, 300), act(W1, 5, 'TRADE', 'BUY', 'Yes', 0, 999, 9 * 86400)];
  servePages(() => w1rows);
  await C.syncNewest('activity', W1);
  // W2: activity known only from a recent point (a page-capped first sync), so its coverage does not span 24 h
  servePages(() => [act(W2, 1, 'TRADE', 'BUY', 'Yes', 0, 5000, 60)]);
  await C.syncNewest('activity', W2);
  S.putSync(`activity:${W2}`, { covered_since: T0 - 600 });
  const n = A.netTradeValue(24);
  assert.equal(n.label, 'Watched-wallet net trade value');
  assert.match(n.note, /not whole-market net capital inflow/);
  assert.equal(n.status, 'partial');
  assert.deepEqual(n.partial_wallets.map((p) => p.wallet), [W2]);
  const no = n.by_market_outcome.find((r) => r.outcome === 'No')!, yes = n.by_market_outcome.find((r) => r.outcome === 'Yes')!;
  assert.equal(no.net_usdc, 60); assert.equal(yes.net_usdc, 10, 'old trade outside the window and the partial wallet are excluded');
  assert.equal(n.excluded_activity.REDEEM, 1, 'settlement is counted separately, not as a trade');
  assert.ok(!('total_net_usdc' in n), 'no figure across outcomes');
});

test('positions: missing provider PnL stays null (never 0); a complete snapshot replaces the previous one', async () => {
  servePages(() => [
    { proxy_wallet: W1, token_id: 'tokYES', condition_id: COND, current_size: 10, avg_price: 0.4, current_price: 0.5, current_value: 5, realized_pnl: 1, unrealized_pnl: 1, status: 'OPEN', title: 'Test market', outcome: 'Yes', outcome_index: 0 },
    { proxy_wallet: W1, token_id: 'tokNO', condition_id: COND, current_size: 4, current_value: 2, status: 'OPEN', title: 'Test market', outcome: 'No', outcome_index: 1 },
  ]);
  await C.snapshotPositions(W1);
  const v = A.watchedViews().find((x) => x.wallet === W1)!;
  assert.equal(v.open_positions, 2);
  assert.equal(v.provider_unrealized_pnl_usdc, null, 'one position lacks PnL → the sum is unknown');
  servePages(() => []);
  await C.snapshotPositions(W1);
  assert.equal(A.watchedViews().find((x) => x.wallet === W1)!.open_positions, 0);
});

test('large trades: each row states which screening criterion it met', () => {
  db.prepare("INSERT OR IGNORE INTO markets (condition_id, event_id, event_slug, event_title, question, outcome_label, token_id, observed_at, is_open, venue, price) VALUES (?, 'e','e','E','Will X?','Yes','tokYES','x',1,'polymarket',0.5)").run(COND);
  S.setPilotMarkets([COND]);
  db.prepare("INSERT INTO pm_market_trades (key, condition_id, token_id, outcome, outcome_index, wallet, side, size_shares, price_usdc, notional_usdc, ts, tx_hash, first_seen_at, seen_via, api_version) VALUES ('big', ?, 'tokNO', 'No', 1, ?, 'BUY', 40000, 0.5, 20000, ?, '0xbig', 'x', 'poll', 'v2')").run(COND, W2, T0);
  const lt = A.largeTrades({ conditionId: COND });
  const big = lt.find((t) => t.key === 'big')!;
  assert.ok(big.criteria.some((c) => c.startsWith('≥ 10,000 USDC')));
  assert.ok(big.criteria.some((c) => /P95/.test(c)), 'the market has ≥ 50 stored trades, so its own P95 applies');
  assert.equal(big.outcome, 'No', 'outcome is explicit: buying NO is not buying YES');
  assert.ok(lt.every((t) => t.criteria.length > 0));
});

test('watch list: address validated, at most 20, selection rule frozen at the time of choice', () => {
  assert.equal(S.addWatch('0x123', null, undefined).ok, false);
  assert.equal(S.addWatch(W1, 'x'.repeat(201), undefined).ok, false);
  for (let i = 0; i < 18; i++) assert.ok(S.addWatch(`0x${String(i).padStart(40, 'a')}`, null, undefined).ok);
  const r = S.addWatch(`0x${'b'.repeat(40)}`, null, undefined);
  assert.equal(r.ok, false);
  const w2 = S.watchedWallets().find((w) => w.wallet === W2)!;
  assert.equal(w2.selection_rule, 'leaderboard week PNL rank 3 on 2026-10-09');
  S.addWatch(W2, 'new note', 'some later rule');
  assert.equal(S.watchedWallets().find((w) => w.wallet === W2)!.selection_rule, 'leaderboard week PNL rank 3 on 2026-10-09', 'rule cannot be rewritten afterwards');
});

test('leaderboard: a silently ignored parameter is detected from the cursor and nothing is stored', async () => {
  handler = (_q, res) => res.end(JSON.stringify({ data: fx('leaderboard').data, pagination: fx('leaderboard').pagination })); // cursor says t=day
  await assert.rejects(C.snapshotLeaderboard(), /ignored requested parameters/);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM pm_leaderboard').get() as { c: number }).c, 0);
  hits = 0;
});
