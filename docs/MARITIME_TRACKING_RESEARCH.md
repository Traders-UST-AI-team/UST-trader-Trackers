# Maritime tracking and route resources

Research date: 9 October 2026. This is an implementation reference, not an implemented integration. Provider connectivity, credentials and regional coverage have not been tested from the production server.

## Recommended approach

Use a free-first, two-stage approach: add public reference links and improve the existing aggregate maritime indicators first; then run a bounded AISstream regional pilot. Public ship maps are useful for human investigation, but a publicly visible map does not establish a free automated data feed, historical archive or redistribution entitlement.

Keep three kinds of map layer distinct:

- **Observed AIS positions and tracks:** positions actually received, with source and timestamps; gaps remain visible.
- **Reported voyage destination and ETA:** vessel-reported fields, not confirmation that the vessel will arrive there.
- **Illustrative routes:** generated paths between selected ports; clearly labelled estimates, never presented as actual voyages.

## Resource assessment

| Resource | Useful data or workflow | Access and limitations | Plan decision |
| --- | --- | --- | --- |
| [MarineTraffic](https://www.marinetraffic.com/) / Kpler | Public vessel investigation; authenticated AIS APIs for position and voyage information | API access is separate from website browsing. Kpler's current Maritime 2.0 documentation requires an access token and offers a trial. Legacy Kpler Vessels REST documentation is explicitly discontinued. | Reference links first; defer paid integration and verify current endpoint/product with provider if later selected. |
| [VesselFinder](https://www.vesselfinder.com/) | Public vessel investigation; APIs for positions, port calls, expected arrivals, vessel particulars and shortest sea routes | API uses purchased credits or subscriptions; a trial can be requested. This is not an unlimited free API. | Reference links first; paid adapter optional later. |
| [MyShipTracking](https://www.myshiptracking.com/) | Public live map; terrestrial vessel status, history tracks and port calls through API | Trial key has 2,000 coins and lasts at most 10 days. Historical tracks can be incomplete because coverage is terrestrial. Basic API plan currently lists EUR 90/month before VAT. | Reference links first; do not describe the trial as a permanent free source. |
| [AISstream](https://aisstream.io/) | Free live AIS WebSocket messages filtered by region and optionally MMSI/message type | Requires an API key and backend connection. No uptime SLA or durable event replay; missing delivery and receiver gaps must be expected. | Best candidate for a limited free live-data pilot, subject to regional coverage measurement. |
| [AISHub](https://www.aishub.net/) | Combined AIS data in JSON/XML/CSV for qualifying contributors | Requires an operational receiver and own raw feed; API qualification includes station coverage and uptime requirements. Requests at most once per minute. | Conditional future source; not available merely by registering. |
| [IMF PortWatch](https://portwatch.imf.org/) | Daily port calls, shipment estimates and chokepoint transit indicators | Aggregate activity estimates; not a raw vessel-position or full individual-voyage feed. Latest values can be revised. | Retain as the main maritime indicator baseline. |
| [searoute-py](https://github.com/genthalili/searoute-py) | Open-source generation of GeoJSON sea routes between coordinates | Its README describes visualization routes, not navigation. Generated paths do not establish observed vessel movement. | Optional illustrative route overlay; defer Python runtime addition until useful. |

Primary documentation: [MarineTraffic AIS API](https://servicedocs.marinetraffic.com/), [Kpler Maritime 2.0](https://servicedocs-sm.kpler.com/maritime-2-0/), [discontinued legacy Vessels API](https://servicedocs-sm.kpler.com/vessels-api/), [VesselFinder API products and credits](https://api.vesselfinder.com/docs/), [VesselFinder trial FAQ](https://api.vesselfinder.com/docs/faq.html), [MyShipTracking API and trial limits](https://api.myshiptracking.com/), [MyShipTracking pricing](https://api.myshiptracking.com/api-pricing).

AISstream advertises free access on its [homepage](https://aisstream.io/). Its [documentation](https://aisstream.io/documentation) specifies server-only access, required bounding boxes, optional MMSI filters up to 200 per subscription, three subscribed connections per account and three open connections per originating IP. It requires subscription within three seconds, continuous consumption and reconnects with backoff; compression reduces bandwidth pressure. The documented stream provides no durable replay, so this plan builds history from locally captured messages. No historical-query endpoint was verified in this research; that is not proof that the provider cannot offer another product.

AISHub's [joining requirements](https://www.aishub.net/join-us) require own receiver data and, for combined API access, at least ten vessels in coverage and 90% uptime on seven-day averages, with limits on delay/downsampling. It requires contributor attribution and does not allow raw-data redistribution. Its [API documentation](https://www.aishub.net/api) documents the once-per-minute request limit and vessel/geographic filters.

PortWatch's daily activity measures are explained in the IMF's [methodology paper](https://www.imf.org/-/media/files/publications/wp/2025/english/wpiea2025093-print-pdf.pdf). Its [Hormuz disruption page](https://portwatch.imf.org/pages/cc317ba850e34c4dadbead6f7b336fb1) highlights AIS/GPS issues in the region. The [searoute-py README](https://raw.githubusercontent.com/genthalili/searoute-py/main/README.md) explains the generated visualization paths and GeoJSON output.

## Stage 1: reference links and aggregate indicators

1. Add a Maritime resource section containing provider name, link, data type and access classification: `public_reference`, `free_authenticated`, `contributor_access` or `paid_api`.
2. Provide vessel investigation links using MMSI/IMO only where the provider's documented URL format has been verified. Otherwise link to its homepage and provide the identifier to copy. Do not invent deep links.
3. Reuse the existing PortWatch adapter for chokepoint and port activity. Show observed date, fetched date, latest available value, seven-day average and change against a clearly defined historical baseline.
4. Preserve existing maritime incident and warning sources such as NGA/ASAM and UKMTO as reports. They are not vessel-position feeds.
5. Add ship identifiers found in source material as investigation metadata without asserting that similarly named ships are identical. Show the originating evidence.

## Stage 2: bounded AISstream pilot

Start with one or two configured bounding boxes, for example selected approaches to Hormuz or Bab el-Mandeb. These are candidate study regions, not coverage promises. Run a seven-day collection pilot before enabling automated maritime alerts.

Implementation requirements:

- Store `AISSTREAM_API_KEY` only on the backend. One background consumer uses compression, reconnect backoff/jitter and complete subscription replacement. Never expose the provider key or connect browsers directly to AISstream.
- Feature flag the integration; no credential means an explicit disabled state. A failed stream must not block news, Telegram, market or PortWatch refreshes.
- Store normalized MMSI, optional IMO/name/type, coordinates, speed in knots, course, heading, source, provider timestamp when available, and local receive time. Convert AIS sentinel values to null. The AIS UTC-second field alone is not a complete date/time.
- Maintain a latest-position table and bounded historical samples, with configurable retention (initial proposal: 30 days). Rate-limit writes per vessel and apply a bounded queue; expose application-dropped message counts separately from connection failures.
- Use GeoJSON longitude/latitude order consistently. Add map clustering, ship-type/watchlist filters, stale-position styling and tooltips showing last observation. Do not interpolate across long gaps as though observed.
- Return latest positions and bounded track windows through this project's backend. Keep provider raw payloads out of public responses unless the provider's current use conditions support that use; verify storage, display, attribution and export conditions before selecting a production feed.
- Show source health, last received time, monitored region, observed vessel counts and stream downtime. Report missing coverage as unknown rather than zero traffic.

Pilot acceptance criteria:

1. Produce a daily report of stream uptime, distinct observed vessels, inter-message gaps, geographic coverage of received points, reconnects, queue drops and database growth. Observed counts measure this feed, not the complete fleet in that region.
2. Verify no key reaches the browser, reconnects do not duplicate positions, a restart retains saved history and stale points are visibly stale.
3. Compare a small manually selected vessel sample against public reference pages, recording timestamp differences and gaps without claiming the reference is ground truth.
4. If coverage is weak, keep the feature labelled experimental and retain PortWatch/reference links as the primary maritime workflow.

## Indicator and alert boundaries

First release: latest observation age, observed vessel count in a region, observed tanker/cargo mix where static data exists, and watchlist vessel new-position notifications. Label every metric with window and observed coverage.

Later, after sufficient history and measured coverage: sampled speed changes, long stationary periods, and observed entry/exit across specified geofences. Gate entry/exit detection on consecutive valid observations and maximum time gap; otherwise mark the transition uncertain. A lower AIS count alone must not trigger an assertion that a chokepoint is closed. Missing AIS must not be labelled intentional concealment. Confirmed incidents continue to come from attributed reports.

Defer complete ocean-wide tracking, satellite AIS guarantees, historical backfill before collection began, cargo inference, ownership inference and real-time global rerouting. Paid sources can be evaluated later if the measured free coverage cannot answer the user's questions. No paid account or subscription is part of this plan.
