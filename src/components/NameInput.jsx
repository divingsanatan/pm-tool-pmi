import { useEffect, useRef, useState } from 'react';
import { useTasks } from '../store/useTasks';

// The name of a work item, edited in place. Enter adds a sibling below, Tab / Shift+Tab indent / outdent, Alt+Up / Down reorder.
export default function NameInput({ t, focus, bold, done, keys }) {
  const tk = useTasks();
  const [v, setV] = useState(t.name);
  const ref = useRef(null);
  useEffect(() => setV(t.name), [t.name]);
  useEffect(() => {
    if (focus && focus.id === t.id && ref.current) {
      ref.current.focus();
      if (focus.select) ref.current.select();
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = v.trim();
    if (n && n !== t.name) tk.patch(t.id, { name: n });
    else setV(t.name);
  };
  return (
    <input
      ref={ref}
      className={'c w-in' + (bold ? ' bold' : '') + (done ? ' done' : '')}
      value={v}
      aria-label="Work item name"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
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
      }}
    />
  );
}
