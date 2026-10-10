import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFromHash } from '../src/navigation.ts';
import { escapeHtml } from '../src/html.ts';

test('navigation restores valid views on reload and back/forward; invalid links fall back to dashboard', async () => {
  // Read the registry rather than restating the list: this test previously omitted two views the
  // app offered, which is exactly the drift a duplicated list produces.
  const { VIEW_IDS } = await import('../src/views.ts');
  for (const view of VIEW_IDS) assert.equal(viewFromHash(`#${view}`), view);
  for (const invalid of ['', '#undefined', '#<script>', '#constructor', '#not-a-view']) assert.equal(viewFromHash(invalid), 'dashboard');
});
test('provider and user text remains literal in chart HTML tooltips', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'source\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;source&#39;');
});

test('context links preserve concrete records and reject oversized or invalid research tabs', async () => {
  const { contextFromHash } = await import('../src/navigation.ts');
  assert.equal(viewFromHash('#research?tab=hypotheses&hypothesis=hy_123'), 'research');
  assert.deepEqual(contextFromHash('#dashboard?event=evt_123&market=kalshi%3Atest'), { event: 'evt_123', market: 'kalshi:test' });
  assert.deepEqual(contextFromHash(`#research?tab=unknown&dossier=${'x'.repeat(201)}`), {});
});
test('obsolete feed/search and pagination responses cannot commit after a newer query', async () => {
  const { RequestGeneration } = await import('../src/workspace.ts');
  const generations = new RequestGeneration();
  let releaseOld: (value: string[]) => void = () => {};
  let rows: string[] = []; let loading = true;
  const older = generations.next();
  const delayed = new Promise<string[]>((resolve) => { releaseOld = resolve; }).then((result) => { if (generations.isCurrent(older)) { rows = [...rows, ...result]; loading = false; } });
  const newer = generations.next();
  if (generations.isCurrent(newer)) rows = ['Arabic search result'];
  releaseOld(['previous-filter page']); await delayed;
  assert.deepEqual(rows, ['Arabic search result']);
  assert.equal(loading, true, 'obsolete finally must not end loading for the new query');
  assert.equal(generations.isCurrent(newer), true);
});

test('keyboard schedule input rejects impossible dates and round-trips the browser local time', async () => {
  const { validLocalDateTime, localDateTime } = await import('../src/workspace.ts');
  assert.equal(validLocalDateTime('2030-01-01T12:00'), true);
  assert.equal(localDateTime(new Date('2030-01-01T12:00').toISOString()), '2030-01-01T12:00');
  for (const value of ['2030-02-30T12:00', '2030-01-01T25:00', 'invalid', '2030-01-01']) assert.equal(validLocalDateTime(value), false);
});

test('toast notification store tracks active items, types, and supports manual dismissal', async () => {
  const { toast, getToasts, dismissToast, clearToasts } = await import('../src/toast.ts');
  clearToasts();
  assert.equal(getToasts().length, 0);

  const id1 = toast('Pinned contract', 'info', 0);
  const id2 = toast('Copied link', 'success', 0);
  assert.equal(getToasts().length, 2);
  assert.equal(getToasts()[0].id, id1);
  assert.equal(getToasts()[0].text, 'Pinned contract');
  assert.equal(getToasts()[0].type, 'info');
  assert.equal(getToasts()[1].id, id2);
  assert.equal(getToasts()[1].type, 'success');

  dismissToast(id1);
  assert.equal(getToasts().length, 1);
  assert.equal(getToasts()[0].id, id2);

  clearToasts();
  assert.equal(getToasts().length, 0);
});

