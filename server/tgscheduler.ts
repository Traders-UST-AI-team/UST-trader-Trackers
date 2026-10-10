// Telegram runs as a job of the background scheduler (server/scheduler.ts), decoupled from the main ingest cycle: each tick polls
// every enabled channel that is due (configured cadence, pilot target 5 min, per-channel jitter). Per-channel leases prevent
// overlapping runs of the same channel (also across processes sharing the database); per-channel breakers isolate a failing channel.
import { db } from './db.ts';
import { withLease } from './lease.ts';
import { configOf, jitterFrac } from './sourceconfig.ts';
import { recordRun } from './runlog.ts';
import { getBreaker, isOpen, recordFailure, recordSuccess } from './breaker.ts';
import { configuredChannels, pollChannel } from './sources/telegram.ts';
import { matchTelegramToEvents } from './telegram.ts';
import { registerJob } from './scheduler.ts';
import { afterCollection } from './research/hooks.ts';

let cycle: Promise<TgCycle> | null = null;
export const telegramBusy = () => cycle !== null;

export interface TgCycle { at: string; ran: { channel: string; ok: boolean; detail: string }[]; skipped: { channel: string; why: string }[] }

export function channelDueAt(channel: string): number | null {
  const r = db.prepare('SELECT last_attempt_at FROM tg_channels WHERE channel = ?').get(channel) as { last_attempt_at: string | null } | undefined;
  const last = r?.last_attempt_at ? Date.parse(r.last_attempt_at) : null;
  const iv = configOf('telegram')!.interval_min;
  return last === null ? null : last + iv * 60_000 * (1 + jitterFrac(`telegram:${channel}`));
}

export function runTelegramCycle(opts: { force?: boolean } = {}): Promise<TgCycle> {
  if (cycle) return cycle;
  cycle = (async () => {
    const out: TgCycle = { at: new Date().toISOString(), ran: [], skipped: [] };
    const cfg = configOf('telegram')!;
    let inserted = 0;
    for (const ch of configuredChannels()) {
      const due = channelDueAt(ch);
      if (!opts.force && due !== null && due > Date.now()) { out.skipped.push({ channel: ch, why: `not due until ${new Date(due).toISOString()}` }); continue; }
      const bid = `telegram:${ch}`;
      if (!opts.force && isOpen(bid)) { out.skipped.push({ channel: ch, why: `paused after ${getBreaker(bid).fails} consecutive failures until ${getBreaker(bid).open_until}` }); continue; }
      const r = await withLease(`tg:${ch}`, 10 * 60_000, () => pollChannel(ch, cfg.request_budget));
      if (r === null) { out.skipped.push({ channel: ch, why: 'another run of this channel is in progress' }); continue; }
      if (r.ok) {
        recordSuccess(bid); inserted += r.result.inserted;
        out.ran.push({ channel: ch, ok: true, detail: `${r.result.inserted} new / ${r.result.fetched} seen over ${r.result.pages} page(s) (latest ${r.result.pages_by_phase.latest}, gap ${r.result.pages_by_phase.gap}, history ${r.result.pages_by_phase.history}); ${r.result.stoppedBecause}` });
      } else {
        recordFailure(bid, cfg.interval_min, r.error);
        out.ran.push({ channel: ch, ok: false, detail: r.error });
      }
    }
    if (out.ran.length) {
      const failed = out.ran.filter((x) => !x.ok);
      const total = (db.prepare('SELECT COUNT(*) c FROM tg_posts').get() as { c: number }).c;
      // The source is FAILED only when every channel that ran failed; a partial failure is reported but other channels' data is current.
      recordRun('telegram', failed.length < out.ran.length, total, failed.length ? `${failed.length} of ${out.ran.length} channel(s) failed: ${failed.map((f) => `${f.channel} (${f.detail.slice(0, 60)})`).join('; ')}` : null, { manual: !!opts.force, partial: failed.length > 0 && failed.length < out.ran.length });
      if (inserted > 0) { try { matchTelegramToEvents(); } catch (e) { console.error('[telegram] match failed', e); } }
      afterCollection('telegram'); // edits to attached posts become new captured versions
    }
    return out;
  })().finally(() => { cycle = null; });
  return cycle;
}

registerJob({
  id: 'telegram', maxRunMs: 15 * 60_000,
  run: async ({ force }) => {
    const c = await runTelegramCycle({ force });
    return c.ran.length ? c.ran.map((r) => `${r.channel}: ${r.ok ? 'ok' : 'FAILED'}`).join(', ') : null;
  },
});

export const nextTelegramAttempt = (): string | null => {
  const dues = configuredChannels().map(channelDueAt).filter((x): x is number => x !== null);
  return dues.length ? new Date(Math.min(...dues)).toISOString() : null;
};
