import { pd } from './dates';
import { nz } from './format';
import { calendarOf, okDate } from './offdays';
import { leafTasks } from './hier';
import { typeOf } from './tasks';
import { capacityOverPlan, dayStates, leaveMap, planWindow, rangeText, settingsOf, sprintCapacity, sprintDaySet } from './capacity';

/* Allocation guard (warnings only, every one can be overridden).

   Four things are checked for each stakeholder who has work with dates or hours:
     leave     a work item runs over a day the person is on full leave (Working calendar > leave). Nothing can be allocated to them that day.
     day       the person's work items cannot fit into their effective hours per day (hours per day x focus factor x allocation).
               Each item's hours are placed on the days of its own dates, earliest due date first, filling whatever room the earlier
               items left (an 8 h item over 2 and 3 Nov takes the 2 h left on the 2nd and 6 h on the 3rd). Only hours that do not fit
               anywhere inside the item's dates are reported, on the item's last working day.
     sprint    the person's hours in one sprint are above their effective capacity for that sprint
     project   the person's hours in all sprints are above their effective capacity for the whole plan

   A check only complains about what an edit makes new or worse (scan before, scan after, compare), so an override is not asked for again
   on the next unrelated edit. People with no allocation % have no effective capacity to compare with: the day / sprint / project checks
   skip them (the capacity planner already shows "No capacity set"); the leave check still applies to them. */

const EPS = 0.05;
const r1 = (n) => Math.round(n * 10) / 10;

// the work a person does on one item: hours (shared equally between the item's assignees) and the dates they run over
function parts(S, sp) {
  const leaves = new Set(leafTasks(sp.tasks).map((t) => t.id));
  const out = [];
  sp.tasks.forEach((t) => {
    if (typeOf(S, t.type).milestone) return;
    const ids = (t.assignees || []).filter((id) => S.people.some((p) => p.id === id));
    if (!ids.length) return;
    if (leaves.has(t.id)) out.push({ key: t.id, t, ids, h: nz(t.effort), start: t.start, due: t.due, sp });
    else out.push({ key: t.id + ':own', t, ids, h: nz(t.ownEffort), start: t.ownStart, due: t.ownDue, sp });
  });
  return out;
}

export function scanLoad(S) {
  const cal = calendarOf(S);
  const res = { leave: new Map(), day: new Map(), sprint: new Map(), project: new Map(), caps: new Map() };
  const win = planWindow(S), set = sprintDaySet(S, win);
  const per = new Map(S.people.map((p) => [p.id, { p, st: settingsOf(S, p), lm: leaveMap(p), load: 0, sched: [] }]));
  (S.sprints || []).forEach((sp) => {
    parts(S, sp).forEach((x) => {
      const lo = okDate(x.start) ? x.start : okDate(x.due) ? x.due : '', hi = okDate(x.due) ? x.due : lo;
      const dated = lo && pd(hi) >= pd(lo);
      x.ids.forEach((pid) => {
        const e = per.get(pid);
        if (!e) return;
        const share = x.h / x.ids.length;
        e.load += share;
        if (!dated) return;
        const ds = dayStates(S, e.p, lo, hi, cal, e.lm).filter((d) => !d.teamOff);
        const away = ds.filter((d) => d.state === 'leave').map((d) => d.date);
        if (away.length) res.leave.set(pid + '|' + x.key, { pid, name: x.t.name || 'This work item', dates: away, sprint: sp.name });
        const w = ds.reduce((a, d) => a + d.factor, 0);
        if (share > 0 && w > 0 && e.st.perDay > 0) {
          const days = ds.filter((d) => d.factor > 0);
          e.sched.push({ name: x.t.name, share, left: share, days: new Map(days.map((d) => [d.date, d.factor])), from: days[0].date, due: days[days.length - 1].date });
        }
      });
    });
  });
  // hours per day: place every item's hours into the days of its dates, earliest due date first, filling the room that is left
  per.forEach((e, pid) => {
    if (!e.sched.length) return;
    const perDay = e.st.perDay;
    const dates = Array.from(new Set(e.sched.flatMap((x) => Array.from(x.days.keys())))).sort();
    const cell = (date, factor) => {
      const k = pid + '|' + date;
      let cur = res.day.get(k);
      if (!cur) res.day.set(k, (cur = { pid, date, load: 0, cap: perDay * factor, perDay, items: [] }));
      return cur;
    };
    dates.forEach((date) => {
      const open = e.sched.filter((x) => x.left > EPS && x.days.has(date)).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
      if (!open.length) return;
      const cur = cell(date, open[0].days.get(date));
      let room = cur.cap;
      open.forEach((x) => {
        const g = Math.min(x.left, room);
        if (g <= 0) return;
        x.left -= g;
        room -= g;
        cur.load += g;
        cur.items.push(x.name);
      });
    });
    // what still does not fit inside an item's own dates lands on its last working day (that day is then over its limit)
    e.sched.forEach((x) => {
      if (x.left <= EPS) return;
      const cur = cell(x.due, x.days.get(x.due));
      cur.load += x.left;
      cur.items.push(x.name);
    });
  });
  // sprint and project totals
  const rowsBySprint = (S.sprints || []).map((sp) => ({ sp, X: sprintCapacity(S, sp) })).filter((x) => x.X);
  rowsBySprint.forEach(({ sp, X }) =>
    X.rows.forEach((r) => {
      if (!(r.cap > 0) || !(r.load > r.cap + EPS)) return;
      res.sprint.set(r.id + '|' + sp.id, { pid: r.id, name: r.name, sprint: sp.name, load: r.load, cap: r.cap, excess: r.load - r.cap });
    })
  );
  per.forEach((e, pid) => {
    if (!(e.st.perDay > 0) || !(e.load > 0)) return;
    const cap = capacityOverPlan(S, e.p, win, set).cap;
    if (cap > 0 && e.load > cap + EPS) res.project.set(pid, { pid, name: e.p.name || 'This stakeholder', load: e.load, cap, excess: e.load - cap });
  });
  return res;
}

