// Adapter registry. A news/official/maritime source in registry.ts names its adapter; this file maps names to implementations.
// To add a source type: (1) write server/sources/<name>.ts exporting `ingestX(src: NewsSource): Promise<AdapterResult>`;
// (2) add it to ADAPTERS; (3) add a registry entry with `adapter: '<name>'`; (4) add a real-fixture test. The registry-integrity test
// fails if an entry names an adapter that is missing here.
import type { NewsSource } from './registry.ts';
import { ingestRss, type RssResult } from './sources/rss.ts';
import { ingestMaersk } from './sources/maersk.ts';
import { ingestFcdo } from './sources/fcdo.ts';
import { ingestOfac } from './sources/ofac.ts';
import { ingestEasa } from './sources/easa.ts';
import { ingestGoogleNews } from './sources/gnews.ts';
import { ingestInbox } from './sources/inbox.ts';
import { ingestNga } from './sources/nga.ts';

/** What every adapter returns: how many items it saw, how many were new, how many passed the Middle-East relevance rule. */
export type AdapterResult = RssResult;
/**
 * Contract an adapter must honour:
 *  - throw on failure (network, HTTP, parse): never return an empty result to mean "failed" (silent ≠ failed);
 *  - be idempotent: re-running adds nothing (storage dedupes on source + external id);
 *  - store only through storeParsed()/ingestParsed() so tiering, entity/topic/place extraction and revisions are uniform;
 *  - never evade a block (403/406/429/challenge) — surface it as an error.
 */
export type SourceAdapter = (src: NewsSource) => Promise<AdapterResult>;

export const ADAPTERS: Record<NonNullable<NewsSource['adapter']>, SourceAdapter> = {
  rss: ingestRss,
  maersk: ingestMaersk,
  fcdo: ingestFcdo,
  ofac: ingestOfac,
  easa: ingestEasa,
  gnews: ingestGoogleNews,
  inbox: ingestInbox,
  nga: ingestNga,
};

export const adapterFor = (src: NewsSource): SourceAdapter => ADAPTERS[src.adapter ?? 'rss'];
