import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Modal } from './UI';
import { MAX_ROWS, TEMPLATE_CSV, applyImport, exportCsv, parseCsv, planImport } from '../lib/csvImport';
import { activePeople } from '../lib/people';
import { containerById, makeTask } from '../lib/tasks';

const download = (text, name) => {
  const bl = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(bl);
  const el = document.createElement('a');
  el.href = url;
  el.download = name;
  document.body.appendChild(el);
  el.click();
  el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
};
const ACTION = { new: ['New', 'good'], update: ['Update', 'warn'], same: ['No change', 'neutral'], skip: ['Skipped', 'bad'] };

// Adds work items to one sprint (or the backlog) from a CSV file, or updates the ones that already exist.
// A preview is shown first; nothing is saved until you confirm.
export default function ImportDialog({ pid, cid, onClose }) {
  const { W, updateW } = useStore();
  const S = W.projects.find((p) => p.id === pid);
  const c = S && containerById(S, cid);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [mode, setMode] = useState('new');
  const [err, setErr] = useState('');
  const plan = useMemo(() => (S && rows ? planImport(S, cid, rows, mode) : null), [S, cid, rows, mode]);
  if (!S || !c) return null;

  const template = () => {
    const ppl = activePeople(S).map((p) => p.name).filter(Boolean);
    const a = ppl[0] || '', b = ppl[1] || ppl[0] || '';
    download(TEMPLATE_CSV.replace('Ritik Sir', a).replace('Narendra;Kaye', [b, ppl[2]].filter(Boolean).join(';')), 'work-items-template.csv');
  };

  const read = (file) => {
    setErr('');
    setRows(null);
    if (!file) return;
    if (file.size > 1024 * 1024) return setErr('This file is larger than 1 MB. Split it into smaller files.');
    setFileName(file.name);
    const fr = new FileReader();
    fr.onload = () => {
      const r = parseCsv(String(fr.result));
      if (r.length - 1 > MAX_ROWS) return setErr('This file has more than ' + MAX_ROWS + ' rows. Import it in smaller parts.');
      setRows(r);
    };
    fr.onerror = () => setErr('Could not read that file.');
    fr.readAsText(file);
  };

  const problem = plan && (plan.missing.includes('name') ? 'The first row must have a column called Name (or Title / Task). Download the template to see the layout.' : !plan.items.length ? 'No work items found: every row has an empty Name.' : '');
  const todo = plan ? plan.add + plan.update : 0;
  const go = () => {
    updateW((w) => { const pr = w.projects.find((x) => x.id === pid); if (pr) applyImport(pr, cid, plan.items, makeTask); }); // the activity log records each change
    onClose();
  };

  const shown = plan && !problem ? plan.items.slice(0, 60) : [];
  return (
    <Modal title={'Import work items into ' + c.name} onClose={onClose} wide="xl">
      <p className="hint">Add many work items at once from a spreadsheet saved as CSV. The first row holds the column names. Only <b>Name</b> is required. Other columns: Type, Status, Priority, Assignees (separate several with ;), Start, Due, Hours, Description, Tags, Parent (the name of another item) and Code (such as T-12, used to find an item to update).</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={template}>Download template</button>
        <button className="btn" onClick={() => download(exportCsv(S, cid), (c.name || 'items').replace(/[^\w-]+/g, '-') + '-items.csv')} disabled={!c.tasks.length} title="The current items with their Code. Edit the file, then import it with “Update” selected.">Download current items</button>
        <label className="btn" style={{ display: 'inline-block' }}>
          Choose CSV file
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { read(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        {fileName && <span className="msg">{fileName}</span>}
      </div>
      <label className="fld" style={{ maxWidth: 520 }}>When a row matches an item already in {c.name}
        <select className="c" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Import mode">
          <option value="new">Add it as a new item (can create duplicates)</option>
          <option value="update">Update that item, and add the rows that have no match</option>
        </select>
      </label>
      {mode === 'update' && <p className="msg">A row matches by Code, or by Name when there is no Code. Only the columns you fill in are changed: an empty cell never erases what is already there.</p>}
      {err && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
      {problem && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{problem}</p>}
      {plan && !problem && (
        <>
          <p className="msg">
            <b>{plan.add}</b> to add · <b>{plan.update}</b> to update · {plan.same} unchanged · {plan.skip} skipped
            {plan.skipped.length ? ' · ' + plan.skipped.length + ' empty row' + (plan.skipped.length === 1 ? '' : 's') + ' ignored' : ''}
            {plan.notes ? ' · ' + plan.notes + ' note' + (plan.notes === 1 ? '' : 's') + ' below' : ''}
          </p>
          <div className="scroll" style={{ maxHeight: 340 }}>
            <table className="tbl">
              <thead><tr><th>Row</th><th>Action</th><th>Name</th><th>What happens</th></tr></thead>
              <tbody>
                {shown.map((it) => {
                  const [label, cls] = ACTION[it.action];
                  const parts = [];
                  if (it.action === 'update') parts.push('Changes: ' + it.changes.join('; '));
                  if (it.action === 'new') parts.push([it.f.type, it.f.start && 'from ' + it.f.start, it.f.due && 'due ' + it.f.due, it.f.effort != null && it.f.effort + ' h'].filter(Boolean).join(' · '));
                  return (
                    <tr key={it.line}>
                      <td className="mono">{it.line}</td>
                      <td><span className={'pill ' + cls}>{label}</span></td>
                      <td>{it.f.name}</td>
                      <td>
                        {parts.filter(Boolean).join(' ')}
                        {it.warn.length > 0 && <div className="msg lateTxt">{it.warn.join('. ')}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {plan.items.length > shown.length && <p className="msg">Showing the first {shown.length} rows. All of them will be applied.</p>}
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!plan || !!problem || !todo} onClick={go}>
          {plan && !problem && todo ? [plan.add ? 'Add ' + plan.add : '', plan.update ? 'Update ' + plan.update : ''].filter(Boolean).join(' and ') : 'Apply'}
        </button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
