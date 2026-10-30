import { DAY, pd, today, fsh } from './dates';
import { nz, cl, cleanEffort, money as money0 } from './format';
import { DEFAULT_STATUSES, DEFAULT_TYPES, allContainers, cleanTags, firstOpenStatus, isDoneStatus, makeTask, statusPct, typeOf, uid } from './tasks';
import { flatTree, leafTasks, ownDoneItems, rollupContainer, rootTasks } from './hier';
import { ACTIVITY_MAX } from './activity';
import { calendarOf, offDaysOf, sprintCalendar } from './offdays';
import { calendarHours, planWindow } from './capacity';

/* ---------- timeline helpers ---------- */
export const nW = (S) => S.meta.weeks;
export const wkS = (S, w) => pd(S.meta.start) + (w - 1) * 7 * DAY;
export const wkE = (S, w) => wkS(S, w) + 6 * DAY;
// Sprint numbers come from the sprints that actually exist (their dates), not from a fixed sprint length.
// sprintOf(S, w): 1-based number of the sprint that covers most of week w, or 0 when no sprint covers it.
export function sprintOf(S, w) {
  const a = wkS(S, w), b = wkE(S, w);
  let best = 0, days = 0;
  S.sprints.forEach((sp, i) => {
    if (!sp.start || !sp.end) return;
    const lo = Math.max(a, pd(sp.start)), hi = Math.min(b, pd(sp.end));
    const d = hi >= lo ? (hi - lo) / DAY + 1 : 0;
    if (d > days) {
      days = d;
      best = i + 1;
    }
  });
  return best;
}
// first and last project week a sprint touches, or null when it has no dates
export function sprintWeeks(S, sp) {
  if (!sp || !sp.start || !sp.end) return null;
  const W = nW(S);
  const a = Math.floor((pd(sp.start) - pd(S.meta.start)) / (7 * DAY)) + 1;
  const b = Math.floor((pd(sp.end) - pd(S.meta.start)) / (7 * DAY)) + 1;
  return [Math.max(1, Math.min(W, a)), Math.max(1, Math.min(W, b))];
}
export function curWeek(S) {
  const w = Math.floor((pd(today()) - pd(S.meta.start)) / (7 * DAY)) + 1;
  return Math.max(1, Math.min(nW(S), w));
}
export const started = (S) => pd(today()) >= pd(S.meta.start);

/* ---------- work breakdown (derived from sprints and their tasks) ---------- */
// Flat list used by the Timeline and Dashboard: one Phase row per sprint, then its work items in tree order.
// Items without children are WP rows (the real work); items with children are Sum rows (their values are roll-ups).
// The Backlog is not a sprint and is not scheduled work, so it is not part of this list.
export function wbsOf(S) {
  const rows = [];
  S.sprints.forEach((sp, i) => {
    const n = String(i + 1);
    rows.push({ id: n, name: sp.name, type: 'Phase', sprintId: sp.id });
    flatTree(sp.tasks, { prefix: n }).forEach((r) => {
      const t = r.t;
      rows.push({
        id: t.code, wbs: r.wbs, depth: r.depth, name: t.name, type: r.kids ? 'Sum' : 'WP', kind: t.type, sprintId: sp.id, taskId: t.id,
        parentId: t.parent || '', kids: r.kids, assignees: t.assignees, hrs: t.effort, start: t.start || '', finish: t.due || '',
        pct: r.kids ? nz(t.pct) : statusPct(S, t.status),
      });
    });
  });
  return rows;
}

export const wps = (S) => wbsOf(S).filter((x) => x.type === 'WP');

// Roll-up for one Phase row: hours, dates and completion (weighted by effort when items have it).
// Top-level items already hold their children's totals, so only they are added up (nothing is counted twice).
export function roll(S, p) {
  const all = wbsOf(S).filter((x) => x.type !== 'Phase' && x.sprintId === p.sprintId);
  const k = all.filter((x) => x.depth === 0);
  const o = { hrs: 0, pct: null, n: all.filter((x) => x.type === 'WP').length, s: null, f: null };
  const weighted = k.some((x) => nz(x.hrs) > 0);
  let wsum = 0, e = 0;
  k.forEach((x) => {
    o.hrs += nz(x.hrs);
    const w = weighted ? nz(x.hrs) : 1;
    wsum += w;
    e += w * nz(x.pct);
    const s = x.start || x.finish, f = x.finish || x.start;
    if (s && (!o.s || s < o.s)) o.s = s;
    if (f && (!o.f || f > o.f)) o.f = f;
  });
  o.pct = wsum ? e / wsum : null;
  return o;
}

export function wstat(x) {
  if (nz(x.pct) >= 1) return 'Done';
  if (x.finish && x.finish < today()) return 'Late';
  if (nz(x.pct) > 0) return 'In progress';
  return 'Not started';
}

/* ---------- budget ---------- */
// The labour budget is a list of stakeholders ({ person: id }); their rate and capacity live on the stakeholder itself,
// so the Budget register and the RACI chart always show the same numbers.
export const personOf = (S, id) => S.people.find((p) => p.id === id);
export const hourly = (S) => S.team.reduce((a, t) => {
  const p = personOf(S, t.person);
  return a + (p ? nz(p.rate) * nz(p.cap) : 0);
}, 0);
// Labour cost of one stakeholder on this project:
//   total available hours = the hours their calendar gives them over the plan (working days x hours per day, after team off days and
//                           their own leave; see capacity.js). It is pulled from the Stakeholders tab until someone types a value on the
//                           budget row (team row `hours`), which then stays as an adjustment.
//   available hours       = total available hours x capacity %   (capacity % is the stakeholder's allocation, the same number everywhere)
//   cost                  = available hours x hourly rate
// Rate and capacity live on the stakeholder; the optional hours adjustment belongs to this project (the budget team row).
export function labourOf(S, t, win) {
  const p = personOf(S, t.person);
  if (!p) return null;
  const auto = calendarHours(S, p, win || planWindow(S));
  const manual = t.hours != null && !isNaN(t.hours);
  const total = manual ? Math.max(0, nz(t.hours)) : auto.hours;
  const avail = total * nz(p.cap);
  return { total, off: 0, net: total, cap: nz(p.cap), rate: nz(p.rate), avail, cost: avail * nz(p.rate), manual, auto, diff: total - auto.hours };
}
export const labourRows = (S) => { const win = planWindow(S); return S.team.map((t) => labourOf(S, t, win)).filter(Boolean); };
export const labourTotal = (S) => labourRows(S).reduce((a, r) => a + r.cost, 0);
// Labour is a project total now. The weekly figure below is only that total spread evenly over the project weeks,
// kept for the project budget (projectBAC) and the cost-by-period views; the Budget tab does not use it.
export const sprintCap = (S) => labourTotal(S) / Math.max(1, nW(S));
// Planned cost of one budget line. A recurring line (per week / month / sprint) is its amount times the number of
// iterations typed in; a one-time line is just its amount.
export const ITER_UNIT = { week: 'weeks', month: 'months', sprint: 'sprints' };
export const lineTotal = (S, l) => (l.per === 'project' ? nz(l.amount) : nz(l.amount) * Math.max(0, nz(l.iterations)));
// Suggested number of iterations for a basis, from the project length (only used to pre-fill the box)
export const suggestIter = (S, per) => {
  const w = Math.max(1, nW(S));
  if (per === 'week') return w;
  if (per === 'month') return Math.max(1, Math.round((w * 12) / 52));
  if (per === 'sprint') return Math.max(1, Math.round(w / Math.max(1, S.meta.sprintWeeks)));
  return 0;
};
export const lineRecurring = (S) => S.lines.reduce((a, l) => a + (l.per === 'project' ? 0 : lineTotal(S, l)), 0);
export const lineWeeklySum = (S) => lineRecurring(S) / Math.max(1, nW(S));
export const lineOnce = (S) => S.lines.reduce((a, l) => a + (l.per === 'project' ? nz(l.amount) : 0), 0);
export const weeklyBAC = (S) => sprintCap(S) + lineWeeklySum(S);
// Work budget = team labour + line items, before any reserve.
export const workBudget = (S) => weeklyBAC(S) * nW(S) + lineOnce(S);
// Budget at completion (BAC) = work budget + contingency reserve. The management reserve is NOT part of BAC.
export const projectBAC = (S) => workBudget(S) + reserves(S).contingency;
// The approved baseline is the base for every calculation: once one exists, BAC is the baseline's BAC, not the live plan.
// Changes typed in afterwards (pending a change request) do not move PV, EV, SPI, CPI or the reserves until the request is implemented.
export const baseOf = (S) => (S.baselines && S.baselines.length ? S.baselines[S.baselines.length - 1] : null);
export const planBAC = (S) => {
  const b = baseOf(S);
  return b && b.bac != null ? nz(b.bac) : projectBAC(S);
};
// A baseline stores BAC (work budget + contingency). Its work budget is that minus the contingency it froze.
export const baseWork = (b) => nz(b.bac) - nz(b.reserve && b.reserve.contingency);
// The work budget of the plan: the baseline's once one exists, otherwise the live one. Reserve percentages apply to this.
export const planWork = (S) => {
  const b = baseOf(S);
  return b && b.bac != null ? baseWork(b) : workBudget(S);
};
// a sprint counts in the plan once it is in the current baseline (a sprint still waiting for its change request does not)
export const inPlan = (S, sp) => {
  const b = baseOf(S);
  return !b || !Array.isArray(b.sprints) || b.sprints.some((x) => x.id === sp.id);
};
/* Budget line items after a baseline: 'locked' = exactly as baselined, 'changed' = a baselined line with different values,
   'new' = not in the baseline. Changed and new lines must belong to a change request (line.crId). */
