import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from './UI';
import { Cell } from './Field';
import Menu from './Menu';
import { AddRow } from './ListBits';
import { BacklogIcon, SprintIcon, StatusIcon } from './Bits';
import { AddChildMenu, AssigneeMenu, StatusMenu, TypeMenu } from './Pickers';
import { containerById, isDoneStatus, statusOf, statusPct, typeOf, typesOf } from '../lib/tasks';
import { flatTree, kidsMap, subtreeIds, summarize, withAncestors } from '../lib/hier';
import { fdate, today } from '../lib/dates';
import { hrsf, nz, pc } from '../lib/format';

// The name of a work item, edited in place. Enter adds a sibling below, Tab / Shift+Tab indent / outdent, Alt+Up / Down reorder.
function NameInput({ t, focus, bold, done, keys }) {
  const tk = useTasks();
  const [v, setV] = useState(t.name);
  const ref = useRef(null);
  useEffect(() => setV(t.name), [t.name]);
  useEffect(() => {
    if (focus && focus.id === t.id && ref.current) {
      ref.current.focus();
      if (focus.select) ref.current.select();
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = v.trim();
    if (n && n !== t.name) tk.patch(t.id, { name: n });
    else setV(t.name);
  };
  return (
    <input
      ref={ref}
      className={'c w-in' + (bold ? ' bold' : '') + (done ? ' done' : '')}
      value={v}
      aria-label="Work item name"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          keys.enter();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commit();
          e.shiftKey ? keys.outdent() : keys.indent();
        } else if (e.altKey && e.key === 'ArrowUp') {
          e.preventDefault();
          commit();
          keys.up();
        } else if (e.altKey && e.key === 'ArrowDown') {
          e.preventDefault();
          commit();
          keys.down();
        } else if (e.key === 'Escape') {
          setV(t.name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Work breakdown structure as a tree. ids = the sprint(s) / Backlog to show; with several, each gets a header row.
export default function WbsTree({ ids, onOpen }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const [col, setCol] = useState(() => new Set()); // collapsed ids (work items and whole sprints)
  const [q, setQ] = useState('');
  const [ft, setFt] = useState('all');
  const [lvl, setLvl] = useState(0);
  const [focus, setFocus] = useState(null);
  const [drag, setDrag] = useState(null); // { id, cid, sub }
  const [over, setOver] = useState(null); // { id, zone }

  const conts = ids.map((id) => containerById(S, id)).filter(Boolean);
  const multi = conts.length > 1;
  const types = typesOf(S);
  const ql = q.trim().toLowerCase();
  const filtering = !!ql || ft !== 'all';
  const maxDepth = lvl || Infinity;
  const ask = (f) => setFocus({ ...f, n: Date.now() });

  const parts = useMemo(
    () =>
      conts.map((c) => {
        const hit = filtering ? new Set(c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql) || t.code.toLowerCase().includes(ql)) && (ft === 'all' || t.type === ft)).map((t) => t.id)) : null;
        const keep = hit ? withAncestors(c.tasks, hit) : null;
        const prefix = multi ? (c.id === 'backlog' ? 'B' : String(S.sprints.findIndex((s) => s.id === c.id) + 1)) : '';
        const rows = col.has(c.id) ? [] : flatTree(c.tasks, { prefix, collapsed: col, keep, maxDepth });
        return { c, hit, rows, prefix, sum: summarize(S, c) };
      }),
    [S, ids.join('|'), col, ql, ft, lvl] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const toggle = (id) => setCol((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setCol(new Set());
  const collapseAll = () => setCol(new Set(conts.flatMap((c) => [...kidsMap(c.tasks).keys()].filter(Boolean))));

  const drop = (target, zone) => {
    if (!drag) return;
    if (zone === 'inside') {
      tk.place(drag.id, { parent: target.id });
      setCol((p) => { const n = new Set(p); n.delete(target.id); return n; });
    } else tk.place(drag.id, { parent: target.parent || '', ref: target.id, pos: zone });
  };

  const addRoot = (c) => ask({ id: tk.add(c.id, { name: 'New task' }), select: true });

  const renderRow = (c, r, hit) => {
    const t = r.t;
    const back = c.id === 'backlog';
    const parent = r.kids > 0;
    const ty = typeOf(S, t.type);
    const effortRolled = parent && r.list.some((k) => nz(k.effort) > 0);
    const datesRolled = parent && !back && r.list.some((k) => k.start || k.due);
    const done = !back && isDoneStatus(S, t.status);
    const late = !back && !done && t.due && t.due < today();
    const pct = back ? null : parent ? nz(t.pct) : statusPct(S, t.status);
    const expanded = parent && !col.has(t.id) && r.depth + 1 < maxDepth;
    const dropCls = over && over.id === t.id ? ' drop-' + over.zone : '';
    const keys = {
      enter: () => ask({ id: tk.addSibling(t.id, { name: 'New ' + ty.label.toLowerCase() }), select: true }),
      indent: () => { tk.indent(t.id); ask({ id: t.id }); },
      outdent: () => { tk.outdent(t.id); ask({ id: t.id }); },
      up: () => { tk.moveUp(t.id); ask({ id: t.id }); },
      down: () => { tk.moveDown(t.id); ask({ id: t.id }); },
    };
    const actions = [
      { label: 'Open details', onClick: () => onOpen(t.id) },
      { label: 'Add child item', onClick: () => { const id = tk.addChild(t.id, {}); setCol((p) => { const n = new Set(p); n.delete(t.id); return n; }); ask({ id, select: true }); } },
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
          const n = subtreeIds(c.tasks, t.id).length - 1;
          ui.ask({
            title: 'Delete work item?',
            body: `“${t.name}”${n ? ' and its ' + n + ' child item' + (n > 1 ? 's' : '') : ''} will be permanently deleted.`,
            confirm: 'Delete',
            danger: true,
            onConfirm: () => tk.remove(t.id),
          });
        },
      },
    ];
    return (
      <div
        key={t.id}
        className={'wbs-row' + (parent ? ' par' : '') + (hit && !hit.has(t.id) ? ' ctx' : '') + (drag && drag.id === t.id ? ' dragging' : '') + dropCls}
        onDragOver={(e) => {
          if (!drag || drag.cid !== c.id || drag.sub.has(t.id)) return;
          e.preventDefault();
          const b = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - b.top) / b.height;
          const zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
          if (!over || over.id !== t.id || over.zone !== zone) setOver({ id: t.id, zone });
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
        onDrop={(e) => {
          e.preventDefault();
          if (over && over.id === t.id) drop(t, over.zone);
          setDrag(null);
          setOver(null);
        }}
      >
        <div className="w-code mono" title="WBS number">{r.wbs}</div>
        <div className="w-name">
          <span
            className="w-grip"
            draggable
            title="Drag to reorder, or drop onto an item to nest under it"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', t.id);
              const row = e.currentTarget.closest('.wbs-row');
              if (row) e.dataTransfer.setDragImage(row, 12, 12);
              setDrag({ id: t.id, cid: c.id, sub: new Set(subtreeIds(c.tasks, t.id)) });
            }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
          >⋮⋮</span>
          {Array.from({ length: r.depth }, (_, i) => (<i key={i} className="w-gd" />))}
          {parent ? (
            <button className="x w-exp" onClick={() => toggle(t.id)} aria-label={expanded ? 'Collapse' : 'Expand'}>{expanded ? '▾' : '▸'}</button>
          ) : (
            <span className="w-exp sp" />
          )}
          <TypeMenu task={t} size={16} />
          <NameInput t={t} focus={focus} bold={parent} done={done} keys={keys} />
          {parent && <span className="subc" title="Direct child items">⑂ {r.kids}</span>}
          <AddChildMenu parent={t} onAdded={(id) => { setCol((p) => { const n = new Set(p); n.delete(t.id); return n; }); ask({ id, select: true }); }} />
          <button className="x w-open" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button>
        </div>
        <div className="w-c"><AssigneeMenu task={t} size={20} /></div>
        <div className="w-c">
          {back ? <span className="msg">–</span> : datesRolled ? <span className="cell roll" title="Rolled up from child items">Σ {t.start ? fdate(t.start) : '–'}</span> : <Cell value={t.start} type="date" cls="w-date" label="Start date" disabled={ty.milestone} onCommit={(v) => tk.patch(t.id, { start: v })} />}
        </div>
        <div className="w-c">
          {back ? <span className="msg">–</span> : datesRolled ? <span className={'cell roll' + (late ? ' od' : '')} title="Rolled up from child items">Σ {t.due ? fdate(t.due) : '–'}</span> : <Cell value={t.due} type="date" cls={'w-date' + (late ? ' od' : '')} label={ty.milestone ? 'Date' : 'Due date'} onCommit={(v) => tk.patch(t.id, { due: v })} />}
        </div>
        <div className="w-c">
          {effortRolled ? <span className="cell roll n w-sm" title="Rolled up from child items">Σ {hrsf(t.effort)}</span> : <Cell value={t.effort} type="num" cls="n w-sm" label="Effort in hours" min={0} placeholder={ty.milestone ? '' : '–'} disabled={ty.milestone} onCommit={(v) => tk.patch(t.id, { effort: v })} />}
        </div>
        <div className="w-c w-pct">
          {pct == null ? <span className="msg">–</span> : (<><div className="bar"><i style={{ width: Math.min(100, pct * 100) + '%' }} /></div><span className="mono">{pc(pct, 0)}</span></>)}
        </div>
        <div className="w-c w-st">
          {back ? <span className="msg">–</span> : parent ? (<span title="Status is calculated from its child items"><StatusIcon status={statusOf(S, t.status)} size={16} /> <span className="msg">{statusOf(S, t.status).label}</span></span>) : (<><StatusMenu task={t} /><span className="msg">{statusOf(S, t.status).label}</span></>)}
        </div>
        <div className="w-c"><Menu className="x" label="⋯" title="More actions" items={actions} /></div>
      </div>
    );
  };

  const empty = parts.every((p) => !p.c.tasks.length);

  return (
    <div className="wbs">
      <div className="tools">
        <input className="c" style={{ maxWidth: 220 }} type="search" placeholder="Search work items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search work items" />
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Type
          <select className="c" value={ft} onChange={(e) => setFt(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by type">
            <option value="all">All types</option>
            {types.map((x) => (<option key={x.id} value={x.id}>{x.label}</option>))}
          </select>
        </label>
        <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          Show
          <select className="c" value={lvl} onChange={(e) => setLvl(parseInt(e.target.value, 10))} style={{ width: 'auto' }} aria-label="Levels to show">
            <option value={0}>All levels</option><option value={1}>Level 1</option><option value={2}>Down to level 2</option><option value={3}>Down to level 3</option><option value={4}>Down to level 4</option>
          </select>
        </label>
        <button className="btn" onClick={expandAll}>Expand all</button>
        <button className="btn" onClick={collapseAll}>Collapse all</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={ui.openTypes} title="Add or edit work item types">Types</button>
        <button className="btn" onClick={ui.openStatuses} title="Add or edit statuses">Statuses</button>
        {!multi && conts[0] && <button className="btn primary" onClick={() => addRoot(conts[0])}>+ Item</button>}
      </div>
      <p className="msg wbs-help">Enter adds an item below · Tab / Shift+Tab indent and outdent · Alt+↑ / ↓ reorder · drag ⋮⋮ to reorder or drop onto an item to nest · Σ values add up from the child items.</p>

      <div className="scroll wbs-scroll">
        <div className="wbs-grid">
          <div className="wbs-row wbs-h">
            <div>WBS</div><div>Work item</div><div>Assignee</div><div>Start</div><div>Due</div><div>Effort (h)</div><div>Progress</div><div>Status</div><div />
          </div>
          {parts.map(({ c, hit, rows, prefix, sum }) => (
            <div key={c.id} className="wbs-sec">
              {multi && (
                <div className="wbs-row wbs-phase">
                  <div className="w-code mono">{prefix}</div>
                  <div className="w-name">
                    <button className="x w-exp" onClick={() => toggle(c.id)} aria-label={col.has(c.id) ? 'Expand ' + c.name : 'Collapse ' + c.name}>{col.has(c.id) ? '▸' : '▾'}</button>
                    {c.id === 'backlog' ? <BacklogIcon /> : <SprintIcon status={c.status} />}
                    <b>{c.name}</b>
                    <span className="msg">{sum.items} item{sum.items === 1 ? '' : 's'}</span>
                  </div>
                  <div />
                  <div className="w-c msg">{sum.start ? fdate(sum.start) : ''}</div>
                  <div className="w-c msg">{sum.end ? fdate(sum.end) : ''}</div>
                  <div className="w-c mono">{hrsf(sum.hrs)}</div>
                  <div className="w-c w-pct">{sum.pct == null ? null : (<><div className="bar"><i style={{ width: Math.min(100, sum.pct * 100) + '%' }} /></div><span className="mono">{pc(sum.pct, 0)}</span></>)}</div>
                  <div /><div />
                </div>
              )}
              {rows.map((r) => renderRow(c, r, hit))}
              {!col.has(c.id) && !filtering && (
                <div className="wbs-add"><AddRow label="Add item" onAdd={(n) => ask({ id: tk.add(c.id, { name: n }) })} /></div>
              )}
              {!multi && (
                <div className="wbs-row wbs-tot">
                  <div /><div className="w-name"><b>Total</b> <span className="msg">{sum.items} work item{sum.items === 1 ? '' : 's'} · {sum.leaves} at the lowest level</span></div>
                  <div /><div className="w-c msg">{sum.start ? fdate(sum.start) : ''}</div><div className="w-c msg">{sum.end ? fdate(sum.end) : ''}</div>
                  <div className="w-c mono">{hrsf(sum.hrs)}</div>
                  <div className="w-c w-pct">{sum.pct == null ? null : (<><div className="bar"><i style={{ width: Math.min(100, sum.pct * 100) + '%' }} /></div><span className="mono">{pc(sum.pct, 0)}</span></>)}</div>
                  <div /><div />
                </div>
              )}
            </div>
          ))}
          {empty && <div className="empty">No work items yet. Add the first one, then press Tab to nest items under each other.</div>}
          {!empty && filtering && parts.every((p) => !p.rows.length) && <div className="empty">No work items match.</div>}
        </div>
      </div>
    </div>
  );
}
