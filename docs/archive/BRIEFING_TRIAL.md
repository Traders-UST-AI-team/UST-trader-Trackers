# Change-briefing trial (3–5 days)

Goal: find out what the briefing is missing or gets wrong before building anything else.

## Setup
- Keep the tracker running: `npm run dev` in a terminal (do not set `TRACKER_NO_AUTO_REFRESH`). The laptop must be awake; after sleep the next tick catches up.
- The briefing saves itself once each morning (after 07:00 local time) as "Automatic morning snapshot" — Research → Briefing → "N saved snapshots". Untick the box there to turn it off.
- Each morning open Research → Briefing (key `b`) **before** you check anything else, and read it as you normally would start your day.

## Questions to answer each day (2 minutes)
| # | Question | Where it points |
|---|---|---|
| 1 | Did you learn something from it that you would otherwise have found by hand? Which line? | what to keep |
| 2 | Did you find something important elsewhere that is not in it? What, and where did you see it? | missing source / link / rule |
| 3 | Any story group that joined unrelated items, or split one story into two? | grouping |
| 4 | Any contract listed that clearly did not move because of the item (or an obviously relevant contract that was not listed)? | links / thresholds (5 pp, hourly P95) |
| 5 | Any line you could not trace to its source in one click? | citations |
| 6 | Too long / too short? Which section did you skip? | layout |
| 7 | How many contracts were "no computable 24 h change" (see the grey ∅ lines)? | history gaps |

Write short answers in the snapshot note ("Save this briefing" with a note) or in the table below.

## Log
| Date | Learned (1) | Missing (2) | Grouping (3) | Contracts (4) | Citations (5) | Layout (6) | ∅ count (7) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## After the trial
Bring the log (and the saved snapshots — `GET /api/briefings`). Likely follow-ups, in order of what the log shows: fetch price history for all touched contracts so fewer are ∅; tune the 5 pp threshold or grouping; add a missing source; add equity sentiment or an FOMC text diff only if question 2 asks for them.
