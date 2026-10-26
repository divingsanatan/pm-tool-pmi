import { DAY, pd, today, fsh } from './dates';
import { nz, cl, cleanEffort, money as money0 } from './format';
import { DEFAULT_STATUSES, DEFAULT_TYPES, allContainers, firstOpenStatus, isDoneStatus, makeTask, statusPct, typeOf, uid } from './tasks';
import { flatTree, leafTasks, rollupContainer, rootTasks } from './hier';
import { ACTIVITY_MAX } from './activity';

/* ---------- timeline helpers ---------- */
export const nW = (S) => S.meta.weeks;
export const wkS = (S, w) => pd(S.meta.start) + (w - 1) * 7 * DAY;
export const wkE = (S, w) => wkS(S, w) + 6 * DAY;
export const wlabel = (S, w) => fsh(wkS(S, w)) + ' – ' + fsh(wkE(S, w));
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
export const nSp = (S) => Math.max(1, S.sprints.length);
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
// Labour cost of one stakeholder on this project, from numbers typed in the Labour budget:
//   available hours = (total hours on the project - off hours) x capacity %
//   cost            = available hours x hourly rate
// Rate and capacity live on the stakeholder; total hours and off hours belong to this project (the budget team row).
export function labourOf(S, t) {
  const p = personOf(S, t.person);
  if (!p) return null;
  const total = Math.max(0, nz(t.hours)), off = Math.max(0, nz(t.off));
  const net = Math.max(0, total - off);
  const avail = net * nz(p.cap);
  return { total, off, net, cap: nz(p.cap), rate: nz(p.rate), avail, cost: avail * nz(p.rate), overOff: off > total };
}
export const labourRows = (S) => S.team.map((t) => labourOf(S, t)).filter(Boolean);
export const labourTotal = (S) => labourRows(S).reduce((a, r) => a + r.cost, 0);
// Labour is a project total now. The weekly figure below is only that total spread evenly over the project weeks,
// kept for the Dashboard and Weekly tracker (period budgets, planned value); the Budget tab does not use it.
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
// Per-week spread of a recurring line, kept only for the Dashboard and Weekly tracker (period budgets, planned value)
export const lineWeekly = (S, l) => (l.per === 'project' ? 0 : lineTotal(S, l) / Math.max(1, nW(S)));
export const lineWeeklySum = (S) => lineRecurring(S) / Math.max(1, nW(S));
export const lineOnce = (S) => S.lines.reduce((a, l) => a + (l.per === 'project' ? nz(l.amount) : 0), 0);
export const weeklyBAC = (S) => sprintCap(S) + lineWeeklySum(S);
export const projectBAC = (S) => weeklyBAC(S) * nW(S) + lineOnce(S);
export const projectEnd = (S) => pd(S.meta.start) + (nW(S) * 7 - 1) * DAY;

/* ---------- actual cost ledger ---------- */
export const ledgerTotal = (S) => S.ledger.reduce((a, e) => a + nz(e.amount), 0);
export const weekOfDate = (S, date) => (date ? Math.floor((pd(date) - pd(S.meta.start)) / (7 * DAY)) + 1 : null);
export function weekAc(S, w) {
  let sum = 0, n = 0;
  S.ledger.forEach((e) => {
    if (weekOfDate(S, e.date) === w) {
      sum += nz(e.amount);
      n++;
    }
  });
  return n ? sum : null;
}

// Number of weeks needed to cover every dated sprint, task and cost entry
export function autoWeeks(S) {
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
  return Math.max(1, Math.min(104, Math.ceil(((end - start) / DAY + 1) / 7)));
}

const mStart = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), 1);
const mNext = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth() + 1, 1);
const norm = (x) => (x || '').trim().toLowerCase();

