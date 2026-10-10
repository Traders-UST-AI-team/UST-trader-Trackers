import type { TgChannel, Counterpart, TgOverview, TgPost, SensorSeries, AssetsFile, Market, MarketHistory, Status, TrackerEvent, WatchCard, WatchItem, Prefs, ReactionResult, ActivityResponse, FeedResponse, SourcesResponse, SourceConfigView, WalletsOverview, WalletDetail, LargeTrade, HolderGroup, AlertsResponse } from '../shared/types';
import type { IndicatorResult } from '../shared/indicators';
import type { VesselView } from '../shared/maritime';
import type { Briefing, SavedBriefingRow } from '../shared/briefing';
import type { CalendarEntryView, ClaimView, CoverageReport, DossierDetail, DossierSummary, HypothesisView, ObservationTarget, SourceItemRef, SourceVersion, TaskView } from '../shared/research';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface IndResponse { target: string; as_of: number; definition_version: string; indicators: IndicatorResult[]; rejected: string[]; seed_mode: boolean }
export interface WatchResponse { as_of: number; definition_version: string; cards: WatchCard[]; items: WatchItem[]; seed_mode: boolean }

async function send<T>(method: 'PUT' | 'POST' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `${url} → HTTP ${r.status}`);
  return j as T;
}

export type BriefingWindowChoice = { hours: number } | { since: 'last' };
const briefingQuery = (w: BriefingWindowChoice) => ('since' in w ? 'since=last' : `hours=${w.hours}`);

