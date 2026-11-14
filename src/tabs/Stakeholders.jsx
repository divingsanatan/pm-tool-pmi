import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import { allContainers, uid } from '../lib/tasks';
import { Modal } from '../components/UI';
import { supabase } from '../lib/supabase';
import { activePeople, openAssigned, shortDate, todayIso } from '../lib/people';
import WrapCell from '../components/WrapCell';
import PowerInterestGrid from '../components/PowerInterestGrid';
import WorkCalendar from '../components/WorkCalendar';
import CapacityCards from '../components/CapacityCards';
import LeaveCalendar, { PeopleCapacity } from '../components/LeaveCalendar';
import { SCORES, quadrantOf, scoreOf } from '../lib/stakeholderGrid';

const key = (x) => (x || '').trim().toLowerCase();

// The one list of people for the project. Work items, RACI and the labour budget all pick from here.
export default function Stakeholders() {
  const { S, update, track, cloud } = useStore();
  const [leaving, setLeaving] = useState(null); // person being marked as left
  const [reassign, setReassign] = useState(null); // person whose open work is being handed over
  const ui = useUI();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [msg, setMsg] = useState('');
  const [dir, setDir] = useState(null); // the Admin's stakeholder directory (null while loading or when it is not available)
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const NEW = '__new';
  const loadDir = useCallback(async () => {
    if (!cloud) return;
    const r = await supabase.from('directory_people').select('id,name,role,email').order('name', { ascending: true });
    setDir(r.error ? null : r.data || []);
  }, [cloud]);
  useEffect(() => { loadDir(); }, [loadDir]);
  const tasks = allContainers(S).flatMap((c) => c.tasks);
  const taken = (n, exceptId) => S.people.some((p) => p.id !== exceptId && key(p.name) === key(n));

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (taken(n)) return setMsg(`“${n}” is already on the list.`);
    update((p) => void p.people.push({ id: uid(), name: n, role: role.trim(), cap: 1, rate: 0, joined: todayIso() }));
    setName('');
    setRole('');
    setMsg('');
  };
  // Adds a person from the directory, or creates a new directory entry and adds that. Either way they are linked to the directory.
  const addFromDirectory = async () => {
    setMsg('');
    setBusy(true);
    try {
      let d = dir.find((x) => x.id === sel);
      if (sel === NEW) {
        const n = name.trim();
        if (!n) throw new Error('Enter the person’s name.');
        if (taken(n)) throw new Error('“' + n + '” is already on this project.');
        if (dir.some((x) => key(x.name) === key(n))) throw new Error('“' + n + '” is already in the directory. Choose them from the list.');
        d = { id: uid(), name: n, role: role.trim(), email: '' };
        const r = await supabase.rpc('directory_create', { did: d.id, nm: d.name, rl: d.role, mail: '' });
        if (r.error) throw r.error;
      }
      if (!d) throw new Error('Choose a stakeholder first.');
      update((p) => {
        const same = p.people.find((x) => !x.dirId && key(x.name) === key(d.name));
        if (same) same.dirId = d.id;
        else p.people.push({ id: uid(), dirId: d.id, name: d.name, role: d.role, cap: 1, rate: 0, joined: todayIso() });
      });
      setSel(''); setName(''); setRole('');
      setMsg(d.email ? d.name + ' is added. To let them sign in to this project, use People at the top right.' : '');
      loadDir();
    } catch (e) {
      setMsg('Could not add: ' + (e.message || 'unknown error'));
    }
    setBusy(false);
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
    <CapacityCards />
    <div className="card">
      <h2>Stakeholders</h2>
      <p className="hint">The single list of people for this project. Pick them as assignees on work items, mark them in the RACI chart, and cost them in the Budget. Names can only be added or changed here.</p>
      {cloud && dir ? (
        <div className="row" style={{ margin: '4px 0 12px', alignItems: 'flex-end' }}>
          <label className="fld">Add a stakeholder
            <select className="c" style={{ borderColor: 'var(--line)', minWidth: 240 }} value={sel} onChange={(e) => { setSel(e.target.value); setMsg(''); }} aria-label="Stakeholder from the directory">
              <option value="">Choose from the directory…</option>
              {dir.filter((d) => !S.people.some((x) => x.dirId === d.id)).map((d) => (<option key={d.id} value={d.id}>{d.name}{d.role ? ' · ' + d.role : ''}</option>))}
              <option value={NEW}>+ Create a new stakeholder…</option>
            </select>
          </label>
          {sel === NEW && (
            <>
              <label className="fld">Name<input className="c w-name" style={{ borderColor: 'var(--line)' }} value={name} onChange={(e) => { setName(e.target.value); setMsg(''); }} placeholder="Full name" aria-label="New stakeholder name" /></label>
              <label className="fld">Role or title (optional)<input className="c w-md" style={{ borderColor: 'var(--line)' }} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Product owner" aria-label="New stakeholder role" /></label>
            </>
          )}
          <button className="btn primary" onClick={addFromDirectory} disabled={busy || !sel || (sel === NEW && !name.trim())}>+ Add stakeholder</button>
        </div>
      ) : (
        <div className="row" style={{ margin: '4px 0 12px', alignItems: 'flex-end' }} onKeyDown={(e) => e.key === 'Enter' && add()}>
        <label className="fld">Name<input className="c w-name" style={{ borderColor: 'var(--line)' }} value={name} onChange={(e) => { setName(e.target.value); setMsg(''); }} placeholder="Full name" aria-label="New stakeholder name" /></label>
        <label className="fld">Role or title (optional)<input className="c w-md" style={{ borderColor: 'var(--line)' }} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Product owner" aria-label="New stakeholder role" /></label>
        <button className="btn primary" onClick={add} disabled={!name.trim()}>+ Add stakeholder</button>
      </div>
      )}
      {msg && <p className="msg lateTxt" style={{ marginBottom: 8 }}>{msg}</p>}
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Name</th><th>Role or title</th><th>Power (1–5)</th><th>Interest (1–5)</th><th>Engage</th><th className="r">Assigned work items</th><th className="r">RACI roles</th><th>Labour budget</th><th></th></tr></thead>
          <tbody>
            {S.people.map((p) => (
              <tr key={p.id} style={p.left ? { opacity: 0.6 } : undefined}>
                <td data-l="Name"><WrapCell value={p.name} label="Stakeholder name" onCommit={(v) => rename(p, v)} />{p.left ? <span className="pill neutral" style={{ marginLeft: 8 }}>Left {shortDate(p.left)}</span> : p.joined ? <span className="msg" style={{ marginLeft: 8, fontSize: 12 }}>Joined {shortDate(p.joined)}</span> : null}</td>
                <td data-l="Role"><WrapCell value={p.role || ''} minWidth={180} placeholder="Role" label="Role or title" onCommit={(v) => update((s) => { s.people.find((x) => x.id === p.id).role = v.trim(); })} /></td>
                <td data-l="Power">{scoreBox(p, 'power', 'Power')}</td>
                <td data-l="Interest">{scoreBox(p, 'interest', 'Interest')}</td>
                <td data-l="Engage"><span className="cell msg">{quadrantOf(p) ? quadrantOf(p).label : 'Set power and interest'}</span></td>
                <td data-l="Assigned" className="r mono"><span className="cell">{tasks.filter((t) => (t.assignees || []).includes(p.id)).length}</span></td>
                <td data-l="RACI roles" className="r mono"><span className="cell">{tasks.filter((t) => t.raci && t.raci[p.id]).length}</span></td>
                <td data-l="Labour budget"><span className="cell msg">{S.team.some((t) => t.person === p.id) ? 'Included' : '–'}</span></td>
                <td data-l="">
                  {p.left ? (
                    <>
                      {openAssigned(S, p.id).length > 0 && <button className="btn" onClick={() => setReassign(p)}>Reassign {openAssigned(S, p.id).length} open</button>}{' '}
                      <button className="btn" onClick={() => update((s) => { delete s.people.find((x) => x.id === p.id).left; })} title="Mark as back on the project. Add their login again in People.">Rejoined</button>{' '}
                    </>
                  ) : (
                    <button className="btn" onClick={() => setLeaving(p)}>Left the project</button>
                  )}{' '}
                  <button className="x" onClick={() => remove(p)} aria-label={'Remove ' + p.name} title="Delete completely (removes their history)">✕</button>
                </td>
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
    {leaving && <LeftDialog person={leaving} S={S} cloud={cloud} onClose={() => setLeaving(null)} onConfirm={(date, msg) => { update((s) => { s.people.find((x) => x.id === leaving.id).left = date; }); track('people', leaving.name + ' left the project on ' + shortDate(date) + (msg ? ' (' + msg + ')' : '')); }} />}
    {reassign && <ReassignDialog person={reassign} S={S} onClose={() => setReassign(null)} onConfirm={(to) => { update((s) => { openAssigned(s, reassign.id).forEach((t) => { const a = (t.assignees || []).filter((x) => x !== reassign.id); if (!a.includes(to)) a.push(to); t.assignees = a; }); }); track('people', 'Open work of ' + reassign.name + ' was reassigned to ' + ((S.people.find((x) => x.id === to) || {}).name || 'someone else')); }} />}
    </>
  );
}

// Marks a stakeholder as having left. Their history stays; their login for this project is switched off.
function LeftDialog({ person, S, cloud, onClose, onConfirm }) {
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = openAssigned(S, person.id).length;

  const go = async () => {
    setBusy(true);
    setErr('');
    let note = '';
    if (cloud && person.dirId) {
      // their login to this project is removed too (found through the directory entry)
      const d = await supabase.from('directory_people').select('email').eq('id', person.dirId).maybeSingle();
      const em = d.data && d.data.email ? d.data.email.trim().toLowerCase() : '';
      if (em) {
        const a = await supabase.from('project_invites').delete().eq('project_id', S.id).eq('email', em);
        const b = await supabase.from('project_members').delete().eq('project_id', S.id).ilike('email', em);
        if (a.error || b.error) {
          setErr('Could not switch off their login: ' + (a.error || b.error).message + ' Ask an Admin to remove them in People.');
          setBusy(false);
          return;
        }
        note = 'login removed';
      }
    }
    onConfirm(date, note);
    onClose();
  };

  return (
    <Modal title={person.name + ' left the project'} onClose={onClose}>
      <p className="hint">Their history stays: past assignments, RACI roles and labour cost are kept. They are left out of new assignments, dropdowns and capacity planning, and their login to this project is switched off.</p>
      <label className="fld">Date they left<input className="c" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date they left" /></label>
      {n > 0 && <p className="msg lateTxt">{n} open work item{n === 1 ? ' is' : 's are'} still assigned to them. You can reassign them next.</p>}
      {err && <p className="msg" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy || !date} onClick={go}>{busy ? 'Saving…' : 'Mark as left'}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function ReassignDialog({ person, S, onClose, onConfirm }) {
  const others = activePeople(S).filter((p) => p.id !== person.id && p.name);
  const [to, setTo] = useState(others[0] ? others[0].id : '');
  const items = openAssigned(S, person.id);
  return (
    <Modal title={'Reassign the open work of ' + person.name} onClose={onClose}>
      <p className="hint">{items.length} open work item{items.length === 1 ? '' : 's'} will move to the person you choose. Done work and past RACI roles stay as they are.</p>
      <label className="fld">Reassign to
        <select className="c" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Reassign to">
          {others.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.role ? ' · ' + p.role : ''}</option>))}
        </select>
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!to} onClick={() => { onConfirm(to); onClose(); }}>Reassign</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