/** Planned vs actual cost grouped by 'week' | 'month' | 'sprint' | 'element'. */
export function costBy(S, mode) {
  const wB = weeklyBAC(S), perDay = wB / 7;
  const start = pd(S.meta.start), end = projectEnd(S);
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
      const a = wkS(S, w), b = wkE(S, w), { s, n } = sumIn(a, b);
      rows.push({ key: 'w' + w, label: 'Week ' + w, sub: fsh(a) + ' – ' + fsh(b), planned: wB, actual: s, n });
    }
    const out = led.filter((e) => e.t == null || e.t < start || e.t > end);
    if (out.length) rows.push({ key: 'out', label: 'Outside the project weeks', sub: 'Dated before the start or after the last week', planned: 0, actual: out.reduce((a, e) => a + e.amount, 0), n: out.length });
  } else if (mode === 'month') {
    const dated = led.filter((e) => e.t != null).map((e) => e.t);
    const lo = mStart(Math.min(start, ...dated)), hi = Math.max(end, ...dated);
    for (let m = lo; m <= hi; m = mNext(m)) {
      const b = mNext(m) - DAY, { s, n } = sumIn(m, b);
      rows.push({ key: 'm' + m, label: new Date(m).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), sub: '', planned: overlap(m, b) * perDay, actual: s, n });
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
/* Planned and earned value come from the work items of the sprints (the Backlog is not scheduled work).
   Every work item carries a share of the project budget: by effort hours when any item has effort, otherwise equally.
   Planned: the item's share lands in the week of its due date (falling back to the sprint end, then its start).
   Earned: the item's share lands in the week it was marked done. Items finished before completion dates were
   recorded count on their due date. */
export function workPlanByTasks(S) {
  const N = nW(S);
  const items = [];
  // only items without children count (a parent is the sum of its children), and milestones carry no work
  S.sprints.forEach((sp) => leafTasks(sp.tasks).forEach((t) => !typeOf(S, t.type).milestone && items.push({ t, sp })));
  const weighted = items.some((x) => nz(x.t.effort) > 0);
  const wt = (x) => (weighted ? nz(x.t.effort) : 1);
  const idx = (date) => Math.max(1, Math.min(N, weekOfDate(S, date))) - 1;
  const o = { total: 0, plan: Array(N).fill(0), done: Array(N).fill(0), count: items.length, undated: 0, undatedDone: 0, noStamp: 0, weighted };
  items.forEach((x) => {
    const w = wt(x);
    if (!w) return;
    o.total += w;
    const finish = x.t.due || x.sp.end || x.t.start || x.sp.start;
    const finished = !!x.t.status && isDoneStatus(S, x.t.status);
    if (finish) o.plan[idx(finish)] += w;
    else o.undated++;
    if (finished) {
      if (!x.t.doneOn) o.noStamp++;
      const on = x.t.doneOn || finish;
      if (on) o.done[idx(on)] += w;
      else {
        o.undatedDone++;
        o.done[idx(today())] += w;
      }
    }
  });
  return o;
}

// Planned hours per sprint and each sprint's share of the project plan.
// A sprint's planned hours are typed by the user. A sprint without them falls back to what its work items add up to,
// so older projects keep working (the Dashboard flags those sprints). Shares always add up to 100% by themselves.
export function sprintShares(S) {
  const rows = S.sprints.map((sp) => {
    const h = sprintHours(S, sp);
    const planned = h.planned != null && h.planned > 0 ? h.planned : h.items;
    return { sp, planned, typed: h.planned != null && h.planned > 0, items: h.items, done: h.done, share: 0 };
  });
  const total = rows.reduce((a, r) => a + r.planned, 0);
  rows.forEach((r) => (r.share = total > 0 ? r.planned / total : 0));
  return { rows, total };
}

/* Planned and earned value from the sprint plan (when sprints have hours; otherwise from the work items, see workPlanByTasks).
   Planned: a sprint's share of the project budget = its planned hours / all planned hours. It is placed on the sprint's own
   dates, spread over the weeks in proportion to the days of the sprint that fall in each week.
   Earned: done work item hours / the sprint's planned hours, capped at the sprint's own share, placed in the week each item
   was marked done. Values are kept as "planned hours" so that value = hours / total hours * budget. */
export function workPlan(S) {
  const base = workPlanByTasks(S);
  const { rows, total } = sprintShares(S);
  if (!(total > 0)) return base;
  const N = nW(S);
  const idx = (date) => Math.max(1, Math.min(N, weekOfDate(S, date))) - 1;
  const o = { ...base, total, plan: Array(N).fill(0), done: Array(N).fill(0), bySprint: rows, mode: 'sprint-hours' };
  const wStart = (i) => pd(S.meta.start) + i * 7 * DAY;
  rows.forEach((r) => {
    if (!(r.planned > 0)) return;
    const { sp } = r;
    // planned: on the sprint's dates
    if (sp.start && sp.end && pd(sp.end) >= pd(sp.start)) {
      const a = pd(sp.start), b = pd(sp.end), days = (b - a) / DAY + 1;
      for (let i = 0; i < N; i++) {
        const lo = Math.max(a, wStart(i)), hi = Math.min(b, wStart(i) + 6 * DAY);
        if (hi >= lo) o.plan[i] += (r.planned * ((hi - lo) / DAY + 1)) / days;
      }
    } else o.plan[idx(sp.end || sp.start || S.meta.start)] += r.planned;
    // earned: done hours in the week they were finished, never more than the sprint's planned hours
    const f = r.done > r.planned ? r.planned / r.done : 1;
    leafTasks(sp.tasks).forEach((t) => {
      if (typeOf(S, t.type).milestone || !t.status || !isDoneStatus(S, t.status) || !nz(t.effort)) return;
      const on = t.doneOn || t.due || sp.end || t.start || sp.start || today();
      o.done[idx(on)] += nz(t.effort) * f;
    });
  });
  return o;
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
     planned %  = days of the sprint gone (counting today) / days in the sprint
     earned %   = done work item hours / planned hours, never above 100%
     PV = budget x planned %     EV = budget x earned %     AC = cost entries dated inside the sprint up to the date
     SPI = EV / PV               CPI = EV / AC */
export function sprintEvm(S, sp, asOf = today()) {
  const { rows, total } = sprintShares(S);
  const row = rows.find((r) => r.sp.id === sp.id);
  const bac = projectBAC(S);
  const planned = row ? row.planned : 0;
  const share = row ? row.share : 0;
  const budget = bac * share;
  const hasDates = !!(sp.start && sp.end && pd(sp.end) >= pd(sp.start));
  const days = hasDates ? Math.round((pd(sp.end) - pd(sp.start)) / DAY) + 1 : 0;
  const started = hasDates && pd(asOf) >= pd(sp.start);
  const ended = hasDates && pd(asOf) > pd(sp.end);
  const elapsed = hasDates ? Math.max(0, Math.min(days, Math.round((pd(asOf) - pd(sp.start)) / DAY) + 1)) : 0;
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
  if (!(planned > 0) || !hasDates) {
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
    bac, planned, total, share, typed: !!(row && row.typed), budget, hasDates, days, elapsed, left, started, ended,
    plannedPct, earnedPct, doneH: h.done, itemsH: h.items, openH: open, nItems: h.n,
    pv, ev, ac, entries, spi, cpi, sv: ev - pv, cv: ac > 0 ? ev - ac : null, status, cls, why, costStatus,
    costCls: cpi == null ? 'neutral' : cpi >= 1 ? 'good' : cpi >= 0.9 ? 'warn' : 'bad',
  };
}

export function wk(S, w) {
  const BAC = projectBAC(S);
  const P = workPlan(S);
  // Planned % and Earned % are shares of the whole project budget (BAC), the same base the sprint plan uses.
  // planned: follows the sprint plan (each sprint's share of BAC, spread over its dates)
  const pv = P.total > 0 ? (P.plan[w - 1] / P.total) * BAC : null;
  // earned: counted for weeks up to today (future weeks have nothing to report yet)
  let ev = null;
  if (P.total > 0 && started(S) && w <= curWeek(S)) ev = (P.done[w - 1] / P.total) * BAC;
  return {
    w,
    plan: pv == null ? null : BAC ? pv / BAC : null,
    earn: ev == null ? null : BAC ? ev / BAC : null,
    ac: weekAc(S, w),
    pv,
    ev,
  };
}
export function hasData(S, w) {
  const x = wk(S, w);
  return x.ev != null || x.ac != null;
}

export function agg(S, a, b) {
  const o = { pv: 0, ev: 0, ac: 0, pvR: 0, evR: 0, evC: 0, acC: 0, weeks: b - a + 1, reported: 0, spiS: [], cpiS: [] };
  for (let w = a; w <= b; w++) {
    const x = wk(S, w);
    if (x.pv != null && x.ev != null) {
      o.pvR += x.pv;
      o.evR += x.ev;
      o.reported++;
    }
    if (x.pv != null) o.pv += x.pv;
    if (x.ev != null) o.ev += x.ev;
    if (x.ac != null) o.ac += x.ac;
    if (x.ev != null && x.ac != null) {
      o.evC += x.ev;
      o.acC += x.ac;
    }
    o.spiS.push(x.pv && x.ev != null ? x.ev / x.pv : null);
    o.cpiS.push(x.ac && x.ev != null ? x.ev / x.ac : null);
  }
  o.spi = o.pvR ? o.evR / o.pvR : null;
  o.cpi = o.acC ? o.evC / o.acC : null;
  o.budget = weeklyBAC(S) * (b - a + 1);
  return o;
}

/* ---------- selected range on the dashboard ---------- */
export function rng(S) {
  const u = S.ui;
  const W = nW(S);
  let a, b;
  if (u.mode === 'week') {
    a = b = u.week;
  } else if (u.mode === 'sprint') {
    const r = sprintWeeks(S, S.sprints[u.sprint - 1]);
    a = r ? r[0] : 1;
    b = r ? r[1] : W;
  } else if (u.mode === 'custom') {
    a = Math.min(u.from, u.to);
    b = Math.max(u.from, u.to);
  } else {
    a = 1;
    b = W;
  }
  return [a, b];
}

export function rlabel(S, a, b) {
  const m = S.ui.mode;
  if (m === 'week') return 'Week ' + a + ' · ' + wlabel(S, a);
  if (m === 'sprint')
    return 'Sprint ' + S.ui.sprint + ' · Weeks ' + a + (b > a ? '–' + b : '') + ' · ' + fsh(wkS(S, a)) + ' – ' + fsh(wkE(S, b));
  return (m === 'project' ? 'Whole project · ' : '') + 'Weeks ' + a + '–' + b + ' · ' + fsh(wkS(S, a)) + ' – ' + fsh(wkE(S, b));
}

/* ---------- "Needs attention" checks (returns [{cls, text}]) ---------- */
// Hours of a sprint: what the user planned (typed) against what its work items add up to (live), and how much of that is done
export const DEFAULT_RESERVE = { contingency: 0.1, management: 0.05 };

/* The budget as a structure:
     work budget (BAC)        team labour + line items. Earned value, SPI and CPI are measured against this.
     + contingency reserve    % of the work budget, held for identified risks   -> cost baseline
     + management reserve     % of the work budget, held for unknown risks      -> total project budget
   Until a baseline exists the amounts follow the percentages. From the first baseline on, percentages and amounts are the
   baseline's own (locked), so they do not move when the work budget moves; a change goes through a change request. */
export function reserves(S) {
  const base = projectBAC(S);
  const r2 = (n) => Math.round(n * 100) / 100;
  const rs = S.reserve || DEFAULT_RESERVE;
  const b = S.baselines && S.baselines.length ? S.baselines[S.baselines.length - 1] : null;
  const br = b && b.reserve;
  const contPct = br ? br.contPct : rs.contingency;
  const mgmtPct = br ? br.mgmtPct : rs.management;
  const contingency = br ? br.contingency : r2(base * contPct);
  const management = br ? br.management : r2(base * mgmtPct);
  return { base, contPct, mgmtPct, contingency, management, costBaseline: r2(base + contingency), total: r2(base + contingency + management), locked: !!b, version: b ? b.version : '' };
}

export function sprintHours(S, sp) {
  const items = rootTasks(sp.tasks).reduce((a, t) => a + nz(t.effort), 0); // top-level items already hold their children's hours
  const leaves = leafTasks(sp.tasks).filter((t) => !typeOf(S, t.type).milestone);
  const done = leaves.filter((t) => t.status && isDoneStatus(S, t.status)).reduce((a, t) => a + nz(t.effort), 0);
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
    const c = sp.crId && S.cr.find((x) => x.id === sp.crId);
    if (c && !['Approved', 'Implemented', 'Closed'].includes(c.status))
      a.push({ cls: 'warn', text: sp.name + ' was added through ' + c.code + ', which is ' + c.status.toLowerCase() + '. The sprint is not part of the approved plan until the change request is approved and implemented.' });
  });
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
  const wb = weeklyBAC(S);
  const over = [];
  for (let k = 1; k <= nW(S); k++) {
    const x = wk(S, k);
    if (x.ac != null && x.ac > wb) over.push(k);
  }
  if (over.length) a.push({ cls: 'bad', text: 'Actual cost is above the weekly budget in week' + (over.length > 1 ? 's ' : ' ') + over.join(', ') + '.' });
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

  // number of weeks: always from the data (latest dated task, sprint, completion or cost)
  m.weeks = autoWeeks(S);
  // labour budget rows hold total hours and off hours; rows from earlier versions start at the hours they used to imply
  // (weeks x hours per day x working days), so the budget does not change until the hours are edited
  S.team.forEach((t) => {
    if (t.hours == null) t.hours = Math.round(m.weeks * nz(m.hoursPerDay) * nz(m.sprintDays) * 100) / 100;
    t.hours = Math.max(0, nz(t.hours));
    t.off = Math.max(0, nz(t.off));
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

/* ---------- all projects together ---------- */
// Weeks are aligned by calendar (Monday based), so projects that start on different dates still line up.
export function portfolio(projects) {
  const WEEK = 7 * DAY;
  const mon = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
  const base = Math.min(...projects.map((p) => mon(pd(p.meta.start))));
  const last = Math.max(...projects.map((p) => mon(wkS(p, nW(p)))));
  const n = Math.round((last - base) / WEEK) + 1;
  const rows = Array.from({ length: n }, (_, k) => ({ k: k + 1, s: base + k * WEEK, e: base + k * WEEK + 6 * DAY, parts: [] }));
  projects.forEach((p) => {
    for (let w = 1; w <= nW(p); w++) {
      const k = Math.round((mon(wkS(p, w)) - base) / WEEK);
      if (rows[k]) rows[k].parts.push({ p, w, x: wk(p, w) });
    }
  });
  const sum = (parts, f) => {
    const v = parts.map(f).filter((a) => a != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  rows.forEach((r) => {
    r.pv = sum(r.parts, (q) => q.x.pv);
    r.ev = sum(r.parts, (q) => q.x.ev);
    r.ac = sum(r.parts, (q) => q.x.ac);
    const both = r.parts.filter((q) => q.x.pv != null && q.x.ev != null);
    const cost = r.parts.filter((q) => q.x.ev != null && q.x.ac != null);
    const pvR = both.reduce((a, q) => a + q.x.pv, 0), evR = both.reduce((a, q) => a + q.x.ev, 0);
    const evC = cost.reduce((a, q) => a + q.x.ev, 0), acC = cost.reduce((a, q) => a + q.x.ac, 0);
    r.spi = pvR ? evR / pvR : null;
    r.cpi = acC ? evC / acC : null;
  });
  const t = pd(today());
  const cur = rows.findIndex((r) => t >= r.s && t <= r.e);
  return { rows, cur: cur < 0 ? null : cur + 1 };
}
