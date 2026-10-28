import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import DataPanel from './DataPanel';
import StatusManager from './StatusManager';
import TypeManager from './TypeManager';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { DAY, pd, today } from '../lib/dates';
import { hrsf } from '../lib/format';
import { newSprint, uid } from '../lib/tasks';
import { insertAt, sane, sprintClash } from '../lib/sprintGuard';
import { calendarOf, sprintCalendar } from '../lib/offdays';
import { blankCr, currentBaseline, sprintCrs } from '../lib/change';
import './toast.css';

const Ctx = createContext(null);
export const useUI = () => useContext(Ctx);

// The details every sprint must have before it exists: name, start, end and planned hours (all typed by the user, editable later).
// Once the project has a baseline, a new sprint is a change to the approved plan, so it must belong to a change request:
// pick an open one, or raise a new one right here.
// opts: { name, start, end, hours } pre-fill the form (opts.minHours: the work items moving in, which the planned hours must cover); opts.onCreated(sprintId) runs after the sprint exists.
function SprintForm({ pid, opts = {}, onClose }) {
  const { W, updateW } = useStore();
  const p = W.projects.find((x) => x.id === pid);
  const [f, setF] = useState(() => {
    const d = newSprint(p);
    return { name: opts.name || d.name, start: opts.start || d.start, end: opts.end || d.end, hours: opts.hours ? String(opts.hours) : '', cr: '', crTitle: '', crCost: '', crDays: '' };
  });
  if (!p) return null;
  const base = currentBaseline(p);
  const crs = sprintCrs(p);
  const choice = f.cr || (base && !crs.length ? NEW_CR : '');
  const hrs = parseFloat(f.hours);
  const orderOk = sane(f.start) && sane(f.end) && f.start <= f.end;
  const hoursOk = f.hours !== '' && !isNaN(hrs) && hrs > 0 && (!opts.minHours || hrs >= opts.minHours - 0.005);
  const nameOk = f.name.trim() !== '';
  const num = (v) => v !== '' && !isNaN(parseFloat(v));
  const crOk = !base || (choice && choice !== NEW_CR) || (choice === NEW_CR && f.crTitle.trim() !== '' && num(f.crCost) && num(f.crDays));
  const clash = orderOk ? sprintClash(p, '', f.start, f.end) : []; // sprints of one project cannot overlap
  const days = orderOk ? Math.round((pd(f.end) - pd(f.start)) / DAY) + 1 : null;
  // the project's weekly off days and holidays apply to every sprint; planned % counts working days only
  const sc = orderOk ? sprintCalendar({ start: f.start, end: f.end }, null, calendarOf(p)) : null;
  const offN = sc ? sc.off : 0;
  const workDays = sc ? sc.work : null;
  const ok = nameOk && orderOk && !clash.length && hoursOk && crOk && (workDays == null || workDays > 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    if (!ok) return;
    const id = uid();
    updateW((w) => {
      const pr = w.projects.find((x) => x.id === pid);
      let crId = '';
      if (pr.baselines && pr.baselines.length) {
        crId = choice;
        if (choice === NEW_CR) {
          crId = uid();
          pr.cr.push(blankCr(pr, crId, {
            title: f.crTitle.trim(), cost: parseFloat(f.crCost), days: parseInt(f.crDays, 10),
            kind: 'Enhancement or new requirement', affects: ['Scope', 'Schedule', 'Cost'],
            desc: 'Adds ' + f.name.trim() + ' (' + f.start + ' to ' + f.end + ', ' + hrsf(hrs) + ' planned hours) to the plan.',
          }));
        }
      }
      const sp = { ...newSprint(pr, id), name: f.name.trim(), start: f.start, end: f.end, plannedHours: hrs };
      if (crId) sp.crId = crId;
      pr.sprints.splice(insertAt(pr, f.start), 0, sp);
      w.nav = { ...w.nav, projectId: pid, view: 'sprint', sprintId: id };
    });
    opts.onCreated && opts.onCreated(id);
    onClose();
  };
  const key = (e) => e.key === 'Enter' && e.target.tagName !== 'SELECT' && save();
  return (
    <div>
      <p className="hint" style={{ marginBottom: 14 }}>Every sprint needs a name, dates and planned hours. You can edit all of them later on the sprint page.</p>
      <div className="form">
        <label className="fld">Sprint name *
          <input className="c" autoFocus value={f.name} onChange={set('name')} onKeyDown={key} aria-invalid={!nameOk || undefined} />
        </label>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <label className="fld" style={{ flex: 1, minWidth: 140 }}>Start date *
            <input className="c" type="date" value={f.start} onChange={set('start')} onKeyDown={key} aria-invalid={!sane(f.start) || undefined} />
          </label>
          <label className="fld" style={{ flex: 1, minWidth: 140 }}>End date *
            <input className="c" type="date" value={f.end} onChange={set('end')} onKeyDown={key} aria-invalid={!sane(f.end) || undefined} />
          </label>
        </div>
        <label className="fld">Planned hours *
          <input className="c" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 80" value={f.hours} onChange={set('hours')} onKeyDown={key} aria-invalid={(f.hours !== '' && !hoursOk) || undefined} />
        </label>
      </div>

      {base && (
        <div className="cr-box">
          <p className="hint" style={{ margin: '0 0 8px' }}>
            <b>This project has a baseline ({base.version}).</b> A sprint added after it changes the approved plan, so it must be added through a change request.
            {crs.length ? ' Pick an open request, or raise a new one.' : ' There is no open change request yet, so raise one now. You can complete its details and get it approved in Change control.'}
          </p>
          <label className="fld">Change request *
            <select className="c" value={choice} onChange={set('cr')} aria-invalid={!crOk || undefined}>
              {!choice && <option value="">Choose a change request…</option>}
              {crs.map((c) => (<option key={c.id} value={c.id}>{c.code} · {c.title || '(untitled)'} · {c.status}</option>))}
              <option value={NEW_CR}>+ Raise a new change request</option>
            </select>
          </label>
          {choice === NEW_CR && (
            <div className="form" style={{ marginTop: 8 }}>
              <label className="fld">Change request title *
                <input className="c" value={f.crTitle} onChange={set('crTitle')} onKeyDown={key} placeholder="e.g. Add a sprint for the meal plan feature" />
              </label>
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <label className="fld" style={{ flex: 1, minWidth: 140 }}>Cost change *
                  <input className="c" type="number" step="any" inputMode="decimal" placeholder="0 if none" value={f.crCost} onChange={set('crCost')} onKeyDown={key} />
                </label>
                <label className="fld" style={{ flex: 1, minWidth: 140 }}>Schedule change (days) *
                  <input className="c" type="number" step="1" inputMode="numeric" placeholder="0 if none" value={f.crDays} onChange={set('crDays')} onKeyDown={key} />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="hint" style={{ margin: '10px 0 0', minHeight: 20 }} role="status">
        {!nameOk && 'Enter a sprint name.'}
        {nameOk && !orderOk && (sane(f.start) && sane(f.end) ? 'The end date must be on or after the start date.' : 'Enter both a start and an end date.')}
        {nameOk && orderOk && clash.length > 0 && 'Sprint dates cannot overlap another sprint. Change the start or end date.'}
        {nameOk && orderOk && !clash.length && !hoursOk && 'Enter the planned hours (more than 0).'}
        {nameOk && orderOk && !clash.length && hoursOk && !crOk && (choice === NEW_CR ? 'Enter the change request title, cost change and schedule change (0 is fine).' : 'Choose the change request this sprint belongs to.')}
        {ok && days + ' calendar day' + (days === 1 ? '' : 's') + (offN ? ' − ' + offN + ' off (project calendar) = ' + workDays + ' working' : '') + ' · ' + hrsf(hrs) + ' planned hours'}
        {nameOk && orderOk && !clash.length && workDays === 0 && 'Every day would be off. Choose fewer off days.'}
      </div>
      {clash.length > 0 && <div className="banner" style={{ marginTop: 8 }}>These dates overlap {clash.map((s) => s.name + ' (' + s.start + ' to ' + s.end + ')').join(', ')}. Sprints in the same project cannot overlap, so this sprint cannot be created yet.</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={save}>Create sprint</button>
      </div>
    </div>
  );
}
const NEW_CR = '__new';

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
  const [spr, setSpr] = useState(null);
  const [stat, setStat] = useState(false);
  const [typ, setTyp] = useState(false);
  const openStatuses = useCallback(() => setStat(true), []);
  const openTypes = useCallback(() => setTyp(true), []);
  const addCost = useCallback((init = {}) => setCost(init), []);
  const ask = useCallback((o) => setDlg(o), []);
  const openData = useCallback(() => setData(true), []);
  // opens the New sprint form for a project; opts: { name, start, end, onCreated(sprintId) }
  const openSprint = useCallback((pid, opts) => setSpr({ pid, opts: opts || {} }), []);
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
    <Ctx.Provider value={{ ask, openData, addCost, openStatuses, openTypes, openSprint, toast, dismiss }}>
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
          <div className="hint" style={{ marginBottom: 16 }}>{dlg.body}</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setDlg(null)}>Cancel</button>
            {(dlg.actions || [{ label: dlg.confirm || 'Confirm', primary: !dlg.danger, danger: !!dlg.danger, onClick: dlg.onConfirm }]).map((a, i) => (
              <button
                key={i}
                className={'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '')}
                autoFocus={i === 0}
                onClick={() => {
                  setDlg(null);
                  a.onClick();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {spr && (
        <Modal title="New sprint" onClose={() => setSpr(null)}>
          <SprintForm pid={spr.pid} opts={spr.opts} onClose={() => setSpr(null)} />
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
