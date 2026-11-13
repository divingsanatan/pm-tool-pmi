import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { supabase } from '../lib/supabase';
import { Modal, useUI } from './UI';
import { uid } from '../lib/tasks';

const key = (x) => (x || '').trim().toLowerCase();

// Admin only. One master list of stakeholders; tick the projects each person belongs to.
// Ticking adds the person to that project's Stakeholders list (linked by dirId), unticking removes them from it.
// A person's name and role are kept the same in every project they are linked to. Rate, capacity and power/interest stay per project.
export default function DirectoryPanel({ onClose }) {
  const { W, updateW } = useStore();
  const ui = useUI();
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const r = await supabase.from('directory_people').select('id,name,role').order('name', { ascending: true });
    if (r.error) {
      setMsg(/does not exist|schema cache/i.test(r.error.message) ? 'The directory is not set up yet. Run the SQL file 0004_stakeholder_directory.sql in Supabase first.' : 'Could not load: ' + r.error.message);
      return;
    }
    setRows(r.data || []);
    setReady(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const linked = (d, p) => p.people.find((x) => x.dirId === d.id);
  const unlinked = W.projects.flatMap((p) => p.people.filter((x) => !x.dirId).map((x) => ({ pid: p.id, x })));

  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (rows.some((d) => key(d.name) === key(n))) return setMsg('“' + n + '” is already in the directory.');
    const row = { id: uid(), name: n, role: role.trim() };
    const ins = await supabase.from('directory_people').insert(row);
    if (ins.error) return setMsg('Could not add: ' + ins.error.message);
    setName(''); setRole(''); setMsg('');
    load();
  };

  const importAll = async () => {
    const groups = new Map();
    unlinked.forEach(({ x }) => { if (!groups.has(key(x.name))) groups.set(key(x.name), { name: x.name, role: x.role || '' }); });
    const have = new Map(rows.map((d) => [key(d.name), d]));
    const fresh = [...groups.entries()].filter(([k]) => !have.has(k)).map(([k, g]) => ({ id: uid(), name: g.name, role: g.role }));
    if (fresh.length) {
      const ins = await supabase.from('directory_people').insert(fresh);
      if (ins.error) return setMsg('Could not import: ' + ins.error.message);
    }
    const ids = new Map([...have.entries()].map(([k, d]) => [k, d.id]).concat(fresh.map((d) => [key(d.name), d.id])));
    updateW((w) => w.projects.forEach((p) => p.people.forEach((x) => { if (!x.dirId && ids.has(key(x.name))) x.dirId = ids.get(key(x.name)); })));
    setMsg('Imported the stakeholders already in your projects. The same name in two projects is now one person.');
    load();
  };

  const save = async (d, patch) => {
    const next = { ...d, ...patch };
    if (!next.name.trim()) return;
    if (rows.some((o) => o.id !== d.id && key(o.name) === key(next.name))) return setMsg('“' + next.name + '” is already in the directory.');
    const up = await supabase.from('directory_people').update({ name: next.name.trim(), role: next.role.trim() }).eq('id', d.id);
    if (up.error) return setMsg('Could not save: ' + up.error.message);
    updateW((w) => w.projects.forEach((p) => p.people.forEach((x) => { if (x.dirId === d.id) { x.name = next.name.trim(); x.role = next.role.trim(); } })));
    setMsg('');
    load();
  };

  const toggle = (d, p) => {
    const have = linked(d, p);
    if (!have) {
      updateW((w) => {
        const pr = w.projects.find((x) => x.id === p.id);
        const same = pr.people.find((x) => !x.dirId && key(x.name) === key(d.name)); // already there by name: link it, do not duplicate
        if (same) same.dirId = d.id;
        else pr.people.push({ id: uid(), dirId: d.id, name: d.name, role: d.role, cap: 1, rate: 0 });
      });
      return;
    }
    const tasks = [...p.sprints.flatMap((s) => s.tasks), ...p.backlog.tasks];
    const a = tasks.filter((t) => (t.assignees || []).includes(have.id) || (t.raci && t.raci[have.id])).length;
    ui.ask({
      title: 'Remove from ' + p.meta.name + '?',
      body: '“' + d.name + '” will be removed from this project, including ' + a + ' work item assignment' + (a === 1 ? '' : 's') + ' or RACI role' + (a === 1 ? '' : 's') + ' and the labour budget.',
      confirm: 'Remove',
      danger: true,
      onConfirm: () => updateW((w) => { const pr = w.projects.find((x) => x.id === p.id); pr.people = pr.people.filter((x) => x.dirId !== d.id); }),
    });
  };

  const del = (d) =>
    ui.ask({
      title: 'Delete from the directory?',
      body: '“' + d.name + '” is deleted from the directory only. They stay on the projects they are already in, no longer linked.',
      confirm: 'Delete',
      danger: true,
      onConfirm: async () => {
        const r = await supabase.from('directory_people').delete().eq('id', d.id);
        if (r.error) return setMsg('Could not delete: ' + r.error.message);
        updateW((w) => w.projects.forEach((p) => p.people.forEach((x) => { if (x.dirId === d.id) delete x.dirId; })));
        load();
      },
    });

  return (
    <Modal title="Stakeholder directory" onClose={onClose} wide>
      <p className="hint">Your master list. Tick the projects each person belongs to. Rate, capacity and power/interest stay separate in each project. Names and roles stay the same everywhere.</p>
      {unlinked.length > 0 && ready && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={importAll}>Import the {new Set(unlinked.map((u) => key(u.x.name))).size} stakeholders already in your projects</button>
        </div>
      )}
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Projects</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><input className="c" defaultValue={d.name} onBlur={(e) => e.target.value.trim() !== d.name && save(d, { name: e.target.value })} aria-label="Name" /></td>
                <td><input className="c" defaultValue={d.role} onBlur={(e) => e.target.value.trim() !== d.role && save(d, { role: e.target.value })} aria-label="Role" /></td>
                <td>
                  {W.projects.map((p) => (
                    <label key={p.id} className="msg" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 12 }}>
                      <input type="checkbox" checked={!!linked(d, p)} onChange={() => toggle(d, p)} /> {p.meta.name}
                    </label>
                  ))}
                </td>
                <td><button className="x" onClick={() => del(d)} aria-label={'Delete ' + d.name}>✕</button></td>
              </tr>
            ))}
            {ready && !rows.length && (<tr><td colSpan="4"><span className="msg">The directory is empty. Add someone below, or import the stakeholders already in your projects.</span></td></tr>)}
          </tbody>
        </table>
      </div>
      <form className="row" style={{ marginTop: 14, alignItems: 'flex-end' }} onSubmit={add}>
        <label className="fld">Name<input className="c w-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the new stakeholder" /></label>
        <label className="fld">Role<input className="c w-name" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role of the new stakeholder" /></label>
        <button className="btn primary" type="submit" disabled={!name.trim() || !ready}>Add to directory</button>
      </form>
      {msg && <p className="msg" role="status">{msg}</p>}
    </Modal>
  );
}
