// Lightweight reactive toast notification store using useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export type ToastType = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: string;
  text: string;
  type: ToastType;
  createdAt: number;
  durationMs: number;
  remainingMs: number;
  pausedAt?: number;
}

const MAX_TOASTS = 5;
let nextId = 1;
let items: ToastItem[] = [];
const subscribers = new Set<() => void>();
const timerMap = new Map<string, any>();

function emit() {
  for (const sub of subscribers) {
    sub();
  }
}

function startTimer(id: string, durationMs: number) {
  if (durationMs > 0 && typeof setTimeout !== 'undefined') {
    const timer = setTimeout(() => {
      dismissToast(id);
    }, durationMs);
    timerMap.set(id, timer);
  }
}

export function toast(text: string, type: ToastType = 'info', durationMs = 3500): string {
  // Deduplicate if identical toast is already active: refresh its timer rather than spamming
  const existingIndex = items.findIndex((t) => t.text === text && t.type === type);
  if (existingIndex !== -1) {
    const existing = items[existingIndex];
    const oldTimer = timerMap.get(existing.id);
    if (oldTimer) {
      clearTimeout(oldTimer);
      timerMap.delete(existing.id);
    }
    existing.durationMs = durationMs;
    existing.remainingMs = durationMs;
    existing.pausedAt = undefined;
    startTimer(existing.id, durationMs);
    emit();
    return existing.id;
  }

  // Cap max visible toasts to prevent overflowing the viewport
  if (items.length >= MAX_TOASTS) {
    const excess = items.length - MAX_TOASTS + 1;
    for (let i = 0; i < excess; i++) {
      const old = items[i];
      const t = timerMap.get(old.id);
      if (t) {
        clearTimeout(t);
        timerMap.delete(old.id);
      }
    }
    items = items.slice(excess);
  }

  const id = `toast_${Date.now()}_${nextId++}`;
  const item: ToastItem = {
    id,
    text,
    type,
    createdAt: Date.now(),
    durationMs,
    remainingMs: durationMs,
  };
  items = [...items, item];
  emit();

  startTimer(id, durationMs);

  return id;
}

export function pauseToast(id: string): void {
  const item = items.find((t) => t.id === id);
  if (!item || item.pausedAt) return;

  const timer = timerMap.get(id);
  if (timer) {
    clearTimeout(timer);
    timerMap.delete(id);
  }

  const elapsed = Date.now() - item.createdAt;
  item.remainingMs = Math.max(0, item.durationMs - elapsed);
  item.pausedAt = Date.now();
}

export function resumeToast(id: string): void {
  const item = items.find((t) => t.id === id);
  if (!item || !item.pausedAt) return;

  item.pausedAt = undefined;
  if (item.remainingMs > 0) {
    item.createdAt = Date.now() - (item.durationMs - item.remainingMs);
    startTimer(id, item.remainingMs);
  } else {
    dismissToast(id);
  }
}

export function pauseAllToasts(): void {
  for (const item of items) {
    pauseToast(item.id);
  }
}

export function resumeAllToasts(): void {
  for (const item of items) {
    resumeToast(item.id);
  }
}

export function dismissToast(id: string): void {
  const existingTimer = timerMap.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    timerMap.delete(id);
  }
  items = items.filter((t) => t.id !== id);
  emit();
}

export function clearToasts(): void {
  for (const timer of timerMap.values()) {
    clearTimeout(timer);
  }
  timerMap.clear();
  items = [];
  emit();
}

export function getToasts(): ToastItem[] {
  return items;
}

export function subscribeToasts(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribeToasts, getToasts, () => []);
}
