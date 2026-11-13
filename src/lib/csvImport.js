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
  code: ['code', 'id', 'key', 'item id', 'work item id'],
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

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sameTags = (a, b) => sameSet((a || []).map(key), (b || []).map(key));

// Turns parsed rows into a plan for one sprint or the backlog, and a list of problems per row. Nothing is saved here.
// mode 'new': every row becomes a new work item.  mode 'update': a row whose Code (or, failing that, Name) matches an item already in
// this sprint or the backlog UPDATES that item; the other rows are added. In an update, empty cells never erase what is already there.
export function planImport(S, cid, rows, mode) {
  const out = { items: [], skipped: [], missing: [], notes: 0, add: 0, update: 0, same: 0, skip: 0 };
  if (!rows.length) return out;
  const head = rows[0].map(key);
  const col = {};
  Object.entries(HEADS).forEach(([f, names]) => { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[f] = i; });
  if (col.name == null && !(mode === 'update' && col.code != null)) { out.missing.push('name'); return out; }
  const get = (r, f) => (col[f] == null ? '' : String(r[col[f]] == null ? '' : r[col[f]]).trim());

  const types = typesOf(S), statuses = statusesOf(S), people = activePeople(S);
  const c = containerById(S, cid);
  const isBacklog = cid === 'backlog';
  const update = mode === 'update';
  const tasks = c ? c.tasks : [];
  const byCode = new Map(tasks.map((t) => [key(t.code), t]));
  const byName = new Map();
  tasks.forEach((t) => { const k = key(t.name); byName.set(k, (byName.get(k) || []).concat(t)); });
  const body = rows.slice(1);
  const nameCount = new Map();
  body.forEach((r) => { const n = key(get(r, 'name')); if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1); });
  const usedTargets = new Set();
  const nameOfId = (id) => (people.find((x) => x.id === id) || S.people.find((x) => x.id === id) || {}).name || '';

  body.forEach((r, k) => {
    const line = k + 2;
    let name = get(r, 'name');
    const code = get(r, 'code');
    // is this row an update of an item that exists?
    let target = null;
    const warn = [];
    if (update) {
      if (code && byCode.has(key(code))) target = byCode.get(key(code));
      else if (code) warn.push('Code “' + code + '” is not in ' + (c ? c.name : 'this list') + (name ? ', so the Name is used' : ''));
      if (!target && name) {
        const m = byName.get(key(name)) || [];
        if (m.length > 1) { out.items.push({ line, action: 'skip', f: { name }, warn: warn.concat('Several items here are called “' + name + '”. Add the Code column to say which one'), changes: [] }); out.skip++; out.notes++; return; }
        if (m.length === 1) target = m[0];
      }
      if (target && usedTargets.has(target.id)) { out.items.push({ line, action: 'skip', f: { name: name || target.name }, warn: warn.concat('This item is already updated by an earlier row of the file'), changes: [] }); out.skip++; out.notes++; return; }
      if (target && !code && nameCount.get(key(name)) > 1) { out.items.push({ line, action: 'skip', f: { name }, warn: warn.concat('The name appears more than once in the file. Add the Code column to say which one'), changes: [] }); out.skip++; out.notes++; return; }
    }
    if (!name && !target) { out.skipped.push(line); return; }
    if (!name && target) name = target.name;
    if (target) usedTargets.add(target.id);

    const f = { name };
    const ty = get(r, 'type');
    const type = ty && types.find((x) => key(x.label) === key(ty) || key(x.id) === key(ty));
    if (ty && !type) warn.push('Type “' + ty + '” is not in this project, so ' + (target ? 'it is left as it is' : 'it becomes Task'));
    if (type) f.type = type.id;
    else if (!target) f.type = (types.find((x) => x.id === 'task') || types[0]).id;
    const typeId = f.type || (target && target.type);

    const st = get(r, 'status');
    if (!isBacklog) {
      const sx = st && statuses.find((x) => key(x.label) === key(st) || key(x.id) === key(st));
      if (st && !sx) warn.push('Status “' + st + '” is not in this project, so ' + (target ? 'it is left as it is' : 'it starts as ' + statuses.find((x) => !x.done).label));
      if (sx) f.status = sx.id;
    } else if (st) warn.push('Backlog items have no status, so it is ignored');

    const pr = get(r, 'priority');
    if (pr) {
      const px = PRIORITIES.find((x) => key(x.label) === key(pr) || key(x.id) === key(pr)) || (key(pr) === 'medium' ? PRIORITIES.find((x) => x.id === 'normal') : null);
      if (px) f.priority = px.id; else warn.push('Priority “' + pr + '” is not recognised, so ' + (target ? 'it is left as it is' : 'it stays Normal'));
    }

    const as = get(r, 'assignees');
    if (as) {
      f.assignees = [];
      as.split(/[;|\n]/).map((x) => x.trim()).filter(Boolean).forEach((n) => {
        const px = people.find((x) => key(x.name) === key(n));
        if (px) { if (!f.assignees.includes(px.id)) f.assignees.push(px.id); }
        else warn.push('“' + n + '” is not an active stakeholder on this project, so they are not assigned');
      });
    }

    ['start', 'due'].forEach((d) => {
      const v = get(r, d);
      if (!v) return;
      const x = parseDate(v);
      if (x.bad) warn.push((d === 'start' ? 'Start' : 'Due') + ' date “' + v + '” is not a date (use YYYY-MM-DD or DD/MM/YYYY)');
      else f[d] = x.v;
    });
    const sFin = f.start || (target && target.start), dFin = f.due || (target && target.due);
    if (f.due && sFin && f.due < sFin) { warn.push('Due date is before the start date, so the due date is not used'); delete f.due; }
    else if (f.start && dFin && !f.due && dFin < f.start) { warn.push('Start date is after the existing due date, so the start date is not used'); delete f.start; }

    const ef = get(r, 'effort');
    const milestone = (types.find((x) => x.id === typeId) || {}).milestone;
    if (ef && !milestone) {
      const n = parseFloat(ef.replace(',', '.'));
      if (isFinite(n) && n >= 0) f.effort = n; else warn.push('Hours “' + ef + '” is not a number, so it is left ' + (target ? 'as it is' : 'empty'));
    }

    const ds = get(r, 'description');
    if (ds) f.description = ds;
    const tg = get(r, 'tags');
    if (tg) f.tags = tg.split(/[;|,]/).map((x) => x.trim().replace(/^#+/, '')).filter(Boolean);

    const parentName = get(r, 'parent');
    if (parentName) {
      const inFile = body.some((x, j) => j !== k && key(x[col.name]) === key(parentName));
      if (!inFile && !byName.has(key(parentName))) warn.push('Parent “' + parentName + '” was not found, so it is ' + (target ? 'left as it is' : 'added without a parent'));
    }

    if (!target) {
      if (byName.has(key(name)) || (nameCount.get(key(name)) || 0) > 1) warn.push('A work item with this name already exists; it is still added' + (update ? ' (use the Code column to update it)' : ''));
      out.notes += warn.length;
      out.items.push({ line, action: 'new', f, parentName, warn, changes: [] });
      out.add++;
      return;
    }

    // an item with sub-items takes its status, dates and hours from them, so those columns cannot change it
    if (tasks.some((t) => t.parent === target.id) && ['status', 'start', 'due', 'effort'].some((k) => f[k] != null && f[k] !== '')) {
      ['status', 'start', 'due', 'effort'].forEach((k) => delete f[k]);
      warn.push('This item has sub-items, so its status, dates and hours come from them and are not changed here');
    }
    // an update: list what really changes
    const changes = [];
    const show = (v) => (v === '' || v == null ? 'empty' : v);
    if (f.name !== target.name && code) changes.push('Name ' + target.name + ' → ' + f.name);
    if (f.type && f.type !== target.type) changes.push('Type ' + show(target.type) + ' → ' + f.type);
    if (f.status && f.status !== target.status) changes.push('Status ' + show(target.status) + ' → ' + f.status);
    if (f.priority && f.priority !== (target.priority || 'normal')) changes.push('Priority ' + (target.priority || 'normal') + ' → ' + f.priority);
    if (f.assignees && !sameSet(f.assignees, target.assignees || [])) changes.push('Assignees ' + ((target.assignees || []).map(nameOfId).join(', ') || 'none') + ' → ' + (f.assignees.map(nameOfId).join(', ') || 'none'));
    if (f.start && f.start !== target.start) changes.push('Start ' + show(target.start) + ' → ' + f.start);
    if (f.due && f.due !== target.due) changes.push('Due ' + show(target.due) + ' → ' + f.due);
    if (f.effort != null && f.effort !== target.effort) changes.push('Hours ' + show(target.effort) + ' → ' + f.effort);
    if (f.description && f.description !== (target.description || '')) changes.push('Description');
    if (f.tags && !sameTags(f.tags, target.tags)) changes.push('Tags');
    if (parentName) {
      const par = tasks.find((t) => t.id !== target.id && key(t.name) === key(parentName)) || body.some((x, j) => j !== k && key(x[col.name]) === key(parentName));
      const parId = par && par.id;
      if (par && parId && parId !== target.parent) {
        let up = par, bad = false, guard = 0;
        while (up && up.parent && guard++ < 50) { if (up.parent === target.id) { bad = true; break; } up = tasks.find((t) => t.id === up.parent); }
        if (bad) warn.push('Parent “' + parentName + '” sits under this item, so the parent is not changed');
        else changes.push('Parent → ' + parentName);
      } else if (par && !parId) changes.push('Parent → ' + parentName);
    }
    out.notes += warn.length;
    if (!changes.length) { out.items.push({ line, action: 'same', target: target.id, f, parentName, warn, changes }); out.same++; return; }
    out.items.push({ line, action: 'update', target: target.id, f, parentName, warn, changes });
    out.update++;
  });
  if (!out.items.length && !out.skipped.length) out.missing.push('rows');
  return out;
}

// Applies a plan to a project (call inside updateW or update). Returns { added, updated }.
export function applyImport(p, cid, items, makeTask) {
  const c = containerById(p, cid);
  if (!c) return { added: 0, updated: 0 };
  const news = items.filter((it) => it.action === 'new');
  const ups = items.filter((it) => it.action === 'update');
  const created = news.map((it) => makeTask(p, { ...it.f, ...(cid === 'backlog' ? { status: '' } : {}) }));
  const before = c.tasks.slice();
  created.forEach((t) => c.tasks.push(t));
  const find = (name, self) => c.tasks.find((t) => t.id !== self && key(t.name) === key(name));
  news.forEach((it, i) => {
    if (!it.parentName) return;
    const par = created.find((t, j) => j !== i && key(t.name) === key(it.parentName)) || before.find((t) => key(t.name) === key(it.parentName));
    if (par) created[i].parent = par.id;
  });
  let updated = 0;
  ups.forEach((it) => {
    const t = c.tasks.find((x) => x.id === it.target);
    if (!t) return;
    const f = it.f;
    ['name', 'type', 'priority', 'start', 'due', 'description'].forEach((k) => { if (f[k]) t[k] = f[k]; });
    if (f.status && cid !== 'backlog') t.status = f.status;
    if (f.effort != null) t.effort = f.effort;
    if (f.assignees) t.assignees = f.assignees.slice();
    if (f.tags) t.tags = f.tags.slice();
    if (it.parentName) {
      const par = find(it.parentName, t.id);
      let ok = !!par, up = par, guard = 0;
      while (ok && up && up.parent && guard++ < 50) { if (up.parent === t.id) ok = false; up = c.tasks.find((x) => x.id === up.parent); }
      if (ok) t.parent = par.id;
    }
    updated++;
  });
  return { added: created.length, updated };
}

// the items of one sprint or the backlog as CSV, with their Code, so the file can be edited and imported back as an update
export function exportCsv(S, cid) {
  const c = containerById(S, cid);
  const q = (v) => { const t = v == null ? '' : String(v); return /[",\r\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const nm = (id) => (S.people.find((x) => x.id === id) || {}).name || '';
  const head = ['Code', 'Name', 'Type', 'Status', 'Priority', 'Assignees', 'Start', 'Due', 'Hours', 'Description', 'Tags', 'Parent'];
  const rows = ((c && c.tasks) || []).map((t) => {
    const par = (c.tasks.find((x) => x.id === t.parent) || {}).name || '';
    const ty = typesOf(S).find((x) => x.id === t.type);
    const st = t.status ? statusesOf(S).find((x) => x.id === t.status) : null;
    return [t.code, t.name, ty ? ty.label : t.type, st ? st.label : '', (PRIORITIES.find((x) => x.id === t.priority) || {}).label || '', (t.assignees || []).map(nm).filter(Boolean).join(';'), t.start || '', t.due || '', t.effort == null ? '' : t.effort, t.description || '', (t.tags || []).join(';'), par];
  });
  return [head].concat(rows).map((r) => r.map(q).join(',')).join('\r\n');
}

export const TEMPLATE_CSV = [
  'Name,Type,Status,Priority,Assignees,Start,Due,Hours,Description,Tags,Parent',
  'Login screen,Story,To do,High,Ritik Sir,2026-11-16,2026-11-20,16,Email and Google sign-in,auth;frontend,',
  'Build Google sign-in,Task,To do,Normal,Narendra;Kaye,2026-11-16,2026-11-18,8,,auth,Login screen',
  'Release candidate,Milestone,,Urgent,,,2026-11-30,,,,',
].join('\r\n');

export { allContainers };
