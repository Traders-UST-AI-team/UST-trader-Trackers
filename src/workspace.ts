import { useState, type Dispatch, type SetStateAction } from 'react';

/** Local drafts are annotations, never provider records. Persist each edit for reload safety. */
export function useDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `war-tracker-workspace-v1:${key}`;
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(storageKey); return raw === null ? initial : JSON.parse(raw) as T; } catch { return initial; }
  });
  const update: Dispatch<SetStateAction<T>> = (next) => setValue((prev) => {
    const result = typeof next === 'function' ? (next as (v: T) => T)(prev) : next;
    try { localStorage.setItem(storageKey, JSON.stringify(result)); }
    catch { queueMicrotask(() => window.dispatchEvent(new Event('workspace-storage-error'))); }
    return result;
  });
  return [value, update];
}
export function localDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** A query generation owns its rows, cursor, loading and errors. Obsolete responses do not commit. */
export class RequestGeneration {
  private generation = 0;
  next() { return ++this.generation; }
  isCurrent(generation: number) { return generation === this.generation; }
}

export function validLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && localDateTime(date.toISOString()) === value;
}
