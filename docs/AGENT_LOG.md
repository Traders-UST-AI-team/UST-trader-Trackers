## Repository clean-up (2026-10-10)

Old planning/report files were moved to `docs/archive/` and later deleted at the owner's request (still in the first Git commit); the empty `data/tracker.db` was removed. Before publishing: no secrets or personal data found in the tree; live databases, the demo seed, review kits containing third-party text and screenshots are excluded by `.gitignore`. Regenerate the demo seed with `npm run seed:export` after a live run.

## Session 7 (2026-10-10, HK) — evidence-desk positioning, change briefing, UI migration

The owner chose the positioning "evidence & provenance research desk" (not a Bloomberg-style terminal) and asked for the workflow *happened → touches → price → save* and a cited, exportable daily briefing.

- **Change briefing** (`server/briefing.ts`, `shared/briefing.ts`, `src/components/research/Briefing.tsx`): rule-built, every line cited, stories grouped with independence groups, contracts that moved (history-based or venue-reported, labelled), sensors, alerts, research changes, upcoming dates, limits. Markdown download, browser print (print stylesheet), frozen snapshots and "since last saved". 6 tests in `server/briefing.test.ts`; acceptance criterion #29.
- **UI migration** per `docs/UI_REDESIGN_SPEC.md` (progress table in §11). The design itself came from an Opus agent after research of public product docs (sources in the spec); the first canvas was rejected as too cluttered and replaced.
- **Verified:** `npm run check` 148/148, `npm run acceptance` 29/29, browser pass on live data (briefing, Monitor dark, Sources & alerts at 375 px light).
- **Findings:** most stored contracts have no stored price history (history is fetched when a chart opens), so the briefing falls back to the venue-reported 24h change and says so; 22 of 33 touched contracts had no computable change at test time. The project folder was renamed from `Traders War Tracker` to `Traders Tracker` mid-session (not by the agent); old path mentions in earlier log entries and in the temp handoff file refer to the old name.
- **Trial setup (same day), later shelved:** an automatic morning snapshot job (`briefing-daily`; now **off by default**, switch on in the Briefing tab) and `BRIEFING_TRIAL.md` (removed) (daily questions and log). The owner decided not to run the trial for now.
- **Not done:** equity sentiment and FOMC text diff (scope decision pending), CFTC COT, `RightPanel` split, Markets contract-detail route, self-hosted fonts.

## Session 6 (2026-10-10, HK) — independent verification of the delegated work

Re-check of the previous agent's report: `npm run check` gives a clean typecheck, **138/138** tests and a production build with split vendor chunks (`vendor-react`, `echarts`, `leaflet`). `docs/ACCEPTANCE_REPORT_v2.md` shows 28/28 (generated 2026-10-10 02:58 UTC); the original `docs/ACCEPTANCE_REPORT.md` is untouched. Confirmed in code: SSE (`server/stream.ts`; it only nudges clients with `alerts`/`refresh`, polling stays the source of truth), keyboard shortcuts, toasts, clipboard fallback, and CSV export where gaps and warm-up are empty cells, never 0. Not re-checked: rendered UI in a browser. Stale docs fixed: plan rows D and L, research report W4, README test count.

**Package G started (same day, at the user's request).** `shared/indicators.ts` gained `rsiSeries`, `macdSeries`, `bollingerSeries` (definition version bumped to `ind-1.1.0`; existing formulas unchanged); `server/indicators/service.ts` registers `rsi14`, `macd`, `bollinger` as optional, non-default indicators. Expected values in `server/indicators.test.ts` come from a separate plain-Python implementation; the RSI case also tracks the published 20-close worked example (≈0.07 lower because the published closes are rounded to 2 dp). Checked on a copy of the live DB: a Kalshi contract with a recent hourly gap correctly returns `gap` with a reason, never a number. UI added the same day: `src/components/SubPane.tsx` (RSI/MACD sub-plots sharing the main chart's window), Bollinger as an overlay, `panes` in saved prefs, CSV columns per pane unit; checked in the browser against live data (prefs restored afterwards). Not done: CFTC COT. 143/143 tests. Tests that used `rsi14`/`macd` as examples of unregistered ids now use `atr14`/`vwap`.

