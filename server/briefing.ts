// Daily change briefing: "what changed since yesterday", every line cited. Built only from stored data by fixed rules (no model, no score).
// Wording rule (see docs/UNIFIED_MONITOR_PLAN.md): items and price moves are listed together because they overlap in time or share entities —
// coincident, not causal. A value that cannot be computed is reported with its reason, never as 0.
import type { Express } from 'express';
import { db, kvGet, kvSet } from './db.ts';
import { registerJob } from './scheduler.ts';
import { SOURCE_META } from './registry.ts';
import { originGroupOf } from './story.ts';
import { marketIndicators, watchlistCards } from './indicators/service.ts';
import { sourceHealth } from './sourcehealth.ts';
import { largeTrades } from './wallets/analytics.ts';
import { listEntries } from './research/calendar.ts';
import { BRIEFING_VERSION, type Briefing, type BriefingContract, type BriefingItem, type BriefingStory, type Citation, type SavedBriefingRow } from '../shared/briefing.ts';

type Row = Record<string, any>;

db.exec(`
CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, window_from TEXT NOT NULL, window_to TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', body TEXT NOT NULL
);
`);

/** A contract is listed when its 24h change is at least this many percentage points, or its latest hourly move exceeds its own P95. */
export const MOVE_PP = 5;
const MAX_ITEMS_PER_STORY = 6, MAX_STORIES = 12, MAX_CONTRACTS_CHECKED = 60, MAX_CONTRACTS_LISTED = 12;
const meta = SOURCE_META;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const iso = (ms: number) => new Date(ms).toISOString();
const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

class Cites {
  private list: Citation[] = [];
  private byKey = new Map<string, number>();
  add(key: string, c: Omit<Citation, 'n'>): number {
    const have = this.byKey.get(key);
    if (have) return have;
    const n = this.list.length + 1;
    this.list.push({ n, ...c });
    this.byKey.set(key, n);
    return n;
  }
  all(): Citation[] { return this.list; }
}

export interface BuildOpts { now?: number; hours?: number; fromIso?: string; seed?: boolean }

