import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTags } from '../store/useTags';
import { useUI } from './UI';
import Menu from './Menu';
import { TAG_COLORS, allContainers, cleanTag, okColor, tagColor, tagDef } from '../lib/tasks';

// How many work items carry a tag
export const tagUsage = (S, tag) => {
  const k = String(tag).toLowerCase();
  let n = 0;
  allContainers(S).forEach((c) => c.tasks.forEach((t) => { if ((t.tags || []).some((g) => g.toLowerCase() === k)) n++; }));
  return n;
};

// A coloured tag label. Pass onRemove to get a small ✕ on it.
export function TagChip({ tag, onRemove }) {
  const { S } = useStore();
  return (
    <span className="tagc" style={{ '--tc': tagColor(S, tag) }} title={tag}>
      <span className="tagc-t">{tag}</span>
      {onRemove && <button type="button" className="tagc-x" onClick={onRemove} aria-label={'Remove tag ' + tag}>✕</button>}
    </span>
  );
}

// A new-tag box: type a name, press Enter
export function TagAdder({ onAdd, placeholder = 'New tag, then Enter', autoFocus = true }) {
  const [v, setV] = useState('');
  const go = () => {
    if (!cleanTag(v)) return;
    onAdd(v);
    setV('');
  };
  return (
    <div className="tag-add">
      <input className="c" autoFocus={autoFocus} value={v} maxLength={30} placeholder={placeholder} aria-label="New tag" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} />
      <button type="button" className="btn" onClick={go} disabled={!cleanTag(v)}>Add</button>
    </div>
  );
}

/* The colours a tag can have, as in ClickUp: no colour, a palette, and "Add color" for any colour of your own.
   value: '' (automatic), 'none' or '#rrggbb'. */
export function TagColorPicker({ value, onChange }) {
  const custom = useRef(null);
  const [mine, setMine] = useState(okColor(value) && !TAG_COLORS.includes(value) ? value : '#4f8cff');
  // the native colour box reports a colour only when the picker is closed, so one choice is one edit
  useEffect(() => {
    const el = custom.current;
    if (!el) return undefined;
    const done = () => { setMine(el.value); onChange(el.value); };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [onChange]);
  const sw = (c, label, cls = '') => (
    <button key={c} type="button" className={'tag-sw' + cls + (value === c ? ' on' : '')} style={{ '--tc': c === 'none' ? 'transparent' : c }} onClick={() => onChange(c)} aria-label={label} aria-pressed={value === c} title={label} />
  );
  return (
    <div className="tag-cp">
      <div className="tag-sws">
        {sw('none', 'No color', ' none')}
        {TAG_COLORS.map((c) => sw(c, 'Color ' + c))}
        {okColor(value) && !TAG_COLORS.includes(value) && sw(value, 'Custom color ' + value)}
      </div>
      <label className="mi tag-addcol">
        <span><b aria-hidden="true">＋</b> Add color</span>
        <input ref={custom} type="color" value={mine} onChange={(e) => setMine(e.target.value)} aria-label="Pick your own color" />
      </label>
    </div>
  );
}

// The ClickUp-style tag popover: rename, colour, filter, delete. `close` closes the menu it sits in; onRenamed(newName) / onGone() tell the caller.
export function TagEditor({ tag, close, onRenamed, onGone }) {
  const { S } = useStore();
  const tags = useTags();
  const ui = useUI();
  const [name, setName] = useState(tag);
  useEffect(() => setName(tag), [tag]);
  const d = tagDef(S, tag);
  const n = tagUsage(S, tag);
  const commit = () => {
    const g = cleanTag(name);
    if (!g || g === tag) return setName(tag);
    const out = tags.rename(tag, g);
    onRenamed && onRenamed(out);
  };
  return (
    <div className="tag-ed">
      <div className="tag-ed-top">
        <input className="c tag-ed-name" autoFocus value={name} maxLength={30} aria-label="Tag name" onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setName(tag); }} />
        {ui && ui.openTags && <button type="button" className="x tag-ed-gear" title="Open the Tag manager" aria-label="Open the Tag manager" onClick={() => { close && close(); ui.openTags(); }}>⚙</button>}
      </div>
      <TagColorPicker value={d ? d.color : ''} onChange={(c) => tags.setColor(tag, c)} />
      <div className="msep" />
      <button type="button" className="mi" onClick={() => { window.dispatchEvent(new CustomEvent('sc-tag-filter', { detail: tag })); close && close(); }}><span>Filter by tag</span></button>
      <button
        type="button"
        className="mi danger"
        onClick={() => {
          close && close();
          ui.ask({
            title: 'Delete the tag \u201c' + tag + '\u201d?',
            body: n ? 'It will be taken off ' + n + ' work item' + (n === 1 ? '' : 's') + ' and removed from the project. This cannot be undone.' : 'It is not used by any work item. It will be removed from the project.',
            confirm: 'Delete',
            danger: true,
            onConfirm: () => { tags.remove([tag]); onGone && onGone(); },
          });
        }}
      ><span>Delete</span></button>
    </div>
  );
}

// A tag chip you can click to open its editor (the ✕ takes the tag off the item it sits on)
export function EditableTag({ tag, onRemove }) {
  return (
    <span className="tagc-ed">
      <Menu className="tagc-btn" label={<TagChip tag={tag} />} title={'Edit the tag \u201c' + tag + '\u201d'} items={[]} footer={({ close }) => <TagEditor tag={tag} close={close} />} />
      {onRemove && <button type="button" className="tagc-x2" onClick={onRemove} aria-label={'Remove tag ' + tag} title="Take this tag off the work item">✕</button>}
    </span>
  );
}
