import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { Avatar, BacklogIcon } from '../components/Bits';
import { AssigneeMenu, PriorityMenu } from '../components/Pickers';
import { nameOf } from '../lib/tasks';
import { hrsf } from '../lib/format';
import TaskDrawer from './TaskDrawer';
import BulkBar from '../components/BulkBar';
import { useSelect } from '../lib/useSelect';
import { AddRow, TriBox, groupsOf } from './SprintView';

function MoveMenu({ task, className = 'btn' }) {
  const { S } = useStore();
  const tk = useTasks();
  const items = S.sprints.length
    ? S.sprints.map((sp) => ({ label: sp.name, hint: sp.status === 'Not started' ? '' : sp.status, onClick: () => tk.move(task.id, sp.id) }))
    : [{ label: 'No sprints yet. Add one in the menu on the left.', disabled: true }];
  return <Menu className={className} label="Move to sprint ▾" title={'Move ' + task.name + ' to a sprint'} items={items} />;
}

function Row({ t, expanded, onToggle, onOpen, selected, onSelect }) {
  const tk = useTasks();
  const { S } = useStore();
  const subDone = t.subtasks.filter((s) => s.done).length;
  return (
    <>
      <div className={'tg-row' + (selected ? ' sel' : '')}>
        <div className="tg-name">
          <input type="checkbox" className="tg-sel" checked={selected} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
          <button className="x tg-exp" onClick={onToggle} aria-label={expanded ? 'Hide subtasks' : 'Show subtasks'}>{expanded ? '▾' : '▸'}</button>
          <button className="tg-title" onClick={() => onOpen(t.id)} title="Open work item">{t.name}</button>
          {t.subtasks.length > 0 && <span className="subc" title="Subtasks done">⑂ {subDone}/{t.subtasks.length}</span>}
        </div>
        <div className="c-ass"><AssigneeMenu task={t} /></div>
        <div className="c-pri"><PriorityMenu task={t} /></div>
        <div className="c-eff"><Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" placeholder="–" onCommit={(v) => tk.patch(t.id, { effort: v })} /></div>
        <div className="c-move"><MoveMenu task={t} /></div>
        <div className="c-open"><button className="x" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button></div>
      </div>
      {expanded && (
        <div className="tg-sub">
          {t.subtasks.map((s) => (
            <div key={s.id} className="tg-row sub">
              <div className="tg-name">
                <input type="checkbox" checked={s.done} onChange={(e) => tk.patchSub(t.id, s.id, { done: e.target.checked })} aria-label="Subtask done" />
                <Cell value={s.name} cls={s.done ? 'strike' : ''} label="Subtask name" onCommit={(v) => v && tk.patchSub(t.id, s.id, { name: v })} />
              </div>
              <div className="c-ass">
                <Menu
                  className="x ass-btn"
                  label={<Avatar name={nameOf(S, s.person)} size={20} />}
                  title="Subtask assignee"
                  items={[{ label: 'Unassigned', active: !s.person, onClick: () => tk.patchSub(t.id, s.id, { person: '' }) }].concat(
                    S.people.map((x) => ({ label: x.name || '(unnamed)', active: x.id === s.person, onClick: () => tk.patchSub(t.id, s.id, { person: x.id }) }))
                  )}
                />
              </div>
              <div /><div /><div />
              <div className="c-open"><button className="x" onClick={() => tk.removeSub(t.id, s.id)} aria-label="Delete subtask">✕</button></div>
            </div>
          ))}
          <div className="tg-row sub"><div className="tg-name"><AddRow label="Add subtask" onAdd={(n) => tk.addSub(t.id, n)} /></div></div>
        </div>
      )}
    </>
  );
}

