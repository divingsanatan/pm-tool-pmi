import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Modal } from './UI';
import { MAX_ROWS, TEMPLATE_CSV, applyImport, parseCsv, planImport } from '../lib/csvImport';
import { activePeople } from '../lib/people';
import { containerById, makeTask } from '../lib/tasks';

// Adds work items to one sprint (or the backlog) from a CSV file. A preview is shown first; nothing is saved until you confirm.
export default function ImportDialog({ pid, cid, onClose }) {
  const { W, updateW } = useStore();
  const S = W.projects.find((p) => p.id === pid);
  const c = S && containerById(S, cid);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  if (!S || !c) return null;

  const template = () => {
    const ppl = activePeople(S).map((p) => p.name).filter(Boolean);
    const a = ppl[0] || '', b = ppl[1] || ppl[0] || '';
    const text = TEMPLATE_CSV.replace('Ritik Sir', a).replace('Narendra;Kaye', [b, ppl[2]].filter(Boolean).join(';'));
    const bl = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(bl);
    const el = document.createElement('a');
    el.href = url;
    el.download = 'work-items-template.csv';
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const read = (file) => {
    setErr('');
    setPlan(null);
    if (!file) return;
    if (file.size > 1024 * 1024) return setErr('This file is larger than 1 MB. Split it into smaller files.');
    setFileName(file.name);
    const fr = new FileReader();
    fr.onload = () => {
      const rows = parseCsv(String(fr.result));
      if (rows.length - 1 > MAX_ROWS) return setErr('This file has more than ' + MAX_ROWS + ' rows. Import it in smaller parts.');
      const p = planImport(S, cid, rows);
      if (p.missing.includes('name')) return setErr('The first row must have a column called Name (or Title / Task). Download the template to see the layout.');
      if (!p.items.length) return setErr('No work items found: every row has an empty Name.');
      setPlan(p);
    };
    fr.onerror = () => setErr('Could not read that file.');
    fr.readAsText(file);
  };

  const go = () => {
    updateW((w) => { const pr = w.projects.find((x) => x.id === pid); if (pr) applyImport(pr, cid, plan.items, makeTask); }); // the activity log records each new item
    onClose();
  };

  const shown = plan ? plan.items.slice(0, 40) : [];
  return (
    <Modal title={'Import work items into ' + c.name} onClose={onClose} wide="xl">
      <p className="hint">Add many work items at once from a spreadsheet saved as CSV. The first row holds the column names. Only <b>Name</b> is required. Other columns: Type, Status, Priority, Assignees (separate several with ;), Start, Due, Hours, Description, Tags, Parent (the name of another item).</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={template}>Download template</button>
        <label className="btn" style={{ display: 'inline-block' }}>
          Choose CSV file
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { read(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        {fileName && <span className="msg">{fileName}</span>}
      </div>
      {err && <p className="msg" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
      {plan && (
        <>
          <p className="msg">
            <b>{plan.items.length}</b> work item{plan.items.length === 1 ? '' : 's'} ready to add to {c.name}
            {plan.skipped.length ? ' · ' + plan.skipped.length + ' empty row' + (plan.skipped.length === 1 ? '' : 's') + ' skipped' : ''}
            {plan.notes ? ' · ' + plan.notes + ' note' + (plan.notes === 1 ? '' : 's') + ' below (the item is still added, without the part that did not match)' : ''}
          </p>
          <div className="scroll" style={{ maxHeight: 340 }}>
            <table className="tbl">
              <thead><tr><th>Row</th><th>Name</th><th>Type</th><th>Start</th><th>Due</th><th className="r">Hours</th><th>Notes</th></tr></thead>
              <tbody>
                {shown.map((it) => (
                  <tr key={it.line}>
                    <td className="mono">{it.line}</td>
                    <td>{it.f.name}</td>
                    <td>{it.f.type}</td>
                    <td className="mono">{it.f.start || ''}</td>
                    <td className="mono">{it.f.due || ''}</td>
                    <td className="r mono">{it.f.effort == null ? '' : it.f.effort}</td>
                    <td>{it.warn.length ? <span className="msg lateTxt">{it.warn.join('. ')}</span> : <span className="msg">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.items.length > shown.length && <p className="msg">Showing the first {shown.length} rows. All {plan.items.length} will be added.</p>}
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!plan} onClick={go}>{plan ? 'Add ' + plan.items.length + ' work items' : 'Add work items'}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
