// Print current story clusters for human review (tuning/QA). Usage: npx tsx scripts/review-stories.ts
import { db } from '../server/db.ts';
import { rebuildStories } from '../server/story.ts';
console.log(rebuildStories());
const rows = db.prepare('SELECT s.story_id, s.size, e.source_id, e.published_at, e.title FROM stories s JOIN events e ON e.id = s.event_id ORDER BY s.story_id, e.published_at').all() as any[];
let cur = '';
for (const r of rows) { if (r.story_id !== cur) { cur = r.story_id; console.log(`\n[${r.story_id}] ×${r.size}`); } console.log(`  ${r.source_id.padEnd(14)} ${r.published_at.slice(5, 16)}  ${r.title.slice(0, 110)}`); }
