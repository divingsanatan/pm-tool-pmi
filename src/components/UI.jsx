import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import DataPanel from './DataPanel';
import StatusManager from './StatusManager';
import TypeManager from './TypeManager';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { today } from '../lib/dates';
import './toast.css';

const Ctx = createContext(null);
export const useUI = () => useContext(Ctx);

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(720px, 100%)' } : undefined}>
        <div className="row sp" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ask({ title, body, confirm, danger, onConfirm }) shows an in-app confirm dialog
// (window.confirm is blocked inside many embedded pages).
function CostForm({ initial, onClose }) {
  const { S } = useStore();
  const costs = useCosts();
  const [f, setF] = useState({ date: initial.date || today(), element: initial.element || '', desc: '', amount: '' });
  const names = ['Team labour'].concat(S.lines.map((l) => l.name).filter(Boolean));
  const ok = f.date && f.amount !== '' && !isNaN(parseFloat(f.amount));
  const save = () => {
    if (!ok) return;
    costs.add({ date: f.date, element: f.element.trim(), desc: f.desc.trim(), amount: parseFloat(f.amount) });
    onClose();
  };
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="d-grid" onKeyDown={(e) => e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && save()}>
      <label className="fld">Date<input className="c" type="date" value={f.date} onChange={on('date')} /></label>
      <label className="fld">Amount<input className="c n" type="number" step="any" inputMode="decimal" autoFocus value={f.amount} onChange={on('amount')} placeholder="0" /></label>
      <label className="fld" style={{ gridColumn: '1 / -1' }}>Cost element
        <input className="c" list="cost-elements-dlg" value={f.element} onChange={on('element')} placeholder="e.g. Team labour, Licenses, Cloud" />
        <datalist id="cost-elements-dlg">{names.map((n) => (<option key={n} value={n} />))}</datalist>
      </label>
      <label className="fld" style={{ gridColumn: '1 / -1' }}>Description (optional)<input className="c" value={f.desc} onChange={on('desc')} /></label>
      <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={save}>Add cost</button>
      </div>
    </div>
  );
}

export function UIProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const [data, setData] = useState(false);
  const [cost, setCost] = useState(null);
  const [stat, setStat] = useState(false);
  const [typ, setTyp] = useState(false);
  const openStatuses = useCallback(() => setStat(true), []);
  const openTypes = useCallback(() => setTyp(true), []);
  const addCost = useCallback((init = {}) => setCost(init), []);
  const ask = useCallback((o) => setDlg(o), []);
  const openData = useCallback(() => setData(true), []);
  // toast({ id, tone: 'info' | 'warn' | 'bad', text, ttl, actions: [{ label, primary, onClick }] }); a toast with the same id replaces the old one.
  // A toast with actions stays until the user picks one (or cancels).
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((o) => {
    const id = o.id || Math.random().toString(36).slice(2);
    setToasts((t) => t.filter((x) => x.id !== id).concat({ ...o, id, n: Date.now() + Math.random() }));
  }, []);
  useEffect(() => {
    const timed = toasts.filter((t) => t.ttl && !(t.actions && t.actions.length));
    if (!timed.length) return undefined;
    const ids = timed.map((t) => setTimeout(() => dismiss(t.id), t.ttl));
    return () => ids.forEach(clearTimeout);
  }, [toasts, dismiss]);
  return (
    <Ctx.Provider value={{ ask, openData, addCost, openStatuses, openTypes, toast, dismiss }}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.tone || 'info')} role={t.actions && t.actions.length ? 'alertdialog' : 'status'}>
            <p>{t.text}</p>
            <div className="toast-act">
              {(t.actions || []).map((a, i) => (
                <button key={i} className={'btn' + (a.primary ? ' primary' : '')} onClick={() => { dismiss(t.id); a.onClick(); }}>{a.label}</button>
              ))}
              {t.actions && t.actions.length > 0 && <button className="btn" onClick={() => dismiss(t.id)}>Cancel</button>}
            </div>
            <button className="x toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
      {dlg && (
        <Modal title={dlg.title} onClose={() => setDlg(null)}>
          <p className="hint" style={{ marginBottom: 16 }}>{dlg.body}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setDlg(null)}>Cancel</button>
            <button
              className={'btn ' + (dlg.danger ? 'danger' : 'primary')}
              autoFocus
              onClick={() => {
                const f = dlg.onConfirm;
                setDlg(null);
                f();
              }}
            >
              {dlg.confirm || 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
      {stat && (
        <Modal title="Task statuses" onClose={() => setStat(false)} wide>
          <StatusManager />
        </Modal>
      )}
      {typ && (
        <Modal title="Work item types" onClose={() => setTyp(false)} wide>
          <TypeManager />
        </Modal>
      )}
      {cost && (
        <Modal title="Add a cost" onClose={() => setCost(null)}>
          <CostForm initial={cost} onClose={() => setCost(null)} />
        </Modal>
      )}
      {data && (
        <Modal title="Data" onClose={() => setData(false)} wide>
          <DataPanel />
        </Modal>
      )}
    </Ctx.Provider>
  );
}
