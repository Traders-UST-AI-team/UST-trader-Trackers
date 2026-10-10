import { db } from './db.ts';
import { ensureHistory } from './sources/polymarket.ts';
import { ensureKalshiHistory } from './sources/kalshi.ts';

export const HISTORY_BASIS: Record<string, string> = {
  polymarket: 'Polymarket CLOB price-history series (provider-defined; not an order-book midpoint)',
  kalshi: 'Midpoint of each candle’s closing yes-bid/yes-ask, only where both are a real two-sided quote; other periods are gaps, not filled',
};

export async function ensureAnyHistory(conditionId: string, maxAgeMin: number): Promise<string> {
  if (process.env.TRACKER_SEED) return 'seed'; // offline snapshot: never touch the network
  const v = (db.prepare('SELECT venue FROM markets WHERE condition_id = ?').get(conditionId) as { venue: string } | undefined)?.venue;
  if (v === 'kalshi') return ensureKalshiHistory(conditionId, { maxAgeMin });
  return ensureHistory(conditionId, { maxAgeMin });
}
