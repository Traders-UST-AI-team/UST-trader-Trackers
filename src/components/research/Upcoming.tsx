import { ActionButton } from '../ActionButton';
import { useDraft } from '../../workspace';
import { useMemo, useState } from 'react';
import type { CalendarEntryView } from '../../../shared/research';
import type { Market } from '../../../shared/types';
import { pct } from '../../format';
import { api } from '../../api';
import { absTime } from '../../format';
import { ErrorChip, attempt } from './common';
import { useResource } from '../../read';

const ZONE = 'Asia/Hong_Kong';
const when = (e: CalendarEntryView) => (e.start_utc
  ? new Date(e.start_utc).toLocaleString(undefined, { timeZone: ZONE, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
  : `${e.date_local} — whole day (${e.tz}); no time of day given`);

const dateOf = (e: CalendarEntryView) =>
  e.date_local ?? (e.start_utc ? new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(e.start_utc)) : '');

function CalendarEdit({ entry, onChanged }: { entry: CalendarEntryView; onChanged: () => void }) {
  const parts = entry.start_utc ? Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: entry.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(entry.start_utc)).map((p) => [p.type, p.value])) : null;
  const [f, setF] = useDraft(`calendar-${entry.id}-edit`, { expected_version: entry.version, date: entry.date_local ?? (parts ? `${parts.year}-${parts.month}-${parts.day}` : ''), time: parts ? `${parts.hour}:${parts.minute}` : '', status: entry.status, basis: '' });
  const [err, setErr] = useState<string | null>(null);
  return <details className="small"><summary>Edit known event</summary><div className="hypoform">
    <label>Date ({entry.tz})<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
    <label>Time (leave empty for whole day)<input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
    <select aria-label="Known event status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>{['scheduled', 'revised', 'postponed', 'cancelled', 'unknown', 'closed'].map((v) => <option key={v}>{v}</option>)}</select>
    <input placeholder="Why did this entry change? Include source (required)" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} />
    <ActionButton disabled={!f.date || !f.basis.trim()} onClick={() => attempt(() => api.updateCalendarEntry(entry.id, { ...f, time: f.time || null }), setErr).then((r) => { if (r) { setF({ ...f, basis: '', expected_version: r.version }); onChanged(); } })}>Save event change</ActionButton><ErrorChip e={err} />
  </div></details>;
}

const dayLabel = (date: string, today: string) => {
  const d = new Date(`${date}T00:00:00Z`), t = new Date(`${today}T00:00:00Z`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400_000);
  const name = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return diff === 0 ? `Today · ${name}` : diff === 1 ? `Tomorrow · ${name}` : name;
};
const timeOf = (e: CalendarEntryView) => (e.start_utc ? new Date(e.start_utc).toLocaleTimeString(undefined, { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }) : 'all day');

