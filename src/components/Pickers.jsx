import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from './UI';
import Menu from './Menu';
import { AvatarStack, Flag, StatusIcon } from './Bits';
import { PRIORITIES, nameOf, statusOf, statusesOf } from '../lib/tasks';

// Several stakeholders can be assigned to one work item
export function AssigneeMenu({ task, className = 'x ass-btn', label, size = 24 }) {
  const { S, setNav } = useStore();
  const tk = useTasks();
  const ids = task.assignees || [];
  const items = S.people.map((p) => ({ label: p.name || '(unnamed)', active: ids.includes(p.id), keepOpen: true, onClick: () => tk.toggleAssignee(task.id, p.id) }));
  items.push(
    { sep: true },
    { label: 'Clear all', disabled: !ids.length, onClick: () => tk.patch(task.id, { assignees: [] }) },
    { label: 'Manage stakeholders…', onClick: () => setNav({ view: 'project', tab: 'people' }) }
  );
  return <Menu className={className} label={label || <AvatarStack names={ids.map((id) => nameOf(S, id))} size={size} />} title="Assignees" items={items} />;
}

export function PriorityMenu({ task, className = 'x ass-btn' }) {
  const tk = useTasks();
  const items = PRIORITIES.map((p) => ({ label: p.label, active: p.id === task.priority, onClick: () => tk.patch(task.id, { priority: p.id }) })).concat([
    { sep: true },
    { label: 'Clear', onClick: () => tk.patch(task.id, { priority: '' }) },
  ]);
  return <Menu className={className} label={<Flag priority={task.priority} />} title="Priority" items={items} />;
}

export function StatusMenu({ task, className = 'x st-btn' }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const items = statusesOf(S).map((s) => ({
    label: (<span className="sm-item"><StatusIcon status={s} size={14} />{s.label}</span>),
    active: s.id === task.status,
    onClick: () => tk.patch(task.id, { status: s.id }),
  }));
  items.push({ sep: true }, { label: 'Edit statuses…', onClick: ui.openStatuses });
  return <Menu className={className} label={<StatusIcon status={statusOf(S, task.status)} />} title="Change status" items={items} />;
}
