import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { uid } from '../lib/tasks';
import { DAY, addDays, pd, today } from '../lib/dates';
import { nz } from '../lib/format';
import { promoteFor } from '../lib/drafts';
import { baselinesOf, blankCr, crBlockers, currentBaseline, implementPlan, inNextBaseline, isNewestBaseline, missing, reserveAfter, snapshot } from '../lib/change';
import { allContainers } from '../lib/tasks';

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
      // Baselines can be corrected or removed.
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
      // Only the newest baseline can be deleted (every later one is built on the one before it). The request that created it goes back
      // to Approved, so its approved cost and days can be corrected and it can be implemented again; the previous version becomes current.
      removeBaseline(id) {
        update((p) => {
          const b = p.baselines.find((x) => x.id === id);
          if (!b || !isNewestBaseline(p, id)) return;
          p.baselines = p.baselines.filter((x) => x.id !== id);
          p.cr.forEach((c) => {
            if (c.baselineId !== id && !(b.crId && c.id === b.crId)) return;
            c.baselineId = '';
            if (['Implemented', 'Closed'].includes(c.status)) {
              c.status = 'Approved';
              c.implementedOn = '';
              c.closedOn = '';
              note(c, 'Baseline ' + b.version + ' was deleted: back to Approved');
            } else note(c, 'Baseline ' + b.version + ' was deleted');
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
      // Deletes a request in any status, unless another request sits on top of it (a later one already Approved, Implemented or Closed).
      // Its baseline goes with it (the previous version becomes current). Sprints, the budget line and the labour claims it created stay in the plan
      // but lose the link, so the Dashboard flags them as outside the baseline until they are removed or covered by another request.
      remove(id) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || crBlockers(p, c).length) return;
          const mine = baselinesOf(p, c);
          p.baselines = p.baselines.filter((b) => !mine.some((m) => m.id === b.id));
          p.drafts = (p.drafts || []).filter((d) => d.crId !== id);
          p.sprints.forEach((sp) => {
            if (sp.crId === id) delete sp.crId;
            if (sp.dateCrId === id) sp.dateCrId = '';
            if (sp.hoursCrId === id) sp.hoursCrId = '';
          });
          (p.lines || []).forEach((l) => { if (l.crId === id) l.crId = ''; });
          (p.team || []).forEach((t) => { if (t.crId === id) { t.crId = ''; t.crClaim = 0; } });
          allContainers(p).forEach((ct) => ct.tasks.forEach((t) => (t.deps || []).forEach((d) => { if (d.crId === id) d.crId = ''; })));
          p.cr = p.cr.filter((x) => x.id !== id);
        });
      },
      // While a request is Approved (not yet implemented) its approved cost and days can still be corrected; every change is written to its history
      editApproved(id, patch) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || c.status !== 'Approved') return;
          Object.keys(patch).forEach((k) => {
            const was = c[k], to = patch[k];
            if (was === to || (was == null && to == null)) return;
            note(c, (k === 'apCost' ? 'Approved cost' : 'Approved schedule (days)') + ' changed ' + (was == null ? 'blank' : was) + ' → ' + (to == null ? 'blank' : to) + ' (before implementation)');
          });
          Object.assign(c, patch);
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
          if (to === 'Rejected') {
            // a rejected request can never be reopened, so its draft sprints have no purpose left: they are discarded (the request keeps the record)
            const gone = (p.drafts || []).filter((d) => d.crId === c.id);
            if (gone.length) { p.drafts = p.drafts.filter((d) => d.crId !== c.id); note(c, 'Draft sprint(s) discarded: ' + gone.map((d) => d.name).join(', ')); }
          }
          if (to === 'Approved') {
            const stuck = promoteFor(p, c.id); // the request's draft sprints become regular sprints
            if (stuck.length) note(c, 'Draft sprint(s) not activated because their dates overlap another sprint: ' + stuck.join(', '));
          }
        });
      },
      // Records the new baseline for an approved request and marks it implemented
      // addBudgetLine: true adds the approved cost to the Budget tab as one line named after the request (the user chose this in the dialog)
      implement(id, addBudgetLine) {
        update((p) => {
          const c = p.cr.find((x) => x.id === id);
          if (!c || c.status !== 'Approved' || missing(c, 'Implemented', p).length || !currentBaseline(p)) return;
          const prev = currentBaseline(p);
          const pl = implementPlan(c, p);
          if (!pl || !pl.fits) return; // the sprint dates must end on the approved finish first
          const apCost = nz(c.apCost), apDays = nz(c.apDays);
          // The approved cost and schedule change are added to the previous baseline:
          // BAC of the new baseline = (previous work budget + approved cost) + contingency; the management reserve stays outside it.
          // Its finish is the previous finish + the approved days (the sprint dates have been checked to end there).
          const res = reserveAfter(c, p, 'ap');
          const bac = res.bac;
          const snap = snapshot(p, (sp) => inNextBaseline(p, sp, c.id));
          const end = pl.end;
          // the approved cost goes into the plan's budget only when the user asked for it
          if (apCost && addBudgetLine === true && !p.lines.some((l) => l.crId === c.id))
            p.lines.push({ id: uid(), name: c.code + ' ' + (c.title || 'Change request'), amount: apCost, per: 'project' });
          const version = 'v1.' + p.baselines.length;
          const bid = uid();
          p.baselines.push({
            id: bid, version, kind: 'Change', date: today(), crId: c.id, crCode: c.code,
            note: c.title, approvedCost: apCost, approvedDays: apDays, ...snap,
            bac, end, weeks: Math.max(1, Math.ceil(((pd(end) - pd(prev.start || p.meta.start)) / DAY + 1) / 7)),
            // reserves: carried over unchanged, except the percentages this request set
            reserve: { contPct: res.contPct, mgmtPct: res.mgmtPct, contingency: res.contingency, management: res.management },
            work: res.work,
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
