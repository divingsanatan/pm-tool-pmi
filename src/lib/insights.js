import { evmSeries, inPlan, labourTotal, planBAC, projectEvm, reserves, sprintEvm, sprintHours } from './calc';
import { calendarOf, hasValidDates, sprintCalendar } from './offdays';
import { capacityBetween, planWindow, projectCapacity, settingsOf } from './capacity';
import { DAY, addDays, pd, today } from './dates';
import { isDoneStatus, statusesOf, typeOf } from './tasks';
import { leafTasks, ownDoneItems } from './hier';
import { nz } from './format';
import { planLineTotal } from './lineChange';
import { CR_STATUSES } from './change';
import { depIndex, isBlocked } from './deps';

/* Numbers behind the dashboard's charts. Everything is worked out from the live project and as of today. */

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const sundayStart = (ms) => { const d = new Date(ms); return ms - ((d.getUTCDay() + 6) % 7) * DAY; }; // Monday of that week

/* ---------- burn-up / burn-down (hours) ----------
   scope  = the hours of work in the plan (what each sprint planned, or what its work items add up to)
   ideal  = the hours that should be done by each day, following each sprint's working days
   done   = the hours of work items finished by each day (an item finished with no date counts on its due date)
   proj   = if work carries on at the pace of the last two weeks */
function doneByDay(S, sp, ms, now) {
  const n = ms.length, lo = ms[0];
  const at = (t) => Math.max(0, Math.min(n - 1, Math.round((t - lo) / DAY)));
  const done = Array(n).fill(0);
  const put = (t, h, fallback) => { done[at(Math.min(now, pd(t.doneOn || t.due || fallback || t.start || sp.start)))] += h; };
  leafTasks(sp.tasks).forEach((t) => {
    if (typeOf(S, t.type).milestone || !t.status || !isDoneStatus(S, t.status) || !nz(t.effort)) return;
    put(t, nz(t.effort), sp.end);
  });
  ownDoneItems(S, sp.tasks).forEach((t) => put(t, nz(t.ownEffort), sp.end));
  return done;
}
// a repeatable pseudo-random generator, so the forecast does not jump around between renders
function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];

/* Monte Carlo forecast. The weekly hours finished so far (zero weeks included) are drawn at random, again and again, until the
   remaining work is done: 1,500 possible futures. P50 is the middle outcome, P80 means 80 of 100 futures finish by then. */
function simulate(samples, left, doneNow, scope, seed) {
  const RUNS = 1500, K = 104;
  const rnd = rng(seed);
  const paths = Array.from({ length: RUNS }, () => new Float32Array(K + 1));
  const weeks = [];
  for (let r = 0; r < RUNS; r++) {
    let c = 0, fin = null;
    paths[r][0] = doneNow;
    for (let k = 1; k <= K; k++) {
      const x = samples[Math.floor(rnd() * samples.length)];
      if (fin == null && c + x >= left) fin = k - 1 + (x > 0 ? (left - c) / x : 1);
      c += x;
      paths[r][k] = Math.min(scope, doneNow + c);
    }
    weeks.push(fin == null ? Infinity : fin);
  }
  weeks.sort((a, b) => a - b);
  const w50 = quant(weeks, 0.5), w80 = quant(weeks, 0.8), w95 = quant(weeks, 0.95);
  const Kmax = Math.min(K, Math.max(4, Math.ceil(isFinite(w95) ? w95 : isFinite(w80) ? w80 : 26) + 1));
  const lo = [], mid = [], hi = [];
  for (let k = 0; k <= Kmax; k++) {
    const col = paths.map((x) => x[k]).sort((a, b) => a - b);
    lo.push(quant(col, 0.2)); mid.push(quant(col, 0.5)); hi.push(quant(col, 0.8));
  }
  return { w50, w80, w95, Kmax, lo, mid, hi };
}
const scopeOf = (S, sp) => { const h = sprintHours(S, sp); return h.planned > 0 ? h.planned : h.items; };

