import { useEffect, useMemo, useState } from 'react';
import type { HistoryPoint, Market, TrackerEvent } from '../../shared/types';
import type { DeskContract, DeskStory } from '../../shared/desk';
import { api } from '../api';
import { absTime, ago, pct } from '../format';
import { toast } from '../toast';
import { ProbChart, type Range } from './ProbChart';
import { TIER_LABEL } from './EventList';

const RANGES: Range[] = ['24h', '7d', '30d'];
const outlet = (e: TrackerEvent) => e.publisher ?? e.source_name.split(' — ')[0];
const COVERAGE_SHOWN = 4;

function Delta({ d }: { d: number | null }) {
  if (d == null) return <span className="dlt muted" title="The venue reports no 24h change">—</span>;
  return <span className={`dlt ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`} title="24h change as reported by the venue">{d > 0 ? '▲' : d < 0 ? '▼' : '–'} {Math.abs(d * 100).toFixed(1)}</span>;
}

/** The Monitor reading pane: the story, why it is on the desk, the contracts it touches with one chart, and what else is related. */
export function SimpleDetail({ event, story, related, onSelect, markets, contractId, setContractId, onOpenDossier, now, onBack, onAdvanced }: {
  onBack: () => void; onAdvanced: () => void; onSelect: (e: TrackerEvent) => void;
  event: TrackerEvent | null; story: DeskStory | null; related: DeskStory[];
  markets: Market[]; contractId: string | null; setContractId: (id: string) => void; onOpenDossier: (id: string) => void; now: number;
}) {
  const [range, setRange] = useState<Range>('7d');
  const [hist, setHist] = useState<{ id: string; points: HistoryPoint[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [allCoverage, setAllCoverage] = useState(false);
  useEffect(() => setAllCoverage(false), [event?.id]);
  const byId = useMemo(() => new Map(markets.map((m) => [m.condition_id, m])), [markets]);
  const contracts: DeskContract[] = useMemo(() => story?.contracts ?? (event?.linked_contracts ?? []).map((c) => {
    const m = byId.get(c.condition_id);
    return { condition_id: c.condition_id, question: c.question, venue: c.venue, price: m?.price ?? c.price, change_24h: m?.one_day_change ?? null };
  }), [story, event, byId]);
  const market = contractId ? byId.get(contractId) ?? null : null;
  const showChart = !!market && contracts.some((c) => c.condition_id === market.condition_id);

  useEffect(() => {
    if (!showChart || !contractId) return;
    let live = true;
    api.history(contractId).then((h) => { if (live) setHist({ id: contractId, points: h.points }); }).catch(() => { if (live) setHist({ id: contractId, points: [] }); });
    return () => { live = false; };
  }, [contractId, showChart]);

  const points = useMemo(() => (hist && hist.id === contractId ? hist.points : []), [hist, contractId]);
  const markers = useMemo(() => (event ? [{ ts: Date.parse(event.timestamp), title: event.title, selected: true }] : []), [event]);

  const save = async () => {
    if (!event) return;
    setBusy(true);
    try { const d = await api.createDossier({ title: event.title.slice(0, 200), from_ref: event.feed_key }); toast('Saved to a new dossier', 'success'); onOpenDossier(d.dossier.id); }
    catch (e) { toast(`Could not save: ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  if (!event) return <section className="simple simple-empty"><h2>Pick a story on the left.</h2><p className="muted">j / k to step through the ranked list.</p></section>;
  const why = story?.reasons.filter((r) => r.points > 0 && r.key !== 'hard' && r.key !== 'topic') ?? [];
  const caveats = story?.reasons.filter((r) => r.points < 0) ?? [];
  const once = new Set([`${outlet(event)}|${event.title}`]);
  const others = (story?.items ?? []).filter((e) => { const k = `${outlet(e)}|${e.title}`; if (once.has(k)) return false; once.add(k); return true; });
  const coverage = allCoverage ? others : others.slice(0, COVERAGE_SHOWN);

  return (
    <section className="simple" aria-label="Selected story">
      <div className="reader-toolbar"><button className="back-stories" onClick={onBack}>← Stories</button><button className="quiet-button" onClick={onAdvanced}>Advanced view ↗</button></div>
      <h2 dir={event.title_en ? 'ltr' : 'auto'} lang={event.title_en ? 'en' : event.language}>{event.title_en ?? event.title}</h2>
      <p className="reader-meta">
        <strong>{outlet(event)}</strong><span>·</span><time title={absTime(event.timestamp)}>{ago(event.timestamp, now)}</time>
        {story && story.items.length > 1 && story.last_at > event.timestamp && <><span>·</span><span>story updated {ago(story.last_at, now)}</span></>}
        <span className="reader-tier" title="Publisher-level prior, not a verdict on this claim">{TIER_LABEL[event.reliability_tier] ?? event.reliability_tier}</span>
      </p>
      {why.length > 0 && <p className="why-line" title="Fixed ranking rules; a linked market's move is coincident, not caused by this story">
        <span className="eyebrow">WHY IT'S HERE</span>{why.map((r) => <span key={r.key}>{r.label}</span>)}
        {caveats.map((r) => <span key={r.key} className="caveat">{r.label}</span>)}
      </p>}
      {event.summary && event.summary !== event.title && <p className="reader-summary" dir="auto" lang={event.language}>{event.summary}</p>}
      {event.title_en && <details className="original-headline"><summary>Translated headline · view original</summary><p dir="rtl" lang={event.language}>{event.title}</p></details>}
      <div className="simpleactions">
        <a className="source-link" href={event.raw_url} target="_blank" rel="noreferrer">Read original ↗</a>
        <button className="quiet-button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save to research'}</button>
      </div>

      {contracts.length > 0 && <div className="block">
        <div className="block-head"><span className="eyebrow">MARKETS IT TOUCHES</span><span className="small muted">24h, pp</span></div>
        <ul className="contract-rows">
          {contracts.map((c) => (
            <li key={c.condition_id}><button className={c.condition_id === contractId ? 'on' : ''} aria-pressed={c.condition_id === contractId} onClick={() => setContractId(c.condition_id)}>
              <span className="q">{c.question}</span><b>{pct(c.price)}</b><Delta d={c.change_24h} />
            </button></li>
          ))}
        </ul>
        {showChart && market && (
          <div className="simplechart">
            <div className="rangebar" role="group" aria-label="Time range">
              {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
              <span className="small muted chart-basis">{market.outcome_label} · {market.quote_basis ? market.quote_basis.replace('_', ' ') : 'price'}</span>
            </div>
            <ProbChart contextKey={market.condition_id} publication={Date.parse(event.timestamp)} points={points} markers={markers} range={range} label={`${market.outcome_label} probability`} axis="auto" />
            <p className="small muted">Dashed line = when this was published. Shown together, not as cause and effect.</p>
          </div>
        )}
      </div>}

      {others.length > 0 && <div className="block">
        <div className="block-head"><span className="eyebrow">ALSO REPORTED BY</span><span className="small muted">{story!.independent} independent of {Math.max(story!.outlets.length, story!.independent)} outlets · 72 h</span></div>
        <ul className="plain-rows">
          {coverage.map((e) => <li key={e.id}><button onClick={() => onSelect(e)}><span className="o">{outlet(e)}</span><span className="t" dir="auto">{e.title_en ?? e.title}</span><time>{ago(e.timestamp, now)}</time></button></li>)}
        </ul>
        {others.length > COVERAGE_SHOWN && <button className="quiet-button" onClick={() => setAllCoverage((v) => !v)}>{allCoverage ? 'Show fewer' : `Show all ${others.length}`}</button>}
      </div>}

      {related.length > 0 && <div className="block">
        <div className="block-head"><span className="eyebrow">RELATED DEVELOPMENTS</span></div>
        <ul className="plain-rows">
          {related.map((s) => <li key={s.id}><button onClick={() => onSelect(s.lead)}><span className="t" dir="auto">{s.lead.title_en ?? s.lead.title}</span><time>{ago(s.last_at, now)}</time></button></li>)}
        </ul>
      </div>}
    </section>
  );
}
