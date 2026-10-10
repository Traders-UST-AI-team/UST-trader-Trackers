# War Tracker — 3-Day Execution Plan for Autonomous Sub-Agents

> 2026-10-09 新一轮实施入口：[UNIFIED_MONITOR_PLAN.md](UNIFIED_MONITOR_PLAN.md)。用户已要求 X 全部延期，新增 indicators、统一 Telegram 来源和资金观察。该新规划及其工具／数据研究为后续 agent 的当前任务；下文保留原三日计划及历史进度。

Written 2026-10-08/09 (HK). Supersedes the 7-day sequence in `docs/archive/WAR_TRACKER_DEMO_PLAN.md` *for scheduling only*; every evidence, labelling and honesty rule in that file and in `SOURCE_RESEARCH_MARITIME_ENERGY.md` still applies and is restated in §2.

**Status legend** used throughout: ✅ built and verified in this repo · 🟡 built, partially verified · ⬜ not started · ⛔ attempted and blocked (reason recorded).

---

## 1. Where we are (Day 1 shipped; parts of Days 2–3 also done — see §1b)

| Day-1 deliverable | State | Evidence |
|---|---|---|
| Polymarket client (Gamma discovery + CLOB history) | ✅ | 239 events / 200 open contracts per refresh; hourly history, ~20k points stored; `server/sources/polymarket.ts` |
| Local persistence | ✅ | SQLite (`node:sqlite`, `data/tracker.sqlite`); events, markets, per-refresh observations, history, links, source health |
| News/official ingestion, normalised | ✅ | 7 live feeds → universal event schema (`shared/types.ts → TrackerEvent`); idempotent (unit-tested) |
| Split page (feed left / ECharts right) | ✅ | `npm run dev` → http://localhost:5173 ; event click draws publication time on the contract curve and shows source text + link |
| Event → contract links (explicit rule) | ✅ | shared Middle-East entity + shared topic + contract existed at publication; evidence shown per link |
| Reliability/provenance labels | 🟡 | Publisher-level tier + affiliation on every card. **Claim-level verification does not exist yet** (all items are `reported`, single-source) |
| Source health, stale labels, manual + auto refresh | ✅ | status pills, 10-min server timer, stale-while-revalidate on page load |
| Failure behaviour | ✅ | Offline simulation: all sources error, **0 rows lost**, UI keeps data and marks sources FAILED/STALE; circuit breakers cap a total outage at ~26 s |
| Tests | ✅ | `npm test` — 9 passing (quote convention, parser, idempotence, location/relevance rules) |

### 1b. Progress beyond Day 1 (done by the lead agent in session 1; details and evidence in `docs/AGENT_LOG.md`)

