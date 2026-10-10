import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from './toast';
import { RequestGeneration } from './workspace';

/**
 * One interface for "read this resource, keyed by this version signal".
 *
 * Before this module the client had one named generation helper with a single adopter, about eight
 * hand-rolled copies of the same idea, and several views with no guard at all — so a slow response
 * could overwrite a newer one, and a failed load had no shared way to reach the user. Views now
 * declare what they read; this module owns the when, the staleness rule and the failure.
 *
 * The three states stay distinct, which is what callers need in order to avoid printing invented
 * values: `data === null` means not loaded yet, any real value means loaded, and `state === 'error'`
 * means the value on screen is not a statement about the world.
 */

export type ReadState = 'idle' | 'loading' | 'ready' | 'error';

export interface ReadSnapshot<T> {
  /** null until the first successful load. */
  data: T | null;
  state: ReadState;
  /** A message ready to render, or null. */
  error: string | null;
}

export type ReadEvent<T> = { type: 'start' } | { type: 'ready'; value: T } | { type: 'fail'; message: string };

export const initialRead = <T,>(): ReadSnapshot<T> => ({ data: null, state: 'idle', error: null });

/**
 * The read state machine, kept pure so its semantics can be tested without a DOM.
 *
 * Starting keeps the previous value on screen (stale-while-revalidate, the behaviour the rest of
 * this app relies on). Failing clears it: a value left behind after a failed load is indistinguish-
 * able from a fresh one, and that is exactly the confusion this seam exists to remove.
 */
export function reduceRead<T>(snapshot: ReadSnapshot<T>, event: ReadEvent<T>): ReadSnapshot<T> {
  switch (event.type) {
    case 'start':
      return { ...snapshot, state: 'loading' };
    case 'ready':
      return { data: event.value, state: 'ready', error: null };
    case 'fail':
      return { data: null, state: 'error', error: event.message };
  }
}

export interface Read<T> extends ReadSnapshot<T> {
  /** Re-read the resource (also usable as a retry action). */
  reload: () => void;
  /**
   * Adopt a value a write just returned, so a mutation needs neither a second round trip nor a
   * separate piece of state.
   */
  replace: (value: T) => void;
}

export interface ReadOptions {
  /** Named in the failure message, e.g. 'Coverage'. */
  label: string;
  /** Optional reads stay silent: nothing is toasted, the caller may render nothing at all. */
  quiet?: boolean;
}

/**
 * @param key    Re-reads whenever this changes. Must be a primitive or a memoised tuple: a fresh
 *               object or array each render would re-read forever.
 * @param load   The read itself. Recreated every render is fine; it is called through a ref.
 * @param opts   `label` for messages, `quiet` for reads the UI treats as optional.
 */
export function useResource<T>(key: unknown, load: () => Promise<T>, opts: ReadOptions): Read<T> {
  const [snapshot, setSnapshot] = useState<ReadSnapshot<T>>(initialRead<T>);
  const [token, setToken] = useState(0);
  const generation = useRef(new RequestGeneration());
  const loadRef = useRef(load);
  loadRef.current = load;
  const { label, quiet } = opts;

  useEffect(() => {
    const current = generation.current.next();
    setSnapshot((s) => reduceRead(s, { type: 'start' }));
    loadRef.current()
      .then((value) => {
        if (!generation.current.isCurrent(current)) return; // a newer read owns the screen
        setSnapshot((s) => reduceRead(s, { type: 'ready', value }));
      })
      .catch((e: Error) => {
        if (!generation.current.isCurrent(current)) return;
        setSnapshot((s) => reduceRead(s, { type: 'fail', message: `${label} could not be loaded: ${e.message}` }));
        if (!quiet) toast(`${label} could not be loaded.`, 'error');
      });
  }, [key, token, label, quiet]);

  const reload = useCallback(() => setToken((n) => n + 1), []);
  const replace = useCallback((value: T) => setSnapshot((s) => reduceRead(s, { type: 'ready', value })), []);

  return { ...snapshot, reload, replace };
}
