// Small external stores (preferences, watchlist) shared by several components without prop-drilling.
import { useEffect, useSyncExternalStore } from 'react';
import type { Prefs, WatchCard, WatchItem } from '../shared/types';
import { api } from './api';

function createStore<T>(initial: T) {
  let state = initial; const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (v: T) => { state = v; subs.forEach((f) => f()); },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

// ── preferences (persisted server-side; a failed save keeps the local choice and says so) ──
const DEFAULT_PREFS: Prefs = { indicators: ['sma24'], axis: 'auto', range: '30d', panes: [] };
const prefsStore = createStore<{ prefs: Prefs; loaded: boolean; saveError: string | null }>({ prefs: DEFAULT_PREFS, loaded: false, saveError: null });
let prefsRequested = false;

export function usePrefs() {
  const s = useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
  useEffect(() => {
    if (prefsRequested) return;
    prefsRequested = true;
    api.prefs().then((p) => prefsStore.set({ prefs: p, loaded: true, saveError: null })).catch(() => prefsStore.set({ ...prefsStore.get(), loaded: true }));
  }, []);
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefsStore.get().prefs, ...patch };
    prefsStore.set({ prefs: next, loaded: true, saveError: null });
    api.setPrefs(next).catch((e: Error) => prefsStore.set({ ...prefsStore.get(), saveError: e.message }));
  };
  return { prefs: s.prefs, loaded: s.loaded, saveError: s.saveError, update };
}

// ── watchlist ──
const wlStore = createStore<{ items: WatchItem[]; cards: WatchCard[]; loaded: boolean; asOf: number | null; error: string | null }>({ items: [], cards: [], loaded: false, asOf: null, error: null });

export async function reloadWatchlist() {
  try { const w = await api.watchlist(); wlStore.set({ items: w.items, cards: w.cards, loaded: true, asOf: w.as_of, error: null }); }
  catch (e) { wlStore.set({ ...wlStore.get(), loaded: true, error: (e as Error).message }); }
}

export function useWatchlist() {
  const s = useSyncExternalStore(wlStore.subscribe, wlStore.get);
  const isPinned = (kind: WatchItem['kind'], id: string) => s.items.some((i) => i.kind === kind && i.id === id);
  const toggle = async (kind: WatchItem['kind'], id: string) => {
    const items = isPinned(kind, id) ? s.items.filter((i) => !(i.kind === kind && i.id === id)) : [...s.items, { kind, id }];
    try { const w = await api.setWatchlist(items); wlStore.set({ items: w.items, cards: w.cards, loaded: true, asOf: w.as_of, error: null }); }
    catch (e) { wlStore.set({ ...wlStore.get(), error: (e as Error).message }); }
  };
  return { ...s, isPinned, toggle, reload: reloadWatchlist };
}

/** A string that changes when ANY of the named sources' stored data changes (from /api/status `versions`). */
export const versionKey = (versions: Record<string, number> | undefined, sources: string[]): string => sources.map((s) => `${s}:${versions?.[s] ?? 0}`).join(',');
export const MARKET_SOURCES = ['polymarket', 'kalshi'];
export const SENSOR_SOURCES_IDS = ['portwatch', 'fred', 'opensky', 'ioda'];
export const WALLET_SOURCE_IDS = ['pm-trades', 'pm-wallets', 'pm-holders', 'pm-leaderboard'];
