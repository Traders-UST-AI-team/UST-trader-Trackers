# War Tracker: Research Workspace Implementation Plan

Date: 9 October 2026 (Hong Kong). Status: **Implemented W0–W6 on 2026-10-09; desktop/interaction repair completed 2026-10-10** — see [RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md](RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md) (originally proposed the same day). This is a new, standalone implementation plan for the user's accepted Research Workspace brainstorm. It defines this release's scope, implementation sequence, data contracts, and acceptance requirements. It can be handed directly to an implementation agent. [UNIFIED_MONITOR_PLAN.md](UNIFIED_MONITOR_PLAN.md) and the research notes are background references; completing their full roadmap is not a prerequisite for this release. This document does not authorize implementation of every deferred idea at once.

## 1. Outcome and first-release scope

Move from a scrolling information dashboard toward a research workflow:

**Notice a change → open an event dossier → inspect source updates and disagreements → review a research hypothesis → record the next check.**

First release contains the five prioritized features:

1. Event dossiers with source updates, corrections, and an investigation checklist.
2. Port/chokepoint observation cards using available data, with explicit coverage limits.
3. Research hypothesis cards with supporting/contradicting evidence and invalidation conditions.
4. Contract deadline and known-event calendar.
5. Monitoring coverage/blind-spot panel.

Historical replay, complex route changes, full impact modeling, automatic narratives, and platform-wide sentiment are later work. X remains entirely deferred. No paid data subscription, automated trading, arbitrary script execution, or model-based processing of Telegram is introduced.

Use the current React/TypeScript/Express/SQLite/ECharts/Leaflet/Cytoscape stack. Reuse existing event feeds, story candidates, contract histories, asset relationships, Telegram collection, and source-health infrastructure.

## 2. Current baseline and optional integration

Before editing code, inspect `shared/types.ts`, `server/db.ts`, `server/index.ts`, `server/story.ts`, `server/telegram.ts`, `server/assets.ts`, and the current `src/components` directory. Read `docs/AGENT_LOG.md` and `docs/ACCEPTANCE_REPORT.md` for recorded baseline evidence. Previously repaired sensor refresh, Telegram channel selection/isolation, and coverage warnings must not be rebuilt as new features.

Current useful inputs are source events with original URLs/publication/collection times; story-similarity candidates; prediction-market metadata and history; sensor series; curated assets/company links; Telegram posts and channel state; persisted source-health/breaker state. Their available revisions and coverage are limited. Discover actual implementation status rather than assume another plan has been completed.

| Existing package | Relationship to this plan |
|---|---|
| A: data contracts/freshness | Reuse timestamp, coverage, version, and missing-data conventions. |
| B/C: indicators/watchlist | Embed the same indicator outputs in observation cards; do not recalculate them in components. |
| D: unified feed/Telegram | Provides source references and stable identities for dossiers. Dossiers can initially use current news records and add Telegram when D is available. |
| E: wallet activity | Future dossier evidence/context can link to observed trades. A dossier must work without wallet access. |
| H: claim/evidence review | Shared evidence and review model. Hypothesis cards are research judgments, not a competing truth-status engine. |
| J/K: vessels/assets/maritime | Share port/asset identities, reviewed geometry, source access gates, and coverage rules. |

The package names above refer only to optional integration points in the earlier roadmap. Implement the minimal shared contracts needed here if they do not yet exist; reuse them if they do. Do not implement the full earlier indicators, wallet-monitoring, or AIS roadmap as a dependency of this release.

No new data-access dependency blocks the first event/hypothesis/calendar release. Use existing configured sources; incomplete port/AIS coverage produces unavailable states rather than invented observations.

## 3. Shared domain model

Keep source records, event dossiers, claims, and research hypotheses distinct:

- **Source item:** an original news item, official advisory, Telegram post, or observed data record. Preserve its original identity, URL, time precision, and attribution.
- **Event dossier:** a user-reviewed grouping of source items describing a particular development. It is not the existing broad story cluster and is not a verified incident by default.
- **Claim:** a specific attributed statement within a source item. Reuse an existing claim-review model if available; otherwise start with source-linked statements and explicit attribution without requiring a full corroboration engine.
- **Hypothesis:** the user's testable interpretation, with observations that could support, weaken, or invalidate it.
- **Observation target:** a reviewed port, chokepoint, facility, vessel, market, or source set.
- **Coverage interval:** the recorded collection/observation availability for a source and region, not proof of complete real-world coverage.