export const lineState = (S, l) => {
  const b = baseOf(S);
  if (!b || !Array.isArray(b.lines)) return 'free';
  const o = b.lines.find((x) => x.id === l.id);
  if (!o) return 'new';
  return o.name === l.name && nz(o.amount) === nz(l.amount) && o.per === l.per && nz(o.iterations) === nz(l.iterations) ? 'locked' : 'changed';
};
export const baseLine = (S, l) => {
  const b = baseOf(S);
  return b && Array.isArray(b.lines) ? b.lines.find((x) => x.id === l.id) || null : null;
};
// the most times a recurring line can repeat inside the project: weeks, months or sprints that really exist in it
export const maxIter = (S, per) => {
  const w = Math.max(1, nW(S));
  if (per === 'week') return w;
  if (per === 'month') return Math.max(1, Math.ceil((w * 12) / 52));
  if (per === 'sprint') return Math.max(1, Math.ceil(w / Math.max(1, S.meta.sprintWeeks || 2)));
  return Infinity;
};
export const projectEnd = (S) => pd(S.meta.start) + (nW(S) * 7 - 1) * DAY;

/* ---------- actual cost ledger ---------- */
export const ledgerTotal = (S) => S.ledger.reduce((a, e) => a + nz(e.amount), 0);

// The project start is never typed in: it is the start of the earliest dated sprint (kept in meta.start by normalize,
// so every week-based figure counts from it). With no dated sprint yet, the stored date stays as it is.
export function scheduleStart(S) {
  let lo = '';
  (S.sprints || []).forEach((sp) => {
    if (typeof sp.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) && !isNaN(pd(sp.start)) && (!lo || sp.start < lo)) lo = sp.start;
  });
  return lo;
}
// The last day the project reaches: the latest date among its sprints, work items, completions and cost entries (never before day 7)
export function lastDay(S) {
  const start = pd(S.meta.start);
  let end = start + 6 * DAY;
  const take = (d) => {
    if (!d) return;
    const t = pd(d);
    if (!isNaN(t) && t > end) end = t;
  };
  S.sprints.forEach((c) => {
    take(c.start);
    take(c.end);
    c.tasks.forEach((t) => {
      take(t.start);
      take(t.due);
      take(t.doneOn);
    });
  });
  S.ledger.forEach((e) => take(e.date));
  return end;
}
// Number of weeks needed to cover every dated sprint, task and cost entry, counted from the project start
export function autoWeeks(S) {
  const start = pd(S.meta.start);
  return Math.max(1, Math.min(104, Math.ceil(((lastDay(S) - start) / DAY + 1) / 7)));
}

const mStart = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), 1);
const mNext = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth() + 1, 1);
const norm = (x) => (x || '').trim().toLowerCase();

/** Planned vs actual cost grouped by 'week' | 'month' | 'sprint' | 'element'. */
export function costBy(S, mode) {
  // The project runs from its start to its real last day (not to the end of the last 7-day block), so a project that
  // ends on Tuesday 3 Nov has a short last week (2-3 Nov) and the planned budget is spread over those real days only.
  const start = pd(S.meta.start), end = lastDay(S);
  const nDays = Math.max(1, Math.round((end - start) / DAY) + 1);
  // BAC includes the contingency reserve, so the time-phased plan carries it too (same basis as PV on the Dashboard):
  // every phased amount is scaled by (1 + contingency / work budget). The management reserve stays outside.
  const R = reserves(S);
  const k = R.base > 0 ? 1 + R.contingency / R.base : 1;
  const perDay = ((labourTotal(S) + lineRecurring(S)) * k) / nDays; // one-time lines are not time-phased (shown under By element)
  const led = S.ledger.map((e) => ({ amount: nz(e.amount), element: e.element, t: e.date ? pd(e.date) : null }));
  const sumIn = (a, b) => {
    let s = 0, n = 0;
    led.forEach((e) => {
      if (e.t != null && e.t >= a && e.t <= b) {
        s += e.amount;
        n++;
      }
    });
    return { s, n };
  };
  const overlap = (a, b) => {
    const lo = Math.max(a, start), hi = Math.min(b, end);
    return hi >= lo ? (hi - lo) / DAY + 1 : 0;
  };
  const rows = [];
  if (mode === 'week') {
    for (let w = 1; w <= nW(S); w++) {
      const a = wkS(S, w), b = Math.min(wkE(S, w), end), { s, n } = sumIn(a, b);
      rows.push({ key: 'w' + w, label: 'Week ' + w, sub: fsh(a) + ' – ' + fsh(b), planned: overlap(a, b) * perDay, actual: s, n });
    }
    const out = led.filter((e) => e.t == null || e.t < start || e.t > end);
    if (out.length) rows.push({ key: 'out', label: 'Outside the project weeks', sub: 'Dated before the start or after the last week', planned: 0, actual: out.reduce((a, e) => a + e.amount, 0), n: out.length });
  } else if (mode === 'month') {
    const dated = led.filter((e) => e.t != null).map((e) => e.t);
    const lo = mStart(Math.min(start, ...dated)), hi = Math.max(end, ...dated);
    for (let m = lo; m <= hi; m = mNext(m)) {
      const b = mNext(m) - DAY, { s, n } = sumIn(m, b);
      rows.push({ key: 'm' + m, label: new Date(m).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), sub: overlap(m, b) ? fsh(Math.max(m, start)) + ' – ' + fsh(Math.min(b, end)) : '', planned: overlap(m, b) * perDay, actual: s, n });
    }
    const nd = led.filter((e) => e.t == null);
    if (nd.length) rows.push({ key: 'nd', label: 'No date', sub: '', planned: 0, actual: nd.reduce((a, e) => a + e.amount, 0), n: nd.length });
  } else if (mode === 'sprint') {
    const covered = new Set();
    S.sprints.forEach((sp) => {
      if (!sp.start || !sp.end) {
        rows.push({ key: sp.id, label: sp.name, sub: 'No dates set', planned: 0, actual: 0, n: 0 });
        return;
      }
      const a = pd(sp.start), b = pd(sp.end), { s, n } = sumIn(a, b);
      led.forEach((e, i) => e.t != null && e.t >= a && e.t <= b && covered.add(i));
      rows.push({ key: sp.id, label: sp.name, sub: fsh(a) + ' – ' + fsh(b), planned: overlap(a, b) * perDay, actual: s, n });
    });
    const rest = led.filter((e, i) => !covered.has(i));
    if (rest.length) rows.push({ key: 'none', label: 'Not in any sprint', sub: '', planned: 0, actual: rest.reduce((a, e) => a + e.amount, 0), n: rest.length });
  } else {
    const map = new Map();
    const get = (name) => {
      const k = norm(name) || '(none)';
      if (!map.has(k)) map.set(k, { key: k, label: (name || '').trim() || '(no element)', sub: '', planned: 0, actual: 0, n: 0 });
      return map.get(k);
    };
    get('Team labour').planned += sprintCap(S) * nW(S);
    S.lines.forEach((l) => {
      get(l.name || 'Line item').planned += lineTotal(S, l);
    });
    led.forEach((e) => {
      const r = get(e.element);
      r.actual += e.amount;
      r.n++;
    });
    rows.push(...map.values());
    if (R.contingency > 0) rows.push({ key: 'contingency', label: 'Contingency reserve', sub: '', planned: R.contingency, actual: 0, n: 0 });
  }
  return rows;
}

