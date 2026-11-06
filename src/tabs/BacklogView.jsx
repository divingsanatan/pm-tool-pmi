import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { BacklogIcon } from '../components/Bits';
import { AddChildMenu, AssigneeMenu, PriorityMenu, TagMenu, TypeMenu } from '../components/Pickers';
import { RollCell } from '../components/OwnValues';
import NameInput from '../components/NameInput';
import { useUI } from '../components/UI';
import { allTags, hasTag, typeOf } from '../lib/tasks';
import { hrsf, nz } from '../lib/format';
import { flatTree, kidsMap, leafTasks, rootTasks, subtreeIds, withAncestors } from '../lib/hier';
import TaskDrawer from './TaskDrawer';
import BulkBar from '../components/BulkBar';
import { useSelect } from '../lib/useSelect';
import { AddRow, TriBox } from '../components/ListBits';
import { groupsOf } from './SprintView';
import '../sprintlist.css';
import '../backlog.css';

function MoveMenu({ task, className = 'btn' }) {
  const { S } = useStore();
  const tk = useTasks();
  const items = S.sprints.length
    ? S.sprints.map((sp) => ({ label: sp.name, hint: sp.status === 'Not started' ? '' : sp.status, onClick: () => tk.move(task.id, sp.id) }))
    : [{ label: 'No sprints yet. Add one in the menu on the left.', disabled: true }];
  return <Menu className={className} label="Move to sprint ▾" title={'Move ' + task.name + ' to a sprint'} items={items} />;
}

