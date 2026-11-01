import { useRef, useState } from 'react';
import { nice } from './Charts';
import { fsh } from '../lib/dates';
import '../dashcharts.css';

/* Chart pieces for the dashboard. Everything is plain SVG / HTML that follows the theme, scales to the width of its card and
   has a hover read-out. Nothing here knows about projects: the caller passes numbers. */

const r1 = (v) => Math.round(v * 10) / 10;
export const fmtNum = (v) => (v == null ? '–' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(r1(v)));

export const Legend = ({ items }) => (
  <div className="dc-legend">
    {items.map((i) => (<span key={i.name}><i style={{ background: i.dash ? 'none' : i.color, borderTop: i.dash ? '2px dashed ' + i.color : undefined, height: i.dash ? 0 : 10 }} />{i.name}</span>))}
  </div>
);

/* A line / area chart over dates.
   series: [{ name, color, values (one per date, null = no value), dash, area, w }]   refs: [{ y, label, color }] */
export function TimeChart({ ms, series, nowIdx = -1, fmt = fmtNum, yMax, yMin = 0, refs = [], height = 260, label, yFmt, marks = [], w = 760 }) {
  const W = w, H = height, L = 52, R = 16, T = 16, B = 32;
  const pw = W - L - R, ph = H - T - B, n = ms.length;
  const [hov, setHov] = useState(null);
  const box = useRef(null);
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const top = yMax != null ? yMax : nice(Math.max(1e-9, ...all, ...refs.map((r) => r.y))).top;
  const lo = yMin;
  const xp = (i) => L + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const yp = (v) => T + ph - ((Math.max(lo, Math.min(top, v)) - lo) / (top - lo || 1)) * ph;
  const segs = (vals) => {
    const out = []; let cur = [];
    vals.forEach((v, i) => { if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push([xp(i), yp(v)]); });
    if (cur.length) out.push(cur);
    return out;
  };
  const pts = (seg) => seg.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
  const every = Math.max(1, Math.ceil(n / (W < 600 ? 4 : 7)));
  const ticks = [];
  for (let i = 0; i < n; i += every) ticks.push(i);
  const move = (e) => {
    const r = box.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHov(Math.max(0, Math.min(n - 1, Math.round(((x - L) / pw) * (n - 1)))));
  };
  const yf = yFmt || fmt;
  return (
    <div className="dc-wrap">
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHov(null)}>
        {[0, 1, 2, 3, 4].map((g) => {
          const v = lo + ((top - lo) * g) / 4, y = yp(v);
          return (<g key={g}><line className="grid" x1={L} x2={W - R} y1={y} y2={y} /><text x={L - 6} y={y + 4} textAnchor="end">{yf(v)}</text></g>);
        })}
        {ticks.map((i) => (<text key={i} x={xp(i)} y={H - 10} textAnchor="middle">{fsh(ms[i])}</text>))}
        {refs.map((r, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={yp(r.y)} y2={yp(r.y)} style={{ stroke: r.color || 'var(--muted)', strokeWidth: 1.2, strokeDasharray: '4 4' }} />
            <text x={W - R} y={yp(r.y) - 4} textAnchor="end" style={{ fill: r.color || 'var(--muted)' }}>{r.label}</text>
          </g>
        ))}
        {marks.map((m, i) => (
          <g key={i}>
            <line x1={xp(m.i)} x2={xp(m.i)} y1={T} y2={T + ph} style={{ stroke: m.color || 'var(--muted)', strokeWidth: 1, strokeDasharray: '2 3' }} />
            <text x={xp(m.i) + (nowIdx >= 0 && Math.abs(xp(m.i) - xp(nowIdx)) < 90 ? (m.i < nowIdx ? -4 : 4) : 0)} y={T - 4} textAnchor={nowIdx >= 0 && Math.abs(xp(m.i) - xp(nowIdx)) < 90 ? (m.i < nowIdx ? 'end' : 'start') : 'middle'} style={{ fill: m.color || 'var(--muted)' }}>{m.label}</text>
          </g>
        ))}
        {nowIdx >= 0 && (
          <g><line x1={xp(nowIdx)} x2={xp(nowIdx)} y1={T} y2={T + ph} style={{ stroke: 'var(--ink)', strokeWidth: 1.2, strokeDasharray: '3 3' }} /><text x={xp(nowIdx)} y={T - 4} textAnchor="middle">Today</text></g>
        )}
        {series.map((s) => segs(s.values).map((sg, k) => (
          <g key={s.name + k}>
            {s.area && sg.length > 1 && <polygon points={pts(sg) + ' ' + sg[sg.length - 1][0].toFixed(1) + ',' + yp(lo) + ' ' + sg[0][0].toFixed(1) + ',' + yp(lo)} style={{ fill: s.color, opacity: 0.14 }} />}
            <polyline points={pts(sg)} style={{ fill: 'none', stroke: s.color, strokeWidth: s.w || 2.2, strokeDasharray: s.dash ? '5 4' : undefined, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
            {sg.length === 1 && <circle cx={sg[0][0]} cy={sg[0][1]} r="3.5" style={{ fill: s.color }} />}
          </g>
        )))}
        {hov != null && (
          <g>
            <line x1={xp(hov)} x2={xp(hov)} y1={T} y2={T + ph} style={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
            {series.map((s) => (s.values[hov] != null ? <circle key={s.name} cx={xp(hov)} cy={yp(s.values[hov])} r="4" style={{ fill: s.color, stroke: 'var(--surface)', strokeWidth: 1.5 }} /> : null))}
          </g>
        )}
      </svg>
      {hov != null && (
        <div className="dc-tip" style={{ left: Math.min(82, Math.max(10, (xp(hov) / W) * 100)) + '%' }}>
          <b>{fsh(ms[hov])}</b>
          {series.map((s) => (s.values[hov] != null ? <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{fmt(s.values[hov])}</b></span> : null))}
        </div>
      )}
    </div>
  );
}

/* Vertical bars, grouped or stacked. cats: [{ label, values:[…one per series] }]   series: [{ name, color }] */
export function BarChart({ cats, series, stacked = false, fmt = fmtNum, axisFmt, refs = [], height = 240, label, yMin = 0, w = 760 }) {
  const W = w, H = height, L = 52, R = 16, T = 14, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const [hov, setHov] = useState(null);
  const vals = cats.flatMap((c) => (stacked ? [c.values.filter((v) => v > 0).reduce((a, v) => a + v, 0)] : c.values));
  const negs = cats.flatMap((c) => c.values.filter((v) => v < 0));
  const hi = nice(Math.max(1e-9, ...vals, ...refs.map((r) => r.y))).top;
  const lo = negs.length ? -nice(Math.max(...negs.map((v) => -v))).top : yMin;
  const yp = (v) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const gw = pw / Math.max(1, cats.length);
  const bw = Math.min(46, (gw * 0.7) / (stacked ? 1 : series.length));
  return (
    <div className="dc-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label={label} onMouseLeave={() => setHov(null)}>
        {[0, 1, 2, 3, 4].map((g) => {
          const v = lo + ((hi - lo) * g) / 4, y = yp(v);
          return (<g key={g}><line className="grid" x1={L} x2={W - R} y1={y} y2={y} /><text x={L - 6} y={y + 4} textAnchor="end">{(axisFmt || fmt)(v)}</text></g>);
        })}
        {lo < 0 && <line x1={L} x2={W - R} y1={yp(0)} y2={yp(0)} style={{ stroke: 'var(--muted)', strokeWidth: 1.2 }} />}
        {refs.map((r, i) => (
          <g key={i}><line x1={L} x2={W - R} y1={yp(r.y)} y2={yp(r.y)} style={{ stroke: r.color || 'var(--muted)', strokeWidth: 1.2, strokeDasharray: '4 4' }} /><text x={W - R} y={yp(r.y) - 4} textAnchor="end" style={{ fill: r.color || 'var(--muted)' }}>{r.label}</text></g>
        ))}
        {cats.map((c, ci) => {
          const cx = L + gw * ci + gw / 2;
          let acc = 0;
          return (
            <g key={ci} onMouseEnter={() => setHov(ci)}>
              <rect x={L + gw * ci} y={T} width={gw} height={ph} style={{ fill: hov === ci ? 'var(--row)' : 'transparent' }} />
              {c.values.map((v, si) => {
                if (v == null) return null;
                const x = stacked ? cx - bw / 2 : cx - (bw * series.length) / 2 + si * bw;
                const y0 = stacked ? yp(acc) : yp(0), y1 = stacked ? yp(acc + v) : yp(v);
                if (stacked) acc += v;
                return <rect key={si} x={x} y={Math.min(y0, y1)} width={bw - (stacked ? 0 : 2)} height={Math.max(1, Math.abs(y1 - y0))} rx="3" style={{ fill: c.colors ? c.colors[si] : series[si].color }}><title>{c.label + ' · ' + series[si].name + ': ' + fmt(v)}</title></rect>;
              })}
              <text x={cx} y={H - 24} textAnchor="middle">{c.label.length > (W < 600 ? 10 : 16) ? c.label.slice(0, W < 600 ? 9 : 15) + '…' : c.label}</text>
              {c.sub && <text x={cx} y={H - 10} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: 10.5 }}>{c.sub}</text>}
            </g>
          );
        })}
      </svg>
      {hov != null && cats[hov] && (
        <div className="dc-tip" style={{ left: Math.min(82, Math.max(10, ((L + gw * hov + gw / 2) / W) * 100)) + '%' }}>
          <b>{cats[hov].label}</b>
          {series.map((s, si) => (cats[hov].values[si] != null ? <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{fmt(cats[hov].values[si])}</b></span> : null))}
        </div>
      )}
    </div>
  );
}