// The Backlog is a holding area for work items that are not planned yet. It is not a sprint: no statuses,
// no dates, no board. The main action is moving items into a sprint.
export default function BacklogView() {
  const { S } = useStore();
  const tk = useTasks();
  const c = S.backlog;
  const [q, setQ] = useState('');
  const [by, setBy] = useState('none');
  const [who, setWho] = useState('all');
  const [open, setOpen] = useState(null);
  const [exp, setExp] = useState({});
  const [shut, setShut] = useState({});
  const people = S.people.filter((p) => p.name);

  const tasks = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql)) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who))));
  }, [c, q, who]);

  const totalH = c.tasks.reduce((a, t) => a + (t.effort || 0), 0);
  const missing = c.tasks.filter((t) => !t.effort).length;
  const assigned = c.tasks.filter((t) => (t.assignees || []).length).length;
  const pctA = c.tasks.length ? Math.round((assigned / c.tasks.length) * 100) : null;
  const filtering = !!q.trim() || who !== 'all';
  const groups = groupsOf(tasks, by, S, false);
  const addTo = (defaults) => (name) => tk.add('backlog', { name, ...defaults });
  const order = [];
  groups.forEach((g) => !shut[g.key] && g.tasks.forEach((t) => !order.includes(t.id) && order.push(t.id)));
  const pick = useSelect(tasks.map((t) => t.id), order, S.id);

  return (
    <div className="sprint backlog">
      <div className="crumb"><span>{S.meta.name}</span><span aria-hidden="true">/</span><span>Backlog</span></div>
      <div className="s-head">
        <div className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
          <BacklogIcon size={24} />
          <h2 className="h-title">Backlog</h2>
        </div>
        <div className="row s-meta">
          <span className="chip-d">{c.tasks.length} item{c.tasks.length === 1 ? '' : 's'}</span>
          <span className="chip-d mono">{hrsf(totalH)} h</span>
          <span className={'chip-d' + (missing ? ' warnc' : '')}>{missing} not est</span>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 12 }}>Work items that are not planned yet. They have no status or dates until you move them into a sprint.</p>

      <div className="tools">
        <input className="c" style={{ maxWidth: 240 }} type="search" placeholder="Search the backlog" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the backlog" />
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Group by
          <select className="c" value={by} onChange={(e) => setBy(e.target.value)} style={{ width: 'auto' }} aria-label="Group by">
            <option value="none">None</option><option value="priority">Priority</option><option value="assignee">Assignee</option>
          </select>
        </label>
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Assignee
          <select className="c" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }} aria-label="Assignee filter">
            <option value="all">Everyone</option><option value="none">Unassigned</option>
            {people.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setOpen(tk.add('backlog', { name: 'Untitled work item' }))}>+ Work item</button>
      </div>

      <BulkBar ids={pick.chosen} container={c} onDone={pick.clear} />

      <div className="s-cards">
        <div className="s-card"><span className={'s-ic ' + (c.tasks.length ? 'good' : 'warn')}>{c.tasks.length ? '✓' : '!'}</span><div><b>Work items</b><div className="msg">{c.tasks.length} waiting to be planned</div></div></div>
        <div className="s-card"><span className={'s-ic ' + (pctA === 100 ? 'good' : 'warn')}>{pctA === 100 ? '✓' : '!'}</span><div><b>Assigned</b><div className="msg">{pctA == null ? 'No work items yet' : pctA + '% assigned'}</div></div></div>
        <div className="s-card"><span className={'s-ic ' + (missing ? 'warn' : 'good')}>{missing ? '!' : '✓'}</span><div><b>Effort</b><div className="msg">{missing ? missing + ' work item' + (missing > 1 ? 's' : '') + ' missing effort' : 'All work items estimated'}</div></div></div>
      </div>

      <div className="scroll">
        <div className="tg bk">
          <div className="tg-row tg-h"><div className="tg-name"><TriBox all={tasks.length > 0 && pick.chosen.length === tasks.length} some={pick.chosen.length > 0} onChange={(e) => pick.setMany(tasks.map((t) => t.id), e.target.checked)} label="Select all work items" />Name</div><div>Assignee</div><div>Priority</div><div>Effort (h)</div><div>Sprint</div><div /></div>
          {groups.map((g) => {
            const hide = shut[g.key];
            return (
              <div key={g.key} className="tg-group">
                {by !== 'none' && (
                  <div className="g-hd">
                    <TriBox
                      all={g.tasks.length > 0 && g.tasks.every((t) => pick.sel.has(t.id))}
                      some={g.tasks.some((t) => pick.sel.has(t.id))}
                      onChange={(e) => pick.setMany(g.tasks.map((t) => t.id), e.target.checked)}
                      label={'Select all in ' + g.label}
                    />
                    <button className="x" onClick={() => setShut({ ...shut, [g.key]: !hide })} aria-label={hide ? 'Expand group' : 'Collapse group'}>{hide ? '▸' : '▾'}</button>
                    <span className="g-chip" style={{ background: g.color }}>{g.label}</span>
                    <span className="msg">{g.tasks.length}</span>
                  </div>
                )}
                {!hide && g.tasks.map((t) => (
                  <Row key={t.id} t={t} expanded={!!exp[t.id]} onToggle={() => setExp({ ...exp, [t.id]: !exp[t.id] })} onOpen={setOpen} selected={pick.sel.has(t.id)} onSelect={pick.toggleOne} />
                ))}
              </div>
            );
          })}
          {!groups.length && <div className="empty">{filtering ? 'No work items match your search or filter.' : 'The backlog is empty. Add work items here and move them into a sprint when you are ready to plan them.'}</div>}
          {!filtering && <div className="tg-add"><AddRow label="Add to backlog" onAdd={addTo({})} /></div>}
        </div>
      </div>

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
