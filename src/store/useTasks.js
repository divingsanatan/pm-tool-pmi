import { useMemo, useRef } from 'react';
import { useStore } from './StoreContext';
import { useUI } from '../components/UI';
import { alignSprintDates, normalize, sprintHours } from '../lib/calc';
import { PRIORITIES, childTypeFor, containerById, findTask, firstOpenStatus, isDoneStatus, makeTask, statusPct, statusesOf, uid } from '../lib/tasks';
import { leafTasks, rootTasks, subtreeIds } from '../lib/hier';
import { cleanEffort, nz } from '../lib/format';
import { DAY, fdate, pd } from '../lib/dates';
import { blankCr, currentBaseline, sprintCrs } from '../lib/change';
import { offDayInfo } from '../lib/offdays';
import { baselinedDates, clampDates, datePatchViolations, dateCrOf, gapWindow, hoursCrOf, hoursLocked, inWin, nextFreeDay, outsideBaseline, rollover, sane, sprintClash, sprintCovers, tasksOutside, windowOf } from '../lib/sprintGuard';

const plural = (n, a, b) => (n === 1 ? a : b);
const span = (c) => (c.start ? fdate(c.start) : '…') + ' – ' + (c.end ? fdate(c.end) : '…');

const r2 = (x) => Math.round(x * 100) / 100;
const hrs = (x) => r2(x) + ' h';

// Work items of a sprint that could go to the Backlog to bring it back under its planned hours: top-level items that have not
// been started, lowest priority first (then the biggest), until `excess` hours are covered. `exclude` ids are never suggested.
// Returns { ids, hours }, or null when the open items cannot cover the excess.
function suggestBacklog(S, sp, excess, exclude = []) {
  const rank = Object.fromEntries(PRIORITIES.slice().reverse().map((p, i) => [p.id, i])); // low = 0 ... urgent = 3
  const started = (t) => (t.pct != null ? nz(t.pct) > 0 : statusPct(S, t.status) > 0);
  const pool = rootTasks(sp.tasks)
    .filter((t) => !exclude.includes(t.id) && nz(t.effort) > 0 && !(t.status && isDoneStatus(S, t.status)) && !started(t))
    .sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || nz(b.effort) - nz(a.effort));
  const ids = [];
  let hours = 0;
  for (const t of pool) {
    if (hours >= excess - 0.005) break;
    ids.push(t.id);
    hours += nz(t.effort);
  }
  return hours >= excess - 0.005 && ids.length ? { ids, hours: r2(hours) } : null;
}


// Dates of a start / due patch that fall on an off day of the project's Working calendar (weekly off day or holiday).
// Used only for a warning: work can still be planned on an off day.
function offDayHits(S, patch) {
  const seen = new Set();
  return ['start', 'due']
    .map((k) => patch && patch[k])
    .filter((d) => d && !seen.has(d) && seen.add(d))
    .map((d) => ({ date: d, info: offDayInfo(S, d) }))
    .filter((x) => x.info);
}

// effort in hours can never be negative
const safe = (f) => (f && 'effort' in f ? { ...f, effort: cleanEffort(f.effort) } : f);

// Only the highest items of a selection: an item is dropped when one of its ancestors is selected too
function topIds(c, ids) {
  const set = new Set(ids);
  const by = new Map(c.tasks.map((t) => [t.id, t]));
  return ids.filter((id) => {
    let x = by.get(id);
    let up = x && x.parent;
    let guard = 0;
    while (up && guard++ < 50) {
      if (set.has(up)) return false;
      up = (by.get(up) || {}).parent;
    }
    return !!x;
  });
}

// take one item and everything below it out of its list and put it in another (it becomes a top-level item there).
// In the Backlog it loses its status (and its dates when clearDates). In a sprint its dates are pulled inside that sprint,
// so work never sits outside the sprint it belongs to. Returns how many lowest-level items had dates changed.
function moveSubtree(p, id, to, clearDates) {
  const f = findTask(p, id);
  if (!f || f.c === to) return 0;
  const set = new Set(subtreeIds(f.c.tasks, id));
  const moving = f.c.tasks.filter((t) => set.has(t.id));
  f.c.tasks = f.c.tasks.filter((t) => !set.has(t.id));
  f.t.parent = '';
  const w = to.id === 'backlog' ? null : windowOf(to);
  const parents = new Set(moving.map((t) => t.parent).filter(Boolean));
  let changed = 0;
  moving.forEach((t) => {
    if (to.id === 'backlog') {
      t.status = '';
      if (clearDates) {
        t.start = '';
        t.due = '';
      }
    } else {
      if (!t.status) t.status = firstOpenStatus(p);
      const o = rollover(t, w);
      if (Object.keys(o).length) {
        Object.assign(t, o);
        if (!parents.has(t.id)) changed++;
      }
    }
    to.tasks.push(t);
  });
  return changed;
}

// Dry run of moving items to another container: how many lowest-level items would get their dates moved (for the message afterwards)
function previewMove(S, ids, toId) {
  const to = containerById(S, toId);
  const w = to && to.id !== 'backlog' ? windowOf(to) : null;
  if (!w) return 0;
  const seen = new Set();
  ids.forEach((id) => {
    const f = findTask(S, id);
    if (!f || f.c === to) return;
    const set = new Set(subtreeIds(f.c.tasks, id));
    const parents = new Set(f.c.tasks.filter((t) => set.has(t.id)).map((t) => t.parent).filter(Boolean));
    f.c.tasks.forEach((t) => set.has(t.id) && !parents.has(t.id) && Object.keys(rollover(t, w)).length && seen.add(t.id));
  });
  return seen.size;
}

