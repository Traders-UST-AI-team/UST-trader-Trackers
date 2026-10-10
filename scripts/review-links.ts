// Print a sample of event→contract links with their evidence for human precision review.
import { db } from '../server/db.ts';
import { rebuildLinks } from '../server/link.ts';
console.log(rebuildLinks());
const rows = db.prepare(`SELECT e.title, m.venue, m.question, l.matched_entities me, l.matched_topics mt FROM event_market_links l
  JOIN events e ON e.id = l.event_id JOIN markets m ON m.condition_id = l.condition_id ORDER BY random() LIMIT ${Number(process.argv[2] ?? 25)}`).all() as any[];
for (const r of rows) console.log(`\n• ${r.title.slice(0, 100)}\n   → [${r.venue}] ${r.question.slice(0, 110)}\n     matched ${r.me} · ${r.mt}`);
