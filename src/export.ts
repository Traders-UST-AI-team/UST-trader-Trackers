import type { HistoryPoint, Market } from '../shared/types';
import type { Overlay } from './components/ProbChart';

export interface CsvExportOptions {
  market: Market;
  points: HistoryPoint[];
  overlays?: Overlay[];
  /** Optional sub-plot series (RSI, MACD lines). Each is written in its own unit: `pane_<id>_<unit>`. */
  panes?: { id: string; unit: string; points: { t: number; value: number | null }[] }[];
}

/**
 * Format historical probability points and active indicator overlays into CSV format.
 * - Rows are ordered chronologically by Unix timestamp.
 * - Timestamps are provided in both ISO 8601 string and Unix epoch seconds.
 * - Probability values are scaled to percentage points (0-100) with two decimal places.
 * - Missing or gap values produce empty cells, avoiding false zero interpolation.
 */
export function formatHistoryCsv(options: CsvExportOptions): string {
  const { points, overlays = [], panes = [] } = options;
  if (!points.length && !overlays.length && !panes.length) return '';

  const rowsMap = new Map<number, { p: number; overlays: Record<string, number | null> }>();

  for (const pt of points) {
    rowsMap.set(pt.t, { p: pt.p, overlays: {} });
  }

  for (const ov of overlays) {
    for (const pt of ov.points) {
      if (!rowsMap.has(pt.t)) {
        rowsMap.set(pt.t, { p: NaN, overlays: {} });
      }
      rowsMap.get(pt.t)!.overlays[ov.id] = pt.value;
    }
  }

  const paneMaps = panes.map((q) => new Map(q.points.map((x) => [x.t, x.value] as const)));
  for (const m of paneMaps) for (const t of m.keys()) if (!rowsMap.has(t)) rowsMap.set(t, { p: NaN, overlays: {} });

  const timestamps = [...rowsMap.keys()].sort((a, b) => a - b);
  const headerCols = [
    'timestamp_iso',
    'timestamp_unix',
    'probability_pct',
    ...overlays.map((o) => `overlay_${o.id}_pct`),
    ...panes.map((q) => `pane_${q.id}_${q.unit}`),
  ];

  const lines = [headerCols.join(',')];

  for (const t of timestamps) {
    const row = rowsMap.get(t)!;
    const iso = new Date(t * 1000).toISOString();
    const pStr = Number.isFinite(row.p) ? (row.p * 100).toFixed(2) : '';
    const ovStrs = overlays.map((o) => {
      const v = row.overlays[o.id];
      return v != null && Number.isFinite(v) ? v.toFixed(2) : '';
    });
    const paneStrs = paneMaps.map((m) => { const v = m.get(t); return v != null && Number.isFinite(v) ? v.toFixed(2) : ''; });
    lines.push([iso, t, pStr, ...ovStrs, ...paneStrs].join(','));
  }

  return lines.join('\n');
}

/**
 * Trigger a browser client-side file download for the generated CSV string.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
