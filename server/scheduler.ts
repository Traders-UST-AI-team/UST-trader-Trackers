// One background scheduler for every job that runs outside the main ingest cycle (Telegram channels, Polymarket wallet jobs).
// A single one-minute tick asks each registered job whether it is due; each job decides that from its own persisted
// configuration (source_config) and runs under a lease, so a job never overlaps itself — also across processes sharing the DB.
// The main ingest cycle (server/ingest.ts) keeps its own timer; it does not poll anything registered here.
import { withLease } from './lease.ts';

export interface Job {
  id: string;
  /** Called every tick; returns quickly when nothing is due. `force` = a user-requested refresh (still budgeted and leased). */
  run: (opts: { force: boolean }) => Promise<string | null>;
  /** Upper bound on one run; the lease expires after this so a crashed process cannot block the job forever. */
  maxRunMs: number;
}

const jobs = new Map<string, Job>();
const running = new Set<string>();
export const registerJob = (j: Job) => { jobs.set(j.id, j); };
export const isJobRunning = (id: string) => running.has(id);
export const registeredJobs = () => [...jobs.keys()];

/** Run one job now (in-process de-duplicated, cross-process leased). Returns null when it was already running elsewhere. */
export async function runJob(id: string, force = false): Promise<string | null> {
  const j = jobs.get(id);
  if (!j || running.has(id)) return null;
  running.add(id);
  try { return await withLease(`job:${id}`, j.maxRunMs, () => j.run({ force })); }
  finally { running.delete(id); }
}

export const runAllJobs = (force = false) => Promise.allSettled([...jobs.keys()].map((id) => runJob(id, force)));

let timer: NodeJS.Timeout | null = null;
export function startScheduler(log = true) {
  if (timer) return;
  const tick = () => {
    for (const id of jobs.keys()) {
      runJob(id).then((detail) => { if (log && detail) console.log(`[${id}] ${detail}`); }).catch((e) => console.error(`[${id}] failed`, e));
    }
  };
  setTimeout(tick, 5_000).unref();
  timer = setInterval(tick, 60_000);
  timer.unref();
}
