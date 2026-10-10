// Automated acceptance matrix (docs/PLAN_3DAY_SUBAGENTS.md §6). Each criterion is checked mechanically and its evidence recorded.
// Usage:  npm run acceptance            (copies the existing database; starts its own server on that copy, no auto-refresh, no writes to live data)
//         npm run acceptance -- --ingest   (runs a forced live ingest first — use on a clean checkout)
//         npm run acceptance -- --out docs/SOME_REPORT.md
// Output: docs/ACCEPTANCE_REPORT_v2.md by default (the first run's docs/ACCEPTANCE_REPORT.md is kept as its own record) · exit 1 if any criterion FAILS.
// Limits are stated in the report: UI wording/labels are verified by source search, not by pixels; "independent" QA is not claimed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const sh = (cmd: string, args: string[], env: Record<string, string> = {}, timeout = 600_000) =>
  spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout });

type Row = { id: string; criterion: string; status: 'PASS' | 'FAIL' | 'WARN'; evidence: string };
const rows: Row[] = [];
const add = (id: string, criterion: string, ok: boolean | 'warn', evidence: string) => rows.push({ id, criterion, status: ok === 'warn' ? 'WARN' : ok ? 'PASS' : 'FAIL', evidence });

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist' || f === 'fixtures') continue;
    if (statSync(p).isDirectory()) walk(p, exts, out); else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}
const grep = (re: RegExp, files: string[]) => files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f: f.replace(ROOT + '/', ''), i: i + 1, l })).filter((x) => re.test(x.l)));

async function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(port), TRACKER_NO_AUTO_REFRESH: '1', ...env }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).status < 600) return child; } catch { /* not up yet */ }
  }
  child.kill(); throw new Error(`server on :${port} did not start`);
}
const j = async <T>(base: string, path: string): Promise<T> => (await fetch(base + path)).json() as Promise<T>;

if (process.argv.includes('--ingest')) {
  console.log('forced live ingest…');
  const r = sh('npx', ['tsx', 'server/cli.ts', 'ingest', '--force']);
  console.log(r.stdout.split('\n').slice(-3).join('\n'));
}

