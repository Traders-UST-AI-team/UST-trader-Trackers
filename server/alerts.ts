// In-app alerts (Package F; definition `alert-1.0.0`). No external notifications.
// Level rules keep a state per (rule, target): an alert opens only on an OBSERVED normal → abnormal transition, stays one record
// while abnormal (value updated, marked revised if the input was revised), is marked recovered on a normal reading and the
// rule re-arms. A first-ever or post-outage abnormal reading does not fire (there was no observed normal state before it).
// Event rules (single trades) fire for genuinely new rows only — never for backfilled, gap-recovered or stale data — and are
// deduplicated into one alert per (rule, target, cooldown window). Seed mode never evaluates anything.
import type { Express } from 'express';
import { db, kvGet, kvSet } from './db.ts';
import { marketIndicators } from './indicators/service.ts';
import { sourceHealth } from './sourcehealth.ts';
import { configOf } from './sourceconfig.ts';
import { coverageOf, largeTrades } from './wallets/analytics.ts';
import { bump } from './versions.ts';
import type { AlertItem, AlertRuleView, AlertsResponse, AlertSeverity } from '../shared/types.ts';

export const ALERT_DEFINITION_VERSION = 'alert-1.0.0';
type Row = Record<string, any>;

interface RuleDef { id: string; title: string; description: string; kind: 'level' | 'event'; unit: string; threshold: number; bounds: [number, number]; cooldown_min: number; enabled: boolean }
export const RULES: RuleDef[] = [
  { id: 'hourly_move_p95', kind: 'level', title: 'Hourly move above its own P95', unit: '× P95', threshold: 1, bounds: [1, 5], cooldown_min: 60, enabled: true,
    description: 'The latest completed-hour move of a contract exceeds threshold × the 95th percentile of its prior 168 adjacent-hour moves (server indicator hourly_movement, status ok only). Describes unusualness, not a cause.' },
  { id: 'change_24h', kind: 'level', title: '24h probability change', unit: 'pp', threshold: 10, bounds: [2, 50], cooldown_min: 120, enabled: true,
    description: '|change_24h| of a contract (completed-hour samples, server indicator, status ok only) is at least the threshold.' },
  { id: 'large_trade', kind: 'event', title: 'Large trade on a pilot market', unit: 'USDC', threshold: 10_000, bounds: [100, 10_000_000], cooldown_min: 30, enabled: true,
    description: 'A newly collected single trade on a pilot market at or above the threshold (market tape, taker side). Backfilled or gap-recovered trades and stale collection never fire.' },
  { id: 'watched_wallet_trade', kind: 'event', title: 'Watched-wallet trade', unit: 'USDC', threshold: 1_000, bounds: [1, 10_000_000], cooldown_min: 30, enabled: true,
    description: 'A newly collected BUY/SELL by a watched wallet at or above the threshold. Grouped per wallet per cooldown window.' },
  { id: 'source_failed', kind: 'level', title: 'Data source failing', unit: 'state', threshold: 1, bounds: [1, 1], cooldown_min: 180, enabled: true,
    description: 'A collector failed its last attempt or is paused by its circuit breaker. A data-status alert, not a market or event signal.' },
];
const ruleDef = (id: string) => RULES.find((r) => r.id === id);

export function rules(): AlertRuleView[] {
  return RULES.map((d) => {
    const r = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(d.id) as Row | undefined;
    return { id: d.id, title: d.title, description: d.description, kind: d.kind, unit: d.unit, bounds: d.bounds, enabled: r ? !!r.enabled : d.enabled, threshold: r?.threshold ?? d.threshold, cooldown_min: r?.cooldown_min ?? d.cooldown_min, version: r?.version ?? 0 };
  });
}
const ruleOf = (id: string) => rules().find((r) => r.id === id)!;