Evidence rules for this release: preserve source identity and original attribution; keep publication, stated incident, collection, and review times separate; similarity and outlet counts are not verification; manual research judgments require a rationale and audit record. Do not infer operating status, ship cargo, ownership, or real-world completeness from unsupported observations.

Reuse stable source-item keys from the unified feed. Implement a typed source-reference resolver for original tables; do not copy all Telegram/news text into new unversioned dossier tables. Display missing or unavailable references explicitly.

Suggested new tables, adapted to existing migrations:

| Table | Minimum purpose/fields |
|---|---|
| `research_dossiers` | ID, title, description, workflow state, created/updated time, owner label, optional reviewed place/asset references. |
| `dossier_items` | Dossier/source-reference IDs, relationship, source revision reference, attached time, human/deterministic attachment basis, rationale. Unique dossier/reference membership. |
| `source_item_versions` | Source-reference ID, content hash, permitted source excerpt/metadata snapshot, observation/collection time, source-reported modification time, revision kind/basis. |
| `research_tasks` | Dossier/hypothesis reference, question, status, optional due time, resolution note, linked evidence. |
| `research_hypotheses` | ID, title, scope/targets, statement, status, invalidation conditions, next-check time, created/updated time, version. |
| `hypothesis_evidence` | Hypothesis/source-or-claim reference, supporting/contradicting/unclear relationship, user rationale, reviewer/time, revision reference. |
| `research_decisions` | Append-only record of previous/new hypothesis assessment, rationale, referenced evidence versions, author, recorded time. |
| `calendar_entries` | Contract or manual entry reference, kind, occurrence/window, time precision/zone, basis, source URL, discovery time, revision/status. |
| `source_coverage_intervals` | Reuse existing coverage storage where possible; source/channel/region, start/end, collection state, gap reason and scope. |
| `workspace_preferences` | Single-user preferences for pinned dossiers/targets, filters, timezone, and display choices. |

Do not create duplicate claim/coverage/asset models if another package has already implemented them. Use transactional writes, foreign-reference validation, bounded requests, and optimistic concurrency for edited research records. Maintain the existing privacy/retention rules for Telegram snapshots and exports; do not silently widen demo-seed scope.

## 4. Feature specifications

### W1. Event dossiers, updates, and corrections

**User flow:** select a source item → create a dossier or attach to an existing one → inspect a chronological timeline → add a question or record a review.

- Title and description are editable research metadata; they must not overwrite the publisher's headline.
- Show publication time, stated incident time where available, collection time, and revision-observed time separately. Default timeline ordering uses publication time with date-only labels; an alternative “entered our system” view uses collection time.
- Reuse existing story similarity to propose attachments. Every suggestion shows its reason and remains pending until accepted. Broad shared countries/topics alone must not auto-merge distinct incidents.
- Separate source revisions from new reports. Store versions prospectively; mark changes with before/after text or metadata differences. A publisher's explicit correction/retraction differs from a locally detected edit. A failed request or missing page is not a confirmed retraction.
- Add a disagreement view with attributed statements side by side. Differences in reported location, timing, casualties, or responsibility remain differences to review; they do not auto-generate a truth verdict.
- Checklist tasks include question, optional due date, evidence links, and open/resolved/dismissed state. Completion requires a note or linked evidence; reopening remains possible.
- Existing data with no archived prior revision has unknown previous content. Do not reconstruct earlier versions from the current response cache.

**Acceptance:** two unrelated events sharing entities remain separate; duplicate attachments are idempotent; source edits preserve old versions after capture begins; corrections, unavailable pages, and date-only reports display distinctly; a researcher can create, attach, detach, resolve a task, and inspect the audit history.

### W2. Port and chokepoint observation cards

**User flow:** pin Hormuz or another supported target → see aggregate activity, freshness, relevant reports, and links to observed vessels where available.

- Start with existing PortWatch chokepoints and reviewed assets. A port card can initially show identity/reference links and attributed reports without numerical port-call data.
- Display latest observation, source, expected publication lag, and comparison window. Reuse shared indicator outputs when implemented; otherwise show existing raw observations without inventing missing calculations. If adding a basic change here, compare the latest and preceding actual observations from the same source/unit, label both times, and compute percentage as `100 * (latest - prior) / prior` only when prior is nonzero. Missing/stale inputs produce unavailable. Do not add the entire technical-indicator package as a card dependency.
- Where authorized AIS observations become available, show observed vessels/type mix and position ages under the measured coverage window. Do not imply that the free feed sees all ships.
- Arrival/departure/anchorage/queue/dwell metrics require actual source fields or validated continuous tracks and reviewed geometry. Do not infer port closure from few observations or congestion from slow speed alone.
- Operational notices use statuses such as “operator announcement” or “reported restriction,” with source and valid time. An old notice must not remain indefinitely presented as current without validity information.
- Build official/reference/observed/computed layers separately. AIS, PortWatch, and published port schedules must not be collapsed into a single count or a single operational verdict.

