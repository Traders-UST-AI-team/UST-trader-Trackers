# UKMTO / maritime advisory access

**Status:** UKMTO is the most valuable maritime incident source for Hormuz / Red Sea and it is **not connected**. `https://www.ukmto.org/` returns HTTP 403 to scripted requests (checked 2026-10-08/09). This tracker does not scrape past that, spoof a browser, or route around it.

## What is verified and what is not

| Claim | Status |
|---|---|
| The site returns 403 to a plain scripted GET with an honest user-agent | **Verified** (smoke test, `data/source_registry.json`) |
| UKMTO publishes an RSS feed or API | **Not verified.** The research file explicitly says not to assume one exists |
| UKMTO offers email alerts / data-sharing | **Not verified.** The 7-day plan lists "email alerts" as an integration route; whether and how UKMTO provides them must be confirmed with UKMTO directly |
| Terms of use for automated collection | **Not read** (the page is not reachable by script) |

## Permitted routes (what you can do)

1. **Ask UKMTO / JMIC.** Use the contact route on ukmto.org to ask for (a) a permitted data feed or API for research use, or (b) a subscription to their advisory/warning emails. Say what the use is (a local research dashboard, no redistribution).
2. **Once you receive advisory emails you are entitled to**, save each message as an `.eml` file into `data/inbox/` (Apple Mail: drag the message to a Finder folder; Outlook: *Save As → .eml*; Gmail: *Show original → Download*). The tracker ingests them automatically each cycle (`inbox` source, 15-min cadence).
3. **Describe the sender** in `data/inbox/senders.json` so tier/affiliation are right:

   ```json
   [{ "match": "ukmto.org", "name": "UKMTO advisory email", "tier": "Tier-2",
      "affiliation": "UK Maritime Trade Operations (reports relayed from vessel masters)",
      "scope": "Reports are as received from ship masters; not independently verified" }]
   ```
   Unknown senders default to an explicitly **unrated Tier-2**. Replace the `match` with whatever domain the real emails come from — I did not guess it.
4. The email parser is generic (RFC-822: encoded-word subjects, quoted-printable/base64, multipart, quote/signature stripping). Place names (Fujairah, Hormuz, Aden…) and entities are extracted by the same dictionaries as every other source; vessel type is not extracted yet.

## What not to do

- Do not point a headless browser or a rotating-proxy scraper at ukmto.org.
- Do not treat "no UKMTO items" as "no incidents". An empty inbox only means nothing was supplied.

## Meanwhile (already integrated, partial substitutes)

- Maersk Middle-East advisories (single-carrier scope), gCaptain / Splash247 trade press, EASA conflict-zone bulletins (airspace), FCDO travel-advice changes, PortWatch chokepoint transit counts.
- **Next best official source:** NGA Maritime Safety Information (navigational warnings and ASAM anti-shipping incident records, keyless JSON). It is unreachable *from this machine* (connection failure, not a block); retry from another network and, if it works, add an adapter against its documented schema with a real captured fixture.

## Test fixture caveat

`server/fixtures/inbox_sample.eml` is **synthetic** (its headers say so): it demonstrates the format handling and contains no real organisation's wording. Do not read it as a UKMTO message.