## Session 5 Review & Hardening (2026-10-10, HK) — Calendar month grid repair, SSE error isolation, and dynamic windowing

Rigorous review of Session 5 additions identified and corrected 5 defects:
1. **Calendar month grid disappearing on empty filter:** When search keywords or status/kind filters matched 0 items, the entire month grid and its navigation disappeared. Fixed by always keeping the month grid and navigation interactive, with a dedicated filter banner and clear button.
2. **Stale selected day across month navigation:** Selecting a day in one month (e.g., Oct 15) and navigating to another month (e.g., Nov) left the inspection drawer open on the stale date. Fixed by resetting or synchronizing selection upon month change.
3. **Other-month cell navigation:** Clicking preceding or trailing month days in the grid now shifts the active view to that target month and selects the date.
4. **Dynamic calendar query window for 2027–2030 entries:** Previously `api.calendar()` was called without parameters, returning only the default 90-day window and rendering 2027+ months empty despite >100 contracts in the database. `Upcoming.tsx` now dynamically queries the server for the window relevant to the viewed month and filter range (clamped within the 400d server limit).
5. **SSE stream socket error handling & graceful teardown:** Added `res.on('error')` and `req.on('error')` handlers in `server/stream.ts` to prevent unhandled socket reset crashes, added `closeAllStreamClients()` wired into `server/index.ts` shutdown hooks, and enhanced `src/App.tsx` to refresh status on `connected` and stabilize EventSource lifetime.
6. **Leap year & UTC date purity:** Replaced local-timezone `Date` constructors in month arithmetic with timezone-independent UTC methods (`Date.UTC` + `getUTCDate()`). Added unit test in `server/research.test.ts`.

## Session 5 (2026-10-10, HK) — Calendar month grid, Server-Sent Events (SSE), and bundle optimization

Followed handoff document and unified monitor plan to resolve remaining unblocked gaps:
- **Calendar Month Grid:** Added interactive Month Grid to Research Workspace Upcoming (`src/components/research/Upcoming.tsx` + `src/styles.css`), featuring List vs Month Grid toggle, month navigation (prev/next/today), 7-column ISO weekday layout, day cells with event count and venue tags (PM, KALSHI, MAN), and an interactive day inspection panel for inspecting contracts, resolution rules, and editing manual events.
- **Server-Sent Events (SSE):** Built `server/stream.ts` with `/api/stream`, keepalive comments, and broadcast dispatch for ingest completion and alerts; connected client subscription in `src/api.ts` and `src/App.tsx` for immediate state refresh, keeping interval polling as a resilient fallback. Tested with `server/stream.test.ts`.
- **Bundle Optimization:** Added Rollup `manualChunks` in `vite.config.ts` splitting ECharts, Leaflet, and React vendor code, eliminating the 1.5MB+ bundle-size warning (largest chunk now ~758 kB minified / ~238 kB gzip).
- **Verification:** `npm run check` clean (TypeScript + 133/133 tests + build); `npm run acceptance` passes all 28/28 criteria.

## Frontend repair session — 2026-10-09 → 10, Hong Kong

User requested second-plan implementation, a desktop-first usable frontend, corrected charts/click flows, and English below Arabic news. Existing W0–W6 were inventoried before edits. Desktop stacking at 980px was reproduced and corrected; stale dossier choices after returning to Dashboard were reproduced and corrected. Full delivery/verification/limits: [FRONTEND_REPAIR_REPORT.md](FRONTEND_REPAIR_REPORT.md). Current checks: typecheck + 127/127 tests + production build; 26/26 acceptance. QA writes stayed on a SQLite copy. Existing source-data/reviewer/AIS gates and deferred backlog were preserved.

