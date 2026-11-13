import { PRIORITIES, allContainers, containerById, statusesOf, typesOf } from './tasks';
import { activePeople } from './people';

const key = (x) => String(x == null ? '' : x).trim().toLowerCase();
export const MAX_ROWS = 500;

// Reads CSV text (comma, semicolon or tab separated; quoted fields; Excel's byte-order mark) into a list of rows of text
export function parseCsv(text) {
  let s = String(text || '').replace(/^\uFEFF/, '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => (first.match(new RegExp(ch === '\t' ? '\\t' : '\\' + ch, 'g')) || []).length;
  const d = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const HEADS = {
  name: ['name', 'title', 'task', 'work item', 'workitem', 'summary', 'item'],
  type: ['type', 'item type', 'kind'],
  status: ['status', 'state'],
  priority: ['priority'],
  assignees: ['assignee', 'assignees', 'assigned to', 'owner', 'owners', 'responsible'],
  start: ['start', 'start date', 'begin'],
  due: ['due', 'due date', 'end', 'end date', 'finish', 'deadline'],
  effort: ['effort', 'hours', 'estimate', 'effort (hours)', 'estimated hours', 'planned hours'],
  description: ['description', 'details', 'notes', 'note'],
  tags: ['tags', 'tag', 'labels', 'label'],
  parent: ['parent', 'parent name', 'parent item', 'belongs to'],
};

// dates: 2026-11-30, or day first 30/11/2026 or 30-11-2026
export function parseDate(v) {
  const t = String(v || '').trim();
  if (!t) return { v: '' };
  let y, m, d;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else return { v: '', bad: true };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { v: '', bad: true };
  return { v: y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2) };
}

// Turns parsed rows into work items for one sprint or the backlog, and a list of problems per row. Nothing is saved here.
export function planImport(S, cid, rows) {
  const out = { items: [], skipped: [], missing: [], notes: 0 };
  if (!rows.length) return out;
  const head = rows[0].map(key);
  const col = {};
  Object.entries(HEADS).forEach(([f, names]) => { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[f] = i; });
  if (col.name == null) { out.missing.push('name'); return out; }
  const get = (r, f) => (col[f] == null ? '' : String(r[col[f]] == null ? '' : r[col[f]]).trim());

  const types = typesOf(S), statuses = statusesOf(S), people = activePeople(S);
  const c = containerById(S, cid);
  const isBacklog = cid === 'backlog';
  const existing = new Map();
  if (c) c.tasks.forEach((t) => existing.set(key(t.name), t));
  const names = new Map();

  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const name = get(r, 'name');
    if (!name) { out.skipped.push(line); return; }
    const warn = [];
    const f = { name };

    const ty = get(r, 'type');
    const type = ty && types.find((x) => key(x.label) === key(ty) || key(x.id) === key(ty));
    if (ty && !type) warn.push('Type “' + ty + '” is not in this project, so it becomes Task');
    f.type = type ? type.id : (types.find((x) => x.id === 'task') || types[0]).id;

    const st = get(r, 'status');
    if (!isBacklog) {
      const s = st && statuses.find((x) => key(x.label) === key(st) || key(x.id) === key(st));
      if (st && !s) warn.push('Status “' + st + '” is not in this project, so it starts as ' + statuses.find((x) => !x.done).label);
      if (s) f.status = s.id;
    } else if (st) warn.push('Backlog items have no status, so it is ignored');

    const pr = get(r, 'priority');
    if (pr) {
      const p = PRIORITIES.find((x) => key(x.label) === key(pr) || key(x.id) === key(pr)) || (key(pr) === 'medium' ? PRIORITIES.find((x) => x.id === 'normal') : null);
      if (p) f.priority = p.id; else warn.push('Priority “' + pr + '” is not recognised, so it stays Normal');
    }

    const as = get(r, 'assignees');
    if (as) {
      f.assignees = [];
      as.split(/[;|\n]/).map((x) => x.trim()).filter(Boolean).forEach((n) => {
        const p = people.find((x) => key(x.name) === key(n));
        if (p) { if (!f.assignees.includes(p.id)) f.assignees.push(p.id); }
        else warn.push('“' + n + '” is not an active stakeholder on this project, so they are not assigned');
      });
    }

    ['start', 'due'].forEach((d) => {
      const v = get(r, d);
      if (!v) return;
      const x = parseDate(v);
      if (x.bad) warn.push(d === 'start' ? 'Start date “' + v + '” is not a date (use YYYY-MM-DD or DD/MM/YYYY)' : 'Due date “' + v + '” is not a date (use YYYY-MM-DD or DD/MM/YYYY)');
      else f[d] = x.v;
    });
    if (f.start && f.due && f.due < f.start) { warn.push('Due date is before the start date, so the due date is left empty'); f.due = ''; }

    const ef = get(r, 'effort');
    const milestone = (types.find((x) => x.id === f.type) || {}).milestone;
    if (ef && !milestone) {
      const n = parseFloat(ef.replace(',', '.'));
      if (isFinite(n) && n >= 0) f.effort = n; else warn.push('Hours “' + ef + '” is not a number, so it is left empty');
    }

    const ds = get(r, 'description');
    if (ds) f.description = ds;
    const tg = get(r, 'tags');
    if (tg) f.tags = tg.split(/[;|,]/).map((x) => x.trim().replace(/^#+/, '')).filter(Boolean);

    const parentName = get(r, 'parent');
    if (parentName) {
      const inFile = rows.slice(1).some((x, j) => j !== k && key(x[col.name]) === key(parentName));
      if (!inFile && !existing.has(key(parentName))) warn.push('Parent “' + parentName + '” was not found, so it is added without a parent');
    }
    if (names.has(key(name)) || existing.has(key(name))) warn.push('A work item with this name already exists; it is still added');
    names.set(key(name), true);

    out.notes += warn.length;
    out.items.push({ line, f, parentName, warn });
  });
  if (!out.items.length && !out.skipped.length) out.missing.push('rows');
  return out;
}

// Applies a plan to a project (call inside updateW or update). Returns how many were added.
export function applyImport(p, cid, items, makeTask) {
  const c = containerById(p, cid);
  if (!c) return 0;
  const key2 = key;
  const created = items.map((it) => makeTask(p, { ...it.f, ...(cid === 'backlog' ? { status: '' } : {}) }));
  const before = c.tasks.slice();
  created.forEach((t) => c.tasks.push(t));
  items.forEach((it, i) => {
    if (!it.parentName) return;
    const par = created.find((t, j) => j !== i && key2(t.name) === key2(it.parentName)) || before.find((t) => key2(t.name) === key2(it.parentName));
    if (par) created[i].parent = par.id;
  });
  return created.length;
}

export const TEMPLATE_CSV = [
  'Name,Type,Status,Priority,Assignees,Start,Due,Hours,Description,Tags,Parent',
  'Login screen,Story,To do,High,Ritik Sir,2026-11-16,2026-11-20,16,Email and Google sign-in,auth;frontend,',
  'Build Google sign-in,Task,To do,Normal,Narendra;Kaye,2026-11-16,2026-11-18,8,,auth,Login screen',
  'Release candidate,Milestone,,Urgent,,,2026-11-30,,,,',
].join('\r\n');

export { allContainers };
