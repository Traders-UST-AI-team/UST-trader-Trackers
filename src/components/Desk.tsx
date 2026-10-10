import { useEffect, useRef } from 'react';
import type { TrackerEvent } from '../../shared/types';
import type { DeskResult, DeskStory } from '../../shared/desk';
import { absTime, agoP } from '../format';
import { navigateContext } from '../navigation';

const headline = (e: TrackerEvent) => e.title_en ?? e.title;
const outlet = (e: TrackerEvent) => e.publisher ?? e.source_name.split(' — ')[0];
// Reasons worth a trader's glance on the list row. The rest (topic, hard news, tier) live in the detail.
const ROW_REASONS = new Set(['market', 'confirm', 'official', 'developing', 'asset']);

export function storyContains(s: DeskStory, eventId: string | null): boolean {
  return !!eventId && (s.items.some((e) => e.id === eventId) || s.related.some((r) => r.items.some((e) => e.id === eventId)));
}

function Why({ s }: { s: DeskStory }) {
  const parts = s.reasons.filter((r) => r.points > 0 && ROW_REASONS.has(r.key)).slice(0, 2);
  return <>{parts.map((r, i) => <span key={r.key} className={r.label.includes('▲') ? 'mv up' : r.label.includes('▼') ? 'mv down' : ''}>{i > 0 && <i>·</i>}{r.label.replace(/^Linked market /, '').replace(/ 24h$/, ' 24h')}</span>)}
    {s.related.length > 0 && <span><i>·</i>+{s.related.length} related</span>}</>;
}

interface Props {
  desk: DeskResult; hours: number; setHours: (h: number) => void;
  results: TrackerEvent[] | null; query: string; setQuery: (s: string) => void;
  selectedId: string | null; onSelect: (e: TrackerEvent) => void; now: number;
  seen: Record<string, string>; since: number; onOpenFeed: () => void;
}

const WINDOWS = [6, 24, 48];

/** The Monitor's left column: a short ranked reading list. Low-signal items are left out, not folded away. */
export function Desk(p: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = p.selectedId ? listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') : null;
    const box = listRef.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'nearest' });
  }, [p.selectedId]);

  const top = p.desk.stories.filter((s) => s.band === 'top');
  const watch = p.desk.stories.filter((s) => s.band === 'watch');
  const row = (s: DeskStory, rank: number | null) => {
    const sel = storyContains(s, p.selectedId);
    const fresh = p.since > 0 && Date.parse(s.last_at) > p.since && !(p.seen[s.id] && p.seen[s.id] >= s.last_at);
    return (
      <li key={s.id}>
        <button className={`desk-row ${s.band} ${sel ? 'sel' : ''} ${fresh ? 'fresh' : ''}`} aria-pressed={sel} onClick={() => p.onSelect(s.lead)}>
          {rank != null && <span className="rank">{rank}</span>}
          <span className="body">
            <span className="hl" dir={s.lead.title_en ? 'ltr' : 'auto'}>{fresh && <b className="dot" title="Updated since your last visit" />}{headline(s.lead)}</span>
            <span className="why"><Why s={s} /><time title={absTime(s.last_at)}>{agoP(s.last_at, s.lead.time_precision, p.now)}</time></span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="events desk" aria-label="Ranked stories">
      <div className="desk-head">
        <div className="desk-title">
          <h1>Monitor</h1>
          <button className="briefing-link" onClick={() => navigateContext({ tab: 'briefing' }, 'research')}>Briefing ↗</button>
        </div>
        <div className="search-wrap">
          <input id="dashboard-search" type="search" aria-label="Search all items" placeholder="Search all items  /" value={p.query} onChange={(e) => p.setQuery(e.target.value)} />
          {p.query && <button className="clear-btn" onClick={() => p.setQuery('')} aria-label="Clear search" title="Clear">×</button>}
        </div>
        {!p.results && <div className="desk-sum">
          <span>{p.desk.stories.length ? `${p.desk.stories.length} worth reading` : 'Nothing above the bar'} <span className="muted">of {p.desk.considered}</span></span>
          <span className="seg" role="group" aria-label="Time window">{WINDOWS.map((h) => <button key={h} className={p.hours === h ? 'on' : ''} aria-pressed={p.hours === h} onClick={() => p.setHours(h)}>{h}h</button>)}</span>
        </div>}
      </div>

      <ol className="desk-list" ref={listRef}>
        {p.results ? <>
          <li className="desk-label">{p.results.length} match{p.results.length === 1 ? '' : 'es'} in all items</li>
          {p.results.map((e) => (
            <li key={e.id}>
              <button className={`desk-row watch ${p.selectedId === e.id ? 'sel' : ''}`} aria-pressed={p.selectedId === e.id} onClick={() => p.onSelect(e)}>
                <span className="body"><span className="hl" dir={e.title_en ? 'ltr' : 'auto'}>{headline(e)}</span>
                  <span className="why"><span>{outlet(e)}</span><time title={absTime(e.timestamp)}>{agoP(e.timestamp, e.time_precision, p.now)}</time></span></span>
              </button>
            </li>
          ))}
        </> : <>
          {top.length > 0 && <li className="desk-label">Must read</li>}
          {top.map((s, i) => row(s, i + 1))}
          {watch.length > 0 && <li className="desk-label">Also moving</li>}
          {watch.map((s) => row(s, null))}
          {p.desk.stories.length === 0 && <li className="empty">No story in the last {p.hours} h clears the bar. The full stream is in Feed.</li>}
          {p.desk.dropped > 0 && <li className="desk-foot"><button onClick={p.onOpenFeed}>{p.desk.dropped} lower-signal items left out · Feed ↗</button></li>}
        </>}
      </ol>
    </section>
  );
}