export function setRule(id: string, patch: unknown): { ok: true; rule: AlertRuleView } | { ok: false; error: string } {
  const d = ruleDef(id);
  if (!d) return { ok: false, error: `unknown rule ${id}` };
  const p = (patch ?? {}) as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !['enabled', 'threshold', 'cooldown_min'].includes(k));
  if (extra.length) return { ok: false, error: `unknown field(s): ${extra.join(', ')}` };
  const cur = ruleOf(id);
  const enabled = p.enabled === undefined ? cur.enabled : p.enabled;
  const threshold = p.threshold === undefined ? cur.threshold : p.threshold;
  const cooldown = p.cooldown_min === undefined ? cur.cooldown_min : p.cooldown_min;
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be boolean' };
  if (typeof threshold !== 'number' || !(threshold >= d.bounds[0] && threshold <= d.bounds[1])) return { ok: false, error: `threshold must be a number between ${d.bounds[0]} and ${d.bounds[1]} ${d.unit}` };
  if (typeof cooldown !== 'number' || !Number.isInteger(cooldown) || cooldown < 5 || cooldown > 10080) return { ok: false, error: 'cooldown_min must be an integer between 5 and 10080' };
  db.prepare(`INSERT INTO alert_rules (id, enabled, threshold, cooldown_min, version, updated_at) VALUES (?,?,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, threshold = excluded.threshold, cooldown_min = excluded.cooldown_min, version = alert_rules.version + 1, updated_at = excluded.updated_at`)
    .run(id, enabled ? 1 : 0, threshold, cooldown, new Date().toISOString());
  return { ok: true, rule: ruleOf(id) };
}

// ── level rules: state machine ──
type Reading = { status: 'ok'; abnormal: boolean; value: number; label: string; detail: string; severity: AlertSeverity; evidence: Record<string, unknown>; inputVersion?: string }
  | { status: 'unknown'; reason: string };

