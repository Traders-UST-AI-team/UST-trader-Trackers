/**
 * Amazon reviews, through a licensed data provider.
 *
 * Amazon has no public reviews API and blocks direct scraping, and this server never evades a
 * block. Reviews are therefore read from a provider the operator has an account with:
 *
 *   - Rainforest API (Traject Data): RAINFOREST_API_KEY. `type=reviews`, newest first.
 *   - Apify: APIFY_TOKEN plus APIFY_AMAZON_REVIEWS_ACTOR (e.g. "owner~actor-name"). Actor inputs
 *     differ, so APIFY_AMAZON_REVIEWS_INPUT may hold a JSON template where "{{asin}}", "{{url}}"
 *     and "{{max}}" are substituted.
 *
 * With neither configured the collector reports "not connected" and nothing is written. Rows are
 * normalised from whichever field names the provider uses; a row with no identity is dropped.
 */
import type { ReviewRaw } from '../../shared/review-types.ts';
import { fetchJson, HttpError, type FetchOpts } from '../http.ts';
import { CanaryUnavailableError } from './adapters.ts';

export interface AmazonDeps {
  transport?: FetchOpts;
  env?: Record<string, string | undefined>;
}

export interface AmazonParams {
  asin: string;
  ticker: string;
  /** Marketplace, e.g. amazon.com, amazon.co.uk. */
  domain?: string;
  /** Upper bound on reviews read per collection. */
  max?: number;
}

export type AmazonProvider = 'rainforest' | 'apify';

/** Which provider will be used, or null when none is configured. */
export function amazonProvider(env: Record<string, string | undefined> = process.env): AmazonProvider | null {
  if (env.RAINFOREST_API_KEY) return 'rainforest';
  if (env.APIFY_TOKEN && env.APIFY_AMAZON_REVIEWS_ACTOR) return 'apify';
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const pick = (o: Record<string, any>, ...keys: string[]) => keys.map((k) => k.split('.').reduce<any>((v, p) => (v == null ? v : v[p]), o)).find((v) => v != null && v !== '');

/** "Reviewed in the United States on March 3, 2025" and plain ISO strings both become YYYY-MM-DD. */
export function amazonDate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const iso = /\d{4}-\d{2}-\d{2}/.exec(s);
  if (iso) return iso[0];
  const tail = /on (.+)$/i.exec(s)?.[1] ?? s;
  // A bare "March 3, 2025" parses as local midnight; read it back in local time so the server's
  // time zone cannot move the review to the previous day.
  const t = new Date(tail);
  if (!Number.isFinite(t.getTime())) return null;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Normalises one provider row. Returns null when it has no id or no text. */
export function normaliseAmazonReview(row: Record<string, any>, params: AmazonParams): ReviewRaw | null {
  const id = str(pick(row, 'id', 'reviewId', 'review_id'));
  const body = str(pick(row, 'body', 'reviewText', 'text', 'content', 'reviewDescription', 'review'));
  const date = amazonDate(pick(row, 'date.utc', 'date.raw', 'date', 'reviewDate', 'reviewedIn', 'review_date'));
  if (!id || !body || !date) return null;
  const rating = num(pick(row, 'rating', 'ratingScore', 'stars', 'reviewRating'));
  const vine = pick(row, 'vine_program', 'isVine', 'vine', 'is_vine');
  const verified = pick(row, 'verified_purchase', 'isVerified', 'verified', 'verifiedPurchase');
  return {
    review_id: `amazon_${id}`,
    asin: params.asin,
    ticker: params.ticker,
    platform: 'amazon',
    review_date: date,
    star_rating: rating != null && rating >= 0 && rating <= 5 ? rating : null,
    title: str(pick(row, 'title', 'reviewTitle')),
    body,
    author: str(pick(row, 'profile.name', 'author', 'reviewerName', 'userName')),
    verified_purchase: verified === true || verified === 'true',
    source_type: 'amazon_provider',
    source_url: str(pick(row, 'link', 'url', 'reviewUrl')),
    provenance: 'captured',
    // Carried to ingest so Vine (free product) rows are stored but kept out of tone.
    is_vine: vine === true || vine === 'true',
  };
}

async function viaRainforest(params: AmazonParams, key: string, deps: AmazonDeps): Promise<Record<string, any>[]> {
  const q = new URLSearchParams({
    api_key: key,
    type: 'reviews',
    amazon_domain: params.domain || 'amazon.com',
    asin: params.asin,
    sort_by: 'most_recent',
  });
  const json = await fetchJson<{ reviews?: unknown; request_info?: { success?: boolean; message?: string } }>(
    `https://api.rainforestapi.com/request?${q}`,
    { timeoutMs: 60_000, retries: 1, ...deps.transport },
  );
  if (json.request_info && json.request_info.success === false) throw new Error(json.request_info.message || 'provider refused the request');
  if (!Array.isArray(json.reviews)) throw new Error('unexpected response shape');
  return json.reviews as Record<string, any>[];
}

async function viaApify(params: AmazonParams, env: Record<string, string | undefined>, deps: AmazonDeps): Promise<Record<string, any>[]> {
  const actor = env.APIFY_AMAZON_REVIEWS_ACTOR!.replace('/', '~');
  const url = `https://www.amazon.com/product-reviews/${params.asin}`;
  const max = params.max ?? 50;
  const template = env.APIFY_AMAZON_REVIEWS_INPUT
    || '{"asins":["{{asin}}"],"productUrls":[{"url":"{{url}}"}],"maxReviews":{{max}},"sort":"recent"}';
  let input: unknown;
  try {
    input = JSON.parse(template.replaceAll('{{asin}}', params.asin).replaceAll('{{url}}', url).replaceAll('{{max}}', String(max)));
  } catch {
    throw new Error('APIFY_AMAZON_REVIEWS_INPUT is not valid JSON');
  }
  const doFetch = deps.transport?.fetchImpl ?? fetch;
  const res = await doFetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(env.APIFY_TOKEN!)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(deps.transport?.timeoutMs ?? 290_000),
  });
  if (!res.ok) throw new HttpError(res.status, 'api.apify.com');
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('unexpected response shape');
  return json as Record<string, any>[];
}

/**
 * The newest reviews for one ASIN. Throws CanaryUnavailableError when no provider is configured or
 * the provider fails; an empty array means the provider answered and had nothing.
 */
export async function fetchAmazonReviews(params: AmazonParams, deps: AmazonDeps = {}): Promise<ReviewRaw[]> {
  const env = deps.env ?? process.env;
  const provider = amazonProvider(env);
  if (!provider) {
    throw new CanaryUnavailableError('amazon', 'not connected: set RAINFOREST_API_KEY, or APIFY_TOKEN with APIFY_AMAZON_REVIEWS_ACTOR');
  }
  let rows: Record<string, any>[];
  try {
    rows = provider === 'rainforest' ? await viaRainforest(params, env.RAINFOREST_API_KEY!, deps) : await viaApify(params, env, deps);
  } catch (e) {
    // The message never carries the request URL, which holds the provider key.
    const why = e instanceof HttpError ? `${provider} answered HTTP ${e.status}` : `${provider}: ${(e as Error).message}`;
    throw new CanaryUnavailableError('amazon', why);
  }
  const seen = new Set<string>();
  const out: ReviewRaw[] = [];
  for (const row of rows.slice(0, params.max ?? 200)) {
    const r = row && typeof row === 'object' ? normaliseAmazonReview(row, params) : null;
    if (!r || seen.has(r.review_id)) continue;
    seen.add(r.review_id);
    out.push(r);
  }
  return out;
}