| Plan item | State |
|---|---|
| Agent B — Kalshi connector | ✅ 148 open Middle-East contracts, candlestick history (midpoint of closing bid/ask, gaps not filled), venue badge, units, no merged chart. **Cross-venue counterpart finder** built: text-similar candidates (14 of 348 contracts have one) shown with rules excerpts and warnings, **all unverified**; `data/contract_equivalence.json` ships empty and a price difference is displayed only for pairs a named person has verified |
| Agent C — official/maritime | 🟡 UN Press ✅, Maersk ✅ (revisions), **EASA conflict-zone bulletins ✅**, FCDO ✅, OFAC/OFSI ✅. UKMTO/ACLED/GDELT/CENTCOM/NGA blocked or unreachable (§3). **`.eml` drop-folder adapter ✅** (generic parser, per-sender tier profiles, `docs/UKMTO_ACCESS.md`; its fixture is synthetic). ACLED adapter **not** built (no real response sample without a key) |
| Agent A — framework | ✅ typed adapter registry (`server/adapters.ts`, documented contract; a test fails if a registry entry names a missing adapter), shared `storeParsed()` with revisions, per-item publisher/tier, date-only precision |
| Agent D — multilingual | 🟡 hand-written Arabic/Persian alias dictionaries + Al Jazeera Arabic and IRNA Persian feeds enabled, untranslated and RTL-aware; **no native-reader evaluation yet**, no translation runtime |
| Agent E — correlation/credibility | 🟡 story clustering (outlet-aware) ✅, link rule v3 + labelled benchmark ✅, contract-specific "typical hourly move" ✅, Telegram↔news cross-check ✅, **reported event-time extraction (day precision, past cues only) with a shaded event-day band on the chart ✅**, **energy & shipping focus scope ✅**. Claim-level `claim_status` transitions and an independently-labelled set **not** done |
| Agent G — map | ✅ Leaflet + bundled basemap; 9 sourced assets / 5 relations; precision-styled event markers; **event ↔ asset linking** (explicitly named or same reported location only) with a table of documented company relationships and a Cytoscape event→asset→company graph |
| Agent H — resilience | ✅ throttle, backoff, per-source cadence guard, atomic per-source batches, **persisted circuit breaker** (opens at 3 failures, doubling cool-down to 6 h, survives restarts, manual refresh bypasses), **`/api/health`**, raw-response cache + `npm run replay`, error boundaries, **fault-injection tests against a real local server** (429→recover, 5xx, 403/404/406 never retried, timeout, truncated XML, HTML-instead-of-XML, undated items) |
| Agent I — demo fallback/runbook | ✅ `npm run seed:export`, `npm run demo`, `docs/DEMO_RUNBOOK.md` |
| Agent F/J — QA & acceptance matrix | ✅ **`npm run acceptance`** runs the §6 matrix (+3 later criteria) mechanically and writes `docs/ACCEPTANCE_REPORT.md`: **14/14 pass** in the main folder **and from a clean copy** (fresh `npm install`, cold live ingest). Not independent QA: it is the build's own harness, UI labels are checked by source search, and passing does not show the data are right |
| NEW — Sensors | ✅ PortWatch, FRED, OpenSky, IODA with a Sensors tab (small multiples, provider, as-of, caveat) |
| NEW — Telegram | ✅ collector, rule-based analysis, cross-check, Cytoscape network, places map, media manifest (see `docs/TELEGRAM.md`) |

Known Day-1 limits (do not paper over them in the demo):
- Locations are the *place named in the text* (gazetteer match), not a verified incident coordinate. Country centroids are labelled approximate.
- Event time is **publication time**. "Reported event time" is not extracted yet.
- Topics/entities are dictionary rules (English only). Arabic/Persian items would currently be dropped by the relevance filter — see Day 2 Agent D.
- A link between an event and a contract is a *relevance pointer*, never causal. Price context shown is coincident timing only.
- No claim extraction, no dedup across outlets (the same story from BBC and Guardian are two cards), no corroboration logic.

---

## 2. Non-negotiable rules (every sub-agent must follow)

1. **No fabricated data.** Unknown stays `null`/"unknown". No interpolated price history, no zero for a missing quote, no invented coordinates. If a source fails, say so.
2. **No evasion.** A 403/406/429/CAPTCHA/"bot activity" response is a *recorded result*, not an obstacle. Do not spoof browsers, rotate IPs, shell out to curl to dodge fingerprinting, or scrape pages whose terms forbid it. Record `blocked` + the contact/registration path and move on.
3. **Claims, not sources, carry confidence.** Tier is a publisher prior. An official statement proves *that the institution said it*. Reposts and translations are not independent confirmations. Never turn a model score into "probability the event is true".
4. **Distinguish times:** publication, reported event time, first observation (`first_seen_at`), last update.
5. **Prediction markets:** one contract = one venue-specific object. Never average or merge contracts. Quote convention is midpoint-only-when-both-sides-valid else *labelled* last trade. Kalshi and Polymarket stay separate unless rules are verified equivalent.
6. **Correlation ≠ causation.** UI wording stays "coincident timing". Never label a price move as caused by a headline.
7. **Rights.** RSS gives title + excerpt; we store those and link out. We do not scrape full article bodies. Telegram data must not be fed to AI processing (Telegram API terms §1.5). X needs paid API — out of scope.
8. **State the status ladder** for every source in `data/source_registry.json`: `candidate → page_verified → fetch_verified → parse_verified → operational | blocked`. Only an adapter that has run twice idempotently *and* survived a simulated failure may be marked `operational`.
9. **Every change ships with a test or a recorded manual check.** `npm test` and `npm run typecheck` must pass before an agent reports done.

---

