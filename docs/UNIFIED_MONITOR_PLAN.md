# War Tracker: Consolidated Next-Step Implementation Plan

Updated: 2026-10-09 (Hong Kong). Status: **Existing baseline implemented; next-phase work planned**. This document combines the user's latest Days 2–3 completion/next-step report with indicators, unified monitoring, wallet activity, maritime tracking, and the accepted Research Workspace extension. Planning updates changed documentation only: no application features were implemented, packages installed, live ingestion run, or deployment performed. It supersedes stale next-step instructions and all X implementation work in earlier versions.

**New product extension:** [RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md](RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md) defines the first-release event dossiers, observation cards, research hypotheses, calendar, and coverage panel. Read Section 14 for sequencing; its deferred brainstorm is not a requirement to build every idea now.

## 1. Scope and objectives

Reuse React, TypeScript, Express, SQLite, and ECharts to deliver explainable indicators, unified monitoring of news/official sources/Telegram, traceable wallet activity, maritime vessel/route context, and the remaining evidence-quality and source-access work from Days 2–3. Preserve and extend the working baseline rather than rebuilding it.

**X is entirely deferred.** This iteration excludes its API, web scraping, mirrors, account monitoring, and paid data configuration. It also excludes automated trading, arbitrary Pine script execution, model-based analysis of Telegram, and a composite war-risk score. Telegram media remains links only.

Priorities:

- **P0:** Data quality and unified source monitoring.
- **P1:** Moving averages, changes, baselines, and a small Polymarket wallet-monitoring pilot.
- **P2:** Optional RSI, MACD, Bollinger Bands, and weekly CFTC positioning.

Run evidence-quality work alongside the core delivery. Credential-dependent sources and human reviews have explicit gates in Section 12 and must not block unrelated work.

P2 must not block P0/P1 delivery.

## 2. User collection and research sources