/* Horizontal bars with a name on each row. rows: [{ label, sub, parts:[{ v, color, title }], text, flag }]   mark: a value to draw a line at (e.g. 100% capacity) */
export function HBars({ rows, max, mark, markLabel, label }) {
  const top = max || Math.max(1e-9, ...rows.map((r) => r.parts.reduce((a, p) => a + p.v, 0)), mark || 0) * 1.05;
  return (
    <div className="dc-hb" role="img" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} className="dc-hb-r">
          <div className="dc-hb-l" title={r.label}><b>{r.label}</b>{r.sub && <span className="msg">{r.sub}</span>}</div>
          <div className="dc-hb-t">
            {mark != null && <u style={{ left: (mark / top) * 100 + '%' }} title={markLabel} />}
            {r.parts.map((p, k) => (<i key={k} style={{ width: Math.min(100, (p.v / top) * 100) + '%', background: p.color }} title={p.title} />))}
          </div>
          <div className="dc-hb-v">{r.text}{r.flag && <span className={'pill ' + r.flag.cls}>{r.flag.label}</span>}</div>
        </div>
      ))}
    </div>
  );
}

// colour of a utilisation figure (load ÷ capacity)
export function heat(util, has = true) {
  if (!has) return 'var(--row)';
  if (util === Infinity) return 'color-mix(in srgb, var(--bad) 90%, var(--surface))';
  if (util <= 0.001) return 'var(--row)';
  const mix = (c, p) => 'color-mix(in srgb, ' + c + ' ' + Math.round(p) + '%, var(--surface))';
  if (util < 0.5) return mix('var(--s1)', 18 + util * 40);
  if (util < 0.85) return mix('var(--good)', 30 + (util - 0.5) * 70);
  if (util <= 1.0005) return mix('var(--warn)', 50 + (util - 0.85) * 100);
  return mix('var(--bad)', Math.min(90, 55 + (util - 1) * 120));
}
export const HeatLegend = () => (
  <div className="dc-legend">
    <span><i style={{ background: heat(0.3) }} />Under 50%</span><span><i style={{ background: heat(0.7) }} />50–85%</span>
    <span><i style={{ background: heat(0.95) }} />85–100%</span><span><i style={{ background: heat(1.25) }} />Over 100%</span>
  </div>
);