function applyLevel(ruleId: string, targetKind: string, targetId: string, reading: Reading, now: string): 'opened' | 'reopened' | 'updated' | 'recovered' | 'none' {
  const rule = ruleOf(ruleId);
  const prev = db.prepare('SELECT * FROM alert_state WHERE rule_id = ? AND target_id = ?').get(ruleId, targetId) as Row | undefined;
  const put = (state: string, since: string, value: number | null, inputStatus: string, openId: string | null) =>
    db.prepare('INSERT OR REPLACE INTO alert_state (rule_id, target_id, state, since, last_value, last_eval_at, last_input_status, open_alert_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(ruleId, targetId, state, since, value, now, inputStatus, openId);
  if (reading.status !== 'ok') {
    // Stale / gap / warming-up input: no transition in either direction; a later normal reading is required to re-arm.
    put(prev?.state === 'abnormal' ? 'abnormal' : 'unknown', prev?.since ?? now, prev?.last_value ?? null, reading.reason.slice(0, 120), prev?.open_alert_id ?? null);
    return 'none';
  }
  if (!reading.abnormal) {
    if (prev?.state === 'abnormal' && prev.open_alert_id) db.prepare('UPDATE alerts SET recovered_at = ?, last_seen_at = ? WHERE id = ? AND recovered_at IS NULL').run(now, now, prev.open_alert_id);
    put('normal', prev?.state === 'normal' ? prev.since : now, reading.value, 'ok', null);
    return prev?.state === 'abnormal' ? 'recovered' : 'none';
  }
  if (prev?.state === 'abnormal') {
    if (prev.open_alert_id) {
      const a = db.prepare('SELECT value, evidence FROM alerts WHERE id = ?').get(prev.open_alert_id) as Row | undefined;
      const revised = a && reading.inputVersion && JSON.parse(a.evidence || '{}').input_version && JSON.parse(a.evidence).input_version !== reading.inputVersion ? 1 : 0;
      db.prepare('UPDATE alerts SET value = ?, last_seen_at = ?, revised = MAX(revised, ?), evidence = ? WHERE id = ?').run(reading.value, now, revised, JSON.stringify({ ...reading.evidence, input_version: reading.inputVersion ?? null }), prev.open_alert_id);
    }
    put('abnormal', prev.since, reading.value, 'ok', prev.open_alert_id);
    return 'updated';
  }
  if (prev?.state !== 'normal' || !rule.enabled) { put('abnormal', now, reading.value, 'ok', null); return 'none'; } // no observed normal before → no transition
  // normal → abnormal. Within the cooldown after the previous episode recovered, reopen that alert instead of creating a new one.
  const recent = db.prepare('SELECT id FROM alerts WHERE rule_id = ? AND target_id = ? AND recovered_at IS NOT NULL AND recovered_at >= ? ORDER BY opened_at DESC LIMIT 1')
    .get(ruleId, targetId, new Date(Date.parse(now) - rule.cooldown_min * 60_000).toISOString()) as Row | undefined;
  if (recent) {
    db.prepare('UPDATE alerts SET recovered_at = NULL, last_seen_at = ?, occurrences = occurrences + 1, value = ?, acked_at = NULL WHERE id = ?').run(now, reading.value, recent.id);
    put('abnormal', now, reading.value, 'ok', recent.id);
    return 'reopened';
  }
  const id = `al_${Date.parse(now).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`INSERT INTO alerts (id, rule_id, target_kind, target_id, target_label, episode_key, title, detail, severity, value, threshold, unit, opened_at, last_seen_at, evidence, definition_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, ruleId, targetKind, targetId, reading.label, `${ruleId}:${targetId}:${now}`, ruleDef(ruleId)!.title, reading.detail, reading.severity, reading.value,
    rule.threshold, rule.unit, now, now, JSON.stringify({ ...reading.evidence, input_version: reading.inputVersion ?? null }), ALERT_DEFINITION_VERSION);
  put('abnormal', now, reading.value, 'ok', id);
  return 'opened';
}

// ── event rules: new rows only, grouped per cooldown window ──
function applyEvent(ruleId: string, targetKind: string, targetId: string, label: string, value: number, detail: string, evidence: Record<string, unknown>, firstSeenMs: number): boolean {
  const rule = ruleOf(ruleId);
  const bucket = Math.floor(firstSeenMs / (rule.cooldown_min * 60_000));
  const now = new Date().toISOString();
  const key = `${ruleId}:${targetId}:${bucket}`;
  const existing = db.prepare('SELECT id, value FROM alerts WHERE episode_key = ?').get(key) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE alerts SET occurrences = occurrences + 1, last_seen_at = ?, value = MAX(value, ?), detail = ? WHERE id = ?').run(now, value, detail, existing.id);
    return false;
  }
  const id = `al_${firstSeenMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`INSERT INTO alerts (id, rule_id, target_kind, target_id, target_label, episode_key, title, detail, severity, value, threshold, unit, opened_at, last_seen_at, recovered_at, evidence, definition_version)
    VALUES (?,?,?,?,?,?,?,?,'info',?,?,?,?,?,?,?,?)`).run(id, ruleId, targetKind, targetId, label, key, ruleDef(ruleId)!.title, detail, value, rule.threshold, rule.unit, now, now, now, JSON.stringify(evidence), ALERT_DEFINITION_VERSION);
  return true;
}

const fmtUsd = (v: number) => `${Math.round(v).toLocaleString('en-US')} USDC`;
const FRESH_S = 2 * 3600; // an event older than this when first collected is history, not news

export function evaluateAlerts(opts: { seed: boolean; now?: number }): { opened: number; recovered: number; skipped_reason: string | null } {
  if (opts.seed) return { opened: 0, recovered: 0, skipped_reason: 'seed mode: alerts are never evaluated on an offline snapshot' };
  const nowMs = opts.now ?? Date.now(), now = new Date(nowMs).toISOString();
  let opened = 0, recovered = 0;
  const count = (r: string) => { if (r === 'opened' || r === 'reopened') opened++; if (r === 'recovered') recovered++; };
  const markets = db.prepare('SELECT condition_id, question, venue FROM markets WHERE is_open = 1').all() as Row[];
  const enabled = new Set(rules().filter((r) => r.enabled).map((r) => r.id));

  if (enabled.has('hourly_move_p95') || enabled.has('change_24h')) {
    const mult = ruleOf('hourly_move_p95').threshold, pp = ruleOf('change_24h').threshold;
    for (const m of markets) {
      const res = marketIndicators(m.condition_id, ['change_24h', 'hourly_movement'], { asOf: Math.floor(nowMs / 1000) });
      if (!res) continue;
      const [c24, mv] = res.indicators;
      if (enabled.has('hourly_move_p95')) {
        const x = (mv.extra ?? {}) as { current?: { abs_pp: number; t: number } | null; baseline?: { p95_pp: number; median_pp: number; n: number } | null; caution?: string | null };
        count(applyLevel('hourly_move_p95', 'market', m.condition_id, mv.status !== 'ok' || !x.current || !x.baseline || x.baseline.p95_pp <= 0
          ? { status: 'unknown', reason: `${mv.status}: ${mv.reason ?? 'no baseline'}` }
          : { status: 'ok', abnormal: x.current.abs_pp > mult * x.baseline.p95_pp, value: x.current.abs_pp / x.baseline.p95_pp, label: m.question, severity: 'notice', inputVersion: mv.input_version,
              detail: `Completed-hour move of ${x.current.abs_pp.toFixed(1)} pp vs this contract's P95 of ${x.baseline.p95_pp.toFixed(1)} pp (median ${x.baseline.median_pp.toFixed(1)}, n=${x.baseline.n}).${x.caution ? ` Caution: ${x.caution}.` : ''} Unusual for this contract; not a cause.`,
              evidence: { hour_t: x.current.t, ...x.baseline } }, now));
      }
      if (enabled.has('change_24h')) {
        const v = c24.latest?.value ?? null, ex = (c24.extra ?? {}) as { reference?: { at: string } | null; latest?: { at: string } | null };
        count(applyLevel('change_24h', 'market', m.condition_id, c24.status !== 'ok' || v === null
          ? { status: 'unknown', reason: `${c24.status}: ${c24.reason ?? ''}` }
          : { status: 'ok', abnormal: Math.abs(v) >= pp, value: v, label: m.question, severity: Math.abs(v) >= 2 * pp ? 'warning' : 'notice', inputVersion: c24.input_version,
              detail: `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pp between ${ex.reference?.at ?? '?'} and ${ex.latest?.at ?? '?'} (completed-hour samples of the provider history).`,
              evidence: { reference: ex.reference, latest: ex.latest } }, now));
      }
    }
  }

  if (enabled.has('source_failed')) {
    for (const s of sourceHealth(nowMs)) {
      if (s.status === 'blocked' || s.status === 'never') continue;
      const bad = s.status === 'error' || (!!s.breaker_open_until && Date.parse(s.breaker_open_until) > nowMs);
      count(applyLevel('source_failed', 'source', s.source_id, { status: 'ok', abnormal: bad, value: s.consecutive_failures, label: s.name, severity: 'warning',
        detail: bad ? `Last attempt failed${s.breaker_open_until ? `; automatic retries paused until ${s.breaker_open_until}` : ''}: ${(s.error ?? '').slice(0, 160)}. Previously stored data stays on screen.` : 'recovered',
        evidence: { last_attempt_at: s.last_attempt_at, last_success_at: s.last_success_at } }, now));
    }
  }

  // Event rules read rows first collected since the last evaluation (cursor), so restarts never replay old rows.
  const cursorKey = (r: string) => `alert_cursor:${r}`;
  if (enabled.has('large_trade')) {
    const since = kvGet(cursorKey('large_trade')) ?? now;
    const thr = ruleOf('large_trade').threshold, iv = configOf('pm-trades')?.interval_min ?? 5;
    const rows = db.prepare(`SELECT t.*, m.question FROM pm_market_trades t LEFT JOIN markets m ON m.condition_id = t.condition_id
      WHERE t.first_seen_at > ? AND t.notional_usdc >= ? AND t.seen_via = 'poll' ORDER BY t.first_seen_at`).all(since, thr) as Row[];
    for (const r of rows) {
      const fs = Date.parse(r.first_seen_at);
      if (fs / 1000 - r.ts > FRESH_S || coverageOf(`trades:${r.condition_id}`, iv, nowMs).stale) continue;
      if (applyEvent('large_trade', 'market', r.condition_id, r.question ?? r.condition_id, r.notional_usdc,
        `${r.side} ${r.outcome}: ${r.size_shares.toLocaleString('en-US', { maximumFractionDigits: 0 })} shares at ${(r.price_usdc * 100).toFixed(1)}¢ = ${fmtUsd(r.notional_usdc)} by ${r.wallet.slice(0, 8)}… (largest in this window shown).`,
        { key: r.key, tx_hash: r.tx_hash, ts: r.ts }, fs)) opened++;
    }
    kvSet(cursorKey('large_trade'), rows.at(-1)?.first_seen_at ?? (kvGet(cursorKey('large_trade')) ?? now));
  }
  if (enabled.has('watched_wallet_trade')) {
    const since = kvGet(cursorKey('watched_wallet_trade')) ?? now;
    const thr = ruleOf('watched_wallet_trade').threshold, iv = configOf('pm-wallets')?.interval_min ?? 15;
    const rows = db.prepare(`SELECT a.* FROM pm_wallet_activity a JOIN pm_watch_wallets w ON w.wallet = a.wallet
      WHERE a.first_seen_at > ? AND a.type = 'TRADE' AND a.usdc_size >= ? AND a.seen_via = 'poll' ORDER BY a.first_seen_at`).all(since, thr) as Row[];
    for (const r of rows) {
      const fs = Date.parse(r.first_seen_at);
      if (fs / 1000 - r.ts > FRESH_S || coverageOf(`activity:${r.wallet}`, iv, nowMs).stale) continue;
      if (applyEvent('watched_wallet_trade', 'wallet', r.wallet, r.wallet, r.usdc_size, `${r.side} ${r.outcome ?? '?'} on "${r.title ?? r.condition_id}": ${fmtUsd(r.usdc_size)} (maker or taker fill).`, { key: r.key, tx_hash: r.tx_hash, ts: r.ts }, fs)) opened++;
    }
    kvSet(cursorKey('watched_wallet_trade'), rows.at(-1)?.first_seen_at ?? (kvGet(cursorKey('watched_wallet_trade')) ?? now));
  }
  if (opened || recovered) bump('alerts');
  return { opened, recovered, skipped_reason: null };
}

