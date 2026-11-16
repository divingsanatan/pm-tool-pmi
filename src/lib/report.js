import { DAY, addDays, fdate, pd, today } from './dates';
import { money, nz, hrsf, pc } from './format';
import { baseOf, evmSeries, inPlan, projectEnd, projectEvm, reserves, sprintEvm, sprintHours, stCls, worst } from './calc';
import { burnSeries, costByElement, raidMix, riskMatrix, scheduleHealth, spiFinish, velocity } from './insights';
import { pendingOf, CR_STATUSES } from './change';
import { firstOpenStatus, isDoneStatus, nameOf, statusOf, statusesOf, typeOf } from './tasks';
import { leafTasks } from './hier';
import { hasValidDates } from './offdays';
import * as CH from './reportCharts';

/* The Reports engine. buildReport(S, options) works out EVERYTHING a report shows and returns it as plain data
   (numbers, text, tables and chart drawings), so the screen, the PDF, the Excel file and the Markdown file can all print the same model.
   No figure is invented here: schedule and cost come from the same earned value functions as the Dashboard (calc.js, insights.js). */

export const SECTIONS = [
  ['schedule', 'Schedule'], ['cost', 'Cost'], ['work', 'Work progress'], ['pending', 'Pending tasks'],
  ['risks', 'Risks and issues'], ['changes', 'Change requests'], ['team', 'Team workload'], ['appendix', 'How the figures are calculated'],
];
export const SCOPES = [['project', 'Entire project'], ['sprint', 'One sprint'], ['custom', 'Custom dates']];

const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const x2 = (v) => (v == null || !isFinite(v) ? '–' : (Math.round(v * 100) / 100).toFixed(2));
const days = (a, b) => Math.round((pd(b) - pd(a)) / DAY);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const signedMoney = (v) => (v == null ? '–' : (v < 0 ? '−' : '') + money(Math.abs(v)));
const STATUS_HEX = { 'var(--muted)': '#8D9D97', 'var(--accent)': '#1B5E8C', 'var(--warn)': '#C9892B', 'var(--good)': '#1E7A4C', 'var(--bad)': '#A92E1C', 'var(--s4)': '#7C5BA8', 'var(--s3)': '#2E8B6A', 'var(--s2)': '#C9892B', 'var(--s5)': '#C2503C', 'var(--s6)': '#5F7A74' };
const hex = (c, i) => (typeof c === 'string' && c[0] === '#' ? c : STATUS_HEX[c] || CH.PAL.series[i % CH.PAL.series.length]);

const SCHED = { good: 'On schedule', warn: 'Slightly behind', bad: 'Behind schedule', neutral: 'Not enough data' };
const COST = { good: 'Within budget', warn: 'Slightly over budget', bad: 'Over budget', neutral: 'No cost recorded yet' };
const OVERALL = { good: 'On track', warn: 'Needs attention', bad: 'Off track', neutral: 'Not enough data' };

// the derived earned value measures from BAC, PV, EV and AC (the same formulas as projectEvm)
function derive(bac, pv, ev, ac) {
  const spi = pv > 0 ? ev / pv : null, cpi = ac > 0 ? ev / ac : null;
  const eac = cpi != null && cpi > 0 ? bac / cpi : null;
  return {
    bac, pv, ev, ac, spi, cpi, sv: ev - pv, cv: bac > 0 ? ev - ac : null, eac,
    etc: eac == null ? null : Math.max(0, eac - ac), vac: eac == null ? null : bac - eac,
    tcpi: bac > ac ? (bac - ev) / (bac - ac) : null,
    plannedPct: bac > 0 ? pv / bac : null, earnedPct: bac > 0 ? ev / bac : null, spentPct: bac > 0 ? ac / bac : null,
  };
}

// which period the report covers, and the date its figures are worked out "as of"
function windowOf(S, o, t0) {
  if (!S.sprints.length) return null;
  const dated = S.sprints.filter((sp) => inPlan(S, sp) && hasValidDates(sp));
  const pFrom = dated.length ? dated.map((s) => s.start).sort()[0] : S.meta.start;
  const pTo = dated.length ? dated.map((s) => s.end).sort().slice(-1)[0] : isoOf(projectEnd(S));
  if (o.scope === 'sprint') {
    const sp = S.sprints.find((s) => s.id === o.sprintId) || S.sprints[0];
    if (!sp) return null;
    const from = hasValidDates(sp) ? sp.start : pFrom, to = hasValidDates(sp) ? sp.end : pTo;
    return { scope: 'sprint', sp, from, to, asOf: t0 > to ? to : t0, name: sp.name, ids: new Set([sp.id]) };
  }
  if (o.scope === 'custom') {
    let from = o.from || pFrom, to = o.to || pTo;
    if (to < from) [from, to] = [to, from];
    const ids = new Set(S.sprints.filter((sp) => hasValidDates(sp) && sp.start <= to && sp.end >= from).map((sp) => sp.id));
    return { scope: 'custom', sp: null, from, to, asOf: t0 > to ? to : t0, name: fdate(from) + ' – ' + fdate(to), ids };
  }
  return { scope: 'project', sp: null, from: pFrom, to: pTo, asOf: t0, name: 'Entire project', ids: new Set(S.sprints.map((sp) => sp.id)) };
}

const ledgerUpTo = (S, asOf) => (S.ledger || []).filter((e) => !e.date || e.date <= asOf);
const ledgerIn = (S, a, b) => (S.ledger || []).filter((e) => e.date && e.date >= a && e.date <= b);
const sum = (l, f) => l.reduce((a, x) => a + nz(f(x)), 0);

