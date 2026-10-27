import { DAY, pd } from './dates';

/* Off days: dates inside a sprint on which nobody works (Sundays, public holidays, shutdowns).
   They are stored on the sprint as sp.offDays, a list of ISO dates, and every time-based figure
   (planned %, planned value, SPI, the S-curve) counts working days only:
       working days = calendar days in the sprint - off days
   A sprint with no off days behaves exactly as before. */

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // index = Date.getUTCDay()
const MAX_DAYS = 1000; // guard against a mistyped year turning a sprint into thousands of days
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const okDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(pd(s));

export const hasValidDates = (sp) => !!(sp && okDate(sp.start) && okDate(sp.end) && pd(sp.end) >= pd(sp.start));

// The off days of a sprint that really fall inside its dates, sorted, without duplicates
export function offDaysOf(sp) {
  if (!hasValidDates(sp) || !Array.isArray(sp.offDays)) return [];
  const a = pd(sp.start), b = pd(sp.end);
  return Array.from(new Set(sp.offDays.filter((d) => okDate(d) && pd(d) >= a && pd(d) <= b))).sort();
}

/* The sprint calendar, as of a date (omit asOf for the whole-sprint figures only).
     cal      calendar days in the sprint
     off      off days
     work     working days (cal - off)
     gone     working days gone up to and including asOf (today counts)
     calGone  calendar days gone up to and including asOf
     cum[i]   working days up to and including day i of the sprint (for the S-curve)
   Returns null when the sprint has no usable dates. */
export function sprintCalendar(sp, asOf) {
  if (!hasValidDates(sp)) return null;
  const a = pd(sp.start);
  const cal = Math.min(MAX_DAYS, Math.round((pd(sp.end) - a) / DAY) + 1);
  const off = new Set(offDaysOf(sp));
  const now = asOf ? pd(asOf) : null;
  let work = 0, gone = 0, calGone = 0, offN = 0;
  const cum = [];
  for (let i = 0; i < cal; i++) {
    const ms = a + i * DAY;
    const isOff = off.has(iso(ms));
    if (isOff) offN++;
    else work++;
    if (now != null && ms <= now) {
      calGone++;
      if (!isOff) gone++;
    }
    cum.push(work);
  }
  return { cal, off: offN, work, gone, calGone, cum, offList: Array.from(off) };
}

// Every date of a sprint that falls on one of the given weekdays (0 = Sunday ... 6 = Saturday)
export function datesOnWeekdays(sp, weekdays) {
  if (!hasValidDates(sp)) return [];
  const a = pd(sp.start), n = Math.min(MAX_DAYS, Math.round((pd(sp.end) - a) / DAY) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ms = a + i * DAY;
    if (weekdays.includes(new Date(ms).getUTCDay())) out.push(iso(ms));
  }
  return out;
}

// Every calendar day of a sprint, for the day picker: [{ date, dow, day, off }]
export function sprintDayList(sp) {
  if (!hasValidDates(sp)) return [];
  const a = pd(sp.start), n = Math.min(MAX_DAYS, Math.round((pd(sp.end) - a) / DAY) + 1);
  const off = new Set(offDaysOf(sp));
  return Array.from({ length: n }, (_, i) => {
    const ms = a + i * DAY, date = iso(ms);
    return { date, dow: new Date(ms).getUTCDay(), day: new Date(ms).getUTCDate(), off: off.has(date) };
  });
}