test('keyboard shortcut handler maps navigation keys and handles non-input actions', async () => {
  const { handleShortcutKey, VIEW_KEY_MAP, isInputElement } = await import('../src/shortcuts.ts');
  assert.equal(VIEW_KEY_MAP['1'], 'dashboard');
  assert.equal(VIEW_KEY_MAP['2'], 'feed');
  assert.equal(VIEW_KEY_MAP['3'], 'wallets');
  assert.equal(VIEW_KEY_MAP['4'], 'research');
  assert.equal(VIEW_KEY_MAP['5'], 'sources');
  assert.equal(VIEW_KEY_MAP['6'], 'research', 'alias kept for one release');
  assert.equal(VIEW_KEY_MAP['7'], 'sources', 'alias kept for one release');

  let viewTarget: string | null = null;
  let refreshed = false;
  let nextCalled = false;
  let searchFocused = false;
  let helpToggled = false;
  let escaped = false;

  const handlers = {
    onViewChange: (v: any) => { viewTarget = v; },
    onRefresh: () => { refreshed = true; },
    onNextItem: () => { nextCalled = true; },
    onFocusSearch: () => { searchFocused = true; },
    onToggleHelp: () => { helpToggled = true; },
    onEscape: () => { escaped = true; },
  };

  const fakeEvt = (key: string, ctrl = false) => ({
    key,
    ctrlKey: ctrl,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault: () => {},
  } as unknown as KeyboardEvent);

  assert.equal(handleShortcutKey(fakeEvt('1'), handlers), true);
  assert.equal(viewTarget, 'dashboard');

  assert.equal(handleShortcutKey(fakeEvt('4'), handlers), true);
  assert.equal(viewTarget, 'research');

  assert.equal(handleShortcutKey(fakeEvt('r'), handlers), true);
  assert.equal(refreshed, true);

  assert.equal(handleShortcutKey(fakeEvt('j'), handlers), true);
  assert.equal(nextCalled, true);

  assert.equal(handleShortcutKey(fakeEvt('/'), handlers), true);
  assert.equal(searchFocused, true);

  assert.equal(handleShortcutKey(fakeEvt('?'), handlers), true);
  assert.equal(helpToggled, true);

  assert.equal(handleShortcutKey(fakeEvt('Escape'), handlers), true);
  assert.equal(escaped, true);

  // Upper-case alpha keys (e.g. CapsLock enabled) should still trigger shortcuts
  let capNextCalled = false;
  let capRefreshCalled = false;
  assert.equal(handleShortcutKey(fakeEvt('J'), { onNextItem: () => { capNextCalled = true; } }), true);
  assert.equal(capNextCalled, true);
  assert.equal(handleShortcutKey(fakeEvt('R'), { onRefresh: () => { capRefreshCalled = true; } }), true);
  assert.equal(capRefreshCalled, true);

  // Modified keys should be ignored
  assert.equal(handleShortcutKey(fakeEvt('r', true), handlers), false);
  assert.equal(isInputElement(null), false);
});

test('toast store caps active toasts, deduplicates identical messages, and supports hover pause/resume', async () => {
  const { toast, getToasts, clearToasts, pauseToast, resumeToast } = await import('../src/toast.ts');
  clearToasts();

  // Deduplication
  const idA1 = toast('Message A', 'info', 5000);
  const idA2 = toast('Message A', 'info', 5000);
  assert.equal(idA1, idA2);
  assert.equal(getToasts().length, 1);

  // Capping at MAX_TOASTS (5)
  for (let i = 1; i <= 6; i++) {
    toast(`Message ${i}`, 'warn', 5000);
  }
  assert.equal(getToasts().length, 5);
  assert.equal(getToasts()[4].text, 'Message 6');

  // Pause and resume
  pauseToast(getToasts()[0].id);
  assert.ok(getToasts()[0].pausedAt != null);
  resumeToast(getToasts()[0].id);
  assert.equal(getToasts()[0].pausedAt, undefined);

  clearToasts();
});

test('formatHistoryCsv formats probability history and overlays into valid, aligned CSV', async () => {
  const { formatHistoryCsv } = await import('../src/export.ts');
  const dummyMarket: any = {
    condition_id: '0x123abc',
    venue: 'polymarket',
    question: 'Will Brent crude exceed $100?',
    outcome_label: 'Yes',
  };

  // Empty
  assert.equal(formatHistoryCsv({ market: dummyMarket, points: [] }), '');

  // With points and overlays
  const points = [
    { t: 1700000000, p: 0.5432 },
    { t: 1700003600, p: 0.60 },
  ];
  const overlays: any[] = [
    {
      id: 'sma24',
      label: 'SMA 24h',
      colorVar: '--series-2',
      dashed: false,
      points: [
        { t: 1700000000, value: 52.1, status: 'ok' },
        { t: 1700003600, value: null, status: 'gap' },
      ],
    },
  ];

  const csv = formatHistoryCsv({ market: dummyMarket, points, overlays });
  const lines = csv.split('\n');
  assert.equal(lines[0], 'timestamp_iso,timestamp_unix,probability_pct,overlay_sma24_pct');
  assert.equal(lines.length, 3);

  // Row 1: has both probability and overlay
  const row1 = lines[1].split(',');
  assert.equal(row1[0], new Date(1700000000 * 1000).toISOString());
  assert.equal(row1[1], '1700000000');
  assert.equal(row1[2], '54.32');
  assert.equal(row1[3], '52.10');

  // Row 2: gap in overlay produces empty string instead of zero
  const row2 = lines[2].split(',');
  assert.equal(row2[1], '1700003600');
  assert.equal(row2[2], '60.00');
  assert.equal(row2[3], '');
});

