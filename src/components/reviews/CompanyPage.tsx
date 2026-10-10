import { useState } from 'react';
import type { ChannelExposure, ConnectorStatus, Product, QuarterlyAggregation } from '../../../shared/review-types';
import { SIGNALS } from '../../../shared/review-signals';
import { reviewsApi } from '../../api-reviews';
import { ago } from '../../format';
import { toast } from '../../toast';
import { ToneRevenueChart, ToneSignalChart } from './charts';
import { ExposureBadge, HitRate, OutcomeBadge, SignalBadge } from './badges';
import { AddListingDialog, ImportDialog } from './dialogs';
import { fiscalYearEndNote, formatDelta, formatMillions, formatPercent, formatTone, NO_VALUE, summariseProvenance } from './metrics';
import { ReviewTable } from './ReviewTable';
import { useCompany } from './useReviewWorkspace';

export type CompanyTab = 'signal' | 'revenue' | 'reviews' | 'collection';
const TABS: { id: CompanyTab; label: string }[] = [
  { id: 'signal', label: 'Tone signal' },
  { id: 'revenue', label: 'vs Revenue' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'collection', label: 'Collection' },
];

interface Props {
  ticker: string;
  asin: string | null;
  tab: CompanyTab;
  version: number;
  canWrite: boolean;
  connectors: ConnectorStatus[] | null;
  onBack: () => void;
  onScope: (asin: string | null) => void;
  onTab: (tab: CompanyTab) => void;
  onChanged: () => void;
}

