import { useState, useEffect } from 'react';
import type { CompanyFinancial, Company } from '../../../shared/review-types';
import { reviewsApi } from '../../api-reviews';
import { toast } from '../../toast';

interface SecReportsViewProps {
  companies: Company[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
}

export function SecReportsView({ companies, selectedTicker, onSelectTicker }: SecReportsViewProps) {
  // null = not loaded. An empty array is only ever "loaded, and this company has no filings".
  const [financials, setFinancials] = useState<CompanyFinancial[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    reviewsApi
      .financials(selectedTicker)
      .then((rows) => live && setFinancials(rows))
      .catch((e: Error) => {
        // Previously swallowed into console.error, after which the empty list rendered as
        // "No SEC financial records found for this ticker" — a claim about the world made from a
        // failed request.
        if (!live) return;
        setFinancials(null);
        setError(`Could not load SEC financials for ${selectedTicker}: ${e.message}`);
        toast(`Could not load SEC financials for ${selectedTicker}.`, 'error');
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [selectedTicker]);

  const currentCompany = companies.find((c) => c.ticker === selectedTicker);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Banner with Case Study & Source Provenance */}
      <div
        style={{
          background: 'linear-gradient(135deg, #171b22 0%, #1c2128 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '18px 20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>🏛️</span>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#f3f4f6' }}>
                Official SEC EDGAR Filings &amp; Earnings Reports
              </h3>
              <span
                style={{
                  fontSize: 11,
                  background: 'rgba(59, 130, 246, 0.2)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  padding: '2px 8px',
                  borderRadius: 12,
                }}
              >
                Authoritative U.S. GAAP Data
              </span>
            </div>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: 13, lineHeight: 1.5, maxWidth: 840 }}>
              Official quarterly 10-Q and annual 10-K filings retrieved from the U.S. Securities and Exchange Commission (SEC EDGAR).
              Used to backtest and correlate consumer review sentiment swings against subsequent reported GAAP revenue and operating income.
            </p>
          </div>

          {currentCompany?.cik && (
            <a
              href={`https://www.sec.gov/edgar/browse/?CIK=${currentCompany.cik}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#23272e',
                color: '#60a5fa',
                border: '1px solid #374151',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              SEC EDGAR (CIK: {currentCompany.cik}) ↗
            </a>
          )}
        </div>

        {/* Company Quick Switcher */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {companies.map((c) => (
            <button
              key={c.ticker}
              onClick={() => onSelectTicker(c.ticker)}
              style={{
                background: c.ticker === selectedTicker ? '#2563eb' : '#1e232a',
                color: c.ticker === selectedTicker ? '#ffffff' : '#9ca3af',
                border: '1px solid ' + (c.ticker === selectedTicker ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'),
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: c.ticker === selectedTicker ? 600 : 400,
              }}
            >
              {c.ticker} · {c.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Narrative Highlight Box based on Ticker */}
      {selectedTicker === 'NKE' && (
        <div
          style={{
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.25)',
            borderRadius: 8,
            padding: '14px 18px',
          }}
        >
          <b style={{ color: '#f87171', fontSize: 14 }}>
            Case Study (Video Intro): Nike (NKE) June 28, 2024 Collapse (-20% Drop)
          </b>
          <p style={{ margin: '6px 0 0 0', color: '#d1d5db', fontSize: 13, lineHeight: 1.5 }}>
            On June 28, 2024, Nike shares cratered 20% in a single trading session ($28.4B market cap wiped out) after reporting Q4 10-K sales down 2% and NIKE Direct sales down 8%. 
            Emerging rivals (On Holding, Hoka) had been accumulating overwhelmingly negative consumer review sentiment regarding Nike running shoe quality and durability for 6+ months beforehand.
          </p>
        </div>
      )}

      {selectedTicker === 'LOGI' && (
        <div
          style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: 8,
            padding: '14px 18px',
          }}
        >
          <b style={{ color: '#93c5fd', fontSize: 14 }}>
            Case Study: Logitech (LOGI) May 5, 2026 Earnings Release (Sales +7%, Operating Income +28%)
          </b>
          <p style={{ margin: '6px 0 0 0', color: '#d1d5db', fontSize: 13, lineHeight: 1.5 }}>
            In Angus Sewell's review pilot, Logitech M510 consumer sentiment experienced a positive swing in FY26 Q3 (Delta Tone +0.252).
            Subsequently on May 5, 2026, Logitech reported Q4 net sales rose 7% in US dollars, with operating income surging 28% to $203M, confirming the leading indicator.
            Conversely, in FY27 Q2, M510 Delta Tone swung negative to <b>-0.214</b>, warning of category headwinds.
          </p>
        </div>
      )}

      {/* Authoritative Financials Table */}
      <div
        style={{
          background: '#121418',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>
              {currentCompany?.name} ({selectedTicker}) · SEC Reported Financial History
            </h4>
            <span style={{ fontSize: 12, color: '#8b949e' }}>
              Fiscal Year Ends: Month {currentCompany?.fiscal_year_end_month} (
              {currentCompany?.fiscal_year_end_month === 3 ? 'March 31' : currentCompany?.fiscal_year_end_month === 5 ? 'May 31' : 'December 31'})
            </span>
          </div>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {financials === null ? 'Recorded quarters unknown' : `${financials.length} Recorded Quarters`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>Loading official SEC filings...</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#f87171' }} role="alert">
            {error} — a failed request, not an absence of filings.
          </div>
        ) : (financials ?? []).length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No SEC financial records found for this ticker.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#161a20', color: '#9ca3af', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <th className="rv-th-wide">Fiscal Quarter</th>
                  <th className="rv-th-wide">Period Ended</th>
                  <th className="rv-th-wide">SEC Filing Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Net Sales (USD)</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>YoY Growth</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Operating Income</th>
                  <th className="rv-th-wide">SEC Accession &amp; Excerpt</th>
                </tr>
              </thead>
              <tbody>
                {(financials ?? []).map((f, idx) => {
                  const yoy = f.revenue_yoy_growth;
                  const isPositive = yoy != null && yoy > 0;
                  return (
                    <tr
                      key={f.id || idx}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                      }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: '#f3f4f6' }}>
                        {f.fiscal_label}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                        {f.period_end_date}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                        {f.sec_report_date || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#e5e7eb', fontVariantNumeric: 'tabular-nums' }}>
                        {f.revenue_usd != null
                          ? f.revenue_usd >= 1e9
                            ? `$${(f.revenue_usd / 1e9).toFixed(2)}B`
                            : `$${(f.revenue_usd / 1e6).toFixed(0)}M`
                          : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {yoy != null ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontWeight: 600,
                              background: isPositive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isPositive ? '#4ade80' : '#f87171',
                            }}
                          >
                            {yoy > 0 ? `+${yoy.toFixed(1)}%` : `${yoy.toFixed(1)}%`}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                        {f.operating_income_usd != null
                          ? f.operating_income_usd >= 1e9
                            ? `$${(f.operating_income_usd / 1e9).toFixed(2)}B`
                            : `$${(f.operating_income_usd / 1e6).toFixed(0)}M`
                          : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 360 }}>
                        {f.official_excerpt ? (
                          <p style={{ margin: 0, color: '#9ca3af', fontSize: 11.5, lineHeight: 1.4 }}>
                            {f.official_excerpt}
                          </p>
                        ) : null}
                        {f.accession_number && (
                          <span style={{ fontSize: 10.5, color: '#6b7280', display: 'block', marginTop: 2 }}>
                            Accession: {f.accession_number}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
