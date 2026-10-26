import { kf, money, pc } from '../lib/format';
import { stCls } from '../lib/calc';
import { fsh } from '../lib/dates';

export function nice(max) {
  let step = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1) / 4)));
  const m = [1, 2, 2.5, 5, 10].filter((k) => step * k * 4 >= max)[0] || 10;
  step = step * m;
  return { step, top: step * 4 };
}

export function Gauge({ v }) {
  const max = 1.5, R = 52, cx = 64, cy = 64;
  const frac = v == null || !isFinite(v) ? 0 : Math.max(0, Math.min(1, v / max));
  const d = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  const f1 = Math.PI / 1.5;
  const x1 = cx - (R - 9) * Math.cos(f1), y1 = cy - (R - 9) * Math.sin(f1);
  const x2 = cx - (R + 7) * Math.cos(f1), y2 = cy - (R + 7) * Math.sin(f1);
  return (
    <svg viewBox="0 0 128 84" width="168" height="110" role="img" aria-label={'Gauge ' + pc(v)}>
      <path className="g-track" d={d} pathLength="100" />
      <path className={'g-val g-' + stCls(v)} d={d} pathLength="100" strokeDasharray={`${(frac * 100).toFixed(1)} 100`} />
      <line className="g-tick" x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} />
      <text className="gv" x={cx} y={cy - 6} textAnchor="middle">{pc(v, 0)}</text>
      <text className="gs" x={cx} y={cy + 12} textAnchor="middle">target 100%</text>
    </svg>
  );
}

export function Donut({ parts, unit = 'total', label = 'Budget makeup' }) {
  const tot = parts.reduce((a, p) => a + p.v, 0);
  const r = 15.9155;
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" width="170" height="170" role="img" aria-label={label}>
      <circle className="sg" cx="21" cy="21" r={r} style={{ stroke: 'var(--line)' }} />
      {tot > 0 &&
        parts.map((p, i) => {
          const len = (p.v / tot) * 100;
          const dash = Math.max(0, len - 0.6);
          const off = 25 - acc;
          acc += len;
          return (
            <circle
              key={i}
              className={'sg sg' + ((i % 6) + 1)}
              cx="21"
              cy="21"
              r={r}
              strokeDasharray={`${dash.toFixed(2)} ${(100 - dash).toFixed(2)}`}
              strokeDashoffset={off.toFixed(2)}
            >
              <title>{p.n + ' ' + money(p.v)}</title>
            </circle>
          );
        })}
      <text x="21" y="20" textAnchor="middle" style={{ font: '500 4.2px var(--f-mono)', fill: 'var(--ink)' }}>{money(tot)}</text>
      <text x="21" y="26" textAnchor="middle" style={{ font: '3px var(--f-body)' }}>{unit}</text>
    </svg>
  );
}

// Cumulative planned, earned and actual cost, day by day. Earned and actual stop at today; planned runs to the end of the plan.
export function SCurve({ s }) {
  const W = 760, H = 270, L = 56, R = 16, T = 18, Bm = 34;
  const pw = W - L - R, ph = H - T - Bm, n = s.ms.length;
  const top = (arr) => arr.reduce((m, v) => (v != null && v > m ? v : m), 0);
  const nc = nice(Math.max(1, s.bac, top(s.pv), top(s.ev), top(s.ac)));
  const xp = (i) => L + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const yp = (v) => T + ph - (v / nc.top) * ph;
  const line = (arr) => arr.map((v, i) => (v == null ? null : xp(i).toFixed(1) + ',' + yp(v).toFixed(1))).filter(Boolean).join(' ');
  const every = n <= 14 ? 1 : Math.ceil(n / 8 / 7) * 7; // about eight date labels, on whole weeks for long plans
  const ticks = [];
  for (let i = 0; i < n; i += every) ticks.push(i);
  const ni = s.nowIdx;
  const names = { pv: 'Planned', ev: 'Earned', ac: 'Actual' };
  const mark = (k) => {
    const v = ni >= 0 ? s[k][ni] : null;
    return v == null ? null : (
      <circle className={'pt-' + k} cx={xp(ni).toFixed(1)} cy={yp(v).toFixed(1)} r="4">
        <title>{names[k] + ' to date ' + money(v)}</title>
      </circle>
    );
  };
  return (
    <div className="scroll">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: 'block' }} role="img" aria-label="Cumulative planned, earned and actual cost up to today">
        {[0, 1, 2, 3, 4].map((g) => {
          const y = T + ph - (g / 4) * ph;
          return (
            <g key={g}>
              <line className="grid" x1={L} x2={W - R} y1={y} y2={y} />
              <text x={L - 6} y={y + 4} textAnchor="end">{kf(nc.step * g)}</text>
            </g>
          );
        })}
        {ticks.map((i) => (<text key={i} x={xp(i).toFixed(1)} y={H - 10} textAnchor="middle">{fsh(s.ms[i])}</text>))}
        {s.bac > 0 && (
          <g>
            <line x1={L} x2={W - R} y1={yp(s.bac)} y2={yp(s.bac)} style={{ stroke: 'var(--muted)', strokeWidth: 1, strokeDasharray: '2 4' }} />
            <text x={W - R} y={yp(s.bac) - 5} textAnchor="end">{'Budget ' + money(s.bac)}</text>
          </g>
        )}
        {ni >= 0 && (
          <g>
            <line x1={xp(ni)} x2={xp(ni)} y1={T} y2={T + ph} style={{ stroke: 'var(--ink)', strokeWidth: 1.2, strokeDasharray: '3 3' }} />
            <text x={xp(ni)} y={T - 5} textAnchor="middle">Today</text>
          </g>
        )}
        {['pv', 'ac', 'ev'].map((k) => (s[k].some((v) => v != null) ? <polyline key={k} className={'ln ln-' + k} points={line(s[k])} /> : null))}
        {mark('pv')}{mark('ac')}{mark('ev')}
      </svg>
    </div>
  );
}

export function Legend3() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--c-pv)' }} />Planned (PV)</span>
      <span><i style={{ background: 'var(--c-ev)' }} />Earned (EV)</span>
      <span><i style={{ background: 'var(--c-ac)' }} />Actual (AC)</span>
    </div>
  );
}
