import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Market, TrackerEvent } from '../shared/types.ts';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-movers-')), 't.sqlite');
const { db } = await import('./db.ts');
const { observedChanges } = await import('./views.ts');
const { groupMarkets, rankMovers } = await import('../shared/movers.ts');

const mk = (id: string, event: string, question: string, o: Partial<Market> = {}): Market => ({
  condition_id: id, venue: 'polymarket', volume_unit: 'USD', open_interest: null, event_id: event, event_title: `Event ${event}`, question, outcome_label: 'Yes',
  price: 0.5, quote_basis: 'midpoint', best_bid: null, best_ask: null, spread: null, wide_spread: false, one_day_change: null, one_week_change: null,
  change_24h: null, change_basis: null, volume_total: null, volume_24h: 5000, liquidity: null, end_date: null, start_date: null, provider_updated_at: null,
  observed_at: '', resolution_url: '', resolution_text: '', tags: [], history_points: 0, ...o,
});
const news = (id: string, story: string, contracts: string[], hoursAgo: number) => ({
  id, timestamp: new Date(Date.now() - hoursAgo * 3600_000).toISOString(), title: id, story: { story_id: story },
  linked_contracts: contracts.map((condition_id) => ({ condition_id })),
}) as unknown as TrackerEvent;

test('movers: an event ranks by its biggest credible move; a move on a thin market does not count', () => {
  const ms = [
    mk('p1', 'perim', 'Perim Island no longer under Houthi control by October 31?', { change_24h: 0.19, price: 0.45 }),
    mk('p2', 'perim', 'Perim Island no longer under Houthi control by December 31?', { change_24h: 0.37, price: 0.7 }),
    mk('t1', 'thin', 'Will the USS Theodore Roosevelt arrive in CENTCOM by October 31?', { change_24h: 0.27, volume_24h: 345 }),
    mk('q1', 'quiet', 'Will Iran target Iraq by October 15?', { change_24h: 0.01 }),
    mk('o1', 'oil', 'Military action against Saudi Oil Pipeline by October 31?', { change_24h: -0.11 }),
  ];
  const groups = groupMarkets(ms, [news('n1', 's1', ['o1'], 2), news('n2', 's1', ['o1'], 1), news('n3', 's2', ['o1'], 5)]);
  const { movers, thinOnly } = rankMovers(groups);
  assert.deepEqual(movers.map((g) => g.lead.condition_id), ['p2', 'o1'], 'Perim (37 pp) then the pipeline (−11 pp); thin and quiet events left out');
  assert.equal(thinOnly, 1, 'the thin-only move is counted, not shown');
  const perim = movers[0];
  assert.deepEqual(perim.ladder.map((m) => perim.labels.get(m.condition_id)), ['December 31?', 'October 31?'], 'ladder by price, labels without the shared words');
  assert.deepEqual(movers[1].news.map((e) => e.id), ['n2', 'n3'], 'one item per story, newest first');
});

test('movers: Kalshi contracts are labelled by their outcome text', () => {
  const k = (id: string, tail: string) => mk(id, 'hz', `${id === 'k1' ? '25' : '30'} transit calls through the Strait of Hormuz this week? — ${tail}`, { venue: 'kalshi', volume_unit: 'contracts' });
  const [g] = groupMarkets([k('k1', 'Above 25'), k('k2', 'Above 30')], []);
  assert.equal(g.labels.get('k1'), 'Above 25');
});

test('observed 24h change: latest observation minus the one nearest 24 h earlier, only inside the 22–26 h window', () => {
  const ins = db.prepare('INSERT INTO market_obs (condition_id, observed_at, price) VALUES (?,?,?)');
  const at = (h: number) => new Date(Date.parse('2026-10-10T12:00:00Z') - h * 3600_000).toISOString();
  ins.run('k-ok', at(25), 0.2); ins.run('k-ok', at(23.5), 0.3); ins.run('k-ok', at(0), 0.42);
  ins.run('k-short', at(10), 0.2); ins.run('k-short', at(0), 0.5);   // only 10 h of history: no 24h figure
  const ch = observedChanges(db, ['k-ok', 'k-short', 'k-none']);
  assert.equal(ch.get('k-ok'), 0.12, 'reference is the 23.5 h observation (nearest to 24 h)');
  assert.equal(ch.has('k-short'), false);
  assert.equal(ch.has('k-none'), false);
});
