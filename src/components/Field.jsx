import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';

const toDisplay = (type, val) => {
  if (val == null) return '';
  if (type === 'pct') return String(Math.round(val * 1000) / 10);
  return String(val);
};

const conv = (type, v) => {
  if (type === 'num') {
    const n = parseFloat(v);
    return v === '' || isNaN(n) ? null : n;
  }
  if (type === 'int') {
    const n = parseInt(v, 10);
    return v === '' || isNaN(n) ? null : n;
  }
  if (type === 'pct') {
    const n = parseFloat(v);
    return v === '' || isNaN(n) ? null : n / 100;
  }
  return v;
};

/**
 * Editable table cell bound to S[sec][i][f] (or S[sec][f] for meta/ui).
 * type: 'text' | 'num' | 'int' | 'pct' | 'date'
 * 'pct' is stored as a fraction (0.5) and shown as a percent (50).
 * Text/number edits commit on blur or Enter; dates commit immediately.
 */
export function Cell({ sec, i = 0, f, value, type = 'text', cls = '', placeholder, label, onCommit, list, disabled, min }) {
  const { setField } = useStore();
  const shown = toDisplay(type, value);
  const [draft, setDraft] = useState(shown);
  const [bad, setBad] = useState(false); // a value below `min` was refused
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => setDraft(shown), [shown]);

  const commit = (v) => {
    if (v === shown) return;
    if (min != null && (type === 'num' || type === 'int') && v !== '' && parseFloat(v) < min) {
      setBad(true); // refuse it; the field snaps back to the stored value
      setTimeout(() => setBad(false), 2500);
      return;
    }
    if (onCommit) onCommit(conv(type, v));
    else setField(sec, i, f, conv(type, v));
  };
  const inputType = type === 'date' ? 'date' : type === 'text' ? 'text' : 'number';
  const numeric = inputType === 'number';

  return (
    <input
      className={'c ' + cls + (bad ? ' bad' : '')}
      type={inputType}
      min={numeric && min != null ? min : undefined}
      aria-invalid={bad || undefined}
      title={bad ? 'Must be ' + min + ' or more' : undefined}
      step={numeric ? 'any' : undefined}
      inputMode={numeric ? 'decimal' : undefined}
      value={draft}
      placeholder={placeholder}
      list={list}
      disabled={disabled}
      aria-label={label || f}
      onChange={(e) => {
        setDraft(e.target.value);
        if (type === 'date') commit(e.target.value);
      }}
      onBlur={(e) => {
        const before = shown;
        commit(e.target.value);
        // if the edit was refused or changed nothing, snap back to the stored value
        setTimeout(() => {
          if (shownRef.current === before) setDraft(before);
        }, 0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** Dropdown bound to S[sec][i][f]. options: strings or [value, label] pairs. */
export function SelectCell({ sec, i = 0, f, value, options, type = 'text', cls = '', onCommit, disabled }) {
  const { setField } = useStore();
  return (
    <select
      className={'c ' + cls}
      aria-label={f}
      disabled={disabled}
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const v = type === 'int' ? parseInt(e.target.value, 10) : e.target.value;
        if (onCommit) onCommit(v);
        else setField(sec, i, f, v);
      }}
    >
      {options.map((o) => {
        const v = Array.isArray(o) ? o[0] : o;
        const l = Array.isArray(o) ? o[1] : o;
        return (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

/** Label + control wrapper used in the timeline setup and dashboard range pickers. */
export function Fld({ label, children, style }) {
  return (
    <label className="fld" style={style}>
      {label}
      {children}
    </label>
  );
}

/** Multi-line text, committed on blur. */
export function Area({ value, onCommit, placeholder, rows = 4, label, cls = '', single = false, disabled }) {
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);
  useEffect(() => setDraft(value || ''), [value]);
  // single-line style fields (task names) grow to fit their text instead of clipping it
  useLayoutEffect(() => {
    if (!single || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = ref.current.scrollHeight + 'px';
  }, [draft, single]);
  return (
    <textarea
      ref={ref}
      className={'c area ' + cls}
      rows={rows}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value || '') && onCommit(draft)}
      onKeyDown={single ? (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } } : undefined}
    />
  );
}
