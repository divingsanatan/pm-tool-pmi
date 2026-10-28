import { PRIORITIES, statusesOf, typeOf, uid } from './tasks';
import { fdate } from './dates';
import { money, pc } from './format';

/* Activity log.
   Every change to a project is found by comparing the project before and after the edit (diffProject), turned into a
   short sentence, and stamped with the exact time it happened. The log lives in project.activity (newest last). */

export const ACTIVITY_MAX = 1000;

export const CATS = {
  work: ['Work items', '▤', 'var(--accent)'],
  sprint: ['Sprints', '◷', 'var(--s3)'],
  people: ['Stakeholders', '☺', 'var(--s6)'],
  budget: ['Budget & tracker', '$', 'var(--good)'],
  raid: ['RAID log', '⚑', 'var(--warn)'],
  change: ['Change control', '⇄', 'var(--s5)'],
  project: ['Project & settings', '⚙', 'var(--muted)'],
  data: ['Data', '⇩', 'var(--s4)'],
};

const LABELS = {
  name: 'Name', title: 'Title', desc: 'Description', description: 'Description', status: 'Status', start: 'Start', end: 'End', due: 'Due date',
  amount: 'Amount', per: 'Per', cap: 'Capacity', rate: 'Rate', owner: 'Owner', type: 'Type', priority: 'Priority', cost: 'Cost impact',
  days: 'Schedule impact (days)', p: 'Probability (1–5)', i: 'Impact (1–5)', probPct: 'Probability', resp: 'Response', date: 'Date',
  element: 'Cost element', kind: 'Kind', by: 'Raised by', on: 'Raised on', affects: 'Affects', why: 'Reason', ref: 'Reference',
  tasks: 'Linked work items', raid: 'Linked RAID items', informed: 'Informed', iScope: 'Scope impact', iQuality: 'Quality impact',
  iResources: 'Resource impact', iRisk: 'Risk impact', alt: 'Alternatives', noop: 'If not done', decidedBy: 'Decided by',
  rationale: 'Rationale', apCost: 'Approved cost', apDays: 'Approved days', target: 'Target date', conditions: 'Conditions',
  chk: 'Checklist', reconcile: 'Reconciliation', verified: 'Verification', planPct: 'Planned %', earnPct: 'Earned %', note: 'Note',
  weeks: 'Duration (weeks)', sprintWeeks: 'Sprint length (weeks)', hoursPerDay: 'Hours per day', sprintDays: 'Working days per sprint', hours: 'Total hours', plannedHours: 'Planned hours', offDays: 'Off days', weeklyOff: 'Weekly off days', from: 'From', off: 'Off hours', iterations: 'Iterations',
  label: 'Name', color: 'Colour', done: 'Counts as done', pct: 'Progress weight', icon: 'Icon', milestone: 'Milestone', effort: 'Effort (h)',
};
const humanize = (k) => {
  if (k.includes('.')) {
    const [a, b] = k.split('.');
    return humanize(a) + ' · ' + b;
  }
  if (LABELS[k]) return LABELS[k];
  const s = k.replace(/([A-Z])/g, ' $1').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const MONEY = new Set(['amount', 'cost', 'apCost', 'rate']);
const PCT = new Set(['planPct', 'earnPct', 'probPct']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Lookups used to turn ids into names / codes
function makeCtx(before, after) {
  const people = new Map();
  const codes = new Map();
  [before, after].forEach((p) => {
    (p.people || []).forEach((x) => people.set(x.id, x.name || '(unnamed)'));
    [...(p.sprints || []), p.backlog].forEach((c) => c && c.tasks.forEach((t) => codes.set(t.id, t.code)));
  });
  return { people, codes };
}
const resolve = (ctx, x) => (typeof x === 'string' ? ctx.people.get(x) || ctx.codes.get(x) || x : x);

function val(ctx, key, v) {
  if (v == null || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return MONEY.has(key) ? money(v) : PCT.has(key) ? pc(v, 0) : String(Math.round(v * 100) / 100);
  if (key === 'weeklyOff' && Array.isArray(v)) return v.length ? v.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] || d).join(', ') : '(none)';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' && ISO.test(x) ? fdate(x) : resolve(ctx, x))).join(', ') : '(none)';
  if (typeof v === 'object') return 'changed';
  const s = String(v);
  if (ISO.test(s)) return fdate(s);
  const r = resolve(ctx, s);
  return r.length > 70 ? r.slice(0, 67) + '…' : r;
}

// one level of nesting is flattened ("chk.comms")
function flat(o, skip) {
  const out = {};
  Object.keys(o || {}).forEach((k) => {
    if (skip.has(k)) return;
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((s) => (out[k + '.' + s] = v[s]));
    else out[k] = v;
  });
  return out;
}
const same = (a, b) => JSON.stringify(a == null ? '' : a) === JSON.stringify(b == null ? '' : b);

function changesOf(ctx, a, b, skip) {
  const A = flat(a, skip), B = flat(b, skip);
  const out = [];
  new Set([...Object.keys(A), ...Object.keys(B)]).forEach((k) => {
    if (!same(A[k], B[k])) out.push({ f: humanize(k), a: val(ctx, k.split('.')[0], A[k]), b: val(ctx, k.split('.')[0], B[k]) });
  });
  return out;
}

// Records of one kind (budget lines, RAID items, change requests…) matched by id
function listEvents(ev, ctx, o) {
  const { cat, noun, a = [], b = [], label, skip = [], made, gone } = o;
  const sk = new Set(['id', ...skip]);
  const idOf = o.id || ((x, i) => (x.id != null ? x.id : 'row' + i));
  const A = new Map(a.map((x, i) => [idOf(x, i), x]));
  const B = new Map(b.map((x, i) => [idOf(x, i), x]));
  B.forEach((x, id) => {
    const old = A.get(id);
    if (!old) {
      ev.push({ cat, act: 'created', text: made ? made(x) : 'Added ' + noun + ' ' + label(x) });
      return;
    }
    if (o.noUpdate) return;
    const d = changesOf(ctx, old, x, sk);
    if (!d.length) return;
    if (d.length === 1) ev.push({ cat, act: 'updated', text: cap(noun) + ' ' + label(x) + ': ' + d[0].f + ' ' + d[0].a + ' → ' + d[0].b });
    else ev.push({ cat, act: 'updated', text: 'Updated ' + noun + ' ' + label(x), d });
  });
  A.forEach((x, id) => {
    if (!B.has(id)) ev.push({ cat, act: 'deleted', text: gone ? gone(x) : 'Removed ' + noun + ' ' + label(x) });
  });
}

/* ---------- work items ---------- */
function taskEvents(before, after, ctx) {
  const ev = [];
  const idx = (p) => {
    const m = new Map();
    [...p.sprints, p.backlog].forEach((c) => c.tasks.forEach((t) => m.set(t.id, { t, c })));
    return m;
  };
  const A = idx(after), B = idx(before);
  const stillThere = new Set([...after.sprints, after.backlog].map((c) => c.id));
  const st = (p, id) => (id ? (statusesOf(p).find((s) => s.id === id) || {}).label || id : '(none)');
  const who = (ids) => ((ids || []).length ? ids.map((x) => resolve(ctx, x)).join(', ') : 'Unassigned');
  const dt = (v) => (v ? fdate(v) : '(none)');
  const lab = (t) => t.code + ' “' + t.name + '”';
  const FIELDS = [
    ['type', 'Type', (p, t) => typeOf(p, t.type).label],
    ['status', 'Status', (p, t) => st(p, t.status)],
    ['assignees', 'Assignees', (p, t) => who(t.assignees)],
    ['priority', 'Priority', (p, t) => (PRIORITIES.find((x) => x.id === t.priority) || { label: 'None' }).label],
    ['start', 'Start', (p, t) => dt(t.start)],
    ['due', 'Due date', (p, t) => dt(t.due)],
    ['effort', 'Effort (h)', (p, t) => (t.effort == null ? '(none)' : t.effort + ' h')],
  ];
  A.forEach(({ t, c }, id) => {
    const b = B.get(id);
    const ref = { type: 'task', id };
    if (!b) {
      const under = t.parent && ctx.codes.get(t.parent) ? ' under ' + ctx.codes.get(t.parent) : '';
      ev.push({ cat: 'work', act: 'created', g: { k: 'created', to: c.name }, item: t.code, ref, text: 'Created ' + typeOf(after, t.type).label.toLowerCase() + ' ' + lab(t) + ' in ' + c.name + under });
      return;
    }
    const o = b.t;
    if (b.c.id !== c.id) ev.push({ cat: 'work', act: 'moved', g: { k: 'moved', to: c.name }, item: t.code, ref, text: 'Moved ' + lab(t) + ' from ' + b.c.name + ' to ' + c.name });
    else if ((o.parent || '') !== (t.parent || '')) ev.push({ cat: 'work', act: 'moved', g: { k: 'nested', to: t.parent ? ctx.codes.get(t.parent) : 'the top level' }, item: t.code, ref, text: 'Moved ' + lab(t) + (t.parent ? ' under ' + ctx.codes.get(t.parent) : ' to the top level') });
    if (o.name !== t.name) ev.push({ cat: 'work', act: 'renamed', ref, text: 'Renamed ' + o.code + ' from “' + o.name + '” to “' + t.name + '”' });
    const d = [];
    FIELDS.forEach(([k, l, f]) => {
      if (!same(o[k], t[k])) d.push({ f: l, a: f(before, o), b: f(after, t), k });
    });
    if (!same(o.description, t.description)) d.push({ f: 'Description', a: '', b: 'edited', k: 'description' });
    const r0 = o.raci || {}, r1 = t.raci || {};
    new Set([...Object.keys(r0), ...Object.keys(r1)]).forEach((pid) => {
      if ((r0[pid] || '') !== (r1[pid] || '')) d.push({ f: 'RACI · ' + resolve(ctx, pid), a: r0[pid] || '–', b: r1[pid] || '–', k: 'raci' });
    });
    if (d.length === 1) {
      const x = d[0];
      ev.push({ cat: 'work', act: 'updated', g: { k: 'upd:' + x.k, f: x.f, to: x.b }, item: t.code, ref, text: lab(t) + ': ' + x.f + (x.k === 'description' ? ' edited' : ' ' + x.a + ' → ' + x.b) });
    } else if (d.length > 1) {
      ev.push({ cat: 'work', act: 'updated', item: t.code, ref, text: 'Updated ' + lab(t), d: d.map(({ f, a, b }) => ({ f, a, b })) });
    }
  });
  B.forEach(({ t, c }, id) => {
    if (A.has(id) || !stillThere.has(c.id)) return; // tasks of a deleted sprint are covered by the sprint entry
    ev.push({ cat: 'work', act: 'deleted', g: { k: 'deleted', to: c.name }, item: t.code, text: 'Deleted ' + lab(t) + ' from ' + c.name });
  });
  return ev;
}

// Many identical changes from one action (a bulk edit, a deleted branch) become one entry
function collapse(events) {
  const groups = new Map();
  events.forEach((e, i) => {
    if (!e.g) return;
    const k = e.cat + '|' + e.act + '|' + e.g.k;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const first = new Map();
  const drop = new Set();
  groups.forEach((idxs) => {
    if (idxs.length < 4) return;
    const es = idxs.map((i) => events[i]);
    const tos = new Set(es.map((e) => e.g.to));
    const to = tos.size === 1 ? [...tos][0] : '';
    const n = es.length;
    const text =
      es[0].act === 'created' ? 'Created ' + n + ' work items' + (to ? ' in ' + to : '')
      : es[0].act === 'deleted' ? 'Deleted ' + n + ' work items' + (to ? ' from ' + to : '')
      : es[0].act === 'moved' ? 'Moved ' + n + ' work items' + (to ? ' to ' + to : '')
      : 'Changed ' + es[0].g.f.toLowerCase() + ' on ' + n + ' work items' + (to ? ' to ' + to : '');
    idxs.forEach((i) => drop.add(i));
    first.set(idxs[0], { cat: 'work', act: es[0].act, text, count: n, items: es.map((e) => e.item).filter(Boolean).slice(0, 80) });
  });
  const out = [];
  events.forEach((e, i) => {
    if (first.has(i)) out.push(first.get(i));
    if (drop.has(i)) return;
    const { g, item, ...rest } = e; // eslint-disable-line no-unused-vars
    out.push(rest);
  });
  return out;
}

const META_SKIP = new Set([]);
const CR_SKIP = ['log', 'code', 'submittedOn', 'decidedOn', 'implementedOn', 'closedOn', 'baselineId'];

// What changed between two versions of a project, as activity events (without time or author)
export function diffProject(before, after) {
  const ctx = makeCtx(before, after);
  const ev = taskEvents(before, after, ctx);
  const q = (o) => listEvents(ev, ctx, o);
  q({ cat: 'sprint', noun: 'sprint', a: before.sprints, b: after.sprints, label: (x) => '“' + x.name + '”', skip: ['tasks'],
    made: (x) => 'Created sprint “' + x.name + '”',
    gone: (x) => 'Deleted sprint “' + x.name + '”' + (x.tasks && x.tasks.length ? ' with ' + x.tasks.length + ' work item' + (x.tasks.length === 1 ? '' : 's') : '') });
  // project settings
  const m = changesOf(ctx, before.meta, after.meta, META_SKIP);
  m.forEach((x) => { if (x.f === 'Name') x.f = 'Project name'; if (x.f === 'Start') x.f = 'Project start date'; });
  if (m.length === 1) ev.push({ cat: 'project', act: 'updated', text: 'Project setting “' + m[0].f + '”: ' + m[0].a + ' → ' + m[0].b });
  else if (m.length) ev.push({ cat: 'project', act: 'updated', text: 'Updated project settings', d: m });
  q({ cat: 'project', noun: 'holiday', a: before.holidays || [], b: after.holidays || [], label: (x) => '“' + (x.label || 'Holiday') + '”' });
  q({ cat: 'people', noun: 'stakeholder', a: before.people, b: after.people, label: (x) => x.name || '(unnamed)' });
  q({ cat: 'budget', noun: 'team member', a: before.team, b: after.team, id: (x) => x.person, label: (x) => resolve(ctx, x.person),
    made: (x) => 'Added ' + resolve(ctx, x.person) + ' to the budget team', gone: (x) => 'Removed ' + resolve(ctx, x.person) + ' from the budget team' });
  q({ cat: 'budget', noun: 'budget line', a: before.lines, b: after.lines, label: (x) => '“' + (x.name || 'untitled') + '”' });
  q({ cat: 'budget', noun: 'cost entry', a: before.ledger, b: after.ledger, label: (x) => '“' + (x.desc || x.element || 'cost') + '” (' + money(x.amount) + ')' });
  q({ cat: 'raid', noun: 'RAID item', a: before.raid, b: after.raid, label: (x) => x.id + (x.desc ? ' “' + x.desc + '”' : ''), skip: ['rev', 'key'] });
  q({ cat: 'change', noun: 'change request', a: before.cr, b: after.cr, label: (x) => x.code + ' “' + (x.title || 'untitled') + '”', skip: CR_SKIP,
    made: (x) => 'Created change request ' + x.code + (x.title ? ' “' + x.title + '”' : ''),
    gone: (x) => 'Deleted change request ' + x.code + (x.title ? ' “' + x.title + '”' : '') });
  q({ cat: 'change', noun: 'baseline', a: before.baselines, b: after.baselines, label: (x) => x.version, noUpdate: true,
    made: (x) => 'Recorded baseline ' + x.version + (x.crCode ? ' for ' + x.crCode : '') + (x.kind === 'Initial' ? ' (initial plan)' : ''),
    gone: (x) => 'Removed baseline ' + x.version });
  q({ cat: 'project', noun: 'status', a: before.statuses, b: after.statuses, label: (x) => '“' + x.label + '”' });
  q({ cat: 'project', noun: 'work item type', a: before.types || [], b: after.types || [], label: (x) => '“' + x.label + '”' });
  // weekly tracker (rows have no ids, so they are matched by week)
  (after.report || []).forEach((r, i) => {
    const old = (before.report || [])[i] || {};
    const d = changesOf(ctx, old, r, new Set());
    if (!d.length) return;
    if (d.length === 1) ev.push({ cat: 'budget', act: 'updated', text: 'Weekly tracker, week ' + (i + 1) + ': ' + d[0].f + ' ' + d[0].a + ' → ' + d[0].b });
    else ev.push({ cat: 'budget', act: 'updated', text: 'Updated weekly tracker, week ' + (i + 1), d });
  });
  return collapse(ev);
}

// Parents get their status from their children; note when that changes without anyone setting it
export const statusSnapshot = (p) => {
  const m = new Map();
  [...p.sprints, p.backlog].forEach((c) => c.tasks.forEach((t) => m.set(t.id, t.status)));
  return m;
};
export function autoEvents(p, snap) {
  const out = [];
  const lab = (id) => (statusesOf(p).find((s) => s.id === id) || {}).label || id;
  [...p.sprints, p.backlog].forEach((c) => {
    const parents = new Set(c.tasks.map((t) => t.parent).filter(Boolean));
    c.tasks.forEach((t) => {
      if (parents.has(t.id) && snap.has(t.id) && snap.get(t.id) !== t.status && c.id !== 'backlog') {
        out.push({ cat: 'work', act: 'auto', ref: { type: 'task', id: t.id }, text: t.code + ' “' + t.name + '” is now ' + lab(t.status) + ' (calculated from its child items)' });
      }
    });
  });
  return out;
}

export function addActivity(p, events, at, by) {
  if (!events || !events.length) return;
  if (!Array.isArray(p.activity)) p.activity = [];
  events.forEach((e) => p.activity.push({ id: uid(), at, by, ...e }));
  if (p.activity.length > ACTIVITY_MAX) p.activity.splice(0, p.activity.length - ACTIVITY_MAX);
}

/* ---------- display helpers ---------- */
export const clock = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dayLabel = (at, now = Date.now()) => {
  const d = new Date(at), n = new Date(now);
  const key = (x) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
  if (key(d) === key(n)) return 'Today';
  if (key(d) === key(new Date(now - 86400000))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
export function relTime(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return '';
}

const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
export function activityCsv(p) {
  const head = ['Timestamp (UTC)', 'Local time', 'Category', 'Action', 'By', 'What happened', 'Details'];
  const rows = (p.activity || []).slice().reverse().map((e) => [
    e.at, new Date(e.at).toLocaleString(), (CATS[e.cat] || [e.cat])[0], e.act, e.by, e.text,
    (e.d || []).map((x) => x.f + ': ' + x.a + ' → ' + x.b).join('; ') + (e.items ? (e.d ? '; ' : '') + e.items.join(', ') : ''),
  ]);
  return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
}
