import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Button + dropdown rendered in a portal (so table scroll areas never clip it).
 * items: [{ label, onClick, danger, active, disabled, hint }]  or  { sep: true }
 */
export default function Menu({ label, className = '', items, title, align = 'left' }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const openedAt = useRef(0);
  const close = () => setPos(null);

  const toggle = (e) => {
    e.stopPropagation();
    if (pos) return close();
    openedAt.current = Date.now();
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: align === 'right' ? r.right : r.left, anchorRight: r.right, rTop: r.top });
  };

  // keep the menu fully on screen: flip upward near the bottom, and slide left/right so it never runs off a side
  // (a "⋯" button at the far right of a table used to open its menu past the screen edge)
  // (it is first drawn hidden at left 0 so its natural width is measured, then placed)
  useLayoutEffect(() => {
    if (!pos || !menu.current || pos.placed) return;
    const w = menu.current.offsetWidth;
    const h = menu.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = pos.top;
    if (top + h > vh - 8) top = Math.max(8, pos.rTop - h - 4);
    let left = align === 'right' ? pos.anchorRight - w : pos.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    setPos({ ...pos, top, left, placed: true });
  }, [pos, align]);

  useEffect(() => {
    if (!pos) return undefined;
    const down = (e) => {
      if (menu.current && menu.current.contains(e.target)) return;
      if (btn.current && btn.current.contains(e.target)) return;
      close();
    };
    const key = (e) => e.key === 'Escape' && close();
    // ignore scrolls caused by opening the menu itself (browsers scroll the item into view)
    const away = (e) => Date.now() - openedAt.current > 250 && !(menu.current && menu.current.contains(e.target)) && close();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', away, true);
    };
  }, [pos]);

  return (
    <>
      <button ref={btn} type="button" className={className} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}>
        {label}
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="menu" role="menu" style={{ position: 'fixed', top: pos.top, ...(pos.placed ? { left: pos.left } : { left: 0, visibility: 'hidden' }) }}>
            {items.map((it, i) =>
              it.sep ? (
                <div key={i} className="msep" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={'mi' + (it.danger ? ' danger' : '') + (it.active ? ' on' : '')}
                  disabled={it.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!it.keepOpen) close();
                    it.onClick && it.onClick();
                  }}
                >
                  <span>{it.label}</span>
                  {it.active && <span aria-hidden="true">✓</span>}
                  {it.hint && <span className="msg">{it.hint}</span>}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}
