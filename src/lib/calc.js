import { DAY, pd, today, fsh } from './dates';
import { nz, cl } from './format';
import { DEFAULT_STATUSES, allContainers, firstOpenStatus, isDoneStatus, makeTask, statusPct, uid } from './tasks';

/* ---------- timeline helpers ---------- */
export const nW = (S) => S.meta.weeks;
export const wkS = (S, w) => pd(S.meta.start) + (w - 1) * 7 * DAY;
export const wkE = (S, w) => wkS(S, w) + 6 * DAY;
export const wlabel = (S, w) => fsh(wkS(S, w)) + ' – ' + fsh(wkE(S, w));
export const sprintOf = (S, w) => Math.ceil(w / S.meta.sprintWeeks);
export const nSp = (S) => Math.ceil(nW(S) / S.meta.sprintWeeks);
export function curWeek(S) {
  const w = Math.floor((pd(today()) - pd(S.meta.start)) / (7 * DAY)) + 1;
  return Math.max(1, Math.min(nW(S), w));
}
export const started = (S) => pd(today()) >= pd(S.meta.start);

/* ---------- work breakdown (derived from sprints and their tasks) ---------- */
// Flat list used by the Timeline and Dashboard: one Phase row per sprint, then its tasks as WP rows.
// The Backlog is not a sprint and is not scheduled work, so it is not part of this list.
export function wbsOf(S) {
  const rows = [];
  let n = 0;
  const add = (sp, id) => {
    rows.push({ id, name: sp.name, type: 'Phase', sprintId: sp.id });
    sp.tasks.forEach((t) =>
      rows.push({
        id: t.code, name: t.name, type: 'WP', sprintId: sp.id, taskId: t.id, assignees: t.assignees,
        hrs: t.effort, start: t.start || '', finish: t.due || '', pct: statusPct(S, t.status),
      })
    );
  };
  S.sprints.forEach((sp) => {
    n++;
    add(sp, String(n));
  });
  return rows;
}

export const wps = (S) => wbsOf(S).filter((x) => x.type === 'WP');

// Roll-up for one Phase row: hours, dates and completion (weighted by effort when tasks have it)
export function roll(S, p) {
  const k = wbsOf(S).filter((x) => x.type === 'WP' && x.sprintId === p.sprintId);
  const o = { hrs: 0, pct: null, n: k.length, s: null, f: null };
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
export const dailyCap = (S) => hourly(S) * nz(S.meta.hoursPerDay);
export const sprintCap = (S) => dailyCap(S) * nz(S.meta.sprintDays);
// planned cost of one budget line, expressed per week (one-time lines are not time-phased)
export function lineWeekly(S, l) {
  if (l.per === 'week') return nz(l.amount);
  if (l.per === 'month') return (nz(l.amount) * 12) / 52;
  if (l.per === 'sprint') return nz(l.amount) / Math.max(1, S.meta.sprintWeeks);
  return 0;
}
export const lineWeeklySum = (S) => S.lines.reduce((a, l) => a + lineWeekly(S, l), 0);
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
      get(l.name || 'Line item').planned += l.per === 'project' ? nz(l.amount) : lineWeekly(S, l) * nW(S);
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
  S.sprints.forEach((c) => c.tasks.forEach((t) => !isDoneStatus(S, t.status) && !raciOk(t.raci) && out.push(t.code)));
  return out;
}

/* ---------- status colours ---------- */
export const stCls = (v) => (v == null || !isFinite(v) ? 'neutral' : v >= 1 ? 'good' : v >= 0.9 ? 'warn' : 'bad');
export function worst(a, b) {
  const o = { bad: 3, warn: 2, good: 1, neutral: 0 };
  return o[a] >= o[b] ? a : b;
}

