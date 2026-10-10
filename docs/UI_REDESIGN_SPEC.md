# UI redesign spec — "Monitor" (v2)

Status: phases 0–2, 4 and 5 implemented on 2026-10-10 (see the progress note at the end); phase 3 partly (touches strip) and 6–7 not started. Canvas: https://claude.ai/artifact/25hpa3DsQv1Ys8v5NZFHs6
Scope: interface only. No change to data, sources, server or honesty rules. Stack stays React 19 + TypeScript + Vite, ECharts, Leaflet, Cytoscape. No new UI framework.

The owner's verdict on v1 was "too complex and cluttered, and it does not match how the tool is used". This spec therefore starts from one workflow and cuts everything that does not serve it.

---

## 1. The one workflow

> **Something happened → which contracts or assets does it touch → what did the price do around it (coincident, not causal) → save it or note it.**

Every screen is judged against this. A screen does one job. Anything that is not part of the job is hidden until asked for: in a drawer, an expandable row, or the single **Chart options** menu.

| Step | Where it happens | What the user sees by default |
|---|---|---|
| 1. Something happened | Monitor, left column | A list of items: outlet, tier, age, headline. One search box, one Filter button. |
| 2. What it touches | Monitor, reading pane, "Touches" | The linked contracts and assets (sensors), each with its price and 24h change. |
| 3. What the price did | Monitor, reading pane, chart | One price line for the selected contract with a dashed line at the item's publication time, and one sentence: the change around publication or the reason it is a gap. Wording: "coincident, not causal". |
| 4. Save or note it | Monitor, reading pane footer | Two buttons: **Save to dossier** and **Add note**. |

---

## 2. Research findings

What I looked at, and the transferable principle I took from each. These are principles only. No branding, logos, colours or assets are copied.

| # | Product | Source (primary where reachable) | What it does | What we take |
|---|---|---|---|---|
| R1 | Koyfin dashboards | https://www.koyfin.com/help/my-dashboards-groups/amp/ | Widgets join one of 7 colour "groups". Picking a security in one widget loads it in every widget in the same group. | **Linked selection**: select an item and every pane follows it, with no "sync" buttons. We need only one link group: the selected item and its selected contract. |
| R2 | Koyfin hotkeys | https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/amp/ | `/` opens one search box that is also the command line. Short codes jump to features. | **One entry point**: `/` focuses the single search box. The search finds items, contracts and places. No second toolbar. |
| R3 | Bloomberg Terminal UX | https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity (fetch returned 403; quoted from the search index) | The CTO describes the approach as "hiding complexity". Small changes such as a moved button disrupt expert users. | **Conceal, don't delete**: power features (indicators, filters, layout) stay available behind one menu. Keep positions stable between versions. |
| R4 | Bloomberg colour accessibility | https://www.techatbloomberg.com/blog/designing-the-terminal-for-color-accessibility/ and https://www.bloomberg.com/ux/accessibility/ (both 403 to fetch; summarised from the search index) | Bloomberg says about 20,000 users have a colour-vision deficiency. Red/green up/down is the core problem. It ships alternate CVD colour schemes. | **Never colour alone**: direction uses ▲/▼ in neutral ink. State uses glyph + word. Contrasting pairs are blue/orange and differ in lightness. |
| R5 | Polymarket docs | https://docs.polymarket.com/concepts/prices-orderbook | The displayed price is the midpoint (bid+ask)/2. When the spread is above $0.10 the last trade is shown instead. The midpoint is not the fill price. | **Say what the number is**: the headline price always carries its basis ("midpoint" or "last trade, spread > 10¢") in small text next to it. |
| R6 | Kalshi Pro charts | https://kalshi.com/pro/help/charts | Step-line price, range selector (LIVE…ALL), local time, a single stats line above the chart. Non-live ranges are labelled as refreshing on a timer. | **Step line + one range selector + one stats line.** Flat stretches read as "no trades", not as smooth drift. Ranges: 24h · 7d · 30d · All. |
| R7 | TradingView indicator placement | https://www.tradingview.com/charting-library-docs/latest/ui_elements/indicators/indicator-placement | Price-range studies (MA, Bollinger) overlay the price pane. Studies with a different range (oscillators) get their own pane and scale. | **Overlays vs sub-plots**: SMA/EMA/Bands overlay the price. RSI/MACD are separate sub-plots. All are **off by default**, all sit in Chart options, and each is labelled with its period (e.g. "SMA 24×1h"). |
| R8 | TradingView alerts manager | https://www.tradingview.com/support/solutions/43000595311-manage-alerts/ | Each alert has a small status vocabulary (Active / Stopped — Triggered / Stopped manually / Stopped — Expired). Triggered alerts go to a log with keyboard navigation. | **Few states, named in words**, and a log you can step through with the keyboard (j/k). |
| R9 | Dataminr Pulse | https://www.dataminr.com/pulse | Alerts are timestamped to first discovery, updated as the event unfolds, and say which sources corroborate them. | **Item-first, with provenance**: the item is the unit. Its outlet, tier and "same story cluster ≠ same incident" wording travel with it. |
| R10 | FT Visual Vocabulary | https://github.com/Financial-Times/chart-doctor/blob/main/visual-vocabulary/README.md | Choose a chart by the relationship it shows. It warns that correlation charts are read as causation unless told otherwise. | **One chart, one message**: change over time with an event marker, plus an explicit "coincident, not causal" sentence. |
| R11 | MarineTraffic help | https://support.marinetraffic.com/en/articles/14594303-how-to-check-when-a-vessel-s-position-was-last-updated · https://support.marinetraffic.com/en/articles/9552757-vessel-details-page | "Data received on" absolute time plus "last update N min ago". Old positions may mean the transponder is off or out of coverage. | **Every value carries its age**: absolute time on hover or in the drawer, relative age inline. |
| R12 | Windward, AIS gaps | https://windward.ai/blog/mind-the-ais-gap/ | A gap is context, not an alarm. Unknown periods stay unknown and are never filled in. | **A gap is shown as a gap with its reason**, never interpolated or zeroed. This applies to price history too. |

