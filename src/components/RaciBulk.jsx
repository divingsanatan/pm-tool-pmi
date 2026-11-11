import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Modal, useUI } from './UI';
import { Avatar } from './Bits';
import { raciOkFor } from '../lib/calc';
import { findTask } from '../lib/tasks';
import { RACI_ROLES, ROLE_INFO } from '../lib/raci';

export const ROLE_NAMES = Object.fromEntries(RACI_ROLES.map((r) => [r, ROLE_INFO[r].name]));

// Applies { personId: 'A' | 'R' | 'C' | 'I' | '' } to one work item's roles. Only one person can be Accountable:
// making someone A moves the previous A to Responsible (so they stay on the work item). An empty role removes the person.
export function applyRoles(roles, changes) {
  const next = { ...(roles || {}) };
  const newA = Object.keys(changes).filter((k) => changes[k] === 'A');
  Object.entries(changes).forEach(([pid, role]) => {
    if (role) next[pid] = role;
    else delete next[pid];
  });
  if (newA.length) {
    const keep = newA[newA.length - 1];
    Object.keys(next).forEach((k) => next[k] === 'A' && k !== keep && (next[k] = 'R'));
  }
  return next;
}

function RoleButtons({ value, onPick, name, allowClear = true, clearLabel = 'None', disabledA }) {
  return (
    <div className="rx-seg" role="group" aria-label={'Role for ' + name}>
      {RACI_ROLES.map((r) => (
        <button
          key={r}
          type="button"
          className={'rx-rb r-' + r}
          aria-pressed={value === r}
          disabled={r === 'A' && disabledA}
          title={ROLE_INFO[r].name + ' · ' + ROLE_INFO[r].hint}
          onClick={() => onPick(r)}
        >{r}</button>
      ))}
      {allowClear && <button type="button" className="rx-rb rx-none" aria-pressed={value === ''} title="No role" onClick={() => onPick('')}>{clearLabel}</button>}
    </div>
  );
}

