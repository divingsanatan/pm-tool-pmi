import { DAY, pd } from './dates';

/* Off days: dates on which nobody works. A day inside a sprint is off for one of three reasons:
     weekly   a weekday the team always rests (e.g. Sunday), set once for the project  (meta.weeklyOff, 0 = Sunday ... 6 = Saturday)
     holiday  a public holiday or shutdown, set once for the project                   (S.holidays: [{ id, from, to, label }])
     sprint   (retired) days once marked off on one sprint only. Leaves are now managed in the project's Working calendar
              (Stakeholders tab), so anything still stored in sprint.offDays is ignored and no longer counted.
   Every time-based figure (planned %, planned value, SPI, the S-curve) counts working days only:
       working days = calendar days in the sprint - off days
   A project with no weekly off days, no holidays and no sprint off days behaves exactly as before. */

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // index = Date.getUTCDay()
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, for display
const MAX_DAYS = 1000; // guard against a mistyped year turning a sprint into thousands of days
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const okDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(pd(s)) && +s.slice(0, 4) >= 1900 && +s.slice(0, 4) <= 2200;

export const hasValidDates = (sp) => !!(sp && okDate(sp.start) && okDate(sp.end) && pd(sp.end) >= pd(sp.start));

// The project's working calendar: weekly off weekdays and holiday ranges (missing or broken data counts as none)
export function calendarOf(S) {
  const w = S && S.meta && Array.isArray(S.meta.weeklyOff) ? S.meta.weeklyOff : [];
  const weekly = Array.from(new Set(w.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  const holidays = ((S && S.holidays) || [])
    .filter((h) => h && okDate(h.from))
    .map((h) => {
      let a = pd(h.from), b = okDate(h.to) ? pd(h.to) : a;
      if (b < a) [a, b] = [b, a];
      return { a, b, label: (h.label || '').trim() || 'Holiday' };
    });
  return { weekly, holidays };
}
const NO_CAL = { weekly: [], holidays: [] };

// The off days a sprint stores itself (sprint-specific), inside its own dates, sorted, without duplicates
export function offDaysOf(sp) {
  if (!hasValidDates(sp) || !Array.isArray(sp.offDays)) return [];
  const a = pd(sp.start), b = pd(sp.end);
  return Array.from(new Set(sp.offDays.filter((d) => okDate(d) && pd(d) >= a && pd(d) <= b))).sort();
}

// Every calendar day of a sprint with the reason it is off (kind: 'holiday' | 'weekly' | 'sprint' | '' for a working day)
export function sprintDayList(sp, cal = NO_CAL) {
  if (!hasValidDates(sp)) return [];
  const a = pd(sp.start), n = Math.min(MAX_DAYS, Math.round((pd(sp.end) - a) / DAY) + 1);
  const own = new Set(); // sprint-level off days are retired: only the project's Working calendar decides what is off
  return Array.from({ length: n }, (_, i) => {
    const ms = a + i * DAY, date = iso(ms), dow = new Date(ms).getUTCDay();
    const hol = cal.holidays.find((h) => ms >= h.a && ms <= h.b);
    const kind = hol ? 'holiday' : cal.weekly.includes(dow) ? 'weekly' : own.has(date) ? 'sprint' : '';
    return { date, ms, dow, day: new Date(ms).getUTCDate(), kind, off: !!kind, locked: kind === 'holiday' || kind === 'weekly', label: hol ? hol.label : kind === 'weekly' ? WEEKDAYS_SHORT[dow] + ' is a weekly off day' : '', own: own.has(date) };
  });
}

/* The sprint calendar, as of a date (omit asOf for the whole-sprint figures only).
     cal / off / work   calendar days, off days and working days (cal - off)
     offWeekly, offHoliday, offOwn   off days by reason
     gone      working days gone up to and including asOf (today counts)
     cum[i]    working days up to and including day i of the sprint (for the S-curve)
   Returns null when the sprint has no usable dates. */
export function sprintCalendar(sp, asOf, calendar = NO_CAL) {
  const days = sprintDayList(sp, calendar);
  if (!days.length) return null;
  const now = asOf ? pd(asOf) : null;
  let work = 0, gone = 0, calGone = 0, offWeekly = 0, offHoliday = 0, offOwn = 0;
  const cum = [], offList = [];
  days.forEach((d) => {
    if (d.kind === 'weekly') offWeekly++;
    else if (d.kind === 'holiday') offHoliday++;
    else if (d.kind === 'sprint') offOwn++;
    if (d.off) offList.push(d.date);
    else work++;
    if (now != null && d.ms <= now) {
      calGone++;
      if (!d.off) gone++;
    }
    cum.push(work);
  });
  return { cal: days.length, off: days.length - work, work, gone, calGone, offWeekly, offHoliday, offOwn, cum, offList };
}

export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Why a date is off in the project's Working calendar (weekly off day or holiday), or null for a working day / an unusable date.
export function offDayInfo(S, date) {
  if (!okDate(date)) return null;
  const cal = calendarOf(S), ms = pd(date), dow = new Date(ms).getUTCDay();
  const hol = cal.holidays.find((h) => ms >= h.a && ms <= h.b);
  if (hol) return { kind: 'holiday', label: hol.label, dow };
  if (cal.weekly.includes(dow)) return { kind: 'weekly', label: WEEKDAYS_LONG[dow], dow };
  return null;
}
