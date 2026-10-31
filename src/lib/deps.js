import { DAY, addDays, fdate, pd, today } from './dates';
import { allContainers, findTask, isDoneStatus, statusPct, uid } from './tasks';
import { subtreeIds } from './hier';

/* Dependencies between work items, the way PMI describes them (PMBOK Guide, Sequence Activities; Practice Standard for Scheduling).
   A dependency is stored on the work item that WAITS (the successor):  task.deps = [{ id, pred, ext, type, lag, nature, due, resolved }]
     pred    id of the work item it waits on (any sprint or the Backlog), or '' for an external dependency
     ext     for an external dependency: who or what the work waits on (a client, a vendor, a permit...)
     type    precedence relationship (PDM):  FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish
     lag     days: positive = lag (wait), negative = lead (overlap)
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

const lagTxt = (n) => (n > 0 ? n + ' day' + (n === 1 ? '' : 's') + ' lag' : n < 0 ? Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' lead' : '');
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
  const lag = Number(dep.lag) || 0;
  let conflict = null;
  // logic conflict: the successor already started (or finished) although the predecessor has not reached the point it must reach
  if (r.need === 'start' && started(S, succ)) conflict = { text: label(succ) + ' has already started, but ' + label(pred) + (r.from === 'finish' ? ' is not finished.' : ' has not started.') };
  else if (r.need === 'finish' && finished(S, succ)) conflict = { text: label(succ) + ' is already finished, but ' + label(pred) + (r.from === 'finish' ? ' is not finished.' : ' has not started.') };
  // schedule conflict: the dates break the rule
  if (!conflict) {
    const base = r.from === 'finish' ? fDate(pred) : sDate(pred);
    const have = r.need === 'start' ? sDate(succ) : fDate(succ);
    if (base && have) {
      // finish-to-start: the day after the predecessor ends; the others: the same day
      const target = addDays(base, lag + (dep.type === 'FS' ? 1 : 0));
      if (have < target) {
        const days = Math.round((pd(target) - pd(have)) / DAY);
        conflict = {
          days, field: r.need === 'start' ? 'start' : 'due', target,
          text: label(succ) + ' is planned to ' + r.need + ' on ' + fdate(have) + ', ' + days + ' day' + (days === 1 ? '' : 's') + ' too early. The earliest it can ' + r.need + ' is ' + fdate(target) + '.',
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

/* ---------- the RAID entry of a dependency ---------- */
export function describeDep(S, e) {
  const r = REL[e.dep.type] || REL.FS;
  const nat = (NATURE[e.dep.nature] || NATURE.mandatory).label.toLowerCase();
  const lag = lagTxt(Number(e.dep.lag) || 0);
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
          pred, type: REL[d.type] ? d.type : 'FS', lag,
          nature: NATURE[d.nature] ? d.nature : 'mandatory',
        };
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
  });
  S.raid.forEach((r) => {
    if (!r.depId || r.depRemoved || live.has(r.depId)) return;
    r.depRemoved = day;
    r.status = 'Closed';
    r.resp = ((r.resp || '').trim() ? r.resp.trim() + ' ' : '') + 'Dependency removed on ' + fdate(day) + ', so this entry was closed automatically and kept for the record.';
    if (r.respHtml) delete r.respHtml;
  });
}