Not verified: Bloomberg pages returned HTTP 403 to fetch, so R3/R4 rely on search-index text of those official pages. The Kalshi help-center articles on order books were not readable. I found no official Economist chart style guide (only third-party copies), so it is not used.

---

## 3. Principles chosen (and why)

1. **One workflow, one screen per job.** The Monitor screen holds the whole workflow, and nothing else competes for it. (Owner feedback; R3.)
2. **Linked selection, not linking UI.** Selecting an item updates the Touches list, the chart and the save target. The user never sets up links. (R1.)
3. **Three numbers, then a drawer.** A contract header shows price (with basis), 24h change and resolves date. Bid/ask, volume, liquidity, hourly-move statistics, rules and provider history sit behind **Details**. (R5, owner feedback.)
4. **Chart options, off by default.** Overlays, sub-plots, axis mode and large-trade markers live in one menu, and every option is off on first run. (R7.)
5. **Quiet honesty markers.** One glyph + one or two words, in the same place every time. A healthy source shows no marker. (R4, R11, R12.)
6. **Every number states its basis and age.** Examples: "midpoint", "24h · history", "obs 5 d ago". (R5, R11.)
7. **Keyboard first, but discoverable.** Keys 1–5 for destinations, j/k, `/`, r, `?`, plus Enter to open and s/n to save/note. Each key is shown once, in the footer hint line. (R2, R8.)
8. **Calm visual language.** Hairline-separated panes, no cards-in-cards, no shadows, no gradients, a single accent. Numbers in a tabular mono face.

---

## 4. Navigation: five destinations

| Key | Destination | Job | Merges (old views) |
|---|---|---|---|
| 1 | **Monitor** | Run the workflow on incoming items. | Dashboard (event list + right panel) |
| 2 | **Feed** | Read everything, by source, including Telegram. | Feed, Telegram (now a source filter) |
| 3 | **Markets** | Look up a contract or asset. See large trades and watched wallets. | Contract lookup, Wallets, pinned watchlist |
| 4 | **Research** | Dossiers, claims, hypotheses, upcoming, places, vessels. | Research (+ Vessels sub-tab) |
| 5 | **Sources & alerts** | Is collection healthy? What fired? | Sources, Alerts |

