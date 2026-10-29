import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { AvatarStack, Flag, StatusIcon, TypeBadge } from '../components/Bits';
import { TagChip } from '../components/Pickers';
import { findTask, isDoneStatus, nameOf, statusesOf, typeOf } from '../lib/tasks';
import { fdate, today } from '../lib/dates';

function Card({ t, onOpen }) {
  const { S } = useStore();
  const done = isDoneStatus(S, t.status);
  const late = !done && t.due && t.due < today();
  const up = t.parent ? findTask(S, t.parent) : null;
  return (
    <div
      className="kcard"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(t.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
    >
      {up && <div className="msg k-up" title="Parent work item">↳ {up.t.name}</div>}
      <div className={'k-title' + (done ? ' done' : '')}><TypeBadge type={typeOf(S, t.type)} size={15} /> {t.name}</div>
      {(t.tags || []).length > 0 && <div className="tags" style={{ flexWrap: 'wrap', margin: '4px 0' }}>{t.tags.map((g) => (<TagChip key={g} tag={g} />))}</div>}
      <div className="row k-meta">
        <AvatarStack names={(t.assignees || []).map((id) => nameOf(S, id))} size={20} />
        <Flag priority={t.priority} size={14} />
        {t.due && <span className={'msg' + (late ? ' lateTxt' : '')}>{fdate(t.due)}</span>}
        {t.effort ? <span className="msg mono">{t.effort}h</span> : null}
      </div>
    </div>
  );
}

function Column({ s, tasks, onOpen, onAdd }) {
  const tk = useTasks();
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState('');
  return (
    <div
      className={'kcol' + (over ? ' over' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) tk.setStatus(id, s.id);
      }}
    >
      <div className="k-hd"><StatusIcon status={s} size={16} /><b>{s.label}</b><span className="msg">{tasks.length}</span></div>
      {tasks.map((t) => (<Card key={t.id} t={t} onOpen={onOpen} />))}
      {adding ? (
        <input
          className="c"
          autoFocus
          value={v}
          placeholder="Task name, then Enter"
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            if (v.trim()) onAdd(s.id, v.trim());
            setV('');
            setAdding(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (v.trim()) onAdd(s.id, v.trim());
              setV('');
            }
            if (e.key === 'Escape') {
              setV('');
              setAdding(false);
            }
          }}
          aria-label="New task name"
        />
      ) : (
        <button className="add-row" onClick={() => setAdding(true)}>+ Add task</button>
      )}
    </div>
  );
}

export default function Board({ tasks, onOpen, onAdd }) {
  const { S } = useStore();
  const sts = statusesOf(S);
  return (
    <div className="scroll">
      <div className="kanban" style={{ '--cols': sts.length }}>
        {sts.map((s) => (
          <Column key={s.id} s={s} tasks={tasks.filter((t) => t.status === s.id)} onOpen={onOpen} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}
