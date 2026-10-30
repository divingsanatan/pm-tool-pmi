import { DAY, pd, today } from './dates';
import { nz } from './format';
import { calendarOf, hasValidDates, okDate, WEEKDAYS_SHORT } from './offdays';
import { leafTasks } from './hier';
import { isDoneStatus, typeOf, uid } from './tasks';

/* Capacity planning.

   A stakeholder's effective capacity is worked out from four things, each editable on the Stakeholders tab:
     hours per day   person.hpd     (blank = the project's hours per day, normally 8)
     focus factor    person.focus   share of those hours that is real productive work (meetings, email, context switching
                                    eat the rest). Blank = 80%
     allocation      person.cap     share of their time that goes to this project (the same number as the Budget's Capacity %)
     leave           person.leaves  [{ id, from, to, type, label, half }]  full days off, or half days (half = true)

       effective hours per day  = hours per day x focus factor x allocation
       available days           = working days of the project calendar - full leave days - 0.5 x half days
       effective capacity       = available days x effective hours per day

   Weekly off days and holidays belong to the project (Working calendar) and apply to everybody; leave belongs to one person.
   Work is counted per person: a work item's hours are shared equally between its assignees.
   Nothing here changes earned value, planned value or the budget: those stay on the team calendar. */

export const DEFAULT_FOCUS = 0.8;
export const LEAVE_TYPES = [
  { id: 'leave', label: 'Annual leave' },
  { id: 'sick', label: 'Sick leave' },
  { id: 'training', label: 'Training' },
  { id: 'other', label: 'Other' },
];
export const leaveTypeLabel = (id) => (LEAVE_TYPES.find((x) => x.id === id) || LEAVE_TYPES[0]).label;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const MAX_SPAN = 800; // guard against a mistyped year turning one leave into thousands of days

/* ---------- a person's settings ---------- */
// The project's defaults: everybody inherits them until a person has a value of their own.
//   meta.hoursPerDay (the same number the Budget uses, 8 if missing) and meta.focus (80% if missing)
export function projectDefaults(S) {
  const m = (S && S.meta) || {};
  const hpd = nz(m.hoursPerDay) > 0 ? Math.min(24, m.hoursPerDay) : 8;
  const focus = m.focus != null && !isNaN(m.focus) ? Math.max(0, Math.min(1, m.focus)) : DEFAULT_FOCUS;
  return { hpd, focus, customHpd: nz(m.hoursPerDay) > 0, customFocus: m.focus != null && !isNaN(m.focus) };
}

export function settingsOf(S, p) {
  const d = projectDefaults(S);
  const hpd = p && p.hpd != null && nz(p.hpd) > 0 ? Math.min(24, p.hpd) : d.hpd;
  const focus = p && p.focus != null && !isNaN(p.focus) ? Math.max(0, Math.min(1, p.focus)) : d.focus;
  const alloc = Math.max(0, nz(p && p.cap));
  return { hpd, focus, alloc, perDay: hpd * focus * alloc, customHpd: !!(p && p.hpd != null && nz(p.hpd) > 0), customFocus: !!(p && p.focus != null && !isNaN(p.focus)) };
}

// Is this stakeholder part of the delivery team for capacity purposes? Yes with an allocation above 0 or any assigned work.
// Sponsors, customers and other people who only need to be informed stay out of the planner.
export function onDeliveryTeam(S, p) {
  if (nz(p && p.cap) > 0) return true;
  return [S.backlog].concat(S.sprints || []).some((c) => c && (c.tasks || []).some((t) => (t.assignees || []).includes(p.id)));
}

/* ---------- leave ---------- */
// date -> { half, type, label } for every day a person is away (a full day beats a half day when two entries meet)
export function leaveMap(p) {
  const m = new Map();
  ((p && p.leaves) || []).forEach((l) => {
    if (!l || !okDate(l.from)) return;
    let a = pd(l.from), b = okDate(l.to) ? pd(l.to) : a;
    if (b < a) [a, b] = [b, a];
    for (let t = a, i = 0; t <= b && i < MAX_SPAN; t += DAY, i++) {
      const d = iso(t), prev = m.get(d);
      if (!prev || (prev.half && !l.half)) m.set(d, { half: !!l.half, type: l.type || 'leave', label: (l.label || '').trim() });
    }
  });
  return m;
}

