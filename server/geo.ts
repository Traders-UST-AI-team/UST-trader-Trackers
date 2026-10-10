// Rule-based entity / place / topic extraction. Deliberately transparent: every match is a dictionary hit
// that can be shown to the user as evidence. No model guesses; unknowns stay unknown.
import type { EventLocation, LocationPrecision } from '../shared/types.ts';

interface EntityDef { name: string; kind: 'country' | 'actor' | 'chokepoint' | 'org'; re: RegExp; me: boolean }

const e = (name: string, kind: EntityDef['kind'], pattern: string, me = true): EntityDef => ({
  name, kind, re: new RegExp(pattern, 'i'), me,
});

export const ENTITIES: EntityDef[] = [
  e('Iran', 'country', '\\b(Iran|Iranian|Tehran)\\b'),
  e('Israel', 'country', '\\b(Israel|Israeli|Israelis|Jerusalem|Tel Aviv|Knesset|Netanyahu)\\b'),
  e('Palestine', 'country', '\\b(Gaza|Palestin\\w+|West Bank|Rafah|Ramallah)\\b'),
  e('Lebanon', 'country', '\\b(Lebanon|Lebanese|Beirut)\\b'),
  e('Syria', 'country', '\\b(Syria|Syrian|Damascus|Aleppo)\\b'),
  e('Iraq', 'country', '\\b(Iraq|Iraqi|Baghdad|Basra|Kurdistan)\\b'),
  e('Yemen', 'country', '\\b(Yemen|Yemeni|Sanaa|Sana\'a|Aden|Hodeidah|Marib)\\b'),
  e('Saudi Arabia', 'country', '\\b(Saudi|Saudi Arabia|Riyadh|Jeddah)\\b'),
  e('UAE', 'country', '\\b(UAE|United Arab Emirates|Emirati|Abu Dhabi|Dubai|Fujairah)\\b'),
  e('Qatar', 'country', '\\b(Qatar|Qatari|Doha)\\b'),
  e('Kuwait', 'country', '\\bKuwait\\w*\\b'),
  e('Bahrain', 'country', '\\bBahrain\\w*\\b'),
  e('Oman', 'country', '\\b(Oman|Omani|Muscat)\\b'),
  e('Jordan', 'country', '\\b(Jordan(ian)?\\b(?!\\s+(Peterson|Bardella|Henderson))|Amman)'),
  e('Egypt', 'country', '\\b(Egypt|Egyptian|Cairo)\\b'),
  e('Turkey', 'country', '\\b(Turkey|T[uü]rkiye|Turkish|Ankara)\\b'),
  e('Hezbollah', 'actor', '\\b(Hezbollah|Hizballah|Hizbollah)\\b'),
  e('Hamas', 'actor', '\\bHamas\\b'),
  e('Houthis', 'actor', '\\b(Houthi|Houthis|Ansar Allah|Ansarallah)\\b'),
  e('IRGC', 'actor', '\\b(IRGC|IRGC-QF|Revolutionary Guards?|Islamic Revolutionary Guard Corps)\\b'),
  e('IDF', 'actor', '\\b(IDF|Israel Defen[cs]e Forces)\\b'),
  e('CENTCOM', 'actor', '\\b(CENTCOM|Central Command)\\b'),
  e('Strait of Hormuz', 'chokepoint', '\\b(Strait of Hormuz|Hormuz)\\b'),
  e('Bab el-Mandeb', 'chokepoint', '\\bBab[ -]el[ -]Mandeb\\b'),
  e('Red Sea', 'chokepoint', '\\bRed Sea\\b'),
  e('Suez Canal', 'chokepoint', '\\bSuez\\b'),
  e('Persian Gulf', 'chokepoint', '\\b(Persian Gulf|Arabian Gulf|the Gulf of Oman|Gulf of Oman)\\b'),
  e('Gulf of Aden', 'chokepoint', '\\bGulf of Aden\\b'),
  e('IAEA', 'org', '\\bIAEA\\b'),
  e('OPEC', 'org', '\\bOPEC\\+?\\b', false),
  e('Aramco', 'org', '\\b(Aramco|Saudi Aramco)\\b'),
  e('ADNOC', 'org', '\\bADNOC\\b'),
  e('QatarEnergy', 'org', '\\bQatarEnergy\\b'),
  e('Maersk', 'org', '\\bMaersk\\b', false),
  e('UNIFIL', 'org', '\\bUNIFIL\\b'),
  e('UNRWA', 'org', '\\bUNRWA\\b'),
  e('United States', 'country', '\\b(United States|U\\.S\\.|US (forces|military|Navy|strikes?|troops|sanctions)|Pentagon|Washington|Trump)\\b', false),
  e('Russia', 'country', '\\b(Russia|Russian|Moscow|Putin)\\b', false),
  e('China', 'country', '\\b(China|Chinese|Beijing)\\b', false),
  e('Pakistan', 'country', '\\b(Pakistan|Pakistani|Islamabad)\\b', false),
  e('United Kingdom', 'country', '\\b(UK|United Kingdom|British|Britain)\\b', false),
];