test('copyToClipboard falls back gracefully when Clipboard API is absent or rejects', async () => {
  const { copyToClipboard } = await import('../src/clipboard.ts');
  // In a headless Node testing environment without document or navigator, returns false gracefully
  const res = await copyToClipboard('https://example.com#dashboard');
  assert.equal(typeof res, 'boolean');
});


test('formatHistoryCsv writes sub-plot series in their own units and leaves gaps empty', async () => {
  const { formatHistoryCsv } = await import('../src/export.ts');
  const market = { venue: 'polymarket', condition_id: 'c' } as never;
  const csv = formatHistoryCsv({ market, points: [{ t: 3600, p: 0.5 }, { t: 7200, p: 0.52 }], panes: [{ id: 'rsi14', unit: '0_100', points: [{ t: 3600, value: null }, { t: 7200, value: 61.234 }] }] });
  const rows = csv.split('\n');
  assert.equal(rows[0], 'timestamp_iso,timestamp_unix,probability_pct,pane_rsi14_0_100');
  assert.equal(rows[1].endsWith(',50.00,'), true, 'warm-up is an empty cell, never 0');
  assert.equal(rows[2].endsWith(',52.00,61.23'), true);
});

// ── reviews workspace presentation rules ────────────────────────────────────────────────────────

test('reviews metrics: an unknown value renders as unknown, never as a plausible number', async () => {
  const m = await import('../src/components/reviews/metrics.ts');
  assert.equal(m.NO_VALUE, '—');
  assert.equal(m.formatTone(null), m.NO_VALUE);
  assert.equal(m.formatTone(undefined), m.NO_VALUE);
  assert.equal(m.formatTone(Number.NaN), m.NO_VALUE);
  assert.equal(m.formatDelta(null), m.NO_VALUE);
  assert.equal(m.formatCount(null), m.NO_VALUE);
  assert.equal(m.formatPercent(null), m.NO_VALUE);
  assert.equal(m.formatMillions(null), m.NO_VALUE);

  assert.equal(m.formatTone(0.5), '0.500');
  assert.equal(m.formatDelta(-0.214), '-0.214');
  assert.equal(m.formatDelta(0.2), '+0.200');
  assert.equal(m.formatCount(0), '0', 'a real zero is a value, not an absence');
  assert.equal(m.formatMillions(123_000_000), '$123M');
});

test('reviews metrics: the headline never invents a quarter or a number', async () => {
  const { headline } = await import('../src/components/reviews/metrics.ts');
  assert.match(headline(null, null), /Loading/);
  assert.match(headline({ latest_quarter: null }, 'Logitech'), /No stored reviews/);

  const text = headline({ latest_quarter: { quarter_label: 'FY25 Q2', avg_tone: 0.667, baseline_tone: 0.881, delta_tone: -0.214, review_count: 6 } as never }, 'Logitech');
  assert.match(text, /FY25 Q2/);
  assert.match(text, /0\.667/);
  assert.match(text, /-0\.214/);
  assert.doesNotMatch(text, /FY27/, 'the old fallback quarter label must be gone');
});

test('reviews metrics: one classification for a quarter, and a failed quarter says nothing it cannot', async () => {
  const { quarterAssessment } = await import('../src/components/reviews/metrics.ts');
  const { SIGNALS } = await import('../shared/review-signals.ts');

  // The server's flag wins when present.
  assert.equal(quarterAssessment({ delta_tone: -0.9, review_count: 40, is_negative_swing: true }).signal, 'negative_swing');
  assert.equal(quarterAssessment({ delta_tone: 0.3, review_count: 40, signal: 'positive' }).signal, 'positive');

  // Without a flag, the shared thresholds decide — the same numbers the server uses.
  assert.equal(quarterAssessment({ delta_tone: SIGNALS.negativeSwingDelta - 0.001, review_count: 40 }).signal, 'negative_swing');
  assert.equal(quarterAssessment({ delta_tone: SIGNALS.negativeSwingDelta + 0.001, review_count: 40 }).signal, 'stable');
  assert.equal(quarterAssessment({ delta_tone: 0.5, review_count: 40 }).label, 'Positive expansion');
  assert.equal(quarterAssessment({ delta_tone: 0, review_count: 40 }).tone, 'flat');

  // Sparse quarters are flagged from the shared threshold, not a literal.
  assert.equal(quarterAssessment({ delta_tone: 0, review_count: SIGNALS.sparseReviewCount - 1 }).sparse, true);
  assert.equal(quarterAssessment({ delta_tone: 0, review_count: SIGNALS.sparseReviewCount }).sparse, false);
});

