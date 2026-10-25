import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { SprintIcon, StatusIcon } from '../components/Bits';
import { AssigneeMenu, PriorityMenu, StatusMenu, TypeMenu } from '../components/Pickers';
import { AddRow, TriBox } from '../components/ListBits';
import { PRIORITIES, SPRINT_STATUSES, containerById, isDoneStatus, isOpen, priorityOf, statusOf, statusesOf, typeOf } from '../lib/tasks';
import { DAY, fdate, pd, today } from '../lib/dates';
import { outsideSprint, sprintHours, sprintShares } from '../lib/calc';
import { hrsf, nz, pc } from '../lib/format';
import { crCls } from '../lib/change';
import { kidsMap, leafTasks, rootTasks, withAncestors } from '../lib/hier';
import BulkBar from '../components/BulkBar';
import WbsTree from '../components/WbsTree';
import TaskDrawer from './TaskDrawer';
import Board from './Board';

export { AddRow, TriBox };

// One work item in the list. Items with children are parents: their hours, dates and status are roll-ups, so they are read-only.
function Row({ t, depth, kidList, expanded, onToggle, onOpen, selected, onSelect }) {
  const tk = useTasks();
  const { S } = useStore();
  const done = isDoneStatus(S, t.status);
  const late = !done && t.due && t.due < today();
  const parent = kidList.length > 0;
  const effortRolled = parent && kidList.some((k) => nz(k.effort) > 0);
  const datesRolled = parent && kidList.some((k) => k.start || k.due);
  const kidsDone = kidList.filter((k) => isDoneStatus(S, k.status)).length;
  const milestone = typeOf(S, t.type).milestone;
  return (
    <div className={'tg-row' + (selected ? ' sel' : '') + (parent ? ' par' : '')}>
      <div className="tg-name" style={depth ? { paddingLeft: depth * 18 } : undefined}>
        <input type="checkbox" className="tg-sel" checked={selected} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
        <button className="x tg-exp" onClick={onToggle} aria-label={expanded ? 'Hide child items' : 'Show child items'} title={parent ? (expanded ? 'Collapse' : 'Expand') : 'Add a subtask'}>{expanded ? '▾' : '▸'}</button>
        <TypeMenu task={t} size={16} />
        {parent ? (
          <span className="x st-btn ro" title="Status is calculated from its child items"><StatusIcon status={statusOf(S, t.status)} /></span>
        ) : (
          <StatusMenu task={t} />
        )}
        <button className={'tg-title' + (done ? ' done' : '') + (parent ? ' bold' : '')} onClick={() => onOpen(t.id)} title="Open work item">{t.name}</button>
        {parent && <span className="subc" title="Direct child items done">⑂ {kidsDone}/{kidList.length}</span>}
      </div>
      <div className="c-ass"><AssigneeMenu task={t} /></div>
      <div className="c-due">
        {datesRolled ? (
          <span className={'cell roll' + (late ? ' od' : '')} title={'Rolled up from child items' + (t.start ? ' · starts ' + fdate(t.start) : '')}>Σ {t.due ? fdate(t.due) : '–'}</span>
        ) : (
          <Cell value={t.due} type="date" cls={'w-date' + (late ? ' od' : '')} label="Due date" onCommit={(v) => tk.patch(t.id, { due: v })} />
        )}
      </div>
      <div className="c-pri"><PriorityMenu task={t} /></div>
      <div className="c-eff">
        {effortRolled ? (
          <span className="cell roll n w-sm" title="Rolled up from child items">Σ {hrsf(t.effort)}</span>
        ) : (
          <Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" min={0} placeholder={milestone ? '' : '–'} disabled={milestone} onCommit={(v) => tk.patch(t.id, { effort: v })} />
        )}
      </div>
      <div className="c-open"><button className="x" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button></div>
    </div>
  );
}

