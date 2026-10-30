import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A text cell that wraps long text onto as many lines as it needs (instead of scrolling inside one line).
// Saves when you leave it or press Enter; Esc puts the old text back. onCommit may refuse a value (the box then shows the saved text again).
export default function WrapCell({ value, onCommit, label, placeholder, minWidth = 160 }) {
  const [v, setV] = useState(value || '');
  const ref = useRef(null);
  const latest = useRef(value || '');
  latest.current = value || '';
  useEffect(() => setV(value || ''), [value]);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  };
  useLayoutEffect(fit, [v]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !el.parentElement || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);
  const commit = () => {
    const n = v.trim().replace(/\s*\n\s*/g, ' ');
    if (n !== (value || '')) onCommit(n);
    requestAnimationFrame(() => setV(latest.current)); // show what was actually saved
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className="c wrap-in"
      style={{ minWidth }}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setV(value || ''); e.currentTarget.blur(); }
      }}
    />
  );
}