During migration, keys 6 and 7 stay as aliases (6 → Research, 7 → Sources & alerts) and old `#view=` hashes redirect. Remove the aliases one release later.

Top bar (desktop): product name · 5 destinations · search (`/`) · health line · Refresh (r). That is five controls.
Phone: a bottom tab bar with the same 5 destinations (≥ 48 px targets). Health is folded into one line under the title.

---

## 5. Visual language and tokens

### 5.1 Type
- **IBM Plex Sans** 400/500/600 for UI and reading. Its sibling **IBM Plex Sans Arabic** covers Persian/Arabic headlines with matching metrics (`font-family: 'IBM Plex Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif`).
- **IBM Plex Mono** 400/500 for numbers, ages, times, addresses and IDs, always with `font-variant-numeric: tabular-nums`.
- Do not use Inter, Roboto or Arial (the current `styles.css` lists Inter/Roboto as fallbacks; replace them).

| Token | Size / line | Use |
|---|---|---|
| `--fs-xs` | 11 / 16 | footer key hints, axis labels |
| `--fs-sm` | 12 / 18 | meta lines (outlet, age), table cells |
| `--fs-md` | 14 / 20 | body, list headlines |
| `--fs-lg` | 17 / 24 | reading-pane headline, contract title |
| `--fs-xl` | 28 / 32 | the one headline number (mono) |

### 5.2 Colour (dark is the default; light is a full equal)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0B0D0F` | `#F4F4F1` | app background |
| `--s1` | `#111417` | `#FFFFFF` | panes |
| `--s2` | `#171B1F` | `#F7F7F4` | hover, drawer background |
| `--sel` | `#14263A` | `#E4EEFA` | selected row |
| `--rule` | `#252B31` | `#DCDDD6` | hairlines |
| `--t1` | `#E7E9EB` | `#111315` | primary text |
| `--t2` | `#AEB5BC` | `#3D444B` | secondary text |
| `--t3` | `#8A939B` | `#5A626A` | meta (≥ 4.5:1 on `--s1` in both themes) |
| `--acc` | `#6CB4FF` | `#0A5FC2` | focus ring, links, selected marker, price series |
| `--pub` | `#F2A65A` | `#A8530A` | publication-time marker (orange; differs from the blue series in lightness too) |
| `--warn` | `#E8B341` | `#8A5A00` | STALE glyph |
| `--bad` | `#FF8373` | `#B42318` | FAILED glyph |
| `--aff` | `#C9A8FF` | `#6B3FB8` | "state-affiliated" disclosure text |

Rules:
- One accent. Direction (▲/▼) is drawn in `--t1`, never green or red. Up is not "good" (this matches the existing `WatchlistBar` rule).
- Tier badges are **neutral** (outlined `--t2`), not traffic-light colours. The tier describes the source class, not truth. "State-affiliated" is a separate word label in `--aff`.
- Hairlines separate panes. No drop shadows, gradients, or left-border accent cards.

### 5.3 Spacing and shape
4-px base: `4, 8, 12, 16, 24, 32`. Pane padding is 16. List rows are at least 56 desktop / 64 phone. Controls are 32 desktop and **44 on touch** (`@media (pointer: coarse)`). Radius is 4 on controls and 0 on panes.

### 5.4 Honesty markers (the only state vocabulary)
Each marker is a glyph + a short word in `--t2`. The glyph alone carries the colour, and the word carries the meaning, so the marker survives greyscale and CVD.

| State | Marker | Example |
|---|---|---|
| OK | *(none)* | Absence is the healthy state. Age is still shown: `obs 34 s ago`. |
| Stale | `◐ stale` | `◐ stale · 4 h` |
| Failed | `✕ failed` | `✕ failed · 3 tries` |
| Not connected | `○ not connected` | `○ not connected · access gated` |
| Gap | `∅ gap` + reason | `∅ gap · needs 34 hourly points, has 21` (never 0) |
| Delayed (normal for provider) | `◷ delayed` | `◷ delayed · normal for IMF PortWatch` |
| Demo seed | full-width hatched line | `DEMO SEED — not live · captured Oct 9, 2026 · nothing is being fetched` |

Required labels that are always visible: tier (`T1`/`T2`/`T3`), `state-affiliated`, `untranslated`, `approx.` location, the price basis, and "coincident, not causal" beside any price-around-item number.

