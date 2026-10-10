# Desktop workspace and interaction repair

Completed: 10 October 2026, Asia/Hong_Kong. This follows the user's second implementation plan and subsequent requests to repair the desktop frontend, charts, interactions, and add English beneath Arabic news. W0–W6 already existed; this pass repairs their usability rather than implementing deferred roadmap packages.

## Completed

- Desktop first: 761–1279px retains news and workspace side by side; 1280px and above shows news, chart, and context in three panes. The chart and context scroll independently. Below 761px the layout stacks with normal document scrolling. Tested 980×800, 1440×900, and 375×812; no document horizontal overflow in the checked views.
- Compact header/watchlist, bounded grid columns, all seven main navigation entries visible at desktop width, sticky context/research tabs, focus outlines, and persistent Light/Dark/System preference. Resolved chart colors update when the theme changes.
- Fixed market chooser above the chart; full filtered contract list instead of silently truncating at 120. Quote details and event metadata are expandable so the actual plot, original excerpt, and translation remain accessible. Provider end date is correctly labelled separately from resolution timing.
- History loading/empty/error states, a visible symbol and nonzero time window for one-point histories, escaped HTML tooltip text, range/axis/overlay controls, existing publication markers and event-day bands retained. A retained market without a relevance link to the selected news item is explicitly labelled context only.
- Hash navigation supports browser Back/Forward and restoring a main view on reload. Already visited views/research tabs keep their in-memory draft/filter/selection state during navigation. Drafts are not promised to survive a full page reload.
- Feed and Telegram news links use `GET /api/events/:id` when an item is outside the loaded 400-item dashboard page. Original source identity, links and attribution are preserved. `GET /api/markets/:id` allows the calendar/wallet flows to open stored contracts outside the open-market list. Unknown records return 404. Newer selections supersede older requests.
- Event selection reveals its detail from Sensors/Contracts, including reselecting the same item; Map keeps its selection highlight. Pinned sensors now open and highlight their actual series. Telegram has one full-size context pane, unaffected by the dashboard's two-pane grid.
- Dossier creation/attachment opens Dossiers even when Research was on another tab. The attachment chooser refreshes when returning to Dashboard; it no longer hides dossiers created since its first load. Dossiers can attach sources from a readable chooser. Checklist actions, evidence detach/re-attach, and review history remain intact.
- Hypothesis evidence can be selected by news title or dossier/recorded claim, with raw keys available as an advanced fallback. Hypotheses can be edited. Required fields disable premature submission; research mutation buttons lock while a request is in flight. Failed calls show their message without closing the working form.
- Known calendar entries can be revised/postponed/cancelled with a rationale and version check. Whole-day entries remain date-only; provider dates cannot be manually rewritten.
- Source-health popover dismisses outside the panel or on Escape; refresh HTTP failures are surfaced instead of treating an error payload as Status.
- Dev HMR ports derive from the app port so multiple local QA servers do not contend for the same WebSocket port.

## Arabic → English

Original Arabic is kept. Selecting an Arabic news item automatically loads English; other news cards offer Translate to English underneath. Both headline and stored feed excerpt are translated, not the publisher's full article. The UI labels the result machine translated and names MyMemory. Translation does not alter matching, original source versions, claims, or research assessments.

`server/translation.ts` reads only an existing Arabic record from `events`; arbitrary supplied text and Telegram posts are not accepted. Requests are serialized and identical concurrent requests deduplicated. Unicode segments stay below 480 UTF-8 bytes. Completed translations are persisted by content hash; revised source text invalidates the previous translation. A persisted 4,500-character daily UTC application cap includes failed attempts. There is no paid fallback, API key, email registration, or new subscription. Quota/network failures are explicit and retryable. Seed mode reads a cached translation or explains unavailability without network access. Persian remains untranslated.

Live provider verification: a real Al Jazeera Arabic report about Taiz returned an English headline and excerpt, rendered beneath the original. This verifies connectivity and rendering, not translation accuracy; no native-language reviewer has signed off. MyMemory's documentation pages returned 403 to the research tool; no block was bypassed. The adapter used its public API and a conservative application budget, with response/error behavior verified by fixtures and a successful live call.

New additive tables: `news_translations` and `translation_budget`, created repeatably by the translation module when the app starts. Existing event/provider/research records are preserved. No Telegram content is added to the seed export.

## Checks actually run

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (via `npm run check`) | **127 passed, 0 failed** |
| `npm exec vite build` (via `npm run check`) | Pass; existing large-bundle warning remains |
| `npm run acceptance -- --out docs/ACCEPTANCE_REPORT_frontend.md` | **26/26 pass**; original acceptance reports preserved |

New tests: `server/translation.test.ts` checks Unicode splitting, revised-content hashes, provider failures, duplicate requests, persistent budget, unsupported records, and seed no-network behavior. `server/frontend.test.ts` checks valid/invalid navigation hashes and literal tooltip escaping. Acceptance #26 resolves a real source outside the first 400 dashboard records and checks missing-source/market 404 responses.

Browser verification ran first in development, then against the production build on port 5175 using `/private/tmp/war-tracker-ui-qa.sqlite`, a SQLite snapshot of the user's database. Automatic source ingestion was disabled. On-demand market history and public-news translation can still fetch live data into that isolated copy. Synthetic dossier/hypothesis/calendar annotations were confined to that copy, not the user's database.

Verified: desktop/laptop/narrow dimensions; dark/light; original and real English translation; Feed → selected news; source → dossier; task add/resolve/reopen; evidence detach/re-attach; dossier attachment chooser refresh; hypothesis create/link/review/edit; draft preservation across main navigation; Back/Forward; all 350 contract rows; map; chart range/fixed axis; sensor watchlist jump; Telegram pane; Coverage denominator/gap/lag presentation; date-only calendar display and postponed edit. Keyboard activation was also checked for context tabs and chart controls.

Native date-input automation could not reliably fill the creation form in this browser tool. The date-only creation fixture was inserted through the actual API on the QA copy, then its whole-day display and status-edit/save flow were verified in the browser. Domain calendar/date/timezone fixtures pass; automated browser coverage of native date entry remains incomplete. This is not recorded as a successful browser creation check.

Screenshots:
- `docs/screenshots/frontend-desktop-arabic-dark.png`
- `docs/screenshots/frontend-laptop-light.png`
- `docs/screenshots/frontend-mobile-light.png`

Root-cause feedback signal: at 980px compare the `.events` and `.right` DOM rectangles. Before repair the right pane had the same x-coordinate and started below the event pane (FAIL); afterward its x-coordinate is greater (PASS), with a 300px chart and no document overflow. A second browser regression exposed the stale dossier chooser after navigation and confirmed it refreshed after the active-view fix.

## Remaining / blockers

No unresolved implementation blocker for this frontend repair. Full independent usability review and native date-input browser automation are not complete. Translation availability remains subject to the provider and the application cap; translations are not independently reviewed. Other languages and bulk pretranslation are outside this request.

Existing plan gates remain: named human reviewers for authoritative claims/link/language/pair review; credentials/sample for ACLED; authorized AIS access for vessel tracks. Month-grid calendar, SSE, optional indicators, bundle splitting, and the plan's deferred Section 7 remain unfinished/deferred. No scope/budget expansion into these packages was made.
