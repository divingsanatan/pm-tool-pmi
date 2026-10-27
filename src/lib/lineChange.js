import { baseLine, lineTotal, lineState, planBAC, projectBAC } from './calc';
import { blankCr } from './change';
import { nz } from './format';
import { uid } from './tasks';
import { today } from './dates';

/* Budget line items after a baseline can only change through a change request.
   A line added or changed after the baseline carries line.crId and line.crClaim (the part of the request's cost change that
   belongs to this line), so the request's cost always equals the sum of its claims. Implementing the request creates the new
   baseline, which freezes the line again. */
const r2 = (n) => Math.round(n * 100) / 100;
export const CR_DONE = ['Implemented', 'Closed'];
// requests a line change can still be added to (not decided yet)
export const lineCrs = (S) => (S.cr || []).filter((c) => ['Draft', 'Submitted', 'Under review'].includes(c.status));
// what the line was worth in the baseline (0 for a line that is new)
export const baseTotal = (S, l) => {
  const o = baseLine(S, l);
  return o ? lineTotal(S, { ...o }) : 0;
};
// a line's amount in the approved plan: pending lines are left out, changed lines count at their baseline value
export const planLineTotal = (S, l) => {
  const st = lineState(S, l);
  return st === 'new' ? 0 : st === 'changed' ? baseTotal(S, l) : lineTotal(S, l);
};
// pending (new/changed) line whose request is still open: it may be edited here
export const lineEditable = (S, l) => {
  const st = lineState(S, l);
  if (st === 'free') return true;
  if (st === 'locked') return false;
  const c = l.crId && (S.cr || []).find((x) => x.id === l.crId);
  return !!c && !CR_DONE.includes(c.status);
};
// makes the request's cost change match this line's claim after the line was edited
export function syncClaim(p, l) {
  if (!l.crId) return;
  const c = p.cr.find((x) => x.id === l.crId);
  if (!c) return;
  const claim = r2(lineTotal(p, l) - baseTotal(p, l));
  const old = nz(l.crClaim);
  if (Math.abs(claim - old) > 0.004) {
    c.cost = r2(nz(c.cost) + claim - old);
    c.log.push({ on: today(), text: 'Cost change ' + (claim - old >= 0 ? '+' : '') + r2(claim - old) + ' for budget line “' + (l.name || 'Line item') + '”' });
  }
  l.crClaim = claim;
  if (!c.affects.includes('Cost')) c.affects.push('Cost');
}
// picks (or raises) the request that owns a change; returns its id
function owner(p, choice, title, days, who) {
  if (choice.crId) return choice.crId;
  const id = uid();
  p.cr.push(blankCr(p, id, { title: choice.new.title || title, cost: 0, days: choice.new.days == null ? 0 : choice.new.days, kind: 'Enhancement or new requirement', affects: ['Cost'], desc: who }));
  return id;
}
export function addLineViaCr(p, choice, line) {
  const l = { id: uid(), name: line.name, amount: nz(line.amount), per: line.per, iterations: line.per === 'project' ? 0 : nz(line.iterations) };
  l.crId = owner(p, choice, 'Add budget line “' + l.name + '”', 0, 'Adds the budget line “' + l.name + '” to the plan.');
  p.lines.push(l);
  syncClaim(p, l);
  return l.id;
}
// a baselined line changes: its new values apply to the pending plan, and the difference goes to the request
export function changeLineViaCr(p, id, choice, patch) {
  const l = p.lines.find((x) => x.id === id);
  if (!l) return;
  if (l.crId && l.crId !== choice.crId && nz(l.crClaim)) {
    const oc = p.cr.find((x) => x.id === l.crId);
    if (oc) oc.cost = r2(nz(oc.cost) - nz(l.crClaim));
    l.crClaim = 0;
  }
  Object.assign(l, patch);
  if (l.per === 'project') l.iterations = 0;
  l.crId = owner(p, choice, 'Change budget line “' + (l.name || 'Line item') + '”', 0, 'Changes the budget line “' + (l.name || 'Line item') + '”.');
  syncClaim(p, l);
}
// a pending line is removed again: its claim leaves the request
export function dropPendingLine(p, id) {
  const l = p.lines.find((x) => x.id === id);
  if (!l) return;
  const c = l.crId && p.cr.find((x) => x.id === l.crId);
  if (c) c.cost = r2(nz(c.cost) - nz(l.crClaim));
  p.lines = p.lines.filter((x) => x.id !== id);
}
// put a changed line back to its baseline values
export function revertLine(p, id) {
  const l = p.lines.find((x) => x.id === id);
  const o = l && baseLine(p, l);
  if (!o) return;
  const c = l.crId && p.cr.find((x) => x.id === l.crId);
  if (c) c.cost = r2(nz(c.cost) - nz(l.crClaim));
  Object.assign(l, { name: o.name, amount: o.amount, per: o.per, iterations: o.iterations });
  delete l.crId;
  delete l.crClaim;
}
export const liveVsPlan = (S) => r2(projectBAC(S) - planBAC(S));
