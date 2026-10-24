import { useMemo, useRef } from 'react';
import { useStore } from './StoreContext';
import { useUI } from '../components/UI';
import { alignSprintDates } from '../lib/calc';
import { containerById, findTask, firstOpenStatus, isDoneStatus, makeTask, uid } from '../lib/tasks';
import { fdate } from '../lib/dates';
import { clampDates, datePatchViolations, gapWindow, insertAt, inWin, rollover, sane, sprintCovers, tasksOutside, windowOf } from '../lib/sprintGuard';

const plural = (n, a, b) => (n === 1 ? a : b);
const span = (c) => (c.start ? fdate(c.start) : '…') + ' – ' + (c.end ? fdate(c.end) : '…');

// Moves work items to another container. In the Backlog they lose status and dates; in a sprint they get a status
// and their dates are pulled inside that sprint. Returns how many items had dates changed.
function relocate(p, ids, toId) {
  const to = containerById(p, toId);
  if (!to) return 0;
  const w = windowOf(to);
  let changed = 0;
  ids.forEach((id) => {
    const f = findTask(p, id);
    if (!f || f.c === to) return;
    f.c.tasks.splice(f.i, 1);
    if (to.id === 'backlog') {
      f.t.status = '';
      f.t.start = '';
      f.t.due = '';
    } else {
      if (!f.t.status) f.t.status = firstOpenStatus(p);
      const o = rollover(f.t, w);
      if (Object.keys(o).length) {
        Object.assign(f.t, o);
        changed++;
      }
    }
    to.tasks.push(f.t);
  });
  return changed;
}

// Dry run of relocate, for the message shown afterwards
function previewMove(S, ids, toId) {
  const to = containerById(S, toId);
  const w = to && to.id !== 'backlog' ? windowOf(to) : null;
  return ids.filter((id) => {
    const f = findTask(S, id);
    return f && f.c !== to && w && Object.keys(rollover(f.t, w)).length;
  }).length;
}

function addSprintFor(p, lo, hi) {
  const win = gapWindow(p, lo, hi, p.meta.sprintWeeks || 2);
  const sp = { id: uid(), name: 'Sprint ' + (p.sprints.length + 1), status: 'Not started', start: win.start, end: win.end, tasks: [] };
  p.sprints.splice(insertAt(p, win.start), 0, sp);
  return sp;
}

