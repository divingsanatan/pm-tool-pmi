import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from '../components/UI';
import { Area, Cell, SelectCell } from '../components/Field';
import { Avatar } from '../components/Bits';
import { AssigneeMenu } from '../components/Pickers';
import { PRIORITIES, allContainers, findTask, nameOf, statusesOf } from '../lib/tasks';

export default function TaskDrawer({ taskId, onClose }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const [sub, setSub] = useState('');
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
  const place = allContainers(S).map((c) => [c.id, c.name]);
  const addSub = () => {
    const n = sub.trim();
    if (n) tk.addSub(t.id, n);
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
        <Area value={t.name} single rows={2} cls="h-name d-name" label="Task name" onCommit={(v) => v.trim() && tk.patch(t.id, { name: v.trim() })} />

        <div className="d-grid">
          {f.c.id !== 'backlog' && (
            <label className="fld">Status
              <SelectCell value={t.status} options={statusesOf(S).map((s) => [s.id, s.label])} onCommit={(v) => tk.patch(t.id, { status: v })} />
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
          <label className="fld">Effort (hours)
            <Cell value={t.effort} type="num" cls="n" placeholder="–" onCommit={(v) => tk.patch(t.id, { effort: v })} />
          </label>
          {f.c.id !== 'backlog' && (
            <>
          <label className="fld">Start date
            <Cell value={t.start} type="date" onCommit={(v) => tk.patch(t.id, { start: v })} />
          </label>
          <label className="fld">Due date
            <Cell value={t.due} type="date" onCommit={(v) => tk.patch(t.id, { due: v })} />
          </label>
            </>
          )}
          {f.c.id === 'backlog' && <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Backlog items have no status or dates. Move this item to a sprint to schedule it.</p>}
          <label className="fld" style={{ gridColumn: '1 / -1' }}>Location
            <SelectCell value={f.c.id} options={place} onCommit={(v) => tk.move(t.id, v)} />
          </label>
        </div>

        <h3 className="d-h">Description</h3>
        <Area value={t.description} placeholder="Add details, acceptance criteria, links…" onCommit={(v) => tk.patch(t.id, { description: v })} label="Description" />

        <h3 className="d-h">Subtasks {t.subtasks.length > 0 && <span className="msg">{t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}</span>}</h3>
        <div className="d-subs">
          {t.subtasks.map((s) => (
            <div key={s.id} className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input type="checkbox" checked={s.done} onChange={(e) => tk.patchSub(t.id, s.id, { done: e.target.checked })} aria-label="Subtask done" />
              <Cell value={s.name} cls={s.done ? 'strike' : ''} label="Subtask name" onCommit={(v) => v && tk.patchSub(t.id, s.id, { name: v })} />
              {s.person && <Avatar name={nameOf(S, s.person)} size={20} />}
              <button className="x" onClick={() => tk.removeSub(t.id, s.id)} aria-label="Delete subtask">✕</button>
            </div>
          ))}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="c" value={sub} placeholder="Add a subtask" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} aria-label="New subtask" />
            <button className="btn" onClick={addSub}>Add</button>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <button
            className="btn danger"
            onClick={() =>
              ui.ask({
                title: 'Delete task?',
                body: `“${t.name}” and its subtasks will be permanently deleted.`,
                confirm: 'Delete task',
                danger: true,
                onConfirm: () => {
                  tk.remove(t.id);
                  onClose();
                },
              })
            }
          >
            Delete task
          </button>
        </div>
      </aside>
    </>
  );
}
