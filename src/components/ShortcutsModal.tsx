import { useEffect, useRef } from 'react';
import { SHORTCUT_LIST, type ShortcutDef } from '../shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus();

    const handleOutside = (e: PointerEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      prevFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const categories: Array<ShortcutDef['category']> = ['Navigation', 'Actions', 'Help'];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div className="shortcuts-modal" ref={dialogRef}>
        <div className="shortcuts-header">
          <h3 id="shortcuts-title">Keyboard Shortcuts</h3>
          <button
            ref={closeBtnRef}
            className="shortcuts-close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts modal"
          >
            ×
          </button>
        </div>
        <p className="muted small shortcuts-intro">
          Speed up your workflow across markets, events, and research with analyst hotkeys.
        </p>

        <div className="shortcuts-body">
          {categories.map((cat) => {
            const list = SHORTCUT_LIST.filter((s) => s.category === cat);
            return (
              <div key={cat} className="shortcuts-section">
                <h4>{cat}</h4>
                <div className="shortcuts-grid">
                  {list.map((s) => (
                    <div key={s.key} className="shortcut-row">
                      <kbd className="kbd-key">{s.label}</kbd>
                      <span className="shortcut-desc">{s.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="shortcuts-footer">
          <span className="muted small">Press <kbd className="kbd-key inline">Esc</kbd> or click outside to dismiss</span>
          <button className="btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