export function buildBriefing(opts: BuildOpts = {}): Briefing {
  const nowMs = opts.now ?? Date.now();
  const fromMs = opts.fromIso ? Date.parse(opts.fromIso) : nowMs - (opts.hours ?? 24) * 3600e3;
  const from = iso(fromMs), to = iso(nowMs);
  const hours = Math.round(((nowMs - fromMs) / 3600e3) * 10) / 10;
  const asOf = Math.floor(nowMs / 1000);
  const c = new Cites();
  const limits: string[] = [];

  // ── items and story groups ──
  const evs = db.prepare(`SELECT e.id, e.source_id, e.external_id, e.title, e.summary, e.raw_url, e.published_at, e.first_seen_at, e.language, e.tier, e.publisher, COALESCE(e.outlet, e.source_id) AS outlet, s.story_id
    FROM events e LEFT JOIN stories s ON s.event_id = e.id WHERE e.relevant = 1 AND e.published_at >= ? AND e.published_at <= ? ORDER BY e.published_at ASC`).all(from, to) as Row[];
  const late = (db.prepare('SELECT COUNT(*) n FROM events WHERE relevant = 1 AND first_seen_at >= ? AND first_seen_at <= ? AND published_at < ?').get(from, to, from) as Row).n as number;
  const links = new Map<string, { condition_id: string; question: string; venue: string; score: number }[]>();
  if (evs.length) {
    const ph = evs.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT l.event_id, l.condition_id, l.score, m.question, m.venue FROM event_market_links l JOIN markets m ON m.condition_id = l.condition_id AND m.is_open = 1 WHERE l.event_id IN (${ph}) ORDER BY l.score DESC`).all(...evs.map((e) => e.id)) as Row[]) {
      const a = links.get(r.event_id) ?? []; a.push({ condition_id: r.condition_id, question: r.question, venue: r.venue, score: r.score }); links.set(r.event_id, a);
    }
  }
  const itemOf = (e: Row): BriefingItem => {
    const m = meta.get(e.source_id);
    const outlet = e.publisher ?? m?.name.split(' — ')[0] ?? e.source_id;
    const tier = e.tier ?? m?.tier ?? 'unknown';
    const n = c.add(`item:${e.id}`, { kind: 'item', label: e.title, url: e.raw_url, ref: `web:${e.source_id}:${e.external_id}`, outlet, tier, published_at: e.published_at, collected_at: e.first_seen_at });
    return { n, event_id: e.id, title: e.title, outlet, tier, published_at: e.published_at, collected_at: e.first_seen_at, affiliation: m?.affiliation ?? '', language: e.language, untranslated: e.language !== 'en' };
  };
  const groups = new Map<string, Row[]>();
  for (const e of evs) { const k = e.story_id ?? `solo:${e.id}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  const tierRank = (e: Row) => { const t = String(e.tier ?? meta.get(e.source_id)?.tier ?? ''); return t === 'Tier-1' ? 1 : t === 'Tier-2' ? 2 : t === 'Tier-3' ? 3 : 4; };
  // First pass: cheap statistics for every group (no citations), so only the groups that are shown cite anything.
  const ranked = [...groups.values()].map((members) => {
    const origin = new Set(members.map((e) => originGroupOf(`${e.title}. ${e.summary}`, e.outlet, meta.get(e.source_id)?.name ?? '')));
    const seen = new Map<string, { condition_id: string; question: string; venue: string; score: number }>();
    for (const e of members) for (const l of links.get(e.id) ?? []) if (!seen.has(l.condition_id) || seen.get(l.condition_id)!.score < l.score) seen.set(l.condition_id, l);
    return { members, origin: origin.size, seen, first: members[0].published_at as string };
  }).sort((a, b) => b.origin - a.origin || b.seen.size - a.seen.size || b.members.length - a.members.length || b.first.localeCompare(a.first));
  const shown: BriefingStory[] = ranked.slice(0, MAX_STORIES).map(({ members, origin, seen, first }) => {
    const listed = [...members].sort((a, b) => tierRank(a) - tierRank(b) || a.published_at.localeCompare(b.published_at)).slice(0, MAX_ITEMS_PER_STORY);
    const items = listed.map(itemOf);
    const touches = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 3).map((l) => ({
      n: c.add(`contract:${l.condition_id}`, { kind: 'contract', label: l.question, url: null, ref: l.condition_id, outlet: null, tier: null, published_at: null, collected_at: null }), question: l.question, venue: l.venue, score: l.score,
    }));
    const outlets = new Set(members.map((e) => e.outlet));
    return {
      title: items[0].title, first_published_at: first, items, items_total: members.length, independence_groups: origin,
      state_only: members.every((e) => tierRank(e) === 3), single_outlet: outlets.size === 1, touches,
    };
  });
  const stories = ranked;

  // ── contracts touched by these items ──
  const cands = evs.length ? db.prepare(`SELECT l.condition_id, COUNT(*) n, MAX(l.score) sc FROM event_market_links l JOIN markets m ON m.condition_id = l.condition_id AND m.is_open = 1
    WHERE l.event_id IN (${evs.map(() => '?').join(',')}) GROUP BY l.condition_id ORDER BY n DESC, sc DESC LIMIT ?`).all(...evs.map((e) => e.id), MAX_CONTRACTS_CHECKED) as Row[] : [];
  const itemsByContract = new Map<string, Row[]>();
  for (const e of evs) for (const l of links.get(e.id) ?? []) (itemsByContract.get(l.condition_id) ?? itemsByContract.set(l.condition_id, []).get(l.condition_id)!).push(e);
  const contracts: BriefingContract[] = [];
  const notComputable = new Map<string, { count: number; example: string }>();
  for (const k of cands) {
    const res = marketIndicators(k.condition_id, ['change_24h', 'hourly_movement'], { asOf });
    const m = db.prepare('SELECT question, venue, price, quote_basis, one_day_change FROM markets WHERE condition_id = ?').get(k.condition_id) as Row | undefined;
    if (!res || !m) continue;
    const ch = res.indicators.find((i) => i.id === 'change_24h'), mv = res.indicators.find((i) => i.id === 'hourly_movement');
    if (!ch || ch.status !== 'ok') {
      // Stored history is fetched on demand, so many contracts have none. Fall back to the venue's own reported 24h change, labelled as such.
      const prov = m.one_day_change === null || m.one_day_change === undefined ? null : 100 * Number(m.one_day_change);
      if (prov !== null && Math.abs(prov) >= MOVE_PP) {
        contracts.push({
          n: c.add(`contract:${k.condition_id}`, { kind: 'contract', label: m.question, url: null, ref: k.condition_id, outlet: null, tier: null, published_at: null, collected_at: null }),
          condition_id: k.condition_id, venue: m.venue, question: m.question, price_pct: m.price === null ? null : 100 * m.price, quote_basis: m.quote_basis,
          change_24h_pp: prov, change_from_t: null, change_to_t: null, change_basis: 'provider_reported', hourly: null,
          reasons: [`24h change ${sgn(prov)} pp as reported by the venue (its window and reference point are not documented)`],
          items: (itemsByContract.get(k.condition_id) ?? []).slice(0, 5).map((e) => ({ n: itemOf(e).n, outlet: e.publisher ?? meta.get(e.source_id)?.name.split(' — ')[0] ?? e.source_id, published_at: e.published_at })),
        });
        continue;
      }
      const key = ch?.status ?? 'unsupported';
      const cur = notComputable.get(key) ?? { count: 0, example: ch?.reason ?? 'not computable' };
      cur.count++; notComputable.set(key, cur);
      continue;
    }
    const pp = ch.latest?.value ?? null;
    const exceeds = (mv?.extra as Row | undefined)?.exceeds_p95 === true;
    const big = pp !== null && Math.abs(pp) >= MOVE_PP;
    if (!big && !exceeds) continue;
    const ex = (ch.extra ?? {}) as Row;
    const reasons: string[] = [];
    if (big) reasons.push(`24h change ${sgn(pp as number)} pp`);
    if (exceeds) reasons.push('latest hourly move is larger than 95% of this contract\'s own prior hourly moves');
    const mvx = (mv?.extra ?? {}) as Row;
    contracts.push({
      n: c.add(`contract:${k.condition_id}`, { kind: 'contract', label: m.question, url: null, ref: k.condition_id, outlet: null, tier: null, published_at: null, collected_at: null }),
      condition_id: k.condition_id, venue: m.venue, question: m.question, price_pct: m.price === null ? null : 100 * m.price, quote_basis: m.quote_basis,
      change_24h_pp: pp, change_from_t: ex.reference?.t ?? null, change_to_t: ex.latest?.t ?? null, change_basis: 'history',
      hourly: mv && mv.status === 'ok' ? { label: String(mvx.label ?? ''), current_pp: mvx.current?.abs_pp ?? null, p95_pp: mvx.baseline?.p95_pp ?? null } : null,
      reasons, items: (itemsByContract.get(k.condition_id) ?? []).slice(0, 5).map((e) => ({ n: itemOf(e).n, outlet: e.publisher ?? meta.get(e.source_id)?.name.split(' — ')[0] ?? e.source_id, published_at: e.published_at })),
    });
  }
  contracts.sort((a, b) => Math.abs(b.change_24h_pp ?? 0) - Math.abs(a.change_24h_pp ?? 0));
  const listed = contracts.slice(0, MAX_CONTRACTS_LISTED);

  // ── pinned sensors ──
  const num = (x: number) => (Math.abs(x) >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(x * 100) / 100));
  const sensors = watchlistCards(asOf).cards.filter((k) => k.kind === 'sensor').map((k) => ({
    n: c.add(`sensor:${k.id}`, { kind: 'sensor', label: k.title, url: null, ref: `sensor:${k.id}`, outlet: k.subtitle, tier: null, published_at: k.latest.observed_at, collected_at: k.latest.fetched_at }),
    title: k.title, value: k.latest.value === null ? '—' : `${num(k.latest.value)} ${k.unit}`.trim(), observed_at: k.latest.observed_at,
    change: k.change && k.change.status === 'ok' && k.change.value !== null ? `${k.change.value >= 0 ? '+' : '−'}${num(Math.abs(k.change.value))}${k.change.unit === '%' ? '%' : ` ${k.change.unit}`} ${k.change.window}${k.change.detail ? ` (${k.change.detail})` : ''}` : null,
    status: k.status, reason: k.change && k.change.status !== 'ok' ? k.change.reason : k.latest.label,
  }));

  // ── alerts opened in the window ──
  const alerts = (db.prepare('SELECT * FROM alerts WHERE opened_at >= ? AND opened_at <= ? ORDER BY opened_at DESC LIMIT 20').all(from, to) as Row[]).map((a) => ({
    n: c.add(`alert:${a.id}`, { kind: 'alert', label: a.title, url: null, ref: `alert:${a.id}`, outlet: null, tier: null, published_at: a.opened_at, collected_at: null }),
    title: a.title, severity: a.severity, opened_at: a.opened_at, open: !a.recovered_at, rule_id: a.rule_id, definition_version: a.definition_version, detail: a.detail,
  }));

  // ── research changes ──
  const research: Briefing['research'] = [];
  const addR = (kind: string, text: string, at: string, cite: Omit<Citation, 'n'> | null, key = '') => research.push({ n: cite ? c.add(key, cite) : null, kind, text, at });
  for (const r of db.prepare('SELECT r.at, r.reviewer, r.new_state, r.new_assessment, c.quote, c.id, c.source_ref FROM claim_reviews r JOIN claims c ON c.id = r.claim_id WHERE r.at >= ? AND r.at <= ? ORDER BY r.at DESC LIMIT 20').all(from, to) as Row[])
    addR('claim review', `Claim review by ${r.reviewer}: ${r.new_state}, assessment “${r.new_assessment}” — “${clip(r.quote, 140)}”`, r.at, { kind: 'claim', label: clip(r.quote, 80), url: null, ref: `claim:${r.id}`, outlet: null, tier: null, published_at: null, collected_at: null }, `claim:${r.id}`);
  for (const r of db.prepare('SELECT id, quote, created_at FROM claims WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 20').all(from, to) as Row[])
    addR('new claim', `New claim recorded (unreviewed): “${clip(r.quote, 140)}”`, r.created_at, { kind: 'claim', label: clip(r.quote, 80), url: null, ref: `claim:${r.id}`, outlet: null, tier: null, published_at: null, collected_at: null }, `claim:${r.id}`);
  for (const r of db.prepare('SELECT d.at, d.author, d.prev_assessment, d.new_assessment, h.id, h.title FROM research_decisions d JOIN research_hypotheses h ON h.id = d.hypothesis_id WHERE d.at >= ? AND d.at <= ? ORDER BY d.at DESC LIMIT 20').all(from, to) as Row[])
    addR('hypothesis review', `Hypothesis “${r.title}”: assessment ${r.prev_assessment} → ${r.new_assessment} (${r.author})`, r.at, { kind: 'hypothesis', label: r.title, url: null, ref: `hypothesis:${r.id}`, outlet: null, tier: null, published_at: null, collected_at: null }, `hypothesis:${r.id}`);
  for (const r of db.prepare('SELECT id, title, updated_at FROM research_dossiers WHERE updated_at >= ? AND updated_at <= ? ORDER BY updated_at DESC LIMIT 20').all(from, to) as Row[])
    addR('dossier', `Dossier “${r.title}” was edited`, r.updated_at, { kind: 'dossier', label: r.title, url: null, ref: `dossier:${r.id}`, outlet: null, tier: null, published_at: null, collected_at: null }, `dossier:${r.id}`);
  const KIND: Record<string, string> = { publisher_revision: 'was revised by its publisher', content_changed: 'changed when re-read', unavailable: 'is no longer available', restored: 'is available again' };
  for (const r of db.prepare(`SELECT v.ref, v.kind, v.captured_at, v.title, v.url FROM source_item_versions v WHERE v.captured_at >= ? AND v.captured_at <= ? AND v.kind IN ('publisher_revision','content_changed','unavailable','restored')
    AND (v.ref IN (SELECT source_ref FROM dossier_items WHERE detached_at IS NULL) OR v.ref IN (SELECT source_ref FROM claims)) ORDER BY v.captured_at DESC LIMIT 20`).all(from, to) as Row[])
    addR('source revision', `A source you attached ${KIND[r.kind]}: “${clip(r.title ?? r.ref, 100)}”. Compare versions before reassessing; no assessment was changed.`, r.captured_at, { kind: 'item', label: r.title ?? r.ref, url: r.url, ref: r.ref, outlet: null, tier: null, published_at: null, collected_at: null }, `ref:${r.ref}`);
  const horizon = iso(nowMs + 7 * 86400e3);
  for (const r of db.prepare("SELECT id, question, due_at FROM research_tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT 10").all(horizon) as Row[])
    addR('check due', `Research check due ${r.due_at.slice(0, 10)}: ${r.question}`, r.due_at, null);
  for (const r of db.prepare("SELECT id, title, next_check_at FROM research_hypotheses WHERE next_check_at IS NOT NULL AND next_check_at <= ? AND status != 'closed' ORDER BY next_check_at LIMIT 10").all(horizon) as Row[])
    addR('check due', `Hypothesis “${r.title}” is due for its next check (${r.next_check_at.slice(0, 10)})`, r.next_check_at, { kind: 'hypothesis', label: r.title, url: null, ref: `hypothesis:${r.id}`, outlet: null, tier: null, published_at: null, collected_at: null }, `hypothesis:${r.id}`);

  // ── upcoming (next 7 days) ──
  const upcoming = listEntries(to, horizon).slice(0, 10).map((u) => ({
    n: c.add(`cal:${u.id}`, { kind: 'calendar', label: u.title, url: u.source_url, ref: u.condition_id ?? `calendar:${u.id}`, outlet: u.venue, tier: null, published_at: u.start_utc, collected_at: null }),
    title: u.title, when: u.start_utc ?? u.date_local ?? '', precision: u.time_precision, basis: u.basis,
  }));

  // ── large single trades (pilot markets only) ──
  const trades = largeTrades({ sinceTs: Math.floor(fromMs / 1000), limit: 50 }).filter((t) => t.ts * 1000 <= nowMs).sort((a, b) => b.notional_usdc - a.notional_usdc).slice(0, 5).map((t) => ({
    n: c.add(`trade:${t.key}`, { kind: 'wallet_trade', label: `${t.side} ${t.outcome}: ${t.question}`, url: null, ref: `trade:${t.key}`, outlet: 'Polymarket data API', tier: null, published_at: t.at, collected_at: t.first_seen_at }),
    question: t.question, side: t.side, outcome: t.outcome, notional_usdc: t.notional_usdc, at: t.at, wallet: t.wallet, criteria: t.criteria,
  }));

  // ── telegram volume (content is not summarised) ──
  let tg = 0;
  try { tg = (db.prepare('SELECT COUNT(*) n FROM tg_posts WHERE posted_at >= ? AND posted_at <= ?').get(from, to) as Row).n as number; } catch { tg = 0; }

  // ── what this briefing cannot tell you ──
  const health = sourceHealth(nowMs).filter((h) => h.status !== 'blocked');
  const stale = health.filter((h) => h.stale && h.status !== 'never'), failing = health.filter((h) => h.status === 'error'), never = health.filter((h) => h.status === 'never');
  if (stale.length) limits.push(`${stale.length} of ${health.length} sources are stale, so items from them may be missing: ${stale.slice(0, 8).map((h) => h.name).join(', ')}${stale.length > 8 ? ', …' : ''}.`);
  if (failing.length) limits.push(`${failing.length} source(s) failed their last attempt: ${failing.slice(0, 6).map((h) => h.name).join(', ')}.`);
  if (never.length) limits.push(`${never.length} source(s) have not been collected yet or are not connected.`);
  if (opts.seed) limits.push('DEMO SEED: this briefing is built from a saved sample, not from live collection.');
  limits.push('The window is by publication time. Items first collected inside the window but published earlier are counted separately and not listed.');
  limits.push('Story groups join items by headline and entity similarity. Several outlets repeating one report are not independent confirmation; “independence groups” is an estimate.');
  limits.push('Contract links are keyword and entity matches, not evidence of impact. Items and price moves are listed together because they overlap in time — coincident, not causal.');
  if (cands.length >= MAX_CONTRACTS_CHECKED) limits.push(`Only the ${MAX_CONTRACTS_CHECKED} contracts most often linked to these items were checked for price moves.`);
  if (tg) limits.push(`${tg} Telegram posts were collected in this window. Their text is not summarised here; open Feed to read them.`);
  const notC = [...notComputable.entries()].map(([k, v]) => ({ reason: `${k.replace('_', ' ')} (for example: ${v.example})`, count: v.count }));

  // ── summary sentences (fixed templates over counts) ──
  const outlets = new Set(evs.map((e) => String(e.outlet)));
  const multi = stories.filter((s) => s.origin >= 2).length;
  const summary: string[] = [];
  summary.push(evs.length ? `${evs.length} new item${evs.length === 1 ? '' : 's'} from ${outlets.size} outlet${outlets.size === 1 ? '' : 's'} in the last ${hours} h, in ${stories.length} story group${stories.length === 1 ? '' : 's'}; ${multi} reported by two or more independence groups.` : `No new relevant items were published in the last ${hours} h.`);
  if (cands.length) summary.push(`${contracts.length} of ${cands.length} contracts touched by these items moved at least ${MOVE_PP} pp over 24 h or had an unusually large hourly move${notC.length ? `; ${notC.reduce((s, x) => s + x.count, 0)} had no computable 24h change` : ''}.`);
  if (alerts.length) summary.push(`${alerts.length} alert${alerts.length === 1 ? '' : 's'} opened.`);
  if (research.length) summary.push(`${research.length} research change${research.length === 1 ? '' : 's'} or due check${research.length === 1 ? '' : 's'}.`);
  if (upcoming.length) summary.push(`${upcoming.length} contract date${upcoming.length === 1 ? '' : 's'} in the next 7 days.`);

  return {
    version: BRIEFING_VERSION, generated_at: iso(nowMs), window: { from, to, hours, basis: 'publication time' }, seed_mode: !!opts.seed, summary,
    stories: shown, stories_omitted: Math.max(0, ranked.length - shown.length), late_collected: late, telegram_posts: tg,
    contracts: listed, contracts_checked: cands.length, contracts_not_computable: notC, sensors, alerts, research, upcoming, large_trades: trades, limits, citations: c.all(),
  };
}

