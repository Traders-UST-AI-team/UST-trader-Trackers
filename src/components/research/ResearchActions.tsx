import { ActionButton } from '../ActionButton';
import { useEffect, useState } from 'react';
import type { DossierSummary } from '../../../shared/research';
import { api } from '../../api';
import { ErrorChip, attempt } from './common';

/** Dashboard entry point: open a dossier from the selected item or attach it to an existing one (the market context is kept). */
export function ResearchActions({ active, feedKey, title, onOpenDossier }: { active: boolean; feedKey: string; title: string; onOpenDossier: (id: string) => void }) {
  const [list, setList] = useState<DossierSummary[] | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setTarget(''); setErr(null); }, [feedKey]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    api.dossiers().then((d) => { if (live) setList(d); }).catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [feedKey, active]);
  return (
    <div className="researchactions small">
      <b>Research</b>
      <ActionButton disabled={busy} onClick={() => { setBusy(true); return attempt(() => api.createDossier({ title: title.slice(0, 200), from_ref: feedKey }), setErr).then((r) => r && onOpenDossier(r.dossier.id)).finally(() => setBusy(false)); }} title="Your working title starts as the headline; edit it freely — the publisher's headline is never changed">New dossier from this item</ActionButton>
      <select value={target} onFocus={() => { api.dossiers().then(setList).catch((e) => setErr(e.message)); }} onChange={(e) => setTarget(e.target.value)} aria-label="Attach to dossier">
        <option value="">attach to dossier…</option>{(list ?? []).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
      </select>
      {target && <ActionButton onClick={() => attempt(() => api.attach(target, { source_ref: feedKey, relationship: 'report' }), setErr).then((r) => r && onOpenDossier(target))}>Attach</ActionButton>}
      <ErrorChip e={err} />
    </div>
  );
}
