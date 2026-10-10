# Demo runbook

## Before the meeting (10 minutes)

1. `npm install` (once) and `npm run dev` → http://localhost:5173. First load on an empty database takes ~70 s; afterwards the page opens instantly from cache and refreshes in the background.
2. Check the **health summary** (top bar, "34 sources · N OK"; click for the full list): problem sources are also shown inline. Known NOT CONNECTED: ReliefWeb (bot-blocked). If something is FAILED/STALE, say so — don't hide it.
3. **Fallback**: if the network is unreliable at the venue, run `npm run demo` (port 5174) instead. It loads `data/demo_seed.json` — a snapshot of *real* data — with a yellow **DEMO SEED — not live** banner and refresh disabled. The seed **excludes Telegram** by design (third-party content under Telegram's terms); use the live app for the Telegram tab. Re-capture the seed on the morning of the demo while online: `npm run seed:export`.
4. `npm test` (44 tests), `npm run typecheck` and `npm run acceptance` (14/14) should be green; `/api/health` should say ok or degraded (never down).

## 5-minute walkthrough

1. **The page** — left: normalised news/official feed with publisher tier and affiliation; right: prediction-market contract with probability history. Point at the pills: "every source's health is visible; failures leave old data on screen, labelled".
1b. Use the **scope filter** ("Energy & shipping focus") to cut the feed to the demo's subject; say how it is defined (topics, chokepoint/energy entities, or a mapped asset).
2. **Click a Hormuz/shipping event** (e.g. a Maersk advisory or an IRGC/Hormuz story). Show: source excerpt + link to the original (we store headline+excerpt only), the *place named in the text*, entities, the "scope limit" on single-carrier advisories.
2b. In the event detail show **Mapped reference assets**: the table says *why* each asset is linked (named in the text / same reported location), lists only **cited** company relationships ("no sourced relationship on file" is a normal answer), and the small graph shows event → asset → company. Say: linking is not evidence of damage.
3. **Linked contracts** — show *why* each matched (entities + topic). Click one: the chart draws the item's publication time; read the "coincident timing only — not evidence of cause" line aloud. Mention Kalshi vs Polymarket are separate venues (the "Same question on the other venue?" box lists unverified text-similar candidates with warnings; a price difference appears only for pairs a named person has verified — none yet) with different units (USD vs contracts) and are never merged.
4. **Related coverage** — a multi-outlet story: "N outlets · independence groups assumed". Stress: several outlets ≠ confirmation.
5. **Sensors tab** — IMF PortWatch transit counts for Hormuz vs Bab el-Mandeb/Suez/Cape (the series Kalshi's Hormuz contracts settle on), Brent, air traffic, internet routing. Each panel names its provider, latest observation and caveat; the red line is the selected item's publication time (coincident timing only).
6. **Map tab** — event markers (solid = city/point, dashed = country-level approximate); static reference assets with source links and the caveat that these are dated background, not status.
7. **Telegram tab** — show the viewpoint box first (the channel calls itself "independent, but not unbiased"), then the cross-check funnel ("no match ≠ false; match ≠ verified"), the entity network and one post with video in the detail view. Say plainly: analysis is rule-based; no model touches Telegram text; the media manifest is for your own later analysis, under Telegram's terms.
8. **Limits slide (say these unprompted)**: locations are text-derived (about two-thirds country-level); Arabic/Persian rules unverified by a native reader; event time = publication time; link precision measured at roughly half clearly relevant / few clearly wrong / rest borderline (see `AGENT_LOG.md`); UKMTO/ACLED/ReliefWeb/GDELT not connected yet and why.

## Questions to put to SNT (from the planning doc)

Which event would you actually click? What do you already get from existing tools? Which relationship or context is hard to find today? Which sources would you add/remove? Would this replace any daily reading or add another screen? Which errors would make you stop trusting it?

## If something breaks live

| Symptom | Action |
|---|---|
| Blank page | Hard refresh; the panels have error boundaries so one failure shouldn't blank everything — read the red message; check terminal log |
| Pills FAILED after network change | Click **Refresh now**; stored data stays visible meanwhile |
| Chart says "No price history available" | Provider returned none; nothing is invented — pick another contract |
| Port busy | `PORT=5180 npm run dev` |
| Need a clean slate | stop server, delete `data/tracker.sqlite*`, restart (or use `npm run demo`) |
