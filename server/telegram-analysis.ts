// Deterministic, rule-based analysis of a Telegram post's text. No model, classifier or LLM touches the text:
// dictionaries, regular expressions and counting only (see docs/TELEGRAM.md for the Telegram terms rationale).
import { extractEntities, extractTopics, geolocate } from './geo.ts';
import type { LocationPrecision } from '../shared/types.ts';

/** ISO-3166 alpha-2 → name for flags the channel uses as its own location/actor tags. */
const FLAG_NAMES: Record<string, string> = { IR: 'Iran', IL: 'Israel', US: 'United States', YE: 'Yemen', SA: 'Saudi Arabia', IQ: 'Iraq', LB: 'Lebanon', SY: 'Syria', PS: 'Palestine', AE: 'UAE', QA: 'Qatar', KW: 'Kuwait',
  BH: 'Bahrain', OM: 'Oman', JO: 'Jordan', EG: 'Egypt', TR: 'Turkey', RU: 'Russia', CN: 'China', GB: 'United Kingdom', PK: 'Pakistan', AF: 'Afghanistan', IN: 'India', UA: 'Ukraine', FR: 'France', DE: 'Germany' };

export function extractFlags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu)) {
    const code = String.fromCharCode(m[1].codePointAt(0)! - 0x1F1E6 + 65, m[2].codePointAt(0)! - 0x1F1E6 + 65);
    out.add(FLAG_NAMES[code] ?? code);
  }
  return [...out];
}

export function detectLang(text: string): string {
  const n = (re: RegExp) => (text.match(re) ?? []).length;
  const arabic = n(/[؀-ۿ]/g), persianOnly = n(/[پچژگ]/g), cyr = n(/[Ѐ-ӿ]/g), heb = n(/[֐-׿]/g), latin = n(/[A-Za-z]/g);
  const max = Math.max(arabic, cyr, heb, latin);
  if (max < 3) return 'und';
  if (max === arabic) return persianOnly > 0 ? 'fa' : 'ar';
  if (max === cyr) return 'ru';
  if (max === heb) return 'he';
  return 'en';
}

/** Outlets/actors whose name in a post is an attribution ("Reuters", "Tasnim", "IDF"). Presence ≠ verification. */
const ATTRIB = ['Reuters', 'AP', 'AFP', 'Associated Press', 'Bloomberg', 'Axios', 'CNN', 'Fox News', 'NBC', 'CBS', 'ABC News', 'WSJ', 'Wall Street Journal', 'New York Times', 'NYT', 'Washington Post', 'BBC', 'Sky News',
  'Al Jazeera', 'Al Mayadeen', 'Al-Manar', 'Al Arabiya', 'Asharq', 'Tasnim', 'Fars', 'IRNA', 'Mehr', 'Press TV', 'IRIB', 'Kan', 'Channel 12', 'Channel 13', 'Haaretz', 'Times of Israel', 'Jerusalem Post', 'Ynet', 'i24',
  'Kpler', 'Vortexa', 'Lloyd', 'UKMTO', 'JMIC', 'CENTCOM', 'IDF', 'IRGC', 'Pentagon', 'White House', 'Truth Social', 'State Department', 'Houthis', 'Saree', 'Ansar Allah', 'Hezbollah', 'Hamas', 'IAEA', 'UN', 'OPEC',
  'Anadolu', 'TASS', 'RT', 'Sputnik', 'Xinhua', 'Geopolitics Watch', 'OSINT', 'Aramco', 'ADNOC'];
