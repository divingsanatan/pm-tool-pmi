import { DAY, fsh, pd } from './dates';
import { lastDay } from './calc';
import { calendarOf, hasValidDates, WEEKDAYS_SHORT } from './offdays';
import { capacityBetween, onDeliveryTeam, projectDefaults, settingsOf } from './capacity';

const MAX_DAYS = 104 * 7 + 400;
const r2 = (n) => Math.round(n * 100) / 100;

/* The project's time and capacity at a glance (the cards at the top of the Stakeholders tab).
   Window: from the project start (earliest sprint start) to the last day of the plan, the same span the Dashboard and Budget use.
     calendar days  = days in the window
     off days       = weekly off days + holidays of the Working calendar that fall in the window (a holiday on a Sunday counts once)
     available days = calendar days - off days
     available hrs  = available days x hours per day   (one person at 100% allocation and 100% focus)
   Team: for everybody on the delivery team, the leave they take inside the window and the effective capacity that is left
   after allocation, focus factor and leave (see capacity.js). */
export function projectGlance(S) {
  const D = projectDefaults(S);
  const cal = calendarOf(S);
  const startMs = pd(S.meta.start), endMs = lastDay(S);
  const n = Math.min(MAX_DAYS, Math.max(1, Math.round((endMs - startMs) / DAY) + 1));
  let weekly = 0, holiday = 0;
  for (let i = 0, ms = startMs; i < n; i++, ms += DAY) {
    if (cal.holidays.some((h) => ms >= h.a && ms <= h.b)) holiday++;
    else if (cal.weekly.includes(new Date(ms).getUTCDay())) weekly++;
  }
  const off = weekly + holiday, avail = n - off;
  const startS = new Date(startMs).toISOString().slice(0, 10), endS = new Date(startMs + (n - 1) * DAY).toISOString().slice(0, 10);

  const team = S.people.filter((p) => onDeliveryTeam(S, p));
  let leaveDays = 0, perDay = 0, cap = 0, custom = 0;
  team.forEach((p) => {
    const st = settingsOf(S, p), c = capacityBetween(S, p, startS, endS);
    perDay += st.perDay;
    cap += c.cap;
    leaveDays += c.leaveFull + c.leaveHalf * 0.5;
    if (st.customHpd) custom++;
  });
  return {
    hpd: D.hpd, focus: D.focus, startS, endS, startLbl: fsh(startMs), endLbl: fsh(startMs + (n - 1) * DAY),
    hasDates: S.sprints.some(hasValidDates),
    cal: n, weekly, holiday, off, avail, availHrs: r2(avail * D.hpd),
    weeklyNames: cal.weekly.map((d) => WEEKDAYS_SHORT[d]),
    team: team.length, customHpd: custom, leaveDays: r2(leaveDays), perDay: r2(perDay), cap: r2(cap),
  };
}
