import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Button + dropdown rendered in a portal (so table scroll areas never clip it).
 * items: [{ label, onClick, danger, active, disabled, hint }]  or  { sep: true }
 */
export default function Menu({ label, className = '', items, title, align = 'left', footer, wide }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const openedAt = useRef(0);
  const close = () => setPos(null);

  const toggle = (e) => {
    e.stopPropagation();
    if (pos) return close();
    openedAt.current = Date.now();
    const b = btn.current.getBoundingClientRect();
    // phones get a sheet that slides up from the bottom; larger screens get a dropdown placed next to the button
    const sheet = window.matchMedia('(max-width: 640px)').matches;
    setPos({ r: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, sheet, placed: false, w: window.innerWidth });
  };

  // Place the dropdown once it has been measured: inside the screen on every side, below the button when there is room, above it when
  // that side has more room, and never taller than the room it has (it scrolls inside instead).
  useLayoutEffect(() => {
    if (!pos || pos.placed || !menu.current) return;
    if (pos.sheet) return setPos({ ...pos, placed: true });
    const M = 8;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = Math.min(menu.current.offsetWidth, vw - 2 * M);
    const h = menu.current.scrollHeight + 2;
    let left = align === 'right' ? pos.r.right - w : pos.r.left;
    left = Math.max(M, Math.min(left, vw - w - M));
    const below = vh - pos.r.bottom - M - 4;
    const above = pos.r.top - M - 4;
    let top, maxH;
    if (h <= below || below >= above) { top = pos.r.bottom + 4; maxH = below; }
    else { maxH = above; top = pos.r.top - 4 - Math.min(h, maxH); }
    maxH = Math.max(maxH, Math.min(h, 160));
    setPos({ ...pos, left, top: Math.max(M, top), maxH, placed: true });
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // closing on resize would also close the menu when a phone's keyboard opens (a tag box inside it): only a change of width closes it
    const resize = () => window.innerWidth !== pos.w && close();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
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
          <>
            {pos.sheet && <div className="menu-back" onMouseDown={close} onTouchStart={close} />}
            <div
              ref={menu}
              className={'menu' + (wide ? ' wide' : '') + (pos.sheet ? ' sheet' : '')}
              role="menu"
              style={pos.sheet ? undefined : { position: 'fixed', top: pos.placed ? pos.top : 0, left: pos.placed ? pos.left : 0, maxHeight: pos.placed ? pos.maxH : undefined, visibility: pos.placed ? 'visible' : 'hidden' }}
            >
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
            {footer && <div className="mfoot">{typeof footer === 'function' ? footer({ close }) : footer}</div>}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
