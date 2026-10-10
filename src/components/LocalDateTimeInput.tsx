import { validLocalDateTime } from '../workspace';

/** Native picker plus a predictable keyboard entry path; timezone is the browser's local zone. */
export function LocalDateTimeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="local-datetime small"><label>{label} (your browser timezone)<input aria-label={label} type="datetime-local" value={validLocalDateTime(value) ? value : ''} onChange={(e) => onChange(e.target.value)} /></label><details><summary>Enter date/time as text</summary><input aria-label={`${label} text`} type="text" placeholder="YYYY-MM-DDTHH:mm" value={value} onChange={(e) => onChange(e.target.value)} /></details>{value && !validLocalDateTime(value) && <p role="alert">Use a valid local time, for example 2030-01-01T12:00.</p>}</div>;
}