### 5.5 Number formatting
- Probability: `18.5%` (1 dp). Change: `+0.4 pp` with an explicit sign, and its window stated (`24h`).
- Money: `$126.2K`, `$14.45M`. USDC integers: `3,185 USDC`. Share price: `91.0¢`.
- Time: relative inline (`34 s`, `12 min`, `4 h`, `5 d`). Absolute in the drawer or tooltip, in local time with its offset (`Oct 9, 2026, 08:29 PM GMT+8`).
- Missing value: `—` followed by a reason within reach (marker or tooltip). Never `0`.

---

## 6. Screens (artboards)

The four artboards are on the canvas. Values on them are copied from `docs/screenshots/*` (the seed captured 2026-10-09) and are tagged **layout sample**. Chart lines are illustrative shapes and are labelled as such.

### 6.1 Monitor — desktop (`Main.dc.html`)
- Two columns: **Items** (400 px) | **Reading pane** (fluid, max 880 px of content).
- Items: the top-bar search (`/`) filters this list. The list header has one **Filter** button (topic / tier / region / include filtered-out go into a popover). The count line reads "400 items · newest first". Each row has outlet · tier · age on line 1, the headline on line 2, and on line 3 only "touches N" plus place. Selected row: `--sel` background and a ▸ glyph.
- Reading pane, top to bottom, numbered to match the workflow:
  1. **What happened**: outlet, tier, published/collected times, headline, `original ↗`.
  2. **Touches**: up to 5 linked contracts/assets as rows (name · price with basis · 24h change). Click a row to select it for the chart. "Show all N" reveals the rest.
  3. **Price around publication**: contract header (3 numbers), range selector, step-line chart with the dashed publication line, and one sentence: change across publication, or `∅ gap` with its reason. Below it: "Coincident, not causal." `Chart options` is a single button at the chart's top right.
  4. **Save**: `Save to dossier` (primary) and `Add note`. Both act on the item + selected contract pair.
- Top bar health line: `41 sources · ◐ 3 stale · ○ 1 not connected`. Clicking it goes to Sources & alerts.
- Footer: `1–5 views · j/k items · / search · r refresh · ? keys`.

### 6.2 Monitor — phone (`Mobile.dc.html`, 375 × 812)
- A list of items, the same as desktop. Tapping a row pushes the reading pane as a full screen with the same four steps stacked. The artboard shows the list with the reading sheet opened over it.
- The bottom tab bar has the 5 destinations. Search and Filter share one row. All targets are ≥ 44 px.

### 6.3 Contract detail (`Detail.dc.html`)
Opened from a Touches row ("Open contract") or from Markets.
- Header: title, source (Polymarket/Kalshi), 3 numbers. A `Details` disclosure holds bid/ask, volume, liquidity, hourly move vs its history, provider-reported changes and rules.
- Chart with the **Chart options** menu shown open (to document it): overlays SMA/EMA 24×1h and 72×1h, Bands 20×1h ±2σ, sub-plots RSI 14×1h and MACD 12/26/9×1h, axis Auto / 0–100%, large-trade markers. Every option is off by default. A note in the menu says these describe the sampled series and are not trading signals.
- Below the chart: **Items around this contract** (the reverse direction of the workflow) and **Large trades** as an expandable section (collapsed).

### 6.4 Research — claim review (`Research.dc.html`, light theme)
- Three columns collapse to one: dossier outline (left), claim being reviewed (centre), evidence + review (right drawer).
- The claim card shows the exact excerpt, source and times, the structured fields (actor / action / place / stated time / attribution; "unknown" stays "unknown"), the origin-group count, and the "same story cluster ≠ same incident" wording.

---

## 7. Mapping artboards → existing components