// ───────────────────────────── Markdown export ─────────────────────────────

const md = (s: string) => s.replace(/([\\`*_{}\[\]<>])/g, '\\$1').replace(/\s+/g, ' ');
const cite = (...n: (number | null)[]) => n.filter((x): x is number => x !== null).map((x) => `[${x}]`).join('');

export function toMarkdown(b: Briefing): string {
  const L: string[] = [];
  L.push(`# Change briefing — ${b.window.from.slice(0, 16).replace('T', ' ')} to ${b.window.to.slice(0, 16).replace('T', ' ')} UTC`, '');
  L.push(`Generated ${b.generated_at} · ${b.version} · window by ${b.window.basis} · every line below is produced by fixed rules from stored data and cites its sources.`);
  if (b.seed_mode) L.push('', '**DEMO SEED — not live data.**');
  L.push('', '## Summary', '', ...b.summary.map((s) => `- ${s}`));
  L.push('', '## What happened', '');
  if (!b.stories.length) L.push('No new relevant items in this window.');
  for (const s of b.stories) {
    const tag = s.single_outlet ? 'single outlet' : `${s.items_total} items · ${s.independence_groups} independence group${s.independence_groups === 1 ? '' : 's'}${s.state_only ? ' · state-affiliated outlets only' : ''}`;
    L.push(`### ${md(s.title)} ${cite(s.items[0].n)}`, '', `_${tag} · first published ${s.first_published_at.slice(0, 16).replace('T', ' ')} UTC_`, '');
    for (const i of s.items) L.push(`- ${md(i.outlet)} (${i.tier}${i.affiliation && !/^Headline discovery/.test(i.affiliation) ? `, ${md(i.affiliation)}` : ''}) ${i.published_at.slice(11, 16)} UTC${i.untranslated ? ` — original language: ${i.language}, not translated` : ''} ${cite(i.n)}`);
    if (s.items_total > s.items.length) L.push(`- …and ${s.items_total - s.items.length} more item(s) in this group, not listed.`);
    if (s.touches.length) L.push('', `Touches (keyword/entity match, not evidence of impact): ${s.touches.map((t) => `${md(t.question)} ${cite(t.n)}`).join('; ')}`);
    L.push('');
  }
  if (b.stories_omitted) L.push(`${b.stories_omitted} further story group(s) not shown.`, '');
  if (b.late_collected) L.push(`${b.late_collected} item(s) were first collected in this window but published earlier; they are not listed.`, '');
  L.push('## Contracts that moved (coincident, not causal)', '');
  if (!b.contracts.length) L.push(`None of the ${b.contracts_checked} checked contracts met the criteria.`);
  for (const k of b.contracts) {
    L.push(`- **${md(k.question)}** (${k.venue}) ${cite(k.n)} — ${k.reasons.join('; ')}${k.price_pct !== null ? `; price ${k.price_pct.toFixed(1)}%${k.quote_basis ? ` (${k.quote_basis})` : ''}` : ''}${k.change_from_t && k.change_to_t ? `; measured ${iso(k.change_from_t * 1000).slice(0, 16).replace('T', ' ')} → ${iso(k.change_to_t * 1000).slice(0, 16).replace('T', ' ')} UTC` : ''}`);
    if (k.items.length) L.push(`  - Items touching it in this window: ${k.items.map((i) => `${md(i.outlet)} ${i.published_at.slice(11, 16)} UTC ${cite(i.n)}`).join('; ')}`);
  }
  for (const n of b.contracts_not_computable) L.push(`- Not computable for ${n.count} contract(s): ${n.reason}.`);
  if (b.sensors.length) { L.push('', '## Pinned sensors', ''); for (const s of b.sensors) L.push(`- ${md(s.title)}: ${s.value}${s.observed_at ? ` (observed ${s.observed_at.slice(0, 16).replace('T', ' ')} UTC)` : ''}${s.change ? ` — ${md(s.change)}` : s.reason ? ` — ${md(s.reason)}` : ''} ${cite(s.n)}`); }
  if (b.alerts.length) { L.push('', '## Alerts opened', ''); for (const a of b.alerts) L.push(`- ${a.severity}: ${md(a.title)} — ${a.open ? 'still open' : 'recovered'} · rule ${a.rule_id} (${a.definition_version}) ${cite(a.n)}`); }
  if (b.large_trades.length) { L.push('', '## Large single trades (pilot markets; wallet addresses are not people)', ''); for (const t of b.large_trades) L.push(`- ${t.side} ${md(t.outcome)} ${Math.round(t.notional_usdc).toLocaleString('en-US')} USDC on ${md(t.question)} at ${t.at.slice(0, 16).replace('T', ' ')} UTC (${t.criteria.join('; ')}) ${cite(t.n)}`); }
  if (b.research.length) { L.push('', '## Research changes and checks', ''); for (const r of b.research) L.push(`- ${md(r.text)} ${cite(r.n)}`); }
  if (b.upcoming.length) { L.push('', '## Next 7 days', ''); for (const u of b.upcoming) L.push(`- ${md(u.title)} — ${u.when.slice(0, u.precision === 'date' ? 10 : 16).replace('T', ' ')}${u.precision === 'date' ? ' (date only)' : ' UTC'} · ${md(u.basis)} ${cite(u.n)}`); }
  L.push('', '## What this briefing cannot tell you', '', ...b.limits.map((x) => `- ${md(x)}`));
  L.push('', '## Sources', '');
  for (const x of b.citations) L.push(`${x.n}. ${md(x.label)}${x.outlet ? ` — ${md(x.outlet)}` : ''}${x.tier ? ` (${x.tier})` : ''}${x.published_at ? `, ${x.published_at.slice(0, 16).replace('T', ' ')}` : ''}${x.url ? ` — ${x.url}` : x.ref ? ` — in tracker: ${x.ref}` : ''}`);
  return `${L.join('\n')}\n`;
}

// ───────────────────────────── saved snapshots ─────────────────────────────

const newId = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function saveBriefing(b: Briefing, note = '', savedAt = new Date()): SavedBriefingRow {
  const row = { id: newId(), saved_at: savedAt.toISOString(), window_from: b.window.from, window_to: b.window.to, note: clip(note.trim(), 500) };
  db.prepare('INSERT INTO briefings (id, saved_at, window_from, window_to, note, body) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.saved_at, row.window_from, row.window_to, row.note, JSON.stringify(b));
  return row;
}
export const listSaved = (): SavedBriefingRow[] => db.prepare('SELECT id, saved_at, window_from, window_to, note FROM briefings ORDER BY saved_at DESC LIMIT 60').all() as unknown as SavedBriefingRow[];
export function getSaved(id: string): Briefing | null {
  const r = db.prepare('SELECT body FROM briefings WHERE id = ?').get(id) as Row | undefined;
  return r ? (JSON.parse(r.body) as Briefing) : null;
}
function lastSavedTo(): string | null {
  return ((db.prepare('SELECT window_to FROM briefings ORDER BY saved_at DESC LIMIT 1').get() as Row | undefined)?.window_to as string | undefined) ?? null;
}

// ───────────────────────────── automatic morning snapshot ─────────────────────────────

const AUTO_NOTE = 'Automatic morning snapshot';
/** Off unless the owner switches it on in the Briefing tab. */
export const autoEnabled = () => kvGet('briefing_auto') === '1';
export const setAutoEnabled = (on: boolean) => kvSet('briefing_auto', on ? '1' : '0');

/** Saves the last 24 h as a frozen briefing once per day, after 07:00 server-local time (or at the first tick after the server starts later).
 * Returns a log line when it saved, null otherwise. Needs no network. */
export function autoSnapshotIfDue(now = new Date(), seed = false): string | null {
  if (!autoEnabled() || now.getHours() < 7) return null;
  const last = db.prepare('SELECT saved_at FROM briefings WHERE note = ? ORDER BY saved_at DESC LIMIT 1').get(AUTO_NOTE) as Row | undefined;
  if (last && now.getTime() - Date.parse(last.saved_at) < 20 * 3600e3) return null;
  const b = buildBriefing({ now: now.getTime(), hours: 24, seed });
  const row = saveBriefing(b, AUTO_NOTE, now);
  return `saved ${row.id}: ${b.stories.length} story groups shown, ${b.contracts.length} contracts, ${b.citations.length} citations`;
}

export function registerBriefingJob(opts: { seed: boolean }): void {
  registerJob({ id: 'briefing-daily', maxRunMs: 120_000, run: async () => autoSnapshotIfDue(new Date(), opts.seed) });
}

// ───────────────────────────── routes ─────────────────────────────

export function registerBriefingRoutes(app: Express, opts: { seed: boolean }): void {
  const windowOf = (q: Record<string, unknown>): { ok: true; opts: BuildOpts } | { ok: false; error: string } => {
    if (q.since === 'last') {
      const last = lastSavedTo();
      const floor = Date.now() - 168 * 3600e3;
      return { ok: true, opts: last && Date.parse(last) > floor ? { fromIso: last, seed: opts.seed } : { hours: 24, seed: opts.seed } };
    }
    const h = q.hours === undefined ? 24 : Number(q.hours);
    if (!Number.isInteger(h) || h < 1 || h > 168) return { ok: false, error: 'hours must be a whole number from 1 to 168' };
    return { ok: true, opts: { hours: h, seed: opts.seed } };
  };
  app.get('/api/briefing', (req, res) => {
    const w = windowOf(req.query);
    if (!w.ok) return res.status(400).json({ error: w.error });
    res.json(buildBriefing(w.opts));
  });
  app.get('/api/briefing.md', (req, res) => {
    const w = windowOf(req.query);
    if (!w.ok) return res.status(400).json({ error: w.error });
    const b = buildBriefing(w.opts);
    res.type('text/markdown; charset=utf-8').set('Content-Disposition', `attachment; filename="briefing_${b.window.to.slice(0, 10)}.md"`).send(toMarkdown(b));
  });
  app.post('/api/briefings', (req, res) => {
    const w = windowOf(typeof req.body?.since === 'string' ? { since: req.body.since } : { hours: req.body?.hours });
    if (!w.ok) return res.status(400).json({ error: w.error });
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    res.status(201).json(saveBriefing(buildBriefing(w.opts), note));
  });
  app.get('/api/briefing/auto', (_req, res) => res.json({ enabled: autoEnabled(), note: AUTO_NOTE }));
  app.put('/api/briefing/auto', (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    setAutoEnabled(req.body.enabled);
    res.json({ enabled: autoEnabled(), note: AUTO_NOTE });
  });
  app.get('/api/briefings', (_req, res) => res.json(listSaved()));
  app.get('/api/briefings/:id.md', (req, res) => {
    const b = getSaved(req.params.id);
    if (!b) return res.status(404).json({ error: 'unknown briefing' });
    res.type('text/markdown; charset=utf-8').set('Content-Disposition', `attachment; filename="briefing_${b.window.to.slice(0, 10)}.md"`).send(toMarkdown(b));
  });
  app.get('/api/briefings/:id', (req, res) => { const b = getSaved(req.params.id); b ? res.json(b) : res.status(404).json({ error: 'unknown briefing' }); });
}
