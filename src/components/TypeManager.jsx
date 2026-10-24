import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell } from './Field';
import Menu from './Menu';
import { TypeBadge } from './Bits';
import { DEFAULT_TYPES, TYPE_COLORS, allContainers, typesOf, uid } from '../lib/tasks';

// Add, rename, recolour, reorder and delete the work item types of the current project
export default function TypeManager() {
  const { S, update } = useStore();
  const [armed, setArmed] = useState(null);
  const types = typesOf(S);
  const counts = {};
  allContainers(S).forEach((c) => c.tasks.forEach((t) => { counts[t.type] = (counts[t.type] || 0) + 1; }));
  const missing = DEFAULT_TYPES.filter((d) => !types.some((t) => t.id === d.id));

  const patch = (i, pt) => update((p) => void Object.assign(p.types[i], pt));
  const move = (i, d) =>
    update((p) => {
      const j = i + d;
      if (j < 0 || j >= p.types.length) return;
      const [x] = p.types.splice(i, 1);
      p.types.splice(j, 0, x);
    });
  const add = () =>
    update((p) => {
      p.types.push({ id: uid(), label: 'New type', color: TYPE_COLORS[p.types.length % TYPE_COLORS.length][0], icon: 'N', milestone: false, raci: true });
    });
  const restore = () =>
    update((p) => {
      DEFAULT_TYPES.forEach((d) => {
        if (!p.types.some((t) => t.id === d.id)) p.types.push({ ...d });
      });
    });
  const remove = (i) =>
    update((p) => {
      const gone = p.types[i];
      const rest = p.types.filter((_, k) => k !== i);
      const target = rest.find((x) => x.id === 'task') || rest[0];
      allContainers(p).forEach((c) => c.tasks.forEach((t) => { if (t.type === gone.id) t.type = target.id; }));
      p.types = rest;
    });

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Types describe what a work item is: an Epic breaks down into Features and Stories, those into Tasks and Subtasks. Add your own for anything else.
        A <b>milestone</b> is a point in time: it carries no effort and is left out of earned value. <b>Needs RACI</b> controls whether the RACI check expects an Accountable and a Responsible for items of that type.
        Hours, dates and progress of a parent always roll up from its children, whatever the type.
      </p>
      <div className="stm">
        {types.map((ty, i) => {
          const n = counts[ty.id] || 0;
          const last = types.length <= 1;
          return (
            <div key={ty.id} className="stm-row">
              <Menu
                className="x st-btn"
                label={<TypeBadge type={ty} size={24} />}
                title="Color"
                items={TYPE_COLORS.map(([c, nm]) => ({ label: (<span className="sm-item"><i className="dot" style={{ background: c }} />{nm}</span>), active: ty.color === c, onClick: () => patch(i, { color: c }) }))}
              />
              <Cell value={ty.icon} cls="n w-sm" label={ty.label + ' icon'} onCommit={(v) => patch(i, { icon: (v || '').trim().slice(0, 2) || ty.label.charAt(0).toUpperCase() })} />
              <Cell value={ty.label} cls="stm-name" label="Type name" onCommit={(v) => v.trim() && patch(i, { label: v.trim() })} />
              <label className="stm-chk" title="A point in time: no effort, not counted in earned value">
                <input type="checkbox" checked={!!ty.milestone} onChange={(e) => patch(i, { milestone: e.target.checked, icon: e.target.checked && !ty.icon ? '◆' : ty.icon })} aria-label={ty.label + ' is a milestone'} />
                Milestone
              </label>
              <label className="stm-chk" title="The RACI check expects one Accountable and one Responsible">
                <input type="checkbox" checked={ty.raci !== false} onChange={(e) => patch(i, { raci: e.target.checked })} aria-label={ty.label + ' needs RACI'} />
                Needs RACI
              </label>
              <span className="msg stm-n" title="Work items of this type">{n} item{n === 1 ? '' : 's'}</span>
              <span className="stm-act">
                <button className="x" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="x" onClick={() => move(i, 1)} disabled={i === types.length - 1} aria-label="Move down">↓</button>
                <button
                  className={'x' + (armed === ty.id ? ' armed' : '')}
                  disabled={last}
                  title={last ? 'Keep at least one type' : n ? 'Its items become Tasks' : 'Delete type'}
                  aria-label="Delete type"
                  onClick={() => (n && armed !== ty.id ? setArmed(ty.id) : (setArmed(null), remove(i)))}
                  onBlur={() => setArmed(null)}
                >
                  {armed === ty.id ? `Move ${n} & delete` : '✕'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={add}>+ Add type</button>
        {missing.length > 0 && <button className="btn" onClick={restore} title={missing.map((m) => m.label).join(', ')}>Restore standard types</button>}
      </div>
    </div>
  );
}
