// EASA Conflict Zone Information Bulletins (CZIBs): official aviation-risk assessments by airspace, with issue/revision/valid-until dates.
// Public HTML list + detail pages. Dates are day-precision (DD/MM/YYYY), so items carry time_precision "date".
// Scope: EASA's assessment for EU air operators — not a statement that any specific flight is or is not safe.
import { parse } from 'node-html-parser';
import { fetchText } from '../http.ts';
import { db } from '../db.ts';
import { extractEntities } from '../geo.ts';
import { ingestParsed, outletKey, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

const BASE = 'https://www.easa.europa.eu';

export interface Czib { number: string; subject: string; status: string; issue: string | null; revision: string | null; validUntil: string | null; path: string | null }

const dmy = (s: string | undefined): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s ?? '').trim());
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))).toISOString() : null;
};

export function parseCzibList(html: string): Czib[] {
  const out: Czib[] = [];
  for (const tr of parse(html).querySelectorAll('tr')) {
    const number = tr.querySelector('.czib_number')?.text.trim();
    const subject = tr.querySelector('.cz-title')?.text.replace(/\s+/g, ' ').trim();
    if (!number || !subject) continue;
    const dates = tr.querySelectorAll('td').map((td) => td.text.trim()).filter((t) => /^(\d{2}\/\d{2}\/\d{4}|N\/A)$/.test(t)); // issue, revision, valid until (header order)
    out.push({
      number, subject, status: tr.querySelector('.cz-status')?.text.trim() ?? 'Unknown',
      issue: dmy(dates[0]), revision: dmy(dates[1]), validUntil: dmy(dates[2]),
      path: tr.querySelector('a[href*="/czibs/"]')?.getAttribute('href') ?? null,
    });
  }
  return out;
}

export function parseCzibDetail(html: string): string | null {
  const el = parse(html).querySelector('.field-name-field-easa-cz-description .field-item');
  const t = el?.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'n/a');

export function czibItems(rows: Czib[], descriptions: Map<string, string>, now = Date.now()): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const r of rows) {
    const when = r.revision ?? r.issue;
    if (!when) continue;
    const age = (now - Date.parse(when)) / 86400_000;
    const me = extractEntities(r.subject).me.length > 0 || /middle east|persian gulf|gulf of oman/i.test(r.subject);
    // Keep Middle-East bulletins that are active or were withdrawn within the last 4 months; others (Ukraine, Mali…) are not this tracker's scope.
    if (!me || (r.status !== 'Active' && age > 120)) continue;
    const desc = descriptions.get(r.number) ?? '';
    out.push({
      externalId: `${r.number}|${day(r.revision ?? r.issue)}|${r.status}`, url: r.path ? `${BASE}${r.path}` : `${BASE}/en/domains/air-operations/czibs`,
      title: `EASA conflict-zone bulletin ${r.number}: ${r.subject}${r.status === 'Active' ? '' : ` — ${r.status.toLowerCase()}`}`,
      summary: `Status: ${r.status}. Issued ${day(r.issue)}${r.revision ? `, last revised ${day(r.revision)}` : ''}${r.validUntil ? `, valid until ${day(r.validUntil)} unless reviewed earlier` : ''}. ${desc ? `EASA description (excerpt): ${desc.slice(0, 520)}${desc.length > 520 ? '…' : ''}` : ''}`.trim(),
      publishedAt: when, timePrecision: 'date', originating: 'European Union Aviation Safety Agency (CZIB)', countries: [], forceRelevant: true, outlet: outletKey('EASA'),
    });
  }
  return out;
}

export async function ingestEasa(src: NewsSource): Promise<RssResult> {
  const rows = parseCzibList(await fetchText(`${BASE}/en/domains/air-operations/czibs`, { retries: 2 }));
  if (!rows.length) throw new Error('EASA CZIB list parsed to zero rows (page structure changed)');
  // Fetch EASA's own description for recent Middle-East bulletins we do not hold yet (≤6 per run, polite spacing from http.ts).
  const descriptions = new Map<string, string>();
  const have = db.prepare("SELECT summary FROM events WHERE source_id = ? AND external_id LIKE ? AND summary LIKE '%EASA description%' LIMIT 1");
  let fetched = 0;
  for (const r of rows) {
    if (fetched >= 6 || !r.path || r.status !== 'Active') continue;
    const when = r.revision ?? r.issue;
    if (!when || Date.now() - Date.parse(when) > 120 * 86400_000) continue;
    if (!(extractEntities(r.subject).me.length > 0 || /middle east|persian gulf|gulf of oman/i.test(r.subject))) continue;
    if (have.get(src.id, `${r.number}|${day(when)}|%`)) continue;
    try { const d = parseCzibDetail(await fetchText(`${BASE}${r.path}`, { retries: 1 })); if (d) descriptions.set(r.number, d); fetched++; }
    catch (e) { console.warn(`[easa] detail ${r.number}: ${(e as Error).message.slice(0, 60)}`); }
  }
  return ingestParsed(src, czibItems(rows, descriptions));
}
