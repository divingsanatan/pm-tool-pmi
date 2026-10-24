import { addDays, mondayOfToday, today } from './dates';

// Statuses are per project and editable. "done" marks a status as finished work; pct is the share of a task
// counted as complete while it sits in an open status (used by the Dashboard and Timeline roll-ups).
export const DEFAULT_STATUSES = [
  { id: 'todo', label: 'To do', color: 'var(--muted)', pct: 0, done: false },
  { id: 'progress', label: 'In progress', color: 'var(--accent)', pct: 0.5, done: false },
  { id: 'review', label: 'In review', color: 'var(--warn)', pct: 0.8, done: false },
  { id: 'done', label: 'Done', color: 'var(--good)', pct: 1, done: true },
];
export const STATUS_COLORS = [
  ['var(--muted)', 'Gray'], ['var(--accent)', 'Blue'], ['var(--warn)', 'Amber'], ['var(--good)', 'Green'], ['var(--bad)', 'Red'],
  ['var(--s4)', 'Purple'], ['var(--s3)', 'Teal'], ['var(--s2)', 'Gold'], ['var(--s5)', 'Coral'], ['var(--s6)', 'Sage'],
];
export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: 'var(--bad)' },
  { id: 'high', label: 'High', color: 'var(--warn)' },
  { id: 'normal', label: 'Normal', color: 'var(--accent)' },
  { id: 'low', label: 'Low', color: 'var(--muted)' },
];
export const SPRINT_STATUSES = ['Not started', 'Active', 'Done'];

// Work item types are per project and editable. A milestone is a point in time (no effort, not counted in earned value);
// "raci" says whether the RACI check expects an Accountable and a Responsible for items of that type.
export const DEFAULT_TYPES = [
  { id: 'milestone', label: 'Milestone', color: 'var(--s4)', icon: '◆', milestone: true, raci: true },
  { id: 'epic', label: 'Epic', color: 'var(--s5)', icon: 'E', milestone: false, raci: true },
  { id: 'feature', label: 'Feature', color: 'var(--s3)', icon: 'F', milestone: false, raci: true },
  { id: 'story', label: 'Story', color: 'var(--s6)', icon: 'S', milestone: false, raci: true },
  { id: 'task', label: 'Task', color: 'var(--accent)', icon: 'T', milestone: false, raci: true },
  { id: 'subtask', label: 'Subtask', color: 'var(--muted)', icon: 's', milestone: false, raci: false },
  { id: 'bug', label: 'Bug', color: 'var(--bad)', icon: 'B', milestone: false, raci: true },
];
export const TYPE_COLORS = STATUS_COLORS;
const LADDER = ['epic', 'feature', 'story', 'task', 'subtask'];
export const typesOf = (p) => (p.types && p.types.length ? p.types : DEFAULT_TYPES);
export const typeOf = (p, id) => typesOf(p).find((x) => x.id === id) || typesOf(p).find((x) => x.id === 'task') || typesOf(p)[0];
// the type a new child gets: one step down the ladder (epic > feature > story > task > subtask)
export function childTypeFor(p, parentType) {
  const have = new Set(typesOf(p).map((x) => x.id));
  const i = LADDER.indexOf(parentType);
  if (i >= 0) {
    for (let k = i + 1; k < LADDER.length; k++) if (have.has(LADDER[k])) return LADDER[k];
    return parentType;
  }
  if (parentType === 'milestone') return have.has('task') ? 'task' : typesOf(p)[0].id;
  return have.has('subtask') ? 'subtask' : have.has('task') ? 'task' : typesOf(p)[0].id;
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const statusesOf = (p) => (p.statuses && p.statuses.length ? p.statuses : DEFAULT_STATUSES);
export const firstOpenStatus = (p) => (statusesOf(p).find((s) => !s.done) || statusesOf(p)[0]).id;
export const statusOf = (p, id) => statusesOf(p).find((s) => s.id === id) || statusesOf(p).find((s) => !s.done) || statusesOf(p)[0];
export const statusPct = (p, id) => {
  const s = statusOf(p, id);
  return s.done ? 1 : s.pct || 0;
};
export const isDoneStatus = (p, id) => !!statusOf(p, id).done;
export const nameOf = (p, id) => (p.people.find((x) => x.id === id) || {}).name || '';
export const priorityOf = (id) => PRIORITIES.find((p) => p.id === id) || null;
export const isOpen = (p, t) => !isDoneStatus(p, t.status);

export const containerById = (p, id) => (id === 'backlog' ? p.backlog : p.sprints.find((s) => s.id === id));
export const allContainers = (p) => p.sprints.concat([p.backlog]);

export function findTask(p, id) {
  for (const c of allContainers(p)) {
    const i = c.tasks.findIndex((t) => t.id === id);
    if (i >= 0) return { c, i, t: c.tasks[i] };
  }
  return null;
}

export function makeTask(p, fields) {
  const n = p.counter || 1;
  p.counter = n + 1;
  return {
    id: uid(),
    code: 'T-' + n,
    name: 'New task',
    type: 'task',
    parent: '',
    status: firstOpenStatus(p),
    assignees: [],
    priority: 'normal',
    start: '',
    due: '',
    effort: null,
    description: '',
    raci: {},
    ...fields,
  };
}

// Work that just moved into a finished status gets today's date as its completion date; reopened work loses it.
export function stampDone(before, p) {
  const was = new Set();
  allContainers(before).forEach((c) => c.tasks.forEach((t) => t.status && isDoneStatus(before, t.status) && was.add(t.id)));
  allContainers(p).forEach((c) =>
    c.tasks.forEach((t) => {
      const now = !!t.status && isDoneStatus(p, t.status);
      if (!now) delete t.doneOn;
      else if (!was.has(t.id) && !t.doneOn) t.doneOn = today();
    })
  );
}

export function newSprint(p, id) {
  const last = p.sprints[p.sprints.length - 1];
  const start = last && last.end ? addDays(last.end, 1) : mondayOfToday();
  const weeks = Math.max(1, Math.round((p.meta && p.meta.sprintWeeks) || 2));
  return { id: id || uid(), name: 'Sprint ' + (p.sprints.length + 1), status: 'Not started', start, end: addDays(start, weeks * 7 - 1), tasks: [] };
}

export function blankProject(name, id) {
  const start = mondayOfToday();
  const report = [];
  for (let i = 0; i < 12; i++) report.push({ planPct: null, earnPct: null, note: '' });
  return {
    id: id || uid(),
    meta: { name: name || 'New project', start, weeks: 12, sprintWeeks: 2, hoursPerDay: 8, sprintDays: 5 },
    ui: { mode: 'project', week: 1, sprint: 1, from: 1, to: 12 },
    report,
    lines: [],
    team: [],
    people: [],
    raci: [],
    raid: [],
    ledger: [],
    cr: [],
    baselines: [],
    statuses: DEFAULT_STATUSES.map((x) => ({ ...x })),
    types: DEFAULT_TYPES.map((x) => ({ ...x })),
    sprints: [{ id: uid(), name: 'Sprint 1', status: 'Not started', start, end: addDays(start, 13), tasks: [] }],
    backlog: { id: 'backlog', name: 'Backlog', tasks: [] },
    counter: 1,
  };
}
