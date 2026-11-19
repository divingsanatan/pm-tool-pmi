import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useCrLinks } from '../store/useCrLinks';
import { canSeeBudget } from '../lib/access';
import { crLabel, crsFor } from '../lib/crLinks';
import { crCls } from '../lib/change';
import { allContainers, statusesOf } from '../lib/tasks';
import Menu from './Menu';
import { Modal } from './UI';
import '../crlinks.css';

const KIND_WORD = { tasks: ['work item', 'work items'], raid: ['risk, issue or other RAID item', 'RAID items'] };

// A change request shown as a tag: its code and name, coloured by status
export function CrChip({ cr, onRemove }) {
  return (
    <span className={'crtag ' + crCls(cr.status)} title={crLabel(cr) + ' (' + cr.status + ')'}>
      <span className="crt-c">{cr.code}</span>
      {cr.title && <span className="crt-t">{cr.title}</span>}
      {onRemove && <button type="button" className="crtag-x" onClick={onRemove} aria-label={'Unlink ' + cr.code}>✕</button>}
    </span>
  );
}

// Read-only tags for the change requests linked to one item
export function CrChips({ kind = 'tasks', id }) {
  const { S, role } = useStore();
  if (!canSeeBudget(role)) return null;
  const mine = crsFor(S, kind, id);
  if (!mine.length) return null;
  return <span className="crl-wrap">{mine.map((c) => (<CrChip key={c.id} cr={c} />))}</span>;
}

// The menu items for linking the given items (one or many) to change requests. A tick means all of them are linked, "some" means a few.
export function crMenuItems(S, kind, ids, lk, setNav) {
  const items = (S.cr || []).map((c) => {
    const has = ids.filter((id) => (c[kind] || []).includes(id)).length;
    return {
      label: <span className="sm-item"><b className="mono">{c.code}</b>&nbsp;{c.title || '(untitled)'}</span>,
      hint: has && has < ids.length ? 'some' : c.status,
      active: has === ids.length,
      keepOpen: true,
      onClick: () => lk.set(kind, ids, c.id, has !== ids.length),
    };
  });
  if (!items.length) items.push({ label: 'No change requests yet', disabled: true });
  const any = (S.cr || []).some((c) => ids.some((id) => (c[kind] || []).includes(id)));
  items.push(
    { sep: true },
    { label: 'Remove all change request links', disabled: !any, onClick: () => lk.clear(kind, ids) },
    { label: 'Open Change control…', onClick: () => setNav({ view: 'project', tab: 'change' }) }
  );
  return items;
}

// Tags for the linked change requests, and a menu to link or unlink them (works whatever the request's status)
export function CrLink({ kind = 'tasks', id, inline = false, className, label: forced, title }) {
  const { S, role, setNav } = useStore();
  const lk = useCrLinks();
  if (!canSeeBudget(role)) return null;
  const mine = crsFor(S, kind, id);
  const label = forced || (mine.length ? <span className="crl-wrap">{mine.map((c) => (<CrChip key={c.id} cr={c} />))}</span> : <span>＋ CR</span>);
  return (
    <Menu
      className={(className || 'tag-btn crl') + (inline ? ' inl' : '') + (mine.length || forced ? '' : ' none')}
      label={label}
      title={title || (mine.length ? 'Change requests: ' + mine.map((c) => c.code).join(', ') + '. Click to change.' : 'Link a change request')}
      items={crMenuItems(S, kind, [id], lk, setNav)}
    />
  );
}

// For a drawer: the linked change requests with a remove button, and a button to link more
export function CrField({ kind = 'tasks', id }) {
  const { S, role } = useStore();
  const lk = useCrLinks();
  if (!canSeeBudget(role)) return null;
  const mine = crsFor(S, kind, id);
  return (
    <div className="chips-a">
      {mine.map((c) => (<CrChip key={c.id} cr={c} onRemove={() => lk.set(kind, [id], c.id, false)} />))}
      <CrLink kind={kind} id={id} className="btn tag-add-btn crl" label={mine.length ? '+ Change request' : '+ Link a change request'} title="Link or unlink change requests" />
      {!mine.length && !(S.cr || []).length && <span className="msg">No change requests yet.</span>}
    </div>
  );
}

// Everything that can be linked, grouped: work items by sprint (or Backlog), RAID items by type
function candidates(S, kind) {
  if (kind === 'raid') {
    const g = {};
    (S.raid || []).forEach((r) => { (g[r.type] = g[r.type] || []).push({ id: r.key, code: r.id || '(no ID)', text: r.desc || '(no description)' }); });
    return Object.keys(g).map((k) => ({ name: k + 's', items: g[k] }));
  }
  return allContainers(S).map((c) => ({ name: c.id === 'backlog' ? 'Backlog' : c.name, items: c.tasks.map((t) => ({ id: t.id, code: t.code || '', text: t.name })) })).filter((g) => g.items.length);
}

