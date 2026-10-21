import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { seedWorkspace } from '../lib/seed';

export default function DataPanel() {
  const { W, replace } = useStore();
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const [armReset, setArmReset] = useState(false);

  const doImport = (txt) => {
    try {
      const o = JSON.parse(txt);
      if (!replace(o)) throw new Error('shape');
      setMsg('Imported.');
    } catch (e) {
      setMsg('Import failed: this is not valid Sprint Control data.');
    }
  };

  const copy = async () => {
    const txt = JSON.stringify(W, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      setMsg('Copied to clipboard.');
    } catch (e) {
      setPaste(txt);
      setMsg('Copy was blocked. The JSON is in the box below, copy it manually.');
    }
  };

  const download = () => {
    try {
      const bl = new Blob([JSON.stringify(W, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(bl);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sprint-control-workspace.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      setMsg('Download started. If nothing downloads, use Copy instead.');
    } catch (e) {
      setMsg('Download is not available here. Use Copy instead.');
    }
  };

  const reset = () => {
    if (!armReset) {
      setArmReset(true);
      return;
    }
    replace(seedWorkspace());
    setArmReset(false);
    setMsg('Restored the sample workspace.');
  };

  return (
    <div className="panel">
      <div className="row">
        <button className="btn" onClick={copy}>Copy data as JSON</button>
        <button className="btn" onClick={download}>Download JSON</button>
        <label className="btn" style={{ display: 'inline-block' }}>
          Import file
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              const fr = new FileReader();
              fr.onload = () => doImport(String(fr.result));
              fr.readAsText(f);
              e.target.value = '';
            }}
          />
        </label>
        <button className="btn danger" onClick={reset}>{armReset ? 'Click again to replace everything with sample data' : 'Reset to sample data'}</button>
      </div>
      <textarea className="paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste exported JSON here, then choose Import pasted data" aria-label="Paste JSON" />
      <div className="row">
        <button className="btn" onClick={() => doImport(paste)}>Import pasted data</button>
        <span className="msg">{msg}</span>
      </div>
    </div>
  );
}
