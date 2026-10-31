import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { ACTIVITY_MAX, CATS, activityCsv, clock, dayLabel, relTime } from '../lib/activity';
import { ACTS, RANGES, actKey, dayKey, facets, matches, parseQuery, perDay, rangeBounds, startOfDay, subOf, subjects } from '../lib/activityFilter';
import { findTask } from '../lib/tasks';
import TaskDrawer from './TaskDrawer';
import '../activity.css';

const EXAMPLES = ['Change requests this week', 'Stakeholders added', 'Deleted work items', 'RAID changes yesterday', 'Budget changes last 30 days'];

// clock that ticks every second so "just now" / "5s ago" stay true while the tab is open
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// the typed words, marked in a sentence
function Mark({ text, words }) {
  if (!words.length) return text;
  const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

function Entry({ e, now, onOpen, onHistory, exists, words, showDate, isNew }) {
  const [more, setMore] = useState(false);
  const [name, icon, color] = CATS[e.cat] || [e.cat, '•', 'var(--muted)'];
  const fresh = now - new Date(e.at).getTime() < 8000;
  const rel = relTime(e.at, now);
  const sub = subOf(e);
  return (
    <li className={'act' + (fresh ? ' new' : '') + (isNew ? ' unseen' : '')}>
      <span className="act-t mono" title={new Date(e.at).toString() + '\n' + e.at}>{showDate && <span className="act-dd">{dayLabel(e.at, now)}</span>}{clock(e.at)}</span>
      <span className="act-ic" style={{ color, borderColor: color }} title={name} aria-label={name}>{icon}</span>
      <div className="act-b">
        <div className="act-x"><Mark text={e.text} words={words} /></div>
        {e.d && e.d.length > 0 && (
          <ul className="act-d">
            {e.d.map((x, i) => (<li key={i}><b>{x.f}</b>: {x.a ? x.a + ' → ' : ''}{x.b}</li>))}
          </ul>
        )}
        {e.items && e.items.length > 0 && (
          <div className="msg">
            <button className="x act-more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Hide' : 'Show'} the {e.count} items</button>
            {more && <span className="mono"> {e.items.join(', ')}{e.count > e.items.length ? ' …' : ''}</span>}
          </div>
        )}
        <div className="msg act-m">{rel ? rel + ' · ' : ''}{name} · {e.by}{isNew && <b className="act-newtag"> · new</b>}</div>
      </div>
      <div className="act-side">
        {sub && <button className="x" onClick={() => onHistory(sub)} title="Show everything that happened to this">History</button>}
        {exists && <button className="x" onClick={() => onOpen(e.ref.id)} aria-label="Open work item">Open</button>}
      </div>
    </li>
  );
}

const Chip = ({ on, onClick, children, n, color, title }) => (
  <button type="button" className={'ax-chip' + (on ? ' on' : '')} aria-pressed={!!on} onClick={onClick} title={title} style={on && color ? { borderColor: color } : undefined}>
    {children}{n != null && <span className="ax-n">{n}</span>}
  </button>
);

// Everything that happens in the project, as it happens
export default function Activity() {
  const { S, nav } = useStore();
  const now = useNow();
  const all = S.activity || [];

  // when this tab was last opened (per project, on this device)
  const seenKey = 'sprint-control-activity-seen-' + (nav.projectId || S.meta.name);
  const seen = useRef(Number(typeof localStorage !== 'undefined' && localStorage.getItem(seenKey)) || 0);
  useEffect(() => {
    const stamp = () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch (e) { /* private mode */ } };
    const t = setInterval(stamp, 15000);
    return () => { clearInterval(t); stamp(); };
  }, [seenKey]);

  const [q, setQ] = useState('');
  const [cats, setCats] = useState(() => new Set());
  const [acts, setActs] = useState(() => new Set());
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [by, setBy] = useState('');
  const [subject, setSubject] = useState('');
  const [group, setGroup] = useState('day');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState(null);
  const [sug, setSug] = useState(false);
  const reset = () => setLimit(100);

  const authors = useMemo(() => [...new Set(all.map((e) => e.by).filter(Boolean))], [all]);
  const nameOfTask = (k) => { const f = k.startsWith('task:') ? findTask(S, k.slice(5)) : null; return f ? f.t.code + ' “' + f.t.name + '”' : ''; };
  const subs = useMemo(() => subjects(all, nameOfTask), [all, S]); // eslint-disable-line react-hooks/exhaustive-deps
  const subName = (k) => (subs.find((x) => x.key === k) || {}).name || k;

  // chips + the sentence typed in the box, combined
  const parsed = useMemo(() => parseQuery(q, authors, now), [q, authors, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const win = parsed.range || rangeBounds(range, now, seen.current, from, to);
  const F = useMemo(() => ({
    cats: new Set([...cats, ...parsed.cats]),
    acts: new Set([...acts, ...parsed.acts]),
    a: win ? win.a : 0, b: win ? win.b : null,
    by: parsed.by || by, subject, words: parsed.words,
  }), [cats, acts, parsed, win && win.a, win && win.b, by, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => all.filter((e) => matches(e, F)).reverse(), [all, F]);
  const fc = useMemo(() => facets(all, F), [all, F]);
  const days = useMemo(() => perDay(all, F, now), [all, F, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const peak = Math.max(1, ...days.map((d) => d.n));
  const unseen = seen.current ? all.filter((e) => new Date(e.at).getTime() > seen.current).length : 0;
  const todayN = all.filter((e) => dayLabel(e.at, now) === 'Today').length;
  const lastAt = all.length ? all[all.length - 1].at : null;
  const filtered = F.cats.size || F.acts.size || F.by || F.subject || F.words.length || F.b != null;

  const toggle = (set, setter, k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n); reset(); };
  const clearAll = () => { setQ(''); setCats(new Set()); setActs(new Set()); setRange('all'); setFrom(''); setTo(''); setBy(''); setSubject(''); reset(); };
  const pickDay = (d) => { setRange('custom'); setFrom(d.key); setTo(d.key); reset(); };
  const history = (k) => { setSubject(k); setQ(''); reset(); window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const sugList = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return subs.filter((x) => (x.name + ' ' + x.type).toLowerCase().includes(t)).slice(0, 6);
  }, [q, subs]);

  const shown = list.slice(0, limit);
  const dayGroups = [];
  shown.forEach((e) => {
    const k = dayLabel(e.at, now);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.k === k) last.items.push(e);
    else dayGroups.push({ k, items: [e] });
  });
  const itemGroups = useMemo(() => {
    const m = new Map();
    shown.forEach((e) => {
      const k = subOf(e) || 'other';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    });
    return [...m.entries()].map(([k, items]) => ({ k, items, name: k === 'other' ? 'Project-wide changes' : subName(k) }));
  }, [shown, subs]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    const bl = new Blob(['\ufeff' + activityCsv(S, list)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(bl);
    const a = document.createElement('a');
    a.href = url;
    a.download = (S.meta.name || 'project').replace(/[^\w-]+/g, '-') + '-activity.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const row = (e) => (
    <Entry key={e.id} e={e} now={now} onOpen={setOpen} onHistory={history} words={parsed.words} showDate={group === 'item'}
      exists={!!(e.ref && e.ref.type === 'task' && findTask(S, e.ref.id))} isNew={!!seen.current && new Date(e.at).getTime() > seen.current} />
  );

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Activity <span className="live" title="This list updates the moment anything changes"><i />Live</span></h2>
          <p className="hint">Every change in this project, with the exact time it happened. Ask in plain words, tap the filters, or open the history of one work item or record. Kept for the latest {ACTIVITY_MAX} events, so export to CSV to keep a permanent record.</p>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!list.length}>Export CSV{filtered ? ' (' + list.length + ')' : ''}</button>
      </div>

      <div className="act-sum">
        <span><b>{all.length}</b> events</span>
        <span><b>{todayN}</b> today</span>
        <span>Last change <b>{lastAt ? relTime(lastAt, now) || dayLabel(lastAt, now) + ' ' + clock(lastAt) : '–'}</b></span>
        {unseen > 0 && <button type="button" className="linkbtn" onClick={() => { setRange('since'); reset(); }}><b>{unseen}</b> new since your last visit</button>}
      </div>

      {/* ask */}
      <div className="ax-ask">
        <input className="c ax-q" type="search" value={q} placeholder="Ask in plain words, e.g. “change requests this week” or a work item like T-12"
          onChange={(e) => { setQ(e.target.value); setSug(true); reset(); }} onFocus={() => setSug(true)} onBlur={() => setTimeout(() => setSug(false), 150)} aria-label="Search the activity" />
        {sug && sugList.length > 0 && (
          <ul className="ax-sug" role="listbox" aria-label="History of…">
            <li className="ax-sug-h">Show the full history of…</li>
            {sugList.map((x) => (
              <li key={x.key}><button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => { history(x.key); setSug(false); }}>
                <span>{x.name}</span><span className="msg">{x.type} · {x.n} event{x.n === 1 ? '' : 's'}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      {!q && !filtered && (
        <div className="ax-ex">Try: {EXAMPLES.map((x) => (<button key={x} type="button" className="ax-try" onClick={() => { setQ(x); reset(); }}>{x}</button>))}</div>
      )}
      {parsed.notes.length > 0 && (
        <div className="ax-und">Understood as: {parsed.notes.map((n) => (<span key={n} className="ax-pill">{n}</span>))}{parsed.words.length > 0 && <span> containing <b>{parsed.words.join(' ')}</b></span>}</div>
      )}

      {/* filters */}
      <div className="ax-bar">
        <div className="ax-row" role="group" aria-label="What changed">
          {Object.entries(CATS).map(([id, c]) => (
            <Chip key={id} on={F.cats.has(id)} n={fc.cats[id] || 0} color={c[2]} onClick={() => toggle(cats, setCats, id)}><span style={{ color: c[2] }} aria-hidden="true">{c[1]}</span> {c[0]}</Chip>
          ))}
        </div>
        <div className="ax-row" role="group" aria-label="What was done">
          {Object.entries(ACTS).map(([id, l]) => (<Chip key={id} on={F.acts.has(id)} n={fc.acts[id] || 0} onClick={() => toggle(acts, setActs, id)}>{l}</Chip>))}
        </div>
        <div className="ax-row ax-sel">
          <select className="c" value={parsed.range ? 'q' : range} onChange={(e) => { setRange(e.target.value); reset(); }} aria-label="Time range" disabled={!!parsed.range}>
            {parsed.range && <option value="q">{parsed.range.label} (from your search)</option>}
            {RANGES.map(([id, l]) => (<option key={id} value={id}>{l}</option>))}
          </select>
          {range === 'custom' && !parsed.range && (
            <>
              <input className="c" type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="From date" />
              <span className="msg">to</span>
              <input className="c" type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="To date" />
            </>
          )}
          {authors.length > 1 && (
            <select className="c" value={parsed.by || by} onChange={(e) => { setBy(e.target.value); reset(); }} aria-label="Who made the change" disabled={!!parsed.by}>
              <option value="">Everyone</option>
              {authors.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          )}
          <div className="seg" role="group" aria-label="Group the list">
            <button aria-pressed={group === 'day'} onClick={() => setGroup('day')}>By day</button>
            <button aria-pressed={group === 'item'} onClick={() => setGroup('item')} title="Group the changes by work item or record">By item</button>
          </div>
          {(filtered || q) && <button type="button" className="linkbtn" onClick={clearAll}>Clear all</button>}
        </div>
      </div>

      {/* the last 30 days */}
      <div className="ax-spark" role="group" aria-label="Events per day, last 30 days. Choose a day to show only that day.">
        {days.map((d) => {
          const on = range === 'custom' && from === d.key && to === d.key;
          return (
            <button key={d.key} type="button" className={'ax-bar-d' + (on ? ' on' : '') + (d.key === dayKey(now) ? ' today' : '')} onClick={() => pickDay(d)} title={new Date(d.t0).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + d.n + ' event' + (d.n === 1 ? '' : 's')} aria-label={d.key + ': ' + d.n}>
              <i style={{ height: d.n ? Math.max(8, (d.n / peak) * 100) + '%' : '3px' }} />
            </button>
          );
        })}
      </div>
      <div className="ax-spark-l"><span>{new Date(startOfDay(now) - 29 * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><span>Last 30 days · tap a day</span><span>Today</span></div>

      {/* what is on */}
      {(subject || F.by || F.words.length > 0) && (
        <div className="ax-on">
          {subject && <span className="ax-pill big">History of <b>{subName(subject)}</b><button type="button" className="x" onClick={() => { setSubject(''); reset(); }} aria-label="Remove this filter">✕</button></span>}
        </div>
      )}
      <div className="ax-count">{filtered ? <><b>{list.length}</b> of {all.length} events</> : <><b>{all.length}</b> events</>}</div>

      {group === 'day' ? dayGroups.map((d) => (
        <section key={d.k} aria-label={d.k}>
          <h3 className="act-day">{d.k} <span className="ax-dn">{d.items.length}</span></h3>
          <ul className="act-list">{d.items.map(row)}</ul>
        </section>
      )) : itemGroups.map((g) => (
        <details key={g.k} className="ax-grp" open>
          <summary>
            <b>{g.name}</b>
            <span className="ax-dn">{g.items.length}</span>
            {g.k !== 'other' && <button type="button" className="x" onClick={(e) => { e.preventDefault(); history(g.k); }}>Only this</button>}
          </summary>
          <ul className="act-list">{g.items.map(row)}</ul>
        </details>
      ))}

      {!list.length && (
        <div className="empty">
          {all.length ? 'Nothing matches these filters.' : 'No activity yet. Changes you make will show up here.'}
          {all.length > 0 && <div style={{ marginTop: 8 }}><button className="btn" onClick={clearAll}>Clear all filters</button></div>}
        </div>
      )}
      {list.length > limit && <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn" onClick={() => setLimit(limit + 100)}>Show {Math.min(100, list.length - limit)} more</button></div>}

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
