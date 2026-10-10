// Recompute derived fields (entities, topics, place, relevance) for stored events after a dictionary/rule change. No network.
// Skips FCDO items: their relevance comes from a source-specific rule applied at ingest, not from entity matching.
import { db, tx } from '../server/db.ts';
import { extractEntities, extractTopics, geolocate, isMiddleEastRelevant } from '../server/geo.ts';
import { stripDateline } from '../server/sources/rss.ts';
import { rebuildLinks } from '../server/link.ts';
import { rebuildStories } from '../server/story.ts';
import { matchTelegramToEvents } from '../server/telegram.ts';

const rows = db.prepare("SELECT id, title, summary, relevant, entities, loc_precision, location_name FROM events WHERE source_id != 'fcdo'").all() as any[];
let changed = 0, relFlip = 0;
tx(() => {
  const up = db.prepare('UPDATE events SET summary = ?, entities = ?, topics = ?, relevant = ?, location_name = ?, lat = ?, lng = ?, loc_precision = ? WHERE id = ?');
  for (const r of rows) {
    const summary = stripDateline(r.summary);
    const text = `${r.title}. ${summary}`;
    const ents = extractEntities(text);
    const rel = ents.me.length > 0 || isMiddleEastRelevant(text) ? 1 : 0;
    const loc = geolocate(r.title, summary, []);
    const entities = JSON.stringify(ents.all);
    if (entities !== r.entities || rel !== r.relevant || (loc?.name ?? null) !== r.location_name) changed++;
    if (rel !== r.relevant) relFlip++;
    up.run(summary, entities, JSON.stringify(extractTopics(text)), rel, loc?.name ?? null, loc?.lat ?? null, loc?.lng ?? null, loc?.precision ?? null, r.id);
  }
});
console.log(`reanalyzed ${rows.length} events: ${changed} changed, ${relFlip} relevance flips`);
console.log('links', rebuildLinks(), 'stories', rebuildStories(), 'telegram', matchTelegramToEvents());
