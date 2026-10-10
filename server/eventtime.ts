// Conservative extraction of the time an item says something HAPPENED (distinct from when it was published).
// Only explicit, past-referring English cues are used; everything else stays unknown. Never guesses an hour.
//   "yesterday"                      → the previous UTC day
//   "on Thursday" / "last Thursday"  → most recent such weekday (today's weekday = today)
//   "8 October 2026" / "October 8, 2026" / ISO date → that day (year must be explicit)
//   "on October 8" (no year)         → that day, only if it is ≤ the publication day and within 45 days, and not an anniversary-style reference
// A cue in a future construction ("will meet on Thursday", "by Friday") is ignored.
export interface EventTime { start: string; precision: 'day'; basis: string }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = MONTHS.map((m) => m.slice(0, 3)).join('|');
const FUTURE_WEAK = /\b(by|until|before|ahead of|next|upcoming|from|starting|begins?|could|may|might)\b[^.!?]{0,40}$/i;   // only a nearby cue counts
const FUTURE_STRONG = /\b(will|would|shall|to be|expected to|set to|scheduled|planned|plans? to|due|going to|vows? to|poised to)\b[^.!?]*$/i; // anywhere earlier in the same sentence
const ANNIV = /^\s*(attacks?|massacre|war|anniversary|vigil|events|assault|offensive|invasion|raid)/i;

const utcDay = (t: number) => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
const iso = (t: number) => new Date(t).toISOString();

export function extractEventTime(text: string, publishedAt: string): EventTime | null {
  const pub = Date.parse(publishedAt);
  if (!Number.isFinite(pub)) return null;
  const pubDay = utcDay(pub);
  const found: { t: number; basis: string }[] = [];
  const futureBefore = (idx: number) => {
    const sentence = text.slice(Math.max(0, text.slice(0, idx).search(/[^.!?]*$/)), idx);
    return FUTURE_STRONG.test(sentence) || FUTURE_WEAK.test(text.slice(Math.max(0, idx - 60), idx));
  };

  for (const m of text.matchAll(/\byesterday\b/gi)) if (!futureBefore(m.index!)) found.push({ t: pubDay - 86400_000, basis: '“yesterday”' });

  for (const m of text.matchAll(/\b(last\s+|on\s+|this\s+past\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)) {
    if (!m[1] && !/^(on|last)/i.test(m[0])) continue; // a bare weekday ("Thursday said") is not a date cue
    if (futureBefore(m.index!) || /^\s*(night\s+)?(will|to)\b/i.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + 8))) continue;
    const want = DAYS.indexOf(m[2].toLowerCase());
    const have = new Date(pubDay).getUTCDay();
    let back = (have - want + 7) % 7;
    if (back === 0 && /^last/i.test(m[0])) back = 7;
    found.push({ t: pubDay - back * 86400_000, basis: `“${m[0].trim()}”` });
  }

  // explicit full dates (year present)
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${MON_RE})[a-z]*\\.?,?\\s+(20\\d{2})\\b|\\b(${MON_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) {
    const d = m[1] ? Number(m[1]) : Number(m[5]);
    const mon = MONTHS.findIndex((x) => x.startsWith((m[2] ?? m[4]).toLowerCase()));
    const yr = Number(m[3] ?? m[6]);
    const t = Date.UTC(yr, mon, d);
    if (t <= pubDay && pubDay - t <= 400 * 86400_000 && !futureBefore(m.index!)) found.push({ t, basis: `“${m[0]}”` });
  }
  // month-day without a year: recent past only, never anniversary-style
  for (const m of text.matchAll(new RegExp(`\\bon\\s+(?:(\\d{1,2})\\s+(${MON_RE})[a-z]*|(${MON_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b(?!,?\\s+20\\d{2})`, 'gi'))) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
    if (ANNIV.test(after) || futureBefore(m.index!)) continue;
    const d = Number(m[1] ?? m[4]);
    const mon = MONTHS.findIndex((x) => x.startsWith((m[2] ?? m[3]).toLowerCase()));
    let t = Date.UTC(new Date(pubDay).getUTCFullYear(), mon, d);
    if (t > pubDay) t = Date.UTC(new Date(pubDay).getUTCFullYear() - 1, mon, d);
    if (t <= pubDay && pubDay - t <= 45 * 86400_000) found.push({ t, basis: `“${m[0]}” (year assumed)` });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.t - b.t);
  const pick = found[0];
  return { start: iso(pick.t), precision: 'day', basis: pick.basis };
}
