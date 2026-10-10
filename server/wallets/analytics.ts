// Read model for the Wallet activity view. Three things are kept apart (plan §9): large single trades, position concentration
// (only as returned — no complete denominator is available), and provider-reported performance. Nothing here is a
// "smart money" score; an address is a pseudonymous key, not an identified person or institution.
import { db, kvGet, kvSet } from '../db.ts';
import { quantile7 } from '../../shared/indicators.ts';
import { configOf } from '../sourceconfig.ts';
import * as S from './store.ts';
import type {
  CoverageView, HolderGroup, LargeTrade, LeaderboardSnapshot, NetTradeValue, PilotMarketView, WalletActivityItem, WalletDetail, WalletPositionItem, WalletsOverview, WatchedWalletView,
} from '../../shared/types.ts';

type Row = Record<string, any>;
export const NET_LABEL = 'Watched-wallet net trade value';
export const DEFAULT_LARGE_USDC = 10_000;
const P95_MIN_N = 50;

export const largeTradeUsdc = (): number => Number(kvGet('wallet_large_trade_usdc') ?? DEFAULT_LARGE_USDC);
export function setLargeTradeUsdc(v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 100 || v > 10_000_000) return { ok: false, error: 'large-trade threshold must be a number of USDC between 100 and 10,000,000' };
  kvSet('wallet_large_trade_usdc', String(v));
  return { ok: true, value: v };
}

const nameOf = (wallet: string): { display_name: string | null; pseudonym: string | null } =>
  (db.prepare('SELECT display_name, pseudonym FROM pm_profiles WHERE wallet = ?').get(wallet) as { display_name: string | null; pseudonym: string | null } | undefined) ?? { display_name: null, pseudonym: null };
const watchedSet = () => new Set(S.watchedWallets().map((w) => w.wallet));

export function coverageOf(target: string, intervalMin: number, now = Date.now()): CoverageView {
  const st = S.getSync(target), gaps = S.openGaps(target);
  const lastOk = st?.last_ok_at ? Date.parse(st.last_ok_at) : null;
  const stale = lastOk === null || now - lastOk > 3 * intervalMin * 60_000;
  return {
    target, covered_since: st?.covered_since == null ? null : st.covered_since === 0 ? 'upstream window start' : new Date(st.covered_since * 1000).toISOString(),
    covered_since_ts: st?.covered_since ?? null, last_ok_at: st?.last_ok_at ?? null, last_status: st?.last_status ?? 'never', last_detail: st?.last_detail ?? null, stale,
    open_gaps: gaps.map((g) => ({ from: new Date(g.from_ts * 1000).toISOString(), to: new Date(g.to_ts * 1000).toISOString(), opened_at: g.opened_at, pages_used: g.pages_used })),
  };
}

/** P95 of a market's stored trade notionals (type-7), only when at least 50 trades are stored. */
export function marketP95(conditionId: string): { p95: number | null; n: number } {
  const v = (db.prepare('SELECT notional_usdc v FROM pm_market_trades WHERE condition_id = ? ORDER BY notional_usdc').all(conditionId) as { v: number }[]).map((r) => r.v);
  return { p95: v.length >= P95_MIN_N ? quantile7(v, 0.95) : null, n: v.length };
}