export function burnSeries(S, spId = '', asOf = today()) {
  const now = pd(asOf);
  const cal = calendarOf(S);
  const list = S.sprints.filter((sp) => (spId ? sp.id === spId : inPlan(S, sp)) && hasValidDates(sp));
  if (!list.length) return null;
  let lo = Math.min(...list.map((sp) => pd(sp.start))), hi = Math.max(...list.map((sp) => pd(sp.end)));
  const planEnd = hi;
  hi = Math.max(hi, now);
  const n0 = Math.round((hi - lo) / DAY) + 1;
  if (n0 > 1500) return null;
  let ms = Array.from({ length: n0 }, (_, i) => lo + i * DAY);
  const scope = list.reduce((a, sp) => a + scopeOf(S, sp), 0);
  if (!(scope > 0)) return null;
  const ideal = Array(n0).fill(0), done = Array(n0).fill(0);
  list.forEach((sp) => {
    const sc = scopeOf(S, sp), c = sprintCalendar(sp, null, cal), a = pd(sp.start);
    if (c && c.work > 0) for (let i = 0; i < n0; i++) { const k = Math.round((ms[i] - a) / DAY); ideal[i] += (sc * (k < 0 ? 0 : k >= c.cum.length ? c.work : c.cum[k])) / c.work; }
    const d = doneByDay(S, sp, ms, now);
    for (let i = 0; i < n0; i++) done[i] += d[i];
  });
  let cum = 0;
  const doneCum = done.map((v) => (cum += v));
  const nowIdx = now < lo ? -1 : Math.min(n0 - 1, Math.round((now - lo) / DAY));
  const doneNow = nowIdx >= 0 ? doneCum[nowIdx] : 0;
  // pace: hours done per day over the last 14 days, or over the whole time so far when nothing was done recently
  let pace = 0;
  if (nowIdx >= 0) {
    const back = Math.max(0, nowIdx - 14);
    pace = (doneCum[nowIdx] - doneCum[back]) / Math.max(1, nowIdx - back);
    if (!(pace > 0)) pace = doneCum[nowIdx] / Math.max(1, nowIdx + 1);
  }
  // weekly throughput so far: hours finished in each completed 7-day block since the first finished work
  const samples = [];
  if (nowIdx >= 0) {
    const first = doneCum.findIndex((v) => v > 0);
    if (first >= 0) for (let e = nowIdx; e - 7 >= Math.max(0, first - 1); e -= 7) samples.push(doneCum[e] - doneCum[e - 7]);
  }
  const leftNow = Math.max(0, scope - doneNow);
  const sim = nowIdx >= 0 && leftNow > 0 && samples.length >= 3 && samples.some((x) => x > 0) ? simulate(samples, leftNow, doneNow, scope, Math.round(scope * 100 + doneNow * 10 + nowIdx)) : null;
  let finishIdx = null;
  const left = Math.max(0, scope - doneNow);
  if (nowIdx >= 0 && left > 0 && pace > 0) finishIdx = nowIdx + Math.ceil(left / pace);
  else if (nowIdx >= 0 && left <= 0) finishIdx = doneCum.findIndex((v) => v >= scope - 1e-6);
  const n = Math.min(n0 + 400, Math.max(n0, finishIdx != null ? finishIdx + 1 : 0, sim ? nowIdx + sim.Kmax * 7 + 1 : 0));
  if (n > n0) {
    ms = ms.concat(Array.from({ length: n - n0 }, (_, i) => lo + (n0 + i) * DAY));
    for (let i = n0; i < n; i++) ideal.push(scope);
  }
  const proj = Array(n).fill(null);
  if (nowIdx >= 0 && left > 0 && pace > 0) for (let i = nowIdx; i < n; i++) proj[i] = Math.min(scope, doneNow + pace * (i - nowIdx));
  let mc = null;
  if (sim) {
    const at = (arr, i) => { const k = (i - nowIdx) / 7, a = Math.min(Math.floor(k), arr.length - 1), b = Math.min(arr.length - 1, a + 1); return arr[a] + (arr[b] - arr[a]) * (k - Math.floor(k)); };
    const band = (arr) => Array.from({ length: n }, (_, i) => (i < nowIdx ? null : at(arr, i)));
    const date = (w) => (isFinite(w) && w <= 104 ? iso(ms[nowIdx] + Math.round(w * 7) * DAY) : null);
    mc = { weeks: samples.length, p50: date(sim.w50), p80: date(sim.w80), p95: date(sim.w95), lo: band(sim.lo), mid: band(sim.mid), hi: band(sim.hi) };
  }
  const planEndIdx = Math.round((planEnd - lo) / DAY);
  return {
    ms, n, nowIdx, scope, ideal: ideal.map((v) => Math.min(scope, v)),
    done: Array.from({ length: n }, (_, i) => (i <= nowIdx && i < n0 ? doneCum[i] : null)),
    proj, pace, left, doneNow, planEndIdx, mc, samples: samples.length,
    undated: list.reduce((a, sp) => a + leafTasks(sp.tasks).filter((t) => t.status && isDoneStatus(S, t.status) && nz(t.effort) && !t.doneOn).length, 0),
    finish: finishIdx != null && finishIdx < n ? iso(ms[finishIdx]) : null, planEnd: iso(planEnd),
    slip: finishIdx != null ? finishIdx - planEndIdx : null,
  };
}

