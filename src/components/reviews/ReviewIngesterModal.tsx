import { useState } from 'react';
import { reviewsApi } from '../../api-reviews';
import type { Product, SnifferDetectionResult } from '../../../shared/review-types';

interface ReviewIngesterModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

export function ReviewIngesterModal({
  product,
  isOpen,
  onClose,
  onImportSuccess,
}: ReviewIngesterModalProps) {
  const [tab, setTab] = useState<'extensions' | 'csv' | 'canary'>('extensions');
  const [snifferResult, setSnifferResult] = useState<SnifferDetectionResult | null>(null);
  const [sniffing, setSniffing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [canaryLoading, setCanaryLoading] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!isOpen) return null;

  const amazonUrl = `https://www.amazon.com/product-reviews/${product.asin}?sortBy=recent`;

  const handleFileUpload = (file: File) => {
    setStatusMsg(null);
    setSniffing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = (e.target?.result as string) || '';
      try {
        const result = await reviewsApi.sniff(text);
        setSnifferResult(result);
      } catch (err) {
        setStatusMsg({ type: 'err', text: `Sniffing failed: ${(err as Error).message}` });
      } finally {
        setSniffing(false);
      }
    };
    reader.onerror = () => {
      setSniffing(false);
      setStatusMsg({ type: 'err', text: 'Failed to read file' });
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!snifferResult || snifferResult.parsedReviews.length === 0) return;
    setImporting(true);
    setStatusMsg(null);
    try {
      const res = await reviewsApi.importReviews(product.asin, snifferResult.parsedReviews);
      setStatusMsg({
        type: 'ok',
        text: `Successfully imported ${res.imported} reviews and scored ${res.scored} with TypeSafe AI!`,
      });
      setTimeout(() => {
        onImportSuccess();
        onClose();
      }, 1200);
    } catch (err) {
      setStatusMsg({ type: 'err', text: `Import failed: ${(err as Error).message}` });
    } finally {
      setImporting(false);
    }
  };

  const handleFetchCanary = async (type: 'reddit' | 'bestbuy') => {
    setCanaryLoading(type);
    setStatusMsg(null);
    try {
      const res = await reviewsApi.fetchCanary(product.asin, type);
      setStatusMsg({
        type: 'ok',
        text: `Successfully fetched and scored ${res.added} canary reviews from ${type === 'reddit' ? 'Reddit r/' + (product.ticker === 'LOGI' ? 'Logitech' : 'community') : 'Best Buy'}!`,
      });
      setTimeout(() => {
        onImportSuccess();
      }, 1000);
    } catch (err) {
      setStatusMsg({ type: 'err', text: `Canary fetch failed: ${(err as Error).message}` });
    } finally {
      setCanaryLoading(null);
    }
  };

  return (
    <div className="overlay" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1000, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="panel"
        style={{
          width: '90%',
          maxWidth: 820,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--surface-1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 20,
        }}
        role="dialog"
        aria-labelledby="ingester-modal-title"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <h2 id="ingester-modal-title" style={{ fontSize: 18, fontWeight: 700 }}>
              📥 Review Ingestion Toolbox &amp; Column Sniffer
            </h2>
            <p className="muted small">
              Target Product: <b>{product.title}</b> ({product.asin}) · {product.ticker}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 14 }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>

        {/* Tab switch */}
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'extensions' ? 'on' : ''} onClick={() => setTab('extensions')}>
            🧩 1-Click Amazon &amp; Extensions
          </button>
          <button className={tab === 'csv' ? 'on' : ''} onClick={() => setTab('csv')}>
            📂 Drag-and-Drop CSV Sniffer {snifferResult ? `(${snifferResult.totalRows})` : ''}
          </button>
          <button className={tab === 'canary' ? 'on' : ''} onClick={() => setTab('canary')}>
            ⚡ API Canaries (Reddit &amp; Best Buy)
          </button>
        </div>

        {statusMsg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 13,
              background: statusMsg.type === 'ok' ? 'color-mix(in srgb, var(--ok) 15%, var(--surface-1))' : 'color-mix(in srgb, var(--bad) 15%, var(--surface-1))',
              color: statusMsg.type === 'ok' ? 'var(--ok)' : 'var(--bad)',
              border: `1px solid ${statusMsg.type === 'ok' ? 'var(--ok)' : 'var(--bad)'}`,
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* TAB 1: 1-Click Amazon & Extensions */}
        {tab === 'extensions' && (
          <div className="rv-stack">
            <div className="rv-panel-themed">
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>1️⃣ Open Target Amazon Reviews Page</h3>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Click below to launch Amazon's product review page pre-configured with <code>sortBy=recent</code> (newest first).
              </p>
              <a
                href={amazonUrl}
                target="_blank"
                rel="noreferrer"
                className="btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              >
                🔗 Open Amazon Reviews (ASIN: {product.asin}) ↗
              </a>
            </div>

            <div className="rv-panel-themed">
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>2️⃣ Recommended Free Chrome Extensions</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                <div style={{ padding: 12, background: 'var(--surface-1)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🧩 Instant Data Scraper</span>
                    <span className="chip" style={{ fontSize: 10, background: 'var(--ok)', color: '#fff' }}>Recommended</span>
                  </div>
                  <p className="muted small" style={{ marginBottom: 10 }}>
                    AI-powered table detector. Click extension icon on Amazon → click "Start crawling" → click "CSV" button.
                  </p>
                  <a
                    href="https://chromewebstore.google.com/detail/instant-data-scraper/ofaokhiedipichpaobibbnahnkdoiiah"
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}
                  >
                    Install from Chrome Web Store ↗
                  </a>
                </div>

                <div style={{ padding: 12, background: 'var(--surface-1)', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>🧩 Amazon Reviews Exporter</div>
                  <p className="muted small" style={{ marginBottom: 10 }}>
                    Specialized Amazon review scraper that outputs verified purchases, star ratings, and review body in one click.
                  </p>
                  <a
                    href="https://chromewebstore.google.com/detail/amazon-reviews-exporter/gijmopadllfcmcfchblakbkcogndidfc"
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}
                  >
                    Install from Chrome Web Store ↗
                  </a>
                </div>
              </div>
            </div>

            <div className="rv-panel-themed">
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>3️⃣ Next Step: Drag &amp; Drop CSV</h3>
              <p className="muted small" style={{ marginBottom: 10 }}>
                Once your CSV is downloaded, switch to the <b>"Drag-and-Drop CSV Sniffer"</b> tab above. Our Universal Column Sniffer will auto-detect columns without manual configuration.
              </p>
              <button
                className="btn"
                style={{ background: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                onClick={() => setTab('csv')}
              >
                Go to CSV Dropzone →
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: CSV Drag & Drop with Sniffer */}
        {tab === 'csv' && (
          <div className="rv-stack">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
              style={{
                border: '2px dashed var(--border)',
                borderRadius: 8,
                padding: '30px 20px',
                textAlign: 'center',
                background: 'var(--surface-2)',
                cursor: 'pointer',
              }}
              onClick={() => {
                const el = document.getElementById('csv-file-input');
                el?.click();
              }}
            >
              <input
                id="csv-file-input"
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <div style={{ fontSize: 28, marginBottom: 8 }}>📥</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Drop any scraper CSV / TSV here, or click to browse
              </div>
              <p className="muted small">
                Works with Instant Data Scraper, Amazon Reviews Exporter, Webscraper.io, comma/semicolon/tab formats.
              </p>
            </div>

            {sniffing && <div className="muted small">🔍 Running Universal Column Sniffer...</div>}

            {snifferResult && (
              <div className="rv-panel-themed">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14 }}>
                    🎯 Column Sniffer Analysis ({snifferResult.totalRows} rows, {snifferResult.parsedReviews.length} valid reviews)
                  </h3>
                  <span className="chip" style={{ background: 'var(--ok)', color: '#fff', fontSize: 11 }}>
                    Confidence: {(snifferResult.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 14 }}>
                  <div className="chip" style={{ padding: '4px 8px' }}>
                    Body: <b>{snifferResult.detectedColumns.bodyCol || 'Not detected'}</b>
                  </div>
                  <div className="chip" style={{ padding: '4px 8px' }}>
                    Date: <b>{snifferResult.detectedColumns.dateCol || 'Not detected'}</b>
                  </div>
                  <div className="chip" style={{ padding: '4px 8px' }}>
                    Rating: <b>{snifferResult.detectedColumns.ratingCol || 'Not detected'}</b>
                  </div>
                  <div className="chip" style={{ padding: '4px 8px' }}>
                    Title: <b>{snifferResult.detectedColumns.titleCol || 'Optional'}</b>
                  </div>
                  <div className="chip" style={{ padding: '4px 8px' }}>
                    Author: <b>{snifferResult.detectedColumns.authorCol || 'Optional'}</b>
                  </div>
                </div>

                {snifferResult.parsedReviews.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <h4 style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-secondary)' }}>Parsed Sample Preview:</h4>
                    <div style={{ overflowX: 'auto', maxHeight: 150, border: '1px solid var(--border)', borderRadius: 6 }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
                            <th className="rv-cell-tight">Date</th>
                            <th className="rv-cell-tight">Rating</th>
                            <th className="rv-cell-tight">Title</th>
                            <th className="rv-cell-tight">Review Body Excerpt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snifferResult.parsedReviews.slice(0, 3).map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{r.date}</td>
                              <td className="rv-cell-tight">{r.rating != null ? `${r.rating}★` : 'N/A'}</td>
                              <td style={{ padding: '4px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '—'}</td>
                              <td style={{ padding: '4px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.body}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <button
                  className="btn"
                  onClick={handleImport}
                  disabled={importing || snifferResult.parsedReviews.length === 0}
                  style={{ width: '100%' }}
                >
                  {importing ? 'Scoring with TypeSafe AI & Importing...' : `Import & Score ${snifferResult.parsedReviews.length} Reviews`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Canary Ingestion */}
        {tab === 'canary' && (
          <div className="rv-stack">
            <div className="rv-panel-themed">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h3 style={{ fontSize: 14 }}>💬 Reddit Canary Community Scanner</h3>
                <span className="chip" style={{ background: 'var(--warn)', color: '#fff', fontSize: 10 }}>T-60 Days Early Sentinel</span>
              </div>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Searches Reddit public feeds (e.g. <code>r/{product.ticker === 'LOGI' ? 'Logitech' : 'BuyItForLife'}</code>) for user complaints regarding <b>{product.reddit_query || product.title}</b>.
              </p>
              <button
                className="btn"
                onClick={() => handleFetchCanary('reddit')}
                disabled={Boolean(canaryLoading)}
              >
                {canaryLoading === 'reddit' ? 'Scanning Reddit...' : 'Fetch Reddit Canary Posts'}
              </button>
            </div>

            <div className="rv-panel-themed">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h3 style={{ fontSize: 14 }}>🏪 Best Buy Official Review Feed</h3>
                <span className="chip" style={{ background: 'var(--ok)', color: '#fff', fontSize: 10 }}>Official 3C Stream</span>
              </div>
              <p className="muted small" style={{ marginBottom: 12 }}>
                Queries consumer reviews from Best Buy (SKU: <b>{product.bestbuy_sku || 'N/A'}</b>). Official retail feedback with clean buyer verification.
              </p>
              <button
                className="btn"
                onClick={() => handleFetchCanary('bestbuy')}
                disabled={Boolean(canaryLoading) || !product.bestbuy_sku}
              >
                {canaryLoading === 'bestbuy' ? 'Fetching Best Buy Reviews...' : 'Fetch Best Buy Reviews'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
