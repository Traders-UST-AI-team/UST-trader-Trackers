import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACKER_DB = join(mkdtempSync(join(tmpdir(), 'wt-')), 't.sqlite');
const { chooseQuote } = await import('./sources/polymarket.ts');
const { kalshiQuote } = await import('./sources/kalshi.ts');
const { parseFeed, storeFeed, canonicalUrl, tidySummary, stripDateline } = await import('./sources/rss.ts');
const { geolocate, extractEntities, extractTopics, isMiddleEastRelevant } = await import('./geo.ts');
const { db } = await import('./db.ts');
const { NEWS_SOURCES, ALL_SOURCES, SENSOR_SOURCES, WALLET_SOURCES } = await import('./registry.ts');
const { policyOf } = await import('./sourcehealth.ts');
const { allSourceDefs, boundsOf } = await import('./sourceconfig.ts');
const { extractArticleLinks, parseArticle } = await import('./sources/maersk.ts');
const { storeParsed } = await import('./sources/rss.ts');
const { matchPair, buildIdf } = await import('./link.ts');
const { parseCzibList, parseCzibDetail, czibItems } = await import('./sources/easa.ts');
const { parseGoogleNews, publisherTier } = await import('./sources/gnews.ts');
const { fcdoItems } = await import('./sources/fcdo.ts');
const { parseOfacListing } = await import('./sources/ofac.ts');
const { outletKey } = await import('./sources/rss.ts');
const { parseChannelPage, parseCount } = await import('./sources/telegram.ts');
const { analyzePost, extractFlags, detectLang, extractAttributions, reportKind } = await import('./telegram-analysis.ts');
const { matchTelegramToEvents, cleanPostText } = await import('./telegram.ts');
const { extractEventTime } = await import('./eventtime.ts');
const { isEnergyShippingFocus } = await import('./geo.ts');
const { parseEml, emailItem } = await import('./sources/inbox.ts');
const { ADAPTERS } = await import('./adapters.ts');
const { findCounterparts, SCORE_MIN } = await import('./equivalence.ts');
const { linkAssets } = await import('./assets.ts');
const { rebuildStories, storyFor } = await import('./story.ts');
import { readFileSync } from 'node:fs';

test('quote: midpoint only when both sides valid', () => {
  assert.deepEqual(chooseQuote({ bestBid: 0.69, bestAsk: 0.7, lastTradePrice: 0.5 }), { price: 0.695, basis: 'midpoint' });
});
test('quote: falls back to labelled last trade, never to zero', () => {
  assert.deepEqual(chooseQuote({ bestBid: 0, bestAsk: 0.7, lastTradePrice: 0.4 }), { price: 0.4, basis: 'last_trade' });
  assert.deepEqual(chooseQuote({}), { price: null, basis: null });
  assert.equal(chooseQuote({ bestBid: 0.8, bestAsk: 0.7 }).basis, null); // crossed book is invalid
});

test('geo: outlet name is not evidence of place', () => {
  assert.equal(geolocate('Israel assassinated navy chief - exclusive', 'By The Jerusalem Post staff')?.name, 'Israel');
  assert.deepEqual(extractEntities('Report from The Jerusalem Post about nothing').all, []);
});
test('geo: headline subject wins; country centroid flagged approximate', () => {
  assert.equal(geolocate('Iran says Strait of Hormuz could reopen as Tehran weighs response', '')?.name, 'Strait of Hormuz');
  assert.equal(geolocate('Tanker hit off Qatar', '')?.precision, 'country');
  assert.equal(geolocate('Local election results in Ohio', 'Voters in Jordan Peterson fan club'), null);
});
test('relevance: non-ME geopolitics excluded, ME included', () => {
  assert.equal(isMiddleEastRelevant('Russia says NATO troops in Baltics would be escalation'), false);
  assert.equal(isMiddleEastRelevant('Houthi missile hits tanker in Red Sea'), true);
  assert.ok(extractTopics('Houthi missile hits tanker').includes('shipping'));
});

const BBC = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Tanker hit in Gulf off Qatar &amp; more]]></title><description><![CDATA[A vessel reported an explosion.]]></description>
<link>https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&amp;at_campaign=rss</link><guid isPermaLink="false">https://www.bbc.co.uk/news/articles/abc#0</guid><pubDate>Thu, 08 Oct 2026 12:11:31 GMT</pubDate></item>
<item><title>Undated item</title><link>https://example.com/x</link></item></channel></rss>`;
const RW = `<rss version="2.0"><channel><item><title>Syria: Overview Map</title><link>https://reliefweb.int/map/x</link><pubDate>Thu, 08 Oct 2026 13:03:09 +0000</pubDate>
<description>&lt;div class="tag country"&gt;Countries: Syrian Arab Republic, Iraq&lt;/div&gt;&lt;div class="tag source"&gt;Source: UNHCR&lt;/div&gt;&lt;p&gt;Please refer to the attached Map.&lt;/p&gt;</description></item></channel></rss>`;

