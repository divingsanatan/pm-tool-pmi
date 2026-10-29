import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from './UI';
import Menu from './Menu';
import { AvatarStack, Flag, StatusIcon, TypeBadge } from './Bits';
import { PRIORITIES, findTask, nameOf, statusOf, statusesOf, typeOf, typesOf } from '../lib/tasks';

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

// Status of a work item. Every item can be changed, parents included (a parent is automatic, from its child items, until you pick one).
// pill: the coloured label for the List's Status column; otherwise just the round icon.
export function StatusMenu({ task, className = 'x st-btn', pill = false }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const f = findTask(S, task.id);
  const parent = !!f && f.c.tasks.some((k) => k.parent === task.id);
  const items = statusesOf(S).map((s) => ({
    label: (<span className="sm-item"><StatusIcon status={s} size={14} />{s.label}</span>),
    active: s.id === task.status,
    onClick: () => tk.setStatus(task.id, s.id),
  }));
  if (parent) items.push({ sep: true }, { label: 'Automatic (from child items)', active: !task.statusSet, disabled: !task.statusSet, onClick: () => tk.autoStatus(task.id) });
  items.push({ sep: true }, { label: 'Edit statuses…', onClick: ui.openStatuses });
  const st = statusOf(S, task.status);
  const title = 'Change status' + (parent ? (task.statusSet ? ' (set by hand)' : ' (calculated from child items until you set it)') : '');
  return (
    <Menu
      className={pill ? 'st-pill' : className}
      label={pill ? (<><StatusIcon status={st} size={13} /><span>{st.label}</span>{parent && !task.statusSet && <i className="st-auto" aria-hidden="true">auto</i>}</>) : (<StatusIcon status={st} />)}
      title={title}
      items={items}
    />
  );
}

// the type of a work item (Epic, Story, Task, Bug, or your own); the badge is the button
export function TypeMenu({ task, className = 'x type-btn', size = 18 }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const items = typesOf(S).map((ty) => ({
    label: (<span className="sm-item"><TypeBadge type={ty} size={16} />{ty.label}</span>),
    active: ty.id === task.type,
    onClick: () => tk.patch(task.id, { type: ty.id }),
  }));
  items.push({ sep: true }, { label: 'Manage types…', onClick: ui.openTypes });
  return <Menu className={className} label={<TypeBadge type={typeOf(S, task.type)} size={size} />} title={'Type: ' + typeOf(S, task.type).label + '. Click to change.'} items={items} />;
}

// "+" menu that adds a child work item of the chosen type under a parent
export function AddChildMenu({ parent, className = 'x w-add', label = '＋', onAdded }) {
  const { S } = useStore();
  const tk = useTasks();
  const items = typesOf(S).map((ty) => ({
    label: (<span className="sm-item"><TypeBadge type={ty} size={16} />Add {ty.label.toLowerCase()}</span>),
    onClick: () => {
      const id = tk.addChild(parent.id, { type: ty.id, name: 'New ' + ty.label.toLowerCase() });
      onAdded && onAdded(id);
    },
  }));
  return <Menu className={className} label={label} title={'Add a child under ' + parent.name} items={items} />;
}
