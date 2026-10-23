import { useEffect, useRef, useState } from 'react';

// Multi-select state for a list of work items: click toggles, shift-click selects a range, groups can select all.
// visibleIds: items currently shown (hidden items are never acted on). orderIds: shown order, for ranges.
export function useSelect(visibleIds, orderIds, resetKey) {
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
    if (range && last.current && orderIds.includes(last.current) && orderIds.includes(id)) {
      const a = orderIds.indexOf(last.current), b = orderIds.indexOf(id);
      const on = !sel.has(id);
      orderIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? n.add(x) : n.delete(x)));
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
  const clear = () => {
    setSel(new Set());
    last.current = null;
  };
  return { sel, chosen, toggleOne, setMany, clear };
}
