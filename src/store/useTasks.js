import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { alignSprintDates } from '../lib/calc';
import { containerById, findTask, firstOpenStatus, isDoneStatus, makeTask, uid } from '../lib/tasks';

// All task / sprint mutations in one place. Every function edits the current project.
export function useTasks() {
  const { update } = useStore();
  return useMemo(
    () => ({
      add(cid, fields = {}) {
        const id = fields.id || uid();
        update((p) => {
          const c = containerById(p, cid);
          if (c) c.tasks.push(makeTask(p, { ...fields, id, ...(cid === 'backlog' ? { status: '' } : {}) }));
        });
        return id;
      },
      patch(id, patch) {
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
        update((p) => {
          ids.forEach((id) => {
            const f = findTask(p, id);
            if (f) Object.assign(f.t, patch);
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
        update((p) => {
          const f = findTask(p, id);
          const to = containerById(p, cid);
          if (!f || !to || f.c === to) return;
          f.c.tasks.splice(f.i, 1);
          // the Backlog has no statuses: items lose theirs there and start at the first open status in a sprint
          if (to.id === 'backlog') f.t.status = '';
          else if (!f.t.status) f.t.status = firstOpenStatus(p);
          to.tasks.push(f.t);
        });
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
        update((p) => {
          const c = containerById(p, cid);
          if (c) Object.assign(c, patch);
        });
      },
      moveOpen(from, to) {
        update((p) => {
          const a = containerById(p, from);
          const b = containerById(p, to);
          if (!a || !b || a === b) return;
          const keep = [];
          a.tasks.forEach((t) => {
            if (isDoneStatus(p, t.status) && t.status) return keep.push(t);
            if (b.id === 'backlog') t.status = '';
            else if (!t.status) t.status = firstOpenStatus(p);
            b.tasks.push(t);
          });
          a.tasks = keep;
        });
      },
    }),
    [update]
  );
}