// ---- Arabic / Persian aliases (hand-written, small, NOT verified by a native reader; precision/recall unmeasured) ----
const I18N_ENTITIES: Record<string, string[]> = {
  Iran: ['إيران', 'ایران', 'طهران', 'تهران', 'الإيراني', 'الإيرانية', 'ایرانی'], Israel: ['إسرائيل', 'اسرائیل', 'الإسرائيلي', 'الإسرائيلية', 'تل أبيب', 'نتنياهو', 'نتانیاهو', 'صهیونیست'],
  Palestine: ['غزة', 'غزه', 'فلسطين', 'فلسطین', 'الضفة الغربية', 'رفح'], Lebanon: ['لبنان', 'بيروت', 'بیروت'], Syria: ['سوريا', 'سورية', 'سوریه', 'دمشق'], Iraq: ['العراق', 'عراق', 'بغداد', 'عراقی'],
  Yemen: ['اليمن', 'یمن', 'صنعاء', 'تعز', 'الحديدة'], 'Saudi Arabia': ['السعودية', 'عربستان', 'الرياض', 'ریاض'], UAE: ['الإمارات', 'امارات', 'أبوظبي', 'دبي'], Qatar: ['قطر', 'الدوحة', 'دوحه'],
  Kuwait: ['الكويت', 'کویت'], Bahrain: ['البحرين', 'بحرین'], Jordan: ['الأردن', 'اردن'], Egypt: ['مصر'], Turkey: ['تركيا', 'ترکیه', 'ترکیه'],
  Hezbollah: ['حزب الله'], Hamas: ['حماس'], Houthis: ['الحوثي', 'الحوثيين', 'الحوثيون', 'أنصار الله', 'حوثی', 'انصارالله'], IRGC: ['الحرس الثوري', 'سپاه پاسداران', 'سپاه'],
  'Strait of Hormuz': ['مضيق هرمز', 'تنگه هرمز', 'هرمز'], 'Red Sea': ['البحر الأحمر', 'دریای سرخ'], 'Persian Gulf': ['الخليج الفارسي', 'الخليج العربي', 'خلیج فارس'], 'Bab el-Mandeb': ['باب المندب'],
  'United States': ['الولايات المتحدة', 'أمريكا', 'آمریکا', 'ایالات متحده', 'واشنطن', 'واشنگتن', 'ترمب', 'ترامب', 'ترامپ'], IAEA: ['الوكالة الدولية للطاقة الذرية', 'آژانس بین‌المللی انرژی اتمی'], OPEC: ['أوبك', 'اوپک'],
};
const I18N_TOPICS: Record<string, string[]> = {
  security: ['هجوم', 'غارة', 'غارات', 'صاروخ', 'صواريخ', 'قصف', 'مسيرة', 'استهداف', 'تستهدف', 'اشتباك', 'حمله', 'موشک', 'پهپاد', 'انفجار', 'درگیری'],
  shipping: ['ناقلة', 'ناقلات', 'سفينة', 'سفن', 'ملاحة', 'نفتکش', 'کشتی', 'دریانوردی', 'قنصلية'].filter((x) => x !== 'قنصلية'), energy: ['نفط', 'غاز', 'نفت', 'گاز', 'بترول', 'طاقة', 'انرژی'],
  sanctions: ['عقوبات', 'تحریم', 'تحریم‌ها'], diplomacy: ['مفاوضات', 'وقف إطلاق النار', 'هدنة', 'قنصلية', 'سفارة', 'مذاکرات', 'آتش‌بس', 'گفت‌وگو', 'دیپلمات'], nuclear: ['نووي', 'نووی', 'اليورانيوم', 'غنی‌سازی', 'هسته‌ای', 'تخصيب'],
  humanitarian: ['إنساني', 'لاجئ', 'نازح', 'مجاعة', 'امدادی', 'انسانی', 'نزوح'], politics: ['انتخابات', 'برلمان', 'حكومة', 'وزير', 'رئيس', 'انتخابات', 'دولت', 'وزیر', 'رئیس‌جمهور', 'مجلس'],
};
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const i18nRe = (a: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:[وبلفك]|ال)?${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
const I18N_ENT_RE = Object.entries(I18N_ENTITIES).map(([name, al]) => [name, al.map(i18nRe)] as const);
const I18N_TOPIC_RE = Object.entries(I18N_TOPICS).map(([name, al]) => [name, al.map(i18nRe)] as const);

/** Outlet names contain place names ("Jerusalem Post"); they are not evidence about the story. */
export const scrub = (t: string): string => t.replace(/\b(The )?Jerusalem Post\b|\bTimes of Israel\b|\bMiddle East Eye\b|\bMiddle East Monitor\b/gi, ' ');

/** Entities counted as evidence that an item concerns the Middle East. */
export function extractEntities(raw: string): { all: string[]; me: string[] } {
  const text = scrub(raw);
  const all: string[] = [];
  const me: string[] = [];
  for (const d of ENTITIES) {
    if (d.re.test(text)) { all.push(d.name); if (d.me) me.push(d.name); }
  }
  if (ARABIC_SCRIPT.test(text)) {
    for (const [name, res] of I18N_ENT_RE) {
      if (all.includes(name)) continue;
      if (res.some((r) => r.test(text))) { all.push(name); if (ENTITIES.find((x) => x.name === name)?.me) me.push(name); }
    }
  }
  return { all, me };
}

// ---- Gazetteer (approximate public coordinates; precision recorded, never overstated) ----
interface Place { name: string; lat: number; lng: number; precision: LocationPrecision; re: RegExp }
const p = (name: string, lat: number, lng: number, precision: LocationPrecision, pattern?: string): Place => ({
  name, lat, lng, precision,
  re: new RegExp(pattern ?? `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
});

const SPECIFIC_PLACES: Place[] = [
  // chokepoints / water bodies = region
  p('Strait of Hormuz', 26.57, 56.25, 'region', '\\bHormuz\\b'),
  p('Bab el-Mandeb', 12.58, 43.33, 'region', '\\bBab[ -]el[ -]Mandeb\\b'),
  p('Red Sea', 20.0, 38.5, 'region'),
  p('Gulf of Aden', 12.5, 47.0, 'region'),
  p('Gulf of Oman', 24.5, 58.5, 'region'),
  p('Persian Gulf', 27.0, 51.5, 'region', '\\b(Persian Gulf|Arabian Gulf)\\b'),
  p('Suez Canal', 30.46, 32.34, 'region', '\\bSuez\\b'),
  // facilities / ports = point
  p('Kharg Island', 29.23, 50.31, 'point'),
  p('Natanz', 33.72, 51.73, 'point'),
  p('Fordow', 34.88, 50.99, 'point', '\\bFord[oa]w\\b'),
  p('Bandar Abbas', 27.18, 56.27, 'city'),
  p('Abqaiq', 25.94, 49.68, 'point'),
  p('Ras Tanura', 26.64, 50.16, 'point'),
  p('Yanbu', 24.09, 38.06, 'point'),
  p('Ras Laffan', 25.93, 51.55, 'point'),
  p('Fujairah', 25.12, 56.34, 'city'),
  p('Hodeidah', 14.8, 42.95, 'city', '\\bHod[ei]idah\\b'),
  // cities
  p('Tehran', 35.69, 51.39, 'city'),
  p('Isfahan', 32.65, 51.67, 'city'),
  p('Tel Aviv', 32.08, 34.78, 'city'),
  p('Haifa', 32.79, 34.99, 'city'),
  p('East Jerusalem', 31.78, 35.23, 'city'),
  p('Jerusalem', 31.77, 35.21, 'city'),
  p('Gaza City', 31.5, 34.47, 'city'),
  p('Khan Younis', 31.34, 34.3, 'city'),
  p('Rafah', 31.3, 34.25, 'city'),
  p('Ramallah', 31.9, 35.2, 'city'),
  p('Beirut', 33.89, 35.5, 'city'),
  p('Damascus', 33.51, 36.29, 'city'),
  p('Aleppo', 36.2, 37.13, 'city'),
  p('Baghdad', 33.31, 44.37, 'city'),
  p('Basra', 30.51, 47.78, 'city'),
  p('Erbil', 36.19, 44.01, 'city'),
  p('Sanaa', 15.37, 44.19, 'city', "\\bSana'?a\\b"),
  p('Aden', 12.78, 45.04, 'city', '\\bAden\\b(?!\\s+Gulf)'),
  p('Riyadh', 24.71, 46.68, 'city'),
  p('Jeddah', 21.54, 39.17, 'city'),
  p('Dubai', 25.2, 55.27, 'city'),
  p('Abu Dhabi', 24.45, 54.38, 'city'),
  p('Doha', 25.29, 51.53, 'city'),
  p('Muscat', 23.59, 58.41, 'city'),
  p('Manama', 26.23, 50.59, 'city'),
  p('Kuwait City', 29.38, 47.99, 'city'),
  p('Amman', 31.95, 35.93, 'city'),
  p('Cairo', 30.04, 31.24, 'city'),
  p('Ankara', 39.93, 32.86, 'city'),
  p('West Bank', 31.95, 35.3, 'region'),
  p('Gaza', 31.45, 34.4, 'region', '\\bGaza\\b'),
];

const COUNTRY_CENTROIDS: Place[] = [
  p('Iran', 32.4, 53.7, 'country'), p('Israel', 31.5, 34.9, 'country'), p('Lebanon', 33.85, 35.86, 'country'),
  p('Syria', 34.8, 39.0, 'country'), p('Iraq', 33.2, 43.7, 'country'), p('Yemen', 15.55, 48.5, 'country'),
  p('Saudi Arabia', 23.9, 45.1, 'country', '\\b(Saudi Arabia|Saudi)\\b'), p('United Arab Emirates', 23.4, 53.8, 'country', '\\b(UAE|United Arab Emirates)\\b'),
  p('Qatar', 25.3, 51.2, 'country'), p('Kuwait', 29.3, 47.5, 'country'), p('Bahrain', 26.07, 50.55, 'country'),
  p('Oman', 21.5, 55.9, 'country'), p('Jordan', 31.2, 36.5, 'country', '\\bJordan(ian)?\\b(?!\\s+(Peterson|Bardella|Henderson))'), p('Egypt', 26.8, 30.8, 'country'),
  p('Türkiye', 39.0, 35.2, 'country', '\\b(Turkey|T[uü]rkiye)\\b'),
  p('Palestine', 31.9, 35.2, 'country', '\\bPalestin\\w+\\b'),
];

const rank: Record<LocationPrecision, number> = { point: 0, city: 1, region: 2, country: 3 };

/**
 * Pick the most specific named place. Title hits beat summary hits; then precision; then earliest position.
 * Country centroids are returned with precision "country" so the UI can label them approximate.
 */
export function geolocate(rawTitle: string, rawSummary: string, hintCountries: string[] = []): EventLocation | null {
  const title = scrub(rawTitle), summary = scrub(rawSummary);
  type Hit = { place: Place; zone: number; pos: number };
  const hits: Hit[] = [];
  for (const place of [...SPECIFIC_PLACES, ...COUNTRY_CENTROIDS]) {
    const mt = place.re.exec(title);
    if (mt) { hits.push({ place, zone: 0, pos: mt.index }); continue; }
    const ms = place.re.exec(summary);
    if (ms) hits.push({ place, zone: 1, pos: ms.index });
  }
  if (!hits.length && ARABIC_SCRIPT.test(title + summary)) {
    const first = extractEntities(`${title} ${summary}`).all.find((n) => COUNTRY_CENTROIDS.some((c) => c.name === n || (n === 'UAE' && c.name === 'United Arab Emirates') || (n === 'Saudi Arabia' && c.name === 'Saudi Arabia') || (n === 'Turkey' && c.name === 'Türkiye')));
    if (first) { const c = COUNTRY_CENTROIDS.find((x) => x.name === first || (first === 'UAE' && x.name === 'United Arab Emirates') || (first === 'Turkey' && x.name === 'Türkiye')); if (c) hits.push({ place: c, zone: 0, pos: 0 }); }
  }
  if (!hits.length && hintCountries.length === 1) {
    const c = COUNTRY_CENTROIDS.find((x) => x.name.toLowerCase() === hintCountries[0].toLowerCase()
      || x.re.test(hintCountries[0]));
    if (c) hits.push({ place: c, zone: 1, pos: 0 });
  }
  if (!hits.length) return null;
  // Title beats summary; a named place beats a country centroid; then the place mentioned first wins
  // (headlines lead with their subject). This is "place named in the text", not a verified incident coordinate.
  hits.sort((a, b) => {
    const ca = a.place.precision === 'country' ? 1 : 0, cb = b.place.precision === 'country' ? 1 : 0;
    return a.zone - b.zone || ca - cb || a.pos - b.pos || rank[a.place.precision] - rank[b.place.precision];
  });
  const h = hits[0].place;
  return { name: h.name, lat: h.lat, lng: h.lng, precision: h.precision };
}

// ---- Topics ----
export const TOPICS: Record<string, RegExp> = {
  security: /\b(strike[sd]?|airstrikes?|attack(s|ed)?|missile[s]?|drone[s]?|rocket[s]?|shell(ing|ed)|bomb(ing|ed|s)?|killed|raid(s|ed)?|troops?|offensive|invasion|invade|military|clash(es)?|war\b|intercept(ed|ion)?|explosion)\b/i,
  shipping: /\b(tanker[s]?|vessel[s]?|ship(s|ping)?|maritime|port[s]?\b|seafarers?|navy|naval|cargo|container|chokepoint|strait|Red Sea|Hormuz|Suez|freight|UKMTO)\b/i,
  energy: /\b(oil|crude|gas\b|LNG|pipeline[s]?|refiner(y|ies)|OPEC|Brent|barrel[s]?|energy|petroleum|Aramco|ADNOC|QatarEnergy|power plant|fuel)\b/i,
  sanctions: /\b(sanction(s|ed)?|embargo|OFAC|export controls?|blacklist(ed)?|asset freeze)\b/i,
  diplomacy: /\b(ceasefire|truce|talks|negotiat\w+|diplomat\w*|envoy|summit|accord|peace|agreement|mediat\w+|consulate|embassy|deal)\b/i,
  nuclear: /\b(nuclear|enrich(ment)?|uranium|IAEA|atomic)\b/i,
  humanitarian: /\b(humanitarian|aid\b|famine|displace(d|ment)|refugees?|civilians?|hospital[s]?|UNRWA|OCHA|UNHCR|cholera|food insecurity|casualt\w+)\b/i,
  politics: /\b(election[s]?|parliament|knesset|minister|cabinet|coalition|prime minister|president|regime|leader|vote[sd]?)\b/i,
};

export function extractTopics(text: string): string[] {
  const out = new Set(Object.entries(TOPICS).filter(([, re]) => re.test(text)).map(([k]) => k));
  if (ARABIC_SCRIPT.test(text)) for (const [name, res] of I18N_TOPIC_RE) if (res.some((r) => r.test(text))) out.add(name);
  return [...out];
}

/** Relevance rule: at least one Middle-East entity or place. Energy/shipping flag is separate (via topics). */
export function isMiddleEastRelevant(text: string): boolean {
  return extractEntities(text).me.length > 0;
}

const FOCUS_ENTITIES = new Set(['Strait of Hormuz', 'Bab el-Mandeb', 'Red Sea', 'Suez Canal', 'Persian Gulf', 'Gulf of Aden', 'Aramco', 'ADNOC', 'QatarEnergy', 'OPEC', 'Maersk']);
/** "Energy & shipping focus": energy/shipping/sanctions topics, a chokepoint or energy-company entity, or a mapped asset. Everything else is regional context. */
export function isEnergyShippingFocus(topics: string[], entities: string[], hasAsset: boolean): boolean {
  return hasAsset || topics.some((t) => t === 'energy' || t === 'shipping' || t === 'sanctions') || entities.some((e) => FOCUS_ENTITIES.has(e));
}
