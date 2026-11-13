import { allContainers, isOpen } from './tasks';

// A stakeholder can leave a project without being deleted: they keep their history (past assignments, RACI roles, labour cost)
// but are left out of new assignments, pickers and planning. person.left holds the date (YYYY-MM-DD) they left; person.joined the date they were added.
export const isLeft = (p) => !!(p && p.left);
export const activePeople = (S) => S.people.filter((p) => !p.left);
export const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
export const openAssigned = (S, pid) => allContainers(S).flatMap((c) => c.tasks).filter((t) => (t.assignees || []).includes(pid) && isOpen(S, t));
// people who have left but still own open work: these need reassigning
export const leftWithWork = (S) => S.people.filter(isLeft).map((p) => ({ p, n: openAssigned(S, p.id).length })).filter((x) => x.n > 0);
export const shortDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
