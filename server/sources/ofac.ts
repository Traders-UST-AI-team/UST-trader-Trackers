// US Treasury OFAC "Recent Actions": official sanctions announcements. The page gives a title and a DATE only (no time of day),
// so items carry time_precision "date". Public HTML listing; first page only (10 most recent). Titles only — the linked notices
// name the designated parties; we do not interpret legal effect.
import { fetchText } from '../http.ts';
import { ingestParsed, outletKey, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

export function parseOfacListing(html: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  const rows = html.split(/<div class="[^"]*search-result views-row">/).slice(1);
  for (const row of rows) {
    const a = /<a href="(\/recent-actions\/[^"]+)"[^>]*>([^<]+)<\/a>/.exec(row);
    const d = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s*-\s*<a[^>]*>([^<]*)<\/a>/.exec(row);
    if (!a || !d) continue;
    const when = Date.UTC(Number(d[3]), MONTHS[d[1].toLowerCase()], Number(d[2]));
    const title = a[2].replace(/\s+/g, ' ').trim();
    out.push({
      externalId: a[1], url: `https://ofac.treasury.gov${a[1]}`, title: `OFAC: ${title}`, summary: `US Treasury OFAC recent action (${d[4].trim() || 'uncategorised'}). The notice lists the affected parties; no interpretation of legal effect is made here.`,
      publishedAt: new Date(when).toISOString(), timePrecision: 'date', originating: 'US Department of the Treasury, Office of Foreign Assets Control', countries: [], outlet: outletKey('US Treasury OFAC'),
    });
  }
  return out;
}

export async function ingestOfac(src: NewsSource): Promise<RssResult> {
  const items = parseOfacListing(await fetchText(src.url, { retries: 2 }));
  if (!items.length) throw new Error('OFAC listing parsed to zero rows (page structure changed)');
  return ingestParsed(src, items.slice(0, src.maxItems));
}
