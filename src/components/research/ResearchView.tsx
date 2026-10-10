import { navigateContext, useHashContext } from '../../navigation';
import { useEffect, useRef, useState } from 'react';
import { Briefing } from './Briefing';
import { Dossiers } from './Dossiers';
import { Hypotheses } from './Hypotheses';
import { Upcoming } from './Upcoming';
import { Coverage } from './Coverage';
import { Places } from './Places';
import { Vessels } from './Vessels';

export type ResearchTab = 'briefing' | 'dossiers' | 'hypotheses' | 'upcoming' | 'coverage' | 'places' | 'vessels';
const TABS: [ResearchTab, string][] = [['briefing', 'Briefing'], ['dossiers', 'Dossiers'], ['hypotheses', 'Hypotheses'], ['upcoming', 'Upcoming'], ['coverage', 'Coverage'], ['places', 'Places'], ['vessels', 'Vessels & maritime sources']];

export function ResearchView({ dossierRequest, now, versionKey, openDossier, onOpenMarket, onOpenEvent }: { dossierRequest: number; now: number; versionKey: string; openDossier: string | null; onOpenMarket: (id: string) => void; onOpenEvent: (id: string) => void }) {
  const context = useHashContext();
  const tab = (context.tab ?? 'briefing') as ResearchTab;
  const setTab = (tab: ResearchTab) => navigateContext({ tab }, 'research');
  const visited = useRef(new Set<ResearchTab>(['briefing']));
  visited.current.add(tab);

  return (
    <main className="researchview">
      <div className="tabs" role="tablist" aria-label="Research">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {visited.current.has('briefing') && <div hidden={tab !== 'briefing'}><Briefing versionKey={versionKey} onOpenEvent={onOpenEvent} onOpenMarket={onOpenMarket} /></div>}
      {visited.current.has('dossiers') && <div hidden={tab !== 'dossiers'}><Dossiers initial={context.dossier ?? openDossier} versionKey={versionKey} /></div>}
      {visited.current.has('hypotheses') && <div hidden={tab !== 'hypotheses'}><Hypotheses versionKey={versionKey} /></div>}
      {visited.current.has('upcoming') && <div hidden={tab !== 'upcoming'}><Upcoming versionKey={versionKey} onOpenMarket={onOpenMarket} /></div>}
      {visited.current.has('coverage') && <div hidden={tab !== 'coverage'}><Coverage versionKey={versionKey} now={now} /></div>}
      {visited.current.has('places') && <div hidden={tab !== 'places'}><Places versionKey={versionKey} now={now} /></div>}
      {visited.current.has('vessels') && <div hidden={tab !== 'vessels'}><Vessels versionKey={versionKey} /></div>}
    </main>
  );
}