/* ---------- RAID ---------- */
export const score = (r) => (r.p && r.i ? r.p * r.i : null);
export const rating = (s) => (s == null ? '' : s >= 15 ? 'High' : s >= 8 ? 'Medium' : 'Low');
export const emv = (r) => (r.type === 'Risk' && r.probPct != null && r.cost != null ? r.probPct * r.cost : null);
export const expo = (r) => (r.type === 'Risk' && r.probPct != null && r.days != null ? r.probPct * r.days : null);
export const overdue = (r) => r.status !== 'Closed' && r.due && r.due < today();

/* ---------- RACI ---------- */
const raciOk = (roles) => {
  const v = Object.values(roles || {});
  return v.filter((x) => x === 'A').length === 1 && v.filter((x) => x === 'R').length >= 1;
};
export const raciOkFor = raciOk;
export function raciGaps(S) {
  const out = [];
  S.sprints.forEach((c) => c.tasks.forEach((t) => typeOf(S, t.type).raci !== false && !isDoneStatus(S, t.status) && !raciOk(t.raci) && out.push(t.code)));
  return out;
}

/* ---------- status colours ---------- */
export const stCls = (v) => (v == null || !isFinite(v) ? 'neutral' : v >= 1 ? 'good' : v >= 0.9 ? 'warn' : 'bad');
export function worst(a, b) {
  const o = { bad: 3, warn: 2, good: 1, neutral: 0 };
  return o[a] >= o[b] ? a : b;
}

/* ---------- earned value ---------- */

// Planned hours per sprint and each sprint's share of the project plan.
// A sprint's planned hours are typed by the user. A sprint without them falls back to what its work items add up to,
// so older projects keep working (the Dashboard flags those sprints). Shares always add up to 100% by themselves.
export function sprintShares(S) {
  const rows = S.sprints.filter((sp) => inPlan(S, sp)).map((sp) => {
    const h = sprintHours(S, sp);
    const planned = h.planned != null && h.planned > 0 ? h.planned : h.items;
    return { sp, planned, typed: h.planned != null && h.planned > 0, items: h.items, done: h.done, share: 0 };
  });
  const total = rows.reduce((a, r) => a + r.planned, 0);
  rows.forEach((r) => (r.share = total > 0 ? r.planned / total : 0));
  return { rows, total };
}


// Actual cost of each sprint: cost entries (Budget tab) dated inside the sprint's own dates. An entry that falls in no sprint is not counted in any.
export function sprintLedger(S) {
  const by = {};
  S.sprints.forEach((sp) => (by[sp.id] = []));
  (S.ledger || []).forEach((e) => {
    if (!e.date) return;
    const sp = S.sprints.find((s) => s.start && s.end && e.date >= s.start && e.date <= s.end);
    if (sp) by[sp.id].push(e);
  });
  return by;
}

/* Earned value measures for one sprint, as of a date (today by default). Nothing is typed in; every figure is worked out from
   the sprint's planned hours, dates, work items and cost entries, and sprintEvm returns the working so the screen can show it.
     budget     = BAC x the sprint's share of the planned hours
     planned %  = working days of the sprint gone (counting today) / working days in the sprint (calendar days - off days)
     earned %   = done work item hours / planned hours, never above 100%
     PV = budget x planned %     EV = budget x earned %     AC = cost entries dated inside the sprint up to the date
     SPI = EV / PV               CPI = EV / AC */
export function sprintEvm(S, sp, asOf = today()) {
  const { rows, total } = sprintShares(S);
  const row = rows.find((r) => r.sp.id === sp.id);
  const bac = planBAC(S);
  const pending = !inPlan(S, sp);
  const planned = row ? row.planned : 0;
  const share = row ? row.share : 0;
  const budget = bac * share;
  const hasDates = !!(sp.start && sp.end && pd(sp.end) >= pd(sp.start));
  // Off days (Sundays, holidays...) are not working days: they are left out of both the days in the sprint and the days gone,
  // so planned % moves only on working days and reaches 100% on the last working day.
  const cal = hasDates ? sprintCalendar(sp, asOf, calendarOf(S)) : null;
  const calDays = cal ? cal.cal : 0; // calendar days in the sprint
  const offN = cal ? cal.off : 0; // off days in the sprint
  const days = cal ? cal.work : 0; // working days in the sprint
  const started = hasDates && pd(asOf) >= pd(sp.start);
  const ended = hasDates && pd(asOf) > pd(sp.end);
  const elapsed = cal ? cal.gone : 0; // working days gone, today counts
  const offToday = !!cal && cal.offList.includes(asOf);
  const plannedPct = days ? elapsed / days : 0;
  const h = sprintHours(S, sp);
  const open = Math.max(0, h.items - h.done);
  const earnedPct = planned > 0 ? Math.min(1, h.done / planned) : 0;
  const pv = budget * plannedPct;
  const ev = budget * earnedPct;
  const entries = (sprintLedger(S)[sp.id] || []).filter((e) => e.date <= asOf).sort((x, y) => (x.date < y.date ? -1 : 1));
  const ac = entries.reduce((a, e) => a + nz(e.amount), 0);
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  // real-time status from the numbers above
  let status, cls, why;
  const left = hasDates ? Math.round((pd(sp.end) - pd(asOf)) / DAY) : 0;
  if (pending) {
    status = 'Awaiting change request'; cls = 'warn'; why = 'This sprint is not in the approved baseline yet, so it is left out of planned value, earned value and the budget until its change request is implemented.';
  } else if (hasDates && !(days > 0)) {
    status = 'Set up needed'; cls = 'warn'; why = 'Every day of the sprint is marked off. Leave at least one working day.';
  } else if (!(planned > 0) || !hasDates) {
    status = 'Set up needed'; cls = 'warn'; why = 'Enter planned hours and the start and end dates.';
  } else if (!started) {
    status = 'Not started'; cls = 'neutral'; why = 'Starts in ' + Math.round((pd(sp.start) - pd(asOf)) / DAY) + ' day' + (Math.round((pd(sp.start) - pd(asOf)) / DAY) === 1 ? '' : 's') + '.';
  } else if (h.items > 0 && open < 0.001) {
    status = 'Complete'; cls = 'good'; why = 'All work items are done' + (earnedPct < 1 ? '; ' + Math.round((planned - h.done) * 100) / 100 + ' h of the planned hours were not used.' : '.');
  } else if (ended) {
    status = 'Overdue'; cls = 'bad'; why = 'The sprint ended ' + Math.abs(left) + ' day' + (Math.abs(left) === 1 ? '' : 's') + ' ago with ' + Math.round(open * 100) / 100 + ' h of work items still open.';
  } else if (spi >= 1.05) {
    status = 'Ahead'; cls = 'good'; why = 'Earned value is ahead of planned value.';
  } else if (spi >= 0.95) {
    status = 'On track'; cls = 'good'; why = 'Earned value matches planned value.';
  } else if (spi >= 0.8) {
    status = 'At risk'; cls = 'warn'; why = 'Earned value is slightly behind planned value.';
  } else {
    status = 'Behind'; cls = 'bad'; why = 'Earned value is well behind planned value.';
  }
  const costStatus = cpi == null ? 'No cost entries yet' : cpi >= 1 ? 'Under budget' : cpi >= 0.9 ? 'Slightly over budget' : 'Over budget';
  return {
    bac, planned, total, share, typed: !!(row && row.typed), budget, hasDates, days, calDays, offN, offWeekly: cal ? cal.offWeekly : 0, offHoliday: cal ? cal.offHoliday : 0, offOwn: cal ? cal.offOwn : 0, offToday, elapsed, left, started, ended,
    plannedPct, earnedPct, doneH: h.done, itemsH: h.items, openH: open, nItems: h.n,
    pv, ev, ac, entries, spi, cpi, sv: ev - pv, cv: ac > 0 ? ev - ac : null, status, cls, why, costStatus,
    costCls: cpi == null ? 'neutral' : cpi >= 1 ? 'good' : cpi >= 0.9 ? 'warn' : 'bad',
  };
}





