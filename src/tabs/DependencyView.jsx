import { useState } from 'react';
import Kpi from '../components/Kpi';
import { AddDependency, DepRow, useDepIndex } from '../components/Dependencies';
import { isBlocked } from '../lib/deps';

const FILTERS = [
  ['all', 'All'],
  ['open', 'Not satisfied'],
  ['conflict', 'Conflicts'],
  ['cross', 'Across sprints'],
  ['ext', 'External'],
  ['met', 'Satisfied'],
];

// All dependencies that start or end in this sprint: what it waits on and what it holds up in other sprints.
export default function DependencyView({ c, onOpen }) {
  const idx = useDepIndex();
  const [f, setF] = useState('open');
  const mine = idx.all.filter((e) => e.sc.id === c.id || (e.pc && e.pc.id === c.id));
  const count = (k) => mine.filter((e) => match(e, k)).length;
  const rows = mine.filter((e) => match(e, f)).sort((a, b) => rank(a) - rank(b));
  const blocked = c.tasks.filter((t) => isBlocked(idx, t.id)).length;
  const holding = new Set(mine.filter((e) => e.pc && e.pc.id === c.id && e.sc.id !== c.id && !e.ev.met).map((e) => e.pred.id)).size;
  return (
    <>
      <section className="kpis">
        <Kpi l="Dependencies" v={mine.length} s={count('met') + ' satisfied · ' + count('open') + ' open'} />
        <Kpi l="Blocked work items" v={blocked} s={blocked ? <span className="pill warn">Waiting on predecessors</span> : <span className="pill good">None blocked</span>} />
        <Kpi l="Conflicts" v={count('conflict')} s={count('conflict') ? <span className="pill bad">Schedule or logic broken</span> : <span className="pill good">Schedule respects them</span>} />
        <Kpi l="Across sprints" v={count('cross')} s={holding ? holding + ' item' + (holding === 1 ? '' : 's') + ' here hold up other sprints' : 'Nothing here holds up another sprint'} />
        <Kpi l="External, open" v={mine.filter((e) => !e.pred && !e.ev.met).length} s="Waiting on people outside the project" />
      </section>
      <div className="card">
        <div className="row sp" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Dependencies</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>A work item waits on another (or on someone outside the project). Each one is logged in the RAID log automatically, and closes there when it is satisfied. You can also add them from a work item&apos;s details or the Dependencies column in the List.</p>
          </div>
          <AddDependency />
        </div>
        <div className="chips" role="group" aria-label="Filter dependencies" style={{ margin: '12px 0' }}>
          {FILTERS.map(([k, l]) => (<button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{l}<span className="cnt">{count(k)}</span></button>))}
        </div>
        <div className="dv-list">
          {rows.map((e) => (
            <div key={e.dep.id} className="dv-pair">
              <div className="dv-arrow"><button type="button" className="linkbtn" onClick={() => onOpen(e.succ.id)}><span className="mono">{e.succ.code}</span> {e.succ.name}</button> <span className="msg">({e.sc.name})</span> waits on</div>
              <DepRow e={e} side="succ" onOpen={onOpen} />
            </div>
          ))}
          {!rows.length && <p className="msg" style={{ margin: 0 }}>{mine.length ? 'No dependencies match this filter.' : 'No dependencies yet. Use “Add dependency”, or the Dependencies column in the List.'}</p>}
        </div>
      </div>
    </>
  );
}

function match(e, k) {
  if (k === 'open') return !e.ev.met;
  if (k === 'conflict') return e.ev.state === 'conflict';
  if (k === 'cross') return e.cross;
  if (k === 'ext') return !e.pred;
  if (k === 'met') return e.ev.met;
  return true;
}
const rank = (e) => ({ conflict: 0, waiting: 1, external: 2, met: 3 }[e.ev.state] ?? 4);
