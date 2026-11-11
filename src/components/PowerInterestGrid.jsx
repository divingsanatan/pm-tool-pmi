import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Avatar } from './Bits';
import { allContainers } from '../lib/tasks';
import { QUADRANTS, SCORES, gridInsights, isPlaced, quadrantOf, scoreOf } from '../lib/stakeholderGrid';
import '../pg.css';

const QBY = Object.fromEntries(QUADRANTS.map((q) => [q.id, q]));
const ROWS = [5, 4, 3, 2, 1]; // power, top to bottom
const MAX_IN_CELL = 3;

// Power / interest grid built from the stakeholder list. Power runs up the side, interest along the bottom.
// Drag a stakeholder to a new box (or use the arrow keys / the score buttons) to change their scores.
export default function PowerInterestGrid() {
  const { S, update } = useStore();
  const tasks = useMemo(() => allContainers(S).flatMap((c) => c.tasks), [S]);
  const I = useMemo(() => gridInsights(S, tasks), [S, tasks]);
  const [sel, setSel] = useState(null); // person id
  const [cell, setCell] = useState(null); // [power, interest] when a crowded box was opened
  const [focus, setFocus] = useState(''); // quadrant id used as a highlight filter
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState(null);
  const board = useRef(null);
  const dragRef = useRef(null);

  const people = S.people;
  const selP = people.find((p) => p.id === sel) || null;
  useEffect(() => { if (sel && !selP) setSel(null); }, [sel, selP]);

  const lit = (p) => {
    if (q.trim() && !((p.name || '') + ' ' + (p.role || '')).toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (focus) return !!isPlaced(p) && quadrantOf(p).id === focus;
    return true;
  };
  const setPos = (id, power, interest) => update((s) => { const x = s.people.find((y) => y.id === id); if (x) { x.power = power; x.interest = interest; } });
  const setScore = (id, field, v) => update((s) => { const x = s.people.find((y) => y.id === id); if (x) x[field] = v; });
  const unplace = (id) => update((s) => { const x = s.people.find((y) => y.id === id); if (x) { delete x.power; delete x.interest; } });

  const cellAt = (x, y) => {
    const el = board.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return [5 - Math.min(4, Math.floor(((y - r.top) / r.height) * 5)), Math.min(5, Math.floor(((x - r.left) / r.width) * 5) + 1)];
  };
  const down = (e, id) => {
    if (e.button !== undefined && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: dragging still works inside the element */ }
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    d.moved = true;
    setDrag({ id: d.id, x: e.clientX, y: e.clientY, cell: cellAt(e.clientX, e.clientY) });
  };
  const up = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      const c = cellAt(e.clientX, e.clientY);
      setDrag(null);
      if (c) setPos(d.id, c[0], c[1]);
      setSel(d.id);
      setCell(null);
    } else {
      setSel((cur) => (cur === d.id ? null : d.id));
      setCell(null);
    }
  };
  const cancel = () => { dragRef.current = null; setDrag(null); };
  const keys = (e, p) => {
    if (!isPlaced(p)) return;
    const pw = scoreOf(p.power), it = scoreOf(p.interest);
    const d = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    setPos(p.id, Math.max(1, Math.min(5, pw + d[0])), Math.max(1, Math.min(5, it + d[1])));
    setSel(p.id);
  };

  // a plain function (not a component) so the dragged button is never remounted while it is being dragged
  const person = (p, small) => (
    <button
      key={p.id}
      type="button"
      className={'pg-av' + (sel === p.id ? ' sel' : '') + (lit(p) ? '' : ' dim') + (drag && drag.id === p.id ? ' lift' : '') + (small ? ' sm' : '')}
      onPointerDown={(e) => down(e, p.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
      onClick={(e) => { if (e.detail === 0) { setSel((cur) => (cur === p.id ? null : p.id)); setCell(null); } }}
      onKeyDown={(e) => keys(e, p)}
      aria-pressed={sel === p.id}
      aria-label={p.name + (isPlaced(p) ? ', power ' + scoreOf(p.power) + ', interest ' + scoreOf(p.interest) + '. Use arrow keys to move.' : ', not placed on the grid')}
      title={p.name + (isPlaced(p) ? ' · power ' + scoreOf(p.power) + ', interest ' + scoreOf(p.interest) : ' · drag onto the grid')}
    >
      <Avatar name={p.name || '?'} size={30} />
    </button>
  );

  const total = people.length;
  const mix = QUADRANTS.map((qd) => ({ qd, n: I.by[qd.id].length }));
  const drop = drag && drag.cell;
  const cellPeople = cell ? people.filter((p) => isPlaced(p) && scoreOf(p.power) === cell[0] && scoreOf(p.interest) === cell[1]) : [];

  if (!total) {
    return (
      <div className="card pg">
        <h2>Power / interest grid</h2>
        <p className="msg">Add stakeholders above to build the grid.</p>
      </div>
    );
  }

  return (
    <div className="card pg">
      <div className="pg-head">
        <div>
          <h2>Power / interest grid</h2>
          <p className="hint">Where each stakeholder sits by how much power they have over the project and how interested they are in it (scores 1 to 5; 4 and 5 count as high). <b>Drag</b> a person to another box, or select them and use the score buttons, to change their scores.</p>
        </div>
      </div>

      <div className="pg-cards" aria-label="Stakeholder insights">
        <section className="pg-ic">
          <div className="l">On the grid</div>
          <div className="v">{I.placed.length}<small> / {total}</small></div>
          <div className="pg-prog" role="img" aria-label={I.placed.length + ' of ' + total + ' stakeholders placed'}><i style={{ width: (total ? (I.placed.length / total) * 100 : 0) + '%' }} /></div>
          <div className="s">{I.loose.length ? I.loose.length + ' still need power and interest scores' : 'Everyone is placed.'}</div>
        </section>

        <section className="pg-ic">
          <div className="l">Engagement mix</div>
          <div className="pg-mix" role="img" aria-label={mix.map((m) => m.qd.label + ' ' + m.n).join(', ')}>
            {I.placed.length ? mix.filter((m) => m.n).map((m) => (<i key={m.qd.id} className={'q-' + m.qd.id} style={{ flexGrow: m.n }} title={m.qd.label + ': ' + m.n} />)) : <i className="none" style={{ flexGrow: 1 }} />}
          </div>
          <ul className="pg-leg">
            {mix.map((m) => (<li key={m.qd.id} className={'q-' + m.qd.id}><i />{m.qd.label}<b>{m.n}</b></li>))}
          </ul>
        </section>

        <section className="pg-ic">
          <div className="l">Manage closely</div>
          <div className={'v ' + (I.by.closely.length ? '' : 'mute')}>{I.by.closely.length}</div>
          {I.by.closely.length ? (
            <>
              <div className="av-stack" style={{ margin: '2px 0 4px' }}>{I.by.closely.slice(0, 5).map((p) => (<Avatar key={p.id} name={p.name} size={26} />))}{I.by.closely.length > 5 && <span className="av more" style={{ width: 26, height: 26, fontSize: 11 }}>+{I.by.closely.length - 5}</span>}</div>
              <div className="s">High power and high interest. Your key relationships.</div>
            </>
          ) : <div className="s">Nobody has both high power and high interest yet.</div>}
        </section>

        <section className="pg-ic">
          <div className="l">Risk watch</div>
          <div className={'v ' + (I.by.satisfied.length ? 'warn' : 'good')}>{I.by.satisfied.length}</div>
          <div className="s">{I.by.satisfied.length ? 'High-power stakeholders with low interest: ' + I.by.satisfied.slice(0, 2).map((p) => p.name).join(', ') + (I.by.satisfied.length > 2 ? ' +' + (I.by.satisfied.length - 2) : '') + '. Keep them satisfied so they do not turn against the project.' : 'No powerful stakeholder is disengaged.'}</div>
        </section>

        <section className="pg-ic">
          <div className="l">Involvement gap</div>
          <div className={'v ' + (I.gap.length ? 'bad' : 'good')}>{I.hasTasks ? I.gap.length : '–'}</div>
          <div className="s">
            {!I.hasTasks ? 'Add work items to compare with the RACI chart.' : I.gap.length ? 'High-power stakeholders with no RACI role on any work item: ' + I.gap.slice(0, 2).map((p) => p.name).join(', ') + (I.gap.length > 2 ? ' +' + (I.gap.length - 2) : '') + '.' : 'Every high-power stakeholder has a role in the RACI chart.'}
          </div>
        </section>
      </div>

      <div className="pg-bar">
        <div className="pg-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a stakeholder" aria-label="Find a stakeholder" /></div>
        <div className="chips" role="group" aria-label="Highlight a box">
          <button type="button" className="chip" aria-pressed={!focus} onClick={() => setFocus('')}>All<span className="pg-n">{total}</span></button>
          {mix.map((m) => (<button key={m.qd.id} type="button" className={'chip pg-chip q-' + m.qd.id} aria-pressed={focus === m.qd.id} onClick={() => setFocus(focus === m.qd.id ? '' : m.qd.id)}>{m.qd.label}<span className="pg-n">{m.n}</span></button>))}
        </div>
      </div>

      <div className="pg-main">
        <div className="pg-plot">
          <div className="pg-yaxis" aria-hidden="true">
            <span className="pg-ylabel">Power</span>
            <div className="pg-yticks">{ROWS.map((n) => (<span key={n}>{n}</span>))}</div>
          </div>
          <div className="pg-stage">
            <div className="pg-board" ref={board} role="group" aria-label={'Power and interest grid with ' + I.placed.length + ' stakeholder' + (I.placed.length === 1 ? '' : 's')}>
              {QUADRANTS.map((qd) => (
                <div key={qd.id} className={'pg-q q-' + qd.id + (focus && focus !== qd.id ? ' off' : '')}>
                  <span className="pg-qt">{qd.label}<b>{I.by[qd.id].length}</b></span>
                </div>
              ))}
              {ROWS.map((power) => [1, 2, 3, 4, 5].map((interest) => {
                const here = I.placed.filter((p) => scoreOf(p.power) === power && scoreOf(p.interest) === interest);
                const shownHere = here.length > MAX_IN_CELL ? here.slice(0, MAX_IN_CELL - 1) : here;
                const more = here.length - shownHere.length;
                return (
                  <div key={power + '-' + interest} className={'pg-cell' + (drop && drop[0] === power && drop[1] === interest ? ' drop' : '') + (cell && cell[0] === power && cell[1] === interest ? ' open' : '')} style={{ gridRow: 6 - power, gridColumn: interest }}>
                    <div className="pg-stack">
                      {shownHere.map((p) => person(p))}
                      {more > 0 && <button type="button" className="pg-more" onClick={() => { setCell([power, interest]); setSel(null); }} aria-label={more + ' more stakeholders in this box. Show all.'}>+{more}</button>}
                    </div>
                  </div>
                );
              }))}
            </div>
            <div className="pg-xaxis" aria-hidden="true">
              <div className="pg-xticks">{SCORES.map((n) => (<span key={n}>{n}</span>))}</div>
              <span className="pg-xlabel">Interest</span>
            </div>
          </div>
        </div>

        <div className="pg-side">
          {selP ? (
            <Detail p={selP} I={I} onScore={setScore} onUnplace={unplace} onClose={() => setSel(null)} />
          ) : cell ? (
            <div className="pg-detail">
              <div className="row sp"><b>Power {cell[0]} · interest {cell[1]}</b><button className="x" onClick={() => setCell(null)} aria-label="Close">✕</button></div>
              <div className="pg-plist">{cellPeople.map((p) => (<button key={p.id} type="button" className="pg-prow" onClick={() => { setSel(p.id); setCell(null); }}><Avatar name={p.name} size={24} /><span>{p.name}</span>{p.role ? <span className="msg">{p.role}</span> : null}</button>))}</div>
            </div>
          ) : (
            <div className="pg-tip"><b>Tip.</b> Select a stakeholder to see how to engage them and what role they play in the RACI chart. Arrow keys move the selected person one box at a time.</div>
          )}

          <div className="pg-quads">
            {QUADRANTS.map((qd) => {
              const who = I.by[qd.id];
              return (
                <div key={qd.id} className={'pg-qc q-' + qd.id + (focus && focus !== qd.id ? ' off' : '')}>
                  <div className="pg-qh"><b>{qd.label}</b><span className="pg-qn">{who.length}</span></div>
                  <span className="msg">{qd.power === 'high' ? 'High' : 'Low'} power · {qd.interest === 'high' ? 'high' : 'low'} interest</span>
                  <p className="pg-how">{qd.how}</p>
                  <div className="pg-meta"><span>Suggested: {qd.cadence}</span><span>Typical RACI: <b>{qd.raci}</b></span></div>
                  <div className="pg-who">
                    {who.length ? who.map((p) => (<button key={p.id} type="button" className={'pg-p' + (sel === p.id ? ' sel' : '') + (lit(p) ? '' : ' dim')} onClick={() => { setSel(p.id); setCell(null); }}><Avatar name={p.name || '?'} size={20} />{p.name}</button>)) : <span className="msg">Nobody here yet</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {I.loose.length > 0 && (
        <div className="pg-tray">
          <div className="pg-tray-h"><b>Not on the grid yet</b><span className="msg">Drag a person onto the grid, or select them and set both scores.</span></div>
          <div className="pg-tray-l">
            {I.loose.map((p) => (
              <span key={p.id} className={'pg-tp' + (sel === p.id ? ' sel' : '') + (lit(p) ? '' : ' dim')}>{person(p, true)}<span>{p.name}</span></span>
            ))}
          </div>
        </div>
      )}

      {drag && (() => { const p = people.find((x) => x.id === drag.id); return p ? <div className="pg-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true"><Avatar name={p.name} size={38} /></div> : null; })()}
    </div>
  );
}

function ScoreRow({ label, value, onPick }) {
  return (
    <div className="pg-score">
      <span>{label}</span>
      <div className="rx-seg pg-seg" role="group" aria-label={label}>
        {SCORES.map((n) => (<button key={n} type="button" className="rx-rb" aria-pressed={value === n} onClick={() => onPick(n)}>{n}</button>))}
      </div>
      <span className={'pg-lvl ' + (value >= 4 ? 'hi' : '')}>{value ? (value >= 4 ? 'High' : 'Low') : ''}</span>
    </div>
  );
}

function Detail({ p, I, onScore, onUnplace, onClose }) {
  const qd = quadrantOf(p);
  const r = I.rolesOf(p.id);
  return (
    <div className={'pg-detail' + (qd ? ' q-' + qd.id : '')}>
      <div className="pg-dh">
        <Avatar name={p.name} size={42} />
        <div className="pg-dn"><b>{p.name}</b>{p.role ? <span className="msg">{p.role}</span> : null}</div>
        <button className="x" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      {qd ? <span className={'pg-badge q-' + qd.id}>{qd.label}</span> : <span className="pg-badge none">Not placed yet. Set both scores.</span>}
      <ScoreRow label="Power" value={scoreOf(p.power)} onPick={(n) => onScore(p.id, 'power', n)} />
      <ScoreRow label="Interest" value={scoreOf(p.interest)} onPick={(n) => onScore(p.id, 'interest', n)} />
      {qd && (
        <>
          <p className="pg-how">{qd.how}</p>
          <div className="pg-meta"><span>Suggested: {qd.cadence}</span></div>
        </>
      )}
      <div className="pg-roles" aria-label="RACI roles of this stakeholder">
        {['A', 'R', 'C', 'I'].map((k) => (<span key={k}><b className={'r-' + k}>{k}</b>{r[k]}</span>))}
        <span className="msg">{r.total ? 'roles across work items' : I.hasTasks ? 'no RACI role yet' : ''}</span>
      </div>
      {qd && qd.id !== 'monitor' && qd.id !== 'informed' && I.hasTasks && r.total === 0 && <p className="pg-warn">High power but no role in the RACI chart. Consider making them Consulted or Informed.</p>}
      {qd && <button type="button" className="btn pg-clear" onClick={() => onUnplace(p.id)}>Remove from grid</button>}
    </div>
  );
}
