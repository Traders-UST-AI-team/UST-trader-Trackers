import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewsApi } from '../../api-reviews';
import { toast } from '../../toast';
import { RequestGeneration } from '../../workspace';
import type { Company, EnrichedReview, Product, ReviewDashboardSummary, ReviewStatusResponse } from '../../../shared/review-types';

/**
 * Everything the reviews workspace reads, behind one interface.
 *
 * The view declares what it needs; this module owns when to fetch, how to avoid a stale response
 * overwriting a newer one, and what to do when a load fails. Three states are kept distinct, which
 * the view could not express before: `null` means not loaded, `[]` means loaded and genuinely
 * empty, and `state === 'error'` means the load failed. Failures also go to the toast seam rather
 * than `console.error`, so the operator sees them.
 */

export interface ReviewFilters {
  platform: string;
  tone: string;
  reason: string;
  query: string;
  verifiedOnly: boolean;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = { platform: 'all', tone: 'all', reason: 'all', query: '', verifiedOnly: false };

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ReviewData {
  companies: Company[];
  selectedTicker: string | null;
  setSelectedTicker: (t: string) => void;
  products: Product[];
  selectedAsin: string | null;
  setSelectedAsin: (a: string) => void;

  status: ReviewStatusResponse | null;
  summary: ReviewDashboardSummary | null;
  summaryState: LoadState;

  /** null = not loaded; [] = loaded, nothing matched. */
  reviews: EnrichedReview[] | null;
  totalReviews: number | null;
  listState: LoadState;

  filters: ReviewFilters;
  setFilters: (patch: Partial<ReviewFilters>) => void;

  /** The one error the workspace should show, if any. */
  error: string | null;
  reload: () => void;
  reloadList: () => void;
  createProduct: (asin: string, title: string) => Promise<boolean>;
}

export function useReviewData(): ReviewData {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [status, setStatus] = useState<ReviewStatusResponse | null>(null);
  const [summary, setSummary] = useState<ReviewDashboardSummary | null>(null);
  const [summaryState, setSummaryState] = useState<LoadState>('idle');
  const [reviews, setReviews] = useState<EnrichedReview[] | null>(null);
  const [totalReviews, setTotalReviews] = useState<number | null>(null);
  const [listState, setListState] = useState<LoadState>('idle');
  const [filters, setFiltersState] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // One generation per resource: an obsolete response must not commit.
  const summaryGen = useRef(new RequestGeneration());
  const listGen = useRef(new RequestGeneration());

  const fail = useCallback((where: string, e: unknown) => {
    const message = `${where}: ${(e as Error).message}`;
    setError(message);
    toast(message, 'error');
  }, []);

  // Companies and engine status: once, then whenever the operator asks for a reload.
  useEffect(() => {
    let live = true;
    reviewsApi.companies()
      .then((rows) => {
        if (!live) return;
        setCompanies(rows);
        setSelectedTicker((current) => current ?? rows[0]?.ticker ?? null);
      })
      .catch((e) => live && fail('Could not list companies', e));
    reviewsApi.status().then((s) => live && setStatus(s)).catch(() => { /* status is informational */ });
    return () => { live = false; };
  }, [fail, reloadToken]);

  // Products for the selected ticker.
  useEffect(() => {
    if (!selectedTicker) return;
    let live = true;
    reviewsApi.products(selectedTicker)
      .then((rows) => {
        if (!live) return;
        setProducts(rows);
        setSelectedAsin((current) => (rows.some((p) => p.asin === current) ? current : rows[0]?.asin ?? null));
      })
      .catch((e) => live && fail('Could not list products', e));
    return () => { live = false; };
  }, [selectedTicker, fail, reloadToken]);

  const loadSummary = useCallback(async () => {
    if (!selectedAsin) return;
    const generation = summaryGen.current.next();
    setSummaryState('loading');
    try {
      const next = await reviewsApi.dashboard(selectedAsin);
      if (!summaryGen.current.isCurrent(generation)) return;
      setSummary(next);
      setSummaryState('ready');
      setError(null);
    } catch (e) {
      if (!summaryGen.current.isCurrent(generation)) return;
      setSummary(null);
      setSummaryState('error');
      fail('Could not load the summary', e);
    }
  }, [selectedAsin, fail]);

  const loadList = useCallback(async () => {
    if (!selectedAsin) return;
    const generation = listGen.current.next();
    setListState('loading');
    try {
      const res = await reviewsApi.list({
        asin: selectedAsin,
        platform: filters.platform,
        tone: filters.tone,
        reason: filters.reason,
        query: filters.query,
        verified_only: filters.verifiedOnly,
        limit: 100,
      });
      if (!listGen.current.isCurrent(generation)) return;
      setReviews(res.reviews);
      setTotalReviews(res.total);
      setListState('ready');
    } catch (e) {
      if (!listGen.current.isCurrent(generation)) return;
      setReviews(null);
      setTotalReviews(null);
      setListState('error');
      fail('Could not load the review list', e);
    }
  }, [selectedAsin, filters, fail]);

  useEffect(() => { void loadSummary(); }, [loadSummary, reloadToken]);
  useEffect(() => { void loadList(); }, [loadList, reloadToken]);

  const setFilters = useCallback((patch: Partial<ReviewFilters>) => {
    setFiltersState((current) => ({ ...current, ...patch }));
  }, []);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const reloadList = useCallback(() => { void loadList(); }, [loadList]);

  const createProduct = useCallback(async (asin: string, title: string): Promise<boolean> => {
    try {
      await reviewsApi.createProduct({ asin, ticker: selectedTicker ?? undefined, title } as Partial<Product>);
      if (selectedTicker) setProducts(await reviewsApi.products(selectedTicker));
      setSelectedAsin(asin);
      toast(`Added ${asin}. It has no reviews yet — import a CSV or fetch a canary.`, 'success');
      return true;
    } catch (e) {
      // Was an alert(); it belongs to the same error seam as every other failure here.
      fail('Could not add the product', e);
      return false;
    }
  }, [selectedTicker, fail]);

  return {
    companies, selectedTicker, setSelectedTicker: setSelectedTicker as (t: string) => void,
    products, selectedAsin, setSelectedAsin: setSelectedAsin as (a: string) => void,
    status, summary, summaryState,
    reviews, totalReviews, listState,
    filters, setFilters,
    error, reload, reloadList, createProduct,
  };
}
