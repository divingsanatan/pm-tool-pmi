import { useEffect, useRef, useState } from 'react';

// Multi-select state for a list of work items: click toggles, shift-click selects a range, groups can select all.
// visibleIds: items currently shown (hidden items are never acted on). orderIds: shown order, for ranges.
// withKids (optional): id -> the ids to (de)select together with it, e.g. a parent and everything below it. Default: just the item itself.
export function useSelect(visibleIds, orderIds, resetKey, withKids = (id) => [id]) {
  const [sel, setSel] = useState(() => new Set());
  const last = useRef(null);
  useEffect(() => {
    setSel(new Set());
    last.current = null;
  }, [resetKey]);
  const visible = new Set(visibleIds);
  const chosen = [...sel].filter((id) => visible.has(id));
  const toggleOne = (id, range) => {
    const n = new Set(sel);
    const on = !sel.has(id);
    const mark = (x) => withKids(x).forEach((k) => (on ? n.add(k) : n.delete(k)));
    if (range && last.current && orderIds.includes(last.current) && orderIds.includes(id)) {
      const a = orderIds.indexOf(last.current), b = orderIds.indexOf(id);
      orderIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(mark);
    } else mark(id);
    last.current = id;
    setSel(n);
  };
  const setMany = (ids, on) => {
    const n = new Set(sel);
    ids.forEach((x) => withKids(x).forEach((k) => (on ? n.add(k) : n.delete(k))));
    setSel(n);
  };
  const clear = () => {
    setSel(new Set());
    last.current = null;
  };
  return { sel, chosen, toggleOne, setMany, clear };
}
