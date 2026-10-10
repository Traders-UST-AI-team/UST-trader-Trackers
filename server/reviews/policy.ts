import type { BacktestSummary, CompanyFinancial, QuarterlyAggregation, ReviewDashboardSummary } from '../../shared/review-types.ts';
import { classifyQuarter, rollingBaseline, SIGNALS, type SignalOutcome } from '../../shared/review-signals.ts';
import { dateToCalendarQuarter, fiscalPeriodForCalendarQuarter, matchPeriodByDate, type CalendarQuarter } from './fiscal.ts';

/**
 * The row shape the aggregation needs: a stored review joined with its score.
 * Deliberately plain data, so the rules below can be exercised without a database.
 */
export interface ScoredReviewRow {
  review_id: string;
  review_date: string;
  platform: string;
  tone_score: number | null;
  is_product_related: number | boolean | null;
  primary_reason: string | null;
  tags_json: string | null;
  /** Amazon Vine (free product) review: counted, but kept out of tone. */
  is_vine?: number | boolean | null;
}

export interface QuarterSeries {
  quarters: QuarterlyAggregation[];
  totalNegatives: number;
  topTags: { tag: string; count: number }[];
}

const round3 = (n: number) => Number(n.toFixed(3));

/** A stored review counts for listing tone when it is product-related. Reddit rows are canaries. */
export const isProductRelated = (r: ScoredReviewRow): boolean =>
  r.is_product_related === 1 || r.is_product_related === true || r.is_product_related == null;

/**
 * Groups reviews into fiscal quarters and computes the tone series.
 *
 * Pure: everything it needs arrives as arguments, so the rules can be tested against literal arrays
 * instead of a seeded store. The financial join is on dates (see fiscal.ts), and an unmatched
 * quarter says so through `financial_match` rather than looking like an absent filing.
 */
