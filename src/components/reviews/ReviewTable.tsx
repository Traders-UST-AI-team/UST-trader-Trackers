import { useEffect, useState } from 'react';
import type { EnrichedReview } from '../../../shared/review-types';
import { reviewsApi } from '../../api-reviews';
import { toast } from '../../toast';
import type { ReviewFilters } from './useReviewWorkspace';

const TONE_LABEL: Record<string, string> = { '-2': 'Very negative', '-1': 'Negative', '0': 'Neutral', '1': 'Positive', '2': 'Very positive' };
const REASON_LABEL: Record<string, string> = {
  defect: 'Defect', quality_decline: 'Quality decline', price: 'Price / value', ergonomics: 'Ergonomics', software: 'Software', praise: 'Praise', other: 'Other / shipping',
};
const PLATFORM_LABEL: Record<string, string> = { amazon: 'Amazon', bestbuy: 'Best Buy', reddit: 'Reddit' };

function toneClass(score: number | null): string {
  if (score == null) return 'unscored';
  return score <= -1 ? 'neg' : score >= 1 ? 'pos' : 'neu';
}

interface Props {
  reviews: EnrichedReview[] | null;
  total: number | null;
  loading: boolean;
  failed: boolean;
  filters: ReviewFilters;
  setFilters: (patch: Partial<ReviewFilters>) => void;
  canWrite: boolean;
  onChanged: () => void;
}

export function ReviewTable({ reviews, total, loading, failed, filters, setFilters, canWrite, onChanged }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rescoring, setRescoring] = useState<string | null>(null);
  // Typing filters the list after a pause, not on every keystroke.
  const [query, setQuery] = useState(filters.query);
  useEffect(() => { setQuery(filters.query); }, [filters.query]);
  useEffect(() => {
    if (query === filters.query) return;
    const t = setTimeout(() => setFilters({ query }), 300);
    return () => clearTimeout(t);
  }, [query, filters.query, setFilters]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rescore = async (id: string) => {
    setRescoring(id);
    try {
      await reviewsApi.scoreSingle({ review_id: id });
      toast('Re-scored.', 'success');
      onChanged();
    } catch (e) {
      toast(`Re-score failed: ${(e as Error).message}`, 'error');
    } finally {
      setRescoring(null);
    }
  };

  return (
    <section className="rv-reviews">
      <div className="rv-filters">
        <input type="search" placeholder="Search review text, title or author" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search reviews" />
        <select value={filters.tone} onChange={(e) => setFilters({ tone: e.target.value })} aria-label="Tone">
          <option value="all">Any tone</option>
          <option value="negative">Negative (−2, −1)</option>
          <option value="-2">Very negative (−2)</option>
          <option value="neutral">Neutral (0)</option>
          <option value="positive">Positive (+1, +2)</option>
        </select>
        <select value={filters.reason} onChange={(e) => setFilters({ reason: e.target.value })} aria-label="Reason">
          <option value="all">Any reason</option>
          {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.platform} onChange={(e) => setFilters({ platform: e.target.value })} aria-label="Platform">
          <option value="all">All platforms</option>
          {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="rv-check"><input type="checkbox" checked={filters.verifiedOnly} onChange={(e) => setFilters({ verifiedOnly: e.target.checked })} /> Verified only</label>
        <span className="rv-muted rv-small rv-count">{loading ? 'Loading…' : total != null ? `${total} match${total === 1 ? '' : 'es'}` : ''}</span>
      </div>

      {failed ? (
        <p className="rv-empty" role="alert">The review list could not be loaded, so this says nothing about what exists.</p>
      ) : reviews === null ? (
        <p className="rv-empty">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="rv-empty">No reviews match these filters.</p>
      ) : (
        <ul className="rv-review-list">
          {reviews.map((r) => {
            const long = r.body.length > 280;
            const open = expanded.has(r.review_id);
            return (
              <li key={r.review_id} className={`rv-review ${toneClass(r.tone_score)}`}>
                <div className="rv-review-meta">
                  <span className={`rv-tone ${toneClass(r.tone_score)}`} title="Tone, −2 to +2">
                    {r.tone_score == null ? 'Unscored' : `${r.tone_score > 0 ? '+' : ''}${r.tone_score} ${TONE_LABEL[String(r.tone_score)] ?? ''}`}
                  </span>
                  {r.primary_reason && <span className="chip">{REASON_LABEL[r.primary_reason] ?? r.primary_reason}</span>}
                  {r.is_product_related === false && <span className="chip warn" title="Seller, shipping or packaging — excluded from tone">seller / shipping</span>}
                  {r.is_vine && <span className="chip warn" title="Amazon Vine free-product review — excluded from tone">Vine</span>}
                  {r.provenance !== 'captured' && <span className="chip" title="Bundled demo row — not evidence">demo</span>}
                  <span className="rv-spacer" />
                  <span className="rv-muted rv-small">{PLATFORM_LABEL[r.platform] ?? r.platform} · {r.review_date}{r.star_rating != null ? ` · ${'★'.repeat(Math.round(r.star_rating))}${'☆'.repeat(Math.max(0, 5 - Math.round(r.star_rating)))}` : ''}</span>
                </div>
                {r.title && <h4>{r.title}</h4>}
                <p>{long && !open ? `${r.body.slice(0, 280)}…` : r.body}</p>
                <div className="rv-review-foot rv-small rv-muted">
                  <span>{r.author || 'Anonymous'}{r.verified_purchase ? ' · verified purchase' : ''}</span>
                  {r.tags.length > 0 && <span>{r.tags.map((t) => `#${t}`).join(' ')}</span>}
                  <span className="rv-spacer" />
                  {long && <button className="rv-link" onClick={() => toggle(r.review_id)}>{open ? 'Show less' : 'Read all'}</button>}
                  {r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer">Source ↗</a>}
                  {canWrite && <button className="rv-link" disabled={rescoring === r.review_id} onClick={() => void rescore(r.review_id)} title={`Scored by ${r.model_used ?? 'nothing yet'}`}>{rescoring === r.review_id ? 'Scoring…' : 'Re-score'}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {reviews && total != null && total > reviews.length && <p className="rv-muted rv-small">Showing the newest {reviews.length} of {total}. Narrow the filters to see others.</p>}
    </section>
  );
}