// day map -> compact [{ id, from, to, type, label, half }]: consecutive days with the same details become one range
export function compressLeaves(map) {
  const days = Array.from(map.keys()).sort();
  const out = [];
  days.forEach((d) => {
    const v = map.get(d), last = out[out.length - 1];
    const same = last && last.half === v.half && last.type === v.type && last.label === v.label;
    if (same && pd(d) - pd(last.end) === DAY) last.end = d;
    else out.push({ from: d, end: d, half: v.half, type: v.type, label: v.label });
  });
  return out.map((r) => ({ id: uid(), from: r.from, to: r.end !== r.from ? r.end : '', type: r.type, label: r.label, half: r.half }));
}

// set (mode 'full' | 'half') or clear (null) leave on some dates of one person. Mutates the person (use inside update()).
export function setLeaveDays(person, dates, mode, extra = {}) {
  const m = leaveMap(person);
  dates.forEach((d) => {
    if (!okDate(d)) return;
    if (!mode) m.delete(d);
    else m.set(d, { half: mode === 'half', type: extra.type || (m.get(d) || {}).type || 'leave', label: extra.label != null ? extra.label : (m.get(d) || {}).label || '' });
  });
  person.leaves = compressLeaves(m);
}

export const datesBetween = (from, to) => {
  if (!okDate(from)) return [];
  const a = pd(from), b = okDate(to) ? pd(to) : a, lo = Math.min(a, b), hi = Math.max(a, b);
  const out = [];
  for (let t = lo, i = 0; t <= hi && i < MAX_SPAN; t += DAY, i++) out.push(iso(t));
  return out;
};

/* ---------- one person, day by day ---------- */
// state: 'weekly' | 'holiday' (team off, locked) | 'leave' | 'half' | 'work'.  factor = share of a normal day available (0, 0.5, 1)
export function dayStates(S, p, from, to, cal = calendarOf(S), lm = leaveMap(p)) {
  const a = pd(from), n = Math.min(MAX_SPAN, Math.round((pd(to) - a) / DAY) + 1);
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const ms = a + i * DAY, date = iso(ms), dow = new Date(ms).getUTCDay();
    const hol = cal.holidays.find((h) => ms >= h.a && ms <= h.b);
    const lv = lm.get(date);
    let state = 'work', factor = 1, label = '';
    if (hol) { state = 'holiday'; factor = 0; label = hol.label; }
    else if (cal.weekly.includes(dow)) { state = 'weekly'; factor = 0; label = WEEKDAYS_SHORT[dow] + ' is a weekly off day'; }
    else if (lv) { state = lv.half ? 'half' : 'leave'; factor = lv.half ? 0.5 : 0; label = lv.label || (lv.type === 'sick' ? 'Sick leave' : lv.type === 'training' ? 'Training' : lv.type === 'other' ? 'Away' : lv.half ? 'Half day' : 'Leave'); }
    return { date, ms, dow, day: new Date(ms).getUTCDate(), state, factor, label, teamOff: state === 'weekly' || state === 'holiday' };
  });
}

// how much a person can do between two dates (inclusive); `from` can be moved forward to count only what is still ahead
export function capacityBetween(S, p, from, to) {
  const st = settingsOf(S, p);
  if (!okDate(from) || !okDate(to) || pd(to) < pd(from)) return { ...st, cal: 0, teamOff: 0, leaveFull: 0, leaveHalf: 0, workDays: 0, availDays: 0, gross: 0, cap: 0, days: [] };
  const days = dayStates(S, p, from, to);
  let teamOff = 0, leaveFull = 0, leaveHalf = 0, availDays = 0;
  days.forEach((d) => {
    if (d.teamOff) teamOff++;
    else if (d.state === 'leave') leaveFull++;
    else if (d.state === 'half') { leaveHalf++; availDays += 0.5; }
    else availDays += 1;
  });
  const workDays = days.length - teamOff;
  return { ...st, cal: days.length, teamOff, leaveFull, leaveHalf, workDays, availDays, gross: availDays * st.hpd, cap: availDays * st.perDay, days };
}


/* ---------- the plan window and the hours the calendar gives a person ---------- */
// The span the plan covers: the project start (earliest sprint start) to the latest planned date (sprints and their work items).
// Cost entries and completion dates are left out on purpose: logging an actual cost must never stretch the planned hours, and so the budget.
export function planWindow(S) {
  const start = pd(S.meta.start);
  let end = start + 6 * DAY;
  const take = (d) => {
    if (!okDate(d)) return;
    const t = pd(d);
    if (t > end) end = t;
  };
  (S.sprints || []).forEach((sp) => {
    take(sp.start);
    take(sp.end);
    (sp.tasks || []).forEach((t) => { take(t.start); take(t.due); });
  });
  const n = Math.min(104 * 7 + 400, Math.round((end - start) / DAY) + 1);
  return { start, n, startS: iso(start), endS: iso(start + (n - 1) * DAY) };
}

