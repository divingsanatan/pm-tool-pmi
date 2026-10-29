import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import Menu from './Menu';
import { rollParts } from '../lib/hier';
import { fdate } from '../lib/dates';
import { hrsf } from '../lib/format';

/* A parent (a feature, an epic, any item with child items) shows what its child items add up to. It can also carry values of its own, on top:
     hours  = child hours + its own estimate
     dates  = the earliest start and the latest due date of the child items and of its own dates
   With no values of its own it simply shows the roll-up. These cells are that "Σ" figure; clicking one opens the box where the item's own
   values are entered, with the working shown (from the child items, own, total). */

// number box that saves when you press Enter, leave it, or close the box
function OwnNum({ value, onSave, label }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const live = useRef(v);
  const base = useRef(value == null ? '' : String(value));
  const save = () => {
    if (live.current !== base.current) {
      base.current = live.current;
      onSave(live.current === '' ? null : parseFloat(live.current));
    }
  };
  useEffect(() => save, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="c n"
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      value={v}
      placeholder="0"
      aria-label={label}
      onChange={(e) => { live.current = e.target.value; setV(e.target.value); }}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
    />
  );
}

function OwnDate({ value, onSave, label }) {
  return <input className="c" type="date" value={value || ''} aria-label={label} onChange={(e) => onSave(e.target.value)} />;
}

const range = (a, b) => (a || b ? (a ? fdate(a) : '–') + (b && b !== a ? ' – ' + fdate(b) : '') : '–');

export function OwnPanel({ task, c, kind }) {
  const tk = useTasks();
  const P = rollParts(null, c, task);
  const kidsTxt = P.kids + ' child item' + (P.kids === 1 ? '' : 's');
  if (kind === 'effort') {
    return (
      <div className="own-pop">
        <div className="own-h">Hours</div>
        <div className="own-r"><span>From {kidsTxt}</span><b className="mono">{hrsf(P.kidsEffort)} h</b></div>
        <label className="own-r"><span>Its own estimate</span><OwnNum value={task.ownEffort} label="Own estimate in hours" onSave={(v) => tk.patchOwn(task.id, { effort: v })} /></label>
        <div className="own-r own-t"><span>Total shown</span><b className="mono">{hrsf(task.effort)} h</b></div>
        <p className="own-n">Leave the estimate empty to show only what the child items add up to.</p>
      </div>
    );
  }
  return (
    <div className="own-pop">
      <div className="own-h">Dates</div>
      <div className="own-r"><span>From {kidsTxt}</span><b className="mono">{range(P.kidsStart, P.kidsDue)}</b></div>
      <label className="own-r"><span>Its own start</span><OwnDate value={task.ownStart} label="Own start date" onSave={(v) => tk.patchOwn(task.id, { start: v })} /></label>
      <label className="own-r"><span>Its own due</span><OwnDate value={task.ownDue} label="Own due date" onSave={(v) => tk.patchOwn(task.id, { due: v })} /></label>
      <div className="own-r own-t"><span>Total shown</span><b className="mono">{range(task.start, task.due)}</b></div>
      <p className="own-n">The start is the earliest and the due date the latest of the child items and its own dates. Clear a date to take it away.</p>
    </div>
  );
}

// The Σ cell of a parent in the List. kind: 'effort' | 'start' | 'due'
export function RollCell({ task, c, kind, late }) {
  const hasOwn = kind === 'effort' ? task.ownEffort != null && task.ownEffort > 0 : kind === 'start' ? !!(task.ownStart || task.ownDue) : !!(task.ownDue || task.ownStart);
  const text = kind === 'effort' ? 'Σ ' + hrsf(task.effort) : 'Σ ' + (task[kind] ? fdate(task[kind]) : '–');
  const what = kind === 'effort' ? 'hours' : 'dates';
  return (
    <Menu
      className={'cell roll own-btn' + (kind === 'effort' ? ' n' : '') + (late ? ' od' : '')}
      label={<>{text}{hasOwn && <i className="own-dot" aria-hidden="true">+own</i>}</>}
      title={'Added up from the child items' + (hasOwn ? ' and its own ' + what : '') + '. Click to add values of its own.'}
      items={[]}
      wide
      footer={<OwnPanel task={task} c={c} kind={kind === 'effort' ? 'effort' : 'dates'} />}
    />
  );
}
