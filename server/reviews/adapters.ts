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
  constructor(public readonly provider: 'reddit' | 'bestbuy', public readonly reason: string) {
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

/**
 * Consumer reviews from the Best Buy developer API. Requires BESTBUY_API_KEY; without it the
 * provider is not connected, which is reported rather than filled in with samples.
 */
export async function fetchBestBuyReviews(params: CanaryFetchParams, deps: CanaryDeps = {}): Promise<ReviewRaw[]> {
  const sku = params.bestbuy_sku || '9226065';
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) throw new CanaryUnavailableError('bestbuy', 'not connected: BESTBUY_API_KEY is not set');

  const url = `https://api.bestbuy.com/v1/reviews(sku=${sku})?apiKey=${apiKey}&format=json&pageSize=20&sort=submissionTime.desc`;

  let json: { reviews?: unknown };
  try {
    json = await fetchJson<{ reviews?: unknown }>(url, { timeoutMs: 8000, ...deps.transport });
  } catch (e) {
    throw new CanaryUnavailableError('bestbuy', e instanceof HttpError ? `HTTP ${e.status}` : (e as Error).message);
  }

  const reviews = json?.reviews;
  if (!Array.isArray(reviews)) throw new CanaryUnavailableError('bestbuy', 'unexpected response shape');

  return (reviews as Record<string, any>[])
    .map((r) => ({
      review_id: `bestbuy_${r.id}`,
      asin: params.asin,
      ticker: params.ticker,
      platform: 'bestbuy',
      review_date: String(r.submissionTime || new Date().toISOString()).slice(0, 10),
      star_rating: typeof r.rating === 'number' ? r.rating : null,
      title: r.title || null,
      body: String(r.comment ?? ''),
      author: r.reviewer?.name || null,
      verified_purchase: Boolean(r.verifiedPurchase),
      source_type: 'bestbuy_api',
      source_url: `https://www.bestbuy.com/site/reviews/${sku}/${r.id}`,
      provenance: 'captured' as const,
    }))
    .filter((r) => r.body.trim().length > 0);
}
