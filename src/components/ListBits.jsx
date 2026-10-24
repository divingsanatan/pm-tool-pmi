import { useState } from 'react';

// "+ Add task" row that turns into a one-line input
export function AddRow({ onAdd, label = 'Add task' }) {
  const [on, setOn] = useState(false);
  const [v, setV] = useState('');
  if (!on) return <button className="add-row" onClick={() => setOn(true)}>+ {label}</button>;
  const submit = () => {
    const n = v.trim();
    if (n) onAdd(n);
    setV('');
  };
  return (
    <div className="add-row on">
      <input
        className="c"
        autoFocus
        value={v}
        placeholder="Name, then press Enter"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v.trim()) submit();
          setOn(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setV('');
            setOn(false);
          }
        }}
        aria-label="New work item name"
      />
    </div>
  );
}

// checkbox that can show "some selected"
export function TriBox({ all, some, onChange, label }) {
  return <input type="checkbox" className="tg-sel" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={onChange} aria-label={label} />;
}