/* ---------- velocity: what each sprint planned against what it finished ---------- */
export function velocity(S) {
  return S.sprints.filter((sp) => inPlan(S, sp)).map((sp) => {
    const h = sprintHours(S, sp), plan = h.planned > 0 ? h.planned : h.items;
    return { id: sp.id, name: sp.name, planned: plan, items: h.items, done: h.done, pct: plan > 0 ? h.done / plan : null };
  }).filter((r) => r.planned > 0 || r.done > 0);
}

/* ---------- SPI and CPI over time (weekly) ---------- */
export function indexTrend(S, asOf = today()) {
  const s = evmSeries(S, asOf);
  if (s.nowIdx < 0) return null;
  const idx = [];
  for (let i = Math.min(s.nowIdx, 6); i <= s.nowIdx; i += 7) idx.push(i);
  for (let i = idx.length ? idx[idx.length - 1] + 7 : 7; i < s.nowIdx; i += 7) idx.push(i);
  if (idx[idx.length - 1] !== s.nowIdx) idx.push(s.nowIdx);
  const ms = idx.map((i) => s.ms[i]);
  const spi = idx.map((i) => (s.pv[i] > 0 && s.ev[i] != null ? s.ev[i] / s.pv[i] : null));
  const cpi = idx.map((i) => (s.ac[i] > 0 && s.ev[i] != null ? s.ev[i] / s.ac[i] : null));
  return spi.some((v) => v != null) || cpi.some((v) => v != null) ? { ms, spi, cpi } : null;
}

/* ---------- PMBOK forecasts at completion ---------- */
export function eacScenarios(S, asOf = today()) {
  const E = projectEvm(S, asOf), RS = reserves(S);
  if (!E.hasPlan) return null;
  const out = [];
  if (E.cpi > 0) out.push({ id: 'typical', name: 'Today’s cost performance continues', f: 'BAC ÷ CPI', eac: E.bac / E.cpi });
  out.push({ id: 'atypical', name: 'The overspend so far is a one-off', f: 'AC + (BAC − EV)', eac: E.ac + (E.bac - E.ev) });
  if (E.cpi > 0 && E.spi > 0) out.push({ id: 'both', name: 'Cost and schedule both keep their pace', f: 'AC + (BAC − EV) ÷ (CPI × SPI)', eac: E.ac + (E.bac - E.ev) / (E.cpi * E.spi) });
  return { list: out, bac: E.bac, total: RS.total, ac: E.ac };
}

/* ---------- budget against actual cost, by cost element ---------- */
export function costByElement(S) {
  const m = new Map();
  const add = (name, k, v) => { if (!m.has(name)) m.set(name, { name, planned: 0, actual: 0 }); m.get(name)[k] += v; };
  add('Team labour', 'planned', labourTotal(S));
  S.lines.forEach((l) => { if (!/reserve/i.test(l.name || '')) add(l.name || 'Line item', 'planned', planLineTotal(S, l)); }); // the reserves are held back, not a cost element
  (S.ledger || []).forEach((e) => add(e.element || 'Other', 'actual', nz(e.amount)));
  return [...m.values()].filter((r) => r.planned > 0 || r.actual > 0).sort((a, b) => b.planned + b.actual - (a.planned + a.actual));
}

