// Persisted leases: at most one holder per named job across processes sharing this database (e.g. a second `npm run dev`
// against the same file). In-process overlap is prevented by the same mechanism, so a job can never run twice at once.
import { randomBytes } from 'node:crypto';
import { db } from './db.ts';

export const HOLDER = `${process.pid}-${randomBytes(4).toString('hex')}`;

/** True unless the holder is a process on this machine that no longer exists (holders are "<pid>-<random>"). */
export function holderAlive(holder: string): boolean {
  const pid = Number(holder.split('-')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return true; // not ours to judge
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/** Returns true when this process now holds `name` until now + ttl. A lease held by another live holder is honoured until it
 *  expires; one left behind by a process that died (e.g. a dev-server restart mid-run) is taken over at once. */
export function acquireLease(name: string, ttlMs: number, holder = HOLDER, now = Date.now()): boolean {
  const cur = db.prepare('SELECT holder, expires_at FROM leases WHERE name = ?').get(name) as { holder: string; expires_at: number } | undefined;
  const orphaned = !!cur && cur.holder !== holder && cur.expires_at > now && !holderAlive(cur.holder);
  const r = db.prepare(`INSERT INTO leases (name, holder, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
    WHERE leases.expires_at <= ? OR leases.holder = excluded.holder OR leases.holder = ?`).run(name, holder, now + ttlMs, now, orphaned ? cur!.holder : '');
  return Number(r.changes) > 0;
}

/** Release everything this process holds (called on shutdown). */
export function releaseAllLeases(holder = HOLDER): void {
  db.prepare('DELETE FROM leases WHERE holder = ?').run(holder);
}

export function releaseLease(name: string, holder = HOLDER): void {
  db.prepare('DELETE FROM leases WHERE name = ? AND holder = ?').run(name, holder);
}

export function leaseHolder(name: string, now = Date.now()): string | null {
  const r = db.prepare('SELECT holder, expires_at FROM leases WHERE name = ?').get(name) as { holder: string; expires_at: number } | undefined;
  return r && r.expires_at > now ? r.holder : null;
}

/** Run fn under the lease, or return null without running it when someone else holds it. */
export async function withLease<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  if (!acquireLease(name, ttlMs)) return null;
  try { return await fn(); } finally { releaseLease(name); }
}
