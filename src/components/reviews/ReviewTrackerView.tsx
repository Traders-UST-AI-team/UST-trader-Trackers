import { useCallback, useState } from 'react';
import { navigateContext, useHashContext } from '../../navigation';
import { AddCompanyDialog, TeamCodeDialog } from './dialogs';
import { CompanyPage, type CompanyTab } from './CompanyPage';
import { WatchlistPage } from './WatchlistPage';
import { memberName, useTeamAccess } from './team';
import { useWatchlist } from './useReviewWorkspace';

const COMPANY_TABS: CompanyTab[] = ['signal', 'revenue', 'reviews', 'collection'];

/**
 * The Customer Reviews workspace: a team watchlist of companies, each with the Amazon listings that
 * stand for it, kept current on a schedule and tested against the filings that follow.
 *
 * Where you are lives in the URL (#reviews?company=LOGI&asin=…&rtab=revenue), so a view can be
 * shared as a link and the back button works.
 */
export function ReviewTrackerView() {
  const context = useHashContext();
  const ticker = context.company?.toUpperCase() ?? null;
  const asin = context.asin ?? null;
  const tab: CompanyTab = COMPANY_TABS.includes(context.rtab as CompanyTab) ? (context.rtab as CompanyTab) : 'signal';

  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const team = useTeamAccess();
  const { watchlist, connectors } = useWatchlist(version);
  const [dialog, setDialog] = useState<'company' | 'unlock' | null>(null);

  const go = (patch: { company?: string | null; asin?: string | null; rtab?: string | null }) => navigateContext(patch, 'reviews');

  return (
    <div className="rv">
      <div className="rv-inner">
        <div className="rv-accessbar">
          {team.writeProtected && (team.canWrite
            ? <span className="rv-small rv-muted">Editing{memberName.get() ? ` as ${memberName.get()}` : ''} · <button className="rv-link" onClick={team.lock}>lock</button></span>
            : <button className="rv-link" onClick={() => setDialog('unlock')}>🔒 Read-only · enter team code to edit</button>)}
        </div>

        {ticker ? (
          <CompanyPage
            ticker={ticker}
            asin={asin}
            tab={tab}
            version={version}
            canWrite={team.canWrite}
            connectors={connectors.data}
            onBack={() => go({ company: null, asin: null, rtab: null })}
            onScope={(a) => go({ asin: a })}
            onTab={(t) => go({ rtab: t === 'signal' ? null : t })}
            onChanged={changed}
          />
        ) : (
          <WatchlistPage
            rows={watchlist.data}
            failed={watchlist.state === 'error'}
            connectors={connectors.data}
            canWrite={team.canWrite}
            onOpen={(t) => go({ company: t, asin: null, rtab: null })}
            onAdd={() => setDialog('company')}
            onRetry={watchlist.reload}
          />
        )}
      </div>

      {dialog === 'unlock' && <TeamCodeDialog onClose={() => setDialog(null)} unlock={team.unlock} />}
      {dialog === 'company' && (
        <AddCompanyDialog
          onClose={() => setDialog(null)}
          onAdded={(t) => { setDialog(null); changed(); go({ company: t, asin: null, rtab: 'collection' }); }}
        />
      )}
    </div>
  );
}
