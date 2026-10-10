// Bounded, read-only collection from the Polymarket data API v2 (no key, no signing, no trading). Four jobs on the shared
// background scheduler, each with its own cadence/budget in source_config:
//   pm-trades       market tape of the pilot markets (taker-only: each fill once)     — pilot target 5 min
//   pm-wallets      watched wallets: activity (maker + taker) and position snapshots    — 15 min
//   pm-holders      top holders per outcome of the pilot markets (a ranked list only)  — 60 min
//   pm-leaderboard  daily snapshot used for candidate discovery (not a win rate)       — daily
// Incremental sync walks newest-first until it overlaps stored rows. If the page cap is hit first, the missing interval is
// recorded as a gap (continuous coverage restarts) and later runs walk it down from the saved cursor until it is recovered.
import { fetchJson, BudgetExceeded } from '../http.ts';
import { db } from '../db.ts';
import { registerJob } from '../scheduler.ts';
import { runSourceJob } from '../sourcejob.ts';
import { cursorParams, parseActivity, parseHolders, parseLeaderboard, parsePage, parsePositions, parseTrades, type Page } from './parse.ts';
import * as S from './store.ts';

const base = () => process.env.POLYMARKET_DATA_BASE ?? 'https://data-api.polymarket.com';
const url = (path: string, q: Record<string, string | number | boolean | undefined>) => {
  const u = new URL(`${base()}/v2/${path}`);
  for (const [k, v] of Object.entries(q)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
};
const get = (path: string, q: Record<string, string | number | boolean | undefined>) => fetchJson<unknown>(url(path, q), { retries: 2 });

export interface SyncOutcome { target: string; pages: number; fetched: number; inserted: number; rejected: number; status: 'ok' | 'partial'; detail: string }

type Kind = 'trades' | 'activity';
interface Spec {
  path: string; query: Record<string, string | number | boolean | undefined>;
  /** Rows outside the requested filter (e.g. a global-feed page) are rejected, never stored under the wrong target. */
  matches: (raw: Record<string, unknown>) => boolean;
  parse: (raw: Record<string, unknown>[]) => { rows: { ts: number; key: string }[]; rejected: number }; insert: (rows: never[], via: S.SeenVia) => number;
}

const spec = (kind: Kind, id: string): Spec => kind === 'trades'
  ? { path: 'trades', query: { condition: id, limit: 100 }, matches: (r) => r.condition_id === id, parse: parseTrades, insert: S.insertTrades as Spec['insert'] }
  : { path: 'activity', query: { user: id, limit: 100 }, matches: (r) => String(r.proxy_wallet ?? '').toLowerCase() === id, parse: parseActivity, insert: S.insertActivity as Spec['insert'] };

/** Walk older pages from `cursor` (null = newest) until `stop(minTs)` or the page cap; ordinals are assigned over the whole walk. */
async function walk(sp: Spec, cursor: string | null, maxPages: number, stop: (minTs: number) => boolean) {
  const raw: Record<string, unknown>[] = [];
  let pages = 0, next: string | null = cursor, hasMore = true, reached = false, offFilter = 0;
  while (pages < maxPages) {
    // The cursor carries position only; the filter must be sent again on every page.
    const page = parsePage<Record<string, unknown>>(await get(sp.path, next ? { ...sp.query, cursor: next } : sp.query));
    pages++;
    const ok = page.rows.filter(sp.matches);
    offFilter += page.rows.length - ok.length;
    if (offFilter) throw new Error(`upstream returned ${offFilter} row(s) outside the requested filter on page ${pages}; nothing from this walk is stored`);
    raw.push(...ok);
    const ts = page.rows.map((r) => Number(r.timestamp)).filter(Number.isFinite);
    if (ts.length && stop(Math.min(...ts))) { reached = true; next = page.nextCursor; break; }
    hasMore = page.hasMore; next = page.nextCursor;
    if (!hasMore || !next) break; // end of upstream data, or a truncated page (has_more without a cursor: stays incomplete)
  }
  const parsed = sp.parse(raw);
  return { pages, raw: raw.length, parsed, reached, hasMore: hasMore && !reached, next };
}

export async function syncNewest(kind: Kind, id: string, maxPages = 3): Promise<SyncOutcome> {
  const target = `${kind}:${id}`, sp = spec(kind, id), st = S.getSync(target), now = new Date().toISOString();
  const first = st?.newest_ts == null;
  const w = await walk(sp, null, maxPages, (minTs) => !first && minTs <= (st!.newest_ts as number));
  const inserted = sp.insert(w.parsed.rows as never[], first ? 'initial' : 'poll');
  const tss = w.parsed.rows.map((r) => r.ts);
  const oldest = tss.length ? Math.min(...tss) : null, newest = tss.length ? Math.max(...tss) : null;
  let status: 'ok' | 'partial' = 'ok', coveredSince = st?.covered_since ?? null, detail: string;
  if (first) {
    // First contact: covered from the oldest row reached (or the whole upstream window when the walk reached its end).
    coveredSince = w.hasMore ? oldest : 0;
    detail = w.hasMore ? `initial sync: ${w.pages} page(s); older history not fetched (bounded pilot)` : 'initial sync: complete upstream window';
  } else if (w.reached || !w.hasMore) {
    detail = 'caught up with stored rows';
  } else {
    // Page cap hit before reaching stored rows: everything between the stored newest and the oldest fetched row may be missing.
    db.prepare('INSERT INTO pm_gaps (target, from_ts, to_ts, resume_cursor, prior_covered_since, episode_start, opened_at, reason) VALUES (?,?,?,?,?,?,?,?)')
      .run(target, st!.newest_ts, oldest ?? st!.newest_ts, w.next, st?.covered_since ?? null, S.openGaps(target).length ? 0 : 1, now, `catch-up hit its ${maxPages}-page cap before reaching stored rows`);
    status = 'partial'; coveredSince = oldest;
    detail = `gap opened: rows after ${new Date((st!.newest_ts as number) * 1000).toISOString()} and before ${oldest ? new Date(oldest * 1000).toISOString() : '?'} not yet collected`;
  }
  S.putSync(target, { newest_ts: Math.max(st?.newest_ts ?? 0, newest ?? 0) || null, covered_since: coveredSince, last_run_at: now, last_ok_at: now, last_status: status, last_detail: detail, pages: w.pages, upstream_has_more: w.hasMore ? 1 : 0 });
  return { target, pages: w.pages, fetched: w.raw, inserted, rejected: w.parsed.rejected, status, detail };
}

/** Continue each open gap from its saved cursor; resolved only when this walk reaches the gap's lower bound. */
export async function recoverGaps(kind: Kind, id: string, maxPages = 2): Promise<{ pages: number; resolved: number; inserted: number }> {
  const target = `${kind}:${id}`, sp = spec(kind, id);
  let pages = 0, resolved = 0, inserted = 0;
  for (const g of S.openGaps(target)) {
    if (pages >= maxPages || !g.resume_cursor) break;
    const w = await walk(sp, g.resume_cursor, maxPages - pages, (minTs) => minTs <= g.from_ts);
    pages += w.pages; inserted += sp.insert(w.parsed.rows as never[], 'gap');
    const done = w.reached || !w.hasMore;
    db.prepare('UPDATE pm_gaps SET resume_cursor = ?, pages_used = pages_used + ?, resolved_at = ? WHERE id = ?').run(done ? null : w.next, w.pages, done ? new Date().toISOString() : null, g.id);
    if (done) {
      resolved++;
      // With no gap left, continuous coverage extends back to where it was before the earliest gap opened.
      if (!S.openGaps(target).length) {
        const prior = db.prepare('SELECT prior_covered_since p FROM pm_gaps WHERE target = ? AND episode_start = 1 ORDER BY id DESC LIMIT 1').get(target) as { p: number | null } | undefined;
        if (prior && prior.p !== null) S.putSync(target, { covered_since: prior.p });
      }
    }
  }
  return { pages, resolved, inserted };
}

export async function snapshotPositions(wallet: string, maxPages = 2): Promise<{ rows: number; complete: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null, pages = 0, complete = false;
  while (pages < maxPages) {
    const p: Page<Record<string, unknown>> = parsePage<Record<string, unknown>>(await get('positions', { user: wallet, limit: 100, ...(cursor ? { cursor } : {}) }));
    if (p.rows.some((r) => String(r.proxy_wallet ?? '').toLowerCase() !== wallet)) throw new Error('positions page contained rows of another wallet; snapshot not stored');
    pages++; rows.push(...p.rows);
    if (!p.hasMore) { complete = true; break; }
    if (!p.nextCursor) break; // truncated: the snapshot stays partial
    cursor = p.nextCursor;
  }
  const parsed = parsePositions(rows);
  S.replacePositions(wallet, parsed.rows, complete);
  const now = new Date().toISOString();
  S.putSync(`positions:${wallet}`, { last_run_at: now, last_ok_at: now, last_status: complete ? 'ok' : 'partial', last_detail: complete ? `${parsed.rows.length} open position(s)` : `first ${parsed.rows.length} positions only (page cap)`, pages, upstream_has_more: complete ? 0 : 1 });
  return { rows: parsed.rows.length, complete };
}

export async function snapshotHolders(conditionId: string): Promise<number> {
  const p = parsePage<Record<string, unknown>>(await get('holders', { condition: conditionId, limit: 20 }));
  const parsed = parseHolders(p.rows);
  S.replaceHolders(conditionId, parsed.rows, p.hasMore);
  const now = new Date().toISOString();
  S.putSync(`holders:${conditionId}`, { last_run_at: now, last_ok_at: now, last_status: 'ok', last_detail: `${parsed.rows.length} holder rows (top of each outcome only)`, pages: 1, upstream_has_more: p.hasMore ? 1 : 0 });
  return parsed.rows.length;
}

export const LEADERBOARDS = [
  { time_period: 'week', order_by: 'PNL', category: 'overall' },
  { time_period: 'month', order_by: 'PNL', category: 'overall' },
] as const;
/** Unknown parameters are silently ignored upstream, so the applied parameters are read back from the cursor and checked. */
export async function snapshotLeaderboard(): Promise<number> {
  let n = 0;
  for (const lb of LEADERBOARDS) {
    const p = parsePage<Record<string, unknown>>(await get('leaderboard', { ...lb, limit: 25 }));
    const applied = cursorParams(p.nextCursor);
    if (applied && (applied.t !== lb.time_period || applied.s !== lb.order_by || applied.c !== lb.category)) throw new Error(`leaderboard ignored requested parameters (applied ${JSON.stringify(applied)}) — API changed; snapshot not stored`);
    const parsed = parseLeaderboard(p.rows);
    S.insertLeaderboard(lb, parsed.rows); n += parsed.rows.length;
  }
  S.putSync('leaderboard', { last_run_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_status: 'ok', last_detail: `${n} rows`, pages: LEADERBOARDS.length, upstream_has_more: null });
  return n;
}

/** Run `fn` for each target, isolating per-target failures; a spent request budget stops the loop (later targets wait for the next run). */
async function each<T>(targets: string[], fn: (t: string) => Promise<T>, label: (t: string, r: T) => string): Promise<string> {
  const out: string[] = [];
  for (const t of targets) {
    try { out.push(label(t, await fn(t))); }
    catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      out.push(`${t.slice(0, 10)}…: FAILED ${(e as Error).message.slice(0, 80)}`);
      S.putSync(`${t}`, { last_run_at: new Date().toISOString(), last_status: 'error', last_detail: (e as Error).message.slice(0, 200) });
    }
  }
  const failed = out.filter((x) => x.includes('FAILED')).length;
  if (targets.length && failed === targets.length) throw new Error(`all ${targets.length} target(s) failed: ${out[0]}`);
  return out.join('; ') || 'nothing to collect';
}

