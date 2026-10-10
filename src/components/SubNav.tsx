import type { View } from './StatusBar';

/** Second-level tabs for destinations that hold two existing pages (Feed ⇄ Telegram analysis, Sources ⇄ Alerts). */
export function SubNav({ items, view, setView }: { items: { id: View; label: string; badge?: number }[]; view: View; setView: (v: View) => void }) {
  return (
    <div className="subnav tabs" role="tablist" aria-label="Section">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={view === i.id} className={view === i.id ? 'on' : ''} onClick={() => setView(i.id)}>
          {i.label}{i.badge ? <span className="badge">{i.badge > 99 ? '99+' : i.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
