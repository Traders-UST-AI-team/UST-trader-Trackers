const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s > 0 && s < 600) return 'just now'; // within normal clock skew between a publisher and this machine
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
export const absTime = (iso: string | number | null): string =>
  iso == null ? '—' : new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
export const pct = (p: number | null, d = 1): string => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
export const pp = (x: number | null): string => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pp`);
export const usd = (x: number | null): string =>
  x == null ? '—' : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : `$${x.toFixed(0)}`;
export const shortDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

const num = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(0));
/** Volume carries its venue's unit; Polymarket is USD, Kalshi is contracts. Never mixed or summed. */
export const vol = (x: number | null, unit: 'USD' | 'contracts'): string => (x == null ? '—' : unit === 'USD' ? `$${num(x)}` : `${num(x)} ct`);
export const VENUE_NAME: Record<string, string> = { polymarket: 'Polymarket', kalshi: 'Kalshi' };

/** Age label that never implies a time of day the source did not give. */
export function agoP(iso: string | null, precision: 'instant' | 'date', now = Date.now()): string {
  if (precision === 'instant' || !iso) return ago(iso, now);
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' (date only)';
}
export const absTimeP = (iso: string | null, precision: 'instant' | 'date'): string =>
  precision === 'date' && iso ? `${new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })} — date only; the source gives no time of day` : absTime(iso);

/** USDC amounts (Polymarket's settlement currency); never mixed with Kalshi contract counts. */
export const usdc = (x: number | null | undefined, d = 0): string => (x == null ? '—' : `${x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })} USDC`);
export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const signed = (x: number | null | undefined, fmt: (v: number) => string): string => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${fmt(Math.abs(x))}`);
