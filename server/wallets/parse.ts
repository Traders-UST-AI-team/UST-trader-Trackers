// Pure parsers for the Polymarket data API v2 (https://data-api.polymarket.com/v2/*), verified against live responses on 2026-10-09
// (fixtures in server/fixtures/polymarket_v2_*.json). Facts this module relies on:
//   • envelope {data, pagination{limit, offset, has_more, next_cursor}}; continue with ?cursor=<next_cursor> until null
//   • trade/activity rows have NO unique id; one transaction can carry several rows → composite key + occurrence ordinal
//   • size = shares; price = USDC per share; activity rows also carry usdc_size
//   • /v2/trades defaults to taker_only=true (each fill once — the market tape); for a single wallet, /v2/activity TRADE rows equal
//     /v2/trades?taker_only=false (maker fills included) — measured: 260 vs 8 rows for one high-volume wallet over one hour
//   • unknown query parameters are silently ignored → the leaderboard's applied params are read back from its cursor
//   • a cursor does NOT carry the query's filters: a cursor-only request returns the GLOBAL feed. Every follow-up page must
//     repeat the original parameters, and rows outside the requested filter are rejected (measured 2026-10-09)
import { createHash } from 'node:crypto';

export const API_VERSION = 'v2';

/** hasMore = upstream says more rows exist; nextCursor may still be null (a truncated page) — then coverage is incomplete. */
export interface Page<T> { rows: T[]; hasMore: boolean; nextCursor: string | null }
export function parsePage<T = Record<string, unknown>>(body: unknown): Page<T> {
  const b = body as { data?: unknown; pagination?: { has_more?: unknown; next_cursor?: unknown }; error?: unknown };
  if (!b || typeof b !== 'object') throw new Error('response is not an object');
  if (b.error) throw new Error(`upstream error: ${String(b.error)}`);
  if (!Array.isArray(b.data)) throw new Error('response has no data array (schema changed?)');
  const next = typeof b.pagination?.next_cursor === 'string' && b.pagination.next_cursor ? b.pagination.next_cursor : null;
  return { rows: b.data as T[], hasMore: b.pagination?.has_more === true, nextCursor: next };
}

/** The opaque cursor is base64url JSON whose `params` echo what the server actually applied (used to verify silent-ignore cases). */
export function cursorParams(cursor: string | null): Record<string, unknown> | null {
  if (!cursor) return null;
  try { return (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { data?: { params?: Record<string, unknown> } }).data?.params ?? null; } catch { return null; }
}

const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
const addr = (v: unknown): string | null => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
export const isAddress = (v: unknown): v is string => addr(v) !== null;

/** Assigns `#n` to the n-th occurrence of an identical base key within one fetched sequence (all pages of one run, in order). */
function withOrdinals<T extends { key: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((r) => { const n = seen.get(r.key) ?? 0; seen.set(r.key, n + 1); return { ...r, key: `${r.key}#${n}` }; });
}
const digest = (parts: unknown[]) => createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 32);

export interface TradeRow {
  key: string; condition_id: string; token_id: string; outcome: string; outcome_index: number; wallet: string; side: 'BUY' | 'SELL';
  size_shares: number; price_usdc: number; notional_usdc: number; ts: number; tx_hash: string; display_name: string | null; pseudonym: string | null;
}
/** Market-tape trades. Rows missing a field needed for identity or money are rejected (counted), never guessed. */
export function parseTrades(raw: Record<string, unknown>[]): { rows: TradeRow[]; rejected: number } {
  const out: TradeRow[] = []; let rejected = 0;
  for (const r of raw) {
    const wallet = addr(r.proxy_wallet), size = num(r.size), price = num(r.price), ts = num(r.timestamp), oi = num(r.outcome_index);
    const side = r.side === 'BUY' || r.side === 'SELL' ? r.side : null;
    const cond = str(r.condition_id), token = str(r.token_id), tx = str(r.transaction_hash), outcome = str(r.outcome);
    if (!wallet || size === null || price === null || ts === null || !side || !cond || !token || !tx || !outcome || oi === null || price < 0 || price > 1 || size <= 0) { rejected++; continue; }
    out.push({
      key: `t:${digest([tx, wallet, token, side, size, price, ts])}`, condition_id: cond, token_id: token, outcome, outcome_index: oi, wallet, side,
      size_shares: size, price_usdc: price, notional_usdc: size * price, ts, tx_hash: tx, display_name: str(r.name), pseudonym: str(r.pseudonym),
    });
  }
  return { rows: withOrdinals(out), rejected };
}