/* ---------- real-time earned value for the whole project (the Dashboard) ---------- */
/* Every figure is "as of" one date (today by default) and worked out from the live plan: nothing is typed in per week.
     BAC = the live work budget (Budget tab)
     PV  = sum over the sprints of  sprint budget x share of the sprint's working days gone (today counts)     [sprintEvm]
     EV  = sum over the sprints of  sprint budget x done hours / planned hours, at most 100% per sprint [sprintEvm]
     AC  = the sum of all cost entries recorded on the Budget tab
     SPI = EV / PV      CPI = EV / AC      SV = EV - PV      CV = EV - AC
     EAC = BAC / CPI    ETC = EAC - AC     VAC = BAC - EAC   TCPI = (BAC - EV) / (BAC - AC)
   A sprint's budget is BAC x its share of all planned hours, so the sprint budgets always add up to BAC. A sprint without
   dates has no time-phased plan yet: its share is reported as `unscheduled` and PV leaves it out until it is dated. */
export function projectEvm(S, asOf = today()) {
  const bac = planBAC(S);
  const { rows, total } = sprintShares(S);
  const hasPlan = total > 0 && bac > 0;
  let pv = 0, ev = 0, unscheduled = 0;
  const sprints = rows.map((r) => {
    const e = sprintEvm(S, r.sp, asOf);
    if (!e.hasDates) unscheduled += r.share;
    pv += e.pv;
    ev += e.ev;
    return e;
  });
  // AC is the sum of every cost entry on the Budget tab (the one source of actual cost), whatever its date
  const ac = ledgerTotal(S), later = 0, laterN = 0;
  const spi = hasPlan && pv > 0 ? ev / pv : null;
  const cpi = hasPlan && ac > 0 ? ev / ac : null;
  const eac = cpi != null && cpi > 0 ? bac / cpi : null;
  return {
    asOf, bac, hasPlan, pv, ev, ac, later, laterN, unscheduled, sprints,
    sv: hasPlan ? ev - pv : null, cv: hasPlan ? ev - ac : null, spi, cpi,
    eac, etc: eac == null ? null : Math.max(0, eac - ac), vac: eac == null ? null : bac - eac,
    tcpi: hasPlan && bac > ac ? (bac - ev) / (bac - ac) : null,
    pctComplete: hasPlan && bac ? ev / bac : null, pctSpent: bac ? ac / bac : null,
  };
}

/* The same PV / EV / AC, day by day, cumulative, for the S-curve. The last EV and AC points are the figures above:
   PV(day) uses the share of each sprint's working days gone by that day (off days add nothing); EV(day) the done hours finished by that day (an item
   done with no completion date counts on its due date, never later than today); AC(day) the cost entries dated by that day.
   EV and AC stop at the as-of date, because nothing after it has happened yet. */
export function evmSeries(S, asOf = today()) {
  const bac = planBAC(S);
  const { rows, total } = sprintShares(S);
  const now = pd(asOf);
  let lo = pd(S.meta.start), hi = Math.max(projectEnd(S), now);
  rows.forEach((r) => {
    if (r.sp.start && r.sp.end) {
      lo = Math.min(lo, pd(r.sp.start));
      hi = Math.max(hi, pd(r.sp.end));
    }
  });
  const n = Math.min(MAX_SERIES_DAYS, Math.round((hi - lo) / DAY) + 1);
  const ms = Array.from({ length: n }, (_, i) => lo + i * DAY);
  const at = (t) => Math.max(0, Math.min(n - 1, Math.round((t - lo) / DAY)));
  const pv = Array(n).fill(0), evAt = Array(n).fill(0);
  if (total > 0 && bac > 0) {
    rows.forEach((r) => {
      if (!(r.planned > 0)) return;
      const sp = r.sp, budget = bac * r.share;
      const cal = sprintCalendar(sp, null, calendarOf(S)); // working days only: the line stays flat over an off day
      if (cal && cal.work > 0) {
        const a = pd(sp.start);
        for (let i = 0; i < n; i++) {
          const k = Math.round((ms[i] - a) / DAY);
          const gone = k < 0 ? 0 : k >= cal.cum.length ? cal.work : cal.cum[k];
          pv[i] += (budget * gone) / cal.work;
        }
      }
      const done = Array(n).fill(0);
      leafTasks(sp.tasks).forEach((t) => {
        if (typeOf(S, t.type).milestone || !t.status || !isDoneStatus(S, t.status) || !nz(t.effort)) return;
        const on = Math.min(now, pd(t.doneOn || t.due || sp.end || t.start || sp.start || asOf));
        done[at(on)] += nz(t.effort);
      });
      // a done parent's own hours (its children's hours are already counted on the children)
      ownDoneItems(S, sp.tasks).forEach((t) => {
        const on = Math.min(now, pd(t.doneOn || t.due || sp.end || t.start || sp.start || asOf));
        done[at(on)] += nz(t.ownEffort);
      });
      let cum = 0;
      for (let i = 0; i < n; i++) {
        cum += done[i];
        evAt[i] += budget * Math.min(1, cum / r.planned);
      }
    });
  }
  const acAt = Array(n).fill(0);
  (S.ledger || []).forEach((e) => {
    acAt[e.date ? (e.date > asOf ? at(now) : at(pd(e.date))) : 0] += nz(e.amount); // every entry counts; one dated later is shown at today
  });
  let c = 0;
  const ac = acAt.map((v) => (c += v));
  const nowIdx = now < lo ? -1 : at(now);
  return { ms, bac, nowIdx, pv, ev: evAt.map((v, i) => (i <= nowIdx ? v : null)), ac: ac.map((v, i) => (i <= nowIdx ? v : null)) };
}
const MAX_SERIES_DAYS = 104 * 7 + 400;

