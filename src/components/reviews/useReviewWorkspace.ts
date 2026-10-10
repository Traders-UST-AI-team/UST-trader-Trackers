import { useCallback, useMemo, useState } from 'react';
import { reviewsApi } from '../../api-reviews';
import { useResource } from '../../read';

/**
 * Everything the reviews workspace reads, through the app's one read primitive (`useResource`):
 * one staleness rule, one failure mode, and `data === null` meaning "not loaded" rather than empty.
 *
 * `version` is bumped after any write (collect, import, add) so every read that could have changed
 * is asked again.
 */

export interface ReviewFilters {
  platform: string;
  tone: string;
  reason: string;
  query: string;
  verifiedOnly: boolean;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = { platform: 'all', tone: 'all', reason: 'all', query: '', verifiedOnly: false };

export function useWatchlist(version: number) {
  const watchlist = useResource(`watchlist:${version}`, reviewsApi.watchlist, { label: 'The watchlist' });
  const connectors = useResource(`connectors:${version}`, reviewsApi.connectors, { label: 'Connector status', quiet: true });
  return { watchlist, connectors };
}

export function useCompany(ticker: string, asin: string | null, version: number) {
  const scopeKey = `${ticker}|${asin ?? ''}|${version}`;
  const summary = useResource(scopeKey, () => reviewsApi.dashboard(asin ? { asin } : { ticker }), { label: `${ticker} dashboard` });
  const runs = useResource(`${ticker}|${version}`, () => reviewsApi.runs({ ticker, limit: 40 }), { label: 'Collection log', quiet: true });
  const financials = useResource(`${ticker}|${version}`, () => reviewsApi.financials(ticker), { label: 'Financials', quiet: true });
  // Every listing of the company, paused ones included, whichever scope is open.
  const listings = useResource(`${ticker}|${version}`, () => reviewsApi.products(ticker), { label: 'Listings', quiet: true });

  const [filters, setFiltersState] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS);
  const setFilters = useCallback((patch: Partial<ReviewFilters>) => setFiltersState((f) => ({ ...f, ...patch })), []);
  const listKey = useMemo(() => JSON.stringify([ticker, asin, version, filters]), [ticker, asin, version, filters]);
  const list = useResource(listKey, () => reviewsApi.list({
    ...(asin ? { asin } : { ticker }),
    platform: filters.platform,
    tone: filters.tone,
    reason: filters.reason,
    query: filters.query.trim() || undefined,
    verified_only: filters.verifiedOnly,
    limit: 100,
  }), { label: 'The review list' });

  return { summary, runs, financials, listings, list, filters, setFilters };
}
