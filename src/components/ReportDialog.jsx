import { useMemo, useState } from 'react';
import { Modal } from './UI';
import { useStore } from '../store/StoreContext';
import { canSeeBudget } from '../lib/access';
import { SECTIONS, buildReport } from '../lib/report';
import { reportMarkdown } from '../lib/reportMd';
import { addDays, today } from '../lib/dates';

const BY_KEY = 'sc-report-prepared-by';
const getBy = () => { try { return localStorage.getItem(BY_KEY) || ''; } catch (e) { return ''; } };
const setBy = (v) => { try { localStorage.setItem(BY_KEY, v); } catch (e) { /* a blocked store only means the name is not remembered */ } };

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* The "Report" button. Without sprintId it reports on the project; with one it reports on that sprint.
   The report holds budget figures, so only Admin and Project Manager see the button. */
export function ReportButton({ sprintId, className = 'btn' }) {
  const { role } = useStore();
  const [open, setOpen] = useState(false);
  if (!canSeeBudget(role)) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} title={sprintId ? 'Download a report for this sprint' : 'Download a report for this project'}>Report</button>
      {open && <ReportDialog sprintId={sprintId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ sprintId, onClose }) {
  const { S } = useStore();
  const sp = sprintId ? S.sprints.find((s) => s.id === sprintId) : null;
  const [format, setFormat] = useState('pdf');
  const [scope, setScope] = useState('project');
  const [from, setFrom] = useState(() => addDays(today(), -13));
  const [to, setTo] = useState(() => today());
  const [by, setByState] = useState(getBy);
  const [notes, setNotes] = useState('');
  const [sections, setSections] = useState(() => SECTIONS.map(([id]) => id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const opts = { scope: sp ? 'sprint' : scope, sprintId, from, to, preparedBy: by, notes, sections };
  const toggle = (id) => setSections((l) => (l.includes(id) ? l.filter((x) => x !== id) : SECTIONS.map(([k]) => k).filter((k) => k === id || l.includes(k))));

  // the data gaps that change the numbers, worked out live so they can be fixed before downloading
  const quality = useMemo(() => {
    try { return buildReport(S, { ...opts, sections: [] }).quality || []; } catch (e) { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, sprintId, scope, from, to]);

  const download = async () => {
    setBusy(true); setErr('');
    try {
      setBy(by.trim());
      const R = buildReport(S, opts);
      if (R.empty) throw new Error(R.empty);
      if (format === 'pdf') {
        const { reportPdf, reportFilename } = await import('../lib/reportPdf');
        const doc = await reportPdf(R);
        save(doc.output('blob'), reportFilename(R, 'pdf'));
      } else {
        const { reportFilename } = await import('../lib/reportPdf');
        save(new Blob([reportMarkdown(R)], { type: 'text/markdown;charset=utf-8' }), reportFilename(R, 'md'));
      }
      onClose();
    } catch (e) {
      setErr((e && e.message) || String(e));
    } finally { setBusy(false); }
  };

  return (
    <Modal title={sp ? 'Report: ' + sp.name : 'Report: ' + (S.meta.name || 'project')} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        A status report for leadership: schedule and cost first, then work progress, pending tasks, and risks and issues.
      </p>
      <div className="fld">Format
        <div className="seg" role="group" aria-label="File format">
          <button aria-pressed={format === 'pdf'} onClick={() => setFormat('pdf')}>PDF</button>
          <button aria-pressed={format === 'md'} onClick={() => setFormat('md')}>Markdown (.md)</button>
        </div>
      </div>
      {!sp && (
        <div className="fld" style={{ marginTop: 10 }}>Covers
          <div className="seg" role="group" aria-label="Report scope">
            <button aria-pressed={scope === 'project'} onClick={() => setScope('project')}>Entire project</button>
            <button aria-pressed={scope === 'custom'} onClick={() => setScope('custom')}>Custom dates</button>
          </div>
        </div>
      )}
      {!sp && scope === 'custom' && (
        <div className="row" style={{ marginTop: 10, gap: 12 }}>
          <label className="fld">From<input className="c" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fld">To<input className="c" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}
      <label className="fld" style={{ marginTop: 10 }}>Prepared by (optional)
        <input className="c" value={by} onChange={(e) => setByState(e.target.value)} placeholder="Your name" />
      </label>
      <label className="fld" style={{ marginTop: 10 }}>Your comment for the reader (optional)
        <textarea className="c" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example: the delay comes from the late design sign-off; we ask leadership to approve CR-03." />
      </label>
      <details style={{ marginTop: 10 }}>
        <summary className="msg" style={{ cursor: 'pointer' }}>Choose sections ({sections.length} of {SECTIONS.length})</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
          {SECTIONS.map(([id, l]) => (
            <label key={id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={sections.includes(id)} onChange={() => toggle(id)} /> {l}</label>
          ))}
        </div>
      </details>
      {quality.length > 0 && (
        <div className="msg" style={{ marginTop: 12 }} role="status">
          <b>Check before you share</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {quality.map((q, i) => (<li key={i} className={q.cls === 'bad' ? 'lateTxt' : ''}>{q.text}</li>))}
          </ul>
        </div>
      )}
      {err && <p className="msg lateTxt" role="alert">The report could not be created: {err}</p>}
      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={download} disabled={busy || !sections.length}>{busy ? 'Preparing…' : 'Download ' + (format === 'pdf' ? 'PDF' : 'Markdown')}</button>
      </div>
    </Modal>
  );
}
