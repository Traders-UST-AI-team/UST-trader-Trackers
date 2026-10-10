// H2/H4 review gates: verified pairs need a named reviewer and every check; benchmark intervals are Wilson 95 %.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvePairs, wilson } from './review/pairs.ts';

const PM = '0x' + 'a'.repeat(64);
const row = (o: Record<string, string> = {}) => ({ polymarket_id: PM, kalshi_id: 'KX-1', reviewer: 'Dr. R', 'equivalent (yes|no|partial)': 'yes', 'outcome_alignment (same|inverted|different)': 'same',
  'deadline_and_timezone_checked (yes|no)': 'yes', 'resolution_source_checked (yes|no)': 'yes', rationale: 'Both resolve on the same official announcement before 31 Dec ET.', review_date: '2026-10-10', ...o });

test('pairs: only a named, fully checked, reasoned review is approved; untouched rows are ignored; no duplicates', () => {
  const r = approvePairs([row(), row({ reviewer: '' }), row({ 'outcome_alignment (same|inverted|different)': 'inverted' }), row({ rationale: 'looks same' }),
    row({ 'resolution_source_checked (yes|no)': 'no' }), { polymarket_id: PM, kalshi_id: 'KX-2' }, row()], []);
  assert.equal(r.added, 1); assert.equal(r.rejected, 4);
  assert.deepEqual(r.pairs[0], { polymarket: PM, kalshi: 'KX-1', verified_by: 'Dr. R', verified_at: '2026-10-10', rules_note: 'Both resolve on the same official announcement before 31 Dec ET.' });
});

test('wilson interval', () => {
  const [lo, hi] = wilson(8, 10)!;
  assert.ok(Math.abs(lo - 0.4902) < 1e-3 && Math.abs(hi - 0.9433) < 1e-3);
  assert.equal(wilson(0, 0), null);
});
