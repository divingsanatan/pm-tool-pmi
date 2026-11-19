import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { canSeeBudget } from '../lib/access';
import { today } from '../lib/dates';

const WORD = { tasks: 'work item', raid: 'RAID item' };
const note = (c, text) => { if (!Array.isArray(c.log)) c.log = []; c.log.push({ on: today(), text }); };

/* Link or unlink work items (kind 'tasks') or RAID items (kind 'raid') on change requests, in any status.
     set(kind, ids, crId, on)   adds (on) or removes the items on one request; every change is written to the request's history
     clear(kind, ids)           takes the items off every request
   Only an Admin or a Project Manager may link (the Change control tab is theirs). */
export function useCrLinks() {
  const { update, role } = useStore();
  const ok = canSeeBudget(role);
  return useMemo(
    () => ({
      set(kind, ids, crId, on) {
        if (!ok) return;
        const want = Array.isArray(ids) ? ids : [ids];
        update((p) => {
          const c = (p.cr || []).find((x) => x.id === crId);
          if (!c) return;
          const cur = Array.isArray(c[kind]) ? c[kind] : [];
          const next = on ? cur.concat(want.filter((x) => !cur.includes(x))) : cur.filter((x) => !want.includes(x));
          const n = Math.abs(next.length - cur.length);
          if (!n) return;
          c[kind] = next;
          note(c, (on ? 'Linked ' : 'Unlinked ') + n + ' ' + WORD[kind] + (n === 1 ? '' : 's'));
        });
      },
      clear(kind, ids) {
        if (!ok) return;
        const gone = new Set(ids);
        update((p) => {
          (p.cr || []).forEach((c) => {
            const cur = Array.isArray(c[kind]) ? c[kind] : [];
            const next = cur.filter((x) => !gone.has(x));
            if (next.length === cur.length) return;
            note(c, 'Unlinked ' + (cur.length - next.length) + ' ' + WORD[kind] + (cur.length - next.length === 1 ? '' : 's'));
            c[kind] = next;
          });
        });
      },
    }),
    [update, ok]
  );
}