## 3. Source architecture and validation ledger

Results of `npm run smoke:sources` (one polite GET per candidate, 2026-10-09; machine-readable in `data/source_registry.json`). **Re-run before trusting any row — availability changes.**

### 3.1 Taxonomy → what is actually available

| Category | Candidate | Role / value | Day-1/2 status | Notes and next action |
|---|---|---|---|---|
| Prediction markets | Polymarket Gamma + CLOB | Real-money probability curves | ✅ operational | Public, no key. `outcomePrices` can lag order book → we compute midpoint ourselves |
| | Kalshi public market-data API | Regulated-venue contracts; cross-venue divergence | ✅ operational | Docs say unauthenticated reads. Day 2 Agent B verifies endpoints + history granularity. Keep separate from Polymarket |
| Wire / editorial | BBC Middle East RSS | Broad validation layer | ✅ operational | Headline + 1-sentence excerpt only |
| | Guardian ME RSS | same | ✅ operational | |
| | Al Jazeera English RSS (global; we filter) | Regional perspective; **state-funded (Qatar)** | ✅ operational, Tier-2 | Only ~25 % of the global feed is Middle East |
| | Middle East Eye RSS | Regional editorial | ✅ operational, Tier-2 | Ownership/funding disputed → affiliation label says so |
| | Jerusalem Post RSS | Israeli press | ✅ operational, Tier-2 | Outlet name contains "Jerusalem" → stripped before geocoding (regression test exists) |
| | Reuters / AP RSS | Highest-credibility wire | ⛔ | Public RSS no longer offered by either; do not scrape. Options: licensed feed (user decision) or rely on BBC/Guardian |
| | Times of Israel, Arab News, State Dept feed | — | ⛔ blocked (403/Cloudflare challenge) | Recorded. Not bypassed |
| Official / state | UN News ME RSS | Official UN reporting | ✅ operational, Tier-1 | |
| | UN Press (meetings & statements) RSS | Official statements | ✅ operational (mostly non-ME items; filtered) | |
| | Anadolu (Turkish state agency) | State narrative | ✅ operational, **Tier-3** | Labelled as state narrative on every card |
| | Press TV (Iranian state broadcaster) | State narrative, Iran side | ⛔ disabled | Feed has **no timestamps**. Day 2: derive date-only from URL with explicit `time_precision: "date"` |
| | IRNA (Persian), Al Jazeera Arabic | Multilingual coverage | parse_verified | Need Arabic/Persian aliases or translation first (Agent D) |
| | US CENTCOM | Official military releases | ⛔ unreachable from this machine | Retry on a different network before giving up; no workaround |
| | IAEA feed | Nuclear official | fetch_verified, undated items | Needs bespoke parser or skip |
| | IMO Hormuz/Red Sea pages | Maritime official | ⛔ connect failure | Retry; PDFs need extraction |
| | EU EEAS press | Official | fetch ok but JS-rendered | Needs a headless browser → out of scope for 3 days |
| Maritime | **UKMTO** | The incident source for Hormuz/Red Sea | ⛔ **403** to scripted clients | Highest-value gap. Options (user decisions): ask UKMTO for permitted access / email-alert subscription parsed from an inbox; meanwhile use IMO/JMIC PDFs and carrier advisories |
| | Maersk News & Advisories | Carrier operational changes | ✅ operational (listing + article metadata; robots.txt allows `/news/articles/*`) | Single-carrier scope label shown. Site terms of use not read — confirm |
| | MARAD advisories | US maritime guidance | JS-rendered | Out of scope unless an API/feed is found |
| | MarineTraffic / AIS | Live telemetry | not attempted | Paid/licensed. Out of scope; do not infer positions |
| Structured conflict data | **ACLED** | Coordinates, incident types | ⛔ 403 without credentials | Requires registered account/API key → **user action**: register at acleddata.com, put key in `.env`. Adapter can be pre-built against the documented schema and tested with a fixture |
| | Liveuamap | OSINT map | fetch ok, JS app | Commercial; terms unverified → do not scrape |
| Event discovery | GDELT DOC 2.0 | Multilingual discovery | ⛔ 429 | Documented ≈1 req/5 s. Retry with spacing from a single sequential job; if still limited, drop |
| Humanitarian | ReliefWeb RSS | UN OCHA updates | ⛔ 406 "bot activity" | Request an approved `appname` for their API (hdx@un.org). Adapter exists in registry, disabled |
| Context | EIA Today in Energy RSS | Chokepoint/energy background | parse_verified | Reference context, not events. Candidate for the Day 3 asset panel |
| Company | Aramco/ADNOC/QatarEnergy | Static asset facts | manual | Curate by hand with page/date citation (Day 3 Agent F) |

