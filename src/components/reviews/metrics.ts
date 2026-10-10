import { classifyQuarter, QUARTER_SIGNAL_LABEL, SIGNALS, type QuarterSignal } from '../../../shared/review-signals';
import type { EnrichedReview, QuarterlyAggregation, ReviewProvenance } from '../../../shared/review-types';

/**
 * Presentation rules for the reviews workspace.
 *
 * Two disciplines live here so no view has to remember them:
 *   1. A value that has not loaded, or does not exist, renders as `NO_VALUE`. It is never replaced
 *      by a plausible number — the previous view printed literals such as 0.667 and 100 that were
 *      indistinguishable from measured values.
 *   2. Signal classification comes from the shared thresholds, or from the flag the server already
 *      sent. A quarter cannot be a warning in the table and stable in the chart.
 */

/** Shown when a value is unknown: not loaded, or genuinely absent. */
export const NO_VALUE = '—';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function formatTone(v: number | null | undefined, digits = 3): string {
  return isNum(v) ? v.toFixed(digits) : NO_VALUE;
}

export function formatDelta(v: number | null | undefined, digits = 3): string {
  if (!isNum(v)) return NO_VALUE;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

export function formatCount(v: number | null | undefined): string {
  return isNum(v) ? String(v) : NO_VALUE;
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${v.toFixed(digits)} %` : NO_VALUE;
}

export function formatMillions(v: number | null | undefined): string {
  return isNum(v) ? `$${Math.round(v / 1e6).toLocaleString("en-US")}M` : NO_VALUE;
}

export type SignalTone = 'warn' | 'good' | 'flat' | 'unknown';

export interface QuarterAssessment {
  signal: QuarterSignal;
  label: string;
  tone: SignalTone;
  /** True when the quarter is too thin for its mean to mean much. */
  sparse: boolean;
}

/**
 * Classifies a quarter for display. Prefers the flag the server computed and only falls back to
 * the shared rules when the wire has none, so the two can never disagree about the same quarter.
 */
export function quarterAssessment(q: {
  delta_tone?: number | null;
  review_count?: number | null;
  signal?: QuarterSignal | null;
  is_negative_swing?: boolean;
}): QuarterAssessment {
  const reviewCount = isNum(q.review_count) ? q.review_count : 0;
  const computed = classifyQuarter({ delta_tone: isNum(q.delta_tone) ? q.delta_tone : null, review_count: reviewCount });
  const signal: QuarterSignal = q.signal ?? (q.is_negative_swing === true ? 'negative_swing' : computed.signal);
  const tone: SignalTone = signal === 'negative_swing' ? 'warn' : signal === 'positive' ? 'good' : 'flat';
  return { signal, label: QUARTER_SIGNAL_LABEL[signal], tone, sparse: computed.is_sparse };
}

/** True when a quarter has fewer reviews than the shared threshold allows. */
export const isSparseQuarter = (reviewCount: number | null | undefined): boolean =>
  isNum(reviewCount) ? reviewCount < SIGNALS.sparseReviewCount : false;

export interface ProvenanceSummary {
  captured: number;
  seed: number;
  synthetic: number;
  total: number;
  /** A sentence for the header, or null when every row is captured evidence. */
  label: string | null;
}

/**
 * What the numbers on screen are actually made of. Seed and synthetic rows are demo or fixture
 * material and must be labelled wherever they contribute to a count.
 */
export function summariseProvenance(reviews: Pick<EnrichedReview, 'provenance'>[]): ProvenanceSummary {
  const counts: Record<ReviewProvenance, number> = { captured: 0, seed: 0, synthetic: 0 };
  for (const r of reviews) counts[r.provenance ?? 'captured']++;
  const total = reviews.length;
  const foreign = counts.seed + counts.synthetic;
  const parts: string[] = [];
  if (counts.seed > 0) parts.push(`${counts.seed} demo rows`);
  if (counts.synthetic > 0) parts.push(`${counts.synthetic} sample rows (no provider reachable)`);
  const label = foreign === 0 ? null : `${parts.join(' · ')} — of ${total} reviews shown; only captured rows are evidence.`;
  return { ...counts, total, label };
}

/** The headline sentence above the charts, with unknown values shown as unknown. */
export function headline(summary: { latest_quarter: QuarterlyAggregation | null } | null, companyName: string | null): string {
  const q = summary?.latest_quarter ?? null;
  if (!summary) return 'Loading the latest stored quarter…';
  if (!q) return `No stored reviews for ${companyName ?? 'this product'} yet, so there is no quarter to describe.`;
  const change = q.delta_tone == null ? 'no baseline yet, so no change to report' : `a change of ${formatDelta(q.delta_tone)}`;
  return `${q.quarter_label}: mean tone ${formatTone(q.avg_tone)} against a prior-four-quarter baseline of ${formatTone(q.baseline_tone)}, ${change}, from ${formatCount(q.product_review_count ?? q.review_count)} product reviews.`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthShort = (m: number) => MONTH_SHORT[(((m - 1) % 12) + 12) % 12];

/**
 * Describes a company's fiscal quarters from its year-end month. The previous view hardcoded three
 * branches (March, May, December) and mislabelled every other company, including two already seeded.
 */
export function fiscalYearEndNote(fiscalYearEndMonth: number | null | undefined): string {
  if (!isNum(fiscalYearEndMonth) || fiscalYearEndMonth < 1 || fiscalYearEndMonth > 12) {
    return `not loaded yet.`;
  }
  const first = (fiscalYearEndMonth % 12) + 1;
  const quarter = (i: number) => `${monthShort(first + i * 3)}–${monthShort(first + i * 3 + 2)}`;
  return `${MONTH_LONG[fiscalYearEndMonth - 1]} (last day): Q1 ${quarter(0)}, Q2 ${quarter(1)}, Q3 ${quarter(2)}, Q4 ${quarter(3)}.`;
}
