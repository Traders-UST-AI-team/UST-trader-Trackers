// Sensor layer: numeric series from sources that are not news. Each series states its provider, unit, as-of date and caveat.
// None of these are event reports; they are context to read next to events and contracts, never proof of cause.
import { fetchJson, fetchText } from '../http.ts';
import { db, tx } from '../db.ts';
import { bump } from '../versions.ts';

export interface SensorDef {
  id: string; group: 'chokepoint' | 'price' | 'airspace' | 'connectivity'; title: string; unit: string; style: 'bar' | 'line';
  provider: string; source_url: string; caveat: string; /** how often our collector should poll */ intervalMin: number;
}

const PW_URL = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const PW_NOTE = 'IMF PortWatch estimates daily vessel transit calls from satellite AIS; published with a lag of several days and revised. Small-vessel and AIS-dark traffic is not counted. Counts are transits, not cargo volume.';
export const PW_POINTS: { key: string; name: string }[] = [
  { key: 'hormuz', name: 'Strait of Hormuz' }, { key: 'babelmandeb', name: 'Bab el-Mandeb Strait' }, { key: 'suez', name: 'Suez Canal' }, { key: 'capegh', name: 'Cape of Good Hope' },
];

export const SENSORS: SensorDef[] = [
  ...PW_POINTS.flatMap((c) => [
    { id: `pw:${c.key}:total`, group: 'chokepoint' as const, title: `${c.name} — daily transit calls (all vessels)`, unit: 'vessels/day', style: 'bar' as const, provider: 'IMF PortWatch', source_url: 'https://portwatch.imf.org/', caveat: PW_NOTE, intervalMin: 360 },
    { id: `pw:${c.key}:tanker`, group: 'chokepoint' as const, title: `${c.name} — daily tanker transit calls`, unit: 'vessels/day', style: 'bar' as const, provider: 'IMF PortWatch', source_url: 'https://portwatch.imf.org/', caveat: PW_NOTE, intervalMin: 360 },
  ]),
  { id: 'fred:brent', group: 'price', title: 'Brent crude spot (Europe), daily', unit: 'USD/bbl', style: 'line', provider: 'FRED (St. Louis Fed), source: US EIA', source_url: 'https://fred.stlouisfed.org/series/DCOILBRENTEU', caveat: 'Daily spot assessment published with a delay of a few days; not a live quote and not a futures price. No causal reading of any move.', intervalMin: 360 },
  { id: 'fred:wti', group: 'price', title: 'WTI crude spot (Cushing), daily', unit: 'USD/bbl', style: 'line', provider: 'FRED (St. Louis Fed), source: US EIA', source_url: 'https://fred.stlouisfed.org/series/DCOILWTICO', caveat: 'Daily spot assessment published with a delay of a few days; not a live quote.', intervalMin: 360 },
  ...(['iran:Iran', 'gulf:Gulf states (E. Arabia)', 'levant:Levant (Israel/Lebanon/Jordan/Syria)']).map((x) => {
    const [k, n] = x.split(':');
    return { id: `opensky:${k}:airborne`, group: 'airspace' as const, title: `Airborne aircraft seen over ${n}`, unit: 'aircraft', style: 'line' as const, provider: 'OpenSky Network (ADS-B)', source_url: 'https://opensky-network.org/',
      caveat: 'Counts only aircraft heard by volunteer ADS-B receivers; coverage varies by area and time and many military/state flights do not broadcast. A relative indicator of civil traffic, not a census. Our own series: it starts when this tracker first polled.', intervalMin: 30 };
  }),
  ...(['IR:Iran', 'IL:Israel', 'LB:Lebanon', 'YE:Yemen', 'IQ:Iraq', 'SY:Syria']).map((x) => {
    const [k, n] = x.split(':');
    return { id: `ioda:${k}:bgp`, group: 'connectivity' as const, title: `${n} — internet routing visibility (BGP, /24 prefixes)`, unit: 'visible /24 prefixes', style: 'line' as const, provider: 'IODA (Georgia Tech)', source_url: `https://ioda.inetintel.cc.gatech.edu/country/${k}`,
      caveat: 'Counts routed prefixes visible from collectors; a sustained drop suggests a connectivity disruption (power, cable, shutdown or filtering) but does not say which. Hourly points as aggregated by the IODA API.', intervalMin: 120 };
  }),
];

const sourceOfSeries = (id: string) => ({ pw: 'portwatch', fred: 'fred', opensky: 'opensky', ioda: 'ioda' } as Record<string, string>)[id.split(':')[0]] ?? id;

function put(seriesId: string, rows: [number, number][]) {
  if (!rows.length) return 0;
  tx(() => {
    const ins = db.prepare('INSERT OR REPLACE INTO series_points (series_id, t, v) VALUES (?,?,?)');
    for (const [t, v] of rows) if (Number.isFinite(t) && Number.isFinite(v)) ins.run(seriesId, t, v);
    db.prepare('INSERT OR REPLACE INTO series_meta (series_id, fetched_at) VALUES (?,?)').run(seriesId, new Date().toISOString());
  });
  bump(sourceOfSeries(seriesId));
  return rows.length;
}