export function quarterToneSeries(
  rows: ScoredReviewRow[],
  opts: { fiscalYearEndMonth: number; financials: CompanyFinancial[] },
): QuarterSeries {
  const buckets = new Map<string, { calendar: CalendarQuarter; rows: ScoredReviewRow[] }>();
  for (const r of rows) {
    const calendar = dateToCalendarQuarter(r.review_date);
    const bucket = buckets.get(calendar.key);
    if (bucket) bucket.rows.push(r);
    else buckets.set(calendar.key, { calendar, rows: [r] });
  }

  const sortedKeys = Array.from(buckets.keys()).sort();
  const latestFiledEnd = opts.financials.reduce<string | null>((m, f) => (m == null || f.period_end_date > m ? f.period_end_date : m), null);
  const quarters: QuarterlyAggregation[] = [];
  const toneHistory: number[] = [];
  let previousTone: number | null = null;
  let firstNegativeSwingDate: string | null = null;

  for (const qKey of sortedKeys) {
    const { calendar, rows: qReviews } = buckets.get(qKey)!;
    const fiscal = fiscalPeriodForCalendarQuarter(qKey, opts.fiscalYearEndMonth);
    const matchedFin = matchPeriodByDate(opts.financials, calendar);

    let totalTone = 0;
    let scoredCount = 0;
    let negativeCount = 0;
    let defectCount = 0;
    let qualityDeclineCount = 0;
    let productCount = 0;
    let sellerOnlyCount = 0;
    let vineCount = 0;
    let redditToneSum = 0;
    let redditCount = 0;
    let amazonToneSum = 0;
    let amazonCount = 0;
    let bestbuyToneSum = 0;
    let bestbuyCount = 0;
    let startDate = '';
    let endDate = '';

    for (const r of qReviews) {
      if (!startDate || r.review_date < startDate) startDate = r.review_date;
      if (!endDate || r.review_date > endDate) endDate = r.review_date;

      const product = isProductRelated(r);
      if (r.platform === 'reddit') {
        // A canary channel, not a retail listing: kept out of listing tone, tracked separately.
        if (r.tone_score != null) {
          redditToneSum += Number(r.tone_score);
          redditCount++;
        }
      } else if (r.is_vine === 1 || r.is_vine === true) {
        // Free-product reviews read systematically warmer; they are shown, never averaged in.
        vineCount++;
      } else if (product) {
        productCount++;
        if (r.tone_score != null) {
          const score = Number(r.tone_score);
          totalTone += score;
          scoredCount++;
          if (score <= -1) negativeCount++;
          if (r.platform === 'bestbuy') {
            bestbuyToneSum += score;
            bestbuyCount++;
          } else {
            amazonToneSum += score;
            amazonCount++;
          }
        }
      } else {
        sellerOnlyCount++;
      }

      if (r.primary_reason === 'defect') defectCount++;
      if (r.primary_reason === 'quality_decline') qualityDeclineCount++;
    }

    const avgTone = scoredCount > 0 ? round3(totalTone / scoredCount) : null;
    const baselineTone = rollingBaseline(toneHistory);
    if (avgTone != null) toneHistory.push(avgTone);

    const deltaTone = avgTone != null && baselineTone != null ? round3(avgTone - baselineTone) : null;
    const qoqChange = avgTone != null && previousTone != null ? round3(avgTone - previousTone) : null;
    if (avgTone != null) previousTone = avgTone;
    // Sparse is judged on the reviews that actually carry tone, not on every stored row.
    const { signal, is_negative_swing, is_sparse } = classifyQuarter({ delta_tone: deltaTone, review_count: scoredCount, qoq_change: qoqChange });

    if (is_negative_swing && !firstNegativeSwingDate && startDate) firstNegativeSwingDate = startDate;

    // A swing is only worth something if revenue followed it. The outcome is decided against the
    // filings that came *after* the swing quarter (see SIGNALS.outcomeHorizonQuarters), and a swing
    // that revenue did not follow is recorded as a miss, never quietly dropped.
    // A swing in a quarter newer than the latest filing is not untestable, just early: its own
    // report has not been filed yet.
    const notYetReported = !matchedFin && latestFiledEnd != null && calendar.start > latestFiledEnd;
    const outcome = is_negative_swing ? (notYetReported ? 'pending' : swingOutcome(matchedFin, opts.financials)) : null;
    const confirming = outcome === 'hit' && matchedFin ? confirmingFiling(matchedFin, opts.financials) : null;

    quarters.push({
      quarter_label: fiscal.label,
      calendar_quarter: qKey,
      start_date: startDate || calendar.start,
      end_date: endDate || calendar.end,
      review_count: qReviews.length,
      product_review_count: productCount,
      seller_only_count: sellerOnlyCount,
      vine_count: vineCount,
      tone_review_count: scoredCount,
      qoq_change: qoqChange,
      avg_tone: avgTone,
      baseline_tone: baselineTone,
      delta_tone: deltaTone,
      reddit_tone: redditCount > 0 ? round3(redditToneSum / redditCount) : null,
      amazon_tone: amazonCount > 0 ? round3(amazonToneSum / amazonCount) : null,
      bestbuy_tone: bestbuyCount > 0 ? round3(bestbuyToneSum / bestbuyCount) : null,
      negative_count: negativeCount,
      defect_count: defectCount,
      quality_decline_count: qualityDeclineCount,
      is_sparse,
      is_negative_swing,
      financial: matchedFin,
      financial_match: matchedFin ? 'matched' : 'no_filing',
      outcome,
      outcome_filing: confirming
        ? { fiscal_label: confirming.fiscal_label, revenue_yoy_growth: confirming.revenue_yoy_growth, sec_report_date: confirming.sec_report_date }
        : null,
      is_miss: outcome === 'miss',
      signal,
    });
  }

  const tagCounts = new Map<string, number>();
  let totalNegatives = 0;
  for (const r of rows) {
    if (r.tone_score != null && r.tone_score <= -1) totalNegatives++;
    if (!r.tags_json) continue;
    try {
      for (const t of JSON.parse(r.tags_json) as string[]) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    } catch {
      // an unreadable tag list is not worth failing an aggregate over
    }
  }

  return {
    quarters,
    totalNegatives,
    topTags: Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
  };
}

/** The reported quarters after `fin`, oldest first. */
function followingQuarters(fin: CompanyFinancial, financials: CompanyFinancial[]): CompanyFinancial[] {
  return financials
    .filter((f) => f.period_start_date > fin.period_end_date || (f.period_start_date >= fin.period_end_date && f.id !== fin.id))
    .sort((a, b) => a.period_end_date.localeCompare(b.period_end_date))
    .slice(0, SIGNALS.outcomeHorizonQuarters);
}

/** Whether revenue growth slowed within the horizon after the quarter reported as `fin`. */
function decelerated(fin: CompanyFinancial, financials: CompanyFinancial[]): SignalOutcome {
  if (fin.revenue_yoy_growth == null) return 'no_filing';
  const next = followingQuarters(fin, financials);
  if (next.some((f) => f.revenue_yoy_growth != null && f.revenue_yoy_growth < fin.revenue_yoy_growth!)) return 'hit';
  if (next.length >= SIGNALS.outcomeHorizonQuarters && next.every((f) => f.revenue_yoy_growth != null)) return 'miss';
  return 'pending';
}

/** The first following filing in which revenue growth was below `fin`'s — the one that confirmed a hit. */
export function confirmingFiling(fin: CompanyFinancial, financials: CompanyFinancial[]): CompanyFinancial | null {
  if (fin.revenue_yoy_growth == null) return null;
  return followingQuarters(fin, financials).find((f) => f.revenue_yoy_growth != null && f.revenue_yoy_growth < fin.revenue_yoy_growth!) ?? null;
}

