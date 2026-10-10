# Unified Monitor — implementation report

Date: 2026-10-09 (Hong Kong). Plan: [UNIFIED_MONITOR_PLAN.md](UNIFIED_MONITOR_PLAN.md). This report separates **fixture verification** (deterministic tests on hand-computed or captured inputs) from **live verification** (the running app against real providers on this date). Human-dependent reviews are not claimed.

## 1. Status by package

| Package | Status | Verified by |
|---|---|---|
| A — result types, normalisation, freshness, numerical fixtures | Done | 13 hand-computed fixture tests (`server/indicators.test.ts`) |
| B — P0/P1 computation, APIs, cache | Done | 14 service tests (`server/indicators.service.test.ts`); live API on 31 Polymarket + Kalshi contracts; acceptance #16 |
| C — overlays, multi-series tooltip, watchlist, preferences | Done | Browser: light/dark, desktop, 375 px; acceptance #17 |
| D — Telegram scheduler + durable gaps, unified feed, unread state, Sources view | Done (SSE not built; polling) | Fault tests with a fake t.me (gap open → not cleared by newest poll → recovered); 7 feed tests; live scheduler runs; acceptance #18 |
| J2 — persisted cadence / request budgets, no double scheduling | Done | Feed/config tests, lease tests incl. orphan takeover, budget tests; acceptance #19 |
| E — Polymarket wallet activity (bounded pilot) | Done (pilot) | 10 wallet tests on **real captured v2 responses** + a fake v2 API; live collection 2026-10-09 (below); acceptance #20 |
| F — in-app alerts + new acceptance run | Done | 4 alert tests (transitions, re-arm, cooldown, stale/backfill/seed suppression); one live alert observed; acceptance #21 → `ACCEPTANCE_REPORT_v2.md` |
| G — RSI/MACD/Bands, CFTC COT | Not started (optional, must not block) | — |
| H — claim/evidence review, link benchmark, language corpus, verified pairs | H1 done (tooling, 9 research tests, acceptance #22/#24); H2–H4 pending reviewers | — |
| I — ACLED / NGA | I2 connected after a successful retry (documented public endpoint, real fixture, 3 tests, live smoke test); I1 ACLED still gated on credentials | `server/nga.test.ts`; live: 20 warnings |
| J1 — vessel types, reviewed reference assets | Done | `server/maritime.test.ts`; `docs/review/asset_review.csv` |
| K — maritime directory (K1), AIS pilot (K2/K3) | K1 done; K2/K3 need a user-configured AISstream key | `server/maritime.test.ts`; acceptance #25 |
| L — Research Workspace (separate plan) | Done W0–W6 | see RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md; acceptance #23 |

## 2. Definitions and versions

- **Indicators `ind-1.0.0`** (`shared/indicators.ts`): hourly representative = final real sample of each completed UTC hour; gap > 90 min breaks continuity; SMA/EMA over N consecutive hourly samples (EMA α = 2/(N+1), seeded by the first N-SMA); `change = 100 × (p_latest − p_ref)` measured between completed-hour samples (1h ref tolerance 15 min, 24h tolerance 2 h, latest ≤ 2 h old); hourly-move baseline = up to 168 prior adjacent-hour pairs (≥ 48), type-7 median/P95; PortWatch vs mean of the preceding 28 calendar days (≥ 24 valid, current excluded); FRED vs previous published observation, SMA reset on > 7-day gaps; OpenSky/IODA observed change only (no anomaly baseline before 14 days). Nulls always carry a status (`ok | warming_up | stale | gap | unsupported`) and a reason.
  - Design decision: hourly change uses completed-hour samples, not the provider's trailing "price at fetch time" point (that point is off-grid and put every contract outside the 15-min tolerance). The live quote is shown separately.
- **Alerts `alert-1.0.0`** (`server/alerts.ts`): level rules (hourly move > k × own P95, |24h change| ≥ pp, source failing) open only on an *observed* normal → abnormal transition, stay one record while abnormal, are marked recovered on a normal reading and re-open the same record within the cooldown. Event rules (large trade, watched-wallet trade) fire only for rows first collected by an incremental poll within 2 h of the trade, grouped per target per cooldown window. Stale/gap/warming-up inputs and seed mode never fire.
- **Wallet facts (Polymarket data API v2, measured 2026-10-09)** — recorded in `server/wallets/parse.ts`:
  - Rows have no unique id → identity = SHA-1 of (tx, wallet, token, side, size, price, ts) + occurrence ordinal; 13 of 500 activity rows of one wallet shared a transaction hash.
  - `size` = shares, `price` = USDC/share; activity rows carry `usdc_size`.
  - `/v2/trades` defaults to taker-only; for one high-volume wallet over one hour, taker-only returned 8 rows vs 260 with `taker_only=false`, and `/v2/activity` TRADE rows were identical to the maker-inclusive set. Market tape therefore uses taker-only (each fill once); watched wallets use `/v2/activity`.
  - **A cursor does not carry the query's filters** — a cursor-only request returns the global feed. Every page repeats the filter, and off-filter rows abort the walk.
  - Unknown parameters are silently ignored (e.g. `period=week` → day). Leaderboard parameters (`time_period`, `order_by`, `category`) are verified from the cursor echo; a mismatch stores nothing.
- **Collection settings** (`server/sourceconfig.ts`): per-source interval/budget bounds, versioned, persisted; ±5 % deterministic jitter; budgets sized from measured usage (e.g. Polymarket 44/250, Kalshi 137/250, FCDO 14 pages → 32).

## 3. Changed and added files

Server: `shared/indicators.ts`, `shared/types.ts`; `server/indicators/{service,routes}.ts`; `server/{versions,sourcehealth,sourceconfig,sourcejob,scheduler,lease,runlog,feed,sourcesapi,tgscheduler,alerts}.ts`; `server/wallets/{parse,store,collect,analytics,routes}.ts`; edits to `server/{db,index,ingest,http,registry}.ts`, `server/sources/{rss,telegram,polymarket,kalshi,sensors}.ts`.
Client: `src/{api,store,format}.ts`, `src/App.tsx`, `src/styles.css`; components `ProbChart`, `IndicatorControl`, `WatchlistBar`, `RightPanel`, `SensorPanel`, `StatusBar`, `FeedView`, `SourcesView`, `WalletsView`, `AlertsView`.
Tests: `server/{indicators,indicators.service,feed,wallets,alerts}.test.ts` (new), `server/{core,fault}.test.ts` (extended). Fixtures: `server/fixtures/polymarket_v2_*.json` (real responses, profile fields removed).
Tooling: `scripts/acceptance.ts` (criteria 15–21, `--out`, runs on a DB copy), `package.json` (`npm run check`), `tsconfig.json` (now type-checks `scripts/`), `.claude/launch.json`.

## 4. Verification actually run (2026-10-09)

| Command | Result |
|---|---|
| `npm run typecheck` | clean (now includes `scripts/`) |
| `npm test` | **121 / 121 pass** (indicators 13, service 14, core 36, fault 19, feed 7, wallets 10, alerts 4, research 9, maritime 4, review 2, NGA 3) |
| `npm run acceptance` | **25 / 25 pass** → `docs/ACCEPTANCE_REPORT_v2.md` (the first run's `ACCEPTANCE_REPORT.md` is kept unchanged) |
| `npm exec vite build` | succeeds; existing warning: one chunk > 1.5 MB (map + charts), not addressed |

Live checks (real providers, this date):
- Indicators on all open contracts; after replace-on-refetch and completed-hour measurement, `change_1h` ok for 30/31 Polymarket contracts.
- Telegram job on the shared scheduler polled `Middle_East_Spectator` every ~5 min (1 page per run when quiet); no gap opened live (gap logic verified on the fake server only).
- Wallet pilot: 8 default pilot markets (top Polymarket contracts by 24h volume), 2,400 trades on the first sync (3 pages each, 24/30 requests), holders 8/12, leaderboard 2/4 with parameters confirmed by cursor echo. The watched-wallet path was verified on a **scratch copy** of the database (122 activity rows incl. maker/taker rebates and a redemption; immediate re-poll inserted 0; complete position snapshot) so the user's watch list was not changed — it starts empty by design.
- Alerts: a real "Data source failing" alert opened once when Press TV moved from ok to a timeout.

Screenshots (`docs/screenshots/`): `c1-dashboard-watchlist-light.jpg`, `c2-overlay-tooltip-light.png`, `c3-dashboard-dark.jpg`, `c4-mobile-375px.jpg`, `d1-feed.jpg`, `d2-sources.jpg`, `e1-wallets-dark.jpg`, `e2-chart-large-trades-dark.jpg`, `e3-large-trade-tooltip.png`, `f1-alerts-dark.jpg`, `f2-alerts-mobile-light.jpg`.

## 5. Defects found during verification and fixed

1. **Earlier draft of packages E/F replaced.** A previous draft of `server/wallets.ts` inserted invented trades (made-up transaction hashes and sizes attributed to real addresses) and seeded watched wallets with editorial labels; it also keyed trades on (tx, token, side, ts, ordinal) with INSERT OR REPLACE (rows of different wallets could overwrite each other), reported a fixed 100 % holder concentration and listed non-large trades as large. It never ran against the live database (verified: all wallet tables empty). Replaced by `server/wallets/*`; the draft alert engine (repeat-firing, no seed/stale suppression) by `server/alerts.ts`. Empty draft tables are dropped by a guarded migration.
2. **Cursor pages lost the market filter** (first live wallet run stored 1,576 global-feed trades) — fixed as described in §2; affected rows and coverage records purged and re-synced; the test fake now behaves like the real API.
3. **Feed cursor truncated to 120 characters** — "Load older items" failed whenever an external id was a long URL; fixed with a regression test through the HTTP layer.
4. **Orphaned leases after a dev-server restart** blocked the ingest cycle for up to 30 min; leases of dead local processes are now taken over and all leases are released on SIGINT/SIGTERM.
5. **Budget stops swallowed by per-item error handling** (FCDO fetched 12 of 14 countries while reporting success) — now labelled partial; multi-page adapters got measured budgets.
6. Large-trade chart markers did not render (ECharts `ScatterChart` not registered); axis labels collided at the edges; a Jerusalem Post item stamped 3 h in the future is now placed at collection time with the publisher's value kept and labelled.

## 6. Unfinished work and blockers

- **Not started:** G (optional RSI/MACD/Bands, CFTC COT — a separate later delivery per the plan). H2–H4 kits are ready and need named reviewers. L is done with its own report.
- **Human-dependent (pending):** verified Polymarket–Kalshi pairs, independent link benchmark labels, Arabic/Persian native review, claim assessments.
- **Access-gated:** ACLED (credentials + real sample), AISstream (user-configured key, server-side only). NGA is now connected (its ASAM endpoint is not in the documented public API; navigational warnings are).
- **Known limits:** Telegram gap recovery verified on fixtures only (no live gap occurred); SSE not implemented (polling); wallet history is bounded (3 pages per market on first sync — coverage start is shown, earlier history is not implied); bundle-size warning.
