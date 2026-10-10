import { useRef, useState } from 'react';
import type { SourceItemRef, SourceVersion } from '../../../shared/research';
import { NewsTranslation } from '../NewsTranslation';
import { absTime } from '../../format';
import { VERSION_LABEL } from './common';

/** Captured originals and current reading aid remain separate. Earlier missing snapshots are unknown. */
export function SourceReader({ source, versions, onQuote }: { source: SourceItemRef | null; versions: SourceVersion[]; onQuote?: (quote: string) => void }) {
  const original = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState(versions[0]?.id ?? 0);
  const [afterId, setAfterId] = useState(versions.at(-1)?.id ?? 0);
  const before = versions.find((v) => v.id === beforeId), after = versions.find((v) => v.id === afterId);
  const quote = () => {
    const selection = window.getSelection(); const text = selection?.toString().trim() ?? '';
    if (!text || !selection?.anchorNode || !selection.focusNode || !original.current?.contains(selection.anchorNode) || !original.current.contains(selection.focusNode) || !`${source?.title}\n${source?.text}`.includes(text) || text.length > 600) { setError('Select up to 600 characters from the current original headline or excerpt above.'); return; }
    setError(null); onQuote?.(text);
  };
  return <details className="source-reader small"><summary>Read source &amp; compare captured versions ({versions.length})</summary>
    {source ? <><div ref={original} className="original-source" dir="auto" lang={source.language ?? undefined}><h4>{source.title}</h4><p>{source.text || 'Headline only; no excerpt supplied.'}</p></div>{onQuote && <button onMouseDown={(e) => e.preventDefault()} onClick={quote}>Quote selected original text</button>}{error && <p role="alert">{error}</p>}{source.platform === 'web' && source.language === 'ar' && source.event_id && <NewsTranslation key={`${source.event_id}:${source.title}:${source.text}`} eventId={source.event_id} automatic={false} />}</> : <p>Current source unavailable. Captured versions below are retained.</p>}
    {versions.length > 1 ? <><div className="row2"><label>Before<select aria-label="Before source version" value={beforeId} onChange={(e) => setBeforeId(Number(e.target.value))}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.id} · {VERSION_LABEL[v.kind]} · {absTime(v.captured_at)}</option>)}</select></label><label>After<select aria-label="After source version" value={afterId} onChange={(e) => setAfterId(Number(e.target.value))}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.id} · {VERSION_LABEL[v.kind]} · {absTime(v.captured_at)}</option>)}</select></label></div><p className="muted">Changes shown below compare captured originals. Machine English above describes the current source only.</p><div className="version-compare">{[before, after].map((v, i) => <div key={i} className="version-snapshot"><b>{i ? 'After' : 'Before'} · v{v?.id} · {v ? VERSION_LABEL[v.kind] : 'unknown'}</b><h4 dir="auto">{v?.title ?? 'Title unavailable'}</h4><p dir="auto">{v?.excerpt ?? 'Excerpt unavailable'}</p><p>Published: {v?.published_at ? absTime(v.published_at) : 'unknown'} · Captured: {v ? absTime(v.captured_at) : 'unknown'}</p></div>)}</div><p>{before?.title === after?.title && before?.excerpt === after?.excerpt ? 'Captured title and excerpt are unchanged; inspect time/status metadata.' : 'Captured title or excerpt differs. Review both originals before changing an assessment.'}</p></> : <p className="muted">No earlier captured version to compare. Previous content is unknown.</p>}
  </details>;
}