// Hours one person has over the plan window before allocation: working days (calendar days - team off days - their own leave)
// x their hours per day. This is the figure the Budget's labour section starts from; allocation % is applied there.
export function calendarHours(S, p, win = planWindow(S)) {
  const c = capacityBetween(S, p, win.startS, win.endS);
  return { hours: r2(c.availDays * c.hpd), days: c.availDays, cal: c.cal, teamOff: c.teamOff, leave: r2(c.leaveFull + c.leaveHalf * 0.5), hpd: c.hpd };
}

/* ---------- work counted per person in one sprint ---------- */
// Hours a work item adds to the load: the real work is on items without children; a parent's own estimate is its ownEffort.
function loadItems(S, sp) {
  const leaves = new Set(leafTasks(sp.tasks).map((t) => t.id));
  return sp.tasks
    .filter((t) => !typeOf(S, t.type).milestone)
    .map((t) => ({ t, h: leaves.has(t.id) ? nz(t.effort) : nz(t.ownEffort), done: !!t.status && isDoneStatus(S, t.status) }))
    .filter((x) => x.h > 0);
}

export function statusOfLoad(util, cap, load) {
  if (cap <= 0 && load > 0) return { id: 'nocap', label: 'No capacity set', cls: 'warn' };
  if (load <= 0) return { id: 'none', label: 'No work yet', cls: 'neutral' };
  if (util > 1.0005) return { id: 'over', label: 'Over capacity', cls: 'bad' };
  if (util >= 0.85) return { id: 'full', label: 'Near the limit', cls: 'warn' };
  if (util >= 0.5) return { id: 'ok', label: 'Healthy', cls: 'good' };
  return { id: 'under', label: 'Room to take more', cls: 'neutral' };
}

/* The capacity plan of one sprint.
   rows: one per stakeholder who has allocation, work or leave in the sprint.
   Everything is "as of" a date: remaining capacity counts only days from that date on (today counts). */
