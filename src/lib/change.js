import { DAY, addDays, pd, today } from './dates';
import { nz } from './format';
import { nW, projectBAC, projectEnd, weeklyBAC } from './calc';

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
// A baseline is a frozen copy of the three things PMI asks you to baseline: scope, schedule and cost.
export function snapshot(S) {
  const tasks = S.sprints.flatMap((sp) => sp.tasks); // the Backlog is unscheduled, so it is not part of the scope baseline
  return {
    bac: Math.round(projectBAC(S) * 100) / 100,
    weekly: Math.round(weeklyBAC(S) * 100) / 100,
    start: S.meta.start,
    end: isoOf(projectEnd(S)),
    weeks: nW(S),
    items: tasks.length,
    effort: Math.round(tasks.filter((t) => !t.parent).reduce((a, t) => a + nz(t.effort), 0) * 100) / 100, // top-level items already hold their children's hours
    codes: tasks.map((t) => t.code),
  };
}
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
  const o = {
    b, live, added, removed,
    dCost: live.bac - b.bac,
    dDays: Math.round((pd(live.end) - pd(b.end)) / DAY),
    dItems: live.items - b.items,
    dEffort: live.effort - b.effort,
  };
  o.moved = Math.abs(o.dCost) > 0.5 || o.dDays !== 0 || added.length > 0 || removed.length > 0 || Math.abs(o.dEffort) > 0.01;
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
    cost: null, days: null, iScope: '', iQuality: '', iResources: '', iRisk: '', alt: '', noop: '',
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
export function changeAlerts(S) {
  const a = [];
  const b = currentBaseline(S);
  if (!b) {
    a.push({ cls: 'warn', text: 'No baseline is set. Change control needs an approved baseline to measure changes against (Change control tab).' });
    return a;
  }
  const d = drift(S);
  const P = pendingOf(S);
  if (d && d.moved && !P.appr.length) {
    const bits = [];
    if (Math.abs(d.dCost) > 0.5) bits.push('budget ' + (d.dCost > 0 ? '+' : '−') + Math.round(Math.abs(d.dCost)).toLocaleString('en-US'));
    if (d.dDays) bits.push('finish ' + signedDays(d.dDays));
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
