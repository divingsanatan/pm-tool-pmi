import { DAY, pd, today } from './dates';
import { curWeek, nW, projectEnd, wkE, wkS } from './calc';
import { allContainers } from './tasks';
import { autoSprint } from './gantt';

export const RF_SCOPES = [['project', 'Entire project'], ['sprint', 'Sprint'], ['week', 'Week'], ['month', 'Month'], ['custom', 'Custom']];
export const DEFAULT_RF = { scope: 'project', sprintId: '', week: 0, month: '', from: '', to: '' };

const mStart = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), 1);
const mNext = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth() + 1, 1);

// every calendar month the project or its work items touch
export function monthsOf(S) {
  const start = pd(S.meta.start), end = projectEnd(S);
  const ds = [];
  S.sprints.forEach((c) => c.tasks.forEach((t) => [t.start, t.due].forEach((d) => d && ds.push(pd(d)))));
  const out = [];
  for (let m = mStart(Math.min(start, ...ds)); m <= Math.max(end, ...ds); m = mNext(m)) {
    const d = new Date(m);
    out.push({ key: d.toISOString().slice(0, 7), start: m, end: mNext(m) - DAY, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  return out;
}

// fills in sensible defaults (current week / month, active sprint) for whatever the filter leaves unset
export function resolveRf(S, rf) {
  const r = { ...DEFAULT_RF, ...(rf || {}) };
  const months = monthsOf(S);
  const sprint = S.sprints.find((x) => x.id === r.sprintId) || (r.sprintId === 'backlog' ? S.backlog : autoSprint(S) || S.sprints[0] || S.backlog);
  const week = r.week >= 1 && r.week <= nW(S) ? r.week : curWeek(S);
  const month = months.find((m) => m.key === r.month) || months.find((m) => m.key === today().slice(0, 7)) || months[0];
  let a = r.from ? pd(r.from) : pd(S.meta.start), b = r.to ? pd(r.to) : projectEnd(S);
  if (b < a) [a, b] = [b, a];
  const range = r.scope === 'week' ? [wkS(S, week), wkE(S, week)] : r.scope === 'month' ? [month.start, month.end] : r.scope === 'custom' ? [a, b] : null;
  return { scope: r.scope, sprint, week, month, from: r.from, to: r.to, range, months };
}

// work items to show: always every task of the sprints; the filter only narrows by sprint or by dates
export function workItems(S, rf) {
  const R = resolveRf(S, rf);
  const groups = [];
  let total = 0;
  allContainers(S).forEach((c) => {
    total += c.tasks.length;
    let list = c.tasks;
    if (R.scope === 'sprint') list = c.id === R.sprint.id ? c.tasks : [];
    else if (R.range && c.id === 'backlog') list = []; // the Backlog is unscheduled, so it never falls in a week, month or date range
    else if (R.range) {
      const [a, b] = R.range;
      list = c.tasks.filter((t) => {
        const s = t.start || t.due, f = t.due || t.start;
        return !!s && pd(f) >= a && pd(s) <= b; // a work item belongs to a period when its dates overlap it
      });
    }
    if (list.length) groups.push({ id: c.id, name: c.name, tasks: list });
  });
  return { R, groups, shown: groups.reduce((a, g) => a + g.tasks.length, 0), total };
}
