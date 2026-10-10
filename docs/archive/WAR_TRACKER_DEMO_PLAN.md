# Middle East Energy & Shipping Tracker — Demo Plan

> Current implementation handoff (2026-10-09): [Unified indicators, monitoring and wallet-activity plan](docs/UNIFIED_MONITOR_PLAN.md). It adds the user's latest indicator/Telegram/fund-activity scope and explicitly defers X. The original demo scope and schedule below are historical; wallet observation in the new plan supersedes the earlier exclusion of financial-holdings work for that specific module, without adding insider detection or trading.

Planning date: 8 October 2026 (Hong Kong). Status: planning only; nothing has been implemented. The seven-day schedule is relative to the start of implementation, not a committed meeting date.

## Agreed direction

- Build a local laptop dashboard as a one-week demo for SNT.
- Refresh daily; streaming and second-by-second alerts are unnecessary for this demo.
- Start with free data sources. Do not assume paid API subscriptions, market-data licenses, or new AI-service spending.
- Cover developments across the Middle East that plausibly affect oil, gas, shipping, energy infrastructure, and energy companies. Include Iran, IRGC-related public reporting, Saudi Arabia, and shipping chokepoints.
- Interpret the user's reference to “hormones” as the Strait of Hormuz; this remains a wording assumption.
- Include English, Persian, and Arabic sources where accessible.
- Track officials' public statements and announced actions. Financial holdings, options trades, and insider-trading detection are outside this demo.
- Include prediction-market context from Kalshi/Polymarket and a social-media sentiment panel, as explicitly requested in the latest planning round. Real populated sentiment remains dependent on obtaining suitable permitted social data; never substitute invented values or silently relabel news analysis as social sentiment.
- Use visualization libraries in the supplied Google Doc to present collected information. The user explicitly clarified that this does not request a terminal-style layout. Compare Lightweight Charts, ECharts, KLineChart, and Vela by visualization need rather than assuming a docking/panel framework.
- Use the demo to discover SNT's real workflow in the meeting. Do not claim the workflow or usefulness has already been validated.

## Proposed dashboard behavior

The product is a tracker, not a separate written daily report. Its main surface contains event cards, a map, infrastructure and company details, and evidence on demand. An optional short “since the last update” section stays within the dashboard.

Proposed handling of Q14: automatically display extracted claims with visible source and verification labels. The user should not need to approve every incoming item. Curate the infrastructure/company reference relationships before the demo; do not automatically promote model-generated exposure suggestions into established facts. This is a recommendation, not yet an explicitly settled choice.

Main user path: scan new developments → select an event → inspect its location and sources → inspect related infrastructure → inspect documented company relationships.

### Main screen

1. Refresh status: last successful run, time period covered, source failures, and a manual refresh action.
2. Map: curated facilities, ports, terminals, pipelines, and relevant shipping routes; reported events use distinguishable markers. Approximate locations are labeled and never presented as precise strike coordinates.
3. Event list: filter by geography, category, source language, report status, asset, company, and new/updated event.
4. Detail drawer: concise summary, original-language excerpt where permitted, English translation, source links, dates, competing claims, and revision history.
5. Exposure drawer: documented relationships such as owner/operator and evidenced route dependence; separately labeled potential consequences.
6. Optional context charts: daily oil/gas prices only where a free, usable data source has been verified. Always show provider and as-of time; never imply delayed data is real time or that a coincident move was caused by an event.
7. Prediction markets: a small watchlist of relevant contracts, daily observations, price/probability history where available, changes in percentage points, venue, contract deadline, and a direct link to resolution criteria.
8. Social sentiment: a topic-filtered breakdown of the collected social sample, source/language composition, unique-post/author counts, and representative source-linked posts. Display “insufficient data” where coverage is inadequate.

## Potential information to track

| Category | Information to extract | Why it belongs in the tracker | Avoid inferring |
|---|---|---|---|
| Attacks and security incidents | Reported target, location, event time, claimant, reported damage and corroboration | Connect the incident to relevant infrastructure and shipping geography | A reported attack means confirmed damage or lost production |
| Oil/gas operations | Shutdown, restart, maintenance, force majeure, reported output/export changes | Show the operational state of selected facilities and operators | Full capacity is lost when the extent is unknown |
| Shipping and port disruption | Navigation warning, reported vessel incident, port restriction, route interruption, reopening | Track possible constraints on physical transport | A warning means a strait or port is closed |
| Officials' statements | Speaker, institution, exact attribution, topic, statement time, conditional wording, prior comparable statement | Show changes in publicly stated positions and announced actions | A threat, proposal, or claim is an implemented policy |
| Iran/IRGC-related developments | Public statements and reported actions linked to energy or maritime security | Surface potentially relevant regional information | An institution's claim is independently verified |
| Sanctions and trade restrictions | Issuing authority, targeted entities/vessels, measure, announcement/effective dates | Link policy changes to named entities and logistics | Announcement and implementation happen on the same date |
| Diplomacy and de-escalation | Talks, ceasefire proposals, agreements, implementation claims | Track developments that might change disruption risk | A proposal has been accepted or is holding |
| Company updates | Operator statements, facility status, exposure disclosures, operational notices | Establish attributable company links and observed impacts | General sector exposure proves direct facility exposure |
| Corrections and recovery | Retraction, corrected location, revised damage estimate, restored operation | Keep the current event state accurate while preserving history | A correction should silently overwrite the original claim |

