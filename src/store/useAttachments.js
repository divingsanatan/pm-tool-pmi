import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { canEdit } from '../lib/access';
import { findTask, uid } from '../lib/tasks';
import { today } from '../lib/dates';
import { checkFile, dropFile, mimeOf, putFile } from '../lib/attachments';
import { supabase } from '../lib/supabase';

/* Attach files to a work item.
     add(taskId, files)     saves each file, then lists it on the work item. Returns { added, errors } (errors are plain sentences).
     remove(taskId, attId)  takes it off the work item; the file itself is deleted unless another work item (a copy) still uses it.
     can                    Admin, Project Manager and Team member may add and remove; Viewers only look. */
export function useAttachments() {
  const { S, update, role, cloud } = useStore();
  const can = canEdit(role);
  return useMemo(
    () => ({
      can,
      async add(taskId, files) {
        const added = [], errors = [];
        if (!can) return { added, errors: ['You can look at attachments but not add them.'] };
        for (const f of files) {
          const bad = checkFile(f);
          if (bad) { errors.push(bad); continue; }
          const id = uid();
          try {
            const { path, store } = await putFile(f, { online: !!cloud && !!supabase, projectId: S.id, taskId, id });
            const att = { id, name: f.name, type: mimeOf(f), size: f.size, path, store, by: (cloud && cloud.email) || '', on: today() };
            update((p) => {
              const g = findTask(p, taskId);
              if (!g) return;
              if (!Array.isArray(g.t.attachments)) g.t.attachments = [];
              g.t.attachments.push(att);
            });
            added.push(att);
          } catch (e) {
            errors.push('“' + f.name + '”: ' + e.message);
          }
        }
        return { added, errors };
      },
      remove(taskId, attId) {
        if (!can) return;
        const g = findTask(S, taskId);
        const att = g && (g.t.attachments || []).find((a) => a.id === attId);
        if (!att) return;
        update((p) => {
          const h = findTask(p, taskId);
          if (h) h.t.attachments = (h.t.attachments || []).filter((a) => a.id !== attId);
        });
        const shared = [...S.sprints, S.backlog].some((c) => c.tasks.some((t) => t.id !== taskId && (t.attachments || []).some((a) => a.path === att.path)));
        if (!shared) dropFile(att).catch(() => {});
      },
    }),
    [S, update, can, cloud]
  );
}
