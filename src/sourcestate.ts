// One plain state per source, so the Sources page can lead with what needs attention.
// Collection (did the fetch run?) and data age (how old is the newest observation?) stay separate
// underneath; this only decides which single word a reader sees first.
import type { SourceHealth } from '../shared/types';

export type SourceState = 'failing' | 'old' | 'behind' | 'pending' | 'off' | 'ok';

export const STATE_LABEL: Record<SourceState, string> = {
  failing: 'Failing', old: 'Data old', behind: 'Behind schedule', pending: 'Not run yet', off: 'Not connected', ok: 'OK',
};

/** Most severe first: a failing fetch outranks old data, which outranks a late but working collector. */
export const STATE_ORDER: SourceState[] = ['failing', 'old', 'behind', 'pending', 'off', 'ok'];

export function sourceState(h: Pick<SourceHealth, 'status' | 'stale' | 'breaker_open_until' | 'freshness'>): SourceState {
  if (h.status === 'blocked') return 'off';
  if (h.status === 'error' || h.breaker_open_until) return 'failing';
  if (h.status === 'never') return 'pending';
  if (h.freshness.assessment === 'old') return 'old';
  if (h.stale) return 'behind';
  return 'ok';
}

/** Where a reader would notice the source going quiet. */
export const AFFECTS: Record<string, string> = {
  prediction_market: 'contract prices in Markets and Monitor', wallet: 'large trades and wallets in Markets', sensor: 'pinned sensors and the briefing',
  social: 'Telegram items in Feed', official: 'official items in Monitor and Feed', maritime: 'maritime items in Monitor and Feed',
  news: 'news in Monitor and Feed', analysis: 'analysis items in Feed',
};

/** One sentence on why a source is in its state. */
export function reasonFor(h: SourceHealth, state: SourceState): string {
  switch (state) {
    case 'failing': return h.breaker_open_until
      ? `${h.consecutive_failures} failed attempts in a row; automatic retries paused${h.error ? ` · ${h.error}` : ''}`
      : `last attempt failed${h.error ? ` · ${h.error}` : ''}`;
    case 'old': return 'collection runs, but the newest data is older than this provider normally publishes';
    case 'behind': return `no successful check within its ${h.expected_interval_min}-minute cycle`;
    case 'pending': return 'waiting for its first collection';
    case 'off': return h.error ?? 'not connected';
    default: return '';
  }
}
