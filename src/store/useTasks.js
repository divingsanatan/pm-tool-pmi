import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { alignSprintDates } from '../lib/calc';
import { childTypeFor, containerById, findTask, firstOpenStatus, isDoneStatus, makeTask, uid } from '../lib/tasks';
import { leafTasks, subtreeIds } from '../lib/hier';
import { cleanEffort } from '../lib/format';

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

// take one item and everything below it out of its list and put it in another (it becomes a top-level item there)
function moveSubtree(p, id, to, clearDates) {
  const f = findTask(p, id);
  if (!f || f.c === to) return;
  const set = new Set(subtreeIds(f.c.tasks, id));
  const moving = f.c.tasks.filter((t) => set.has(t.id));
  f.c.tasks = f.c.tasks.filter((t) => !set.has(t.id));
  f.t.parent = '';
  moving.forEach((t) => {
    if (to.id === 'backlog') {
      t.status = '';
      if (clearDates) {
        t.start = '';
        t.due = '';
      }
    } else if (!t.status) t.status = firstOpenStatus(p);
    to.tasks.push(t);
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
export function useTasks() {
  const { update } = useStore();
  return useMemo(
    () => ({
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
        patch = safe(patch);
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
        update((p) => {
          const c = containerById(p, cid);
          if (c) Object.assign(c, patch);
        });
      },
      // unfinished top-level items (with everything below them) move to another sprint or the Backlog
      moveOpen(from, to) {
        update((p) => {
          const a = containerById(p, from);
          const b = containerById(p, to);
          if (!a || !b || a === b) return;
          const leaves = new Set(leafTasks(a.tasks).filter((t) => !(t.status && isDoneStatus(p, t.status))).map((t) => t.id));
          const roots = a.tasks.filter((t) => !t.parent && subtreeIds(a.tasks, t.id).some((x) => leaves.has(x)));
          roots.forEach((t) => moveSubtree(p, t.id, b, false));
        });
      },
    }),
    [update]
  );
}
