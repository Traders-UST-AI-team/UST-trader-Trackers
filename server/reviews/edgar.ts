/**
 * SEC EDGAR: who a ticker is, when its fiscal year ends, and what it reported each quarter.
 *
 * Everything here reads EDGAR's public JSON APIs (no key). The SEC's fair-access policy asks every
 * client to identify itself; set SEC_USER_AGENT to "<product> <contact email>" in production.
 *
 * Quarterly figures come from XBRL "company facts". 10-Qs report Q1–Q3 directly; Q4 is rarely tagged
 * on its own, so it is derived as the 10-K full year minus the three quarters inside it, and marked
 * as derived. A value restated in a later filing replaces the original, but the report date kept is
 * the *first* filing — the day the market learned the number, which is what a lead-time test needs.
 */
import { fetchJson, type FetchOpts } from '../http.ts';
import { fiscalPeriodContaining } from './fiscal.ts';

export const SEC_USER_AGENT = process.env.SEC_USER_AGENT || 'TradersTracker reviews-pilot (set SEC_USER_AGENT to add a contact)';

export interface EdgarDeps {
  transport?: FetchOpts;
}

const secGet = <T>(url: string, deps: EdgarDeps = {}) =>
  fetchJson<T>(url, { timeoutMs: 20_000, retries: 2, ...deps.transport, headers: { 'user-agent': SEC_USER_AGENT, ...deps.transport?.headers } });

export const padCik = (cik: string | number) => String(cik).replace(/\D/g, '').padStart(10, '0');

export interface EdgarCompany {
  ticker: string;
  cik: string;
  name: string;
  /** 1–12; null when EDGAR does not state it. */
  fiscal_year_end_month: number | null;
  sector: string | null;
}

/**
 * The month a fiscal year ends in, from EDGAR's "MMDD". A 52/53-week year that closes in the first
 * week of a month (YETI: "0103") belongs to the month before — its year is effectively December.
 */
export function fiscalYearEndMonth(mmdd: string | undefined): number | null {
  if (!mmdd || !/^\d{4}$/.test(mmdd)) return null;
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  if (month < 1 || month > 12) return null;
  return day <= 7 ? (month === 1 ? 12 : month - 1) : month;
}

/** Resolves a ticker to its CIK and profile. Returns null when EDGAR has no such ticker. */
export async function lookupCompany(ticker: string, deps: EdgarDeps = {}): Promise<EdgarCompany | null> {
  const wanted = ticker.trim().toUpperCase();
  const map = await secGet<Record<string, { cik_str: number; ticker: string; title: string }>>('https://www.sec.gov/files/company_tickers.json', deps);
  const hit = Object.values(map).find((r) => r.ticker.toUpperCase() === wanted);
  if (!hit) return null;
  const cik = padCik(hit.cik_str);
  const sub = await secGet<{ name?: string; fiscalYearEnd?: string; sicDescription?: string }>(`https://data.sec.gov/submissions/CIK${cik}.json`, deps);
  return {
    ticker: wanted,
    cik,
    name: sub.name || hit.title,
    fiscal_year_end_month: fiscalYearEndMonth(sub.fiscalYearEnd),
    sector: sub.sicDescription || null,
  };
}

/** One XBRL fact as EDGAR publishes it. */
export interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

/** Revenue has been tagged under several concepts over the years; earlier entries win on a tie. */
export const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueGoodsNet',
];

export interface QuarterFigure {
  start: string;
  end: string;
  value: number;
  accn: string;
  /** First time this period's value was filed. */
  first_filed: string;
  form: string;
  /** Q4 computed as full year minus Q1–Q3, rather than reported on its own. */
  derived: boolean;
}

const DAY = 86_400_000;
const days = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Quarterly values for one concept family: one value per period, Q4s derived where only the year
 * was reported. Pure, so it is tested against literal facts.
 */
export function quarterlySeries(factLists: XbrlFact[][]): QuarterFigure[] {
  // One entry per (start, end): the latest filing's value, the earliest filing's date. A concept
  // earlier in the list owns a period it reports; a later one only fills periods the first lacks.
  const periods = new Map<string, { fact: XbrlFact; first_filed: string; rank: number }>();
  factLists.forEach((facts, rank) => {
    for (const f of facts) {
      if (!f.start || !Number.isFinite(f.val)) continue;
      const key = `${f.start}|${f.end}`;
      const seen = periods.get(key);
      if (!seen) { periods.set(key, { fact: f, first_filed: f.filed, rank }); continue; }
      if (rank > seen.rank) continue;
      const first_filed = f.filed < seen.first_filed ? f.filed : seen.first_filed;
      const fact = rank < seen.rank || f.filed > seen.fact.filed ? f : seen.fact;
      periods.set(key, { fact, first_filed, rank: Math.min(rank, seen.rank) });
    }
  });

  const all = [...periods.values()];
  const quarters = new Map<string, QuarterFigure>();
  for (const { fact, first_filed } of all) {
    const d = days(fact.start!, fact.end);
    if (d >= 80 && d <= 100) {
      quarters.set(fact.end, { start: fact.start!, end: fact.end, value: fact.val, accn: fact.accn, first_filed, form: fact.form, derived: false });
    }
  }

  // Derive Q4 = year − (the three quarters inside it), when the year's last quarter is missing.
  for (const { fact, first_filed } of all) {
    const d = days(fact.start!, fact.end);
    if (d < 350 || d > 380 || quarters.has(fact.end)) continue;
    const inside = [...quarters.values()]
      .filter((q) => q.start >= fact.start! && q.end < fact.end)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (inside.length !== 3) continue;
    const start = addDays(inside[2].end, 1);
    if (days(start, fact.end) < 80) continue;
    quarters.set(fact.end, {
      start,
      end: fact.end,
      value: fact.val - inside.reduce((s, q) => s + q.value, 0),
      accn: fact.accn,
      first_filed,
      form: fact.form,
      derived: true,
    });
  }

  return [...quarters.values()].sort((a, b) => a.end.localeCompare(b.end));
}

