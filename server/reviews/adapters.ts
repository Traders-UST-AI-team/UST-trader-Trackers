import type { ReviewRaw } from '../../shared/review-types.ts';
import { fetchJson, HttpError, type FetchOpts } from '../http.ts';

export interface CanaryFetchParams {
  asin: string;
  ticker: string;
  subreddit?: string;
  query?: string;
  bestbuy_sku?: string;
}

/** The transport seam. Leave empty in production; tests pass a fake `fetchImpl` and never dial out. */
export interface CanaryDeps {
  transport?: FetchOpts;
}

/**
 * Raised when a canary provider cannot be reached, refuses the request, or answers with a shape we
 * cannot read. The adapters below follow the same contract as every other adapter in this server
 * (server/adapters.ts): throw on failure, never return an empty result to mean "failed", and never
 * evade a block. Reddit answers 403 to scripted requests from this project; before this change that
 * block was answered with hand-written reviews shaped exactly like captured ones.
 */
export class CanaryUnavailableError extends Error {
  constructor(public readonly provider: 'reddit' | 'bestbuy' | 'amazon' | 'edgar', public readonly reason: string) {
    super(`${provider} unavailable: ${reason}`);
    this.name = 'CanaryUnavailableError';
  }
}

/**
 * Early canary feedback from a subreddit's public search JSON.
 *
 * Returns captured rows, or an empty array when the request succeeded and the search genuinely
 * matched nothing. A block, a timeout or a malformed body throws.
 */
export async function fetchRedditCanaries(params: CanaryFetchParams, deps: CanaryDeps = {}): Promise<ReviewRaw[]> {
  const subreddit = params.subreddit || (params.ticker === 'LOGI' ? 'Logitech' : 'BuyItForLife');
  const query = params.query || 'M510';
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=15`;

  let data: { data?: { children?: unknown } };
  try {
    data = await fetchJson<{ data?: { children?: unknown } }>(url, { timeoutMs: 8000, ...deps.transport });
  } catch (e) {
    const why = e instanceof HttpError ? `HTTP ${e.status} (blocked or not found; not retried and not evaded)` : (e as Error).message;
    throw new CanaryUnavailableError('reddit', why);
  }

  const children = data?.data?.children;
  if (!Array.isArray(children)) throw new CanaryUnavailableError('reddit', 'unexpected response shape');

  const results: ReviewRaw[] = [];
  for (const c of children as { data?: Record<string, any> }[]) {
    const p = c?.data;
    // Identity is required, never inferred: a post with no id would otherwise all collapse onto one
    // stored row named `reddit_undefined`.
    if (!p || !p.id || !p.title) continue;
    const createdUtc = Number(p.created_utc);
    if (!Number.isFinite(createdUtc)) continue;
    const body = (p.selftext ? `${p.title}\n\n${p.selftext}` : p.title).trim();
    if (!body) continue;

    results.push({
      review_id: `reddit_${p.id}`,
      asin: params.asin,
      ticker: params.ticker,
      platform: 'reddit',
      review_date: new Date(createdUtc * 1000).toISOString().slice(0, 10),
      star_rating: null,
      title: p.title,
      body,
      author: p.author || null,
      verified_purchase: false,
      source_type: 'reddit_api',
      source_url: p.permalink ? `https://reddit.com${p.permalink}` : null,
      provenance: 'captured',
    });
  }

  return results;
}

/** Best Buy rows per page; the API allows up to 100. */
export const BESTBUY_PAGE_SIZE = 100;

const bestBuyKey = (): string => {
  const key = process.env.BESTBUY_API_KEY;
  if (!key) throw new CanaryUnavailableError('bestbuy', 'not connected: BESTBUY_API_KEY is not set');
  return key;
};

/** A Best Buy request whose failure never echoes the URL (it carries the key). */
async function bestBuyGet<T>(url: string, deps: CanaryDeps): Promise<T> {
  try {
    return await fetchJson<T>(url, { timeoutMs: 15_000, ...deps.transport });
  } catch (e) {
    throw new CanaryUnavailableError('bestbuy', e instanceof HttpError ? `HTTP ${e.status}` : (e as Error).message.replace(/apiKey=[^&\s]+/g, 'apiKey=…'));
  }
}

