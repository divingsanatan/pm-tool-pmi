import { DAY, pd, today } from './dates';
import { curWeek, nW, projectEnd, raciOkFor, wkE, wkS } from './calc';
import { allContainers, isDoneStatus, typeOf } from './tasks';
import { autoSprint } from './gantt';
import { flatTree } from './hier';

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
    // show the work items as a tree: parents first, children indented under them
    const keep = new Set(list.map((t) => t.id));
    const depth = new Map();
    const ordered = flatTree(c.tasks).filter((r) => keep.has(r.t.id));
    ordered.forEach((r) => depth.set(r.t.id, r.depth));
    list = ordered.map((r) => r.t);
    if (list.length) groups.push({ id: c.id, name: c.name, tasks: list, depth });
  });
  return { R, groups, shown: groups.reduce((a, g) => a + g.tasks.length, 0), total };
}

/* ================= Filters and insights (RACI tab) ================= */

export const RACI_ROLES = ['A', 'R', 'C', 'I'];
export const ROLE_INFO = {
  A: { name: 'Accountable', hint: 'Owns the outcome. Exactly one per work item.' },
  R: { name: 'Responsible', hint: 'Does the work. At least one per work item.' },
  C: { name: 'Consulted', hint: 'Gives input before decisions (two-way).' },
  I: { name: 'Informed', hint: 'Kept up to date (one-way).' },
};
export const DEFAULT_RX = { q: '', check: 'all', state: 'all', type: 'all', person: '', role: '' };
export const CHECK_FILTERS = [['all', 'All'], ['attention', 'Needs attention'], ['noA', 'No A'], ['multiA', 'Multiple A'], ['noR', 'No R'], ['ok', 'OK'], ['empty', 'No roles at all']];

// what is wrong (if anything) with one work item's roles
export function raciIssue(roles) {
  const v = Object.values(roles || {});
  const A = v.filter((x) => x === 'A').length, R = v.filter((x) => x === 'R').length;
  if (A === 0) return 'noA';
  if (A > 1) return 'multiA';
  if (R < 1) return 'noR';
  return '';
}
export const issueLabel = (k) => ({ noA: 'No A', multiA: 'Multiple A', noR: 'No R' }[k] || 'OK');

// work items a filter lets through. Types that do not need RACI (e.g. sub-tasks) are never flagged.
export function matchesRx(S, t, rx) {
  const roles = t.raci || {};
  const issue = raciIssue(roles);
  const needs = typeOf(S, t.type).raci !== false;
  const bad = needs && !!issue;
  if (rx.q) {
    const q = rx.q.trim().toLowerCase();
    if (!(String(t.name || '').toLowerCase().includes(q) || String(t.code || '').toLowerCase().includes(q))) return false;
  }
  if (rx.state === 'open' && isDoneStatus(S, t.status)) return false;
  if (rx.state === 'done' && !isDoneStatus(S, t.status)) return false;
  if (rx.type !== 'all' && t.type !== rx.type) return false;
  if (rx.check === 'attention' && !bad) return false;
  if (rx.check === 'noA' && !(needs && issue === 'noA')) return false;
  if (rx.check === 'multiA' && !(needs && issue === 'multiA')) return false;
  if (rx.check === 'noR' && !(needs && issue === 'noR')) return false;
  if (rx.check === 'ok' && !raciOkFor(roles)) return false;
  if (rx.check === 'empty' && Object.keys(roles).length) return false;
  if (rx.person) {
    const r = roles[rx.person];
    if (!r || (rx.role && r !== rx.role)) return false;
  }
  return true;
}

export const rxActive = (rx) => ['q', 'person', 'role'].some((k) => rx[k]) || ['check', 'state', 'type'].some((k) => rx[k] !== 'all');

// numbers behind the insight cards, for whatever work items are currently on screen
export function raciInsights(S, items) {
  const people = S.people;
  const per = new Map(people.map((p) => [p.id, { p, A: 0, R: 0, C: 0, I: 0, openR: 0, total: 0 }]));
  let ok = 0, noA = 0, multiA = 0, noR = 0, applicable = 0, empty = 0, noneInformed = 0, crowded = 0;
  items.forEach((t) => {
    const roles = t.raci || {};
    const open = !isDoneStatus(S, t.status);
    const needs = typeOf(S, t.type).raci !== false;
    const issue = raciIssue(roles);
    if (needs) {
      applicable += 1;
      if (!issue) ok += 1;
      else if (issue === 'noA') noA += 1;
      else if (issue === 'multiA') multiA += 1;
      else noR += 1;
      if (!Object.keys(roles).length) empty += 1;
    }
    const cs = Object.values(roles).filter((x) => x === 'C').length;
    if (cs >= 3) crowded += 1;
    if (needs && open && !Object.values(roles).includes('I')) noneInformed += 1;
    Object.entries(roles).forEach(([pid, r]) => {
      const row = per.get(pid);
      if (!row || !RACI_ROLES.includes(r)) return;
      row[r] += 1;
      row.total += 1;
      if (r === 'R' && open) row.openR += 1;
    });
  });
  const rows = [...per.values()];
  const totalA = rows.reduce((a, r) => a + r.A, 0);
  const topA = rows.slice().sort((a, b) => b.A - a.A)[0];
  const topR = rows.slice().sort((a, b) => b.openR - a.openR)[0];
  const idle = rows.filter((r) => r.total === 0);
  return {
    count: items.length, applicable, ok, noA, multiA, noR, empty, noneInformed, crowded,
    attention: noA + multiA + noR,
    pct: applicable ? Math.round((ok / applicable) * 100) : 100,
    rows, totalA, topA: topA && topA.A > 0 ? topA : null, topR: topR && topR.openR > 0 ? topR : null, idle,
    aShare: topA && totalA ? Math.round((topA.A / totalA) * 100) : 0,
  };
}