**Acceptance:** cards work without AIS credentials; numerical metrics display unavailable when unsupported; delayed aggregate data is not marked live; differences in source definitions are visible; new input versions refresh the cards without losing pins.

### W3. Research hypothesis cards

**User flow:** write a hypothesis → define what would support or invalidate it → attach evidence → record a review → schedule the next check.

Required fields: statement, geographic/topic scope, linked targets, rationale, evidence, invalidation conditions, and next check. Optional fields: alternative explanation and scenario assumptions.

- Workflow status is draft/active/closed. Manual assessment is strengthened/weakened/unchanged/insufficient; keep it separate from claim-level evidence assessments.
- Evidence relationships are user-reviewed supporting/contradicting/unclear. Deterministic entity/topic matching can suggest relevance, but must not auto-classify support or contradiction.
- Record previous and new assessments with rationale and the exact evidence revisions reviewed. A source change or new relevant item creates a “review needed” cue, not an automatic change of belief.
- Invalidation conditions may be prose initially. Structured threshold conditions can later reuse registered indicators, requiring adequate freshness/coverage and no arbitrary script execution.
- Preserve conflicts and alternative explanations. No blended confidence percentage or single buy/sell recommendation.

**Acceptance:** edit conflicts are detected; supporting evidence can be revised or reassessed without erasing history; missing evidence yields insufficient; users can trace each assessment to its author, time, rationale, and source versions.

### W4. Contract and known-event calendar

**User flow:** open a calendar or upcoming list → select a contract deadline or recorded event → inspect its basis and resolution rules.

- Populate from existing market end dates, preserving provider meaning. Label them “provider end date” unless actual trading cutoff/expiry semantics have been verified. Resolution date is separate and may be unknown.
- Reuse original contract resolution text/links. Keep venue/outcome identity and human-verified pair requirements intact.
- Allow manual events such as an announced meeting or a scheduled advisory expiry, with source URL, date/time precision, and explicit timezone. Do not extract unverified future dates into confirmed calendar entries.
- UTC storage, user-zone display (default Asia/Hong_Kong), and IANA zone handling for known source times. A date-only entry stays a date-only interval, not a fabricated midnight deadline.
- Display revised, postponed, canceled, and unknown entries. Save first-known time and changes for future audit/replay.
- Provide an upcoming list as the first UI; month/week calendar is optional afterward. No external calendar sync or outgoing notifications in this release.

**Acceptance:** timezone/daylight-saving fixtures, date-only handling, changed provider end dates, distinct end/resolution dates, removed/closed contracts, and no invented deadline semantics.

### W5. Monitoring coverage and blind spots

**User flow:** inspect Coverage → see where data is stale, disconnected, sparse, or has known gaps before interpreting an empty feed.

- Extend existing source-health and Telegram gap state; do not create a competing health engine.
- Show configured sources by platform/type, monitored channels, languages supported by rules, regional scope, last successful collection, latest data time, and known gap intervals.
- Collection continuity requires persisted run/interval telemetry from its actual start. Mark earlier continuity unknown. Source availability is not evidence of exhaustive news or AIS coverage.
- Define collection success rate as completed successful scheduled attempts divided by completed scheduled attempts in the stated window; show numerator/denominator. Exclude disabled sources and incomplete attempts; display backoff/paused state separately. Manual attempts are separately labeled.
- Publication-to-first-collection lag is descriptive only for instant-precision records. Date-only items and historical backfill are excluded or reported in separate cohorts; sample counts and windows are visible.
- Record source-set versions. Adding channels, removing sources, or changing filters must be visible beside message-volume comparisons; otherwise counts can rise solely because coverage changed.
- Do not display “no incidents” when all relevant sources are unavailable. Use “No items observed within this coverage” and an explanation.

**Acceptance:** all-source failure, one-channel failure, sparse AIS, delayed daily data, source-set changes, known gaps, no telemetry history, and recovery all produce explicit states rather than zero traffic or zero incidents.

## 5. API and frontend boundaries

