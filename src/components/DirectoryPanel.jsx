import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { supabase } from '../lib/supabase';
import { Modal, useUI } from './UI';
import { uid } from '../lib/tasks';
import { ROLE_LABEL } from '../lib/access';

const key = (x) => (x || '').trim().toLowerCase();
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Admin only. One master list of stakeholders: tick the projects each person belongs to, add their email to link their sign-in,
// and choose their login role per project. "Signed in" means an account with that email has logged in at least once.
// Name and role are kept the same in every linked project. Rate, capacity and power/interest stay per project.
export default function DirectoryPanel({ onClose }) {
  const { W, updateW } = useStore();
  const ui = useUI();
  const [rows, setRows] = useState([]);
  const [accts, setAccts] = useState(new Map()); // email -> { is_admin, last_sign_in_at }
  const [mem, setMem] = useState([]); // { project_id, email, role } members
  const [inv, setInv] = useState([]); // { project_id, email, role } waiting invitations
  const [form, setForm] = useState({ name: '', role: '', email: '' });
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [d, a, m, i] = await Promise.all([
      supabase.from('directory_people').select('id,name,role,email').order('name', { ascending: true }),
      supabase.rpc('list_accounts'),
      supabase.from('project_members').select('project_id,email,role'),
      supabase.from('project_invites').select('project_id,email,role'),
    ]);
    const err = d.error || a.error || m.error || i.error;
    if (err) {
      setMsg(/does not exist|schema cache|could not find/i.test(err.message) ? 'The directory is not fully set up. Run the SQL files 0004 and 0005 from the supabase folder in Supabase first.' : 'Could not load: ' + err.message);
      return;
    }
    setRows(d.data || []);
    setAccts(new Map((a.data || []).map((x) => [x.email, x])));
    setMem(m.data || []);
    setInv(i.data || []);
    setReady(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const linked = (d, p) => p.people.find((x) => x.dirId === d.id);
  const unlinked = W.projects.flatMap((p) => p.people.filter((x) => !x.dirId).map((x) => ({ pid: p.id, x })));
  const loginOf = (d, p) => { const e = key(d.email); const m = mem.find((x) => x.project_id === p.id && key(x.email) === e); const i = inv.find((x) => x.project_id === p.id && key(x.email) === e); return m ? { role: m.role, state: 'member' } : i ? { role: i.role, state: 'invited' } : null; };
  const hasAccess = (d) => !!d.email && (mem.some((x) => key(x.email) === key(d.email)) || inv.some((x) => key(x.email) === key(d.email)));

  const status = (d) => {
    const e = key(d.email);
    if (!e) return ['No login', 'neutral', 'No email yet: a placeholder, not a real user'];
    const a = accts.get(e);
    if (a) return [a.is_admin ? 'Admin · signed in' : 'Signed in', 'good', a.last_sign_in_at ? 'Last sign-in ' + day(a.last_sign_in_at) : 'Has an account'];
    if (inv.some((x) => key(x.email) === e)) return ['Invited', 'warn', 'Waiting for their first Google sign-in with this email'];
    return ['Email added', 'neutral', 'Not invited to any project yet'];
  };
  const counts = rows.reduce((c, d) => { const s = status(d)[0]; if (s.includes('signed in') || s === 'Signed in') c.in++; else if (s === 'Invited') c.inv++; else c.none++; return c; }, { in: 0, inv: 0, none: 0 });

  const add = async (e) => {
    e.preventDefault();
    const n = form.name.trim();
    const em = key(form.email);
    if (!n) return;
    if (em && !okEmail(em)) return setMsg('That email address does not look right.');
    if (rows.some((d) => key(d.name) === key(n))) return setMsg('“' + n + '” is already in the directory.');
    if (em && rows.some((d) => key(d.email) === em)) return setMsg('That email already belongs to another person in the directory.');
    const ins = await supabase.from('directory_people').insert({ id: uid(), name: n, role: form.role.trim(), email: em });
    if (ins.error) return setMsg('Could not add: ' + ins.error.message);
    setForm({ name: '', role: '', email: '' });
    setMsg('');
    load();
  };

  const importAll = async () => {
    const groups = new Map();
    unlinked.forEach(({ x }) => { if (!groups.has(key(x.name))) groups.set(key(x.name), { name: x.name, role: x.role || '' }); });
    const have = new Map(rows.map((d) => [key(d.name), d]));
    const fresh = [...groups.entries()].filter(([k]) => !have.has(k)).map(([k, g]) => ({ id: uid(), name: g.name, role: g.role, email: '' }));
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
    const em = key(next.email);
    if (em && !okEmail(em)) return setMsg('That email address does not look right.');
    if (em && rows.some((o) => o.id !== d.id && key(o.email) === em)) return setMsg('That email already belongs to another person in the directory.');
    if (patch.email !== undefined && key(d.email) !== em && hasAccess(d)) return setMsg('Set every project to “No login” for ' + d.name + ' first, then change the email.');
    const up = await supabase.from('directory_people').update({ name: next.name.trim(), role: next.role.trim(), email: em }).eq('id', d.id);
    if (up.error) return setMsg('Could not save: ' + up.error.message);
    updateW((w) => w.projects.forEach((p) => p.people.forEach((x) => { if (x.dirId === d.id) { x.name = next.name.trim(); x.role = next.role.trim(); } })));
    setMsg('');
    load();
  };

  const revoke = async (pid, email) => {
    const e = key(email);
    if (!e) return;
    const a = await supabase.from('project_invites').delete().eq('project_id', pid).eq('email', e);
    const b = await supabase.from('project_members').delete().eq('project_id', pid).ilike('email', e);
    const err = a.error || b.error;
    if (err) setMsg('Could not remove login access: ' + err.message);
  };

  const setLogin = async (d, p, role) => {
    setMsg('');
    if (!role) await revoke(p.id, d.email);
    else {
      const r = await supabase.rpc('grant_access', { pid: p.id, mail: key(d.email), r: role });
      if (r.error) setMsg('Could not set the login: ' + r.error.message);
      else setMsg(r.data === 'member' ? d.name + ' already has an account, so they have this access now.' : d.name + ' is invited. Tell them to sign in with Google using ' + key(d.email) + '.');
    }
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
    const login = loginOf(d, p);
    ui.ask({
      title: 'Remove from ' + p.meta.name + '?',
      body: '“' + d.name + '” will be removed from this project, including ' + a + ' work item assignment' + (a === 1 ? '' : 's') + ' or RACI role' + (a === 1 ? '' : 's') + ' and the labour budget.' + (login ? ' Their login access to this project is removed too.' : ''),
      confirm: 'Remove',
      danger: true,
      onConfirm: async () => {
        if (login) await revoke(p.id, d.email);
        updateW((w) => { const pr = w.projects.find((x) => x.id === p.id); pr.people = pr.people.filter((x) => x.dirId !== d.id); });
        load();
      },
    });
  };

  const del = (d) =>
    ui.ask({
      title: 'Delete from the directory?',
      body: '“' + d.name + '” is deleted from the directory only. They stay on the projects they are already in, no longer linked' + (hasAccess(d) ? ', and keep their login access until you change it in each project’s People list.' : '.'),
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
    <Modal title="Stakeholder directory" onClose={onClose} wide="xl">
      <p className="hint">Your master list. Tick the projects each person belongs to. Add an email to link their sign-in, then choose their login role per project. Rate, capacity and power/interest stay separate in each project.</p>
      {ready && <p className="msg">{counts.in} signed in · {counts.inv} invited · {counts.none} with no login yet (placeholders)</p>}
      {unlinked.length > 0 && ready && (
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={importAll}>Import the {new Set(unlinked.map((u) => key(u.x.name))).size} stakeholders already in your projects</button>
        </div>
      )}
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Email (sign-in)</th><th>Status</th><th>Projects and login role</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => {
              const [label, cls, tip] = status(d);
              const isAdmin = !!(accts.get(key(d.email)) || {}).is_admin;
              return (
                <tr key={d.id}>
                  <td><input className="c" defaultValue={d.name} onBlur={(e) => e.target.value.trim() !== d.name && save(d, { name: e.target.value })} aria-label="Name" /></td>
                  <td><input className="c" defaultValue={d.role} onBlur={(e) => e.target.value.trim() !== d.role && save(d, { role: e.target.value })} aria-label="Role" /></td>
                  <td><input className="c" type="email" defaultValue={d.email} placeholder="name@gmail.com" onBlur={(e) => key(e.target.value) !== key(d.email) && save(d, { email: e.target.value })} aria-label={'Sign-in email of ' + d.name} /></td>
                  <td><span className={'pill ' + cls} title={tip}>{label}</span></td>
                  <td>
                    {W.projects.map((p) => {
                      const on = !!linked(d, p);
                      const lg = loginOf(d, p);
                      return (
                        <div key={p.id} className="row" style={{ gap: 8, marginBottom: 4, alignItems: 'center' }}>
                          <label className="msg" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 150 }}>
                            <input type="checkbox" checked={on} onChange={() => toggle(d, p)} /> {p.meta.name}
                          </label>
                          {on && d.email && !isAdmin && (
                            <select className="c" value={lg ? lg.role : ''} onChange={(e) => setLogin(d, p, e.target.value)} aria-label={'Login role of ' + d.name + ' on ' + p.meta.name}>
                              <option value="">No login</option>
                              {['pm', 'member', 'viewer'].map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                            </select>
                          )}
                          {on && lg && lg.state === 'invited' && <span className="msg">invited</span>}
                        </div>
                      );
                    })}
                  </td>
                  <td><button className="x" onClick={() => del(d)} aria-label={'Delete ' + d.name}>✕</button></td>
                </tr>
              );
            })}
            {ready && !rows.length && (<tr><td colSpan="6"><span className="msg">The directory is empty. Add someone below, or import the stakeholders already in your projects.</span></td></tr>)}
          </tbody>
        </table>
      </div>
      <form className="row" style={{ marginTop: 14, alignItems: 'flex-end' }} onSubmit={add}>
        <label className="fld">Name<input className="c w-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name of the new stakeholder" /></label>
        <label className="fld">Role<input className="c w-name" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role of the new stakeholder" /></label>
        <label className="fld">Email (optional)<input className="c w-name" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@gmail.com" aria-label="Email of the new stakeholder" /></label>
        <button className="btn primary" type="submit" disabled={!form.name.trim() || !ready}>Add to directory</button>
      </form>
      {msg && <p className="msg" role="status">{msg}</p>}
    </Modal>
  );
}