/** One agenda line: a manual event, a single contract, or several contracts of one venue event that end on the same day. */
function AgendaRow({ entries, title, markets, onOpenMarket, onChanged }: { entries: CalendarEntryView[]; title: string; markets: ReadonlyMap<string, Market>; onOpenMarket: (id: string) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const e = entries[0];
  const many = entries.length > 1;
  const m = !many && e.condition_id ? markets.get(e.condition_id) : undefined;
  const flagged = entries.filter((x) => x.status !== 'scheduled');
  return (
    <li className={`ag-row ${open ? 'open' : ''}`}>
      <button className="ag-head" aria-expanded={open} onClick={() => (many || e.kind === 'manual' || !e.condition_id ? setOpen(!open) : onOpenMarket(e.condition_id))}>
        <time>{timeOf(e)}</time>
        <span className="t">{title}{many && <span className="muted"> · {entries.length} contracts</span>}</span>
        <span className="v">{e.kind === 'manual' ? 'event' : e.venue === 'kalshi' ? 'Kalshi' : 'Polymarket'}</span>
        <span className="p">{m ? pct(m.price) : ''}</span>
        {flagged.length > 0 && <span className="chip warn">{flagged[0].status}</span>}
      </button>
      {open && <div className="ag-body">
        {many && <ul>{entries.map((x) => {
          const mx = x.condition_id ? markets.get(x.condition_id) : undefined;
          return <li key={x.id}><button className="linkbtn" onClick={() => x.condition_id && onOpenMarket(x.condition_id)}>{x.title}</button><span className="muted">{mx ? pct(mx.price) : ''}</span></li>;
        })}</ul>}
        {!many && <p className="small muted">{e.basis}{e.source_url && <> · <a href={e.source_url} target="_blank" rel="noreferrer">source ↗</a></>}</p>}
        <p className="small muted">{when(e)} · resolution time is separate and may be later.</p>
        {entries.flatMap((x) => x.revisions).length > 0 && <ul className="small muted">{entries.flatMap((x) => x.revisions.map((r, i) => <li key={`${x.id}${i}`}>{absTime(r.at)}: {r.field} {r.before ?? '—'} → {r.after ?? '—'} ({r.basis})</li>))}</ul>}
        {!many && e.kind === 'manual' && <CalendarEdit key={e.id} entry={e} onChanged={onChanged} />}
      </div>}
    </li>
  );
}

export function Upcoming({ versionKey, onOpenMarket, markets = [] }: { versionKey: string; onOpenMarket: (id: string) => void; markets?: Market[] }) {
  const [f, setF] = useDraft('new-calendar-entry', { title: '', date: '', time: '', tz: ZONE, source_url: '', notes: '' });
  // A write failing and a read failing are different events; they used to share one variable.
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [q, setQ] = useDraft('calendar-search', '');
  const [kind, setKind] = useDraft('calendar-kind', 'all');
  const [status, setStatus] = useDraft('calendar-status', 'all');
  const [from, setFrom] = useDraft('calendar-from', '');
  const [to, setTo] = useDraft('calendar-to', '');
  const [viewMode, setViewMode] = useDraft<'list' | 'grid'>('calendar-view-mode-v2', 'list');
  const [adding, setAdding] = useState(false);
  const marketById = useMemo(() => new Map(markets.map((m) => [m.condition_id, m])), [markets]);

  const todayStr = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);
  const defaultYearMonth = todayStr.slice(0, 7);
  const [selectedYearMonth, setSelectedYearMonth] = useDraft('calendar-grid-month', defaultYearMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [curYear, curMonth] = useMemo(() => {
    const ym = selectedYearMonth || defaultYearMonth;
    const parts = ym.split('-').map(Number);
    return [parts[0] || 2026, parts[1] || 10];
  }, [selectedYearMonth, defaultYearMonth]);

  const monthLabel = useMemo(() => {
    const dt = new Date(Date.UTC(curYear, curMonth - 1, 1));
    return dt.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [curYear, curMonth]);

  const changeMonth = (newYm: string) => {
    setSelectedYearMonth(newYm);
    if (selectedDate && !selectedDate.startsWith(newYm)) {
      setSelectedDate(null);
    }
  };

  const prevMonth = () => {
    let y = curYear;
    let m = curMonth - 1;
    if (m < 1) { y--; m = 12; }
    changeMonth(`${y}-${String(m).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    let y = curYear;
    let m = curMonth + 1;
    if (m > 12) { y++; m = 1; }
    changeMonth(`${y}-${String(m).padStart(2, '0')}`);
  };

  const goToday = () => {
    changeMonth(defaultYearMonth);
    setSelectedDate(todayStr);
  };

  const clearFilters = () => {
    setQ('');
    setKind('all');
    setStatus('all');
    setFrom('');
    setTo('');
  };

  // Compute the calendar query range to load matching events dynamically.
  // When in grid view, fetch ±3 months around the viewed month (~180 days, within 400d limit).
  const queryWindow = useMemo(() => {
    if (from && to) {
      const fT = Date.parse(`${from}T00:00:00Z`);
      const tT = Date.parse(`${to}T23:59:59Z`);
      if (Number.isFinite(fT) && Number.isFinite(tT) && tT > fT) {
        const clampedT = Math.min(tT, fT + 365 * 86400e3);
        return { from: new Date(fT).toISOString(), to: new Date(clampedT).toISOString() };
      }
    }
    if (from) {
      const fT = Date.parse(`${from}T00:00:00Z`);
      if (Number.isFinite(fT)) {
        return { from: new Date(fT).toISOString(), to: new Date(fT + 180 * 86400e3).toISOString() };
      }
    }
    if (to) {
      const tT = Date.parse(`${to}T23:59:59Z`);
      if (Number.isFinite(tT)) {
        return { from: new Date(tT - 180 * 86400e3).toISOString(), to: new Date(tT).toISOString() };
      }
    }
    if (viewMode === 'list') {
      // The agenda looks forward: today and the next 30 days, unless a range is set.
      const start = Date.parse(`${todayStr}T00:00:00Z`) - 86400_000;
      return { from: new Date(start).toISOString(), to: new Date(start + 32 * 86400e3).toISOString() };
    }
    if (viewMode === 'grid') {
      const start = new Date(Date.UTC(curYear, curMonth - 3, 1)).toISOString();
      const end = new Date(Date.UTC(curYear, curMonth + 3, 0, 23, 59, 59)).toISOString();
      return { from: start, to: end };
    }
    return null;
  }, [from, to, viewMode, curYear, curMonth, todayStr]);


  // One versioned read: the calendar window is part of the key, so a new window re-reads and a
  // slow response for an old window cannot commit.
  const { data: d, error: readErr, reload: load } = useResource(
    [versionKey, queryWindow?.from ?? null, queryWindow?.to ?? null],
    () => (queryWindow ? api.calendar(queryWindow.from, queryWindow.to) : api.calendar()),
    { label: 'Calendar' },
  );
  const err = readErr ?? writeErr;

  const shown = useMemo(() => d?.entries.filter((e) => {
    const date = dateOf(e);
    return e.title.toLowerCase().includes(q.toLowerCase()) && (kind === 'all' || e.kind === kind) && (status === 'all' || e.status === status) && (!from || date >= from) && (!to || date <= to);
  }) ?? [], [d, q, kind, status, from, to]);


  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const entriesByDate = useMemo(() => {
    const map = new Map<string, CalendarEntryView[]>();
    for (const e of shown) {
      const dt = dateOf(e);
      if (!dt) continue;
      const arr = map.get(dt) ?? [];
      arr.push(e);
      map.set(dt, arr);
    }
    return map;
  }, [shown]);

  // Agenda: by day, and inside a day one line per venue event (a ladder of 12 thresholds is one line).
  const agenda = useMemo(() => {
    const days = [...entriesByDate.entries()].filter(([d]) => viewMode !== 'list' || from || d >= todayStr).sort(([a], [b]) => a.localeCompare(b));
    return days.map(([date, es]) => {
      const lines = new Map<string, { title: string; entries: CalendarEntryView[] }>();
      for (const e of [...es].sort((a, b) => (a.start_utc ?? '').localeCompare(b.start_utc ?? ''))) {
        const m = e.condition_id ? marketById.get(e.condition_id) : undefined;
        const key = m ? `${m.venue}:${m.event_id}` : e.id;
        const line = lines.get(key) ?? lines.set(key, { title: m && m.event_title ? m.event_title : e.title, entries: [] }).get(key)!;
        line.entries.push(e);
      }
      for (const l of lines.values()) if (l.entries.length === 1) l.title = l.entries[0].title;
      return { date, lines: [...lines.values()] };
    });
  }, [entriesByDate, marketById, viewMode, from, todayStr]);

  const gridDays = useMemo(() => {
    const daysInMonth = new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate();
    const firstDay = new Date(Date.UTC(curYear, curMonth - 1, 1));
    const startDayOfWeek = (firstDay.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const prevMonthDays = new Date(Date.UTC(curYear, curMonth - 1, 0)).getUTCDate();

    const days: { dateStr: string; dayNum: number; isCurrentMonth: boolean; isToday: boolean; entries: CalendarEntryView[] }[] = [];

    // Prior month days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const prevM = curMonth === 1 ? 12 : curMonth - 1;
      const prevY = curMonth === 1 ? curYear - 1 : curYear;
      const dateStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        entries: entriesByDate.get(dateStr) ?? [],
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: day,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        entries: entriesByDate.get(dateStr) ?? [],
      });
    }

    // Trailing days
    const totalSlots = days.length <= 35 ? 35 : 42;
    const trailingCount = totalSlots - days.length;
    for (let day = 1; day <= trailingCount; day++) {
      const nextM = curMonth === 12 ? 1 : curMonth + 1;
      const nextY = curMonth === 12 ? curYear + 1 : curYear;
      const dateStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: day,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        entries: entriesByDate.get(dateStr) ?? [],
      });
    }
    return days;
  }, [curYear, curMonth, entriesByDate, todayStr]);

  const onCellClick = (cell: (typeof gridDays)[number]) => {
    if (!cell.isCurrentMonth) {
      const targetYm = cell.dateStr.slice(0, 7);
      changeMonth(targetYm);
      setSelectedDate(cell.dateStr);
    } else {
      setSelectedDate(selectedDate === cell.dateStr ? null : cell.dateStr);
    }
  };

  const monthEntriesCount = useMemo(() => {
    const prefix = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    return shown.filter((e) => dateOf(e).startsWith(prefix)).length;
  }, [shown, curYear, curMonth]);

  const selectedDayEntries = useMemo(() => {
    if (!selectedDate) return [];
    return entriesByDate.get(selectedDate) ?? [];
  }, [selectedDate, entriesByDate]);

  return (
    <div className="upcoming">
      <div className="ag-bar">
        <div className="seg" role="group" aria-label="Calendar view">
          <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>Agenda</button>
          <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')}>Month</button>
        </div>
        <div className="search-wrap"><input type="search" aria-label="Search upcoming" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <details className="wire-filters">
          <summary>Filters{[kind !== 'all', status !== 'all', from, to].filter(Boolean).length ? ` · ${[kind !== 'all', status !== 'all', from, to].filter(Boolean).length}` : ''}</summary>
          <div className="wire-filter-panel">
            <select aria-label="Calendar kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds</option>
              <option value="manual">Known events</option>
              <option value="provider_end_date">Contract end dates</option>
            </select>
            <select aria-label="Calendar status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {['scheduled', 'revised', 'postponed', 'cancelled', 'unknown', 'closed'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <label className="small">From<input aria-label="Upcoming from date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="small">To<input aria-label="Upcoming to date" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="quiet-button" onClick={clearFilters}>Clear filters</button>
          </div>
        </details>
        <button className="quiet-button ag-add" onClick={() => setAdding((v) => !v)}>+ Known event</button>
      </div>
      {adding && <div className="ag-addform">
        <input placeholder="title" value={f.title} onChange={set('title')} />
        <input type="date" value={f.date} onChange={set('date')} aria-label="Date" />
        <input type="time" value={f.time} onChange={set('time')} aria-label="Time (optional)" />
        <input placeholder="IANA zone" value={f.tz} onChange={set('tz')} aria-label="Time zone" />
        <input placeholder="source URL (required)" value={f.source_url} onChange={set('source_url')} />
        <ActionButton disabled={!f.title.trim() || !f.date || !f.tz.trim() || !f.source_url.trim()} onClick={() => attempt(() => api.createCalendarEntry({ ...f, time: f.time || null }), setWriteErr).then((r) => { if (r) { setF({ ...f, title: '', date: '', time: '', source_url: '' }); setAdding(false); load(); } })}>Add</ActionButton>
      </div>}
      <ErrorChip e={err} />
      <p className="small muted ag-note">Times in {ZONE}. A contract's end date is the venue's; resolution can be later.</p>

      {!d ? <p className="muted">Loading…</p> : (
        <>
          {viewMode === 'grid' ? (
            <div>
              <div className="calendar-month-nav">
                <button onClick={prevMonth} aria-label="Previous month">‹ Prev</button>
                <h3>{monthLabel}</h3>
                <button onClick={nextMonth} aria-label="Next month">Next ›</button>
                <button onClick={goToday}>Today</button>
                <span className="small muted">
                  {monthEntriesCount} {monthEntriesCount === 1 ? 'event' : 'events'} in this month
                </span>
              </div>

              {shown.length === 0 && (
                <div className="calendar-filter-banner small muted">
                  No upcoming events match the active search or filter criteria. <button className="linkbtn" onClick={clearFilters}>Clear filters</button>
                </div>
              )}

              <div className="month-grid-wrap">
                <div className="month-grid" role="region" aria-label={`Calendar grid for ${monthLabel}`}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
                    <div key={w} className="month-grid-weekday">{w}</div>
                  ))}
                  {gridDays.map((cell) => (
                    <div
                      key={cell.dateStr}
                      role="button"
                      className={`month-grid-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${cell.isToday ? 'today' : ''} ${cell.entries.length > 0 ? 'has-events' : ''} ${selectedDate === cell.dateStr ? 'selected' : ''}`}
                      onClick={() => onCellClick(cell)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick(cell); } }}
                      aria-label={`${cell.dateStr}, ${cell.entries.length} items`}
                    >
                      <div className="cell-header">
                        <span className="cell-day-num">{cell.dayNum}</span>
                        {cell.isToday && <span className="cell-today-tag">Today</span>}
                        {cell.entries.length > 0 && <span className="cell-count-tag">{cell.entries.length}</span>}
                      </div>
                      <div className="cell-badges">
                        {cell.entries.slice(0, 2).map((e) => {
                          const venueCls = e.kind === 'manual' ? 'manual' : e.venue === 'kalshi' ? 'kalshi' : 'pm';
                          const label = e.venue ? e.venue.slice(0, 2).toUpperCase() : e.kind === 'manual' ? 'MAN' : 'EXP';
                          return (
                            <div key={e.id} className={`cell-badge ${venueCls}`} title={`${e.title} (${e.status})`}>
                              <b>{label}</b> {e.title}
                            </div>
                          );
                        })}
                        {cell.entries.length > 2 && (
                          <div className="cell-badge-more">+{cell.entries.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedDate && (
                <div className="calendar-selected-day-panel">
                  <div className="header">
                    <h4>Events on {selectedDate} ({selectedDayEntries.length} {selectedDayEntries.length === 1 ? 'item' : 'items'})</h4>
                    <button onClick={() => setSelectedDate(null)}>Close day view</button>
                  </div>
                  {selectedDayEntries.length === 0 ? (
                    <p className="muted small">No scheduled deadlines or events on this day matching active filters.</p>
                  ) : (
                    <div className="tablewrap">
                      <table className="mini-table">
                        <thead><tr><th>When</th><th>What</th><th>Kind / basis</th><th>Status</th></tr></thead>
                        <tbody>
                          {selectedDayEntries.map((e) => (
                            <tr key={e.id}>
                              <td className="small">{when(e)}</td>
                              <td>{e.condition_id ? <ActionButton className="linkbtn" onClick={() => onOpenMarket(e.condition_id!)}>{e.title}</ActionButton> : e.title}{e.venue && <span className={`venue ${e.venue}`}> {e.venue}</span>}</td>
                              <td className="small muted">{e.kind === 'provider_end_date' ? 'provider end date' : 'manual'} <details><summary>Basis &amp; resolution timing</summary>{e.basis}<p>Resolution time is separate and may be unknown.</p></details>{e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer">source ↗</a>}</td>
                              <td className="small">
                                <span className={`chip ${e.status === 'scheduled' ? '' : 'warn'}`}>{e.status}</span>
                                {e.revisions.length > 0 && <details><summary>{e.revisions.length} change(s)</summary><ul>{e.revisions.map((r, i) => <li key={i}>{absTime(r.at)}: {r.field} {r.before ?? '—'} → {r.after ?? '—'} ({r.basis})</li>)}</ul></details>}
                                <div className="muted">first known {absTime(e.first_known_at)}</div>
                                {e.kind === 'manual' && <CalendarEdit key={e.id} entry={e} onChanged={load} />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            agenda.length === 0 ? (
              <p className="muted small">Nothing scheduled in this range.</p>
            ) : (
              <div className="agenda">
                {agenda.map((day) => (
                  <section key={day.date}>
                    <h4 className="ag-day">{dayLabel(day.date, todayStr)}</h4>
                    <ul>{day.lines.map((l) => <AgendaRow key={l.entries[0].id} entries={l.entries} title={l.title} markets={marketById} onOpenMarket={onOpenMarket} onChanged={load} />)}</ul>
                  </section>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