Suggested modules: `server/research/` for dossiers/hypotheses/tasks/revisions, `server/calendar.ts`, and existing/shared coverage and maritime modules. Shared contracts belong in `shared/research.ts`; reuse indicator/source types rather than duplicate them.

Suggested routes, finalized against current routing conventions:

- `GET/POST /api/research/dossiers`; `GET/PATCH /api/research/dossiers/:id`.
- `POST/DELETE /api/research/dossiers/:id/items` for attachments; paginated timeline and source-version reads.
- `GET/POST/PATCH /api/research/tasks` with bounded filters.
- `GET/POST /api/research/hypotheses`; `PATCH /api/research/hypotheses/:id`; append-only review endpoint.
- `GET /api/observation-targets`; target detail combines existing indicators, reports, and coverage.
- `GET /api/calendar?from=...&to=...`; manual-entry writes separate from provider-derived entries.
- `GET /api/coverage?window=...`; explicit source-set/region/window metadata.

Validate IDs, timestamps, timezones, enums, lengths, and pagination. Use revision/version checks to return edit conflicts rather than silently overwrite research. Separate user annotations from provider data. These are local single-user workflows initially; shared server access requires the consolidated deployment/access-control layer before exposing write endpoints.

Frontend additions: a Research entry point with Dossiers and Hypotheses, an observation-target view, Upcoming, and Coverage. Keep existing Dashboard/Telegram views usable. Selecting a source can open its dossier without losing selected market/context. Use the current layout initially; no docking framework or chart-engine migration.

## 6. Delivery sequence and gates

| Stage | Implementation | Completion gate |
|---|---|---|
| W0 | Current-code inventory, shared source references, migrations, source revision capture, and coverage telemetry | Existing acceptance still passes; old records remain intact; unavailable history explicitly unknown. |
| W1 | Manual dossiers, attachments, timeline, revisions, checklist, and disagreement presentation | A user can investigate one real event without losing attribution or confusing it with similar events. |
| W3 | Hypothesis CRUD, evidence attachments, review history, and next-check queue | Assessments traceable to source versions; no automated truth/support score. |
| W4/W5 | Upcoming list and coverage panel | Deadlines preserve semantics; gaps and source-set changes visible. These can be developed after W0 without waiting for live AIS. |
| W2 | Port/chokepoint cards | Existing aggregate data works; optional vessel fields remain unavailable until maritime access/coverage is validated. |
| W6 | Integrated flows, regression tests, browser verification, documentation, and seed handling | All first-release features meet Section 8 and are marked implemented/partial/pending accurately. |

This is a standalone release sequence. Earlier roadmap packages are optional integrations, not mandatory release blockers. If no AIS key, independent reviewer, or native reader is available, finish the eligible workspace features and record the gated items.

## 7. Deferred backlog from the brainstorm

| Idea | Next useful increment | Dependency / limitation |
|---|---|---|
| Historical replay | Show records as known at a selected past time | Prospective immutable versions and first-known timestamps. Earlier periods without snapshots are unavailable; present-day fields must not leak into past views. |
| Vessel/fleet behavior and route changes | Watchlist tracks, observed route comparisons, reviewed vessel identity history | Consolidated maritime K2/K3 and measured coverage. No fabricated missing history. |
| Dependency/impact graph | Event → facility/port/chokepoint → documented company/transport links | Existing asset graph plus reviewed relationships with dates. Exposure is context, not quantified causal loss. |
| Alternative-route scenarios | Compare clearly labeled illustrative route distances | Versioned graph and explicit route assumptions. Time/cost need stated speed/operating assumptions; not a real voyage forecast. |
| Market change without matched reporting | Review queue of unusual movements with no relevant item in the monitored corpus | Indicators and a stable source set. “No match in our feeds” is not “no news exists.” |
| High reporting activity with little market movement | Descriptive comparison by target/window | Deduplicated reporting and compatible market timestamps; not a trading signal. |
| Wallet disagreement and approaching-expiry activity | Show watched outcome positions and selected-window trades | Consolidated E; incomplete holdings, external hedges, and unknown identity remain visible. |
| Daily change brief | Template-based summary of new/revised items, indicators, and open tasks | Stable revisions and coverage. No automatic Telegram LLM summarization. |
| Shareable research packet | Markdown/HTML export with evidence links, timestamps, chart references, and limits | Snapshot-consistent output and per-source retention/export rules; Telegram seed/export exclusions remain intact. |
| Personal workspace | Persist pins, filters, tasks, and saved views | Existing workspace preferences; collaboration/authentication is later scope. |

