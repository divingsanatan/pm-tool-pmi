import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Modal, useUI } from './UI';
import { raciOkFor } from '../lib/calc';
import { findTask } from '../lib/tasks';

export const ROLE_NAMES = { A: 'Accountable', R: 'Responsible', C: 'Consulted', I: 'Informed' };

// Applies { personId: 'A' | 'R' | 'C' | 'I' | '' } to one work item's roles. Only one person can be Accountable:
// making someone A clears the A of whoever had it. An empty role removes the person from the item.
export function applyRoles(roles, changes) {
  const next = { ...(roles || {}) };
  Object.entries(changes).forEach(([pid, role]) => {
    if (role === 'A') Object.keys(next).forEach((k) => next[k] === 'A' && k !== pid && delete next[k]);
    if (role) next[pid] = role;
    else delete next[pid];
  });
  return next;
}

function Dialog({ ids, items, people, onClose }) {
  const { S, update } = useStore();
  const [mode, setMode] = useState('set');
  const [pick, setPick] = useState({}); // personId -> 'A' | 'R' | 'C' | 'I' | '' (clear); missing = no change
  const [from, setFrom] = useState('');
  const tasks = ids.map((id) => (findTask(S, id) || {}).t).filter(Boolean);
  const src = items.find((t) => t.id === from);

  const choose = (pid, role) =>
    setPick((cur) => {
      const n = { ...cur };
      if (n[pid] === role) delete n[pid];
      else {
        if (role === 'A') Object.keys(n).forEach((k) => n[k] === 'A' && delete n[k]); // one A at a time
        n[pid] = role;
      }
      return n;
    });

  const changed = Object.keys(pick).length;
  const after = (t) => (mode === 'copy' ? (src ? { ...src.raci } : t.raci) : applyRoles(t.raci, pick));
  const okAfter = tasks.filter((t) => raciOkFor(after(t))).length;
  const ready = mode === 'set' ? changed > 0 : !!src;

  const apply = () => {
    update((p) => {
      ids.forEach((id) => {
        const f = findTask(p, id);
        if (!f) return;
        if (mode === 'copy') {
          const keep = new Set(p.people.map((x) => x.id));
          f.t.raci = Object.fromEntries(Object.entries(src.raci || {}).filter(([k]) => keep.has(k)));
        } else f.t.raci = applyRoles(f.t.raci, pick);
      });
    });
    onClose();
  };

  return (
    <Modal title={'Set RACI for ' + ids.length + ' work item' + (ids.length > 1 ? 's' : '')} onClose={onClose} wide>
      <div className="seg" role="group" aria-label="How to set RACI" style={{ marginBottom: 12 }}>
        <button aria-pressed={mode === 'set'} onClick={() => setMode('set')}>Set roles</button>
        <button aria-pressed={mode === 'copy'} onClick={() => setMode('copy')}>Copy from a work item</button>
      </div>

      {mode === 'set' ? (
        <>
          <p className="hint">Choose a role for each person you want to change. People left on “No change” keep whatever they have on each work item. Only one person can be Accountable: making someone A replaces the current A on every selected item.</p>
          <div className="rb-list">
            {people.map((p) => (
              <div key={p.id} className="rb-row">
                <div className="rb-who"><b>{p.name}</b>{p.role ? <span className="msg"> · {p.role}</span> : null}</div>
                <div className="chips" role="group" aria-label={'Role for ' + p.name}>
                  {['A', 'R', 'C', 'I'].map((r) => (<button key={r} className="chip" title={ROLE_NAMES[r]} aria-pressed={pick[p.id] === r} onClick={() => choose(p.id, r)}>{r}</button>))}
                  <button className="chip" aria-pressed={pick[p.id] === ''} onClick={() => choose(p.id, '')}>Remove</button>
                </div>
              </div>
            ))}
            {!people.length && <p className="msg">There are no stakeholders yet.</p>}
          </div>
        </>
      ) : (
        <>
          <p className="hint">Replaces the RACI of every selected work item with the roles of the item you pick.</p>
          <label className="fld">Copy roles from
            <select className="c" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Copy roles from">
              <option value="">— select a work item —</option>
              {items.filter((t) => !ids.includes(t.id)).map((t) => (<option key={t.id} value={t.id}>{t.code} · {t.name}</option>))}
            </select>
          </label>
          {src && <p className="msg">{Object.keys(src.raci || {}).length ? Object.entries(src.raci).map(([k, v]) => ((people.find((x) => x.id === k) || {}).name || '?') + ' ' + v).join(' · ') : 'That work item has no roles set, so this clears the selected items.'}</p>}
        </>
      )}

      {ready && <p className="msg" style={{ marginTop: 10 }}>After this, {okAfter} of {tasks.length} selected work item{tasks.length > 1 ? 's' : ''} will have exactly one A and at least one R{okAfter < tasks.length ? '; the rest will show a warning in the Check column' : ''}.</p>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ready} onClick={apply}>Apply to {ids.length} item{ids.length > 1 ? 's' : ''}</button>
      </div>
    </Modal>
  );
}

// Bulk bar for the RACI chart: set roles for many work items at once
export default function RaciBar({ ids, items, people, onDone }) {
  const { update } = useStore();
  const ui = useUI();
  const [open, setOpen] = useState(false);
  if (!ids.length) return null;
  const n = ids.length;
  const clear = () =>
    ui.ask({
      title: 'Clear RACI on ' + n + ' work item' + (n > 1 ? 's' : '') + '?',
      body: 'Every role on the selected work items will be removed.',
      confirm: 'Clear RACI',
      danger: true,
      onConfirm: () => update((p) => ids.forEach((id) => { const f = findTask(p, id); if (f) f.t.raci = {}; })),
    });
  return (
    <>
      <div className="selbar" role="region" aria-label="Bulk RACI actions">
        <b>{n} selected</b>
        <button className="btn primary" onClick={() => setOpen(true)}>Set roles…</button>
        <button className="btn danger" onClick={clear}>Clear RACI</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onDone}>Clear selection</button>
      </div>
      {open && <Dialog ids={ids} items={items} people={people} onClose={() => setOpen(false)} />}
    </>
  );
}
