import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { ACTIVITY_MAX, CATS, activityCsv, clock, dayLabel, relTime } from '../lib/activity';
import { findTask } from '../lib/tasks';
import TaskDrawer from './TaskDrawer';

const RANGES = [['all', 'All time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
const SPAN = { today: 0, '7d': 7, '30d': 30 };

// clock that ticks every second so "just now" / "5s ago" stay true while the tab is open
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Entry({ e, now, onOpen, exists }) {
  const [more, setMore] = useState(false);
  const [name, icon, color] = CATS[e.cat] || [e.cat, '•', 'var(--muted)'];
  const fresh = now - new Date(e.at).getTime() < 8000;
  const rel = relTime(e.at, now);
  return (
    <li className={'act' + (fresh ? ' new' : '')}>
      <span className="act-t mono" title={new Date(e.at).toString() + '\n' + e.at}>{clock(e.at)}</span>
      <span className="act-ic" style={{ color, borderColor: color }} title={name} aria-label={name}>{icon}</span>
      <div className="act-b">
        <div className="act-x">{e.text}</div>
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
        <div className="msg act-m">{rel ? rel + ' · ' : ''}{name} · {e.by}</div>
      </div>
      {exists && <button className="x" onClick={() => onOpen(e.ref.id)} aria-label="Open work item">Open</button>}
    </li>
  );
}

// Everything that happens in the project, as it happens
export default function Activity() {
  const { S } = useStore();
  const now = useNow();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [range, setRange] = useState('all');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState(null);

  const all = S.activity || [];
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const from = range === 'all' ? 0 : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - SPAN[range] * 86400000; })();
    return all
      .filter((e) => (cat === 'all' || e.cat === cat) && (!from || new Date(e.at).getTime() >= from) && (!ql || (e.text + ' ' + (e.d || []).map((x) => x.f + x.a + x.b).join(' ')).toLowerCase().includes(ql)))
      .reverse();
  }, [all, q, cat, range]);

  const shown = list.slice(0, limit);
  const days = [];
  shown.forEach((e) => {
    const k = dayLabel(e.at, now);
    const last = days[days.length - 1];
    if (last && last.k === k) last.items.push(e);
    else days.push({ k, items: [e] });
  });
  const todayN = all.filter((e) => dayLabel(e.at, now) === 'Today').length;
  const lastAt = all.length ? all[all.length - 1].at : null;

  const exportCsv = () => {
    const bl = new Blob(['\ufeff' + activityCsv(S)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(bl);
    const a = document.createElement('a');
    a.href = url;
    a.download = (S.meta.name || 'project').replace(/[^\w-]+/g, '-') + '-activity.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Activity <span className="live" title="This list updates the moment anything changes"><i />Live</span></h2>
          <p className="hint">Every change in this project, with the exact time it happened: work items, sprints, people, budget, RAID, change control and settings. Kept for the latest {ACTIVITY_MAX} events, so export to keep a full record.</p>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!all.length}>Export CSV</button>
      </div>

      <div className="act-sum">
        <span><b>{all.length}</b> events</span>
        <span><b>{todayN}</b> today</span>
        <span>Last change <b>{lastAt ? relTime(lastAt, now) || dayLabel(lastAt, now) + ' ' + clock(lastAt) : '–'}</b></span>
      </div>

      <div className="tools">
        <input className="c" style={{ maxWidth: 240 }} type="search" placeholder="Search the activity" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} aria-label="Search the activity" />
        <select className="c" style={{ width: 'auto' }} value={cat} onChange={(e) => { setCat(e.target.value); setLimit(100); }} aria-label="Category">
          <option value="all">All categories</option>
          {Object.entries(CATS).map(([id, c]) => (<option key={id} value={id}>{c[0]}</option>))}
        </select>
        <select className="c" style={{ width: 'auto' }} value={range} onChange={(e) => { setRange(e.target.value); setLimit(100); }} aria-label="Time range">
          {RANGES.map(([id, l]) => (<option key={id} value={id}>{l}</option>))}
        </select>
      </div>

      {days.map((d) => (
        <section key={d.k} aria-label={d.k}>
          <h3 className="act-day">{d.k}</h3>
          <ul className="act-list">
            {d.items.map((e) => (
              <Entry key={e.id} e={e} now={now} onOpen={setOpen} exists={!!(e.ref && e.ref.type === 'task' && findTask(S, e.ref.id))} />
            ))}
          </ul>
        </section>
      ))}
      {!list.length && <div className="empty">{all.length ? 'Nothing matches these filters.' : 'No activity yet. Changes you make will show up here.'}</div>}
      {list.length > limit && <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn" onClick={() => setLimit(limit + 100)}>Show {Math.min(100, list.length - limit)} more</button></div>}

      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