### 3.2 Tiering policy (publisher prior, shown on every card)

- **Tier-1**: major editorial or official institutional reporting (BBC, Guardian, UN). Still *reported*, not *verified*.
- **Tier-2**: regional/specialist or funded-with-stance outlets (Al Jazeera, MEE, JPost); useful for perspective and speed.
- **Tier-3**: state-affiliated media (Anadolu, Press TV, IRNA). State claims need secondary corroboration; the card says so.
- Planned (Day 2 Agent E): add **`claim_status`** transitions `reported → corroborated` only when **≥2 independent-group** sources report the same claim (independence_group = originating wire/report; BBC quoting UKMTO and Guardian quoting UKMTO share a group).

---

### 3.3 Uncommon-but-reliable sources researched in session 2 (answering "think about sources that are not common but reliable")

Selection test: (1) official or sensor-based rather than commentary, (2) free without credentials, (3) ties to something we already track (a contract, an event type, a chokepoint). Probed 2026-10-09 with one polite GET each.

| Source | Why it is valuable | Verdict | Notes |
|---|---|---|---|
| **IMF PortWatch** (ArcGIS REST) | Daily vessel transit calls per chokepoint from satellite AIS — **the data family Kalshi's Hormuz contracts settle on** | ✅ integrated (sensor) | 4 chokepoints × total/tanker; latest observation lags ~5 days; AIS-based, revised, transits ≠ cargo volume |
| **UK FCDO travel advice** (gov.uk content API) | A government's own advice-level changes with minute timestamps (e.g. "advises against all but essential travel to …") — a leading, official, non-media signal | ✅ integrated (14 countries) | Reflects UK assessment, not ground truth; routine edits filtered |
| **US Treasury OFAC recent actions** | Official sanctions announcements; maps to Kalshi's "New Iran OFAC action by [date]" | ✅ integrated | Date-only; titles only; no legal-effect interpretation |
| **UK OFSI notices** (atom) | Second, independent government sanctions authority | ✅ integrated | Mostly generic licences; filtered |
| **FRED Brent/WTI spot** (EIA series) | Official daily price history with no key | ✅ integrated (sensor) | Delayed a few days; spot not futures |
| **IODA internet routing** (Georgia Tech) | Independent connectivity sensor per country — a physical-world signal of power/cable/shutdown disruption | ✅ integrated (sensor) | Hourly points over 7 days (aggregation done by the API, method not checked); says *that* connectivity dropped, not *why* |
| **OpenSky ADS-B** (anonymous) | Airspace-activity sensor (e.g. for "Saudi airspace closed") | ✅ integrated (sensor, 30-min cadence) | Receiver coverage varies; military flights mostly absent; our series starts when first polled; 30-min cadence chosen to stay under what I believe is a small daily anonymous quota (**not verified** against OpenSky's docs) |
| **Maritime trade press** (gCaptain, Splash247) and **OilPrice** | Sector-specific reporting on Hormuz/tankers that general news under-covers | ✅ integrated | Trade press republishes wires; OilPrice is commentary-heavy |
| **Google News headline discovery** | Brings Reuters/AP/AFP/Bloomberg/FT headlines (no free wire RSS exists) with the *publisher* setting the tier | ✅ integrated | Headline + redirect link only; headline ≠ verified claim |
| **Amwaj.media, France 24, NYT ME, Sky, IRNA EN, Press TV (date-only), Al Jazeera Arabic, IRNA Persian** | Regional and state perspectives, Arabic/Persian coverage | ✅ integrated | State outlets Tier-3; non-English untranslated |
| **Telegram public channel** | OSINT-style fast claims with video | ✅ integrated, viewpoint-labelled | See `docs/TELEGRAM.md` (terms constraints) |
| NGA MSI navigational warnings + **ASAM anti-shipping messages** | Closest free analogue to UKMTO: official warnings and incident records with coordinates | ⛔ unreachable from this machine (connection failure) | **Highest-value next step**: retry from another network; the endpoints are documented and keyless |
| **EASA conflict-zone bulletins (CZIB)** | Official aviation-risk assessments per airspace with issue/revision/valid-until dates; the current Saudi bulletin cites Houthi attacks on energy infrastructure | ✅ integrated (Middle-East bulletins, active or withdrawn ≤4 months; EASA's own description excerpted) | Day precision; EASA's assessment for EU operators, not flight-by-flight safety |
| IAEA news feed | Official nuclear updates | 🟡 feed parses but per-item dates are `yy-mm-dd hh:mm` with no timezone | Skipped rather than guess time zones |
| GDELT DOC API | Multilingual discovery | ⛔ intermittent (429 even at 7 s gaps; empty result on one query) | Not integrated; retry later with ≥6 s spacing |
| ISW / Critical Threats | Best-regarded Iran/axis daily analysis | ⛔ Cloudflare challenge | Not bypassed; ask for an official feed/key or read manually |
| Stooq | Brent CSV | ⛔ 403 | FRED used instead |
| UCDP GED, HDX HAPI | Structured conflict events (peer-reviewed / ACLED-derived) | ⛔ need a token / app identifier | **User action**: UCDP asks for an access token; HAPI needs a generated app identifier (it embeds an email address — I did not use yours) |
| Crisis Group RSS | Analysis | 🟡 parses but weekly digest only | Low value for an event feed |
| Israel Home Front Command (Oref) alerts | Real-time siren alerts | not attempted | Geo-restricted/undocumented; do not scrape |
| NASA FIRMS (thermal anomalies) | Satellite fire detections near energy facilities | not attempted | Needs a free MAP_KEY — good Day-2+ candidate |

## 4. Architecture as built (and the seams sub-agents extend)

```
server/
  db.ts                 SQLite schema (node:sqlite). Tables: events, markets, market_obs, price_history, history_meta,
                        event_market_links, source_health, kv
  http.ts               fetchText/fetchJson: per-host throttle, timeout, exp. backoff+jitter, Retry-After; no retry on 4xx blocks
  registry.ts           NEWS_SOURCES (id, url, tier, affiliation, language, interval, enabled/blockedReason)
  sources/polymarket.ts Gamma discovery by tag + entity filter; quote convention; CLOB history (fidelity fallback 60→360→1440)
  sources/rss.ts        parseFeed → storeFeed (idempotent) ; entity/topic/location extraction
  geo.ts                dictionaries: entities, gazetteer (≈60 places), topics ; relevance rule
  link.ts               event↔contract rule (shared ME entity + shared topic + contract started before publication)
  ingest.ts             orchestrator: sequential per source, per-source health, shared in-flight run
  index.ts              Express API + Vite middleware (dev) / dist (prod); stale-while-revalidate; 10-min timer
src/                    React + ECharts. App → StatusBar | EventList | RightPanel(ProbChart, detail, contracts)
shared/types.ts         API contract (TrackerEvent, Market, Status…)
scripts/smoke-sources.ts  writes data/source_registry.json
```

**Adapter contract (target for Day 2).** Every new source implements:

```ts
interface SourceAdapter {
  id: string; name: string; kind: 'news'|'official'|'maritime'|'conflict'|'market';
  tier: Tier; affiliation: string; language: string; intervalMin: number;
  fetch(): Promise<RawItem[]>;                // network only; throws on failure; never returns [] to mean "failed"
  normalise(raw: RawItem): NormalisedItem;     // pure; unit-tested with a saved fixture in server/fixtures/<id>.*
}
```
`ingest.ts` stores `NormalisedItem` through one shared `storeItems()` (extracted from `storeFeed`) so dedupe, entity/topic/location extraction, and health reporting are identical across sources. Fixtures are real captured responses (trimmed) checked into `server/fixtures/`.

**Schema additions planned** (migration-safe `ALTER TABLE ... ADD COLUMN`): `events.event_time` (nullable, reported occurrence), `events.time_precision` (`instant|date|unknown`), `events.independence_group`, `events.claim_status` (`reported|corroborated|disputed|corrected|withdrawn`), `events.revision_of`, `events.title_original`/`title_en` + `translation_method`.

---

## 5. Execution plan

Sub-agents are named by the work they own. **One writer per file set**; agents that only research run in parallel. Each agent's *Done* means: acceptance checks pass, `npm test` + `npm run typecheck` green, one paragraph in `docs/AGENT_LOG.md` stating what was verified and what was not.

### Day 1 — Ingestion engine & split view  ✅ complete (see §1)

Remaining Day-1 polish folded into Day 2 Agent A: README, demo seed, and the ReliefWeb/Press TV decisions.

### Day 2 — Source diversification, correlation quality, credibility

**Agent A — Adapter framework & hygiene** (writer: `server/ingest.ts`, `server/sources/*`, `server/registry.ts`)
- Extract `storeItems()`; define `SourceAdapter`; migrate the 7 RSS feeds to it with zero behaviour change (existing tests stay green; add fixture tests per feed).
- Add `time_precision`; implement Press TV date-from-URL as `date`-only (UI shows "date only", chart markers use 00:00 UTC with that caveat).
- Source health: record `http_status`, `items_new`, `newest_item_at` per run; mark a source *silent* (feed ok, no new items in N intervals) differently from *failed* — "no news ≠ fetch failure" (research file §3.4).
- *Acceptance:* two consecutive runs → 0 duplicates; simulated 500/timeout/HTML-instead-of-XML each produce a distinct, visible error; the other sources still update.

**Agent B — Kalshi connector** (writer: `server/sources/kalshi.ts`, `markets` table extension)
- Research first: unauthenticated read endpoints, series/event/market listing, tag/category for geopolitics, candlestick history and its minimum interval. Record in `docs/KALSHI_NOTES.md` with real sample responses.
- Normalise into the same `markets` shape with `venue` column (`polymarket|kalshi`); price from yes bid/ask midpoint under the same convention; history from candlesticks (close price, labelled).
- UI: venue badge on every contract; **no** merged chart. If an explicit-equivalence mapping is wanted later, it is a hand-curated table `contract_equivalence(poly_id, kalshi_ticker, verified_by, rules_diff_note)`.
- *Acceptance:* ≥5 relevant Kalshi contracts with history render beside Polymarket ones; a contract with no history shows "unavailable", not a flat line.

**Agent C — Official & maritime feeds** (writer: new adapters only)
- Add UN Security Council press RSS and Maersk advisories (HTML list parser from a saved fixture; scope label "single carrier"); re-test CENTCOM, IMO and GDELT once (spaced), record outcomes; ACLED adapter built against documented response schema with a fixture, disabled until a key exists.
- UKMTO: do **not** scrape. Write `docs/UKMTO_ACCESS.md` listing the permitted paths (contact UKMTO for data access; email-advisory subscription → `server/inbox/*.eml` drop-folder parser) and build the `.eml` parser + fixture so access can be switched on the moment the user obtains it.
- Add a `maritime` topic dictionary extension (vessel types, "UKMTO", "JMIC", incident verbs) and a `vessel_type` field when stated (container/tanker/LNG/bulk) — research file §4: vessel type changes meaning.
- *Acceptance:* ≥3 distinct source *roles* live (editorial, official, maritime/carrier); each shows tier + affiliation + scope label.

**Agent D — Multilingual relevance (rule-based first)** (writer: `server/geo.ts` aliases, new `server/lang.ts`)
- Add Arabic and Persian alias tables for the same entity/place dictionary (إيران/ایران, غزة/غزه, لبنان, اليمن/یمن, الحوثي, مضيق هرمز/تنگه هرمز …), RTL-safe rendering, `lang` detection by script.
- Enable Al Jazeera Arabic and IRNA (Tier-3) behind a flag; show original title + a *"translation: none"* marker. Machine translation is **not** introduced until a runtime is chosen (open decision §7).
- *Acceptance:* ≥20 hand-checked items per language with precision/recall of the relevance filter recorded in `docs/EVAL_RELEVANCE.md` (human spot-check by someone who reads the language, or flagged as unverified).

**Agent E — Correlation & credibility engine** (writer: `server/link.ts`, `server/corroborate.ts`, tests)
1. *Cross-outlet clustering:* group items about the same development (shared place + entity set + verb/topic, ≤48 h, TF-IDF cosine ≥ threshold; later bge-small). Cluster = "story"; list outlets with their `independence_group`. UI: one story card with "4 publishers / 1 known underlying report" (never "4 sources confirm").
2. *Claim status:* `corroborated` only with ≥2 distinct independence groups, ≥1 of Tier-1/2; state media alone stays `reported`; contradictory claims across groups → `disputed` with both visible.
3. *Link scoring v2:* replace the integer score with weighted evidence — entity specificity (Hormuz > Iran), topic overlap, temporal proximity to **contract-relevant price moves** (≥ k·σ step within ±2 h of publication, computed from stored history), and contract deadline distance. Persist the evidence JSON. Add a precision benchmark: hand-label 50 event→contract pairs, report precision@3 for v1 vs v2.
4. *Price-reaction annotation (descriptive only):* for each linked pair store `p(t−1h)`, `p(t+1h)`, `p(t+24h)`, whether data existed, and the contract's typical hourly |Δ| so the UI can say "within normal range" vs "unusual for this contract". No causal wording.
- *Acceptance:* benchmark file committed; v2 ≥ v1 precision@3 or the reason is documented; story cards render with correct independence counts on 10 hand-checked real clusters.

**Agent F — QA/red-team (read-only until findings)**
- Replays fixtures through the pipeline; tries to break labelling: reposts counted twice, outlet names geocoded, non-ME items promoted, undated items, HTML-in-XML, stale source masked as fresh, contract averaged anywhere, causal wording anywhere in UI strings. Files issues in `docs/QA_FINDINGS.md`; writers fix.

**Day 2 acceptance:** ≥3 source *types* live and labelled; Kalshi contracts visible and separate; story clustering with independence counts; claim_status computed by the stated rule; relevance eval recorded; blocked sources documented with the exact next human action.

### Day 3 — Geospatial context, hardening, demo

**Agent G — Map** (writer: `src/components/MapPanel.tsx`, `server/assets.ts`, `data/assets.json`)
- Leaflet + Natural Earth (public-domain) or OSM tiles with attribution; verify tile policy — default to a bundled low-zoom basemap to avoid tile-usage issues in a demo.
- Layers: (a) curated static assets (Hormuz, Bab el-Mandeb, Suez, Fujairah, Yanbu, Ras Tanura, Ras Laffan, Kharg …) each with `source_url`, `valid_as_of`, `precision`; (b) events at their *named-place* position with precision styling (point/city solid, region ring, country dashed + "approximate"); (c) selected event highlight. Event click ↔ marker click are linked both ways.
- Company relations only from curated rows: `owns|operates|equity_in_venture|uses_route|serves_port` with `valid_as_of, source_url, supporting_excerpt, verified_by`. Unsupported = no edge.
- *Acceptance:* 8–12 assets and 5–10 relations each with a citation; no marker lacks a precision label; toggling layers never drops events silently.

**Agent H — Resilience & cache** (writer: `server/http.ts`, `server/ingest.ts`, `server/index.ts`)
- Persist the last good response per source (hash + body, size-capped) so parser regressions can be replayed and boot is instant offline.
- Per-source rate-limit guard from registry (`minGapMs`), jittered schedule, circuit breaker state persisted across restarts, exponential backoff caps; `/api/health` with machine-readable detail.
- UI error boundaries per panel (a chart failure must not blank the page — today one thrown render error blanks everything), offline banner, "data as of" always visible.
- *Acceptance:* kill the network mid-run → UI usable, banner shown; restore → recovers without restart; fault-injection tests for 429 / 5xx / truncated XML / HTML instead of XML.

**Agent I — Demo fallback & runbook** (writer: `data/demo_seed.json`, `scripts/make-seed.ts`, `README.md`, `docs/DEMO_RUNBOOK.md`)
- `npm run seed:export` snapshots *real* captured markets/history/events/links with a visible `SEED — captured <timestamp>` banner; `npm run dev -- --offline` loads the seed. A seed is never presented as live.
- Runbook: pre-flight checklist (network, source pills, last refresh), 5-minute script (pick an event → contract → coincident-timing caveat → blocked-sources slide), questions for SNT from the planning doc, known limitations slide.

**Agent J — Final QA / acceptance** (read-only + report)
- Run the §6 acceptance matrix on a clean checkout and a cold start; record pass/fail with evidence.

**Day 3 acceptance:** live streams + interactive map linked to events + market overlays + offline seed mode; cold start from README in <5 minutes; acceptance matrix signed with evidence.

---

## 6. Acceptance matrix (checked by Agent J)

| # | Criterion | How verified |
|---|---|---|
| 1 | `npm run dev` loads page with real contracts + real events | screenshot + `/api/status` counts |
| 2 | Every event has a source URL, publication time, tier, affiliation | SQL: no NULLs |
| 3 | Refresh twice → no duplicates; failures isolated per source | tests + log |
| 4 | Stale/failed/blocked sources visibly labelled; old data retained | fault injection |
| 5 | Contract quote shows basis (midpoint/last trade), bid/ask, deadline, rules link | UI check |
| 6 | No averaging/merging of contracts; venues separate | code search + UI |
| 7 | Event links show their evidence; no-match events show none | UI check |
| 8 | Price context says "coincident, not causal" | UI string audit |
| 9 | State-affiliated sources labelled Tier-3 with affiliation | UI check |
| 10 | Approximate locations labelled approximate | UI check |
| 11 | Demo seed visibly labelled as seed | UI check |

---

## 7. Open decisions that need the user (agents must not guess)

1. **Reuters/AP**: no free public RSS. Accept BBC/Guardian as Tier-1 proxies, or provide a licensed feed?
2. **UKMTO access**: request data access / email advisories (preferred), or accept the gap and use IMO/JMIC PDFs + carrier advisories?
3. **ACLED key**: register for API access (free for researchers, terms apply).
4. **ReliefWeb appname**: request from hdx@un.org.
5. **Translation runtime**: local model (Ollama/bge-small family) vs none. Until chosen, non-English items are shown untranslated and flagged.
6. **Telegram**: the plan notes Telegram's AI-processing restriction; the channel stays a reference link only unless permission is clarified.
7. **Polymarket tag scope**: current rule = ME-specific tags + entity-filtered `geopolitics`/`military`. Confirm this matches what SNT would consider "relevant".

---

## 8. Recommended architectural and analytical improvements (after the 3 days)

**Architecture**
- Replace polling with a small job table + scheduler (per-source cadence, jitter, backoff state) and WebSocket push to the UI; keep SQLite, add FTS5 for search.
- Content-addressed raw-response store so any extraction bug can be replayed offline; parser regression corpus per source.
- Move dictionaries to data files (`data/gazetteer.json`, `data/aliases.*.json`) editable without code changes; add provenance (who added, source) to each alias.
- Polymarket WebSocket/CLOB streaming for live ticks only for the one or two contracts on screen.
- Proper migrations (versioned SQL) once the schema stabilises.

**Analytics**
- *Lead–lag:* estimate whether price changes precede or follow first publication using event-study windows with a permutation baseline (shuffle event times within the same hours-of-day to control for diurnal volume). Report effect sizes with intervals, per contract class, and refuse to publish below a minimum n.
- *Triangulation engine:* require ≥2 independent groups across ≥2 *sensor types* (wire, official, maritime incident report, AIS anomaly, market microstructure) before a "high-confidence" flag; alerts name which sensors agree.
- *Propaganda/state-framing classifier:* separate "actor X claims" from "event occurred" using attribution parsing (verb + speaker); tag framing features, not truth.
- *Entity resolution:* ship-name/IMO aliasing, facility gazetteer from curated sources, company/ticker mapping with explicit `unknown` for unlisted exposure; never fuzzy-merge vessels by name alone.
- *Market-side signals:* spread/depth anomalies, volume spikes vs the contract's own baseline, cross-venue divergence only for hand-verified equivalent contracts.
- *Evaluation culture:* a frozen, hand-labelled benchmark (event↔contract, relevance, location) re-scored on every rule change; record the numbers in the repo.
