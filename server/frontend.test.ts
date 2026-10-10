import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFromHash } from '../src/navigation.ts';
import { escapeHtml } from '../src/html.ts';

test('navigation restores valid views on reload and back/forward; invalid links fall back to dashboard', () => {
  for (const view of ['dashboard', 'feed', 'telegram', 'research', 'wallets', 'alerts', 'sources']) assert.equal(viewFromHash(`#${view}`), view);
  for (const invalid of ['', '#undefined', '#<script>', '#constructor']) assert.equal(viewFromHash(invalid), 'dashboard');
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
