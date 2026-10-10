// Maersk "News & Advisories": public pages, robots.txt allows /news/articles/*. One listing fetch + at most a few article
// fetches per run, only for Middle-East-related slugs. Reads <title>/description and JSON-LD dates; never full-article copying.
import { fetchText } from '../http.ts';
import { db } from '../db.ts';
import { canonicalUrl, decodeEntities, storeParsed, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

const ME_SLUG = /(middle-east|red-sea|hormuz|gulf|suez|houthi|bab-el|persian|iran|israel)/i;

export function extractArticleLinks(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/href="(\/news\/articles\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+)"/gi)) set.add(m[1]);
  return [...set];
}

export function parseArticle(html: string, url: string): ParsedItem | null {
  const og = (p: string) => new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`, 'i').exec(html)?.[1];
  const title = decodeEntities(og('og:title') ?? /<title>([^<]*)/i.exec(html)?.[1]?.replace(/\s*\|\s*Maersk\s*$/i, '') ?? '').trim();
  const desc = decodeEntities(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? og('og:description') ?? '').trim();
  const pub = /"datePublished":"([^"]+)"/.exec(html)?.[1];
  const mod = /"dateModified":"([^"]+)"/.exec(html)?.[1];
  const ts = pub ? Date.parse(pub) : NaN;
  if (!title || !Number.isFinite(ts)) return null; // no title or no publication time → not a usable record
  const modTs = mod ? Date.parse(mod) : NaN;
  return {
    externalId: url, url, title, summary: desc, publishedAt: new Date(ts).toISOString(),
    modifiedAt: Number.isFinite(modTs) ? new Date(modTs).toISOString() : null, originating: 'Maersk (carrier operational advisory)', countries: [],
  };
}

export async function ingestMaersk(src: NewsSource): Promise<RssResult> {
  const listing = await fetchText(src.url, { retries: 2 });
  const links = extractArticleLinks(listing);
  if (links.length === 0) throw new Error('listing contained no /news/articles links (page structure changed or JS-rendered)');
  const wanted = links.filter((l) => ME_SLUG.test(l)).sort().reverse().slice(0, src.maxItems);
  const items: ParsedItem[] = [];
  for (const path of wanted) {
    const url = canonicalUrl(`https://www.maersk.com${path}`);
    // Re-fetch an already stored article only if it is recent (advisories are edited in place), otherwise skip the request.
    const known = db.prepare('SELECT published_at, last_seen_at FROM events WHERE source_id = ? AND external_id = ?').get(src.id, url) as { published_at: string; last_seen_at: string } | undefined;
    if (known && (Date.now() - Date.parse(known.published_at) > 14 * 86400_000 || Date.now() - Date.parse(known.last_seen_at) < 30 * 60_000)) continue;
    const it = parseArticle(await fetchText(url, { retries: 2 }), url);
    if (it) items.push(it);
  }
  if (items.length === 0) return { fetched: wanted.length, inserted: 0, relevant: 0 };
  const r = storeParsed(src, items);
  return { ...r, fetched: wanted.length };
}
