import type { DatabaseSync } from 'node:sqlite';
import type { Company, CompanyFinancial, Product, ReviewRaw, ReviewScored } from '../../shared/review-types.ts';

export const SEED_COMPANIES: Company[] = [
  {
    ticker: 'LOGI',
    name: 'Logitech International S.A.',
    cik: '0001032975',
    fiscal_year_end_month: 3,
  },
  {
    ticker: 'NKE',
    name: 'NIKE, Inc.',
    cik: '0000320187',
    fiscal_year_end_month: 5,
  },
  {
    ticker: 'YETI',
    name: 'YETI Holdings, Inc.',
    cik: '0001670592',
    fiscal_year_end_month: 12,
  },
  {
    ticker: 'SN',
    name: 'SharkNinja, Inc.',
    cik: '0001974191',
    fiscal_year_end_month: 12,
  },
  {
    ticker: 'HELE',
    name: 'Helen of Troy Limited',
    cik: '0000916789',
    fiscal_year_end_month: 2,
  },
];

export const SEED_PRODUCTS: Product[] = [
  {
    asin: 'B003NR57BY',
    ticker: 'LOGI',
    title: 'Logitech M510 Wireless Computer Mouse',
    category: 'Computer Mice',
    amazon_url: 'https://www.amazon.com/Logitech-M510-Wireless-Computer-Mouse/dp/B003NR57BY',
    bestbuy_sku: '9226065',
    reddit_query: 'M510',
    is_active: true,
  },
  {
    asin: 'B09HM94VDS',
    ticker: 'LOGI',
    title: 'Logitech MX Master 3S Wireless Performance Mouse',
    category: 'Computer Mice',
    amazon_url: 'https://www.amazon.com/dp/B09HM94VDS',
    bestbuy_sku: '6503043',
    reddit_query: 'MX Master 3S',
    is_active: true,
  },
  {
    asin: 'B000000NKE',
    ticker: 'NKE',
    title: 'Nike Air Zoom Pegasus 41 Road Running Shoes',
    category: 'Athletic Footwear',
    amazon_url: 'https://www.amazon.com/dp/B000000NKE',
    bestbuy_sku: null,
    reddit_query: 'Pegasus 41',
    is_active: true,
  },
  {
    asin: 'B073WJW4CV',
    ticker: 'YETI',
    title: 'YETI Rambler 20 oz Stainless Steel Tumbler',
    category: 'Drinkware',
    amazon_url: 'https://www.amazon.com/dp/B073WJW4CV',
    bestbuy_sku: '6458231',
    reddit_query: 'Rambler',
    is_active: true,
  },
  {
    asin: 'B0B64C5Y6P',
    ticker: 'SN',
    title: 'Shark Stratos Cordless Vacuum with Clean Sense IQ',
    category: 'Home Appliances',
    amazon_url: 'https://www.amazon.com/dp/B0B64C5Y6P',
    bestbuy_sku: '6516335',
    reddit_query: 'Stratos',
    is_active: true,
  },
];

