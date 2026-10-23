import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { Avatar, SprintIcon, StatusIcon } from '../components/Bits';
import { AssigneeMenu, PriorityMenu, StatusMenu } from '../components/Pickers';
import { PRIORITIES, SPRINT_STATUSES, containerById, isDoneStatus, isOpen, nameOf, priorityOf, statusesOf } from '../lib/tasks';
import { today } from '../lib/dates';
import { hrsf } from '../lib/format';
import TaskDrawer from './TaskDrawer';
import Board from './Board';

export function AddRow({ onAdd, label = 'Add task' }) {
  const [on, setOn] = useState(false);
  const [v, setV] = useState('');
  if (!on)
    return (
      <button className="add-row" onClick={() => setOn(true)}>+ {label}</button>
    );
  const submit = () => {
    const n = v.trim();
    if (n) onAdd(n);
    setV('');
  };
  return (
    <div className="add-row on">
      <input
        className="c"
        autoFocus
        value={v}
        placeholder="Task name, then press Enter"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v.trim()) submit();
          setOn(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setV('');
            setOn(false);
          }
        }}
        aria-label="New task name"
      />
    </div>
  );
}

function Row({ t, expanded, onToggle, onOpen, selected, onSelect }) {
  const tk = useTasks();
  const { S } = useStore();
  const done = isDoneStatus(S, t.status);
  const late = !done && t.due && t.due < today();
  const subDone = t.subtasks.filter((s) => s.done).length;
  return (
    <>
      <div className={'tg-row' + (selected ? ' sel' : '')}>
        <div className="tg-name">
          <input type="checkbox" className="tg-sel" checked={selected} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
          <button className="x tg-exp" onClick={onToggle} aria-label={expanded ? 'Hide subtasks' : 'Show subtasks'}>{expanded ? '▾' : '▸'}</button>
          <StatusMenu task={t} />
          <button className={'tg-title' + (done ? ' done' : '')} onClick={() => onOpen(t.id)} title="Open task">{t.name}</button>
          {t.subtasks.length > 0 && <span className="subc" title="Subtasks done">⑂ {subDone}/{t.subtasks.length}</span>}
        </div>
        <div className="c-ass"><AssigneeMenu task={t} /></div>
        <div className="c-due"><Cell value={t.due} type="date" cls={'w-date' + (late ? ' od' : '')} label="Due date" onCommit={(v) => tk.patch(t.id, { due: v })} /></div>
        <div className="c-pri"><PriorityMenu task={t} /></div>
        <div className="c-eff"><Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" placeholder="–" onCommit={(v) => tk.patch(t.id, { effort: v })} /></div>
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

// checkbox that can show "some selected"
function TriBox({ all, some, onChange, label }) {
  return <input type="checkbox" className="tg-sel" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={onChange} aria-label={label} />;
}

export function groupsOf(tasks, by, S, showEmpty) {
  const who = (t) => t.assignees || [];
  let g;
  if (by === 'status') g = statusesOf(S).map((st) => ({ key: st.id, label: st.label, color: st.color, tasks: tasks.filter((t) => t.status === st.id), defaults: { status: st.id } }));
  else if (by === 'priority')
    g = PRIORITIES.map((p) => ({ key: p.id, label: p.label, color: p.color, tasks: tasks.filter((t) => t.priority === p.id), defaults: { priority: p.id } })).concat([
      { key: 'none', label: 'No priority', color: 'var(--muted)', tasks: tasks.filter((t) => !priorityOf(t.priority)), defaults: { priority: '' } },
    ]);
  else if (by === 'assignee')
    // a task with several assignees shows up under each of them
    g = S.people.map((p) => ({ key: p.id, label: p.name || '(unnamed)', color: 'var(--accent)', tasks: tasks.filter((t) => who(t).includes(p.id)), defaults: { assignees: [p.id] } })).concat([
      { key: 'un', label: 'Unassigned', color: 'var(--muted)', tasks: tasks.filter((t) => !who(t).length), defaults: { assignees: [] } },
    ]);
  else g = [{ key: 'all', label: 'All tasks', color: 'var(--accent)', tasks, defaults: {} }];
  return g.filter((x) => x.tasks.length || (showEmpty && by === 'status'));
}

export default function SprintView() {
  const { S, nav, setNav } = useStore();
  const tk = useTasks();
  const c = containerById(S, nav.sprintId);
  const [q, setQ] = useState('');
  const [by, setBy] = useState('status');
  const [who, setWho] = useState('all');
  const [open, setOpen] = useState(null); // task shown in the drawer
  const [exp, setExp] = useState({});
  const [shut, setShut] = useState({});
  const [sel, setSel] = useState(() => new Set()); // ids of selected work items (list view)
  const last = useRef(null); // last clicked id, for shift-click range selection

  const ui = useUI();
  const people = S.people.filter((p) => p.name);
  const tasks = useMemo(() => {
    if (!c) return [];
    const ql = q.trim().toLowerCase();
    return c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql)) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who))));
  }, [c, q, who]);
  // a selection belongs to one sprint and one view
  useEffect(() => { setSel(new Set()); last.current = null; }, [nav.sprintId, nav.sprintView]);
  if (!c) return <div className="card">This sprint no longer exists. Pick another from the left.</div>;

  const idx = S.sprints.findIndex((s) => s.id === c.id);
  const next = S.sprints[idx + 1];
  const unfinished = c.tasks.filter((t) => isOpen(S, t));
  const totalH = c.tasks.reduce((a, t) => a + (t.effort || 0), 0);
  const missing = c.tasks.filter((t) => !t.effort).length;
  const assigned = c.tasks.filter((t) => (t.assignees || []).length).length;
  const pctA = c.tasks.length ? Math.round((assigned / c.tasks.length) * 100) : null;
  const filtering = !!q.trim() || who !== 'all';
  const groups = groupsOf(tasks, by, S, !filtering);
  const view = nav.sprintView;

  // selection only counts items that are currently visible (search / assignee filters can hide some)
  const order = [];
  groups.forEach((g) => !shut[g.key] && g.tasks.forEach((t) => !order.includes(t.id) && order.push(t.id)));
  const visible = new Set(tasks.map((t) => t.id));
  const chosen = [...sel].filter((id) => visible.has(id));
  const toggleOne = (id, range) => {
    const n = new Set(sel);
    if (range && last.current && order.includes(last.current) && order.includes(id)) {
      const a = order.indexOf(last.current), b = order.indexOf(id);
      const on = !sel.has(id);
      order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? n.add(x) : n.delete(x)));
    } else if (n.has(id)) n.delete(id);
    else n.add(id);
    last.current = id;
    setSel(n);
  };
  const setMany = (ids, on) => {
    const n = new Set(sel);
    ids.forEach((x) => (on ? n.add(x) : n.delete(x)));
    setSel(n);
  };
  const bulkStatus = (status) => {
    tk.patchMany(chosen, { status });
    setSel(new Set());
    last.current = null;
  };

  const addTo = (defaults) => (name) => tk.add(c.id, { name, ...defaults });
  const quickAdd = () => setOpen(tk.add(c.id, { name: 'Untitled task' }));

  return (
    <div className="sprint">
      <div className="crumb">
        <span>{S.meta.name}</span><span aria-hidden="true">/</span><span>{c.name}</span>
      </div>
      <div className="s-head">
        <div className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
          <SprintIcon status={c.status} size={22} />
          <Cell value={c.name} cls="h-name" label="Sprint name" onCommit={(v) => v && tk.patchContainer(c.id, { name: v })} />
        </div>
        <div className="row s-meta">
          <>
              <Menu
                className={'pill st-' + c.status.replace(' ', '')}
                label={c.status + ' ▾'}
                title="Sprint status"
                items={SPRINT_STATUSES.map((s) => ({ label: s, active: s === c.status, onClick: () => tk.patchContainer(c.id, { status: s }) }))}
              />
              <span className="chip-d">
                <Cell value={c.start} type="date" cls="w-date" label="Sprint start" onCommit={(v) => v && tk.patchContainer(c.id, { start: v })} />
                <span aria-hidden="true">–</span>
                <Cell value={c.end} type="date" cls="w-date" label="Sprint end" onCommit={(v) => v && tk.patchContainer(c.id, { end: v })} />
              </span>
          </>
          <span className="chip-d mono">{hrsf(totalH)} h</span>
          <span className={'chip-d' + (missing ? ' warnc' : '')}>{missing} not est</span>
        </div>
      </div>

      <div className="vtabs" role="tablist">
        {[['list', 'List'], ['board', 'Board']].map(([id, l]) => (
          <button key={id} className="vtab" role="tab" aria-selected={view === id} onClick={() => setNav({ sprintView: id })}>{l}</button>
        ))}
      </div>

      <div className="tools">
        <input className="c" style={{ maxWidth: 240 }} type="search" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        {view === 'list' && (
          <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            Group by
            <select className="c" value={by} onChange={(e) => setBy(e.target.value)} style={{ width: 'auto' }}>
              <option value="status">Status</option><option value="assignee">Assignee</option><option value="priority">Priority</option><option value="none">None</option>
            </select>
          </label>
        )}
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Assignee
          <select className="c" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Everyone</option><option value="none">Unassigned</option>
            {people.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={ui.openStatuses} title="Add or edit task statuses">Statuses</button>
        <button className="btn primary" onClick={quickAdd}>+ Task</button>
      </div>

      {view === 'list' && chosen.length > 0 && (
        <div className="selbar" role="region" aria-label="Bulk actions">
          <b>{chosen.length} selected</b>
          <Menu
            className="btn primary"
            label="Set status ▾"
            title="Set status for selected tasks"
            items={statusesOf(S).map((st) => ({
              label: (<span className="sm-item"><StatusIcon status={st} size={14} />{st.label}</span>),
              onClick: () => bulkStatus(st.id),
            }))}
          />
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => { setSel(new Set()); last.current = null; }}>Clear selection</button>
        </div>
      )}

      {c.status === 'Done' && unfinished.length > 0 && (
        <div className="banner">
          <span>This sprint has {unfinished.length} unfinished task{unfinished.length > 1 ? 's' : ''}</span>
          <span className="row">
            {next && <button className="btn" onClick={() => tk.moveOpen(c.id, next.id)}>Move to {next.name}</button>}
            <button className="btn" onClick={() => tk.moveOpen(c.id, 'backlog')}>Move to Backlog</button>
          </span>
        </div>
      )}

      <div className="s-cards">
        <div className="s-card"><span className={'s-ic ' + (c.tasks.length ? 'good' : 'warn')}>{c.tasks.length ? '✓' : '!'}</span><div><b>Work items</b><div className="msg">{c.tasks.length} planned</div></div></div>
        <div className="s-card"><span className={'s-ic ' + (pctA === 100 ? 'good' : 'warn')}>{pctA === 100 ? '✓' : '!'}</span><div><b>Assigned</b><div className="msg">{pctA == null ? 'No tasks yet' : pctA + '% assigned'}</div></div></div>
        <div className="s-card"><span className={'s-ic ' + (missing ? 'warn' : 'good')}>{missing ? '!' : '✓'}</span><div><b>Effort</b><div className="msg">{missing ? missing + ' task' + (missing > 1 ? 's' : '') + ' missing effort' : 'All tasks estimated'}</div></div></div>
      </div>

      {view === 'list' ? (
        <div className="scroll">
          <div className="tg">
            <div className="tg-row tg-h"><div className="tg-name"><TriBox all={tasks.length > 0 && chosen.length === tasks.length} some={chosen.length > 0} onChange={(e) => setMany(tasks.map((t) => t.id), e.target.checked)} label="Select all tasks" />Name</div><div>Assignee</div><div>Due date</div><div>Priority</div><div>Effort (h)</div><div /></div>
            {groups.map((g) => {
              const hide = shut[g.key];
              return (
                <div key={g.key} className="tg-group">
                  <div className="g-hd">
                    <TriBox
                      all={g.tasks.length > 0 && g.tasks.every((t) => sel.has(t.id))}
                      some={g.tasks.some((t) => sel.has(t.id))}
                      onChange={(e) => setMany(g.tasks.map((t) => t.id), e.target.checked)}
                      label={'Select all in ' + g.label}
                    />
                    <button className="x" onClick={() => setShut({ ...shut, [g.key]: !hide })} aria-label={hide ? 'Expand group' : 'Collapse group'}>{hide ? '▸' : '▾'}</button>
                    <span className="g-chip" style={{ background: g.color }}>{g.label}</span>
                    <span className="msg">{g.tasks.length}</span>
                  </div>
                  {!hide && g.tasks.map((t) => (
                    <Row key={t.id} t={t} expanded={!!exp[t.id]} onToggle={() => setExp({ ...exp, [t.id]: !exp[t.id] })} onOpen={setOpen} selected={sel.has(t.id)} onSelect={toggleOne} />
                  ))}
                  {!hide && <div className="tg-add"><AddRow onAdd={addTo(g.defaults)} /></div>}
                </div>
              );
            })}
            {!groups.length && <div className="empty">{filtering ? 'No tasks match your search or filter.' : 'No tasks yet. Use + Task to add the first one.'}</div>}
          </div>
        </div>
      ) : (
        <Board tasks={tasks} onOpen={setOpen} onAdd={(status, name) => tk.add(c.id, { name, status })} />
      )}

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