/* ---------- earned value, sprint by sprint ---------- */
export function sprintPerformance(S, asOf = today()) {
  return S.sprints.filter((sp) => inPlan(S, sp)).map((sp) => {
    const e = sprintEvm(S, sp, asOf);
    return { id: sp.id, name: sp.name, pv: e.pv, ev: e.ev, ac: e.ac, sv: e.sv, cv: e.cv, spi: e.spi, cpi: e.cpi, start: sp.start, end: sp.end, budget: e.budget };
  });
}

/* ---------- work items by status in each sprint ---------- */
export function statusMix(S) {
  const sts = statusesOf(S);
  const rows = S.sprints.map((sp) => {
    const leaves = leafTasks(sp.tasks).filter((t) => !typeOf(S, t.type).milestone);
    const by = {};
    leaves.forEach((t) => { by[t.status] = (by[t.status] || 0) + 1; });
    return { id: sp.id, name: sp.name, n: leaves.length, by };
  }).filter((r) => r.n > 0);
  return { rows, statuses: sts.map((s) => ({ id: s.id, label: s.label, color: s.color || 'var(--muted)', done: !!s.done })) };
}

/* ---------- late and due-soon work ---------- */
export function dueWork(S, asOf = today()) {
  const late = [], soon = [];
  const limit = addDays(asOf, 7);
  S.sprints.forEach((sp) => leafTasks(sp.tasks).forEach((t) => {
    if (typeOf(S, t.type).milestone && !t.due) return;
    if (!t.due || (t.status && isDoneStatus(S, t.status))) return;
    const x = { t, sp, days: Math.round((pd(asOf) - pd(t.due)) / DAY) };
    if (t.due < asOf) late.push(x);
    else if (t.due <= limit) soon.push({ ...x, days: -x.days });
  }));
  late.sort((a, b) => b.days - a.days);
  soon.sort((a, b) => a.days - b.days);
  return { late, soon };
}

/* ---------- people: utilisation over the project, and week by week ---------- */
export function peopleLoad(S, asOf = today()) {
  const X = projectCapacity(S, asOf);
  return X.people.map((p) => {
    let load = 0, cap = 0, done = 0;
    p.cells.forEach((c) => { if (c) { load += c.load; cap += c.cap; done += c.done; } });
    return { id: p.id, name: p.name, load, cap, done, open: Math.max(0, load - done), util: cap > 0 ? load / cap : load > 0 ? Infinity : 0 };
  }).filter((r) => r.load > 0 || r.cap > 0).sort((a, b) => (b.util === Infinity ? 1e9 : b.util) - (a.util === Infinity ? 1e9 : a.util));
}

/* A person's work is spread evenly over the working days of each work item (shared items split between the assignees);
   a week's capacity is what the calendar and leave leave them. */
export function weeklyLoad(S) {
  const win = planWindow(S);
  if (!win || !win.startS || !win.endS) return null;
  const cal = calendarOf(S);
  const lo = sundayStart(pd(win.startS)), hi = pd(win.endS);
  const weeks = [];
  for (let t = lo; t <= hi && weeks.length < 60; t += 7 * DAY) weeks.push({ a: t, b: t + 6 * DAY, from: iso(t), to: iso(t + 6 * DAY) });
  if (!weeks.length) return null;
  const isWork = (ms) => !cal.weekly.includes(new Date(ms).getUTCDay()) && !cal.holidays.some((h) => ms >= h.a && ms <= h.b);
  const ids = new Set(S.people.map((p) => p.id));
  const load = new Map(); // person -> per-week hours
  const bump = (id, w, h) => { if (!load.has(id)) load.set(id, Array(weeks.length).fill(0)); load.get(id)[w] += h; };
  S.sprints.forEach((sp) => {
    const leaves = new Set(leafTasks(sp.tasks).map((t) => t.id));
    sp.tasks.forEach((t) => {
      if (typeOf(S, t.type).milestone) return;
      const h = leaves.has(t.id) ? nz(t.effort) : nz(t.ownEffort);
      const who = (t.assignees || []).filter((x) => ids.has(x));
      const s = t.start || t.due, f = t.due || t.start;
      if (!(h > 0) || !who.length || !s || !f) return;
      const a = pd(s), b = Math.max(a, pd(f));
      const days = [];
      for (let ms = a; ms <= b && days.length < 800; ms += DAY) if (isWork(ms)) days.push(ms);
      if (!days.length) days.push(a);
      days.forEach((ms) => {
        const w = Math.floor((sundayStart(ms) - lo) / (7 * DAY));
        if (w >= 0 && w < weeks.length) who.forEach((id) => bump(id, w, h / days.length / who.length));
      });
    });
  });
  const rows = S.people.map((p) => {
    const l = load.get(p.id);
    const st = settingsOf(S, p);
    if (!l && !(st.alloc > 0)) return null;
    const cells = weeks.map((w, i) => {
      const cap = capacityBetween(S, p, w.from, w.to).cap;
      const ld = l ? l[i] : 0;
      return { load: ld, cap, util: cap > 0 ? ld / cap : ld > 0.05 ? Infinity : 0 };
    });
    return { id: p.id, name: p.name || '(unnamed)', cells, load: cells.reduce((a, c) => a + c.load, 0) };
  }).filter((r) => r && (r.load > 0 || r.cells.some((c) => c.cap > 0))).sort((a, b) => b.load - a.load);
  const totals = weeks.map((w, i) => ({ load: rows.reduce((a, r) => a + r.cells[i].load, 0), cap: rows.reduce((a, r) => a + r.cells[i].cap, 0) }));
  return { weeks, rows, totals };
}

