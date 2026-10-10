// UK FCDO foreign travel advice: official, timestamped change log per country (gov.uk content API, public, no key).
// Value: a government's own advice-level changes (e.g. "advises against all but essential travel to …") dated to the minute.
// Scope: reflects the UK government's assessment for British nationals, not ground truth.
import { fetchJson } from '../http.ts';
import { ingestParsed, outletKey, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

const NAMES: Record<string, string> = { iran: 'Iran', israel: 'Israel', lebanon: 'Lebanon', iraq: 'Iraq', yemen: 'Yemen', 'saudi-arabia': 'Saudi Arabia', 'united-arab-emirates': 'United Arab Emirates',
  qatar: 'Qatar', kuwait: 'Kuwait', bahrain: 'Bahrain', oman: 'Oman', jordan: 'Jordan', syria: 'Syria', egypt: 'Egypt' };
const LEVEL: Record<string, string> = { avoid_all_travel_to_whole_country: 'advises against all travel to the whole country', avoid_all_but_essential_travel_to_whole_country: 'advises against all but essential travel to the whole country',
  avoid_all_travel_to_parts: 'advises against all travel to parts of the country', avoid_all_but_essential_travel_to_parts: 'advises against all but essential travel to parts of the country' };
const SECURITY = /regional tensions|strike|attack|missile|security|terror|conflict|advis(es|e|ing) against|no longer advises|airspace|flight|border|military|safety|evacuat|embassy|withdraw|unrest|protest/i;
const WINDOW_DAYS = 120;

interface FcdoDoc { title: string; base_path: string; details: { alert_status?: string[]; change_history?: { note: string; public_timestamp: string }[] } }

export function fcdoItems(doc: FcdoDoc, slug: string, now = Date.now()): ParsedItem[] {
  const country = NAMES[slug] ?? doc.title.replace(/ travel advice$/i, '');
  const level = (doc.details.alert_status ?? []).map((a) => LEVEL[a]).filter(Boolean).join('; ') || 'no travel warning level listed';
  const out: ParsedItem[] = [];
  for (const h of doc.details.change_history ?? []) {
    const ts = Date.parse(h.public_timestamp);
    if (!Number.isFinite(ts) || now - ts > WINDOW_DAYS * 86400_000) continue;
    const note = h.note.replace(/\s+/g, ' ').trim();
    if (!note) continue;
    out.push({
      externalId: `${doc.base_path}|${h.public_timestamp}`, url: `https://www.gov.uk${doc.base_path}`,
      title: `UK FCDO travel advice update — ${country}: ${note.length > 140 ? note.slice(0, 137) + '…' : note}`,
      summary: `${note} Current FCDO position (as of last read): ${level}.`, publishedAt: new Date(ts).toISOString(),
      originating: 'UK Foreign, Commonwealth & Development Office (travel-advice change log)', countries: [country],
      // Routine administrative edits (e.g. LGBT+ traveller info) are stored but not promoted as Middle East security developments.
      forceRelevant: SECURITY.test(note.replace(/[(‘'][^)’']*\bpages?\b[^)]*\)?/gi, ' ')), outlet: outletKey('UK FCDO'),
    });
  }
  return out;
}

export async function ingestFcdo(src: NewsSource): Promise<RssResult> {
  const items: ParsedItem[] = [];
  const errors: string[] = [];
  let ok = 0;
  for (const slug of Object.keys(NAMES)) {
    try {
      const doc = await fetchJson<FcdoDoc>(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`, { retries: 1 });
      items.push(...fcdoItems(doc, slug)); ok++;
    } catch (e) { errors.push(`${slug}: ${(e as Error).message.slice(0, 50)}`); }
  }
  if (ok === 0) throw new Error(`FCDO API unreachable for every country (${errors[0] ?? 'unknown'})`);
  const r = ingestParsed(src, items);
  if (errors.length) console.warn(`[fcdo] partial: ${errors.join('; ')}`);
  return r;
}
