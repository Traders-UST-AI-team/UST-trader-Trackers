import type { ConnectorStatus, WatchlistRow } from '../../../shared/review-types';
import { SIGNALS } from '../../../shared/review-signals';
import { ago } from '../../format';
import { Sparkline } from './charts';
import { formatDelta, formatTone, NO_VALUE } from './metrics';
import { SignalBadge, ExposureBadge, HitRate } from './badges';

interface Props {
  rows: WatchlistRow[] | null;
  failed: boolean;
  connectors: ConnectorStatus[] | null;
  canWrite: boolean;
  onOpen: (ticker: string) => void;
  onAdd: () => void;
  onRetry: () => void;
}

export function WatchlistPage({ rows, failed, connectors, canWrite, onOpen, onAdd, onRetry }: Props) {
  const now = Date.now();
  const swings = rows?.filter((r) => r.signal === 'negative_swing') ?? [];
  const decided = rows?.reduce((a, r) => ({ hits: a.hits + r.backtest.hits, misses: a.misses + r.backtest.misses }), { hits: 0, misses: 0 });
  const amazon = connectors?.find((c) => c.id === 'amazon');

  return (
    <>
      <header className="rv-pagehead">
        <div>
          <h1>Review tone watchlist</h1>
          <p className="rv-lede">
            Negative swings in consumer review tone have tended to lead revenue by one to two quarters
            (Jin, 2023). Each company's listings are collected on a schedule, scored −2…+2, and every
            swing is checked against the filings that followed.
          </p>
        </div>
        {canWrite && <button className="btn" onClick={onAdd}>+ Add company</button>}
      </header>

      {amazon && !amazon.ready && (
        <div className="rv-callout" role="note">
          <b>Automatic Amazon collection is not connected.</b> {amazon.detail} Filings are read from SEC EDGAR automatically either way.
        </div>
      )}

      <dl className="rv-kpis">
        <div><dt>Companies</dt><dd>{rows ? rows.length : NO_VALUE}</dd></div>
        <div><dt>Listings tracked</dt><dd>{rows ? rows.reduce((s, r) => s + r.product_count, 0) : NO_VALUE}</dd></div>
        <div className={swings.length ? 'warn' : ''}><dt>Negative swings now</dt><dd>{rows ? swings.length : NO_VALUE}</dd>
          {swings.length > 0 && <span className="rv-small">{swings.map((s) => s.company.ticker).join(', ')}</span>}</div>
        <div><dt>Swing hit rate</dt><dd>{decided && decided.hits + decided.misses > 0 ? `${Math.round((decided.hits / (decided.hits + decided.misses)) * 100)}%` : NO_VALUE}</dd>
          <span className="rv-small rv-muted">{decided ? `${decided.hits} hit · ${decided.misses} miss` : ''}</span></div>
      </dl>

      {failed ? (
        <p className="rv-empty" role="alert">The watchlist could not be loaded. <button className="rv-link" onClick={onRetry}>Retry</button></p>
      ) : rows === null ? (
        <p className="rv-empty">Loading the watchlist…</p>
      ) : rows.length === 0 ? (
        <div className="rv-empty">
          <p>No companies yet.</p>
          {canWrite ? <button className="btn" onClick={onAdd}>Add the first company</button> : <p className="rv-muted">Unlock editing with the team code to add one.</p>}
        </div>
      ) : (
        <div className="rv-tablewrap">
          <table className="rv-table rv-watch">
            <thead>
              <tr>
                <th>Company</th>
                <th className="hide-sm">Channel</th>
                <th>Latest quarter</th>
                <th className="hide-sm">Tone trend</th>
                <th className="num">Tone</th>
                <th className="num">Δ vs 4Q</th>
                <th>Signal</th>
                <th className="hide-sm">Track record</th>
                <th className="hide-sm num">Reviews 90d</th>
                <th className="hide-sm">Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.company.ticker} onClick={() => onOpen(r.company.ticker)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.company.ticker); }}>
                  <td>
                    <b className="rv-ticker">{r.company.ticker}</b>
                    <span className="rv-coname">{r.company.name}</span>
                    <span className="rv-muted rv-small">{r.product_count} listing{r.product_count === 1 ? '' : 's'}{r.company.added_by ? ` · added by ${r.company.added_by}` : ''}</span>
                  </td>
                  <td className="hide-sm"><ExposureBadge exposure={r.company.channel_exposure ?? 'medium'} /></td>
                  <td>{r.latest_quarter ?? <span className="rv-muted">no reviews</span>}{r.latest_quarter && r.is_sparse && <span className="rv-sparse" title={`Fewer than ${SIGNALS.sparseReviewCount} reviews carried tone`}>sparse</span>}</td>
                  <td className="hide-sm"><Sparkline values={r.tone_trend} /></td>
                  <td className="num">{formatTone(r.avg_tone, 2)}</td>
                  <td className={`num ${r.delta_tone != null && r.delta_tone < SIGNALS.negativeSwingDelta ? 'bad' : ''}`}>{formatDelta(r.delta_tone, 2)}</td>
                  <td><SignalBadge signal={r.signal} /></td>
                  <td className="hide-sm"><HitRate backtest={r.backtest} compact /></td>
                  <td className="hide-sm num">{r.reviews_90d}</td>
                  <td className="hide-sm rv-muted rv-small">{r.last_collected_at ? ago(r.last_collected_at, now) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="rv-details rv-method">
        <summary>How the signal is computed</summary>
        <ul>
          <li>Each review is scored for tone from −2 to +2 by the scoring chain (JEV first, then fallbacks). Seller, shipping and packaging complaints, and Amazon Vine free-product reviews, are kept but excluded from tone.</li>
          <li>A company's listings are pooled per quarter. Mean tone is compared with the mean of the previous four quarters: <code>Δ = tone<sub>t</sub> − baseline<sub>t</sub></code>.</li>
          <li>A <b>negative swing</b> is Δ below {SIGNALS.negativeSwingDelta} <i>and</i> a fall from the previous quarter. Quarters with fewer than {SIGNALS.sparseReviewCount} tone-bearing reviews are marked sparse.</li>
          <li>Every swing is checked against the next {SIGNALS.outcomeHorizonQuarters} reported quarters on SEC EDGAR: a <b>hit</b> when revenue YoY growth slowed, a <b>miss</b> when it did not. Misses are kept; the hit rate is shown next to the base rate (how often growth slowed anyway).</li>
          <li>Channel exposure records how much of a company's sales run through Amazon / DTC. Signals for low-exposure companies are weak by construction.</li>
        </ul>
      </details>
    </>
  );
}