/* ---------- risks ---------- */
export function riskMatrix(S) {
  const cells = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => []));
  const open = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed');
  let unrated = 0;
  open.forEach((r) => {
    if (r.p >= 1 && r.p <= 5 && r.i >= 1 && r.i <= 5) cells[r.i - 1][r.p - 1].push(r);
    else unrated++;
  });
  const emv = open.map((r) => ({ r, v: r.probPct != null && r.cost != null ? r.probPct * r.cost : null })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
  return { cells, open: open.length, unrated, emv, emvTotal: emv.reduce((a, x) => a + x.v, 0), contingency: reserves(S).contingency };
}
export function raidMix(S) {
  const today0 = today();
  return ['Risk', 'Assumption', 'Issue', 'Dependency'].map((type) => {
    const l = S.raid.filter((r) => r.type === type);
    const open = l.filter((r) => r.status !== 'Closed');
    return { type, open: open.filter((r) => !(r.due && r.due < today0)).length, overdue: open.filter((r) => r.due && r.due < today0).length, closed: l.length - open.length };
  });
}

/* ---------- change requests ---------- */
export function changeMix(S) {
  const by = {};
  (S.cr || []).forEach((c) => { (by[c.status] = by[c.status] || []).push(c); });
  const rows = CR_STATUSES.map((s) => ({ status: s, n: (by[s] || []).length })).filter((r) => r.n > 0);
  const impl = (S.cr || []).filter((c) => c.status === 'Implemented' || c.status === 'Closed');
  const pending = (S.cr || []).filter((c) => ['Draft', 'Submitted', 'Under review', 'Approved'].includes(c.status));
  const cost = (c) => (c.apCost != null && c.status !== 'Draft' && c.status !== 'Submitted' && c.status !== 'Under review' ? nz(c.apCost) : nz(c.cost));
  const days = (c) => (c.apDays != null && c.status !== 'Draft' && c.status !== 'Submitted' && c.status !== 'Under review' ? nz(c.apDays) : nz(c.days));
  return {
    rows, total: (S.cr || []).length,
    costDone: impl.reduce((a, c) => a + cost(c), 0), daysDone: impl.reduce((a, c) => a + days(c), 0),
    costPending: pending.reduce((a, c) => a + cost(c), 0), daysPending: pending.reduce((a, c) => a + days(c), 0), pendingN: pending.length,
  };
}

/* ---------- dependencies and the critical path ---------- */
export function scheduleHealth(S) {
  const di = depIndex(S);
  const blocked = [];
  di.where.forEach(({ t, c }) => { if (isBlocked(di, t.id)) blocked.push({ t, c }); });
  return { total: di.all.length, blocked, conflicts: di.all.filter((e) => e.ev.state === 'conflict'), critical: di.cpm.list, length: di.cpm.length, end: di.cpm.end, external: di.all.filter((e) => !e.pred && !e.ev.met).length };
}

