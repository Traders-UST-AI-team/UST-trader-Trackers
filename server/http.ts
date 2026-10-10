// Polite HTTP client: per-host throttle, timeout, exponential backoff with jitter, Retry-After support, per-run request budgets.
import { AsyncLocalStorage } from 'node:async_hooks';
const UA = 'WarTrackerDemo/0.1 (local research dashboard; contact: local-user)';
const lastHit = new Map<string, number>();
const MIN_GAP_MS: Record<string, number> = { default: 400, 't.me': 1500, 'opensky-network.org': 800, 'clob.polymarket.com': 250, 'gamma-api.polymarket.com': 300, 'data-api.polymarket.com': 300 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, public url: string, msg?: string) {
    super(msg ?? `HTTP ${status} for ${url}`);
  }
}

/** A per-source request budget for one collection run. Every attempt (including retries) counts; exceeding it stops the run. */
export class BudgetExceeded extends Error {
  constructor(public sourceId: string, public budget: number) { super(`request budget of ${budget} per run exhausted for ${sourceId}`); }
}
interface Budget { sourceId: string; budget: number; used: number; exhausted: boolean }
const budgetStore = new AsyncLocalStorage<Budget>();
export async function withBudget<T>(sourceId: string, budget: number, fn: () => Promise<T>): Promise<{ value: T; used: number; exhausted: boolean }> {
  const b: Budget = { sourceId, budget, used: 0, exhausted: false };
  try { const value = await budgetStore.run(b, fn); return { value, used: b.used, exhausted: b.exhausted }; }
  catch (e) { (e as { budgetUsed?: number }).budgetUsed = b.used; throw e; }
}
export const budgetUsed = (): number | null => budgetStore.getStore()?.used ?? null;
export const budgetLeft = (): number | null => { const b = budgetStore.getStore(); return b ? b.budget - b.used : null; };

export interface FetchOpts {
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Transport seam: tests supply a fake instead of reaching the network. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { retries = 3, timeoutMs = 15000, headers = {}, fetchImpl } = opts;
  const doFetch = fetchImpl ?? fetch;
  const host = new URL(url).host;
  const gap = process.env.HTTP_MIN_GAP_MS !== undefined ? Number(process.env.HTTP_MIN_GAP_MS) : MIN_GAP_MS[host] ?? MIN_GAP_MS.default; // env override exists for fault-injection tests
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const bud = budgetStore.getStore();
    if (bud) { if (bud.used >= bud.budget) { bud.exhausted = true; throw new BudgetExceeded(bud.sourceId, bud.budget); } bud.used++; }
    const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await doFetch(url, { headers: { 'user-agent': UA, accept: '*/*', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.text();
      // 4xx other than 408/429 are not retryable: do not hammer or try to evade blocks.
      if (res.status !== 429 && res.status !== 408 && res.status < 500) throw new HttpError(res.status, url);
      const ra = Number(res.headers.get('retry-after'));
      lastErr = new HttpError(res.status, url);
      if (attempt < retries) await sleep(ra > 0 ? Math.min(ra, 30) * 1000 : backoff(attempt));
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(backoff(attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, opts?: FetchOpts): Promise<T> {
  return JSON.parse(await fetchText(url, { headers: { accept: 'application/json' }, ...opts })) as T;
}

const backoff = (attempt: number) => { const base = Number(process.env.HTTP_BACKOFF_MS ?? 600); return Math.round(base * 2 ** attempt + Math.random() * Math.min(400, base)); };