const ATTRIB_RE = new RegExp(`(?:^|[^A-Za-z])(${ATTRIB.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'g');
const SOURCE_PHRASE = /(?:according to|source:|sources?:|via|citing|reported by|reports? from|per|per the)\s+([A-Z][\w.&'’\- ]{1,40})/g;
const REPORTING_VERB = /\b(reports|reported|says|said|claims|claimed|announced|warns|warned|stated|confirms|confirmed|denies|denied|alleges|alleged|posted|published)\b/i;

export function extractAttributions(text: string): string[] {
  const out = new Set<string>();
  const t = text.replace(/@Middle_East_Spectator/g, ' ');
  for (const m of t.matchAll(ATTRIB_RE)) out.add(m[1]);
  for (const m of t.matchAll(SOURCE_PHRASE)) out.add(m[1].trim().replace(/[.,;:]+$/, ''));
  // "Attributed" only when the name is followed within one sentence (≤ 70 chars, no sentence end) by a reporting verb,
  // or introduced by an explicit "according to / via / source: / citing / per". A bare mention is just a mention.
  const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributed = [...out].filter((n) => new RegExp(`${esc(n)}[^.!?\\n]{0,70}?${REPORTING_VERB.source}|(?:according to|via|source:?|sources:?|citing|per|reported by)\\s+${esc(n)}`, 'i').test(text));
  return [...new Set(attributed)].slice(0, 6);
}

const CLAIMS: Record<string, RegExp> = {
  kinetic: /\b(struck|strikes?|airstrike|impact(s|ed)?|hit|hits|explosions?|exploded|missiles?|drones?|rockets?|shell(ing|ed)|bomb(ing|ed)?|intercept(ed|ion)|shot down|ballistic)\b/i,
  maritime: /\b(tankers?|vessels?|ships?|shipping|hormuz|strait|navy|naval|port|seiz(ed|ure)|mine[sd]?|ais)\b/i,
  statement: /\b(says|said|announced|warns?|warned|stated|statement|spokesperson|declares?|vows?|pledges?|posted|message from)\b/i,
  casualties: /\b(killed|dead|wounded|injured|casualt(y|ies)|martyr(s|ed)?|death toll)\b/i,
  diplomacy: /\b(talks|negotiat\w+|ceasefire|truce|deal|proposal|discussions|summit|envoy|mediat\w+)\b/i,
  deployment: /\b(deploy(s|ed|ment)?|carrier|aircraft|jets?|troops?|mobili[sz](e|ed|ation)|convoy|reinforce\w*)\b/i,
  energy_econ: /\b(oil|gas|crude|barrels?|brent|lng|refiner(y|ies)|pipeline|export(s|ed)?|prices?|sanction(s|ed)?)\b/i,
  security_alert: /\b(security alert|travel advisory|embassy|evacuat\w+|airspace|flights? (suspended|cancel\w+)|notam)\b/i,
};

export function reportKind(text: string, hasMedia: boolean, isForward: boolean): string {
  const t = text.trim();
  if (!t) return hasMedia ? 'media_only' : 'empty';
  if (/^[\W_]*(BREAKING|NEW|URGENT|UPDATE|ALERT|JUST IN)\b/i.test(t.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}\s/—–\-❗️‼️🚨]+/u, ''))) return 'breaking_claim';
  if (isForward) return 'forward';
  if (/\b(I|I'm|I’m|my|we|let's|let’s)\b/.test(t) || /\?\s*$/.test(t) || t.length > 600) return 'commentary';
  return 'report';
}

export interface PostAnalysis {
  lang: string; entities: string[]; topics: string[]; flags: string[];
  loc: { name: string; lat: number; lng: number; precision: LocationPrecision } | null;
  reportKind: string; claimKinds: string[]; attributions: string[]; hashtags: string[]; domains: string[];
}

export function analyzePost(text: string, opts: { hasMedia: boolean; isForward: boolean; links: string[] }): PostAnalysis {
  const flags = extractFlags(text);
  const ents = extractEntities(text).all;
  const entities = [...new Set([...ents, ...flags.map((f) => (f === 'Palestine' ? 'Palestine' : f))])];
  const topics = extractTopics(text);
  const loc = geolocate(text.split('\n')[0] ?? '', text, []);
  const domains = [...new Set(opts.links.map((l) => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter((d) => d && !/^t\.me$/.test(d)))];
  return {
    lang: detectLang(text), entities, topics, flags, loc,
    reportKind: reportKind(text, opts.hasMedia, opts.isForward),
    claimKinds: Object.entries(CLAIMS).filter(([, re]) => re.test(text)).map(([k]) => k),
    attributions: extractAttributions(text),
    hashtags: [...new Set([...text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1]))],
    domains,
  };
}
