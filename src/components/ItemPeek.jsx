import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AttPreview } from './Attachments';
import { kindOf } from '../lib/attachments';
import { htmlToText } from '../lib/richtext';
import '../attachments.css';

const descOf = (t) => (t.description && t.description.trim()) || htmlToText(t.descriptionHtml || '');
const NAMES = { image: ['image', 'images'], doc: ['document', 'documents'] };

// Small icons after a work item's name: it has a description, and how many files are attached
export function ItemMarks({ t }) {
  const n = (t.attachments || []).length;
  const d = !!descOf(t);
  if (!n && !d) return null;
  return (
    <span className="marks">
      {d && <span className="mk" title="Has a description" aria-label="Has a description"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></span>}
      {n > 0 && <span className="mk" title={n + ' attachment' + (n === 1 ? '' : 's')} aria-label={n + ' attachments'}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4.5l-5 5a1.7 1.7 0 002.4 2.4l5.2-5.2a3 3 0 00-4.2-4.2L3.6 8a4.3 4.3 0 006.1 6.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{n}</span>}
    </span>
  );
}

function Peek({ t, rect }) {
  const text = descOf(t);
  const atts = t.attachments || [];
  const kinds = {};
  atts.forEach((a) => { const k = kindOf(a.type) === 'image' ? 'image' : 'doc'; kinds[k] = (kinds[k] || 0) + 1; });
  const summary = Object.keys(kinds).map((k) => kinds[k] + ' ' + NAMES[k][kinds[k] === 1 ? 0 : 1]).join(' · ');
  const below = rect.bottom + 320 < window.innerHeight;
  const style = { left: Math.max(8, Math.min(rect.left + 40, window.innerWidth - 368)), ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) };
  return (
    <div className="peek" style={style} role="tooltip">
      <div className="peek-h"><b className="mono">{t.code}</b> {t.name}</div>
      {text ? <div className="peek-desc">{text.length > 700 ? text.slice(0, 700) + '…' : text}</div> : <div className="peek-none">No description</div>}
      {atts.length > 0 ? (
        <div className="peek-media">
          <div className="peek-sum">📎 {summary}</div>
          <div className="peek-row">
            {atts.slice(0, 4).map((a) => (<AttPreview key={a.id} att={a} className="peek-pv" />))}
            {atts.length > 4 && <span className="peek-more">+{atts.length - 4}</span>}
          </div>
        </div>
      ) : <div className="peek-none">No attachments</div>}
    </div>
  );
}

// Hover a work item for a moment to see its description and attachments. Returns { bind, node }: spread bind on the element to hover
// and render node anywhere in the row. Items with neither a description nor files show nothing.
export function usePeek(t) {
  const [rect, setRect] = useState(null);
  const tm = useRef(0);
  const can = !!descOf(t) || (t.attachments || []).length > 0;
  const hide = () => { clearTimeout(tm.current); setRect(null); };
  useEffect(() => {
    if (!rect) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', hide, true);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('keydown', hide, true); };
  }, [rect]);
  useEffect(() => () => clearTimeout(tm.current), []);
  const bind = can ? {
    onMouseEnter: (e) => { const r = e.currentTarget.getBoundingClientRect(); clearTimeout(tm.current); tm.current = setTimeout(() => setRect(r), 400); },
    onMouseLeave: hide,
    onMouseDown: hide,
  } : {};
  return { bind, node: rect && can ? createPortal(<Peek t={t} rect={rect} />, document.body) : null };
}