/**
 * The outcome of a negative swing in the quarter reported as `fin`: hit when revenue YoY growth
 * slowed in one of the next `outcomeHorizonQuarters` reported quarters, miss when they are all
 * reported and none did, pending until then, no_filing when there is nothing to test against.
 */
export function swingOutcome(fin: CompanyFinancial | null | undefined, financials: CompanyFinancial[]): SignalOutcome {
  return fin ? decelerated(fin, financials) : 'no_filing';
}

/**
 * Hit rate of the swings, set against the base rate: how often revenue growth slowed after *any*
 * reported quarter. A hit rate no better than the base rate means the signal adds nothing.
 */
export function backtestSummary(quarters: QuarterlyAggregation[], financials: CompanyFinancial[]): BacktestSummary {
  const swings = quarters.filter((q) => q.is_negative_swing);
  const tally = (o: SignalOutcome) => swings.filter((q) => q.outcome === o).length;
  const hits = tally('hit');
  const misses = tally('miss');

  let baseHits = 0;
  let baseDecided = 0;
  for (const fin of financials) {
    const o = decelerated(fin, financials);
    if (o === 'hit') { baseHits++; baseDecided++; } else if (o === 'miss') baseDecided++;
  }

  return {
    horizon_quarters: SIGNALS.outcomeHorizonQuarters,
    swings: swings.length,
    hits,
    misses,
    pending: tally('pending'),
    no_filing: tally('no_filing'),
    hit_rate: hits + misses > 0 ? Number((hits / (hits + misses)).toFixed(3)) : null,
    base_rate: baseDecided > 0 ? Number((baseHits / baseDecided).toFixed(3)) : null,
    base_quarters: baseDecided,
  };
}

/** The headline state for a product, from its latest quarter. */
export function currentStatus(quarters: QuarterlyAggregation[]): ReviewDashboardSummary['current_status'] {
  const latest = quarters.at(-1);
  if (!latest) return 'neutral';
  if (latest.is_negative_swing) return 'negative_swing';
  if (latest.avg_tone != null && latest.avg_tone > SIGNALS.healthyTone) return 'healthy';
  if (latest.is_sparse) return 'sparse_data';
  return 'neutral';
}

/**
 * How far ahead of the first negative swing the earliest canary defect appeared.
 * Dynamically derived from stored dates; it used to be a literal in the client.
 */
export function canarySummary(
  rows: ScoredReviewRow[],
  quarters: QuarterlyAggregation[],
): ReviewDashboardSummary['canary_summary'] {
  const reddit = rows.filter((r) => r.platform === 'reddit' && r.tone_score != null);
  const redditSentiment = reddit.length > 0 ? Number((reddit.reduce((s, r) => s + Number(r.tone_score), 0) / reddit.length).toFixed(2)) : null;
  const earliestDefect = reddit.find((r) => r.primary_reason === 'defect')?.review_date ?? null;

  let leadTimeDays = 0;
  if (earliestDefect) {
    const defectTs = Date.parse(`${earliestDefect}T00:00:00Z`);
    const firstSwing = quarters.find((q) => q.is_negative_swing);
    if (firstSwing) leadTimeDays = Math.max(0, Math.round((Date.parse(`${firstSwing.start_date}T00:00:00Z`) - defectTs) / 86_400_000));
    if (leadTimeDays === 0) {
      // Otherwise: ahead of the filing that confirmed a swing (revenue growth slowed).
      const confirmed = quarters.find((q) => q.outcome === 'hit' && q.outcome_filing?.sec_report_date);
      if (confirmed?.outcome_filing?.sec_report_date) {
        leadTimeDays = Math.max(0, Math.round((Date.parse(`${confirmed.outcome_filing.sec_report_date}T00:00:00Z`) - defectTs) / 86_400_000));
      }
    }
  }

  return { reddit_sentiment: redditSentiment, reddit_post_count: reddit.length, earliest_defect_detected: earliestDefect, lead_time_days: leadTimeDays };
}

/** Record counts shown above the charts, plus the share of negative reviews. */
export function listingCounts(rows: ScoredReviewRow[]): { all_records_count: number; product_reviews_count: number; seller_only_count: number; negative_rate: number } {
  const listing = rows.filter((r) => r.platform !== 'reddit');
  const product = listing.filter(isProductRelated).length;
  const negatives = rows.filter((r) => r.tone_score != null && r.tone_score <= -1).length;
  return {
    all_records_count: listing.length,
    product_reviews_count: product,
    seller_only_count: listing.length - product,
    negative_rate: rows.length > 0 ? Number(((negatives / rows.length) * 100).toFixed(1)) : 0,
  };
}
