import { useCallback, useEffect, useState } from 'react';
import type { ReviewSession } from '../../../shared/review-types';
import { reviewsApi } from '../../api-reviews';
import { teamCode } from '../../http';

const NAME_KEY = 'tracker-member-name';

/** The name a teammate signs additions with; remembered in this browser only. */
export const memberName = {
  get(): string {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
  },
  set(name: string) {
    try { localStorage.setItem(NAME_KEY, name.trim().slice(0, 60)); } catch { /* not remembered */ }
  },
};

export interface TeamAccess {
  /** null until the server has answered. */
  session: ReviewSession | null;
  /** True when this browser may change the watchlist. */
  canWrite: boolean;
  /** True when the deployment needs a team code for changes at all. */
  writeProtected: boolean;
  /** Checks a code with the server and keeps it only if accepted. */
  unlock: (code: string) => Promise<boolean>;
  lock: () => void;
}

/**
 * Whether this browser can edit. On a local install there is no code and the answer is always yes;
 * on a shared deployment the code is checked once, kept in this browser, and sent with every write.
 */
export function useTeamAccess(): TeamAccess {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const changed = () => setVersion((v) => v + 1);
    window.addEventListener('team-code-changed', changed);
    return () => window.removeEventListener('team-code-changed', changed);
  }, []);

  useEffect(() => {
    let live = true;
    reviewsApi.session()
      .then((s) => { if (live) setSession(s); })
      // An older server without the endpoint has no write protection.
      .catch(() => { if (live) setSession({ write_protected: false, can_write: true }); });
    return () => { live = false; };
  }, [version]);

  const unlock = useCallback(async (code: string) => {
    const response = await fetch('/api/session', { headers: { 'x-team-token': code } });
    const answer = (await response.json().catch(() => null)) as ReviewSession | null;
    if (!answer?.can_write) return false;
    teamCode.set(code);
    return true;
  }, []);

  const lock = useCallback(() => teamCode.set(null), []);

  return {
    session,
    canWrite: session?.can_write ?? false,
    writeProtected: session?.write_protected ?? false,
    unlock,
    lock,
  };
}
