// NGA Maritime Safety Information — broadcast navigational warnings (HYDROPAC / HYDROLANT / HYDROARC / NAVAREA IV / XII).
// Official public REST API, documented in NGA's OpenAPI spec (https://msi.nga.mil/api/v3/api-docs/public-api, viewer
// https://msi.nga.mil/api/swagger-ui/index.html). No key. Reachability and response shape verified 2026-10-09
// (fixture: server/fixtures/nga_broadcast_warn.json). The plan's I2 gate ("reachable + real fixture before connecting") is met.
// Only warnings about Middle East waters or coasts are stored. A warning describes a declared hazard or operation and its validity;
// it is not an incident report. "Active" includes long-running warnings issued years ago — they appear as late finds, never as new.
import { fetchJson } from '../http.ts';
import { ingestParsed, outletKey, type ParsedItem, type RssResult } from './rss.ts';
import type { NewsSource } from '../registry.ts';

export const NGA_URL = 'https://msi.nga.mil/api/publications/broadcast-warn?status=active&output=json';
export interface NgaWarning { msgYear: string; msgNumber: string; navArea: string; subregion: string; text: string; status: string; issueDate: string; authority: string; cancelDate?: string; cancelNavArea?: string; cancelMsgYear?: string; cancelMsgNumber?: string }
const AREA: Record<string, string> = { P: 'HYDROPAC', A: 'HYDROLANT', C: 'HYDROARC', '4': 'NAVAREA IV', '12': 'NAVAREA XII' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ME_WATERS = /\b(PERSIAN GULF|ARABIAN GULF|GULF OF OMAN|STRAIT OF HORMUZ|RED SEA|GULF OF ADEN|BAB[- ]EL[- ]MANDEB|SUEZ|GULF OF AQABA)\b/i;
const ME_COAST = /^(IRAN|IRAQ|KUWAIT|SAUDI ARABIA|BAHRAIN|QATAR|U\.A\.E|UNITED ARAB EMIRATES|OMAN|YEMEN|ISRAEL|LEBANON|SYRIA|EGYPT|JORDAN|DJIBOUTI|ERITREA)\.?$/i;

/** Military date-time group "081538Z MAY 2024" → ISO UTC; null when it does not parse (the item is then skipped, never re-dated). */
export function parseDtg(s: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})$/.exec((s ?? '').trim().toUpperCase());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[4]);
  if (mon < 0) return null;
  const t = Date.UTC(Number(m[5]), mon, Number(m[1]), Number(m[2]), Number(m[3]));
  return Number.isFinite(t) && new Date(t).getUTCDate() === Number(m[1]) ? new Date(t).toISOString() : null;
}

export function ngaItems(rows: NgaWarning[]): { items: ParsedItem[]; skipped: number } {
  const items: ParsedItem[] = []; let skipped = 0;
  for (const w of rows) {
    const lines = String(w.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const head = lines.slice(0, 2);
    const me = ME_WATERS.test(head.join(' ')) || head.some((l) => ME_COAST.test(l));
    const at = parseDtg(w.issueDate);
    if (!me || !at || !w.msgNumber || !w.msgYear || !w.navArea) { skipped++; continue; }
    const area = AREA[w.navArea] ?? `area ${w.navArea}`;
    const id = `${area} ${w.msgNumber}/${String(w.msgYear).slice(-2)}`;
    const subject = lines.slice(0, 3).join(' ').replace(/\s+/g, ' ');
    items.push({
      externalId: `${w.navArea}-${w.msgYear}-${w.msgNumber}`,
      // The documented query for exactly this message (no undocumented deep link is constructed).
      url: `https://msi.nga.mil/api/publications/broadcast-warn?navArea=${encodeURIComponent(w.navArea)}&msgYear=${w.msgYear}&msgNumber=${w.msgNumber}&output=json`,
      title: `${id} — ${subject.length > 150 ? subject.slice(0, 147) + '…' : subject}`,
      summary: `${lines.join(' ').replace(/\s+/g, ' ').slice(0, 1500)} [Status: ${w.status === 'A' ? 'in force' : w.status}${w.cancelDate && w.cancelDate !== 'None' ? `; cancel ${w.cancelDate}` : ''}.]`,
      publishedAt: at, timePrecision: 'instant', originating: w.authority && w.authority !== 'None' ? `Relayed from ${w.authority.replace(/\.$/, '')}` : 'NGA', countries: [],
      forceRelevant: true, outlet: outletKey('NGA MSI'),
    });
  }
  return { items, skipped };
}

export async function ingestNga(src: NewsSource): Promise<RssResult> {
  const body = await fetchJson<{ 'broadcast-warn'?: NgaWarning[] }>(src.url, { retries: 2 });
  if (!Array.isArray(body['broadcast-warn'])) throw new Error('NGA response has no broadcast-warn array (schema changed?)');
  return ingestParsed(src, ngaItems(body['broadcast-warn']).items);
}