/* ---------- earned value ---------- */
export function wk(S, w) {
  const r = S.report[w - 1] || {};
  const B = weeklyBAC(S);
  return {
    w,
    plan: r.planPct,
    earn: r.earnPct,
    ac: weekAc(S, w),
    note: r.note || '',
    pv: r.planPct != null ? r.planPct * B : null,
    ev: r.earnPct != null ? r.earnPct * B : null,
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
  const sw = S.meta.sprintWeeks;
  let a, b;
  if (u.mode === 'week') {
    a = b = u.week;
  } else if (u.mode === 'sprint') {
    a = (u.sprint - 1) * sw + 1;
    b = Math.min(W, u.sprint * sw);
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
export function alerts(S) {
  const a = [];
  const cur = curWeek(S);
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
  const miss = [];
  if (started(S)) for (let w = 1; w < cur; w++) if (!hasData(S, w)) miss.push(w);
  if (miss.length)
    a.push({
      cls: 'warn',
      text:
        miss.length +
        ' past week' +
        (miss.length > 1 ? 's have' : ' has') +
        ' no report: ' +
        (miss.length > 6 ? 'weeks ' + miss[0] + ' to ' + miss[miss.length - 1] : 'week' + (miss.length > 1 ? 's ' : ' ') + miss.join(', ')) +
        '. Fill them in on the Weekly tracker.',
    });
  const wb = weeklyBAC(S);
  const over = [];
  for (let k = 1; k <= nW(S); k++) {
    const x = wk(S, k);
    if (x.ac != null && x.ac > wb) over.push(k);
  }
  if (over.length) a.push({ cls: 'bad', text: 'Actual cost is above the weekly budget in week' + (over.length > 1 ? 's ' : ' ') + over.join(', ') + '.' });
  const gaps = raciGaps(S);
  if (gaps.length)
    a.push({ cls: 'warn', text: 'RACI is incomplete for ' + gaps.length + ' open item' + (gaps.length > 1 ? 's' : '') + ' (needs one Accountable and at least one Responsible): ' + gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? '…' : '') + '.' });
  if (S.meta.weeksMode !== 'auto' && autoWeeks(S) > nW(S))
    a.push({ cls: 'warn', text: 'Some tasks, sprints or costs are dated after week ' + nW(S) + '. Extend the weeks on the Budget tab so they are counted.' });
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

/* ---------- keep state valid after any edit ---------- */
export function normalize(S) {
  const m = S.meta;
  if (!Array.isArray(S.sprints)) S.sprints = [];
  if (!S.backlog) S.backlog = { id: 'backlog', name: 'Backlog', tasks: [] };
  S.backlog.id = 'backlog';
  if (!S.counter) S.counter = 1;
  if (!S.tl || typeof S.tl !== 'object') S.tl = { scale: 'week', scope: 'project', sprintId: '', from: '', to: '' };
  if (!m.weeksMode) m.weeksMode = 'manual';
  if (!Array.isArray(S.raci)) S.raci = [];
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
      (t.subtasks || []).forEach((st) => {
        if (st.assignee !== undefined) {
          st.person = idForName(st.assignee) || '';
          delete st.assignee;
        }
      });
    })
  );

  const ids = new Set(S.people.map((p) => p.id));
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
    (t.subtasks || []).forEach((st) => {
      if (st.person && !ids.has(st.person)) st.person = '';
    });
  });

  // number of weeks: from the data, or whatever was typed
  if (m.weeksMode === 'auto') m.weeks = autoWeeks(S);
  m.weeks = Math.max(1, Math.min(104, Math.round(nz(m.weeks)) || 26));
  m.sprintWeeks = Math.max(1, Math.round(nz(m.sprintWeeks)) || 2);
  while (S.report.length < m.weeks) S.report.push({ planPct: null, earnPct: null, note: '' });

  const u = S.ui;
  const W = m.weeks;
  const SP = Math.ceil(W / m.sprintWeeks);
  u.week = cl(u.week, 1, W);
  u.sprint = cl(u.sprint, 1, SP);
  u.from = cl(u.from, 1, W);
  u.to = cl(u.to, 1, W);
  return S;
}
