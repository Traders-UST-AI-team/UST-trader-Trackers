import type { DatabaseSync } from 'node:sqlite';
import type { ReviewProvenance } from '../../shared/review-types.ts';
import { scoreReview, type ScoreInput, type ScoreResult } from './jev.ts';
import { runInTransaction } from './db.ts';

/** Scores one review. Injectable so a test can supply a deterministic scorer instead of a provider. */
export type Scorer = (input: ScoreInput) => Promise<ScoreResult>;

/**
 * A review the caller wants stored. Deliberately permissive: the CSV importer, the canary fetches
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

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Stores a batch of reviews for one product.
 *
 * The invariant this module exists for: a stored review always has exactly one score. Scoring
 * happens *before* any write, and the raw row and its score are written in one transaction, so a
 * provider timeout can no longer leave a raw row whose missing score is later read as "product
 * related, tone 0" by the aggregation. Nothing is written for an item that could not be scored, and
 * the caller gets a per-item reason.
 */
export async function ingestReviews(
  db: DatabaseSync,
  product: { asin: string; ticker: string },
  inputs: ReviewInput[],
  opts: { scorer?: Scorer } = {},
): Promise<IngestReport> {
  const scorer = opts.scorer ?? scoreReview;
  const outcomes: IngestOutcome[] = [];

  const prepared: { row: ReviewStored }[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    if (!isNonEmptyString(item.body)) {
      outcomes.push({ review_id: null, stored: false, error: 'empty body' });
      continue;
    }

    const review_id = isNonEmptyString(item.review_id) ? item.review_id : `import_${product.asin}_${Date.now()}_${i}`;
    const star = typeof item.rating === 'number' ? item.rating : typeof item.star_rating === 'number' ? item.star_rating : null;
    const body = item.body.trim();

    const scoreInput: ScoreInput = {
      review_id,
      asin: product.asin,
      ticker: product.ticker,
      body,
      title: item.title ?? null,
      star_rating: star,
    };

    let score: ScoreResult;
    try {
      score = await scorer(scoreInput);
    } catch (e) {
      outcomes.push({ review_id, stored: false, error: `scoring failed: ${(e as Error).message}` });
      continue;
    }

    prepared.push({
      row: {
        review_id,
        platform: item.platform || 'amazon',
        review_date: item.date || item.review_date || new Date().toISOString().slice(0, 10),
        star_rating: star,
        title: item.title ?? null,
        body,
        author: item.author ?? null,
        verified_purchase: Boolean(item.verified ?? item.verified_purchase),
        source_type: item.source_type || 'csv_plugin',
        source_url: item.source_url ?? null,
        provenance: item.provenance ?? 'captured',
        score,
      },
    });
  }

  if (prepared.length > 0) {
    const insertRaw = db.prepare(`
      INSERT OR REPLACE INTO reviews_raw (review_id, asin, ticker, platform, review_date, star_rating, title, body, author, verified_purchase, source_type, source_url, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertScored = db.prepare(`
      INSERT OR REPLACE INTO reviews_scored (review_id, asin, ticker, tone_score, is_product_related, primary_reason, tags_json, model_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // One transaction for the whole batch: the pair, or neither.
    runInTransaction(db, () => {
      for (const { row } of prepared) {
        insertRaw.run(
          row.review_id,
          product.asin,
          product.ticker,
          row.platform,
          row.review_date,
          row.star_rating,
          row.title,
          row.body,
          row.author,
          row.verified_purchase ? 1 : 0,
          row.source_type,
          row.source_url,
          row.provenance,
        );
        insertScored.run(
          row.review_id,
          product.asin,
          product.ticker,
          row.score.tone_score,
          row.score.is_product_related ? 1 : 0,
          row.score.primary_reason,
          JSON.stringify(row.score.tags),
          row.score.model_used,
        );
      }
    });
  }

  const stored: IngestOutcome[] = prepared.map(({ row }) => ({ review_id: row.review_id, stored: true, score: row.score }));
  return {
    imported: stored.length,
    scored: stored.length,
    skipped: outcomes.length,
    outcomes: [...outcomes, ...stored],
  };
}
