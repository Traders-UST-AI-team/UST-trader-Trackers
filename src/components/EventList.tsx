import { useEffect, useRef } from 'react';
import { NewsTranslation } from './NewsTranslation';
import type { TrackerEvent } from '../../shared/types';
import { absTime, agoP } from '../format';
import { navigateContext } from '../navigation';

export const TIER_LABEL: Record<string, string> = { 'Tier-1': 'T1 · Official/Major', 'Tier-2': 'T2 · Regional/Specialist', 'Tier-3': 'T3 · State-affiliated' };

export function TierBadge({ tier }: { tier: string }) {
  return <span className={`tier t${tier.slice(-1)}`} title="Publisher-level prior, not a verdict on this claim">{TIER_LABEL[tier] ?? tier}</span>;
}

interface Props {
  events: TrackerEvent[]; selectedId: string | null; onSelect: (e: TrackerEvent) => void; now: number;
  query: string; setQuery: (s: string) => void; topic: string; setTopic: (s: string) => void;
  tier: string; setTier: (s: string) => void; scope: 'all' | 'focus'; setScope: (s: 'all' | 'focus') => void; showFiltered: boolean; setShowFiltered: (b: boolean) => void; total: number;
}

const TOPICS = ['all', 'security', 'shipping', 'energy', 'sanctions', 'diplomacy', 'nuclear', 'humanitarian', 'politics'];

export function EventList(p: Props) {
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
      <div className="filters">
        <div className="search-wrap">
          <input id="dashboard-search" type="search" placeholder="Search events, places, entities… (/)" value={p.query} onChange={(e) => p.setQuery(e.target.value)} />
          {p.query && <button className="clear-btn" onClick={() => p.setQuery('')} aria-label="Clear search" title="Clear">×</button>}
        </div>
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
        <div className="muted small">{p.events.length} shown of {p.total} stored · newest first · <button className="linkbtn" onClick={() => navigateContext({ tab: 'briefing' }, 'research')} title="What changed in the last 24 h, cited (b)">Change briefing →</button></div>
      </div>
      <ol className="cards" ref={cardsRef}>
        {p.events.map((e) => (
          <li key={e.id} id={`event-card-${e.id}`}>
            <button className={`card ${p.selectedId === e.id ? 'sel' : ''} ${e.relevant ? '' : 'dim'}`} onClick={() => p.onSelect(e)}>
              <div className="meta">
                <span className="src">{e.source_name.split(' — ')[0]}</span>
                <TierBadge tier={e.reliability_tier} />
                <time title={absTime(e.timestamp)}>{agoP(e.timestamp, e.time_precision, p.now)}</time>
              </div>
              <h3 dir={e.language === 'ar' || e.language === 'fa' ? 'rtl' : 'auto'}>{e.title}</h3>
              <div className="chips">
                {e.location && <span className="chip loc" title={`Place named in the text (${e.location.precision}); not a verified incident coordinate`}>{e.location.name}{e.location.precision === 'country' ? ' · approx.' : ''}</span>}
                {e.topics.slice(0, 3).map((t) => <span className="chip" key={t}>{t}</span>)}
                {e.language !== 'en' && <span className="chip warn" title="Shown in the original language; entity/topic matching uses a small hand-written dictionary">{e.language} · original</span>}
                {e.story && <span className="chip story" title={e.story.note}>{e.story.size} outlets · related coverage</span>}
                {e.focus_energy_shipping && <span className="chip" title="Energy, shipping, sanctions, chokepoint or mapped asset">energy/shipping</span>}
                {e.assets.length > 0 && <span className="chip" title="Curated reference assets this item names or is located at">{e.assets.length} asset{e.assets.length > 1 ? 's' : ''}</span>}
                {e.linked_contracts.length > 0 && <span className="chip link" title="Contracts that name the same entity and topic">{e.linked_contracts.length} contract{e.linked_contracts.length > 1 ? 's' : ''}</span>}
                {!e.relevant && <span className="chip warn">filtered out</span>}
              </div>
            </button>
            {e.language === 'ar' && <NewsTranslation key={`${e.id}:${e.title}:${e.summary}`} eventId={e.id} automatic={p.selectedId === e.id} compact />}
          </li>
        ))}
        {p.events.length === 0 && <li className="empty">No events match. Data may still be loading, or filters are too narrow.</li>}
      </ol>
    </section>
  );
}