| Artboard region | Existing component(s) | Change |
|---|---|---|
| Top bar, 5 destinations, health line | `StatusBar.tsx`, `shortcuts.ts`, `navigation.ts` | Reduce nav to 5. Collapse pills into one health line (the per-source pills move to Sources). Add key aliases 6/7. |
| Items list | `EventList.tsx` | Move the filters into one Filter popover. Drop chips other than place. Show "touches N". Tier badge goes neutral. |
| Reading pane steps 1–4 | `RightPanel.tsx` (split into `ItemSummary`, `TouchesList`, `PriceAroundItem`, `SaveBar`) | Split by step. Existing `ResearchActions.tsx` becomes `SaveBar`. |
| Contract header (3 numbers + Details) | contract head inside `RightPanel.tsx` | Remove the 4×3 stats grid and move it into a `<details>` drawer. |
| Chart | `ProbChart.tsx`, `SubPane.tsx`, `useChartTheme.ts` | Keep. Set step line and publication marker colour from the tokens. |
| Chart options menu | `IndicatorControl.tsx` | Same options in a single popover. Defaults off. Saved choices are respected. |
| Assets (sensors) in Touches | `SensorPanel.tsx`, `WatchlistBar.tsx` | Sensor values appear as Touches rows. The watchlist strip leaves Monitor and pins move to Markets. |
| Map | `MapPanel.tsx`, `baseMap.ts` | Off Monitor. Available in Feed as a "Map" toggle and in Research › Places. |
| Feed | `FeedView.tsx`, `TelegramView.tsx`, `NewsTranslation.tsx` | Telegram becomes a source filter inside Feed. Its own scheduler settings move to Sources. |
| Markets | `WalletsView.tsx`, `charts.tsx`, `AssetGraph.tsx` | Tabs: Contracts · Large trades · Watched wallets. The disclaimer becomes one line + "About this data" disclosure. |
| Contract detail | `RightPanel.tsx` chart part, `WalletsView.tsx` trade rows | New route `#market=<id>&view=markets` reuses the same pieces. |
| Research | `research/*` (`Dossiers`, `Hypotheses`, `Upcoming`, `Places`, `Coverage`, `Vessels`, `EvidencePicker`, `SourceReader`, `common`) | Keep the sub-tabs. Vessels moves under Research (already there). The claim review layout follows 6.4. |
| Sources & alerts | `SourcesView.tsx`, `AlertsView.tsx` | Two tabs in one destination. |
| Keys help | `ShortcutsModal.tsx` | 1–5, j/k, Enter, s, n, /, r, ?, Esc. |
| Banners | `App.tsx` banners | Demo seed / paused / disconnected become one stacked "system line" under the top bar with the same wording. |

---

## 8. Phased migration (the app works after every step)

Each phase ends with `npm run check` and the existing acceptance screenshots (`npm run acceptance`). There is no big-bang rewrite.

| Phase | Change | Safe because |
|---|---|---|
| 0. Tokens | Add the §5 variables to `styles.css` next to the old ones, alias the old names to them, and load Plex fonts. | Pure CSS. Existing classes keep working. |
| 1. Navigation | Five destinations in `StatusBar`. Telegram renders inside Feed, Alerts inside Sources, and Wallets inside Markets, each as an existing component under a tab. Keys 6/7 and old hashes alias. | Components are reused unchanged. Only the container changes. |
| 2. Health line | Collapse the pills into one line + a popover listing problem sources. | Same data (`status.sources`). The full per-source list is still in Sources. |
| 3. Reading pane | Split `RightPanel` into the four step components. Contract header → 3 numbers + `<details>`. | Each step reuses existing JSX. Only the order and grouping change. |
| 4. Chart options | Wrap `IndicatorControl` in a popover. Change the defaults for new users only. | Stored preferences (`useDraft`) are honoured. |
| 5. Items list | One Filter popover. Simplified row. | Filter state is unchanged (`dashboard-topic`, etc.). |
| 6. Markets + Contract detail | Add the route and reuse the chart. Add the Large trades tab. | Additive. |
| 7. Cleanup | Remove the watchlist strip from Monitor, delete dead CSS and the key aliases. | Only after phases 1–6 have shipped. |

Constraint while another agent edits chart components: phases 0–2 and 5 do not touch `ProbChart.tsx`, `SubPane.tsx` or `IndicatorControl.tsx`, and can go first.

---