export interface ActivityRow {
  key: string; wallet: string; type: string; condition_id: string | null; token_id: string | null; outcome: string | null; outcome_index: number | null;
  side: 'BUY' | 'SELL' | null; size: number | null; usdc_size: number | null; price_usdc: number | null; ts: number; tx_hash: string; title: string | null;
  display_name: string | null; pseudonym: string | null;
}
/** Wallet activity: TRADE (maker + taker), REDEEM, SPLIT, MERGE, REWARD, YIELD, TAKER_REBATE, CONVERSION … kept with their raw type. */
export function parseActivity(raw: Record<string, unknown>[]): { rows: ActivityRow[]; rejected: number } {
  const out: ActivityRow[] = []; let rejected = 0;
  for (const r of raw) {
    const wallet = addr(r.proxy_wallet), ts = num(r.timestamp), type = str(r.type), tx = str(r.transaction_hash);
    if (!wallet || ts === null || !type || !tx) { rejected++; continue; }
    const side = r.side === 'BUY' || r.side === 'SELL' ? r.side : null;
    const token = str(r.token_id), cond = str(r.condition_id);
    if (type === 'TRADE' && (!side || !token || num(r.usdc_size) === null)) { rejected++; continue; }
    out.push({
      key: `a:${digest([type, tx, wallet, cond, token, side, num(r.size), num(r.usdc_size), ts])}`, wallet, type, condition_id: cond, token_id: token,
      outcome: str(r.outcome), outcome_index: num(r.outcome_index), side, size: num(r.size), usdc_size: num(r.usdc_size), price_usdc: num(r.price) || null,
      ts, tx_hash: tx, title: str(r.title), display_name: str(r.name), pseudonym: str(r.pseudonym),
    });
  }
  return { rows: withOrdinals(out), rejected };
}

export interface PositionRow {
  wallet: string; token_id: string; condition_id: string; title: string | null; outcome: string | null; outcome_index: number | null;
  size_shares: number | null; entry_price_usdc: number | null; cost_usdc: number | null; current_price_usdc: number | null; current_value_usdc: number | null;
  /** Provider-reported; null when absent — never assumed to be 0. */
  realized_pnl_usdc: number | null; unrealized_pnl_usdc: number | null; status: string | null; redeemable: boolean | null; end_date: string | null;
}
export function parsePositions(raw: Record<string, unknown>[]): { rows: PositionRow[]; rejected: number } {
  const out: PositionRow[] = []; let rejected = 0;
  for (const r of raw) {
    const wallet = addr(r.proxy_wallet), token = str(r.token_id), cond = str(r.condition_id);
    if (!wallet || !token || !cond) { rejected++; continue; }
    out.push({
      wallet, token_id: token, condition_id: cond, title: str(r.title), outcome: str(r.outcome), outcome_index: num(r.outcome_index),
      size_shares: num(r.current_size), entry_price_usdc: num(r.avg_price), cost_usdc: num(r.total_cost_usdc ?? r.entry_cost_usdc), current_price_usdc: num(r.current_price),
      current_value_usdc: num(r.current_value), realized_pnl_usdc: num(r.realized_pnl), unrealized_pnl_usdc: num(r.unrealized_pnl), status: str(r.status),
      redeemable: typeof r.redeemable === 'boolean' ? r.redeemable : null, end_date: str(r.end_date),
    });
  }
  return { rows: out, rejected };
}

export interface HolderRow { token_id: string; outcome_index: number | null; rank: number; wallet: string; amount_shares: number; display_name: string | null; pseudonym: string | null }
/** /v2/holders returns one group per outcome token, each a ranked list of the largest holders (not the whole distribution). */
export function parseHolders(raw: Record<string, unknown>[]): { rows: HolderRow[]; rejected: number } {
  const out: HolderRow[] = []; let rejected = 0;
  for (const g of raw) {
    const token = str(g.token_id);
    const list = Array.isArray(g.holders) ? (g.holders as Record<string, unknown>[]) : [];
    if (!token) { rejected += list.length || 1; continue; }
    list.forEach((h, i) => {
      const wallet = addr(h.proxy_wallet), amount = num(h.amount);
      if (!wallet || amount === null) { rejected++; return; }
      out.push({ token_id: token, outcome_index: num(h.outcome_index), rank: i + 1, wallet, amount_shares: amount, display_name: h.display_username_public === false ? null : str(h.name), pseudonym: str(h.pseudonym) });
    });
  }
  return { rows: out, rejected };
}

export interface LeaderRow { rank: number; wallet: string; pnl_usdc: number | null; volume_usdc: number | null; display_name: string | null }
export function parseLeaderboard(raw: Record<string, unknown>[]): { rows: LeaderRow[]; rejected: number } {
  const out: LeaderRow[] = []; let rejected = 0;
  for (const r of raw) {
    const wallet = addr(r.user_id ?? r.proxy_wallet), rank = num(r.rank);
    if (!wallet || rank === null) { rejected++; continue; }
    out.push({ rank, wallet, pnl_usdc: num(r.pnl), volume_usdc: num(r.volume ?? r.vol), display_name: str(r.user_name) });
  }
  return { rows: out, rejected };
}
