import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useTags } from '../store/useTags';
import { useUI } from './UI';
import Menu from './Menu';
import { TagAdder, TagChip, TagColorPicker } from './Tags';
import { allContainers, allTags, cleanTag, tagColor, tagDef } from '../lib/tasks';
import { pd } from '../lib/dates';

const when = (s) => (s ? new Date(pd(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');

// Tag manager, as in ClickUp: every tag of the project in one place with its colour, how many work items use it, where, and when it was
// created. Search, filter (by colour or location), sort, rename, recolour, create, and delete several at once.
export default function TagManager() {
  const { S } = useStore();
  const tags = useTags();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [fc, setFc] = useState('all'); // colour filter: all | none | a colour
  const [fl, setFl] = useState('all'); // location filter: all | a sprint or backlog id
  const [by, setBy] = useState('name');
  const [dir, setDir] = useState(1);
  const [sel, setSel] = useState(new Set());

  const rows = useMemo(() => {
    const info = new Map();
    allTags(S).forEach((g) => info.set(g.toLowerCase(), { tag: g, n: 0, where: new Map() }));
    allContainers(S).forEach((c) =>
      c.tasks.forEach((t) =>
        (t.tags || []).forEach((g) => {
          const r = info.get(g.toLowerCase());
          if (!r) return;
          r.n++;
          r.where.set(c.id, c.id === 'backlog' ? 'Backlog' : c.name);
        })
      )
    );
    return [...info.values()].map((r) => ({ ...r, d: tagDef(S, r.tag) || { color: '', created: '' }, color: tagColor(S, r.tag) }));
  }, [S]);

  const locations = [['backlog', 'Backlog']].concat((S.sprints || []).map((s) => [s.id, s.name]));
  const shown = rows
    .filter((r) => !q.trim() || r.tag.toLowerCase().includes(q.trim().toLowerCase().replace(/^#/, '')))
    .filter((r) => fc === 'all' || (fc === 'none' ? r.d.color === 'none' : fc === 'auto' ? r.d.color === '' : r.d.color === fc))
    .filter((r) => fl === 'all' || r.where.has(fl))
    .sort((a, b) => dir * (by === 'usage' ? a.n - b.n : by === 'created' ? (a.d.created || '').localeCompare(b.d.created || '') : a.tag.localeCompare(b.tag)) || a.tag.localeCompare(b.tag));
  const chosen = shown.filter((r) => sel.has(r.tag.toLowerCase()));
  const allOn = shown.length > 0 && chosen.length === shown.length;
  const colorsUsed = [...new Set(rows.map((r) => r.d.color).filter((c) => c && c !== 'none'))];

  const sort = (k) => { if (by === k) setDir(-dir); else { setBy(k); setDir(1); } };
  const arrow = (k) => (by === k ? (dir === 1 ? ' ▲' : ' ▼') : '');
  const toggle = (g) => setSel((s) => { const n = new Set(s); const k = g.toLowerCase(); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const del = (list) => {
    const n = list.reduce((a, r) => a + r.n, 0);
    ui.ask({
      title: 'Delete ' + (list.length === 1 ? 'the tag \u201c' + list[0].tag + '\u201d' : list.length + ' tags') + '?',
      body: (n ? 'They will be taken off ' + n + ' work item' + (n === 1 ? '' : 's') + ' and removed from the project.' : 'None of them is used by a work item.') + ' This cannot be undone.',
      confirm: 'Delete',
      danger: true,
      onConfirm: () => { tags.remove(list.map((r) => r.tag)); setSel(new Set()); },
    });
  };

  return (
    <div className="tgm">
      <p className="hint" style={{ marginBottom: 10 }}>
        View, find and manage all the tags of this project in one place. A tag can be on any work item of any sprint or the Backlog; renaming or recolouring it here changes it everywhere.
      </p>
      <div className="tgm-bar">
        <input className="c" type="search" placeholder="Search tags…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tags" />
        <Menu
          className="btn"
          label={'Filter' + (fc !== 'all' || fl !== 'all' ? ' •' : '') + ' ▾'}
          title="Filter the tags"
          items={[
            { label: 'Any color', active: fc === 'all', keepOpen: true, onClick: () => setFc('all') },
            { label: 'No color', active: fc === 'none', keepOpen: true, onClick: () => setFc('none') },
            { label: 'Automatic color', active: fc === 'auto', keepOpen: true, onClick: () => setFc('auto') },
          ].concat(colorsUsed.map((c) => ({ label: <span className="sm-item"><i className="tag-dot" style={{ '--tc': c }} />{c}</span>, active: fc === c, keepOpen: true, onClick: () => setFc(c) })))
            .concat([{ sep: true }, { label: 'Any location', active: fl === 'all', keepOpen: true, onClick: () => setFl('all') }])
            .concat(locations.map(([id, nm]) => ({ label: nm, active: fl === id, keepOpen: true, onClick: () => setFl(id) })))}
        />
        <span style={{ flex: 1 }} />
        {chosen.length > 0 && <button className="btn danger" onClick={() => del(chosen)}>Delete {chosen.length} selected</button>}
      </div>
      <div className="tgm-tbl" role="table" aria-label="Tags">
        <div className="tgm-r tgm-h" role="row">
          <label className="tgm-c" title="Select all shown"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((r) => r.tag.toLowerCase())))} aria-label="Select all tags shown" /></label>
          <button className="tgm-n tgm-s" onClick={() => sort('name')}>Tag name{arrow('name')}</button>
          <span className="tgm-col">Color</span>
          <button className="tgm-u tgm-s" onClick={() => sort('usage')}>Usage{arrow('usage')}</button>
          <span className="tgm-l">Location</span>
          <button className="tgm-d tgm-s" onClick={() => sort('created')}>Created{arrow('created')}</button>
          <span className="tgm-a" />
        </div>
        {shown.map((r) => (
          <div key={r.tag} className="tgm-r" role="row">
            <label className="tgm-c"><input type="checkbox" checked={sel.has(r.tag.toLowerCase())} onChange={() => toggle(r.tag)} aria-label={'Select ' + r.tag} /></label>
            <span className="tgm-n"><RenameChip tag={r.tag} onRename={(to) => tags.rename(r.tag, to)} /></span>
            <span className="tgm-col">
              <Menu className="tgm-sw" label={<i className="tag-dot big" style={{ '--tc': r.color }} />} title={'Change the color of ' + r.tag} items={[]} footer={() => <TagColorPicker value={r.d.color} onChange={(c) => tags.setColor(r.tag, c)} />} />
            </span>
            <span className="tgm-u">{r.n} {r.n === 1 ? 'task' : 'tasks'}</span>
            <span className="tgm-l" title={[...r.where.values()].join(', ')}>{r.where.size ? [...r.where.values()].join(', ') : '–'}</span>
            <span className="tgm-d">{when(r.d.created)}</span>
            <span className="tgm-a"><button className="x" onClick={() => del([r])} aria-label={'Delete ' + r.tag} title="Delete this tag">✕</button></span>
          </div>
        ))}
        {!shown.length && <p className="hint" style={{ padding: '14px 4px' }}>{rows.length ? 'No tag matches the search or filter.' : 'This project has no tags yet. Add the first one below.'}</p>}
      </div>
      <div style={{ marginTop: 12 }}>
        <TagAdder placeholder="New tag, then Enter" autoFocus={false} onAdd={(name) => { const g = cleanTag(name); if (g) tags.create(g); }} />
      </div>
    </div>
  );
}

// the tag as a chip; click it to rename in place
function RenameChip({ tag, onRename }) {
  const [on, setOn] = useState(false);
  const [v, setV] = useState(tag);
  const done = () => { setOn(false); const g = cleanTag(v); if (g && g !== tag) onRename(g); else setV(tag); };
  if (!on) return <button type="button" className="tgm-chipbtn" title="Click to rename" onClick={() => { setV(tag); setOn(true); }}><TagChip tag={tag} /></button>;
  return <input className="c" autoFocus value={v} maxLength={30} aria-label={'Rename ' + tag} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { setV(tag); setOn(false); } }} />;
}