/* ---------- forecast finish from schedule performance ---------- */
export function spiFinish(S, asOf = today()) {
  const E = projectEvm(S, asOf);
  const sps = S.sprints.filter((sp) => inPlan(S, sp) && hasValidDates(sp));
  if (!sps.length || !(E.spi > 0)) return null;
  const a = Math.min(...sps.map((sp) => pd(sp.start))), b = Math.max(...sps.map((sp) => pd(sp.end)));
  const dur = (b - a) / DAY + 1;
  const fd = Math.round(dur / E.spi);
  return { planEnd: iso(b), forecastEnd: iso(a + (fd - 1) * DAY), slipDays: fd - Math.round(dur), spi: E.spi };
}

/* ---------- cumulative flow: work items by status, day by day (from the daily record) ---------- */
const holdDays = (H, asOf, cap = 400) => {
  if (!H.length) return [];
  const a = pd(H[0].d), b = pd(asOf);
  const n = Math.min(cap, Math.round((b - a) / DAY) + 1), lo = b - (n - 1) * DAY;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = iso(lo + i * DAY);
    while (j + 1 < H.length && H[j + 1].d <= d) j++;
    out.push({ ms: lo + i * DAY, e: H[j].d <= d ? H[j] : H[0] });
  }
  return out;
};
export function flowSeries(S, asOf = today()) {
  const H = (S.history || []).filter((e) => e.w).sort((x, y) => (x.d < y.d ? -1 : 1));
  const days = holdDays(H, asOf);
  if (days.length < 2) return { points: days.length };
  const sts = statusesOf(S);
  const order = sts.slice().reverse(); // finished work at the bottom, not started at the top
  const known = new Set(sts.map((x) => x.id));
  const layers = order.map((x) => ({ id: x.id, label: x.label, color: x.color || 'var(--muted)', done: !!x.done, values: days.map((d) => d.e.w[x.id] || 0) }));
  const other = days.map((d) => Object.keys(d.e.w).filter((k) => !known.has(k)).reduce((a, k) => a + d.e.w[k], 0));
  if (other.some((v) => v > 0)) layers.push({ id: '', label: 'No status', color: 'var(--line)', done: false, values: other });
  const n = days.length;
  const total = days.map((_, i) => layers.reduce((a, l) => a + l.values[i], 0));
  const doneV = days.map((_, i) => layers.filter((l) => l.done).reduce((a, l) => a + l.values[i], 0));
  const firstId = sts.length ? sts[0].id : null;
  const wipV = days.map((_, i) => layers.filter((l) => !l.done && l.id !== firstId && l.id !== '').reduce((a, l) => a + l.values[i], 0));
  const back = (k) => Math.max(0, n - 1 - k);
  const win = Math.min(28, n - 1);
  const thr = win > 0 ? Math.max(0, doneV[n - 1] - doneV[back(win)]) / (win / 7) : 0; // items finished per week
  const from = back(Math.min(14, n - 1));
  const wipAvg = wipV.slice(from).reduce((a, v) => a + v, 0) / (n - from);
  const firstReal = (S.history || []).find((e) => !e.est);
  return {
    points: n, ms: days.map((d) => d.ms), layers, total, wipNow: wipV[n - 1], wipAvg, thr,
    cycle: thr > 0 ? (wipAvg / thr) * 7 : null, // Little's law: average days an item spends in progress
    estUntil: firstReal && (S.history || []).some((e) => e.est) ? firstReal.d : null,
    nowIdx: n - 1,
  };
}

/* ---------- risk burn-down: open risks and their exposure over time ---------- */
export function riskSeries(S, asOf = today()) {
  const H = (S.history || []).filter((e) => e.k).sort((x, y) => (x.d < y.d ? -1 : 1));
  const days = holdDays(H, asOf);
  if (days.length < 2) return { points: days.length };
  const pick = (f) => days.map((d) => f(d.e.k));
  return {
    points: days.length, ms: days.map((d) => d.ms),
    hi: pick((k) => k.hi), me: pick((k) => k.me), lo: pick((k) => k.lo), un: pick((k) => k.un || 0),
    emv: pick((k) => k.emv), score: pick((k) => k.score), closed: pick((k) => k.closed || 0),
    open: pick((k) => k.hi + k.me + k.lo + (k.un || 0)), nowIdx: days.length - 1, since: H[0].d,
  };
}
