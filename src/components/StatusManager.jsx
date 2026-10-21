import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell } from './Field';
import Menu from './Menu';
import { StatusIcon } from './Bits';
import { STATUS_COLORS, allContainers, statusesOf, uid } from '../lib/tasks';

// Add, rename, recolour, reorder and delete the task statuses of the current project
export default function StatusManager() {
  const { S, update } = useStore();
  const [armed, setArmed] = useState(null);
  const sts = statusesOf(S);
  const counts = {};
  allContainers(S).forEach((c) => c.tasks.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; }));
  const nDone = sts.filter((x) => x.done).length;
  const nOpen = sts.length - nDone;

  const patch = (i, pt) => update((p) => void Object.assign(p.statuses[i], pt));
  const move = (i, d) =>
    update((p) => {
      const j = i + d;
      if (j < 0 || j >= p.statuses.length) return;
      const [x] = p.statuses.splice(i, 1);
      p.statuses.splice(j, 0, x);
    });
  const add = () =>
    update((p) => {
      const at = p.statuses.findIndex((x) => x.done); // new statuses go before the finished ones
      const st = { id: uid(), label: 'New status', color: STATUS_COLORS[p.statuses.length % STATUS_COLORS.length][0], pct: 0.5, done: false };
      p.statuses.splice(at < 0 ? p.statuses.length : at, 0, st);
    });
  const remove = (i) =>
    update((p) => {
      const gone = p.statuses[i];
      const rest = p.statuses.filter((_, k) => k !== i);
      const target = rest.find((x) => x.done === gone.done) || rest[0];
      allContainers(p).forEach((c) => c.tasks.forEach((t) => { if (t.status === gone.id) t.status = target.id; }));
      p.statuses = rest;
    });

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Statuses belong to this project. A <b>finished</b> status counts as done work: those tasks leave the “unfinished” lists and count as 100%.
        For the others, <b>Counts as</b> says how complete a task is while it sits in that status. The Dashboard and Timeline use it.
      </p>
      <div className="stm">
        {sts.map((st, i) => {
          const n = counts[st.id] || 0;
          const lastOfKind = st.done ? nDone <= 1 : nOpen <= 1;
          return (
            <div key={st.id} className="stm-row">
              <Menu
                className="x st-btn"
                label={<StatusIcon status={st} size={22} />}
                title="Color"
                items={STATUS_COLORS.map(([c, nm]) => ({ label: (<span className="sm-item"><i className="dot" style={{ background: c }} />{nm}</span>), active: st.color === c, onClick: () => patch(i, { color: c }) }))}
              />
              <Cell value={st.label} cls="stm-name" label="Status name" onCommit={(v) => v.trim() && patch(i, { label: v.trim() })} />
              <label className="stm-chk" title={lastOfKind && st.done ? 'You need at least one finished status' : 'Counts as finished work'}>
                <input type="checkbox" checked={st.done} disabled={st.done ? nDone <= 1 : nOpen <= 1} onChange={(e) => patch(i, { done: e.target.checked, pct: e.target.checked ? 1 : 0.5 })} aria-label={st.label + ' is a finished status'} />
                Finished
              </label>
              <label className="stm-pct">Counts as
                <Cell value={st.done ? 1 : st.pct} type="pct" cls="n w-sm" disabled={st.done} label={st.label + ' percent complete'} onCommit={(v) => patch(i, { pct: v == null ? 0 : Math.max(0, Math.min(0.99, v)) })} />%
              </label>
              <span className="msg stm-n" title="Tasks in this status">{n} task{n === 1 ? '' : 's'}</span>
              <span className="stm-act">
                <button className="x" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="x" onClick={() => move(i, 1)} disabled={i === sts.length - 1} aria-label="Move down">↓</button>
                <button
                  className={'x' + (armed === st.id ? ' armed' : '')}
                  disabled={lastOfKind}
                  title={lastOfKind ? 'Keep at least one open and one finished status' : n ? 'Its tasks move to another status' : 'Delete status'}
                  aria-label="Delete status"
                  onClick={() => (n && armed !== st.id ? setArmed(st.id) : (setArmed(null), remove(i)))}
                  onBlur={() => setArmed(null)}
                >
                  {armed === st.id ? `Move ${n} & delete` : '✕'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={add}>+ Add status</button>
      </div>
    </div>
  );
}
