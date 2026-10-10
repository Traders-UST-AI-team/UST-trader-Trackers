import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankDesk } from '../shared/desk.ts';
import type { Market, TrackerEvent } from '../shared/types.ts';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const H = 3600_000;

function ev(id: string, title: string, o: Partial<TrackerEvent> & { hoursAgo?: number; storyId?: string; groups?: number } = {}): TrackerEvent {
  const { hoursAgo = 1, storyId, groups = 1, ...rest } = o;
  return {
    id, timestamp: new Date(NOW - hoursAgo * H).toISOString(), collected_at: new Date(NOW - hoursAgo * H).toISOString(),
    source_id: 'bbc-me', source_name: 'BBC News — Middle East', source_kind: 'news', originating_source: null, source_affiliation: '', source_scope: null,
    modified_at: null, revision_count: 0, reliability_tier: 'Tier-1', claim_status: 'reported', time_precision: 'instant', publisher_time_note: null,
    feed_key: `web:x:${id}`, vessel_types: [], publisher: null, title, location: null, entities: ['Iran'], topics: ['security'], summary: '', raw_url: 'https://x',
    language: 'en', relevant: true, linked_contracts: [], title_en: null, focus_energy_shipping: false, event_time: null, assets: [],
    story: storyId ? { story_id: storyId, size: 2, publishers: [], independence_groups: groups, state_only: false, note: '' } : null,
    ...rest,
  };
}
const link = (condition_id: string, score = 5) => ({ condition_id, venue: 'polymarket' as const, question: `Q ${condition_id}`, price: 0.4, score, matched_entities: ['Iran'], matched_topics: ['shipping'] });
const market = (condition_id: string, one_day_change: number) => ({ condition_id, price: 0.4, one_day_change } as Market);

test('desk: a confirmed, market-linked development ranks first with its reasons; features and untopical items are left out', () => {
  const markets = new Map([['hz', market('hz', -0.09)]]);
  const events = [
    ev('a1', 'Iran strikes tanker in Strait of Hormuz', { storyId: 's1', groups: 4, topics: ['security', 'shipping'], focus_energy_shipping: true, linked_contracts: [link('hz')] }),
    ev('a2', 'Tanker hit in Hormuz, Iran Guards say', { storyId: 's1', groups: 4, source_id: 'guardian-me', source_name: 'The Guardian — Middle East', topics: ['shipping'], linked_contracts: [link('hz')] }),
    ev('f1', 'In photos: Iran celebrates ancient Mehregan Festival', { reliability_tier: 'Tier-3', topics: [] }),
    ev('f2', 'Film | Iranian rock climbers show their power', { reliability_tier: 'Tier-3', topics: [] }),
  ];
  const r = rankDesk(events, markets, NOW);
  assert.equal(r.stories.length, 1);
  const s = r.stories[0];
  assert.equal(s.band, 'top');
  assert.equal(s.items.length, 2, 'both outlets fold into one story');
  assert.ok(s.reasons.some((x) => x.key === 'market' && x.label.includes('▼ 9.0 pp')), 'the linked market move is a stated reason');
  assert.ok(s.reasons.some((x) => x.key === 'confirm' && x.label === '4 independent outlets'));
  assert.equal(r.considered, 4);
  assert.equal(r.dropped, 2, 'the two feature items are counted as left out, not shown');
});

test('desk: stories about the same development fold into one thread headed by straight news, not the live blog', () => {
  const markets = new Map([['sa', market('sa', 0.07)]]);
  const base = { topics: ['security'], entities: ['Saudi Arabia', 'Houthis'], linked_contracts: [link('sa')] };
  const events = [
    ev('l1', 'Security Council LIVE: Yemen in spotlight as Houthi attacks on Saudi Arabia escalate', { ...base, storyId: 'live', groups: 3, source_id: 'un-news-me', source_name: 'UN News — Middle East', source_kind: 'official' }),
    ev('l2', 'Security Council LIVE: Houthi attacks on Saudi Arabia', { ...base, storyId: 'live', groups: 3, source_id: 'un-press', source_name: 'UN Press', source_kind: 'official' }),
    ev('h1', 'Houthi attack on Riyadh airport kills three Saudi nationals', { ...base, storyId: 'hit', groups: 6, hoursAgo: 3 }),
    ev('h2', 'Three killed in Houthi attacks on Riyadh airport', { ...base, storyId: 'hit', groups: 6, hoursAgo: 2, source_id: 'sky-world', source_name: 'Sky News' }),
  ];
  const r = rankDesk(events, markets, NOW);
  assert.equal(r.stories.length, 1, 'one thread, not two rows');
  assert.match(r.stories[0].lead.title, /Riyadh airport/);
  assert.equal(r.stories[0].related.length, 1);
  assert.match(r.stories[0].related[0].lead.title, /LIVE/);
});

test('desk: items outside the window and filtered-out items are not considered', () => {
  const events = [
    ev('old', 'Iran missile attack on tanker', { hoursAgo: 30, storyId: 'x', groups: 5 }),
    ev('irrelevant', 'Iran missile attack on tanker again', { relevant: false, storyId: 'y', groups: 5 }),
  ];
  const r = rankDesk(events, new Map(), NOW, 24);
  assert.equal(r.considered, 0);
  assert.equal(r.stories.length, 0);
  assert.equal(rankDesk(events, new Map(), NOW, 48).considered, 1);
});

test('desk: one moving contract linked to several stories gives its full move to the best-linked story only', () => {
  const markets = new Map([['perim', market('perim', 0.365)]]);
  const base = { topics: ['security', 'shipping'], focus_energy_shipping: true };
  const events = [
    ev('y1', 'Houthis withdraw from Perim Island in Bab el-Mandeb', { ...base, storyId: 'perim', groups: 3, entities: ['Houthis', 'Perim'], linked_contracts: [link('perim', 9)] }),
    ev('y2', 'Saudi coalition jets strike targets near Hodeidah port', { ...base, storyId: 'hod', groups: 3, entities: ['Hodeidah'], linked_contracts: [link('perim', 5)] }),
    ev('y3', 'Tanker diverted after drone sighting off Mocha', { ...base, storyId: 'mocha', groups: 3, entities: ['Mocha'], linked_contracts: [link('perim', 4)] }),
    ev('y4', 'Aden government announces fuel export halt', { ...base, storyId: 'aden', groups: 3, entities: ['Aden'], linked_contracts: [link('perim', 6)] }),
  ];
  const r = rankDesk(events, markets, NOW);
  assert.equal(r.stories.length, 4, 'all four stories still rank on their own merits');
  const withMove = r.stories.filter((s) => s.reasons.some((x) => x.label.includes('36.5 pp')));
  assert.deepEqual(withMove.map((s) => s.lead.id), ['y1'], 'only the best-linked story carries the move');
  assert.equal(withMove[0].reasons.find((x) => x.key === 'market')?.points, 4);
  assert.equal(r.stories[0].lead.id, 'y1', 'and it ranks first');
  for (const s of r.stories.filter((s) => s.lead.id !== 'y1')) {
    const shared = s.reasons.find((x) => x.key === 'market-shared');
    assert.ok(shared && shared.points === 1, `${s.lead.id} only touches a moving market`);
    assert.ok(!s.reasons.some((x) => x.key === 'market'), `${s.lead.id} has no full market reason`);
    assert.ok(s.contracts.some((c) => c.change_24h === 0.365), 'the contract and its move stay visible in the detail');
  }
});
