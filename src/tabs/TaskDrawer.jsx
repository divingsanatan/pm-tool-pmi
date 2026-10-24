import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from '../components/UI';
import { Area, Cell, SelectCell } from '../components/Field';
import { Avatar, StatusIcon, TypeBadge } from '../components/Bits';
import { AssigneeMenu } from '../components/Pickers';
import { PRIORITIES, allContainers, childTypeFor, findTask, isDoneStatus, nameOf, statusOf, statusesOf, typeOf, typesOf } from '../lib/tasks';
import { ancestorsOf, flatTree, subtreeIds } from '../lib/hier';
import { fdate } from '../lib/dates';
import { clock, dayLabel } from '../lib/activity';
import { hrsf, nz, pc } from '../lib/format';

export default function TaskDrawer({ taskId, onClose, onOpen }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const [sub, setSub] = useState('');
  const [subType, setSubType] = useState('');
  const f = findTask(S, taskId);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    if (!f) onClose();
  }, [f, onClose]);
  if (!f) return null;

  const t = f.t;
  const back = f.c.id === 'backlog';
  const place = allContainers(S).map((c) => [c.id, c.name]);
  const kids = f.c.tasks.filter((x) => x.parent === t.id);
  const parent = kids.length > 0;
  const effortRolled = parent && kids.some((k) => nz(k.effort) > 0);
  const datesRolled = parent && !back && kids.some((k) => k.start || k.due);
  const up = ancestorsOf(f.c.tasks, t.id);
  const below = subtreeIds(f.c.tasks, t.id);
  const milestone = typeOf(S, t.type).milestone;
  // a work item can sit under any other item of the same sprint, except itself and what is below it
  const parents = [['', 'None (top level)']].concat(
    flatTree(f.c.tasks).filter((r) => !below.includes(r.t.id)).map((r) => [r.t.id, '\u00A0\u00A0'.repeat(r.depth) + r.t.code + ' · ' + r.t.name])
  );
  const defaultSub = childTypeFor(S, t.type);
  const addSub = () => {
    const n = sub.trim();
    if (n) tk.addChild(t.id, { name: n, type: subType || defaultSub });
    setSub('');
  };

  return (
    <>
      <div className="drawer-bg" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-label="Task details">
        <div className="row sp">
          <span className="msg mono">{t.code}</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {up.length > 0 && (
          <div className="crumbs" aria-label="Parent work items">
            {up.map((a) => (
              <span key={a.id}>
                <button className="x" onClick={() => onOpen && onOpen(a.id)} title={'Open ' + a.name}><TypeBadge type={typeOf(S, a.type)} size={14} /> {a.name}</button>
                <span aria-hidden="true"> › </span>
              </span>
            ))}
          </div>
        )}
        <Area value={t.name} single rows={2} cls="h-name d-name" label="Task name" onCommit={(v) => v.trim() && tk.patch(t.id, { name: v.trim() })} />

        <div className="d-grid">
          <label className="fld">Type
            <SelectCell value={t.type} options={typesOf(S).map((x) => [x.id, x.label])} onCommit={(v) => tk.patch(t.id, { type: v })} />
          </label>
          <label className="fld">Parent
            <SelectCell value={t.parent || ''} options={parents} onCommit={(v) => tk.place(t.id, { parent: v })} />
          </label>
          {!back && (
            <label className="fld">Status
              {parent ? (
                <span className="c ro-field"><StatusIcon status={statusOf(S, t.status)} size={16} /> {statusOf(S, t.status).label} · {pc(t.pct, 0)}</span>
              ) : (
                <SelectCell value={t.status} options={statusesOf(S).map((s) => [s.id, s.label])} onCommit={(v) => tk.patch(t.id, { status: v })} />
              )}
            </label>
          )}
          <div className="fld">Assignees
            <div className="chips-a">
              {(t.assignees || []).map((id) => (
                <span key={id} className="chip-a">
                  <Avatar name={nameOf(S, id)} size={18} />{nameOf(S, id)}
                  <button className="x" onClick={() => tk.toggleAssignee(t.id, id)} aria-label={'Remove ' + nameOf(S, id)}>✕</button>
                </span>
              ))}
              <AssigneeMenu task={t} className="btn" label={(t.assignees || []).length ? '+' : '+ Add'} />
            </div>
          </div>
          <label className="fld">Priority
            <SelectCell value={t.priority} options={[['', 'None']].concat(PRIORITIES.map((p) => [p.id, p.label]))} onCommit={(v) => tk.patch(t.id, { priority: v })} />
          </label>
          <label className="fld">Effort (hours){effortRolled && <span className="msg"> · Σ from children</span>}
            {effortRolled ? <span className="c ro-field n">{hrsf(t.effort)}</span> : <Cell value={t.effort} type="num" min={0} cls="n" placeholder={milestone ? 'Milestones carry no effort' : '–'} disabled={milestone} onCommit={(v) => tk.patch(t.id, { effort: v })} />}
          </label>
          {!back && (
            <>
              <label className="fld">Start date{datesRolled && <span className="msg"> · Σ from children</span>}
                {datesRolled ? <span className="c ro-field">{t.start ? fdate(t.start) : '–'}</span> : <Cell value={t.start} type="date" onCommit={(v) => tk.patch(t.id, { start: v })} />}
              </label>
              <label className="fld">{milestone ? 'Date' : 'Due date'}{datesRolled && <span className="msg"> · Σ from children</span>}
                {datesRolled ? <span className="c ro-field">{t.due ? fdate(t.due) : '–'}</span> : <Cell value={t.due} type="date" onCommit={(v) => tk.patch(t.id, { due: v })} />}
              </label>
              {isDoneStatus(S, t.status) && !parent && (
                <label className="fld" title="Earned value counts this work in the week it was completed. If empty, the due date is used.">Completed on
                  <Cell value={t.doneOn || ''} type="date" onCommit={(v) => tk.patch(t.id, { doneOn: v || '' })} />
                </label>
              )}
            </>
          )}
          {back && <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Backlog items have no status or dates. Move this item to a sprint to schedule it.</p>}
          {parent && <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Hours, dates and status are calculated from its {kids.length} child item{kids.length === 1 ? '' : 's'}. Change them on the children.</p>}
          <label className="fld" style={{ gridColumn: '1 / -1' }}>Location
            <SelectCell value={f.c.id} options={place} onCommit={(v) => tk.move(t.id, v)} />
          </label>
        </div>

        <h3 className="d-h">Description</h3>
        <Area value={t.description} placeholder="Add details, acceptance criteria, links…" onCommit={(v) => tk.patch(t.id, { description: v })} label="Description" />

        <h3 className="d-h">Child items {kids.length > 0 && <span className="msg">{kids.filter((k) => isDoneStatus(S, k.status)).length}/{kids.length} done</span>}</h3>
        <div className="d-subs">
          {kids.map((k) => (
            <div key={k.id} className="d-kid">
              <TypeBadge type={typeOf(S, k.type)} size={16} />
              <button className="x d-kid-name" onClick={() => onOpen && onOpen(k.id)} title="Open">{k.name}</button>
              {!back && <StatusIcon status={statusOf(S, k.status)} size={15} />}
              {(k.assignees || []).length > 0 && <Avatar name={nameOf(S, k.assignees[0])} size={20} />}
              <span className="msg mono">{nz(k.effort) ? hrsf(k.effort) + ' h' : ''}</span>
              <button className="x" onClick={() => tk.moveUp(k.id)} aria-label="Move up">↑</button>
              <button className="x" onClick={() => tk.moveDown(k.id)} aria-label="Move down">↓</button>
            </div>
          ))}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select className="c" style={{ width: 'auto' }} value={subType || defaultSub} onChange={(e) => setSubType(e.target.value)} aria-label="Type of the new child item">
              {typesOf(S).map((x) => (<option key={x.id} value={x.id}>{x.label}</option>))}
            </select>
            <input className="c" value={sub} placeholder="Add a child item" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} aria-label="New child item" />
            <button className="btn" onClick={addSub}>Add</button>
          </div>
        </div>

        <h3 className="d-h">History</h3>
        <ul className="d-hist">
          {(S.activity || []).filter((e) => e.ref && e.ref.id === t.id).slice(-8).reverse().map((e) => (
            <li key={e.id}><span className="mono msg" title={new Date(e.at).toString()}>{dayLabel(e.at)} {clock(e.at)}</span> {e.text}</li>
          ))}
          {!(S.activity || []).some((e) => e.ref && e.ref.id === t.id) && <li className="msg">No recorded changes yet.</li>}
        </ul>

        <div style={{ marginTop: 20 }}>
          <button
            className="btn danger"
            onClick={() =>
              ui.ask({
                title: 'Delete work item?',
                body: `“${t.name}”${below.length > 1 ? ' and its ' + (below.length - 1) + ' child item' + (below.length > 2 ? 's' : '') : ''} will be permanently deleted.`,
                confirm: 'Delete',
                danger: true,
                onConfirm: () => {
                  tk.remove(t.id);
                  onClose();
                },
              })
            }
          >
            Delete work item
          </button>
        </div>
      </aside>
    </>
  );
}
