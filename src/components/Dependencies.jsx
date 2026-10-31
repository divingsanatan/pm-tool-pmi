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

const itemOf = (S, id) => allContainers(S).flatMap((c) => c.tasks).find((t) => t.id === id);
const q = (t) => (t ? '“' + t.name + '”' : 'a work item');
const lagWords = (n, cal) => {
  const a = Math.abs(n), u = (cal === 'cal' ? 'calendar' : 'working') + ' day' + (a === 1 ? '' : 's');
  return n > 0 ? a + ' ' + u + ' after' : n < 0 ? a + ' ' + u + ' before' : '';
};

// "B cannot start until A finishes", in plain words. waits / blocker are names (already quoted).
function sentence(type, waits, blocker, lag, lagCal) {
  const r = REL[type] || REL.FS;
  const l = lagWords(Number(lag) || 0, lagCal);
  const when = r.from === 'finish' ? 'finishes' : 'starts';
  return waits + ' cannot ' + r.need + ' until ' + blocker + ' ' + when + (l ? ' (' + (Number(lag) > 0 ? l.replace(' after', ' later') : l.replace(' before', ' earlier')) + ')' : '') + '.';
}

/* A tiny two-bar picture of each relationship: top bar = the work item that must happen first (A), bottom bar = the one that waits (B) */
const PIC = {
  FS: [[2, 24], [28, 30]],
  SS: [[2, 34], [2, 24]],
  FF: [[2, 34], [14, 22]],
  SF: [[26, 30], [2, 24]],
};
const Pic = ({ type }) => (
  <svg className="dp-pic" viewBox="0 0 60 22" aria-hidden="true">
    <rect x={PIC[type][0][0]} y="3" width={PIC[type][0][1]} height="6" rx="2" className="a" />
    <rect x={PIC[type][1][0]} y="13" width={PIC[type][1][1]} height="6" rx="2" className="b" />
  </svg>
);
const REL_HINT = {
  FS: 'B starts after A finishes. The most common.',
  SS: 'B starts after A has started.',
  FF: 'B finishes after A has finished.',
  SF: 'B finishes after A has started. Rare.',
};
function RelPicker({ value, onChange }) {
  return (
    <div className="dp-rels" role="radiogroup" aria-label="How the two work items are linked">
      {REL_IDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={'dp-rel-tile' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>
          <Pic type={k} />
          <span className="t">{REL[k].label}</span>
          <span className="h">{REL_HINT[k]}</span>
        </button>
      ))}
    </div>
  );
}
const NatureSeg = ({ value, onChange }) => (
  <div className="seg dp-seg" role="group" aria-label="Nature of the dependency">
    {Object.keys(NATURE).map((k) => (<button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} title={NATURE[k].help}>{NATURE[k].label}</button>))}
  </div>
);
const LagInput = ({ lag, lagCal, onLag, onCal }) => (
  <div className="dp-lagrow">
    <input className="c n" type="number" value={lag} onChange={(e) => onLag(e.target.value)} aria-label="Lag or lead" />
    <select className="c" value={lagCal} onChange={(e) => onCal(e.target.value)} aria-label="Lag unit"><option value="work">working days</option><option value="cal">calendar days</option></select>
  </div>
);

