import { DAY, addDays, fdate, pd, today } from './dates';
import { allContainers, findTask, isDoneStatus, statusPct, uid } from './tasks';
import { subtreeIds } from './hier';
import { calendarOf, okDate } from './offdays';

/* Dependencies between work items, the way PMI describes them (PMBOK Guide, Sequence Activities; Practice Standard for Scheduling).
   A dependency is stored on the work item that WAITS (the successor):  task.deps = [{ id, pred, ext, type, lag, nature, due, resolved }]
     pred    id of the work item it waits on (any sprint or the Backlog), or '' for an external dependency
     ext     for an external dependency: who or what the work waits on (a client, a vendor, a permit...)
     type    precedence relationship (PDM):  FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish
     lag     days: positive = lag (wait), negative = lead (overlap)
     lagCal  'work' (default): the lag counts working days of the project calendar (weekly off days and holidays are skipped); 'cal': calendar days
     crId    the change request this dependency was added or changed under (needed once the project has a baseline)
     nature  mandatory (hard logic: physics or contract) or discretionary (soft logic: preferred practice)
     due     external only: the date the outside input is needed by
     resolved external only: the outside input has arrived
   Every dependency has an entry of type "Dependency" in the RAID log (raid.depId = dep.id). syncDependencies() creates it, keeps its text,
   due date and open / closed status in step with the dependency, and closes it (keeping the record) when the dependency is removed. */

export const REL = {
  FS: { code: 'FS', label: 'Finish to start', arrow: 'Finish → Start', help: 'The successor cannot start until the predecessor finishes (the most common).', need: 'start', from: 'finish' },
  SS: { code: 'SS', label: 'Start to start', arrow: 'Start → Start', help: 'The successor cannot start until the predecessor starts.', need: 'start', from: 'start' },
  FF: { code: 'FF', label: 'Finish to finish', arrow: 'Finish → Finish', help: 'The successor cannot finish until the predecessor finishes.', need: 'finish', from: 'finish' },
  SF: { code: 'SF', label: 'Start to finish', arrow: 'Start → Finish', help: 'The successor cannot finish until the predecessor starts (rare).', need: 'finish', from: 'start' },
};
export const REL_IDS = Object.keys(REL);
export const NATURE = {
  mandatory: { label: 'Mandatory', help: 'Hard logic: the order cannot be changed (contractual or physical).' },
  discretionary: { label: 'Discretionary', help: 'Soft logic: a preferred order that could be changed if needed.' },
};
export const STATE = {
  met: { label: 'Satisfied', cls: 'good' },
  waiting: { label: 'Waiting', cls: 'warn' },
  conflict: { label: 'Conflict', cls: 'bad' },
  external: { label: 'External · open', cls: 'warn' },
};

// pending jump from another screen to a RAID item (read once by the RAID tab)
export const raidJump = { key: null };

const lagTxt = (n, cal) => {
  const a = Math.abs(n), u = (cal === 'cal' ? 'calendar' : 'working') + ' day' + (a === 1 ? '' : 's');
  return n > 0 ? a + ' ' + u + ' lag' : n < 0 ? a + ' ' + u + ' lead' : '';
};

/* ---------- working-day arithmetic on the project calendar ---------- */
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWork = (cal, ms) => !cal.weekly.includes(new Date(ms).getUTCDay()) && !cal.holidays.some((h) => ms >= h.a && ms <= h.b);
const noOff = (cal) => !cal.weekly.length && !cal.holidays.length;
// n working days after (or before, when negative) a date; n = 0 gives the date itself, or the next working day when it is off
export function addWork(cal, d, n) {
  let ms = pd(d);
  if (noOff(cal)) return iso(ms + n * DAY);
  let g = 0;
  if (n === 0) { while (!isWork(cal, ms) && g++ < 4000) ms += DAY; return iso(ms); }
  let left = Math.abs(n);
  const step = n < 0 ? -DAY : DAY;
  while (left > 0 && g++ < 8000) { ms += step; if (isWork(cal, ms)) left--; }
  return iso(ms);
}
// working days from a to b (b after a); at least 1 when b is later
export function workGap(cal, a, b) {
  const x = pd(a), y = pd(b);
  if (y <= x) return 0;
  if (noOff(cal)) return Math.round((y - x) / DAY);
  let n = 0, ms = x, g = 0;
  while (ms < y && g++ < 8000) { ms += DAY; if (isWork(cal, ms)) n++; }
  return Math.max(1, n);
}
// the earliest date the successor may start / finish, given the predecessor's start or finish (base) and the lag
export function earliestDate(cal, dep, base) {
  const L = (Number(dep.lag) || 0) + (dep.type === 'FS' ? 1 : 0);
  return dep.lagCal === 'cal' ? addDays(base, L) : addWork(cal, base, L);
}
const label = (t) => (t ? (t.code ? t.code + ' ' : '') + '“' + t.name + '”' : 'a removed work item');

