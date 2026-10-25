import { useMemo, useRef } from 'react';
import { useStore } from './StoreContext';
import { useUI } from '../components/UI';
import { alignSprintDates } from '../lib/calc';
import { childTypeFor, containerById, findTask, firstOpenStatus, isDoneStatus, makeTask, uid } from '../lib/tasks';
import { leafTasks, subtreeIds } from '../lib/hier';
import { cleanEffort } from '../lib/format';
import { fdate } from '../lib/dates';
import { clampDates, datePatchViolations, gapWindow, inWin, rollover, sane, sprintCovers, tasksOutside, windowOf } from '../lib/sprintGuard';

const plural = (n, a, b) => (n === 1 ? a : b);
const span = (c) => (c.start ? fdate(c.start) : '…') + ' – ' + (c.end ? fdate(c.end) : '…');

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
        onClick: () => update((p) => applyClamped(p, allIds, patch)),
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

    // A sprint's dates are changing: say what happens to the work items that would end up outside them
    function guardSprint(cid, patch) {
      const S0 = sRef.current;
      const c = containerById(S0, cid);
      if (!c || cid === 'backlog') return false;
      const next = { start: 'start' in patch ? patch.start || '' : c.start || '', end: 'end' in patch ? patch.end || '' : c.end || '' };
      if ((next.start && !sane(next.start)) || (next.end && !sane(next.end))) return true;
      if (next.start && next.end && next.start > next.end) {
        say({ id: 'guard', tone: 'bad', text: 'A sprint cannot end before it starts.', ttl: 6000 });
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
        update((p) => {
          const c = containerById(p, cid);
          if (c) c.tasks.push(makeTask(p, { ...fields, id, ...(cid === 'backlog' ? { status: '' } : {}) }));
        });
        return id;
      },
      // a new work item under another one (its type steps down the ladder: epic > feature > story > task > subtask)
      addChild(parentId, fields = {}) {
        fields = safe(fields);
        const id = fields.id || uid();
        update((p) => {
          const f = findTask(p, parentId);
          if (!f) return;
          const type = fields.type || childTypeFor(p, f.t.type);
          f.c.tasks.push(makeTask(p, { ...fields, type, id, parent: parentId, ...(f.c.id === 'backlog' ? { status: '' } : {}) }));
        });
        return id;
      },
      // a new work item right after another one, at the same level
      addSibling(afterId, fields = {}) {
        fields = safe(fields);
        const id = fields.id || uid();
        update((p) => {
          const f = findTask(p, afterId);
          if (!f) return;
          const t = makeTask(p, { name: 'New task', ...fields, type: fields.type || f.t.type, id, parent: f.t.parent || '', ...(f.c.id === 'backlog' ? { status: '' } : {}) });
          f.c.tasks.splice(f.i + 1, 0, t);
        });
        return id;
      },
      patch(id, patch) {
        patch = safe(patch);
        if (('start' in patch || 'due' in patch) && guardDates([id], patch)) return;
        update((p) => {
          const f = findTask(p, id);
          if (f) Object.assign(f.t, patch);
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
        update((p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f) Object.assign(f.t, patch);
          });
        });
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
        moveNote(previewMove(sRef.current, ids, cid), cid);
        update((p) => {
          const to = containerById(p, cid);
          if (!to) return;
          const groups = new Map();
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f && f.c !== to) groups.set(f.c, (groups.get(f.c) || []).concat(id));
          });
          groups.forEach((list, c) => topIds(c, list).forEach((id) => moveSubtree(p, id, to, true)));
        });
      },
      move(id, cid) {
        moveNote(previewMove(sRef.current, [id], cid), cid);
        update((p) => {
          const to = containerById(p, cid);
          if (to) moveSubtree(p, id, to, false);
        });
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
        update((p) => {
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
        });
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
        if (('start' in patch || 'end' in patch) && guardSprint(cid, patch)) return;
        update((p) => {
          const c = containerById(p, cid);
          if (c) Object.assign(c, patch);
        });
      },
      // unfinished top-level items (with everything below them) move to another sprint or the Backlog
      moveOpen(from, to) {
        const S0 = sRef.current;
        const a0 = containerById(S0, from);
        if (a0) moveNote(previewMove(S0, openRoots(S0, a0).map((t) => t.id), to), to);
        update((p) => {
          const a = containerById(p, from);
          const b = containerById(p, to);
          if (!a || !b || a === b) return;
          openRoots(p, a).forEach((t) => moveSubtree(p, t.id, b, false));
        });
      },
    };
  }, [update]);
}
