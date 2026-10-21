import { uid } from './tasks';
import { normalize } from './calc';

const hasKeys = (p) => !!(p && p.meta && p.meta.start && p.ui && p.report && p.lines && p.team && p.people && p.raci && p.raid);

export const isV2 = (o) => hasKeys(o) && Array.isArray(o.wbs) && o.days === undefined;
export const isProjectV3 = (p) => hasKeys(p) && Array.isArray(p.sprints) && p.backlog && Array.isArray(p.backlog.tasks);
export const isV3 = (o) => !!(o && o.v === 3 && Array.isArray(o.projects) && o.projects.length && o.projects.every(isProjectV3) && o.nav);

const statusFromPct = (pct) => (pct >= 1 ? 'done' : pct >= 0.75 ? 'review' : pct > 0 ? 'progress' : 'todo');

// Old single-project data (flat WBS) -> project with sprints
export function projectFromV2(o) {
  const p = { ...o, id: uid(), sprints: [], backlog: { id: 'backlog', name: 'Backlog', tasks: [] }, counter: 1 };
  delete p.wbs;
  const byPrefix = {};
  const container = (prefix, name) => {
    if (byPrefix[prefix]) return byPrefix[prefix];
    const c = { id: uid(), name: name || 'Sprint ' + prefix, status: 'Active', start: '', end: '', tasks: [] };
    p.sprints.push(c);
    byPrefix[prefix] = c;
    return c;
  };
  (o.wbs || []).forEach((x) => {
    if (x.type === 'Phase') {
      if (/backlog/i.test(x.name)) byPrefix[x.id] = p.backlog;
      else container(x.id, x.name);
    }
  });
  (o.wbs || []).forEach((x) => {
    if (x.type !== 'WP') return;
    const prefix = String(x.id).split('.')[0];
    const c = container(prefix);
    c.tasks.push({
      id: uid(), code: x.id, name: x.name, status: statusFromPct(x.pct || 0), assignees: [], priority: 'normal',
      start: x.start || '', due: x.finish || '', effort: x.hrs == null ? null : x.hrs, description: '', subtasks: [],
    });
  });
  p.sprints.forEach((c) => {
    c.tasks.forEach((t) => {
      if (t.start && (!c.start || t.start < c.start)) c.start = t.start;
      if (t.due && (!c.end || t.due > c.end)) c.end = t.due;
    });
    if (c.tasks.length && c.tasks.every((t) => t.status === 'done')) c.status = 'Done';
  });
  if (!p.sprints.length) p.sprints.push({ id: uid(), name: 'Sprint 1', status: 'Not started', start: o.meta.start, end: o.meta.start, tasks: [] });
  return p;
}

// Accepts a v3 workspace or old v2 project; returns a workspace or null
export function toWorkspace(o) {
  let w = null;
  if (isV3(o)) w = o;
  else if (isV2(o)) {
    const p = projectFromV2(o);
    w = { v: 3, projects: [p], nav: { projectId: p.id, view: 'project', sprintId: null, tab: 'dash', sprintView: 'list' } };
  }
  if (!w) return null;
  w.projects.forEach(normalize);
  return fixNav(w);
}

export function fixNav(w) {
  const n = w.nav || (w.nav = {});
  let p = w.projects.find((x) => x.id === n.projectId);
  if (!p) {
    p = w.projects[0];
    n.projectId = p.id;
    n.view = 'project';
  }
  if (n.view === 'sprint' && !(n.sprintId === 'backlog' || p.sprints.some((s) => s.id === n.sprintId))) {
    n.view = 'project';
    n.sprintId = null;
  }
  if (!n.tab) n.tab = 'dash';
  if (!n.sprintView) n.sprintView = 'list';
  return w;
}
