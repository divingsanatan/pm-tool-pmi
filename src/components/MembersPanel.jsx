import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { supabase } from '../lib/supabase';
import { Modal } from './UI';
import { ROLE_HINT, ROLE_LABEL, grantable } from '../lib/access';

const clean = (e) => String(e || '').trim().toLowerCase();
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// People on one project. Admin can give any role; a Project Manager can add team members and viewers.
export default function MembersPanel({ onClose }) {
  const { S, role, cloud } = useStore();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const options = grantable(role);
  const [pick, setPick] = useState(options.includes('member') ? 'member' : options[0] || 'member');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.from('project_members').select('user_id,email,role').eq('project_id', S.id).order('created_at', { ascending: true }),
      supabase.from('project_invites').select('id,email,role').eq('project_id', S.id).order('created_at', { ascending: true }),
    ]);
    if (m.error || i.error) return setMsg('Could not load people: ' + (m.error || i.error).message);
    setMembers(m.data || []);
    setInvites(i.data || []);
  }, [S.id]);
  useEffect(() => { load(); }, [load]);

  const mayChange = (r) => role === 'admin' || (role === 'pm' && (r === 'member' || r === 'viewer'));

  const invite = async (e) => {
    e.preventDefault();
    const em = clean(email);
    if (!okEmail(em)) return setMsg('Enter a valid email address.');
    if (members.some((m) => clean(m.email) === em)) return setMsg('That person is already on this project.');
    setBusy(true);
    setMsg('');
    const up = await supabase.from('project_invites').upsert({ project_id: S.id, email: em, role: pick }, { onConflict: 'project_id,email' });
    setBusy(false);
    if (up.error) return setMsg('Could not invite: ' + up.error.message);
    setEmail('');
    setMsg('Invited ' + em + '. They join when they sign in with Google using this exact email.');
    load();
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
      <p className="hint">Admins see every project. Everyone below can open this project with the role shown.</p>
      <div className="scroll">
        <table className="tbl">
          <thead><tr><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email || '(no email)'}{m.user_id === cloud.userId ? ' (you)' : ''}</td>
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
                <td>{i.email} <span className="pill neutral">Invited</span></td>
                <td>{ROLE_LABEL[i.role]}</td>
                <td><button className="x" onClick={() => dropInvite(i.id)} aria-label={'Cancel invite for ' + i.email}>✕</button></td>
              </tr>
            ))}
            {!members.length && !invites.length && (<tr><td colSpan="3"><span className="msg">Only Admins can open this project so far.</span></td></tr>)}
          </tbody>
        </table>
      </div>

      <form className="row" style={{ marginTop: 14, alignItems: 'flex-end' }} onSubmit={invite}>
        <label className="fld">Invite by email<input className="c w-name" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" aria-label="Email to invite" /></label>
        <label className="fld">Role
          <select className="c" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Role">
            {options.map((o) => (<option key={o} value={o}>{ROLE_LABEL[o]}</option>))}
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={busy || !email.trim()}>Invite</button>
      </form>
      <p className="msg">{ROLE_HINT[pick]}</p>
      {msg && <p className="msg" role="status">{msg}</p>}
    </Modal>
  );
}
