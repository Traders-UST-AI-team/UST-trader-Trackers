import type { CompanyFinancial, QuarterlyAggregation, ReviewDashboardSummary } from '../../shared/review-types.ts';
import { classifyQuarter, rollingBaseline, SIGNALS } from '../../shared/review-signals.ts';
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
  const quarters: QuarterlyAggregation[] = [];
  const toneHistory: number[] = [];
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
    const { signal, is_negative_swing, is_sparse } = classifyQuarter({ delta_tone: deltaTone, review_count: qReviews.length });

    if (is_negative_swing && !firstNegativeSwingDate && startDate) firstNegativeSwingDate = startDate;

    // A "miss" here is the divergence this pilot looks for: tone swung negative while reported
    // revenue was still growing. That is the canary, not a confirmatory earnings miss.
    const isMiss = Boolean(is_negative_swing && matchedFin && matchedFin.revenue_yoy_growth != null && matchedFin.revenue_yoy_growth > 0);

    quarters.push({
      quarter_label: fiscal.label,
      calendar_quarter: qKey,
      start_date: startDate || calendar.start,
      end_date: endDate || calendar.end,
      review_count: qReviews.length,
      product_review_count: productCount,
      seller_only_count: sellerOnlyCount,
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
      is_miss: isMiss,
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
      const missWithFiling = quarters.find((q) => q.is_miss && q.financial?.sec_report_date);
      if (missWithFiling?.financial?.sec_report_date) {
        leadTimeDays = Math.max(0, Math.round((Date.parse(`${missWithFiling.financial.sec_report_date}T00:00:00Z`) - defectTs) / 86_400_000));
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
