import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { uid } from '../lib/tasks';
import { today } from '../lib/dates';
import { nz } from '../lib/format';
import { blankCr, currentBaseline, missing, snapshot } from '../lib/change';

const note = (c, text) => c.log.push({ on: today(), text });

// Change-request and baseline actions for the current project
export function useChange() {
  const { update } = useStore();
  return useMemo(
    () => ({
      // The first baseline is taken from the plan as it stands; every later one comes from an approved change request
      setInitialBaseline(text) {
        update((p) => {
          if (p.baselines.length) return;
          p.baselines.push({ id: uid(), version: 'v1.0', kind: 'Initial', date: today(), crId: '', crCode: '', note: (text || '').trim() || 'Original approved plan', ...snapshot(p) });
        });
      },
      add(fields = {}) {
        const id = uid();
        update((p) => void p.cr.push(blankCr(p, id, fields)));
        return id;
      },
      patch(id, patch) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (c) Object.assign(c, patch);
        });
      },
      remove(id) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (c && c.status === 'Draft') p.cr = p.cr.filter((x) => x.id !== id); // once submitted, a request stays on record
        });
      },
      // Moves a request to another status, but only if its required items are complete
      setStatus(id, to) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || missing(c, to, p).length) return;
          const from = c.status;
          if (to === 'Submitted') c.submittedOn = today();
          if (to === 'Under review') {
            if (c.apCost == null) c.apCost = nz(c.cost);
            if (c.apDays == null) c.apDays = nz(c.days);
          }
          if (to === 'Approved' || to === 'Rejected' || to === 'Deferred') {
            if (!c.decidedOn) c.decidedOn = today();
          }
          if (to === 'Under review' && from === 'Deferred') {
            c.decidedOn = '';
          }
          if (to === 'Closed') c.closedOn = today();
          c.status = to;
          note(c, from + ' → ' + to);
        });
      },
      // Records the new baseline for an approved request and marks it implemented
      implement(id) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || c.status !== 'Approved' || missing(c, 'Implemented', p).length || !currentBaseline(p)) return;
          const version = 'v1.' + p.baselines.length;
          const bid = uid();
          p.baselines.push({
            id: bid, version, kind: 'Change', date: today(), crId: c.id, crCode: c.code,
            note: c.title, approvedCost: nz(c.apCost), approvedDays: nz(c.apDays), ...snapshot(p),
          });
          c.baselineId = bid;
          c.implementedOn = today();
          c.status = 'Implemented';
          note(c, 'Approved → Implemented · baseline ' + version + ' created');
        });
      },
    }),
    [update]
  );
}
