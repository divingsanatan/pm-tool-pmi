import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { roll, wbsOf, wstat } from '../lib/calc';
import { DAY, fdate, pd } from '../lib/dates';
import { nz, pc } from '../lib/format';
import { DEFAULT_TL, SCALES, SCOPES, buildAxis, pickedSprint } from '../lib/gantt';
import { Fld } from '../components/Field';
import { TypeBadge } from '../components/Bits';
import { typeOf } from '../lib/tasks';
import { depIndex } from '../lib/deps';
import '../deps.css';

const HH = 78; // three header rows of 26px

function Bar({ s, f, pct, cls, ax, tip, note }) {
  s = s || f;
  f = f || s;
  if (!s || !f) return null;
  const a = pd(s), b = pd(f);
  if (b < ax.r0 || a > ax.r1) return null; // entirely outside the visible range
  const fullL = ((a - ax.r0) / DAY) * ax.ppd;
  const fullW = ((b - a) / DAY + 1) * ax.ppd;
  const l = Math.max(0, fullL);
  const r = Math.min(ax.total, fullL + fullW);
  const wd = Math.max(6, r - l);
  const fill = Math.max(0, Math.min(r, fullL + fullW * Math.min(1, nz(pct))) - l);
  const clipL = fullL < 0, clipR = fullL + fullW > ax.total;
  return (
    <div
      className={'g-bar ' + cls + (clipL ? ' clipL' : '') + (clipR ? ' clipR' : '')}
      style={{ left: l.toFixed(1) + 'px', width: wd.toFixed(1) + 'px' }}
      title={(tip ? tip + ' · ' : '') + fdate(s) + ' – ' + fdate(f) + ' · ' + pc(pct, 0) + ' complete' + (note ? ' · ' + note : '')}
    >
      <i style={{ width: fill.toFixed(1) + 'px' }} />
    </div>
  );
}

const cpNote = (n) => (!n || !n.linked ? '' : n.critical ? 'Critical path: no float' : 'Float ' + n.float + ' working day' + (n.float === 1 ? '' : 's'));

