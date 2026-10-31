import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useDeps } from '../store/useDeps';
import { Cell } from './Field';
import Menu from './Menu';
import { NATURE, REL, REL_IDS, STATE, depIndex, depLocked, hasBaseline, raidJump } from '../lib/deps';
import { allContainers } from '../lib/tasks';
import { fdate } from '../lib/dates';
import '../deps.css';

// the project's dependencies, recalculated whenever the project changes
export function useDepIndex() {
  const { S } = useStore();
  return useMemo(() => depIndex(S), [S]);
}

export const StatePill = ({ e }) => <span className={'pill ' + STATE[e.ev.state].cls} title={e.ev.text}>{STATE[e.ev.state].label}</span>;

// Work items of every sprint and the Backlog, grouped by sprint, filtered by what is typed in the box
function ItemSelect({ S, value, onChange, exclude = [], label }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const groups = allContainers(S)
    .map((c) => ({ c, list: c.tasks.filter((t) => !exclude.includes(t.id) && (!ql || (t.code + ' ' + t.name).toLowerCase().includes(ql) || t.id === value)) }))
    .filter((g) => g.list.length);
  return (
    <div className="dp-pick">
      <input className="c" type="search" value={q} placeholder="Search work items" onChange={(e) => setQ(e.target.value)} aria-label={'Search ' + label} />
      <select className="c" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Pick a work item…</option>
        {groups.map((g) => (
          <optgroup key={g.c.id} label={g.c.name}>
            {g.list.map((t) => (<option key={t.id} value={t.id}>{t.code} · {t.name}</option>))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/* The "link a dependency" form.
   task + side:  'succ' = this work item WAITS on the one you pick;  'pred' = this work item BLOCKS the one you pick.
   No task: both ends are picked (used on the sprint's Dependencies view). */
export function AddDependency({ task, side = 'succ', onDone, startOpen = false }) {
  const { S } = useStore();
  const dp = useDeps();
  const [open, setOpen] = useState(startOpen);
  const [f, setF] = useState({ other: '', second: '', ext: false, extText: '', due: '', type: 'FS', lag: '0', lagCal: 'work', nature: 'mandatory' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const ev = (k) => (e) => set(k)(e.target.value);
  const reset = () => { setF({ other: '', second: '', ext: false, extText: '', due: '', type: 'FS', lag: '0', lagCal: 'work', nature: 'mandatory' }); onDone && onDone(); };
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>{task ? (side === 'succ' ? '+ Waiting on…' : '+ Blocking…') : '+ Add dependency'}</button>;
  const both = !task;
  // who waits (succ) and who is waited on (pred)
  const succId = both ? f.other : side === 'succ' ? task.id : f.other;
  const predId = both ? f.second : side === 'succ' ? f.other : task.id;
  const external = !both && side === 'succ' && f.ext;
  const ready = external ? f.extText.trim() : succId && predId;
  const go = () => {
    dp.add(external ? task.id : succId, { pred: external ? '' : predId, ext: f.extText, due: f.due, type: f.type, lag: f.lag, lagCal: f.lagCal, nature: f.nature }, () => { reset(); setOpen(false); });
  };
  const hint = REL[f.type].help;
  return (
    <div className="dp-form">
      {both ? (
        <>
          <label className="fld">Work item that waits<ItemSelect S={S} value={f.other} onChange={set('other')} exclude={[f.second]} label="Work item that waits" /></label>
          <label className="fld">…and waits on<ItemSelect S={S} value={f.second} onChange={set('second')} exclude={[f.other]} label="Work item it waits on" /></label>
        </>
      ) : external ? (
        <>
          <label className="fld">Who or what is it waiting on?
            <input className="c" autoFocus value={f.extText} onChange={ev('extText')} placeholder="e.g. Client sign-off, vendor delivery, permit" />
          </label>
          <label className="fld">Needed by (optional)<input className="c" type="date" value={f.due} onChange={ev('due')} /></label>
        </>
      ) : (
        <label className="fld">{side === 'succ' ? 'This work item waits on' : 'This work item blocks'}
          <ItemSelect S={S} value={f.other} onChange={set('other')} exclude={[task.id]} label="Other work item" />
        </label>
      )}
      {!external && (
        <div className="dp-grid">
          <label className="fld">Relationship
            <select className="c" value={f.type} onChange={ev('type')}>{REL_IDS.map((k) => (<option key={k} value={k}>{REL[k].label} ({k})</option>))}</select>
          </label>
          <label className="fld">Lag (+) or lead (−)
            <span className="dp-lagrow">
              <input className="c n" type="number" value={f.lag} onChange={ev('lag')} />
              <select className="c" value={f.lagCal} onChange={ev('lagCal')} aria-label="Lag unit"><option value="work">working days</option><option value="cal">calendar days</option></select>
            </span>
          </label>
        </div>
      )}
      <label className="fld">Nature
        <select className="c" value={f.nature} onChange={ev('nature')}>{Object.keys(NATURE).map((k) => (<option key={k} value={k}>{NATURE[k].label}</option>))}</select>
      </label>
      <p className="msg dp-help">{NATURE[f.nature].help}</p>
      {!external && <p className="msg dp-help">{REL[f.type].arrow}: {hint}</p>}
      {hasBaseline(S) && <p className="msg dp-help"><b>This project has a baseline.</b> Adding a dependency now asks you for a change request.</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!ready} onClick={go}>Add dependency</button>
        <button className="btn" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
        {task && side === 'succ' && (
          <button className="linkbtn" onClick={() => setF((x) => ({ ...x, ext: !x.ext, other: '' }))}>{f.ext ? 'Pick a work item instead' : 'It waits on someone outside the project'}</button>
        )}
      </div>
    </div>
  );
}

// One dependency. side = 'succ': the open work item waits on the one shown; side = 'pred': the open work item blocks the one shown.
export function DepRow({ e, side = 'succ', onOpen, showSprint = true }) {
  const { S, setNav } = useStore();
  const dp = useDeps();
  const tk = useTasks();
  const idx = useDepIndex();
  const cp = other && idx.cpm.nodes.get(other.id);
  const cr = e.dep.crId ? (S.cr || []).find((x) => x.id === e.dep.crId) : null;
  const locked = depLocked(S, e.dep);
  const other = side === 'succ' ? e.pred : e.succ;
  const otherC = side === 'succ' ? e.pc : e.sc;
  const rel = REL[e.dep.type] || REL.FS;
  const patch = (o) => dp.patch(e.succ.id, e.dep.id, o);
  const c = e.ev.conflict;
  const toRaid = () => { if (e.raid) { raidJump.key = e.raid.key; setNav({ view: 'project', tab: 'raid' }); } };
  return (
    <div className={'dp-row ' + e.ev.state}>
      <div className="dp-main">
        <StatePill e={e} />
        {e.pred && <span className="dp-rel" title={rel.label + ': ' + rel.help}>{rel.code}{Number(e.dep.lag) ? (e.dep.lag > 0 ? '+' : '') + e.dep.lag + 'd' : ''}</span>}
        {other ? (
          <button type="button" className="linkbtn dp-name" onClick={() => onOpen && onOpen(other.id)} title="Open this work item">
            <span className="mono">{other.code}</span> {other.name}
          </button>
        ) : (
          <span className="dp-name"><span className="msg">External · </span>{e.dep.ext}</span>
        )}
        {showSprint && otherC && <span className="msg dp-where">{otherC.name}</span>}
        {cp && cp.linked && <span className={'pill ' + (cp.critical ? 'bad' : cp.float < 0 ? 'bad' : 'neutral')} title="Critical Path Method, in working days">{cp.critical ? 'Critical' : 'Float ' + cp.float + ' wd'}</span>}
        {cr && <span className="pill neutral" title={'Raised under ' + cr.code + ' (' + cr.status + ')'}>{cr.code}</span>}
        {locked && <span className="msg" title="Part of the approved baseline: changing or removing it needs a change request">🔒 baseline</span>}
      </div>
      <div className="dp-ctl">
        {e.pred && side === 'succ' && (
          <select className="c" value={e.dep.type} onChange={(x) => patch({ type: x.target.value })} aria-label="Relationship">
            {REL_IDS.map((k) => (<option key={k} value={k}>{REL[k].label}</option>))}
          </select>
        )}
        {e.pred && (
          <label className="dp-lag" title="Positive = lag (wait), negative = lead (overlap)">Lag
            <Cell value={e.dep.lag} type="int" cls="n" label="Lag" onCommit={(v) => patch({ lag: v == null ? 0 : v })} />
            <select className="c" value={e.dep.lagCal === 'cal' ? 'cal' : 'work'} onChange={(x) => patch({ lagCal: x.target.value })} aria-label="Lag unit"><option value="work">working days</option><option value="cal">calendar days</option></select>
          </label>
        )}
        <select className="c" value={e.dep.nature} onChange={(x) => patch({ nature: x.target.value })} aria-label="Nature of the dependency" title={NATURE[e.dep.nature].help}>
          {Object.keys(NATURE).map((k) => (<option key={k} value={k}>{NATURE[k].label}</option>))}
        </select>
        {!e.pred && (
          <>
            <Cell value={e.dep.due || ''} type="date" label="Needed by" onCommit={(v) => patch({ due: v || '' })} />
            <label className="dp-res"><input type="checkbox" checked={!!e.dep.resolved} onChange={(x) => patch({ resolved: x.target.checked })} /> Received</label>
          </>
        )}
        {e.raid && <button type="button" className="btn dp-raid" onClick={toRaid} title="Open its entry in the RAID log">{e.raid.id}</button>}
        <button type="button" className="x" onClick={() => dp.remove(e.succ.id, e.dep.id)} aria-label="Remove dependency" title="Remove dependency">✕</button>
      </div>
      {c && (
        <div className="dp-warn">
          <span>{c.text}</span>
          {c.field && e.succ && (
            <button className="btn" onClick={() => tk.patch(e.succ.id, { [c.field]: c.target })}>Move {c.field === 'start' ? 'start' : 'due date'} to {fdate(c.target)}</button>
          )}
        </div>
      )}
    </div>
  );
}

// The Dependencies part of the work item drawer: what it waits on, what it blocks, and links to add more
export function DepsSection({ task, onOpen }) {
  const idx = useDepIndex();
  const waits = idx.waiting.get(task.id) || [];
  const blocks = idx.blocking.get(task.id) || [];
  return (
    <>
      <h3 className="d-h" id="dependencies">Dependencies {(waits.length + blocks.length) > 0 && <span className="msg">{waits.length} waiting on · {blocks.length} blocking</span>}</h3>
      <p className="msg dp-help">Every dependency is logged automatically in the RAID log and closes there when it is satisfied.</p>
      <div className="dp-grp">
        <b>Waiting on</b>
        {waits.map((e) => (<DepRow key={e.dep.id} e={e} side="succ" onOpen={onOpen} />))}
        {!waits.length && <span className="msg">Nothing. This work item can start whenever it is scheduled.</span>}
        <AddDependency task={task} side="succ" />
      </div>
      <div className="dp-grp">
        <b>Blocking</b>
        {blocks.map((e) => (<DepRow key={e.dep.id} e={e} side="pred" onOpen={onOpen} />))}
        {!blocks.length && <span className="msg">Nothing waits on this work item.</span>}
        <AddDependency task={task} side="pred" />
      </div>
    </>
  );
}

// The Dependencies column of the sprint list
export function DepsCell({ task, idx, onOpen }) {
  const waits = idx.waiting.get(task.id) || [];
  const blocks = idx.blocking.get(task.id) || [];
  const open = waits.filter((e) => !e.ev.met).length;
  const cp = idx.cpm && idx.cpm.nodes.get(task.id);
  const bad = waits.some((e) => e.ev.state === 'conflict');
  const items = [];
  waits.forEach((e) => items.push({ label: <span className="dp-mi">← {e.pred ? e.pred.code + ' ' + e.pred.name : e.dep.ext} <i className={'pill ' + STATE[e.ev.state].cls}>{STATE[e.ev.state].label}</i></span>, onClick: () => onOpen(e.pred ? e.pred.id : task.id) }));
  blocks.forEach((e) => items.push({ label: <span className="dp-mi">→ {e.succ.code} {e.succ.name}</span>, onClick: () => onOpen(e.succ.id) }));
  if (items.length) items.push({ sep: true });
  items.push({ label: 'Manage dependencies…', onClick: () => onOpen(task.id) });
  const label = waits.length || blocks.length ? (
    <span className="dp-chips">
      {waits.length > 0 && <span className={'dp-chip ' + (bad ? 'bad' : open ? 'warn' : 'good')} title={waits.length + ' waiting on, ' + open + ' not satisfied'}>← {waits.length}</span>}
      {blocks.length > 0 && <span className="dp-chip neutral" title={'Blocking ' + blocks.length}>→ {blocks.length}</span>}
      {cp && cp.critical && <span className="dp-chip bad" title="On the critical path: no float">CP</span>}
    </span>
  ) : <span className="dp-empty">＋</span>;
  return <Menu className="dp-btn" label={label} title="Dependencies" items={items} wide />;
}
