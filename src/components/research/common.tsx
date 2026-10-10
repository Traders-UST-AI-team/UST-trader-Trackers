import type { SourceItemRef, SourceVersion } from '../../../shared/research';
import { absTime, absTimeP } from '../../format';

export const VERSION_LABEL: Record<string, string> = {
  first_capture: 'first captured', publisher_revision: 'publisher revision', content_changed: 'changed (no revision declared)', unavailable: 'unavailable here (not a confirmed retraction)', restored: 'available again',
};

const readableRef = (ref: string) => { try { return decodeURIComponent(ref); } catch { return ref; } };
/** A feed key is platform:source:external-id, and the id is often a whole article URL; the source is enough on screen. */
const shortRef = (ref: string) => { const [platform, source] = ref.split(':'); return source ? `${source}${platform === 'web' ? '' : ` (${platform})`}` : ref.slice(0, 40); };

/** One line identifying a source item with its separate times. */
export function SourceLine({ s, fallback }: { s: SourceItemRef | null; fallback?: string }) {
  if (!s) return <span className="chip warn" title={`The original record is no longer in this tracker. Captured versions are kept.${fallback ? `\n${readableRef(fallback)}` : ''}`}>source unavailable{fallback ? ` · ${shortRef(fallback)}` : ''}</span>;
  return (
    <span className="srcline small">
      <b>{s.source_name}</b>{s.viewpoint_label && <span className="chip warn" title={s.viewpoint_label}>viewpoint-labelled</span>}
      <span className="muted" title="Publication time as stated by the source">published {absTimeP(s.published_at, s.time_precision)}</span>
      <span className="muted" title="When this tracker first collected it">· collected {absTime(s.collected_at)}</span>
      <a href={s.url} target="_blank" rel="noreferrer">original ↗</a>
    </span>
  );
}

export function Versions({ versions }: { versions: SourceVersion[] }) {
  if (!versions.length) return null;
  return (
    <span className="versions small">
      {versions.map((v) => <span key={v.id} className={`chip ${v.kind === 'first_capture' ? '' : 'warn'}`} title={`captured ${absTime(v.captured_at)}${v.excerpt ? `\n${v.excerpt.slice(0, 200)}` : ''}`}>v{v.id} {VERSION_LABEL[v.kind] ?? v.kind}</span>)}
    </span>
  );
}

export function ErrorChip({ e }: { e: string | null }) { return e ? <span className="chip warn" role="alert">{e}</span> : null; }

/** Run an API call and route its error message to a setter (keeps forms small). */
export async function attempt<T>(fn: () => Promise<T>, setErr: (e: string | null) => void): Promise<T | null> {
  try { const r = await fn(); setErr(null); return r; } catch (e) { setErr((e as Error).message); return null; }
}
