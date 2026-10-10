// Event ↔ curated-asset linking. Only two evidence-backed relation types are produced (from SOURCE_RESEARCH §3):
//   explicitly_named        — an asset alias appears in the item's own text
//   same_reported_location  — the item's named place is that asset's place (same name, or a point/city/region place within 25 km)
// "nearby_context" and "analyst_inferred" are deliberately not generated. Linking never implies disruption or damage.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Asset, AssetRelation, AssetsFile } from '../shared/types.ts';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'assets.json');
let cache: { mtime: number; data: AssetsFile & { assets: (Asset & { aliases: string[] })[] } } | null = null;

export function loadAssets(path = FILE): AssetsFile & { assets: (Asset & { aliases: string[] })[] } {
  const raw = readFileSync(path, 'utf8');
  if (path === FILE && cache && cache.mtime === raw.length) return cache.data;
  const data = JSON.parse(raw);
  if (path === FILE) cache = { mtime: raw.length, data };
  return data;
}

export interface AssetLink {
  asset_id: string; name: string; type: string; relation: 'explicitly_named' | 'same_reported_location';
  evidence: string; relations: Pick<AssetRelation, 'company' | 'relation' | 'detail' | 'source_url' | 'valid_as_of' | 'verified_by'>[];
}

const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function linkAssets(text: string, location: { name: string; lat: number; lng: number; precision: string } | null, file = loadAssets()): AssetLink[] {
  const out: AssetLink[] = [];
  for (const a of file.assets) {
    const hit = a.aliases.find((al) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(al)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
    let relation: AssetLink['relation'] | null = null, evidence = '';
    if (hit) { relation = 'explicitly_named'; evidence = `“${hit}” appears in the item’s text`; }
    else if (location && location.precision !== 'country' && (location.name.toLowerCase() === a.name.toLowerCase() || a.aliases.some((x) => x.toLowerCase() === location.name.toLowerCase()) || (location.precision !== 'region' && km([location.lat, location.lng], [a.lat, a.lng]) <= 25))) {
      relation = 'same_reported_location'; evidence = `the item’s named place (${location.name}) is this asset’s place`;
    }
    if (!relation) continue;
    out.push({ asset_id: a.id, name: a.name, type: a.type, relation, evidence,
      relations: file.relations.filter((r) => r.asset_id === a.id).map(({ company, relation: rel, detail, source_url, valid_as_of, verified_by }) => ({ company, relation: rel, detail, source_url, valid_as_of, verified_by })) });
  }
  return out;
}