/* ---------- "Needs attention" checks (returns [{cls, text}]) ---------- */
// Hours of a sprint: what the user planned (typed) against what its work items add up to (live), and how much of that is done
export const DEFAULT_RESERVE = { contingency: 0.1, management: 0.05 };

/* The budget as a structure:
     work budget              team labour + line items.
     + contingency reserve    % of the work budget, held for identified risks   -> BAC (cost baseline). Earned value, SPI and CPI are measured against this.
     + management reserve     % of the work budget, held for unknown risks      -> total project budget (not part of BAC)
   Until a baseline exists the amounts follow the percentages. From the first baseline on, percentages and amounts are the
   baseline's own (locked), so they do not move when the work budget moves; a change goes through a change request. */
export function reserves(S) {
  const base = planWork(S);
  const r2 = (n) => Math.round(n * 100) / 100;
  const rs = S.reserve || DEFAULT_RESERVE;
  const b = S.baselines && S.baselines.length ? S.baselines[S.baselines.length - 1] : null;
  const br = b && b.reserve;
  const contPct = br ? br.contPct : rs.contingency;
  const mgmtPct = br ? br.mgmtPct : rs.management;
  const contingency = br ? br.contingency : r2(base * contPct);
  const management = br ? br.management : r2(base * mgmtPct);
  return { base, contPct, mgmtPct, contingency, management, costBaseline: r2(base + contingency), bac: r2(base + contingency), total: r2(base + contingency + management), locked: !!b, version: b ? b.version : '' };
}

export function sprintHours(S, sp) {
  const items = rootTasks(sp.tasks).reduce((a, t) => a + nz(t.effort), 0); // top-level items already hold their children's hours
  const leaves = leafTasks(sp.tasks).filter((t) => !typeOf(S, t.type).milestone);
  const done = leaves.filter((t) => t.status && isDoneStatus(S, t.status)).reduce((a, t) => a + nz(t.effort), 0) + ownDoneItems(S, sp.tasks).reduce((a, t) => a + nz(t.ownEffort), 0);
  const planned = sp.plannedHours == null || isNaN(sp.plannedHours) ? null : nz(sp.plannedHours);
  return { planned, items, done, n: leaves.length };
}

export function alerts(S) {
  const a = [];
  S.sprints.forEach((sp) => {
    const h = sprintHours(S, sp);
    const r = (x) => Math.round(x * 100) / 100;
    if (h.planned == null || h.planned <= 0)
      a.push({ cls: 'warn', text: sp.name + ' has no planned hours. Enter them in the Planned hours box on the sprint page.' });
    else if (h.items > h.planned)
      a.push({ cls: 'warn', text: sp.name + ': work items add up to ' + r(h.items) + ' h, which is ' + r(h.items - h.planned) + ' h over the ' + r(h.planned) + ' h planned.' });
  });
  S.sprints.forEach((sp) => {
    const cal = sprintCalendar(sp, null, calendarOf(S));
    if (cal && cal.work === 0)
      a.push({ cls: 'bad', text: sp.name + ' has every day off (weekly off days and holidays), so it has no working days and no planned value. Check the Working calendar on the Stakeholders tab.' });
  });
  S.sprints.forEach((sp) => {
    const c = sp.crId && S.cr.find((x) => x.id === sp.crId);
    if (c && !['Approved', 'Implemented', 'Closed'].includes(c.status))
      a.push({ cls: 'warn', text: sp.name + ' was added through ' + c.code + ', which is ' + c.status.toLowerCase() + '. The sprint is not part of the approved plan until the change request is approved and implemented.' });
  });
  {
    const R = reserves(S), E = projectEvm(S), spent = E.ac, f = (n) => Math.round(n).toLocaleString('en-US');
    if (spent > R.costBaseline + 0.5)
      a.push({ cls: 'bad', text: 'Actual cost (' + f(spent) + ') is above the budget at completion (BAC, ' + f(R.costBaseline) + '), so it is using the management reserve. Releasing it needs a change request.' });
    else if (spent > R.base + 0.5)
      a.push({ cls: 'warn', text: 'Actual cost (' + f(spent) + ') is above the work budget (' + f(R.base) + '): ' + f(spent - R.base) + ' of the ' + f(R.contingency) + ' contingency reserve is in use.' });
    // the forecast looks ahead: cost performance so far, carried to the end of the project
    if (E.eac != null && E.eac > R.total + 0.5)
      a.push({ cls: 'bad', text: 'At the current cost performance (CPI ' + (Math.round(E.cpi * 100) / 100) + ') the project will finish at ' + f(E.eac) + ', which is ' + f(E.eac - R.total) + ' above the total project budget of ' + f(R.total) + ' even with both reserves. Act on cost now.' });
    else if (E.eac != null && E.eac > R.costBaseline + 0.5)
      a.push({ cls: 'bad', text: 'At the current cost performance (CPI ' + (Math.round(E.cpi * 100) / 100) + ') the project will finish at ' + f(E.eac) + ', above the budget at completion (BAC) of ' + f(R.costBaseline) + '. The management reserve would be needed.' });
    if (E.hasPlan && E.unscheduled > 0.0005)
      a.push({ cls: 'warn', text: Math.round(E.unscheduled * 100) + '% of the budget belongs to sprints without start and end dates, so it is left out of planned value and SPI is overstated until they are dated.' });
    // planned hours that no work item covers yet: delivery status only counts work items, so say what is missing
    const gap = S.sprints.filter((sp) => inPlan(S, sp)).map((sp) => ({ sp, h: sprintHours(S, sp) })).filter((x) => x.h.planned > 0 && x.h.items < x.h.planned - 0.005);
    gap.forEach((x) => a.push({ cls: 'warn', text: x.sp.name + ' has ' + f(x.h.planned) + ' planned hours but its work items cover only ' + f(x.h.items) + ' h (' + f(x.h.planned - x.h.items) + ' h have no work item). Earned value cannot reach 100% for it and delivery status leaves that work out until work items are added.' }));
    S.lines.forEach((l) => {
      if (l.per === 'project') return;
      const mx = maxIter(S, l.per), st = lineState(S, l);
      if (nz(l.iterations) > mx)
        a.push({ cls: 'bad', text: '“' + (l.name || 'Line item') + '” repeats ' + nz(l.iterations) + ' ' + ITER_UNIT[l.per] + ' but the project has only ' + mx + ' (' + nW(S) + ' weeks). ' + (st === 'free' ? 'Lower the iterations on the Budget tab.' : 'The baseline is locked, so correct it through a change request on the Budget tab.') });
      if (st === 'new' || st === 'changed') {
        const c = l.crId && S.cr.find((x) => x.id === l.crId);
        if (!c) a.push({ cls: 'bad', text: '“' + (l.name || 'Line item') + '” differs from the baseline and is not linked to a change request. Link or raise one on the Budget tab.' });
      }
    });
  }
  {
    // sprints of one project must not share a day; this catches data saved before the rule existed
    const over = [];
    const dated = S.sprints.filter((sp) => sp.start && sp.end && sp.start <= sp.end);
    dated.forEach((x, i) => dated.slice(i + 1).forEach((y) => x.start <= y.end && x.end >= y.start && over.push(x.name + ' and ' + y.name)));
    if (over.length) a.push({ cls: 'bad', text: 'Sprint dates overlap: ' + over.join('; ') + '. Sprints in the same project cannot overlap. Open the sprint and change its start or end date.' });
  }
  const od = S.raid.filter(overdue);
  if (od.length)
    a.push({
      cls: 'bad',
      text: od.length + ' RAID ' + (od.length > 1 ? 'items are' : 'item is') + ' past due and not closed: ' + od.map((r) => r.id).join(', ') + '.',
    });
  const late = wps(S).filter((x) => wstat(x) === 'Late');
  if (late.length)
    a.push({
      cls: 'bad',
      text:
        late.length + ' work package' + (late.length > 1 ? 's are' : ' is') + ' past the finish date and not complete: ' + late.map((x) => x.id).join(', ') + '.',
    });
  const outs = outsideSprint(S);
  if (outs.length) {
    const now = ifAligned(S);
    const same = now.weeks === nW(S);
    a.push({
      cls: 'warn',
      text:
        outs.length + ' work item' + (outs.length > 1 ? 's are' : ' is') + ' dated outside ' + (outs.length > 1 ? 'their sprints' : 'its sprint') + ' (' + outs.slice(0, 4).map((x) => x.t.code).join(', ') + (outs.length > 4 ? '…' : '') + ')' +
        (same ? '.' : '. This stretches the project to ' + nW(S) + ' weeks and the budget to ' + money0(projectBAC(S)) + '; inside the sprints it would be ' + now.weeks + ' week' + (now.weeks > 1 ? 's' : '') + ' and ' + money0(now.bac) + '. Fix it on the sprint page.'),
    });
  }
  const gaps = raciGaps(S);
  if (gaps.length)
    a.push({ cls: 'warn', text: 'RACI is incomplete for ' + gaps.length + ' open item' + (gaps.length > 1 ? 's' : '') + ' (needs one Accountable and at least one Responsible): ' + gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? '…' : '') + '.' });
  if (!a.length) a.push({ cls: 'good', text: 'Nothing flagged.' });
  return a;
}