# Agent log — what was done, what was verified, what was not

Newest first. "Verified" means I ran it and looked at the output; "not verified" is stated explicitly.

---

## Session 4 (2026-10-09, HK, evening) — Unified monitor plan + research workspace

Plan: `docs/UNIFIED_MONITOR_PLAN.md` (packages A–L) and `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md`. Details and evidence: `docs/INDICATOR_IMPLEMENTATION_REPORT.md`, `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md`, `docs/ACCEPTANCE_REPORT_v2.md` (25/25), `npm test` 121/121.

- Done: A–F, J2 (indicators, overlays/watchlist, Telegram scheduler with durable gap recovery, unified feed, Sources view, persisted cadence/budgets with leases, Polymarket wallet pilot, transition-based alerts), H1 claim review, L W0–W6, J1, K1, I2 (NGA connected after a successful retry).
- Replaced an earlier draft of the wallet/alert code that inserted invented trades (made-up tx hashes attributed to real addresses) and seeded editorial wallet labels; it had never run against the live DB (wallet tables were empty).
- Real defects found by live/browser verification and fixed: v2 cursors drop query filters (1,576 global-feed trades stored on the first run — purged and re-synced); feed cursor truncated at 120 chars; orphaned leases after dev restarts; budget stops swallowed by per-item error handling (FCDO 12/14); ECharts scatter not registered; invalid date-format options crashing Upcoming; several narrow-layout overflows.
- Pending: H2–H4 human review (kits in `docs/review/`), I1 ACLED credentials, K2/K3 AISstream key, optional G.

---

## Session 3 (2026-10-09, HK) — Days 2–3 residuals from the plan

### Built and verified (live data, tests, browser checks)

| Plan item | Result | Evidence |
|---|---|---|
| EASA conflict-zone bulletins (new official source) | Parses the CZIB table (number, subject, status, issue/revision/valid-until) and fetches EASA's own description for recent active Middle-East bulletins; 9 current items (Saudi Arabia, Iran, Iraq, Jordan, Lebanon, Syria, Yemen, Persian Gulf, plus a recently withdrawn one) | real-page fixtures + test; live ingest |
| Event ↔ asset linking (Agent G) | Only two relation types: *explicitly named* and *same reported location*. 67 of 444 events link, almost all via "Hormuz" (the other assets are rarely named). Company relationships shown only when cited; the UI says "no sourced relationship on file" otherwise. Cytoscape event→asset→company graph | test; screenshot |
| Energy & shipping focus (relevance tier) | `focus_energy_shipping` flag + scope filter; 134 of the 400 loaded items are in focus | browser check |
| Reported event time | Conservative English cues only (yesterday, on/last weekday, explicit dated phrases; future constructions and anniversary references ignored); day precision; shaded "event day (as stated)" band. 59 of 411 relevant items (14%) carry one | 12 unit cases; I read ~18 live extractions |
| Persisted circuit breaker + `/api/health` | Opens at 3 consecutive failures, cool-down doubles to 6 h, survives restart, manual refresh bypasses; health = ok/degraded/down | tests; live endpoint; a real Press TV timeout in the clean run showed `degraded` correctly |
| Fault injection | 429→recover, 503 gives up, 403/404/406 never retried, hanging server times out, HTML-instead-of-XML and undated/truncated feeds fail safe, breaker semantics — against a real local HTTP server | `server/fault.test.ts` |
| Typed adapter registry (Agent A) | `server/adapters.ts`; a test fails if a registry entry names a missing adapter | test |
| Email drop-folder adapter (Agent C) | Generic `.eml` parser + per-sender tier profiles; end-to-end run on temp dirs; `docs/UKMTO_ACCESS.md` | tests; **fixture is synthetic** (stated in its headers) |
| Cross-venue counterparts (Agent B) | 14 of 348 contracts have text-similar candidates on the other venue, shown with rules excerpts and warnings; verified-pairs file ships empty | test; screenshot |
| Acceptance harness (Agents F/J) | `npm run acceptance`: 14 criteria, **14/14 pass**; also **14/14 from a clean copy** (fresh `npm install`, 41 tests, cold ingest of ~580 events, ~3 min) | `docs/ACCEPTANCE_REPORT.md` |
| Responsive layout | No horizontal overflow at 768 px and 375 px (dashboard and Telegram views); stacked layout readable | browser checks |
| Tests | **44 passing**; typecheck clean | CLI |

