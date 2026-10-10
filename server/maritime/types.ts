// J1 — conservative vessel-type extraction. A type is reported only when the text names it explicitly; every hit keeps its
// evidence span. "Vessel"/"ship" alone is "unspecified" — never upgraded to a tanker. Extraction describes the WORDING of an item;
// it does not establish what a vessel carries, who owns it or what happened to it.
export type VesselType = 'crude_tanker' | 'product_tanker' | 'chemical_tanker' | 'tanker' | 'lng_carrier' | 'lpg_carrier' | 'container_ship' | 'bulk_carrier'
  | 'general_cargo' | 'car_carrier' | 'passenger' | 'fishing' | 'naval' | 'small_craft' | 'unspecified';
export interface VesselTypeHit { type: VesselType; label: string; span: string; start: number; end: number }

// Ordered most-specific first; a span already claimed by a specific pattern is not re-used by a generic one.
const PATTERNS: [VesselType, string, RegExp][] = [
  ['crude_tanker', 'crude tanker', /\b(?:crude(?:[- ]oil)?|VLCC|ULCC|Suezmax|Aframax)\s+(?:oil\s+)?tankers?\b|\bVLCCs?\b|\bSuezmax(?:es)?\b|\bAframax(?:es)?\b/gi],
  ['product_tanker', 'product tanker', /\b(?:product|products|clean|refined[- ]products?)\s+tankers?\b/gi],
  ['chemical_tanker', 'chemical tanker', /\bchemical(?:\/products?)?\s+tankers?\b/gi],
  ['lng_carrier', 'LNG carrier', /\bLNG\s+(?:carriers?|tankers?|vessels?|ships?)\b/gi],
  ['lpg_carrier', 'LPG carrier', /\bLPG\s+(?:carriers?|tankers?|vessels?|ships?)\b|\bgas\s+carriers?\b/gi],
  ['tanker', 'tanker (type not specified)', /\b(?:oil\s+)?tankers?\b/gi],
  ['container_ship', 'container ship', /\bcontainer\s*(?:ships?|vessels?|carriers?)\b|\bcontainerships?\b|\bboxships?\b/gi],
  ['bulk_carrier', 'bulk carrier', /\bbulk\s+carriers?\b|\bbulkers?\b|\bdry[- ]bulk\s+(?:vessels?|ships?)\b/gi],
  ['general_cargo', 'general cargo ship', /\bgeneral[- ]cargo\s+(?:ships?|vessels?)\b/gi],
  ['car_carrier', 'car carrier', /\b(?:car|vehicle)\s+carriers?\b|\bro-?ro\s+(?:ships?|vessels?)\b/gi],
  ['passenger', 'passenger ship', /\b(?:cruise|passenger)\s+(?:ships?|liners?|vessels?)\b|\bferr(?:y|ies)\b/gi],
  ['fishing', 'fishing vessel', /\bfishing\s+(?:boats?|vessels?|ships?)\b|\btrawlers?\b/gi],
  ['naval', 'naval vessel', /\b(?:warships?|destroyers?|frigates?|corvettes?|aircraft carriers?|naval\s+vessels?|patrol\s+boats?)\b/gi],
  ['small_craft', 'small craft', /\bdhows?\b|\bskiffs?\b|\bspeedboats?\b|\bfast[- ]attack\s+craft\b/gi],
];
const GENERIC = /\b(?:merchant|commercial|cargo)\s+(?:ships?|vessels?)\b|\bvessels?\b|\bships?\b/gi;

export function extractVesselTypes(text: string): VesselTypeHit[] {
  const hits: VesselTypeHit[] = [];
  const claimed: [number, number][] = [];
  const free = (s: number, e: number) => !claimed.some(([a, b]) => s < b && e > a);
  for (const [type, label, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const s = m.index ?? 0, e = s + m[0].length;
      if (!free(s, e)) continue;
      claimed.push([s, e]); hits.push({ type, label, span: m[0], start: s, end: e });
    }
  }
  if (!hits.length) for (const m of text.matchAll(GENERIC)) { const s = m.index ?? 0; hits.push({ type: 'unspecified', label: 'vessel (type not stated)', span: m[0], start: s, end: s + m[0].length }); break; }
  return hits.sort((a, b) => a.start - b.start);
}

/** Distinct types with their first evidence span, for display. */
export function vesselTypeSummary(text: string): { type: VesselType; label: string; span: string }[] {
  const seen = new Map<VesselType, { type: VesselType; label: string; span: string }>();
  for (const h of extractVesselTypes(text)) if (!seen.has(h.type)) seen.set(h.type, { type: h.type, label: h.label, span: h.span });
  return [...seen.values()];
}