// One dialog for one work item OR many. With one work item it starts from the roles already there and you edit
// everybody in a single place. With many it only changes the people you touch and leaves everyone else alone.
// Tick several stakeholders to give them all the same role in one click.
export function AssignDialog({ ids, items, people, onClose }) {
  const { S, update } = useStore();
  const single = ids.length === 1;
  const tasks = ids.map((id) => (findTask(S, id) || {}).t).filter(Boolean);
  const [mode, setMode] = useState('set');
  const [pick, setPick] = useState(() => {
    if (!single) return {};
    const t = tasks[0];
    return Object.fromEntries(people.map((p) => [p.id, (t && t.raci && t.raci[p.id]) || '']));
  });
  const [marked, setMarked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const src = items.find((t) => t.id === from);

  const shown = useMemo(() => people.filter((p) => !q.trim() || (p.name + ' ' + (p.role || '')).toLowerCase().includes(q.trim().toLowerCase())), [people, q]);
  const nameOf = (id) => (people.find((x) => x.id === id) || {}).name || 'Someone';

  const setRole = (cur, pid, role) => {
    const n = { ...cur };
    if (role === 'A') Object.keys(n).forEach((k) => k !== pid && n[k] === 'A' && (n[k] = single ? 'R' : undefined)); // one A: the old one becomes R (single) or is left unchanged (many)
    Object.keys(n).forEach((k) => n[k] === undefined && delete n[k]);
    if (single) n[pid] = role;
    else if (n[pid] === role) delete n[pid];
    else n[pid] = role;
    return n;
  };
  const choose = (pid, role) => setPick((cur) => setRole(cur, pid, single && cur[pid] === role ? '' : role));
  const toggleMark = (pid) => setMarked((m) => { const n = new Set(m); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  const markAll = (on) => setMarked(on ? new Set(shown.map((p) => p.id)) : new Set());
  const giveMarked = (role) =>
    setPick((cur) => {
      let n = { ...cur };
      [...marked].forEach((pid) => { n = single || n[pid] !== role ? setRole(n, pid, role) : (delete n[pid], n); });
      return n;
    });
  const fillInformed = () => setPick((cur) => Object.fromEntries(people.map((p) => [p.id, cur[p.id] || 'I'])));

  const changes = single ? pick : Object.fromEntries(Object.entries(pick).filter(([, v]) => v !== undefined));
  const changed = single ? people.filter((p) => (pick[p.id] || '') !== ((tasks[0] && tasks[0].raci && tasks[0].raci[p.id]) || '')).length : Object.keys(changes).length;
  const after = (t) => (mode === 'copy' ? (src ? { ...src.raci } : t.raci) : applyRoles(t.raci, single ? Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, v || ''])) : changes));
  const okAfter = tasks.filter((t) => raciOkFor(after(t))).length;
  const ready = mode === 'set' ? changed > 0 : !!src;
  const aCount = Object.values(pick).filter((v) => v === 'A').length;
  const rCount = Object.values(pick).filter((v) => v === 'R').length;

  const apply = () => {
    update((p) => {
      ids.forEach((id) => {
        const f = findTask(p, id);
        if (!f) return;
        if (mode === 'copy') {
          const keep = new Set(p.people.map((x) => x.id));
          f.t.raci = Object.fromEntries(Object.entries((src && src.raci) || {}).filter(([k]) => keep.has(k)));
        } else f.t.raci = applyRoles(f.t.raci, single ? Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, v || ''])) : changes);
      });
    });
    onClose();
  };

  const title = single ? 'Assign stakeholders' : 'Set RACI for ' + ids.length + ' work items';
  return (
    <Modal title={title} onClose={onClose} wide>
      {single && tasks[0] && (
        <p className="rx-dlg-item"><span className="mono msg">{tasks[0].code}</span> <b>{tasks[0].name}</b></p>
      )}
      <div className="seg" role="group" aria-label="How to set RACI" style={{ marginBottom: 12 }}>
        <button aria-pressed={mode === 'set'} onClick={() => setMode('set')}>Set roles</button>
        <button aria-pressed={mode === 'copy'} onClick={() => setMode('copy')}>Copy from a work item</button>
      </div>

      {mode === 'set' ? (
        <>
          <p className="hint">
            {single
              ? 'Give each stakeholder a role for this work item. Tick several people to give them the same role at once.'
              : 'Roles you choose are applied to every selected work item. People left on “No change” keep what they have. Tick several people to give them the same role at once.'}
          </p>

          <div className="rx-tools">
            {people.length > 6 && <input className="c rx-find" type="search" placeholder="Find a stakeholder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a stakeholder" />}
            <label className="rx-all"><input type="checkbox" className="tg-sel" checked={shown.length > 0 && shown.every((p) => marked.has(p.id))} onChange={(e) => markAll(e.target.checked)} aria-label="Tick all stakeholders" /> Tick all</label>
            {single && <button type="button" className="btn" onClick={fillInformed} title="Everyone with no role becomes Informed">Everyone else Informed</button>}
          </div>

          {marked.size > 0 && (
            <div className="rx-bulkrow" role="region" aria-label="Give ticked stakeholders a role">
              <b>{marked.size} ticked</b>
              <span className="msg">give them</span>
              <RoleButtons value={null} name="ticked stakeholders" onPick={giveMarked} clearLabel={single ? 'None' : 'Remove'} disabledA={marked.size > 1} />
              {marked.size > 1 && <span className="msg">Only one person can be Accountable.</span>}
            </div>
          )}

          <div className="rb-list rx-plist">
            {shown.map((p) => {
              const v = pick[p.id];
              return (
                <div key={p.id} className={'rx-prow' + (marked.has(p.id) ? ' on' : '')}>
                  <input type="checkbox" className="tg-sel" checked={marked.has(p.id)} onChange={() => toggleMark(p.id)} aria-label={'Tick ' + p.name} />
                  <Avatar name={p.name} size={28} />
                  <div className="rx-who"><b>{p.name}</b>{p.role ? <span className="msg">{p.role}</span> : null}</div>
                  <RoleButtons value={single ? (v || '') : (v === undefined ? null : v)} name={p.name} onPick={(r) => choose(p.id, r)} clearLabel={single ? 'None' : 'Remove'} />
                </div>
              );
            })}
            {!people.length && <p className="msg">There are no stakeholders yet. Add them on the Stakeholders tab.</p>}
            {people.length > 0 && !shown.length && <p className="msg">No stakeholder matches “{q}”.</p>}
          </div>
          {single && (
            <p className={'rx-live ' + (aCount === 1 && rCount >= 1 ? 'good' : 'warn')} role="status">
              {aCount === 1 && rCount >= 1 ? 'Looks good: one Accountable and ' + rCount + ' Responsible.' : aCount === 0 ? 'Needs one Accountable (A).' : rCount < 1 ? 'Needs at least one Responsible (R).' : ''}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="hint">Replaces the RACI of {single ? 'this work item' : 'every selected work item'} with the roles of the item you pick.</p>
          <label className="fld">Copy roles from
            <select className="c" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Copy roles from">
              <option value="">— select a work item —</option>
              {items.filter((t) => !ids.includes(t.id)).map((t) => (<option key={t.id} value={t.id}>{t.code} · {t.name}</option>))}
            </select>
          </label>
          {src && <p className="msg">{Object.keys(src.raci || {}).length ? Object.entries(src.raci).map(([k, v]) => nameOf(k) + ' ' + v).join(' · ') : 'That work item has no roles set, so this clears the selected items.'}</p>}
        </>
      )}

      {ready && !single && <p className="msg" style={{ marginTop: 10 }}>After this, {okAfter} of {tasks.length} selected work items will have exactly one A and at least one R{okAfter < tasks.length ? '; the rest will show a warning in the Check column' : ''}.</p>}
      <div className="row rx-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ready} onClick={apply}>{single ? 'Save roles' : 'Apply to ' + ids.length + ' items'}</button>
      </div>
    </Modal>
  );
}

// Bulk bar for the RACI chart. Tick work items (rows) and/or stakeholders (columns):
//  - "Assign roles…" opens the dialog for the ticked work items
//  - with stakeholders ticked, one click gives all of them the same role on the ticked work items
//    (or on every work item currently shown, when none are ticked)
export default function RaciBar({ ids, items, people, pickedPeople = [], shownIds = [], onDone, onClearPeople }) {
  const { update } = useStore();
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const n = ids.length, k = pickedPeople.length;
  if (!n && !k) return null;
  const targets = n ? ids : shownIds;
  const names = pickedPeople.map((id) => (people.find((p) => p.id === id) || {}).name).filter(Boolean);
  const who = k === 1 ? names[0] : k + ' stakeholders';
  const what = n ? n + ' selected work item' + (n > 1 ? 's' : '') : 'all ' + shownIds.length + ' work items shown';

  const run = (role) => {
    const go = () => update((p) => targets.forEach((id) => {
      const f = findTask(p, id);
      if (!f) return;
      f.t.raci = applyRoles(f.t.raci, Object.fromEntries(pickedPeople.map((pid) => [pid, role])));
    }));
    if (!n || role === '') {
      ui.ask({
        title: (role ? 'Set ' + role + ' for ' : 'Remove ') + who + (role ? '' : ' from') + ' ' + (role ? 'on ' : '') + what + '?',
        body: role ? who + ' will get the role ' + ROLE_INFO[role].name + ' on ' + what + '. Existing roles for ' + (k === 1 ? 'this person' : 'these people') + ' on those work items are replaced.' : 'Their roles on ' + what + ' will be removed.',
        confirm: role ? 'Apply ' + role : 'Remove',
        danger: !role,
        onConfirm: go,
      });
    } else go();
  };
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
      <div className="selbar rx-selbar" role="region" aria-label="Bulk RACI actions">
        <div className="rx-sel-top">
          <b>{n ? n + ' work item' + (n > 1 ? 's' : '') : ''}{n && k ? ' · ' : ''}{k ? k + ' stakeholder' + (k > 1 ? 's' : '') : ''} selected</b>
          <span style={{ flex: 1 }} />
          {n > 0 && <button className="btn" onClick={onDone}>Clear items</button>}
          {k > 0 && <button className="btn" onClick={onClearPeople}>Clear stakeholders</button>}
        </div>
        {k > 0 && (
          <div className="rx-sel-row">
            <span className="msg">Give {who} on {what}:</span>
            <RoleButtons value={null} name={who} onPick={run} clearLabel="Remove" disabledA={k > 1} />
            {k > 1 && <span className="msg">A is off because only one person can be Accountable.</span>}
          </div>
        )}
        {n > 0 && (
          <div className="rx-sel-row">
            <button className="btn primary" onClick={() => setOpen(true)}>Assign roles…</button>
            <button className="btn danger" onClick={clear}>Clear RACI</button>
          </div>
        )}
      </div>
      {open && <AssignDialog ids={ids} items={items} people={people} onClose={() => setOpen(false)} />}
    </>
  );
}
