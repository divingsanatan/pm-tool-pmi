import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { useUI } from './UI';
import Menu from './Menu';
import { AvatarStack, Flag, StatusIcon, TypeBadge } from './Bits';
import { useState } from 'react';
import { leaveCheck, rangeText } from '../lib/capacity';
import { PRIORITIES, allTags, cleanTag, cleanTags, findTask, hasTag, nameOf, statusOf, statusesOf, tagColor, typeOf, typesOf } from '../lib/tasks';
import { TagAdder, TagChip, TagEditor } from './Tags';

export { TagChip };

// Several stakeholders can be assigned to one work item
export function AssigneeMenu({ task, className = 'x ass-btn', label, size = 24 }) {
  const { S, setNav } = useStore();
  const tk = useTasks();
  const ids = task.assignees || [];
  const items = S.people.map((p) => {
    // leave days are shown next to the name; choosing someone on leave raises a warning that can be overridden
    const lc = ids.includes(p.id) ? null : leaveCheck(S, p, task.start, task.due);
    const hint = lc && lc.lost.length ? (lc.block ? 'on leave ' : 'leave ') + rangeText(lc.lost) : '';
    return { label: (p.name || '(unnamed)') + (hint ? ' · ' + hint : ''), active: ids.includes(p.id), keepOpen: true, onClick: () => tk.toggleAssignee(task.id, p.id) };
  });
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

// Tags of a work item. The button shows the tags themselves (or a small # / "+ Tag" when there are none); the menu lists every tag
// of the project to tick on or off, and a box at the bottom creates a new one. The coloured dot in front of a tag opens its editor
// (rename, colour, filter, delete) and "Manage tags…" opens the Tag manager.
//   inline: the compact form inside the Name cell (the # only shows when the row is hovered)
export function TagMenu({ task, inline = false, max = 2, className, label: forced }) {
  const { S } = useStore();
  const tk = useTasks();
  const ui = useUI();
  const [edit, setEdit] = useState(null);
  const mine = task.tags || [];
  const set = (next) => tk.patch(task.id, { tags: cleanTags(next) });
  const toggle = (g) => set(hasTag(task, g) ? mine.filter((x) => x.toLowerCase() !== g.toLowerCase()) : mine.concat(g));
  const known = allTags(S);
  const items = known.map((g) => ({
    label: (
      <span className="sm-item">
        <span role="button" tabIndex={0} className="tag-dotbtn" title="Change the color, rename or delete this tag" aria-label={'Edit the tag ' + g} style={{ '--tc': tagColor(S, g) }}
          onClick={(e) => { e.stopPropagation(); setEdit(g); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setEdit(g); } }}><i className="tag-dot" /></span>
        {g}
      </span>
    ),
    active: hasTag(task, g), keepOpen: true, onClick: () => toggle(g),
  }));
  if (!items.length) items.push({ label: 'No tags in this project yet', disabled: true });
  if (ui && ui.openTags) items.push({ sep: true }, { label: 'Manage tags…', onClick: () => ui.openTags() });
  const label = forced || (mine.length ? (
    <span className="tags">
      {mine.slice(0, max).map((g) => (<TagChip key={g} tag={g} />))}
      {mine.length > max && <span className="tag-more" title={mine.slice(max).join(', ')}>+{mine.length - max}</span>}
    </span>
  ) : inline ? '#' : <span className="tag-empty">＋ Tag</span>);
  return (
    <Menu
      className={(className || 'tag-btn') + (inline ? ' inl' : '') + (mine.length ? '' : ' none')}
      label={label}
      title={mine.length ? 'Tags: ' + mine.join(', ') + '. Click to change.' : 'Add a tag'}
      items={items}
      onOpen={() => setEdit(null)}
      footer={({ close }) => edit ? (
        <div>
          <button type="button" className="mi" onClick={() => setEdit(null)}><span>← Back to the tags</span></button>
          <TagEditor tag={edit} close={close} onRenamed={setEdit} onGone={() => setEdit(null)} />
        </div>
      ) : (
        <TagAdder onAdd={(name) => { const g = cleanTag(name); const same = known.find((x) => x.toLowerCase() === g.toLowerCase()); set(mine.concat(same || g)); }} />
      )}
    />
  );
}