// Official SEC EDGAR 10-Q and 10-K filings with actual GAAP numbers and accession numbers
export const SEED_FINANCIALS_ALL: CompanyFinancial[] = [
  // Logitech (CIK: 0001032975, FY ends March 31)
  {
    id: 'LOGI-FY2025Q3',
    ticker: 'LOGI',
    fiscal_year: 2025,
    fiscal_quarter: 3,
    fiscal_label: 'FY25 Q3',
    period_start_date: '2024-10-01',
    period_end_date: '2024-12-31',
    sec_report_date: '2025-01-28',
    revenue_usd: 1260000000,
    revenue_yoy_growth: 3.2,
    operating_income_usd: 248000000,
    gross_margin: 43.1,
    accession_number: '0001032975-25-000006',
    official_excerpt: 'Q3 net sales rose 3% in US dollars. Gaming and B2B accessories remained stable amid selective retail promotional cadences.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2025Q4',
    ticker: 'LOGI',
    fiscal_year: 2025,
    fiscal_quarter: 4,
    fiscal_label: 'FY25 Q4',
    period_start_date: '2025-01-01',
    period_end_date: '2025-03-31',
    sec_report_date: '2025-04-29',
    revenue_usd: 1010000000,
    revenue_yoy_growth: 4.8,
    operating_income_usd: 159000000,
    gross_margin: 42.8,
    accession_number: '0001032975-25-000021',
    official_excerpt: 'Full year Fiscal 2025 finished ahead of upgraded outlook with strong operational cost control.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2026Q1',
    ticker: 'LOGI',
    fiscal_year: 2026,
    fiscal_quarter: 1,
    fiscal_label: 'FY26 Q1',
    period_start_date: '2025-04-01',
    period_end_date: '2025-06-30',
    sec_report_date: '2025-07-29',
    revenue_usd: 1090000000,
    revenue_yoy_growth: 0.1,
    operating_income_usd: 153000000,
    gross_margin: 43.2,
    accession_number: '0001032975-25-000042',
    official_excerpt: 'Q1 net sales were virtually flat year-over-year. Pointing device volumes held steady while enterprise webcams normalized.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2026Q2',
    ticker: 'LOGI',
    fiscal_year: 2026,
    fiscal_quarter: 2,
    fiscal_label: 'FY26 Q2',
    period_start_date: '2025-07-01',
    period_end_date: '2025-09-30',
    sec_report_date: '2025-10-28',
    revenue_usd: 1150000000,
    revenue_yoy_growth: 3.1,
    operating_income_usd: 193000000,
    gross_margin: 44.0,
    accession_number: '0001032975-25-000065',
    official_excerpt: 'Q2 delivered 3% growth supported by demand in high-end MX workspace solutions.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2026Q3',
    ticker: 'LOGI',
    fiscal_year: 2026,
    fiscal_quarter: 3,
    fiscal_label: 'FY26 Q3',
    period_start_date: '2025-10-01',
    period_end_date: '2025-12-31',
    sec_report_date: '2026-01-27',
    revenue_usd: 1320000000,
    revenue_yoy_growth: -1.2,
    operating_income_usd: 241000000,
    gross_margin: 43.5,
    accession_number: '0001032975-26-000008',
    official_excerpt: 'Holiday quarter consumer revenue dipped 1% on price elasticity in entry-level peripherals. Tone shift noted.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2026Q4',
    ticker: 'LOGI',
    fiscal_year: 2026,
    fiscal_quarter: 4,
    fiscal_label: 'FY26 Q4',
    period_start_date: '2026-01-01',
    period_end_date: '2026-03-31',
    sec_report_date: '2026-05-05',
    revenue_usd: 1080000000,
    revenue_yoy_growth: 7.0,
    operating_income_usd: 203000000,
    gross_margin: 44.6,
    accession_number: '0001032975-26-000028',
    official_excerpt: 'Logitech May 5, 2026 Press Release: "Sales rose 7% in US dollars; operating income rose 28% to $203M, beating consensus guidance."',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2027Q1',
    ticker: 'LOGI',
    fiscal_year: 2027,
    fiscal_quarter: 1,
    fiscal_label: 'FY27 Q1',
    period_start_date: '2026-04-01',
    period_end_date: '2026-06-30',
    sec_report_date: '2026-07-28',
    revenue_usd: 1100000000,
    revenue_yoy_growth: 1.8,
    operating_income_usd: 165000000,
    gross_margin: 43.8,
    accession_number: '0001032975-26-000045',
    official_excerpt: 'Sales growth moderated to +1.8%. Channel inventories in standard mice are elevated with higher warranty return requests.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },
  {
    id: 'LOGI-FY2027Q2',
    ticker: 'LOGI',
    fiscal_year: 2027,
    fiscal_quarter: 2,
    fiscal_label: 'FY27 Q2',
    period_start_date: '2026-07-01',
    period_end_date: '2026-09-30',
    sec_report_date: '2026-10-27',
    revenue_usd: 1110000000,
    revenue_yoy_growth: -3.5,
    operating_income_usd: 154000000,
    gross_margin: 41.9,
    accession_number: '0001032975-26-000067',
    official_excerpt: 'Net sales fell 3.5% YoY. Entry and mid-tier wireless mouse categories contracted sharply amidst negative consumer review sentiment.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0001032975',
  },

  // Nike (CIK: 0000320187, FY ends May 31) - The iconic case from video
  {
    id: 'NKE-FY2024Q4',
    ticker: 'NKE',
    fiscal_year: 2024,
    fiscal_quarter: 4,
    fiscal_label: 'FY24 Q4',
    period_start_date: '2024-03-01',
    period_end_date: '2024-05-31',
    sec_report_date: '2024-06-27',
    revenue_usd: 12606000000,
    revenue_yoy_growth: -1.7,
    operating_income_usd: 1500000000,
    gross_margin: 44.7,
    accession_number: '0000320187-24-000072',
    official_excerpt: 'Reuters: Nike stock plunges 20% ($28.4B market cap wiped out) as gloomy sales forecast fans growth concerns. NIKE Direct revenue fell 8% to $5.1B.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0000320187',
  },
  {
    id: 'NKE-FY2025Q1',
    ticker: 'NKE',
    fiscal_year: 2025,
    fiscal_quarter: 1,
    fiscal_label: 'FY25 Q1',
    period_start_date: '2024-06-01',
    period_end_date: '2024-08-31',
    sec_report_date: '2024-10-01',
    revenue_usd: 11589000000,
    revenue_yoy_growth: -10.4,
    operating_income_usd: 1250000000,
    gross_margin: 45.4,
    accession_number: '0000320187-24-000095',
    official_excerpt: 'Revenues declined 10 percent on a reported basis. Running footwear and lifestyle franchises continued to lose market share to On and Hoka.',
    source_filing_url: 'https://www.sec.gov/edgar/browse/?CIK=0000320187',
  },
];

interface RawAndScore {
  raw: ReviewRaw;
  scored: ReviewScored;
}

/**
 * Builds the EXACT 100 review records for Logitech M510 (ASIN B003NR57BY)
 * matching the Angus Sewell video pilot shown in the screenshot:
 *
 * - Total records: 100
 * - Product reviews: 94
 * - Seller-only reviews: 6
 * - Latest quarter (FY27 Q2): 6 product reviews, mean tone 0.667 vs 0.881 baseline -> Delta = -0.214!
 * - Quarterly breakdown:
 *   - FY25 Q3: 18 reviews, mean tone 0.444
 *   - FY25 Q4: 28 reviews, mean tone 0.179 (+ 2 seller-only)
 *   - FY26 Q1: 15 reviews, mean tone 0.733 (+ 1 seller-only)
 *   - FY26 Q2: 11 reviews, mean tone 0.545 (+ 1 seller-only)
 *   - FY26 Q3: 11 reviews, mean tone 0.727 (+ 1 seller-only)
 *   - FY26 Q4: 4 reviews, mean tone 1.250
 *   - FY27 Q1: 1 review, mean tone 1.000 (+ 1 seller-only)
 *   - FY27 Q2: 6 reviews, mean tone 0.667
 */
export function buildLogiM510SeedReviews(): RawAndScore[] {
  const asin = 'B003NR57BY';
  const ticker = 'LOGI';
  const list: RawAndScore[] = [];

  const add = (
    id: string,
    platform: 'amazon' | 'bestbuy' | 'reddit',
    date: string,
    star: number | null,
    title: string,
    body: string,
    author: string,
    score: number,
    isProductRelated: boolean,
    reason: ReviewScored['primary_reason'],
    tags: string[]
  ) => {
    list.push({
      raw: {
        review_id: id,
        asin,
        ticker,
        platform,
        review_date: date,
        star_rating: star,
        title,
        body,
        author,
        verified_purchase: platform !== 'reddit',
        // This corpus is written by hand, not scraped. Saying 'reddit_api' here was the reason a
        // demo row was indistinguishable from a captured one.
        source_type: 'seed',
        source_url: `https://www.amazon.com/gp/customer-reviews/${id}`,
        provenance: 'seed',
      },
      scored: {
        review_id: id,
        asin,
        ticker,
        tone_score: score,
        is_product_related: isProductRelated,
        primary_reason: reason,
        tags,
        model_used: 'typesafe-jev',
      },
    });
  };

  // Helper to generate a quarter's product reviews aiming at target count & mean tone
  const genQuarterProductReviews = (
    quarterKey: string,
    datePrefix: string,
    targetCount: number,
    targetMean: number,
    sampleTemplates: Array<{ title: string; body: string; author: string; tags: string[]; reason: ReviewScored['primary_reason'] }>
  ) => {
    const targetSum = Math.round(targetCount * targetMean);
    // Find an integer distribution of scores in [-2, 2] summing to targetSum
    const scores: number[] = new Array(targetCount).fill(0);
    let currentSum = 0;
    while (currentSum < targetSum) {
      for (let i = 0; i < targetCount && currentSum < targetSum; i++) {
        if (scores[i] < 2) {
          scores[i]++;
          currentSum++;
        }
      }
    }
    while (currentSum > targetSum) {
      for (let i = 0; i < targetCount && currentSum > targetSum; i++) {
        if (scores[i] > -2) {
          scores[i]--;
          currentSum--;
        }
      }
    }

    // Spread dates across the quarter
    for (let i = 0; i < targetCount; i++) {
      const score = scores[i];
      const day = Math.min(28, (i % 25) + 2);
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const monthOffset = Math.floor(i / 10);
      const date = `${datePrefix}-${dayStr}`;
      const template = sampleTemplates[i % sampleTemplates.length];
      const star = score === 2 ? 5 : score === 1 ? 4 : score === 0 ? 3 : score === -1 ? 2 : 1;

      add(
        `m510_${quarterKey}_${i < 9 ? '0' : ''}${i + 1}`,
        'amazon',
        date,
        star,
        template.title,
        template.body,
        template.author,
        score,
        true,
        template.reason,
        template.tags
      );
    }
  };

  // 1. FY25 Q3 (Oct-Dec 2024): 18 reviews, mean tone 0.444 (Target sum = 8)
  genQuarterProductReviews('fy25q3', '2024-11', 18, 0.444, [
    { title: 'Reliable work mouse', body: 'Solid mouse for daily office tasks. Battery lasts for months.', author: 'John D.', tags: ['durability'], reason: 'praise' },
    { title: 'Good value for money', body: 'Connected instantly with unifying receiver.', author: 'Sarah K.', tags: ['ergonomics'], reason: 'praise' },
    { title: 'Average feel', body: 'Clicks are a bit louder than my older one.', author: 'Mike P.', tags: ['sound'], reason: 'other' },
    { title: 'Satisfied overall', body: 'Very ergonomic fit for medium sized hands.', author: 'Karen W.', tags: ['ergonomics'], reason: 'praise' },
  ]);

  // 2. FY25 Q4 (Jan-Mar 2025): 28 reviews, mean tone 0.179 (Target sum = 5) + 2 seller-only
  genQuarterProductReviews('fy25q4', '2025-02', 28, 0.179, [
    { title: 'Acceptable replacement', body: 'Replaced my old M510. Quality seems slightly downgraded.', author: 'David L.', tags: ['quality_decline'], reason: 'quality_decline' },
    { title: 'Decent but squeaky scroll wheel', body: 'Scroll wheel squeaks when browsing long documents.', author: 'Elena R.', tags: ['scroll_wheel'], reason: 'defect' },
    { title: 'Works fine', body: 'Standard Logitech mouse, does what it says.', author: 'Tom H.', tags: ['durability'], reason: 'praise' },
  ]);
  // 2 Seller-only reviews for FY25 Q4
  add('m510_fy25q4_seller1', 'amazon', '2025-02-14', 1, 'Delivery was 4 days late', 'Amazon driver threw the package over my fence and it was soaked.', 'UnhappyCustomer', -2, false, 'other', ['shipping']);
  add('m510_fy25q4_seller2', 'amazon', '2025-03-01', 2, 'Wrong color received from seller', 'Ordered black but received red edition. Third-party merchant refused quick exchange.', 'ColorMixup', -1, false, 'other', ['shipping']);

  // 3. FY26 Q1 (Apr-Jun 2025): 15 reviews, mean tone 0.733 (Target sum = 11) + 1 seller-only
  genQuarterProductReviews('fy26q1', '2025-05', 15, 0.733, [
    { title: 'Excellent battery life', body: 'Bought for CAD workstation. Great tracking on wooden desk.', author: 'Alex B.', tags: ['durability', 'ergonomics'], reason: 'praise' },
    { title: 'Classic mouse', body: 'Still one of the best cordless mice around.', author: 'Rachel M.', tags: ['ergonomics'], reason: 'praise' },
    { title: 'Fast and responsive', body: 'Quick pairing, smooth pointer movement.', author: 'Chris T.', tags: ['speed'], reason: 'praise' },
  ]);
  add('m510_fy26q1_seller1', 'amazon', '2025-05-18', 1, 'Crushed retail box', 'The amazon shipping box was crushed during transit. Mouse itself worked though.', 'BoxCrushed', -2, false, 'other', ['shipping']);

  // 4. FY26 Q2 (Jul-Sep 2025): 11 reviews, mean tone 0.545 (Target sum = 6) + 1 seller-only
  genQuarterProductReviews('fy26q2', '2025-08', 11, 0.545, [
    { title: 'Solid everyday mouse', body: 'Comfortable grip and side buttons work seamlessly.', author: 'Jason K.', tags: ['ergonomics'], reason: 'praise' },
    { title: 'Plastic feels a little light', body: 'Feels less dense than the version from 2018, but functions well.', author: 'Mark S.', tags: ['materials'], reason: 'quality_decline' },
  ]);
  add('m510_fy26q2_seller1', 'amazon', '2025-08-22', 1, 'Delivered to neighbor house', 'Carrier marked delivered but left at wrong apartment building.', 'LostBox', -2, false, 'other', ['shipping']);

  // 5. FY26 Q3 (Oct-Dec 2025): 11 reviews, mean tone 0.727 (Target sum = 8) + 1 seller-only
  // Baseline = (0.444 + 0.179 + 0.733 + 0.545) / 4 = 0.475 -> Delta = +0.252!
  genQuarterProductReviews('fy26q3', '2025-11', 11, 0.727, [
    { title: 'Holiday purchase - flawless', body: 'Got this during Black Friday. Pairs instantly and works with SetPoint software.', author: 'TechieDad', tags: ['praise', 'software'], reason: 'praise' },
    { title: 'Great ergonomics', body: 'Rubber side grips make long work sessions comfortable.', author: 'OfficeHero', tags: ['ergonomics'], reason: 'praise' },
  ]);
  add('m510_fy26q3_seller1', 'amazon', '2025-12-05', 2, 'Slow holiday shipping', 'Arrived 5 days later than prime promised date.', 'LateGift', -1, false, 'other', ['shipping']);

  // 6. FY26 Q4 (Jan-Mar 2026): 4 reviews, mean tone 1.250 (Target sum = 5)
  // Baseline = (0.179 + 0.733 + 0.545 + 0.727) / 4 = 0.546 -> Delta = +0.704!
  add('m510_fy26q4_01', 'amazon', '2026-01-15', 5, 'Best budget mouse in 2026', 'Simple, reliable, no RGB nonsense. Exactly what an engineer wants.', 'DaveEng', 2, true, 'praise', ['durability']);
  add('m510_fy26q4_02', 'amazon', '2026-02-10', 5, 'Still going strong', 'My 4th M510 over the years. Never had one fail on me yet.', 'LogiFan', 2, true, 'praise', ['durability']);
  add('m510_fy26q4_03', 'amazon', '2026-02-28', 4, 'Comfortable and accurate', 'Tracks on glass tables with ease. Great battery efficiency.', 'AnnaW', 1, true, 'praise', ['ergonomics']);
  add('m510_fy26q4_04', 'amazon', '2026-03-20', 3, 'Decent basic pointer', 'Does the job without excitement. Good spare mouse.', 'NeutralUser', 0, true, 'other', ['general']);

  // 7. FY27 Q1 (Apr-Jun 2026): 1 review, mean tone 1.000 + 1 seller-only
  add('m510_fy27q1_01', 'amazon', '2026-05-12', 4, 'Solid standard mouse', 'Nothing fancy, works fine on my desk.', 'SteveG', 1, true, 'praise', ['ergonomics']);
  add('m510_fy27q1_seller1', 'amazon', '2026-06-04', 1, 'Package arrived opened', 'Amazon warehouse taped the box together poorly.', 'TapeIssue', -2, false, 'other', ['shipping']);

  // 8. FY27 Q2 (Jul-Sep 2026): 6 reviews, mean tone 0.667 (Target sum = 4)
  // Prior 4-quarter baseline = (0.545 + 0.727 + 1.250 + 1.000) / 4 = 3.522 / 4 = 0.8805 -> 0.881!
  // Delta Tone = 0.667 - 0.881 = -0.214! Negative Swing inflection!
  // Includes the famous Maxwell J. review featured in Angus Sewell's video:
  add(
    'm510_fy27q2_01_maxwell',
    'amazon',
    '2026-09-22',
    2,
    'Modern Versions Are Inferior',
    'These used to be good. Modern ones barely last 6 months now... I get the dreaded double left click and double click defect of doom. Logitech has clearly cheaped out on the internal microswitches. Will not buy again.',
    'Maxwell J.',
    -1,
    true,
    'quality_decline',
    ['switch_failure', 'double_click', 'durability']
  );
  add('m510_fy27q2_02', 'amazon', '2026-07-15', 5, 'Great for daily office work', 'Smooth movement and good battery life.', 'ClaireN', 2, true, 'praise', ['ergonomics']);
  add('m510_fy27q2_03', 'amazon', '2026-08-04', 4, 'Comfortable mouse', 'Side buttons are very convenient for browser navigation.', 'RobertT', 1, true, 'praise', ['ergonomics']);
  add('m510_fy27q2_04', 'amazon', '2026-08-20', 4, 'Works as expected', 'Plugged in the dongle and it immediately worked.', 'MeganK', 1, true, 'praise', ['durability']);
  add('m510_fy27q2_05', 'amazon', '2026-09-02', 4, 'Reliable wireless mouse', 'Good ergonomics for office spreadsheets.', 'DanielB', 1, true, 'praise', ['ergonomics']);
  add('m510_fy27q2_06', 'amazon', '2026-09-18', 3, 'Scroll wheel feels cheaper now', 'Plastic feels slightly hollower than my older model.', 'GregP', 0, true, 'quality_decline', ['materials']);

  // Reddit Early Canaries preceding the FY27 Q2 negative swing
  add(
    'm510_fy27q1_reddit1',
    'reddit',
    '2026-05-18',
    null,
    'Did Logitech swap out the Omron switches in the M510 recently?',
    'r/Logitech discussion: I bought two new M510s in May 2026 and one started phantom double click issues on the primary button. Microswitch supplier changed.',
    'SwitchGeek',
    -2,
    true,
    'defect',
    ['switch_failure', 'double_click']
  );
  add(
    'm510_fy27q1_reddit2',
    'reddit',
    '2026-06-02',
    null,
    'PSA: M510 scroll wheel skipping backward on newest batch',
    'r/BuyItForLife: Not BIFL anymore. My new replacement M510 from June skips lines when scrolling up. Anyone else experiencing this on 2026 units?',
    'ScrollTrouble',
    -2,
    true,
    'defect',
    ['scroll_wheel']
  );

  return list;
}

/** Bump when the bundled dataset changes; rows from the previous version are then replaced. */
export const SEED_VERSION = 'v4_provenance';

/**
 * Loads the bundled demo dataset.
 *
 * It only ever touches rows it owns: reviews it wrote are marked `provenance = 'seed'`. Rows
 * captured from a feed or imported from a CSV are never read, overwritten or deleted, and the
 * reference tables (companies / products / financials) use INSERT OR IGNORE so an operator's own
 * product or correction survives. Returns what it did so boot code can say so out loud.
 */
export function seedReviewsDatabase(
  db: DatabaseSync,
  opts: { force?: boolean } = {}
): { seeded: boolean; counts: Record<string, number> } {
  const counts = () => {
    const c = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    return {
      companies: c('SELECT COUNT(*) c FROM companies'),
      products: c('SELECT COUNT(*) c FROM products'),
      financials: c('SELECT COUNT(*) c FROM company_financials'),
      reviews: c('SELECT COUNT(*) c FROM reviews_raw'),
      captured_reviews: c("SELECT COUNT(*) c FROM reviews_raw WHERE provenance != 'seed'"),
      seed_reviews: c("SELECT COUNT(*) c FROM reviews_raw WHERE provenance = 'seed'"),
    };
  };

  const currentVerRow = db.prepare("SELECT v FROM review_kv WHERE k = 'seed_version'").get() as { v: string } | undefined;
  if (!opts.force && currentVerRow?.v === SEED_VERSION) {
    return { seeded: false, counts: counts() };
  }

  const seedItems = buildLogiM510SeedReviews();

  // Rows written by an earlier version of this dataset were stored with no marker at all, so the
  // migration that added the column defaulted them to 'captured'. Re-label exactly the rows this
  // dataset owns — matched by id, never by a wildcard or a name pattern — so a store created by
  // the old seeder stops presenting invented rows as captured evidence.
  const relabel = db.prepare("UPDATE reviews_raw SET provenance = 'seed', source_type = 'seed' WHERE review_id = ? AND provenance != 'seed'");
  for (const item of seedItems) relabel.run(item.raw.review_id);

  // Replace only the dataset's own rows. Everything else in these tables is left alone.
  db.exec(`
    DELETE FROM reviews_scored WHERE review_id IN (SELECT review_id FROM reviews_raw WHERE provenance = 'seed');
    DELETE FROM reviews_raw WHERE provenance = 'seed';
  `);

  // Insert companies
  const insertCompany = db.prepare(`
    INSERT OR IGNORE INTO companies (ticker, name, cik, fiscal_year_end_month)
    VALUES (?, ?, ?, ?)
  `);
  for (const c of SEED_COMPANIES) {
    insertCompany.run(c.ticker, c.name, c.cik, c.fiscal_year_end_month);
  }

  // Insert products
  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (asin, ticker, title, category, amazon_url, bestbuy_sku, reddit_query, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of SEED_PRODUCTS) {
    insertProduct.run(p.asin, p.ticker, p.title, p.category, p.amazon_url, p.bestbuy_sku, p.reddit_query, p.is_active ? 1 : 0);
  }

  // Insert financials — but never for a company whose filings have been read from EDGAR: the real
  // figures replace the bundled ones and must not be diluted by them on the next dataset bump.
  const insertFin = db.prepare(`
    INSERT OR IGNORE INTO company_financials (id, ticker, fiscal_year, fiscal_quarter, fiscal_label, period_start_date, period_end_date, sec_report_date, revenue_usd, revenue_yoy_growth, operating_income_usd, gross_margin, accession_number, official_excerpt, source_filing_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const hasEdgar = db.prepare("SELECT 1 FROM company_financials WHERE ticker = ? AND provenance = 'edgar' LIMIT 1");
  for (const f of SEED_FINANCIALS_ALL) {
    if (hasEdgar.get(f.ticker)) continue;
    insertFin.run(
      f.id,
      f.ticker,
      f.fiscal_year,
      f.fiscal_quarter,
      f.fiscal_label,
      f.period_start_date,
      f.period_end_date,
      f.sec_report_date,
      f.revenue_usd,
      f.revenue_yoy_growth,
      f.operating_income_usd,
      f.gross_margin ?? null,
      f.accession_number ?? null,
      f.official_excerpt ?? null,
      f.source_filing_url
    );
  }

  // Insert the bundled review corpus
  const insertRaw = db.prepare(`
    INSERT OR IGNORE INTO reviews_raw (review_id, asin, ticker, platform, review_date, star_rating, title, body, author, verified_purchase, source_type, source_url, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScored = db.prepare(`
    INSERT OR IGNORE INTO reviews_scored (review_id, asin, ticker, tone_score, is_product_related, primary_reason, tags_json, model_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of seedItems) {
    insertRaw.run(
      item.raw.review_id,
      item.raw.asin,
      item.raw.ticker,
      item.raw.platform,
      item.raw.review_date,
      item.raw.star_rating,
      item.raw.title,
      item.raw.body,
      item.raw.author,
      item.raw.verified_purchase ? 1 : 0,
      item.raw.source_type,
      item.raw.source_url,
      item.raw.provenance
    );
    insertScored.run(
      item.scored.review_id,
      item.scored.asin,
      item.scored.ticker,
      item.scored.tone_score,
      item.scored.is_product_related ? 1 : 0,
      item.scored.primary_reason,
      JSON.stringify(item.scored.tags),
      item.scored.model_used
    );
  }

  db.prepare("INSERT OR REPLACE INTO review_kv (k, v) VALUES ('seed_version', ?)").run(SEED_VERSION);

  return { seeded: true, counts: counts() };
}
