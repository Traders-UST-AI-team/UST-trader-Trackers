import { dismissToast, pauseAllToasts, resumeAllToasts, useToasts, type ToastType } from '../toast';

const ICONS: Record<ToastType, string> = {
  success: '✓',
  warn: '!',
  error: '✕',
  info: 'ℹ',
};

export function ToastContainer() {
  const items = useToasts();

  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      onMouseEnter={pauseAllToasts}
      onMouseLeave={resumeAllToasts}
    >
      {items.map((t) => (
        <div key={t.id} className={`toast-item toast-${t.type}`} role="status">
          <span className="toast-icon" aria-hidden>{ICONS[t.type]}</span>
          <span className="toast-message">{t.text}</span>
          <button
            className="toast-close"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
