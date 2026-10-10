# War Tracker — evidence & provenance research desk for geopolitical events (local)

**What it is:** a research desk, not a terminal. It does not compete with a market-data terminal on charts or macro series. It keeps the chain *something happened → which contracts it touches → what the price did (coincident, not causal) → saved with its sources*, and every claim keeps its original text, versions and origin. The daily entry point is the **change briefing** (Research → Briefing, key `b`).

A local dashboard that puts **live prediction-market contracts** (Polymarket) next to a **normalised feed of real news/official reports**. Click an event → see its source text and link, the contracts that explicitly share its entities/topic, and the contract's probability curve with the event's publication time marked.

> Not a trading tool and not a verification engine. Events are **reported** claims; links between events and contracts are **relevance pointers**, and price context is **coincident timing, not causation**.

## Run

Requirements: Node ≥ 22.13 (built-in `node:sqlite`; developed on Node 26), internet access for live data.

```bash
npm install
npm run dev          # → http://localhost:5173
```

First start fetches everything (~20–30 s); the page shows cached data immediately on later starts and refreshes in the background (stale after 5 min, server timer every 10 min, **Refresh now** button for manual).

| Command | Purpose |
|---|---|
| `npm run dev` | Server + UI (Vite middleware) with live reload |
| `npm start` | Production build, then serve `dist/` |
| `npm run ingest` | One refresh from the CLI (prints per-source result, exit 1 if any source failed) |
| `npm test` | Unit and fixture tests (148): indicators, feeds/gaps, wallets, alerts, research, maritime, NGA, SSE, shortcuts, CSV export |
| `npm run typecheck` | TypeScript check (server, client, shared, scripts) |
| `npm run check` | typecheck + tests + production build in one go |
| `npm run smoke:sources` | Polite access test of candidate sources → `data/source_registry.json` |
| `npm run acceptance` | Automated acceptance matrix (25 criteria, on a copy of the database) → `docs/ACCEPTANCE_REPORT_v2.md` (`-- --out <file>` to change; the first run's `ACCEPTANCE_REPORT.md` is kept) |
| `npx tsx scripts/review-kit.ts …` | Human-review kits: link benchmark, Arabic/Persian corpus, cross-venue pair queue and approval gate — see `docs/review/README.md` |
| `npx tsx scripts/asset-review.ts export\|import` | Reference-asset review sheet and review trail (assets.json is edited by hand only) |
| `npm run reanalyze` | Recompute entities/topics/places/relevance for stored items after a rules change (no network) |
| `npm run replay -- <source_id>` | Re-parse the last cached raw response of a feed (parser-regression aid) |
| `npm run telegram:review` | Print Telegram↔news matches and misses for hand-checking |
| `npm run seed:export` | Snapshot the current database to `data/demo_seed.json` (real captured data; **not in the repository** — run the app live once, then export your own) |
| `npm run demo` | **Offline demo** on port 5174 from the seed — no network, clearly labelled *DEMO SEED — not live* |

Data lives in `data/tracker.sqlite` (git-ignored). Delete it to start clean. `PORT=5180 npm run dev` changes the port.

## What you see

- **Top bar** — health of every source: OK / STALE / FAILED / NOT CONNECTED with last success time (hover for details). A failed source keeps its previous data on screen.
- **Left (40 %)** — event feed, newest first. Each card: outlet, **publisher tier** (T1 official/major, T2 regional/specialist, T3 state-affiliated), age, headline, the *place named in the text*, topics, and how many contracts it links to. Filters: search, topic, tier, and "include filtered-out" (items the Middle-East relevance rule excluded, for auditing misses).
- **Map tab** — Leaflet with a bundled Natural Earth basemap (no tile server): event markers styled by location precision, plus curated static reference assets (Hormuz, East-West pipeline, Fujairah, Ras Laffan …) whose facts each cite a source and date (`data/assets.json`; unreviewed by a human).
- **Right (60 %)** — selected contract: probability, quote basis (midpoint or labelled last trade), bid/ask, volume, liquidity, deadline, link to the **resolution rules**; ECharts history with a red line at the selected event's publication time; below it the event detail (provenance, affiliation, source excerpt, link to the original, linked contracts with *why* they matched) or the full contract list.

## Data sources (live today, 36 connected)

- **Prediction markets:** Polymarket (Gamma + CLOB) and Kalshi (public API) — separate venues, never merged.
- **Official:** EASA conflict-zone airspace bulletins · UK FCDO travel-advice change log (per country, to the minute) · US Treasury OFAC recent actions (date-only) · UK OFSI notices · UN News · UN Press.
- **Maritime:** NGA broadcast navigational warnings for Middle East waters (official public API; standing-hazard context — the newest in-force warning was issued May 2024) · Maersk Middle-East advisories (single-carrier scope) · gCaptain · Splash247 (trade press) · **advisory emails you are entitled to receive**, dropped as `.eml` into `data/inbox/` (see `docs/UKMTO_ACCESS.md`).
- **Wallet activity:** Polymarket data API v2 (public, no key) — pilot markets' trade tape, watched wallets, holders, leaderboard.
- **Sensors (series, not news):** IMF PortWatch daily chokepoint transits (Hormuz, Bab el-Mandeb, Suez, Cape of Good Hope — the data family Kalshi's Hormuz contracts settle on) · FRED Brent/WTI spot · OpenSky air-traffic counts (our own series) · IODA internet-routing visibility (Iran, Israel, Lebanon, Yemen, Iraq, Syria).
- **News:** BBC · Guardian · NYT · Sky · France 24 · Al Jazeera (EN + Arabic) · Middle East Eye · Jerusalem Post · Amwaj · OilPrice · Anadolu, IRNA (EN + Persian), Press TV (state-affiliated, Tier-3) · Google-News headline discovery (publisher sets the tier; headline + link only).
- **Social (viewpoint-labelled):** Telegram public channel *Middle East Spectator* — see `docs/TELEGRAM.md`.

Not connected, with reasons: UKMTO, ACLED, ReliefWeb, ISW/Critical Threats, Stooq (blocked), UCDP/HAPI (need credentials), CENTCOM (unreachable from this machine), GDELT (rate-limits this connection), Reuters/AP (no free feed). See `docs/PLAN_3DAY_SUBAGENTS.md` §3 and `data/source_registry.json`.

## Destinations (five; keys 1–5, `b` for the briefing)

- **Monitor (1)** — the workflow in one place: items (left) → the contracts the selected item touches (strip above the chart) → price around publication with the dashed publication line → save to a dossier / add a note (Selected event tab). The contract picker, quote details and **Chart options** (overlays, optional RSI/MACD sub-plots, axis, large-trade markers, all off or minimal by default) sit behind disclosures. List filters are one **Filters** disclosure.
- **Feed (2)** — one stream over news, official, maritime and Telegram items (stable identities, keyset paging, "N new items" without moving the list, unread marker). Second tab: **Telegram analysis** (overview charts, entity network, places map, per-post cross-check against news, media manifest export).
- **Markets (3)** — Polymarket public data API (bounded pilot): large trades on pilot markets with the screening criterion they met, top holders (no concentration % without a denominator), watched wallets (empty by default; a wallet address is not a person), coverage and gaps.
- **Research (4)** — **Briefing** (default tab), dossiers (timeline, revisions, attributed claims with evidence and review history, checklist), hypotheses (invalidation conditions, reviews tied to evidence versions), upcoming contract dates (list + month grid), coverage, places, vessels.
- **Sources & alerts (5)** — every collector (collection vs data age vs next attempt, editable cadence and request budget, Telegram allowlist, gaps and lag), and in-app alerts (open on a normal → abnormal change, re-arm after recovery; stale/gap/seed inputs never fire).

Keys 6 and 7 still open Research and Sources for one release.

### Change briefing

`GET /api/briefing?hours=24` (or `since=last`), `/api/briefing.md` (download), `POST /api/briefings` (freeze a snapshot with its citations), `GET /api/briefings`. Built only by fixed rules from stored data — no model-written text, no score. Sections: what happened (story groups with outlets, tiers, independence groups, contracts touched), contracts that moved (≥ 5 pp over 24 h from stored history, or the venue-reported change labelled as such, or an hourly move above the contract's own P95; contracts that cannot be computed are counted with their reason), pinned sensors, alerts opened, large trades on pilot markets, research changes and checks due, contract dates in the next 7 days, and **what the briefing cannot tell you** (stale/failed sources, similarity-based grouping, link matches ≠ impact). Every line carries a numbered citation; the Sources list gives original URLs.

## Evidence rules the UI enforces

Quote basis shown (midpoint vs last trade) · volume in each venue's own unit · "coincident timing only" next to any price context · tier is a publisher prior, not a claim verdict · outlet count ≠ independent confirmation · approximate places labelled approximate · seed data labelled as seed.

## Honest limits

Locations are gazetteer matches in the text (country-level = approximate). Event time = publication time unless the text states a past day (then shown separately, day precision). Entity/topic extraction is English dictionary rules. Cross-outlet grouping exists; claim-level review exists but every assessment is a named person's judgment — nothing is corroborated automatically. Event↔contract links are lexical relevance pointers (measured quality in `docs/AGENT_LOG.md`). Feeds supply headline + excerpt only; the app links to the publisher for the full article. Arabic items preserve the original text and offer a machine English translation beneath the headline and excerpt; opening an Arabic item translates it automatically. Other cards offer a Translate to English button. Public news text is sent server-side to MyMemory, cached by source content hash, with a persisted 4,500-character daily UTC cap and no paid fallback. Translation is a reading aid and never changes entity matching or evidence assessments. Seed mode only reads cached translations and never calls the provider. Persian remains untranslated. Both languages are matched with a small hand-written dictionary that no native reader has verified.

## Plans

**`docs/PLAN_3DAY_SUBAGENTS.md`** (execution plan) · `docs/AGENT_LOG.md` (what was done/verified) · `docs/DEMO_RUNBOOK.md` · `docs/TELEGRAM.md` · `docs/UKMTO_ACCESS.md` · `docs/ACCEPTANCE_REPORT.md` · **`docs/UNIFIED_MONITOR_PLAN.md`** + `docs/INDICATOR_IMPLEMENTATION_REPORT.md` · `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md` + `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md` · `docs/ACCEPTANCE_REPORT_v2.md` · `docs/review/README.md`.