// One backlog item. It works like a row of the Sprint list: the name is edited in place (Enter adds an item below,
// Tab / Shift+Tab indent and outdent, Alt+Up / Down reorder), drag the grip to reorder or drop onto an item to nest under it.
// A backlog item has no status or dates; those start when it is moved into a sprint.
function Row({ t, depth, kidList, expanded, onToggle, ctx, wbs }) {
  const tk = useTasks();
  const ui = useUI();
  const { S } = useStore();
  const { onOpen, sel, onSelect, drag, over, setDrag, setOver, drop, focus, ask, expand, tasks } = ctx;
  const selected = sel.has(t.id);
  const ty = typeOf(S, t.type);
  const parent = kidList.length > 0;
  const effortRolled = parent && kidList.some((k) => nz(k.effort) > 0);
  const milestone = ty.milestone;
  const cc = { tasks };
  const keys = {
    enter: () => ask({ id: tk.addSibling(t.id, { name: 'New ' + ty.label.toLowerCase() }), select: true }),
    indent: () => { tk.indent(t.id); ask({ id: t.id }); },
    outdent: () => { tk.outdent(t.id); ask({ id: t.id }); },
    up: () => { tk.moveUp(t.id); ask({ id: t.id }); },
    down: () => { tk.moveDown(t.id); ask({ id: t.id }); },
  };
  const addChild = () => { const id = tk.addChild(t.id, {}); expand(t.id); ask({ id, select: true }); };
  const actions = [
    { label: 'Open details', onClick: () => onOpen(t.id) },
    { label: 'Add child item', onClick: addChild },
    { label: 'Add item below', onClick: keys.enter },
    { sep: true },
    { label: 'Indent (make child of the item above)', onClick: keys.indent },
    { label: 'Outdent (move up one level)', disabled: !t.parent, onClick: keys.outdent },
    { label: 'Move up', onClick: keys.up },
    { label: 'Move down', onClick: keys.down },
    { sep: true },
    { label: 'Duplicate (with its children)', onClick: () => tk.duplicateMany([t.id]) },
    {
      label: 'Delete…',
      danger: true,
      onClick: () => {
        const n = subtreeIds(tasks, t.id).length - 1;
        ui.ask({
          title: 'Delete work item?',
          body: `“${t.name}”${n ? ' and its ' + n + ' child item' + (n > 1 ? 's' : '') : ''} will be permanently deleted.` + tk.depNote([t.id]),
          confirm: 'Delete',
          danger: true,
          onConfirm: () => tk.remove(t.id),
        });
      },
    },
  ];
  const dropCls = over && over.id === t.id ? ' drop-' + over.zone : '';
  return (
    <div
      className={'tg-row' + (selected ? ' sel' : '') + (parent ? ' par' : '') + (drag && drag.id === t.id ? ' dragging' : '') + dropCls}
      onDragOver={(e) => {
        if (!drag || drag.sub.has(t.id)) return;
        e.preventDefault();
        const b = e.currentTarget.getBoundingClientRect();
        const y = (e.clientY - b.top) / b.height;
        const zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
        if (!over || over.id !== t.id || over.zone !== zone) setOver({ id: t.id, zone });
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
      onDrop={(e) => {
        if (!over || over.id !== t.id) return;
        e.preventDefault();
        e.stopPropagation();
        drop(t, over.zone);
        setDrag(null);
        setOver(null);
      }}
    >
      <div className="c-wbs mono" title="WBS number">{wbs}</div>
      <div className="tg-name" style={depth ? { paddingLeft: depth * 18 } : undefined}>
        <span
          className="w-grip"
          draggable
          title="Drag to reorder, or drop onto an item to nest under it"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
            const row = e.currentTarget.closest('.tg-row');
            if (row) e.dataTransfer.setDragImage(row, 12, 12);
            setDrag({ id: t.id, sub: new Set(subtreeIds(tasks, t.id)) });
          }}
          onDragEnd={() => { setDrag(null); setOver(null); }}
        >⋮⋮</span>
        <input type="checkbox" className="tg-sel" checked={selected} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
        {parent ? (
          <button className="x tg-exp" onClick={onToggle} aria-expanded={!!expanded} aria-label={expanded ? 'Hide child items' : 'Show child items'} title={expanded ? 'Collapse' : 'Expand'}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        ) : (
          <span className="w-exp sp" aria-hidden="true" />
        )}
        <TypeMenu task={t} size={16} />
        <NameInput t={t} focus={focus} bold={parent} done={false} keys={keys} wrap>
          <span className="tags-inline"><TagMenu task={t} inline max={99} /></span>
        </NameInput>
        {parent && <span className="subc" title="Direct child items">⑂ {kidList.length}</span>}
        <AddChildMenu parent={t} onAdded={(id) => { expand(t.id); ask({ id, select: true }); }} />
      </div>
      <div className="c-ass"><AssigneeMenu task={t} /></div>
      <div className="c-pri"><PriorityMenu task={t} /></div>
      <div className="c-eff">
        {effortRolled ? (
          <RollCell task={t} c={cc} kind="effort" />
        ) : parent ? (
          <Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" min={0} placeholder={milestone ? '' : '–'} disabled={milestone} onCommit={(v) => tk.patchOwn(t.id, { effort: v })} />
        ) : (
          <Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" min={0} placeholder={milestone ? '' : '–'} disabled={milestone} onCommit={(v) => tk.patch(t.id, { effort: v })} />
        )}
      </div>
      <div className="c-move">{!t.parent && <MoveMenu task={t} />}</div>
      <div className="c-open">
        <button className="x" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button>
        <Menu className="x" label="⋯" title="More actions" items={actions} />
      </div>
    </div>
  );
}

