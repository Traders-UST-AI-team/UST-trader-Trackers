// Access smoke test for candidate sources. One polite GET each (our UA, no header spoofing, no retries on blocks).
// A 403/406/429 is recorded as blocked/limited — never worked around. Output: data/source_registry.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseFeed } from '../server/sources/rss.ts';

const UA = 'WarTrackerDemo/0.1 (local research dashboard; contact: local-user)';
type Level = 'candidate' | 'page_verified' | 'fetch_verified' | 'parse_verified' | 'operational' | 'blocked';
interface Cand { id: string; name: string; role: string; url: string; method: 'rss' | 'html' | 'json'; terms?: string; note?: string; needsAuth?: boolean }

const CANDIDATES: Cand[] = [
  { id: 'ukmto', name: 'UKMTO', role: 'maritime incidents', url: 'https://www.ukmto.org/', method: 'html', note: 'Primary maritime incident source' },
  { id: 'centcom', name: 'US CENTCOM releases', role: 'official military', url: 'https://www.centcom.mil/MEDIA/PRESS-RELEASES/', method: 'html' },
  { id: 'ofac', name: 'OFAC Recent Actions', role: 'sanctions', url: 'https://ofac.treasury.gov/recent-actions', method: 'html' },
  { id: 'maersk', name: 'Maersk news & advisories', role: 'carrier operations', url: 'https://www.maersk.com/news', method: 'html' },
  { id: 'imo', name: 'IMO Middle East hot topic', role: 'maritime official', url: 'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-strait-of-hormuz.aspx', method: 'html' },
  { id: 'marad', name: 'MARAD maritime advisories', role: 'maritime official', url: 'https://www.maritime.dot.gov/msci-advisories', method: 'html' },
  { id: 'gdelt', name: 'GDELT DOC 2.0 API', role: 'wire discovery', url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=%22Strait%20of%20Hormuz%22&mode=artlist&maxrecords=5&format=json&timespan=3d', method: 'json', note: 'Documented limit ≈ 1 request / 5s' },
  { id: 'acled', name: 'ACLED API', role: 'structured conflict events', url: 'https://acleddata.com/api/acled/read?limit=1', method: 'json', needsAuth: true, note: 'Requires registered account/API access' },
  { id: 'liveuamap', name: 'Liveuamap', role: 'crowd/OSINT map', url: 'https://liveuamap.com/', method: 'html', note: 'Commercial site; scraping terms unverified' },
  { id: 'reliefweb-rss', name: 'ReliefWeb RSS', role: 'humanitarian', url: 'https://reliefweb.int/updates/rss.xml?search=middle%20east', method: 'rss' },
  { id: 'un-news', name: 'UN News — Middle East', role: 'official', url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml', method: 'rss' },
  { id: 'eia-today', name: 'EIA Today in Energy', role: 'energy context', url: 'https://www.eia.gov/rss/todayinenergy.xml', method: 'rss' },
  { id: 'aljazeera-ar', name: 'Al Jazeera Arabic', role: 'Arabic regional', url: 'https://www.aljazeera.net/rss', method: 'rss' },
  { id: 'irna', name: 'IRNA (Persian)', role: 'Persian state agency', url: 'https://www.irna.ir/rss', method: 'rss' },
  { id: 'iaea', name: 'IAEA news', role: 'nuclear official', url: 'https://www.iaea.org/feeds/topnews', method: 'rss' },
  { id: 'unsc', name: 'UN Security Council press', role: 'official', url: 'https://press.un.org/en/rss.xml', method: 'rss' },
  { id: 'eu-eeas', name: 'EEAS press', role: 'official', url: 'https://www.eeas.europa.eu/eeas/press-material_en', method: 'html' },
  { id: 'aramco', name: 'Aramco news', role: 'company', url: 'https://www.aramco.com/en/news-media/news', method: 'html' },
  { id: 'portwatch', name: 'IMF PortWatch (ArcGIS)', role: 'chokepoint transit sensor', url: 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query?where=portname%3D%27Strait+of+Hormuz%27&outFields=date,n_total&orderByFields=date+DESC&resultRecordCount=1&f=json', method: 'json' },
  { id: 'fred-brent', name: 'FRED Brent spot', role: 'price sensor', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=2026-09-25', method: 'html' },
  { id: 'stooq', name: 'Stooq Brent CSV', role: 'price sensor', url: 'https://stooq.com/q/d/l/?s=cb.f&i=d', method: 'html' },
  { id: 'opensky', name: 'OpenSky anonymous states', role: 'airspace sensor', url: 'https://opensky-network.org/api/states/all?lamin=24&lomin=50&lamax=26&lomax=52', method: 'json' },
  { id: 'ioda', name: 'IODA internet signals', role: 'connectivity sensor', url: `https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/IR?from=${Math.floor(Date.now() / 1000) - 7200}&until=${Math.floor(Date.now() / 1000)}&datasource=bgp`, method: 'json' },
  { id: 'nga-msi', name: 'NGA Maritime Safety broadcast warnings (NAVAREA IX)', role: 'official navigational warnings', url: 'https://msi.nga.mil/api/publications/broadcast-warn?navArea=IX&status=active&output=json', method: 'json' },
  { id: 'nga-asam', name: 'NGA ASAM anti-shipping activity messages', role: 'maritime incidents', url: 'https://msi.nga.mil/api/publications/asam?minOccurDate=2026-09-01&sort=occurDate&output=json', method: 'json' },
  { id: 'fcdo-api', name: 'UK FCDO travel advice (content API)', role: 'official advisory changes', url: 'https://www.gov.uk/api/content/foreign-travel-advice/iran', method: 'json' },
  { id: 'ofsi', name: 'UK OFSI notices (atom)', role: 'official sanctions', url: 'https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation.atom', method: 'rss' },
  { id: 'gcaptain', name: 'gCaptain', role: 'maritime trade press', url: 'https://gcaptain.com/feed/', method: 'rss' },
  { id: 'splash247', name: 'Splash247', role: 'maritime trade press', url: 'https://splash247.com/feed/', method: 'rss' },
  { id: 'oilprice', name: 'OilPrice.com', role: 'energy news', url: 'https://oilprice.com/rss/main', method: 'rss' },
  { id: 'france24', name: 'France 24 Middle East', role: 'news', url: 'https://www.france24.com/en/middle-east/rss', method: 'rss' },
  { id: 'nyt-me', name: 'NYT Middle East', role: 'news', url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml', method: 'rss' },
  { id: 'amwaj', name: 'Amwaj.media', role: 'regional analysis', url: 'https://amwaj.media/rss', method: 'rss' },
  { id: 'irna-en', name: 'IRNA English', role: 'state media (Iran)', url: 'https://en.irna.ir/rss', method: 'rss' },
  { id: 'isw', name: 'ISW feed', role: 'think-tank analysis', url: 'https://understandingwar.org/feed/', method: 'rss' },
  { id: 'criticalthreats', name: 'Critical Threats (Iran Update)', role: 'think-tank analysis', url: 'https://www.criticalthreats.org/feed', method: 'rss' },
  { id: 'crisisgroup', name: 'Crisis Group RSS', role: 'think-tank analysis', url: 'https://www.crisisgroup.org/rss.xml', method: 'rss' },
  { id: 'ucdp', name: 'UCDP GED API', role: 'structured conflict events', url: 'https://ucdpapi.pcr.uu.se/api/gedevents/25.1?pagesize=1', method: 'json', needsAuth: true },
  { id: 'hapi', name: 'HDX HAPI', role: 'structured conflict events (aggregated)', url: 'https://hapi.humdata.org/api/v2/metadata/location?output_format=json&limit=1', method: 'json', needsAuth: true },
  { id: 'telegram-preview', name: 'Telegram public channel preview', role: 'social (viewpoint-labelled)', url: 'https://t.me/s/Middle_East_Spectator', method: 'html', note: 'No robots.txt (404). Telegram API terms §1.5 restrict AI/ML use of platform data — see docs/TELEGRAM.md' },
];


async function probe(c: Cand) {
  const t0 = Date.now();
  const out: Record<string, unknown> = { ...c, checked_at: new Date().toISOString() };
  try {
    const res = await fetch(c.url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const body = await res.text();
    out.http_result = res.status; out.content_type = res.headers.get('content-type'); out.bytes = body.length; out.final_url = res.url;
    let level: Level = 'candidate';
    if (res.status === 403 || res.status === 406 || res.status === 429 || res.status === 401) level = 'blocked';
    else if (res.ok) {
      level = 'fetch_verified';
      if (c.method === 'rss') {
        const items = (() => { try { return parseFeed(body); } catch { return []; } })();
        out.parsed_items = items.length;
        if (items.length) { level = 'parse_verified'; out.sample_item = { title: items[0].title, url: items[0].url, published_at: items[0].publishedAt }; out.newest_item_at = items.map((i) => i.publishedAt).sort().pop(); }
        else out.extraction_result = 'no dated items parsed (undated, non-RSS, or format change)';
      } else if (c.method === 'json') {
        try { const j = JSON.parse(body); out.extraction_result = `JSON ok (${Object.keys(j).slice(0, 5).join(', ')})`; level = 'parse_verified'; } catch { out.extraction_result = `not JSON: ${body.slice(0, 80).replace(/\s+/g, ' ')}`; }
      } else {
        out.extraction_result = /<title>([^<]{0,120})/i.exec(body)?.[1]?.trim() ?? 'no <title>';
        out.js_app_suspected = body.length < 4000 || /enable javascript|just a moment/i.test(body);
        if (out.js_app_suspected) out.extraction_result += ' · likely JS-rendered or challenge page; item list NOT extractable by plain GET';
      }
    } else level = 'candidate';
    if (c.needsAuth && !res.ok) level = 'blocked';
    out.level = level;
  } catch (e) { out.http_result = null; out.error = (e as Error).message; out.level = 'candidate'; out.extraction_result = 'network error / timeout'; }
  out.elapsed_ms = Date.now() - t0;
  return out;
}

const results: Record<string, unknown>[] = [];
for (const c of CANDIDATES) {
  const r = await probe(c);
  results.push(r);
  console.log(String(r.level).padEnd(15), String(r.http_result ?? 'ERR').padEnd(4), c.id.padEnd(14), String(r.extraction_result ?? (r.parsed_items != null ? `${r.parsed_items} items, newest ${r.newest_item_at}` : '')).slice(0, 110));
  await new Promise((r2) => setTimeout(r2, c.id === 'gdelt' ? 6000 : 800));
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'source_registry.json');
writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), note: 'Smoke test only: fetch/parse results, not an operational guarantee.', sources: results }, null, 2));
console.log('\nwrote', out);