### Defects fixed after reading `docs/UNIFIED_MONITOR_PLAN.md`

Two planning documents appeared in `docs/` during the session that I did not write (`UNIFIED_MONITOR_PLAN.md`, `INDICATOR_TOOLS_RESEARCH.md`). They propose a **next phase** (unified feed, X pilot, alerts, indicator libraries; the research file says selection only, X excluded). I did **not** start that phase — it needs your decisions (accounts, budget, latency target). But the proposal's code review correctly named four defects in what I built; all four are fixed and tested:

1. A failing Telegram channel aborted the remaining channels' work in the same job → channels are now isolated (`ingestTelegramChannels`), per-channel `last_attempt_at` / `last_error` are stored, and the job fails only if *every* channel fails (fault test with a real local server, bad channel first).
2. The Sensors tab fetched only on mount → it re-reads after every completed ingest.
3. No channel picker → `/api/telegram/channels` plus a picker (shown when >1 channel is configured; with the single default channel it is hidden).
4. A catch-up that hits its 4-page cap was silent → it now sets a visible "possible coverage gap" note, cleared when a later run reaches stored posts (fault test).

Everything else in those documents (indicator formulas, baselines, watchlist, alerts, X) remains a proposal. Tests: **46 passing**.

### What went wrong and how it was caught

1. **Harness bugs, not product bugs:** my first acceptance run showed 2 FAILs because `tsx -e` rejected top-level `await` (so it "checked 0 feeds") and the label check counted lines instead of words. Fixed; I record this because "14/14" is only meaningful if the harness itself is checked — it still only checks labelling/safety rules, not data correctness.
2. **Event-time false positive:** "…set to join … on Saturday" was read as a past event because the future cue sat >40 characters earlier. Strong future cues now look across the whole sentence (regression tests added).
3. **Cross-venue test corpus too small:** the counterpart test failed until it used a realistically sized corpus; the cutoff was lowered from 0.50 to 0.45 after seeing real scores (0.66 for a plausible pair).
4. **HTML class case:** my first browser check missed the asset section because CSS uppercases headings; a reminder that those UI checks are approximate.

### Judgement calls and honest limits

- **Counterparts:** by my reading most proposed pairs are **not** equivalent (e.g. "Pahlavi lead Iran" vs "who will head Iran — Pahlavi"; "Hormuz traffic normal" vs "transit calls > 60"). A few are plausible ("US embassy Damascus/Syria reopened", "Pahlavi enter/visit Iran") but I have not verified any and did not mark any verified — verification must be a named person's check of outcome, deadline/time zone and resolution source.
- **Asset linking** is dominated by Hormuz; the 9-asset reference set is small and unreviewed by a human. "Linked" never means damaged or disrupted.
- **Event time:** day precision only; English only; unevaluated against labels (I read a sample); 86% of items state no event time and stay unknown.
- **Focus tier** is a dictionary rule, not a classifier; borderline items exist.
- **Email adapter:** I do not know that UKMTO offers email alerts or what its sender domain is; nothing UKMTO-specific is assumed. An empty inbox is reported as a quiet source.
- **Acceptance harness** is not independent QA and does not validate link precision, translation quality, or any extracted value.
- Press TV is flaky (timed out in one of two clean runs); it is a reminder that "34/36 OK" is a point-in-time reading.

