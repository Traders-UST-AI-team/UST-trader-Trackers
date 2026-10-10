/**
 * The signal rules for a quarter of review tone, defined once.
 *
 * These thresholds decide whether a quarter is a "negative swing", and the same numbers were
 * previously re-typed in the dashboard query, in the KPI strip, in the tone-change table and in the
 * chart — one of which used a threshold (`> 0.2`) the server had never heard of, so a quarter could
 * be a warning in one view and stable in another. Server and client both read from here.
 */
export const SIGNALS = {
  /** Delta tone below this is a negative swing (θ in the write-up). */
  negativeSwingDelta: -0.15,
  /** Delta tone above this is a positive expansion. */
  positiveDelta: 0.2,
  /** Fewer tone-bearing reviews than this in a quarter makes the mean unreliable. */
  sparseReviewCount: 20,
  /** Quarters of history used for the rolling baseline. */
  baselineWindowQuarters: 4,
  /** Mean tone above this counts as healthy when there is no swing. */
  healthyTone: 0.5,
  /**
   * How many reported quarters after a swing are checked for its outcome. A swing is a hit when
   * revenue YoY growth in any of them is below the swing quarter's own YoY growth (deceleration);
   * a miss when all of them are reported and none is; pending while they are not yet reported.
   */
  outcomeHorizonQuarters: 2,
} as const;

export type QuarterSignal = 'negative_swing' | 'positive' | 'stable';

export interface QuarterSignalAssessment {
  signal: QuarterSignal;
  is_negative_swing: boolean;
  is_sparse: boolean;
}

/**
 * Classifies one quarter. Takes only what the rule needs, so it can be applied to any array.
 *
 * A negative swing needs both halves of the rule: tone sits well below its own 4-quarter baseline
 * *and* it fell from the previous quarter. A quarter that is still below baseline but recovering is
 * not a new swing. `qoq_change` is optional so a caller without the previous quarter still gets the
 * baseline half of the rule.
 */
export function classifyQuarter(input: { delta_tone: number | null; review_count: number; qoq_change?: number | null }): QuarterSignalAssessment {
  const { delta_tone, review_count, qoq_change } = input;
  const turnedDown = qoq_change == null || qoq_change < 0;
  const signal: QuarterSignal =
    delta_tone == null ? 'stable'
      : delta_tone < SIGNALS.negativeSwingDelta && turnedDown ? 'negative_swing'
      : delta_tone > SIGNALS.positiveDelta ? 'positive'
      : 'stable';
  return { signal, is_negative_swing: signal === 'negative_swing', is_sparse: review_count < SIGNALS.sparseReviewCount };
}

export const QUARTER_SIGNAL_LABEL: Record<QuarterSignal, string> = {
  negative_swing: 'Negative swing',
  positive: 'Positive expansion',
  stable: 'Stable',
};

/** What happened to revenue after a negative swing. */
export type SignalOutcome = 'hit' | 'miss' | 'pending' | 'no_filing';

export const SIGNAL_OUTCOME_LABEL: Record<SignalOutcome, string> = {
  hit: 'Hit — revenue growth slowed',
  miss: 'Miss — revenue growth held',
  pending: 'Pending — awaiting filings',
  no_filing: 'No filing to test against',
};

/** The rolling mean tone of the previous `baselineWindowQuarters` quarters, or null without enough history. */
export function rollingBaseline(previousAvgTones: number[]): number | null {
  const window = SIGNALS.baselineWindowQuarters;
  if (previousAvgTones.length < window) return null;
  const slice = previousAvgTones.slice(-window);
  return Number((slice.reduce((a, b) => a + b, 0) / window).toFixed(3));
}
