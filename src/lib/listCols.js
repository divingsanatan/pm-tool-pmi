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
  { id: 'deps', label: 'Dependencies', w: 120, cls: 'c-deps', def: true },
  { id: 'tags', label: 'Tags', w: 150, cls: 'c-tags', def: false },
  { id: 'code', label: 'ID', w: 80, cls: 'c-code', def: false },
  { id: 'type', label: 'Type', w: 100, cls: 'c-type', def: false },
  { id: 'doneOn', label: 'Completed on', w: 124, cls: 'c-doneon', def: false },
  { id: 'parent', label: 'Parent item', w: 160, cls: 'c-parent', def: false },
];

const KEY = 'sprint-control-list-cols-v1';
const KEY_NAME_W = 'sprint-control-list-name-w-v1';
const KEY_WRAP = 'sprint-control-list-wrap-v1';
export const NAME_MIN = 180;
export const NAME_MAX = 900;
const clampW = (w) => Math.max(NAME_MIN, Math.min(NAME_MAX, Math.round(w)));
const DEFAULTS = LIST_COLS.filter((c) => c.def).map((c) => c.id);

const KEY_DEPS = 'sprint-control-list-deps-col-v1';
function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(a)) {
      const ok = a.filter((id) => LIST_COLS.some((c) => c.id === id));
      // the Dependencies column is new: show it once for people who had already chosen their columns (they can hide it again)
      if (!localStorage.getItem(KEY_DEPS)) {
        localStorage.setItem(KEY_DEPS, '1');
        if (!ok.includes('deps')) ok.push('deps');
        localStorage.setItem(KEY, JSON.stringify(ok));
      }
      return ok;
    }
  } catch (e) {
    /* storage blocked or corrupt: use the defaults */
  }
  return DEFAULTS;
}

export function useListCols() {
  // Name column: width null = it takes the room that is left (and never gets narrower than 240px); a number = the width the user dragged it to.
  const [nameW, setNameWState] = useState(() => { try { const n = parseInt(localStorage.getItem(KEY_NAME_W), 10); return n ? clampW(n) : null; } catch (e) { return null; } });
  const [wrap, setWrapState] = useState(() => { try { return localStorage.getItem(KEY_WRAP) !== '0'; } catch (e) { return true; } }); // wrap long names (default) or cut them with …
  const setNameW = useCallback((w, persist) => {
    const n = w == null ? null : clampW(w);
    setNameWState(n);
    if (persist) { try { n == null ? localStorage.removeItem(KEY_NAME_W) : localStorage.setItem(KEY_NAME_W, String(n)); } catch (e) { /* not saved */ } }
  }, []);
  const setWrap = useCallback((on) => { setWrapState(on); try { localStorage.setItem(KEY_WRAP, on ? '1' : '0'); } catch (e) { /* not saved */ } }, []);
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
  if (nameW) { parts.push(nameW + 'px'); min += nameW + 4; } else { parts.push('minmax(260px,1fr)'); min += 264; }
  moving.forEach((id) => { parts.push(colOf(id).w + 'px'); min += colOf(id).w + 4; });
  parts.push('64px');
  const vars = { '--tg-cols': parts.join(' '), '--tg-min': min + 'px' };
  LIST_COLS.forEach((c) => { vars['--o-' + c.id] = moving.includes(c.id) ? moving.indexOf(c.id) + 2 : 900; });
  return {
    ids,
    nameW,
    setNameW,
    wrap,
    setWrap,
    has: (id) => ids.includes(id),
    toggle,
    move,
    reset: () => save(DEFAULTS),
    vars,
    items: () => LIST_COLS.map((c) => ({ label: c.label, active: ids.includes(c.id), keepOpen: true, onClick: () => toggle(c.id) })).concat([{ sep: true }, { label: 'Reset to default columns', onClick: () => save(DEFAULTS) }]),
  };
}
