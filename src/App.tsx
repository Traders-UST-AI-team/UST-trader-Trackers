import { contextFromHash, navigateContext, useHashContext, useViewNavigation } from './navigation';
import { useDraft } from './workspace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Market, Status, TrackerEvent } from '../shared/types';
import { api, subscribeStream } from './api';
import { StatusBar } from './components/StatusBar';
import type { View } from './views';
import { FeedView } from './components/FeedView';
import { SourcesView } from './components/SourcesView';
import { MarketsView } from './components/MarketsView';
import { AlertsView } from './components/AlertsView';
import { ResearchView } from './components/research/ResearchView';
import { Desk, storyContains } from './components/Desk';
import { rankDesk, type DeskStory } from '../shared/desk';
import { RightPanel } from './components/RightPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TelegramView } from './components/TelegramView';
import { ToastContainer } from './components/Toast';
import { ShortcutsModal } from './components/ShortcutsModal';
import { SubNav } from './components/SubNav';
import { SimpleDetail } from './components/SimpleDetail';
import { useGlobalShortcuts } from './shortcuts';
import { MARKET_SOURCES, SENSOR_SOURCES_IDS, WALLET_SOURCE_IDS, versionKey } from './store';
import { ReviewTrackerView } from './components/reviews/ReviewTrackerView';