// Work items of every sprint and the Backlog, grouped by sprint, filtered by what is typed in the box
function ItemSelect({ S, value, onChange, exclude = [], label }) {
  const [text, setText] = useState('');
  const ql = text.trim().toLowerCase();
  const groups = allContainers(S)
    .map((c) => ({ c, list: c.tasks.filter((t) => !exclude.includes(t.id) && (!ql || (t.code + ' ' + t.name).toLowerCase().includes(ql) || t.id === value)) }))
    .filter((g) => g.list.length);
  return (
    <div className="dp-pick">
      <input className="c" type="search" value={text} placeholder="Type to search work items" onChange={(e) => setText(e.target.value)} aria-label={'Search ' + label} />
      <select className="c" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Choose a work item…</option>
        {groups.map((g) => (
          <optgroup key={g.c.id} label={g.c.name}>
            {g.list.map((t) => (<option key={t.id} value={t.id}>{t.code} · {t.name}</option>))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

const Step = ({ n, title, hint, children }) => (
  <div className="dp-step">
    <div className="dp-step-h"><span className="dp-n">{n}</span><b>{title}</b>{hint && <span className="msg">{hint}</span>}</div>
    {children}
  </div>
);

/* The "add a dependency" form, in three steps.
   task + side:  'succ' = this work item WAITS on the one you pick;  'pred' = this work item BLOCKS the one you pick.
   No task: both ends are picked (used on the sprint's Dependencies view). */
export function AddDependency({ task, side = 'succ', onDone, startOpen = false }) {
  const { S } = useStore();
  const dp = useDeps();
  const [open, setOpen] = useState(startOpen);
  const blank = { other: '', second: '', ext: false, extText: '', due: '', type: 'FS', lag: '0', lagCal: 'work', nature: 'mandatory' };
  const [f, setF] = useState(blank);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const reset = () => { setF(blank); onDone && onDone(); };
  const both = !task;
  const waitsHere = !both && side === 'succ';
  if (!open) {
    return (
      <button type="button" className="dp-add" onClick={() => setOpen(true)}>
        <span aria-hidden="true">＋</span> {both ? 'Add a dependency' : waitsHere ? 'Add something this waits on' : 'Add something this blocks'}
      </button>
    );
  }
  const succId = both ? f.other : waitsHere ? task.id : f.other;
  const predId = both ? f.second : waitsHere ? f.other : task.id;
  const external = waitsHere && f.ext;
  const ready = external ? f.extText.trim() : succId && predId;
  const go = () => dp.add(external ? task.id : succId, { pred: external ? '' : predId, ext: f.extText, due: f.due, type: f.type, lag: f.lag, lagCal: f.lagCal, nature: f.nature }, () => { reset(); setOpen(false); });
  const sT = itemOf(S, succId), pT = itemOf(S, predId);
  const preview = external
    ? q(task) + ' depends on ' + (f.extText.trim() || '…') + ' (outside the project).'
    : sT && pT ? sentence(f.type, q(sT), q(pT), f.lag, f.lagCal) : 'Pick the work items to see how this reads.';
  return (
    <div className="dp-form" role="group" aria-label="New dependency">
      <div className="dp-form-h">
        <b>New dependency</b>
        <button type="button" className="x" onClick={() => { reset(); setOpen(false); }} aria-label="Cancel">✕</button>
      </div>

      <Step n="1" title={both ? 'Which work items?' : waitsHere ? 'What does this work item wait on?' : 'Which work item does this one block?'}>
        {waitsHere && (
          <div className="seg dp-seg" role="group" aria-label="Kind of dependency">
            <button type="button" aria-pressed={!f.ext} onClick={() => setF((x) => ({ ...x, ext: false }))}>A work item</button>
            <button type="button" aria-pressed={f.ext} onClick={() => setF((x) => ({ ...x, ext: true, other: '' }))}>Someone outside the project</button>
          </div>
        )}
        {both ? (
          <div className="dp-two">
            <label className="fld"><span className="dp-l">Waits (the later work)</span><ItemSelect S={S} value={f.other} onChange={set('other')} exclude={[f.second]} label="Work item that waits" /></label>
            <label className="fld"><span className="dp-l">…until this one (the earlier work)</span><ItemSelect S={S} value={f.second} onChange={set('second')} exclude={[f.other]} label="Work item it waits on" /></label>
          </div>
        ) : external ? (
          <div className="dp-two">
            <label className="fld"><span className="dp-l">Who or what?</span><input className="c" autoFocus value={f.extText} onChange={(e) => set('extText')(e.target.value)} placeholder="Client sign-off, vendor delivery, permit…" /></label>
            <label className="fld"><span className="dp-l">Needed by (optional)</span><input className="c" type="date" value={f.due} onChange={(e) => set('due')(e.target.value)} /></label>
          </div>
        ) : (
          <ItemSelect S={S} value={f.other} onChange={set('other')} exclude={[task.id]} label="Other work item" />
        )}
      </Step>

      {!external && (
        <Step n="2" title="How are they linked?" hint="A is the work that comes first, B is the work that waits.">
          <RelPicker value={f.type} onChange={set('type')} />
        </Step>
      )}

      <Step n={external ? '2' : '3'} title="Timing and strength">
        <div className="dp-two">
          {!external && (
            <div className="fld"><span className="dp-l">Gap between them <span className="msg">(+ lag, − lead)</span></span><LagInput lag={f.lag} lagCal={f.lagCal} onLag={set('lag')} onCal={set('lagCal')} /></div>
          )}
          <div className="fld"><span className="dp-l">Nature</span><NatureSeg value={f.nature} onChange={set('nature')} /><span className="msg dp-note">{NATURE[f.nature].help}</span></div>
        </div>
      </Step>

      <div className="dp-preview">
        <span className="dp-pv-l">This reads as</span>
        <p>{preview}</p>
        <span className="msg">It will be logged in the RAID log as a Dependency{hasBaseline(S) ? ', and because the project has a baseline you will be asked for a change request' : ''}.</span>
      </div>

      <div className="dp-actions">
        <button type="button" className="btn primary" disabled={!ready} onClick={go}>Add dependency</button>
        <button type="button" className="btn" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}

// One dependency as a card. side = 'succ': the open work item waits on the one shown; side = 'pred': the open work item blocks the one shown.
export function DepRow({ e, side = 'succ', onOpen, showSprint = true }) {
  const { S, setNav } = useStore();
  const dp = useDeps();
  const tk = useTasks();
  const idx = useDepIndex();
  const [edit, setEdit] = useState(false);
  const other = side === 'succ' ? e.pred : e.succ;
  const otherC = side === 'succ' ? e.pc : e.sc;
  const cp = other && idx.cpm.nodes.get(other.id);
  const cr = e.dep.crId ? (S.cr || []).find((x) => x.id === e.dep.crId) : null;
  const locked = depLocked(S, e.dep);
  const rel = REL[e.dep.type] || REL.FS;
  const patch = (o) => dp.patch(e.succ.id, e.dep.id, o);
  const c = e.ev.conflict;
  const toRaid = () => { if (e.raid) { raidJump.key = e.raid.key; setNav({ view: 'project', tab: 'raid' }); } };
  const lag = Number(e.dep.lag) || 0;
  const text = !e.pred
    ? q(e.succ) + ' is waiting on ' + e.dep.ext + (e.dep.due ? ', needed by ' + fdate(e.dep.due) : '') + '.'
    : side === 'succ'
      ? sentence(e.dep.type, 'This', q(e.pred), lag, e.dep.lagCal)
      : sentence(e.dep.type, q(e.succ), 'this', lag, e.dep.lagCal);
  return (
    <div className={'dp-card ' + e.ev.state}>
      <div className="dp-top">
        <div className="dp-who">
          {other ? (
            <button type="button" className="dp-name" onClick={() => onOpen && onOpen(other.id)} title="Open this work item"><span className="mono">{other.code}</span> {other.name}</button>
          ) : (
            <span className="dp-name"><span className="dp-ext">External</span> {e.dep.ext}</span>
          )}
          {showSprint && otherC && <span className="msg">{otherC.name}</span>}
        </div>
        <StatePill e={e} />
      </div>
      <p className="dp-sent">{text}</p>
      <div className="dp-tags">
        {e.pred && <span className="dp-tag rel" title={rel.help}>{rel.label}</span>}
        <span className="dp-tag" title={NATURE[e.dep.nature].help}>{NATURE[e.dep.nature].label}</span>
        {e.pred && lag !== 0 && <span className="dp-tag">{Math.abs(lag)} {e.dep.lagCal === 'cal' ? 'calendar' : 'working'} day{Math.abs(lag) === 1 ? '' : 's'} {lag > 0 ? 'lag' : 'lead'}</span>}
        {cp && cp.linked && <span className={'dp-tag ' + (cp.critical || cp.float < 0 ? 'bad' : '')} title="Critical Path Method, in working days">{cp.critical ? 'Critical path' : 'Float ' + cp.float + ' working day' + (cp.float === 1 ? '' : 's')}</span>}
        {cr && <span className="dp-tag" title={'Raised under ' + cr.code + ' (' + cr.status + ')'}>{cr.code}</span>}
        {locked && <span className="dp-tag lock" title="Part of the approved baseline: changing or removing it needs a change request">🔒 Baseline</span>}
        {e.raid && <button type="button" className="dp-tag link" onClick={toRaid} title="Open its entry in the RAID log">RAID {e.raid.id}</button>}
      </div>
      {c && (
        <div className="dp-warn">
          <span>{c.text}</span>
          {c.field && (<button type="button" className="btn" onClick={() => tk.patch(e.succ.id, { [c.field]: c.target })}>Move {c.field === 'start' ? 'start' : 'due date'} to {fdate(c.target)}</button>)}
        </div>
      )}
      {edit && (
        <div className="dp-edit">
          {e.pred && (
            <label className="fld"><span className="dp-l">Relationship</span>
              <select className="c" value={e.dep.type} onChange={(x) => patch({ type: x.target.value })}>{REL_IDS.map((k) => (<option key={k} value={k}>{REL[k].label}</option>))}</select>
            </label>
          )}
          {e.pred && (
            <div className="fld"><span className="dp-l">Gap <span className="msg">(+ lag, − lead)</span></span>
              <div className="dp-lagrow">
                <Cell value={e.dep.lag} type="int" cls="n" label="Lag" onCommit={(v) => patch({ lag: v == null ? 0 : v })} />
                <select className="c" value={e.dep.lagCal === 'cal' ? 'cal' : 'work'} onChange={(x) => patch({ lagCal: x.target.value })} aria-label="Lag unit"><option value="work">working days</option><option value="cal">calendar days</option></select>
              </div>
            </div>
          )}
          <div className="fld"><span className="dp-l">Nature</span><NatureSeg value={e.dep.nature} onChange={(v) => patch({ nature: v })} /></div>
          {!e.pred && (
            <>
              <label className="fld"><span className="dp-l">Needed by</span><Cell value={e.dep.due || ''} type="date" label="Needed by" onCommit={(v) => patch({ due: v || '' })} /></label>
              <label className="dp-res"><input type="checkbox" checked={!!e.dep.resolved} onChange={(x) => patch({ resolved: x.target.checked })} /> It has arrived</label>
            </>
          )}
        </div>
      )}
      <div className="dp-foot">
        <button type="button" className="linkbtn" onClick={() => setEdit(!edit)} aria-expanded={edit}>{edit ? 'Done' : 'Edit details'}</button>
        <button type="button" className="linkbtn dp-del" onClick={() => dp.remove(e.succ.id, e.dep.id)}>Remove</button>
      </div>
    </div>
  );
}

function Group({ icon, title, sub, count, children }) {
  return (
    <section className="dp-group">
      <header className="dp-gh">
        <span className="dp-ic" aria-hidden="true">{icon}</span>
        <div><b>{title}</b> <span className="dp-count">{count}</span><div className="msg">{sub}</div></div>
      </header>
      {children}
    </section>
  );
}

// The Dependencies part of the work item drawer: what it waits on, what it blocks, and how to add more
export function DepsSection({ task, onOpen }) {
  const idx = useDepIndex();
  const waits = idx.waiting.get(task.id) || [];
  const blocks = idx.blocking.get(task.id) || [];
  const open = waits.filter((e) => !e.ev.met).length;
  const bad = waits.concat(blocks).filter((e) => e.ev.state === 'conflict').length;
  return (
    <>
      <h3 className="d-h" id="dependencies">Dependencies</h3>
      <div className="dp-wrap">
        <div className="dp-intro">
          <p>Say what this work item needs before it can move on, and what it holds up. Every dependency is added to the RAID log for you, and closes there when it is satisfied.</p>
          {(waits.length > 0 || blocks.length > 0) && (
            <div className="dp-sum">
              <span className={'pill ' + (open ? 'warn' : 'good')}>{open ? open + ' of ' + waits.length + ' waiting on not done' : waits.length ? 'Nothing blocking this' : 'Not waiting on anything'}</span>
              {blocks.length > 0 && <span className="pill neutral">Holding up {blocks.length}</span>}
              {bad > 0 && <span className="pill bad">{bad} conflict{bad === 1 ? '' : 's'}</span>}
            </div>
          )}
        </div>
        <Group icon="←" title="Waiting on" sub="This work item cannot proceed until these are done." count={waits.length}>
          {waits.map((e) => (<DepRow key={e.dep.id} e={e} side="succ" onOpen={onOpen} />))}
          {!waits.length && <p className="dp-empty-t">Nothing yet. This can start whenever it is scheduled.</p>}
          <AddDependency task={task} side="succ" />
        </Group>
        <Group icon="→" title="Blocking" sub="These work items are held up until this one is done." count={blocks.length}>
          {blocks.map((e) => (<DepRow key={e.dep.id} e={e} side="pred" onOpen={onOpen} />))}
          {!blocks.length && <p className="dp-empty-t">Nothing is waiting on this work item.</p>}
          <AddDependency task={task} side="pred" />
        </Group>
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
