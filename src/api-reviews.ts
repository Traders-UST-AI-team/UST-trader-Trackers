import type {
  Company,
  CompanyFinancial,
  EnrichedReview,
  Product,
  ReviewDashboardSummary,
  ReviewStatusResponse,
  SnifferDetectionResult,
} from '../shared/review-types';
import { get, send } from './http';

export const reviewsApi = {
  companies: () => get<Company[]>('/api/reviews/companies'),

  products: (ticker?: string) =>
    get<Product[]>(`/api/reviews/products${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`),

  createProduct: (data: Partial<Product>) =>
    send<{ success: boolean; asin: string }>('POST', '/api/reviews/products', data),

  dashboard: (asin?: string) =>
    get<ReviewDashboardSummary>(`/api/reviews/dashboard${asin ? `?asin=${encodeURIComponent(asin)}` : ''}`),

  list: (params: {
    asin?: string;
    platform?: string;
    tone?: string;
    reason?: string;
    verified_only?: boolean;
    query?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.asin) q.set('asin', params.asin);
    if (params.platform) q.set('platform', params.platform);
    if (params.tone) q.set('tone', params.tone);
    if (params.reason) q.set('reason', params.reason);
    if (params.verified_only) q.set('verified_only', '1');
    if (params.query) q.set('query', params.query);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    return get<{ reviews: EnrichedReview[]; total: number }>(`/api/reviews/list?${q.toString()}`);
  },

  sniff: (csv: string) =>
    send<SnifferDetectionResult>('POST', '/api/reviews/sniff', { csv }),

  importReviews: (asin: string, reviews: any[]) =>
    send<{ success: boolean; imported: number; scored: number }>('POST', '/api/reviews/import', { asin, reviews }),

  scoreSingle: (payload: { review_id?: string; body?: string; star_rating?: number; title?: string }) =>
    send<{ success: boolean; score: any }>('POST', '/api/reviews/score-single', payload),

  fetchCanary: (asin: string, type: 'reddit' | 'bestbuy') =>
    send<{ success: boolean; added: number }>('POST', '/api/reviews/fetch-canary', { asin, type }),

  financials: (ticker?: string) =>
    get<CompanyFinancial[]>(`/api/reviews/financials${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`),

  status: () => get<ReviewStatusResponse>('/api/reviews/status'),
};
