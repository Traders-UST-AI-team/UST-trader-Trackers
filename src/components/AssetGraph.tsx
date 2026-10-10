import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { AssetLink } from '../../shared/types';
import { css } from './baseMap';

/** event → asset → company. Edges are labelled with their relation type; undocumented links are never drawn. */
export function AssetGraph({ title, links }: { title: string; links: AssetLink[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const ink = css('--text-primary'), accent = css('--accent'), ev = css('--event'), ok = css('--ok'), line = css('--land-line'), surface = css('--surface-1');
    const nodes: cytoscape.ElementDefinition[] = [{ data: { id: 'event', label: title.length > 38 ? `${title.slice(0, 36)}…` : title, kind: 'event' } }];
    const edges: cytoscape.ElementDefinition[] = [];
    const companies = new Set<string>();
    for (const l of links) {
      nodes.push({ data: { id: `a:${l.asset_id}`, label: l.name.replace(/ \(.*\)/, ''), kind: 'asset' } });
      edges.push({ data: { id: `e:${l.asset_id}`, source: 'event', target: `a:${l.asset_id}`, label: l.relation === 'explicitly_named' ? 'names' : 'located at' } });
      for (const r of l.relations) {
        if (!companies.has(r.company)) { companies.add(r.company); nodes.push({ data: { id: `c:${r.company}`, label: r.company, kind: 'company' } }); }
        edges.push({ data: { id: `r:${l.asset_id}:${r.company}:${r.relation}`, source: `c:${r.company}`, target: `a:${l.asset_id}`, label: r.relation.replace(/_/g, ' ') } });
      }
    }
    const cy = cytoscape({
      container: el.current, elements: [...nodes, ...edges], userZoomingEnabled: false, boxSelectionEnabled: false,
      style: [
        { selector: 'node', style: { label: 'data(label)', color: ink, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 3, 'border-width': 2, 'border-color': surface, width: 22, height: 22, 'text-wrap': 'wrap', 'text-max-width': '110px' } },
        { selector: 'node[kind = "event"]', style: { 'background-color': ev, shape: 'round-rectangle', width: 28, height: 20 } },
        { selector: 'node[kind = "asset"]', style: { 'background-color': accent, shape: 'diamond', width: 26, height: 26 } },
        { selector: 'node[kind = "company"]', style: { 'background-color': ok, shape: 'ellipse' } },
        { selector: 'edge', style: { width: 1.5, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 8, color: line, 'text-rotation': 'autorotate', 'text-background-color': surface, 'text-background-opacity': 1, 'text-background-padding': '1px' } },
      ],
      layout: { name: 'breadthfirst', directed: true, roots: '#event', spacingFactor: 1.15, padding: 14, animate: false } as unknown as cytoscape.LayoutOptions,
    });
    return () => cy.destroy();
  }, [title, links]);
  return <div ref={el} className="cy small" role="img" aria-label="Event, mapped assets and documented company relationships" />;
}
