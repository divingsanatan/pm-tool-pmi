import { useMemo, useRef } from 'react';
import { useStore } from './StoreContext';
import { useUI } from '../components/UI';
import { checkAdd, depLocked, hasBaseline } from '../lib/deps';
import { blankCr } from '../lib/change';
import { findTask, uid } from '../lib/tasks';
import { today } from '../lib/dates';

// Add, change and remove dependencies. The dependency lives on the work item that waits (the successor).
// The RAID entry is created and kept up to date by syncDependencies(), which runs after every edit.
// After the baseline, adding a dependency, or changing / removing one that is part of the baseline, goes through a change request.
const CR_FIELDS = ['type', 'lag', 'lagCal', 'nature'];

// the change request to file the change under: an open one the user picked, or a new one raised now
function crFor(p, choice, text) {
  let cr = choice.cr ? (p.cr || []).find((c) => c.id === choice.cr) : null;
  if (!cr) {
    cr = blankCr(p, uid(), { title: choice.title, affects: ['Schedule'], cost: choice.cost, days: choice.days, desc: text });
    p.cr = (p.cr || []).concat(cr);
  }
  (cr.log = cr.log || []).push({ on: today(), text: text });
  return cr;
}

export function useDeps() {
  const { update, S } = useStore();
  const ui = useUI();
  const sRef = useRef(S);
  sRef.current = S;
  const uRef = useRef(ui);
  uRef.current = ui;
  return useMemo(() => {
    const say = (o) => uRef.current && uRef.current.toast && uRef.current.toast(o);
    const nameOf = (id) => { const f = findTask(sRef.current, id); return f ? f.t.code + ' ' + f.t.name : 'a work item'; };
    const gate = (o) => uRef.current.gateCr(o);
    return {
      // spec: { pred, ext, type, lag, lagCal, nature, due }. Returns false when it is not allowed; done() runs once the dependency exists.
      add(succId, spec, done) {
        const pred = spec.pred || '';
        const err = checkAdd(sRef.current, succId, pred, spec.ext);
        if (err) {
          say({ id: 'dep', tone: 'bad', text: err, ttl: 8000 });
          return false;
        }
        const make = (choice) => {
          update((p) => {
            const f = findTask(p, succId);
            if (!f) return;
            const d = { id: uid(), pred, type: spec.type || 'FS', lag: Math.round(Number(spec.lag) || 0), lagCal: spec.lagCal === 'cal' ? 'cal' : 'work', nature: spec.nature || 'mandatory' };
            if (!pred) { d.ext = String(spec.ext).trim(); if (spec.due) d.due = spec.due; }
            if (choice) d.crId = crFor(p, choice, 'Dependency added: ' + (pred ? nameOf(succId) + ' waits on ' + nameOf(pred) : nameOf(succId) + ' waits on ' + String(spec.ext).trim())).id;
            f.t.deps = (f.t.deps || []).concat(d);
          });
          say({ id: 'dep', tone: 'info', text: 'Dependency added and logged in the RAID log as a Dependency.' + (choice ? ' It is listed on its change request.' : ''), ttl: 5000 });
          done && done();
        };
        if (hasBaseline(sRef.current)) {
          gate({ body: 'This project has a baseline. A new dependency changes the approved schedule logic, so it must be added through a change request. Pick an open request, or raise a new one (you can complete it in Change control).', confirm: 'Add dependency', title: 'Dependency: ' + nameOf(succId), onPick: make });
        } else make(null);
        return true;
      },
      patch(succId, depId, patch) {
        const f = findTask(sRef.current, succId);
        const d = f && (f.t.deps || []).find((x) => x.id === depId);
        const real = d && CR_FIELDS.some((k) => k in patch && String(patch[k]) !== String(d[k] ?? (k === 'lagCal' ? 'work' : '')));
        const apply = (choice) => update((p) => {
          const g = findTask(p, succId);
          const x = g && (g.t.deps || []).find((y) => y.id === depId);
          if (!x) return;
          Object.assign(x, patch);
          if (choice) x.crId = crFor(p, choice, 'Dependency changed: ' + nameOf(succId) + (x.pred ? ' and ' + nameOf(x.pred) : '')).id;
        });
        if (d && real && depLocked(sRef.current, d)) {
          gate({ body: 'This dependency is part of the approved baseline. Changing its relationship, lag or nature changes the schedule logic, so it needs a change request.', confirm: 'Change dependency', title: 'Dependency change: ' + nameOf(succId), onPick: apply });
        } else apply(null);
      },
      remove(succId, depId) {
        const f = findTask(sRef.current, succId);
        const d = f && (f.t.deps || []).find((x) => x.id === depId);
        const run = (choice) => {
          update((p) => {
            const g = findTask(p, succId);
            if (!g) return;
            if (choice) {
              const cr = crFor(p, choice, 'Dependency removed: ' + nameOf(succId) + (d && d.pred ? ' no longer waits on ' + nameOf(d.pred) : ''));
              if (!(cr.tasks || (cr.tasks = [])).includes(succId)) cr.tasks.push(succId);
              const r = (p.raid || []).find((x) => x.depId === depId);
              if (r && r.key && !(cr.raid || (cr.raid = [])).includes(r.key)) cr.raid.push(r.key);
            }
            g.t.deps = (g.t.deps || []).filter((x) => x.id !== depId);
          });
          say({ id: 'dep', tone: 'info', text: 'Dependency removed. Its RAID entry was closed and kept for the record.', ttl: 6000 });
        };
        if (d && depLocked(sRef.current, d)) {
          gate({ body: 'This dependency is part of the approved baseline. Removing it changes the schedule logic, so it needs a change request.', confirm: 'Remove dependency', title: 'Remove dependency: ' + nameOf(succId), onPick: run });
        } else run(null);
      },
    };
  }, [update]);
}