// of these ids, the lowest-level items (a parent's dates are rolled up from its children, so only they can be "outside")
function leafIds(S, ids) {
  return ids.filter((id) => {
    const f = findTask(S, id);
    return f && !f.c.tasks.some((x) => x.parent === id);
  });
}

// put an item under `parent` (or at the top when ''), right before or after the sibling `ref` (or last when no ref)
function place(p, id, { parent = '', ref = '', pos = 'after' }) {
  const f = findTask(p, id);
  if (!f) return false;
  const c = f.c;
  if (parent) {
    if (!c.tasks.some((x) => x.id === parent)) return false;
    if (subtreeIds(c.tasks, id).includes(parent)) return false; // cannot go inside itself
  }
  if (ref === id) return false;
  c.tasks.splice(f.i, 1);
  f.t.parent = parent;
  let at = c.tasks.length;
  if (ref) {
    const j = c.tasks.findIndex((x) => x.id === ref);
    if (j >= 0) at = pos === 'before' ? j : j + 1;
  }
  c.tasks.splice(at, 0, f.t);
  return true;
}

// delete items and everything below them
function removeIds(p, ids) {
  const gone = new Set();
  ids.forEach((id) => {
    const f = findTask(p, id);
    if (f) subtreeIds(f.c.tasks, id).forEach((x) => gone.add(x));
  });
  [...p.sprints, p.backlog].forEach((c) => (c.tasks = c.tasks.filter((t) => !gone.has(t.id))));
}

const siblingsOf = (c, t) => c.tasks.filter((x) => (x.parent || '') === (t.parent || ''));

