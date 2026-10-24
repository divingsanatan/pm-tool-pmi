import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { BacklogIcon } from '../components/Bits';
import { AssigneeMenu, PriorityMenu, TypeMenu } from '../components/Pickers';
import { typeOf } from '../lib/tasks';
import { hrsf, nz } from '../lib/format';
import { kidsMap, leafTasks, rootTasks, withAncestors } from '../lib/hier';
import TaskDrawer from './TaskDrawer';
import BulkBar from '../components/BulkBar';
import WbsTree from '../components/WbsTree';
import { useSelect } from '../lib/useSelect';
import { AddRow, TriBox } from '../components/ListBits';
import { groupsOf } from './SprintView';

function MoveMenu({ task, className = 'btn' }) {
  const { S } = useStore();
  const tk = useTasks();
  const items = S.sprints.length
    ? S.sprints.map((sp) => ({ label: sp.name, hint: sp.status === 'Not started' ? '' : sp.status, onClick: () => tk.move(task.id, sp.id) }))
    : [{ label: 'No sprints yet. Add one in the menu on the left.', disabled: true }];
  return <Menu className={className} label="Move to sprint ▾" title={'Move ' + task.name + ' to a sprint'} items={items} />;
}

function Row({ t, depth, kidList, expanded, onToggle, onOpen, selected, onSelect }) {
  const tk = useTasks();
  const { S } = useStore();
  const parent = kidList.length > 0;
  const effortRolled = parent && kidList.some((k) => nz(k.effort) > 0);
  const milestone = typeOf(S, t.type).milestone;
  return (
    <div className={'tg-row' + (selected ? ' sel' : '') + (parent ? ' par' : '')}>
      <div className="tg-name" style={depth ? { paddingLeft: depth * 18 } : undefined}>
        <input type="checkbox" className="tg-sel" checked={selected} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
        <button className="x tg-exp" onClick={onToggle} aria-label={expanded ? 'Hide child items' : 'Show child items'} title={parent ? (expanded ? 'Collapse' : 'Expand') : 'Add a child item'}>{expanded ? '▾' : '▸'}</button>
        <TypeMenu task={t} size={16} />
        <button className={'tg-title' + (parent ? ' bold' : '')} onClick={() => onOpen(t.id)} title="Open work item">{t.name}</button>
        {parent && <span className="subc" title="Direct child items">⑂ {kidList.length}</span>}
      </div>
      <div className="c-ass"><AssigneeMenu task={t} /></div>
      <div className="c-pri"><PriorityMenu task={t} /></div>
      <div className="c-eff">
        {effortRolled ? (
          <span className="cell roll n w-sm" title="Rolled up from child items">Σ {hrsf(t.effort)}</span>
        ) : (
          <Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" min={0} placeholder={milestone ? '' : '–'} disabled={milestone} onCommit={(v) => tk.patch(t.id, { effort: v })} />
        )}
      </div>
      <div className="c-move">{!t.parent && <MoveMenu task={t} />}</div>
      <div className="c-open"><button className="x" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button></div>
    </div>
  );
}

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
              <div className="tg-name"><AddRow label="Add child item" onAdd={(n) => ctx.tk.addChild(t.id, { name: n })} /></div>
            </div>
          )}
        </>
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

  const kids = useMemo(() => kidsMap(c.tasks), [c]);
  const filtering = !!q.trim() || who !== 'all';
  // items matching the search and assignee filter; their parents stay visible so you can see where they live
  const shown = useMemo(() => {
    if (!filtering) return new Set(c.tasks.map((t) => t.id));
    const ql = q.trim().toLowerCase();
    const hit = c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql)) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who)))).map((t) => t.id);
    return withAncestors(c.tasks, hit);
  }, [c, q, who, filtering]);
  const tasks = useMemo(() => c.tasks.filter((t) => shown.has(t.id)), [c, shown]);

  const leaves = leafTasks(c.tasks);
  const work = leaves.filter((t) => !typeOf(S, t.type).milestone);
  const totalH = rootTasks(c.tasks).reduce((a, t) => a + (t.effort || 0), 0); // top-level items already hold their children's hours
  const missing = work.filter((t) => !t.effort).length;
  const assigned = leaves.filter((t) => (t.assignees || []).length).length;
  const pctA = leaves.length ? Math.round((assigned / leaves.length) * 100) : null;
  const tops = tasks.filter((t) => !t.parent);
  const groups = groupsOf(tops, by, S, false);
  const addTo = (defaults) => (name) => tk.add('backlog', { name, ...defaults });
  const isExp = (t) => (exp[t.id] != null ? exp[t.id] : (kids.get(t.id) || []).length > 0);
  const toggle = (t) => setExp({ ...exp, [t.id]: !isExp(t) });
  const branchIds = (t) => [t.id].concat(isExp(t) ? (kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(branchIds) : []);
  const allBranchIds = (t) => [t.id].concat((kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(allBranchIds));
  const order = [];
  groups.forEach((g) => !shut[g.key] && g.tasks.forEach((t) => branchIds(t).forEach((id) => !order.includes(id) && order.push(id))));
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
                      all={g.tasks.length > 0 && g.tasks.flatMap(allBranchIds).every((id) => pick.sel.has(id))}
                      some={g.tasks.flatMap(allBranchIds).some((id) => pick.sel.has(id))}
                      onChange={(e) => pick.setMany(g.tasks.flatMap(allBranchIds), e.target.checked)}
                      label={'Select all in ' + g.label}
                    />
                    <button className="x" onClick={() => setShut({ ...shut, [g.key]: !hide })} aria-label={hide ? 'Expand group' : 'Collapse group'}>{hide ? '▸' : '▾'}</button>
                    <span className="g-chip" style={{ background: g.color }}>{g.label}</span>
                    <span className="msg">{g.tasks.length}</span>
                  </div>
                )}
                {!hide && g.tasks.map((t) => (
                  <Branch key={t.id} t={t} depth={0} ctx={{ kids, visible: shown, isExp, toggle, onOpen: setOpen, sel: pick.sel, onSelect: pick.toggleOne, filtering, tk }} />
                ))}
              </div>
            );
          })}
          {!groups.length && <div className="empty">{filtering ? 'No work items match your search or filter.' : 'The backlog is empty. Add work items here and move them into a sprint when you are ready to plan them.'}</div>}
          {!filtering && <div className="tg-add"><AddRow label="Add to backlog" onAdd={addTo({})} /></div>}
        </div>
      </div>

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