export interface ReportedQuarter {
  id: string;
  fiscal_year: number;
  fiscal_quarter: number;
  fiscal_label: string;
  period_start_date: string;
  period_end_date: string;
  sec_report_date: string;
  revenue_usd: number;
  revenue_yoy_growth: number | null;
  operating_income_usd: number | null;
  gross_margin: number | null;
  accession_number: string;
  source_filing_url: string;
  official_excerpt: string;
}

/** The quarter a year earlier: its end lies 365 ± 10 days before this one's. */
function yearAgo(series: QuarterFigure[], q: QuarterFigure): QuarterFigure | undefined {
  const target = Date.parse(`${q.end}T00:00:00Z`) - 365 * DAY;
  return series.find((p) => Math.abs(Date.parse(`${p.end}T00:00:00Z`) - target) <= 10 * DAY);
}

/**
 * Turns company facts into the rows the dashboard stores. The fiscal label is decided from the
 * middle of the period, which keeps 52/53-week calendars (periods ending a few days off a month
 * end) in the right fiscal quarter.
 */
export function reportedQuarters(
  facts: { 'us-gaap'?: Record<string, { units?: Record<string, XbrlFact[]> }> },
  opts: { ticker: string; cik: string; fiscalYearEndMonth: number },
): ReportedQuarter[] {
  const gaap = facts['us-gaap'] ?? {};
  const usd = (concept: string) => gaap[concept]?.units?.USD ?? [];
  const revenue = quarterlySeries(REVENUE_CONCEPTS.map(usd));
  const opIncome = new Map(quarterlySeries([usd('OperatingIncomeLoss')]).map((q) => [q.end, q.value]));
  const grossProfit = new Map(quarterlySeries([usd('GrossProfit')]).map((q) => [q.end, q.value]));
  const cikNum = String(Number(opts.cik));

  return revenue.map((q) => {
    const mid = addDays(q.start, Math.floor(days(q.start, q.end) / 2));
    const fiscal = fiscalPeriodContaining(mid, opts.fiscalYearEndMonth);
    const prior = yearAgo(revenue, q);
    const yoy = prior && prior.value !== 0 ? Number((((q.value - prior.value) / Math.abs(prior.value)) * 100).toFixed(2)) : null;
    const gp = grossProfit.get(q.end);
    return {
      id: `${opts.ticker}-FY${fiscal.fiscal_year}Q${fiscal.fiscal_quarter}`,
      fiscal_year: fiscal.fiscal_year,
      fiscal_quarter: fiscal.fiscal_quarter,
      fiscal_label: fiscal.label,
      period_start_date: q.start,
      period_end_date: q.end,
      sec_report_date: q.first_filed,
      revenue_usd: q.value,
      revenue_yoy_growth: yoy,
      operating_income_usd: opIncome.get(q.end) ?? null,
      gross_margin: gp != null && q.value ? Number(((gp / q.value) * 100).toFixed(2)) : null,
      accession_number: q.accn,
      source_filing_url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${q.accn.replace(/-/g, '')}/`,
      official_excerpt: q.derived
        ? `Q4 derived from the ${q.form} full-year figure less Q1–Q3 (EDGAR XBRL).`
        : `Reported in ${q.form} (EDGAR XBRL).`,
    };
  });
}

/** Fetches company facts and returns the reported quarters. Throws when EDGAR cannot be read. */
export async function fetchReportedQuarters(
  company: { ticker: string; cik: string; fiscal_year_end_month: number },
  deps: EdgarDeps = {},
): Promise<ReportedQuarter[]> {
  const cik = padCik(company.cik);
  const json = await secGet<{ facts?: Record<string, Record<string, { units?: Record<string, XbrlFact[]> }>> }>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    deps,
  );
  return reportedQuarters(json.facts ?? {}, { ticker: company.ticker, cik, fiscalYearEndMonth: company.fiscal_year_end_month });
}
