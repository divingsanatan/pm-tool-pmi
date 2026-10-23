import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { Modal, useUI } from './UI';
import Menu from './Menu';
import { StatusIcon } from './Bits';
import { PRIORITIES, findTask, statusesOf } from '../lib/tasks';
import { fdate } from '../lib/dates';

// Asks for one value (a date or a number) and applies it to every selected work item
function ValueDialog({ kind, count, tasks, container, onApply, onClose }) {
  const isDate = kind === 'start' || kind === 'due';
  const title = { start: 'Set start date', due: 'Set due date', effort: 'Set effort (hours)' }[kind];
  const [v, setV] = useState('');
  const ok = v !== '' && (isDate || !isNaN(parseFloat(v)));
  const outside = isDate && v && container.start && container.end && (v < container.start || v > container.end);
  const clash = isDate && v ? tasks.filter((t) => (kind === 'start' ? t.due && t.due < v : t.start && t.start > v)).length : 0;
  const apply = () => {
    if (!ok) return;
    onApply(isDate ? v : parseFloat(v));
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div onKeyDown={(e) => e.key === 'Enter' && apply()}>
        <label className="fld">{isDate ? 'Date' : 'Hours'}
          <input className="c" type={isDate ? 'date' : 'number'} step={isDate ? undefined : 'any'} min={isDate ? undefined : 0} autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        {outside && <p className="msg" style={{ color: 'var(--warn)' }}>This date is outside the sprint ({fdate(container.start)} – {fdate(container.end)}). It will stretch the project timeline and budget.</p>}
        {clash > 0 && <p className="msg" style={{ color: 'var(--warn)' }}>{clash} selected item{clash > 1 ? 's have' : ' has'} a {kind === 'start' ? 'due date before this start date' : 'start date after this due date'}.</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ok} onClick={apply}>Apply to {count} item{count > 1 ? 's' : ''}</button>
        </div>
      </div>
    </Modal>
  );
}

// Bulk actions for the selected work items of a sprint or the Backlog
export default function BulkBar({ ids, container, onDone }) {
  const { S, setNav } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const [dlg, setDlg] = useState(null);
  if (!ids.length) return null;

  const backlog = container.id === 'backlog';
  const tasks = ids.map((id) => findTask(S, id)).filter(Boolean).map((f) => f.t);
  const n = ids.length;

  const people = S.people.filter((p) => p.name).map((p) => {
    const has = tasks.filter((t) => (t.assignees || []).includes(p.id)).length;
    return { label: p.name, active: has === tasks.length, hint: has && has < tasks.length ? 'some' : '', keepOpen: true, onClick: () => tk.assignMany(ids, p.id, has !== tasks.length) };
  });
  const assigneeItems = people.concat([
    { sep: true },
    { label: 'Clear all assignees', onClick: () => tk.patchMany(ids, { assignees: [] }) },
    { label: 'Manage stakeholders…', onClick: () => setNav({ view: 'project', tab: 'people' }) },
  ]);
  const prio = PRIORITIES.map((p) => ({ label: p.label, active: tasks.every((t) => t.priority === p.id), onClick: () => tk.patchMany(ids, { priority: p.id }) })).concat([
    { sep: true },
    { label: 'Clear priority', onClick: () => tk.patchMany(ids, { priority: '' }) },
  ]);
  const dates = [
    { label: 'Set start date…', onClick: () => setDlg('start') },
    { label: 'Set due date…', onClick: () => setDlg('due') },
    { sep: true },
    { label: 'Clear start date', onClick: () => tk.patchMany(ids, { start: '' }) },
    { label: 'Clear due date', onClick: () => tk.patchMany(ids, { due: '' }) },
  ];
  const effort = [
    { label: 'Set effort…', onClick: () => setDlg('effort') },
    { label: 'Clear effort', onClick: () => tk.patchMany(ids, { effort: null }) },
  ];
  const targets = S.sprints.filter((s) => s.id !== container.id).map((s) => ({ label: s.name, hint: s.status === 'Not started' ? '' : s.status, onClick: () => { tk.moveMany(ids, s.id); onDone(); } }));
  if (!backlog) targets.push({ sep: true }, { label: 'Backlog', hint: 'clears status and dates', onClick: () => { tk.moveMany(ids, 'backlog'); onDone(); } });
  const more = [
    { label: 'Duplicate', onClick: () => tk.duplicateMany(ids) },
    { sep: true },
    {
      label: 'Delete…',
      danger: true,
      onClick: () =>
        ui.ask({
          title: 'Delete ' + n + ' work item' + (n > 1 ? 's' : '') + '?',
          body: 'The selected work items and their subtasks will be permanently deleted.',
          confirm: 'Delete',
          danger: true,
          onConfirm: () => {
            tk.removeMany(ids);
            onDone();
          },
        }),
    },
  ];

  return (
    <>
      <div className="selbar" role="region" aria-label="Bulk actions">
        <b>{n} selected</b>
        {!backlog && (
          <Menu
            className="btn primary"
            label="Status ▾"
            title="Set status for selected work items"
            items={statusesOf(S).map((st) => ({
              label: (<span className="sm-item"><StatusIcon status={st} size={14} />{st.label}</span>),
              active: tasks.every((t) => t.status === st.id),
              onClick: () => tk.patchMany(ids, { status: st.id }),
            }))}
          />
        )}
        <Menu className="btn" label="Assignees ▾" title="Assign selected work items" items={assigneeItems} />
        <Menu className="btn" label="Priority ▾" title="Set priority for selected work items" items={prio} />
        {!backlog && <Menu className="btn" label="Dates ▾" title="Set dates for selected work items" items={dates} />}
        <Menu className="btn" label="Effort ▾" title="Set effort for selected work items" items={effort} />
        {targets.length > 0 && <Menu className="btn" label="Move to ▾" title="Move selected work items" items={targets} />}
        <Menu className="btn" label="More ▾" title="More actions" items={more} />
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onDone}>Clear selection</button>
      </div>
      {dlg && (
        <ValueDialog
          kind={dlg}
          count={n}
          tasks={tasks}
          container={container}
          onClose={() => setDlg(null)}
          onApply={(v) => tk.patchMany(ids, dlg === 'effort' ? { effort: v } : dlg === 'start' ? { start: v } : { due: v })}
        />
      )}
    </>
  );
}
