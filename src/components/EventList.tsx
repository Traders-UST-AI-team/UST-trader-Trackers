import { useEffect, useRef } from 'react';
import type { Market, TrackerEvent } from '../../shared/types';
import { absTime, agoP } from '../format';
import { navigateContext } from '../navigation';

export const TIER_LABEL: Record<string, string> = { 'Tier-1': 'T1 · Official/Major', 'Tier-2': 'T2 · Regional/Specialist', 'Tier-3': 'T3 · State-affiliated' };
const TIER_SHORT: Record<string, string> = { 'Tier-1': 'T1', 'Tier-2': 'T2', 'Tier-3': 'T3 · state' };

export function TierBadge({ tier, short = false }: { tier: string; short?: boolean }) {
  return <span className={`tier t${tier.slice(-1)}`} title={`${TIER_LABEL[tier] ?? tier} — publisher-level prior, not a verdict on this claim`}>{short ? TIER_SHORT[tier] ?? tier : TIER_LABEL[tier] ?? tier}</span>;
}

interface Props {
  events: TrackerEvent[]; selectedId: string | null; onSelect: (e: TrackerEvent) => void; now: number;
  query: string; setQuery: (s: string) => void; topic: string; setTopic: (s: string) => void;
  tier: string; setTier: (s: string) => void; scope: 'all' | 'focus'; setScope: (s: 'all' | 'focus') => void; showFiltered: boolean; setShowFiltered: (b: boolean) => void; total: number; markets?: Market[];
}

const TOPICS = ['all', 'security', 'shipping', 'energy', 'sanctions', 'diplomacy', 'nuclear', 'humanitarian', 'politics'];

export function EventList(p: Props) {
  const byId = new Map((p.markets ?? []).map((m) => [m.condition_id, m]));
  const cardsRef = useRef<HTMLOListElement>(null);
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (p.selectedId && cardsRef.current) {
      const el = document.getElementById(`event-card-${p.selectedId}`);
      if (el) {
        const container = cardsRef.current;
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
        if (!isVisible) {
          el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    }
  }, [p.selectedId]);

  const filtersOn = (p.topic !== 'all' ? 1 : 0) + (p.tier !== 'all' ? 1 : 0) + (p.scope !== 'all' ? 1 : 0) + (p.showFiltered ? 1 : 0);
  return (
    <section className="events" aria-label="Event feed">
      <div className="feed-heading"><div><span className="eyebrow">YOUR DESK</span><h1>Monitor</h1></div><button className="briefing-link" onClick={() => navigateContext({ tab: 'briefing' }, 'research')}>Daily briefing ↗</button></div>
      <div className="filters">
        <div className="search-wrap">
          <input id="dashboard-search" type="search" aria-label="Search events" placeholder="Search news…" value={p.query} onChange={(e) => p.setQuery(e.target.value)} />
          {p.query && <button className="clear-btn" onClick={() => p.setQuery('')} aria-label="Clear search" title="Clear">×</button>}
        </div>
        <div className="feed-tools"><span className="small muted">{p.events.length === p.total ? p.total : `${p.events.length} / ${p.total}`} stories</span>
        <details className="filterbox"><summary>Filters{filtersOn ? ` · ${filtersOn} on` : ""}</summary>
        <div className="row">
          <select value={p.topic} onChange={(e) => p.setTopic(e.target.value)} aria-label="Topic">
            {TOPICS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All topics' : t}</option>)}
          </select>
          <select value={p.tier} onChange={(e) => p.setTier(e.target.value)} aria-label="Tier">
            <option value="all">All tiers</option><option value="Tier-1">Tier 1</option><option value="Tier-2">Tier 2</option><option value="Tier-3">Tier 3</option>
          </select>
          <select value={p.scope} onChange={(e) => p.setScope(e.target.value as 'all' | 'focus')} aria-label="Scope" title="Energy & shipping focus: energy/shipping/sanctions topics, chokepoint or energy-company entities, or a mapped asset">
            <option value="all">All Middle East</option><option value="focus">Energy &amp; shipping focus</option>
          </select>
          <label className="check" title="Show items the Middle East relevance rule excluded, to audit for misses">
            <input type="checkbox" checked={p.showFiltered} onChange={(e) => p.setShowFiltered(e.target.checked)} /> include filtered-out
          </label>
        </div>
        </details>
        </div>
      </div>
      <ol className="cards" ref={cardsRef}>
        {p.events.map((e) => (
          <li key={e.id} id={`event-card-${e.id}`}>
            <button className={`card ${p.selectedId === e.id ? 'sel' : ''} ${e.relevant ? '' : 'dim'}`} aria-pressed={p.selectedId === e.id} onClick={() => p.onSelect(e)}>
              <div className="meta">
                <span className="src">{e.source_name.split(' — ')[0]}</span>
                {e.reliability_tier === 'Tier-3' && <TierBadge tier={e.reliability_tier} short />}
                {e.title_en && <span className="mt" title="Machine-translated headline; original available in the detail">EN</span>}
                <time title={absTime(e.timestamp)}>{agoP(e.timestamp, e.time_precision, p.now)}</time>
              </div>
              <h3 dir={e.title_en ? 'ltr' : e.language === 'ar' || e.language === 'fa' ? 'rtl' : 'auto'} lang={e.title_en ? 'en' : e.language}>{e.title_en ?? e.title}</h3>
              {(e.language !== 'en' && !e.title_en) || !e.relevant ? <div className="chips">
                {e.language !== 'en' && !e.title_en && <span className="chip warn" title="Not translated yet (the free daily translation budget is limited); shown in the original language">{e.language} · untranslated</span>}
                {!e.relevant && <span className="chip warn">filtered out</span>}
              </div> : null}
              {e.linked_contracts[0] && (() => {
                const c = e.linked_contracts[0]; const m = byId.get(c.condition_id); const d = m?.one_day_change;
                return <div className="touch" title={`${c.question}${d == null ? '' : ' — 24h change as reported by the venue'}`}>
                  <span className="tq">{c.question.length > 52 ? `${c.question.slice(0, 51)}…` : c.question}</span>
                  <b>{c.price == null ? '—' : `${(c.price * 100).toFixed(1)}%`}</b>
                  {d != null && <span className={`dlt ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '–'} {Math.abs(d * 100).toFixed(1)} pp</span>}
                  {e.linked_contracts.length > 1 && <span className="more">+{e.linked_contracts.length - 1}</span>}
                </div>;
              })()}
            </button>
          </li>
        ))}
        {p.events.length === 0 && <li className="empty">No events match. Data may still be loading, or filters are too narrow.</li>}
      </ol>
    </section>
  );
}
