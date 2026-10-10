import { useEffect, useMemo, useState } from 'react';
import type { HistoryPoint, Market, TrackerEvent } from '../../shared/types';
import { api } from '../api';
import { ago, pct } from '../format';
import { toast } from '../toast';
import { ProbChart, type Range } from './ProbChart';
import { TIER_LABEL } from './EventList';

const RANGES: Range[] = ['24h', '7d', '30d'];

/** The plain Monitor detail: the item, the contract it touches, one price chart, one save button. Everything else lives in the detailed view. */
export function SimpleDetail({ event, markets, contractId, setContractId, onOpenDossier, now }: {
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

  if (!event) return <section className="simple"><p className="muted">Pick an item on the left.</p></section>;
  const points = hist && hist.id === contractId ? hist.points : [];

  return (
    <section className="simple" aria-label="Selected item">
      <h2 dir={event.title_en ? 'ltr' : 'auto'} lang={event.title_en ? 'en' : event.language}>{event.title_en ?? event.title}</h2>
      {event.title_en && <p className="small muted orig" dir="rtl" lang={event.language}>{event.title} <span className="mt" title="Machine-translated headline (MyMemory)">EN = machine translation</span></p>}
      <p className="small muted">
        {event.source_name.split(' — ')[0]} · <span title="Publisher-level prior, not a verdict on this claim">{TIER_LABEL[event.reliability_tier] ?? event.reliability_tier}</span> · {ago(event.timestamp, now)} · <a href={event.raw_url} target="_blank" rel="noreferrer">original ↗</a>
      </p>

      {linked.length === 0 ? <p className="muted small">No related contract.</p> : (
        <div className="pickrow" role="group" aria-label="Related contracts">
          {linked.slice(0, 3).map((c) => (
            <button key={c.condition_id} className={c.condition_id === contractId ? 'on' : ''} onClick={() => setContractId(c.condition_id)} title={c.question}>
              <span>{c.question.length > 48 ? `${c.question.slice(0, 47)}…` : c.question}</span> <b>{pct(c.price)}</b>
            </button>
          ))}
        </div>
      )}

      {showChart && market && (
        <div className="simplechart">
          <div className="simplehead">
            <span className="small">{market.question}</span>
            <span className="simpleprice"><b>{pct(market.price)}</b> <span className="muted small">{market.quote_basis ? market.quote_basis.replace('_', ' ') : ''}</span></span>
          </div>
          <div className="rangebar" role="group" aria-label="Time range">
            {RANGES.map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
          </div>
          <ProbChart contextKey={market.condition_id} publication={Date.parse(event.timestamp)} points={points} markers={[{ ts: Date.parse(event.timestamp), title: event.title, selected: true }]} range={range} label={`${market.outcome_label} probability`} axis="auto" />
          <p className="small muted">Dashed line = when this was published. Shown together, not as cause and effect.</p>
        </div>
      )}

      <div className="simpleactions"><button className="primarybtn" onClick={save} disabled={busy}>Save to dossier</button></div>
    </section>
  );
}