/* ---------- id helpers ---------- */
export function newRaidId(S, type) {
  const pre = { Risk: 'R', Assumption: 'A', Issue: 'I', Dependency: 'D' }[type];
  let mx = 0;
  S.raid.forEach((r) => {
    if (r.id.charAt(0) === pre) {
      const n = parseInt(r.id.slice(2), 10);
      if (n > mx) mx = n;
    }
  });
  return pre + '-' + ('0' + (mx + 1)).slice(-2);
}

/* ---------- work items dated outside their sprint ---------- */
// The project length follows the latest date in the plan, so one work item due after its sprint ends
// stretches the whole project (and its budget). These helpers find such items and pull them back in.
const clampDate = (d, lo, hi) => (!d ? d : d < lo ? lo : d > hi ? hi : d);
export function outsideSprint(S) {
  const out = [];
  S.sprints.forEach((sp) => {
    if (!sp.start || !sp.end) return;
    leafTasks(sp.tasks).forEach((t) => {
      if ((t.due && (t.due < sp.start || t.due > sp.end)) || (t.start && (t.start < sp.start || t.start > sp.end))) out.push({ sp, t });
    });
  });
  return out;
}
// Moves start and due dates into the sprint window. Pass a sprint id to limit it to that sprint. Returns how many items changed.
export function alignSprintDates(S, sprintId) {
  let n = 0;
  S.sprints.forEach((sp) => {
    if ((sprintId && sp.id !== sprintId) || !sp.start || !sp.end) return;
    sp.tasks.forEach((t) => {
      const s = clampDate(t.start, sp.start, sp.end), d = clampDate(t.due, sp.start, sp.end);
      if (s !== t.start || d !== t.due) {
        t.start = s;
        t.due = d;
        n++;
      }
      // a parent's own dates stay inside the sprint too
      if (t.ownStart) t.ownStart = clampDate(t.ownStart, sp.start, sp.end);
      if (t.ownDue) t.ownDue = clampDate(t.ownDue, sp.start, sp.end);
    });
  });
  return n;
}
// What the project would look like with every item inside its sprint
export function ifAligned(S) {
  const c = structuredClone(S);
  alignSprintDates(c);
  c.meta.weeks = autoWeeks(c);
  return { weeks: c.meta.weeks, bac: projectBAC(c) };
}

/* ---------- keep state valid after any edit ---------- */
// True when a stored project still holds dates the app now derives itself (fixed end settings, a start that differs from the
// earliest sprint, baseline dates that differ from their frozen sprints), so the cleaned version should be saved back.
export function staleDates(P) {
  if (!P || !P.meta) return false;
  const m = P.meta;
  if ('end' in m || 'endMode' in m || 'workDays' in m) return true;
  const first = scheduleStart(P);
  if (first && m.start !== first) return true;
  return (P.baselines || []).some((b) => {
    const sp = (b.sprints || []).filter((x) => x && x.start && x.end);
    if (!sp.length) return false;
    return b.start !== sp.map((x) => x.start).sort()[0] || b.end !== sp.map((x) => x.end).sort().pop();
  });
}

