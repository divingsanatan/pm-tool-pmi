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
    setPos({ top: r.bottom + 4, left: r.left, right: window.innerWidth - r.right, rTop: r.top });
  };

  // flip upward if the menu would run off the bottom of the screen
  useLayoutEffect(() => {
    if (!pos || !menu.current || pos.fixed) return;
    const h = menu.current.offsetHeight;
    if (pos.top + h > window.innerHeight - 8) setPos({ ...pos, top: Math.max(8, pos.rTop - h - 4), fixed: true });
  }, [pos]);

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
          <div ref={menu} className="menu" role="menu" style={{ position: 'fixed', top: pos.top, ...(align === 'right' ? { right: pos.right } : { left: pos.left }) }}>
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
