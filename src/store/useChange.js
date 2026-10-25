import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { uid } from '../lib/tasks';
import { DAY, addDays, pd, today } from '../lib/dates';
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
      // Baselines can be corrected or removed. Removing one unlinks it from the change request that created it.
      patchBaseline(id, patch) {
        update((p) => {
          const b = p.baselines.find((x) => x.id === id);
          if (b) Object.assign(b, patch);
        });
      },
      recaptureBaseline(id) {
        update((p) => {
          const b = p.baselines.find((x) => x.id === id);
          if (b) Object.assign(b, snapshot(p), { date: today() });
        });
      },
      removeBaseline(id) {
        update((p) => {
          const b = p.baselines.find((x) => x.id === id);
          if (!b) return;
          p.baselines = p.baselines.filter((x) => x.id !== id);
          p.cr.forEach((c) => {
            if (c.baselineId === id) {
              c.baselineId = '';
              note(c, 'Baseline ' + b.version + ' was deleted');
            }
          });
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
      // addBudgetLine: true adds the approved cost to the Budget tab as one line named after the request (the user chose this in the dialog)
      implement(id, addBudgetLine) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || c.status !== 'Approved' || missing(c, 'Implemented', p).length || !currentBaseline(p)) return;
          const prev = currentBaseline(p);
          const apCost = nz(c.apCost), apDays = nz(c.apDays);
          // The approved cost and schedule change are added to the previous baseline. (Before, the new baseline was only a copy of the
          // live plan, so a cost or schedule change that was approved but not typed in elsewhere never reached it.)
          const bac = Math.round((prev.bac + apCost) * 100) / 100;
          const end = addDays(prev.end, apDays);
          // the approved cost goes into the plan's budget only when the user asked for it
          if (apCost && addBudgetLine === true)
            p.lines.push({ id: uid(), name: c.code + ' ' + (c.title || 'Change request'), amount: apCost, per: 'project' });
          const version = 'v1.' + p.baselines.length;
          const bid = uid();
          p.baselines.push({
            id: bid, version, kind: 'Change', date: today(), crId: c.id, crCode: c.code,
            note: c.title, approvedCost: apCost, approvedDays: apDays, ...snapshot(p),
            bac, end, weeks: Math.max(1, Math.ceil(((pd(end) - pd(prev.start || p.meta.start)) / DAY + 1) / 7)),
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