export function normalize(S) {
  const m = S.meta;
  if (!Array.isArray(S.sprints)) S.sprints = [];
  if (!S.backlog) S.backlog = { id: 'backlog', name: 'Backlog', tasks: [] };
  S.backlog.id = 'backlog';
  if (!S.counter) S.counter = 1;
  if (!S.tl || typeof S.tl !== 'object') S.tl = { scale: 'week', scope: 'project', sprintId: '', from: '', to: '' };
  delete m.weeksMode; // the number of weeks always follows the data now
  if (!Array.isArray(S.raci)) S.raci = [];
  // change control: change requests and baseline versions
  if (!Array.isArray(S.baselines)) S.baselines = [];
  // Contingency and management reserve: two built-in budget lines that cannot be deleted. Their percentages (of the work budget)
  // can change until a baseline exists; from then on they are locked to the baseline's values and amounts.
  if (!S.reserve || typeof S.reserve !== 'object') S.reserve = {};
  const pct01 = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  S.reserve.contingency = pct01(S.reserve.contingency, DEFAULT_RESERVE.contingency);
  S.reserve.management = pct01(S.reserve.management, DEFAULT_RESERVE.management);
  // BAC now includes the contingency reserve. A baseline saved before that stored only the work budget in bac: add its own
  // frozen contingency once (b.incl marks it as done) so every baseline holds BAC = work budget + contingency.
  S.baselines.forEach((b) => {
    if (!b.reserve) {
      const w = nz(b.bac);
      b.reserve = { contPct: S.reserve.contingency, mgmtPct: S.reserve.management, contingency: Math.round(w * S.reserve.contingency * 100) / 100, management: Math.round(w * S.reserve.management * 100) / 100 };
    }
    if (!b.incl) {
      b.bac = Math.round((nz(b.bac) + nz(b.reserve.contingency)) * 100) / 100;
      b.incl = true;
    }
  });
  // A baseline's start, finish and length always come from the sprint dates it froze (never typed or carried over):
  // start = earliest sprint start, finish = latest sprint end. A baseline that holds no sprint list (made by a very old version)
  // keeps the dates it has, because there is nothing to derive them from.
  S.baselines.forEach((b) => {
    const sp = (b.sprints || []).filter((x) => x && x.start && x.end);
    if (sp.length) {
      b.start = sp.map((x) => x.start).sort()[0];
      b.end = sp.map((x) => x.end).sort().pop();
      b.weeks = Math.max(1, Math.ceil(((pd(b.end) - pd(b.start)) / DAY + 1) / 7));
    }
    b.endFromSprints = true;
  });
  // Focus factor used to be typed into a percent box, so 1 and 0.5 (meant as factors) were saved as 1% and 0.5%. It is a 0-1 factor now:
  // values of 1% or less are read as the factor that was meant (once only, so a later deliberate 0.01 stays).
  if (!m.focusUnitFix) {
    const fix = (o) => {
      if (o && typeof o.focus === 'number' && o.focus > 0 && o.focus <= 0.01) o.focus = Math.min(1, Math.round(o.focus * 100 * 100) / 100);
    };
    fix(m);
    (S.people || []).forEach(fix);
    m.focusUnitFix = true;
  }
  // working calendar: weekly off weekdays (0 = Sunday) and holiday ranges; only tidied when present, so projects without them are untouched
  if (Array.isArray(S.meta.weeklyOff)) S.meta.weeklyOff = Array.from(new Set(S.meta.weeklyOff.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  if (Array.isArray(S.holidays)) {
    S.holidays = S.holidays.filter((h) => h && typeof h === 'object');
    S.holidays.forEach((h) => {
      if (!h.id) h.id = uid();
    });
  }
  // off days only make sense inside their sprint: when the sprint dates move, off days left outside them are dropped
  S.sprints.forEach((sp) => {
    if (!Array.isArray(sp.offDays) || !sp.start || !sp.end || pd(sp.end) < pd(sp.start)) return;
    const keep = offDaysOf(sp);
    if (keep.length !== sp.offDays.length || keep.some((d, i) => d !== sp.offDays[i])) sp.offDays = keep;
  });
  // a sprint whose dates were opened for change through a request keeps that link while the request is still open
  // (it ends when the request is implemented, closed, rejected or deleted: the next baseline has taken the dates)
  S.sprints.forEach((sp) => {
    if (!sp.dateCrId) return;
    const cr = S.cr.find((c) => c.id === sp.dateCrId);
    if (!cr || !['Draft', 'Submitted', 'Under review', 'Approved'].includes(cr.status)) delete sp.dateCrId;
  });
  S.sprints.forEach((sp) => {
    if (sp.hoursCrId && !S.cr.find((c) => c.id === sp.hoursCrId)) delete sp.hoursCrId;
  });
  const lastB = S.baselines[S.baselines.length - 1];
  if (lastB) {
    if (!lastB.reserve) {
      // a baseline made before reserves existed: record the reserves it would have had, from its own budget at completion
      lastB.reserve = { contPct: S.reserve.contingency, mgmtPct: S.reserve.management, contingency: Math.round(nz(lastB.bac) * S.reserve.contingency * 100) / 100, management: Math.round(nz(lastB.bac) * S.reserve.management * 100) / 100 };
    }
    S.reserve.contingency = lastB.reserve.contPct;
    S.reserve.management = lastB.reserve.mgmtPct;
  }
  if (!Array.isArray(S.cr)) S.cr = [];
  S.cr.forEach((c) => {
    if (!c.id) c.id = uid();
    ['affects', 'tasks', 'raid', 'informed', 'log'].forEach((k) => !Array.isArray(c[k]) && (c[k] = []));
    if (!c.chk || typeof c.chk !== 'object') c.chk = { comms: false, docs: false, raid: false, wbs: false };
  });
  // A stakeholder who claimed extra labour budget through a change request keeps that link (team.crId); it is dropped if the request is gone.
  S.team.forEach((t) => {
    if (t.crId && !S.cr.find((x) => x.id === t.crId)) {
      delete t.crId;
      delete t.crClaim;
    }
  });
  // A sprint added after the baseline belongs to a change request (sprint.crId). Its work items are listed on that request
  // automatically. If the request no longer exists the link is dropped.
  S.sprints.forEach((sp) => {
    if (!sp.crId) return;
    const c = S.cr.find((x) => x.id === sp.crId);
    if (!c) {
      delete sp.crId;
      return;
    }
    sp.tasks.forEach((t) => !c.tasks.includes(t.id) && c.tasks.push(t.id));
  });
  // RAID items get a stable key, because their visible ID can be edited, blank or repeated. Change requests link by key
  // (links made by ID in earlier versions are converted).
  (S.raid || []).forEach((r) => {
    if (!r.key) r.key = uid();
  });
  S.cr.forEach((c) => {
    const keys = (c.raid || []).map((v) => (S.raid.find((r) => r.key === v) || S.raid.find((r) => r.id && r.id === v) || { key: v }).key);
    c.raid = keys.filter((k, i) => keys.indexOf(k) === i);
  });
  if (!S.rf || typeof S.rf !== 'object') S.rf = { scope: 'project', sprintId: '', week: 0, month: '', from: '', to: '' };

  // actual cost ledger (earlier versions kept one typed number per week)
  if (!Array.isArray(S.ledger)) {
    S.ledger = [];
    (S.report || []).forEach((r, i) => {
      if (r && r.ac != null && r.ac !== 0)
        S.ledger.push({ id: uid(), date: new Date(pd(m.start) + i * 7 * DAY).toISOString().slice(0, 10), element: 'General', desc: 'Imported from the weekly tracker', amount: r.ac });
    });
  }
  (S.report || []).forEach((r) => r && delete r.ac);
  S.ledger.forEach((e) => {
    if (!e.id) e.id = uid();
  });

  // people get stable ids; RACI roles are keyed by person id
  S.people.forEach((p) => {
    if (!p.id) p.id = uid();
  });
  // labour budget rows used to hold their own name / rate / focus; fold them into the stakeholder list
  const key = (x) => (x || '').trim().toLowerCase();
  S.team = (S.team || []).map((t) => {
    if (t.person) return t;
    let per = S.people.find((x) => key(x.name) === key(t.name));
    if (per) {
      per.rate = nz(t.rate);
      if (t.focus != null) per.cap = nz(t.focus);
    } else {
      per = { id: uid(), name: (t.name || '').trim() || 'Team member', cap: nz(t.focus), rate: nz(t.rate) };
      S.people.push(per);
    }
    return { person: per.id };
  });
  // statuses: keep at least one open and one finished status; tasks never point at a missing status
  if (!Array.isArray(S.statuses) || !S.statuses.length) S.statuses = DEFAULT_STATUSES.map((x) => ({ ...x }));
  S.statuses.forEach((st) => {
    if (!st.id) st.id = uid();
    st.label = (st.label || '').trim() || 'Status';
    st.color = st.color || 'var(--muted)';
    st.done = !!st.done;
    st.pct = st.done ? 1 : Math.max(0, Math.min(0.99, nz(st.pct)));
  });
  if (!S.statuses.some((x) => x.done)) S.statuses.push({ id: uid(), label: 'Done', color: 'var(--good)', pct: 1, done: true });
  if (!S.statuses.some((x) => !x.done)) S.statuses.unshift({ id: uid(), label: 'To do', color: 'var(--muted)', pct: 0, done: false });
  const stIds = new Set(S.statuses.map((x) => x.id));

  // assignees: earlier versions stored one name per task; now a list of stakeholder ids
  const idForName = (nm) => {
    if (!nm) return null;
    let per = S.people.find((x) => key(x.name) === key(nm));
    if (!per) {
      per = { id: uid(), name: nm, cap: 0, rate: 0 };
      S.people.push(per);
    }
    return per.id;
  };
  allContainers(S).forEach((c) =>
    c.tasks.forEach((t) => {
      if (!Array.isArray(t.assignees)) t.assignees = t.assignee ? [idForName(t.assignee)] : [];
      delete t.assignee;
      if (c.id === 'backlog') t.status = ''; // the Backlog has no statuses
      else if (!stIds.has(t.status)) t.status = firstOpenStatus(S);
      if (!t.status || !S.statuses.find((x) => x.id === t.status && x.done)) delete t.doneOn; // completion date only on finished work
      (t.subtasks || []).forEach((st) => {
        if (st.assignee !== undefined) {
          st.person = idForName(st.assignee) || '';
          delete st.assignee;
        }
      });
    })
  );

  // work item types (per project, editable)
  if (!Array.isArray(S.types) || !S.types.length) S.types = DEFAULT_TYPES.map((x) => ({ ...x }));
  const tySeen = new Set();
  S.types = S.types.filter((x) => x && x.id && !tySeen.has(x.id) && tySeen.add(x.id));
  if (!S.types.length) S.types = DEFAULT_TYPES.map((x) => ({ ...x }));
  S.types.forEach((x) => {
    x.label = (x.label || '').trim() || 'Type';
    x.color = x.color || 'var(--accent)';
    x.icon = (x.icon || '').trim().slice(0, 2) || x.label.charAt(0).toUpperCase();
    x.milestone = !!x.milestone;
    x.raci = x.raci !== false;
  });
  const typeIds = new Set(S.types.map((x) => x.id));
  const fallbackType = typeIds.has('task') ? 'task' : S.types[0].id;
  allContainers(S).forEach((c) => {
    c.tasks.forEach((t) => {
      t.effort = cleanEffort(t.effort); // hours are never negative
      if (t.ownEffort !== undefined) t.ownEffort = cleanEffort(t.ownEffort);
      t.tags = cleanTags(t.tags);
    });
    // earlier versions kept subtasks as a small checklist inside a task; they are real child work items now
    const born = [];
    c.tasks.forEach((t) => {
      (t.subtasks || []).forEach((st) => {
        const fin = S.statuses.find((x) => x.done);
        born.push(
          makeTask(S, {
            name: (st.name || '').trim() || 'Subtask',
            type: typeIds.has('subtask') ? 'subtask' : fallbackType,
            parent: t.id,
            status: c.id === 'backlog' ? '' : st.done && fin ? fin.id : firstOpenStatus(S),
            assignees: st.person ? [st.person] : [],
          })
        );
      });
      delete t.subtasks;
    });
    c.tasks.push(...born);
    // every item has a valid type, and a parent that exists in the same list (no loops)
    const byId = new Map(c.tasks.map((t) => [t.id, t]));
    c.tasks.forEach((t) => {
      if (!typeIds.has(t.type)) t.type = fallbackType;
      if (typeof t.parent !== 'string' || t.parent === t.id || !byId.has(t.parent)) t.parent = '';
    });
    c.tasks.forEach((t) => {
      const walked = new Set([t.id]);
      let up = t.parent;
      while (up) {
        if (walked.has(up)) {
          t.parent = '';
          break;
        }
        walked.add(up);
        up = (byId.get(up) || {}).parent;
      }
    });
    rollupContainer(S, c);
  });

  const ids = new Set(S.people.map((p) => p.id));
  // RAID owners are picked from the stakeholder list and stored by id; names typed in earlier versions are matched to a stakeholder
  const lc = (x) => (x || '').trim().toLowerCase();
  (S.raid || []).forEach((r) => {
    if (!r.owner || ids.has(r.owner)) return;
    const per = S.people.find((x) => lc(x.name) === lc(r.owner));
    if (per) r.owner = per.id;
  });
  const seen = new Set();
  S.team = S.team.filter((t) => ids.has(t.person) && !seen.has(t.person) && seen.add(t.person));
  const tasks = allContainers(S).flatMap((c) => c.tasks);
  tasks.forEach((t) => {
    if (!t.raci || typeof t.raci !== 'object') t.raci = {};
  });
  S.raci = S.raci.filter((r) => {
    if (!Array.isArray(r.roles)) return true;
    const map = {};
    r.roles.forEach((v, i) => v && S.people[i] && (map[S.people[i].id] = v));
    const t = tasks.find((x) => x.code === r.id);
    if (t && !Object.keys(t.raci).length) {
      t.raci = map; // an old RACI row that matches a task now lives on the task
      return false;
    }
    r.roles = map;
    return true;
  });
  // work items can no longer be typed into the RACI chart: rows added there earlier become Backlog tasks
  S.raci.forEach((r) => {
    const t = makeTask(S, { name: (r.name || '').trim() || 'Work item', raci: r.roles || {}, status: '' });
    S.backlog.tasks.push(t);
    tasks.push(t);
  });
  S.raci = [];
  const prune = (roles) => Object.keys(roles).forEach((k) => !ids.has(k) && delete roles[k]);
  tasks.forEach((t) => {
    prune(t.raci);
    t.assignees = t.assignees.filter((id, i) => ids.has(id) && t.assignees.indexOf(id) === i);
  });

  // project start: always from the sprints (the earliest sprint start), so no sprint can ever start before the project
  const first = scheduleStart(S);
  if (first) m.start = first;
  // The project end is never stored: it is always worked out from the data (see lastDay). A fixed end date (meta.end / endMode)
  // and a separate working-days pattern (meta.workDays) belonged to a retired day-by-day budget model, so they are removed.
  delete m.end;
  delete m.endMode;
  delete m.workDays;
  // number of weeks: always from the data (latest dated task, sprint, completion or cost)
  m.weeks = autoWeeks(S);
  // labour budget rows: `hours` is an optional adjustment of the hours the calendar gives (blank = follow the calendar).
  // Rows saved when "total hours" and "off hours" were typed keep exactly the hours they had (total - off), so no cost changes by itself.
  S.team.forEach((t) => {
    if (t.hours != null && !isNaN(t.hours)) t.hours = Math.max(0, nz(t.hours) - Math.max(0, nz(t.off)));
    else delete t.hours;
    delete t.off;
  });
  // recurring budget lines hold a number of iterations; lines from earlier versions keep the total they used to give
  (S.lines || []).forEach((l) => {
    if (l.per === 'project') return;
    if (l.iterations == null) l.iterations = Math.round(suggestIter({ meta: m }, l.per) * 100) / 100;
    l.iterations = Math.max(0, nz(l.iterations));
  });
  // budget lines get ids so the activity log can tell them apart
  (S.lines || []).forEach((l) => {
    if (!l.id) l.id = uid();
  });
  // Before the first baseline a recurring line can never repeat more often than the project is long
  // (2-week project: at most 2 weekly iterations). After a baseline the lines are locked, so nothing is changed silently.
  if (!S.baselines.length)
    (S.lines || []).forEach((l) => {
      if (l.per !== 'project') l.iterations = Math.min(nz(l.iterations), maxIter(S, l.per));
    });
  // a baseline freezes the budget line items too (a baseline made before this was recorded takes the lines as they are now)
  if (lastB && !Array.isArray(lastB.lines))
    lastB.lines = (S.lines || []).map((l) => ({ id: l.id, name: l.name, amount: nz(l.amount), per: l.per, iterations: l.per === 'project' ? 0 : nz(l.iterations) }));
  // activity log: a list of stamped entries, capped
  if (!Array.isArray(S.activity)) {
    S.activity = [{ id: uid(), at: new Date().toISOString(), by: 'System', cat: 'project', act: 'info', text: 'Activity tracking started for this project' }];
  }
  S.activity = S.activity.filter((e) => e && e.at && e.text).slice(-ACTIVITY_MAX);
  m.sprintWeeks = Math.max(1, Math.round(nz(m.sprintWeeks)) || 2);
  while (S.report.length < m.weeks) S.report.push({ planPct: null, earnPct: null, note: '' });

  const u = S.ui;
  const W = m.weeks;
  const SP = Math.max(1, S.sprints.length);
  u.week = cl(u.week, 1, W);
  u.sprint = cl(u.sprint, 1, SP);
  u.from = cl(u.from, 1, W);
  u.to = cl(u.to, 1, W);
  return S;
}
