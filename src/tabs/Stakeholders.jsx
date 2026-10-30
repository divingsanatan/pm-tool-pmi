import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import { allContainers, uid } from '../lib/tasks';
import WrapCell from '../components/WrapCell';
import PowerInterestGrid from '../components/PowerInterestGrid';
import WorkCalendar from '../components/WorkCalendar';
import LeaveCalendar, { PeopleCapacity } from '../components/LeaveCalendar';
import { SCORES, quadrantOf, scoreOf } from '../lib/stakeholderGrid';

const key = (x) => (x || '').trim().toLowerCase();

// The one list of people for the project. Work items, RACI and the labour budget all pick from here.
export default function Stakeholders() {
  const { S, update } = useStore();
  const ui = useUI();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [msg, setMsg] = useState('');
  const tasks = allContainers(S).flatMap((c) => c.tasks);
  const taken = (n, exceptId) => S.people.some((p) => p.id !== exceptId && key(p.name) === key(n));

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (taken(n)) return setMsg(`“${n}” is already on the list.`);
    update((p) => void p.people.push({ id: uid(), name: n, role: role.trim(), cap: 1, rate: 0 }));
    setName('');
    setRole('');
    setMsg('');
  };
  const rename = (p, v) => {
    const n = v.trim();
    if (!n) return;
    if (taken(n, p.id)) return setMsg(`“${n}” is already on the list.`);
    setMsg('');
    update((s) => { s.people.find((x) => x.id === p.id).name = n; });
  };
  const remove = (p) => {
    const a = tasks.filter((t) => (t.assignees || []).includes(p.id)).length;
    const r = tasks.filter((t) => t.raci && t.raci[p.id]).length;
    ui.ask({
      title: 'Remove stakeholder?',
      body: `“${p.name}” will be removed from ${a} assigned work item${a === 1 ? '' : 's'}, ${r} RACI role${r === 1 ? '' : 's'}, and the labour budget.`,
      confirm: 'Remove',
      danger: true,
      onConfirm: () => update((s) => { s.people = s.people.filter((x) => x.id !== p.id); }),
    });
  };

  const setScore = (p, field, v) =>
    update((s) => {
      const x = s.people.find((q) => q.id === p.id);
      if (!x) return;
      if (v === '') delete x[field];
      else x[field] = parseInt(v, 10);
    });
  const scoreBox = (p, field, label) => (
    <select className="c w-sm" value={scoreOf(p[field]) || ''} onChange={(e) => setScore(p, field, e.target.value)} aria-label={label + ' of ' + p.name}>
      <option value="">–</option>
      {SCORES.map((n) => (<option key={n} value={n}>{n}</option>))}
    </select>
  );

  return (
    <>
    <div className="card">
      <h2>Stakeholders</h2>
      <p className="hint">The single list of people for this project. Pick them as assignees on work items, mark them in the RACI chart, and cost them in the Budget. Names can only be added or changed here.</p>
      <div className="row" style={{ margin: '4px 0 12px', alignItems: 'flex-end' }} onKeyDown={(e) => e.key === 'Enter' && add()}>
        <label className="fld">Name<input className="c w-name" style={{ borderColor: 'var(--line)' }} value={name} onChange={(e) => { setName(e.target.value); setMsg(''); }} placeholder="Full name" aria-label="New stakeholder name" /></label>
        <label className="fld">Role or title (optional)<input className="c w-md" style={{ borderColor: 'var(--line)' }} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Product owner" aria-label="New stakeholder role" /></label>
        <button className="btn primary" onClick={add} disabled={!name.trim()}>+ Add stakeholder</button>
      </div>
      {msg && <p className="msg lateTxt" style={{ marginBottom: 8 }}>{msg}</p>}
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Name</th><th>Role or title</th><th>Power (1–5)</th><th>Interest (1–5)</th><th>Engage</th><th className="r">Assigned work items</th><th className="r">RACI roles</th><th>Labour budget</th><th></th></tr></thead>
          <tbody>
            {S.people.map((p) => (
              <tr key={p.id}>
                <td data-l="Name"><WrapCell value={p.name} label="Stakeholder name" onCommit={(v) => rename(p, v)} /></td>
                <td data-l="Role"><WrapCell value={p.role || ''} minWidth={180} placeholder="Role" label="Role or title" onCommit={(v) => update((s) => { s.people.find((x) => x.id === p.id).role = v.trim(); })} /></td>
                <td data-l="Power">{scoreBox(p, 'power', 'Power')}</td>
                <td data-l="Interest">{scoreBox(p, 'interest', 'Interest')}</td>
                <td data-l="Engage"><span className="cell msg">{quadrantOf(p) ? quadrantOf(p).label : 'Set power and interest'}</span></td>
                <td data-l="Assigned" className="r mono"><span className="cell">{tasks.filter((t) => (t.assignees || []).includes(p.id)).length}</span></td>
                <td data-l="RACI roles" className="r mono"><span className="cell">{tasks.filter((t) => t.raci && t.raci[p.id]).length}</span></td>
                <td data-l="Labour budget"><span className="cell msg">{S.team.some((t) => t.person === p.id) ? 'Included' : '–'}</span></td>
                <td data-l=""><button className="x" onClick={() => remove(p)} aria-label={'Remove ' + p.name}>✕</button></td>
              </tr>
            ))}
            {!S.people.length && (<tr className="empty-row"><td colSpan="9"><span className="cell msg">No stakeholders yet. Add the first one above.</span></td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
    <PowerInterestGrid />
    <PeopleCapacity />
    <WorkCalendar />
    <LeaveCalendar />
    </>
  );
}