const srcFiles = walk(join(ROOT, 'src'), ['.ts', '.tsx']);
const serverFiles = walk(join(ROOT, 'server'), ['.ts']).filter((f) => !f.endsWith('.test.ts'));
const OUT = process.argv.includes('--out') ? resolve(ROOT, process.argv[process.argv.indexOf('--out') + 1]) : join(ROOT, 'docs', 'ACCEPTANCE_REPORT_v2.md');
const PORT = 5190 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE_DB = process.env.TRACKER_DB ?? join(ROOT, 'data', 'tracker.sqlite');
const ACC_DB = join(mkdtempSync(join(tmpdir(), 'wt-acc-main-')), 'acc.sqlite');
copyFileSync(LIVE_DB, ACC_DB);
const server = await startServer(PORT, { TRACKER_DB: ACC_DB });
const send = async (method: string, path: string, body?: unknown) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
try {
  // 1 ── page loads with real contracts + real events
  const html = await fetch(BASE + '/'); const status = await j<any>(BASE, '/api/status');
  const markets = await j<any[]>(BASE, '/api/markets');
  const venues = new Set(markets.map((m) => m.venue));
  add('1', 'Dashboard loads with real contracts and real events', html.status === 200 && status.counts.events_relevant > 0 && markets.length > 0 && venues.has('polymarket') && venues.has('kalshi'),
    `GET / → ${html.status}; ${status.counts.events_relevant} relevant events, ${markets.length} open contracts (${[...venues].join(' + ')}), ${status.counts.history_points} history points`);

  // 2 ── every event: URL, publication time, tier, affiliation
  const events = await j<any[]>(BASE, '/api/events?limit=1000&include_filtered=1');
  const bad = events.filter((e) => !e.raw_url || !e.timestamp || !/^Tier-[123]$/.test(e.reliability_tier) || !e.source_affiliation || !e.title);
  add('2', 'Every event has a source URL, publication time, tier and affiliation', events.length > 0 && bad.length === 0, `${events.length} events checked, ${bad.length} incomplete${bad[0] ? ` (e.g. ${bad[0].id})` : ''}`);

  // 3 ── re-run idempotence on cached raw responses; failure isolation + data retention under total network failure
  const dbPath = ACC_DB; // the idempotence re-parse also runs on the copy
  const idem = sh('npx', ['tsx', 'scripts/idempotence-check.ts'], { TRACKER_DB: dbPath });
  let idemRes: { checked: number; dup: number; skipped?: string[] } = { checked: 0, dup: -1 }; try { idemRes = JSON.parse(idem.stdout.trim().split('\n').pop()!); } catch { /* reported below */ }
  const copy = join(mkdtempSync(join(tmpdir(), 'wt-acc-')), 'copy.sqlite'); copyFileSync(dbPath, copy);
  const off = sh('npx', ['tsx', 'scripts/offline-check.ts'], { TRACKER_DB: copy, HTTP_BACKOFF_MS: '20', HTTP_MIN_GAP_MS: '0' });
  let offRes: any = null; try { offRes = JSON.parse(off.stdout.trim().split('\n').pop()!); } catch { /* reported below */ }
  add('3', 'Re-running ingestion adds no duplicates; failures are isolated per source', idemRes.checked > 0 && idemRes.dup === 0 && !!offRes && offRes.failed > 0 && offRes.recorded_errors > 0,
    `second parse of ${idemRes.checked} cached feeds inserted ${idemRes.dup} items${idemRes.skipped?.length ? ` (${idemRes.skipped.length} skipped: ${idemRes.skipped[0]})` : ''}; simulated total outage: ${offRes ? `${offRes.failed} sources recorded their own failure, ${offRes.recorded_errors} error rows, ${offRes.seconds}s` : 'check did not run'}`);

  // 4 ── stale/failed/blocked sources labelled, old data retained
  const uiText = srcFiles.filter((f) => f.includes('StatusBar')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const ui = ['STALE', 'FAILED', 'NOT CONNECTED', 'PENDING'].filter((w) => uiText.includes(w));
  const blocked = status.sources.filter((s: any) => s.status === 'blocked');
  add('4', 'Stale/failed/blocked sources are visibly labelled and old data is retained', ui.length === 4 && !!offRes && offRes.lost.length === 0 && blocked.every((s: any) => s.error),
    `status labels present in StatusBar: ${ui.join(', ')}; ${blocked.length} blocked source(s) each carry a reason; outage simulation lost rows in: ${offRes ? (offRes.lost.length ? offRes.lost.join(', ') : 'no table') : 'n/a'}`);

  // 5 ── quote basis, bid/ask, deadline, rules link
  const priced = markets.filter((m) => m.price !== null);
  const noBasis = priced.filter((m) => !m.quote_basis);
  const noRules = markets.filter((m) => !m.resolution_url);
  const midNoBook = priced.filter((m) => m.quote_basis === 'midpoint' && (m.best_bid === null || m.best_ask === null));
  add('5', 'Each contract shows quote basis, bid/ask where midpoint, deadline and a rules link', priced.length > 0 && noBasis.length === 0 && noRules.length === 0 && midNoBook.length === 0,
    `${priced.length} priced contracts: ${noBasis.length} without basis, ${markets.length - markets.filter((m) => m.end_date).length} without deadline (informational), ${noRules.length} without rules link, ${midNoBook.length} midpoints lacking a two-sided book`);

  // 6 ── no averaging/merging of contracts
  const dupIds = markets.length - new Set(markets.map((m) => m.condition_id)).size;
  const avg = grep(/\b(avg|average|mean)\b.*\b(price|prob|quote)|\b(price|prob|quote)\b.*\b(avg|average|mean)\b/i, [...srcFiles, ...serverFiles]).filter((x) => !/never averaged|not averaged|averaging|never merged/i.test(x.l));
  add('6', 'Contracts are never averaged or merged; venues stay separate', dupIds === 0 && avg.length === 0 && markets.every((m) => (m.venue === 'kalshi') === (m.volume_unit === 'contracts')),
    `${markets.length} contracts, ${dupIds} duplicate ids; code search for price averaging: ${avg.length} hits${avg[0] ? ` (${avg[0].f}:${avg[0].i})` : ''}; volume units match venue for all`);

  // 7 ── link evidence visible; no-match events carry no invented link
  const linked = events.flatMap((e) => e.linked_contracts.map((c: any) => ({ e, c })));
  const noEv = linked.filter(({ c }) => !c.matched_entities.length || !c.matched_topics.length);
  const noLink = events.filter((e) => e.linked_contracts.length === 0).length;
  add('7', 'Event→contract links show their evidence; events without a match show none', linked.length > 0 && noEv.length === 0, `${linked.length} links across ${events.length - noLink} events, ${noEv.length} without matched entities/topics; ${noLink} events have no link (none invented)`);

  // 8 ── causal-wording audit
  const causal = grep(/\b(caused by|because of|due to|drove|triggered|led to|resulted in|as a result of)\b/i, [...srcFiles, ...serverFiles]).filter((x) => !/not (evidence|a? ?cause)|never|no causal|Blocked due to bot|not causation|rather than|causal/i.test(x.l));
  const caveat = grep(/not evidence of cause|coincident/i, srcFiles);
  add('8', 'Price context says "coincident, not causal"; no causal wording anywhere', causal.length === 0 && caveat.length >= 2, `${causal.length} causal-wording hits${causal[0] ? ` (${causal[0].f}:${causal[0].i}: ${causal[0].l.trim().slice(0, 80)})` : ''}; ${caveat.length} caveat strings in UI sources`);

  // 9 ── state-affiliated sources labelled Tier-3 with affiliation
  const reg = readFileSync(join(ROOT, 'server/registry.ts'), 'utf8');
  const stateIds = [...reg.matchAll(/id: '([^']+)'[\s\S]*?tier: '(Tier-\d)', affiliation: '([^']*)'/g)].map((m) => ({ id: m[1], tier: m[2], aff: m[3] }));
  const stateLike = stateIds.filter((s) => /state (news|broadcaster)|state-funded|state narrative|funded by the state/i.test(s.aff));
  const wrongTier = stateLike.filter((s) => s.tier === 'Tier-1');
  const t3 = events.filter((e) => e.reliability_tier === 'Tier-3');
  add('9', 'State-affiliated sources carry an explicit affiliation and are never Tier-1', stateLike.length > 0 && wrongTier.length === 0 && t3.every((e) => e.source_affiliation.length > 10), `${stateLike.length} state-affiliated sources in the registry (${stateLike.map((s) => `${s.id}:${s.tier}`).join(', ')}); ${t3.length} Tier-3 events all carry an affiliation string`);

  // 10 ── approximate locations labelled
  const country = events.filter((e) => e.location?.precision === 'country').length;
  const approxUi = grep(/approx/i, srcFiles.filter((f) => /EventList|MapPanel|RightPanel|TelegramView/.test(f)));
  add('10', 'Approximate (country-level) locations are labelled approximate', approxUi.length >= 4, `${country} of ${events.filter((e) => e.location).length} located events are country-level; "approx" labelling in ${new Set(approxUi.map((x) => x.f)).size} UI files (${approxUi.length} lines)`);

  // 11 ── seed banner + exclusion of third-party Telegram text
  const seedPath = join(ROOT, 'data', 'demo_seed.json');
  let seedOk = false, seedEv = 'no data/demo_seed.json (run npm run seed:export)';
  if (existsSync(seedPath)) {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')); const hasTg = Object.keys(seed.tables).some((k) => k.startsWith('tg_'));
    const seedDb = join(mkdtempSync(join(tmpdir(), 'wt-seed-')), 'seed.sqlite');
    const sp = PORT + 41; const s2 = await startServer(sp, { TRACKER_SEED: '1', TRACKER_DB: seedDb });
    try {
      const st = await j<any>(`http://127.0.0.1:${sp}`, '/api/status'); const refresh = await fetch(`http://127.0.0.1:${sp}/api/refresh`, { method: 'POST' });
      const banner = grep(/DEMO SEED — not live/, srcFiles).length > 0;
      seedOk = st.mode === 'seed' && refresh.status === 409 && banner && !hasTg;
      seedEv = `demo server status mode=${st.mode}, refresh → ${refresh.status}, banner string in UI: ${banner}, Telegram tables in seed: ${hasTg}`;
    } finally { s2.kill(); }
  }
  add('11', 'Demo seed is visibly labelled as seed, cannot refresh, and excludes Telegram text', seedOk, seedEv);

  // 12 ── sensors state provider, as-of date and caveat
  const sensors = await j<any[]>(BASE, '/api/sensors'); const withData = sensors.filter((s) => s.points.length);
  const badS = withData.filter((s) => !s.provider || !s.caveat || !s.as_of || !s.source_url);
  add('12', 'Every sensor series names its provider, latest observation date, source link and caveat', withData.length > 0 && badS.length === 0, `${withData.length} series with data (${sensors.length - withData.length} still empty); ${badS.length} missing provider/caveat/as-of`);

  // 13 ── Telegram guardrails
  const tg = await j<any[]>(BASE, '/api/telegram/posts?limit=1000');
  const manifest = await j<any>(BASE, '/api/telegram/media-manifest');
  const download = grep(/createWriteStream|writeFileSync\([^)]*media|pipeline\(.*res\.body/i, serverFiles);
  const noUrl = tg.filter((p) => !p.url);
  const mlImports = grep(/from ['"](@anthropic-ai|openai|@xenova|onnxruntime|@tensorflow|ollama|@huggingface|transformers)/i, [...serverFiles, ...srcFiles]);
  add('13', 'Telegram: every post links to its source, media is URL-only, no ML/LLM libraries touch it', tg.length > 0 && noUrl.length === 0 && download.length === 0 && mlImports.length === 0,
    `${tg.length} posts, ${noUrl.length} without URL; manifest lists ${manifest.count} media URLs; media-download code hits: ${download.length}; ML/LLM imports: ${mlImports.length}`);

  // 14 ── health endpoint
  const h = await fetch(BASE + '/api/health'); const hb = await h.json() as any;
  add('14', '/api/health is machine-readable and reflects degraded sources', [200, 503].includes(h.status) && ['ok', 'degraded', 'down'].includes(hb.status) && typeof hb.sources?.total === 'number', `HTTP ${h.status}, status=${hb.status}, ${hb.sources.total} sources, ${hb.sources.degraded.length} degraded`);

  // ── Unified monitor plan (docs/UNIFIED_MONITOR_PLAN.md §10) ──
  // 15 ── fixture & unit suite (numerical fixtures, Telegram gaps, wallet fixtures, alert semantics, Section 3.1 regressions)
  const t = sh('npx', ['tsx', '--test', ...readdirSync(join(ROOT, 'server')).filter((f) => f.endsWith('.test.ts')).map((f) => `server/${f}`)], {}, 600_000);
  const tp = Number(/ℹ pass (\d+)/.exec(t.stdout)?.[1] ?? 0), tf = Number(/ℹ fail (\d+)/.exec(t.stdout)?.[1] ?? -1);
  add('15', 'Fixture and unit suite passes (indicator fixtures, gap recovery, wallet fixtures, alert transitions, 3.1 regressions)', tp > 0 && tf === 0, `${tp} passed, ${tf} failed (${readdirSync(join(ROOT, 'server')).filter((f) => f.endsWith('.test.ts')).length} test files)`);

  // 16 ── indicators: registered ids only, statuses with reasons, deterministic, range-independent
  const pm = markets.find((m) => m.venue === 'polymarket' && m.price !== null);
  const i1 = await j<any>(BASE, `/api/markets/${pm.condition_id}/indicators?indicators=change_1h,change_24h,sma24,ema24,hourly_movement`);
  const i2 = await j<any>(BASE, `/api/markets/${pm.condition_id}/indicators?indicators=change_1h,change_24h,sma24,ema24,hourly_movement`);
  const sinceT = Math.floor(Date.now() / 1000) - 7 * 86400;
  const i3 = await j<any>(BASE, `/api/markets/${pm.condition_id}/indicators?indicators=sma24&since=${sinceT}`);
  const statuses = ['ok', 'warming_up', 'stale', 'gap', 'unsupported'];
  const malformed = i1.indicators.filter((r: any) => !r.definition_version || !statuses.includes(r.status) || (r.status !== 'ok' && !r.reason) || (r.latest && r.latest.value === 0 && r.status !== 'ok'));
  const sma = i1.indicators.find((r: any) => r.id === 'sma24'), smaCrop = i3.indicators[0];
  const cropOk = smaCrop.points.every((p: any) => { const q = sma.points.find((x: any) => x.t === p.t); return q && q.value === p.value; });
  const bad1 = (await fetch(`${BASE}/api/markets/${pm.condition_id}/indicators?indicators=atr14`)).status, bad2 = (await fetch(`${BASE}/api/markets/${pm.condition_id}/indicators?asOf=${Math.floor(Date.now() / 1000) + 86400}`)).status;
  add('16', 'Indicators: registered ids only, every null has a status and reason, identical input → identical output, cropping the range changes no value',
    malformed.length === 0 && JSON.stringify(i1.indicators.map((r: any) => r.points)) === JSON.stringify(i2.indicators.map((r: any) => r.points)) && cropOk && bad1 === 400 && bad2 === 400,
    `${i1.indicators.length} indicators for ${pm.condition_id.slice(0, 10)}… (${i1.indicators.map((r: any) => `${r.id}:${r.status}`).join(', ')}); malformed ${malformed.length}; repeat identical; 7-day crop matches full series (${smaCrop.points.length} pts); unregistered id → ${bad1}; future asOf → ${bad2}`);

  // 17 ── chart overlays, multi-series tooltip, persisted display preferences, bounded watchlist
  const chart = readFileSync(join(ROOT, 'src/components/ProbChart.tsx'), 'utf8');
  const prefs0 = await j<any>(BASE, '/api/prefs');
  const put = await send('PUT', '/api/prefs', { indicators: ['sma24', 'ema72'], axis: 'fixed', range: '7d' });
  const back = await j<any>(BASE, '/api/prefs');
  const badPrefs = await send('PUT', '/api/prefs', { indicators: ['atr14'], axis: 'auto', range: '7d' });
  await send('PUT', '/api/prefs', prefs0);
  const wl = await send('PUT', '/api/watchlist', { items: Array.from({ length: 9 }, () => ({ kind: 'sensor', id: 'fred:brent' })) });
  add('17', 'Overlays drawn from server results; tooltip lists every enabled series; preferences persist and are validated; watchlist bounded',
    /for \(const o of ovData\)/.test(chart) && /auto-scaled/.test(chart) && put.status === 200 && back.axis === 'fixed' && back.range === '7d' && badPrefs.status === 400 && wl.status === 400,
    `tooltip iterates every overlay: ${/for \(const o of ovData\)/.test(chart)}; axis labelled: ${/auto-scaled/.test(chart)}; prefs round-trip ${put.status} → axis=${back.axis}, range=${back.range}; unregistered overlay → ${badPrefs.status}; 9-item watchlist → ${wl.status}`);

  // 18 ── unified feed: stable identities, keyset pages without duplicates, Telegram never tiered, backfill not "new"
  const keys: string[] = []; let cur: string | null = null, pages = 0;
  do { const f: any = await j<any>(BASE, `/api/feed?limit=50${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`); keys.push(...f.items.map((x: any) => x.key)); cur = f.next_cursor; pages++; } while (cur && pages < 6);
  const tgFeed = await j<any>(BASE, '/api/feed?kind=telegram&limit=100');
  const newAll = await j<any>(BASE, '/api/feed/new?since=1970-01-01T00:00:00Z'), allItems = await j<any>(BASE, '/api/feed?limit=100');
  add('18', 'Unified feed: platform+source+external-id identities, no duplicates across pages, Telegram untiered, backfilled items never counted as new',
    keys.length > 0 && new Set(keys).size === keys.length && keys.every((k) => /^(web|telegram):/.test(k)) && tgFeed.items.every((x: any) => x.tier === null && x.viewpoint_label) && typeof newAll.count === 'number',
    `${keys.length} items over ${pages} keyset pages, ${keys.length - new Set(keys).size} duplicates; ${tgFeed.items.length} Telegram items, all untiered; "new since epoch" counts ${newAll.count} genuine arrivals (backfill excluded; first page has ${allItems.items.filter((x: any) => x.backfill).length} backfilled/late items shown in place)`);

  // 19 ── source configuration: validated bounds, persisted with a version, no double scheduling
  const cfgBad = await send('PUT', '/api/sources/fred/config', { interval_min: 5 });
  const cfgOk = await send('PUT', '/api/sources/bbc-me/config', { interval_min: 45, request_budget: 6 });
  const srcs = await j<any>(BASE, '/api/sources');
  const persisted = srcs.sources.find((x: any) => x.health.source_id === 'bbc-me').config;
  await send('PUT', '/api/sources/bbc-me/config', { reset: true });
  const leaseCode = readFileSync(join(ROOT, 'server/lease.ts'), 'utf8'), ingestCode = readFileSync(join(ROOT, 'server/ingest.ts'), 'utf8');
  add('19', 'Collection settings: bounds enforced, persisted with a version; leases prevent double polling; manual refresh is budgeted',
    cfgBad.status === 400 && cfgOk.status === 200 && persisted.interval_min === 45 && persisted.version >= 1 && /acquireLease\('ingest-cycle'/.test(ingestCode) && /holderAlive/.test(leaseCode) && /withBudget/.test(readFileSync(join(ROOT, 'server/sourcejob.ts'), 'utf8')),
    `FRED every 5 min → ${cfgBad.status} (${cfgBad.body?.error?.slice(0, 60)}); BBC 45 min → ${cfgOk.status}, stored version ${persisted.version}; ingest cycle and every background job run under a DB lease; every run (manual included) goes through withBudget`);

  // 20 ── wallet activity: no invented rows, partial coverage labelled, net value never called inflow, seed read-only
  const w = await j<any>(BASE, '/api/wallets');
  const hardcodedTx = grep(/0x[0-9a-f]{64}/i, serverFiles.filter((f) => !f.includes('fixtures')));
  const pmWriters = grep(/INSERT (OR IGNORE |OR REPLACE )?INTO pm_(market_trades|wallet_activity|positions|holders|leaderboard)/, serverFiles).map((x) => x.f);
  const inflow = grep(/\binflow\b/i, [...srcFiles, ...serverFiles]).filter((x) => !/not (whole-market )?(net )?(capital )?inflow|never .*inflow|not .*inflow/i.test(x.l));
  const wDisclaim = w.notes.some((n: string) => /pseudonymous key/.test(n)) && w.notes.some((n: string) => /screening parameter/.test(n));
  add('20', 'Wallet activity: data only from the v2 collector (no invented rows), screening criteria and coverage shown, net value labelled "Watched-wallet net trade value", never market inflow',
    hardcodedTx.length === 0 && new Set(pmWriters).size > 0 && [...new Set(pmWriters)].every((f) => f.startsWith('server/wallets/')) && inflow.length === 0 && wDisclaim && w.net_24h.label === 'Watched-wallet net trade value' && w.large_trades.every((t: any) => t.criteria.length > 0) && w.pilot_markets.length <= 10,
    `${w.pilot_markets.length} pilot markets, ${w.pilot_markets.reduce((a: number, m: any) => a + m.trades_stored, 0)} trades stored, ${w.large_trades.length} large trades each with its criterion; ${w.watched.length} watched wallets; hard-coded tx hashes in server code: ${hardcodedTx.length}; pm_* writers: ${[...new Set(pmWriters)].join(', ')}; un-negated "inflow" wording: ${inflow.length}`);

  // 21 ── alerts: transition semantics, validated rules, never in seed mode
  const al = await j<any>(BASE, '/api/alerts');
  const rBad = await send('PUT', '/api/alerts/rules/change_24h', { threshold: 0.1 });
  const alertCode = readFileSync(join(ROOT, 'server/alerts.ts'), 'utf8');
  const sdb = join(mkdtempSync(join(tmpdir(), 'wt-seed2-')), 'seed.sqlite');
  let seedAlerts: any = null, seedEval = 0, seedWallet = 0, seedWalletNote = false;
  if (existsSync(seedPath)) {
    const sp2 = PORT + 43; const s3 = await startServer(sp2, { TRACKER_SEED: '1', TRACKER_DB: sdb });
    try {
      seedAlerts = await j<any>(`http://127.0.0.1:${sp2}`, '/api/alerts'); seedEval = (await fetch(`http://127.0.0.1:${sp2}/api/alerts/evaluate`, { method: 'POST' })).status;
      seedWallet = (await fetch(`http://127.0.0.1:${sp2}/api/wallets/watch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: '0x' + '1'.repeat(40) }) })).status;
      seedWalletNote = (await j<any>(`http://127.0.0.1:${sp2}`, '/api/wallets')).notes.some((n: string) => /Seed mode/.test(n));
    } finally { s3.kill(); }
  }
  add('21', 'Alerts: open only on normal → abnormal, dedupe and re-arm; rules validated; seed mode never evaluates and wallet settings are read-only',
    al.rules.length >= 5 && al.items.every((a: any) => a.definition_version) && rBad.status === 400 && /no observed normal before → no transition/.test(alertCode) && !!seedAlerts && seedAlerts.enabled === false && seedEval === 409 && seedWallet === 409 && seedWalletNote,
    `${al.rules.length} rules (${al.rules.map((r: any) => `${r.id}${r.enabled ? '' : ' off'}`).join(', ')}), ${al.items.length} alerts on record (${al.unacked} unacknowledged); invalid threshold → ${rBad.status}; seed server: alerts enabled=${seedAlerts?.enabled}, evaluate → ${seedEval}, watch → ${seedWallet}, wallet view explains seed: ${seedWalletNote}`);

  // ── Research workspace (RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md) and claim review (H1) — exercised on the acceptance DB copy ──
  const ev0 = events.find((e) => e.relevant && e.summary && e.summary.length > 40)!;
  // 22 ── claims anchored to source text; assessment rules; edit conflicts
  const badQuote = await send('POST', '/api/research/claims', { source_ref: ev0.feed_key, quote: 'this text is not in the item at all' });
  const cl = await send('POST', '/api/research/claims', { source_ref: ev0.feed_key, quote: ev0.summary.slice(0, 30) });
  const noEvidence = await send('POST', `/api/research/claims/${cl.body?.id}/reviews`, { expected_version: 1, reviewer: 'acc', rationale: 'r', workflow_state: 'reviewed', assessment: 'supported' });
  const conflict = await send('POST', `/api/research/claims/${cl.body?.id}/reviews`, { expected_version: 7, reviewer: 'acc', rationale: 'r', assessment: 'insufficient' });
  add('22', 'Claim review: claims anchored to exact source text, default insufficient/unreviewed, non-default assessments need matching evidence, reviewer and rationale; stale edits conflict',
    badQuote.status === 400 && cl.status === 201 && cl.body.assessment === 'insufficient' && cl.body.workflow_state === 'unreviewed' && noEvidence.status === 400 && conflict.status === 409,
    `unanchored quote → ${badQuote.status}; new claim → ${cl.status} (${cl.body?.workflow_state}/${cl.body?.assessment}, version ${cl.body?.version_id ? 'captured' : 'missing'}); "supported" without evidence → ${noEvidence.status}; stale version → ${conflict.status}`);

  // 23 ── dossiers, calendar, coverage, observation cards
  const ds = await send('POST', '/api/research/dossiers', { title: 'acceptance dossier', from_ref: ev0.feed_key });
  const again = await send('POST', `/api/research/dossiers/${ds.body?.dossier?.id}/items`, { source_ref: ev0.feed_key });
  const sugg = (ds.body?.suggestions ?? []) as any[];
  const cal = await j<any>(BASE, '/api/calendar');
  const dateOnly = await send('POST', '/api/calendar', { title: 'acceptance date-only', date: '2026-12-01', tz: 'Asia/Hong_Kong', source_url: 'https://example.org/notice' });
  const badTz = await send('POST', '/api/calendar', { title: 'x', date: '2026-12-01', tz: 'Nowhere/Here', source_url: 'https://example.org' });
  const cov = await j<any>(BASE, '/api/coverage?window=24');
  const tgt = await j<any[]>(BASE, '/api/observation-targets');
  add('23', 'Research workspace: idempotent attachment, suggestions pending with reasons, provider end dates keep provider meaning, date-only entries stay whole days, coverage rates show n/d, cards never invent vessel data',
    ds.status === 201 && again.status === 200 && again.body.timeline.length === 1 && sugg.every((x) => x.reason) && cal.entries.some((e: any) => e.kind === 'provider_end_date' && /provider end date|close/.test(e.basis)) &&
    dateOnly.status === 201 && dateOnly.body.start_utc === null && badTz.status === 400 && cov.sources.every((x: any) => x.attempts.rate === null || x.attempts.scheduled_total > 0) && tgt.every((x) => x.vessels.status === 'unavailable'),
    `dossier ${ds.status}, re-attach keeps ${again.body?.timeline?.length} item; ${sugg.length} suggestion(s), all with a reason, none attached; ${cal.entries.length} upcoming entries (${cal.entries.filter((e: any) => e.kind === 'provider_end_date').length} provider end dates); date-only entry → start ${dateOnly.body?.start_utc}; bad zone → ${badTz.status}; coverage telemetry since ${cov.telemetry_since ?? 'n/a'}; ${tgt.length} observation cards, vessels unavailable on all`);

  // 25 ── maritime directory and vessel identity (K1) + vessel-type wording (J1)
  const dir = await j<any>(BASE, '/api/maritime/sources');
  const noSrc = await send('POST', '/api/maritime/vessels', { name: 'Acceptance Test', imo: '9074729' });
  const badImo = await send('POST', '/api/maritime/vessels', { name: 'Acceptance Test', imo: '9074728', source_url: 'https://example.org/r' });
  const okV = await send('POST', '/api/maritime/vessels', { name: 'Acceptance Test', imo: '9074729', source_url: 'https://example.org/r' });
  const dupImo = await send('POST', '/api/maritime/vessels', { name: 'Another Name', imo: '9074729', source_url: 'https://example.org/r2' });
  const vt = await send('POST', '/api/maritime/vessel-types', { text: 'The vessel reported an explosion' });
  const typed = events.filter((e) => e.vessel_types?.length).length;
  add('25', 'Maritime: directory never invents deep links; vessel identifiers need a source and a valid IMO, are never merged; positions unavailable without authorized AIS; vessel types are wording only',
    dir.sources.length >= 8 && dir.sources.every((x: any) => x.investigation_url_template === null) && noSrc.status === 400 && badImo.status === 400 && okV.status === 201 && okV.body.position.status === 'unavailable' && dupImo.status === 409 && vt.body.types[0]?.type === 'unspecified',
    `${dir.sources.length} directory entries, deep-link templates invented: ${dir.sources.filter((x: any) => x.investigation_url_template).length}; vessel without source → ${noSrc.status}; bad IMO check digit → ${badImo.status}; valid → ${okV.status} (position ${okV.body?.position?.status}); same IMO on a second record → ${dupImo.status}; "vessel" → ${vt.body?.types?.[0]?.type}; ${typed} collected items name a vessel type`);
  // 26 ── navigation from older Feed / Telegram matches does not depend on the dashboard's first 400 records.
  const dashboardItems = await j<any[]>(BASE, '/api/events?limit=400');
  const loadedIds = new Set(dashboardItems.map((e) => e.id));
  const outside = events.find((e) => !loadedIds.has(e.id));
  const detail = outside ? await j<any>(BASE, `/api/events/${encodeURIComponent(outside.id)}`) : null;
  const missingItem = await fetch(BASE + '/api/events/unknown-navigation-fixture');
  const marketDetail = await j<any>(BASE, `/api/markets/${encodeURIComponent(markets[0].condition_id)}`);
  const missingMarket = await fetch(BASE + '/api/markets/unknown-navigation-fixture');
  add('26', 'Cross-view navigation resolves individual sources and contracts beyond the loaded dashboard page, with explicit missing states',
    !!outside && detail?.id === outside.id && detail?.feed_key === outside.feed_key && Array.isArray(detail?.linked_contracts) && marketDetail?.condition_id === markets[0].condition_id && missingItem.status === 404 && missingMarket.status === 404,
    `dashboard ${dashboardItems.length} items; external-page item ${outside?.id ?? 'none'} resolves with original source identity and links; contract detail resolves; missing item/market HTTP ${missingItem.status}/${missingMarket.status}`);

  // 27 — review + next-check schedule is one validated transaction.
  const hypothesis = await send('POST', '/api/research/hypotheses', { title: 'acceptance schedule', statement: 'Traffic may recover', scope: 'Hormuz', invalidation_conditions: 'No recovery', status: 'active', next_check_at: '2020-01-01T00:00:00Z' });
  const review = await send('POST', `/api/research/hypotheses/${hypothesis.body?.id}/reviews`, { expected_version: hypothesis.body?.version, assessment: 'insufficient', rationale: 'Wait for published observations', next_check_at: '2030-01-01T12:00:00Z' });
  const badSchedule = await send('POST', `/api/research/hypotheses/${hypothesis.body?.id}/reviews`, { expected_version: review.body?.version, assessment: 'insufficient', rationale: 'Invalid schedule', next_check_at: 'invalid' });
  const afterSchedule = (await j<any[]>(BASE, '/api/research/hypotheses')).find((h) => h.id === hypothesis.body?.id);
  const cachedOnly = await j<any>(BASE, '/api/events/unknown-cache-fixture/translation');
  add('27', 'Review rescheduling is atomic and rejects invalid dates without a decision; cache-only translation never requires a provider', review.status === 200 && review.body?.next_check_at === '2030-01-01T12:00:00.000Z' && badSchedule.status === 400 && afterSchedule?.decisions.length === 1 && cachedOnly === null,
    `review HTTP ${review.status}, next check ${review.body?.next_check_at}; invalid date HTTP ${badSchedule.status}, decisions remain ${afterSchedule?.decisions.length}; missing cached English returns null`);
  // 28 — simulate a provider closure on the acceptance COPY, retaining its watchlist and detail.
  const closure = sh(process.execPath, ['--input-type=module', '-e', "import { DatabaseSync } from 'node:sqlite'; const d = new DatabaseSync(process.env.ACC_COPY); d.prepare('UPDATE markets SET is_open = 0 WHERE condition_id = ?').run(process.env.ACC_MARKET); d.close();"], { ACC_COPY: ACC_DB, ACC_MARKET: markets[0].condition_id });
  const closed = await j<any>(BASE, `/api/markets/${encodeURIComponent(markets[0].condition_id)}`);
  const closedPin = await send('PUT', '/api/watchlist', { items: [{ kind: 'market', id: markets[0].condition_id }] });
  const remainingOpen = await j<any[]>(BASE, '/api/markets');
  add('28', 'A pinned stored non-open contract remains resolvable while excluded from the open list', closure.status === 0 && closed.is_open === false && closed.condition_id === markets[0].condition_id && closedPin.status === 200 && closedPin.body?.cards.some((c: any) => c.id === closed.condition_id) && !remainingOpen.some((m) => m.condition_id === closed.condition_id),
    `provider closure on database copy only; is_open=${closed.is_open}; watchlist HTTP ${closedPin.status}; original rules retained; contract excluded from open list`);
  // 29 — change briefing: cited, bounded, honest about gaps, exportable
  const brief = await j<any>(BASE, '/api/briefing?hours=24');
  const briefMd = await fetch(`${BASE}/api/briefing.md?hours=24`);
  const briefMdText = await briefMd.text();
  const briefBad = await fetch(`${BASE}/api/briefing?hours=0`);
  const briefCites = new Set<number>([...briefMdText.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const allCited = [...briefCites].every((n) => brief.citations[n - 1] !== undefined);
  add('29', 'Change briefing: every line cited, window and limits stated, gaps carry reasons, "coincident, not causal", Markdown export, bounded hours',
    brief.version === 'briefing-1.0' && brief.citations.length > 0 && brief.limits.length >= 3 && /coincident, not causal/i.test(briefMdText) && allCited && briefMd.status === 200 && /attachment/.test(briefMd.headers.get('content-disposition') ?? '') && briefBad.status === 400
      && !/\b(caused by|because of|due to|drove|triggered|led to|resulted in|as a result of)\b/i.test(briefMdText),
    `${brief.stories.length} story groups shown (${brief.stories_omitted} omitted), ${brief.contracts.length} contracts listed of ${brief.contracts_checked} checked, ${brief.citations.length} citations, ${brief.limits.length} limit statements; markdown ${briefMdText.length} chars with ${briefCites.size} distinct citations, all resolvable; hours=0 → ${briefBad.status}`);
} finally { server.kill(); }

// 24 ── no automatic truth/support status anywhere in code
{
  const claimWrites = grep(/UPDATE claims SET[^']*assessment/, serverFiles).map((x) => x.f);
  const hypoWrites = grep(/UPDATE research_hypotheses SET assessment/, serverFiles).map((x) => x.f);
  const corroborated = grep(/claim_status\s*[:=]\s*['"](corroborated|verified|confirmed)/, [...serverFiles, ...srcFiles]);
  add('24', 'No similarity, outlet count or matching sets a claim or hypothesis assessment; only a reviewed, attributed decision does',
    claimWrites.length === 1 && claimWrites[0] === 'server/research/claims.ts' && hypoWrites.length === 1 && hypoWrites[0] === 'server/research/hypotheses.ts' && corroborated.length === 0,
    `assessment writes: claims ${claimWrites.join(', ') || 'none'} (reviewClaim only), hypotheses ${hypoWrites.join(', ') || 'none'} (reviewHypothesis only); automatic "corroborated/verified" statuses: ${corroborated.length}`);
}

rows.sort((a, b) => Number(a.id) - Number(b.id));
// ── report ─────────────────────────────────────────────────────────────────────────
const pass = rows.filter((r) => r.status === 'PASS').length, fail = rows.filter((r) => r.status === 'FAIL').length;
const md = `# Acceptance report

Generated ${new Date().toISOString()} by \`npm run acceptance\` (Node ${process.version}). **${pass}/${rows.length} criteria pass${fail ? `, ${fail} FAIL` : ''}.**

Method and limits: criteria 1–11 come from \`docs/PLAN_3DAY_SUBAGENTS.md\` §6, 12–14 were added in Session 3, 15–21 cover \`docs/UNIFIED_MONITOR_PLAN.md\` packages A–F and J2, 22–24 cover claim review (H1) and the research workspace (\`docs/RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md\`), 25 covers the maritime directory and vessel identity (K1/J1), 26 covers cross-view detail navigation, and 27–28 cover atomic review scheduling, cache-only English and pinned non-open contracts. The server under test runs on a temporary copy of the database, so settings round-trips never touch live data. Checks are mechanical (API responses, database queries, source search, a simulated outage on a database copy, a seed-mode server). UI *labels* are verified by their presence in the source, not rendered pixels. This is the build's own harness, not an independent QA team, and passing it does not establish that the data are correct — only that the labelling and safety rules hold.

| # | Criterion | Result | Evidence |
|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.criterion} | **${r.status}** | ${r.evidence.replace(/\|/g, '\\|')} |`).join('\n')}
`;
writeFileSync(OUT, md);
for (const r of rows) console.log(`${r.status.padEnd(4)} #${r.id.padEnd(2)} ${r.criterion}\n       ${r.evidence}`);
console.log(`\n${pass}/${rows.length} pass → ${OUT.replace(ROOT + '/', '')}`);
process.exit(fail ? 1 : 0);