test('rss: parses, strips tracking params, drops undated items', () => {
  const items = parseFeed(BBC);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.bbc.co.uk/news/articles/abc');
  assert.equal(items[0].title, 'Tanker hit in Gulf off Qatar & more');
  assert.equal(items[0].publishedAt, '2026-10-08T12:11:31.000Z');
  assert.equal(canonicalUrl('https://a.com/p?utm_source=x&id=3'), 'https://a.com/p?id=3');
});
test('rss: extracts originating source from structured tags', () => {
  const [it] = parseFeed(RW);
  assert.equal(it.originating, 'UNHCR');
  assert.deepEqual(it.countries, ['Syrian Arab Republic', 'Iraq']);
  assert.equal(it.summary, 'Please refer to the attached Map.');
});
test('ingest is idempotent: second run adds nothing', () => {
  const src = NEWS_SOURCES[0];
  const a = storeFeed(src, BBC), b = storeFeed(src, BBC);
  assert.equal(a.inserted, 1);
  assert.equal(b.inserted, 0);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c, 1);
  const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>;
  assert.match(String(row.id), /^evt_20261008_[0-9a-f]{6}$/);
});
test('storage is atomic per batch and ids never collide for same-URL items', () => {
  const src = NEWS_SOURCES.find((x) => x.id === 'fcdo')!;
  const mk = (n: number) => ({ externalId: `/foreign-travel-advice/iran|t${n}`, url: 'https://www.gov.uk/foreign-travel-advice/iran', title: `Update ${n}`, summary: 'Iran strikes advice.', publishedAt: '2026-10-05T10:00:00.000Z', originating: null, countries: ['Iran'] });
  const r = storeParsed(src, [mk(1), mk(2), mk(3)]); // same URL, same day
  assert.equal(r.inserted, 3);
  assert.throws(() => storeParsed(src, [mk(4), { ...mk(5), publishedAt: 'not-a-date' as unknown as string, externalId: null as unknown as string }]));
  assert.equal((db.prepare("SELECT COUNT(*) c FROM events WHERE source_id = 'fcdo' AND external_id LIKE '%|t4'").get() as { c: number }).c, 0, 'failed batch must roll back');
});
test('empty/changed feed fails loudly instead of silently storing nothing', () => {
  assert.throws(() => storeFeed(NEWS_SOURCES[0], '<rss><channel></channel></rss>'), /zero usable items/);
});

test('summary: leading headline repeat dropped, long text cut at word boundary', () => {
  assert.equal(tidySummary('Big news today', 'Big news today. The details follow here.'), 'The details follow here.');
  const long = tidySummary('t', 'word '.repeat(300));
  assert.ok(long.endsWith('…') && long.length <= 601 && !long.endsWith('wor…'));
});

