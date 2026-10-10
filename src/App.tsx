import { contextFromHash, navigateContext, useHashContext, useViewNavigation } from './navigation';
import { useDraft } from './workspace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Market, Status, TrackerEvent } from '../shared/types';
import { api, subscribeStream } from './api';
import { StatusBar, type View } from './components/StatusBar';
import { FeedView } from './components/FeedView';
import { SourcesView } from './components/SourcesView';
import { WalletsView } from './components/WalletsView';
import { AlertsView } from './components/AlertsView';
import { ResearchView } from './components/research/ResearchView';
import { EventList } from './components/EventList';
import { RightPanel } from './components/RightPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TelegramView } from './components/TelegramView';
import { WatchlistBar } from './components/WatchlistBar';
import { ToastContainer } from './components/Toast';
import { ShortcutsModal } from './components/ShortcutsModal';
import { SubNav } from './components/SubNav';
import { SimpleDetail } from './components/SimpleDetail';
import { useGlobalShortcuts } from './shortcuts';
import { MARKET_SOURCES, SENSOR_SOURCES_IDS, WALLET_SOURCE_IDS, versionKey } from './store';

export function App() {
  const context = useHashContext();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [restoreRetry, setRestoreRetry] = useState(0);
  const statusFailed = useRef(false);
  const [lastContact, setLastContact] = useState<number | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [followMarket, setFollowMarket] = useDraft('follow-market', true);
  const [simple, setSimple] = useDraft('monitor-simple', true);
  const [newsWidth, setNewsWidth] = useDraft('news-width', 25);
  const [chartWidth, setChartWidth] = useDraft('chart-width', 55);
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [focusedMarket, setFocusedMarket] = useState<Market | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showFiltered, setShowFiltered] = useDraft('dashboard-showFiltered', false);
  const [query, setQuery] = useDraft('dashboard-query', '');
  const [topic, setTopic] = useDraft('dashboard-topic', 'all');
  const [tier, setTier] = useDraft('dashboard-tier', 'all');
  const [scope, setScope] = useDraft<'all' | 'focus'>('dashboard-scope', 'all');
  const [eventId, setEventId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [view, setView] = useViewNavigation();
  const visited = useRef(new Set<View>(['dashboard']));
  visited.current.add(view);
  const [sensorSelection, setSensorSelection] = useState<{ id: string; request: number } | null>(null);
  const [eventSelection, setEventSelection] = useState(0);
  const [unread, setUnread] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const [focusedEvent, setFocusedEvent] = useState<TrackerEvent | null>(null);
  const eventRequest = useRef(0);
  const marketRequest = useRef(0);
  const dataRequest = useRef(0);
  const [dossierRequest, setDossierRequest] = useState(0);
  const [openDossier, setOpenDossier] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastRefresh = useRef<string | null>(null);
  const initialised = useRef(false);

  const loadData = useCallback(async () => {
    const request = ++dataRequest.current;
    try {
      const [ev, mk] = await Promise.all([api.events(showFiltered), api.markets()]);
      if (request !== dataRequest.current) return;
      setEvents(ev); setMarkets(mk); setError(null);
      if (!initialised.current && ev.length) {
        initialised.current = true;
        const restored = contextFromHash(window.location.hash);
        if (restored.event || restored.market) return;
        const first = ev.find((e) => e.relevant && e.linked_contracts.length) ?? null;
        if (first) { setEventId(first.id); setContractId(first.linked_contracts[0].condition_id); navigateContext({ event: first.id, market: first.linked_contracts[0].condition_id }, undefined, true); }
        else if (mk.length) { setContractId(mk[0].condition_id); navigateContext({ market: mk[0].condition_id }, undefined, true); }
      }
    } catch (e) { if (request !== dataRequest.current) return; setError(`Could not load data: ${(e as Error).message}. Showing whatever is on screen.`); }
  }, [showFiltered]);

  // Poll status; reload data whenever a refresh completes.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.status();
        if (stop) return;
        setStatus(s); setConnectionError(null); setLastContact(Date.now());
        if (statusFailed.current) { statusFailed.current = false; setError(null); setRestoreRetry((n) => n + 1); loadData(); }
        // Progressive refresh: any source whose stored data changed (even mid-cycle) triggers a reload; a finished cycle always does.
        const sig = `${s.last_refresh_finished_at}|${Object.entries(s.versions ?? {}).sort().map(([k, v]) => `${k}:${v}`).join(',')}`;
        if (sig !== lastRefresh.current) { lastRefresh.current = sig; loadData(); }
      } catch (e) { if (!stop) { statusFailed.current = true; setConnectionError((e as Error).message); } }
    };
    tick();
    const id = setInterval(tick, status?.refreshing ? 2500 : 20000);
    return () => { stop = true; clearInterval(id); };
  }, [loadData, status?.refreshing]);

  // Server-Sent Events for instant push updates (with polling as fallback)
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    return subscribeStream((evt) => {
      if (evt === 'refresh') {
        api.status().then((s) => {
          setStatus(s);
          loadDataRef.current();
        }).catch(() => {});
      } else if (evt === 'alerts') {
        api.alerts().then((a) => setAlertCount(a.unacked)).catch(() => {});
      } else if (evt === 'connected') {
        api.status().then((s) => setStatus(s)).catch(() => {});
        api.alerts().then((a) => setAlertCount(a.unacked)).catch(() => {});
      }
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const refresh = async () => { try { setStatus(await api.refresh()); setError(null); } catch (e) { setError(`Refresh failed: ${(e as Error).message}`); } };
  const marketVer = versionKey(status?.versions, MARKET_SOURCES);
  const allVer = Object.entries(status?.versions ?? {}).sort().map(([k, v]) => `${k}:${v}`).join(',');
  useEffect(() => { api.feedUnread().then((u) => setUnread(u.counts.all ?? 0)).catch(() => { /* badge is optional */ }); }, [allVer, view]);
  const walletVer = versionKey(status?.versions, WALLET_SOURCE_IDS);
  const alertVer = versionKey(status?.versions, ['alerts']);
  useEffect(() => { api.alerts().then((a) => setAlertCount(a.unacked)).catch(() => { /* badge is optional */ }); }, [alertVer, view]);
  const openMarket = async (id: string, reveal = true) => {
    const request = ++marketRequest.current;
    try {
      const market = markets.find((m) => m.condition_id === id) ?? await api.market(id);
      if (request !== marketRequest.current) return;
      setFocusedMarket(market); setContractId(id); navigateContext({ market: id }, reveal ? 'dashboard' : undefined); setError(null);
    } catch (e) { if (request === marketRequest.current) setError(`Could not open this contract: ${(e as Error).message}`); }
  };
  const workspaceMarkets = focusedMarket && !markets.some((m) => m.condition_id === focusedMarket.condition_id) ? [...markets, focusedMarket] : markets;
  const openDossierView = (id: string) => { setOpenDossier(id); setDossierRequest((n) => n + 1); navigateContext({ dossier: id, tab: 'dossiers' }, 'research'); };
  // Opening an event from the feed: switch to the dashboard and select it (and its first linked contract) if it is loaded.
  const openEvent = async (id: string) => {
    const request = ++eventRequest.current;
    try {
      const e = events.find((x) => x.id === id) ?? await api.event(id);
      if (request !== eventRequest.current) return;
      setQuery(''); setTopic('all'); setTier('all'); setScope('all');
      setFocusedEvent(e); onSelect(e); navigateContext({}, 'dashboard'); setError(null);
    } catch (e) { if (request === eventRequest.current) setError(`Could not open this item: ${(e as Error).message}`); }
  };
  const sensorVer = versionKey(status?.versions, SENSOR_SOURCES_IDS);

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase();
    return events.filter((e) =>
      (topic === 'all' || e.topics.includes(topic)) && (tier === 'all' || e.reliability_tier === tier) && (scope === 'all' || e.focus_energy_shipping) &&
      (!s || `${e.title} ${e.summary} ${e.entities.join(' ')} ${e.location?.name ?? ''}`.toLowerCase().includes(s)));
  }, [events, query, topic, tier, scope]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const selected = events.find((e) => e.id === eventId) ?? (focusedEvent?.id === eventId ? focusedEvent : null);
  const selectContract = (id: string) => { void openMarket(id, false); };
  const onSelect = useCallback((e: TrackerEvent) => { ++eventRequest.current; setEventSelection((v) => v + 1); setEventId(e.id); const nextMarket = followMarket && e.linked_contracts.length ? e.linked_contracts[0].condition_id : contractId; navigateContext({ event: e.id, market: nextMarket }); }, [followMarket, contractId]);

  const onNextEvent = useCallback(() => {
    if (view !== 'dashboard') setView('dashboard');
    if (shown.length === 0) return;
    const curIdx = shown.findIndex((e) => e.id === eventId);
    const nextIdx = curIdx === -1 || curIdx >= shown.length - 1 ? 0 : curIdx + 1;
    onSelect(shown[nextIdx]);
  }, [view, setView, shown, eventId, onSelect]);

  const onPrevEvent = useCallback(() => {
    if (view !== 'dashboard') setView('dashboard');
    if (shown.length === 0) return;
    const curIdx = shown.findIndex((e) => e.id === eventId);
    const prevIdx = curIdx <= 0 ? shown.length - 1 : curIdx - 1;
    onSelect(shown[prevIdx]);
  }, [view, setView, shown, eventId, onSelect]);

  const onFocusSearch = useCallback(() => {
    if (view === 'dashboard') {
      const el = document.getElementById('dashboard-search');
      if (el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      }
    } else {
      const input = document.querySelector('input[type="search"]') as HTMLInputElement | null;
      input?.focus();
    }
  }, [view]);

  useGlobalShortcuts({
    onViewChange: (v) => setView(v),
    onRefresh: () => { void refresh(); },
    onNextItem: onNextEvent,
    onPrevItem: onPrevEvent,
    onFocusSearch,
    onBriefing: () => navigateContext({ tab: 'briefing' }, 'research'),
    onToggleHelp: () => setShortcutsOpen((o) => !o),
    onEscape: () => setShortcutsOpen(false),
  });

  useEffect(() => {
    const storageFailed = () => setStorageError(true);
    window.addEventListener('workspace-storage-error', storageFailed);
    return () => window.removeEventListener('workspace-storage-error', storageFailed);
  }, []);
  useEffect(() => {
    if (!context.event) return;
    const id = context.event, request = ++eventRequest.current;
    setEventId(id); setEventSelection((n) => n + 1);
    api.event(id).then((event) => { if (request === eventRequest.current) { setFocusedEvent(event); setError(null); } }).catch((e) => { if (request === eventRequest.current) setError(`Could not restore this item: ${e.message}`); });
  }, [context.event, restoreRetry]);
  useEffect(() => {
    if (!context.market) return;
    const id = context.market, request = ++marketRequest.current;
    setContractId(id);
    api.market(id).then((market) => { if (request === marketRequest.current) { setFocusedMarket(market); setError(null); } }).catch((e) => { if (request === marketRequest.current) setError(`Could not restore this contract: ${e.message}`); });
  }, [context.market, restoreRetry]);

  return (
    <div className="app" style={{ '--news-width': `${newsWidth}%`, '--chart-share': `${chartWidth}%` } as React.CSSProperties}>
      <ErrorBoundary name="Status bar"><StatusBar status={status} onRefresh={refresh} now={now} view={view} setView={setView} unread={unread} alerts={alertCount} onOpenShortcuts={() => setShortcutsOpen(true)} /></ErrorBoundary>
      {status?.collection_paused && status.mode !== 'seed' && <div className="banner seed small" role="status">Automatic source collection is paused. Stored data remain available; on-demand chart history and translation may still fetch.</div>}
      {status?.mode === 'seed' && <div className="banner seed" role="status"><b>DEMO SEED — not live.</b> Offline snapshot of real data captured {status.seed_captured_at ? new Date(status.seed_captured_at).toLocaleString() : 'at an unknown time'}. Nothing is being fetched; ages shown are relative to now, so source pills will go STALE as this snapshot ages.</div>}
      {status?.refreshing && events.length === 0 && markets.length === 0 && <div className="banner loading" role="status">First data load in progress — fetching prediction markets and news (about a minute). The page fills in automatically.</div>}
      {connectionError && <div className="banner" role="alert"><b>Tracker disconnected — showing cached data.</b> Last contact {lastContact ? new Date(lastContact).toLocaleString() : 'not established'}. {connectionError}</div>}
      {storageError && <div className="banner" role="alert">Browser storage is unavailable. Keep this page open to preserve unsaved drafts.</div>}
      {error && <div className="banner" role="alert">{error} <button onClick={() => { setRestoreRetry((n) => n + 1); loadData(); }}>Retry workspace</button></div>}
      {view === 'wallets' && <ErrorBoundary name="Watchlist"><WatchlistBar versionKey={`${marketVer}|${sensorVer}`} now={now} onOpenMarket={openMarket} onOpenSensor={(id) => { setSensorSelection((s) => ({ id, request: (s?.request ?? 0) + 1 })); setView('dashboard'); }} /></ErrorBoundary>}
      {visited.current.has('feed') && <div className="viewpage col" hidden={view !== 'feed'}><SubNav items={[{ id: 'feed', label: 'All items' }, { id: 'telegram', label: 'Telegram analysis' }]} view={view} setView={setView} /><ErrorBoundary name="Feed"><FeedView now={now} versionKey={allVer} seedMode={status?.mode === 'seed'} onOpenEvent={openEvent} /></ErrorBoundary></div>}
      {visited.current.has('wallets') && <div className="viewpage" hidden={view !== 'wallets'}><ErrorBoundary name="Wallets"><WalletsView now={now} versionKey={walletVer} onOpenMarket={openMarket} /></ErrorBoundary></div>}
      {visited.current.has('alerts') && <div className="viewpage col" hidden={view !== 'alerts'}><SubNav items={[{ id: 'sources', label: 'Sources' }, { id: 'alerts', label: 'Alerts', badge: alertCount }]} view={view} setView={setView} /><ErrorBoundary name="Alerts"><AlertsView now={now} versionKey={alertVer} onOpenMarket={openMarket} /></ErrorBoundary></div>}
      {visited.current.has('research') && <div className="viewpage" hidden={view !== 'research'}><ErrorBoundary name="Research"><ResearchView dossierRequest={dossierRequest} now={now} versionKey={allVer} openDossier={openDossier} onOpenMarket={openMarket} onOpenEvent={openEvent} /></ErrorBoundary></div>}
      {visited.current.has('sources') && <div className="viewpage col" hidden={view !== 'sources'}><SubNav items={[{ id: 'sources', label: 'Sources' }, { id: 'alerts', label: 'Alerts', badge: alertCount }]} view={view} setView={setView} /><ErrorBoundary name="Sources"><SourcesView now={now} versionKey={allVer} /></ErrorBoundary></div>}
      {visited.current.has('telegram') && <div className="viewpage col" hidden={view !== 'telegram'}><SubNav items={[{ id: 'feed', label: 'All items' }, { id: 'telegram', label: 'Telegram analysis' }]} view={view} setView={setView} /><ErrorBoundary name="Telegram view"><TelegramView seedMode={status?.mode === 'seed'} refreshKey={status?.last_refresh_finished_at ?? null} now={now} onOpenEvent={openEvent} /></ErrorBoundary></div>}
      <main className="split" hidden={view !== 'dashboard'}>
        <ErrorBoundary name="Event feed"><EventList events={shown} total={events.length} selectedId={eventId} onSelect={onSelect} now={now}
          query={query} setQuery={setQuery} topic={topic} setTopic={setTopic} tier={tier} setTier={setTier} scope={scope} setScope={setScope}
          showFiltered={showFiltered} setShowFiltered={setShowFiltered} simple={simple} setSimple={setSimple} markets={workspaceMarkets} /></ErrorBoundary>
        {simple
          ? <ErrorBoundary name="Item detail"><SimpleDetail event={selected} markets={workspaceMarkets} contractId={contractId} setContractId={selectContract} onOpenDossier={openDossierView} now={now} /></ErrorBoundary>
          :         <ErrorBoundary name="Chart & detail panel"><RightPanel followMarket={followMarket} setFollowMarket={setFollowMarket} sensorSelection={sensorSelection} active={view === 'dashboard'} eventSelection={eventSelection} marketVer={marketVer} sensorVer={sensorVer} walletVer={walletVer} onOpenDossier={openDossierView} onSelectEvent={onSelect} mapEvents={shown} markets={workspaceMarkets} events={events} event={selected} contractId={contractId} setContractId={selectContract} now={now} /></ErrorBoundary>}
      </main>
      <ToastContainer />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