Exclude unrelated domestic politics and generic commentary without an identifiable energy/shipping connection. Preserve a way to review excluded items during evaluation so the relevance filter can be checked for missed events.

## Data model and evidence rules

Use these connected records:

- **Source item:** original URL/message identifier, publisher/account, language, publication time, collection time, permitted text/excerpt, translation, and revision markers when available.
- **Event:** stable ID, category, neutral summary, reported event time, location and precision, named entities, attached source items, disputed facts, current status, and update history.
- **Infrastructure asset:** name, type, coordinates and precision, reference source/date, and only sourced ownership/operational relationships.
- **Exposure relationship:** event/asset/company endpoints, relationship type, supporting source/date, and whether it is documented or a proposed implication.
- **Prediction contract and observations:** venue and stable contract/outcome identifiers, question, outcome label, resolution rules, deadline, status, quote type, quote/collection timestamps, price, bid/ask where available, and available volume/liquidity measures with provider-specific units. Preserve the basis of each displayed value.
- **Social annotation and daily aggregate:** source-item identifier, topic, source/account, language, deduplication group, stance label, supporting excerpt where permitted, model/version, and aggregation window. Aggregate unique posts and authors by source/language; retain uncertain/unclassifiable cases and the denominator.

Distinguish publication time, reported event time, first observation, and last update. Store unknown values as unknown rather than asking the model to fill gaps.

Use understandable labels such as “reported,” “corroborated,” “disputed,” and “corrected,” with the evidence visible. An official statement is authoritative about what that institution said; it does not independently establish every factual assertion it contains. Ten reposts of one source are not ten independent confirmations. Do not use a model's numeric confidence as a probability that an event is true.

## Collection and processing

Daily scheduled/manual run → collect permitted material → normalize dates/languages → deduplicate → extract claims/entities → group related items → match curated assets → retrieve documented company relationships → publish labeled dashboard updates.

Keep per-source health and last-success timestamps. A failed collection should leave the previous data visible with a stale-data label. Track which extraction step failed so a translation error does not silently remove a source item.

Free source access does not establish article reuse rights, API access, or permission for AI processing. Validate the intended use for each connector. The model/translation runtime still needs to be selected based on existing access or local capability; do not assume free hosted inference.

## Proposed demo bounds

These are sizing recommendations, not established coverage commitments:

- Approximately 10–20 source endpoints/accounts initially, across official, maritime, company, and regional-publisher categories.
- Approximately 20–30 curated infrastructure/route objects and 5–10 companies with source-backed relationships.
- Approximately 5–10 relevant prediction contracts, subject to actual market availability; a first sentiment pilot over 2–3 topics with a clearly identified permitted source sample.
- A modest recent history plus daily additions; older events may be included when needed to establish continuity.
- Static reference infrastructure and reported shipping disruptions. No live AIS vessel positions, inferred troop movements, or comprehensive pipeline inventory.
- No buy/sell recommendations, automated trading, global conflict coverage, or separate PDF/report-generation workflow.

## One-week implementation sequence

| Day | Work and reviewable result |
|---|---|
| 1 | Validate news, prediction-market, and social-source access; define the small asset/company/contract watchlists and choose the necessary visualizations |
| 2 | Implement collection, normalization, source health, and duplicate handling; start storing daily prediction-market observations |
| 3 | Implement translation/extraction, event grouping, and source-labeled sentiment where social access is established; inspect real examples |
| 4 | Build the frontend panel layout, map, and verified asset/company reference relationships |
| 5 | Connect event/evidence/exposure views and prediction/sentiment panels; add oil/gas charts only if access is ready |
| 6 | Evaluate quote semantics, contract matching, sentiment samples, conflicting claims, stale sources, translations, approximate locations, and unsupported links |
| 7 | Run another daily cycle; fix failures; prepare the laptop demonstration and questions for SNT |

