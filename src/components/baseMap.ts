import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { feature } from 'topojson-client';
import countries from 'world-atlas/countries-110m.json';

export const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Leaflet map with a bundled Natural Earth basemap (public domain, via world-atlas). No tile server is contacted. */
export function makeBaseMap(el: HTMLElement): L.Map {
  const m = L.map(el, { center: [27, 46], zoom: 5, minZoom: 3, maxZoom: 9, zoomControl: true, attributionControl: true, worldCopyJump: false });
  m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  m.attributionControl.addAttribution('Basemap: Natural Earth (public domain) via world-atlas · no tile server used');
  const fc = feature(countries as never, (countries as any).objects.countries) as any;
  L.geoJSON(fc, { style: { color: css('--land-line'), weight: 1, fillColor: css('--land'), fillOpacity: 1 }, interactive: false }).addTo(m);
  m.getContainer().style.background = css('--sea');
  return m;
}