const toItem = (r: Row): AlertItem => ({
  id: r.id, rule_id: r.rule_id, target_kind: r.target_kind, target_id: r.target_id, target_label: r.target_label, title: r.title, detail: r.detail, severity: r.severity,
  value: r.value, threshold: r.threshold, unit: r.unit, opened_at: r.opened_at, last_seen_at: r.last_seen_at, occurrences: r.occurrences, recovered_at: r.recovered_at,
  acked_at: r.acked_at, revised: !!r.revised, evidence: (() => { try { return JSON.parse(r.evidence); } catch { return {}; } })(), definition_version: r.definition_version,
});

export function alertsResponse(seed: boolean): AlertsResponse {
  const items = (db.prepare('SELECT * FROM alerts ORDER BY opened_at DESC LIMIT 200').all() as Row[]).map(toItem);
  return {
    seed_mode: seed, enabled: !seed, rules: rules(), items, unacked: items.filter((a) => !a.acked_at).length, definition_version: ALERT_DEFINITION_VERSION,
    notes: seed ? ['Seed mode: alerts are never evaluated on an offline snapshot.'] : ['In-app only; nothing is sent anywhere. A level alert opens on a normal → abnormal change and re-arms after a normal reading; stale, gap and warming-up inputs never open one.'],
  };
}

