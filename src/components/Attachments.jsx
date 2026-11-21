import { useEffect, useRef, useState } from 'react';
import { Modal, useUI } from './UI';
import { useAttachments } from '../store/useAttachments';
import { ACCEPT, TYPES_TEXT, extOf, fmtSize, kindOf, urlOf } from '../lib/attachments';
import { fdate } from '../lib/dates';
import '../attachments.css';

// The link that shows a file (see lib/attachments). on=false waits, so lists do not fetch links they do not need.
export function useAttUrl(att, on = true, download = false) {
  const [st, setSt] = useState({ url: '', err: '' });
  useEffect(() => {
    if (!on) return undefined;
    let off = false;
    urlOf(att, download).then((u) => !off && setSt({ url: u, err: '' })).catch((e) => !off && setSt({ url: '', err: e.message }));
    return () => { off = true; };
  }, [att.path, att.store, on, download]);
  return st;
}

// The short label on a document's tile: its ending in capitals (PDF, DOCX, XLSX...)
const label = (att) => (extOf(att.name) || 'FILE').toUpperCase().slice(0, 4);

// A small picture of a file: the image itself, or a tile with the document's type
export function AttPreview({ att, className = '' }) {
  const k = kindOf(att.type);
  const { url, err } = useAttUrl(att, k === 'image');
  if (k === 'image') {
    if (!url) return <span className={'att-ph ' + className} title={err || 'Loading'}>{err ? '⚠' : '…'}</span>;
    return <img className={className} src={url} alt={att.name} loading="lazy" />;
  }
  return <span className={'att-ico ' + className} aria-hidden="true">{label(att)}</span>;
}

function Lightbox({ att, onClose }) {
  const k = kindOf(att.type);
  const { url, err } = useAttUrl(att);
  const dl = useAttUrl(att, k === 'doc', true); // documents cannot be shown here: they download under their own name
  return (
    <Modal title={att.name} onClose={onClose} wide="xl">
      <div className="att-view">
        {k === 'doc' ? (
          <div className="att-doc"><span className="att-ico big">{label(att)}</span><p className="msg">This kind of file cannot be shown here.</p>
            {dl.err ? <p className="msg">{dl.err}</p> : <a className="btn primary" href={dl.url || undefined} aria-disabled={!dl.url} download={att.name} target="_blank" rel="noopener noreferrer">{dl.url ? 'Download' : 'Preparing…'}</a>}</div>
        ) : err ? <p className="msg">{err}</p> : !url ? <p className="msg">Loading…</p>
          : k === 'image' ? <img src={url} alt={att.name} />
          : <iframe src={url} title={att.name} />}
      </div>
      <p className="msg" style={{ margin: '8px 0 0' }}>
        {fmtSize(att.size)}{att.by ? ' · added by ' + att.by : ''}{att.on ? ' on ' + fdate(att.on) : ''}
        {k !== 'doc' && url && <> · <a href={url} target="_blank" rel="noopener noreferrer">Open in a new tab</a></>}
      </p>
    </Modal>
  );
}

// A pasted screenshot has no useful name: give it one
const named = (f) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)
  ? new File([f], 'screenshot-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.' + f.name.split('.').pop(), { type: f.type })
  : f);

// For the work item drawer: add, look at and remove the files of one work item
export function AttachmentsSection({ task }) {
  const A = useAttachments();
  const ui = useUI();
  const list = task.attachments || [];
  const [busy, setBusy] = useState(0);
  const [errs, setErrs] = useState([]);
  const [open, setOpen] = useState(null);
  const [over, setOver] = useState(false);
  const pick = useRef(null);
  const take = async (files) => {
    const fs = Array.from(files || []);
    if (!fs.length) return;
    setErrs([]);
    setBusy((b) => b + fs.length);
    const r = await A.add(task.id, fs);
    setBusy((b) => b - fs.length);
    setErrs(r.errors);
  };
  const ask = (a) => ui.ask({ title: 'Remove ' + a.name + '?', body: 'The file is removed from this work item and deleted. This cannot be undone.', confirm: 'Remove', danger: true, onConfirm: () => A.remove(task.id, a.id) });
  return (
    <div className="att">
      {A.can && (
        <div
          className={'att-drop' + (over ? ' over' : '')}
          tabIndex={0}
          role="button"
          aria-label="Add files: click to choose, or drop files here"
          onClick={() => pick.current && pick.current.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.current && pick.current.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(Array.from(e.dataTransfer.files || []).map(named)); }}
          onPaste={(e) => { const fs = Array.from(e.clipboardData.files || []); if (fs.length) { e.preventDefault(); take(fs.map(named)); } }}
        >
          <b>Add images or documents</b>
          <span>Drop them here, click to choose, or click here and paste a screenshot (Ctrl+V)</span>
          <small className="msg">{TYPES_TEXT}</small>
          <input ref={pick} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {busy > 0 && <p className="msg att-busy">Uploading {busy} file{busy === 1 ? '' : 's'}…</p>}
      {errs.map((m, i) => (<p key={i} className="att-err" role="alert">{m}</p>))}
      {list.length > 0 && (
        <div className="att-grid">
          {list.map((a) => (
            <div key={a.id} className="att-it">
              <button type="button" className="att-th" onClick={() => setOpen(a)} title={'Open ' + a.name}>
                <AttPreview att={a} className="att-pv" />
              </button>
              <div className="att-nm" title={a.name}>{a.name}</div>
              <div className="att-sz msg">{fmtSize(a.size)}</div>
              {A.can && <button type="button" className="x att-x" onClick={() => ask(a)} aria-label={'Remove ' + a.name} title="Remove">✕</button>}
            </div>
          ))}
        </div>
      )}
      {!list.length && !A.can && <p className="msg" style={{ margin: 0 }}>No attachments.</p>}
      {open && <Lightbox att={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
