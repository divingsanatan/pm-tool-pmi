import { DAY, fsh } from './dates';
import { calendarOf, hasValidDates, WEEKDAYS_SHORT } from './offdays';
import { capacityOverPlan, onDeliveryTeam, planWindow, projectDefaults, sprintDaySet } from './capacity';

const r2 = (n) => Math.round(n * 100) / 100;

/* The project's time and capacity at a glance (the cards at the top of the Stakeholders tab).
   Only days that belong to a sprint count: the span from the first sprint start to the last planned date can hold gaps between
   sprints, and those gap days are neither project time nor budget. The Budget's labour hours use the same days.
     sprint days    = days inside the sprints
     off days       = weekly off days + holidays of the Working calendar among them (a holiday on a Sunday counts once)
     available days = sprint days - off days
     available hrs  = available days x hours per day   (one person at 100% allocation and 100% focus)
   Team: for everybody on the delivery team, the leave they take inside the sprints and the effective capacity that is left
   after allocation, focus factor and leave (see capacity.js). */
export function projectGlance(S) {
  const D = projectDefaults(S);
  const cal = calendarOf(S);
  const win = planWindow(S), set = sprintDaySet(S, win);
  let weekly = 0, holiday = 0, n = 0;
  for (let i = 0, ms = win.start; i < win.n; i++, ms += DAY) {
    if (!set.has(new Date(ms).toISOString().slice(0, 10))) continue;
    n++;
    if (cal.holidays.some((h) => ms >= h.a && ms <= h.b)) holiday++;
    else if (cal.weekly.includes(new Date(ms).getUTCDay())) weekly++;
  }
  const off = weekly + holiday, avail = n - off;

  const team = S.people.filter((p) => onDeliveryTeam(S, p));
  let leaveDays = 0, perDay = 0, cap = 0, custom = 0;
  team.forEach((p) => {
    const c = capacityOverPlan(S, p, win, set);
    perDay += c.perDay;
    cap += c.cap;
    leaveDays += c.leaveFull + c.leaveHalf * 0.5;
    if (c.customHpd) custom++;
  });
  return {
    hpd: D.hpd, focus: D.focus, startLbl: fsh(win.start), endLbl: fsh(win.start + (win.n - 1) * DAY),
    hasDates: S.sprints.some(hasValidDates),
    span: win.n, gap: win.n - n, cal: n, weekly, holiday, off, avail, availHrs: r2(avail * D.hpd),
    weeklyNames: cal.weekly.map((d) => WEEKDAYS_SHORT[d]),
    team: team.length, customHpd: custom, leaveDays: r2(leaveDays), perDay: r2(perDay), cap: r2(cap),
  };
}
