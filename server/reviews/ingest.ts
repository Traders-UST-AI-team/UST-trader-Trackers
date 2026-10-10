import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ReviewProvenance } from '../../shared/review-types.ts';
import { scoreReview, type ScoreInput, type ScoreResult } from './jev.ts';
import { runInTransaction } from './db.ts';

/** Scores one review. Injectable so a test can supply a deterministic scorer instead of a provider. */
export type Scorer = (input: ScoreInput) => Promise<ScoreResult>;

/**
 * A review the caller wants stored. Deliberately permissive: the CSV importer, the collectors
 * and a single re-score all produce slightly different shapes, and normalising them is this
 * module's job rather than each caller's.
 */
export interface ReviewInput {
  review_id?: string;
  platform?: string;
  date?: string;
  review_date?: string;
  rating?: number | null;
  star_rating?: number | null;
  title?: string | null;
  body?: unknown;
  author?: string | null;
  verified?: boolean;
  verified_purchase?: boolean;
  /** Amazon Vine (free product) review: stored, but kept out of tone. */
  is_vine?: boolean;
  source_type?: string;
  source_url?: string | null;
  provenance?: ReviewProvenance;
}

export interface ReviewStored {
  review_id: string;
  platform: string;
  review_date: string;
  star_rating: number | null;
  title: string | null;
  body: string;
  author: string | null;
  verified_purchase: boolean;
  is_vine: boolean;
  source_type: string;
  source_url: string | null;
  provenance: ReviewProvenance;
  score: ScoreResult;
}

export interface IngestOutcome {
  review_id: string | null;
  stored: boolean;
  /** Present when the row was stored. */
  score?: ScoreResult;
  /** Present when it was not, and why. */
  error?: string;
}

export interface IngestReport {
  /** Rows written, each with exactly one score. */
  imported: number;
  scored: number;
  /** Inputs that produced nothing: empty bodies, or a scorer that failed. */
  skipped: number;
  outcomes: IngestOutcome[];
}

/** Provider calls in flight at once. Bounded so a large CSV neither runs serially for hours nor floods a provider. */
export const SCORE_CONCURRENCY = 4;
/** Scored rows are committed in chunks, so a dropped request or a crash keeps the work already done. */
export const COMMIT_EVERY = 25;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Runs `fn` over `items` with at most `limit` calls in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A review date as YYYY-MM-DD. An unreadable date becomes today rather than an unparseable key. */
export function normaliseDate(value: string | undefined | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = value ? Date.parse(value) : NaN;
  return (Number.isFinite(parsed) ? new Date(parsed) : new Date()).toISOString().slice(0, 10);
}

/**
 * A stable id for a row that arrived without one (most CSV exports). Derived from its content, so
 * importing the same export twice — or a scheduled re-collection overlapping the last one — updates
 * the existing rows instead of duplicating them.
 */
export function contentReviewId(asin: string, date: string, author: string | null | undefined, body: string): string {
  const digest = createHash('sha1').update(`${asin}\n${date}\n${author ?? ''}\n${body}`).digest('hex').slice(0, 16);
  return `import_${asin}_${digest}`;
}

/**
 * Stores a batch of reviews for one product.
 *
 * The invariant this module exists for: a stored review always has exactly one score. Scoring
 * happens *before* any write, and each raw row and its score are written in the same transaction,
 * so a provider timeout can no longer leave a raw row whose missing score is later read as
 * "product related, tone 0" by the aggregation. Nothing is written for an item that could not be
 * scored, and the caller gets a per-item reason.
 *
 * Scoring runs with bounded concurrency and rows are committed every `commitEvery` items, so an
 * import of thousands of rows is neither serial nor one all-or-nothing request.
 */
export async function ingestReviews(
  db: DatabaseSync,
  product: { asin: string; ticker: string },
  inputs: ReviewInput[],
  opts: { scorer?: Scorer; concurrency?: number; commitEvery?: number } = {},
): Promise<IngestReport> {
  const scorer = opts.scorer ?? scoreReview;
  const concurrency = Math.max(1, opts.concurrency ?? SCORE_CONCURRENCY);
  const commitEvery = Math.max(1, opts.commitEvery ?? COMMIT_EVERY);
  const failures: IngestOutcome[] = [];
  const stored: IngestOutcome[] = [];

  const insertRaw = db.prepare(`
    INSERT OR REPLACE INTO reviews_raw (review_id, asin, ticker, platform, review_date, star_rating, title, body, author, verified_purchase, is_vine, source_type, source_url, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScored = db.prepare(`
    INSERT OR REPLACE INTO reviews_scored (review_id, asin, ticker, tone_score, is_product_related, primary_reason, tags_json, model_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const write = (rows: ReviewStored[]) => {
    if (rows.length === 0) return;
    // One transaction per chunk: each pair is written together, or neither is.
    runInTransaction(db, () => {
      for (const row of rows) {
        insertRaw.run(
          row.review_id, product.asin, product.ticker, row.platform, row.review_date, row.star_rating, row.title, row.body,
          row.author, row.verified_purchase ? 1 : 0, row.is_vine ? 1 : 0, row.source_type, row.source_url, row.provenance,
        );
        insertScored.run(
          row.review_id, product.asin, product.ticker, row.score.tone_score, row.score.is_product_related ? 1 : 0,
          row.score.primary_reason, JSON.stringify(row.score.tags), row.score.model_used,
        );
      }
    });
    for (const row of rows) stored.push({ review_id: row.review_id, stored: true, score: row.score });
  };

  const prepare = async (item: ReviewInput): Promise<ReviewStored | null> => {
    if (!isNonEmptyString(item.body)) {
      failures.push({ review_id: null, stored: false, error: 'empty body' });
      return null;
    }
    const body = item.body.trim();
    const review_date = normaliseDate(item.date || item.review_date);
    const review_id = isNonEmptyString(item.review_id) ? item.review_id : contentReviewId(product.asin, review_date, item.author, body);
    const star = typeof item.rating === 'number' ? item.rating : typeof item.star_rating === 'number' ? item.star_rating : null;

    const scoreInput: ScoreInput = { review_id, asin: product.asin, ticker: product.ticker, body, title: item.title ?? null, star_rating: star };
    let score: ScoreResult;
    try {
      score = await scorer(scoreInput);
    } catch (e) {
      failures.push({ review_id, stored: false, error: `scoring failed: ${(e as Error).message}` });
      return null;
    }

    return {
      review_id,
      platform: item.platform || 'amazon',
      review_date,
      star_rating: star,
      title: item.title ?? null,
      body,
      author: item.author ?? null,
      verified_purchase: Boolean(item.verified ?? item.verified_purchase),
      is_vine: Boolean(item.is_vine),
      source_type: item.source_type || 'csv_plugin',
      source_url: item.source_url ?? null,
      provenance: item.provenance ?? 'captured',
      score,
    };
  };

  for (let base = 0; base < inputs.length; base += commitEvery) {
    const chunk = inputs.slice(base, base + commitEvery);
    const rows = await mapLimit(chunk, concurrency, prepare);
    write(rows.filter((r): r is ReviewStored => r !== null));
  }

  return {
    imported: stored.length,
    scored: stored.length,
    skipped: failures.length,
    outcomes: [...failures, ...stored],
  };
}
