import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { css, esc, makeBaseMap } from './baseMap';
import type { AssetsFile, TrackerEvent } from '../../shared/types';
import { api } from '../api';
import { ago } from '../format';


interface Props { events: TrackerEvent[]; selected: TrackerEvent | null; onSelect: (e: TrackerEvent) => void; now: number }

export function MapPanel({ events, selected, onSelect, now }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const evLayer = useRef<L.LayerGroup | null>(null);
  const assetLayer = useRef<L.LayerGroup | null>(null);
  const [showEvents, setShowEvents] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  const [assets, setAssets] = useState<AssetsFile | null>(null);
  const [assetErr, setAssetErr] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => { api.assets().then(setAssets).catch((e) => setAssetErr(String(e))); }, []);

  // Group by place so many items at "Gaza" or "Iran" become one marker with a count, never a hidden pile.
  const groups = useMemo(() => {
    const m = new Map<string, { loc: NonNullable<TrackerEvent['location']>; items: TrackerEvent[] }>();
    for (const e of events) {
      if (!e.location) continue;
      const k = `${e.location.name}|${e.location.precision}`;
      const g = m.get(k) ?? { loc: e.location, items: [] };
      g.items.push(e); m.set(k, g);
    }
    return [...m.values()];
  }, [events]);
  const unlocated = events.filter((e) => !e.location).length;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = makeBaseMap(el.current);
    evLayer.current = L.layerGroup().addTo(m);
    assetLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // Event markers: style encodes location precision so approximate places never look exact.
  useEffect(() => {
    const layer = evLayer.current, m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();
    if (!showEvents) return;
    const accent = css('--accent'), sel = css('--event'), surface = css('--surface-1');
    for (const g of groups) {
      const isSel = !!selected && g.items.some((i) => i.id === selected.id);
      const n = g.items.length;
      const base = { fillOpacity: 0.55, weight: 2, color: isSel ? sel : accent, fillColor: isSel ? sel : accent };
      const radius = Math.min(22, 7 + Math.sqrt(n) * 3);
      const style: L.CircleMarkerOptions =
        g.loc.precision === 'point' || g.loc.precision === 'city' ? { ...base, radius }
        : g.loc.precision === 'region' ? { ...base, radius: radius + 3, fillOpacity: 0.12, dashArray: undefined }
        : { ...base, radius: radius + 3, fillOpacity: 0.06, dashArray: '4 4' }; // country centroid: dashed + faint = approximate
      const cm = L.circleMarker([g.loc.lat, g.loc.lng], style).addTo(layer);
      const list = g.items.slice(0, 8).map((i) => `<li><a href="#" data-id="${i.id}">${esc(i.title)}</a> <span class="muted">${esc(i.source_name.split(' — ')[0])} · ${ago(i.timestamp, now)}</span></li>`).join('');
      cm.bindPopup(`<div class="mp"><b>${esc(g.loc.name)}</b> <span class="muted">· ${g.loc.precision === 'country' ? 'country centroid (approximate)' : g.loc.precision} · place named in text, not an incident coordinate</span>
        <div>${n} item${n > 1 ? 's' : ''}</div><ul>${list}</ul>${n > 8 ? `<div class="muted">+${n - 8} more (see feed)</div>` : ''}</div>`, { maxWidth: 340 });
      cm.on('popupopen', (ev) => {
        ev.popup.getElement()?.querySelectorAll('a[data-id]').forEach((a) => a.addEventListener('click', (x) => {
          x.preventDefault();
          const it = g.items.find((i) => i.id === (a as HTMLElement).dataset.id);
          if (it) onSelectRef.current(it);
        }));
      });
      if (isSel) { cm.bringToFront(); L.circleMarker([g.loc.lat, g.loc.lng], { radius: radius + 7, color: sel, weight: 2, fill: false, interactive: false }).addTo(layer); }
    }
    void surface;
  }, [groups, selected, showEvents]); // `now` deliberately omitted: a periodic redraw would close open popups

  // Static assets: square markers with source-backed popups; pipelines drawn only when endpoints are sourced (schematic line).
  useEffect(() => {
    const layer = assetLayer.current;
    if (!layer || !assets) return;
    layer.clearLayers();
    if (!showAssets) return;
    const ink = css('--text-primary'), surface = css('--surface-1');
    for (const a of assets.assets) {
      if (a.line) L.polyline(a.line, { color: ink, weight: 2, dashArray: '2 6', opacity: 0.7 }).bindTooltip(`${esc(a.name)} — schematic line, not the real route`).addTo(layer);
      const icon = L.divIcon({ className: 'asset-icon', html: `<span style="background:${surface};border-color:${ink}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] });
      const rel = assets.relations.filter((r) => r.asset_id === a.id);
      const facts = a.facts.map((f) => `<li>${esc(f.claim)} <a href="${esc(f.source_url)}" target="_blank" rel="noreferrer">${esc(f.source_title)}</a> <span class="muted">(${f.source_date ?? 'undated'})</span></li>`).join('');
      const rels = rel.map((r) => `<li>${esc(r.company)} — ${esc(r.relation.replace(/_/g, ' '))}: ${esc(r.detail)} <span class="muted">(${esc(r.verified_by)})</span></li>`).join('');
      L.marker([a.lat, a.lng], { icon, title: a.name }).bindPopup(
        `<div class="mp"><b>${esc(a.name)}</b> <span class="muted">· ${esc(a.type)} · static reference · coordinates approximate (${a.precision})</span>
         <ul>${facts}</ul>${rels ? `<div><b>Documented relationships</b></div><ul>${rels}</ul>` : ''}
         <div class="muted">${esc(a.caveat)}</div></div>`, { maxWidth: 380 }).addTo(layer);
    }
  }, [assets, showAssets]);

  // Fly to the selected event's place.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected?.location) return;
    m.flyTo([selected.location.lat, selected.location.lng], Math.max(m.getZoom(), selected.location.precision === 'country' ? 5 : 6), { duration: 0.6 });
  }, [selected?.id]);

  return (
    <div className="mapwrap">
      <div className="maptools">
        <label className="check"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} /> events ({groups.reduce((a, g) => a + g.items.length, 0)} placed{unlocated ? `, ${unlocated} with no place named` : ''})</label>
        <label className="check"><input type="checkbox" checked={showAssets} onChange={(e) => setShowAssets(e.target.checked)} /> reference assets{assets ? ` (${assets.assets.length})` : ''}</label>
        <span className="legend"><i className="lg solid" /> city/point <i className="lg ring" /> region <i className="lg dashed" /> country (approx.) <i className="lg sq" /> static asset</span>
      </div>
      <div ref={el} className="map" role="application" aria-label="Map of reported events and reference assets" />
      {assetErr && <p className="muted small">Reference assets unavailable: {assetErr}</p>}
      <p className="muted small">Markers show the place named in each item’s text, not a verified incident location. Reference assets are dated background from cited sources and do not indicate current status. Reference-asset facts are unreviewed by a human.</p>
    </div>
  );
}