test('reviews metrics: demo and sample rows are labelled wherever they count', async () => {
  const { summariseProvenance } = await import('../src/components/reviews/metrics.ts');
  const captured = { provenance: 'captured' } as never;

  const allCaptured = summariseProvenance([captured, captured]);
  assert.equal(allCaptured.label, null, 'pure evidence needs no disclaimer');
  assert.equal(allCaptured.captured, 2);

  const mixed = summariseProvenance([captured, { provenance: 'seed' } as never, { provenance: 'synthetic' } as never]);
  assert.equal(mixed.seed, 1);
  assert.equal(mixed.synthetic, 1);
  assert.match(mixed.label!, /1 demo rows/);
  assert.match(mixed.label!, /1 sample rows/);
  assert.match(mixed.label!, /only captured rows are evidence/);
});

test('reviews metrics: fiscal quarters are described for every year-end month, not three of them', async () => {
  const { fiscalYearEndNote } = await import('../src/components/reviews/metrics.ts');
  assert.match(fiscalYearEndNote(3), /March/);
  assert.match(fiscalYearEndNote(3), /Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar/);
  assert.match(fiscalYearEndNote(12), /Q1 Jan–Mar, Q2 Apr–Jun/);
  assert.match(fiscalYearEndNote(5), /Q1 Jun–Aug, Q2 Sep–Nov, Q3 Dec–Feb, Q4 Mar–May/);
  // Helen of Troy ends in February, which the old three-branch version mislabelled as December.
  assert.match(fiscalYearEndNote(2), /February/);
  assert.match(fiscalYearEndNote(2), /Q1 Mar–May/);
  assert.match(fiscalYearEndNote(null), /not loaded yet/);
});

test('versioned read: stale values survive a re-read, but never survive a failure', async () => {
  const { initialRead, reduceRead } = await import('../src/read.ts');

  const idle = initialRead<string[]>();
  assert.deepEqual(idle, { data: null, state: 'idle', error: null });

  const loaded = reduceRead(idle, { type: 'ready', value: ['a'] });
  assert.deepEqual(loaded, { data: ['a'], state: 'ready', error: null });

  // Stale-while-revalidate: a re-read keeps the previous value on screen.
  const reloading = reduceRead(loaded, { type: 'start' });
  assert.equal(reloading.state, 'loading');
  assert.deepEqual(reloading.data, ['a']);

  // A failure must not leave a value that looks current.
  const failed = reduceRead(reloading, { type: 'fail', message: 'Coverage could not be loaded: HTTP 503' });
  assert.equal(failed.state, 'error');
  assert.equal(failed.data, null, 'a failed read must not keep presenting the old value as current');
  assert.match(failed.error!, /HTTP 503/);

  // Recovering clears the error and produces a real value again.
  const recovered = reduceRead(failed, { type: 'ready', value: ['b'] });
  assert.deepEqual(recovered, { data: ['b'], state: 'ready', error: null });

  // An empty result is a value, not an absence.
  const empty = reduceRead(idle, { type: 'ready', value: [] });
  assert.deepEqual(empty.data, []);
  assert.equal(empty.state, 'ready');
});

// ── view registry ───────────────────────────────────────────────────────────────────────────────