export function App() {
  const context = useHashContext();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [restoreRetry, setRestoreRetry] = useState(0);
  const statusFailed = useRef(false);
  const [lastContact, setLastContact] = useState<number | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [followMarket, setFollowMarket] = useDraft('follow-market', true);
  const [mobileDetail, setMobileDetail] = useState(!!context.event);
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo({ top: 0 });
  }, [mobileDetail]);
  const [simple, setSimple] = useDraft('monitor-simple', true);
  const [newsWidth, setNewsWidth] = useDraft('news-width', 25);
  const [chartWidth, setChartWidth] = useDraft('chart-width', 55);
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [focusedMarket, setFocusedMarket] = useState<Market | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useDraft('dashboard-query', '');
  const [deskHours, setDeskHours] = useDraft('desk-hours', 24);
  const [seen, setSeen] = useDraft<Record<string, string>>('desk-seen', {});
  // "New" means updated since the previous visit and not opened since; the first visit marks nothing.
  const [lastVisit, setLastVisit] = useDraft('desk-visit', 0);
  const [since] = useState(lastVisit);
  useEffect(() => { setLastVisit(Date.now()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      const [ev, mk] = await Promise.all([api.events(false), api.markets()]);
      if (request !== dataRequest.current) return;
      setEvents(ev); setMarkets(mk); setError(null);
      if (!initialised.current && ev.length) {
        initialised.current = true;
        const restored = contextFromHash(window.location.hash);
        if (restored.event || restored.market) return;
        const first = rankDesk(ev, new Map(mk.map((m) => [m.condition_id, m])), Date.now()).stories[0]?.lead ?? ev.find((e) => e.relevant && e.linked_contracts.length) ?? null;
        if (first) { const market = first.linked_contracts[0]?.condition_id; setEventId(first.id); if (market) setContractId(market); navigateContext({ event: first.id, market }, undefined, true); }
        else if (mk.length) { setContractId(mk[0].condition_id); navigateContext({ market: mk[0].condition_id }, undefined, true); }
      }
    } catch (e) { if (request !== dataRequest.current) return; setError(`Could not load data: ${(e as Error).message}. Showing whatever is on screen.`); }
  }, []);

  // Poll status; reload data whenever a refresh completes.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        // The poll also asks the server to keep stored data fresh; that is a POST, so a plain
        // status read (used elsewhere) never triggers collection.
        const s = await api.keepFresh();
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
  const workspaceMarkets = workspaceMarketsOf(markets, focusedMarket);
  const openDossierView = (id: string) => { setOpenDossier(id); setDossierRequest((n) => n + 1); navigateContext({ dossier: id, tab: 'dossiers' }, 'research'); };
  // Opening an event from the feed: switch to the dashboard and select it (and its first linked contract) if it is loaded.
  const openEvent = async (id: string) => {
    const request = ++eventRequest.current;
    try {
      const e = events.find((x) => x.id === id) ?? await api.event(id);
      if (request !== eventRequest.current) return;
      setQuery('');
      setFocusedEvent(e); onSelect(e); navigateContext({}, 'dashboard'); setError(null);
    } catch (e) { if (request === eventRequest.current) setError(`Could not open this item: ${(e as Error).message}`); }
  };
  const sensorVer = versionKey(status?.versions, SENSOR_SOURCES_IDS);

  const marketById = useMemo(() => new Map(workspaceMarketsOf(markets, focusedMarket).map((m) => [m.condition_id, m])), [markets, focusedMarket]);
  const desk = useMemo(() => rankDesk(events, marketById, now, deskHours), [events, marketById, now, deskHours]);
  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return null;
    // One headline per outlet: Google News feeds overlap, so the same article can arrive through several of them.
    const once = new Set<string>();
    return events.filter((e) => {
      if (!`${e.title} ${e.title_en ?? ''} ${e.summary} ${e.entities.join(' ')} ${e.location?.name ?? ''}`.toLowerCase().includes(s)) return false;
      const k = `${e.publisher ?? e.source_id}|${e.title}`;
      if (once.has(k)) return false;
      once.add(k); return true;
    });
  }, [events, query]);
  const shown = results ?? events;
  // Feed rows say when an item belongs to a story on the Monitor, so the two views read as one desk.
  const deskMarks = useMemo(() => {
    const m = new Map<string, string>();
    let rank = 0;
    for (const t of desk.stories) {
      const label = t.band === 'top' ? `Monitor #${++rank}` : 'Monitor';
      for (const s of [t, ...t.related]) for (const e of s.items) m.set(e.id, label);
    }
    return m;
  }, [desk]);
  // j/k walk the list as it is shown: the ranked stories, or the search results.
  const order = useMemo(() => results ?? desk.stories.map((s) => s.lead), [results, desk]);
  const thread = desk.stories.find((s) => storyContains(s, eventId)) ?? null;
  const story: DeskStory | null = thread ? (thread.items.some((e) => e.id === eventId) ? thread : thread.related.find((r) => r.items.some((e) => e.id === eventId)) ?? null) : null;
  const related = thread && story ? [thread, ...thread.related].filter((s) => s !== story) : [];

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const selected = events.find((e) => e.id === eventId) ?? (focusedEvent?.id === eventId ? focusedEvent : null);
  const selectContract = (id: string) => { void openMarket(id, false); };
  // Contracts opened from Research or Alerts open on the Markets page, where every contract has a chart.
  const [marketFocus, setMarketFocus] = useState<{ id: string; request: number } | null>(null);
  const showInMarkets = (id: string) => { setMarketFocus((f) => ({ id, request: (f?.request ?? 0) + 1 })); setView('wallets'); };
  const onSelect = useCallback((e: TrackerEvent) => {
    const s = desk.stories.flatMap((t) => [t, ...t.related]).find((t) => t.items.some((x) => x.id === e.id));
    if (s) setSeen((prev) => { const live = new Set(desk.stories.flatMap((t) => [t.id, ...t.related.map((r) => r.id)])); const next: Record<string, string> = {}; for (const [k, v] of Object.entries(prev)) if (live.has(k)) next[k] = v; next[s.id] = s.last_at; return next; });
    setMobileDetail(true); ++eventRequest.current; setEventSelection((v) => v + 1); setEventId(e.id); const nextMarket = followMarket && e.linked_contracts.length ? e.linked_contracts[0].condition_id : contractId; navigateContext({ event: e.id, market: nextMarket }); }, [followMarket, contractId, desk, setSeen]);

  const onNextEvent = useCallback(() => {
    if (view !== 'dashboard') setView('dashboard');
    if (order.length === 0) return;
    const curIdx = order.findIndex((e, i) => (results ? e.id === eventId : storyContains(desk.stories[i], eventId)));
    const nextIdx = curIdx === -1 || curIdx >= order.length - 1 ? 0 : curIdx + 1;
    onSelect(order[nextIdx]);
  }, [view, setView, order, results, desk, eventId, onSelect]);

  const onPrevEvent = useCallback(() => {
    if (view !== 'dashboard') setView('dashboard');
    if (order.length === 0) return;
    const curIdx = order.findIndex((e, i) => (results ? e.id === eventId : storyContains(desk.stories[i], eventId)));
    const prevIdx = curIdx <= 0 ? order.length - 1 : curIdx - 1;
    onSelect(order[prevIdx]);
  }, [view, setView, order, results, desk, eventId, onSelect]);

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
      {view !== 'reviews' && status?.collection_paused && status.mode !== 'seed' && <div className="banner seed small" role="status">Automatic source collection is paused. Stored data remain available; on-demand chart history and translation may still fetch.</div>}
      {view !== 'reviews' && status?.mode === 'seed' && <div className="banner seed" role="status"><b>Demo workspace</b><span>Offline data{status.seed_captured_at ? ` · captured ${new Date(status.seed_captured_at).toLocaleDateString()}` : ''} · not live</span></div>}
      {view !== 'reviews' && status?.refreshing && events.length === 0 && markets.length === 0 && <div className="banner loading" role="status">First data load in progress — fetching prediction markets and news (about a minute). The page fills in automatically.</div>}
      {connectionError && <div className="banner" role="alert"><b>Tracker disconnected — showing cached data.</b> Last contact {lastContact ? new Date(lastContact).toLocaleString() : 'not established'}. {connectionError}</div>}
      {storageError && <div className="banner" role="alert">Browser storage is unavailable. Keep this page open to preserve unsaved drafts.</div>}
      {error && <div className="banner" role="alert">{error} <button onClick={() => { setRestoreRetry((n) => n + 1); loadData(); }}>Retry workspace</button></div>}
      {visited.current.has('feed') && <div className="viewpage col" hidden={view !== 'feed'}><SubNav items={[{ id: 'feed', label: 'All items' }, { id: 'telegram', label: 'Telegram analysis' }]} view={view} setView={setView} /><ErrorBoundary name="Feed"><FeedView now={now} versionKey={allVer} seedMode={status?.mode === 'seed'} onOpenEvent={openEvent} deskMarks={deskMarks} /></ErrorBoundary></div>}
      {visited.current.has('wallets') && <div className="viewpage" hidden={view !== 'wallets'}><ErrorBoundary name="Markets"><MarketsView now={now} markets={workspaceMarkets} focus={marketFocus} events={events} walletVer={walletVer} onOpenEvent={openEvent}
        onOpenSensor={(id) => { setSensorSelection((s) => ({ id, request: (s?.request ?? 0) + 1 })); setSimple(false); setView('dashboard'); }} /></ErrorBoundary></div>}
      {visited.current.has('alerts') && <div className="viewpage col" hidden={view !== 'alerts'}><SubNav items={[{ id: 'sources', label: 'Sources' }, { id: 'alerts', label: 'Alerts', badge: alertCount }]} view={view} setView={setView} /><ErrorBoundary name="Alerts"><AlertsView now={now} versionKey={alertVer} onOpenMarket={showInMarkets} /></ErrorBoundary></div>}
      {visited.current.has('research') && <div className="viewpage" hidden={view !== 'research'}><ErrorBoundary name="Research"><ResearchView dossierRequest={dossierRequest} now={now} versionKey={allVer} openDossier={openDossier} onOpenMarket={showInMarkets} onOpenEvent={openEvent} markets={workspaceMarkets} /></ErrorBoundary></div>}
      {visited.current.has('sources') && <div className="viewpage col" hidden={view !== 'sources'}><SubNav items={[{ id: 'sources', label: 'Sources' }, { id: 'alerts', label: 'Alerts', badge: alertCount }]} view={view} setView={setView} /><ErrorBoundary name="Sources"><SourcesView now={now} versionKey={allVer} /></ErrorBoundary></div>}
      {visited.current.has('telegram') && <div className="viewpage col" hidden={view !== 'telegram'}><SubNav items={[{ id: 'feed', label: 'All items' }, { id: 'telegram', label: 'Telegram analysis' }]} view={view} setView={setView} /><ErrorBoundary name="Telegram view"><TelegramView seedMode={status?.mode === 'seed'} refreshKey={status?.last_refresh_finished_at ?? null} now={now} onOpenEvent={openEvent} /></ErrorBoundary></div>}
      {visited.current.has('reviews') && <div className="viewpage" hidden={view !== 'reviews'}><ErrorBoundary name="Review Tracker"><ReviewTrackerView /></ErrorBoundary></div>}
      {view === 'dashboard' && !simple && <div className="advanced-return"><button className="quiet-button" onClick={() => { setSimple(true); setMobileDetail(false); }}>← Back to simple monitor</button></div>}
      <main className={`split ${mobileDetail ? 'mobile-detail' : ''}`} hidden={view !== 'dashboard'}>
        <ErrorBoundary name="Ranked stories"><Desk desk={desk} hours={deskHours} setHours={setDeskHours} results={results} query={query} setQuery={setQuery}
          selectedId={eventId} onSelect={onSelect} now={now} seen={seen} since={since} onOpenFeed={() => setView('feed')} /></ErrorBoundary>
        {simple
          ? <ErrorBoundary name="Item detail"><SimpleDetail story={story} related={related} onSelect={onSelect} onBack={() => setMobileDetail(false)} onAdvanced={() => setSimple(false)} event={selected} markets={workspaceMarkets} contractId={contractId} setContractId={selectContract} onOpenDossier={openDossierView} now={now} /></ErrorBoundary>
          :         <ErrorBoundary name="Chart & detail panel"><RightPanel followMarket={followMarket} setFollowMarket={setFollowMarket} sensorSelection={sensorSelection} active={view === 'dashboard'} eventSelection={eventSelection} marketVer={marketVer} sensorVer={sensorVer} walletVer={walletVer} onOpenDossier={openDossierView} onSelectEvent={onSelect} mapEvents={shown} markets={workspaceMarkets} events={events} event={selected} contractId={contractId} setContractId={selectContract} now={now} /></ErrorBoundary>}
      </main>
      <ToastContainer />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function workspaceMarketsOf(markets: Market[], focused: Market | null): Market[] {
  return focused && !markets.some((m) => m.condition_id === focused.condition_id) ? [...markets, focused] : markets;
}
