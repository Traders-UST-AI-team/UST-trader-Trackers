import { useEffect, useMemo, useState } from 'react';
import type { HistoryPoint, Market, TrackerEvent } from '../../shared/types';
import { api } from '../api';
import { ago, pct } from '../format';
import { toast } from '../toast';
import { ProbChart, type Range } from './ProbChart';
import { TIER_LABEL } from './EventList';

const RANGES: Range[] = ['24h', '7d', '30d'];

/** The plain Monitor detail: the item, the contract it touches, one price chart, one save button. Everything else lives in the detailed view. */
export function SimpleDetail({ event, markets, contractId, setContractId, onOpenDossier, now, onBack, onAdvanced }: {
  onBack: () => void; onAdvanced: () => void;
  event: TrackerEvent | null; markets: Market[]; contractId: string | null; setContractId: (id: string) => void; onOpenDossier: (id: string) => void; now: number;
}) {
  const [range, setRange] = useState<Range>('7d');
  const [hist, setHist] = useState<{ id: string; points: HistoryPoint[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const linked = event?.linked_contracts ?? [];
  const market = useMemo(() => markets.find((m) => m.condition_id === contractId) ?? null, [markets, contractId]);
  const showChart = !!market && linked.some((c) => c.condition_id === market.condition_id);

  useEffect(() => {
    if (!showChart || !contractId) return;
    let live = true;
    api.history(contractId).then((h) => { if (live) setHist({ id: contractId, points: h.points }); }).catch(() => { if (live) setHist({ id: contractId, points: [] }); });
    return () => { live = false; };
  }, [contractId, showChart]);

  const save = async () => {
    if (!event) return;
    setBusy(true);
    try { const d = await api.createDossier({ title: event.title.slice(0, 200), from_ref: event.feed_key }); toast('Saved to a new dossier', 'success'); onOpenDossier(d.dossier.id); }
    catch (e) { toast(`Could not save: ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  if (!event) return <section className="simple simple-empty"><span className="eyebrow">EVENT DETAILS</span><h2>Your next insight starts here.</h2><p className="muted">Select a story to read the source and explore related markets.</p></section>;
  const points = hist && hist.id === contractId ? hist.points : [];

  return (
    <section className="simple" aria-label="Selected item">
      <div className="reader-toolbar"><button className="back-stories" onClick={onBack}>← Stories</button><span className="eyebrow">EVENT DETAILS</span><button className="quiet-button" onClick={onAdvanced}>Advanced view ↗</button></div>
      <h2 dir={event.title_en ? 'ltr' : 'auto'} lang={event.title_en ? 'en' : event.language}>{event.title_en ?? event.title}</h2>
      <p className="reader-meta">
        <strong>{event.source_name.split(' — ')[0]}</strong><span>·</span><span>{ago(event.timestamp, now)}</span>
        <span className="reader-tier" title="Publisher-level prior, not a verdict on this claim">{TIER_LABEL[event.reliability_tier] ?? event.reliability_tier}</span>
      </p>
      {event.summary && event.summary !== event.title && <p className="reader-summary" dir="auto" lang={event.language}>{event.summary}</p>}
      {event.title_en && <details className="original-headline"><summary>Translated headline · view original</summary><p dir="rtl" lang={event.language}>{event.title}</p></details>}
      <div className="simpleactions">
        <a className="source-link" href={event.raw_url} target="_blank" rel="noreferrer">Read original ↗</a>
        <button className="quiet-button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save to research'}</button>
      </div>
      <div className="related-heading"><span className="eyebrow">RELATED MARKETS</span><span className="small muted">{linked.length ? `${linked.length} linked` : 'No linked markets'}</span></div>
      {linked.length > 0 && (!showChart || linked.length > 1) && <details className="market-options" key={event.id} open={!showChart || undefined}><summary>{showChart ? 'Change contract' : 'Choose a contract'}</summary><label className="market-picker">
        <span className="small muted">Contract</span>
        <select aria-label="Related contract" value={showChart ? contractId ?? '' : ''} onChange={(e) => setContractId(e.target.value)}>
          <option value="" disabled>Select a related contract</option>
          {linked.map((c) => <option key={c.condition_id} value={c.condition_id}>{c.question} · {pct(c.price)}</option>)}
        </select>
      </label></details>}

      {showChart && market && (
        <div className="simplechart">
          <div className="simplehead">
            <h3>{market.question}</h3>
            <span className="simpleprice"><b>{pct(market.price)}</b> <span className="muted small">{market.quote_basis ? market.quote_basis.replace('_', ' ') : ''}</span></span>
          </div>
          <div className="rangebar" role="group" aria-label="Time range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
          </div>
          <ProbChart contextKey={market.condition_id} publication={Date.parse(event.timestamp)} points={points} markers={[{ ts: Date.parse(event.timestamp), title: event.title, selected: true }]} range={range} label={`${market.outcome_label} probability`} axis="auto" />
          <p className="small muted">Dashed line = when this was published. Shown together, not as cause and effect.</p>
        </div>
      )}


    </section>
  );
}