## 9. Responsive and accessibility
- Breakpoints: ≥ 1200 two columns; 768–1199 list collapses to 340 px and the reading pane scrolls; < 768 list only, and the reading pane pushes full-screen (Back = Esc or the back button). This was checked at 375 px.
- Text contrast ≥ 4.5:1 in both themes (`--t3` is the lowest and passes on `--s1`/`--s2`). Graphical marks ≥ 3:1.
- No state is conveyed by colour alone (§5.4). Direction uses ▲/▼ glyphs.
- Touch targets ≥ 44 px on coarse pointers. Real `<button>`/`<a>`/`<input>` with labels. Visible 2 px `--acc` focus ring.
- RTL headlines get `dir="auto"`. Persian/Arabic text keeps `untranslated` until translated.
- `prefers-reduced-motion`: no chart animation.

---

## 10. What I removed and why

| Removed from the default view | Why | Where it went |
|---|---|---|
| Seven top-level views | Too many destinations for one workflow. Telegram, Alerts and Wallets are facets of other jobs. | Merged into 5 (§4). Keys 6/7 alias for one release. |
| Row of per-source health pills in the header | It took two lines and pulled the eye to plumbing. | One health line with counts and markers. Detail lives in Sources & alerts. |
| Watchlist / sensor tile strip above the dashboard | It competed with the workflow and repeated values the Touches list shows in context. | Pins live in Markets. Sensors appear as Touches rows when an item touches them. |
| 4×3 contract stats grid (1h, 24h, hourly vs history, provider 24h/7d, bid/ask, volume, liquidity, resolves, observed, rules) | Too many numbers to read at a glance. | Header keeps 3 numbers (price + basis, 24h change, resolves). The rest is in **Details**. |
| Always-visible overlay checkboxes, sub-plot toggles, axis switch, large-trade toggle | They were controls for an expert step most visits don't need. | One **Chart options** menu, all off by default. |
| Map panel on the dashboard | Locations are often approximate, and the map took a third of the screen for little decision value. | Feed "Map" toggle and Research › Places. |
| Topic / tier / region selects + "include filtered-out" checkbox above the list | Four controls before the first item. | One Filter popover. Active filters show as one summary line ("2 filters"). |
| Chip rows on list items (topic tags, asset counts, contract counts) | Visual noise on every row. | Place stays. "touches N" replaces asset/contract chips. Topics show in the reading pane. |
| "Workspace layout" sliders (news width / chart share) | Layout tuning is not part of the job. | A sensible fixed split. The pane divider can still be dragged later if requested. |
| v1 artboards Wallets/Alerts/Sources/Vessels (never published) | The owner asked for fewer, calmer artboards. | The patterns are covered in §6–7. They can be drawn once Monitor is approved. |

Nothing that carries an honesty label was removed. Tier, state-affiliation, untranslated, approx., stale/failed/not connected, gaps with reasons, price basis and "coincident, not causal" all remain visible by default.

---

## 11. Implementation progress (2026-10-10)

| Phase | State | Notes |
|---|---|---|
| 0 Tokens | Done | Spec colours in `styles.css` for light and dark (contrast pairs checked ≥ 4.5:1), `--on-accent` token so selected controls stay readable on the lighter dark-theme accent, tier badges neutral (state-affiliated in `--aff`), tabular figures, Inter/Roboto removed from the stack. IBM Plex is used only if installed; no font CDN is contacted (self-hosting is a later step; seed mode must stay offline). |
| 1 Navigation | Done | Five destinations. Feed ⇄ Telegram analysis and Sources ⇄ Alerts are sub-tabs over the unchanged pages. Keys 1–5; 6/7 aliases; `b` opens the briefing. Old `#telegram` / `#alerts` hashes still resolve. |
| 2 Health line | Done | One line with glyph + word (◐ stale, ✕ failed, ○ not connected / pending); per-source pills only in the popover. |
| 3 Reading pane | Partly | A *Touches* strip above the chart lists the linked contracts (price, "not evidence of impact"). The split of `RightPanel` into four step components and the 3-number header are not done (quote details were already a disclosure). |
| 4 Chart options | Done | Overlays, sub-plots, axis, large-trade toggle and chart actions inside one disclosure; summary shows how many are on. |
| 5 Items list | Done | One Filters disclosure; Change-briefing link under the list header. |
| 6 Markets + contract detail route | Not started | |
| 7 Cleanup | Partly | Workspace-layout sliders removed. Watchlist strip still on Monitor (collapsed). |
