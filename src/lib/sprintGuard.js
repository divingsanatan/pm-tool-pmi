import { addDays, DAY, pd } from './dates';
import { findTask } from './tasks';
import { leafTasks } from './hier';

/* Work items must stay inside the dates of their sprint. These helpers decide what is inside, what is not,
   and what the sensible ways out are (the choices are shown to the user by store/useTasks.js). */

// The dates a sprint allows. A sprint with no dates (and the Backlog) allows everything.
export const windowOf = (c) => (c && c.id !== 'backlog' && (c.start || c.end) ? { lo: c.start || '', hi: c.end || '' } : null);
export const inWin = (w, d) => !d || !w || ((!w.lo || d >= w.lo) && (!w.hi || d <= w.hi));
export const clampTo = (w, d) => (!d || !w ? d : w.lo && d < w.lo ? w.lo : w.hi && d > w.hi ? w.hi : d);
export const sprintCovers = (sp, d) => !!(sp && sp.start && sp.end && d >= sp.start && d <= sp.end);

// A usable calendar date (guards against half-typed years such as 0002-03-04)
export const sane = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && +d.slice(0, 4) >= 1900 && +d.slice(0, 4) <= 2200 && !isNaN(pd(d));

// start and due pulled inside a window; keeps start on or before due
export function clampDates(w, t) {
  const o = {};
  ['start', 'due'].forEach((k) => {
    if (t[k]) o[k] = clampTo(w, t[k]);
  });
  const s = o.start || t.start, d = o.due || t.due;
  if (s && d && s > d) o.start = d;
  return o;
}

// When a work item is moved into another sprint: dates before the sprint start go to its start (a due date to its end,
// so unfinished work keeps a realistic deadline), dates after its end go to its end. Returns only what changes.
export function rollover(t, w) {
  const o = {};
  if (!w) return o;
  ['start', 'due'].forEach((k) => {
    const d = t[k];
    if (!d) return;
    if (w.lo && d < w.lo) o[k] = k === 'start' ? w.lo : w.hi || w.lo;
    else if (w.hi && d > w.hi) o[k] = w.hi;
  });
  const s = o.start || t.start, d = o.due || t.due;
  if (s && d && s > d) o.start = d;
  return o;
}

// Work items whose dates in `patch` would land outside their sprint
export function datePatchViolations(S, ids, patch) {
  const keys = ['start', 'due'].filter((k) => patch[k]);
  const out = [];
  if (!keys.length) return out;
  ids.forEach((id) => {
    const f = findTask(S, id);
    const w = f && windowOf(f.c);
    if (!w) return;
    if (keys.some((k) => !inWin(w, patch[k]))) out.push({ id, task: f.t, sprint: f.c });
  });
  return out;
}

// Work items of sprint c that fall outside the dates it would have after an edit
// (only lowest-level items: a parent's dates are rolled up from its children)
export const tasksOutside = (c, w) => leafTasks(c.tasks).filter((t) => !inWin(w, t.start) || !inWin(w, t.due));

/* Baseline lock. Once a baseline exists, a sprint's dates may move freely only inside the dates it was baselined with.
   Anything outside them changes the approved schedule, so it needs a change request (linked on the sprint as dateCrId). */
export const lastBaseline = (S) => (S.baselines && S.baselines.length ? S.baselines[S.baselines.length - 1] : null);
export const OPEN_CR = ['Draft', 'Submitted', 'Under review', 'Approved']; // a request that can still carry a change into the next baseline
export const baselinedDates = (S, id) => {
  const b = lastBaseline(S);
  const x = b && Array.isArray(b.sprints) ? b.sprints.find((y) => y.id === id) : null;
  return x && x.start && x.end ? x : null; // null: no baseline, a sprint added after it (it has its own request) or never dated
};
export const outsideBaseline = (S, id, start, end) => {
  const w = baselinedDates(S, id);
  return !!w && !!((start && start < w.start) || (end && end > w.end));
};
// the request that already covers this sprint's dates (still open, so the baseline will take them when it is implemented)
export const dateCrOf = (S, sp) => (sp && sp.dateCrId ? (S.cr || []).find((c) => c.id === sp.dateCrId && OPEN_CR.includes(c.status)) || null : null);

// Sprints of the same project must not share a day (start and end dates are both inclusive).
// Returns the other dated sprints that overlap start..end; `selfId` is the sprint being edited (ignored).
export const sprintClash = (S, selfId, start, end) =>
  start && end ? S.sprints.filter((s) => s.id !== selfId && s.start && s.end && s.start <= end && s.end >= start) : [];
// Every pair of sprints in the project that currently overlap (used to flag data saved before this rule existed)
export function sprintOverlaps(S) {
  const dated = S.sprints.filter((s) => s.start && s.end && s.start <= s.end);
  const out = [];
  dated.forEach((a, i) => dated.slice(i + 1).forEach((b) => a.start <= b.end && a.end >= b.start && out.push([a, b])));
  return out;
}
// The first day after `start` that is free of other sprints, for the hint shown with the error
export function nextFreeDay(S, selfId, start, end) {
  let d = start;
  for (let n = 0; n < 60; n++) {
    const hit = sprintClash(S, selfId, d, end || d);
    if (!hit.length) return d;
    d = addDays(hit.map((s) => s.end).sort().pop(), 1);
  }
  return d;
}

// A free stretch of calendar, not overlapping any existing sprint, that covers dates lo..hi: where a new sprint can go
export function gapWindow(S, lo, hi, weeks) {
  const len = Math.max(1, weeks) * 7;
  const dated = S.sprints.filter((s) => s.start && s.end);
  const prevEnd = dated.filter((s) => s.end < lo).map((s) => s.end).sort().pop();
  const nextStart = dated.filter((s) => s.start > hi).map((s) => s.start).sort()[0];
  const start = prevEnd ? (addDays(prevEnd, 1) > addDays(lo, -(len - 1)) ? addDays(prevEnd, 1) : addDays(lo, -(len - 1))) : lo;
  let end = addDays(start, len - 1);
  if (end < hi) end = hi;
  if (nextStart && end >= nextStart) end = addDays(nextStart, -1) < hi ? hi : addDays(nextStart, -1);
  return { start, end };
}

// Index to insert a new sprint so sprints stay in date order
export function insertAt(S, start) {
  const i = S.sprints.findIndex((s) => s.start && s.start > start);
  return i < 0 ? S.sprints.length : i;
}

export { DAY };
