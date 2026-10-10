# Acceptance report

Generated 2026-10-09T11:00:40.675Z by `npm run acceptance` (Node v26.7.0). **14/14 criteria pass.**

Method and limits: criteria come from `docs/PLAN_3DAY_SUBAGENTS.md` §6 plus three added later (12–14). Checks are mechanical (API responses, database queries, source search, a simulated outage on a database copy, a seed-mode server). UI *labels* are verified by their presence in the source, not rendered pixels. This is the build's own harness, not an independent QA team, and passing it does not establish that the data are correct — only that the labelling and safety rules hold.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Dashboard loads with real contracts and real events | **PASS** | GET / → 200; 490 relevant events, 348 open contracts (polymarket + kalshi), 26066 history points |
| 2 | Every event has a source URL, publication time, tier and affiliation | **PASS** | 728 events checked, 0 incomplete |
| 3 | Re-running ingestion adds no duplicates; failures are isolated per source | **PASS** | second parse of 20 cached feeds inserted 0 items; simulated total outage: 34 sources recorded their own failure, 34 error rows, 5s |
| 4 | Stale/failed/blocked sources are visibly labelled and old data is retained | **PASS** | status labels present in StatusBar: STALE, FAILED, NOT CONNECTED, PENDING; 1 blocked source(s) each carry a reason; outage simulation lost rows in: no table |
| 5 | Each contract shows quote basis, bid/ask where midpoint, deadline and a rules link | **PASS** | 348 priced contracts: 0 without basis, 0 without deadline (informational), 0 without rules link, 0 midpoints lacking a two-sided book |
| 6 | Contracts are never averaged or merged; venues stay separate | **PASS** | 348 contracts, 0 duplicate ids; code search for price averaging: 0 hits; volume units match venue for all |
| 7 | Event→contract links show their evidence; events without a match show none | **PASS** | 569 links across 171 events, 0 without matched entities/topics; 557 events have no link (none invented) |
| 8 | Price context says "coincident, not causal"; no causal wording anywhere | **PASS** | 0 causal-wording hits; 2 caveat strings in UI sources |
| 9 | State-affiliated sources carry an explicit affiliation and are never Tier-1 | **PASS** | 7 state-affiliated sources in the registry (aljazeera-en:Tier-2, anadolu:Tier-3, france24-me:Tier-2, irna-en:Tier-3, presstv:Tier-3, aljazeera-ar:Tier-2, irna-fa:Tier-3); 185 Tier-3 events all carry an affiliation string |
| 10 | Approximate (country-level) locations are labelled approximate | **PASS** | 309 of 470 located events are country-level; "approx" labelling in 4 UI files (13 lines) |
| 11 | Demo seed is visibly labelled as seed, cannot refresh, and excludes Telegram text | **PASS** | demo server status mode=seed, refresh → 409, banner string in UI: true, Telegram tables in seed: false |
| 12 | Every sensor series names its provider, latest observation date, source link and caveat | **PASS** | 19 series with data (0 still empty); 0 missing provider/caveat/as-of |
| 13 | Telegram: every post links to its source, media is URL-only, no ML/LLM libraries touch it | **PASS** | 255 posts, 0 without URL; manifest lists 246 media URLs; media-download code hits: 0; ML/LLM imports: 0 |
| 14 | /api/health is machine-readable and reflects degraded sources | **PASS** | HTTP 200, status=degraded, 37 sources, 29 degraded |