// Link many work items or RAID items to one change request at once, with search and "select all shown"
function LinkDialog({ crId, kind, onClose }) {
  const { S } = useStore();
  const lk = useCrLinks();
  const [q, setQ] = useState('');
  const cr = S.cr.find((c) => c.id === crId);
  if (!cr) return null;
  const linked = new Set(cr[kind] || []);
  const ql = q.trim().toLowerCase();
  const groups = candidates(S, kind).map((g) => ({ ...g, items: g.items.filter((i) => !ql || (i.code + ' ' + i.text).toLowerCase().includes(ql)) })).filter((g) => g.items.length);
  const shown = groups.flatMap((g) => g.items.map((i) => i.id));
  const word = KIND_WORD[kind];
  return (
    <Modal title={'Link ' + word[1] + ' to ' + cr.code} onClose={onClose}>
      <div className="crl-dlg">
        <input className="c" style={{ borderColor: 'var(--line)' }} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID or name" aria-label="Search" />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!shown.length} onClick={() => lk.set(kind, shown, cr.id, true)}>Link all shown ({shown.length})</button>
          <button className="btn" disabled={!shown.some((id) => linked.has(id))} onClick={() => lk.set(kind, shown, cr.id, false)}>Unlink all shown</button>
          <span style={{ flex: 1 }} /><span className="msg">{linked.size} linked</span>
        </div>
        <div className="crl-list">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="crl-grp">{g.name}</div>
              {g.items.map((i) => (
                <label key={i.id} className="crl-it"><input type="checkbox" checked={linked.has(i.id)} onChange={(e) => lk.set(kind, [i.id], cr.id, e.target.checked)} /><span className="mono">{i.code}</span><span>{i.text}</span></label>
              ))}
            </div>
          ))}
          {!groups.length && <p className="msg" style={{ margin: 10 }}>{(S.raid || []).length || kind === 'tasks' ? 'Nothing matches.' : 'There are no RAID items yet.'}</p>}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

// In a change request: every linked work item (or RAID item), with unlink and a way to link more. Never locked, so it also works after the request is implemented.
export function LinkedSection({ cr, kind }) {
  const { S } = useStore();
  const lk = useCrLinks();
  const [dlg, setDlg] = useState(false);
  const ids = cr[kind] || [];
  const word = KIND_WORD[kind];
  let rows;
  if (kind === 'raid') {
    const by = new Map((S.raid || []).map((r) => [r.key, r]));
    const owner = (id) => (S.people.find((p) => p.id === id) || {}).name || '';
    rows = ids.map((id) => { const r = by.get(id); return r ? { id, a: r.id || '(no ID)', b: r.type, c: r.desc || '(no description)', d: r.status, e: owner(r.owner) } : { id, a: '–', b: '', c: '(removed item)', d: '', e: '' }; });
  } else {
    const by = new Map();
    allContainers(S).forEach((c) => c.tasks.forEach((t) => by.set(t.id, { t, c })));
    const sts = statusesOf(S);
    rows = ids.map((id) => {
      const f = by.get(id);
      if (!f) return { id, a: '–', b: '', c: '(removed work item)', d: '', e: '' };
      const st = sts.find((x) => x.id === f.t.status);
      const who = (f.t.assignees || []).map((a) => (S.people.find((p) => p.id === a) || {}).name).filter(Boolean).join(', ');
      return { id, a: f.t.code || '–', b: f.c.id === 'backlog' ? 'Backlog' : f.c.name, c: f.t.name, d: f.c.id === 'backlog' ? '' : st ? st.label : '', e: who };
    });
  }
  return (
    <div className="crl-sec">
      <div className="crl-head">
        <span className="msg">{ids.length ? ids.length + ' linked' : 'None linked yet'}</span>
        <button className="btn" onClick={() => setDlg(true)}>Link {word[1]}…</button>
      </div>
      {rows.length > 0 && (
        <div className="scroll">
          <table className="tbl rwd">
            <thead><tr><th>ID</th><th>{kind === 'raid' ? 'Type' : 'Sprint'}</th><th>{kind === 'raid' ? 'Description' : 'Work item'}</th><th>Status</th><th>{kind === 'raid' ? 'Owner' : 'Assignees'}</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-l="ID" className="mono"><span className="cell">{r.a}</span></td>
                  <td data-l={kind === 'raid' ? 'Type' : 'Sprint'}><span className="cell">{r.b || '–'}</span></td>
                  <td data-l={kind === 'raid' ? 'Description' : 'Work item'} className="crl-name"><span className="cell">{r.c}</span></td>
                  <td data-l="Status"><span className="cell">{r.d || '–'}</span></td>
                  <td data-l={kind === 'raid' ? 'Owner' : 'Assignees'}><span className="cell">{r.e || '–'}</span></td>
                  <td data-l=""><button className="x" onClick={() => lk.set(kind, [r.id], cr.id, false)} aria-label={'Unlink ' + r.a} title="Unlink">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dlg && <LinkDialog crId={cr.id} kind={kind} onClose={() => setDlg(false)} />}
    </div>
  );
}
