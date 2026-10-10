# Research Workspace — implementation report

Date: 2026-10-09 (Hong Kong). Plan: [RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md](RESEARCH_WORKSPACE_IMPLEMENTATION_PLAN.md). Delivered together with claim review (UNIFIED_MONITOR_PLAN §12 H1), which the plan names as the shared evidence model. Fixture verification and live/browser verification are listed separately; nothing here was reviewed by a human domain expert.

## 1. Stages

| Stage | Status | Notes |
|---|---|---|
| W0 — inventory, shared references, migrations, revision capture, coverage telemetry | Done | References are the unified feed's stable keys (`web:<source>:<id>`, `telegram:<channel>:<post>`), resolved against the original tables. Versions are captured prospectively in `source_item_versions` when research first references an item and after every collection run; earlier content is unknown. Collection attempts are logged from now on (`collection_attempts`), source-set changes are logged (`source_set_changes`), research writes are audited (`research_audit`). |
| W1 — dossiers, attachments, timeline, revisions, checklist, disagreements | Done | Manual dossiers; idempotent, audited attach/detach/re-attach; suggestions only from existing story clusters and Telegram similarity matches, each with its reason and pending until accepted; timeline by publication or by collection; changed-since-attached flags; tasks need a note or evidence to close; side-by-side differences between attributed claims. |
| H1 — claim-level evidence and review | Done (tooling) | Claims anchored to an exact excerpt of a captured version; explicit unknown fields; workflow state separate from assessment; non-default assessments need `reviewed` state, matching evidence, reviewer and rationale; append-only review history with evidence versions; evidence-origin groups (retellings of one upstream report count once). Rule version `claim-review-1.0`. Authoritative assessments still need a named reviewer. |
| W3 — hypotheses, evidence, review history, next checks | Done | Required invalidation conditions; user-set relationships only; only "insufficient" without evidence; append-only decisions with exact evidence versions; review-needed cues for revised sources and re-assessed claims; edit-conflict detection. |
| W4 — contract deadlines and known events | Done (upcoming list + month grid) | Provider end dates mirrored with their provider meaning (Polymarket `endDate`, Kalshi `close_time`), revisions/closed/vanished states; manual entries need a source URL and an IANA zone; date-only entries are whole local days; DST handled. |
| W5 — coverage and blind spots | Done | Scheduled success rate with numerator/denominator (manual separate, disabled excluded), newest data per source, Telegram gaps/lag, wallet-data gaps, lag cohorts (instant vs date-only vs late finds), source-set changes, "no items observed within this coverage" wording, all-sources-down state. |
| W2 — port and chokepoint cards | Done (aggregate data only) | PortWatch chokepoints (same-series change, % only when the prior is non-zero, provider lag, 28-day baseline from the shared indicator) plus reviewed ports/terminals with reports only; vessel fields unavailable until K2. Pins persisted. |
| W6 — integration, regression, browser verification, docs, seed handling | Done | See §3–4. |

Explicitly deferred (plan §7): historical replay, vessel/fleet behaviour, dependency/impact graph extensions, alternative-route scenarios, "market change without matched reporting" queue, reporting-vs-movement comparison, wallet disagreement views, daily brief, research-packet export, collaboration/authentication.

## 2. Files and migration choices

- Server: `server/research/{schema,refs,claims,dossiers,hypotheses,calendar,coverage,targets,hooks,routes}.ts`; `shared/research.ts`; hooks in `server/ingest.ts` and `server/tgscheduler.ts` (re-capture attached items, mirror provider end dates); `server/runlog.ts` (attempt telemetry, source-set changes); `server/story.ts` (`originGroupOf` extracted and shared); `TrackerEvent.feed_key`.
- Client: `src/components/research/{ResearchView,Dossiers,Hypotheses,Upcoming,Coverage,Places,ResearchActions,common}.tsx`; Research tab in the main navigation; "New dossier from this item / attach to dossier" on the dashboard's event detail (the selected market stays selected).
- Migrations live in `server/research/schema.ts` (called from `db.ts`), additive and repeatable. Earlier never-populated draft tables of a different shape (`claims`, `research_*`, `calendar_entries`, …) are dropped only when empty. Research tables are not part of the demo seed export; the seed database gets empty research tables and research works there offline.
- Concurrency: dossiers, tasks, hypotheses, claims and manual calendar entries carry a `version`; a stale `expected_version` returns 409 instead of overwriting.

## 3. Verification actually run

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **112 / 112** — includes `server/research.test.ts` (9 tests): repeatable migration; claim anchoring, copied-wire origin groups, assessment rules, history; publisher revision vs unavailable vs restored; dossier idempotence, suggestions with reasons, "countries alone never suggest", disagreements; task closing rules; hypothesis rules and review-needed cues; calendar provider semantics, revisions, DST (New York 23-hour day, EST after DST end), date-only intervals; coverage denominators; observation-card change rules and pins |
| `npm run acceptance` | **24 / 24** → `docs/ACCEPTANCE_REPORT_v2.md` (criteria 22–24 added for claim review, the workspace, and "no automatic assessment anywhere in code") |
| `npm exec vite build` | succeeds (existing chunk-size warning) |

Browser (QA server on a copy of the live database, port 5175, no collection): created a dossier from a real event, accepted a story-cluster suggestion (BBC), recorded a claim from an exact excerpt, linked evidence, recorded a "supported" review with reviewer and rationale; created a hypothesis, linked the claim, recorded a review; opened Upcoming (295 real provider end dates), Coverage and Places (real PortWatch values, including "previous observation is 0 — percentage undefined" for Hormuz tankers). Dark desktop and light 375 px checked; defects found and fixed: invalid date-format options crashed Upcoming (contained by the error boundary), narrow-layout overflow of sub-tabs/sidebar/audit JSON, invisible active segment text in light mode.
Seed mode (separate seed server): status `seed`, a dossier can be created offline, Telegram explained as excluded, no collection job ran.

Screenshots (`docs/screenshots/`): `l1-dossier-claim-review-dark.jpg`, `l2-hypothesis-dark.jpg`, `l3-places-dark.jpg`, `l4-upcoming-dark.jpg`, `l5-dossier-mobile-light.jpg`.

## 4. Remaining gates

- Authoritative claim assessments, link-benchmark labels (H2), Arabic/Persian review (H3) and verified cross-venue pairs (H4) need named human reviewers; the tooling records reviewer and rationale but no assessment here comes from an independent reviewer.
- Vessel-level observation fields stay unavailable until an authorized AIS feed with measured coverage exists (K2).
- Attempt telemetry and source versions start on 2026-10-09; anything earlier is shown as unknown.


## 5. Desktop and interaction repair — 2026-10-10 (Hong Kong)

Follow-up user requests repaired the desktop layout, chart presentation, navigation, research mutation flows and English reading aids beneath Arabic news. Current verification is **127/127 tests**, clean typecheck/build, and **26/26 acceptance**. Full changes, browser evidence and remaining limits are in [FRONTEND_REPAIR_REPORT.md](FRONTEND_REPAIR_REPORT.md); the new acceptance artifact is [ACCEPTANCE_REPORT_frontend.md](ACCEPTANCE_REPORT_frontend.md). Earlier results above remain the historical implementation record.