The [Product Collection](https://docs.google.com/document/d/1BXsWPfc_UTP6sarxIqaE7DRzYm2U4w8v1F5IavKW9TU/edit) was read through Google Drive. The supplied link points to **Thesis Analysis** (`t.lfmqtv1t6ycu`); indicator-related material is in **Terminal Frontend** (`t.k5dorr917mgj`) in the same document. **Data Gateway & Toolset** also informed the plan. The original Google Doc was not modified.

The collection includes ECharts, TradingView Lightweight Charts, KLineChart, Vela/PineTS, Dockview/FlexLayout, deepentropy/lightweight-charts-indicators, and cinar/indicator. AI Hedge Fund, TradingAgents, FinRobot, and FinGPT in Thesis Analysis are research/model workflows, not numerical-indicator dependencies for this iteration.

Follow the collection's separation of chart rendering, data provision, and indicator computation. Open-source chart libraries do not supply market data or turn missing OHLCV into real observations. Original sources, licensing, and adoption decisions are in [INDICATOR_TOOLS_RESEARCH.md](INDICATOR_TOOLS_RESEARCH.md); wallet and positioning resources are in [SMART_MONEY_RESEARCH.md](SMART_MONEY_RESEARCH.md). Formulas and product thresholds below are proposed design choices, not claims of demonstrated effectiveness.

## 3. Existing code and constraints

The implementation agent must inspect current code first. Other work may have changed it; do not reset functionality based on old conversation counts or status statements. The supplied completion report is a historical record; the code and local reports were inspected for this merge, but its tests and browser checks were not rerun here.

### 3.1 Completed baseline to preserve

| Completed work | Current evidence / preservation requirement |
|---|---|
| EASA conflict-zone airspace bulletins | Official bulletin adapter and fixtures are already present. Preserve issue/validity dates, status, CZIB identity, source links, and date precision. |
| Advisory-email inbox | Generic `.eml` drop-folder adapter with sender profiles; see [UKMTO_ACCESS.md](UKMTO_ACCESS.md). The test email is synthetic. Do not assume a UKMTO subscription, sender identity, or live advisory access has been verified. |
| Event-time extraction and energy/shipping focus | Already implemented. Preserve conservative past-day extraction, unknown states, event-day bands, and scope filtering. Do not turn publication time into an inferred incident time. |
| Assets and company relationships | Event detail includes cited relationships and an event → asset → company graph. Preserve unverified/approximate labels; reference assets are not proof of operational disruption. |
| Cross-venue candidates | `server/equivalence.ts` and the Other venue UI exist. `data/contract_equivalence.json` currently contains no verified pairs. Preserve warnings and the human-verification gate. |
| Resilience and adapters | Persisted circuit breaker, `/api/health`, typed adapter registry, and local-server fault-injection tests exist. Extend these paths rather than introduce parallel infrastructure. |
| Automated acceptance and responsive checks | The supplied report records 46 passing tests, typecheck/build success, clean-copy checks, and desktop/tablet/phone inspection. The saved [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) records 14/14 criteria passing. These are baseline records, not independent validation or a new verification run. |
| Four fixes from the earlier proposal | Channel failure isolation, sensor refresh after ingestion, multi-channel picker, and visible catch-up gap/error state are implemented. Preserve them and extend only the remaining functionality below. |

Source counts and event totals differ between recorded snapshots. Do not treat them as fixed acceptance targets; report new counts with their observation time. See [AGENT_LOG.md](AGENT_LOG.md), Session 3, for evidence and limitations.

### 3.2 Integration points

| Entry point | Existing behavior and integration considerations |
|---|---|
| `shared/types.ts` | `HistoryPoint` contains `t/p`; `SensorSeries` contains numerical observations. Neither is OHLCV. |
| `server/db.ts` | Existing tables include `price_history`, `history_meta`, `market_obs`, `series_points`, `tg_posts`, and `source_health`. |
| `server/history.ts` | Polymarket history is provider-defined; Kalshi history uses closing bid/ask midpoints. Gaps are not filled. |
| `ProbChart.tsx` | ECharts rendering, zoom, publication markers, and some event-time bands. Preserve existing markers and bands. |
| `RightPanel.tsx` | Already displays changes and typical hourly movement. Consolidate computation rather than introduce competing definitions. |
| `SensorPanel.tsx` | Already refreshes using `refreshKey` after ingestion. Preserve this; later update from per-source input versions where appropriate. |
| `sources/telegram.ts` | Supports multiple channels, isolated failures, and a visible `gap_note` after capped catch-up. Durable recovery of the missing middle interval is still required. |
| `telegram.ts` / `TelegramView.tsx` | Channel-list API and picker exist; picker is hidden for a single channel. Unified cross-source feed remains new work. |
| `ingest.ts` / `index.ts` | Shared ingestion loop invokes isolated channel collection. Extend scheduling/coverage without undoing isolation, persisted breakers, or `/api/health`. |
| `docs/ACCEPTANCE_REPORT.md` | Existing mechanical baseline checks do not automatically validate new indicators. |

Components are under `src/components`; server modules are under `server`. Database changes require repeatable migrations. Do not clear existing SQLite data. Seed mode remains offline and must explain when Telegram or wallet data is absent.

## 4. Open-source tool decisions

| Tool | Decision | Rationale |
|---|---|---|
| [Apache ECharts](https://github.com/apache/echarts) | **Keep** | Already installed; Apache-2.0. Continue using it for overlays, synchronized subplots, and sparklines. |
| [simple-statistics](https://github.com/simple-statistics/simple-statistics) | Optional statistics library | ISC. Useful for medians and quantiles, but Section 5 governs the product's exact definitions. |
| [Lucide](https://github.com/lucide-icons/lucide) | Optional icon library | Consistent source, trend, and refresh icons. Retain text and accessible labels; icons do not replace numerical explanations. |
| [technicalindicators](https://github.com/anandanand84/technicalindicators) | P2 computation candidate | MIT. Verify current Node/ESM/TypeScript compatibility, initialization, rounding, and numerical fixtures. Do not install another overlapping calculation library. |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Future alternative | Financial rendering layer with attribution/NOTICE requirements. Do not add a second rendering engine in the first release. |
| [KLineChart](https://github.com/klinecharts/KLineChart) | Evaluate after real OHLCV is available | Built-in indicators and drawing tools suit a candlestick terminal. Choose one future route between it and Lightweight Charts. |
| [PineTS](https://github.com/LuxAlgo/PineTS) | Deferred | Currently AGPL/commercial dual licensing; native Pine support is marked experimental. No runtime is needed without a concrete script-import requirement. |
| [deepentropy indicators](https://github.com/deepentropy/lightweight-charts-indicators) | Deferred | Related to the Lightweight Charts route. Validate dependencies and a small formula allowlist; indicator count does not establish correctness. |
| [cinar/indicator](https://github.com/cinar/indicator) | Do not adopt this iteration | Go stack; v2+ uses AGPL/commercial dual licensing. Do not assume v1's MIT license applies. |
| Dockview / FlexLayout / Vela | Deferred | Docking layouts and a new rendering engine are not the first release's indicator bottleneck. |

Reusing ECharts with a few tested pure functions is acceptable. Do not install every candidate to complete a checklist. Record pinned versions, LICENSE/NOTICE, dependencies, and compatibility verification for new packages.

## 5. Indicator definitions and priorities

### P0: Data status and basic changes

- Each source/channel displays its last attempt, last success, error, next scheduled attempt, and coverage gaps. Retain previous data on failure.
- Distinguish retrieval time from the observation's actual time. Daily PortWatch/FRED series have publication delays: do not assess all sources against a five-minute freshness threshold or label daily observations LIVE.
- Display probability in percent and probability changes in percentage points (`pp`). Preserve venue and original units for spread, volume, and liquidity; do not sum across venues.
- Compute changes within one provider history series: `100 * (p_latest - p_reference)`, using the latest point and the closest prior point at or before the comparison time. Show current order-book quotes separately when their basis differs. Display both actual timestamps and the actual comparison interval.
- For a 1h change, the latest history point must be no more than 2h old relative to `asOf`; the reference point must be within 15min before its target time. For 24h comparisons, reference tolerance is 2h. Otherwise return `null` with stale/gap status, not zero. Configure and version these tolerances.
- Count newly collected items over 15min/1h using `collected_at`; display publication-time distributions separately using `published_at`. Backfilled posts are not newly occurring events. Add a migration if collection time is missing; do not derive it from publication time.
- Use labels such as original, forwarded, attributed, similar reporting found, and not assessed. Multiple retellings are not independent confirmation. Do not display a truth score.

### P1: Trends and sensor baselines

| Indicator | Default definition | Presentation |
|---|---|---|
| SMA | Probability: 24/72 consecutive hourly samples. Oil: 7/20 published observations. Emit only after a complete N-point window. | Main-chart overlay; SMA24 enabled by default. |
| EMA | Probability EMA24, optional EMA72. `alpha = 2/(N+1)`; initialize with the first N-point SMA, then recurse. | Offer a limited selection alongside SMA to avoid clutter. |
| Hourly movement baseline | Absolute changes from up to 168 prior valid adjacent-hour pairs; require at least 48 pairs. Median/P95 use type-7 linear-interpolated quantiles. | Cards and details. Exceeding P95 describes historical unusualness, not causation or escalation. |
| PortWatch | Compare the current daily value with the mean of the preceding 28 calendar days; require at least 24 valid days. Exclude the current observation from the baseline. | Absolute change, percentage change, and baseline. Percentage is unavailable when the baseline is zero. |
| FRED | Absolute/percentage change versus the preceding actual published observation; SMA7/SMA20. Do not insert weekend zeroes. | Clearly label spot prices, daily frequency, delay, and observation date. |
| Information activity | Start with observed counts. Add anomaly baselines only after source membership, deduplication, and continuous coverage stabilize. | Describe activity within the watchlist, not platform-wide sentiment. |

Initially, OpenSky/IODA display latest values and observed changes. Require at least 14 days of coverage and controls for time-of-day and receiver-coverage changes before adding anomaly baselines. A failed source is not zero aircraft or confirmed internet disruption.

### P2: Optional technical subplots, disabled by default

- **RSI14:** Wilder smoothing. Initialize with 14 gain/loss differences from 15 points; then `avg = (prev*13 + current)/14`. Define RSI as 50 when average gain and loss are both zero, 100 when only loss is zero, and 0 when only gain is zero. Use a separate 0–100 subplot; 30/70 are descriptive reference lines.
- **MACD(12,26,9):** Initialize EMA12/EMA26 with SMA seeds. MACD is their difference; initialize the signal with nine valid MACD values; histogram is MACD minus signal. Require at least 34 consecutive points for complete output. Probability inputs remain 0–1; multiply outputs by 100 for display in pp.
- **Bollinger(20,2):** SMA20 plus/minus twice the population standard deviation, using denominator N. Theoretical bands may cross probability's 0–100% boundary. Preserve raw values and indicate excursions; these are not confidence intervals.
- These indicators describe the sampled series. High RSI on a prediction probability does not establish a wrong probability or a reason to sell.
- Exclude ATR, VWAP, OBV, true candlesticks, and volume profiles. Rolling `volume_24h` is not hourly volume and must not be differenced into fabricated VWAP weights.

### Time-series and missing-data rules

1. Sort ascending, deduplicate, and validate finite values. Probabilities must be in 0–1. Compute separately by venue, contract, and basis.
2. Hourly indicators use the final real sample in each completed UTC hour bucket, retaining `sample_at`. Empty buckets remain empty. Representative-point gaps greater than 90min also break continuity; restart warm-up after a gap. Do not present 6h/24h fidelity as 1h.
3. Daily FRED calculations follow actual observation order. Reset and explain interruptions exceeding seven calendar days. Check PortWatch coverage by calendar day.
4. Use only data at or before `asOf`, excluding incomplete buckets. Baselines exclude the observation being evaluated. Compute over the complete input before cropping to the UI range; changing range must not change EMA initialization.
5. Compute before ECharts LTTB downsampling. Return `null` for warm-up/stale/gap states while preserving timestamps.
6. Historical seed data can produce historical indicators, but live anomaly alerts remain disabled. Date-only messages cannot be aligned to a precise hourly price reaction.

## 6. Interface plan

- **Top watchlist:** Default to 4–6 pinned cards showing latest value, change window, sparkline, and observation time. Use neutral direction colors; show alert severity separately.
- **Main-chart Indicators control:** SMA/EMA initially; RSI/MACD/Bands later. Label periods explicitly, such as `24 x 1h`. Offer fixed 0–100% and automatic probability-axis scaling; clearly label automatic scaling.
- Synchronize ECharts crosshairs and zoom across main/subplots while keeping units separate. Tooltips must display all enabled series; replace the current formatter that reads only the first series.
- Preserve publication markers, existing event-time bands, provenance, basis labels, and non-causal explanations. Date-only events use date intervals.
- **Unified feed:** All / News / Official / Telegram, with source/channel/topic/place/language filters. New arrivals wait behind an “N new items” button rather than scrolling the reader to the top.
- **Sources:** Independent channel health; retain Telegram-specific analytics within source details.
- **Wallet activity:** Wallet watchlist plus selected-market large trades and positions. Show incomplete coverage; do not fill in an unsupported whole-market net-inflow metric.

## 7. Module boundaries and API

Suggested structure: `server/indicators/{normalize,math,definitions,service}.ts`, or an equivalent encapsulated module. Keep `shared/indicators.ts` free of third-party dependencies. Calculations are pure functions accepting `asOf`; React renders their results. Consolidate RightPanel's existing change logic into the same service.

Each output includes `id`, `definition_version`, `target(kind/id)`, `basis`, `unit`, `timeframe`, `params`, `as_of`, `computed_at`, `input_version`, `sample_count`, `coverage`, `status`, `reason`, `latest`, and `points[{t,value,status}]`. Status is `ok`, `warming_up`, `stale`, `gap`, or `unsupported`; values may be null. MACD line, signal, and histogram are separate outputs.

Suggested read-only routes: `/api/markets/:id/indicators`, `/api/sensors/:id/indicators`, and `/api/watchlist`. Indicator routes read stored data; history acquisition follows the existing flow rather than triggering full ingestion. Allow only registered indicators and bounded parameters, not arbitrary JavaScript/Pine.

Cache revisions must cover input contents, sampling precision, and basis, not just `MAX(t)`: historical revisions must invalidate results. Start with computed-result caching rather than persisting every indicator point. Persist watchlist, period, and display preferences. Migrations must be repeatable.

## 8. Telegram engineering tasks

The channel picker, failure isolation, sensor refresh, and visible gap/error labels are completed baseline features, not new deliverables. Regression-check them, then implement the extensions below.

1. Use a unified read model while retaining the original `events` and `tg_posts` tables. Stable identity is platform plus channel/source plus external ID. Preserve publication time, collection time, time precision, original URL, forward origin, and match strength. Do not force Telegram into news tiers.
2. Extend the existing isolated channel collector and attempt/error records into independent scheduling, retry, cursor, and durable coverage state. Keep existing failure isolation; prevent overlapping runs for the same channel. Schedule latest-post polling separately from slow sources and historical backfill.
3. Target five-minute public-preview polling during the pilot, preserving host throttling/backoff. Measure publication-to-collection delay rather than promise second-level delivery. Make the channel allowlist configurable.
4. The existing four-page cap already sets a visible gap note. Add durable latest-catch-up progress and continue filling the missing middle interval. Clear a gap only after that specific interval has been recovered, not merely because a later newest-page poll encounters stored posts. Deepening the oldest history must not leave intermediate gaps. Bound requests per cycle.
5. Start with short frontend polling; SSE can follow. Retain existing sensor/Telegram refresh behavior and extend Sensors/Feed/Watchlist to update when per-source input versions change, not only after the entire ingestion cycle completes.

## 9. Wallet activity / smart-money scope

Use the product label **Wallet activity** or **Capital activity**. Separate large trade size, position concentration, and assessable historical performance. A wallet address is not a known person; do not label unknown addresses as institutions or insiders. Resources, API versions, and access limits are documented in [SMART_MONEY_RESEARCH.md](SMART_MONEY_RESEARCH.md).

Prioritize Polymarket's public positions, trades, activity, holders, and leaderboard resources. Start with 5–10 Middle East/energy markets and at most 20 explicitly watched addresses. The research note's 10–20-market range is an expansion ceiling; this plan's smaller starting scope takes priority. Use leaderboard entries for candidate discovery, not as a strategy win rate. No automated trading, private-key access, or signature requests.

**API version requirement:** The official migration guide states that v1 retires on 2026-10-24. New adapters use v2 snake_case fields, cursors, and the data/pagination envelope, preserving `source_api_version`. Separate the market trade tape from wallet activity: default taker-only market trades can avoid counting both sides of a fill; wallet monitoring must evaluate `taker_only=false` to include makers, without adding both sides to market volume. Pin positions, holders, activity fields, and time ranges with official-response fixtures. [Migration guide](https://docs.polymarket.com/migrate/data-api-v1-to-v2), [Trades reference](https://docs.polymarket.com/api-reference/feeds/list-trades).

First probe read-only HTTP or the official public client. Public data is a starting route without purchasing an additional data service, not a promise of permanent free or unlimited access. Read-only monitoring does not require a signing/trading SDK. Use shared throttling, exponential backoff, and per-cycle request budgets. Pilot market-trade polling at 1–5min, positions at 10–15min, and leaderboard updates daily; adjust after measuring actual latency. Respect endpoint history limits; a bare global feed does not provide a guarantee of full history.

Suggested observations: large trades with explicit outcome, watched-wallet position snapshot changes, market concentration only with a complete denominator, parsed trading activity, and separately displayed realized/unrealized PnL. Include address, market/outcome, transaction time, collection time, monetary units, original links, and coverage.

An initial large-trade filter may be configurable as a single trade of at least US$10,000 or sample P95. This is a screening parameter, not a validated smart-money threshold. Compute `trade_notional = size * outcome_price` only after confirming actual endpoint currency/quantity definitions. Display outcome direction; buying NO is not buying YES.

Net buying covers only parsed, deduplicated BUY minus SELL activity for watched wallets, within a specified window and outcome. Label it **Watched-wallet net trade value**, not whole-market net capital inflow. Every market trade has a buyer and seller. Do not double-count maker/taker views, repeated address rows, settlement, splits, merges, or transfers. With incomplete activity coverage, omit the net value or explicitly label it partial.

Do not generate a single smart-money score. Show resolved sample count, historical coverage, PnL basis, unresolved exposure, and topic scope. Without complete cost/settlement records, label values provider-reported or not assessable. Freeze selection times and rules, then observe prospectively; do not select historical winners and claim their returns were reproducible signals.

Kalshi public trades support volume/large-trade observations, not identifiable-wallet tracking. Later CFTC COT integration can show energy Managed Money long/short/net positions, weekly changes, and net positions/open interest. Separate contract codes and report types; label observation date, publication date, and futures-only versus futures-and-options. Do not call it live. SEC 13F is a future institutional-energy-equity background resource, not part of the current fast-news module.

Add raw-response caching, pagination progress, deduplication identities, wallet snapshots, and per-source health. Transaction hash alone is not a unique activity/trade key: one on-chain transaction can contain multiple fills or activities. Use official IDs or complete event identity. Fix API-version mappings with official-response fixtures; mark missing pages, 429s, and lag as degraded. Do not claim live integration without live samples.

## 10. Delivery sequence and acceptance

| Package | Deliverable | Dependencies |
|---|---|---|
| A | Result types, normalization, basis, freshness, and numerical fixtures | First |
| B | P0/P1 computation, APIs, and cache | A |
| C | ECharts overlays, tooltips, watchlist, and display preferences | A/B |
| D | Multi-channel Telegram, unified feed, catch-up, and unread state | Shared time/source definitions |
| E | Polymarket wallet-resource smoke probes/fixtures, bounded collection, and wallet-activity page | A and official-access verification |
| F | In-app alerts and updated acceptance report | Stable B/D/E coverage |
| G | Optional RSI/MACD/Bands and CFTC COT | Separate later delivery; must not block core work |
| H | Claim-review schema/UI, independent benchmark workflow, multilingual review corpus, and verified-pair review workflow | Existing evidence rules; human review for authoritative labels and pair verification |
| I | Credential/access-gated ACLED and NGA/ASAM source work | Valid access and representative real responses; optional, not a core blocker |
| J | Vessel-type extraction, reviewed reference assets, and persisted source-rate controls | Source-specific evidence and adequate fixtures; follow core delivery |
| K | Maritime reference directory, vessel watchlist, and a bounded free AIS coverage pilot | Section 13; official access, server-side key, and measured regional coverage before live integration |
| L | Research Workspace: event dossiers, observation cards, hypothesis reviews, calendar, and coverage panel | Section 14 and its detailed W0–W6 plan; reuse A/D/H/J/K models rather than duplicate them |

In-app alerts fire only when a rule moves from normal to abnormal. Deduplicate by target/rule/window, configure cooldown, and re-arm after recovery. Stale/gap/seed states must not trigger live wallet or event alerts. Historical revisions update existing records with a revision label rather than repeatedly appearing as new events. External notifications and actual server deployment are outside this document-writing task.

Acceptance requirements:

- Fixed numerical fixtures cover SMA/EMA initialization, type-7 quantiles, zero denominators, constant/rising/falling sequences, sorting/deduplication, warm-up, gaps, future-point exclusion, and baselines excluding the current observation.
- If P2 is delivered, validate RSI/MACD/Bands against independently specified expected numbers, not only tests that mirror internal function calls.
- Identical input/version gives identical results. Changing UI range does not change historical values. Revising an old observation invalidates cached results.
- Provider-history/current-quote differences are visible. Venues remain separate, probabilities use percent, changes use pp, daily series do not invent weekends, and downsampling does not affect calculations.
- Validate channel failure isolation, busy-channel page caps, middle-interval recovery after long outages, and restart idempotence. Backfilled items are not new events.
- Regression-check all completed Section 3.1 features: EASA, inbox idempotence/synthetic separation, future-date rejection, energy/shipping scope, asset provenance, cross-venue gating, persisted breakers, `/api/health`, typed adapters, channel picker, sensor refresh, and gap labels. Do not overwrite the previous acceptance report before recording the new run separately.
- Wallet fixtures cover truncated/repeated pages, multiple activities in one transaction, NO outcomes, transfers/splits/settlement, unknown PnL, and partial coverage. Net trade value is not mislabeled as market inflow.
- Manually inspect light/dark themes and desktop/narrow layouts, including multi-series tooltips, synchronized time controls, markers, empty states, and data refresh.
- Run `npm run typecheck`, `npm test`, `npm run acceptance`, and `npm exec vite build`. Extend acceptance for new features rather than relying on the previous report.
- Seed mode is entirely offline and explains missing Telegram/wallet data. No X requests, new paid-data dependencies, or automated trading.
- Write `docs/INDICATOR_IMPLEMENTATION_REPORT.md` covering changed files, formula versions, actual verification, screenshot locations, and unfinished work. Distinguish fixture verification from live verification.
- For packages H/I/J, apply their Section 12 acceptance gates. Human-dependent reviews remain pending until actual reviewers provide evidence; inaccessible sources remain disabled with a reason.
- For package K, apply Section 13 coverage, identity, track-gap, and route-labeling checks. No paid AIS subscription or commercial-site scraper is included in this iteration.

## 11. Ready-to-send implementation-agent brief

> Read this consolidated plan, INDICATOR_TOOLS_RESEARCH.md, SMART_MONEY_RESEARCH.md, MARITIME_TRACKING_RESEARCH.md, AGENT_LOG.md Session 3, and the current code. First inventory the completed baseline in Section 3.1; do not rebuild already completed Days 2–3 features or the four repaired defects. Deliver core P0/P1 in sequence A → B/C/D → E → F, reusing ECharts/SQLite and computing indicators deterministically on the server. Start package H's review infrastructure and K's reference directory alongside core work; I/J, live K, and optional G follow their explicit gates. Verify public wallet API fields and coverage before the bounded pilot; measure regional AIS coverage before claiming vessel monitoring. Preserve provenance, time precision, basis, event/asset views, cross-venue warnings, and existing markers. X is entirely deferred, regardless of older reports mentioning an X pilot. Do not fabricate OHLCV, vessel tracks, or verified routes; do not execute arbitrary Pine scripts, automate trading, or introduce model-based Telegram analysis. Show unavailable/warming_up when history is insufficient. Use existing configured channels with the five-minute pilot target as a planning default; allow user configuration without blocking unrelated work. Run acceptance checks and write the implementation report, separating verified results, pending human input, and credential/access blockers. P2 must not block core delivery.

## 12. Remaining Days 2–3 work and explicit gates

This section incorporates the unfinished work and next-step questions from the supplied completion report and Session 3 log. Prepare reviewable artifacts before requesting inputs, and continue independent core tasks when an external dependency is missing.

### H1. Claim-level evidence and review

Current stories and Telegram-news matches are relevance/similarity results; all news claims currently remain `reported`. Build a claim/evidence review layer rather than treating outlet counts as verification.

- Keep source-item identity separate from claim identity. A claim records actor/action/place/time as stated, original text anchors, attribution, and explicit unknown fields. Initially support manual structured entry and conservative deterministic extraction.
- Link evidence with original URL, publisher, upstream origin, publication/event time precision, supporting/contradicting/unclear relationship, and a rationale. Retellings sharing one upstream source remain one evidence-origin group.
- Keep workflow state (`unreviewed`, `in_review`, `reviewed`) separate from the assessment (`supported`, `contradicted`, `contested`, `insufficient`). Store reviewer, review time, rule version, and history. A reviewed assessment is still an evidence judgment, not a guarantee of truth.
- Default to insufficient/unreviewed. If the existing `claim_status` contract is extended, version it and define transitions explicitly; similarity alone cannot automatically assign `corroborated` or another definitive status.
- Acceptance: fixtures for copied wire reports, unrelated events sharing countries, competing claims, date-only evidence, and retracted/revised evidence. Show the evidence and reviewer behind every non-default assessment.

### H2. Independently labeled link benchmark

- Prepare at least 100 event-contract pairs with a frozen rule version, sampling recipe, and label guide. Include relevant, irrelevant, and ambiguous examples across sources/topics, not only displayed successful links.
- Provide a review file with source URLs, contract questions/rules, and publication/deadline times. Keep proposed predictions hidden while an independent domain reviewer labels it. Preserve ambiguous labels rather than forcing binary answers.
- Separate development and untouched evaluation sets. Report precision/recall with sample counts and uncertainty; tuning on a set makes it development data thereafter.
- Acceptance: record reviewer identity or approved identifier, adjudication, exclusion rules, and evaluation results. Without an independent reviewer, deliver the corpus/tooling and mark independent evaluation pending; do not relabel the agent's own judgments as independent.

### H3. Arabic/Persian dictionary validation and translation decision

- Assemble a representative review corpus spanning relevant and irrelevant items, agency datelines, locations, aliases, negation, and future/past cues. Provide original text, source links, current extracted fields, and editable review columns.
- Native readers review language-specific relevance/entity/place results; record corrections and regression fixtures. Preserve RTL and untranslated flags.
- Translation remains an optional decision, not a prerequisite. Default to no translation runtime. If later authorized, preserve originals, label translations, record engine/version, and separately resolve any Telegram model-processing constraints. Do not silently expand Telegram analysis scope.
- Acceptance: a reviewed corpus and documented error analysis. Until review happens, keep language-quality caveats visible.

### H4. Human-verified Polymarket–Kalshi pairs

- Reuse candidate discovery and `data/contract_equivalence.json`; prepare a small review queue with both resolution texts, outcome definitions, deadline/time zone, and settlement sources. Differences must be explicit.
- Only a named domain reviewer can approve true equivalence; preserve their rationale and review date. Do not approve text-similar candidates automatically or manufacture a verified pair to populate the UI.
- Keep venues and price histories separate. Divergence is available only for verified, currently applicable pairs with aligned outcomes, compatible quote bases, and sufficiently close observation times. Otherwise explain why it is unavailable.
- Acceptance: mismatched deadlines/resolution rules/outcome directions stay unverified; the empty verified list remains valid. Once a real pair is approved, test the divergence calculation and its stale-data behavior. A divergence history chart is later work and requires aligned historical coverage.

### I1. ACLED adapter — credential and real-sample gate

- Obtain authorized API access and a representative real response before implementing a production adapter. Configure secrets locally/on the server; do not ask for tokens pasted into chat.
- Reuse the typed adapter registry, raw cache, source-health handling, migrations, and idempotent storage. Preserve source methodology, dates, revisions, and location precision.
- Acceptance: sanitized real-response fixtures, pagination/retry tests, schema validation, and an authorized live pilot. Without credentials/sample, leave the source disabled with a clear reason; a generic or synthetic adapter does not count as live ACLED integration.

### I2. NGA/ASAM maritime warnings — reachability gate

- Retry from the eventual server/network using legitimate public access. If reachable, capture the actual response shape and official metadata before building an adapter.
- Preserve warning identity, revision/cancellation status, incident/publication dates, geography precision, and original links. Reuse per-source resilience and cadence.
- Acceptance: real fixtures and successful public-access smoke test before claiming connection. If unreachable, record the limitation and continue other work; do not route around access restrictions.

### J1. Vessel types and reference-asset review

- Add conservative vessel-type extraction only where the text explicitly supports it, with evidence spans and unknown values; avoid interpreting every vessel as a tanker.
- Prepare the small reference-asset/company dataset for domain review, including original citations, relationship dates, inferred links, and approximate coordinates. Expand it only with traceable sources.
- Acceptance: fixtures for tanker/container/bulk carrier/ambiguous references and a review trail for changed asset facts. Linking a story to an asset does not establish asset damage, closure, or operating status.

### J2. Persisted per-source rate controls

- Add validated cadence/request-budget configuration over the existing adapter and breaker system. Persist changes in SQLite with sensible bounds, defaults, and configuration version.
- Separate provider observation/publication frequency from collector polling. Changing polling cannot make a delayed provider series real-time.
- Apply backoff, jitter, per-host limits, and no-overlap scheduling; manual refresh must respect request budgets. Show effective cadence and next attempt in Sources.
- Acceptance: settings survive restart, invalid values are rejected, failure isolation remains intact, and multiple schedulers cannot accidentally double polling.

### Inputs to request only when needed

| Input | Needed for | Work that can proceed now |
|---|---|---|
| Additional Telegram channels and desired delay | Expanding the watchlist or changing the pilot target | Use current configured channels; prepare configuration UI, unified feed, and coverage recovery. Five-minute polling remains a pilot target, not a guarantee. |
| Named domain reviewer | Verified contract pairs and claim/evidence assessments | Build review queue, evidence UI, and fixtures; keep candidates unverified. |
| Independent benchmark reviewer | Independent link-quality measurements | Produce the frozen corpus and labeling workflow. |
| Arabic/Persian native readers | Language-quality validation | Produce review corpora; retain caveats and untranslated text. |
| Authorized ACLED access and real sample | ACLED production integration | Continue all core modules; leave ACLED disabled. |
| Working public NGA/ASAM network access | Maritime-warning integration | Prepare adapter boundaries and record reachability results without claiming connection. |
| Real advisory emails legitimately received | Operational email-source verification | Reuse the completed generic inbox parser; keep synthetic samples out of live data. |

There is no X account, credential, budget, or scraping decision to request in this phase.

## 13. Maritime websites, vessel tracking, and route context

The user explicitly added public ship information and route websites to the scope. Treat this as a maritime context module, with free/public-access options first. Public browsing, licensed API access, observed AIS tracks, carrier schedules, and computed route illustrations are distinct products. A viewable map does not establish a free bulk-data entitlement.

### 13.1 Source decisions

| Resource | Suitable use | Integration decision |
|---|---|---|
| Existing IMF PortWatch | Daily chokepoint transit/tanker series and historical comparisons | Keep the working adapter and extend its indicators. It is aggregate context, not a vessel-by-vessel live feed. |
| [MarineTraffic](https://www.marinetraffic.com/) / [official API docs](https://servicedocs.marinetraffic.com/) | Manual vessel/port reference and possible future licensed data | Add external reference links. Do not assume public map access includes API access or scrape its internal map endpoints. No paid integration in this phase. |
| [VesselFinder](https://www.vesselfinder.com/) / [API overview](https://www.vesselfinder.com/vessel-positions-api) | Vessel identity, last positions, voyage/master data and manual checks | External reference initially. Official API is credit-based and requires purchasing credits; keep it outside the free pilot. |
| [MyShipTracking](https://www.myshiptracking.com/) / [API](https://api.myshiptracking.com/) | Vessel/port browsing and terrestrial-AIS context | External reference initially. Free website/account access does not establish a free operational API plan; verify plan and coverage separately. |
| [AISstream](https://aisstream.io/) / [documentation](https://www.aisstream.io/documentation) | Geographic AIS event stream; homepage advertises free access | Preferred bounded integration experiment, using a server-side API key and official WebSocket. Test target-region coverage first; do not promise complete global/satellite coverage. |
| [AISHub](https://www.aishub.net/) / [API](https://www.aishub.net/api) | Shared AIS feed | Conditional alternative: official site requires contributing a qualifying AIS feed. Do not plan it as an anonymous free API or require buying a receiver for this iteration. |
| [Digitraffic marine API](https://www.digitraffic.fi/en/marine-traffic/) | Official open vessel positions, metadata, and port calls in Finnish waters | Useful integration/reference example, not evidence of Middle East coverage. No priority live integration for this project's geography. |
| [searoute-py](https://github.com/genthalili/searoute-py) | GeoJSON route illustration between selected ports | Optional offline/precomputed visualization. Apache-2.0; the README explicitly says it is not for ship navigation. Computed routes are not actual tracks, current carrier services, or safe routes. |

See [MARITIME_TRACKING_RESEARCH.md](MARITIME_TRACKING_RESEARCH.md) for primary-source details and limits. No AIS connection or account setup was performed while writing this plan.

### 13.2 First delivery: references and vessel identity

- Build a Maritime Sources directory and vessel watchlist using names plus source-supported IMO/MMSI. Add external site links and manually recorded provenance; no hidden automated scraping.
- Prioritize tanker/LNG/container traffic near Hormuz, Bab el-Mandeb, Suez, and relevant Gulf/Red Sea ports. These are pilot regions, not a claim that a free feed covers them.
- Use IMO when available for durable ship identity; MMSI is a radio identity that may change. Preserve names, identifiers, source, and validity periods. Do not fuzzy-merge ships on name alone or fabricate an IMO when missing.
- Keep AIS ship type, source-reported cargo/owner details, and manually reviewed company relationships separate. A generic tanker code does not establish actual cargo or beneficial ownership.
- Link relevant news to a vessel only with explicit identifying evidence; ambiguous ship names stay unresolved. Retain existing asset/company context.

### 13.3 Second delivery: bounded AISstream pilot

- Obtain a user-configured AISstream key through its official account process; keep it server-side. Direct browser stream connections are not permitted by its documentation. Do not paste keys into chat or expose them in client bundles.
- Subscribe to a small set of bounding boxes and necessary position/static message types using the documented schema. Validate geographic coordinate order, units, timestamps, sentinel values, and static/dynamic joins with real fixtures.
- Run an initial 24–72h coverage smoke observation from the intended server, followed by a seven-day pilot before enabling automated maritime alerts. Use bounded storage/message budgets. Report received messages, distinct identifiers, observation age, stream disconnects, application queue drops, and gaps by region. Low message volume is not proof of low vessel traffic.
- Reconnect with backoff/jitter; handle binary frames, compression, malformed messages, and slow-consumer drops according to official documentation. Keep ingestion outside HTTP request handlers and prevent duplicate workers.
- Store latest position separately from a bounded historical track. Preserve source observation time and receipt time. If only receipt time is available, label it explicitly; do not interpret an AIS seconds-within-minute field as a complete timestamp.
- No historical-backfill endpoint was verified for this proposal. Observed tracks begin at the collector's actual start and have visible gaps during outages; do not manufacture missed history.
- Retain attribution and record permitted storage/display/redistribution conditions before the live integration. A free stream's geographic reach and permitted use must be checked independently of its price.

### 13.4 Map layers and indicators

Reuse Leaflet and the existing basemap; do not replace the map stack. Add independently toggled layers:

1. **Observed vessel positions:** marker, identity, broad ship type, last observation age, reported speed/course, provider, and raw reference link. Stale positions are faded and labeled.
2. **Observed tracks:** actual chronological points only. Break the line when the configurable maximum gap is exceeded; do not interpolate across outages or teleport-like jumps. Downsampling is for rendering after quality checks.
3. **Declared destination/ETA:** preserve AIS-reported strings and uncertainty. Reported destination is not a verified voyage or confirmed arrival.
4. **Carrier/port schedule references:** only from identified official pages/feeds with publication time and scope. A timetable is planned service, not a measured voyage.
5. **Illustrative routes:** dashed, labeled “computed illustration,” generated offline from a versioned routing graph or curated reference geometry. Keep them visually and structurally separate from observed tracks. Canal restrictions are user-selected scenario assumptions, not verified closures.

Start with indicators for observed unique vessels in a specified region/window, broad observed ship-type counts, position age, and collection continuity. State the denominator as received AIS observations, not all ships at sea. Never infer cargo tonnage from vessel count alone.

Chokepoint crossings, detours, and anchorage dwell are later derived indicators. A crossing requires valid sequential positions on both sides of a reviewed boundary, sufficient continuity, deduplication, and direction rules; one point inside a box is not a transit. Anchorage dwell requires a defined area and sustained observations; slow speed alone is not congestion. Keep locally observed crossings separate from PortWatch's official daily series and explain differing definitions.

No-signal periods must not be called deliberate AIS shutdown, sanctions evasion, military action, or proof of a port closure. Show the observable gap and coverage limitation.

### 13.5 Storage, acceptance, and rollout

Suggested additions: vessel identity records, identifier history, latest positions, bounded position history, source coverage intervals, and source-reviewed port/chokepoint geometry. Keep raw fixture/cache retention bounded and configurable. Suggested read-only routes are `/api/vessels`, `/api/vessels/:id/track`, and `/api/maritime/coverage`; use explicit window/limit bounds.

Acceptance must cover: coordinate order, AIS unknown/sentinel values, missing or changed identifiers, repeated/late/out-of-order messages, source versus receipt time, reconnects and slow-consumer gaps, stale markers, segmented tracks, same-name vessels, unsupported cargo/ownership claims, and clear visual separation of real tracks from illustrations. No frontend key exposure, commercial-site scraping, or paid AIS calls.

Deliver K1 (directory/reference links and identity model) first. Enable K2 (live pilot) only with official access and measured usable coverage. K3 (derived crossings/detours/dwell and illustrative scenarios) follows validated observations and reviewed geometry. Core indicators, Telegram, and wallet work continue if a regional AIS feed is sparse or inaccessible.

## 14. Research Workspace: accepted product extension

The user accepted a broader brainstorm and requested an implementation plan. The detailed specification is [RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md](RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md).

First release delivers five features:

1. Event dossiers with updates/corrections, attributed disagreements, and investigation tasks.
2. Port/chokepoint observation cards with available aggregate indicators and coverage labels.
3. Research hypothesis cards with supporting/contradicting evidence, invalidation conditions, and review history.
4. Contract deadline/known-event calendar preserving provider semantics, time precision, and revisions.
5. Monitoring coverage/blind-spot panel extending current health and gap records.

Implement these as package L, staged W0 → W1 → W3 → W4/W5 → W2 → W6. Shared identity/version/coverage foundations come first; dossiers and manual research reviews can proceed without wallet or AIS access. Observation cards reuse package B outputs and existing PortWatch data; unsupported port/vessel metrics remain unavailable. Share package H's evidence model rather than creating a separate verification engine.

Historical replay, route-change analytics, richer impact scenarios, daily briefs, research-packet exports, and advanced wallet comparisons remain explicit later increments. Capture source revisions and coverage from their actual start so future replay can show what was known at the time; current data must not be projected backward as historical knowledge.

The Section 11 brief covers the original core packages. An agent implementing the accepted workspace must also read the workspace plan's Section 9 brief and write `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md`. No automatic expansion to paid data, X, trading, arbitrary scripts, or Telegram model analysis is authorized by this extension.

## Implementation progress (updated 2026-10-09, evening)

Full details, verification and defects fixed: [INDICATOR_IMPLEMENTATION_REPORT.md](INDICATOR_IMPLEMENTATION_REPORT.md). New acceptance run: [ACCEPTANCE_REPORT_v2.md](ACCEPTANCE_REPORT_v2.md) (25/25); the first run's report is kept unchanged. Research workspace: [RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md](RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md).

| Package | State | Notes |
|---|---|---|
| A | Done | `ind-1.0.0`; 13 hand-computed fixtures. |
| B | Done | Server-side indicators, reaction, watchlist, prefs; cache keyed on complete input fingerprint; live on all open contracts. |
| C | Done | Overlays, multi-series tooltip, labelled auto/fixed axis, persisted prefs, watchlist, version-driven refresh; light/dark, desktop, 375 px checked. |
| D | Done (SSE added 2026-10-10 as a refresh nudge; clients still re-fetch via the API) | Telegram on the shared background scheduler (5-min pilot target), durable interval-specific gap recovery, lag measurement, configurable allowlist, unified feed with keyset paging and unread state, Feed and Sources views. |
| J2 | Done | Validated, versioned, persisted cadence/budget; jitter; DB leases (orphan takeover); manual refresh budgeted; partial runs labelled. |
| E | Done (bounded pilot) | Polymarket v2: 8 pilot markets, ≤ 20 watched wallets (starts empty), market tape, activity, positions, holders, leaderboard; coverage and gaps; Wallets view and chart markers. Earlier draft with invented demo trades replaced. |
| F | Done | Transition-based in-app alerts with dedupe/cooldown/re-arm; seed/stale/gap suppression; Alerts view. |
| G | RSI/MACD/Bollinger done (2026-10-10); CFTC COT not started | `ind-1.1.0`: `rsi14`, `macd`, `bollinger` computed on the server, fixtures from an independent Python implementation. UI: Bollinger as an optional overlay, RSI and MACD as optional sub-plots sharing the chart's time window (all off by default, saved in prefs as `panes`), CSV export includes them in their own units. CFTC COT: the public reporting API answers (dataset 72hh-3qpy, fields incl. managed-money long/short); adapter, fixtures and the futures-only vs combined labelling are not built. |
| H | H1 done (tooling); H2–H4 kits ready, review pending | Claim/evidence review with origin groups, rules and history. Frozen 100-pair link benchmark (hidden predictions, dev/eval), 98-item Arabic/Persian corpus, 5-pair cross-venue queue with an approval gate — all in `docs/review/`, waiting for named reviewers. |
| I | I2 connected; I1 gated | NGA reachable on 2026-10-09 retry: documented public endpoint (official OpenAPI), real fixture, adapter + smoke test (20 Middle East warnings; newest in force issued May 2024 → standing-hazard context). ACLED stays disabled until credentials and a real sample exist. |
| J1 | Done | Conservative vessel-type extraction with evidence spans (shown on events); asset-review export/import with review trail (`docs/review/asset_review.csv`). |
| K | K1 done; K2/K3 gated | Maritime sources directory (no invented deep links), vessel identity model (IMO check digit, identifier history with sources, never merged on names), mention proposals only on explicit IMO/MMSI evidence. K2/K3 need a user-configured AISstream key. |
| L | Done (W0–W6) | Dossiers, hypotheses, upcoming list **and month grid** (UTC-pure date maths, dynamic query window), coverage panel, place cards; §7 ideas deferred. |
| M | Started 2026-10-10 | **Positioning: evidence & provenance research desk** (not a terminal clone). Change briefing (`briefing-1.0`, `server/briefing.ts`, Research → Briefing, Markdown export, frozen snapshots, acceptance #29). UI migration per `docs/UI_REDESIGN_SPEC.md` phases: 0 tokens (spec palette, on-accent token, system font stack; web fonts not fetched), 1 five destinations with sub-tabs (Feed ⇄ Telegram analysis, Sources ⇄ Alerts), 2 one health line with glyph markers, 3 touches strip, 4 Chart options and Change contract behind disclosures, 5 one Filters disclosure. Not done: splitting `RightPanel` into four step components, the dedicated contract-detail route, moving the watchlist strip to Markets, bundled self-hosted fonts, equity-sentiment scope (needs the owner's decision). |