export function sprintCapacity(S, sp, asOf = today()) {
  if (!hasValidDates(sp)) return null;
  const items = loadItems(S, sp);
  const cal = calendarOf(S);
  const startRem = pd(asOf) > pd(sp.start) ? (pd(asOf) > pd(sp.end) ? null : asOf) : sp.start;
  const rows = [];
  let unassigned = 0, unassignedOpen = 0;
  const per = new Map(S.people.map((p) => [p.id, { load: 0, done: 0, items: [] }]));
  items.forEach(({ t, h, done }) => {
    const ids = (t.assignees || []).filter((id) => per.has(id));
    if (!ids.length) { unassigned += h; if (!done) unassignedOpen += h; return; }
    ids.forEach((id) => {
      const e = per.get(id), share = h / ids.length;
      e.load += share;
      if (done) e.done += share;
      e.items.push({ t, share, done, n: ids.length });
    });
  });

  S.people.forEach((p) => {
    const w = per.get(p.id), c = capacityBetween(S, p, sp.start, sp.end);
    const rem = startRem ? capacityBetween(S, p, startRem, sp.end) : null;
    const away = c.days.filter((d) => d.state === 'leave' || d.state === 'half');
    if (!(c.alloc > 0) && !(w.load > 0) && !away.length) return;
    const open = Math.max(0, w.load - w.done);
    const util = c.cap > 0 ? w.load / c.cap : w.load > 0 ? Infinity : 0;
    const remCap = rem ? rem.cap : 0;
    const remUtil = remCap > 0 ? open / remCap : open > 0 ? Infinity : 0;
    // work items whose own dates run into this person's leave
    const hits = [];
    w.items.forEach(({ t, share }) => {
      const lo = okDate(t.start) ? t.start : okDate(t.due) ? t.due : '', hi = okDate(t.due) ? t.due : lo;
      if (!lo || pd(hi) < pd(lo)) return;
      const ds = dayStates(S, p, lo, hi, cal, leaveMap(p));
      const free = ds.filter((d) => !d.teamOff);
      const lost = free.filter((d) => d.state === 'leave' || d.state === 'half');
      if (!lost.length) return;
      const avail = free.reduce((a, d) => a + d.factor, 0);
      const need = avail > 0 ? share / (avail * c.hpd * c.alloc) : Infinity; // share of the person's focused hours the item needs per available day
      const perDay = avail > 0 ? share / avail : Infinity;
      hits.push({ id: t.id, code: t.code || '', name: t.name, lost: lost.map((d) => d.date), avail, perDay, tight: perDay > c.perDay + 0.001 || avail === 0, need });
    });
    rows.push({
      id: p.id, name: p.name || '(unnamed)', role: p.role || '', ...c, days: c.days, away,
      load: w.load, done: w.done, open, util, status: statusOfLoad(util, c.cap, w.load),
      free: c.cap - w.load, remCap, remUtil, hits, nItems: w.items.length,
    });
  });
  rows.sort((a, b) => (b.util === Infinity ? 1e9 : b.util) - (a.util === Infinity ? 1e9 : a.util) || (a.name < b.name ? -1 : 1));

  const cap = rows.reduce((a, r) => a + r.cap, 0), load = rows.reduce((a, r) => a + r.load, 0), open = rows.reduce((a, r) => a + r.open, 0);
  const remCap = rows.reduce((a, r) => a + r.remCap, 0);
  const lostCap = rows.reduce((a, r) => a + (r.workDays - r.availDays) * r.perDay, 0); // capacity given up to leave
  const leaveDays = rows.reduce((a, r) => a + r.leaveFull + r.leaveHalf * 0.5, 0);
  // the team's day-by-day capacity (hours), for the chart
  const daily = (rows[0] ? rows[0].days : []).map((d, i) => {
    let hours = 0, away = 0;
    rows.forEach((r) => {
      const x = r.days[i];
      hours += x.factor * r.perDay;
      if (x.state === 'leave' || x.state === 'half') away++;
    });
    return { date: d.date, dow: d.dow, day: d.day, hours, away, off: d.teamOff, kind: d.state === 'holiday' || d.state === 'weekly' ? d.state : '' };
  });
  const planned = sp.plannedHours == null || isNaN(sp.plannedHours) ? null : nz(sp.plannedHours);
  const totalLoad = load + unassigned;
  return {
    sp, rows, cap, load, open, unassigned, unassignedOpen, totalLoad, remCap, lostCap, leaveDays, daily, planned,
    util: cap > 0 ? load / cap : load > 0 ? Infinity : 0,
    teamUtil: cap > 0 ? totalLoad / cap : totalLoad > 0 ? Infinity : 0,
    free: cap - load,
    over: rows.filter((r) => r.status.id === 'over'),
    planGap: planned != null && cap > 0 ? planned - cap : null, // plan above capacity (positive) means the plan is bigger than the team can do
    status: statusOfLoad(cap > 0 ? totalLoad / cap : totalLoad > 0 ? Infinity : 0, cap, totalLoad),
  };
}

/* Capacity across the whole project: every sprint with usable dates, plus a stakeholder x sprint grid. */
export function projectCapacity(S, asOf = today()) {
  const sprints = S.sprints.map((sp) => sprintCapacity(S, sp, asOf)).filter(Boolean);
  const people = S.people
    .map((p) => ({ id: p.id, name: p.name || '(unnamed)', cells: sprints.map((x) => x.rows.find((r) => r.id === p.id) || null) }))
    .filter((r) => r.cells.some(Boolean));
  const cap = sprints.reduce((a, x) => a + x.cap, 0), load = sprints.reduce((a, x) => a + x.load, 0), unassigned = sprints.reduce((a, x) => a + x.unassigned, 0);
  const lostCap = sprints.reduce((a, x) => a + x.lostCap, 0);
  const upcoming = [];
  const horizon = pd(asOf) + 30 * DAY;
  S.people.forEach((p) => {
    const m = leaveMap(p);
    let n = 0;
    m.forEach((v, d) => { const ms = pd(d); if (ms >= pd(asOf) && ms <= horizon) n += v.half ? 0.5 : 1; });
    if (n) upcoming.push({ id: p.id, name: p.name || '(unnamed)', days: n });
  });
  return { sprints, people, cap, load, unassigned, lostCap, util: cap > 0 ? load / cap : 0, over: sprints.reduce((a, x) => a + x.over.length, 0), upcoming, upcomingDays: upcoming.reduce((a, u) => a + u.days, 0) };
}

