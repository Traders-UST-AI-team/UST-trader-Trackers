import { useEffect, useRef } from 'react';
import { VIEW_KEY_MAP, type View } from './views';

export interface ShortcutDef {
  key: string;
  label: string;
  description: string;
  category: 'Navigation' | 'Actions' | 'Help';
}

export const SHORTCUT_LIST: ShortcutDef[] = [
  { key: '1', label: '1', description: 'Monitor (items → contracts → price → save)', category: 'Navigation' },
  { key: '2', label: '2', description: 'Feed (all sources; Telegram analysis)', category: 'Navigation' },
  { key: '3', label: '3', description: 'Markets (pilot markets, large trades, watched wallets)', category: 'Navigation' },
  { key: '4', label: '4', description: 'Research (briefing, dossiers, hypotheses)', category: 'Navigation' },
  { key: '5', label: '5', description: 'Sources & alerts', category: 'Navigation' },
  { key: 'b', label: 'b', description: 'Open the change briefing', category: 'Navigation' },
  // Kept working for one release; documented so the table and the key map cannot drift apart.
  { key: '6', label: '6', description: 'Research (legacy alias for 4)', category: 'Navigation' },
  { key: '7', label: '7', description: 'Sources (legacy alias for 5)', category: 'Navigation' },
  { key: '/', label: '/', description: 'Focus search input', category: 'Actions' },
  { key: 'j', label: 'j', description: 'Next event in feed', category: 'Actions' },
  { key: 'k', label: 'k', description: 'Previous event in feed', category: 'Actions' },
  { key: 'r', label: 'r', description: 'Refresh live data', category: 'Actions' },
  { key: '?', label: '?', description: 'Toggle keyboard shortcuts help', category: 'Help' },
  { key: 'Escape', label: 'Esc', description: 'Close modals & blur search', category: 'Help' },
];

export { VIEW_KEY_MAP };

export function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export interface ShortcutHandlers {
  onViewChange?: (view: View) => void;
  onRefresh?: () => void;
  onNextItem?: () => void;
  onPrevItem?: () => void;
  onFocusSearch?: () => void;
  onBriefing?: () => void;
  onToggleHelp?: () => void;
  onEscape?: () => void;
}

export function handleShortcutKey(e: KeyboardEvent, handlers: ShortcutHandlers): boolean {
  const inInput = isInputElement(e.target);

  if (e.key === 'Escape') {
    if (inInput && e.target instanceof HTMLElement) {
      e.target.blur();
      return true;
    }
    if (handlers.onEscape) {
      handlers.onEscape();
      return true;
    }
    return false;
  }

  // When typing in text inputs, avoid capturing character shortcuts.
  if (inInput) return false;

  // Don't intercept modified keys (Ctrl/Cmd/Alt)
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  if (VIEW_KEY_MAP[e.key]) {
    handlers.onViewChange?.(VIEW_KEY_MAP[e.key]);
    e.preventDefault();
    return true;
  }

  if (e.key === '/') {
    e.preventDefault();
    handlers.onFocusSearch?.();
    return true;
  }

  const lower = e.key.toLowerCase();

  if (lower === 'j') {
    handlers.onNextItem?.();
    e.preventDefault();
    return true;
  }

  if (lower === 'k') {
    handlers.onPrevItem?.();
    e.preventDefault();
    return true;
  }

  if (lower === 'b') {
    handlers.onBriefing?.();
    e.preventDefault();
    return true;
  }

  if (lower === 'r') {
    handlers.onRefresh?.();
    e.preventDefault();
    return true;
  }

  if (e.key === '?') {
    handlers.onToggleHelp?.();
    e.preventDefault();
    return true;
  }

  return false;
}

export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      handleShortcutKey(e, handlersRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
