import { useRef, useState, type ButtonHTMLAttributes } from 'react';

/** Keep one mutation in flight per control, including before React has rendered the disabled state. */
export function ActionButton({ onClick, disabled, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  return <button {...props} disabled={disabled || busy} aria-busy={busy || undefined} onClick={async (e) => {
    if (locked.current || !onClick) return;
    locked.current = true;
    try {
      const result: unknown = onClick(e);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') { setBusy(true); await result; }
    } finally { locked.current = false; setBusy(false); }
  }}>{busy ? 'Saving…' : children}</button>;
}
