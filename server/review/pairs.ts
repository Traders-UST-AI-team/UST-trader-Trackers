// H4 approval gate: a candidate pair becomes "verified" only when a named reviewer has completed every check and given a reason.
export interface EqPair { polymarket: string; kalshi: string; verified_by: string; verified_at: string; rules_note: string }
const col = (r: Record<string, string>, prefix: string) => r[Object.keys(r).find((k) => k.startsWith(prefix)) ?? prefix] ?? '';

export function approvable(r: Record<string, string>): boolean {
  return !!col(r, 'reviewer') && col(r, 'equivalent') === 'yes' && col(r, 'outcome_alignment') === 'same' && col(r, 'deadline_and_timezone_checked') === 'yes'
    && col(r, 'resolution_source_checked') === 'yes' && col(r, 'rationale').length >= 20 && /^0x[0-9a-f]{64}$/i.test(r.polymarket_id ?? '') && !!r.kalshi_id;
}

export function approvePairs(rows: Record<string, string>[], existing: EqPair[], today = new Date().toISOString().slice(0, 10)): { pairs: EqPair[]; added: number; rejected: number } {
  const pairs = [...existing];
  let added = 0, rejected = 0;
  for (const r of rows) {
    if (!col(r, 'reviewer') && !col(r, 'equivalent')) continue; // untouched row
    if (!approvable(r)) { rejected++; continue; }
    if (pairs.some((p) => p.polymarket === r.polymarket_id && p.kalshi === r.kalshi_id)) continue;
    pairs.push({ polymarket: r.polymarket_id, kalshi: r.kalshi_id, verified_by: col(r, 'reviewer'), verified_at: col(r, 'review_date') || today, rules_note: col(r, 'rationale') });
    added++;
  }
  return { pairs, added, rejected };
}

/** Wilson 95 % interval for k of n. */
export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