export const tradeJob = () => each(S.ensurePilotMarkets().map((m) => m.condition_id), async (cid) => {
  const r = await syncNewest('trades', cid);
  const g = await recoverGaps('trades', cid);
  return { r, g };
}, (cid, { r, g }) => `${cid.slice(0, 10)}…: +${r.inserted} trades (${r.pages} p, ${r.status})${g.pages ? `, gap recovery ${g.pages} p/${g.resolved} resolved` : ''}`);

export const walletJob = () => each(S.watchedWallets().map((w) => w.wallet), async (w) => {
  const a = await syncNewest('activity', w);
  const g = await recoverGaps('activity', w);
  const p = await snapshotPositions(w);
  return { a, g, p };
}, (w, { a, g, p }) => `${w.slice(0, 10)}…: +${a.inserted} activity (${a.status})${g.resolved ? `, ${g.resolved} gap(s) recovered` : ''}, ${p.rows} positions${p.complete ? '' : ' (partial)'}`);

export const holdersJob = () => each(S.ensurePilotMarkets().map((m) => m.condition_id), (cid) => snapshotHolders(cid), (cid, n) => `${cid.slice(0, 10)}…: ${n} holders`);

/** Scheduler wiring: each job is due-checked, breaker-guarded and budgeted by runSourceJob; alerts are evaluated after new data. */
export function registerWalletJobs(afterCollect: (sourceId: string) => void) {
  const jobs: [string, () => Promise<string>, () => number][] = [
    ['pm-trades', tradeJob, () => (db.prepare('SELECT COUNT(*) c FROM pm_market_trades').get() as { c: number }).c],
    ['pm-wallets', walletJob, () => (db.prepare('SELECT COUNT(*) c FROM pm_wallet_activity').get() as { c: number }).c],
    ['pm-holders', holdersJob, () => (db.prepare('SELECT COUNT(*) c FROM pm_holders').get() as { c: number }).c],
    ['pm-leaderboard', async () => `${await snapshotLeaderboard()} leaderboard rows`, () => (db.prepare('SELECT COUNT(*) c FROM pm_leaderboard').get() as { c: number }).c],
  ];
  for (const [id, job, items] of jobs) {
    registerJob({
      id, maxRunMs: 10 * 60_000,
      run: async ({ force }) => {
        const r = await runSourceJob(id, job, { force, items });
        if (r.ran) afterCollect(id);
        return r.ran ? `${r.ok ? 'ok' : 'FAILED'}: ${r.detail.slice(0, 200)}` : null;
      },
    });
  }
}