export function CompanyPage({ ticker, asin, tab, version, canWrite, connectors, onBack, onScope, onTab, onChanged }: Props) {
  const { summary, runs, financials, listings, list, filters, setFilters } = useCompany(ticker, asin, version);
  const [dialog, setDialog] = useState<'listing' | 'import' | null>(null);
  const [busy, setBusy] = useState<'collect' | 'filings' | null>(null);
  const s = summary.data;
  const company = s?.company;
  const latest = s?.latest_quarter ?? null;
  const allProducts: Product[] = listings.data ?? [];
  const activeProducts = allProducts.filter((p) => p.is_active);
  const provenance = summariseProvenance(list.data?.reviews ?? []);

  const collect = async () => {
    setBusy('collect');
    try {
      const { runs: done } = await reviewsApi.collect(asin ? { asin } : { ticker });
      const stored = done.reduce((n, r) => n + r.stored, 0);
      const failed = done.filter((r) => r.status === 'error' || r.status === 'unavailable');
      toast(failed.length === done.length ? `Nothing collected: ${failed[0]?.message ?? 'no connector'}` : `Collected ${stored} new review${stored === 1 ? '' : 's'}.`, failed.length === done.length ? 'info' : 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const refreshFilings = async () => {
    setBusy('filings');
    try {
      const run = await reviewsApi.syncFinancials(ticker);
      toast(run.status === 'ok' ? `Filings updated: ${run.message}` : `Filings not updated: ${run.message}`, run.status === 'ok' ? 'success' : 'error');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const setExposure = async (exposure: ChannelExposure) => {
    try {
      await reviewsApi.updateCompany(ticker, { channel_exposure: exposure });
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggleListing = async (p: Product) => {
    try {
      await reviewsApi.setProductActive(p.asin, !p.is_active);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <nav className="rv-crumbs"><button className="rv-link" onClick={onBack}>← Watchlist</button></nav>

      <header className="rv-pagehead">
        <div>
          <h1><span className="rv-ticker">{ticker}</span> {company?.name ?? ''}</h1>
          <p className="rv-meta">
            {company && <ExposureBadge exposure={company.channel_exposure ?? 'medium'} />}
            {company?.sector && <span>{company.sector}</span>}
            {company && <span>Fiscal year ends {fiscalYearEndNote(company.fiscal_year_end_month)}</span>}
          </p>
          {company?.notes && <p className="rv-lede">{company.notes}</p>}
          <p className="rv-muted rv-small">
            {company?.added_by ? `Added by ${company.added_by} · ` : ''}
            Filings {company?.financials_synced_at ? `read ${ago(company.financials_synced_at)}` : 'not read yet'}
            {company?.financials_status && company.financials_status !== 'ok' ? ` (${company.financials_status})` : ''}
          </p>
        </div>
        {canWrite && (
          <div className="rv-headactions">
            <button className="btn" onClick={() => void collect()} disabled={busy !== null}>{busy === 'collect' ? 'Collecting…' : 'Collect now'}</button>
            <button className="btn-secondary" onClick={() => setDialog('import')} disabled={activeProducts.length === 0}>Import CSV</button>
            <button className="btn-secondary" onClick={() => void refreshFilings()} disabled={busy !== null}>{busy === 'filings' ? 'Reading EDGAR…' : 'Refresh filings'}</button>
          </div>
        )}
      </header>

      <div className="rv-scope" role="tablist" aria-label="Listings">
        <button role="tab" aria-selected={!asin} className={!asin ? 'on' : ''} onClick={() => onScope(null)}>All listings, pooled</button>
        {activeProducts.map((p) => (
          <button key={p.asin} role="tab" aria-selected={asin === p.asin} className={asin === p.asin ? 'on' : ''} onClick={() => onScope(p.asin)} title={p.asin}>{p.title}</button>
        ))}
        {canWrite && <button className="rv-add" onClick={() => setDialog('listing')}>+ Track a product</button>}
      </div>

      {summary.state === 'error' ? (
        <p className="rv-empty" role="alert">{summary.error} <button className="rv-link" onClick={summary.reload}>Retry</button></p>
      ) : (
        <>
          <dl className="rv-kpis">
            <div>
              <dt>Mean tone, {latest?.quarter_label ?? NO_VALUE}</dt>
              <dd>{formatTone(latest?.avg_tone, 2)}</dd>
              <span className="rv-small rv-muted">{latest ? `n = ${latest.tone_review_count ?? latest.review_count}${latest.is_sparse ? ' · sparse' : ''}` : 'no reviews yet'}</span>
            </div>
            <div className={latest?.delta_tone != null && latest.delta_tone < SIGNALS.negativeSwingDelta ? 'warn' : ''}>
              <dt>Δ vs 4-quarter baseline</dt>
              <dd>{formatDelta(latest?.delta_tone, 2)}</dd>
              <span className="rv-small rv-muted">baseline {formatTone(latest?.baseline_tone, 2)}</span>
            </div>
            <div><dt>Signal</dt><dd className="rv-dd-badge"><SignalBadge signal={latest?.signal ?? null} /></dd>
              {latest?.outcome && <span className="rv-small"><OutcomeBadge outcome={latest.outcome} /></span>}</div>
            <div><dt>Track record</dt><dd className="rv-dd-badge">{s ? <HitRate backtest={s.backtest} /> : NO_VALUE}</dd>
              <span className="rv-small rv-muted">{s ? `${s.backtest.pending} pending · next ${SIGNALS.outcomeHorizonQuarters} quarters` : ''}</span></div>
          </dl>

          {provenance.label && <p className="rv-callout subtle">{provenance.label}</p>}

          <div className="rv-tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>{t.label}</button>)}
          </div>

          {!s ? <p className="rv-empty">Loading…</p> : (
            <>
              {tab === 'signal' && (s.quarters.length === 0
                ? <EmptyQuarters canWrite={canWrite} onImport={() => setDialog('import')} />
                : <>
                  <ToneSignalChart quarters={s.quarters} />
                  <QuarterTable quarters={s.quarters} />
                </>)}
              {tab === 'revenue' && (s.quarters.length === 0
                ? <EmptyQuarters canWrite={canWrite} onImport={() => setDialog('import')} />
                : <>
                  <ToneRevenueChart quarters={s.quarters} />
                  <p className="rv-muted rv-small">
                    A swing is a <b>hit</b> when revenue YoY growth in one of the next {SIGNALS.outcomeHorizonQuarters} reported quarters is lower than in the swing quarter, and a <b>miss</b> when both are reported and neither is.
                    Base rate: how often growth slowed after any quarter ({s.backtest.base_quarters} quarters on file).
                  </p>
                  <FinancialsTable rows={financials.data} />
                </>)}
              {tab === 'reviews' && (
                <ReviewTable reviews={list.data?.reviews ?? (list.state === 'error' ? [] : null)} total={list.data?.total ?? null} loading={list.state === 'loading'}
                  failed={list.state === 'error'} filters={filters} setFilters={setFilters} canWrite={canWrite} onChanged={onChanged} />
              )}
              {tab === 'collection' && (
                <CollectionPanel products={allProducts} connectors={connectors} runs={runs.data} canWrite={canWrite} onToggle={toggleListing}
                  exposure={company?.channel_exposure ?? 'medium'} onExposure={setExposure} />
              )}
            </>
          )}
        </>
      )}

      {dialog === 'listing' && <AddListingDialog ticker={ticker} onClose={() => setDialog(null)} onAdded={() => { setDialog(null); onChanged(); }} />}
      {dialog === 'import' && <ImportDialog products={activeProducts} initialAsin={asin} onClose={() => setDialog(null)} onImported={() => { setDialog(null); onChanged(); }} />}
    </>
  );
}

function EmptyQuarters({ canWrite, onImport }: { canWrite: boolean; onImport: () => void }) {
  return (
    <div className="rv-empty">
      <p>No reviews stored for these listings yet, so there is no quarter to plot.</p>
      {canWrite && <p><button className="btn-secondary" onClick={onImport}>Import a CSV</button> <span className="rv-muted">or connect Amazon collection and press Collect now.</span></p>}
    </div>
  );
}

function QuarterTable({ quarters }: { quarters: QuarterlyAggregation[] }) {
  return (
    <div className="rv-tablewrap">
      <table className="rv-table">
        <thead>
          <tr><th>Quarter</th><th className="num">Reviews</th><th className="num">Mean tone</th><th className="num">Baseline</th><th className="num">Δ</th><th className="num hide-sm">QoQ</th><th>Signal</th><th>Outcome</th></tr>
        </thead>
        <tbody>
          {[...quarters].reverse().map((q) => (
            <tr key={q.calendar_quarter} className="static">
              <td><b>{q.quarter_label}</b> <span className="rv-muted rv-small">{q.calendar_quarter}</span></td>
              <td className="num">{q.tone_review_count ?? q.review_count}{q.is_sparse && <span className="rv-sparse">sparse</span>}
                {(q.vine_count ?? 0) + (q.seller_only_count ?? 0) > 0 && <span className="rv-muted rv-small" title="Vine and seller/shipping reviews, excluded from tone"> +{(q.vine_count ?? 0) + (q.seller_only_count ?? 0)} excl.</span>}</td>
              <td className="num">{formatTone(q.avg_tone, 2)}</td>
              <td className="num rv-muted">{formatTone(q.baseline_tone, 2)}</td>
              <td className={`num ${q.is_negative_swing ? 'bad' : ''}`}>{formatDelta(q.delta_tone, 2)}</td>
              <td className="num hide-sm">{formatDelta(q.qoq_change, 2)}</td>
              <td><SignalBadge signal={q.signal ?? null} /></td>
              <td>
                <OutcomeBadge outcome={q.outcome ?? null} />
                {q.outcome_filing && <span className="rv-muted rv-small"> {q.outcome_filing.fiscal_label} YoY {formatPercent(q.outcome_filing.revenue_yoy_growth)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinancialsTable({ rows }: { rows: import('../../../shared/review-types').CompanyFinancial[] | null }) {
  if (!rows) return <p className="rv-empty">Loading filings…</p>;
  if (rows.length === 0) return <p className="rv-empty">No reported quarters on file. Refresh filings to read them from SEC EDGAR.</p>;
  const demo = rows.some((r) => r.provenance !== 'edgar');
  return (
    <>
      <h3 className="rv-h3">Reported quarters {demo ? <span className="chip warn">includes bundled demo figures</span> : <span className="chip">SEC EDGAR</span>}</h3>
      <div className="rv-tablewrap">
        <table className="rv-table">
          <thead><tr><th>Fiscal quarter</th><th className="hide-sm">Period</th><th className="num">Revenue</th><th className="num">YoY</th><th className="num hide-sm">Gross margin</th><th className="num hide-sm">Op. income</th><th>Filed</th></tr></thead>
          <tbody>
            {[...rows].reverse().slice(0, 16).map((f) => (
              <tr key={f.id} className="static">
                <td><b>{f.fiscal_label}</b></td>
                <td className="hide-sm rv-muted rv-small">{f.period_start_date} → {f.period_end_date}</td>
                <td className="num">{formatMillions(f.revenue_usd)}</td>
                <td className={`num ${f.revenue_yoy_growth != null && f.revenue_yoy_growth < 0 ? 'bad' : ''}`}>{formatPercent(f.revenue_yoy_growth)}</td>
                <td className="num hide-sm">{formatPercent(f.gross_margin)}</td>
                <td className="num hide-sm">{formatMillions(f.operating_income_usd)}</td>
                <td>{f.source_filing_url ? <a href={f.source_filing_url} target="_blank" rel="noreferrer">{f.sec_report_date ?? 'filing'} ↗</a> : f.sec_report_date ?? NO_VALUE}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CollectionPanel({ products, connectors, runs, canWrite, onToggle, exposure, onExposure }: {
  products: Product[];
  connectors: ConnectorStatus[] | null;
  runs: import('../../../shared/review-types').CollectionRun[] | null;
  canWrite: boolean;
  onToggle: (p: Product) => void;
  exposure: ChannelExposure;
  onExposure: (e: ChannelExposure) => void;
}) {
  return (
    <div className="rv-collection">
      <section>
        <h3 className="rv-h3">Sources</h3>
        <ul className="rv-connectors">
          {(connectors ?? []).map((c) => (
            <li key={c.id} className={c.ready ? 'ready' : 'off'}>
              <span className="dot" aria-hidden />
              <div><b>{c.label}</b> <span className="rv-muted rv-small">{c.ready ? (c.scheduled ? 'scheduled' : 'on request') : 'not connected'}</span><br /><span className="rv-small rv-muted">{c.detail}</span></div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="rv-h3">Tracked listings</h3>
        {products.length === 0 ? <p className="rv-empty">No products tracked yet. Add the company's best-selling Amazon listings with “Track a product”.</p> : (
        <div className="rv-tablewrap">
          <table className="rv-table">
            <thead><tr><th>Product</th><th className="hide-sm">Every</th><th>Last collected</th><th className="hide-sm">Added by</th>{canWrite && <th />}</tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.asin} className={`static ${p.is_active ? '' : 'paused'}`}>
                  <td><b>{p.title}</b><br /><a className="rv-small" href={`https://www.${p.amazon_domain ?? 'amazon.com'}/dp/${p.asin}`} target="_blank" rel="noreferrer">{p.asin} ↗</a>{p.bestbuy_sku ? <span className="rv-muted rv-small"> · Best Buy {p.bestbuy_sku}</span> : null}</td>
                  <td className="hide-sm">{(p.collect_interval_hours ?? 24) >= 168 ? 'week' : `${p.collect_interval_hours ?? 24} h`}</td>
                  <td className="rv-small">{p.last_collected_at ? ago(p.last_collected_at) : 'never'}</td>
                  <td className="hide-sm rv-muted rv-small">{p.added_by ?? '—'}</td>
                  {canWrite && <td><button className="rv-link" onClick={() => onToggle(p)}>{p.is_active ? 'Pause' : 'Resume'}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {canWrite && (
          <p className="rv-small rv-muted rv-inline">
            Channel exposure:
            {(['high', 'medium', 'low'] as const).map((x) => <button key={x} className={`rv-link ${exposure === x ? 'on' : ''}`} onClick={() => onExposure(x)}>{x}</button>)}
          </p>
        )}
      </section>

      <section>
        <h3 className="rv-h3">Collection log</h3>
        {!runs ? <p className="rv-empty">Loading…</p> : runs.length === 0 ? <p className="rv-empty">Nothing has been collected for this company yet.</p> : (
          <div className="rv-tablewrap">
            <table className="rv-table">
              <thead><tr><th>When</th><th>Source</th><th className="hide-sm">Listing</th><th>Result</th><th className="num">New</th><th className="hide-sm">Detail</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="static">
                    <td className="rv-small">{ago(r.started_at)}<br /><span className="rv-muted">{r.trigger}</span></td>
                    <td>{r.connector}</td>
                    <td className="hide-sm rv-small">{r.asin ?? '—'}</td>
                    <td><span className={`rv-run ${r.status}`}>{r.status}</span></td>
                    <td className="num">{r.stored}</td>
                    <td className="hide-sm rv-small rv-muted">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
