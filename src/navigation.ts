import { useEffect, useState } from 'react';
import { isView, type View } from './views';
export const RESEARCH_TABS = ['briefing', 'dossiers', 'hypotheses', 'upcoming', 'coverage', 'places', 'vessels'] as const;
export type ContextKey = 'event' | 'market' | 'tab' | 'dossier' | 'hypothesis' | 'company' | 'asin' | 'rtab';
export function viewFromHash(hash: string): View {
  const value = hash.replace(/^#/, '').split('?')[0] as View;
  return isView(value) ? value : 'dashboard';
}
export function contextFromHash(hash: string): Partial<Record<ContextKey, string>> {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const result: Partial<Record<ContextKey, string>> = {};
  for (const key of ['event', 'market', 'tab', 'dossier', 'hypothesis', 'company', 'asin', 'rtab'] as const) {
    const value = params.get(key);
    if (value && value.length <= 200 && !/[\x00-\x1f]/.test(value) && (key !== 'tab' || RESEARCH_TABS.includes(value as typeof RESEARCH_TABS[number]))) result[key] = value;
  }
  return result;
}
export function navigateContext(patch: Partial<Record<ContextKey, string | null>>, view?: View, replace = false) {
  const context: Partial<Record<ContextKey, string | null>> = { ...contextFromHash(window.location.hash), ...patch };
  // The reviews workspace's place (company, listing, tab) means nothing to the other views.
  if ((view ?? viewFromHash(window.location.hash)) !== 'reviews') { delete context.company; delete context.asin; delete context.rtab; }
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
