import { DAY, addDays, pd, today } from './dates';
import { nz } from './format';
import { labourOf, nW, personOf, projectBAC, projectEnd, reserves, weeklyBAC } from './calc';
import { uid } from './tasks';

/* ---------- vocabulary ---------- */
// Forward path of a change request, plus the two other ways a decision can go
export const WORKFLOW = ['Draft', 'Submitted', 'Under review', 'Approved', 'Implemented', 'Closed'];
export const CR_STATUSES = WORKFLOW.concat(['Rejected', 'Deferred']);
export const AREAS = ['Scope', 'Schedule', 'Cost', 'Quality', 'Resources', 'Risk'];
export const KINDS = ['Corrective action', 'Preventive action', 'Defect repair', 'Enhancement or new requirement', 'Regulatory or external', 'Sponsor or customer request'];
export const CR_PRIORITIES = ['Low', 'Normal', 'High', 'Emergency'];
export const crCls = (s) => ({ Draft: 'neutral', Submitted: 'neutral', 'Under review': 'warn', Approved: 'good', Implemented: 'good', Closed: 'neutral', Rejected: 'bad', Deferred: 'warn' }[s] || 'neutral');

const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const filled = (v) => (typeof v === 'string' ? v.trim().length > 0 : v != null && v !== '');
export const signedMoney = (n, money) => (!n ? money(0) : (n > 0 ? '+' : '−') + money(Math.abs(n)));
export const signedDays = (n) => (!n ? '0 days' : (n > 0 ? '+' : '−') + Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days'));

/* ---------- baselines ---------- */
// Real finish of the schedule: the latest sprint end or task date (not rounded up to a whole week)
export function scheduleEnd(S) {
  let hi = '';
  S.sprints.forEach((sp) => [sp.end].concat(sp.tasks.map((t) => t.due || t.start)).forEach((d) => { if (d && d > hi) hi = d; }));
  return hi || isoOf(projectEnd(S));
}
// Planned effort: each sprint's Planned hours when entered, otherwise the sum of its work items' effort
export function plannedEffort(S) {
  const r = S.sprints.reduce((a, sp) => {
    const items = sp.tasks.filter((t) => !t.parent).reduce((x, t) => x + nz(t.effort), 0); // top-level items already hold their children's hours
    return a + (sp.plannedHours > 0 ? nz(sp.plannedHours) : items);
  }, 0);
  return Math.round(r * 100) / 100;
}

// A baseline is a frozen copy of the three things PMI asks you to baseline: scope, schedule and cost.
export function snapshot(S) {
  const tasks = S.sprints.flatMap((sp) => sp.tasks); // the Backlog is unscheduled, so it is not part of the scope baseline
  return {
    bac: Math.round(projectBAC(S) * 100) / 100,
    weekly: Math.round(weeklyBAC(S) * 100) / 100,
    start: S.meta.start,
    end: scheduleEnd(S),
    weeks: nW(S),
    items: tasks.length,
    effort: plannedEffort(S),
    codes: tasks.map((t) => t.code),
    // the sprint plan at that moment: PV and the share of each sprint come from the planned hours
    sprints: S.sprints.map((sp) => ({ id: sp.id, name: sp.name, start: sp.start || '', end: sp.end || '', plannedHours: sp.plannedHours == null ? null : sp.plannedHours, crId: sp.crId || '' })),
    // contingency and management reserve (percentages and amounts); carried over unchanged from baseline to baseline
    reserve: (() => { const R = reserves(S); return { contPct: R.contPct, mgmtPct: R.mgmtPct, contingency: R.contingency, management: R.management }; })(),
    // who was in the labour budget at that moment (a new stakeholder after the baseline needs a change request unless budget was freed up)
    labour: S.team.map((t) => {
      const L = labourOf(S, t), per = personOf(S, t.person);
      return L && per ? { person: t.person, name: per.name || '', role: per.role || '', hours: L.total, off: L.off, cap: L.cap, rate: L.rate, avail: Math.round(L.avail * 100) / 100, cost: Math.round(L.cost * 100) / 100 } : null;
    }).filter(Boolean),
    labourCost: Math.round(S.team.reduce((a, t) => a + ((labourOf(S, t) || { cost: 0 }).cost), 0) * 100) / 100,
  };
}
// Change requests a new sprint can still be added to: not decided against, not yet in a baseline
export const sprintCrs = (S) => (S.cr || []).filter((c) => ['Draft', 'Submitted', 'Under review', 'Approved'].includes(c.status));
export const currentBaseline = (S) => (S.baselines && S.baselines.length ? S.baselines[S.baselines.length - 1] : null);

// How far the live plan has moved away from the current baseline
export function drift(S) {
  const b = currentBaseline(S);
  if (!b) return null;
  const live = snapshot(S);
  const was = new Set(b.codes || []);
  const now = new Set(live.codes);
  const added = live.codes.filter((c) => !was.has(c));
  const removed = (b.codes || []).filter((c) => !now.has(c));
  const had = new Set((b.sprints || []).map((x) => x.id));
  const addedSprints = b.sprints ? S.sprints.filter((sp) => !had.has(sp.id)).map((sp) => sp.name) : [];
  const o = {
    b, live, added, removed, addedSprints,
    dCost: live.bac - b.bac,
    dDays: Math.round((pd(live.end) - pd(b.end)) / DAY),
    dItems: live.items - b.items,
    dEffort: live.effort - b.effort,
  };
  o.moved = Math.abs(o.dCost) > 0.5 || o.dDays !== 0 || added.length > 0 || removed.length > 0 || addedSprints.length > 0 || Math.abs(o.dEffort) > 0.01;
  return o;
}

/* ---------- checks: what must (req) and should (not req) be done at each step ---------- */
const chk = (key, label, ok, req = true) => ({ key, label, ok: !!ok, req });
const has = (cr, a) => (cr.affects || []).includes(a);

export function raiseChecks(cr) {
  // Only the title, the cost change and the schedule change are mandatory (0 is a valid answer); everything else is optional
  return [
    chk('title', 'Short title', filled(cr.title)),
    chk('cost', 'Cost change in money (type 0 if none)', cr.cost != null),
    chk('days', 'Schedule change in days (type 0 if none)', cr.days != null),
    chk('desc', 'What exactly is changing (description)', filled(cr.desc), false),
    chk('kind', 'Type of change (corrective, preventive, defect repair, enhancement…)', filled(cr.kind), false),
    chk('by', 'Who is raising it', filled(cr.by), false),
    chk('why', 'Justification: why the change is needed', filled(cr.why), false),
    chk('affects', 'Which baselines it touches (scope, schedule, cost…)', (cr.affects || []).length > 0, false),
    chk('tasks', 'Work items it affects', (cr.tasks || []).length > 0, false),
    chk('raid', 'Related risks, issues or assumptions in the RAID log', (cr.raid || []).length > 0, false),
    chk('informed', 'Stakeholders who must be told about it', (cr.informed || []).length > 0, false),
    chk('ref', 'Evidence or reference (document, link, ticket)', filled(cr.ref), false),
  ];
}
// Impact analysis: all optional (cost and schedule change are already required when raising the request)
export function impactChecks(cr) {
  const l = [];
  if (has(cr, 'Scope')) l.push(chk('iScope', 'Scope impact', filled(cr.iScope), false));
  if (has(cr, 'Quality')) l.push(chk('iQuality', 'Quality impact', filled(cr.iQuality), false));
  if (has(cr, 'Resources')) l.push(chk('iResources', 'Resource impact', filled(cr.iResources), false));
  l.push(
    chk('iRisk', 'Risk impact: new or changed risks', filled(cr.iRisk), false),
    chk('alt', 'Alternatives that were considered', filled(cr.alt), false),
    chk('noop', 'What happens if the change is not made', filled(cr.noop), false)
  );
  return l;
}
export function decisionChecks(cr, approving) {
  const a = [chk('decidedBy', 'Who decided (approver or board member)', filled(cr.decidedBy), false), chk('rationale', 'Reason for the decision', filled(cr.rationale), false)];
  if (!approving) return a;
  return a.concat([
    chk('apCost', 'Approved cost change', cr.apCost != null),
    chk('apDays', 'Approved schedule change (days)', cr.apDays != null),
    chk('owner', 'Who will implement it', filled(cr.owner), false),
    chk('target', 'Target date to implement', filled(cr.target), false),
    chk('conditions', 'Conditions or constraints on the approval', filled(cr.conditions), false),
  ]);
}

// Compares what was approved with what the live plan now says
export function reconcile(cr, S) {
  const b = currentBaseline(S);
  if (!b) return null;
  const live = snapshot(S);
  const expCost = b.bac + nz(cr.apCost);
  const diffCost = live.bac - expCost;
  const actDays = Math.round((pd(live.end) - pd(b.end)) / DAY);
  const diffDays = actDays - nz(cr.apDays);
  // the plan runs in whole weeks, so a finish date within a week of the approved shift counts as matching
  const mismatch = Math.abs(diffCost) > 1 || Math.abs(diffDays) > 6;
  return { b, live, expCost, diffCost, actDays, diffDays, expEnd: addDays(b.end, nz(cr.apDays)), mismatch };
}
export function implChecks(cr, S) {
  const r = reconcile(cr, S);
  const c = cr.chk || {};
  const list = [
    chk('comms', 'Decision communicated to the requester and affected stakeholders', c.comms, false),
    chk('docs', 'Project plan documents updated (scope, schedule, budget, RACI)', c.docs, false),
    chk('raid', 'RAID log updated for new or changed risks', c.raid, false),
    chk('wbs', 'Work items and budget changed to match the approval', c.wbs, false),
  ];
  if (r && r.mismatch) list.push(chk('reconcile', 'Note explaining why the plan differs from the approved impact', filled(cr.reconcile), false));
  return list;
}
export const closeChecks = (cr) => [chk('verified', 'Verification: the change works and the new baseline was checked', filled(cr.verified), false)];

/* ---------- workflow ---------- */
export const NEXT = { Draft: ['Submitted'], Submitted: ['Under review', 'Draft'], 'Under review': ['Approved', 'Rejected', 'Deferred', 'Draft'], Deferred: ['Under review'], Approved: ['Implemented'], Implemented: ['Closed'], Rejected: [], Closed: [] };

export function checksFor(cr, to, S) {
  if (to === 'Submitted') return raiseChecks(cr);
  if (to === 'Under review') return raiseChecks(cr).filter((c) => c.req).concat(impactChecks(cr));
  if (to === 'Approved') return decisionChecks(cr, true);
  if (to === 'Rejected' || to === 'Deferred') return decisionChecks(cr, false);
  if (to === 'Implemented') return implChecks(cr, S);
  if (to === 'Closed') return closeChecks(cr);
  return [];
}
// What implementing an approved request will do: the new baseline is the current one plus the approved cost and days.
// needsBudget is true when the plan's budget (Budget tab) does not already include the approved cost.
// The reserves after a change request: a percentage the request sets is applied to the work budget of the new baseline;
// a reserve it leaves blank is carried over unchanged. basis 'cost' = the requested cost change (planning), 'ap' = the approved one.
export function reserveAfter(cr, S, basis = 'ap') {
  const prev = currentBaseline(S);
  if (!prev) return null;
  const R = reserves(S); // the baseline's own (locked) reserves
  const bac = Math.round((prev.bac + nz(basis === 'ap' ? cr.apCost : cr.cost)) * 100) / 100;
  const has = (v) => v != null && !isNaN(v);
  const contPct = has(cr.reCont) ? cr.reCont : R.contPct;
  const mgmtPct = has(cr.reMgmt) ? cr.reMgmt : R.mgmtPct;
  const contingency = has(cr.reCont) ? Math.round(bac * cr.reCont * 100) / 100 : R.contingency;
  const management = has(cr.reMgmt) ? Math.round(bac * cr.reMgmt * 100) / 100 : R.management;
  return {
    changed: has(cr.reCont) || has(cr.reMgmt), bac, contPct, mgmtPct, contingency, management,
    dCont: Math.round((contingency - R.contingency) * 100) / 100, dMgmt: Math.round((management - R.management) * 100) / 100,
    before: R, totalBefore: Math.round((prev.bac + R.contingency + R.management) * 100) / 100, totalAfter: Math.round((bac + contingency + management) * 100) / 100,
  };
}

export function implementPlan(cr, S) {
  const prev = currentBaseline(S);
  if (!prev) return null;
  const apCost = nz(cr.apCost), apDays = nz(cr.apDays);
  const bac = Math.round((prev.bac + apCost) * 100) / 100;
  const liveBac = Math.round(projectBAC(S) * 100) / 100;
  return { prev, apCost, apDays, bac, end: addDays(prev.end, apDays), liveBac, needsBudget: apCost !== 0 && Math.abs(liveBac - bac) > 1, res: reserveAfter(cr, S, 'ap') };
}
export const missing = (cr, to, S) => checksFor(cr, to, S).filter((c) => c.req && !c.ok);

// The main forward step from the current status, with its checklist
export function stageOf(cr, S) {
  const to = { Draft: 'Submitted', Submitted: 'Under review', 'Under review': 'Approved', Approved: 'Implemented', Implemented: 'Closed' }[cr.status];
  if (!to) return null;
  const list = checksFor(cr, to, S);
  const req = list.filter((c) => c.req);
  return { to, list, done: req.filter((c) => c.ok).length, total: req.length };
}

export function nextCode(S) {
  let mx = 0;
  S.cr.forEach((c) => {
    const n = parseInt(String(c.code || '').slice(3), 10);
    if (n > mx) mx = n;
  });
  return 'CR-' + ('0' + (mx + 1)).slice(-2);
}

export function blankCr(S, id, fields = {}) {
  return {
    id, code: nextCode(S), title: '', desc: '', kind: '', priority: 'Normal', by: '', on: today(), affects: [], why: '', ref: '',
    tasks: [], raid: [], informed: [],
    cost: null, days: null, reCont: null, reMgmt: null, iScope: '', iQuality: '', iResources: '', iRisk: '', alt: '', noop: '',
    decidedBy: '', decidedOn: '', rationale: '', apCost: null, apDays: null, owner: '', target: '', conditions: '',
    chk: { comms: false, docs: false, raid: false, wbs: false }, reconcile: '', verified: '',
    status: 'Draft', submittedOn: '', implementedOn: '', closedOn: '', baselineId: '',
    log: [{ on: today(), text: 'Draft created' }],
    ...fields,
  };
}

/* ---------- roll-ups for the dashboard and the Change tab ---------- */
export function pendingOf(S) {
  const sum = (list, f) => list.reduce((a, c) => a + nz(c[f]), 0);
  const open = S.cr.filter((c) => c.status === 'Submitted' || c.status === 'Under review');
  const appr = S.cr.filter((c) => c.status === 'Approved');
  return { open, appr, openCost: sum(open, 'cost'), openDays: sum(open, 'days'), apprCost: sum(appr, 'apCost'), apprDays: sum(appr, 'apDays') };
}

const age = (d) => (d ? Math.floor((pd(today()) - pd(d)) / DAY) : 0);

/* ---------- labour budget after the baseline ---------- */
// Open change requests the extra labour budget can still be claimed through (not decided yet, so their cost change can still grow)
export const labourCrs = (S) => (S.cr || []).filter((c) => ['Draft', 'Submitted', 'Under review'].includes(c.status));
const r2 = (n) => Math.round(n * 100) / 100;

// Compares the labour budget now with the labour budget frozen in the current baseline.
// The rule: the baseline's labour budget is the allowance. A new stakeholder who takes over the budget of someone removed (or fits
// inside the budget the team has freed up) needs no change request. Only the amount above the baseline's labour budget (net) must
// be claimed through a change request.
//   active: false when there is no baseline, or the baseline did not record its team (reason: 'untracked')
export function labourControl(S) {
  const b = currentBaseline(S);
  if (!b) return { active: false, reason: 'no-baseline' };
  if (!Array.isArray(b.labour)) return { active: false, reason: 'untracked', b };
  const had = new Map(b.labour.map((x) => [x.person, x]));
  const rows = S.team.map((t, i) => {
    const L = labourOf(S, t), per = personOf(S, t.person);
    if (!L || !per) return null;
    const base = had.get(t.person);
    const baseCost = base ? nz(base.cost) : 0;
    return { i, t, person: per, name: per.name || '(unnamed)', cost: r2(L.cost), baseCost, isNew: !base, delta: r2(L.cost - baseCost), crId: t.crId || '', claim: nz(t.crClaim) };
  }).filter(Boolean);
  const inTeam = new Set(S.team.map((t) => t.person));
  const removed = b.labour.filter((x) => !inTeam.has(x.person));
  const baseTotal = r2(b.labour.reduce((a, x) => a + nz(x.cost), 0));
  const nowTotal = r2(rows.reduce((a, r) => a + r.cost, 0));
  const net = r2(nowTotal - baseTotal);
  const extra = Math.max(0, net);
  // change requests already claiming this extra budget (their cost change is what covers it)
  const ids = Array.from(new Set(rows.filter((r) => (r.isNew || r.delta > 0.5) && r.crId).map((r) => r.crId)));
  const crs = ids.map((id) => (S.cr || []).find((c) => c.id === id)).filter((c) => c && !['Rejected', 'Deferred'].includes(c.status));
  const covered = r2(crs.reduce((a, c) => a + (['Approved', 'Implemented', 'Closed'].includes(c.status) ? nz(c.apCost) : nz(c.cost)), 0));
  const short = extra > 0.5 ? Math.max(0, r2(extra - covered)) : 0;
  const claimRows = extra > 0.5 ? rows.filter((r) => (r.isNew || r.delta > 0.5) && !r.crId) : [];
  return { active: true, b, rows, removed, baseTotal, nowTotal, net, extra, crs, covered, short, needsCr: short > 0.5, claimRows };
}

// Claim extra labour budget through a change request. choice: { crId } to add to an open request, or { new: { title, cost, days } } to raise one.
// members: [{ i, claim }] team rows that take the claim. Returns the request id.
export function claimLabour(p, choice, amount, who, members) {
  let crId = choice.crId;
  const b = currentBaseline(p);
  if (choice.new) {
    crId = uid();
    p.cr.push(blankCr(p, crId, {
      title: choice.new.title, cost: choice.new.cost, days: choice.new.days,
      kind: 'Enhancement or new requirement', affects: ['Cost', 'Resources'],
      desc: 'Adds ' + who + ' to the labour budget. The labour budget goes above baseline' + (b ? ' ' + b.version : '') + ' by ' + r2(amount) + '.',
      iResources: who + ' joins the team.',
    }));
  } else {
    const c = p.cr.find((x) => x.id === crId);
    if (!c) return '';
    c.cost = r2(nz(c.cost) + amount);
    if (!c.affects.includes('Cost')) c.affects.push('Cost');
    if (!c.affects.includes('Resources')) c.affects.push('Resources');
    c.log.push({ on: today(), text: 'Cost change +' + r2(amount) + ' for ' + who + ' (labour budget)' });
  }
  members.forEach((m) => {
    const t = p.team[m.i];
    if (t) {
      t.crId = crId;
      t.crClaim = r2(m.claim);
    }
  });
  return crId;
}

// A baseline made before it recorded the team: take the team as it is now as the team of that baseline
export function recordBaselineTeam(p) {
  const b = currentBaseline(p);
  if (!b) return;
  const s = snapshot(p);
  b.labour = s.labour;
  b.labourCost = s.labourCost;
}

export function changeAlerts(S) {
  const a = [];
  const b = currentBaseline(S);
  if (!b) {
    a.push({ cls: 'warn', text: 'No baseline is set. Change control needs an approved baseline to measure changes against (Change control tab).' });
    return a;
  }
  const lc = labourControl(S);
  if (lc.active && lc.needsCr)
    a.push({ cls: 'warn', text: 'The labour budget is ' + Math.round(lc.extra).toLocaleString('en-US') + ' above baseline ' + b.version + ', and ' + Math.round(lc.short).toLocaleString('en-US') + ' of it is not claimed by a change request. Raise or link one on the Budget tab.' });
  const d = drift(S);
  const P = pendingOf(S);
  if (d && d.moved && !P.appr.length) {
    const bits = [];
    if (Math.abs(d.dCost) > 0.5) bits.push('budget ' + (d.dCost > 0 ? '+' : '−') + Math.round(Math.abs(d.dCost)).toLocaleString('en-US'));
    if (d.dDays) bits.push('finish ' + signedDays(d.dDays));
    if (d.addedSprints.length) bits.push(d.addedSprints.length + ' sprint' + (d.addedSprints.length > 1 ? 's' : '') + ' added: ' + d.addedSprints.join(', '));
    if (d.added.length || d.removed.length) bits.push(d.added.length + ' work items added, ' + d.removed.length + ' removed');
    a.push({ cls: 'bad', text: 'The plan has moved away from baseline ' + b.version + (bits.length ? ' (' + bits.join(', ') + ')' : '') + ' with no approved change request. Raise a change request or revert the plan.' });
  }
  const stale = P.open.filter((c) => age(c.submittedOn) > 7);
  if (stale.length) a.push({ cls: 'warn', text: stale.length + ' change request' + (stale.length > 1 ? 's have' : ' has') + ' waited more than 7 days for a decision: ' + stale.map((c) => c.code).join(', ') + '.' });
  if (P.appr.length) a.push({ cls: 'warn', text: 'Approved but not yet in the baseline: ' + P.appr.map((c) => c.code).join(', ') + '. Update the plan, then implement it to create the new baseline.' });
  const late = S.cr.filter((c) => c.status === 'Approved' && c.target && c.target < today());
  if (late.length) a.push({ cls: 'bad', text: 'Past the target implementation date: ' + late.map((c) => c.code).join(', ') + '.' });
  return a;
}
