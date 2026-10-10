/**
 * Calendar ↔ company fiscal periods.
 *
 * The dashboard needs to line a calendar quarter up with the fiscal quarter a company actually
 * reports. Doing that by string-matching a display label ("FY25 Q2") silently produces no match
 * whenever the label is wrong, and "we mislabelled the quarter" then looks exactly like "no filing
 * exists". This module answers the question with dates instead, for any fiscal-year-end month —
 * the previous implementation only handled March and December and fell back to a silent default.
 */

export interface CalendarQuarter {
  key: string; // 'YYYY-Q1' .. 'YYYY-Q4'
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export interface FiscalPeriod {
  label: string; // e.g. 'FY25 Q2'
  fiscal_year: number; // the calendar year the fiscal year ends in
  fiscal_quarter: number; // 1..4 within that fiscal year
  start: string; // first day of the fiscal year
  end: string; // last day of the fiscal year
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Days in a month, 1-indexed month, proleptic Gregorian. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const monthEnd = (year: number, month: number) => iso(year, month, daysInMonth(year, month));

/** Whole months from `from` (YYYY-MM-DD) to `to`, both interpreted as UTC dates. */
function wholeMonthsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const fa = new Date(a);
  const fb = new Date(b);
  return (fb.getUTCFullYear() - fa.getUTCFullYear()) * 12 + (fb.getUTCMonth() - fa.getUTCMonth());
}

/** Returns the quarter key, and its first and last day, for a date. Invalid input falls back to today. */
export function dateToCalendarQuarter(dateStr: string | null | undefined, now = new Date()): CalendarQuarter {
  const parsed = typeof dateStr === 'string' && /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : null;
  const y = parsed ? Number(parsed.slice(0, 4)) : now.getUTCFullYear();
  const m = parsed ? Number(parsed.slice(5, 7)) : now.getUTCMonth() + 1;
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return dateToCalendarQuarter(null, now);
  }
  const q = Math.ceil(m / 3);
  const firstMonth = (q - 1) * 3 + 1;
  return { key: `${y}-Q${q}`, start: iso(y, firstMonth, 1), end: monthEnd(y, firstMonth + 2) };
}

/**
 * The fiscal year containing `date`, for a company whose fiscal year ends in `fiscalYearEndMonth`.
 *
 * The fiscal year is identified by the calendar year it *ends* in, which is how companies label it
 * (Logitech's FY25 runs April 2024 → March 2025).
 */
export function fiscalPeriodContaining(date: string, fiscalYearEndMonth: number): FiscalPeriod {
  const m = Math.min(12, Math.max(1, Math.trunc(fiscalYearEndMonth) || 12));
  const d = date.slice(0, 10);
  const year = Number(d.slice(0, 4));

  // The fiscal year end on or after this date is the end of the fiscal year it belongs to.
  const thisYearEnd = monthEnd(year, m);
  const endYear = thisYearEnd >= d ? year : year + 1;
  const end = monthEnd(endYear, m);
  // The fiscal year starts the day after the previous year's end month.
  const startMonth = m === 12 ? 1 : m + 1;
  const startYear = m === 12 ? endYear : endYear - 1;
  const start = iso(startYear, startMonth, 1);

  const offset = wholeMonthsBetween(start, d);
  const fiscal_quarter = Math.min(4, Math.max(1, Math.floor(offset / 3) + 1));

  return { label: `FY${String(endYear).slice(-2)} Q${fiscal_quarter}`, fiscal_year: endYear, fiscal_quarter, start, end };
}

/**
 * The fiscal period a calendar quarter belongs to, decided by the quarter's first day. A quarter
 * that straddles a fiscal year end (possible for any month other than 3/6/9/12) is assigned to the
 * fiscal quarter containing its start, which keeps every review in exactly one bucket.
 */
export function fiscalPeriodForCalendarQuarter(calendarQ: string, fiscalYearEndMonth: number): FiscalPeriod {
  // The key is already a quarter, so read it as one: routing it back through the date parser would
  // silently fall back to today's quarter.
  const parsed = /^(\d{4})-Q([1-4])$/.exec(calendarQ);
  const now = new Date();
  const year = parsed ? Number(parsed[1]) : now.getUTCFullYear();
  const quarter = parsed ? Number(parsed[2]) : Math.ceil((now.getUTCMonth() + 1) / 3);
  const firstMonth = (quarter - 1) * 3 + 1;
  return fiscalPeriodContaining(iso(year, firstMonth, 1), fiscalYearEndMonth);
}

/** Convenience wrapper: just the display label. */
export function calendarQuarterToFiscalLabel(calendarQ: string, fiscalYearEndMonth = 3): string {
  return fiscalPeriodForCalendarQuarter(calendarQ, fiscalYearEndMonth).label;
}

export interface DatedPeriod {
  period_start_date: string;
  period_end_date: string;
}

/**
 * The reported period that a calendar quarter falls inside, matched on dates rather than on a
 * label. Returns null only when the company genuinely has no filing covering that window, and
 * callers are expected to say so rather than treat the absence as "no earnings miss".
 */
export function matchPeriodByDate<T extends DatedPeriod>(periods: T[], quarter: CalendarQuarter): T | null {
  return periods.find((p) => p.period_start_date <= quarter.start && p.period_end_date >= quarter.start) ?? null;
}
