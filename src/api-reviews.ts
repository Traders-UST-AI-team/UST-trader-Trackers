import type {
  BacktestSummary,
  ChannelExposure,
  CollectionRun,
  Company,
  CompanyFinancial,
  ConnectorStatus,
  EnrichedReview,
  Product,
  ReviewDashboardSummary,
  ReviewSession,
  ReviewStatusResponse,
  SnifferDetectionResult,
  WatchlistRow,
} from '../shared/review-types';
import { get, send } from './http';

export interface ReviewListParams {
  asin?: string;
  ticker?: string;
  platform?: string;
  tone?: string;
  reason?: string;
  verified_only?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface EdgarLookup {
  ticker: string;
  cik: string;
  name: string;
  fiscal_year_end_month: number | null;
  sector: string | null;
}

export interface BestBuyProduct {
  sku: string;
  name: string;
  manufacturer: string | null;
  review_count: number;
  url: string | null;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  scored: number;
  skipped: number;
  failures: { review_id: string | null; error?: string }[];
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, v === true ? '1' : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const reviewsApi = {
  session: () => get<ReviewSession>('/api/session'),
  watchlist: () => get<WatchlistRow[]>('/api/reviews/watchlist'),
  connectors: () => get<ConnectorStatus[]>('/api/reviews/connectors'),
  status: () => get<ReviewStatusResponse>('/api/reviews/status'),
  lookup: (ticker: string) => get<{ found: EdgarLookup | null }>(`/api/reviews/lookup${qs({ ticker })}`),

  companies: () => get<Company[]>('/api/reviews/companies'),
  addCompany: (input: { ticker: string; channel_exposure: ChannelExposure; name?: string; fiscal_year_end_month?: number; notes?: string; added_by?: string }) =>
    send<{ company: Company; financials: CollectionRun | null }>('POST', '/api/reviews/companies', input),
  updateCompany: (ticker: string, patch: { channel_exposure?: ChannelExposure; notes?: string; is_active?: boolean }) =>
    send<Company>('PATCH', `/api/reviews/companies/${encodeURIComponent(ticker)}`, patch),
  syncFinancials: (ticker: string) => send<CollectionRun>('POST', `/api/reviews/companies/${encodeURIComponent(ticker)}/financials`),

  products: (ticker?: string) => get<Product[]>(`/api/reviews/products${qs({ ticker })}`),
  upsertProduct: (input: { asin: string; ticker: string; title: string; category?: string; bestbuy_sku?: string; amazon_domain?: string; collect_interval_hours?: number; added_by?: string }) =>
    send<Product>('POST', '/api/reviews/products', input),
  setProductActive: (asin: string, is_active: boolean) => send<Product>('PATCH', `/api/reviews/products/${encodeURIComponent(asin)}`, { is_active }),

  dashboard: (scope: { ticker?: string; asin?: string }) => get<ReviewDashboardSummary>(`/api/reviews/dashboard${qs(scope)}`),
  list: (params: ReviewListParams) => get<{ reviews: EnrichedReview[]; total: number }>(`/api/reviews/list${qs({ ...params })}`),
  financials: (ticker: string) => get<CompanyFinancial[]>(`/api/reviews/financials${qs({ ticker })}`),
  runs: (scope: { ticker?: string; asin?: string; limit?: number }) => get<CollectionRun[]>(`/api/reviews/runs${qs(scope)}`),

  bestBuySearch: (query: string) => send<BestBuyProduct[]>('POST', '/api/reviews/bestbuy/search', { query }),
  collect: (scope: { ticker?: string; asin?: string }) => send<{ runs: CollectionRun[] }>('POST', '/api/reviews/collect', scope),
  sniff: (csv: string) => send<SnifferDetectionResult>('POST', '/api/reviews/sniff', { csv }),
  importReviews: (asin: string, reviews: SnifferDetectionResult['parsedReviews']) => send<ImportResult>('POST', '/api/reviews/import', { asin, reviews }),
  scoreSingle: (payload: { review_id?: string; body?: string; star_rating?: number; title?: string }) =>
    send<{ success: boolean; score: unknown }>('POST', '/api/reviews/score-single', payload),
};

export type { BacktestSummary };