// a backlog item and, when expanded, everything below it
function Branch({ t, depth, ctx }) {
  const all = ctx.kids.get(t.id) || [];
  const list = all.filter((k) => ctx.visible.has(k.id));
  const expanded = ctx.isExp(t);
  return (
    <>
      <Row t={t} depth={depth} kidList={all} expanded={expanded} onToggle={() => ctx.toggle(t)} ctx={ctx} wbs={ctx.wbsOf.get(t.id) || ''} />
      {expanded && list.map((k) => (<Branch key={k.id} t={k} depth={depth + 1} ctx={ctx} />))}
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
  const [fg, setFg] = useState('all'); // tag filter
  const ui = useUI();
  // "Filter by tag" in a tag's editor sets the Tag filter here too
  useEffect(() => {
    const f = (e) => e.detail && setFg(e.detail);
    window.addEventListener('sc-tag-filter', f);
    return () => window.removeEventListener('sc-tag-filter', f);
  }, []);
  // a tag that was renamed or deleted can no longer be filtered on
  useEffect(() => { if (fg !== 'all' && fg !== 'none' && !allTags(S).some((g) => g.toLowerCase() === fg.toLowerCase())) setFg('all'); }, [S, fg]);
  const [open, setOpen] = useState(null);
  const [exp, setExp] = useState({});
  const [shut, setShut] = useState({});
  const [focus, setFocus] = useState(null); // name box to focus after an item is added or moved
  const [drag, setDrag] = useState(null); // { id, sub } while a row is dragged
  const [over, setOver] = useState(null); // { id, zone } the row it is over
  const people = S.people.filter((p) => p.name);

  const kids = useMemo(() => kidsMap(c.tasks), [c]);
  const filtering = !!q.trim() || who !== 'all' || fg !== 'all';
  // items matching the search, assignee and tag filters; their parents stay visible so you can see where they live
  const shown = useMemo(() => {
    if (!filtering) return new Set(c.tasks.map((t) => t.id));
    const ql = q.trim().toLowerCase();
    const hit = c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql) || (t.tags || []).some((g) => g.toLowerCase().includes(ql.replace(/^#/, '')))) && (fg === 'all' || (fg === 'none' ? !(t.tags || []).length : hasTag(t, fg))) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who)))).map((t) => t.id);
    return withAncestors(c.tasks, hit);
  }, [c, q, who, fg, filtering]);
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
  const ask = (f) => setFocus({ ...f, n: Date.now() });
  const expand = (id) => setExp((e) => ({ ...e, [id]: true }));
  const wbsOf = new Map(flatTree(c.tasks).map((r) => [r.t.id, r.wbs]));
  const drop = (target, zone) => {
    if (!drag) return;
    if (zone === 'inside') {
      tk.place(drag.id, { parent: target.id });
      expand(target.id);
    } else tk.place(drag.id, { parent: target.parent || '', ref: target.id, pos: zone });
  };
  const branchIds = (t) => [t.id].concat(isExp(t) ? (kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(branchIds) : []);
  const allBranchIds = (t) => [t.id].concat((kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap(allBranchIds));
  const order = [];
  groups.forEach((g) => !shut[g.key] && g.tasks.forEach((t) => branchIds(t).forEach((id) => !order.includes(id) && order.push(id))));
  // selecting a parent selects every work item below it (collapsed or not), as in the sprint list; clearing it clears them too
  const pick = useSelect(tasks.map((t) => t.id), order, S.id, (id) => subtreeIds(c.tasks, id).filter((x) => shown.has(x)));

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
      <p className="msg wbs-help">Click a name to edit it · Enter adds an item below · Tab / Shift+Tab indent and outdent · Alt+↑ / ↓ reorder · drag ⋮⋮ to reorder or drop onto an item to nest · ＋ adds a child item · Σ hours add up from the child items. Move a top-level item to a sprint with its children.</p>

      <div className="tools">
        <input className="c" style={{ maxWidth: 190 }} type="search" placeholder="Search the backlog" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the backlog" />
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
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Tag
          <select className="c" value={fg} onChange={(e) => setFg(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by tag">
            <option value="all">All tags</option><option value="none">No tags</option>
            {allTags(S).map((g) => (<option key={g} value={g}>{g}</option>))}
          </select>
        </label>
        <button className="btn" onClick={() => ui.openTags()} title="Rename, recolor and delete the project's tags">Manage tags</button>
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
        <div className="tg sp bk wrapn no-tags">
          <div className="tg-row tg-h"><div className="h-wbs">WBS</div><div className="tg-name"><TriBox all={tasks.length > 0 && pick.chosen.length === tasks.length} some={pick.chosen.length > 0} onChange={(e) => pick.setMany(tasks.map((t) => t.id), e.target.checked)} label="Select all work items" />Name</div><div className="h-assignee">Assignee</div><div className="h-priority">Priority</div><div className="h-effort">Effort (h)</div><div className="h-move">Sprint</div><div className="h-open" /></div>
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
                  <Branch key={t.id} t={t} depth={0} ctx={{ kids, visible: shown, isExp, toggle, onOpen: setOpen, sel: pick.sel, onSelect: pick.toggleOne, filtering, tk, wbsOf, drag, over, setDrag, setOver, drop, focus, ask, expand, tasks: c.tasks }} />
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