// All task / sprint mutations in one place. Every function edits the current project.
// Work items can never be dated outside their sprint: edits that would do so are held back and the user is
// offered the ways out (move the date inside, use or create another sprint, extend the sprint, or send to the Backlog).
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

    // applies a start / due patch to the listed items, each pulled inside its own sprint
    const applyClamped = (p, ids, patch) =>
      ids.forEach((id) => {
        const f = findTask(p, id);
        if (!f) return;
        const w = windowOf(f.c);
        const base = { ...f.t, ...patch };
        Object.assign(f.t, patch, w ? clampDates(w, base) : {});
      });

    // Returns true when the edit was held back (the user is now choosing what to do)
    function guardDates(ids, patch) {
      const dates = ['start', 'due'].map((k) => patch[k]).filter(Boolean);
      if (dates.some((d) => !sane(d))) return true; // half-typed date: ignore until it is complete
      const viol = datePatchViolations(sRef.current, ids, patch);
      if (!viol.length) {
        clear();
        return false;
      }
      const sprints = Array.from(new Set(viol.map((x) => x.sprint.id))).map((id) => viol[viol.findIndex((x) => x.sprint.id === id)].sprint);
      const one = sprints.length === 1 ? sprints[0] : null;
      const vids = viol.map((x) => x.id);
      const sorted = dates.slice().sort();
      const lo = sorted[0], hi = sorted[sorted.length - 1];
      const label = viol.length === 1 ? '“' + viol[0].task.name + '”' : viol.length + ' work items';
      const dtxt = dates.length === 1 ? fdate(dates[0]) : fdate(lo) + ' – ' + fdate(hi);
      const where = one ? one.name + ' runs ' + span(one) : 'their sprints do not cover that date';
      const actions = [];

      actions.push({
        label: viol.length === 1 && one ? 'Use ' + fdate(clampDates(windowOf(one), { ...viol[0].task, ...patch })[patch.start ? 'start' : 'due'] || windowOf(one).lo) : 'Move dates inside the sprint',
        primary: true,
        onClick: () => update((p) => applyClamped(p, ids, patch)),
      });
      if (one) {
        const cover = sRef.current.sprints.find((s) => s.id !== one.id && dates.every((d) => sprintCovers(s, d)));
        if (cover) {
          actions.push({
            label: 'Move to ' + cover.name,
            onClick: () =>
              update((p) => {
                relocate(p, vids, cover.id);
                applyClamped(p, ids, patch);
              }),
          });
        } else {
          const win = gapWindow(sRef.current, lo, hi, sRef.current.meta.sprintWeeks || 2);
          actions.push({
            label: 'New sprint ' + fdate(win.start) + ' – ' + fdate(win.end),
            onClick: () =>
              update((p) => {
                const sp = addSprintFor(p, lo, hi);
                relocate(p, vids, sp.id);
                applyClamped(p, ids, patch);
              }),
          });
        }
        actions.push({
          label: 'Extend ' + one.name,
          onClick: () =>
            update((p) => {
              const c = containerById(p, one.id);
              if (c) {
                if (!c.start || lo < c.start) c.start = lo;
                if (!c.end || hi > c.end) c.end = hi;
              }
              applyClamped(p, ids, patch);
            }),
        });
      }
      actions.push({
        label: 'Move to Backlog',
        onClick: () =>
          update((p) => {
            relocate(p, vids, 'backlog');
            applyClamped(p, ids.filter((id) => !vids.includes(id)), patch);
          }),
      });
      withDecision({ text: label + ' cannot be dated ' + dtxt + ' because ' + where + '. Dates must stay inside the sprint. What would you like to do?', actions });
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
          label: 'Move their dates inside',
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
        const win = gapWindow({ ...S0, sprints: S0.sprints.map((s) => (s.id === cid ? { ...s, start: next.start, end: next.end } : s)) }, dates[0], dates[dates.length - 1], S0.meta.sprintWeeks || 2);
        actions.push({
          label: 'New sprint ' + fdate(win.start) + ' – ' + fdate(win.end),
          onClick: () =>
            update((p) => {
              setSprint(p);
              const sp = addSprintFor(p, dates[0], dates[dates.length - 1]);
              relocate(p, ids, sp.id);
            }),
        });
      }
      actions.push({
        label: 'Move ' + ids.length + ' to Backlog',
        onClick: () =>
          update((p) => {
            setSprint(p);
            relocate(p, ids, 'backlog');
          }),
      });
      withDecision({
        text: ids.length + ' work ' + plural(ids.length, 'item is', 'items are') + ' dated outside ' + c.name + ' (' + span({ start: next.start, end: next.end }) + '). Dates must stay inside the sprint. What would you like to do with ' + plural(ids.length, 'it', 'them') + '? Choosing nothing keeps the old sprint dates.',
        actions,
      });
      return true;
    }

    const moveNote = (n, toId) => {
      const to = containerById(sRef.current, toId);
      if (n > 0 && to && to.id !== 'backlog') say({ id: 'moved', tone: 'info', ttl: 8000, text: n + ' ' + plural(n, 'date was', 'dates were') + ' moved inside ' + to.name + ' (' + span(to) + ') so the work item stays within the sprint.' });
    };

    return {
      add(cid, fields = {}) {
        const id = fields.id || uid();
        update((p) => {
          const c = containerById(p, cid);
          if (c) c.tasks.push(makeTask(p, { ...fields, id, ...(cid === 'backlog' ? { status: '' } : {}) }));
        });
        return id;
      },
      patch(id, patch) {
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
      // change several work items in one update (one render, one save)
      patchMany(ids, patch) {
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
      moveMany(ids, cid) {
        moveNote(previewMove(sRef.current, ids, cid), cid);
        update((p) => void relocate(p, ids, cid));
      },
      removeMany(ids) {
        update((p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f) f.c.tasks.splice(f.i, 1);
          });
        });
      },
      // copies are placed right after their originals with new codes
      duplicateMany(ids) {
        update((p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (!f) return;
            const n = p.counter || 1;
            p.counter = n + 1;
            const copy = structuredClone(f.t);
            copy.id = uid();
            copy.code = 'T-' + n;
            copy.name = f.t.name + ' (copy)';
            copy.subtasks = (copy.subtasks || []).map((s) => ({ ...s, id: uid() }));
            f.c.tasks.splice(f.i + 1, 0, copy);
          });
        });
      },
      remove(id) {
        update((p) => {
          const f = findTask(p, id);
          if (f) f.c.tasks.splice(f.i, 1);
        });
      },
      move(id, cid) {
        moveNote(previewMove(sRef.current, [id], cid), cid);
        update((p) => void relocate(p, [id], cid));
      },
      addSub(id, name) {
        update((p) => {
          const f = findTask(p, id);
          if (f) f.t.subtasks.push({ id: uid(), name, done: false, person: '' });
        });
      },
      patchSub(id, sid, patch) {
        update((p) => {
          const f = findTask(p, id);
          const s = f && f.t.subtasks.find((x) => x.id === sid);
          if (s) Object.assign(s, patch);
        });
      },
      removeSub(id, sid) {
        update((p) => {
          const f = findTask(p, id);
          if (f) f.t.subtasks = f.t.subtasks.filter((x) => x.id !== sid);
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
      // unfinished work moves on to another sprint (or the Backlog); finished work stays
      moveOpen(from, to) {
        const S0 = sRef.current;
        const a = containerById(S0, from);
        if (a) moveNote(previewMove(S0, a.tasks.filter((t) => !(isDoneStatus(S0, t.status) && t.status)).map((t) => t.id), to), to);
        update((p) => {
          const src = containerById(p, from);
          if (!src || !containerById(p, to) || src === containerById(p, to)) return;
          const ids = src.tasks.filter((t) => !(isDoneStatus(p, t.status) && t.status)).map((t) => t.id);
          relocate(p, ids, to);
        });
      },
    };
  }, [update]);
}