// All task / sprint mutations in one place. Every function edits the current project.
//
// Work items can never be dated outside their sprint. An edit that would do so is held back and the user chooses:
//   - set the date inside the sprint (the nearest day the sprint allows),
//   - move the work item to a new sprint (or to the existing sprint that already covers that date),
//   - move the work item to the Backlog.
// Cancel keeps things as they were.
export function useTasks() {
  const { update, S } = useStore();
  const ui = useUI();
  const sRef = useRef(S);
  sRef.current = S;
  const uRef = useRef(ui);
  uRef.current = ui;

  return useMemo(() => {
    const say = (o) => uRef.current && uRef.current.toast && uRef.current.toast(o);
    const clear = () => uRef.current && uRef.current.dismiss && uRef.current.dismiss('guard');
    const withDecision = (o) => say({ id: 'guard', tone: 'warn', ...o });
    // Warning only, never a block: tell the user when work is dated on an off day of the Working calendar (Budget tab).
    // `ids` are the work items just changed (or created); `patch` holds the start / due dates they were given.
    const warnOffDays = (ids, patch) => {
      const S0 = sRef.current;
      const hits = offDayHits(S0, patch);
      if (!hits.length) return;
      const why = (h) => fdate(h.date) + ' (' + (h.info.kind === 'holiday' ? 'holiday: ' + h.info.label : h.info.label + ', a weekly off day') + ')';
      const names = ids.map((id) => (findTask(S0, id) || { t: {} }).t.name).filter(Boolean);
      const nm = names[0] || (patch && patch.name);
      const who = ids.length === 1 && nm ? '\u201c' + nm + '\u201d' : ids.length > 1 ? ids.length + ' work items' : 'This work item';
      say({
        id: 'offday', tone: 'warn', ttl: 9000,
        text: who + ' is dated ' + hits.map(why).join(' and ') + ', an off day in the project\u2019s Working calendar. The change is saved, but nobody is expected to work that day. Check the date or the Working calendar on the Budget tab.',
      });
    };
    // Every new sprint goes through the New sprint form (planned hours, and a change request once the project has a baseline).
    // The work items only move after the sprint exists, so cancelling the form changes nothing.
    const newSprintFor = (pre, done) => uRef.current && uRef.current.openSprint && uRef.current.openSprint(sRef.current.id, { ...pre, onCreated: done });

    // applies a start / due patch to the listed items, each pulled inside its own sprint
    const applyClamped = (p, ids, patch) =>
      ids.forEach((id) => {
        const f = findTask(p, id);
        if (!f) return;
        const w = windowOf(f.c);
        Object.assign(f.t, patch, w ? clampDates(w, { ...f.t, ...patch }) : {});
      });

    // Returns true when the edit was held back (the user is now choosing what to do)
    function guardDates(allIds, patch) {
      const dates = ['start', 'due'].map((k) => patch[k]).filter(Boolean);
      if (dates.some((d) => !sane(d))) return true; // half-typed date: ignore until it is complete
      const ids = leafIds(sRef.current, allIds);
      const viol = datePatchViolations(sRef.current, ids, patch);
      if (!viol.length) {
        clear();
        return false;
      }
      const sprints = Array.from(new Set(viol.map((x) => x.sprint.id))).map((id) => viol.find((x) => x.sprint.id === id).sprint);
      const one = sprints.length === 1 ? sprints[0] : null;
      const vids = viol.map((x) => x.id);
      const sorted = dates.slice().sort();
      const lo = sorted[0], hi = sorted[sorted.length - 1];
      const label = viol.length === 1 ? '“' + viol[0].task.name + '”' : viol.length + ' work items';
      const dtxt = dates.length === 1 ? fdate(dates[0]) : fdate(lo) + ' – ' + fdate(hi);
      const where = one ? one.name + ' runs ' + span(one) : 'their sprints do not cover that date';
      const key = patch.start ? 'start' : 'due';
      const actions = [];

      // 1. keep the work item in its sprint and set the date inside the sprint's time frame
      actions.push({
        label: viol.length === 1 && one ? 'Set it to ' + fdate(clampDates(windowOf(one), { ...viol[0].task, ...patch })[key] || windowOf(one).lo) : 'Set dates inside the sprint',
        primary: true,
        onClick: () => {
          update((p) => applyClamped(p, allIds, patch));
          // the nearest allowed day can itself be an off day: warn about the dates the items actually got
          const S0 = sRef.current;
          const got = {};
          allIds.forEach((id) => {
            const f = findTask(S0, id), w = f && windowOf(f.c);
            if (f) ['start', 'due'].forEach((k) => patch[k] && !got[k] && (got[k] = w ? clampDates(w, { ...f.t, ...patch })[k] || patch[k] : patch[k]));
          });
          warnOffDays(allIds, got);
        },
      });
      // 2. move it to a sprint that covers the date: an existing one, otherwise a new one
      if (one) {
        const cover = sRef.current.sprints.find((x) => x.id !== one.id && dates.every((d) => sprintCovers(x, d)));
        if (cover) {
          actions.push({
            label: 'Move to ' + cover.name,
            onClick: () =>
              update((p) => {
                const to = containerById(p, cover.id);
                vids.forEach((id) => moveSubtree(p, id, to, false));
                applyClamped(p, allIds, patch);
              }),
          });
        } else {
          const win = gapWindow(sRef.current, lo, hi, sRef.current.meta.sprintWeeks || 2);
          actions.push({
            label: 'Move to a new sprint (' + fdate(win.start) + ' – ' + fdate(win.end) + ')',
            onClick: () =>
              newSprintFor({ start: win.start, end: win.end }, (sid) =>
                update((p) => {
                  vids.forEach((id) => moveSubtree(p, id, containerById(p, sid), false));
                  applyClamped(p, allIds, patch);
                })
              ),
          });
        }
      }
      // 3. take it out of the plan: the Backlog has no sprint dates
      actions.push({
        label: 'Move to Backlog',
        onClick: () =>
          update((p) => {
            vids.forEach((id) => moveSubtree(p, id, p.backlog, true));
            applyClamped(p, allIds.filter((id) => !vids.includes(id)), patch);
          }),
      });
      withDecision({ text: label + ' cannot be dated ' + dtxt + ' because ' + where + '. Work items must stay inside their sprint. What would you like to do?', actions });
      return true;
    }

    /* Work item hours of a sprint. Two rules, checked on a dry run of the edit (`run`) before anything changes:
         1. Work items can never add up to more than the sprint's planned hours. The user then chooses: move some work items to the
            Backlog, or move them to a new sprint (the New sprint form asks for a change request once the project has a baseline).
         2. Once a baseline exists, the hours of a sprint in it are fixed. A change needs a change request, raised or linked here
            (kept on the sprint as hoursCrId), unless the sprint's open request already covers it.
       o.cause: the work items behind the edit (the default is the items the edit created). o.lockDown: lowering hours needs a request too
       (typing new hours); moving items out of a sprint never does, because that is the way out of rule 1.
       Returns true when the edit was held back. */
    function guardHours(run, o = {}) {
      const S0 = sRef.current;
      const sim = structuredClone(S0);
      run(sim, sim);
      normalize(sim);
      const had = new Set(S0.sprints.flatMap((s) => s.tasks).concat(S0.backlog.tasks).map((t) => t.id));
      const hits = [];
      sim.sprints.forEach((sp) => {
        const was = S0.sprints.find((x) => x.id === sp.id);
        if (!was) return;
        const a = sprintHours(S0, was).items;
        const h = sprintHours(sim, sp);
        const d = r2(h.items - a);
        if (Math.abs(d) < 0.005) return;
        const over = h.planned > 0 && h.items > h.planned + 0.005 && d > 0;
        const lock = hoursLocked(S0, was) && (d > 0 || !!o.lockDown);
        if (over || lock) hits.push({ was, sp, before: a, after: h.items, planned: h.planned, over, lock });
      });
      if (!hits.length) {
        clear();
        return false;
      }
      const h = hits.find((x) => x.over) || hits[0];
      const added = sim.sprints.flatMap((s) => s.tasks).filter((t) => !had.has(t.id));
      const addedIds = new Set(added.map((t) => t.id));
      const cause = (o.cause || added.filter((t) => !addedIds.has(t.parent)).map((t) => t.id)).filter((id) => {
        const f = findTask(sim, id);
        return f && f.c.id === h.sp.id;
      });
      const causeHours = r2(cause.reduce((a, id) => a + nz((findTask(sim, id) || { t: {} }).t.effort), 0));
      const what = cause.length === 1 ? 'this work item' : cause.length + ' work items';
      const b0 = currentBaseline(S0);

      if (h.over) {
        const excess = r2(h.after - h.planned);
        const actions = [];
        if (cause.length)
          actions.push({
            label: 'Move ' + what + ' to the Backlog',
            primary: true,
            onClick: () => update((p) => { run(p, p); cause.forEach((id) => moveSubtree(p, id, p.backlog, true)); }),
          });
        const sug = h.lock ? null : suggestBacklog(sim, h.sp, excess, cause);
        if (sug)
          actions.push({
            label: 'Keep it and move ' + sug.ids.length + ' lower-priority open ' + plural(sug.ids.length, 'item', 'items') + ' (' + hrs(sug.hours) + ') to the Backlog',
            onClick: () => update((p) => { run(p, p); sug.ids.forEach((id) => moveSubtree(p, id, p.backlog, true)); }),
          });
        if (cause.length)
          actions.push({
            label: 'Move ' + what + ' to a new sprint',
            onClick: () => newSprintFor({ hours: causeHours || undefined, minHours: causeHours || undefined }, (sid) => update((p) => { run(p, p); cause.forEach((id) => moveSubtree(p, id, containerById(p, sid), false)); })),
          });
        withDecision({
          text: h.sp.name + ' work items would add up to ' + hrs(h.after) + ', which is ' + hrs(excess) + ' over its ' + hrs(h.planned) + ' planned hours. Work items cannot exceed the sprint\u2019s planned hours. Move some work items to the Backlog, or to a new sprint' + (b0 ? ' (the new sprint needs a change request linked or created, because the project is baselined)' : '') + '. Cancel keeps things as they are.',
          actions,
        });
        return true;
      }

      // baseline lock: a change request must cover the new hours
      const locked = hits.filter((x) => x.lock);
      const apply = (p, crId) => {
        run(p, p);
        const cr = p.cr.find((x) => x.id === crId);
        locked.forEach((x) => {
          const sp = containerById(p, x.sp.id);
          if (sp) sp.hoursCrId = crId;
          if (cr) cr.log.push({ on: new Date().toISOString().slice(0, 10), text: x.sp.name + ' work item hours set to ' + hrs(x.after) + ' (baselined with ' + hrs(x.before) + ')' });
        });
      };
      const open = sprintCrs(S0).slice(-3).reverse();
      const up = locked.some((x) => x.after > x.before);
      const actions = [{
        label: 'Raise a new change request',
        primary: true,
        onClick: () =>
          update((p) => {
            const id = uid();
            p.cr.push(blankCr(p, id, {
              title: 'Change ' + locked.map((x) => x.sp.name).join(', ') + ' work item hours',
              kind: up ? 'Enhancement or new requirement' : 'Corrective action', affects: ['Scope', 'Cost'], cost: 0, days: 0,
              desc: locked.map((x) => x.sp.name + ': work item hours change from ' + hrs(x.before) + ' (baselined) to ' + hrs(x.after) + '.').join(' '),
            }));
            apply(p, id);
          }),
      }].concat(open.map((cr) => ({ label: 'Link to ' + cr.code + (cr.title ? ' · ' + cr.title : ''), onClick: () => update((p) => apply(p, cr.id)) })));
      withDecision({
        text: 'The baseline (' + b0.version + ') fixes the work item hours of ' + locked.map((x) => x.sp.name + ' (' + hrs(x.before) + ')').join(', ') + '. This change makes them ' + locked.map((x) => hrs(x.after)).join(', ') + ', so a change request must cover it. Cancel keeps the hours as they are.',
        actions,
      });
      return true;
    }

    // A sprint's dates are changing: say what happens to the work items that would end up outside them
    function guardSprint(cid, patch) {
      const S0 = sRef.current;
      const c = containerById(S0, cid);
      if (!c || cid === 'backlog') return false;
      const next = { start: 'start' in patch ? patch.start || '' : c.start || '', end: 'end' in patch ? patch.end || '' : c.end || '' };
      if ((next.start && !sane(next.start)) || (next.end && !sane(next.end))) return true;
      if ('plannedHours' in patch && !(patch.plannedHours > 0)) {
        say({ id: 'guard', tone: 'bad', text: 'Every sprint needs planned hours above 0, because its share of the budget comes from them.', ttl: 7000 });
        return true;
      }
      if ('plannedHours' in patch) {
        const want = r2(nz(patch.plannedHours)), was = nz(c.plannedHours);
        const noDates = !('start' in patch || 'end' in patch);
        if (Math.abs(want - was) < 0.005 && noDates) return true; // nothing changed
        const items = sprintHours(S0, c).items;
        const locked = hoursLocked(S0, c) && was > 0; // a sprint with no planned hours yet can still get them
        // rule 1: the planned hours can never go below the work items already in the sprint
        if (want < items - 0.005) {
          const excess = r2(items - want);
          const sug = suggestBacklog(S0, c, excess);
          const actions = sug
            ? [{
                label: 'Move ' + sug.ids.length + ' lower-priority open ' + plural(sug.ids.length, 'item', 'items') + ' (' + hrs(sug.hours) + ') to the Backlog' + (locked ? '' : ' and set ' + hrs(want)),
                primary: true,
                onClick: () => update((p) => { if (!locked) Object.assign(containerById(p, cid), patch); sug.ids.forEach((id) => moveSubtree(p, id, p.backlog, true)); }),
              }]
            : [];
          withDecision({
            text: c.name + ' has ' + hrs(items) + ' of work items, so its planned hours cannot be ' + hrs(want) + ' (' + hrs(excess) + ' short). Move some work items to the Backlog or to a new sprint first.' + (locked ? ' The baseline fixes the planned hours, so changing them afterwards needs a change request.' : ''),
            actions,
          });
          return true;
        }
        // rule 2: after the first baseline the planned hours change only through a change request
        if (locked && Math.abs(want - was) >= 0.005) {
          const b0 = currentBaseline(S0);
          const apply = (p, crId) => {
            const sp = containerById(p, cid);
            Object.assign(sp, patch);
            sp.hoursCrId = crId;
            const cr = p.cr.find((x) => x.id === crId);
            if (cr) cr.log.push({ on: new Date().toISOString().slice(0, 10), text: sp.name + ' planned hours set to ' + hrs(want) + ' (baselined with ' + hrs(was) + ')' });
          };
          const open = sprintCrs(S0).slice(-3).reverse();
          const actions = [{
            label: 'Raise a new change request',
            primary: true,
            onClick: () =>
              update((p) => {
                const id = uid();
                p.cr.push(blankCr(p, id, { title: 'Change ' + c.name + ' planned hours', kind: want > was ? 'Enhancement or new requirement' : 'Corrective action', affects: ['Scope', 'Cost'], cost: 0, days: 0, desc: c.name + ': planned hours change from ' + hrs(was) + ' (baselined) to ' + hrs(want) + '.' }));
                apply(p, id);
              }),
          }].concat(open.map((cr) => ({ label: 'Link to ' + cr.code + (cr.title ? ' · ' + cr.title : ''), onClick: () => update((p) => apply(p, cr.id)) })));
          withDecision({ text: 'The baseline (' + b0.version + ') fixes the planned hours of ' + c.name + ' at ' + hrs(was) + '. ' + hrs(want) + ' needs a change request. Cancel keeps ' + hrs(was) + '.', actions });
          return true;
        }
      }
      if (next.start && next.end && next.start > next.end) {
        say({ id: 'guard', tone: 'bad', text: 'A sprint cannot end before it starts.', ttl: 6000 });
        return true;
      }
      // sprints of one project cannot share a day (only checked when a date is being changed, so other edits to an old overlapping sprint still work)
      if ('start' in patch || 'end' in patch) {
        const hit = sprintClash(S0, cid, next.start, next.end);
        if (hit.length) {
          const free = nextFreeDay(S0, cid, next.start, next.end);
          say({ id: 'guard', tone: 'bad', text: 'Sprint dates cannot overlap. ' + fdate(next.start) + ' – ' + fdate(next.end) + ' overlaps ' + hit.map((s) => s.name + ' (' + span(s) + ')').join(', ') + '.' + (free !== next.start ? ' The first free start date is ' + fdate(free) + '.' : ''), ttl: 9000 });
          return true;
        }
      }
      // Baseline lock: inside the dates the sprint was baselined with, move freely; outside them, a change request must cover it
      if (('start' in patch || 'end' in patch) && outsideBaseline(S0, cid, next.start, next.end) && !dateCrOf(S0, c)) {
        const bw = baselinedDates(S0, cid), b0 = currentBaseline(S0);
        const apply = (p, crId) => {
          const sp = containerById(p, cid);
          Object.assign(sp, patch);
          sp.dateCrId = crId;
          const cr = p.cr.find((x) => x.id === crId);
          if (cr) cr.log.push({ on: new Date().toISOString().slice(0, 10), text: sp.name + ' dates set to ' + fdate(sp.start) + ' – ' + fdate(sp.end) + ' (baselined ' + fdate(bw.start) + ' – ' + fdate(bw.end) + ')' });
        };
        const open = sprintCrs(S0).slice(-3).reverse();
        const lastEnd = [next.end].concat(S0.sprints.filter((x) => x.id !== cid && x.end).map((x) => x.end)).sort().pop();
        const days = Math.max(0, Math.round((pd(lastEnd) - pd(b0.end)) / DAY));
        const actions = [{
          label: 'Raise a new change request',
          primary: true,
          onClick: () =>
            update((p) => {
              const id = uid();
              p.cr.push(blankCr(p, id, { title: 'Change ' + c.name + ' dates', kind: 'Corrective action', affects: ['Schedule'], cost: 0, days, desc: c.name + ' moves from its baselined dates (' + fdate(bw.start) + ' – ' + fdate(bw.end) + ') to ' + fdate(next.start) + ' – ' + fdate(next.end) + '.' }));
              apply(p, id);
            }),
        }].concat(open.map((cr) => ({ label: 'Link to ' + cr.code + (cr.title ? ' · ' + cr.title : ''), onClick: () => update((p) => apply(p, cr.id)) })));
        withDecision({ text: 'The baseline (' + b0.version + ') fixes ' + c.name + ' at ' + fdate(bw.start) + ' – ' + fdate(bw.end) + '. ' + fdate(next.start) + ' – ' + fdate(next.end) + ' is outside it, so a change request must cover the change. Dates inside the baselined dates need no request.', actions });
        return true;
      }
      const w = { lo: next.start, hi: next.end };
      const out = next.start || next.end ? tasksOutside(c, w) : [];
      if (!out.length) {
        clear();
        return false;
      }
      const ids = out.map((t) => t.id);
      const dates = out.flatMap((t) => [t.start, t.due]).filter((d) => d && !inWin(w, d)).sort();
      const after = dates.every((d) => w.hi && d > w.hi), before = dates.every((d) => w.lo && d < w.lo);
      const setSprint = (p) => Object.assign(containerById(p, cid), patch);
      const actions = [
        {
          label: 'Set their dates inside the sprint',
          primary: true,
          onClick: () =>
            update((p) => {
              setSprint(p);
              const sp = containerById(p, cid);
              sp.tasks.forEach((t) => {
                if (ids.includes(t.id)) Object.assign(t, clampDates(windowOf(sp), t));
              });
            }),
        },
      ];
      if (after || before) {
        const win = gapWindow({ ...S0, sprints: S0.sprints.map((x) => (x.id === cid ? { ...x, start: next.start, end: next.end } : x)) }, dates[0], dates[dates.length - 1], S0.meta.sprintWeeks || 2);
        actions.push({
          label: 'Move to a new sprint (' + fdate(win.start) + ' – ' + fdate(win.end) + ')',
          onClick: () =>
            newSprintFor({ start: win.start, end: win.end }, (sid) =>
              update((p) => {
                setSprint(p);
                ids.forEach((id) => moveSubtree(p, id, containerById(p, sid), false));
              })
            ),
        });
      }
      actions.push({
        label: 'Move ' + ids.length + ' to Backlog',
        onClick: () =>
          update((p) => {
            setSprint(p);
            ids.forEach((id) => moveSubtree(p, id, p.backlog, true));
          }),
      });
      withDecision({
        text: ids.length + ' work ' + plural(ids.length, 'item is', 'items are') + ' dated outside ' + c.name + ' (' + span({ start: next.start, end: next.end }) + '). Work items must stay inside their sprint. What would you like to do with ' + plural(ids.length, 'it', 'them') + '? Cancel keeps the old sprint dates.',
        actions,
      });
      return true;
    }

    const moveNote = (n, toId) => {
      const to = containerById(sRef.current, toId);
      if (n > 0 && to && to.id !== 'backlog') say({ id: 'moved', tone: 'info', ttl: 8000, text: n + ' ' + plural(n, 'date was', 'dates were') + ' moved inside ' + to.name + ' (' + span(to) + ') so the work item stays within the sprint.' });
    };

    // top-level items of sprint a that still have unfinished work below them
    const openRoots = (p, a) => {
      const leaves = new Set(leafTasks(a.tasks).filter((t) => !(t.status && isDoneStatus(p, t.status))).map((t) => t.id));
      return a.tasks.filter((t) => !t.parent && subtreeIds(a.tasks, t.id).some((x) => leaves.has(x)));
    };

    return {
      // a new top-level work item
      add(cid, fields = {}) {
        fields = safe(fields);
        const id = fields.id || uid();
        const run = (p) => {
          const c = containerById(p, cid);
          if (c) c.tasks.push(makeTask(p, { ...fields, id, ...(cid === 'backlog' ? { status: '' } : {}) }));
        };
        if (cid !== 'backlog' && nz(fields.effort) > 0 && guardHours(run, { cause: [id] })) return id;
        update(run);
        warnOffDays([id], fields);
        return id;
      },
      // a new work item under another one (its type steps down the ladder: epic > feature > story > task > subtask)
      addChild(parentId, fields = {}) {
        fields = safe(fields);
        const id = fields.id || uid();
        const run = (p) => {
          const f = findTask(p, parentId);
          if (!f) return;
          const type = fields.type || childTypeFor(p, f.t.type);
          // a new sub-item starts in its parent's status, so adding one never changes the status the parent already has
          const status = f.c.id === 'backlog' ? '' : fields.status || f.t.status || undefined;
          f.c.tasks.push(makeTask(p, { ...fields, type, id, parent: parentId, ...(status !== undefined ? { status } : {}) }));
        };
        if (nz(fields.effort) > 0 && guardHours(run, { cause: [id] })) return id;
        update(run);
        warnOffDays([id], fields);
        return id;
      },
      // a new work item right after another one, at the same level
      addSibling(afterId, fields = {}) {
        fields = safe(fields);
        const id = fields.id || uid();
        const run = (p) => {
          const f = findTask(p, afterId);
          if (!f) return;
          const t = makeTask(p, { name: 'New task', ...fields, type: fields.type || f.t.type, id, parent: f.t.parent || '', ...(f.c.id === 'backlog' ? { status: '' } : {}) });
          f.c.tasks.splice(f.i + 1, 0, t);
        };
        if (nz(fields.effort) > 0 && guardHours(run, { cause: [id] })) return id;
        update(run);
        warnOffDays([id], fields);
        return id;
      },
      patch(id, patch) {
        patch = safe(patch);
        if (('start' in patch || 'due' in patch) && guardDates([id], patch)) return;
        const run = (p) => {
          const f = findTask(p, id);
          if (f) {
            Object.assign(f.t, patch);
            if ('status' in patch && f.c.tasks.some((k) => k.parent === f.t.id)) f.t.statusSet = true; // a status chosen by hand on a parent stays
          }
        };
        if ('effort' in patch && guardHours(run, { cause: [id], lockDown: true })) return;
        update(run);
        warnOffDays([id], patch);
      },
      // A parent's own estimate and dates, kept apart from what rolls up from its child items (ClickUp style: the parent shows
      // the child items plus its own). `o` holds effort / start / due; they are stored as ownEffort / ownStart / ownDue.
      // The same rules as any work item apply: dates stay inside the sprint, hours respect the planned hours and the baseline lock.
      patchOwn(id, o) {
        o = safe(o);
        const own = {};
        if ('effort' in o) own.ownEffort = o.effort;
        if ('start' in o) own.ownStart = o.start || '';
        if ('due' in o) own.ownDue = o.due || '';
        const dates = ['start', 'due'].map((k) => o[k]).filter(Boolean);
        if (dates.some((d) => !sane(d))) return; // half-typed date: ignore until it is complete
        const S0 = sRef.current;
        const f0 = findTask(S0, id);
        if (!f0) return;
        const w = windowOf(f0.c);
        if (dates.length && w && datePatchViolations(S0, [id], { start: o.start, due: o.due }).length) {
          const fix = clampDates(w, { start: o.start || '', due: o.due || '' });
          const got = { ...own };
          if ('start' in o && fix.start) got.ownStart = fix.start;
          if ('due' in o && fix.due) got.ownDue = fix.due;
          const sorted = dates.slice().sort();
          withDecision({
            text: '\u201c' + f0.t.name + '\u201d cannot have its own date ' + (dates.length === 1 ? fdate(dates[0]) : fdate(sorted[0]) + ' \u2013 ' + fdate(sorted[sorted.length - 1])) + ' because ' + f0.c.name + ' runs ' + span(f0.c) + '. Work items must stay inside their sprint.',
            actions: [{
              label: 'Set it inside the sprint',
              primary: true,
              onClick: () => {
                clear();
                update((p) => { const g = findTask(p, id); if (g) Object.assign(g.t, got); });
                warnOffDays([id], { start: got.ownStart, due: got.ownDue });
              },
            }],
          });
          return;
        }
        if (dates.length) clear();
        const run = (p) => {
          const f = findTask(p, id);
          if (f) Object.assign(f.t, own);
        };
        if ('effort' in o && guardHours(run, { cause: [id], lockDown: true })) return;
        update(run);
        warnOffDays([id], { start: o.start, due: o.due });
      },
      // Change the status of one or several work items. This is the one call the List, Board, drawer and bulk bar use.
      // Every item can carry its own status, parents included. A parent's status is automatic (from its child items) until it
      // is set here; autoStatus() hands it back to the roll-up. Closing items that still have open child items asks first,
      // like ClickUp: close the child items too, or only the chosen ones.
      setStatus(ids, statusId) {
        const list = [].concat(ids);
        const S0 = sRef.current;
        const target = statusesOf(S0).find((x) => x.id === statusId);
        if (!target) return;
        const apply = (set) =>
          update((p) =>
            set.forEach((id) => {
              const f = findTask(p, id);
              if (!f || f.c.id === 'backlog') return; // the Backlog has no statuses
              f.t.status = statusId;
              if (f.c.tasks.some((k) => k.parent === f.t.id)) f.t.statusSet = true;
            })
          );
        if (!target.done) return void apply(list);
        const chosen = new Set(list);
        const open = new Set();
        list.forEach((id) => {
          const f = findTask(S0, id);
          if (!f || f.c.id === 'backlog') return;
          subtreeIds(f.c.tasks, id).slice(1).forEach((x) => {
            const k = f.c.tasks.find((t) => t.id === x);
            if (k && !chosen.has(x) && !isDoneStatus(S0, k.status)) open.add(x);
          });
        });
        if (!open.size) return void apply(list);
        const n = open.size;
        withDecision({
          text: n + ' child item' + (n === 1 ? ' is' : 's are') + ' not ' + target.label.toLowerCase() + ' yet. Set ' + (n === 1 ? 'it' : 'them') + ' to ' + target.label + ' as well?',
          actions: [
            { label: 'Yes, ' + target.label + ' too', primary: true, onClick: () => { clear(); apply(list.concat([...open])); } },
            { label: 'Only the selected', onClick: () => { clear(); apply(list); } },
          ],
        });
      },
      // a parent goes back to showing the status calculated from its child items
      autoStatus(id) {
        update((p) => {
          const f = findTask(p, id);
          if (f) delete f.t.statusSet;
        });
      },
      // pull every work item's start and due date of one sprint back inside that sprint
      alignDates(sprintId) {
        update((p) => void alignSprintDates(p, sprintId));
      },
      // Fixes work items that are already dated outside their sprint (older data), in one go.
      // mode: 'inside' sets the dates inside the sprint, 'sprint' moves them to a new sprint, 'backlog' moves them to the Backlog.
      resolveOutside(mode, sprintId) {
        if (mode === 'sprint') {
          // one new sprint that covers every out-of-range date; the items move once the sprint has been created
          const S0 = sRef.current;
          const out = [];
          const dates = [];
          S0.sprints.forEach((sp) => {
            if ((sprintId && sp.id !== sprintId) || !sp.start || !sp.end) return;
            const w = windowOf(sp);
            tasksOutside(sp, w).forEach((t) => {
              out.push(t.id);
              [t.start, t.due].forEach((d) => d && !inWin(w, d) && dates.push(d));
            });
          });
          if (!out.length) return;
          dates.sort();
          const win = gapWindow(S0, dates[0], dates[dates.length - 1], S0.meta.sprintWeeks || 2);
          newSprintFor({ start: win.start, end: win.end }, (sid) => update((p) => out.forEach((id) => moveSubtree(p, id, containerById(p, sid), false))));
          return;
        }
        update((p) => {
          p.sprints.slice().forEach((sp) => {
            if ((sprintId && sp.id !== sprintId) || !sp.start || !sp.end) return;
            const w = windowOf(sp);
            const out = tasksOutside(sp, w);
            if (!out.length) return;
            if (mode === 'inside') {
              out.forEach((t) => Object.assign(t, clampDates(w, t)));
            } else if (mode === 'backlog') {
              out.forEach((t) => moveSubtree(p, t.id, p.backlog, true));
            }
          });
        });
      },
      // change several work items in one update (one render, one save)
      patchMany(ids, patch) {
        patch = safe(patch);
        if (('start' in patch || 'due' in patch) && guardDates(ids, patch)) return;
        const run = (p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f) {
              Object.assign(f.t, patch);
              if ('status' in patch && f.c.tasks.some((k) => k.parent === f.t.id)) f.t.statusSet = true;
            }
          });
        };
        if ('effort' in patch && guardHours(run, { cause: ids, lockDown: true })) return;
        update(run);
        warnOffDays(ids, patch);
      },
      // add (on = true) or remove one stakeholder on every listed work item
      assignMany(ids, personId, on) {
        update((p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (!f) return;
            const a = (f.t.assignees || []).filter((x) => x !== personId);
            f.t.assignees = on ? a.concat(personId) : a;
          });
        });
      },
      // moving an item moves everything below it too
      moveMany(ids, cid) {
        const run = (p) => {
          const to = containerById(p, cid);
          if (!to) return;
          const groups = new Map();
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f && f.c !== to) groups.set(f.c, (groups.get(f.c) || []).concat(id));
          });
          groups.forEach((list, c) => topIds(c, list).forEach((id) => moveSubtree(p, id, to, true)));
        };
        if (cid !== 'backlog' && guardHours(run, { cause: ids })) return;
        moveNote(previewMove(sRef.current, ids, cid), cid);
        update(run);
      },
      move(id, cid) {
        const run = (p) => {
          const to = containerById(p, cid);
          if (to) moveSubtree(p, id, to, false);
        };
        if (cid !== 'backlog' && guardHours(run, { cause: [id] })) return;
        moveNote(previewMove(sRef.current, [id], cid), cid);
        update(run);
      },
      // deleting an item deletes everything below it
      removeMany(ids) {
        update((p) => void removeIds(p, ids));
      },
      remove(id) {
        update((p) => void removeIds(p, [id]));
      },
      // copies (with everything below them) are placed right after their originals with new codes
      duplicateMany(ids) {
        const run = (p) => {
          const groups = new Map();
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f) groups.set(f.c, (groups.get(f.c) || []).concat(id));
          });
          groups.forEach((list, c) =>
            topIds(c, list).forEach((id) => {
              const i = c.tasks.findIndex((t) => t.id === id);
              if (i < 0) return;
              const set = new Set(subtreeIds(c.tasks, id));
              const origs = c.tasks.filter((t) => set.has(t.id));
              const map = new Map();
              const copies = origs.map((t) => {
                const n = p.counter || 1;
                p.counter = n + 1;
                const copy = structuredClone(t);
                copy.id = uid();
                copy.code = 'T-' + n;
                map.set(t.id, copy.id);
                return copy;
              });
              copies.forEach((cp, k) => {
                const orig = origs[k];
                cp.parent = orig.id === id ? orig.parent || '' : map.get(orig.parent) || '';
                if (orig.id === id) cp.name = orig.name + ' (copy)';
              });
              c.tasks.splice(i + 1, 0, ...copies);
            })
          );
        };
        if (guardHours(run)) return;
        update(run);
      },
      // put an item under a parent (or at the top level) at an exact spot: used by drag and drop, indent, outdent
      place(id, where) {
        update((p) => void place(p, id, where));
      },
      // make it a child of the item just above it at the same level
      indent(id) {
        update((p) => {
          const f = findTask(p, id);
          if (!f) return;
          const sibs = siblingsOf(f.c, f.t);
          const k = sibs.findIndex((x) => x.id === id);
          if (k > 0) place(p, id, { parent: sibs[k - 1].id });
        });
      },
      // move it up one level, right after its old parent
      outdent(id) {
        update((p) => {
          const f = findTask(p, id);
          if (!f || !f.t.parent) return;
          const par = f.c.tasks.find((x) => x.id === f.t.parent);
          if (par) place(p, id, { parent: par.parent || '', ref: par.id, pos: 'after' });
        });
      },
      moveUp(id) {
        update((p) => {
          const f = findTask(p, id);
          if (!f) return;
          const sibs = siblingsOf(f.c, f.t);
          const k = sibs.findIndex((x) => x.id === id);
          if (k > 0) place(p, id, { parent: f.t.parent || '', ref: sibs[k - 1].id, pos: 'before' });
        });
      },
      moveDown(id) {
        update((p) => {
          const f = findTask(p, id);
          if (!f) return;
          const sibs = siblingsOf(f.c, f.t);
          const k = sibs.findIndex((x) => x.id === id);
          if (k >= 0 && k < sibs.length - 1) place(p, id, { parent: f.t.parent || '', ref: sibs[k + 1].id, pos: 'after' });
        });
      },
      toggleAssignee(id, personId) {
        update((p) => {
          const f = findTask(p, id);
          if (!f) return;
          const a = f.t.assignees || [];
          f.t.assignees = a.includes(personId) ? a.filter((x) => x !== personId) : a.concat(personId);
        });
      },
      patchContainer(cid, patch) {
        if (('start' in patch || 'end' in patch || 'plannedHours' in patch) && guardSprint(cid, patch)) return;
        update((p) => {
          const c = containerById(p, cid);
          if (!c) return;
          Object.assign(c, patch);
          // dates moved under an open change request: leave the trail in that request
          if (('start' in patch || 'end' in patch) && c.dateCrId) {
            const cr = p.cr.find((x) => x.id === c.dateCrId), bw = baselinedDates(p, cid);
            if (cr && bw) cr.log.push({ on: new Date().toISOString().slice(0, 10), text: c.name + ' dates set to ' + fdate(c.start) + ' \u2013 ' + fdate(c.end) + ' (baselined ' + fdate(bw.start) + ' \u2013 ' + fdate(bw.end) + ')' });
          }
        });
      },
      // After a baseline the sprint dates are read-only. This opens them through a change request: a new one (crId empty) or an open one.
      // The request carries the reason; the next baseline records the new dates. Returns the id of the request.
      unlockDates(cid, { crId = '', reason = '' } = {}) {
        const id = crId || uid();
        update((p) => {
          const sp = containerById(p, cid);
          if (!sp) return;
          const bw = baselinedDates(p, cid);
          const was = bw ? fdate(bw.start) + ' \u2013 ' + fdate(bw.end) : fdate(sp.start) + ' \u2013 ' + fdate(sp.end);
          if (!crId) {
            p.cr.push(blankCr(p, id, { title: 'Change ' + sp.name + ' dates', kind: 'Corrective action', affects: ['Schedule'], cost: 0, days: 0, why: reason, desc: sp.name + ' is fixed at ' + was + ' by the baseline. This request moves its dates to: (enter the new dates).' }));
          }
          const cr = p.cr.find((x) => x.id === id);
          if (!cr) return;
          sp.dateCrId = id;
          cr.log.push({ on: new Date().toISOString().slice(0, 10), text: sp.name + ' dates unlocked for change (baselined ' + was + ')' + (reason && crId ? ': ' + reason : '') });
        });
        return id;
      },
      // unfinished top-level items (with everything below them) move to another sprint or the Backlog
      moveOpen(from, to) {
        const S0 = sRef.current;
        const a0 = containerById(S0, from);
        const run = (p) => {
          const a = containerById(p, from);
          const b = containerById(p, to);
          if (!a || !b || a === b) return;
          openRoots(p, a).forEach((t) => moveSubtree(p, t.id, b, false));
        };
        if (to !== 'backlog' && guardHours(run, { cause: a0 ? openRoots(S0, a0).map((t) => t.id) : [] })) return;
        if (a0) moveNote(previewMove(S0, openRoots(S0, a0).map((t) => t.id), to), to);
        update(run);
      },
    };
  }, [update]);
}
