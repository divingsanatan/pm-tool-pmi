import { useEffect, useMemo, useRef, useState } from 'react';
import { dateCrOf, hoursCrOf, hoursLocked, inBaseline, sprintOverlaps } from '../lib/sprintGuard';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import { SprintIcon, StatusIcon } from '../components/Bits';
import { AddChildMenu, AssigneeMenu, PriorityMenu, StatusMenu, TypeMenu } from '../components/Pickers';
import { AddRow, TriBox } from '../components/ListBits';
import { PRIORITIES, SPRINT_STATUSES, containerById, isDoneStatus, isOpen, priorityOf, statusOf, statusPct, statusesOf, typeOf, typesOf } from '../lib/tasks';
import { fdate, today } from '../lib/dates';
import { outsideSprint, sprintEvm, stCls } from '../lib/calc';
import { hrsf, money, nz, pc } from '../lib/format';
import { crCls, currentBaseline, signedMoney } from '../lib/change';
import { flatTree, kidsMap, leafTasks, rootTasks, subtreeIds, summarize, withAncestors } from '../lib/hier';
import '../sprintlist.css';
import { WEEKDAYS_SHORT, calendarOf, sprintDayList } from '../lib/offdays';
import BulkBar from '../components/BulkBar';
import NameInput from '../components/NameInput';
import TaskDrawer from './TaskDrawer';
import ChangeDrawer from './ChangeDrawer';
import DateChangeDialog from '../components/DateChangeDialog';
import Board from './Board';
import '../offdays.css';

export { AddRow, TriBox };

// One work item in the list: the full work breakdown row. Items with children are parents: their hours, dates, progress and status are roll-ups.
// The name is edited in place (Enter adds an item below, Tab / Shift+Tab indent and outdent, Alt+Up / Down reorder);
// drag the grip to reorder, or drop onto an item to nest under it.
function Row({ t, depth, kidList, expanded, onToggle, ctx, wbs }) {
  const tk = useTasks();
  const ui = useUI();
  const { S } = useStore();
  const { onOpen, sel, onSelect, drag, over, setDrag, setOver, drop, focus, ask, expand, tasks } = ctx;
  const selected = sel.has(t.id);
  const ty = typeOf(S, t.type);
  const done = isDoneStatus(S, t.status);
  const late = !done && t.due && t.due < today();
  const parent = kidList.length > 0;
  const effortRolled = parent && kidList.some((k) => nz(k.effort) > 0);
  const datesRolled = parent && kidList.some((k) => k.start || k.due);
  const kidsDone = kidList.filter((k) => isDoneStatus(S, k.status)).length;
  const milestone = ty.milestone;
  const pct = parent ? nz(t.pct) : statusPct(S, t.status);
  const st = statusOf(S, t.status);
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
          body: `“${t.name}”${n ? ' and its ' + n + ' child item' + (n > 1 ? 's' : '') : ''} will be permanently deleted.`,
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
        e.preventDefault();
        if (over && over.id === t.id) drop(t, over.zone);
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
          <button className="x tg-exp" onClick={onToggle} aria-label={expanded ? 'Hide child items' : 'Show child items'} title={expanded ? 'Collapse' : 'Expand'}>{expanded ? '▾' : '▸'}</button>
        ) : (
          <span className="w-exp sp" aria-hidden="true" />
        )}
        <TypeMenu task={t} size={16} />
        {parent ? (
          <span className="x st-btn ro" title="Status is calculated from its child items"><StatusIcon status={st} /></span>
        ) : (
          <StatusMenu task={t} />
        )}
        <NameInput t={t} focus={focus} bold={parent} done={done} keys={keys} />
        {parent && <span className="subc" title="Direct child items done">⑂ {kidsDone}/{kidList.length}</span>}
        <AddChildMenu parent={t} onAdded={(id) => { expand(t.id); ask({ id, select: true }); }} />
      </div>
      <div className="c-ass"><AssigneeMenu task={t} /></div>
      <div className="c-start">
        {datesRolled ? (
          <span className="cell roll" title="Rolled up from child items">Σ {t.start ? fdate(t.start) : '–'}</span>
        ) : (
          <Cell value={t.start} type="date" cls="w-date" label="Start date" disabled={milestone} onCommit={(v) => tk.patch(t.id, { start: v })} />
        )}
      </div>
      <div className="c-due">
        {datesRolled ? (
          <span className={'cell roll' + (late ? ' od' : '')} title="Rolled up from child items">Σ {t.due ? fdate(t.due) : '–'}</span>
        ) : (
          <Cell value={t.due} type="date" cls={'w-date' + (late ? ' od' : '')} label={milestone ? 'Date' : 'Due date'} onCommit={(v) => tk.patch(t.id, { due: v })} />
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
      <div className="c-pct w-pct">
        {pct == null ? <span className="msg">–</span> : (<><div className="bar"><i style={{ width: Math.min(100, pct * 100) + '%' }} /></div><span className="mono">{pc(pct, 0)}</span></>)}
      </div>
      <div className="c-st msg" title={parent ? 'Status is calculated from its child items' : undefined}>{st.label}</div>
      <div className="c-open">
        <button className="x" onClick={() => onOpen(t.id)} aria-label="Open details" title="Open details">⤢</button>
        <Menu className="x" label="⋯" title="More actions" items={actions} />
      </div>
    </div>
  );
}