If time slips, reduce source/asset/contract counts and layout customization before weakening evidence traceability. Prediction-market and sentiment panels remain in the requested design. If suitable social access is unavailable, keep an honest unavailable state and report that real social sentiment remains undelivered; a panel shell does not complete that feature. X/Telegram-specific connectors and oil/gas price charts remain conditional.

## Demo acceptance criteria

- A daily run fetches fresh permitted material and reports which sources succeeded or failed.
- Every displayed event links to at least one source item; original-source access does not depend on trusting the generated summary.
- Related articles can appear under one event while disagreements remain visible.
- A selected event can show a relevant mapped asset and, where substantiated, a company relationship. Events without supported matches remain valid and show no invented link.
- Translations and extracted event fields pass a small human-reviewed sample across the supported languages. Independent language verification may be needed where the developer cannot read the source language.
- No irrelevant event is promoted solely because it mentions Iran or the Middle East.
- Stale data, unknown values, approximated locations, and possible implications are visible.
- The application works on the developer's laptop and can be restarted for the meeting.
- Prediction-market values include venue, outcome, deadline, quote basis, and observation time; different contracts are not averaged into a single probability.
- Social sentiment identifies the actual sample and supported languages. Duplicate reposts do not inflate counts, classifier uncertainty is retained, and news/official-stance analysis is not mislabeled as representative public opinion.

## Prediction-market module

Use a small manually selected watchlist of approximately 3–5 relevant contracts initially, expanding only when the core workflow works. Kalshi and Polymarket are separate venues with separate contract definitions, not interchangeable names for the same source.

