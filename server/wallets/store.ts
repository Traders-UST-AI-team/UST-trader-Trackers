// Storage for Package E. Every write is idempotent: trade/activity rows are keyed by composite identity and inserted once;
// snapshots (positions, holders) replace the previous snapshot of the same wallet/token; coverage lives in pm_sync / pm_gaps.
import { db, tx } from '../db.ts';
import { bump } from '../versions.ts';
import { API_VERSION, isAddress, type ActivityRow, type HolderRow, type LeaderRow, type PositionRow, type TradeRow } from './parse.ts';

export const MAX_WATCHED = 20;
export const MAX_PILOT = 10;
export type SeenVia = 'initial' | 'poll' | 'gap';

function upsertProfile(wallet: string, name: string | null, pseudonym: string | null, at: string) {
  if (!name && !pseudonym) return;
  // Only the public, self-chosen display name and the platform pseudonym; no bio, images or linked social accounts are stored.
  db.prepare(`INSERT INTO pm_profiles (wallet, display_name, pseudonym, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(wallet) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name), pseudonym = COALESCE(excluded.pseudonym, pseudonym), updated_at = excluded.updated_at`)
    .run(wallet, name, pseudonym, at);
}

export function insertTrades(rows: TradeRow[], via: SeenVia): number {
  const at = new Date().toISOString();
  let n = 0;
  tx(() => {
    const ins = db.prepare(`INSERT OR IGNORE INTO pm_market_trades (key, condition_id, token_id, outcome, outcome_index, wallet, side, size_shares, price_usdc, notional_usdc, ts, tx_hash, first_seen_at, seen_via, api_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) {
      n += Number(ins.run(r.key, r.condition_id, r.token_id, r.outcome, r.outcome_index, r.wallet, r.side, r.size_shares, r.price_usdc, r.notional_usdc, r.ts, r.tx_hash, at, via, API_VERSION).changes);
      upsertProfile(r.wallet, r.display_name, r.pseudonym, at);
    }
  });
  if (n) bump('pm-trades');
  return n;
}

export function insertActivity(rows: ActivityRow[], via: SeenVia): number {
  const at = new Date().toISOString();
  let n = 0;
  tx(() => {
    const ins = db.prepare(`INSERT OR IGNORE INTO pm_wallet_activity (key, wallet, type, condition_id, token_id, outcome, outcome_index, side, size, usdc_size, price_usdc, ts, tx_hash, title, first_seen_at, seen_via, api_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) {
      n += Number(ins.run(r.key, r.wallet, r.type, r.condition_id, r.token_id, r.outcome, r.outcome_index, r.side, r.size, r.usdc_size, r.price_usdc, r.ts, r.tx_hash, r.title, at, via, API_VERSION).changes);
      upsertProfile(r.wallet, r.display_name, r.pseudonym, at);
    }
  });
  if (n) bump('pm-wallets');
  return n;
}

/** Replaces the wallet's position snapshot (positions not returned any more are closed/redeemed, not "sold" — no attribution is made). */
export function replacePositions(wallet: string, rows: PositionRow[], complete: boolean) {
  const at = new Date().toISOString();
  tx(() => {
    if (complete) db.prepare('DELETE FROM pm_positions WHERE wallet = ?').run(wallet);
    const ins = db.prepare(`INSERT OR REPLACE INTO pm_positions (wallet, token_id, condition_id, title, outcome, outcome_index, size_shares, entry_price_usdc, cost_usdc, current_price_usdc, current_value_usdc,
      realized_pnl_usdc, unrealized_pnl_usdc, status, redeemable, end_date, snapshot_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const hist = db.prepare('INSERT OR IGNORE INTO pm_position_history (wallet, token_id, snapshot_at, size_shares, current_value_usdc) VALUES (?,?,?,?,?)');
    for (const r of rows) {
      ins.run(r.wallet, r.token_id, r.condition_id, r.title, r.outcome, r.outcome_index, r.size_shares, r.entry_price_usdc, r.cost_usdc, r.current_price_usdc, r.current_value_usdc,
        r.realized_pnl_usdc, r.unrealized_pnl_usdc, r.status, r.redeemable === null ? null : r.redeemable ? 1 : 0, r.end_date, at);
      hist.run(r.wallet, r.token_id, at, r.size_shares, r.current_value_usdc);
    }
    db.prepare('DELETE FROM pm_position_history WHERE snapshot_at < ?').run(new Date(Date.now() - 30 * 86400e3).toISOString()); // bounded retention
  });
}

export function replaceHolders(conditionId: string, rows: HolderRow[], hasMore: boolean) {
  const at = new Date().toISOString();
  tx(() => {
    for (const token of new Set(rows.map((r) => r.token_id))) db.prepare('DELETE FROM pm_holders WHERE token_id = ?').run(token);
    const ins = db.prepare('INSERT OR REPLACE INTO pm_holders (condition_id, token_id, outcome_index, rank, wallet, amount_shares, snapshot_at, list_has_more) VALUES (?,?,?,?,?,?,?,?)');
    for (const r of rows) { ins.run(conditionId, r.token_id, r.outcome_index, r.rank, r.wallet, r.amount_shares, at, hasMore ? 1 : 0); upsertProfile(r.wallet, r.display_name, r.pseudonym, at); }
  });
}

export function insertLeaderboard(params: { time_period: string; order_by: string; category: string }, rows: LeaderRow[]) {
  const at = new Date().toISOString(), day = at.slice(0, 10);
  tx(() => {
    const ins = db.prepare(`INSERT OR REPLACE INTO pm_leaderboard (snapshot_date, time_period, order_by, category, rank, wallet, pnl_usdc, volume_usdc, display_name, captured_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) { ins.run(day, params.time_period, params.order_by, params.category, r.rank, r.wallet, r.pnl_usdc, r.volume_usdc, r.display_name, at); upsertProfile(r.wallet, r.display_name, null, at); }
  });
}

// ── coverage state ──
export interface SyncState { target: string; newest_ts: number | null; covered_since: number | null; last_run_at: string | null; last_ok_at: string | null; last_status: string | null; last_detail: string | null; pages: number | null; upstream_has_more: number | null }
export const getSync = (target: string): SyncState | null => (db.prepare('SELECT * FROM pm_sync WHERE target = ?').get(target) as SyncState | undefined) ?? null;
export function putSync(target: string, s: Partial<SyncState>) {
  const cur = getSync(target);
  const v = { newest_ts: null, covered_since: null, last_run_at: null, last_ok_at: null, last_status: null, last_detail: null, pages: null, upstream_has_more: null, ...cur, ...s };
  db.prepare(`INSERT OR REPLACE INTO pm_sync (target, newest_ts, covered_since, last_run_at, last_ok_at, last_status, last_detail, pages, upstream_has_more) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(target, v.newest_ts, v.covered_since, v.last_run_at, v.last_ok_at, v.last_status, v.last_detail, v.pages, v.upstream_has_more);
}
export interface Gap { id: number; target: string; from_ts: number; to_ts: number; resume_cursor: string | null; opened_at: string; resolved_at: string | null; pages_used: number; reason: string }
export const openGaps = (target: string): Gap[] => db.prepare('SELECT * FROM pm_gaps WHERE target = ? AND resolved_at IS NULL ORDER BY to_ts DESC').all(target) as unknown as Gap[];

// ── watch list & pilot markets ──
export interface WatchRow { wallet: string; note: string | null; selection_rule: string; selected_at: string; added_by: string }
export const watchedWallets = (): WatchRow[] => db.prepare('SELECT * FROM pm_watch_wallets ORDER BY selected_at').all() as unknown as WatchRow[];
export function addWatch(wallet: unknown, note: unknown, selectionRule: unknown): { ok: true } | { ok: false; error: string } {
  if (!isAddress(wallet)) return { ok: false, error: 'wallet must be a 0x-prefixed 40-hex-digit address' };
  const w = wallet.toLowerCase();
  if (!db.prepare('SELECT 1 FROM pm_watch_wallets WHERE wallet = ?').get(w) && watchedWallets().length >= MAX_WATCHED) return { ok: false, error: `at most ${MAX_WATCHED} watched wallets in this pilot` };
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 200)) return { ok: false, error: 'note must be text of at most 200 characters' };
  // The selection rule and time are frozen when a wallet is added, so later results cannot be back-fitted to the choice.
  const rule = typeof selectionRule === 'string' && selectionRule.trim() ? selectionRule.trim().slice(0, 300) : 'added manually by the user';
  db.prepare(`INSERT INTO pm_watch_wallets (wallet, note, selection_rule, selected_at, added_by) VALUES (?,?,?,?, 'user')
    ON CONFLICT(wallet) DO UPDATE SET note = excluded.note`).run(w, (note as string | undefined) ?? null, rule, new Date().toISOString());
  return { ok: true };
}
export const removeWatch = (wallet: string): boolean => Number(db.prepare('DELETE FROM pm_watch_wallets WHERE wallet = ?').run(wallet.toLowerCase()).changes) > 0;

export interface PilotRow { condition_id: string; selection_rule: string; selected_at: string; added_by: string }
export const pilotMarkets = (): PilotRow[] => db.prepare('SELECT * FROM pm_pilot_markets ORDER BY selected_at, condition_id').all() as unknown as PilotRow[];
/** First use: the 8 open Polymarket contracts with the highest 24h volume among this tracker's (Middle East / energy) markets. */
export function ensurePilotMarkets(): PilotRow[] {
  if (pilotMarkets().length) return pilotMarkets();
  const at = new Date().toISOString();
  const rule = `default pilot: top 8 open Polymarket contracts by 24h volume among tracked Middle East/energy markets, selected ${at}`;
  const top = db.prepare("SELECT condition_id FROM markets WHERE venue = 'polymarket' AND is_open = 1 AND price IS NOT NULL ORDER BY volume_24h DESC NULLS LAST LIMIT 8").all() as { condition_id: string }[];
  for (const t of top) db.prepare("INSERT OR IGNORE INTO pm_pilot_markets (condition_id, selection_rule, selected_at, added_by) VALUES (?,?,?, 'default')").run(t.condition_id, rule, at);
  return pilotMarkets();
}
export function setPilotMarkets(ids: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PILOT) return { ok: false, error: `pilot markets must be 1–${MAX_PILOT} condition ids` };
  for (const id of ids) if (typeof id !== 'string' || !db.prepare("SELECT 1 FROM markets WHERE condition_id = ? AND venue = 'polymarket'").get(id)) return { ok: false, error: `unknown Polymarket contract ${String(id)}` };
  const at = new Date().toISOString();
  tx(() => {
    db.prepare(`DELETE FROM pm_pilot_markets WHERE condition_id NOT IN (${ids.map(() => '?').join(',')})`).run(...(ids as string[]));
    for (const id of ids as string[]) db.prepare("INSERT OR IGNORE INTO pm_pilot_markets (condition_id, selection_rule, selected_at, added_by) VALUES (?, 'selected by the user', ?, 'user')").run(id, at);
  });
  return { ok: true };
}