/* ---------- what a task has started / finished ---------- */
export function finished(S, t) {
  return !!t && !!t.status && isDoneStatus(S, t.status);
}
export function started(S, t) {
  if (!t) return false;
  if (finished(S, t)) return true;
  if (t.pct != null) return t.pct > 0;
  return !!t.status && statusPct(S, t.status) > 0;
}
const sDate = (t) => (t ? t.start || t.due || '' : '');
const fDate = (t) => (t ? t.due || t.start || '' : '');

/* ---------- is a dependency met, and does the schedule respect it? ---------- */
export function evalDep(S, succ, dep, pred) {
  if (!pred) {
    return dep.resolved
      ? { state: 'met', met: true, conflict: null, text: 'The outside input has arrived.' }
      : { state: 'external', met: false, conflict: null, text: 'Waiting on ' + (dep.ext || 'an external party') + (dep.due ? ' (needed by ' + fdate(dep.due) + ')' : '') + '.' };
  }
  const r = REL[dep.type] || REL.FS;
  const met = r.from === 'finish' ? finished(S, pred) : started(S, pred);
  if (met) return { state: 'met', met: true, conflict: null, text: r.from === 'finish' ? 'The predecessor is finished.' : 'The predecessor has started.' };
  const cal = calendarOf(S);
  let conflict = null;
  // logic conflict: the successor already started (or finished) although the predecessor has not reached the point it must reach
  if (r.need === 'start' && started(S, succ)) conflict = { text: label(succ) + ' has already started, but ' + label(pred) + (r.from === 'finish' ? ' is not finished.' : ' has not started.') };
  else if (r.need === 'finish' && finished(S, succ)) conflict = { text: label(succ) + ' is already finished, but ' + label(pred) + (r.from === 'finish' ? ' is not finished.' : ' has not started.') };
  // schedule conflict: the dates break the rule
  if (!conflict) {
    const base = r.from === 'finish' ? fDate(pred) : sDate(pred);
    const have = r.need === 'start' ? sDate(succ) : fDate(succ);
    if (base && have) {
      // finish-to-start: the working day after the predecessor ends; the others: the same day. The lag counts working days unless set to calendar days.
      const target = earliestDate(cal, dep, base);
      if (have < target) {
        const cd = dep.lagCal === 'cal' || noOff(cal);
        const days = cd ? Math.round((pd(target) - pd(have)) / DAY) : workGap(cal, have, target);
        conflict = {
          days, field: r.need === 'start' ? 'start' : 'due', target,
          text: label(succ) + ' is planned to ' + r.need + ' on ' + fdate(have) + ', ' + days + (cd ? ' day' : ' working day') + (days === 1 ? '' : 's') + ' too early. The earliest it can ' + r.need + ' is ' + fdate(target) + '.',
        };
      }
    }
  }
  return conflict ? { state: 'conflict', met: false, conflict, text: conflict.text } : { state: 'waiting', met: false, conflict: null, text: 'Waiting for ' + label(pred) + (r.from === 'finish' ? ' to finish.' : ' to start.') };
}

/* ---------- every dependency of the project, with both ends resolved ---------- */
export function buildDeps(S) {
  const where = new Map();
  allContainers(S).forEach((c) => c.tasks.forEach((t) => where.set(t.id, { t, c })));
  const rd = new Map();
  (S.raid || []).forEach((r) => r.depId && !r.depRemoved && rd.set(r.depId, r));
  const all = [];
  const waiting = new Map(); // task id -> entries where the task WAITS (it is the successor)
  const blocking = new Map(); // task id -> entries where the task BLOCKS (it is the predecessor)
  where.forEach(({ t: succ, c: sc }) => {
    (succ.deps || []).forEach((dep) => {
      const p = dep.pred ? where.get(dep.pred) : null;
      if (dep.pred && !p) return;
      const e = { dep, succ, sc, pred: p ? p.t : null, pc: p ? p.c : null, raid: rd.get(dep.id) || null };
      e.ev = evalDep(S, succ, dep, e.pred);
      e.cross = !!(p && p.c.id !== sc.id);
      all.push(e);
      (waiting.get(succ.id) || waiting.set(succ.id, []).get(succ.id)).push(e);
      if (p) (blocking.get(p.t.id) || blocking.set(p.t.id, []).get(p.t.id)).push(e);
    });
  });
  return { all, waiting, blocking, where };
}