- [Kalshi public-data quickstart](https://docs.kalshi.com/getting_started/quick_start_market_data) documents unauthenticated series, event, market, and order-book reads. [Candlestick documentation](https://docs.kalshi.com/api-reference/market/get-market-candlesticks) includes daily intervals. Validate actual history for each selected contract.
- [Polymarket discovery](https://docs.polymarket.com/market-data/discover-markets) supports public market discovery; [price-history documentation](https://docs.polymarket.com/api-reference/markets/get-prices-history) describes historical queries. Resolve the correct outcome identifier for the market's supported protocol; do not assume all markets expose the same token fields.
- Display the question, venue, outcome, market-implied probability/price, quote basis, bid/ask spread where available, volume with units, deadline, last observation, and a link to resolution rules. A market title alone is not the full contract definition; see [Polymarket resolution](https://docs.polymarket.com/concepts/resolution).
- A suggested quote convention is a midpoint only when both sides are valid, otherwise an explicitly labeled last trade with its age. Never silently switch conventions. Express day-to-day differences in percentage points.
- If comparable prior observations/history are unavailable, show unavailable and start storing daily observations. Do not draw invented history or replace missing quotes with zero.
- Keep cross-venue contracts separate unless their outcome, deadline, and resolution rules are verified equivalent. Do not average superficially similar contract prices.
- Annotate relevant event dates, but do not label a price move as caused by a headline without separate evidence.

Public read access is not a promise of unlimited usage or all downstream display rights. Use small daily requests, local caching, provider rate-limit handling, and endpoint validation during implementation.

## Social-media sentiment module

Interpret the requested output as the tone/stance of monitored posts, not the mood of all users or the market. Keep three separate categories: social discussion, official statements, and publisher/news tone. A news sentiment chart cannot silently stand in for the requested social-media feature.

Recommended dimensions:

- Escalation / de-escalation / neutral / unclear, with the topic identified.
- Expressed concern about supply or shipping disruption.
- Expected oil-price direction only when the author explicitly expresses it, with the relevant market identified.

Do not collapse these into an undefined positive/negative score: positive diplomatic developments and a positive oil-price expectation are different concepts.

Deduplicate repeated posts and show source, date window, topic, unique posts/authors, language mix, coverage gaps, and representative original links. Preserve unclear cases. Show an insufficient-data state when the sample cannot support a useful summary; do not display a polished gauge based on one or two posts. Set the demo's minimum sample rule before evaluation and present it as a display rule, not statistical proof of representativeness.

[Bluesky public AppView](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed) is a possible free social source. Its [official search schema](https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/feed/searchPosts.json) supports queries and filtering but warns that pagination may not expose all matching posts. Validate relevant English/Persian/Arabic coverage and intended-use conditions; a Bluesky sample is not equivalent to X or Telegram coverage.

X remains conditional on existing paid access, and the Telegram AI-processing limitation in the source register remains unresolved. Do not imply that these sources feed the sentiment chart when they are not actually connected. An existing permitted dataset could support a clearly dated offline demonstration; it would not satisfy fresh daily social coverage by itself.

## Visualization selection principles

The user's latest clarification is about visualizing collected information using tools from the Google Doc and other suitable tools. No terminal-style docking framework is required.

Pipeline: source collection → extraction and evidence → structured records → visualization-ready aggregates/series → interactive chart/map. A chart library handles the final presentation stage; it does not itself acquire news, translate posts, establish company exposure, or provide licensed market data.

Choose each view by its question:

| Question | Data required | Visualization |
|---|---|---|
| How has a contract's price changed? | Dated observations and consistent quote convention | Probability line with event-date annotations |
| How do sampled views differ by language or source? | Deduplicated, topic-labeled post annotations and denominators | Stacked bars and daily distributions, with source counts |
| Where are relevant reported disruptions? | Sourced locations and curated infrastructure geometry | Geographic map with event and facility layers |
| Which company is connected to an asset? | Verified ownership/operational relationships | Evidence-backed table first; optional small relationship graph |
| What changed in official statements? | Attributed dated statements on the same topic | Timeline with source-linked excerpts |
| How did oil/gas prices move over the same period? | Separately sourced price history and units | Financial time series with event markers; no automatic causal claim |

Use one general chart engine initially, one map library, and only add a specialized financial chart engine where its interactions justify the extra dependency. Source availability is a separate implementation prerequisite from chart-library availability.

### Library shortlist and recommendation

| Tool | Verified capabilities and proposed use | Demo decision |
|---|---|---|
| [Apache ECharts](https://echarts.apache.org/en/index.html) | General analytical charts including lines, bars, heatmaps and combinations. Use for daily probability history, sentiment distributions, source/language composition, and event counts. | Primary chart library. Start here because daily lines and aggregated intelligence are the main needs. |
| [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Financial time-series charts, line/candlestick series and extensions. Use for price/probability history with event markers when financial-chart interaction adds value. It does not supply this tracker’s market data. | Preferred specialized financial-chart addition. Preserve required TradingView attribution/link. ECharts can cover basic probability lines without it. |
| [KLineChart](https://klinecharts.com/) | Candlestick charts, technical indicators, drawings/overlays and custom extensions; an application-provided [data integration](https://klinecharts.com/en-US/guide/data-integration) supplies timestamped OHLC bars. | Alternative if SNT asks for technical analysis and drawing tools. Not necessary alongside another financial-chart engine. |
| [LuxAlgo Vela](https://github.com/LuxAlgo/Vela) | Financial-chart engine with WebGL2 rendering/Canvas2D fallback, studies, drawings, plugins, and optional workspace. Ships selected crypto-provider adapters and supports custom/offline bars. Those adapters do not provide this tracker’s geopolitical, oil, sentiment or prediction-market data. | Alternative for advanced financial-chart requirements; defer from the first demo. Core requires visible attribution; optional PineTS has a separate license and is unnecessary here. |
| [Leaflet](https://leafletjs.com/) | Maps with markers, popups, polylines, polygons and GeoJSON layers. | Add for reported disruptions, curated infrastructure and shipping-route context. This is an additional recommendation, not a tool found in the user's notes. Preserve basemap attribution and validate [tile usage](https://operations.osmfoundation.org/policies/tiles/). |
| [Cytoscape.js](https://js.cytoscape.org/) | Interactive network/relationship visualization and graph analysis. | Optional later view for event → asset → operator/company relationships; use an evidence-backed table first. This visualizes supplied relationships; it does not discover or validate them. |

Recommended starting combination: ECharts + Leaflet. Add Lightweight Charts if the demo requires a richer financial time-series view. Do not install KLineChart and Vela merely because they appear in the notes; they substantially overlap that financial-chart role. Do not add a docking-layout library without a separate layout requirement.

Daily snapshots support daily lines/points. Candlesticks require actual open/high/low/close bars from a suitable source; never manufacture them from one daily observation. Similarly, use mention counts as coverage measures rather than invented disruption probabilities, and never size “economic damage” markers using unsourced model guesses.

An example cross-view interaction: selecting an event focuses its mapped location, highlights that date on relevant probability/price series, filters the social sample to its topic, and exposes sourced asset/company links. All views should share event/entity IDs and retain their own timestamps, evidence and units.

## SNT meeting questions to validate with the demo

Which event would you actually click? What do you already get from existing tools? Which relationship or context is difficult to find today? Which sources would you add/remove? Would this replace any daily reading or merely add another screen? Which errors would make you stop trusting it?

## Outstanding product choice

Confirm the proposed Q14 behavior: automatic event display with source/uncertainty labels, plus manually curated infrastructure/company reference links. Source-by-source access and runtime feasibility are engineering checks, not questions the user must research.

## Source register

Sources below were inspected on 8 October 2026. These observations establish candidate information sources, not functioning integrations, current-event verification, or permission for automated reuse.

### Supplied Telegram channel

[Middle East Spectator](https://t.me/Middle_East_Spectator) has a readable [public preview](https://t.me/s/Middle_East_Spectator). Observed content includes maritime incident claims, regional military/infrastructure-related claims, statements attributed to officials, reposts from other outlets/channels, media, commentary, and follow-up updates. Its profile identifies an Iran/“Resistance Axis” focus and acknowledges a viewpoint.

Potential tracker fields: original post URL and identifier, post date, claim summary, quoted original source, language, named people/organizations, reported place/time, referenced asset or route, media links, and subsequently found corroboration or contradiction. Treat editorial opinion separately from an event claim. Do not use engagement/reactions as evidence of accuracy.

Use it as a discovery source, not an independent authority for every claim. A repost should preserve the upstream attribution. Where the underlying source can be obtained through permitted access, attach that source to the event. Some media require Telegram access; public-preview availability alone is not a complete ingestion strategy.

Automated AI extraction is conditional: [Telegram API terms §1.5](https://core.telegram.org/api/terms) restrict AI-related use of Telegram data. Do not assume a public channel can be fed into the LLM pipeline. For the initial plan, retain the channel as a source/reference link and investigate permitted access before implementing collection or AI processing. No workaround ingestion method is presumed. The rest of the dashboard can proceed independently.

### Candidate source register

| Candidate | Potential information | Inspection and implementation caveat |
|---|---|---|
| [UKMTO](https://www.ukmto.org/) / [JMIC](https://www.ukmto.org/partner-products/jmic-products) | Maritime incidents, advisories, affected geographic areas | Public pages readable. Text extraction did not reliably surface the incident list; connector needs validation. |
| [Maersk news/advisories](https://www.maersk.com/news) | Route changes, service suspensions, port access, operator surcharges | Public advisory links visible; statements apply to that operator, not necessarily the whole industry. |
| [EIA Hormuz analysis](https://www.eia.gov/todayinenergy/detail.php?id=65504) | Chokepoint context, oil/LNG routes, bypass infrastructure, historical flows | Dated 16 June 2025; reference context only, not current measured throughput or a complete infrastructure map. |
| [Iran foreign ministry](https://en.mfa.gov.ir/) | Public diplomatic statements and announced positions | Public English page readable; source for attributed institutional statements. |
| [CENTCOM public releases](https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/) | Public military announcements and statements | Official URL indexed; direct retrieval was inconsistent across checks. Validate before treating as a working connector. |
| [CIA statements](https://www.cia.gov/stories/press-releases-and-statements/) | Occasional public announcements | Public page readable; no access to undisclosed intelligence or operational positions is implied. |
| [OFAC recent actions](https://ofac.treasury.gov/recent-actions) | Sanctions announcements, named entities/vessels, licensing changes, effective dates | Public index visible; operational or legal consequences should not be guessed from a name match. |
| [Aramco news](https://www.aramco.com/en/news-media/news) | Operational releases and company statements | Public page and RSS link visible; dynamic listing/RSS retrieval did not establish a working feed. Ownership relationships need specific sourced documents. |
| [IRNA Persian](https://www.irna.ir/) | Persian-language reporting and attributed statements | Public homepage readable; article access, collection method, and intended-use permissions remain to be checked. |
| [Al Jazeera Arabic](https://www.aljazeera.net/) | Arabic-language regional reporting | Public homepage readable; article access, collection method, and intended-use permissions remain to be checked. |
| [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/) | Discover relevant multilingual publisher articles | Discovery is not a guarantee of full article access, completeness, or reuse rights. Validate current endpoint behavior before implementation. |
| [X](https://docs.x.com/x-api/getting-started/pricing) | Selected officials, institutions, operators, and journalists | Current official API uses paid credits; omit direct API integration from a free-only demo unless existing access is available. Public official websites may carry corresponding statements but are not an equivalent X feed. |

A selected source must pass a small access test before it counts toward demo coverage. If a source is unavailable or unsuitable for automated processing, show its link as a reference where useful and replace the connector with another permitted source; never claim continuous coverage of an unconnected source.

### Illustrative event card (fictional interface content)

> Shipping · Reported · Strait of Hormuz  
> A named operator reports a temporary routing change.  
> Published: [source time] · Collected: [collection time]  
> Related route: [mapped route] · Company: [operator named in the source]  
> Open source · View map · View evidence

The example shows the intended format only. It asserts no actual incident, route change, or company impact.
