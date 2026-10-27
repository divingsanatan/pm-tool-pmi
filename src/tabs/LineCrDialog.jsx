import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Modal } from '../components/UI';
import { ITER_UNIT, lineTotal, maxIter, suggestIter } from '../lib/calc';
import { lineCrs, baseTotal } from '../lib/lineChange';
import { money, nz } from '../lib/format';

const BASES = [['week', 'Per week'], ['month', 'Per month'], ['sprint', 'Per sprint'], ['project', 'One-time']];
const NEW_CR = '__new';

// After a baseline, a budget line is added or changed through a change request: pick an open one or raise a new one.
// line: the values to start from (a new line, or the baselined line being changed). existing: the line when it is a change.
export default function LineCrDialog({ existing, onConfirm, onCancel }) {
  const { S } = useStore();
  const opts = lineCrs(S);
  const [f, setF] = useState(() => ({
    name: existing ? existing.name : '', amount: existing ? String(nz(existing.amount)) : '', per: existing ? existing.per : 'project',
    iterations: existing && existing.per !== 'project' ? String(nz(existing.iterations)) : '',
  }));
  const [sel, setSel] = useState(existing && existing.crId && opts.some((c) => c.id === existing.crId) ? existing.crId : opts.length ? '' : NEW_CR);
  const [title, setTitle] = useState(existing ? 'Change budget line “' + existing.name + '”' : 'Add a budget line');
  const [days, setDays] = useState('0');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amt = parseFloat(f.amount), it = parseFloat(f.iterations);
  const once = f.per === 'project';
  const cap = maxIter(S, f.per);
  const itOk = once || (!isNaN(it) && it >= 0 && it <= cap);
  const next = { name: f.name.trim(), amount: isNaN(amt) ? 0 : amt, per: f.per, iterations: once ? 0 : isNaN(it) ? 0 : it };
  const claim = Math.round((lineTotal(S, next) - (existing ? baseTotal(S, existing) : 0)) * 100) / 100;
  const crOk = sel === NEW_CR ? title.trim() !== '' && days !== '' && !isNaN(parseInt(days, 10)) : !!sel;
  const ok = next.name !== '' && !isNaN(amt) && itOk && crOk;
  const go = () => ok && onConfirm(sel === NEW_CR ? { new: { title: title.trim(), days: parseInt(days, 10) } } : { crId: sel }, next);
  return (
    <Modal title={existing ? 'Change a baselined budget line' : 'Add a budget line'} onClose={onCancel}>
      <p className="hint" style={{ marginBottom: 12 }}>
        The budget is locked by the baseline. Any change to it is made through a change request, and the new baseline created when that request is implemented becomes the base for every calculation.
      </p>
      <div className="form">
        <label className="fld">Line item *<input className="c" value={f.name} onChange={set('name')} /></label>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <label className="fld" style={{ flex: 1, minWidth: 120 }}>Amount *<input className="c n" type="number" step="any" inputMode="decimal" value={f.amount} onChange={set('amount')} /></label>
          <label className="fld" style={{ flex: 1, minWidth: 120 }}>Basis
            <select className="c" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value, iterations: e.target.value === 'project' ? '' : String(suggestIter(S, e.target.value)) })}>
              {BASES.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
          </label>
          {!once && (
            <label className="fld" style={{ flex: 1, minWidth: 120 }}>How many {ITER_UNIT[f.per]} *
              <input className="c n" type="number" step="any" min="0" max={cap} value={f.iterations} onChange={set('iterations')} aria-invalid={!itOk || undefined} />
            </label>
          )}
        </div>
        {!itOk && <p className="msg lateTxt" style={{ margin: 0 }}>The project has only {cap} {ITER_UNIT[f.per]}, so this cost cannot repeat more often than that.</p>}
        <label className="fld">Change request *
          <select className="c" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Change request">
            {!sel && <option value="">Choose a change request…</option>}
            {opts.map((c) => (<option key={c.id} value={c.id}>{c.code} · {c.title || '(untitled)'} · {c.status}</option>))}
            <option value={NEW_CR}>+ Raise a new change request</option>
          </select>
        </label>
        {sel === NEW_CR && (
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <label className="fld" style={{ flex: 2, minWidth: 160 }}>Title *<input className="c" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="fld" style={{ flex: 1, minWidth: 120 }}>Schedule change (days) *<input className="c n" type="number" step="1" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          </div>
        )}
        <p className="msg" style={{ margin: 0 }}>This adds <b>{money(claim)}</b> to the request's cost change{existing ? ' (new total ' + money(lineTotal(S, next)) + ' against ' + money(baseTotal(S, existing)) + ' in the baseline)' : ''}. It becomes part of the budget only when the request is approved and implemented.</p>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={go}>Link and save</button>
      </div>
    </Modal>
  );
}
