import { useCallback, useState } from 'react';

// Columns of the sprint List (which is also the WBS). Name is always shown; every other column can be hidden or added back
// from the "+" at the end of the header or the Columns button. The choice is a view setting kept in this browser.
// The order here is the order on screen. `cls` is the class of the cells in each row (used to hide a column).
export const LIST_COLS = [
  { id: 'wbs', label: 'WBS', w: 52, cls: 'c-wbs', def: true },
  { id: 'assignee', label: 'Assignee', w: 96, cls: 'c-ass', def: true },
  { id: 'start', label: 'Start', w: 118, cls: 'c-start', def: true },
  { id: 'due', label: 'Due', w: 118, cls: 'c-due', def: true },
  { id: 'priority', label: 'Priority', w: 90, cls: 'c-pri', def: true },
  { id: 'effort', label: 'Effort (h)', w: 84, cls: 'c-eff', def: true },
  { id: 'progress', label: 'Progress', w: 150, cls: 'c-pct', def: true },
  { id: 'status', label: 'Status', w: 140, cls: 'c-st', def: true },
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
  const [ids, setIds] = useState(load);
  const save = useCallback((next) => {
    setIds(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* not saved */ }
  }, []);
  const shown = LIST_COLS.filter((c) => ids.includes(c.id));
  const toggle = (id) => save(ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id));
  // wbs (if shown) + name + the other shown columns + the actions column
  const parts = [];
  let min = 72 + 40;
  shown.forEach((c) => {
    if (c.id === 'wbs') { parts.push('52px'); min += 52 + 4; }
  });
  parts.push('minmax(340px,1fr)'); min += 340 + 4;
  shown.filter((c) => c.id !== 'wbs').forEach((c) => { parts.push(c.w + 'px'); min += c.w + 4; });
  parts.push('72px');
  return {
    ids,
    shown,
    has: (id) => ids.includes(id),
    toggle,
    reset: () => save(DEFAULTS),
    template: parts.join(' '),
    minWidth: min,
    // items for a Menu: tick = shown
    items: () => LIST_COLS.map((c) => ({ label: c.label, active: ids.includes(c.id), keepOpen: true, onClick: () => toggle(c.id) })).concat([{ sep: true }, { label: 'Reset to default columns', onClick: () => save(DEFAULTS) }]),
  };
}
