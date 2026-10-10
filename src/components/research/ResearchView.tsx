import { navigateContext, useHashContext } from '../../navigation';
import { useEffect, useRef, useState } from 'react';
import { Briefing } from './Briefing';
import { Dossiers } from './Dossiers';
import { Hypotheses } from './Hypotheses';
import { Upcoming } from './Upcoming';
import { Coverage } from './Coverage';
import { Places } from './Places';
import { Vessels } from './Vessels';

import type { Market } from '../../../shared/types';

export type ResearchTab = 'briefing' | 'dossiers' | 'hypotheses' | 'upcoming' | 'coverage' | 'places' | 'vessels';
// The daily jobs are tabs; reference pages are quiet links beside them (concealed, not deleted).
const TABS: [ResearchTab, string][] = [['briefing', 'Briefing'], ['upcoming', 'Calendar'], ['dossiers', 'Dossiers'], ['hypotheses', 'Hypotheses']];
const MORE: [ResearchTab, string][] = [['places', 'Places'], ['vessels', 'Vessels'], ['coverage', 'Coverage']];

export function ResearchView({ dossierRequest, now, versionKey, openDossier, onOpenMarket, onOpenEvent, markets }: { dossierRequest: number; now: number; versionKey: string; openDossier: string | null; onOpenMarket: (id: string) => void; onOpenEvent: (id: string) => void; markets: Market[] }) {
  const context = useHashContext();
  const tab = (context.tab ?? 'briefing') as ResearchTab;
  const setTab = (tab: ResearchTab) => navigateContext({ tab }, 'research');
  const visited = useRef(new Set<ResearchTab>(['briefing']));
  visited.current.add(tab);

  return (
    <main className="researchview">
      <div className="rs-head">
        <h1>Research</h1>
        <div className="seg" role="tablist" aria-label="Research">
          {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        <nav className="rs-more" aria-label="Reference pages">
          {MORE.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{label}</button>)}
        </nav>
      </div>
      {visited.current.has('briefing') && <div hidden={tab !== 'briefing'}><Briefing versionKey={versionKey} onOpenEvent={onOpenEvent} onOpenMarket={onOpenMarket} /></div>}
      {visited.current.has('dossiers') && <div hidden={tab !== 'dossiers'}><Dossiers initial={context.dossier ?? openDossier} versionKey={versionKey} /></div>}
      {visited.current.has('hypotheses') && <div hidden={tab !== 'hypotheses'}><Hypotheses versionKey={versionKey} /></div>}
      {visited.current.has('upcoming') && <div hidden={tab !== 'upcoming'}><Upcoming versionKey={versionKey} onOpenMarket={onOpenMarket} markets={markets} /></div>}
      {visited.current.has('coverage') && <div hidden={tab !== 'coverage'}><Coverage versionKey={versionKey} now={now} /></div>}
      {visited.current.has('places') && <div hidden={tab !== 'places'}><Places versionKey={versionKey} now={now} /></div>}
      {visited.current.has('vessels') && <div hidden={tab !== 'vessels'}><Vessels versionKey={versionKey} /></div>}
    </main>
  );
}