### Still not done (from the plan)

ACLED adapter (needs a key and a real sample) · claim-level `claim_status` transitions · independently-labelled benchmark (≥100 pairs) · native-reader evaluation of Arabic/Persian · translation runtime (open decision) · NGA/ASAM adapter (unreachable from this machine) · vessel-type extraction · persisted per-source rate-limit settings in the UI · Kalshi/Polymarket verified-pair divergence chart (needs a verified pair first).

---

## Session 2 (2026-10-09, HK) — new sources, sensors, Telegram, Days 2–3 residuals

### What was added (all run live and visually checked unless noted)

| Area | Result | Evidence |
|---|---|---|
| Source research | 30+ candidates probed; findings in `docs/PLAN_3DAY_SUBAGENTS.md` §3.3 and `data/source_registry.json` | `npm run smoke:sources` |
| New feeds | France 24, NYT ME, Sky (filtered), Amwaj, IRNA EN, Press TV (URL-dated, date-only), Al Jazeera Arabic, IRNA Persian, gCaptain, Splash247, OilPrice, UK OFSI, **US Treasury OFAC**, **UK FCDO travel-advice change log**, 4 Google-News headline queries (publisher sets tier) → **34 connected sources, 0 failing** on a forced run | `npm run ingest -- --force`; 602 events stored (432 relevant); 0 events missing URL/time/title |
| Sensors | PortWatch (Hormuz, Bab el-Mandeb, Suez, Cape of Good Hope; total + tanker), FRED Brent/WTI, OpenSky (3 boxes, our own series), IODA (6 countries) → 19 series / 2,406 points; Sensors tab with provider/as-of/caveat per panel | screenshots; `/api/sensors` |
| Telegram | Collector (public preview, 1.5 s spacing), rule-based analysis, cross-check, overview charts (ECharts), entity network (Cytoscape), places map (Leaflet), post detail, media manifest (JSON/CSV), 255 posts over 8 days | screenshots; fixture parser test; `docs/TELEGRAM.md` |
| Resilience | per-source cadence guard (failed sources retry every cycle), atomic per-source batches, raw-response cache + `npm run replay`, compact health summary UI | tests; UI check |
| Analysis | Contract-specific "typical hourly move" context; dateline stripping; Arabic/Persian dictionaries; `npm run reanalyze` | tests |
| Tests | **28 passing**, typecheck clean | CLI |

### Mistakes I made and caught (so you know where to look harder)

1. **Registry wipe:** a slice-and-replace edit silently deleted 14 sources I had just added. A test failure caught it; I restored them and added a registry-integrity test.
2. **Event-ID collision:** FCDO's several log entries per country share a URL/date, so IDs derived from URL collided and the whole source failed. IDs now derive from the item's own external ID, and each source batch is stored atomically.
3. **Telegram cross-check false positive:** "US Embassy Jerusalem security alert" matched "Riyadh airport alert" on shared country names + the word "alert". Fixed by requiring ≥2 shared non-entity words for a *strong* match, with weaker similarity shown as "weak" and not counted. Regression test added.
4. **Cross-check "no match" inflation:** most "no match" results were a coverage artifact (news feeds span only a few days). The assessed window is now the last 48 h.
5. **Dateline contamination:** IRNA's "Tehran-IRNA-…" prefix placed an unrelated nature story in "Iran/Tehran". Datelines are stripped before extraction (test added).
6. A sign error in the lead/lag calculation (would have flipped "Telegram first" and "news first") was caught during chart design.
7. An article title I wrote from memory in the asset file (session 1) was already caught; no new unsourced facts were added this session.

### Link-rule benchmark, updated (labels are mine; read with caution)

