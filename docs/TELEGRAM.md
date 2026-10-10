# Telegram module

Collects posts from a **public** Telegram channel and shows them next to the news/market data, with rule-based analysis and a cross-check against our news feeds. Built for the channel *Middle East Spectator — MES* (`t.me/Middle_East_Spectator`); more channels can be added with `TELEGRAM_CHANNELS=chan1,chan2 npm run dev`.

## What it does

| Step | How | Where |
|---|---|---|
| Collect | Public web preview `https://t.me/s/<channel>`, newest page first, stepping back with `?before=<id>`; 1.5 s between requests; no API, no login, no cookies. First run back-fills 8 days; later runs fetch only new posts (and refresh view counts/edits on the newest page) and top up history 15 pages per run until the horizon is reached | `server/sources/telegram.ts` |
| Store | `tg_channels`, `tg_posts`, `tg_matches` (SQLite). Text, timestamps, views, forward/reply info, link preview, **media as URLs** (never downloaded) | `server/db.ts` |
| Analyse (rules only) | language by script; entities/topics/place via the same dictionaries as the news pipeline; the channel's **flag emojis** as its own country tags; claim types (kinetic, maritime, statement, casualties, diplomacy, deployment, energy, security-alert) by regex; **named sources** only when a name sits within one sentence of a reporting verb or after "according to / via / source:"; report kind (breaking claim / report / commentary / forward / media only) | `server/telegram-analysis.ts` |
| Cross-check | TF-IDF cosine between the post and news items within ±36 h, with entity tokens; **strong** = (≥2 shared entities & sim ≥ 0.40, or sim ≥ 0.50) *and* ≥2 shared non-entity words; weaker similarity is **weak** and not counted. Only posts from the last 48 h are assessed (the span all news feeds cover) | `server/telegram.ts` |
| Visualise | ECharts (posts/day, hour of day, topics, claim types, flags, named sources, lead/lag), Cytoscape.js (entity co-mention network), Leaflet (places), plus a feed with thumbnails, a per-post detail view and a media manifest | `src/components/TelegramView.tsx` |

## How to read it

- It is a **viewpoint-labelled discovery source**. The channel describes itself (verbatim, shown in the UI) as *"Independent, but not unbiased … Mainly focused on Iran & Resistance Axis."* Its posts are claims to check, not established facts, and are never mixed into the news tiers.
- **Views = reach, not accuracy.**
- **"No similar news item found" ≠ false.** It can mean: too new, outside the outlets we ingest, different wording, or that our short feeds don't reach back far enough. **A match ≠ verified**: outlets may be repeating the same claim.
- The **lead/lag chart** (who appeared first in *our* data) is descriptive, small-n, and not a statement about who had a story first anywhere.
- Places are the first place named in the text; country-level markers are approximate and dashed on the map. A place named is not a verified strike location.
- "Unattributed" means no named source near a reporting verb. It does not mean the post is wrong; many OSINT-style posts rely on video.

## Terms and what this tool deliberately does *not* do

- Telegram's API Terms (§1.5) bar using, accessing or aggregating Telegram platform data for **AI/ML** (training, fine-tuning, building or deploying models), and point to a separate *Content Licensing and AI Scraping* policy that this project could not read. The terms are written for apps built on the Telegram API; they say nothing about `t.me` web previews, so whether the preview is covered is **unestablished**. `t.me` has no `robots.txt` (404).
- Therefore: collection uses only the public preview at a low request rate; **all analysis is deterministic** (dictionaries, regexes, counting, TF-IDF similarity — no model, classifier, embedding or LLM touches Telegram text); **no media is downloaded**; the demo seed **excludes Telegram text** unless you opt in (`SEED_WITH_TELEGRAM=1 npm run seed:export`, for private use only).
- TF-IDF cosine is a fixed formula, not a trained model — but if you read §1.5 more broadly than I do, switch the module off: remove `telegram` from the jobs in `server/ingest.ts` (or set `TELEGRAM_CHANNELS=`) and nothing is collected.
- **Your plan to run other models on the videos/images falls under §1.5 and that unseen policy.** Please read them first; the dashboard stays out of that step by only exporting a manifest.

## Media for your own later analysis

`GET /api/telegram/media-manifest` (JSON) or `?format=csv` lists every photo/video the preview exposes: post URL, time, type, direct media URL (when the preview provides one), thumbnail URL, duration and caption. 246 items at last count (127 photos, 103 videos, 16 "not available in preview"). Telegram media links can expire; videos above the preview's size limit have no direct URL (open the post). The server never fetches these files.

## Known weaknesses

- Cross-check precision/recall is **unmeasured** beyond hand inspection of ~30 pairs; one false strong match was found and fixed (US Embassy alert ↔ Riyadh airport alert). There is a regression test for it. Treat strong matches as "probably the same development", weak ones as "maybe related".
- Rule-based attribution catches only names in my list ("Reuters", "Axios", "IDF"…). Sources named in other ways are missed; the 4–5% "claims citing a named source" figure is therefore a floor.
- English-only posts so far; Arabic/Persian posts would be handled by the small hand-written dictionary (unverified by a native reader).
- The preview shows ~20 posts per page, no deleted-message history, and may omit some media types.
- Only the newest 8 days are back-filled by default (`ingestTelegramChannel({ backfillDays })`).

## Extending

Add channels via `TELEGRAM_CHANNELS` (comma-separated). Channels are isolated: a failing one is recorded on its own row and never stops the others; the UI shows a picker when more than one exists and flags a channel whose last attempt failed or whose catch-up hit its 4-page cap (possible gap). Polling is part of the shared ingest cycle (15-minute source cadence, checked by a 10-minute timer) — **not** a guaranteed or real-time service; publication-to-collection lag has not been measured.

Also: add attribution names in `ATTRIB` (`server/telegram-analysis.ts`); add claim-type regexes in `CLAIMS`. Run `npm run telegram:review` to print sample matches and misses for hand-checking after any change, and add labelled pairs to a benchmark before claiming precision.