Do not add these automatically to W0–W6. Report them as deferred unless the user explicitly selects a later delivery.

## 8. Verification and implementation report

Meaningful tests must cover domain behavior, not only component snapshots:

- Migration preserves existing records and is safe to rerun; transactional attach/edit operations do not leave partial state.
- Dossier proposals remain suggestions; copying the same wire story does not become independent corroboration; separate events remain separable.
- Source versions are immutable after capture; revisions/retractions/unavailable pages differ; pre-capture history is not invented.
- Hypothesis edits use conflict detection; review rationale references exact evidence versions; revised evidence triggers review-needed rather than automatic reassessment.
- Port cards obey the documented same-source calculation and coverage rules; sparse AIS does not assert closure/congestion.
- Calendar date precision, IANA timezone transitions, provider-end semantics, revisions, and known-at times are preserved.
- Coverage rates use the defined denominator; manual/backfill/date-only cohorts do not distort latency; source-set changes are versioned.
- Single-user preferences persist; unsafe or invalid API inputs are rejected; user-provided text renders without executable markup.
- Seed remains offline; research annotations can be demonstrated separately without silently including excluded Telegram content. No live alert or new network fetch is triggered in seed mode.

Run `npm run typecheck`, `npm test`, `npm run acceptance`, and `npm exec vite build`. Current `npm test` matches `server/*.test.ts`; place relevant tests there or explicitly update test discovery so nested research tests actually run. Use a temporary database for synthetic fixtures and record live checks separately.

Browser-check light/dark themes and desktop/narrow widths: create a dossier from a source, attach/detach evidence, review a hypothesis, inspect a date-only calendar entry, view delayed/failed coverage, and inspect an observation card without AIS. Preserve existing charts, maps, event bands, counterpart warnings, and Telegram selector/refresh behavior.

Write `docs/RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md` with delivered stages, changed files, migration/version choices, actual commands/results, screenshot locations, live-versus-fixture verification, remaining gates, and deferred features. Baseline test counts are historical; report the new run's actual counts.

## 9. Ready-to-send implementation brief

> Implement this standalone Research Workspace release. Inventory existing code first and preserve completed Days 2–3 features. Deliver W0 → W1 → W3 → W4/W5 → W2 → W6. Use UNIFIED_MONITOR_PLAN.md as background and reuse any shared modules already implemented, but do not require or build its entire indicators, wallet, or AIS roadmap. Implement only the minimal source-reference, revision, and coverage contracts needed by this release. Capture revisions and coverage prospectively; do not invent past data. Keep dossier grouping, attributed claims, and user hypotheses distinct. Start with manual, explainable review workflows and existing data; do not block them on optional AIS access or human reviewers. X, paid subscriptions, automated trading, arbitrary script execution, and model-based Telegram analysis remain excluded. Verify the domain behaviors, run the existing and new checks, and write RESEARCH_WORKSPACE_IMPLEMENTATION_REPORT.md. Leave Section 7 explicitly deferred.


## 10. Frontend repair progress — 10 October 2026 (Hong Kong)

The user subsequently prioritised a usable desktop workspace, normal charts, corrected interactions, and English beneath Arabic news. Delivered in this pass: desktop/laptop layouts with independent panes; chart sizing, theme/range/axis behavior; reliable cross-view item resolution; retained navigation drafts; dossier/checklist/evidence/hypothesis edit and review flows; readable evidence selection; manual calendar revision controls; refreshed dossier selectors; sensor-watchlist navigation; Arabic original + machine English reading aid with cached, bounded public API requests and offline behavior.

Verification: typecheck, 127/127 tests and production build pass; acceptance **26/26** (including navigation beyond the first 400 dashboard records). Browser checks and screenshots cover 1440px dark desktop, 980px light laptop, 375px light narrow view, real Arabic translation, dossier/hypothesis workflows, calendar date-only display/edit, Coverage, Telegram, maps and charts. Native date-input browser creation automation remains incomplete; API creation and calendar domain fixtures were verified instead. Details, changed modules, limitations and screenshots: [FRONTEND_REPAIR_REPORT.md](FRONTEND_REPAIR_REPORT.md). Latest independent acceptance artifact: [ACCEPTANCE_REPORT_frontend.md](ACCEPTANCE_REPORT_frontend.md).

W0–W6 remain delivered; these fixes refine W1/W3/W4/W6. Existing human-review and AIS/ACLED gates remain unchanged. Section 7 remains deferred. No new paid subscription or trading functionality was introduced.