Wider data (34 sources) with the same rule: **v3 precision 0.81 / recall 0.90 over 58 labelled pairs (29 positive, 29 negative; 15 more excluded as ambiguous; v1 baseline 0.55 / 1.00)**. The three new `holdout-3` negatives (e.g. "Strait of Hormuz crisis fuels Cairo's plastic recycling" → "Will Hormuz traffic return to normal?") show the same failure mode as before: shared entity + topic without shared substance. The earlier caveat stands: roughly half of links are clearly relevant, a few clearly wrong, the rest borderline.

### Telegram: decisions and open risks

- **Terms:** §1.5 restricts AI/ML use of Telegram platform data and points to a policy I could not read; whether the public preview is covered is unestablished. I therefore: collect only the public preview at low rate, use **no model of any kind** on the text (dictionaries, regexes, counting, TF-IDF similarity), download **no media** (manifest of URLs only), and **exclude Telegram text from the demo seed** by default. Your later video analysis with other models is *your* decision under those terms — please read them first.
- Cross-check quality is unmeasured beyond hand inspection (~30 pairs). 5 of the 42 assessable posts from the last 48 h have a strong news match (6 including weak); a large share of the channel's fast OSINT claims has no counterpart in our slower news feeds, which is expected and not evidence of anything.
- Only 4–5% of claim posts name a source by my rules — a floor, not a finding about the channel.
- The channel states its own bias; the UI shows that statement verbatim and labels it a viewpoint-labelled discovery source.

### Not verified / not done

- Arabic/Persian dictionaries: written by me, **no native reader has checked them**; precision/recall unmeasured. One Persian item was wrongly "relevant" before the dateline fix; others may exist.
- The new feeds' relevance filter (any ME entity) is generous: regional, non-energy items pass (e.g. Egyptian protests). Use the topic filter; an energy/shipping-only relevance tier is still not built.
- OpenSky's anonymous quota and IODA's aggregation method were not verified against their documentation.
- NGA maritime warnings/ASAM (best UKMTO substitute) are unreachable from this machine — retry on another network. GDELT is intermittent. ISW/Critical Threats blocked. UCDP/HAPI need credentials.
- No clean-checkout run of the full acceptance matrix; mechanical spot checks only. Dark-mode check of the Telegram view and Sensors tab was done at one viewport size.
- Persisted circuit-breaker state across restarts is not built.
- Telegram view in demo-seed mode shows an explanatory message (verified in code path, not screenshotted).

---

## Session 1 (2026-10-08 → 09, HK) — Day 1 shipped, parts of Day 2 started

### Verified working (evidence in parentheses)

| Area | What | Evidence |
|---|---|---|
| Polymarket | Gamma discovery by Middle-East tags + entity-filtered `geopolitics`/`military`; open contracts only (not closed, accepting orders, not past end date, some liquidity); CLOB hourly history (fallback 360/1440 fidelity) | 243 events → 200 contracts per refresh; ~21k history points; screenshot of chart |
| Kalshi | Unauthenticated public API: Middle-East series discovery (cached 6 h) → open events → contracts; candlestick history | 148 open contracts (Hormuz transit-call contracts on IMF PortWatch, Qatar LNG, Saudi/Iran crude, OFAC, normalisation…); ~8k history points; screenshot |
| News/official feeds | BBC ME, Guardian ME, UN News ME, UN Press (global→filtered), Al Jazeera EN (global→filtered), Middle East Eye, Jerusalem Post, Anadolu (Tier-3 state) | live ingest; per-source counts in `/api/status` |
| Maritime | Maersk Middle-East advisories (listing + article metadata; robots.txt checked — `/news/articles/*` allowed); revisions tracked via `dateModified` | 2 live items, both revised after publication; real-fixture tests |
| Persistence/idempotence | SQLite; second ingest adds 0 duplicates | unit test + live re-runs (`0 new`) |
| Failure behaviour | Simulated total network failure on a DB copy: every source records its own error, 0 rows lost; circuit breakers cap outage at ~26 s (was 106 s before breakers) | `scratchpad/offline.mts` run |
| Quote convention | midpoint only if both sides valid (bid>0, ask<1, ask≥bid), else labelled last trade, else none; never 0 | unit tests (both venues) |
| Story clustering | Cross-outlet grouping (TF-IDF + average-linkage, ≥1 shared entity, ≤48 h, different outlets) with explicit "not verification" wording | reviewed real clusters by eye; unit test |
| Link rule | event↔contract: contract-entity coverage + shared topic + IDF-weighted distinctive-term coverage ≥ 0.35 + contract existed at publication | see "Link precision" below |
| UI | 40/60 split, source-health pills, venue badges + units, history-basis caption, publication marker, coincident-timing note, per-panel error boundaries | screenshots in browser pane |
| Map | Leaflet + bundled Natural Earth basemap (no tile server); events grouped per named place with precision styling; 9 reference assets, 5 company relations from cited pages | screenshots; `data/assets.json` |
| Demo fallback | `npm run seed:export` → `data/demo_seed.json` (4 MB, real data); `npm run demo` loads it offline with a "DEMO SEED — not live" banner, refresh disabled | ran it; `/api/status` mode=seed |
| Production path | `npm start` builds and serves `dist/` | ran it on port 5175 |
| Tests | 16 passing (`npm test`); `npm run typecheck` clean | CLI |

