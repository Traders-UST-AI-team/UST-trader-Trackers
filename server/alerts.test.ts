// Package F: in-app alert semantics — transitions, re-arm, cooldown dedupe, stale/backfill/seed suppression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-alerts-')), 't.sqlite');
const { db } = await import('./db.ts');
const AL = await import('./alerts.ts');
const S = await import('./wallets/store.ts');

const T = Math.floor(Date.now() / 3_600_000) * 3600 - 6 * 3600 + 120; // two minutes past an hour, safely in the past
const NOW = T * 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

function market(id: string) {
  db.prepare("INSERT INTO markets (condition_id, event_id, event_slug, event_title, question, outcome_label, token_id, observed_at, is_open, venue, price) VALUES (?, 'e','e','E', ?, 'Yes', ?, 'x', 1, 'polymarket', 0.3)").run(id, `Question ${id}?`, `tok-${id}`);
}
/** 72 completed hours of history ending in the hour before T; the last `tail` hours at `tailP`. */
function history(id: string, tail: number, tailP: number) {
  db.prepare('DELETE FROM price_history WHERE condition_id = ?').run(id);
  for (let h = 72; h >= 1; h--) {
    const t = Math.floor(T / 3600) * 3600 - h * 3600 + 1800;
    db.prepare('INSERT INTO price_history (condition_id, t, p) VALUES (?,?,?)').run(id, t, h <= tail ? tailP : 0.3);
  }
}
const alertsFor = (rule: string, target: string) => db.prepare('SELECT * FROM alerts WHERE rule_id = ? AND target_id = ? ORDER BY opened_at').all(rule, target) as Record<string, any>[];
const stateOf = (rule: string, target: string) => (db.prepare('SELECT state FROM alert_state WHERE rule_id = ? AND target_id = ?').get(rule, target) as { state: string } | undefined)?.state;

AL.setRule('hourly_move_p95', { enabled: false });

test('level rule: fires only on an observed normal → abnormal change; one record while abnormal; recovers; reopens within cooldown', () => {
  market('mA');
  history('mA', 2, 0.45);                                   // already abnormal at the first reading
  AL.evaluateAlerts({ seed: false, now: NOW });
  assert.equal(alertsFor('change_24h', 'mA').length, 0, 'no observed normal state before → no alert');
  history('mA', 0, 0.3);
  AL.evaluateAlerts({ seed: false, now: NOW });
  assert.equal(stateOf('change_24h', 'mA'), 'normal');
  history('mA', 2, 0.45);                                   // +15 pp ≥ 10 pp
  const r = AL.evaluateAlerts({ seed: false, now: NOW });
  assert.equal(r.opened, 1);
  AL.evaluateAlerts({ seed: false, now: NOW + 60_000 });     // still abnormal: same record, not a new alert
  let a = alertsFor('change_24h', 'mA');
  assert.equal(a.length, 1); assert.equal(a[0].occurrences, 1); assert.equal(a[0].recovered_at, null);
  assert.match(a[0].detail, /\+15\.0 pp between/);
  history('mA', 0, 0.3);
  assert.equal(AL.evaluateAlerts({ seed: false, now: NOW + 120_000 }).recovered, 1);
  assert.ok(alertsFor('change_24h', 'mA')[0].recovered_at);
  history('mA', 2, 0.45);                                   // abnormal again within the 120-min cooldown → same alert reopened
  AL.evaluateAlerts({ seed: false, now: NOW + 180_000 });
  a = alertsFor('change_24h', 'mA');
  assert.equal(a.length, 1); assert.equal(a[0].occurrences, 2); assert.equal(a[0].recovered_at, null);
});

test('level rule: stale input never fires, and a fresh abnormal reading after it needs a normal reading first', () => {
  market('mB');
  history('mB', 0, 0.3);
  AL.evaluateAlerts({ seed: false, now: NOW });
  assert.equal(stateOf('change_24h', 'mB'), 'normal');
  history('mB', 2, 0.6);
  AL.evaluateAlerts({ seed: false, now: NOW + 6 * 3600_000 }); // latest completed sample is hours old → stale
  assert.equal(alertsFor('change_24h', 'mB').length, 0);
  assert.equal(stateOf('change_24h', 'mB'), 'unknown');
  AL.evaluateAlerts({ seed: false, now: NOW });                 // fresh again but abnormal: no transition observed
  assert.equal(alertsFor('change_24h', 'mB').length, 0);
});

test('event rule: new fresh polled trades fire once per target and cooldown window; backfill, old or stale-collected rows never fire', () => {
  const C = 'mA';
  S.setPilotMarkets([C]);
  AL.evaluateAlerts({ seed: false, now: NOW });                 // sets the event cursors
  const W = '0x' + '9'.repeat(40);
  const ins = (key: string, notional: number, ts: number, firstSeen: number, via: string) =>
    db.prepare("INSERT INTO pm_market_trades (key, condition_id, token_id, outcome, outcome_index, wallet, side, size_shares, price_usdc, notional_usdc, ts, tx_hash, first_seen_at, seen_via, api_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'v2')")
      .run(key, C, 'tokNO', 'No', 1, W, 'BUY', notional * 2, 0.5, notional, ts, `0x${key}`, iso(firstSeen), via);
  S.putSync(`trades:${C}`, { last_ok_at: iso(T + 60), last_status: 'ok' });
  ins('t1', 20_000, T + 30, T + 60, 'poll');
  ins('t2', 15_000, T + 90, T + 100, 'poll');                   // same 30-min window → grouped
  ins('bk', 50_000, T + 40, T + 100, 'gap');                    // recovered from a gap: history, not news
  ins('old', 50_000, T - 4 * 3600, T + 100, 'poll');            // first seen hours after it happened
  ins('small', 50, T + 50, T + 100, 'poll');
  AL.evaluateAlerts({ seed: false, now: NOW + 150_000 });
  const a = alertsFor('large_trade', C);
  assert.equal(a.length, 1); assert.equal(a[0].occurrences, 2); assert.equal(a[0].value, 20_000);
  assert.match(a[0].detail, /BUY No/);
  // re-evaluating never replays the same rows
  AL.evaluateAlerts({ seed: false, now: NOW + 200_000 });
  assert.equal(alertsFor('large_trade', C)[0].occurrences, 2);
  // stale collection for the market: a new big trade does not fire
  S.putSync(`trades:${C}`, { last_ok_at: iso(T - 3 * 3600) });
  ins('t3', 30_000, T + 3000, T + 3100, 'poll');
  AL.evaluateAlerts({ seed: false, now: (T + 3200) * 1000 });
  assert.equal(alertsFor('large_trade', C).length, 1);
});

test('rules are validated; seed mode never evaluates', () => {
  assert.equal(AL.setRule('change_24h', { threshold: 0.5 }).ok, false);
  assert.equal(AL.setRule('change_24h', { cooldown_min: 1 }).ok, false);
  assert.equal(AL.setRule('change_24h', { foo: 1 }).ok, false);
  assert.equal(AL.setRule('nope', {}).ok, false);
  const ok = AL.setRule('change_24h', { threshold: 12 });
  assert.ok(ok.ok && ok.rule.threshold === 12 && ok.rule.version === 1);
  const before = (db.prepare('SELECT COUNT(*) c FROM alerts').get() as { c: number }).c;
  const r = AL.evaluateAlerts({ seed: true, now: NOW });
  assert.match(r.skipped_reason ?? '', /seed mode/);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM alerts').get() as { c: number }).c, before);
  assert.equal(AL.alertsResponse(true).enabled, false);
});