/* Plain-language findings for a sprint's capacity plan, most urgent first. */
export function capacityInsights(X) {
  if (!X) return [];
  const out = [];
  const h = (n) => r1(n) + ' h';
  X.rows.filter((r) => r.status.id === 'over').forEach((r) => out.push({ cls: 'bad', text: r.name + ' is over capacity by ' + h(r.load - r.cap) + ' (' + Math.round(r.util * 100) + '%). Move ' + h(r.load - r.cap) + ' of work to someone with room, or to the next sprint.' }));
  X.rows.filter((r) => r.status.id === 'nocap').forEach((r) => out.push({ cls: 'warn', text: r.name + ' has ' + h(r.load) + ' of work but no capacity set. Give them an allocation % on the Stakeholders tab.' }));
  X.rows.forEach((r) => r.hits.filter((x) => x.tight).slice(0, 2).forEach((x) => out.push({ cls: 'bad', text: x.perDay === Infinity ? '“' + x.name + '” is dated only on days ' + r.name + ' is away. Change the dates or the assignee.' : '“' + x.name + '” needs ' + r1(x.perDay) + ' h a day from ' + r.name + ', who is away on ' + x.lost.length + ' of its days and can do ' + r1(r.perDay) + ' h a day.' })));
  if (X.planGap != null && X.planGap > 0.5) out.push({ cls: 'warn', text: 'The sprint plans ' + h(X.planned) + ' but the team can only do ' + h(X.cap) + ' after leave and focus factor. The plan is ' + h(X.planGap) + ' too big.' });
  if (X.unassigned > 0.05) out.push({ cls: 'warn', text: h(X.unassigned) + ' of work has nobody assigned yet. If it were shared out the team would be at ' + Math.round(X.teamUtil * 100) + '% of capacity.' });
  if (X.lostCap > 0.5) out.push({ cls: 'neutral', text: 'Leave takes ' + h(X.lostCap) + ' of capacity out of this sprint (' + r1(X.leaveDays) + ' person-day' + (X.leaveDays === 1 ? '' : 's') + ').' });
  const under = X.rows.filter((r) => r.status.id === 'under' && r.cap > 0);
  if (under.length && X.over.length) out.push({ cls: 'good', text: under.map((r) => r.name + ' (' + h(r.free) + ' free)').join(', ') + ' could take some of the overload.' });
  else if (X.free > 8 && !out.some((o) => o.cls === 'bad')) out.push({ cls: 'good', text: 'The team has ' + h(X.free) + ' of unused capacity in this sprint.' });
  return out;
}

/* ---------- the leave guard ---------- */
// Can this stakeholder be given work that runs from `start` to `due`?
//   block  every working day of those dates is a full leave day for the person, so the work cannot be allocated to them
//   lost   the leave days that fall inside the dates (their capacity for those days is left out of the plan)
// Team off days (weekends, holidays) are nobody's leave and are ignored here. No dates, no check.
export function leaveCheck(S, person, start, due) {
  if (!person) return { block: false, lost: [], days: 0 };
  const lo = okDate(start) ? start : okDate(due) ? due : '', hi = okDate(due) ? due : lo;
  if (!lo || pd(hi) < pd(lo)) return { block: false, lost: [], days: 0 };
  const free = dayStates(S, person, lo, hi).filter((d) => !d.teamOff);
  const lost = free.filter((d) => d.state === 'leave' || d.state === 'half');
  const block = free.length > 0 && free.every((d) => d.state === 'leave');
  return { block, lost: lost.map((d) => d.date), full: lost.filter((d) => d.state === 'leave').map((d) => d.date), days: free.length };
}

// "5–6 Nov" style range text for a list of ISO dates
export function rangeText(dates) {
  if (!dates.length) return '';
  const f = (d) => new Date(pd(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const out = [];
  let a = dates[0], b = dates[0];
  for (let i = 1; i <= dates.length; i++) {
    if (i < dates.length && pd(dates[i]) - pd(b) === DAY) { b = dates[i]; continue; }
    out.push(a === b ? f(a) : f(a) + ' – ' + f(b));
    a = b = dates[i];
  }
  return out.join(', ');
}

export const leaveDaysIn = (p, from, to) => {
  const m = leaveMap(p);
  let n = 0;
  m.forEach((v, d) => { if (d >= from && d <= to) n += v.half ? 0.5 : 1; });
  return r2(n);
};