### Link precision — read this before quoting any number

Benchmark: `server/fixtures/link_benchmark.json` (labels are mine, not an independent expert's).

| Rule | Set | Result |
|---|---|---|
| v1 (any shared entity + topic) | all labelled (n=52) | precision 0.55, recall 1.00 |
| v3 (current) | all labelled | precision 0.88, recall 0.88 — **but dev + holdout-1 were used to design/tune it** |
| v3 | dev only | P 1.00 / R 0.89 (n=9) — tuned on this |
| v3 | holdout-1 | P 0.71 / R 0.71 (n=7) — used to find failure modes, so contaminated |
| v3 | **holdout-2 (never used for tuning)** | of 21 links sampled: **10 clearly relevant, 1 clearly wrong, 10 borderline** |

Honest summary: roughly half of displayed links are clearly relevant, very few are clearly wrong, and the rest are plausible context (e.g. Saudi–Houthi war stories → the broad "Saudi troops fighting in Yemen" contract). Lexical matching cannot separate "same war" from "same development"; known residual false positives: "USS Lincoln returns after Iran war" → "Will the U.S. invade Iran?", "oil prices jump" → "Iran crude production". The UI therefore calls these *relevance pointers* and shows the matched entities/topics. A larger independently-labelled set (≥100 pairs) is needed before claiming a precision figure.

Process lesson recorded: the first rule scored 1.00 on its dev set and ~0.3 on a fresh sample. Always sample new pairs after a rule freeze.

### Not verified / not done

- **No browser check in dark mode or at tablet/phone widths** (styles exist; unchecked).
- Kalshi: only the first 25 contracts per refresh get history eagerly; others load on click (tested for a few, not all 148). Kalshi `previous_price` semantics unverified, so 24h/7d change is derived from history instead.
- Maersk: only 2 items so far; robots.txt allows the pages but the site's terms of use were **not** read — confirm before relying on it beyond the demo.
- Story clustering: tuned by eye on ~130 items; no labelled set yet.
- Locations: gazetteer ≈60 places, English only. Not evaluated against a labelled set.
- Arabic/Persian feeds: parse OK in the smoke test but **not enabled** (relevance dictionaries are English).
- Map: checked visually in light mode only; popups tested for one asset and one event group. Dark-mode map colours are defined but not eyeballed. Leaflet marker overlap near Yemen/Gaza is handled by grouping per place, not by collision avoidance.
- Seed/demo mode: verified loads, serves history from the seed, refresh returns 409, zero ingest activity in the log. **Not** verified with the network physically disabled (relies on the code path never calling out).
- Cold start from an empty DB: ~70 s to fill; page auto-populates (verified once).

### Blocked sources (not bypassed) — human actions needed

| Source | Result | Needed from you |
|---|---|---|
| UKMTO | 403 to scripted requests | Ask UKMTO for data access / email advisories (see `docs/PLAN_3DAY_SUBAGENTS.md` §7) |
| ACLED | 403 without credentials | Register for API access; put key in `.env` |
| ReliefWeb | 406 "Blocked due to bot activity" for Node requests | Request an approved appname (hdx@un.org) |
| GDELT | 429 even on first spaced request | Retry later from a different network; documented limit ≈1 req / 5 s |
| CENTCOM, IMO | connection failures from this machine | Retry on another network |
| Times of Israel, Arab News, State Dept | 403 / Cloudflare challenge | none (not bypassed) |
| Press TV | feed has no per-item timestamps | design decision: date-only precision from URL (Day 2 Agent A) |
| Reuters / AP | no free public RSS | licensed feed or accept BBC/Guardian as Tier-1 proxies |

### Decisions I made that you may want to reverse

1. Tier assignment (publisher prior): BBC/Guardian/UN = Tier-1; Al Jazeera, MEE, JPost, Maersk = Tier-2; Anadolu = Tier-3 (state). Al Jazeera is state-funded but kept Tier-2 with the affiliation shown; arguable.
2. A "story" never changes `claim_status` (all items stay `reported`). I did not implement `corroborated` because outlet similarity ≠ independent verification.
3. Polymarket scope: Middle-East tags + entity-filtered broad tags. This includes contracts about Israeli ministerial appointments etc. (political, not energy/shipping). A relevance tightening for energy/shipping specifically is not done.
4. Volumes are shown in each venue's own unit (USD vs contracts) and never summed.
5. Ran with Node 26's built-in `node:sqlite` (prints an experimental warning on some Node versions) instead of a native SQLite package, to avoid build tooling.

### Reference-asset curation (map) — what was and was not supported

Read via page-fetch summaries (not human-verified): EIA Hormuz article (2025-06-16), EIA Red Sea chokepoints article (2023-12-04), ADNOC Pipelines "who we are", QatarEnergy LNG corporate-structure page, plus a search-result summary for Ras Laffan (QatarEnergy industrial-cities page).

Things I wanted but could **not** support and therefore left out: Kharg Island/other Iranian terminals (EIA Iran page returned only site navigation), Aramco annual-report facts (PDF exceeded the 10 MB fetch limit), ADCOP capacity/origin from ADNOC's own page (not stated), the LNG ventures' location on the QatarEnergy LNG page (not stated; the Ras Laffan link for the equity relations is therefore flagged *inferred*), and any claim about current operating status. One article title I initially wrote from memory was caught and replaced with "title not captured". Coordinates come from general public geography, not the cited sources, and are labelled approximate.

### Acceptance-matrix spot checks run (2026-10-09; mechanical, against the live API)

- #2 every event has URL, publication time, tier and affiliation: 177/177 events complete (Tier-1: 80, Tier-2: 67, Tier-3: 30).
- #5 every market with a price has a quote basis (348/348; 200 Polymarket in USD, 148 Kalshi in contracts).
- #6/#8 wording audit: no causal wording in UI/server strings; no price averaging anywhere (story clustering uses text similarity only).
- #9 state-affiliated sources are Tier-3 with an affiliation string (Anadolu, Press TV[disabled]).
- #10 location quality: of 115 events with a place, **75 (65%) are country-level centroids** — i.e. most map markers are approximate and drawn dashed; 62 of 177 stored events have no place at all. Weak spot for any "where" claim.
- Dark mode: checked page + map; map land contrast was too low and was raised. Light mode checked earlier.
- NOT run: #3 two-run duplicate check on live data after the final code (covered by unit test and earlier live runs), #4 fault injection against the final build (earlier simulation only), #11 seed banner in light mode.