// A grid of coloured cells. cols: header labels. rows: [{ label, sub, cells:[{ bg, text, title }] }]
export function HeatGrid({ cols, rows, label, colW = 44, labelW = 150 }) {
  return (
    <div className="scroll">
      <div className="dc-heat" role="table" aria-label={label} style={{ gridTemplateColumns: labelW + 'px repeat(' + cols.length + ', minmax(' + colW + 'px, 1fr))' }}>
        <div className="dc-h-c" />
        {cols.map((c, i) => (<div key={i} className="dc-h-c" title={c.title}>{c.top && <b>{c.top}</b>}<span>{c.label}</span></div>))}
        {rows.map((r, ri) => [
          <div key={'l' + ri} className="dc-h-l" title={r.label}><b>{r.label}</b>{r.sub && <span className="msg">{r.sub}</span>}</div>,
          ...r.cells.map((c, ci) => (<div key={ri + '-' + ci} className="dc-h-x" style={{ background: c.bg }} title={c.title}>{c.text}</div>)),
        ])}
      </div>
    </div>
  );
}

// The probability × impact matrix. cells[impact-1][probability-1] = list of risks
export function RiskGrid({ cells, onPick }) {
  const zone = (p, i) => { const s = p * i; return s >= 15 ? 'var(--bad)' : s >= 8 ? 'var(--warn)' : 'var(--good)'; };
  const LAB = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
  return (
    <div className="dc-mx" role="table" aria-label="Probability and impact matrix of open risks">
      <div className="dc-mx-y">Impact</div>
      <div className="dc-mx-g">
        {[4, 3, 2, 1, 0].map((i) => (
          <div key={i} className="dc-mx-row">
            <span className="dc-mx-ax">{LAB[i]}</span>
            {[0, 1, 2, 3, 4].map((p) => {
              const list = cells[i][p];
              return (
                <div key={p} className="dc-mx-c" style={{ background: 'color-mix(in srgb, ' + zone(p + 1, i + 1) + ' ' + (list.length ? 46 : 22) + '%, var(--surface))' }} title={(i + 1) * (p + 1) + ' · ' + (list.length ? list.map((r) => r.id).join(', ') : 'no risks')}>
                  {list.slice(0, 4).map((r) => (<button key={r.key} type="button" className="dc-mx-r" onClick={() => onPick && onPick(r)}>{r.id}</button>))}
                  {list.length > 4 && <span className="dc-mx-more">+{list.length - 4}</span>}
                </div>
              );
            })}
          </div>
        ))}
        <div className="dc-mx-row"><span className="dc-mx-ax" />{LAB.map((l) => (<span key={l} className="dc-mx-ax dc-mx-x">{l}</span>))}</div>
        <div className="dc-mx-xl">Probability</div>
      </div>
    </div>
  );
}
