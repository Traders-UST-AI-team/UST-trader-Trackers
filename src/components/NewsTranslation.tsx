import { useEffect, useRef, useState } from 'react';
import type { NewsTranslation as Translation } from '../../shared/translation';
import { api } from '../api';

/** Only public news IDs reach translation; cached results do not consume the provider budget. */
export function NewsTranslation({ eventId, automatic = true, compact = false }: { eventId: string; automatic?: boolean; compact?: boolean }) {
  const [value, setValue] = useState<Translation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const currentId = useRef(eventId);
  const load = async () => {
    const generation = ++request.current; setLoading(true); setError(null);
    try { const result = await api.translation(eventId); if (request.current === generation) setValue(result); }
    catch (e) { if (request.current === generation) setError((e as Error).message); }
    finally { if (request.current === generation) setLoading(false); }
  };
  useEffect(() => {
    const generation = ++request.current; if (currentId.current !== eventId) setValue(null); currentId.current = eventId; setError(null); setLoading(true);
    (async () => {
      try {
        const cached = await api.cachedTranslation(eventId);
        if (generation !== request.current) return;
        const result = cached ?? (automatic ? await api.translation(eventId) : null);
        if (generation === request.current && result) setValue(result);
      } catch (e) { if (generation === request.current) setError((e as Error).message); }
      finally { if (generation === request.current) setLoading(false); }
    })();
    return () => { ++request.current; };
  }, [eventId, automatic]);
  return <div className="translation small" lang="en" dir="ltr" aria-live="polite">
    <b>English translation</b> <span className="muted">· machine translated · MyMemory</span>
    {value ? <><p><b>{value.title}</b></p>{!compact && value.excerpt && <p>{value.excerpt}</p>}<p className="muted">Reading aid; check the original for exact wording and attribution.</p></> : loading ? <p>Loading English reading aid…</p> : <><p className="muted">{error ?? 'Translate the public headline and excerpt into English.'}</p><button className="linkbtn" onClick={load} disabled={loading}>{error ? 'Retry translation' : 'Translate to English'}</button></>}
  </div>;
}