export function largeTrades(opts: { conditionId?: string; sinceTs?: number; limit?: number } = {}): LargeTrade[] {
  const thr = largeTradeUsdc(), watched = watchedSet();
  const markets = opts.conditionId ? [opts.conditionId] : S.pilotMarkets().map((m) => m.condition_id);
  const out: LargeTrade[] = [];
  for (const cid of markets) {
    const { p95, n } = marketP95(cid);
    const floor = p95 === null ? thr : Math.min(thr, p95);
    const rows = db.prepare(`SELECT t.*, m.question FROM pm_market_trades t LEFT JOIN markets m ON m.condition_id = t.condition_id
      WHERE t.condition_id = ? AND t.notional_usdc >= ? AND t.ts >= ? ORDER BY t.ts DESC LIMIT ?`).all(cid, floor, opts.sinceTs ?? 0, opts.limit ?? 50) as Row[];
    for (const r of rows) {
      const criteria: string[] = [];
      if (r.notional_usdc >= thr) criteria.push(`≥ ${thr.toLocaleString('en-US')} USDC`);
      if (p95 !== null && r.notional_usdc >= p95) criteria.push(`≥ this market's P95 trade (${Math.round(p95).toLocaleString('en-US')} USDC, n=${n})`);
      out.push({
        key: r.key, condition_id: r.condition_id, question: r.question ?? r.condition_id, outcome: r.outcome, outcome_index: r.outcome_index, side: r.side,
        size_shares: r.size_shares, price_usdc: r.price_usdc, notional_usdc: r.notional_usdc, ts: r.ts, at: new Date(r.ts * 1000).toISOString(), tx_hash: r.tx_hash,
        wallet: r.wallet, ...nameOf(r.wallet), watched: watched.has(r.wallet), criteria, first_seen_at: r.first_seen_at, seen_via: r.seen_via,
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, opts.limit ?? 50);
}

/**
 * Parsed, deduplicated TRADE activity of watched wallets only: BUY usdc − SELL usdc per market AND outcome, within a window.
 * Never summed across outcomes (buying NO is not buying YES) and never presented as market inflow (every trade has a counterparty).
 * Wallets whose activity coverage does not span the whole window are excluded from the total and listed as partial.
 */
export function netTradeValue(windowH: number, onlyWallet?: string, now = Date.now()): NetTradeValue {
  const since = Math.floor(now / 1000) - windowH * 3600;
  const iv = configOf('pm-wallets')?.interval_min ?? 15;
  const wallets = onlyWallet ? [onlyWallet] : S.watchedWallets().map((w) => w.wallet);
  const complete: string[] = [], partial: { wallet: string; reason: string }[] = [];
  for (const w of wallets) {
    const c = coverageOf(`activity:${w}`, iv, now);
    const reason = c.last_status === 'never' ? 'not collected yet' : c.stale ? 'collection is stale' : c.open_gaps.length ? `${c.open_gaps.length} open coverage gap(s)` : c.covered_since_ts === null || c.covered_since_ts > since ? `continuous coverage only since ${c.covered_since ?? 'unknown'}` : null;
    if (reason) partial.push({ wallet: w, reason }); else complete.push(w);
  }
  const rows = complete.length ? db.prepare(`SELECT a.condition_id, a.outcome, a.outcome_index, MAX(a.title) title,
      SUM(CASE WHEN a.side = 'BUY' THEN a.usdc_size ELSE 0 END) buy, SUM(CASE WHEN a.side = 'SELL' THEN a.usdc_size ELSE 0 END) sell, COUNT(*) n, COUNT(DISTINCT a.wallet) wallets
    FROM pm_wallet_activity a WHERE a.type = 'TRADE' AND a.ts >= ? AND a.wallet IN (${complete.map(() => '?').join(',')})
    GROUP BY a.condition_id, a.outcome_index ORDER BY ABS(buy - sell) DESC`).all(since, ...complete) as Row[] : [];
  const other = complete.length ? db.prepare(`SELECT type, COUNT(*) n FROM pm_wallet_activity WHERE type != 'TRADE' AND ts >= ? AND wallet IN (${complete.map(() => '?').join(',')}) GROUP BY type`).all(since, ...complete) as Row[] : [];
  return {
    label: NET_LABEL, window_h: windowH, since: new Date(since * 1000).toISOString(),
    by_market_outcome: rows.map((r) => ({ condition_id: r.condition_id, title: r.title, outcome: r.outcome, outcome_index: r.outcome_index, buy_usdc: r.buy, sell_usdc: r.sell, net_usdc: r.buy - r.sell, trades: r.n, wallets: r.wallets })),
    complete_wallets: complete.length, partial_wallets: partial,
    excluded_activity: Object.fromEntries(other.map((o) => [o.type, o.n])),
    status: wallets.length === 0 ? 'no_watched_wallets' : complete.length === 0 ? 'unavailable' : partial.length ? 'partial' : 'complete',
    note: 'Only parsed BUY/SELL trades of watched wallets (maker and taker fills). Redemptions, splits, merges, rewards and transfers are excluded and counted separately. This is not whole-market net capital inflow: every trade has a buyer and a seller.',
  };
}

export function holderGroups(conditionId: string): HolderGroup[] {
  const rows = db.prepare('SELECT * FROM pm_holders WHERE condition_id = ? ORDER BY token_id, rank').all(conditionId) as Row[];
  const watched = watchedSet();
  const m = new Map<string, HolderGroup>();
  for (const r of rows) {
    let g = m.get(r.token_id);
    if (!g) { g = { token_id: r.token_id, outcome_index: r.outcome_index, snapshot_at: r.snapshot_at, list_has_more: !!r.list_has_more, holders: [], concentration: null, note: 'Largest holders as returned by the API. The total number of shares outstanding is not available here, so no concentration share is computed.' }; m.set(r.token_id, g); }
    g.holders.push({ rank: r.rank, wallet: r.wallet, amount_shares: r.amount_shares, ...nameOf(r.wallet), watched: watched.has(r.wallet) });
  }
  return [...m.values()];
}

export function pilotMarketViews(): PilotMarketView[] {
  const iv = configOf('pm-trades')?.interval_min ?? 5;
  return S.pilotMarkets().map((p) => {
    const m = db.prepare('SELECT question, price, outcome_label FROM markets WHERE condition_id = ?').get(p.condition_id) as Row | undefined;
    const c = db.prepare('SELECT COUNT(*) n, MIN(ts) oldest, MAX(ts) newest FROM pm_market_trades WHERE condition_id = ?').get(p.condition_id) as Row;
    return {
      condition_id: p.condition_id, question: m?.question ?? p.condition_id, price: m?.price ?? null, outcome_label: m?.outcome_label ?? null,
      selection_rule: p.selection_rule, selected_at: p.selected_at, trades_stored: c.n, oldest_trade_at: c.oldest ? new Date(c.oldest * 1000).toISOString() : null,
      newest_trade_at: c.newest ? new Date(c.newest * 1000).toISOString() : null, p95_notional_usdc: marketP95(p.condition_id).p95, coverage: coverageOf(`trades:${p.condition_id}`, iv),
    };
  });
}

function positionsOf(wallet: string): WalletPositionItem[] {
  return (db.prepare('SELECT * FROM pm_positions WHERE wallet = ? ORDER BY current_value_usdc DESC').all(wallet) as Row[]).map((r) => ({
    condition_id: r.condition_id, token_id: r.token_id, title: r.title, outcome: r.outcome, size_shares: r.size_shares, entry_price_usdc: r.entry_price_usdc, cost_usdc: r.cost_usdc,
    current_price_usdc: r.current_price_usdc, current_value_usdc: r.current_value_usdc, realized_pnl_usdc: r.realized_pnl_usdc, unrealized_pnl_usdc: r.unrealized_pnl_usdc,
    status: r.status, redeemable: r.redeemable === null ? null : !!r.redeemable, end_date: r.end_date, snapshot_at: r.snapshot_at,
    tracked_market: !!db.prepare('SELECT 1 FROM markets WHERE condition_id = ?').get(r.condition_id),
  }));
}

export function watchedViews(now = Date.now()): WatchedWalletView[] {
  const iv = configOf('pm-wallets')?.interval_min ?? 15;
  return S.watchedWallets().map((w) => {
    const pos = positionsOf(w.wallet);
    const known = (k: 'realized_pnl_usdc' | 'unrealized_pnl_usdc') => (pos.length && pos.every((p) => p[k] !== null) ? pos.reduce((a, p) => a + (p[k] as number), 0) : null);
    const last = db.prepare('SELECT MAX(ts) t FROM pm_wallet_activity WHERE wallet = ?').get(w.wallet) as { t: number | null };
    return {
      wallet: w.wallet, ...nameOf(w.wallet), note: w.note, selection_rule: w.selection_rule, selected_at: w.selected_at,
      open_positions: pos.length, positions_value_usdc: pos.length ? pos.reduce((a, p) => a + (p.current_value_usdc ?? 0), 0) : null,
      provider_unrealized_pnl_usdc: known('unrealized_pnl_usdc'), provider_realized_pnl_usdc: known('realized_pnl_usdc'),
      last_activity_at: last.t ? new Date(last.t * 1000).toISOString() : null,
      activity_coverage: coverageOf(`activity:${w.wallet}`, iv, now), positions_coverage: coverageOf(`positions:${w.wallet}`, iv, now),
    };
  });
}

export function walletDetail(wallet: string): WalletDetail | null {
  const w = S.watchedWallets().find((x) => x.wallet === wallet.toLowerCase());
  if (!w) return null;
  const activity: WalletActivityItem[] = (db.prepare('SELECT * FROM pm_wallet_activity WHERE wallet = ? ORDER BY ts DESC LIMIT 100').all(w.wallet) as Row[]).map((r) => ({
    key: r.key, type: r.type, condition_id: r.condition_id, title: r.title, outcome: r.outcome, side: r.side, size: r.size, usdc_size: r.usdc_size, price_usdc: r.price_usdc,
    ts: r.ts, at: new Date(r.ts * 1000).toISOString(), tx_hash: r.tx_hash, seen_via: r.seen_via, tracked_market: !!db.prepare('SELECT 1 FROM markets WHERE condition_id = ?').get(r.condition_id),
  }));
  return { wallet: watchedViews().find((x) => x.wallet === w.wallet)!, positions: positionsOf(w.wallet), activity, net_24h: netTradeValue(24, w.wallet), net_7d: netTradeValue(24 * 7, w.wallet) };
}

export function leaderboardSnapshots(): LeaderboardSnapshot[] {
  const watched = watchedSet();
  const latest = db.prepare('SELECT time_period, order_by, category, MAX(snapshot_date) d FROM pm_leaderboard GROUP BY time_period, order_by, category').all() as Row[];
  return latest.map((l) => ({
    time_period: l.time_period, order_by: l.order_by, category: l.category, snapshot_date: l.d,
    rows: (db.prepare('SELECT * FROM pm_leaderboard WHERE snapshot_date = ? AND time_period = ? AND order_by = ? AND category = ? ORDER BY rank').all(l.d, l.time_period, l.order_by, l.category) as Row[])
      .map((r) => ({ rank: r.rank, wallet: r.wallet, display_name: r.display_name, pnl_usdc: r.pnl_usdc, volume_usdc: r.volume_usdc, watched: watched.has(r.wallet) })),
    note: 'Provider-reported PnL for the period on the provider\'s own basis. A ranking is a starting point for discovery, not a win rate or a strategy result; selecting past winners does not make their returns repeatable.',
  }));
}

export function overview(seed: boolean): WalletsOverview {
  return {
    seed_mode: seed,
    notes: [
      ...(seed ? ['Seed mode: wallet activity is not part of the offline snapshot and nothing is fetched, so this view is empty by design.'] : []),
      'A wallet address is a pseudonymous key. Display names are self-chosen on Polymarket and unverified; no address here is identified as a person, institution or insider.',
      'Data: Polymarket public data API v2 (no key), bounded pilot — up to 10 markets and 20 watched wallets. Coverage starts when collection started; earlier history is not implied.',
      `Large trade = single trade ≥ ${largeTradeUsdc().toLocaleString('en-US')} USDC or ≥ that market's own P95 trade size (with ≥ ${P95_MIN_N} stored trades). This is a screening parameter, not a validated "smart money" threshold.`,
    ],
    large_trade_usdc: largeTradeUsdc(), pilot_markets: pilotMarketViews(), large_trades: largeTrades({ limit: 60 }), watched: watchedViews(),
    net_24h: netTradeValue(24), net_7d: netTradeValue(24 * 7), leaderboards: leaderboardSnapshots(),
  };
}
