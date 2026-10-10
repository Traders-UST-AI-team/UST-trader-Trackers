// Google News RSS search = HEADLINE DISCOVERY ONLY. Each item names its publisher; we store headline + a link (Google's redirect)
// and never any article text. Tier comes from the publisher, not from Google. Local research use; do not republish.
import { parseFeed, ingestParsed, type ParsedItem, type RssResult } from './rss.ts';
import { fetchText } from '../http.ts';
import type { NewsSource } from '../registry.ts';
import { XMLParser } from 'fast-xml-parser';

const TIER1 = /^(reuters|associated press|ap news|ap|afp|agence france-presse|bbc|bbc news|the guardian|the new york times|the wall street journal|wsj|financial times|ft|bloomberg|bloomberg\.com|the washington post|cnn|npr|pbs|pbs newshour|cbs news|nbc news|abc news|sky news|dw|dw news|the economist|un news|united nations|the times|the telegraph|le monde|politico)$/i;
const STATE = /(^|\b)(rt|rt\.com|sputnik|tass|xinhua|cgtn|china daily|global times|press tv|tasnim|fars news|irna|mehr news|al mayadeen|al-manar|trt world|anadolu|anadolu ajansı|daily sabah|kcna)(\b|$)/i;

export function publisherTier(name: string): { tier: 'Tier-1' | 'Tier-2' | 'Tier-3'; note: string } {
  if (STATE.test(name)) return { tier: 'Tier-3', note: 'state-affiliated outlet (state narrative)' };
  if (TIER1.test(name.trim())) return { tier: 'Tier-1', note: 'major editorial/wire' };
  return { tier: 'Tier-2', note: 'publisher not individually rated by this tracker (default)' };
}

const xp = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

export function parseGoogleNews(xml: string): ParsedItem[] {
  const base = parseFeed(xml); // gives title/link/date/guid
  const raw = xp.parse(xml)?.rss?.channel?.item ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const pubByGuid = new Map<string, string>();
  for (const it of arr) {
    const guid = typeof it.guid === 'object' ? it.guid['#text'] : it.guid;
    const src = typeof it.source === 'object' ? it.source['#text'] : it.source;
    if (guid && src) pubByGuid.set(String(guid), String(src));
  }
  const out: ParsedItem[] = [];
  for (const b of base) {
    const publisher = pubByGuid.get(b.externalId) ?? /\s-\s([^-]+)$/.exec(b.title)?.[1]?.trim() ?? null;
    if (!publisher) continue; // unattributed headline: cannot be tiered, skip
    const title = b.title.replace(new RegExp(`\\s+-\\s+${publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim();
    const t = publisherTier(publisher);
    out.push({ ...b, title, summary: '', publisher, tier: t.tier, originating: `${publisher} (headline via Google News search; ${t.note})` });
  }
  return out;
}

export async function ingestGoogleNews(src: NewsSource): Promise<RssResult> {
  const q = encodeURIComponent(src.query ?? '');
  const xml = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US%3Aen`, { retries: 2 });
  const items = parseGoogleNews(xml).slice(0, src.maxItems);
  if (!items.length) throw new Error('Google News returned no attributable items');
  return ingestParsed(src, items);
}
