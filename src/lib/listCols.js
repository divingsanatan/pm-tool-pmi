import { useCallback, useState } from 'react';

// Columns of the sprint List (which is also the WBS). Name is always shown; every other column can be hidden or added back
// from the "+" at the end of the header or the Columns button. The choice is a view setting kept in this browser.
// The order here is the order on screen. `cls` is the class of the cells in each row (used to hide a column).
export const LIST_COLS = [
  { id: 'wbs', label: 'WBS', w: 52, cls: 'c-wbs', def: true },
  { id: 'assignee', label: 'Assignee', w: 88, cls: 'c-ass', def: true },
  { id: 'start', label: 'Start', w: 122, cls: 'c-start', def: true },
  { id: 'due', label: 'Due', w: 122, cls: 'c-due', def: true },
  { id: 'priority', label: 'Priority', w: 88, cls: 'c-pri', def: true },
  { id: 'effort', label: 'Effort (h)', w: 96, cls: 'c-eff', def: true },
  { id: 'progress', label: 'Progress', w: 128, cls: 'c-pct', def: true },
  { id: 'status', label: 'Status', w: 132, cls: 'c-st', def: true },
  { id: 'code', label: 'ID', w: 80, cls: 'c-code', def: false },
  { id: 'type', label: 'Type', w: 100, cls: 'c-type', def: false },
  { id: 'doneOn', label: 'Completed on', w: 124, cls: 'c-doneon', def: false },
  { id: 'parent', label: 'Parent item', w: 160, cls: 'c-parent', def: false },
];

const KEY = 'sprint-control-list-cols-v1';
const DEFAULTS = LIST_COLS.filter((c) => c.def).map((c) => c.id);

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(a)) return a.filter((id) => LIST_COLS.some((c) => c.id === id));
  } catch (e) {
    /* storage blocked or corrupt: use the defaults */
  }
  return DEFAULTS;
}

export function useListCols() {
  const [ids, setIds] = useState(load); // the shown columns, in the order they appear (WBS always stays first, then Name)
  const save = useCallback((next) => {
    setIds(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* not saved */ }
  }, []);
  const toggle = (id) => save(ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id)); // a column added back goes to the end
  // drag a column header onto another one: it lands before it, or after it when dropped on its right half
  const move = (id, target, after) => {
    if (id === target || id === 'wbs' || target === 'wbs' || !ids.includes(id) || !ids.includes(target)) return;
    const rest = ids.filter((x) => x !== id);
    const i = rest.indexOf(target);
    rest.splice(after ? i + 1 : i, 0, id);
    save(rest);
  };
  const moving = ids.filter((id) => id !== 'wbs');
  const colOf = (id) => LIST_COLS.find((c) => c.id === id);
  // grid: wbs (if shown), name, the other shown columns in order, actions. Cells are placed with CSS `order` (--o-<id>).
  const parts = [];
  let min = 64 + 40;
  if (ids.includes('wbs')) { parts.push('52px'); min += 56; }
  parts.push('minmax(240px,1fr)'); min += 244;
  moving.forEach((id) => { parts.push(colOf(id).w + 'px'); min += colOf(id).w + 4; });
  parts.push('64px');
  const vars = { '--tg-cols': parts.join(' '), '--tg-min': min + 'px' };
  LIST_COLS.forEach((c) => { vars['--o-' + c.id] = moving.includes(c.id) ? moving.indexOf(c.id) + 2 : 900; });
  return {
    ids,
    has: (id) => ids.includes(id),
    toggle,
    move,
    reset: () => save(DEFAULTS),
    vars,
    items: () => LIST_COLS.map((c) => ({ label: c.label, active: ids.includes(c.id), keepOpen: true, onClick: () => toggle(c.id) })).concat([{ sep: true }, { label: 'Reset to default columns', onClick: () => save(DEFAULTS) }]),
  };
}
