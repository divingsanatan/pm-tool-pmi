import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { supabase } from '../lib/supabase';
import { Modal } from './UI';
import { uid } from '../lib/tasks';
import { ROLE_HINT, ROLE_LABEL, grantable } from '../lib/access';

const clean = (e) => String(e || '').trim().toLowerCase();
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const NEW = '__new';

// People on one project. Choose a stakeholder from the directory: with an email they get a login (at once if they already have
// an account from another project, otherwise an invitation), without an email they are only a placeholder on the project.
// Admin can give any login role; a Project Manager can add team members and viewers.
export default function MembersPanel({ onClose }) {
  const { S, role, cloud, update } = useStore();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [dir, setDir] = useState([]);
  const [setup, setSetup] = useState('');
  const options = grantable(role);
  const [pick, setPick] = useState(options.includes('member') ? 'member' : options[0] || 'member');
  const [sel, setSel] = useState('');
  const [email, setEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, i, d] = await Promise.all([
      supabase.from('project_members').select('user_id,email,role').eq('project_id', S.id).order('created_at', { ascending: true }),
      supabase.from('project_invites').select('id,email,role').eq('project_id', S.id).order('created_at', { ascending: true }),
      supabase.from('directory_people').select('id,name,role,email').order('name', { ascending: true }),
    ]);
    if (m.error || i.error) return setMsg('Could not load people: ' + (m.error || i.error).message);
    setMembers(m.data || []);
    setInvites(i.data || []);
    if (d.error) setSetup('The stakeholder list is not available yet. Run the SQL files 0004, 0005 and 0006 from the supabase folder in Supabase.');
    else { setDir(d.data || []); setSetup(''); }
  }, [S.id]);
  useEffect(() => { load(); }, [load]);

  const nameOfEmail = (e) => (dir.find((d) => clean(d.email) === clean(e)) || {}).name;
  const available = dir.filter((d) => !S.people.some((x) => x.dirId === d.id));
  const chosen = dir.find((d) => d.id === sel);
  const em = chosen && chosen.email ? clean(chosen.email) : clean(email);
  const mayChange = (r) => role === 'admin' || (role === 'pm' && (r === 'member' || r === 'viewer'));

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      if (!sel) throw new Error('Choose a stakeholder first.');
      if (em && !okEmail(em)) throw new Error('Enter a valid email address.');
      let d = chosen;
      if (em && dir.some((o) => (!d || o.id !== d.id) && clean(o.email) === em)) throw new Error('That email already belongs to ' + dir.find((o) => clean(o.email) === em).name + '. Choose them from the list.');
      if (sel === NEW) {
        const n = newName.trim();
        if (!n) throw new Error('Enter the person’s name.');
        if (dir.some((o) => clean(o.name) === clean(n))) throw new Error('“' + n + '” is already in the list. Choose them from the list.');
        d = { id: uid(), name: n, role: newTitle.trim(), email: em };
        const r = await supabase.rpc('directory_create', { did: d.id, nm: d.name, rl: d.role, mail: em });
        if (r.error) throw r.error;
      } else if (d && !d.email && em) {
        const r = await supabase.rpc('set_directory_email', { did: d.id, mail: em });
        if (r.error) throw r.error;
      }
      // onto this project's Stakeholders list (linked to the directory)
      update((p) => {
        const same = p.people.find((x) => !x.dirId && clean(x.name) === clean(d.name));
        if (same) same.dirId = d.id;
        else p.people.push({ id: uid(), dirId: d.id, name: d.name, role: d.role, cap: 1, rate: 0 });
      });
      if (em) {
        const g = await supabase.rpc('grant_access', { pid: S.id, mail: em, r: pick });
        if (g.error) throw g.error;
        setMsg(g.data === 'member' ? d.name + ' already has an account, so they can open this project now.' : d.name + ' is invited. Tell them to sign in with Google using ' + em + '.');
      } else setMsg(d.name + ' is added to the project as a placeholder with no login. Add an email later to invite them.');
      setSel(''); setEmail(''); setNewName(''); setNewTitle('');
      load();
    } catch (err) {
      setMsg('Could not add: ' + (err.message || 'unknown error'));
    }
    setBusy(false);
  };

  const dropInvite = async (id) => { await supabase.from('project_invites').delete().eq('id', id); load(); };
  const setRole = async (m, r) => {
    const up = await supabase.from('project_members').update({ role: r }).eq('project_id', S.id).eq('user_id', m.user_id);
    if (up.error) setMsg('Could not change the role: ' + up.error.message);
    load();
  };
  const remove = async (m) => {
    const del = await supabase.from('project_members').delete().eq('project_id', S.id).eq('user_id', m.user_id);
    if (del.error) setMsg('Could not remove: ' + del.error.message);
    load();
  };

  return (
    <Modal title={'People on ' + (S.meta.name || 'this project')} onClose={onClose} wide>
      <p className="hint">Admins see every project. Everyone below can open this project with the role shown. Someone who already has an account from another project gets access straight away.</p>
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th>Person</th><th>Role</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{nameOfEmail(m.email) ? nameOfEmail(m.email) + ' · ' : ''}{m.email || '(no email)'}{m.user_id === cloud.userId ? ' (you)' : ''} <span className="pill good">Signed in</span></td>
                <td>
                  {mayChange(m.role) && m.user_id !== cloud.userId ? (
                    <select className="c" value={m.role} onChange={(e) => setRole(m, e.target.value)} aria-label={'Role of ' + m.email}>
                      {[m.role].concat(options.filter((o) => o !== m.role)).map((o) => (<option key={o} value={o}>{ROLE_LABEL[o]}</option>))}
                    </select>
                  ) : ROLE_LABEL[m.role]}
                </td>
                <td>{mayChange(m.role) && m.user_id !== cloud.userId && <button className="x" onClick={() => remove(m)} aria-label={'Remove ' + m.email}>✕</button>}</td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.id}>
                <td>{nameOfEmail(i.email) ? nameOfEmail(i.email) + ' · ' : ''}{i.email} <span className="pill warn">Invited</span></td>
                <td>{ROLE_LABEL[i.role]}</td>
                <td><button className="x" onClick={() => dropInvite(i.id)} aria-label={'Cancel invite for ' + i.email}>✕</button></td>
              </tr>
            ))}
            {!members.length && !invites.length && (<tr><td colSpan="3"><span className="msg">Only Admins can open this project so far.</span></td></tr>)}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: '16px 0 6px' }}>Add a person</h3>
      {setup && <p className="msg" style={{ color: 'var(--bad)' }}>{setup}</p>}
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={add}>
        <label className="fld">Stakeholder
          <select className="c" value={sel} onChange={(e) => { setSel(e.target.value); setEmail(''); }} aria-label="Stakeholder">
            <option value="">Choose from the list…</option>
            {available.map((d) => (<option key={d.id} value={d.id}>{d.name}{d.role ? ' · ' + d.role : ''}{d.email ? '' : ' (no email yet)'}</option>))}
            <option value={NEW}>+ Someone new…</option>
          </select>
        </label>
        {sel === NEW && (
          <>
            <label className="fld">Name<input className="c w-name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name" /></label>
            <label className="fld">Job title<input className="c w-name" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label="Job title" /></label>
          </>
        )}
        {sel && !(chosen && chosen.email) && (
          <label className="fld">Email (leave empty for a placeholder)<input className="c w-name" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" aria-label="Email" /></label>
        )}
        {sel && em && (
          <label className="fld">Login role
            <select className="c" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Login role">
              {options.map((o) => (<option key={o} value={o}>{ROLE_LABEL[o]}</option>))}
            </select>
          </label>
        )}
        <button className="btn primary" type="submit" disabled={busy || !sel}>{em ? 'Add and invite' : 'Add to project'}</button>
      </form>
      {chosen && chosen.email && <p className="msg">Email on file: {chosen.email}</p>}
      {sel && em && <p className="msg">{ROLE_HINT[pick]}</p>}
      {msg && <p className="msg" role="status">{msg}</p>}
    </Modal>
  );
}
