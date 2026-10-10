import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { decodeEntities, cachedHeadlines, cachedNewsTranslation, createHeadlineTranslator, createNewsTranslator, translationHash, translationSegments, translateText, untranslatedHeadlineIds } from './translation.ts';

const fixture = () => {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE events(id TEXT PRIMARY KEY, title TEXT, summary TEXT, language TEXT);');
  d.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('ar1', 'أخبار الطاقة', 'النص الأصلي', 'ar');
  return d;
};
const response = (s: string, status = 200) => new Response(JSON.stringify({ responseStatus: status, responseData: { translatedText: s } }));

test('translation chunks preserve Arabic and Unicode, stay within UTF-8 byte bounds, and hash source revisions', () => {
  const text = 'خبر عاجل عن الطاقة 🚢 '.repeat(140);
  const chunks = translationSegments(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((s) => Buffer.byteLength(s) <= 480));
  assert.notEqual(translationHash('title', 'old'), translationHash('title', 'revised'));
});
test('provider quota/errors cannot become successful English text', async () => {
  const fake = (async () => response('YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY', 403)) as typeof fetch;
  await assert.rejects(translateText('أخبار', fake), /unavailable/);
  await assert.rejects(translateText('أخبار', (async () => response('')) as typeof fetch), /unavailable/);
});
test('only public Arabic records translated; duplicate clicks deduplicate, source changes invalidate cache, seed never fetches', async () => {
  const db = fixture(); let calls = 0;
  const fake = (async () => { calls++; return response('English fixture translation'); }) as typeof fetch;
  const translate = createNewsTranslator(db, { seed: false, request: fake });
  const [a, b] = await Promise.all([translate('ar1'), translate('ar1')]);
  assert.equal(calls, 2); assert.deepEqual(a, b);
  await translate('ar1'); assert.equal(calls, 2);
  db.prepare('UPDATE events SET summary = ? WHERE id = ?').run('تحديث', 'ar1');
  const changed = await translate('ar1'); assert.notEqual(changed.source_hash, a.source_hash); assert.equal(calls, 4);
  const offline = createNewsTranslator(db, { seed: true, request: fake });
  await offline('ar1'); assert.equal(calls, 4);
  db.prepare('UPDATE events SET title = ? WHERE id = ?').run('جديد', 'ar1');
  await assert.rejects(offline('ar1'), /offline snapshot/); assert.equal(calls, 4);
  db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run('en1', 'News', 'Text', 'en');
  await assert.rejects(translate('en1'), /Arabic and Persian/); await assert.rejects(translate('telegram:any'), /Unknown/);
  db.close();
});
test('persistent free daily budget stops concurrent requests before network I/O', async () => {
  const db = fixture(); let calls = 0;
  const translate = createNewsTranslator(db, { seed: false, request: (async () => { calls++; return response('English'); }) as typeof fetch });
  db.prepare('INSERT INTO translation_budget VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), 4500);
  await assert.rejects(translate('ar1'), /budget reached/); assert.equal(calls, 0); db.close();
});

test('cached English reads cost no provider quota and source revisions cannot return stale translations', async () => {
  const db = fixture(); let calls = 0;
  const translate = createNewsTranslator(db, { seed: false, request: (async () => { calls++; return response('English'); }) as typeof fetch });
  assert.equal(cachedNewsTranslation(db, 'ar1'), null);
  const result = await translate('ar1');
  const day = new Date().toISOString().slice(0, 10);
  const budget = () => (db.prepare('SELECT characters FROM translation_budget WHERE day = ?').get(day) as { characters: number }).characters;
  const reserved = budget();
  assert.deepEqual(cachedNewsTranslation(db, 'ar1'), result); assert.equal(calls, 2); assert.equal(budget(), reserved);
  db.prepare('UPDATE events SET summary = ? WHERE id = ?').run('جديد', 'ar1');
  assert.equal(cachedNewsTranslation(db, 'ar1'), null); assert.equal(cachedNewsTranslation(db, 'telegram:x'), null); assert.equal(calls, 2);
  db.close();
});

test('headlines: Arabic and Persian titles translate automatically, cost only their own characters, cache by revision, stop at the budget', async () => {
  const db = fixture(); let calls = 0; let lastQuery = '';
  const request = (async (u: URL) => { calls++; lastQuery = String(u); return response(`EN ${calls}`); }) as unknown as typeof fetch;
  db.exec('CREATE TABLE event_market_links(event_id TEXT, condition_id TEXT, score REAL);');
  const iso = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  db.exec('ALTER TABLE events ADD COLUMN published_at TEXT; ALTER TABLE events ADD COLUMN relevant INTEGER DEFAULT 1;');
  db.prepare('INSERT INTO events (id, title, summary, language, published_at) VALUES (?,?,?,?,?)').run('fa1', 'خبر آزمایشی', 'متن', 'fa', iso(5));
  db.prepare('INSERT INTO events (id, title, summary, language, published_at) VALUES (?,?,?,?,?)').run('fa2', 'خبر قدیمی', 'متن', 'fa', iso(1));
  db.prepare('UPDATE events SET published_at = ? WHERE id = ?').run(iso(2), 'ar1');
  db.prepare('INSERT INTO event_market_links VALUES (?,?,?)').run('fa1', 'm', 1);
  assert.deepEqual(untranslatedHeadlineIds(db, 10), ['fa1', 'fa2', 'ar1'], 'linked first, then newest');
  const translate = createHeadlineTranslator(db, { seed: false, request });
  assert.equal(await translate('fa1'), 'EN 1');
  assert.match(lastQuery, /langpair=fa%7Cen/);
  assert.equal(await translate('fa1'), 'EN 1'); assert.equal(calls, 1, 'second read comes from the cache');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((db.prepare('SELECT characters FROM translation_budget WHERE day = ?').get(day) as { characters: number }).characters, [...'خبر آزمایشی'].length, 'only the title is charged');
  assert.deepEqual(untranslatedHeadlineIds(db, 10), ['fa2', 'ar1']);
  const rows = db.prepare('SELECT id, title, summary, language FROM events').all() as { id: string; title: string; summary: string; language: string }[];
  assert.equal(cachedHeadlines(db, rows).get('fa1'), 'EN 1');
  assert.equal(cachedHeadlines(db, rows).has('fa2'), false);
  db.prepare('UPDATE translation_budget SET characters = 4500 WHERE day = ?').run(day);
  await assert.rejects(translate('fa2'), /budget reached/); assert.equal(calls, 1);
  const offline = createHeadlineTranslator(db, { seed: true, request });
  assert.equal(await offline('ar1'), null, 'seed mode never calls the provider'); assert.equal(calls, 1);
  assert.equal(await translate('ar1').catch(() => 'blocked'), 'blocked');
  db.close();
});

test('provider HTML escapes are decoded so headlines read normally', () => {
  assert.equal(decodeEntities('Iran&#39;s &quot;crisis&quot; &amp; oil &lt;8x&gt;'), 'Iran\'s "crisis" & oil <8x>');
});