export default function Timeline() {
  const { S, update } = useStore();
  const box = useRef(null);
  const [shut, setShut] = useState(() => new Set()); // collapsed parents
  const [showDeps, setShowDeps] = useState(true);
  const [showCrit, setShowCrit] = useState(true);
  const di = depIndex(S);
  const tl = { ...DEFAULT_TL, ...(S.tl || {}) };
  const set = (patch) => update((p) => { p.tl = { ...DEFAULT_TL, ...(p.tl || {}), ...patch }; });
  const sp = pickedSprint(S, tl);
  // width available to the chart area (the box minus the label column), so a short range stretches to fill the page
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      const lw = parseFloat(getComputedStyle(el).getPropertyValue('--lw')) || 250;
      setAvail(Math.max(0, Math.floor(el.clientWidth - lw - 1)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ax = buildAxis(S, tl, avail);

  // which rows to show
  let rows = wbsOf(S);
  let hidden = 0;
  if (tl.scope === 'sprint' && sp) rows = rows.filter((x) => x.sprintId === sp.id);
  if (tl.scope === 'custom') {
    const vis = (x) => {
      const s = x.start || x.finish, f = x.finish || x.start;
      return !!s && pd(f) >= ax.r0 && pd(s) <= ax.r1;
    };
    const keep = new Set();
    rows.forEach((x) => x.type !== 'Phase' && vis(x) && keep.add(x.sprintId));
    hidden = rows.filter((x) => x.type !== 'Phase' && !vis(x)).length;
    rows = rows.filter((x) => (x.type === 'Phase' ? keep.has(x.sprintId) : vis(x)));
  }

  // hide everything below a collapsed parent
  const gone = new Set();
  rows = rows.filter((x) => {
    if (x.type === 'Phase' || !x.parentId) return true;
    if (shut.has(x.parentId) || gone.has(x.parentId)) {
      gone.add(x.taskId);
      return false;
    }
    return true;
  });
  const flip = (id) => setShut((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const setScope = (scope) => set({ scope, scale: scope === 'sprint' ? 'day' : scope === 'project' ? 'week' : tl.scale });
  const jumpToday = () => {
    if (ax.todayX == null || !box.current) return;
    const lw = parseFloat(getComputedStyle(box.current).getPropertyValue('--lw')) || 250;
    box.current.scrollTo({ left: Math.max(0, lw + ax.todayX - box.current.clientWidth / 2), behavior: 'smooth' });
  };

  // dependency arrows between the visible rows
  const RH = 34, G = 9;
  const rowOf = new Map();
  rows.forEach((x, i) => x.taskId && rowOf.set(x.taskId, i));
  const geo = (x) => {
    const s = x.start || x.finish, f = x.finish || x.start;
    if (!s || !f) return null;
    const l = ((pd(s) - ax.r0) / DAY) * ax.ppd;
    return { l, r: Math.max(l + 6, l + ((pd(f) - pd(s)) / DAY + 1) * ax.ppd) };
  };
  const arrows = showDeps ? di.all.filter((e) => e.pred && rowOf.has(e.pred.id) && rowOf.has(e.succ.id)).map((e) => {
    const i1 = rowOf.get(e.pred.id), i2 = rowOf.get(e.succ.id);
    const a = geo(rows[i1]), b = geo(rows[i2]);
    if (!a || !b) return null;
    const t = e.dep.type, fromR = t === 'FS' || t === 'FF', toL = t === 'FS' || t === 'SS';
    const x1 = fromR ? a.r : a.l, y1 = i1 * RH + RH / 2, xe = toL ? b.l : b.r, y2 = i2 * RH + RH / 2;
    const d1 = fromR ? 1 : -1, d2 = toL ? -1 : 1;
    const xo = x1 + d1 * G, xs = xe + d2 * G;
    const ym = y1 + (y2 > y1 ? 1 : -1) * (RH / 2);
    const pts = d1 === 1 && d2 === -1 && xs > xo
      ? [[x1, y1], [(xo + xs) / 2, y1], [(xo + xs) / 2, y2], [xe, y2]]
      : [[x1, y1], [xo, y1], [xo, ym], [xs, ym], [xs, y2], [xe, y2]];
    const ed = di.cpm.edges.get(e.dep.id);
    const cls = e.ev.state === 'conflict' ? 'bad' : e.ev.met ? 'met' : showCrit && ed && ed.critical ? 'crit' : '';
    return { id: e.dep.id, d: 'M' + pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L'), cls, tip: e.succ.code + ' waits on ' + e.pred.code + ' (' + t + ')' };
  }).filter(Boolean) : [];

  const hdr = [ax.scale === 'month' ? 'Year' : 'Month', ax.scale === 'day' ? 'Day' : ax.scale === 'week' ? 'Week' : 'Month', 'Sprint'];

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Timeline</h2>
          <p className="hint">Every work item from your sprints, as a tree. Parents show a bracket that spans their children. The filled part is percent complete, red is late, and the red line is today.</p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 16, alignItems: 'flex-end' }}>
        <Fld label="Zoom">
          <div className="seg" role="group" aria-label="Zoom">
            {SCALES.map(([id, l]) => (<button key={id} aria-pressed={ax.scale === id} onClick={() => set({ scale: id })}>{l}</button>))}
          </div>
        </Fld>
        <Fld label="Range">
          <div className="seg" role="group" aria-label="Range">
            {SCOPES.map(([id, l]) => (<button key={id} aria-pressed={tl.scope === id} onClick={() => setScope(id)}>{l}</button>))}
          </div>
        </Fld>
        {tl.scope === 'sprint' && (
          <Fld label="Sprint">
            <select className="c" value={sp ? sp.id : ''} onChange={(e) => set({ sprintId: e.target.value })} aria-label="Sprint">
              {S.sprints.map((s) => (<option key={s.id} value={s.id}>{s.name}{s.start && s.end ? ' · ' + fdate(s.start) + ' – ' + fdate(s.end) : ''}</option>))}
              {!S.sprints.length && <option value="">No sprints</option>}
            </select>
          </Fld>
        )}
        {tl.scope === 'custom' && (
          <>
            <Fld label="From"><input className="c" type="date" value={tl.from} onChange={(e) => set({ from: e.target.value })} aria-label="From date" /></Fld>
            <Fld label="To"><input className="c" type="date" value={tl.to} onChange={(e) => set({ to: e.target.value })} aria-label="To date" /></Fld>
          </>
        )}
        <Fld label="Show">
          <div className="seg" role="group" aria-label="Dependency display">
            <button aria-pressed={showDeps} onClick={() => setShowDeps(!showDeps)}>Dependencies</button>
            <button aria-pressed={showCrit} onClick={() => setShowCrit(!showCrit)}>Critical path</button>
          </div>
        </Fld>
        <button className="btn" onClick={jumpToday} disabled={ax.todayX == null} title={ax.todayX == null ? 'Today is outside this range' : 'Scroll to today'}>Today</button>
      </div>
      {showDeps && (
        <p className="g-key" style={{ marginBottom: 8 }}>
          <span><i />Dependency arrow</span><span><i className="m" />Satisfied</span><span><i className="b" />Broken by the plan</span>
          {showCrit && <span><i className="c" />Critical path (no float)</span>}
        </p>
      )}
      {(ax.notice || hidden > 0) && (
        <p className="msg" style={{ marginBottom: 8 }}>{ax.notice} {hidden > 0 ? hidden + ' task' + (hidden > 1 ? 's' : '') + ' outside this range (or without dates) are hidden.' : ''}</p>
      )}

      <div className="gantt" ref={box} style={{ '--tw': ax.total.toFixed(1) + 'px', '--hh': HH + 'px' }}>
        <div className="g-in">
          <div className="g-layer">
            {ax.weekend.map((c, i) => (<span key={'w' + i} className="g-we" style={{ left: c.l, width: c.w }} />))}
            {ax.lines.map((l, i) => (<span key={'l' + i} className="g-gl" style={{ left: l.toFixed(1) + 'px' }} />))}
          </div>

          <div className="g-row g-h">
            <div className="g-lab">{hdr[0]}</div>
            <div className="g-trk">{ax.top.map((c, i) => (<span key={i} className="g-m" style={{ left: c.l.toFixed(1) + 'px', width: c.w.toFixed(1) + 'px' }}>{c.label}</span>))}</div>
          </div>
          <div className="g-row g-h">
            <div className="g-lab">{hdr[1]}</div>
            <div className="g-trk">{ax.bot.map((c, i) => (<span key={i} className={'g-w ' + c.cls} style={{ left: c.l.toFixed(1) + 'px', width: c.w.toFixed(1) + 'px' }} title={c.title}>{c.label}</span>))}</div>
          </div>
          <div className="g-row g-h">
            <div className="g-lab">{hdr[2]}</div>
            <div className="g-trk">{ax.band.map((c, i) => (<span key={i} className={'g-s' + (c.alt ? ' alt' : '')} style={{ left: c.l.toFixed(1) + 'px', width: c.w.toFixed(1) + 'px' }} title={c.title}>{c.label}</span>))}</div>
          </div>

          {rows.map((x, i) => {
            if (x.type === 'Phase') {
              const r = roll(S, x);
              return (
                <div key={i} className="g-row">
                  <div className="g-lab"><b>{x.id} {x.name}</b></div>
                  <div className="g-trk"><Bar s={r.s} f={r.f} pct={r.pct} cls="ph" ax={ax} tip={x.name} /></div>
                </div>
              );
            }
            const st = wstat(x);
            const sum = x.type === 'Sum';
            const ty = typeOf(S, x.kind);
            return (
              <div key={i} className={'g-row' + (sum ? ' g-sum' : '')}>
                <div className="g-lab" title={x.wbs + ' ' + x.name} style={{ paddingLeft: 8 + (x.depth || 0) * 14 }}>
                  {sum ? (
                    <button className="x g-exp" onClick={() => flip(x.taskId)} aria-label={shut.has(x.taskId) ? 'Expand ' + x.name : 'Collapse ' + x.name}>{shut.has(x.taskId) ? '▸' : '▾'}</button>
                  ) : (
                    <span className="g-exp" />
                  )}
                  <TypeBadge type={ty} size={14} />{' '}
                  <span className="mono" style={{ color: 'var(--muted)' }}>{x.wbs}</span> {sum ? <b>{x.name}</b> : x.name}
                </div>
                <div className="g-trk"><Bar s={x.start} f={x.finish} pct={x.pct} cls={(sum ? 'sum' : ty.milestone ? 'ms' : st === 'Done' ? 'done' : st === 'Late' ? 'late' : '') + (showCrit && di.cpm.nodes.get(x.taskId) && di.cpm.nodes.get(x.taskId).critical ? ' crit' : '')} ax={ax} tip={x.name} note={cpNote(di.cpm.nodes.get(x.taskId))} /></div>
              </div>
            );
          })}
          {!rows.length && <div className="g-row"><div className="g-lab msg">Nothing to show</div></div>}

          {arrows.length > 0 && (
            <svg className="g-deps" width={ax.total} height={rows.length * RH} aria-hidden="true">
              <defs>
                {[['', 'var(--muted)'], ['met', 'var(--good)'], ['bad', 'var(--bad)'], ['crit', 'var(--bad)']].map(([k, c]) => (
                  <marker key={k} id={'gd-' + (k || 'n')} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={c} stroke="none" /></marker>
                ))}
              </defs>
              {arrows.map((a) => (<path key={a.id} className={a.cls} d={a.d} markerEnd={'url(#gd-' + (a.cls || 'n') + ')'}><title>{a.tip}</title></path>))}
            </svg>
          )}
          {ax.todayX != null && (
            <div className="g-layer t"><span className="g-today" style={{ left: ax.todayX.toFixed(1) + 'px' }} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