function mapBestBuyReview(r: Record<string, any>, params: CanaryFetchParams, sku: string): ReviewRaw {
  // `reviewer` is an array of { name } in the API's JSON; tolerate a bare object too.
  const reviewer = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
  return {
    review_id: `bestbuy_${r.id}`,
    asin: params.asin,
    ticker: params.ticker,
    platform: 'bestbuy',
    review_date: String(r.submissionTime || new Date().toISOString()).slice(0, 10),
    star_rating: typeof r.rating === 'number' ? r.rating : null,
    title: r.title || null,
    body: String(r.comment ?? ''),
    author: reviewer?.name || null,
    verified_purchase: Boolean(r.verifiedPurchase),
    source_type: 'bestbuy_api',
    source_url: `https://www.bestbuy.com/site/reviews/${sku}/${r.id}`,
    provenance: 'captured',
  };
}

/**
 * Consumer reviews from the Best Buy developer API (free key: BESTBUY_API_KEY), newest first.
 *
 * Unlike the Amazon providers, Best Buy pages through a product's whole review history, so the
 * first collection of a listing can backfill years of quarters (`pages` > 1) and later runs read
 * only the newest page. Without a key or a SKU the provider is not connected, which is reported
 * rather than filled in with samples.
 */
export async function fetchBestBuyReviews(params: CanaryFetchParams, deps: CanaryDeps & { pages?: number } = {}): Promise<ReviewRaw[]> {
  const apiKey = bestBuyKey();
  const sku = params.bestbuy_sku?.trim();
  if (!sku || !/^\d{4,10}$/.test(sku)) throw new CanaryUnavailableError('bestbuy', 'this product has no Best Buy SKU');

  const out: ReviewRaw[] = [];
  const maxPages = Math.max(1, deps.pages ?? 1);
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.bestbuy.com/v1/reviews(sku=${sku})?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=${BESTBUY_PAGE_SIZE}&page=${page}&sort=submissionTime.desc`;
    const json = await bestBuyGet<{ reviews?: unknown; totalPages?: number }>(url, deps);
    const reviews = json?.reviews;
    if (!Array.isArray(reviews)) throw new CanaryUnavailableError('bestbuy', 'unexpected response shape');
    for (const r of reviews as Record<string, any>[]) {
      // Identity is required, never inferred: without it every such review would collapse onto
      // one stored row named `bestbuy_undefined`.
      if (!r || !(typeof r.id === 'number' || (typeof r.id === 'string' && r.id.trim() !== ''))) continue;
      const mapped = mapBestBuyReview(r, params, sku);
      if (mapped.body.trim()) out.push(mapped);
    }
    if (reviews.length < BESTBUY_PAGE_SIZE || (typeof json.totalPages === 'number' && page >= json.totalPages)) break;
  }
  return out;
}

export interface BestBuyProduct {
  sku: string;
  name: string;
  manufacturer: string | null;
  review_count: number;
  url: string | null;
}

/** Keyword search of Best Buy's catalogue, most-reviewed first, so a teammate can pick the SKU. */
export async function searchBestBuyProducts(query: string, deps: CanaryDeps = {}): Promise<BestBuyProduct[]> {
  const apiKey = bestBuyKey();
  const words = query.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (words.length === 0) return [];
  const filter = words.map((w) => `search=${encodeURIComponent(w)}`).join('&');
  const url = `https://api.bestbuy.com/v1/products(${filter})?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=8&sort=customerReviewCount.desc&show=sku,name,manufacturer,customerReviewCount,url`;
  const json = await bestBuyGet<{ products?: Record<string, any>[] }>(url, deps);
  return (json.products ?? []).map((p) => ({
    sku: String(p.sku),
    name: String(p.name ?? ''),
    manufacturer: p.manufacturer ?? null,
    review_count: Number(p.customerReviewCount ?? 0),
    url: p.url ?? null,
  }));
}
