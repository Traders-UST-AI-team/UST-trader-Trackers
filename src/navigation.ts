import { useEffect, useState } from 'react';
import type { View } from './components/StatusBar';
const VIEWS: View[] = ['dashboard', 'feed', 'telegram', 'wallets', 'alerts', 'research', 'sources'];
export const RESEARCH_TABS = ['briefing', 'dossiers', 'hypotheses', 'upcoming', 'coverage', 'places', 'vessels'] as const;
export type ContextKey = 'event' | 'market' | 'tab' | 'dossier' | 'hypothesis';
export function viewFromHash(hash: string): View {
  const value = hash.replace(/^#/, '').split('?')[0] as View;
  return VIEWS.includes(value) ? value : 'dashboard';
}
export function contextFromHash(hash: string): Partial<Record<ContextKey, string>> {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const result: Partial<Record<ContextKey, string>> = {};
  for (const key of ['event', 'market', 'tab', 'dossier', 'hypothesis'] as const) {
    const value = params.get(key);
    if (value && value.length <= 200 && !/[\x00-\x1f]/.test(value) && (key !== 'tab' || RESEARCH_TABS.includes(value as typeof RESEARCH_TABS[number]))) result[key] = value;
  }
  return result;
}
export function navigateContext(patch: Partial<Record<ContextKey, string | null>>, view?: View, replace = false) {
  const context = { ...contextFromHash(window.location.hash), ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(context)) if (value) params.set(key, value);
  const hash = `#${view ?? viewFromHash(window.location.hash)}${params.size ? `?${params}` : ''}`;
  if (hash === window.location.hash) return;
  if (replace) { window.history.replaceState(null, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else window.location.hash = hash;
}
export function useHashContext() {
  const [context, setContext] = useState(() => contextFromHash(window.location.hash));
  useEffect(() => { const change = () => setContext(contextFromHash(window.location.hash)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  return context;
}
export function useViewNavigation(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));
  useEffect(() => {
    const changed = () => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return [view, (next) => { setView(next); navigateContext({}, next); }];
}
