import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { uid } from '../lib/tasks';
import { today } from '../lib/dates';

const blank = () => ({ date: today(), element: '', desc: '', amount: null });

// Actual-cost ledger actions for the current project
export function useCosts() {
  const { update } = useStore();
  return useMemo(
    () => ({
      add(fields = {}) {
        const id = fields.id || uid();
        update((p) => void p.ledger.push({ ...blank(), ...fields, id }));
        return id;
      },
      addMany(list) {
        update((p) => list.forEach((f) => p.ledger.push({ ...blank(), ...f, id: uid() })));
      },
      patch(id, patch) {
        update((p) => {
          const e = p.ledger.find((x) => x.id === id);
          if (e) Object.assign(e, patch);
        });
      },
      remove(id) {
        update((p) => {
          p.ledger = p.ledger.filter((x) => x.id !== id);
        });
      },
      sortByDate() {
        update((p) => p.ledger.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')));
      },
    }),
    [update]
  );
}