test('view registry: one source of truth for id, label, key and workspace', async () => {
  const { VIEWS, VIEW_IDS, WORKSPACES, isView, navItemsFor, workspaceOf, viewByKey, VIEW_KEY_MAP } = await import('../src/views.ts');

  // Ids are unique and every id is a valid view.
  assert.equal(new Set(VIEW_IDS).size, VIEW_IDS.length);
  for (const id of VIEW_IDS) assert.equal(isView(id), true);
  assert.equal(isView('nope'), false);

  // Every view belongs to a declared workspace. A workspace with more than one view must offer
  // nav for them; a single-view workspace (reviews) needs none, which is why the shell hides it.
  const workspaceIds = WORKSPACES.map((w) => w.id);
  for (const v of VIEWS) assert.ok(workspaceIds.includes(v.workspace), `${v.id} has an unknown workspace`);
  for (const w of workspaceIds) {
    const inWorkspace = VIEWS.filter((v) => v.workspace === w);
    if (inWorkspace.length > 1) assert.ok(navItemsFor(w).length > 0, `workspace ${w} has several views but no nav`);
    else assert.equal(navItemsFor(w).length, 0, `workspace ${w} has one view and should not need a nav`);
  }

  // Nav entries are the views that say they are in the nav, and they all read well.
  for (const v of VIEWS) {
    if (v.navLabel !== null) {
      assert.ok(v.navLabel.length > 0);
      assert.ok(v.title.length > 0, `${v.id} has no title for its nav button`);
    }
  }

  // Keys are unique, resolve to their own view, and every view with a key is reachable by it.
  const keys = VIEWS.filter((v) => v.key).map((v) => v.key!);
  assert.equal(new Set(keys).size, keys.length, 'two views claim the same key');
  for (const v of VIEWS) if (v.key) assert.equal(viewByKey(v.key), v.id);

  // The map the shortcut handler uses agrees with the registry, aliases included.
  for (const v of VIEWS) if (v.key) assert.equal(VIEW_KEY_MAP[v.key], v.id);
  assert.equal(VIEW_KEY_MAP['6'], 'research');
  assert.equal(VIEW_KEY_MAP['7'], 'sources');
  assert.equal(Object.keys(VIEW_KEY_MAP).length, keys.length + 2);

  // The sub-views that are only reachable from a nav entry still belong to a workspace.
  assert.equal(workspaceOf('telegram'), 'dashboard');
  assert.equal(workspaceOf('alerts'), 'dashboard');
  assert.equal(workspaceOf('reviews'), 'reviews');
});

test('view registry: the shortcut table and the key map cannot disagree', async () => {
  const { SHORTCUT_LIST } = await import('../src/shortcuts.ts');
  const { VIEW_KEY_MAP, viewSpec } = await import('../src/views.ts');

  const navShortcuts = SHORTCUT_LIST.filter((s) => s.category === 'Navigation');
  const navKeys = navShortcuts.map((s) => s.key);

  // Every key the handler can act on is documented for the operator.
  for (const key of Object.keys(VIEW_KEY_MAP)) {
    assert.ok(navKeys.includes(key), `key "${key}" opens a view but is not in the shortcut list`);
  }

  // And every documented navigation key is either a real view key or an alias.
  for (const key of navKeys) {
    if (key === 'b') continue; // opens the briefing, not a view
    assert.ok(VIEW_KEY_MAP[key], `shortcut "${key}" is documented but opens nothing`);
  }

  // The label the operator sees names the destination they actually land on.
  for (const shortcut of navShortcuts) {
    const target = VIEW_KEY_MAP[shortcut.key];
    if (!target) continue;
    assert.ok(shortcut.description.length > 0, `shortcut ${shortcut.key} has no description`);
    assert.ok(viewSpec(target).title.length > 0);
  }
});

test('client transport: one error mode for every resource', async () => {
  const { createServer } = await import('node:http');
  const { get, send } = await import('../src/http.ts');

  const server = createServer((req, res) => {
    const json = (code: number, body: string) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
    if (req.url === '/ok') return json(200, '{"value":7}');
    if (req.url === '/json-error') return json(503, '{"error":"provider blocked"}');
    if (req.url === '/no-message') return json(500, '{}');
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html>not json</html>');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    assert.deepEqual(await get(`${base}/ok`), { value: 7 });
    assert.deepEqual(await send('POST', `${base}/ok`, { anything: true }), { value: 7 });

    // The server's own message wins when it sent one — whichever resource asked.
    await assert.rejects(() => get(`${base}/json-error`), (e: Error) => e.message === 'provider blocked');
    await assert.rejects(() => send('PUT', `${base}/json-error`, {}), (e: Error) => e.message === 'provider blocked');

    // Without a message, the status is reported rather than a parse failure.
    await assert.rejects(() => get(`${base}/no-message`), (e: Error) => e.message === `${base}/no-message → HTTP 500`);

    // A non-JSON error body must not turn into a confusing JSON parse error.
    await assert.rejects(() => get(`${base}/html`), (e: Error) => e.message === `${base}/html → HTTP 404`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('read keys: an inline tuple is the same key on every render, so a read cannot loop', async () => {
  const { readKeyId } = await import('../src/read.ts');
  // Two renders build two different arrays with the same contents: that must not count as a change.
  assert.equal(readKeyId(['v1', 0, null]), readKeyId(['v1', 0, null]));
  assert.notEqual(readKeyId(['v1', 0, null]), readKeyId(['v1', 1, null]));
  assert.equal(readKeyId('watchlist:3'), 'watchlist:3');
  assert.equal(readKeyId(null), null);
});