export function registerAlertRoutes(app: Express, opts: { seed: boolean }) {
  app.get('/api/alerts', (_req, res) => res.json(alertsResponse(opts.seed)));
  app.put('/api/alerts/:id/ack', (req, res) => {
    const n = Number(db.prepare('UPDATE alerts SET acked_at = ? WHERE id = ? AND acked_at IS NULL').run(new Date().toISOString(), req.params.id).changes);
    if (!n && !db.prepare('SELECT 1 FROM alerts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'unknown alert' });
    bump('alerts'); res.json(alertsResponse(opts.seed));
  });
  app.post('/api/alerts/ack-all', (_req, res) => { db.prepare('UPDATE alerts SET acked_at = ? WHERE acked_at IS NULL').run(new Date().toISOString()); bump('alerts'); res.json(alertsResponse(opts.seed)); });
  app.put('/api/alerts/rules/:id', (req, res) => {
    if (opts.seed) return res.status(409).json({ error: 'seed mode: alert rules are read-only' });
    const r = setRule(req.params.id, req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(alertsResponse(opts.seed));
  });
  app.post('/api/alerts/evaluate', (_req, res) => {
    const r = evaluateAlerts({ seed: opts.seed });
    res.status(opts.seed ? 409 : 200).json({ ...r, ...alertsResponse(opts.seed) });
  });
}
