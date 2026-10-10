import { useState } from 'react';
import { EditorialChart } from './EditorialChart';
import { ToneRevenueChart } from './ToneRevenueChart';
import { SecReportsView } from './SecReportsView';
import { ReviewIngesterModal } from './ReviewIngesterModal';
import { ReviewTable } from './ReviewTable';
import { useReviewData } from './useReviewData';
import { fiscalYearEndNote, formatCount, formatDelta, formatTone, headline, quarterAssessment, summariseProvenance, NO_VALUE } from './metrics';
import { SIGNALS } from '../../../shared/review-signals';

export type ReviewTab = 'quarterly_tone' | 'tone_change' | 'compare' | 'sec_reports' | 'review_map';

export function ReviewTrackerView() {
  // All reads live behind one interface; `null` means "not loaded", separate from "empty".
  const {
    companies, selectedTicker, setSelectedTicker, products, selectedAsin, setSelectedAsin,
    status, summary, summaryState, reviews, totalReviews, listState,
    filters, setFilters, error, reload, reloadList, createProduct,
  } = useReviewData();

  // Active Tab
  const [activeTab, setActiveTab] = useState<ReviewTab>('quarterly_tone');

  // Filter state for drill-down table
  const { platform, tone, reason, query, verifiedOnly } = filters;
  const setPlatform = (v: string) => setFilters({ platform: v });
  const setTone = (v: string) => setFilters({ tone: v });
  const setReason = (v: string) => setFilters({ reason: v });
  const setQuery = (v: string) => setFilters({ query: v });
  const setVerifiedOnly = (v: boolean) => setFilters({ verifiedOnly: v });
  const reviewsLoading = listState === 'loading';

  // Ingestion Modal
  const [ingesterOpen, setIngesterOpen] = useState<boolean>(false);
  const [addAsinOpen, setAddAsinOpen] = useState<boolean>(false);
  const [newAsin, setNewAsin] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');

  const handleCreateProduct = async () => {
    if (!newAsin.trim() || !newTitle.trim()) return;
    const ok = await createProduct(newAsin.trim().toUpperCase(), newTitle.trim());
    if (ok) {
      setNewAsin('');
      setNewTitle('');
      setAddAsinOpen(false);
    }
  };

  const currentProduct = products.find((p) => p.asin === selectedAsin);
  const latestQ = summary?.latest_quarter ?? null;

  // A value that has not loaded renders as unknown. It is never replaced by a plausible number.
  const meanToneStr = formatTone(latestQ?.avg_tone);
  const baselineStr = formatTone(latestQ?.baseline_tone);
  const deltaStr = formatDelta(latestQ?.delta_tone);
  const reviewCountStr = formatCount(latestQ ? latestQ.product_review_count ?? latestQ.review_count : null);
  const headlineText = headline(summary, summary?.company.name ?? null);
  const provenance = summariseProvenance(reviews ?? []);
  const listedCountForLabel = status ? status.captured_reviews + status.seed_reviews : null;


  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '24px 32px',
        maxWidth: 1080,
        margin: '0 auto',
        color: '#e5e7eb',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Selector Bar (Company & Product switcher) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
            Ticker:
            <select
              value={selectedTicker ?? ''}
              onChange={(e) => setSelectedTicker(e.target.value)}
              style={{
                background: '#161a20',
                color: '#f3f4f6',
                border: '1px solid #374151',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {companies.map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.ticker} ({c.name.split(' ')[0]})
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 13, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
            Product:
            <select
              value={selectedAsin ?? ''}
              onChange={(e) => setSelectedAsin(e.target.value)}
              style={{
                background: '#161a20',
                color: '#f3f4f6',
                border: '1px solid #374151',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 13,
                maxWidth: 260,
              }}
            >
              {products.map((p) => (
                <option key={p.asin} value={p.asin}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => setAddAsinOpen(true)}
            style={{
              background: '#23272e',
              color: '#d1d5db',
              border: '1px solid #374151',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + Add ASIN
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Was a literal "Updated 3h ago". What the store actually holds is worth stating instead. */}
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            {formatCount(listedCountForLabel)} stored reviews
            {provenance.captured > 0 ? ` · ${provenance.captured} captured in view` : ''}
          </span>

          {currentProduct?.amazon_url && (
            <a
              href={`https://www.amazon.com/product-reviews/${currentProduct.asin}?sortBy=recent`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#1c2128',
                color: '#60a5fa',
                border: '1px solid #374151',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                textDecoration: 'none',
              }}
            >
              🛒 Amazon Reviews ↗
            </a>
          )}

          <button
            onClick={() => setIngesterOpen(true)}
            style={{
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📥 Import Reviews (CSV)
          </button>
        </div>
      </div>

      {/* Main Editorial Header (Exact replication of Angus Sewell's dashboard) */}
      <div>
        <h1
          style={{
            fontFamily: "'Newsreader', 'Georgia', 'Iowan Old Style', 'Times New Roman', serif",
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: -0.5,
            color: '#ffffff',
            margin: '0 0 12px 0',
            lineHeight: 1.2,
          }}
        >
          {selectedTicker === 'LOGI'
            ? 'Logitech M510 review tone pilot'
            : `${currentProduct?.title || selectedAsin} review tone pilot`}
        </h1>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.6,
            color: '#9ca3af',
            margin: '0 0 8px 0',
            maxWidth: 920,
          }}
        >
          {headlineText}
        </p>

        <p
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: '#6b7280',
            margin: 0,
            maxWidth: 920,
          }}
        >
          One Amazon listing (ASIN {selectedAsin ?? NO_VALUE}), not all {summary?.company.name || 'Logitech'} reviews.
          Each review is scored for tone from -2 (very negative) to +2 (very positive); seller-only reviews
          are excluded from tone. Fiscal year ends {fiscalYearEndNote(summary?.company.fiscal_year_end_month ?? null)}
        </p>

        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: '#f87171', margin: '8px 0 0 0', maxWidth: 920 }}>
            {error}{' '}
            <button
              onClick={reload}
              style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: 12.5, textDecoration: 'underline' }}
            >
              Retry
            </button>
          </p>
        )}

        {provenance.label && (
          <p style={{ fontSize: 12.5, color: '#f59e0b', margin: '8px 0 0 0', maxWidth: 920 }}>{provenance.label}</p>
        )}
      </div>

      {/* Four Crisp KPI Stat Boxes (1:1 with video screenshot) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginTop: 4,
        }}
      >
        <div
          className="rv-panel"
        >
          <div className="rv-label">All records</div>
          <div className="rv-metric">
            {formatCount(summary?.all_records_count)}
          </div>
        </div>

        <div
          className="rv-panel"
        >
          <div className="rv-label">Product reviews</div>
          <div className="rv-metric">
            {formatCount(summary?.product_reviews_count)}
          </div>
        </div>

        <div
          className="rv-panel"
        >
          <div className="rv-label">Seller-only</div>
          <div className="rv-metric">
            {formatCount(summary?.seller_only_count)}
          </div>
        </div>

        <div
          className="rv-panel"
        >
          <div className="rv-label">
            Tone change, {latestQ ? latestQ.quarter_label : NO_VALUE}
          </div>
          <div
            className="rv-metric rv-metric-warn"
          >
            {deltaStr}
          </div>
        </div>
      </div>

      {/* Horizontal Navigation Tabs (Review map | Quarterly tone | Tone change | Compare | SEC Financials) */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: 2,
          marginTop: 6,
        }}
      >
        <button
          onClick={() => setActiveTab('review_map')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'review_map' ? '2px solid #ffffff' : '2px solid transparent',
            color: activeTab === 'review_map' ? '#ffffff' : '#8b949e',
            fontSize: 14,
            fontWeight: activeTab === 'review_map' ? 600 : 400,
            padding: '8px 4px',
            cursor: 'pointer',
          }}
        >
          Review map
        </button>

        <button
          onClick={() => setActiveTab('quarterly_tone')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'quarterly_tone' ? '2px solid #ffffff' : '2px solid transparent',
            color: activeTab === 'quarterly_tone' ? '#ffffff' : '#8b949e',
            fontSize: 14,
            fontWeight: activeTab === 'quarterly_tone' ? 600 : 400,
            padding: '8px 4px',
            cursor: 'pointer',
          }}
        >
          Quarterly tone
        </button>

        <button
          onClick={() => setActiveTab('tone_change')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'tone_change' ? '2px solid #ffffff' : '2px solid transparent',
            color: activeTab === 'tone_change' ? '#ffffff' : '#8b949e',
            fontSize: 14,
            fontWeight: activeTab === 'tone_change' ? 600 : 400,
            padding: '8px 4px',
            cursor: 'pointer',
          }}
        >
          Tone change
        </button>

        <button
          onClick={() => setActiveTab('compare')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'compare' ? '2px solid #ffffff' : '2px solid transparent',
            color: activeTab === 'compare' ? '#ffffff' : '#8b949e',
            fontSize: 14,
            fontWeight: activeTab === 'compare' ? 600 : 400,
            padding: '8px 4px',
            cursor: 'pointer',
          }}
        >
          Compare
        </button>

        <button
          onClick={() => setActiveTab('sec_reports')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'sec_reports' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'sec_reports' ? '#93c5fd' : '#8b949e',
            fontSize: 14,
            fontWeight: activeTab === 'sec_reports' ? 600 : 400,
            padding: '8px 4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🏛️ SEC Financials &amp; Reports
        </button>
      </div>

      {/* Tab Content Display */}

      {/* 1. Quarterly Tone (Exact reproduction of Angus Sewell's dashboard charts) */}
      {activeTab === 'quarterly_tone' && summary && summary.quarters.length > 0 && (
        <EditorialChart quarters={summary.quarters} />
      )}

      {/* 2. Tone Change (Negative Swing Focus & Formula breakdown) */}
      {activeTab === 'tone_change' && summary && summary.quarters.length > 0 && (
        <div className="rv-stack">
          <div
            style={{
              background: '#121418',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 8,
              padding: '16px 20px',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', margin: '0 0 6px 0' }}>
              The Negative Swing Indicator (Δ Tone Deviation)
            </h3>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Formula: <code>Δ Tone = Mean Tone (Quarter) - Mean Tone (Prior 4 Quarters)</code>.
              Negative review tone carries higher predictive asymmetry than positive tone.
              A drop below <b>{SIGNALS.negativeSwingDelta}</b> is flagged as a negative swing, and a rise above{' '}
              <b>+{SIGNALS.positiveDelta}</b> as a positive expansion — the same thresholds the server computes the
              flags with, so this table cannot disagree with the chart.
            </p>

            {/* Quick table of Delta Tone */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#8b949e', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left' }}>
                  <th className="rv-th">Quarter</th>
                  <th className="rv-th">Mean Tone</th>
                  <th className="rv-th">4Q Baseline</th>
                  <th className="rv-th">Δ Tone</th>
                  <th className="rv-th">Signal State</th>
                </tr>
              </thead>
              <tbody>
                {summary.quarters.map((q) => {
                  const assessment = quarterAssessment(q);
                  const isNeg = assessment.signal === 'negative_swing';
                  const isPos = assessment.signal === 'positive';
                  return (
                    <tr key={q.quarter_label} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#f3f4f6' }}>{q.quarter_label}</td>
                      <td style={{ padding: '10px 12px', color: '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTone(q.avg_tone)}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTone(q.baseline_tone)}
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: isNeg ? '#f87171' : isPos ? '#4ade80' : '#d1d5db',
                        }}
                      >
                        {formatDelta(q.delta_tone)}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {isNeg ? (
                          <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                            ⚠️ {assessment.label}
                          </span>
                        ) : isPos ? (
                          <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                            ▲ {assessment.label}
                          </span>
                        ) : (
                          <span style={{ color: '#6b7280', fontSize: 11 }}>
                            {assessment.label}
                            {assessment.sparse ? ' · sparse' : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Compare (Tone vs SEC Revenue YoY Dual-Axis & Misses) */}
      {activeTab === 'compare' && summary && summary.quarters.length > 0 && (
        <ToneRevenueChart quarters={summary.quarters} productTitle={currentProduct?.title || selectedAsin || ''} />
      )}

      {/* 4. Official SEC Filings & Financials Tab */}
      {activeTab === 'sec_reports' && (
        <SecReportsView
          companies={companies}
          selectedTicker={selectedTicker ?? ''}
          onSelectTicker={setSelectedTicker}
        />
      )}

      {/* 5. Review Map (Filterable Review Table with Maxwell J. quotes) */}
      {activeTab === 'review_map' && (
        <ReviewTable
          reviews={reviews ?? []}
          total={totalReviews}
          loading={reviewsLoading}
          failed={listState === 'error'}
          platform={platform}
          setPlatform={setPlatform}
          tone={tone}
          setTone={setTone}
          reason={reason}
          setReason={setReason}
          query={query}
          setQuery={setQuery}
          verifiedOnly={verifiedOnly}
          setVerifiedOnly={setVerifiedOnly}
          onRefreshList={() => {
            reloadList();
            reload();
          }}
        />
      )}

      {/* Add Custom ASIN Modal */}
      {addAsinOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#1c2128',
              border: '1px solid #374151',
              borderRadius: 8,
              padding: 24,
              width: 400,
              color: '#f3f4f6',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Add Amazon Product (ASIN)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>
                Amazon ASIN (e.g. B003NR57BY):
                <input
                  type="text"
                  value={newAsin}
                  onChange={(e) => setNewAsin(e.target.value.toUpperCase())}
                  placeholder="B003NR57BY"
                  style={{
                    width: '100%',
                    background: '#121418',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    padding: 8,
                    color: '#fff',
                    marginTop: 4,
                  }}
                />
              </label>

              <label style={{ fontSize: 12, color: '#9ca3af' }}>
                Product Title:
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Logitech M510 Wireless Mouse"
                  style={{
                    width: '100%',
                    background: '#121418',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    padding: 8,
                    color: '#fff',
                    marginTop: 4,
                  }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => setAddAsinOpen(false)}
                  style={{
                    background: '#2d333b',
                    color: '#c9d1d9',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 12px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProduct}
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 16px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Add Product
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ingestion Drawer Modal */}
      {currentProduct && (
        <ReviewIngesterModal
          isOpen={ingesterOpen}
          onClose={() => setIngesterOpen(false)}
          product={currentProduct}
          onImportSuccess={() => {
            reload();
            reloadList();
          }}
        />
      )}
    </div>
  );
}
