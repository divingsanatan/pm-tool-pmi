import { useMemo, useRef } from 'react';
import { useStore } from './StoreContext';
import { useUI } from '../components/UI';
import { checkAdd } from '../lib/deps';
import { findTask, uid } from '../lib/tasks';

// Add, change and remove dependencies. The dependency lives on the work item that waits (the successor).
// The RAID entry is created and kept up to date by syncDependencies(), which runs after every edit.
export function useDeps() {
  const { update, S } = useStore();
  const ui = useUI();
  const sRef = useRef(S);
  sRef.current = S;
  const uRef = useRef(ui);
  uRef.current = ui;
  return useMemo(() => {
    const say = (o) => uRef.current && uRef.current.toast && uRef.current.toast(o);
    return {
      // spec: { pred, ext, type, lag, nature, due }. Returns true when it was added.
      add(succId, spec) {
        const pred = spec.pred || '';
        const err = checkAdd(sRef.current, succId, pred, spec.ext);
        if (err) {
          say({ id: 'dep', tone: 'bad', text: err, ttl: 8000 });
          return false;
        }
        update((p) => {
          const f = findTask(p, succId);
          if (!f) return;
          const d = { id: uid(), pred, type: spec.type || 'FS', lag: Math.round(Number(spec.lag) || 0), nature: spec.nature || 'mandatory' };
          if (!pred) { d.ext = String(spec.ext).trim(); if (spec.due) d.due = spec.due; }
          f.t.deps = (f.t.deps || []).concat(d);
        });
        say({ id: 'dep', tone: 'info', text: 'Dependency added and logged in the RAID log as a Dependency.', ttl: 5000 });
        return true;
      },
      patch(succId, depId, patch) {
        update((p) => {
          const f = findTask(p, succId);
          const d = f && (f.t.deps || []).find((x) => x.id === depId);
          if (d) Object.assign(d, patch);
        });
      },
      remove(succId, depId) {
        update((p) => {
          const f = findTask(p, succId);
          if (f) f.t.deps = (f.t.deps || []).filter((x) => x.id !== depId);
        });
        say({ id: 'dep', tone: 'info', text: 'Dependency removed. Its RAID entry was closed and kept for the record.', ttl: 6000 });
      },
    };
  }, [update]);
}