// a work item and, when expanded, everything below it
function Branch({ t, depth, ctx }) {
  const all = ctx.kids.get(t.id) || [];
  const list = all.filter((k) => ctx.visible.has(k.id));
  const expanded = ctx.isExp(t) && depth + 1 < ctx.maxDepth;
  return (
    <>
      <Row t={t} depth={depth} kidList={all} expanded={expanded} onToggle={() => ctx.toggle(t)} ctx={ctx} wbs={ctx.wbsOf.get(t.id) || ''} />
      {expanded && (
        <>
          {list.map((k) => (<Branch key={k.id} t={k} depth={depth + 1} ctx={ctx} />))}
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

// One tile of the sprint panel. Every tile has the same label, value and note styles, so the row lines up.
// 18-Oct-2026, the same look as the date boxes
const longDate = (d) => (d ? new Date(Date.parse(d + 'T00:00:00Z')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : '–');

function Tile({ l, s, cls = '', vcls = '', title, children, bar }) {
  return (
    <div className={'kpi sp-t ' + cls} title={title}>
      <div className="l">{l}</div>
      <div className={'v ' + vcls}>{children}</div>
      {s != null && <div className="s">{s}</div>}
      {bar}
    </div>
  );
}
const Bar = ({ f, tone, label }) => <div className={'bar ' + (tone || '')} role="img" aria-label={label}><i style={{ width: Math.max(0, Math.min(100, f * 100)) + '%' }} /></div>;
const ratio = (v) => (v == null ? '–' : v.toFixed(2) + ' (' + Math.round(v * 100) + '%)');

// Off days of one sprint, for viewing only. Weekly off days and holidays are managed in the project's Working calendar
// (Budget tab), so nothing here is clickable: the strip just shows which days of the sprint are working and which are off.
function OffDays({ c, E }) {
  const { S, setNav } = useStore();
  const list = sprintDayList(c, calendarOf(S));
  if (!list.length) return null;
  const now = today();
  const parts = [E.offWeekly && E.offWeekly + ' weekly off', E.offHoliday && E.offHoliday + ' holiday' + (E.offHoliday === 1 ? '' : 's')].filter(Boolean);
  return (
    <div className="card od-card">
      <div className="row sp" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 className="sp-h" style={{ margin: 0 }}>Off days · {E.offN} of {E.calDays}{parts.length ? ' (' + parts.join(', ') + ')' : ''}</h3>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            Planned % counts the <b>{E.days}</b> working day{E.days === 1 ? '' : 's'} only: {E.calDays} calendar − {E.offN} off. Weekly off days and holidays come from the project&apos;s Working calendar (Budget tab) and are shown here for reference.
            Work can still be planned on an off day, but you will see a warning.
          </p>
        </div>
        <button className="btn" onClick={() => setNav({ view: 'project', tab: 'budget' })}>Open Working calendar</button>
      </div>
      <div className="od-strip" role="list" aria-label="Days of the sprint">
        {list.map((d) => (
          <div
            key={d.date}
            role="listitem"
            className={'od ro' + (d.off ? ' off' : '') + (d.locked ? ' lock' : '') + (d.date === now ? ' today' : '') + (d.dow === 0 || d.dow === 6 ? ' we' : '')}
            title={fdate(d.date) + (d.kind === 'holiday' ? ' \u00b7 holiday: ' + d.label : d.kind === 'weekly' ? ' \u00b7 weekly off day' : ' \u00b7 working day')}
          >
            <span>{WEEKDAYS_SHORT[d.dow]}</span>
            <b>{d.day}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sprint plan, live progress and earned value for one sprint, with the working shown underneath.
function SprintPanel({ S, c, E, cr, tk, setNav }) {
  const hasPlan = E.typed && E.planned > 0;
  const [askDates, setAskDates] = useState(false);
  const [crOpen, setCrOpen] = useState(null);
  const datesLocked = inBaseline(S, c.id) && !dateCrOf(S, c); // after the first baseline the sprint dates are read-only (unless a date change request is already open on it)
  const over = E.planned > 0 && E.itemsH > E.planned;
  const tone = (cls) => (cls === 'good' || cls === 'warn' || cls === 'bad' ? cls : '');
  const sMoney = (n) => (n == null ? '–' : signedMoney(n, money));
  const rows = [
    ['Project budget (BAC)', 'From the Budget tab', '', money(E.bac)],
    ['Share of the project plan', 'Planned hours ÷ planned hours of all sprints', hrsf(E.planned) + ' h ÷ ' + hrsf(E.total) + ' h' + (E.typed ? '' : ' (no planned hours typed, so its work item hours are used)'), pc(E.share, 2)],
    ['Sprint budget', 'BAC × share', money(E.bac) + ' × ' + pc(E.share, 2), money(E.budget)],
    ['Working days in the sprint', 'Calendar days − off days', E.hasDates ? E.calDays + ' − ' + E.offN + ' off' : 'no dates', E.hasDates ? E.days + ' day' + (E.days === 1 ? '' : 's') : '–'],
    ['Planned % (time gone)', 'Working days gone ÷ working days in the sprint', E.hasDates ? E.elapsed + ' ÷ ' + E.days + ' working days' : 'no dates', pc(E.plannedPct, 1)],
    ['Planned value (PV)', 'Sprint budget × planned %', money(E.budget) + ' × ' + pc(E.plannedPct, 1), money(E.pv)],
    ['Earned % (work done)', 'Done work item hours ÷ planned hours, at most 100%', hrsf(E.doneH) + ' h ÷ ' + hrsf(E.planned) + ' h', pc(E.earnedPct, 1)],
    ['Earned value (EV)', 'Sprint budget × earned %', money(E.budget) + ' × ' + pc(E.earnedPct, 1), money(E.ev)],
    ['Schedule performance (SPI)', 'EV ÷ PV', E.pv > 0 ? money(E.ev) + ' ÷ ' + money(E.pv) : 'planned value is 0 so far', ratio(E.spi)],
    ['Actual cost (AC)', 'Cost entries dated inside the sprint, up to today', E.entries.length + ' entr' + (E.entries.length === 1 ? 'y' : 'ies'), money(E.ac)],
    ['Cost performance (CPI)', 'EV ÷ AC', E.ac > 0 ? money(E.ev) + ' ÷ ' + money(E.ac) : 'no cost entries yet', ratio(E.cpi)],
    ['Schedule variance (SV)', 'EV − PV', money(E.ev) + ' − ' + money(E.pv), sMoney(E.sv)],
    ['Cost variance (CV)', 'EV − AC', E.ac > 0 ? money(E.ev) + ' − ' + money(E.ac) : 'no cost entries yet', sMoney(E.cv)],
  ];
  return (
    <section className="sp-wrap" aria-label="Sprint plan and performance">
      <div>
        <h3 className="sp-h">Plan</h3>
        <div className="sp-grid">
          <Tile l="Start date" s={datesLocked ? 'Fixed by baseline ' + currentBaseline(S).version : 'Editable'}>
            {datesLocked ? <span className="sp-ro mono" title="This date is fixed by the baseline">{longDate(c.start)}</span> : <Cell value={c.start} type="date" label="Sprint start" onCommit={(v) => v && tk.patchContainer(c.id, { start: v })} />}
          </Tile>
          <Tile l="End date" s={(E.calDays ? E.calDays + ' calendar day' + (E.calDays === 1 ? '' : 's') + ' · ' : '') + (datesLocked ? 'fixed by baseline ' + currentBaseline(S).version : 'editable')}>
            {datesLocked ? <span className="sp-ro mono" title="This date is fixed by the baseline">{longDate(c.end)}</span> : <Cell value={c.end} type="date" label="Sprint end" onCommit={(v) => v && tk.patchContainer(c.id, { end: v })} />}
          </Tile>
          <Tile l="Working days" cls={E.hasDates && !E.days ? 'need' : ''} s={E.hasDates ? E.calDays + ' calendar − ' + E.offN + ' off day' + (E.offN === 1 ? '' : 's') : 'Needs dates'} title="Calendar days in the sprint minus its off days. Planned % is counted over these.">
            {E.hasDates ? E.days : '–'}
          </Tile>
          <Tile l={'Planned hours' + (hasPlan ? '' : ' · required')} cls={hasPlan ? '' : 'need'} s={hasPlan ? pc(E.share, 1) + ' of the project plan (' + hrsf(E.total) + ' h) · editable' : 'Enter how many hours this sprint can take'}>
            <Cell value={c.plannedHours} type="num" min={0} placeholder="Enter hours" label="Planned hours" onCommit={(v) => tk.patchContainer(c.id, { plannedHours: v })} />
          </Tile>
          <Tile l="Sprint budget" s={hasPlan || E.planned > 0 ? 'BAC ' + money(E.bac) + ' × ' + pc(E.share, 1) : 'Needs planned hours'} title="BAC × the sprint's share of the planned hours">
            {money(E.budget)}
          </Tile>
        </div>
        <OffDays c={c} E={E} />
        {datesLocked && (
          <div className="row" style={{ margin: '10px 0 0', gap: 12, alignItems: 'center' }}>
            <p className="hint" style={{ margin: 0, flex: '1 1 260px' }}>
              The start and end dates of this sprint are fixed by baseline {currentBaseline(S).version}. To move them, raise a change request: the dates unlock while it is open, and the next baseline records them.
            </p>
            <button className="btn" onClick={() => setAskDates(true)}>Request a date change</button>
          </div>
        )}
        {!datesLocked && dateCrOf(S, c) && (
          <p className="hint" style={{ margin: '10px 0 0' }}>
            The dates of this sprint are open for change under <button className="linkbtn" onClick={() => setCrOpen(dateCrOf(S, c).id)}>{dateCrOf(S, c).code}{dateCrOf(S, c).title ? ' · ' + dateCrOf(S, c).title : ''}</button>. The next baseline will record them.
          </p>
        )}
        {askDates && (
          <DateChangeDialog
            S={S}
            c={c}
            onClose={() => setAskDates(false)}
            onPick={({ crId, reason }) => {
              const id = tk.unlockDates(c.id, { crId, reason });
              setAskDates(false);
              if (!crId) setCrOpen(id); // a new request opens right away so its details can be filled in
            }}
          />
        )}
        {crOpen && <ChangeDrawer id={crOpen} onClose={() => setCrOpen(null)} />}
        {(hoursCrOf(S, c) || hoursLocked(S, c)) && (
          <p className="hint" style={{ margin: '10px 0 0' }}>
            {hoursCrOf(S, c)
              ? <>The work item hours and planned hours of this sprint are covered by <b>{hoursCrOf(S, c).code}</b>{hoursCrOf(S, c).title ? ' · ' + hoursCrOf(S, c).title : ''}. The next baseline will record them.</>
              : <>Work item hours and planned hours are fixed by baseline {currentBaseline(S).version}. Changing either needs a change request, raised or linked when you make the change. Moving work items out to the Backlog needs none.</>}
          </p>
        )}
      </div>

      <div>
        <h3 className="sp-h">Progress · live</h3>
        <div className="sp-grid">
          <Tile l="Work item hours" vcls={over ? 'bad' : ''} s={E.nItems + ' item' + (E.nItems === 1 ? '' : 's') + ' · ' + hrsf(E.doneH) + ' h done · ' + hrsf(E.openH) + ' h open'}
            bar={E.planned > 0 && <Bar f={E.itemsH / E.planned} tone={over ? 'bad' : 'good'} label={pc(E.itemsH / E.planned, 0) + ' of planned hours'} />}>
            {hrsf(E.itemsH)} h
          </Tile>
          <Tile l="Planned %" s={E.hasDates ? (E.started ? 'Working day ' + E.elapsed + ' of ' + E.days + (E.offToday ? ' · today is an off day' : '') : 'Starts ' + fdate(c.start)) : 'Needs dates'} title="Working days gone ÷ working days in the sprint (off days are skipped)"
            bar={E.hasDates && <Bar f={E.plannedPct} label={pc(E.plannedPct, 0) + ' of the time has gone'} />}>
            {E.hasDates ? pc(E.plannedPct, 0) : '–'}
          </Tile>
          <Tile l="Earned %" s={E.planned > 0 ? hrsf(E.doneH) + ' of ' + hrsf(E.planned) + ' planned hours done' : 'Needs planned hours'} title="Done work item hours ÷ planned hours"
            bar={E.planned > 0 && <Bar f={E.earnedPct} tone="good" label={pc(E.earnedPct, 0) + ' of the work is done'} />}>
            {E.planned > 0 ? pc(E.earnedPct, 0) : '–'}
          </Tile>
          <Tile l="Status" s={E.why}>
            <span className={'pill lg ' + E.cls}>{E.status}</span>
          </Tile>
        </div>
      </div>

      <div>
        <h3 className="sp-h">Earned value · as of {fdate(today())}</h3>
        <div className="sp-grid sp-grid5">
          <Tile l="PV · planned value" s="Sprint budget × planned %" title="What should be earned by today">{E.hasDates && E.planned > 0 ? money(E.pv) : '–'}</Tile>
          <Tile l="EV · earned value" s="Sprint budget × earned %" title="What the finished work is worth">{E.planned > 0 ? money(E.ev) : '–'}</Tile>
          <Tile l="AC · actual cost" s={E.entries.length + ' cost entr' + (E.entries.length === 1 ? 'y' : 'ies') + ' in the sprint'} title="Cost entries dated inside the sprint, up to today">{money(E.ac)}</Tile>
          <Tile l="SPI · schedule" vcls={tone(stCls(E.spi))} s={E.spi == null ? 'Not started yet' : 'EV ÷ PV · SV ' + sMoney(E.sv)} title="EV ÷ PV. Above 100% is ahead.">{E.spi == null ? '–' : pc(E.spi, 0)}</Tile>
          <Tile l="CPI · cost" vcls={tone(E.costCls)} s={E.cpi == null ? 'No cost entries yet' : E.costStatus + ' · CV ' + sMoney(E.cv)} title="EV ÷ AC. Above 100% is under budget.">{E.cpi == null ? '–' : pc(E.cpi, 0)}</Tile>
        </div>
      </div>

      <details className="card sp-calc">
        <summary>How these numbers are calculated</summary>
        <p className="hint" style={{ marginTop: 10 }}>Worked out automatically as of {fdate(today())} from this sprint's planned hours, dates, work items and cost entries. Only the planned hours and dates are typed in. Everything updates when you change a work item's status or a date, and as days pass.</p>
        <div className="scroll">
          <table className="tbl rwd sp-tbl">
            <thead><tr><th>Measure</th><th>Formula</th><th>With this sprint's numbers</th><th className="r">Result</th></tr></thead>
            <tbody>
              {rows.map((r) => (<tr key={r[0]}><td data-l="Measure"><b>{r[0]}</b></td><td data-l="Formula" className="msg">{r[1]}</td><td data-l="Numbers" className="mono">{r[2]}</td><td data-l="Result" className="r mono"><b>{r[3]}</b></td></tr>))}
            </tbody>
          </table>
        </div>
        {E.entries.length > 0 && (
          <>
            <h4 className="sp-h" style={{ margin: '14px 0 6px' }}>Cost entries counted in actual cost</h4>
            <div className="scroll">
              <table className="tbl rwd sp-tbl">
                <thead><tr><th>Date</th><th>Cost element</th><th>Description</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {E.entries.map((e, i) => (<tr key={e.id || i}><td data-l="Date" className="mono">{fdate(e.date)}</td><td data-l="Element">{e.element || '–'}</td><td data-l="Description" className="msg">{e.desc || ''}</td><td data-l="Amount" className="r mono">{money(nz(e.amount))}</td></tr>))}
                  <tr><td data-l=""></td><td data-l=""></td><td data-l="Total" className="msg"></td><td data-l="Total" className="r mono"><b>{money(E.ac)}</b></td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
        <h4 className="sp-h" style={{ margin: '14px 0 6px' }}>Status rules</h4>
        <ul className="msg" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Complete:</b> every work item in the sprint is done. <b>Overdue:</b> the end date has passed with work still open.</li>
          <li>Otherwise by SPI: <b>Ahead</b> 105% or more, <b>On track</b> 95% to 105%, <b>At risk</b> 80% to 95%, <b>Behind</b> below 80%. Cost status uses CPI: under budget at 100% or more, slightly over from 90%, over budget below 90%.</li>
          <li>Only working days count: off days marked on this sprint are skipped, and today counts as gone when it is a working day, so planned value reaches 100% on the sprint's last working day. Cost entries dated outside every sprint are not counted in any sprint.</li>
          <li>The Dashboard adds up these same sprint figures, so its planned value, SPI and S-curve follow the off days marked here.</li>
        </ul>
      </details>
    </section>
  );
}

export default function SprintView() {
  const { S, nav, setNav } = useStore();
  const tk = useTasks();
  const c = containerById(S, nav.sprintId);
  const [q, setQ] = useState('');
  const [by, setBy] = useState('status');
  const [who, setWho] = useState('all');
  const [ft, setFt] = useState('all'); // work item type filter
  const [lvl, setLvl] = useState(0); // levels shown in the list (0 = all)
  const [focus, setFocus] = useState(null); // name box to focus after an item is added or moved
  const [drag, setDrag] = useState(null); // { id, sub } while a row is dragged
  const [over, setOver] = useState(null); // { id, zone } the row it is over
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
    return new Set(c.tasks.filter((t) => (!ql || t.name.toLowerCase().includes(ql) || (t.code || '').toLowerCase().includes(ql)) && (ft === 'all' || t.type === ft) && (who === 'all' || (who === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(who)))).map((t) => t.id));
  }, [c, q, who, ft]);
  const filtering = !!q.trim() || who !== 'all' || ft !== 'all';
  const shown = useMemo(() => (!c ? new Set() : filtering ? withAncestors(c.tasks, matched) : new Set(c.tasks.map((t) => t.id))), [c, matched, filtering]);
  const tasks = useMemo(() => (c ? c.tasks.filter((t) => shown.has(t.id)) : []), [c, shown]);
  // a selection belongs to one sprint and one view
  useEffect(() => { setSel(new Set()); last.current = null; }, [nav.sprintId, nav.sprintView]);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []); // keeps today-based figures current on a page left open
  if (!c) return <div className="card">This sprint no longer exists. Pick another from the left.</div>;

  const idx = S.sprints.findIndex((s) => s.id === c.id);
  const next = S.sprints[idx + 1];
  const leaves = leafTasks(c.tasks);
  const work = leaves.filter((t) => !typeOf(S, t.type).milestone); // milestones carry no effort
  const unfinished = leaves.filter((t) => isOpen(S, t));
  const outside = outsideSprint(S).filter((x) => x.sp.id === c.id).length;
  const E = sprintEvm(S, c); // live earned value figures for this sprint, recalculated on every change
  const cr = c.crId ? S.cr.find((x) => x.id === c.crId) : null;
  const missing = work.filter((t) => !t.effort).length;
  const assigned = leaves.filter((t) => (t.assignees || []).length).length;
  const pctA = leaves.length ? Math.round((assigned / leaves.length) * 100) : null;
  const tops = tasks.filter((t) => !t.parent);
  const groups = groupsOf(tops, by, S, !filtering);
  const view = nav.sprintView === 'wbs' ? 'list' : nav.sprintView; // the WBS view was merged into the list
  const maxDepth = lvl || Infinity;
  const wbsOf = new Map(flatTree(c.tasks).map((r) => [r.t.id, r.wbs]));
  const parentIds = c.tasks.filter((t) => (kids.get(t.id) || []).length).map((t) => t.id);
  const ask = (f) => setFocus({ ...f, n: Date.now() });
  const expand = (id) => setExp((e) => ({ ...e, [id]: true }));
  const drop = (target, zone) => {
    if (!drag) return;
    if (zone === 'inside') {
      tk.place(drag.id, { parent: target.id });
      expand(target.id);
    } else tk.place(drag.id, { parent: target.parent || '', ref: target.id, pos: zone });
  };
  const sum = summarize(S, c);
  const boardTasks = leaves.filter((t) => matched.has(t.id));

  // an item is expanded when you opened it, or when it has children and you did not close it
  const isExp = (t) => (exp[t.id] != null ? exp[t.id] : (kids.get(t.id) || []).length > 0);
  const toggle = (t) => setExp({ ...exp, [t.id]: !isExp(t) });
  const branchIds = (t, d = 0) => [t.id].concat(isExp(t) && d + 1 < maxDepth ? (kids.get(t.id) || []).filter((k) => shown.has(k.id)).flatMap((k) => branchIds(k, d + 1)) : []);
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

      <div className="vtabs" role="tablist">
        {[['dash', 'Dashboard'], ['list', 'List'], ['board', 'Board']].map(([id, l]) => (
          <button key={id} className="vtab" role="tab" aria-selected={view === id} onClick={() => setNav({ sprintView: id })}>{l}</button>
        ))}
      </div>

      {view !== 'dash' && (
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
        {view === 'list' && (
          <>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              Type
              <select className="c" value={ft} onChange={(e) => setFt(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by type">
                <option value="all">All types</option>
                {typesOf(S).map((x) => (<option key={x.id} value={x.id}>{x.label}</option>))}
              </select>
            </label>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              Show
              <select className="c" value={lvl} onChange={(e) => setLvl(parseInt(e.target.value, 10))} style={{ width: 'auto' }} aria-label="Levels to show">
                <option value={0}>All levels</option><option value={1}>Level 1</option><option value={2}>Down to level 2</option><option value={3}>Down to level 3</option><option value={4}>Down to level 4</option>
              </select>
            </label>
            <button className="btn" onClick={() => setExp(Object.fromEntries(parentIds.map((id) => [id, true])))}>Expand all</button>
            <button className="btn" onClick={() => setExp(Object.fromEntries(parentIds.map((id) => [id, false])))}>Collapse all</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {view === 'list' && <button className="btn" onClick={ui.openTypes} title="Add or edit work item types">Types</button>}
        <button className="btn" onClick={ui.openStatuses} title="Add or edit task statuses">Statuses</button>
        <button className="btn primary" onClick={quickAdd}>+ Task</button>
      </div>
      )}

      {view === 'list' && <BulkBar ids={chosen} container={c} onDone={() => { setSel(new Set()); last.current = null; }} />}

      {sprintOverlaps(S).filter(([a, b]) => a.id === c.id || b.id === c.id).map(([a, b]) => (
        <div className="banner" key={a.id + b.id}>
          <span>{a.name} ({fdate(a.start)} – {fdate(a.end)}) overlaps {b.name} ({fdate(b.start)} – {fdate(b.end)}). Sprints in the same project cannot overlap: change the start or end date of one of them.</span>
        </div>
      ))}

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
        <div className="s-card"><span className={'s-ic ' + (!c.tasks.length || missing ? 'warn' : 'good')}>{!c.tasks.length || missing ? '!' : '✓'}</span><div><b>Effort</b><div className="msg">{!c.tasks.length ? 'No tasks yet' : missing ? missing + ' task' + (missing > 1 ? 's' : '') + ' missing effort' : 'All tasks estimated'}</div></div></div>
      </div>

      {view === 'dash' ? (
        <SprintPanel S={S} c={c} E={E} cr={cr} tk={tk} setNav={setNav} />
      ) : view === 'list' ? (
        <>
        <p className="msg wbs-help">Click a name to edit it · Enter adds an item below · Tab / Shift+Tab indent and outdent · Alt+↑ / ↓ reorder · drag ⋮⋮ to reorder or drop onto an item to nest · Σ values add up from the child items. Dragging to reorder is clearest with Group by: None.</p>
        <div className="scroll sp-scroll">
          <div className="tg sp">
            <div className="tg-row tg-h"><div>WBS</div><div className="tg-name"><TriBox all={tasks.length > 0 && chosen.length === tasks.length} some={chosen.length > 0} onChange={(e) => setMany(tasks.map((t) => t.id), e.target.checked)} label="Select all tasks" />Name</div><div>Assignee</div><div>Start</div><div>Due</div><div>Priority</div><div>Effort (h)</div><div>Progress</div><div>Status</div><div /></div>
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
                    <Branch key={t.id} t={t} depth={0} ctx={{ kids, visible: shown, isExp, toggle, onOpen: setOpen, sel, onSelect: toggleOne, filtering, tk, maxDepth, wbsOf, drag, over, setDrag, setOver, drop, focus, ask, expand, tasks: c.tasks }} />
                  ))}
                  {!hide && <div className="tg-add"><AddRow onAdd={addTo(g.defaults)} /></div>}
                </div>
              );
            })}
            {c.tasks.length > 0 && (
              <div className="tg-row tg-tot">
                <div /><div className="tg-name"><b>Total</b> <span className="msg">{sum.items} work item{sum.items === 1 ? '' : 's'} · {sum.leaves} at the lowest level</span></div>
                <div /><div className="c-start msg">{sum.start ? fdate(sum.start) : ''}</div><div className="c-due msg">{sum.end ? fdate(sum.end) : ''}</div><div />
                <div className="c-eff mono">{hrsf(sum.hrs)}</div>
                <div className="c-pct w-pct">{sum.pct == null ? null : (<><div className="bar"><i style={{ width: Math.min(100, sum.pct * 100) + '%' }} /></div><span className="mono">{pc(sum.pct, 0)}</span></>)}</div>
                <div /><div />
              </div>
            )}
            {!groups.length && <div className="empty">{filtering ? 'No tasks match your search or filter.' : 'No tasks yet. Use + Task to add the first one.'}</div>}
          </div>
        </div>
        </>
      ) : (
        <Board tasks={boardTasks} onOpen={setOpen} onAdd={(status, name) => tk.add(c.id, { name, status })} />
      )}

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
