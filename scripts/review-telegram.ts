// Print Telegram↔news cross-check results for human review (precision/recall spot-check).
import { db } from '../server/db.ts';
import { matchTelegramToEvents } from '../server/telegram.ts';
console.log(matchTelegramToEvents());
const show = (title: string, rows: any[]) => { console.log(`\n=== ${title}`); for (const r of rows) console.log(`${r.s ?? ''} ${r.dm ?? ''}\n   TG:   ${String(r.t).replace(/\s+/g, ' ').slice(0, 130)}\n   NEWS: ${r.et ?? '(none)'}`); };
show('matched (random 12)', db.prepare("select round(m.similarity,2) s, round(m.delta_min) dm, p.text t, e.title et from tg_matches m join tg_posts p on p.channel=m.channel and p.post_id=m.post_id join events e on e.id=m.event_id order by random() limit 12").all());
show('unmatched claim posts (random 10)', db.prepare("select p.text t from tg_posts p where length(p.text)>=60 and p.report_kind in ('breaking_claim','report') and p.posted_at > datetime('now','-4 days') and not exists (select 1 from tg_matches m where m.channel=p.channel and m.post_id=p.post_id) order by random() limit 10").all());
