import { useState } from 'react';
import type { EnrichedReview } from '../../../shared/review-types';
import { reviewsApi } from '../../api-reviews';
import { toast } from '../../toast';

interface ReviewTableProps {
  reviews: EnrichedReview[];
  total: number | null;
  loading: boolean;
  /** The list could not be loaded: distinct from a list that loaded and matched nothing. */
  failed?: boolean;
  platform: string;
  setPlatform: (p: string) => void;
  tone: string;
  setTone: (t: string) => void;
  reason: string;
  setReason: (r: string) => void;
  query: string;
  setQuery: (q: string) => void;
  verifiedOnly: boolean;
  setVerifiedOnly: (v: boolean) => void;
  onRefreshList: () => void;
}

export function ReviewTable({
  reviews,
  total,
  loading,
  failed = false,
  platform,
  setPlatform,
  tone,
  setTone,
  reason,
  setReason,
  query,
  setQuery,
  verifiedOnly,
  setVerifiedOnly,
  onRefreshList,
}: ReviewTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRescore = async (reviewId: string) => {
    setRescoringId(reviewId);
    try {
      await reviewsApi.scoreSingle({ review_id: reviewId });
      toast(`Re-scored ${reviewId}.`, 'success');
      onRefreshList();
    } catch (e) {
      // Was a blocking alert(); the toast seam is where every other failure in this app surfaces.
      toast(`Rescore failed: ${(e as Error).message}`, 'error');
    } finally {
      setRescoringId(null);
    }
  };

  const getToneBadge = (score: number) => {
    if (score === -2) return { text: '-2 严重差评 / Defect', cls: 'pill err' };
    if (score === -1) return { text: '-1 温和差评 / Decline', cls: 'pill stale' };
    if (score === 0) return { text: '0 中立 / Neutral', cls: 'pill' };
    if (score === 1) return { text: '+1 温和好评', cls: 'pill ok' };
    return { text: '+2 强烈好评 / Praise', cls: 'pill ok' };
  };

  const getPlatformBadge = (plat: string) => {
    if (plat === 'reddit') return { name: 'Reddit', color: '#ff4500' };
    if (plat === 'bestbuy') return { name: 'Best Buy', color: '#0046be' };
    return { name: 'Amazon', color: '#f59e0b' };
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>
          💬 Review Inspection &amp; Sentiment Attribution Drill-Down ({total ?? 'unknown'} reviews)
        </h3>
        <button
          onClick={onRefreshList}
          disabled={loading}
          style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}
        >
          {loading ? 'Refreshing...' : '🔄 Refresh List'}
        </button>
      </div>

      {/* Filter row */}
      <div className="filters" style={{ padding: 0, border: 'none' }}>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="search"
            placeholder="Search keywords (e.g. double click, switch, cheap, battery)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />

          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter Platform">
            <option value="all">All Platforms</option>
            <option value="amazon">Amazon Reviews</option>
            <option value="bestbuy">Best Buy</option>
            <option value="reddit">Reddit Public Posts</option>
          </select>

          <select value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Filter Tone">
            <option value="all">All Tone Scores</option>
            <option value="negative">Negative (-2, -1)</option>
            <option value="-2">Severe Defect (-2)</option>
            <option value="-1">Mild Discontent (-1)</option>
            <option value="neutral">Neutral (0)</option>
            <option value="positive">Positive (+1, +2)</option>
          </select>

          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Filter Reason">
            <option value="all">All Attribution Reasons</option>
            <option value="defect">Hardware Defect</option>
            <option value="quality_decline">Quality Decline</option>
            <option value="ergonomics">Ergonomics</option>
            <option value="software">Software / Firmware</option>
            <option value="price">Price / Value</option>
            <option value="praise">High Praise</option>
            <option value="other">Other / Shipping</option>
          </select>

          <label className="check" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
            />
            Verified Only
          </label>
        </div>
      </div>

      {/* Review list. A failed load is not an empty result, and must not claim to be. */}
      {failed ? (
        <div className="empty" role="alert">
          The review list could not be loaded, so this is not a statement about what exists. Use Refresh List to retry.
        </div>
      ) : loading && reviews.length === 0 ? (
        <div className="empty">Loading customer reviews...</div>
      ) : reviews.length === 0 ? (
        <div className="empty">No reviews match the selected filters.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map((r) => {
            const toneBadge = getToneBadge(r.tone_score);
            const platBadge = getPlatformBadge(r.platform);
            const isExpanded = expandedIds.has(r.review_id);
            const isLong = r.body.length > 220;

            return (
              <div
                key={r.review_id}
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderLeft: `4px solid ${r.tone_score <= -1 ? 'var(--bad)' : r.tone_score >= 1 ? 'var(--ok)' : 'var(--muted)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: platBadge.color,
                        color: '#fff',
                      }}
                    >
                      {platBadge.name}
                    </span>

                    {r.star_rating != null && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
                        {'★'.repeat(Math.round(r.star_rating))}{'☆'.repeat(5 - Math.round(r.star_rating))}
                      </span>
                    )}

                    <span className={toneBadge.cls} style={{ fontSize: 11 }}>
                      <i /> {toneBadge.text}
                    </span>

                    <span
                      className="chip"
                      style={{
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        background: r.primary_reason === 'defect' ? 'color-mix(in srgb, var(--bad) 20%, var(--surface-1))' : undefined,
                        color: r.primary_reason === 'defect' ? 'var(--bad)' : undefined,
                      }}
                    >
                      {r.primary_reason}
                    </span>

                    {r.tags.map((t: string) => (
                      <span key={t} className="chip" style={{ fontSize: 10 }}>
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted small">{r.review_date}</span>
                    <button
                      onClick={() => handleRescore(r.review_id)}
                      disabled={rescoringId === r.review_id}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '1px 6px',
                        fontSize: 10,
                      }}
                      title="Re-run TypeSafe AI scoring"
                    >
                      {rescoringId === r.review_id ? 'Scoring...' : '⚡ Re-score'}
                    </button>
                  </div>
                </div>

                {r.title && (
                  <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    {r.title}
                  </h4>
                )}

                <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                  {isLong && !isExpanded ? `${r.body.slice(0, 220)}...` : r.body}
                </p>

                {isLong && (
                  <button
                    onClick={() => toggleExpand(r.review_id)}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      color: 'var(--accent)',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    {isExpanded ? '▴ Collapse text' : '▾ Read full review'}
                  </button>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>By: {r.author || 'Anonymous'}</span>
                    {r.verified_purchase && (
                      <span className="chip" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--ok) 20%, var(--surface-1))', color: 'var(--ok)' }}>
                        ✓ Verified Purchase
                      </span>
                    )}
                    <span>Model: <code>{r.model_used}</code></span>
                  </div>

                  {r.source_url && (
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, color: 'var(--accent)' }}
                    >
                      Source link ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
