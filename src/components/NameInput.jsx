import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTasks } from '../store/useTasks';

// The name of a work item. It reads as plain text that wraps onto as many lines as it needs (or is cut with … when "Wrap names" is off), with
// the item's tags flowing right after it, as in ClickUp. Click it (or press Enter / F2 on it) to edit in place.
// While editing: Enter adds a sibling below, Tab / Shift+Tab indent / outdent, Alt+Up / Down reorder, Esc cancels.
export default function NameInput({ t, focus, bold, done, keys, wrap = true, children }) {
  const tk = useTasks();
  const [v, setV] = useState(t.name);
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  const sel = useRef(false);
  useEffect(() => setV(t.name), [t.name]);
  useEffect(() => {
    if (focus && focus.id === t.id) {
      sel.current = !!focus.select;
      setEditing(true);
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    if (sel.current) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    sel.current = false;
  }, [editing]);
  // a multi-line box grows with its text and with the column width
  const fit = () => {
    const el = ref.current;
    if (el && el.tagName === 'TEXTAREA') {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 2 + 'px';
    }
  };
  useLayoutEffect(fit, [editing, v, wrap]);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el || !el.parentElement || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [editing, wrap]);
  const commit = () => {
    const n = v.trim().replace(/\s*\n\s*/g, ' ');
    if (n && n !== t.name) tk.patch(t.id, { name: n });
    else setV(t.name);
  };
  const cls = 'c w-in' + (bold ? ' bold' : '') + (done ? ' done' : '');
  const common = {
    ref,
    className: cls,
    value: v,
    'aria-label': 'Work item name',
    onChange: (e) => setV(e.target.value),
    onBlur: () => { commit(); setEditing(false); },
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        keys.enter();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commit();
        e.shiftKey ? keys.outdent() : keys.indent();
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        commit();
        keys.up();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        commit();
        keys.down();
      } else if (e.key === 'Escape') {
        setV(t.name);
        e.currentTarget.blur();
      }
    },
  };
  if (editing) return <span className="nm-wrap">{wrap ? <textarea rows={1} {...common} /> : <input {...common} />}</span>;
  return (
    <span className="nm-wrap">
      <span className={'nm-line' + (bold ? ' bold' : '') + (done ? ' done' : '')}>
        <span
          className="nm-text"
          role="button"
          tabIndex={0}
          title="Click to rename"
          aria-label={'Rename: ' + t.name}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditing(true); } }}
        >{t.name}</span>
        {children}
      </span>
    </span>
  );
}