// What the edit (before -> after) made new or worse, as plain-language lines (most important first)
export function newLoadIssues(S0, S1) {
  const a = scanLoad(S0), b = scanLoad(S1);
  const name = (id) => ((S1.people.find((p) => p.id === id) || {}).name || 'This stakeholder');
  const lines = [];
  // leave
  b.leave.forEach((v, k) => {
    const was = a.leave.get(k);
    if (was && was.dates.length >= v.dates.length) return;
    lines.push({ kind: 'leave', text: name(v.pid) + ' is on leave on ' + rangeText(v.dates) + ', a day of \u201c' + v.name + '\u201d. Nothing should be allocated to them on a leave day.' });
  });
  // hours per day: one line per person, worst day first
  const byPerson = new Map();
  b.day.forEach((v, k) => {
    const ex = v.load - v.cap;
    if (ex <= EPS) return;
    const was = a.day.get(k);
    if (was && was.load - was.cap >= ex - EPS) return;
    byPerson.set(v.pid, (byPerson.get(v.pid) || []).concat(v));
  });
  byPerson.forEach((list, pid) => {
    list.sort((x, y) => (x.date < y.date ? -1 : 1));
    const max = list.reduce((m, x) => Math.max(m, x.load), 0);
    lines.push({ kind: 'day', text: name(pid) + ' would carry up to ' + r1(max) + ' h a day on ' + rangeText(list.map((x) => x.date)) + ', above their effective ' + r1(list[0].perDay) + ' h a day (hours per day \u00d7 focus factor \u00d7 allocation).' });
  });
  // sprint total
  const sprintPeople = new Set();
  b.sprint.forEach((v, k) => {
    const was = a.sprint.get(k);
    if (was && was.excess >= v.excess - EPS) return;
    sprintPeople.add(v.pid);
    lines.push({ kind: 'sprint', text: v.name + ' would have ' + r1(v.load) + ' h in ' + v.sprint + ' against an effective capacity of ' + r1(v.cap) + ' h (' + r1(v.excess) + ' h over).' });
  });
  // project total
  b.project.forEach((v, k) => {
    const was = a.project.get(k);
    if (was && was.excess >= v.excess - EPS) return;
    if (sprintPeople.has(k)) return; // the sprint line already says it
    lines.push({ kind: 'project', text: v.name + ' would have ' + r1(v.load) + ' h across the project against an effective capacity of ' + r1(v.cap) + ' h (' + r1(v.excess) + ' h over).' });
  });
  return lines;
}