// A work item is "blocked" while a dependency that gates its start is not yet met
export const isBlocked = (idx, id) => (idx.waiting.get(id) || []).some((e) => !e.ev.met && (e.dep.type === 'FS' || e.dep.type === 'SS' || !e.pred));

/* ---------- can this dependency be added? ---------- */
// Returns an error text, or '' when it is fine. succId waits on predId (predId '' = external).
export function checkAdd(S, succId, predId, extText = '') {
  const idx = buildDeps(S);
  const s = idx.where.get(succId);
  if (!s) return 'That work item no longer exists.';
  if (!predId) {
    if (!String(extText).trim()) return 'Say what the work item waits on.';
    const same = (s.t.deps || []).some((d) => !d.pred && String(d.ext || '').trim().toLowerCase() === String(extText).trim().toLowerCase());
    return same ? 'That external dependency is already on this work item.' : '';
  }
  const p = idx.where.get(predId);
  if (!p) return 'Pick a work item.';
  if (predId === succId) return 'A work item cannot depend on itself.';
  if ((s.t.deps || []).some((d) => d.pred === predId)) return 'These two work items are already linked. Edit the existing dependency instead.';
  // an item and what is below it are one piece of work: a dependency between them is meaningless
  if (s.c.id === p.c.id && (subtreeIds(s.c.tasks, succId).includes(predId) || subtreeIds(s.c.tasks, predId).includes(succId))) return 'A work item cannot depend on its own parent or child items. Link the child items instead.';
  // a loop (A waits on B, B waits on A, directly or through others) can never be scheduled
  const seen = new Set();
  const walk = (id) => {
    if (id === succId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const w = idx.where.get(id);
    return !!w && (w.t.deps || []).some((d) => d.pred && walk(d.pred));
  };
  if (walk(predId)) return label(p.t) + ' already depends on ' + label(s.t) + ', directly or through other items. Linking them this way would make a loop.';
  return '';
}

/* ---------- change control ---------- */
export const hasBaseline = (S) => !!(S.baselines && S.baselines.length);
export const OPEN_CR = ['Draft', 'Submitted', 'Under review', 'Approved'];
export const openCrs = (S) => (S.cr || []).filter((c) => OPEN_CR.includes(c.status));
// Once the project has a baseline, a dependency is part of the approved schedule logic unless it was added under a change request that is still open.
export function depLocked(S, dep) {
  if (!hasBaseline(S)) return false;
  const cr = dep.crId ? (S.cr || []).find((c) => c.id === dep.crId) : null;
  return !cr || !OPEN_CR.includes(cr.status);
}

/* ---------- the RAID entry of a dependency ---------- */
export function describeDep(S, e) {
  const r = REL[e.dep.type] || REL.FS;
  const nat = (NATURE[e.dep.nature] || NATURE.mandatory).label.toLowerCase();
  const lag = lagTxt(Number(e.dep.lag) || 0, e.dep.lagCal);
  const rule = r.need === 'start' ? 'cannot start until' : 'cannot finish until';
  const tail = (r.from === 'finish' ? 'finishes' : 'starts');
  const head = e.pred
    ? label(e.succ) + ' ' + rule + ' ' + label(e.pred) + ' ' + tail + '.'
    : label(e.succ) + ' depends on an external party: ' + (e.dep.ext || 'unnamed') + '.';
  const bits = [e.pred ? r.label : 'External', nat + ' dependency'];
  if (lag) bits.push(lag);
  if (e.cross) bits.push(e.pc.name + ' → ' + e.sc.name);
  return head + ' ' + bits.join(' · ') + '.';
}
const dueFor = (e) => (e.pred ? ((REL[e.dep.type] || REL.FS).from === 'finish' ? fDate(e.pred) : sDate(e.pred)) : e.dep.due || '');
const ownerFor = (S, e) => {
  const ids = new Set((S.people || []).map((p) => p.id));
  const pick = (t) => ((t && t.assignees) || []).find((x) => ids.has(x)) || '';
  return pick(e.pred) || pick(e.succ);
};
function nextRaidId(S) {
  let mx = 0;
  S.raid.forEach((r) => {
    if ((r.id || '').charAt(0) === 'D') {
      const n = parseInt(r.id.slice(2), 10);
      if (n > mx) mx = n;
    }
  });
  return 'D-' + ('0' + (mx + 1)).slice(-2);
}

/* Tidies every task's dependency list and keeps the RAID log in step. Runs inside normalize(), so it follows every edit:
   a new dependency gets its RAID entry; the entry's text, due date and status follow the dependency; a dependency whose
   work item was deleted or moved out is closed in the log (the record stays). Safe to run again and again. */
export function syncDependencies(S) {
  if (!Array.isArray(S.raid)) S.raid = [];
  const day = today();
  const containers = allContainers(S);
  const ids = new Set();
  containers.forEach((c) => c.tasks.forEach((t) => ids.add(t.id)));
  const seenDep = new Set();
  containers.forEach((c) =>
    c.tasks.forEach((t) => {
      if (t.deps === undefined) return;
      const pairs = new Set();
      const clean = [];
      (Array.isArray(t.deps) ? t.deps : []).forEach((d) => {
        if (!d || typeof d !== 'object') return;
        const pred = typeof d.pred === 'string' ? d.pred : '';
        const ext = String(d.ext || '').trim().slice(0, 120);
        if (pred) {
          if (pred === t.id || !ids.has(pred)) return; // the work item it waited on is gone
        } else if (!ext) return;
        const pair = pred || 'x:' + ext.toLowerCase();
        if (pairs.has(pair)) return;
        pairs.add(pair);
        const lag = Math.max(-365, Math.min(365, Math.round(Number(d.lag) || 0)));
        const o = {
          id: d.id && !seenDep.has(d.id) ? d.id : uid(),
          pred, type: REL[d.type] ? d.type : 'FS', lag, lagCal: d.lagCal === 'cal' ? 'cal' : 'work',
          nature: NATURE[d.nature] ? d.nature : 'mandatory',
        };
        if (d.crId) o.crId = d.crId;
        if (!pred) {
          o.ext = ext;
          if (d.due) o.due = d.due;
          if (d.resolved) o.resolved = true;
        }
        seenDep.add(o.id);
        clean.push(o);
      });
      if (clean.length) t.deps = clean;
      else delete t.deps;
    })
  );
  const idx = buildDeps(S);
  const byDep = new Map();
  S.raid.forEach((r) => r.depId && !r.depRemoved && !byDep.has(r.depId) && byDep.set(r.depId, r));
  const live = new Set();
  idx.all.forEach((e) => {
    live.add(e.dep.id);
    const desc = describeDep(S, e);
    const due = dueFor(e);
    const r = byDep.get(e.dep.id);
    if (!r) {
      S.raid.push({ key: uid(), id: nextRaidId(S), type: 'Dependency', desc, owner: ownerFor(S, e), p: null, i: null, probPct: null, cost: null, days: null, status: e.ev.met ? 'Closed' : 'Open', resp: '', due, rev: day, depId: e.dep.id, auto: 'dependency' });
      return;
    }
    r.type = 'Dependency';
    r.auto = 'dependency';
    if (r.desc !== desc) r.desc = desc;
    if (r.descHtml) delete r.descHtml;
    if ((r.due || '') !== due) r.due = due;
    if (e.ev.met) r.status = 'Closed';
    else if (r.status === 'Closed') r.status = 'Open';
    // a dependency raised under a change request is listed on it (work item and RAID entry), while the request is still open
    const cr = e.dep.crId ? (S.cr || []).find((c) => c.id === e.dep.crId) : null;
    if (cr && OPEN_CR.includes(cr.status)) {
      if (!Array.isArray(cr.tasks)) cr.tasks = [];
      if (!Array.isArray(cr.raid)) cr.raid = [];
      if (!cr.tasks.includes(e.succ.id)) cr.tasks.push(e.succ.id);
      if (r.key && !cr.raid.includes(r.key)) cr.raid.push(r.key);
    }
  });
  S.raid.forEach((r) => {
    if (!r.depId || r.depRemoved || live.has(r.depId)) return;
    r.depRemoved = day;
    r.status = 'Closed';
    r.resp = ((r.resp || '').trim() ? r.resp.trim() + ' ' : '') + 'Dependency removed on ' + fdate(day) + ', so this entry was closed automatically and kept for the record.';
    if (r.respHtml) delete r.respHtml;
  });
}

/* ---------- critical path and float (Critical Path Method, in working days) ----------
   The planned dates are the schedule. For every dated work item:
     total float = how many working days it can slip before it pushes a successor (through a dependency) or the project finish.
   A work item with a dependency and no float is on the critical path: any slip moves the finish. Negative float = the plan already breaks a dependency.
   A dependency is "driving" (critical) when it has no slack and both of its ends are critical. */
export function criticalPath(S, idx) {
  const empty = { nodes: new Map(), edges: new Map(), list: [], end: '', length: 0 };
  idx = idx || buildDeps(S);
  const cal = calendarOf(S);
  const nodes = new Map();
  S.sprints.forEach((sp) =>
    sp.tasks.forEach((t) => {
      const s = t.start || t.due, f = t.due || t.start;
      if (okDate(s) && okDate(f)) nodes.set(t.id, { t, s, f: f < s ? s : f, sp });
    })
  );
  if (!nodes.size) return empty;
  let lo = Infinity, hi = -Infinity;
  nodes.forEach((n) => { lo = Math.min(lo, pd(n.s)); hi = Math.max(hi, pd(n.f)); });
  hi += 21 * DAY;
  const days = Math.round((hi - lo) / DAY) + 1;
  if (days > 6000) return empty;
  const pre = [0]; // pre[k] = working days among the first k days of the range
  for (let k = 0; k < days; k++) pre.push(pre[k] + (isWork(cal, lo + k * DAY) ? 1 : 0));
  const k0 = (d) => Math.round((pd(d) - lo) / DAY);
  nodes.forEach((n) => {
    n.S = pre[k0(n.s)] + 1; // the working day it starts on (an off start day moves to the next working day)
    n.F = Math.max(n.S, pre[k0(n.f) + 1]); // the working day it finishes on
    n.d = n.F - n.S;
  });
  const perWeek = (7 - cal.weekly.length) / 7;
  const edges = idx.all.filter((e) => e.pred && nodes.has(e.pred.id) && nodes.has(e.succ.id));
  const info = new Map();
  edges.forEach((e) => {
    const a = nodes.get(e.pred.id), b = nodes.get(e.succ.id);
    const L0 = Number(e.dep.lag) || 0;
    const L = e.dep.lagCal === 'cal' ? Math.round(L0 * perWeek) : L0;
    const slack = { FS: b.S - (a.F + 1 + L), SS: b.S - (a.S + L), FF: b.F - (a.F + L), SF: b.F - (a.S + L) }[e.dep.type] ?? 0;
    info.set(e.dep.id, { e, a, b, L, slack });
  });
  const out = new Map(), inn = new Map();
  info.forEach((x) => {
    (out.get(x.a.t.id) || out.set(x.a.t.id, []).get(x.a.t.id)).push(x);
    (inn.get(x.b.t.id) || inn.set(x.b.t.id, []).get(x.b.t.id)).push(x);
  });
  let P = 0;
  nodes.forEach((n) => { if (n.F > P) P = n.F; });
  // successors first: depth-first post-order along the dependencies
  const order = [], state = new Map();
  const visit = (id) => {
    if (state.get(id)) return;
    state.set(id, 1);
    (out.get(id) || []).forEach((x) => visit(x.b.t.id));
    order.push(id);
  };
  nodes.forEach((_, id) => visit(id));
  order.forEach((id) => {
    const n = nodes.get(id);
    let lf = P;
    (out.get(id) || []).forEach((x) => {
      const b = x.b, ls = b.LF - b.d;
      const v = { FS: ls - 1 - x.L, SS: ls - x.L + n.d, FF: b.LF - x.L, SF: b.LF - x.L + n.d }[x.e.dep.type];
      if (v < lf) lf = v;
    });
    n.LF = lf;
    n.float = n.LF - n.F;
  });
  const linked = (id) => (out.get(id) || []).length + (inn.get(id) || []).length > 0;
  const nm = new Map();
  nodes.forEach((n, id) => nm.set(id, { float: n.float, critical: linked(id) && n.float <= 0, S: n.S, F: n.F, linked: linked(id) }));
  const em = new Map();
  info.forEach((x, id) => em.set(id, { slack: x.slack, critical: x.slack <= 0 && nm.get(x.a.t.id).critical && nm.get(x.b.t.id).critical }));
  const list = [];
  nodes.forEach((n, id) => { if (nm.get(id).critical) list.push({ task: n.t, sprint: n.sp, float: n.float, start: n.s, due: n.f }); });
  list.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.due < y.due ? -1 : 1));
  let first = Infinity;
  nodes.forEach((n) => { if (n.S < first) first = n.S; });
  let end = '';
  nodes.forEach((n) => { if (n.F === P && n.f > end) end = n.f; });
  return { nodes: nm, edges: em, list, end, length: P - first + 1 };
}

// The dependency index with the critical path, computed once per version of the project
const cache = new WeakMap();
export function depIndex(S) {
  let v = cache.get(S);
  if (!v) {
    v = buildDeps(S);
    v.cpm = criticalPath(S, v);
    cache.set(S, v);
  }
  return v;
}