test('kalshi quote: empty 0/1 book is not a midpoint; last trade is labelled', () => {
  assert.deepEqual(kalshiQuote({ yes_bid_dollars: '0.9800', yes_ask_dollars: '0.9900', last_price_dollars: '0.9900' }), { price: 0.985, basis: 'midpoint', bid: 0.98, ask: 0.99 });
  const empty = kalshiQuote({ yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000', last_price_dollars: '0.0100' });
  assert.equal(empty.basis, 'last_trade'); assert.equal(empty.price, 0.01); assert.equal(empty.bid, null); assert.equal(empty.ask, null);
  assert.equal(kalshiQuote({ yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000', last_price_dollars: '0.0000' }).price, null);
});

test('maersk: listing links and article metadata parse from real captured fixtures', () => {
  const links = extractArticleLinks(readFileSync(new URL('./fixtures/maersk_listing.html', import.meta.url), 'utf8'));
  assert.ok(links.length > 5);
  assert.ok(links.some((l) => /middle-east-operational-update/.test(l)));
  const it = parseArticle(readFileSync(new URL('./fixtures/maersk_article.html', import.meta.url), 'utf8'), 'https://www.maersk.com/news/articles/2026/10/07/middle-east-operational-update-51');
  assert.ok(it);
  assert.match(it!.title, /Middle East Operational Update/);
  assert.equal(it!.publishedAt, '2026-10-07T14:41:00.000Z');
  assert.equal(it!.modifiedAt, '2026-10-08T09:15:00.000Z');
  assert.match(it!.summary, /Strait of Hormuz/);
  assert.equal(parseArticle('<html><title>x</title></html>', 'u'), null); // no date → rejected
});
test('revisions: advanced modified time updates in place, once, keeping first publication', () => {
  const src = NEWS_SOURCES.find((x) => x.id === 'maersk-advisories')!;
  const base = { externalId: 'https://m/x', url: 'https://m/x', title: 'Update 7', summary: 'Hormuz bookings suspended.', publishedAt: '2026-10-01T00:00:00.000Z', originating: null, countries: [] };
  storeParsed(src, [{ ...base, modifiedAt: '2026-10-01T00:00:00.000Z' }]);
  storeParsed(src, [{ ...base, summary: 'Hormuz bookings resumed.', modifiedAt: '2026-10-02T00:00:00.000Z' }]);
  storeParsed(src, [{ ...base, summary: 'Hormuz bookings resumed.', modifiedAt: '2026-10-02T00:00:00.000Z' }]); // same version again
  const r = db.prepare("SELECT summary, revision_count, published_at FROM events WHERE source_id = ? AND external_id = ?").get(src.id, 'https://m/x') as Record<string, unknown>;
  assert.equal(r.summary, 'Hormuz bookings resumed.');
  assert.equal(r.revision_count, 1);
  assert.equal(r.published_at, '2026-10-01T00:00:00.000Z');
});

test('feed time later than first collection is placed at collection time, publisher value kept; small skew is tolerated', () => {
  const src = NEWS_SOURCES.find((x) => x.id === 'jpost-me')!;
  const future = new Date(Date.now() + 3 * 3600e3).toISOString(), skew = new Date(Date.now() + 2 * 60e3).toISOString();
  const before = Date.now();
  storeParsed(src, [
    { externalId: 'fut-1', url: 'https://j/fut-1', title: 'Iran item stamped three hours ahead', summary: 'Tehran.', publishedAt: future, originating: null, countries: [] },
    { externalId: 'fut-2', url: 'https://j/fut-2', title: 'Iran item with clock skew', summary: 'Tehran.', publishedAt: skew, originating: null, countries: [] },
  ]);
  const get = (id: string) => db.prepare('SELECT published_at, first_seen_at, publisher_time_raw FROM events WHERE source_id = ? AND external_id = ?').get(src.id, id) as Record<string, string | null>;
  const a = get('fut-1'), b = get('fut-2');
  assert.equal(a.published_at, a.first_seen_at);
  assert.ok(Date.parse(a.published_at!) >= before - 1000);
  assert.equal(a.publisher_time_raw, future);
  assert.equal(b.published_at, skew); // within 10 min: publisher value used as-is
  assert.equal(b.publisher_time_raw, null);
});

test('stories: cross-outlet coverage groups; unrelated and same-outlet items do not', () => {
  const mk = (srcId: string, k: string, title: string, summary: string, minsAgo: number) => {
    const src = NEWS_SOURCES.find((x) => x.id === srcId)!;
    storeParsed(src, [{ externalId: `story-${k}`, url: `https://x/${k}`, title, summary, publishedAt: new Date(Date.now() - minsAgo * 60_000).toISOString(), originating: null, countries: [] }]);
  };
  mk('bbc-me', 'a', 'Houthi missile hits tanker in Red Sea, maritime agency says', 'A vessel reported an explosion after a Houthi missile struck near Hodeidah in the Red Sea.', 90);
  mk('guardian-me', 'b', 'Tanker struck by Houthi missile off Yemen', 'The tanker was hit in the Red Sea; the Houthis claimed the missile attack near Hodeidah, officials said.', 60);
  mk('bbc-me', 'c', 'Houthi missile attack on tanker: what we know', 'Explainer on the Red Sea tanker strike near Hodeidah by Houthi forces.', 30); // same outlet as 'a'
  mk('mee', 'd', 'Iran central bank raises rates as rial slides', 'Tehran’s central bank raised interest rates again as the rial weakened further against the dollar.', 45);
  rebuildStories();
  const ids = (k: string) => (db.prepare('SELECT id FROM events WHERE external_id = ?').get(`story-${k}`) as { id: string }).id;
  const a = storyFor(ids('a')), b = storyFor(ids('b'));
  assert.ok(a && b && a.story_id === b.story_id, 'BBC and Guardian items should be one story');
  assert.equal(storyFor(ids('d')), null, 'unrelated Iran-economy item stays alone');
  assert.ok(a!.publishers.length >= 2 && a!.independence_groups >= 2);
  assert.match(a!.note, /not verification/i);
});

test('link rule v3 vs hand-labelled benchmark: regression gate, v1 baseline printed', () => {
  const bench = JSON.parse(readFileSync(new URL('./fixtures/link_benchmark.json', import.meta.url), 'utf8')) as { pairs: { event: string; contract: string; label: boolean | null; split: string }[] };
  const corpus = (JSON.parse(readFileSync(new URL('./fixtures/contracts_corpus.json', import.meta.url), 'utf8')) as { texts: string[] }).texts;
  const idf = buildIdf(corpus);
  const score = (rule: (e: string, c: string) => boolean, split?: string) => {
    let tp = 0, fp = 0, fn = 0, tn = 0; const wrong: string[] = [];
    for (const p of bench.pairs.filter((x) => x.label !== null && (!split || x.split === split))) {
      const got = rule(p.event, p.contract);
      if (got && p.label) tp++; else if (got) { fp++; wrong.push(`FP ${p.contract.slice(0, 45)} ← ${p.event.slice(0, 45)}`); }
      else if (p.label) { fn++; wrong.push(`FN ${p.contract.slice(0, 45)} ← ${p.event.slice(0, 45)}`); } else tn++;
    }
    return { tp, fp, fn, tn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), wrong };
  };
  // v1 baseline: any shared ME entity + any shared topic (generic topics need ≥2 entities).
  const v1 = (e: string, c: string) => {
    const eE = new Set(extractEntities(e).me), cE = extractEntities(c).me.filter((n) => eE.has(n));
    const eT = new Set(extractTopics(e)), cT = extractTopics(c).filter((t) => eT.has(t));
    return cE.length > 0 && cT.length > 0 && (cE.length >= 2 || cT.some((t) => ['security', 'shipping', 'energy', 'sanctions', 'nuclear'].includes(t)));
  };
  const rule = (e: string, c: string) => matchPair(e, c, idf) !== null;
  const all1 = score(v1), all3 = score(rule), dev = score(rule, 'dev'), ho = score(rule, 'holdout-1');
  const f = (x: { precision: number; recall: number; tp: number; fp: number; fn: number }) => `P ${x.precision.toFixed(2)} R ${x.recall.toFixed(2)} (tp ${x.tp} fp ${x.fp} fn ${x.fn})`;
  console.log(`link benchmark — v1 all: ${f(all1)} | v3 all: ${f(all3)} | v3 dev: ${f(dev)} | v3 holdout-1: ${f(ho)}`, all3.wrong);
  assert.ok(all3.precision >= 0.8, `precision regressed: ${all3.precision.toFixed(2)} ${all3.wrong.join(' | ')}`);
  assert.ok(all3.recall >= 0.75, `recall regressed: ${all3.recall.toFixed(2)} ${all3.wrong.join(' | ')}`);
  assert.ok(all3.precision > all1.precision + 0.2, 'v3 must clearly beat v1 precision');
});
test('link rule v2: implied entities and coverage', () => {
  assert.ok(matchPair('IRGC navy seizes tanker in Strait of Hormuz, shipping halted', 'Will Iran close the Strait of Hormuz by Dec 31?'));
  assert.equal(matchPair('Israel strikes Gaza', 'Israel military action against Lebanon on October 31?'), null);
});

test('google news: publisher + tier come from the item, headline suffix stripped, no body text kept', () => {
  const items = parseGoogleNews(readFileSync(new URL('./fixtures/gnews_hormuz.xml', import.meta.url), 'utf8'));
  assert.ok(items.length >= 5);
  for (const it of items) { assert.ok(it.publisher); assert.equal(it.summary, ''); assert.ok(!it.title.endsWith(` - ${it.publisher}`)); assert.match(String(it.tier), /^Tier-[123]$/); }
  assert.equal(publisherTier('Reuters').tier, 'Tier-1');
  assert.equal(publisherTier('Press TV').tier, 'Tier-3');
  assert.equal(publisherTier('Some Unknown Gazette').tier, 'Tier-2');
  assert.match(publisherTier('Some Unknown Gazette').note, /not individually rated/);
});
test('outlet keys: one outlet via two feeds is one outlet', () => {
  assert.equal(outletKey('BBC News — Middle East'.split(' — ')[0]), 'bbc');
  assert.equal(outletKey('BBC News'), 'bbc');
  assert.equal(outletKey('The Guardian'), 'guardian');
  assert.equal(outletKey('The New York Times'), 'nyt');
  assert.notEqual(outletKey('Reuters'), outletKey('AFP'));
});
test('fcdo: change-log entries become dated official items; routine edits are not promoted', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/fcdo_iran.json', import.meta.url), 'utf8'));
  const items = fcdoItems(doc, 'iran', Date.parse('2026-10-09T00:00:00Z'));
  assert.ok(items.length >= 1);
  assert.match(items[0].title, /^UK FCDO travel advice update — Iran:/);
  assert.match(items[0].summary, /advises against all travel to the whole country/);
  assert.equal(new Set(items.map((i) => i.externalId)).size, items.length); // each log entry distinct
  const dull = fcdoItems({ ...doc, details: { ...doc.details, change_history: [{ note: 'Updated information about prescription medication.', public_timestamp: '2026-10-01T00:00:00Z' }] } }, 'iran', Date.parse('2026-10-09T00:00:00Z'));
  assert.equal(dull[0].forceRelevant, false);
});
test('ofac: dated titles parse with date-only precision', () => {
  const items = parseOfacListing(readFileSync(new URL('./fixtures/ofac_listing.html', import.meta.url), 'utf8'));
  assert.ok(items.length >= 5);
  assert.ok(items.every((i) => i.timePrecision === 'date' && i.publishedAt.endsWith('T00:00:00.000Z') && i.url.startsWith('https://ofac.treasury.gov/recent-actions/')));
  assert.ok(items.some((i) => /Iran-related/i.test(i.title)));
});

test('telegram: real captured page parses channel info, text, media, forward, reply (fixture)', () => {
  const { info, posts } = parseChannelPage(readFileSync(new URL('./fixtures/telegram_channel.html', import.meta.url), 'utf8'), 'Middle_East_Spectator');
  assert.match(info.title ?? '', /Middle East Spectator/);
  assert.ok((info.subscribers ?? 0) > 100_000);
  assert.match(info.description ?? '', /not unbiased/i); // the channel's own viewpoint disclosure is captured verbatim
  assert.ok(posts.length >= 5);
  const byId = new Map(posts.map((p) => [p.post_id, p]));
  assert.ok(byId.get(37506)!.media.some((m) => m.type === 'photo' && m.url));
  assert.ok(byId.get(37514)!.media.some((m) => m.type === 'video'));
  assert.ok(byId.get(37524)!.forwarded_from, 'forward label captured');
  assert.ok(byId.get(37511)!.reply_to !== null, 'reply captured');
  assert.ok(!/quoted/i.test(byId.get(37511)!.text));
  for (const p of posts) { assert.ok(Date.parse(p.posted_at) > 0); assert.match(p.url, /^https:\/\/t\.me\/Middle_East_Spectator\/\d+$/); assert.ok(p.views === null || p.views > 0); }
  assert.equal(parseCount('41.6K'), 41600); assert.equal(parseCount('1.2M'), 1_200_000); assert.equal(parseCount(undefined), null);
});
test('telegram analysis: flags, language, attribution only near a reporting verb, report kinds', () => {
  assert.deepEqual(extractFlags('🇮🇷/🇶🇦/🇦🇪 BREAKING: ships'), ['Iran', 'Qatar', 'UAE']);
  assert.equal(detectLang('Yemeni missiles struck the airport'), 'en');
  assert.equal(detectLang('إيران تعلن عن هجوم جديد على الميناء'), 'ar');
  assert.equal(detectLang('ایران اعلام کرد که پهپادها را رهگیری کرده است'), 'fa');
  assert.ok(extractAttributions('Kpler says tanker traffic through Hormuz fell sharply').includes('Kpler'));
  assert.deepEqual(extractAttributions('Iran and the IRGC are mentioned here without any report'), []); // bare mention ≠ attribution
  assert.equal(reportKind('🚨 BREAKING: missile strike on port', false, false), 'breaking_claim');
  assert.equal(reportKind('', true, false), 'media_only');
  assert.equal(reportKind('Some text', false, true), 'forward');
  const a = analyzePost('🇾🇪/🇸🇦 NEW: Yemeni ballistic missiles struck Riyadh International Airport. Source: Al Mayadeen reports.', { hasMedia: false, isForward: false, links: ['https://t.me/x', 'https://www.example.com/a'] });
  assert.ok(a.entities.includes('Yemen') && a.entities.includes('Saudi Arabia'));
  assert.ok(a.claimKinds.includes('kinetic'));
  assert.deepEqual(a.domains, ['example.com']);
});

test('telegram cross-check: true pair is strong; country-name-only look-alike is only weak; unrelated is absent', () => {
  const nowMs = Date.now();
  const iso = (minAgo: number) => new Date(nowMs - minAgo * 60_000).toISOString();
  const ev = (id: string, title: string, summary: string, ents: string[], minAgo: number) => db.prepare(`INSERT INTO events (id, source_id, external_id, published_at, title, summary, raw_url, entities, topics, relevant, first_seen_at, last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).run(id, 'bbc-me', id, iso(minAgo), title, summary, `https://x/${id}`, JSON.stringify(ents), '[]', iso(0), iso(0));
  const post = (id: number, text: string, ents: string[], minAgo: number) => db.prepare(`INSERT INTO tg_posts (channel, post_id, posted_at, text, url, entities, first_seen_at, fetched_at) VALUES ('t', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, iso(minAgo), text, `https://t.me/t/${id}`, JSON.stringify(ents), iso(0), iso(0));
  ev('tgm_a', 'Attacks on tankers in Hormuz hit highest of any week since start of Iran war, sources say', 'Attacks on tankers around the Strait of Hormuz reached their highest weekly level since the war began.', ['Iran', 'Strait of Hormuz'], 60);
  ev('tgm_b', "Riyadh airport issues travel alert as Yemen's Houthis claim fresh attack on Saudi Arabia", 'Riyadh airport issued an alert after the Houthis claimed a new attack.', ['Saudi Arabia', 'Yemen', 'Houthis'], 60);
  post(9001, '🇮🇷/🇺🇸 NEW: Iranian attacks on shipping in the Strait of Hormuz have reached their highest level since the start of the war @chan', ['Iran', 'Strait of Hormuz', 'United States'], 120);
  post(9002, '🇺🇸/🇮🇱/🇾🇪 NEW: The U.S. Embassy in Jerusalem has issued a security alert, citing the situation between Yemen and Saudi Arabia @chan', ['Israel', 'Yemen', 'Saudi Arabia', 'United States'], 100);
  post(9003, '🇷🇺 NEW: Russia says a new satellite launch from Vostochny was successful and all stages performed nominally today', ['Russia'], 90);
  matchTelegramToEvents();
  const get = (pid: number) => db.prepare('SELECT event_id, strength FROM tg_matches WHERE channel = ? AND post_id = ?').all('t', pid) as { event_id: string; strength: string }[];
  assert.deepEqual(get(9001).map((m) => [m.event_id, m.strength]), [['tgm_a', 'strong']]);
  assert.ok(get(9002).every((m) => m.strength === 'weak'), 'shared country names + one word must not be a strong match');
  assert.equal(get(9003).length, 0);
  assert.equal(cleanPostText('🇮🇷/🇺🇸 NEW: Iranian attacks @chan https://x.y'), 'Iranian attacks');
});

test('arabic/persian: dictionary entities, topics and country-level place on real feed titles', () => {
  const ar = 'إسرائيل تستهدف قنصلية بريطانيا والغاية دفن الدولة الفلسطينية';
  assert.ok(extractEntities(ar).me.includes('Israel'));
  assert.ok(extractTopics(ar).includes('security'));
  assert.equal(geolocate(ar, '')?.precision, 'country');
  const taiz = '"لو يقطعوا علينا الهواء".. أبناء تعز يشكون وطأة الحصار';
  assert.ok(extractEntities(taiz).me.includes('Yemen'));
  assert.ok(extractEntities('وإيران تعلن عن هجوم').me.includes('Iran')); // attached conjunction prefix
  assert.deepEqual(extractEntities('مصرف مركزي جديد في المدينة').all, []); // "مصر" inside "مصرف" must not match Egypt
  assert.ok(extractEntities('تاکید پزشکیان بر اهمیت استمرار ارتباطات میان ایران و ارمنستان').me.includes('Iran'));
  assert.ok(extractTopics('تحریم‌های جدید علیه نفت ایران').includes('sanctions'));
  assert.deepEqual(extractEntities('پلیکان‌های دریاچه ارومیه در دام نمک!').all, []);
});
test('date-only fallback: undated feed takes the day from the URL and says so', () => {
  const xml = '<rss><channel><item><title>Iran to respond to US proposal</title><link>https://presstv.co.uk/Detail/2026/10/08/777893/Iran-to-respond</link></item><item><title>No date anywhere</title><link>https://presstv.co.uk/x</link></item></channel></rss>';
  assert.equal(parseFeed(xml).length, 0, 'without the opt-in, undated items are dropped');
  const items = parseFeed(xml, { dateFromUrl: true });
  assert.equal(items.length, 1);
  assert.equal(items[0].timePrecision, 'date');
  assert.equal(items[0].publishedAt, '2026-10-08T00:00:00.000Z');
});

test('registry integrity: unique ids, every source has tier + affiliation, key sources present', () => {
  const ids = NEWS_SOURCES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate source id');
  for (const x of NEWS_SOURCES) { assert.match(x.tier, /^Tier-[123]$/); assert.ok(x.affiliation.length > 10, `${x.id} lacks an affiliation`); assert.ok(x.intervalMin > 0); if (x.adapter === 'gnews') assert.ok(x.query); }
  for (const must of ['bbc-me', 'guardian-me', 'un-news-me', 'maersk-advisories', 'aljazeera-en', 'mee', 'jpost-me', 'anadolu', 'france24-me', 'nyt-me', 'amwaj', 'irna-en', 'gcaptain', 'ofsi', 'ofac', 'fcdo', 'gn-hormuz', 'presstv', 'aljazeera-ar', 'irna-fa']) assert.ok(ids.includes(must), `missing source ${must}`);
  assert.ok(NEWS_SOURCES.filter((x) => x.tier === 'Tier-3').every((x) => /state|narrative/i.test(x.affiliation)), 'Tier-3 sources must say why');
});

test('registry traits: sources carry the facts consumers used to re-derive from id lists', () => {
  // One list enumerates every source, and every family is in it exactly once.
  const ids = ALL_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id across source families');
  for (const family of [NEWS_SOURCES, SENSOR_SOURCES, WALLET_SOURCES]) {
    for (const s of family) assert.ok(ids.includes(s.id), `${s.id} is missing from ALL_SOURCES`);
  }
  assert.ok(ids.includes('polymarket') && ids.includes('kalshi') && ids.includes('telegram'));

  // The publishers whose silence is normal say so on their own entry. This used to be a set of ids
  // in sourcehealth.ts that was neither the official sources nor the maritime ones.
  const sporadic = ALL_SOURCES.filter((s) => s.sporadic).map((s) => s.id).sort();
  assert.deepEqual(sporadic, ['easa-czib', 'fcdo', 'inbox', 'maersk-advisories', 'ofac', 'ofsi', 'un-news-me', 'un-press']);
  for (const id of sporadic) assert.equal(policyOf(allSourceDefs().find((d) => d.id === id)!).basis, 'publication');

  // Sources whose rhythm differs from the publication default carry it themselves.
  const byId = new Map(allSourceDefs().map((d) => [d.id, d]));
  assert.deepEqual({ basis: policyOf(byId.get('portwatch')!).basis, current: policyOf(byId.get('portwatch')!).current_s }, { basis: 'observation', current: 129600 });
  assert.equal(policyOf(byId.get('polymarket')!).basis, 'history');
  assert.equal(policyOf(byId.get('telegram')!).basis, 'post');
  assert.equal(policyOf(byId.get('bbc-me')!).note, 'newest item publication time');
  assert.equal(policyOf(byId.get('gcaptain')!).note, 'trade press / advisories');
  assert.equal(policyOf(byId.get('un-news-me')!).current_s, 604800);

  // A source that reports observations must say where to read them.
  for (const d of allSourceDefs()) {
    if (d.freshness?.basis === 'observation' || d.freshness?.basis === 'history' || d.freshness?.basis === 'post') {
      assert.ok(d.newest, `${d.id} reports ${d.freshness.basis} but carries no newest query`);
    }
  }
  // Placeholder-free queries must not be handed an argument.
  for (const d of allSourceDefs()) {
    if (d.newest && !d.newest.sql.includes('?')) assert.deepEqual(d.newest.args, [], `${d.id} takes no placeholder`);
  }
});

test('registry traits: bounds resolve for every source, and none is silently unbounded', () => {
  const defs = allSourceDefs();
  assert.equal(defs.length, ALL_SOURCES.length);
  for (const d of defs) {
    const b = boundsOf(d);
    assert.ok(b.interval[0] <= d.intervalMin && d.intervalMin <= b.interval[1], `${d.id}: default cadence ${d.intervalMin} is outside its own bounds`);
    assert.ok(b.budget[0] <= b.budgetDefault && b.budgetDefault <= b.budget[1], `${d.id}: default budget outside its bounds`);
    assert.ok(b.budgetUnit.length > 0);
  }
  // A disabled source keeps its reason, which is what the UI shows as "not connected".
  const relief = defs.find((d) => d.id === 'reliefweb-me')!;
  assert.match(relief.disabled ?? '', /406/);
});

test('registry traits: the official-activity count follows the registry, not a copied list', async () => {
  const { NEWS_SOURCES: news } = await import('./registry.ts');
  const officialConnected = news.filter((s) => s.kind === 'official' && s.enabled !== false).map((s) => s.id).sort();
  // The old literal set included reliefweb-me, which is disabled and can never contribute an item.
  assert.ok(!officialConnected.includes('reliefweb-me'));
  assert.deepEqual(officialConnected, ['easa-czib', 'fcdo', 'ofac', 'ofsi', 'un-news-me', 'un-press']);
});

test('datelines name the desk, not the event: stripped before place extraction', () => {
  assert.equal(stripDateline('Tehran, IRNA – Iranian President Masoud Pezeshkian has met with Putin'), 'Iranian President Masoud Pezeshkian has met with Putin');
  assert.equal(stripDateline('تهران-ایرنا-با شروع فصل مهاجرت پرندگان'), 'با شروع فصل مهاجرت پرندگان');
  assert.equal(stripDateline('A story with no dateline in Tehran.'), 'A story with no dateline in Tehran.');
  const a = tidySummary('Pezeshkian meets Putin in Turkmenistan', 'Tehran, IRNA – Iranian President Masoud Pezeshkian has met with Russian President Vladimir Putin in Turkmenistan.');
  assert.ok(!/^Tehran/.test(a));
  assert.notEqual(geolocate('Pezeshkian meets Putin in Turkmenistan', a)?.name, 'Tehran', 'never the dateline city');
});

test('easa czib: list rows, dates, status and detail description parse from real captured pages', () => {
  const rows = parseCzibList(readFileSync(new URL('./fixtures/easa_czibs.html', import.meta.url), 'utf8'));
  assert.ok(rows.length >= 4);
  const saudi = rows.find((r) => /Saudi/.test(r.subject))!;
  assert.equal(saudi.number, 'CZIB-2026-09'); assert.equal(saudi.status, 'Active');
  assert.equal(saudi.issue, '2026-09-30T00:00:00.000Z'); assert.equal(saudi.revision, null); assert.equal(saudi.validUntil, '2026-11-16T00:00:00.000Z');
  assert.equal(rows.find((r) => /Pakistan|Ukraine|Yemen/.test(r.subject) && /Ukraine/.test(r.subject))?.status, 'Active');
  const desc = parseCzibDetail(readFileSync(new URL('./fixtures/easa_czib_detail.html', import.meta.url), 'utf8'));
  assert.ok(desc && /Houthis|security situation/i.test(desc));
  const items = czibItems(rows, new Map([['CZIB-2026-09', desc!]]), Date.parse('2026-10-09T00:00:00Z'));
  assert.ok(items.some((i) => /Saudi Arabia/.test(i.title) && i.timePrecision === 'date' && /EASA description/.test(i.summary)));
  assert.ok(!items.some((i) => /Ukraine/.test(i.title)), 'non-Middle-East bulletins are out of scope');
  assert.ok(items.every((i) => i.forceRelevant && new Set(items.map((x) => x.externalId)).size === items.length));
});

test('asset linking: explicit alias or same place only; never for country-level or unrelated text', () => {
  const hormuz = linkAssets('IRGC chief says no power may threaten the Strait of Hormuz', null);
  assert.deepEqual(hormuz.map((l) => [l.asset_id, l.relation]), [['hormuz', 'explicitly_named']]);
  const ras = linkAssets('Qatar LNG hub struck, Ras Laffan fires reported', null);
  assert.equal(ras[0].asset_id, 'ras-laffan'); assert.ok(ras[0].relations.some((r) => r.company === 'QatarEnergy'), 'documented relationship carried with its source');
  assert.ok(ras[0].relations.every((r) => r.source_url.startsWith('http') && r.verified_by.includes('not human-reviewed')));
  const loc = linkAssets('Explosion reported near the port', { name: 'Fujairah', lat: 25.12, lng: 56.34, precision: 'city' });
  assert.deepEqual(loc.map((l) => [l.asset_id, l.relation]), [['fujairah', 'same_reported_location']]);
  assert.deepEqual(linkAssets('Trade talks continue in Iran', { name: 'Iran', lat: 32.4, lng: 53.7, precision: 'country' }), [], 'a country centroid is never an asset location');
  assert.deepEqual(linkAssets('Disaster in Suezmax tanker market', null).filter((l) => l.asset_id === 'suez-sumed'), [], 'alias must be a whole word');
  assert.deepEqual(linkAssets('Nothing to see here', null), []);
});

test('event time: explicit past cues only; future constructions and anniversaries are ignored', () => {
  const pub = '2026-10-09T03:00:00.000Z'; // a Friday
  const day = (t: string) => extractEventTime(t, pub)?.start.slice(0, 10) ?? null;
  assert.equal(day('Iran struck a tanker yesterday, officials said'), '2026-10-08');
  assert.equal(day('The drone hit Erbil on Thursday'), '2026-10-08');
  assert.equal(day('Talks collapsed on Monday'), '2026-10-05');
  assert.equal(day('Strikes were reported last Friday'), '2026-10-02');
  assert.equal(day('The incident occurred on 6 October 2026 near Aden'), '2026-10-06');
  assert.equal(day('A missile struck the port on October 7, 2026'), '2026-10-07');
  assert.equal(day('Tanker attacked on October 7 near Qatar'), '2026-10-07');
  assert.equal(day('Delegations will meet on Thursday'), null, 'future');
  assert.equal(day('The ceasefire expires by Friday'), null, 'future');
  assert.equal(day("Over 200 organisations set to join 'Global Day of Action' for Palestine on Saturday"), null, 'future cue far from the weekday');
  assert.equal(day('Tanker was hit on Thursday. Talks will resume next week'), '2026-10-08', 'a later sentence’s future cue must not cancel an earlier past event');
  assert.equal(day('Israelis mourn victims of the 7 October attacks'), null, 'no cue');
  assert.equal(day('Commemorating events on 7 October attacks three years on'), null, 'anniversary reference');
  assert.equal(day('The minister said Thursday that talks continue'), null, 'bare weekday is a reporting convention, not an event date');
  assert.equal(day('Nothing dated here'), null);
  assert.equal(extractEventTime('x on Friday', 'not-a-date'), null);
  assert.equal(extractEventTime('Attack on 9 October 2026 later', pub)?.start.slice(0, 10), '2026-10-09');
  assert.equal(extractEventTime('Attack on 12 October 2026', pub), null, 'a date after publication is not a past event');
});
test('energy & shipping focus flag', () => {
  assert.equal(isEnergyShippingFocus(['shipping'], [], false), true);
  assert.equal(isEnergyShippingFocus([], ['Strait of Hormuz'], false), true);
  assert.equal(isEnergyShippingFocus([], [], true), true);
  assert.equal(isEnergyShippingFocus(['politics', 'diplomacy'], ['Israel'], false), false);
});

test('inbox: multipart eml decodes (QP, encoded-word), prefers text/plain, drops quotes/signature, applies sender profile', () => {
  const e = parseEml(readFileSync(new URL('./fixtures/inbox_sample.eml', import.meta.url), 'utf8'));
  assert.equal(e.subject, 'WARNING 042/26 - Tanker reports explosion near Fujairah anchorage');
  assert.match(e.from, /Sample Maritime Advisory/);
  assert.equal(e.date, '2026-10-08T14:32:00.000Z');
  assert.match(e.body, /explosion near the vessel at the Fujairah anchorage approximately 12 NM east/);
  assert.match(e.body, /— synthetic test text/);
  assert.ok(!/HTML copy|quoted earlier|Signature block/.test(e.body));
  const it = emailItem(e, '/x/a.eml', [{ match: 'example-advisory.test', name: 'Sample list', tier: 'Tier-2', affiliation: 'synthetic' }])!;
  assert.equal(it.tier, 'Tier-2'); assert.equal(it.publisher, 'Sample list'); assert.equal(it.externalId, 'synthetic-042-26@example-advisory.test');
  const unknown = emailItem(e, '/x/a.eml', [])!;
  assert.match(unknown.originating ?? '', /unrated/); assert.equal(unknown.tier, 'Tier-2');
  assert.equal(emailItem({ ...e, date: null }, '/x', []), null, 'no timestamp → not a record');
});
test('adapter registry: every registry entry names an implemented adapter', () => {
  for (const s of NEWS_SOURCES) assert.ok(typeof ADAPTERS[s.adapter ?? 'rss'] === 'function', `${s.id} → ${s.adapter} has no implementation`);
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['easa', 'fcdo', 'gnews', 'inbox', 'maersk', 'nga', 'ofac', 'rss']); // nga: real-fixture test in nga.test.ts
});

test('cross-venue counterparts: candidates carry warnings; verification is explicit; different-deadline look-alikes are excluded', () => {
  const mk = (id: string, venue: string, q: string, end: string, price: number) => ({ id, venue, question: q, event_title: q, end_date: end, price, quote_basis: 'midpoint', resolution_text: `rules for ${q}`, url: 'https://x' });
  const poly = mk('p1', 'polymarket', 'U.S. Embassy in Damascus reopened by December 31, 2026?', '2026-12-31T00:00:00Z', 0.25);
  const kal = mk('k1', 'kalshi', 'Will the US reopen its embassy in Syria before Jan 1, 2027?', '2027-01-01T00:00:00Z', 0.17);
  const far = mk('k2', 'kalshi', 'Will the US reopen its embassy in Syria before Jan 1, 2029?', '2029-01-01T00:00:00Z', 0.5);
  const unrelated = mk('k3', 'kalshi', 'Will it rain in London tomorrow?', '2026-12-31T00:00:00Z', 0.5);
  const same = mk('p2', 'polymarket', 'Syria embassy reopen', '2026-12-31T00:00:00Z', 0.2);
  const filler = Array.from({ length: 40 }, (_, i) => mk(`f${i}`, i % 2 ? 'kalshi' : 'polymarket', `Filler contract ${i} about topic ${i * 7} and subject ${i * 13}`, '2026-12-31T00:00:00Z', 0.5)); // realistic corpus size so IDF is meaningful
  const c = findCounterparts(poly, [poly, kal, far, unrelated, same, ...filler]);
  assert.deepEqual(c.map((x) => x.condition_id), ['k1']);
  assert.equal(c[0].verified, false);
  assert.ok(c[0].warnings.some((w) => /not equivalence/.test(w)) && c[0].warnings.some((w) => /arbitrage/.test(w)));
  assert.ok(c[0].score >= SCORE_MIN && c[0].shared_entities.length >= 1);
  // same venue is never a counterpart
  assert.ok(!c.some((x) => x.venue === 'polymarket'));
  // an explicit human verification flips the flag and carries who verified it
  const v = findCounterparts(poly, [poly, kal, ...filler], [{ polymarket: 'p1', kalshi: 'k1', verified_by: 'Test Reviewer', verified_at: '2026-10-09', rules_note: 'Deadline differs by one day (time zone)' }]);
  assert.equal(v[0].verified, true); assert.equal(v[0].verified_by, 'Test Reviewer');
});

// ── the API read models, driven without a server ────────────────────────────────────────────────

test('event view: derived fields are computed here, from an injected story lookup', async () => {
  const { eventView, marketView } = await import('./views.ts');
  const { SOURCE_META } = await import('./registry.ts');
  const sourceMeta = SOURCE_META;

  const row = {
    id: 'evt-1', source_id: 'bbc-me', external_id: 'x1', published_at: '2026-03-04T10:00:00.000Z', first_seen_at: '2026-03-04T10:05:00.000Z',
    title: 'Tanker traffic slows near the Strait of Hormuz', summary: 'Transit calls fell, shipping data shows.',
    raw_url: 'https://example.test/a', language: 'en', originating_source: null,
    location_name: 'Strait of Hormuz', lat: 26.6, lng: 56.25, loc_precision: 'point',
    entities: JSON.stringify(['Iran']), topics: JSON.stringify(['shipping']), relevant: 1,
    tier: null, time_precision: 'instant', publisher: null, publisher_time_raw: null,
    modified_at: null, revision_count: 0,
  };

  const seen: string[] = [];
  const view = eventView(row, [{ condition_id: 'c1' } as never], {
    sourceMeta,
    // Both store-reading lookups are injected: this test never touches the database or data/assets.json.
    linkAssets: (text) => { seen.push(text); return []; },
    storyFor: (id) => { seen.push(id); return { story_id: 's1', size: 1, items: [] } as never; },
  });

  // Registry metadata reached the view through the injected map.
  assert.equal(view.source_name, 'BBC News — Middle East');
  assert.equal(view.reliability_tier, 'Tier-1');
  assert.match(view.source_affiliation, /licence-fee/);
  assert.equal(view.feed_key, 'web:bbc-me:x1');
  assert.equal(view.claim_status, 'reported');
  assert.deepEqual(view.entities, ['Iran']);

  // Derived fields came from the injected lookups, once each, with the text the rule expects.
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^Tanker traffic slows near the Strait of Hormuz\. /);
  assert.equal(seen[1], 'evt-1');
  assert.equal(view.story?.story_id, 's1');

  // The asset relation decision is visible in the view rather than hidden behind a file read.
  const withAsset = eventView(row, [], { sourceMeta, linkAssets: () => [{ asset_id: 'hormuz' } as never], storyFor: () => null });
  assert.equal(withAsset.focus_energy_shipping, true, 'a curated asset relation makes the item energy/shipping focused');

  // A maritime source is in focus even with no asset relation.
  const maritime = eventView({ ...row, source_id: 'gcaptain' }, [], { sourceMeta, linkAssets: () => [], storyFor: () => null });
  assert.equal(maritime.focus_energy_shipping, true);

  // An item with a stated past day has no instant event time.
  assert.equal(eventView({ ...row, time_precision: 'date' }, [], { sourceMeta, linkAssets: () => [], storyFor: () => null }).event_time, null);

  // A publisher-time note appears only when the feed stated a later time.
  const noted = eventView({ ...row, publisher_time_raw: '4 Mar 2026 14:00' }, [], { sourceMeta, linkAssets: () => [], storyFor: () => null });
  assert.match(noted.publisher_time_note ?? '', /no offset is guessed/);
});

test('market view: spread, quote basis and the wide-spread flag come from the row', async () => {
  const { marketView } = await import('./views.ts');

  const quoted = marketView({ condition_id: 'c1', is_open: 1, best_bid: 0.4, best_ask: 0.6, tags: '["iran"]' });
  // The stored spread is the raw difference, unrounded (0.6 - 0.4 is 0.19999999999999996 in IEEE754).
  // Pinned as-is: this refactor must not change a number the API already served.
  assert.ok(Math.abs((quoted.spread ?? 0) - 0.2) < 1e-9);
  assert.equal(quoted.wide_spread, true);
  assert.deepEqual(quoted.tags, ['iran']);
  assert.equal(quoted.is_open, true);

  // No two-sided quote: the stored spread is passed through, and nothing is invented.
  const lastTrade = marketView({ condition_id: 'c2', is_open: 1, best_bid: null, best_ask: null, spread: null });
  assert.equal(lastTrade.spread, null);
  assert.equal(lastTrade.wide_spread, false);

  // No url stored: the resolution link falls back to the venue's event page.
  assert.equal(marketView({ condition_id: 'c3', event_slug: 'slug' }).resolution_url, 'https://polymarket.com/event/slug');
});

test('status is a read: only an explicit POST can start a collection cycle', async () => {
  // A structural guard. This cannot be exercised without booting the whole server, and the failure
  // it prevents is silent: re-mounting the refresh on a GET would make any status poll — a
  // monitoring probe included — begin fetching from the network.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  assert.ok(!/app\.use\('\/api\/status'/.test(src), 'the status read path must not carry a side effect');
  assert.match(src, /app\.post\('\/api\/keep-fresh'/, 'the explicit keep-fresh endpoint is the only trigger');

  // The status route itself returns stored state and nothing else.
  const statusRoute = src.slice(src.indexOf("app.get('/api/status'"), src.indexOf("app.get('/api/status'") + 200);
  assert.ok(!/maybeRefresh/.test(statusRoute), 'the status handler must not trigger a refresh');

  // And the client asks for freshness explicitly rather than relying on a GET.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /await api\.keepFresh\(\)/, 'the poll should POST its intent to stay fresh');
  const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
  assert.match(api, /keepFresh: \(\) => send<Status>\('POST', '\/api\/keep-fresh'\)/);
});