const dayUtc = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);

export async function ingestPortWatch(): Promise<string> {
  const since = new Date(Date.now() - 150 * 86400_000).toISOString().slice(0, 10);
  let n = 0, newest = '';
  for (const c of PW_POINTS) {
    const q = new URLSearchParams({ where: `portname='${c.name}' AND date >= '${since}'`, outFields: 'date,n_total,n_tanker', orderByFields: 'date ASC', resultRecordCount: '2000', f: 'json' });
    const j = await fetchJson<{ features?: { attributes: { date: string; n_total: number; n_tanker: number } }[]; error?: { message: string } }>(`${PW_URL}?${q}`, { retries: 2 });
    if (j.error) throw new Error(`PortWatch: ${j.error.message}`);
    const f = j.features ?? [];
    if (!f.length) throw new Error(`PortWatch returned no rows for ${c.name}`);
    n += put(`pw:${c.key}:total`, f.map((x) => [dayUtc(x.attributes.date), x.attributes.n_total]));
    put(`pw:${c.key}:tanker`, f.map((x) => [dayUtc(x.attributes.date), x.attributes.n_tanker]));
    newest = f[f.length - 1].attributes.date > newest ? f[f.length - 1].attributes.date : newest;
  }
  return `${PW_POINTS.length} chokepoints, ${n} daily rows, newest observation ${newest}`;
}

export async function ingestFred(): Promise<string> {
  let n = 0, newest = '';
  for (const [id, series] of [['fred:brent', 'DCOILBRENTEU'], ['fred:wti', 'DCOILWTICO']] as const) {
    const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${new Date(Date.now() - 150 * 86400_000).toISOString().slice(0, 10)}`, { retries: 2 });
    const rows: [number, number][] = [];
    for (const line of csv.trim().split('\n').slice(1)) { const [d, v] = line.split(','); const x = Number(v); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v && v !== '.' && Number.isFinite(x)) rows.push([dayUtc(d), x]); } // "." = no observation (holiday): omitted, not zero
    if (!rows.length) throw new Error(`FRED ${series}: no numeric rows`);
    n += put(id, rows);
    const last = new Date(rows[rows.length - 1][0] * 1000).toISOString().slice(0, 10);
    if (last > newest) newest = last;
  }
  return `2 series, ${n} daily rows, newest observation ${newest}`;
}

const BOXES: Record<string, [number, number, number, number]> = { iran: [25, 44, 39.8, 63.4], gulf: [22, 46, 30.5, 57], levant: [29, 34, 37.5, 42.5] };

export async function ingestOpenSky(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const out: string[] = [];
  for (const [k, [la0, lo0, la1, lo1]] of Object.entries(BOXES)) {
    const j = await fetchJson<{ time: number; states: unknown[][] | null }>(`https://opensky-network.org/api/states/all?lamin=${la0}&lomin=${lo0}&lamax=${la1}&lomax=${lo1}`, { retries: 1, timeoutMs: 20000 });
    const states = j.states ?? [];
    const airborne = states.filter((s) => s[8] === false).length; // index 8 = on_ground
    put(`opensky:${k}:airborne`, [[j.time ?? now, airborne]]);
    out.push(`${k}=${airborne}`);
  }
  return `airborne now: ${out.join(' ')}`;
}

export async function ingestIoda(): Promise<string> {
  const until = Math.floor(Date.now() / 1000), from = until - 7 * 86400;
  let n = 0;
  for (const cc of ['IR', 'IL', 'LB', 'YE', 'IQ', 'SY']) {
    const j = await fetchJson<{ data?: { values: (number | null)[]; from: number; step: number }[][] }>(`https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/${cc}?from=${from}&until=${until}&datasource=bgp&maxPoints=168`, { retries: 1 });
    const s = j.data?.[0]?.[0];
    if (!s) throw new Error(`IODA ${cc}: empty response`);
    const rows: [number, number][] = [];
    s.values.forEach((v, i) => { if (v !== null && v !== undefined) rows.push([s.from + i * s.step, v]); }); // null = no data, omitted
    n += put(`ioda:${cc}:bgp`, rows);
  }
  return `6 countries, ${n} hourly points (7-day window)`;
}

export interface SensorSeries extends SensorDef { points: [number, number][]; as_of: number | null; fetched_at: string | null }

export function readSensors(): SensorSeries[] {
  return SENSORS.map((d) => {
    const pts = db.prepare('SELECT t, v FROM series_points WHERE series_id = ? ORDER BY t').all(d.id) as unknown as { t: number; v: number }[];
    const meta = db.prepare('SELECT fetched_at FROM series_meta WHERE series_id = ?').get(d.id) as { fetched_at: string } | undefined;
    return { ...d, points: pts.map((p) => [p.t, p.v]), as_of: pts.length ? pts[pts.length - 1].t : null, fetched_at: meta?.fetched_at ?? null };
  });
}
