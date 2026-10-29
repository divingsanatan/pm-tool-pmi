import { nz } from './format';
import { firstOpenStatus, statusPct, statusesOf } from './tasks';

/* Work item hierarchy.
   Work items stay in one flat list per sprint (or the Backlog). Each item has a `parent` (id of another item in the
   same list, or '') and a `type`. The order of the list is the order of the siblings. Everything below turns that
   list into a tree and rolls child values up into their parents. */

export const kidsMap = (tasks) => {
  const m = new Map();
  tasks.forEach((t) => {
    const k = t.parent || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  });
  return m;
};

// Items that have no children (the "real" work: only these count in earned value)
export function leafTasks(tasks) {
  const parents = new Set(tasks.map((t) => t.parent).filter(Boolean));
  return tasks.filter((t) => !parents.has(t.id));
}
export const rootTasks = (tasks) => tasks.filter((t) => !t.parent);

// Depth-first rows in sibling order: { t, depth, wbs, kids (count), list (direct children) }.
//  prefix    first part of the WBS number (e.g. the sprint number)
//  collapsed Set of ids whose children are hidden
//  keep      Set of ids to show (null = everything); numbering still counts hidden siblings
//  maxDepth  show at most this many levels (Infinity = all)
export function flatTree(tasks, { prefix = '', collapsed = null, keep = null, maxDepth = Infinity } = {}) {
  const kids = kidsMap(tasks);
  const rows = [];
  const walk = (parent, depth, num) => {
    let n = 0;
    (kids.get(parent) || []).forEach((t) => {
      n++;
      const wbs = num ? num + '.' + n : String(n);
      if (keep && !keep.has(t.id)) return;
      const list = kids.get(t.id) || [];
      rows.push({ t, depth, wbs, kids: list.length, list });
      if (list.length && !(collapsed && collapsed.has(t.id)) && depth + 1 < maxDepth) walk(t.id, depth + 1, wbs);
    });
  };
  walk('', 0, prefix);
  return rows;
}

// the item, then everything below it (depth-first)
export function subtreeIds(tasks, id) {
  const kids = kidsMap(tasks);
  const out = [];
  const seen = new Set();
  const walk = (x) => {
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
    (kids.get(x) || []).forEach((k) => walk(k.id));
  };
  walk(id);
  return out;
}

// ids plus every ancestor of each (used so a search result still shows where it lives)
export function withAncestors(tasks, ids) {
  const by = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set();
  ids.forEach((id) => {
    let x = by.get(id);
    let guard = 0;
    while (x && !out.has(x.id) && guard++ < 50) {
      out.add(x.id);
      x = x.parent ? by.get(x.parent) : null;
    }
  });
  return out;
}

export function ancestorsOf(tasks, id) {
  const by = new Map(tasks.map((t) => [t.id, t]));
  const out = [];
  let x = by.get(id);
  let guard = 0;
  while (x && x.parent && guard++ < 50) {
    x = by.get(x.parent);
    if (x) out.unshift(x);
  }
  return out;
}

export const depthMap = (tasks) => {
  const m = new Map();
  flatTree(tasks).forEach((r) => m.set(r.t.id, r.depth));
  return m;
};

/* ---------- roll-up ---------- */
const r2 = (x) => Math.round(x * 100) / 100;

// Which status a parent shows, from how complete its children are (0 to 1)
export function derivedStatus(S, p) {
  const sts = statusesOf(S);
  const done = sts.find((s) => s.done);
  if (p >= 0.9999 && done) return done.id;
  if (p <= 0) return firstOpenStatus(S);
  const open = sts.filter((s) => !s.done);
  const mid = open.filter((s) => nz(s.pct) > 0);
  if (!mid.length) return open[open.length - 1].id;
  return mid.reduce((a, b) => (Math.abs(nz(b.pct) - p) < Math.abs(nz(a.pct) - p) ? b : a)).id;
}

// Fills in every parent of one list from its children, bottom-up:
//   effort  = sum of the children's effort (a parent's own estimate is kept while no child has one)
//   start   = earliest child start,  due = latest child due
//   status  = calculated from how complete the children are (weighted by effort, else equally)
//   pct     = that completion (0 to 1), stored on the parent only
export function rollupContainer(S, c) {
  const kids = kidsMap(c.tasks);
  const back = c.id === 'backlog';
  const pct = new Map();
  const seen = new Set();
  const visit = (t) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const ks = kids.get(t.id) || [];
    if (!ks.length) {
      delete t.pct;
      pct.set(t.id, back ? 0 : statusPct(S, t.status));
      return;
    }
    ks.forEach(visit);
    if (ks.some((k) => nz(k.effort) > 0)) t.effort = r2(ks.reduce((a, k) => a + nz(k.effort), 0));
    if (back) return;
    let s = '', f = '';
    ks.forEach((k) => {
      const a = k.start || k.due, b = k.due || k.start;
      if (a && (!s || a < s)) s = a;
      if (b && (!f || b > f)) f = b;
    });
    if (s) t.start = s;
    if (f) t.due = f;
    const weighted = ks.some((k) => nz(k.effort) > 0);
    let ws = 0, e = 0;
    ks.forEach((k) => {
      const w = weighted ? nz(k.effort) : 1;
      ws += w;
      e += w * nz(pct.get(k.id));
    });
    const p = ws ? e / ws : 0;
    pct.set(t.id, p);
    t.pct = Math.round(p * 1000) / 1000;
    // children that all share one status give it to the parent as it is (a Blocked or In review item stays so); otherwise the progress decides
    const same = ks.every((k) => k.status === ks[0].status) && statusesOf(S).some((x) => x.id === ks[0].status);
    t.status = same ? ks[0].status : derivedStatus(S, p);
    const fin = statusesOf(S).find((x) => x.id === t.status);
    if (fin && fin.done) {
      const d = ks.reduce((a, k) => (k.doneOn && k.doneOn > a ? k.doneOn : a), '');
      if (d) t.doneOn = d;
    } else delete t.doneOn;
  };
  c.tasks.filter((t) => !t.parent).forEach(visit);
  c.tasks.forEach(visit);
}

// Totals for one sprint or the Backlog, from its top-level items (which already hold their children's totals)
export function summarize(S, c) {
  const roots = rootTasks(c.tasks);
  const back = c.id === 'backlog';
  const o = { hrs: 0, start: '', end: '', pct: null, items: c.tasks.length, leaves: leafTasks(c.tasks).length };
  const weighted = roots.some((t) => nz(t.effort) > 0);
  let ws = 0, e = 0;
  roots.forEach((t) => {
    o.hrs += nz(t.effort);
    if (back) return;
    const a = t.start || t.due, b = t.due || t.start;
    if (a && (!o.start || a < o.start)) o.start = a;
    if (b && (!o.end || b > o.end)) o.end = b;
    const w = weighted ? nz(t.effort) : 1;
    ws += w;
    e += w * (kidsMap(c.tasks).has(t.id) ? nz(t.pct) : statusPct(S, t.status));
  });
  o.hrs = r2(o.hrs);
  o.pct = !back && ws ? e / ws : null;
  return o;
}