export function buildReport(S, o = {}) {
  const t0 = today();
  const W = windowOf(S, o, t0);
  const sections = o.sections || SECTIONS.map(([id]) => id);
  const on = (id) => sections.includes(id);
  const title = (o.title || '').trim() || (S.meta.name || 'Project') + ' – status report';
  const R = { title, project: S.meta.name || 'Project', preparedBy: (o.preparedBy || '').trim(), notes: (o.notes || '').trim(), generated: new Date().toISOString(), sections: sections.slice() };
  if (!W) return Object.assign(R, { empty: 'This project has no sprints yet, so there is nothing to report.' });
  const { scope, sp, from, to, asOf } = W;
  const sps = S.sprints.filter((s) => W.ids.has(s.id));
  Object.assign(R, { scope, scopeLabel: scope === 'project' ? 'Entire project' : scope === 'sprint' ? 'Sprint: ' + W.name : 'Custom dates', period: fdate(from) + ' – ' + fdate(to), from, to, asOf, asOfLabel: fdate(asOf) });
  R.future = from > t0;
  const noun = scope === 'sprint' ? 'sprint' : scope === 'custom' ? 'project' : 'project';

  /* ---------- the work items in this report ---------- */
  const items = [];
  sps.forEach((s) => leafTasks(s.tasks).forEach((t) => { if (!typeOf(S, t.type).milestone) items.push({ t, s }); }));
  const done = (t) => !!t.status && isDoneStatus(S, t.status);
  const openItems = items.filter((x) => !done(x.t));
  const who = (t) => ((t.assignees || []).map((id) => nameOf(S, id)).filter(Boolean).join(', ')) || 'Unassigned';
  const row = (x, extra = {}) => ({ code: x.t.code, name: x.t.name, sprint: x.s.name, who: who(x.t), due: x.t.due || '', status: statusOf(S, x.t.status).label, hours: nz(x.t.effort), ...extra });

  /* ---------- earned value figures ---------- */
  let fig;
  if (scope === 'sprint') {
    const e = sprintEvm(S, sp, asOf);
    fig = Object.assign(derive(e.budget, e.pv, e.ev, e.ac), { ok: e.budget > 0 && e.planned > 0 && e.hasDates, sprint: e });
  } else {
    const E = projectEvm(S, asOf);
    const ac = asOf >= t0 ? E.ac : sum(ledgerUpTo(S, asOf), (e) => e.amount); // an earlier "as of" date counts only the cost recorded by then
    fig = Object.assign(derive(E.bac, E.pv, E.ev, ac), { ok: E.hasPlan, E });
    if (scope === 'custom' && fig.ok) {
      const E0 = projectEvm(S, addDays(from, -1));
      fig.period = { dPV: E.pv - E0.pv, dEV: E.ev - E0.ev, dAC: sum(ledgerIn(S, from, asOf), (e) => e.amount) };
    }
  }
  R.fig = fig;
  const spiCls = fig.ok ? stCls(fig.spi) : 'neutral', cpiCls = fig.ok ? stCls(fig.cpi) : 'neutral';
  let overall = fig.ok ? worst(spiCls, cpiCls) : 'neutral';
  if (overall === 'good' && (spiCls === 'neutral' || cpiCls === 'neutral')) overall = 'neutral'; // never "on track" when one of the two cannot be measured
  R.status = { overall: { cls: overall, label: OVERALL[overall] }, schedule: { cls: spiCls, label: SCHED[spiCls], spi: fig.spi }, cost: { cls: cpiCls, label: COST[cpiCls], cpi: fig.cpi } };

  /* ---------- schedule ---------- */
  const sch = { kpis: [], sprints: [], forecast: [], milestones: [], chart: '', chartNote: '', blocked: [], late: 0 };
  const sprintRows = sps.map((s) => {
    const e = sprintEvm(S, s, asOf);
    return { id: s.id, name: s.name, start: s.start, end: s.end, status: e.status, cls: e.cls, why: e.why, budget: e.budget, plannedPct: e.plannedPct, earnedPct: e.earnedPct, pv: e.pv, ev: e.ev, ac: e.ac, spi: e.spi, cpi: e.cpi, plannedH: e.planned, doneH: e.doneH, openH: e.openH, inPlan: inPlan(S, s) };
  });
  sch.sprints = sprintRows;
  if (fig.ok) {
    sch.kpis = [
      { l: 'Planned progress', v: pc(fig.plannedPct, 0), s: 'should be done by ' + fdate(asOf) },
      { l: 'Earned progress', v: pc(fig.earnedPct, 0), s: 'actually done' },
      { l: 'SPI', v: x2(fig.spi), s: 'earned ÷ planned (1.00 = on plan)', cls: spiCls },
      { l: 'Schedule variance', v: signedMoney(fig.sv), s: 'earned − planned value', cls: fig.sv >= 0 ? 'good' : spiCls },
    ];
  }
  // forecast finish
  const bs = burnSeries(S, scope === 'sprint' ? sp.id : '', asOf);
  const planEnd = scope === 'sprint' ? to : bs ? bs.planEnd : to;
  sch.forecast.push({ l: 'Planned end', v: fdate(planEnd), s: scope === 'sprint' ? 'sprint end date' : 'last sprint end in the approved plan' });
  let slipPace = null, slipSpi = null;
  if (scope !== 'sprint') {
    const sf = spiFinish(S, asOf);
    if (sf) { slipSpi = sf.slipDays; sch.forecast.push({ l: 'Forecast at current SPI', v: fdate(sf.forecastEnd), s: sf.slipDays > 0 ? sf.slipDays + ' days late' : sf.slipDays < 0 ? Math.abs(sf.slipDays) + ' days early' : 'on time', cls: sf.slipDays > 7 ? 'bad' : sf.slipDays > 0 ? 'warn' : 'good' }); }
  }
  if (bs && bs.finish) {
    slipPace = bs.slip;
    sch.forecast.push({ l: 'Forecast at recent pace', v: fdate(bs.finish), s: (bs.slip > 0 ? bs.slip + ' days late' : bs.slip < 0 ? Math.abs(bs.slip) + ' days early' : 'on time') + ' · pace of the last 14 days', cls: bs.slip > 7 ? 'bad' : bs.slip > 0 ? 'warn' : 'good' });
  }
  if (bs && bs.mc && bs.mc.p80) sch.forecast.push({ l: '80% confidence finish', v: fdate(bs.mc.p80), s: 'simulated from past weekly output (half the futures finish by ' + fdate(bs.mc.p50) + ')' });
  // chart
  try {
    if (scope === 'sprint' && bs) {
      sch.chart = CH.lineChart({ ms: bs.ms, nowIdx: bs.nowIdx, label: 'Sprint burn-up in hours', unit: ' h', series: [
        { name: 'Scope (h)', color: CH.PAL.pv, values: bs.ms.map(() => bs.scope), dash: '5 4' }, { name: 'Ideal', color: CH.PAL.warn, values: bs.ideal }, { name: 'Done', color: CH.PAL.ev, values: bs.done }, { name: 'At recent pace', color: CH.PAL.ev, values: bs.proj, dash: '4 4' },
      ] });
      sch.chartNote = 'Hours of work: the scope of the sprint, the ideal line over its working days, and the hours actually finished.';
    } else if (fig.ok) {
      const s = evmSeries(S, asOf);
      let i0 = 0, i1 = s.ms.length - 1;
      if (scope === 'custom') { i0 = Math.max(0, s.ms.findIndex((m) => m >= pd(from))); const j = s.ms.map((m) => m <= pd(to)).lastIndexOf(true); i1 = j < 0 ? i1 : j; if (i1 - i0 < 2) { i0 = 0; i1 = s.ms.length - 1; } }
      const cut = (a) => a.slice(i0, i1 + 1);
      sch.chart = CH.lineChart({ ms: cut(s.ms), nowIdx: s.nowIdx >= i0 && s.nowIdx <= i1 ? s.nowIdx - i0 : -1, label: 'Planned value against earned value', series: [{ name: 'Planned value', color: CH.PAL.pv, values: cut(s.pv) }, { name: 'Earned value', color: CH.PAL.ev, values: cut(s.ev) }] });
      sch.chartNote = 'Planned value is the budget the plan says should be earned by each day; earned value is the budget of the work actually finished. When the blue line is below the grey one, the work is behind.';
      R._series = s;
    }
  } catch (e) { sch.chartNote = 'The chart could not be drawn: ' + e.message; }
  // milestones
  const ms = [];
  sps.forEach((s) => s.tasks.forEach((t) => {
    if (!typeOf(S, t.type).milestone) return;
    const d = t.due || t.start;
    if (!d) return;
    const isDone = done(t);
    ms.push({ code: t.code, name: t.name, sprint: s.name, date: d, done: isDone, state: isDone ? 'Done' : d < asOf ? 'Late by ' + plural(days(d, asOf), 'day') : d === asOf ? 'Due today' : 'In ' + plural(days(asOf, d), 'day'), cls: isDone ? 'good' : d < asOf ? 'bad' : 'neutral' });
  }));
  ms.sort((a, b) => (a.date < b.date ? -1 : 1));
  sch.milestones = ms.filter((m) => !m.done || (m.date >= from && m.date <= to)).slice(0, 10);
  sch.lateMilestones = ms.filter((m) => !m.done && m.date < asOf).length;
  // dependencies
  try {
    const h = scheduleHealth(S);
    sch.blocked = h.blocked.filter((b) => W.ids.has(b.c.id)).map((b) => ({ code: b.t.code, name: b.t.name, sprint: b.c.name }));
    if (scope !== 'sprint') sch.critical = { n: h.critical.length, end: h.end || '', length: h.length };
    sch.conflicts = h.conflicts.length;
  } catch (e) { /* dependencies are optional */ }
  R.schedule = sch;

  /* ---------- cost ---------- */
  const cost = { kpis: [], eac: [], compare: '', elements: [], spends: [], reserve: null, notes: [] };
  if (fig.ok) {
    cost.kpis = [
      { l: scope === 'sprint' ? 'Sprint budget' : 'Budget (BAC)', v: money(fig.bac), s: scope === 'sprint' ? 'its share of the approved budget' : (baseOf(S) ? 'approved baseline ' + baseOf(S).version : 'live plan, no baseline yet') },
      { l: 'Actual cost', v: money(fig.ac), s: pc(fig.spentPct, 0) + ' of budget spent' },
      { l: 'Earned value', v: money(fig.ev), s: pc(fig.earnedPct, 0) + ' of budget earned' },
      { l: 'CPI', v: x2(fig.cpi), s: 'earned ÷ actual cost (1.00 = on budget)', cls: cpiCls },
      { l: 'Cost variance', v: signedMoney(fig.cv), s: 'earned − actual cost', cls: fig.cv == null ? 'neutral' : fig.cv >= 0 ? 'good' : cpiCls },
      { l: 'Forecast at completion', v: fig.eac == null ? '–' : money(fig.eac), s: fig.vac == null ? 'needs recorded cost' : fig.vac >= 0 ? money(fig.vac) + ' under budget' : money(-fig.vac) + ' over budget', cls: fig.vac == null ? 'neutral' : fig.vac >= 0 ? 'good' : 'bad' },
    ];
    // three ways of forecasting the cost at completion
    if (fig.cpi > 0) cost.eac.push({ name: 'Today’s cost performance continues', f: 'BAC ÷ CPI', v: fig.bac / fig.cpi });
    cost.eac.push({ name: 'The overspend so far is a one-off', f: 'AC + (BAC − EV)', v: fig.ac + (fig.bac - fig.ev) });
    if (fig.cpi > 0 && fig.spi > 0) cost.eac.push({ name: 'Cost and schedule both keep their pace', f: 'AC + (BAC − EV) ÷ (CPI × SPI)', v: fig.ac + (fig.bac - fig.ev) / (fig.cpi * fig.spi) });
    cost.eac.forEach((r) => { r.vac = fig.bac - r.v; });
    try {
      const rows = [{ label: scope === 'sprint' ? 'Sprint budget' : 'Budget (BAC)', value: fig.bac, color: CH.PAL.muted }, { label: 'Planned value', value: fig.pv, color: CH.PAL.pv }, { label: 'Earned value', value: fig.ev, color: CH.PAL.ev }, { label: 'Actual cost', value: fig.ac, color: CH.PAL.ac }];
      if (fig.eac != null) rows.push({ label: 'Forecast at completion', value: fig.eac, color: fig.eac > fig.bac ? CH.PAL.bad : CH.PAL.good });
      cost.compare = CH.hbars({ rows: rows.map((r) => ({ ...r, text: money(r.value) })), label: 'Budget, planned, earned, actual and forecast cost' });
    } catch (e) { /* chart is optional */ }
    if (scope !== 'sprint' && R._series) {
      const s = R._series;
      let i0 = 0, i1 = s.ms.length - 1;
      if (scope === 'custom') { i0 = Math.max(0, s.ms.findIndex((m) => m >= pd(from))); const j = s.ms.map((m) => m <= pd(to)).lastIndexOf(true); i1 = j < 0 ? i1 : j; if (i1 - i0 < 2) { i0 = 0; i1 = s.ms.length - 1; } }
      const cut = (a) => a.slice(i0, i1 + 1);
      cost.curve = CH.lineChart({ ms: cut(s.ms), nowIdx: s.nowIdx >= i0 && s.nowIdx <= i1 ? s.nowIdx - i0 : -1, label: 'Earned value against actual cost', refs: [{ value: fig.bac, label: 'Budget ' + money(fig.bac), color: CH.PAL.muted }], series: [{ name: 'Earned value', color: CH.PAL.ev, values: cut(s.ev) }, { name: 'Actual cost', color: CH.PAL.ac, values: cut(s.ac) }] });
    }
  }
  // spend by cost element
  let elems = [];
  if (scope === 'project') {
    elems = costByElement(S).map((r) => ({ name: r.name, planned: r.planned, actual: r.actual }));
    cost.elementsNote = 'Planned is the budget of each cost element; actual is the total of the cost entries recorded on the Budget tab.';
  } else {
    const list = scope === 'sprint' ? fig.sprint.entries : ledgerIn(S, from, asOf);
    const by = new Map();
    list.forEach((e) => { const k = e.element || 'Other'; by.set(k, (by.get(k) || 0) + nz(e.amount)); });
    elems = [...by.entries()].map(([name, actual]) => ({ name, planned: null, actual })).sort((a, b) => b.actual - a.actual);
    cost.elementsNote = 'Cost entries dated ' + (scope === 'sprint' ? 'inside the sprint' : fdate(from) + ' to ' + fdate(asOf)) + ', by cost element.';
    cost.spends = list.slice().sort((a, b) => nz(b.amount) - nz(a.amount)).slice(0, 6).map((e) => ({ date: e.date, element: e.element || 'Other', desc: e.desc || '', amount: nz(e.amount) }));
    cost.spentInPeriod = sum(list, (e) => e.amount);
    cost.entriesInPeriod = list.length;
  }
  cost.elements = elems;
  try {
    if (scope === 'project' && elems.length) cost.elementsChart = CH.groupedBars({ rows: elems.slice(0, 10).map((r) => ({ label: r.name, a: r.planned, b: r.actual })), names: ['Planned', 'Actual'], colors: [CH.PAL.pv, CH.PAL.ac], fmt: (v) => money(v), label: 'Planned and actual cost by cost element' });
    else if (elems.length) cost.elementsChart = CH.hbars({ rows: elems.slice(0, 10).map((r) => ({ label: r.name, value: r.actual, color: CH.PAL.ac, text: money(r.actual) })), label: 'Actual cost by cost element' });
  } catch (e) { /* chart is optional */ }
  if (scope !== 'sprint') {
    const rs = reserves(S), po = pendingOf(S);
    cost.reserve = { contingency: rs.contingency, management: rs.management, total: rs.total, locked: rs.locked, version: rs.version, pendingCost: po.openCost + po.apprCost, pendingDays: po.openDays + po.apprDays, pendingN: po.open.length + po.appr.length };
  }
  R.cost = cost;

  /* ---------- work progress ---------- */
  const work = { kpis: [], byStatus: [], sprints: [], chart: '', velocityChart: '' };
  const H = sps.reduce((a, s) => { const h = sprintHours(S, s); return { planned: a.planned + (h.planned > 0 ? h.planned : h.items), items: a.items + h.items, done: a.done + h.done }; }, { planned: 0, items: 0, done: 0 });
  const hTotal = H.planned > 0 ? H.planned : H.items;
  const nDone = items.filter((x) => done(x.t)).length;
  const first = firstOpenStatus(S);
  const inProg = items.filter((x) => !done(x.t) && x.t.status && x.t.status !== first).length;
  work.n = items.length; work.done = nDone; work.inProgress = inProg; work.hoursDone = H.done; work.hoursTotal = hTotal; work.pct = hTotal > 0 ? Math.min(1, H.done / hTotal) : items.length ? nDone / items.length : null;
  work.kpis = [
    { l: 'Work items done', v: nDone + ' of ' + items.length, s: items.length ? pc(nDone / items.length, 0) + ' of items' : 'no work items' },
    { l: 'Hours done', v: hrsf(H.done) + ' of ' + hrsf(hTotal), s: work.pct == null ? '' : pc(work.pct, 0) + ' of planned hours' },
    { l: 'In progress', v: String(inProg), s: 'started, not yet done' },
    { l: 'Not started', v: String(items.filter((x) => !done(x.t) && (!x.t.status || x.t.status === first)).length), s: 'still waiting' },
  ];
  const doneDate = (t) => t.doneOn || t.due || '';
  if (scope === 'custom') {
    const d = items.filter((x) => done(x.t) && doneDate(x.t) >= from && doneDate(x.t) <= asOf);
    work.completedInPeriod = { n: d.length, hours: sum(d, (x) => x.t.effort) };
    work.kpis.push({ l: 'Completed in this period', v: String(d.length), s: hrsf(work.completedInPeriod.hours) + ' h finished ' + fdate(from) + ' – ' + fdate(asOf) });
  }
  const sts = statusesOf(S);
  work.byStatus = sts.map((s, i) => ({ id: s.id, label: s.label, color: hex(s.color, i), n: items.filter((x) => x.t.status === s.id).length, done: !!s.done })).concat([{ id: '', label: 'No status', color: '#C9D1CE', n: items.filter((x) => !x.t.status).length, done: false }]).filter((r) => r.n > 0);
  work.sprints = sps.map((s) => {
    const it = items.filter((x) => x.s.id === s.id);
    const h = sprintHours(S, s);
    return { name: s.name, n: it.length, done: it.filter((x) => done(x.t)).length, byStatus: sts.map((st) => it.filter((x) => x.t.status === st.id).length), hPlanned: h.planned > 0 ? h.planned : h.items, hDone: h.done };
  });
  try {
    const rows = sps.filter((s) => items.some((x) => x.s.id === s.id)).map((s) => ({ label: s.name, total: items.filter((x) => x.s.id === s.id).length, segs: sts.map((st, i) => ({ v: items.filter((x) => x.s.id === s.id && x.t.status === st.id).length, color: hex(st.color, i) })) }));
    const legend = sts.map((st, i) => ({ label: st.label, color: hex(st.color, i) }));
    if (rows.length) work.chart = CH.stackedRows({ rows, legend, label: 'Work items by status in each sprint' });
    const v = velocity(S).filter((r) => W.ids.has(r.id));
    if (v.length > 1 || (v.length === 1 && scope === 'sprint')) work.velocityChart = CH.groupedBars({ rows: v.map((r) => ({ label: r.name, a: r.planned, b: r.done })), names: ['Planned hours', 'Done hours'], colors: [CH.PAL.pv, CH.PAL.good], fmt: (x) => hrsf(x) + ' h', label: 'Planned and done hours by sprint' });
  } catch (e) { /* charts are optional */ }
  const backlog = leafTasks(S.backlog.tasks).filter((t) => !typeOf(S, t.type).milestone);
  work.backlog = scope === 'project' ? { n: backlog.length, hours: sum(backlog, (t) => t.effort) } : null;
  work.sprintsDone = scope === 'project' ? { done: sprintRows.filter((r) => r.status === 'Complete').length, total: sprintRows.length } : null;
  R.work = work;

  /* ---------- pending tasks ---------- */
  const lim = addDays(asOf, 7);
  const lateX = openItems.filter((x) => x.t.due && x.t.due < asOf).sort((a, b) => (a.t.due < b.t.due ? -1 : 1));
  const soonX = openItems.filter((x) => x.t.due && x.t.due >= asOf && x.t.due <= lim).sort((a, b) => (a.t.due < b.t.due ? -1 : 1));
  const noDueX = openItems.filter((x) => !x.t.due);
  const unassignedX = openItems.filter((x) => !(x.t.assignees || []).length);
  const pend = {
    open: openItems.length, openHours: sum(openItems, (x) => x.t.effort), lateN: lateX.length, soonN: soonX.length, noDueN: noDueX.length, unassignedN: unassignedX.length,
    late: lateX.slice(0, 15).map((x) => row(x, { days: days(x.t.due, asOf) })), soon: soonX.slice(0, 10).map((x) => row(x, { days: days(asOf, x.t.due) })), noDue: noDueX.slice(0, 8).map((x) => row(x)),
    moreLate: Math.max(0, lateX.length - 15), moreSoon: Math.max(0, soonX.length - 10), moreNoDue: Math.max(0, noDueX.length - 8),
    blocked: sch.blocked, lateHours: sum(lateX, (x) => x.t.effort),
  };
  pend.kpis = [
    { l: 'Open work items', v: String(pend.open), s: hrsf(pend.openHours) + ' h still to do' },
    { l: 'Overdue', v: String(pend.lateN), s: hrsf(pend.lateHours) + ' h past their due date', cls: pend.lateN === 0 ? 'good' : pend.lateN <= 3 ? 'warn' : 'bad' },
    { l: 'Due in 7 days', v: String(pend.soonN), s: fdate(asOf) + ' – ' + fdate(lim) },
    { l: 'No due date', v: String(pend.noDueN), s: 'cannot be tracked against the plan', cls: pend.noDueN ? 'warn' : 'good' },
  ];
  R.pending = pend;

  /* ---------- team workload (this report's work items) ---------- */
  const people = new Map();
  const slot = (k) => { if (!people.has(k)) people.set(k, { name: k, open: 0, late: 0, openH: 0, done: 0, doneH: 0 }); return people.get(k); };
  items.forEach((x) => {
    const names = (x.t.assignees || []).map((id) => nameOf(S, id)).filter(Boolean);
    const list = names.length ? names : ['Unassigned'];
    list.forEach((nm) => {
      const p = slot(nm), h = nz(x.t.effort) / list.length;
      if (done(x.t)) { p.done++; p.doneH += h; } else { p.open++; p.openH += h; if (x.t.due && x.t.due < asOf) p.late++; }
    });
  });
  R.team = { rows: [...people.values()].sort((a, b) => b.openH - a.openH || b.doneH - a.doneH).map((p) => ({ ...p, openH: Math.round(p.openH * 10) / 10, doneH: Math.round(p.doneH * 10) / 10 })) };

  /* ---------- risks and issues (the RAID log belongs to the whole project) ---------- */
  const rm = riskMatrix(S);
  const rScore = (r) => (r.p >= 1 && r.i >= 1 ? r.p * r.i : 0);
  const band = (s) => (s >= 15 ? 'High' : s >= 8 ? 'Medium' : s > 0 ? 'Low' : 'Not rated');
  const openRaid = (S.raid || []).filter((r) => r.status !== 'Closed');
  const openRisks = openRaid.filter((r) => r.type === 'Risk');
  const hi = openRisks.filter((r) => rScore(r) >= 15).length, me = openRisks.filter((r) => rScore(r) >= 8 && rScore(r) < 15).length, lo = openRisks.filter((r) => rScore(r) > 0 && rScore(r) < 8).length;
  const rdRow = (r) => ({ id: r.id, type: r.type, desc: r.desc || '(no description)', owner: r.owner || '–', rating: band(rScore(r)), score: rScore(r) || null, exposure: r.type === 'Risk' && r.probPct != null && r.cost != null ? r.probPct * r.cost : null, status: r.status, due: r.due || '', resp: r.resp || '', overdue: !!(r.due && r.due < asOf) });
  const created = (S.activity || []).filter((e) => e.cat === 'raid' && e.act === 'created' && e.at && e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= asOf);
  R.risks = {
    scopeNote: scope === 'project' ? '' : 'The RAID log belongs to the whole project, so this section is the same in every report.',
    openRisks: openRisks.length, hi, me, lo, unrated: rm.unrated, emvTotal: rm.emvTotal, contingency: rm.contingency,
    kpis: [
      { l: 'Open risks', v: String(openRisks.length), s: hi + ' high · ' + me + ' medium · ' + lo + ' low' + (rm.unrated ? ' · ' + rm.unrated + ' not rated' : ''), cls: hi ? (hi >= 3 ? 'bad' : 'warn') : 'good' },
      { l: 'Expected cost of risks', v: rm.emv.length ? money(rm.emvTotal) : '–', s: rm.emv.length ? 'against ' + money(rm.contingency) + ' contingency' : 'no probability and cost entered', cls: rm.emv.length && rm.emvTotal > rm.contingency ? 'bad' : 'neutral' },
      { l: 'Open issues', v: String(openRaid.filter((r) => r.type === 'Issue').length), s: 'raised, not yet closed' },
      { l: 'Overdue RAID items', v: String(openRaid.filter((r) => r.due && r.due < asOf).length), s: 'past their due date', cls: openRaid.some((r) => r.due && r.due < asOf) ? 'warn' : 'good' },
    ],
    top: openRisks.slice().sort((a, b) => rScore(b) - rScore(a) || nz(b.probPct) * nz(b.cost) - nz(a.probPct) * nz(a.cost)).slice(0, 8).map(rdRow),
    issues: openRaid.filter((r) => r.type === 'Issue').slice(0, 8).map(rdRow),
    overdue: openRaid.filter((r) => r.due && r.due < asOf).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 8).map(rdRow),
    mix: raidMix(S), addedInPeriod: S.activity && S.activity.length ? created.length : null, logSince: S.activity && S.activity.length ? S.activity[0].at.slice(0, 10) : '',
  };
  try { R.risks.grid = CH.riskGrid({ cells: rm.cells }); } catch (e) { /* chart is optional */ }

  /* ---------- change requests ---------- */
  const po = pendingOf(S);
  const crRow = (c) => ({ code: c.code, title: c.title || '(untitled)', status: c.status, priority: c.priority || '', cost: nz(c.apCost != null && c.status === 'Approved' ? c.apCost : c.cost), days: nz(c.apDays != null && c.status === 'Approved' ? c.apDays : c.days), since: c.submittedOn || c.on || '' });
  const byStatus = {};
  (S.cr || []).forEach((c) => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  const b = baseOf(S);
  R.changes = {
    total: (S.cr || []).length, baseline: b ? b.version : '', baselines: (S.baselines || []).length,
    mix: CR_STATUSES.map((s) => ({ status: s, n: byStatus[s] || 0 })).filter((r) => r.n > 0),
    awaiting: po.open.map(crRow), approved: po.appr.map(crRow), awaitingCost: po.openCost, awaitingDays: po.openDays, approvedCost: po.apprCost, approvedDays: po.apprDays,
    implementedInPeriod: (S.cr || []).filter((c) => c.implementedOn && c.implementedOn >= from && c.implementedOn <= asOf).map(crRow),
  };

  /* ---------- the summary on page one ---------- */
  const pts = [];
  const add = (area, tone, text) => pts.push({ area, tone, text });
  if (!fig.ok) {
    add('Schedule and cost', 'warn', 'The plan for this ' + noun + ' is not set up yet (planned hours, dates or budget are missing), so schedule and cost performance cannot be measured.');
  } else {
    const word = fig.spi >= 1.05 ? 'ahead of plan' : fig.spi >= 1 ? 'on plan' : fig.spi >= 0.9 ? 'slightly behind plan' : fig.spi >= 0.8 ? 'behind plan' : 'well behind plan';
    add('Schedule', spiCls, (scope === 'sprint' ? 'The sprint is ' : 'The ' + noun + ' is ') + word + ': ' + pc(fig.plannedPct, 0) + ' of the planned work should be done by ' + fdate(asOf) + ' and ' + pc(fig.earnedPct, 0) + ' is done (SPI ' + x2(fig.spi) + ').');
    if (scope === 'sprint') {
      if (fig.sprint && fig.sprint.status) add('Schedule', fig.sprint.cls === 'neutral' ? 'warn' : fig.sprint.cls, 'Sprint status: ' + fig.sprint.status + '. ' + fig.sprint.why);
      if (bs && bs.finish && bs.left > 0) add('Schedule', bs.slip > 0 ? (bs.slip > 7 ? 'bad' : 'warn') : 'good', 'At the pace of the last 14 days the remaining ' + hrsf(bs.left) + ' h of work finishes on ' + fdate(bs.finish) + ', ' + (bs.slip > 0 ? plural(bs.slip, 'day') + ' after' : bs.slip < 0 ? plural(Math.abs(bs.slip), 'day') + ' before' : 'on') + ' the sprint end date.');
    } else {
      const sf = spiFinish(S, asOf);
      if (sf) add('Schedule', sf.slipDays > 7 ? 'bad' : sf.slipDays > 0 ? 'warn' : 'good', sf.slipDays > 0 ? 'At the current rate of progress the project finishes about ' + plural(sf.slipDays, 'day') + ' late: ' + fdate(sf.forecastEnd) + ' against ' + fdate(sf.planEnd) + ' planned.' : 'At the current rate of progress the project finishes on or before its planned end, ' + fdate(sf.planEnd) + '.');
    }
    if (sch.lateMilestones) add('Schedule', 'bad', plural(sch.lateMilestones, 'milestone') + ' passed without being completed.');
    else {
      const nx = ms.find((m) => !m.done && m.date >= asOf);
      if (nx) add('Schedule', 'neutral', 'Next milestone: ' + nx.name + ' on ' + fdate(nx.date) + '.');
    }
    if (fig.ac > 0) {
      const w = fig.cpi >= 1 ? 'The ' + noun + ' is within budget' : fig.cpi >= 0.9 ? 'The ' + noun + ' is slightly over budget' : 'The ' + noun + ' is over budget';
      add('Cost', cpiCls, w + ': ' + money(fig.ac) + ' spent of ' + money(fig.bac) + ' (' + pc(fig.spentPct, 0) + ') while ' + pc(fig.earnedPct, 0) + ' of the budgeted work is earned (CPI ' + x2(fig.cpi) + ').');
      if (fig.eac != null) add('Cost', fig.vac >= 0 ? 'good' : fig.vac > -0.1 * fig.bac ? 'warn' : 'bad', 'Forecast cost at completion is ' + money(fig.eac) + ', which is ' + money(Math.abs(fig.vac)) + (fig.vac >= 0 ? ' under' : ' over') + ' the budget.');
    } else add('Cost', 'neutral', 'No cost has been recorded in this scope yet, so cost performance cannot be measured.');
    if (cost.reserve && cost.reserve.pendingN) add('Cost', 'warn', plural(cost.reserve.pendingN, 'change request') + ' awaiting implementation would add ' + money(cost.reserve.pendingCost) + ' and ' + plural(cost.reserve.pendingDays, 'day') + '.');
  }
  add('Work progress', work.pct != null && work.pct >= 0.999 ? 'good' : 'neutral', nDone + ' of ' + items.length + ' work items are done (' + hrsf(H.done) + ' of ' + hrsf(hTotal) + ' planned hours), ' + inProg + ' in progress.' + (work.sprintsDone ? ' ' + work.sprintsDone.done + ' of ' + work.sprintsDone.total + ' sprints are complete.' : '') + (work.completedInPeriod ? ' ' + plural(work.completedInPeriod.n, 'item') + ' (' + hrsf(work.completedInPeriod.hours) + ' h) finished in this period.' : ''));
  add('Pending tasks', pend.lateN === 0 ? 'good' : pend.lateN <= 3 ? 'warn' : 'bad', pend.open === 0 ? 'No work items are pending.' : plural(pend.lateN, 'open work item') + ' ' + (pend.lateN === 1 ? 'is' : 'are') + ' overdue and ' + pend.soonN + (pend.soonN === 1 ? ' falls' : ' fall') + ' due in the next 7 days; ' + pend.noDueN + ' open ' + (pend.noDueN === 1 ? 'item has' : 'items have') + ' no due date.' + (pend.blocked.length ? ' ' + plural(pend.blocked.length, 'item') + ' ' + (pend.blocked.length === 1 ? 'is' : 'are') + ' blocked by a dependency.' : ''));
  const openIssuesN = openRaid.filter((r) => r.type === 'Issue').length;
  add('Risks and issues', hi ? (hi >= 3 ? 'bad' : 'warn') : 'good', plural(openRisks.length, 'open risk') + ' (' + hi + ' high, ' + me + ' medium, ' + lo + ' low)' + (rm.emv.length ? '; their expected cost is ' + money(rm.emvTotal) + ' against a contingency reserve of ' + money(rm.contingency) : '') + '. ' + plural(openIssuesN, 'open issue') + ', ' + plural(openRaid.filter((r) => r.due && r.due < asOf).length, 'overdue RAID item') + '.');
  R.keyPoints = pts;

  // what leadership may need to decide or act on
  const dec = [];
  po.open.forEach((c) => dec.push({ tag: c.code, text: (c.title || 'Untitled') + ' is waiting for a decision (' + c.status.toLowerCase() + '): ' + signedMoney(nz(c.cost)) + ', ' + nz(c.days) + ' days.' }));
  po.appr.forEach((c) => dec.push({ tag: c.code, text: (c.title || 'Untitled') + ' is approved but not yet implemented into the baseline.' }));
  openRisks.filter((r) => rScore(r) >= 15).slice(0, 4).forEach((r) => dec.push({ tag: r.id, text: 'High risk: ' + (r.desc || 'no description') + (r.resp ? '' : ' (no response planned)') + '.' }));
  openRaid.filter((r) => r.due && r.due < asOf).slice(0, 3).forEach((r) => dec.push({ tag: r.id, text: 'Overdue ' + r.type.toLowerCase() + ': ' + (r.desc || 'no description') + ' (due ' + fdate(r.due) + ').' }));
  if (sch.blocked.length) dec.push({ tag: 'Blocked', text: plural(sch.blocked.length, 'work item') + ' cannot start until a dependency is met.' });
  sprintRows.filter((r) => r.status === 'Overdue').forEach((r) => dec.push({ tag: r.name, text: 'Sprint ended with work still open. Decide whether to extend, move the work or accept the slip.' }));
  sprintRows.filter((r) => !r.inPlan).forEach((r) => dec.push({ tag: r.name, text: 'Sprint is outside the approved baseline until its change request is implemented.' }));
  if (fig.ok && fig.spi != null && fig.spi < 0.8) dec.push({ tag: 'Schedule', text: 'SPI is ' + x2(fig.spi) + ', well below plan; agree a recovery action.' });
  if (fig.ok && fig.cpi != null && fig.cpi < 0.9) dec.push({ tag: 'Cost', text: 'CPI is ' + x2(fig.cpi) + ', well below plan; agree how the overspend is handled.' });
  R.decisions = dec.slice(0, 12);

  /* ---------- things to fix before sharing (shown on screen, not in the report) ---------- */
  const q = [];
  const doneNoDate = items.filter((x) => done(x.t) && !x.t.doneOn && nz(x.t.effort) > 0).length;
  if (doneNoDate) q.push({ cls: 'warn', text: plural(doneNoDate, 'finished work item') + ' ' + (doneNoDate === 1 ? 'has' : 'have') + ' no completion date, so earned value counts ' + (doneNoDate === 1 ? 'it' : 'them') + ' on the due date. Open the item and set “Completed on”.' });
  const noEffort = openItems.filter((x) => !nz(x.t.effort)).length;
  if (noEffort) q.push({ cls: 'warn', text: plural(noEffort, 'open work item') + ' ' + (noEffort === 1 ? 'has' : 'have') + ' no hours, so progress and workload are understated.' });
  if (pend.noDueN) q.push({ cls: 'warn', text: plural(pend.noDueN, 'open work item') + ' ' + (pend.noDueN === 1 ? 'has' : 'have') + ' no due date, so it cannot show as late.' });
  sps.forEach((s) => { if (!hasValidDates(s)) q.push({ cls: 'bad', text: 'Sprint “' + s.name + '” has no valid start and end dates.' }); else if (!(s.plannedHours > 0)) q.push({ cls: 'warn', text: 'Sprint “' + s.name + '” has no planned hours, so its share of the budget is taken from its work items.' }); });
  const undated = (S.ledger || []).filter((e) => !e.date).length;
  if (undated) q.push({ cls: 'warn', text: plural(undated, 'cost entry', 'cost entries') + ' ' + (undated === 1 ? 'has' : 'have') + ' no date, so cost is not placed in time.' });
  const outside = (S.ledger || []).filter((e) => e.date && !S.sprints.some((s) => s.start && s.end && e.date >= s.start && e.date <= s.end)).length;
  if (outside) q.push({ cls: 'neutral', text: plural(outside, 'cost entry', 'cost entries') + ' ' + (outside === 1 ? 'is' : 'are') + ' dated outside every sprint: counted in the project total but in no sprint report.' });
  if (!fig.ok) q.push({ cls: 'bad', text: 'Schedule and cost cannot be calculated for this scope until planned hours, sprint dates and the budget are set.' });
  if (scope === 'custom' && R.future) q.push({ cls: 'warn', text: 'This period has not started yet, so nothing has been done in it.' });
  if (asOf < t0) q.push({ cls: 'neutral', text: 'Figures are worked out as of ' + fdate(asOf) + ', the end of the period, not today.' });
  R.quality = q;

  /* ---------- how every figure was worked out ---------- */
  const calc = [];
  if (fig.ok) {
    const L = scope === 'sprint' ? [
      ['Sprint budget', 'BAC × the sprint’s share of all planned hours', money(fig.bac)],
      ['Planned progress', 'working days gone ÷ working days in the sprint', pc(fig.plannedPct, 1)],
      ['Earned progress', 'done hours ÷ planned hours = ' + hrsf(fig.sprint.doneH) + ' ÷ ' + hrsf(fig.sprint.planned), pc(fig.earnedPct, 1)],
      ['Planned value (PV)', 'sprint budget × planned progress', money(fig.pv)],
      ['Earned value (EV)', 'sprint budget × earned progress', money(fig.ev)],
    ] : [
      ['Budget (BAC)', baseOf(S) ? 'cost baseline ' + baseOf(S).version : 'live work budget + contingency reserve', money(fig.bac)],
      ['Planned value (PV)', 'sum over sprints of sprint budget × share of working days gone', money(fig.pv)],
      ['Earned value (EV)', 'sum over sprints of sprint budget × done hours ÷ planned hours', money(fig.ev)],
    ];
    L.push(['Actual cost (AC)', scope === 'sprint' ? 'cost entries dated inside the sprint, up to ' + fdate(asOf) : 'sum of the cost entries on the Budget tab' + (asOf < t0 ? ', recorded by ' + fdate(asOf) : ''), money(fig.ac)]);
    L.push(['SPI', 'EV ÷ PV = ' + money(fig.ev) + ' ÷ ' + money(fig.pv), x2(fig.spi)], ['CPI', 'EV ÷ AC = ' + money(fig.ev) + ' ÷ ' + money(fig.ac), x2(fig.cpi)], ['Schedule variance (SV)', 'EV − PV', signedMoney(fig.sv)], ['Cost variance (CV)', 'EV − AC', signedMoney(fig.cv)]);
    L.push(['Forecast at completion (EAC)', 'BAC ÷ CPI', fig.eac == null ? '–' : money(fig.eac)], ['Estimate to complete (ETC)', 'EAC − AC', fig.etc == null ? '–' : money(fig.etc)], ['Variance at completion (VAC)', 'BAC − EAC', signedMoney(fig.vac)]);
    L.forEach(([label, how, value]) => calc.push({ label, how, value }));
  }
  R.calc = calc;
  R.notes_scope = [
    'Figures are worked out as of ' + fdate(asOf) + '.',
    scope === 'custom' ? 'SPI and CPI are cumulative to the as-of date. “In this period” figures show what moved inside the chosen dates.' : '',
    'Working days leave out weekly off days, holidays and sprint-only off days.',
  ].filter(Boolean);
  delete R._series;
  delete fig.E;
  delete fig.sprint;
  return R;
}