export const api = {
  briefing: (w: BriefingWindowChoice) => get<Briefing>(`/api/briefing?${briefingQuery(w)}`),
  briefingMarkdownUrl: (w: BriefingWindowChoice) => `/api/briefing.md?${briefingQuery(w)}`,
  saveBriefing: (w: BriefingWindowChoice, note: string) => send<SavedBriefingRow>('POST', '/api/briefings', { ...w, note }),
  briefingAuto: () => get<{ enabled: boolean }>('/api/briefing/auto'),
  setBriefingAuto: (enabled: boolean) => send<{ enabled: boolean }>('PUT', '/api/briefing/auto', { enabled }),
  savedBriefings: () => get<SavedBriefingRow[]>('/api/briefings'),
  savedBriefing: (id: string) => get<Briefing>(`/api/briefings/${encodeURIComponent(id)}`),
  savedBriefingMarkdownUrl: (id: string) => `/api/briefings/${encodeURIComponent(id)}.md`,
  marketIndicators: (id: string, ids: string[]) => get<IndResponse>(`/api/markets/${encodeURIComponent(id)}/indicators?indicators=${ids.join(',')}`),
  sensorIndicators: () => get<{ definition_version: string; seed_mode: boolean; series: { id: string; indicators: IndicatorResult[] }[] }>('/api/indicators/sensors'),
  reaction: (id: string, ts: number, precision: 'instant' | 'date') => get<ReactionResult>(`/api/markets/${encodeURIComponent(id)}/reaction?ts=${Math.floor(ts)}&precision=${precision}`),
  watchlist: () => get<WatchResponse>('/api/watchlist'),
  setWatchlist: (items: WatchItem[]) => send<WatchResponse>('PUT', '/api/watchlist', { items }),
  prefs: () => get<Prefs>('/api/prefs'),
  setPrefs: (p: Prefs) => send<Prefs>('PUT', '/api/prefs', p),
  activity: () => get<ActivityResponse>('/api/indicators/activity'),
  feed: (qs: string) => get<FeedResponse>(`/api/feed?${qs}`),
  feedNew: (qs: string, since: string) => get<{ count: number; newest_collected_at: string | null }>(`/api/feed/new?${qs}&since=${encodeURIComponent(since)}`),
  feedUnread: () => get<{ marker: string | null; counts: Record<string, number> }>('/api/feed/unread'),
  markFeedRead: () => send<{ marker: string | null; counts: Record<string, number> }>('PUT', '/api/feed/read-marker', {}),
  sources: () => get<SourcesResponse>('/api/sources'),
  setSourceConfig: (id: string, body: { interval_min?: number; request_budget?: number; reset?: true }) => send<SourceConfigView>('PUT', `/api/sources/${encodeURIComponent(id)}/config`, body),
  setTgChannels: (channels: { channel: string; enabled: boolean }[]) => send<{ channels: unknown[] }>('PUT', '/api/telegram/config', { channels }),
  wallets: () => get<WalletsOverview>('/api/wallets'),
  walletDetail: (w: string) => get<WalletDetail>(`/api/wallets/watch/${w}`),
  watchWallet: (wallet: string, note: string | null, selection_rule?: string) => send<{ items: unknown[] }>('POST', '/api/wallets/watch', { wallet, note, selection_rule }),
  unwatchWallet: (w: string) => send<{ removed: boolean }>('DELETE', `/api/wallets/watch/${w}`),
  setLargeTradeUsdc: (usdc: number) => send<{ value: number }>('PUT', '/api/wallets/large-trade-threshold', { usdc }),
  largeTrades: (id: string) => get<LargeTrade[]>(`/api/wallets/markets/${encodeURIComponent(id)}/large-trades`),
  holders: (id: string) => get<HolderGroup[]>(`/api/wallets/markets/${encodeURIComponent(id)}/holders`),
  alerts: () => get<AlertsResponse>('/api/alerts'),
  ackAlert: (id: string) => send<AlertsResponse>('PUT', `/api/alerts/${encodeURIComponent(id)}/ack`),
  ackAllAlerts: () => send<AlertsResponse>('POST', '/api/alerts/ack-all'),
  setAlertRule: (id: string, patch: { enabled?: boolean; threshold?: number; cooldown_min?: number }) => send<AlertsResponse>('PUT', `/api/alerts/rules/${id}`, patch),
  // research workspace (W0–W5) and claim review (H1)
  source: (ref: string) => get<{ source: SourceItemRef | null; versions: SourceVersion[]; note: string }>(`/api/research/source?ref=${encodeURIComponent(ref)}`),
  dossiers: () => get<DossierSummary[]>('/api/research/dossiers'),
  dossier: (id: string, order: 'published' | 'collected' = 'published') => get<DossierDetail>(`/api/research/dossiers/${id}?order=${order}`),
  createDossier: (b: { title: string; description?: string; from_ref?: string }) => send<DossierDetail>('POST', '/api/research/dossiers', b),
  updateDossier: (id: string, b: Record<string, unknown>) => send<DossierDetail>('PATCH', `/api/research/dossiers/${id}`, b),
  attach: (id: string, b: { source_ref: string; relationship?: string; rationale?: string; basis?: string }) => send<DossierDetail>('POST', `/api/research/dossiers/${id}/items`, b),
  detach: (id: string, ref: string) => send<DossierDetail>('DELETE', `/api/research/dossiers/${id}/items?ref=${encodeURIComponent(ref)}`),
  createTask: (b: Record<string, unknown>) => send<TaskView>('POST', '/api/research/tasks', b),
  updateTask: (id: string, b: Record<string, unknown>) => send<TaskView>('PATCH', `/api/research/tasks/${id}`, b),
  createClaim: (b: Record<string, unknown>) => send<ClaimView>('POST', '/api/research/claims', b),
  addClaimEvidence: (id: string, b: Record<string, unknown>) => send<ClaimView>('POST', `/api/research/claims/${id}/evidence`, b),
  removeClaimEvidence: (id: string, ref: string) => send<ClaimView>('DELETE', `/api/research/claims/${id}/evidence?ref=${encodeURIComponent(ref)}`),
  reviewClaim: (id: string, b: Record<string, unknown>) => send<ClaimView>('POST', `/api/research/claims/${id}/reviews`, b),
  hypotheses: () => get<HypothesisView[]>('/api/research/hypotheses'),
  createHypothesis: (b: Record<string, unknown>) => send<HypothesisView>('POST', '/api/research/hypotheses', b),
  updateHypothesis: (id: string, b: Record<string, unknown>) => send<HypothesisView>('PATCH', `/api/research/hypotheses/${id}`, b),
  addHypothesisEvidence: (id: string, b: Record<string, unknown>) => send<HypothesisView>('POST', `/api/research/hypotheses/${id}/evidence`, b),
  removeHypothesisEvidence: (id: string, ref: string) => send<HypothesisView>('DELETE', `/api/research/hypotheses/${id}/evidence?ref=${encodeURIComponent(ref)}`),
  reviewHypothesis: (id: string, b: Record<string, unknown>) => send<HypothesisView>('POST', `/api/research/hypotheses/${id}/reviews`, b),
  calendar: (from?: string, to?: string) => get<{ from: string; to: string; entries: CalendarEntryView[]; note: string }>(`/api/calendar${from ? `?from=${from}&to=${to}` : ''}`),
  createCalendarEntry: (b: Record<string, unknown>) => send<CalendarEntryView>('POST', '/api/calendar', b),
  updateCalendarEntry: (id: string, b: Record<string, unknown>) => send<CalendarEntryView>('PATCH', `/api/calendar/${id}`, b),
  coverage: (windowH = 24) => get<CoverageReport>(`/api/coverage?window=${windowH}`),
  targets: () => get<ObservationTarget[]>('/api/observation-targets'),
  maritimeSources: () => get<{ _readme: string; researched_at: string; sources: { id: string; name: string; url: string; docs: string[]; access: string; data: string; decision: string; limits: string; investigation_url_template: string | null }[] }>('/api/maritime/sources'),
  vessels: () => get<VesselView[]>('/api/maritime/vessels'),
  createVessel: (b: Record<string, unknown>) => send<VesselView>('POST', '/api/maritime/vessels', b),
  addVesselIdentifier: (id: string, b: Record<string, unknown>) => send<VesselView>('POST', `/api/maritime/vessels/${id}/identifiers`, b),
  addVesselAttribute: (id: string, b: Record<string, unknown>) => send<VesselView>('POST', `/api/maritime/vessels/${id}/attributes`, b),
  reviewMention: (id: string, b: Record<string, unknown>) => send<VesselView>('POST', `/api/maritime/mentions/${id}/review`, b),
  scanMentions: () => send<{ proposed: number; unresolved: number }>('POST', '/api/maritime/scan'),
  setPins: (pinned: string[]) => send<ObservationTarget[]>('PUT', '/api/observation-targets/pins', { pinned }),
  event: (id: string) => get<TrackerEvent>(`/api/events/${encodeURIComponent(id)}`),
  cachedTranslation: (id: string) => get<import('../shared/translation').NewsTranslation | null>(`/api/events/${encodeURIComponent(id)}/translation`),
  translation: (id: string) => send<import('../shared/translation').NewsTranslation>('POST', `/api/events/${encodeURIComponent(id)}/translation`),
  status: () => get<Status>('/api/status'),
  events: (includeFiltered: boolean) => get<TrackerEvent[]>(`/api/events?limit=400${includeFiltered ? '&include_filtered=1' : ''}`),
  counterparts: (id: string) => get<Counterpart[]>(`/api/markets/${encodeURIComponent(id)}/counterparts`),
  tgChannels: () => get<TgChannel[]>('/api/telegram/channels'),
  tgOverview: (days: number, channel?: string) => get<TgOverview>(`/api/telegram/overview?days=${days}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`),
  tgPosts: (channel?: string) => get<TgPost[]>(`/api/telegram/posts?limit=600${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`),
  sensors: () => get<SensorSeries[]>('/api/sensors'),
  assets: () => get<AssetsFile>('/api/assets'),
  market: (id: string) => get<Market>(`/api/markets/${encodeURIComponent(id)}`),
  markets: () => get<Market[]>('/api/markets'),
  history: (id: string) => get<MarketHistory & { fetch_state: string; error: string | null }>(`/api/markets/${id}/history`),
  refresh: async () => {
    const r = await fetch('/api/refresh', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j as Status;
  },
};

export function subscribeStream(onEvent: (event: string, data: any) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  try {
    const es = new EventSource('/api/stream');
    es.addEventListener('refresh', (e) => {
      try { onEvent('refresh', JSON.parse(e.data)); } catch { onEvent('refresh', null); }
    });
    es.addEventListener('alerts', (e) => {
      try { onEvent('alerts', JSON.parse(e.data)); } catch { onEvent('alerts', null); }
    });
    es.addEventListener('connected', (e) => {
      try { onEvent('connected', JSON.parse(e.data)); } catch { onEvent('connected', null); }
    });
    return () => { es.close(); };
  } catch {
    return () => {};
  }
}
