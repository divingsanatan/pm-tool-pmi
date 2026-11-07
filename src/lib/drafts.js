/* Draft sprints.
   Once a project has a baseline, a new sprint is a change to the approved plan. In integrated change control the change is
   only a PROPOSAL until the change request is approved, so the sprint starts as a draft: a placeholder with a name, dates and
   planned hours that belongs to a change request. A draft is kept apart from the real sprints (S.drafts), so the budget,
   timeline, capacity, dashboards and move menus do not see it. It holds no work items. When the request is approved, the draft
   becomes a regular sprint. If the request is not approved, the draft can be deleted at any time. */
import { newSprint } from './tasks';
import { insertAt, sprintClash } from './sprintGuard';

export const crJump = { id: null }; // "open this change request" when the Change control tab is shown next

export const draftsOf = (S) => (Array.isArray(S.drafts) ? S.drafts : []);
export const draftCr = (S, d) => (S.cr || []).find((c) => c.id === d.crId) || null;
// the request has been approved (or is already further along), so the sprint may exist
export const crAllows = (c) => !!c && ['Approved', 'Implemented', 'Closed'].includes(c.status);

// Sprints (and other drafts) whose dates the given dates would overlap. Draft dates count too, because a draft will become a sprint.
export function clashAll(S, selfId, start, end) {
  const live = sprintClash(S, selfId, start, end);
  const dr = draftsOf(S).filter((d) => d.id !== selfId && d.start && d.end && start <= d.end && end >= d.start);
  return live.concat(dr);
}

// Turns one draft into a regular sprint. Returns false if its dates now overlap a sprint (nothing changes then).
export function activateDraft(p, id) {
  const d = draftsOf(p).find((x) => x.id === id);
  if (!d) return false;
  if (sprintClash(p, '', d.start, d.end).length) return false;
  const sp = { ...newSprint(p, d.id), name: d.name, start: d.start, end: d.end, plannedHours: d.plannedHours };
  if (d.crId) sp.crId = d.crId;
  p.drafts = p.drafts.filter((x) => x.id !== id);
  p.sprints.splice(insertAt(p, d.start), 0, sp);
  return true;
}

// The request was approved: its drafts become sprints. Returns the names of drafts that could not (overlap), if any.
export function promoteFor(p, crId) {
  return draftsOf(p).filter((d) => d.crId === crId && !activateDraft(p, d.id)).map((d) => d.name);
}