// a work item and, when expanded, everything below it
function Branch({ t, depth, ctx }) {
  const all = ctx.kids.get(t.id) || [];
  const list = all.filter((k) => ctx.visible.has(k.id));
  const expanded = ctx.isExp(t);
  return (
    <>
      <Row t={t} depth={depth} kidList={all} expanded={expanded} onToggle={() => ctx.toggle(t)} onOpen={ctx.onOpen} selected={ctx.sel.has(t.id)} onSelect={ctx.onSelect} />
      {expanded && (
        <>
          {list.map((k) => (<Branch key={k.id} t={k} depth={depth + 1} ctx={ctx} />))}
          {!ctx.filtering && (
            <div className="tg-row sub" style={{ paddingLeft: 40 + depth * 18 }}>
              <div className="tg-name"><AddRow label="Add subtask" onAdd={(n) => ctx.tk.addChild(t.id, { name: n })} /></div>
            </div>
          )}
        </>
      )}
    </>
  );
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
  const kids = useMemo(() => kidsMap(c ? c.tasks : []), [c]);
  // items that match the search and assignee filter; their parents stay visible so you can see where they live
  const matched = useMemo(() => {
    if (!c) return new Set();
    const ql = q.trim().toLowerCase();
    return new Set(c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql)) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who)))).map((t) => t.id));
  }, [c, q, who]);
  const filtering = !!q.trim() || who !== 'all';
  const shown = useMemo(() => (!c ? new Set() : filtering ? withAncestors(c.tasks, matched) : new Set(c.tasks.map((t) => t.id))), [c, matched, filtering]);
  const tasks = useMemo(() => (c ? c.tasks.filter((t) => shown.has(t.id)) : []), [c, shown]);
  // a selection belongs to one sprint and one view
  useEffect(() => { setSel(new Set()); last.current = null; }, [nav.sprintId, nav.sprintView]);
  if (!c) return <div className="card">This sprint no longer exists. Pick another from the left.</div>;

  const idx = S.sprints.findIndex((s) => s.id === c.id);
  const next = S.sprints[idx + 1];
  const leaves = leafTasks(c.tasks);
  const work = leaves.filter((t) => !typeOf(S, t.type).milestone); // milestones carry no effort
  const unfinished = leaves.filter((t) => isOpen(S, t));
  const outside = outsideSprint(S).filter((x) => x.sp.id === c.id).length;
  const H = sprintHours(S, c); // planned (typed) vs. work-item hours (live)
  const mine = sprintShares(S).rows.find((r) => r.sp.id === c.id); // this sprint's share of the project plan (planned hours / all planned hours)
  const cr = c.crId ? S.cr.find((x) => x.id === c.crId) : null;
  const hasPlan = H.planned != null && H.planned > 0;
  const left = hasPlan ? H.planned - H.items : null;
  const over = hasPlan && left < 0;
  const days = c.start && c.end ? Math.round((pd(c.end) - pd(c.start)) / DAY) + 1 : null;
  const missing = work.filter((t) => !t.effort).length;
  const assigned = leaves.filter((t) => (t.assignees || []).length).length;
  const pctA = leaves.length ? Math.round((assigned / leaves.length) * 100) : null;
  const tops = tasks.filter((t) => !t.parent);
  const groups = groupsOf(tops, by, S, !filtering);
  const view = nav.sprintView;
  const boardTasks = leaves.filter((t) => matched.has(t.id));

  // an item is expanded when you opened it, or when it has children and you did not close it
  const isExp = (t) => (exp[t.id] != null ? exp[t.id] : (kids.get(t.id) || []).length > 0);
  const toggle = (t) => setExp({ ...exp, [t.id]: !isExp(t) });
  const branchIds = (t) => [t.id].concat(isExp(t) ? (kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(branchIds) : []);
  const allBranchIds = (t) => [t.id].concat((kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(allBranchIds));

  // selection only counts items that are currently visible (search / assignee filters can hide some)
  const order = [];
  groups.forEach((g) => !shut[g.key] && g.tasks.forEach((t) => branchIds(t).forEach((id) => !order.includes(id) && order.push(id))));
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
          </>
          <span className={'chip-d' + (missing ? ' warnc' : '')}>{missing} not est</span>
          {cr && <button className={'pill ' + crCls(cr.status)} onClick={() => setNav({ view: 'project', tab: 'change' })} title="Open change control">{cr.code} · {cr.status}</button>}
        </div>
      </div>

      <section className="s-plan" aria-label="Sprint plan">
        <div className="sp-card">
          <span className="sp-l">Start date</span>
          <Cell value={c.start} type="date" cls="w-date" label="Sprint start" onCommit={(v) => v && tk.patchContainer(c.id, { start: v })} />
          <span className="sp-s">Editable</span>
        </div>
        <div className="sp-card">
          <span className="sp-l">End date</span>
          <Cell value={c.end} type="date" cls="w-date" label="Sprint end" onCommit={(v) => v && tk.patchContainer(c.id, { end: v })} />
          <span className="sp-s">{days ? days + ' day' + (days === 1 ? '' : 's') : 'Editable'}</span>
        </div>
        <div className={'sp-card' + (hasPlan ? '' : ' need')}>
          <span className="sp-l">Planned hours{hasPlan ? '' : ' · required'}</span>
          <Cell value={c.plannedHours} type="num" min={0} cls="sp-in n" placeholder="Enter hours" label="Planned hours" onCommit={(v) => tk.patchContainer(c.id, { plannedHours: v })} />
          <span className="sp-s">{hasPlan ? pc(mine ? mine.share : null, 1) + ' of the project plan · editable' : 'Enter how many hours this sprint can take'}</span>
        </div>
        <div className="sp-card">
          <span className="sp-l">Work item hours</span>
          <b className="sp-big mono">{hrsf(H.items)} h</b>
          <span className="sp-s">{H.n} item{H.n === 1 ? '' : 's'} · {hrsf(H.done)} h done · updates live</span>
          {hasPlan && <div className={'bar ' + (over ? 'bad' : 'good')} role="img" aria-label={pc(H.items / H.planned, 0) + ' of planned hours'}><i style={{ width: Math.min(100, (H.items / H.planned) * 100) + '%' }} /></div>}
        </div>
        <div className={'sp-card' + (over ? ' over' : '')}>
          <span className="sp-l">{!hasPlan ? 'Planned vs work items' : over ? 'Over plan by' : 'Still to plan'}</span>
          <b className="sp-big mono">{hasPlan ? hrsf(Math.abs(left)) + ' h' : '–'}</b>
          <span className="sp-s">{hasPlan ? pc(H.items / H.planned, 0) + ' of planned hours used' : 'Set planned hours to compare'}</span>
        </div>
      </section>

      <div className="vtabs" role="tablist">
        {[['list', 'List'], ['board', 'Board'], ['wbs', 'WBS']].map(([id, l]) => (
          <button key={id} className="vtab" role="tab" aria-selected={view === id} onClick={() => setNav({ sprintView: id })}>{l}</button>
        ))}
      </div>

      {view !== 'wbs' && (
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
      )}

      {view === 'list' && <BulkBar ids={chosen} container={c} onDone={() => { setSel(new Set()); last.current = null; }} />}

      {outside > 0 && (
        <div className="banner warn">
          <span>{outside} work item{outside > 1 ? 's are' : ' is'} dated outside this sprint ({fdate(c.start)} – {fdate(c.end)}). Dates after the sprint ends stretch the whole project timeline and budget.</span>
          <button className="btn" onClick={() => tk.alignDates(c.id)}>Move dates into the sprint</button>
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
        <div className="s-card"><span className={'s-ic ' + (c.tasks.length ? 'good' : 'warn')}>{c.tasks.length ? '✓' : '!'}</span><div><b>Work items</b><div className="msg">{c.tasks.length} planned{leaves.length !== c.tasks.length ? ' · ' + leaves.length + ' at the lowest level' : ''}</div></div></div>
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
                      all={g.tasks.length > 0 && g.tasks.flatMap(allBranchIds).every((id) => sel.has(id))}
                      some={g.tasks.flatMap(allBranchIds).some((id) => sel.has(id))}
                      onChange={(e) => setMany(g.tasks.flatMap(allBranchIds), e.target.checked)}
                      label={'Select all in ' + g.label}
                    />
                    <button className="x" onClick={() => setShut({ ...shut, [g.key]: !hide })} aria-label={hide ? 'Expand group' : 'Collapse group'}>{hide ? '▸' : '▾'}</button>
                    <span className="g-chip" style={{ background: g.color }}>{g.label}</span>
                    <span className="msg">{g.tasks.length}</span>
                  </div>
                  {!hide && g.tasks.map((t) => (
                    <Branch key={t.id} t={t} depth={0} ctx={{ kids, visible: shown, isExp, toggle, onOpen: setOpen, sel, onSelect: toggleOne, filtering, tk }} />
                  ))}
                  {!hide && <div className="tg-add"><AddRow onAdd={addTo(g.defaults)} /></div>}
                </div>
              );
            })}
            {!groups.length && <div className="empty">{filtering ? 'No tasks match your search or filter.' : 'No tasks yet. Use + Task to add the first one.'}</div>}
          </div>
        </div>
      ) : view === 'wbs' ? (
        <WbsTree ids={[c.id]} onOpen={setOpen} />
      ) : (
        <Board tasks={boardTasks} onOpen={setOpen} onAdd={(status, name) => tk.add(c.id, { name, status })} />
      )}

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
