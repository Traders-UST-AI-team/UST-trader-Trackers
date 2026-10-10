// Called after collection runs: re-capture every source item research depends on (revisions are detected prospectively) and
// mirror provider end dates into the calendar. Local work only — no network.
import { recaptureAttached } from './refs.ts';
import { syncProviderDates } from './calendar.ts';
import { scanMentions } from '../maritime/vessels.ts';

export function afterCollection(what: 'ingest' | 'telegram'): string {
  try {
    const r = recaptureAttached();
    const c = what === 'ingest' ? syncProviderDates() : null;
    const m = what === 'ingest' ? scanMentions() : null;
    return `research: ${r.checked} attached item(s) re-checked, ${r.changed} new version(s)${c ? `; calendar +${c.added} / ${c.revised} revised / ${c.closed} closed` : ''}${m ? `; vessel mentions +${m.proposed} proposed / +${m.unresolved} unresolved` : ''}`;
  } catch (e) { return `research hook failed: ${(e as Error).message}`; }
}
