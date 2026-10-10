# Review kits (human review required)

These files prepare work for **named human reviewers**. Nothing in this folder has been reviewed yet. The tracker does not treat any of it as verified until a reviewer completes it and the results are imported. Kits are frozen once generated; a new sample goes in a new versioned file and is never regenerated in place.

| Kit | Plan item | File(s) | What the reviewer does | How results come back |
|---|---|---|---|---|
| Link benchmark v1 | H2 | `link_benchmark_v1/review.csv`, `LABEL_GUIDE.md`, `manifest.json` | Labels 100 event–contract pairs relevant / irrelevant / ambiguous, with their name on every row, without looking at `predictions.json` (kept separate on purpose) | `npx tsx scripts/review-kit.ts score-links <labelled.csv>` → precision and within-sample recall per split, with Wilson 95 % intervals |
| Arabic/Persian corpus v1 | H3 | `language_corpus_v1.csv` | A native reader checks relevance, entities and place for 98 items (Arabic 42, Persian 56), noting negation and tense problems and corrections. Text is untranslated by design | Corrections become regression fixtures; until then the language caveats stay visible in the UI |
| Cross-venue pair queue | H4 | `pair_review_queue.csv` | A domain reviewer compares both rule texts, outcome direction, deadline and time zone, and settlement source for each candidate | `npx tsx scripts/review-kit.ts approve-pairs <reviewed.csv>` adds only rows with equivalent = yes, outcome alignment = same, both checks = yes, a reviewer and a rationale (≥ 20 characters) to `data/contract_equivalence.json` |
| Reference assets | J1 | `asset_review.csv` (`npx tsx scripts/asset-review.ts export`) | Confirms, corrects or rejects each asset fact, coordinate and company relationship | `npx tsx scripts/asset-review.ts import <file>` records decisions in `asset_reviews`; `data/assets.json` is edited by hand only |

Sampling details (benchmark): seed 20261009. Strata: 40 rule links, 40 pairs that share a named entity but were not linked, and 20 random pairs with no shared entity. At most 15 pairs come from any one source; the split into dev and eval is made by a hash of the pair id. Tune only on dev. The older `server/fixtures/link_benchmark.json` was labelled by an AI agent and does not count as independent.

Generated 2026-10-09 from a copy of the live database. The agent that built these kits made no labels or judgments in them.
