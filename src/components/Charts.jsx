import { kf, money, pc } from '../lib/format';
import { stCls, wk, nW } from '../lib/calc';

export function nice(max) {
  let step = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1) / 4)));
  const m = [1, 2, 2.5, 5, 10].filter((k) => step * k * 4 >= max)[0] || 10;
  step = step * m;
  return { step, top: step * 4 };
}

export function Spark({ vals }) {
  const W = 120, H = 30, P = 4, n = vals.length;
  const pts = [];
  vals.forEach((v, i) => {
    if (v != null && isFinite(v)) pts.push([n > 1 ? P + ((W - 2 * P) * i) / (n - 1) : W / 2, v]);
  });
  if (!pts.length) return <span className="msg">No weekly data</span>;
  let mn = Math.min(...pts.map((p) => p[1]));
  let mx = Math.max(...pts.map((p) => p[1]));
  if (mx === mn) {
    mx += 0.5;
    mn -= 0.5;
  }
  const c = pts.map((p) => [p[0], H - P - ((p[1] - mn) / (mx - mn)) * (H - 2 * P)]);
  const l = c[c.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="120" height="30" aria-hidden="true">
      {c.length > 1 && <polyline className="sp" points={c.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')} />}
      <circle className="spd" cx={l[0].toFixed(1)} cy={l[1].toFixed(1)} r="3" />
    </svg>
  );
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

export function Donut({ parts }) {
  const tot = parts.reduce((a, p) => a + p.v, 0);
  const r = 15.9155;
  let acc = 0;
  return (
    <svg viewBox="0 0 42 42" width="170" height="170" role="img" aria-label="Weekly budget makeup">
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
      <text x="21" y="26" textAnchor="middle" style={{ font: '3px var(--f-body)' }}>per week</text>
    </svg>
  );
}

const SERIES = [
  ['pv', 'Planned'],
  ['ev', 'Earned'],
  ['ac', 'Actual'],
];

export function BarsChart({ S, a, b }) {
  const n = b - a + 1, H = 240, L = 48, R = 10, T = 10, Bm = 30;
  const gw = Math.max(40, Math.min(70, 880 / n));
  const pw = gw * n, W = L + pw + R, ph = H - T - Bm;
  const vals = [];
  for (let w = a; w <= b; w++) {
    const x = wk(S, w);
    [x.pv, x.ev, x.ac].forEach((v) => v != null && vals.push(v));
  }
  const nc = nice(Math.max(...vals, 1));
  const bw = Math.min(16, (gw - 10) / 3);
  const weeks = [];
  for (let w = a; w <= b; w++) weeks.push(w);
  return (
    <div className="scroll">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', maxWidth: 'none' }} role="img" aria-label="Planned, earned and actual cost by week">
        {[0, 1, 2, 3, 4].map((g) => {
          const y = T + ph - (g / 4) * ph;
          return (
            <g key={g}>
              <line className="grid" x1={L} x2={W - R} y1={y} y2={y} />
              <text x={L - 6} y={y + 4} textAnchor="end">{kf(nc.step * g)}</text>
            </g>
          );
        })}
        {weeks.map((w) => {
          const x = wk(S, w);
          const cx = L + gw * (w - a) + gw / 2;
          return (
            <g key={w}>
              {SERIES.map(([k, label], idx) => {
                const val = x[k];
                if (val == null) return null;
                const h = Math.max(1, (val / nc.top) * ph);
                return (
                  <rect key={k} className={'b-' + k} x={(cx + (idx - 1) * (bw + 2) - bw / 2).toFixed(1)} y={(T + ph - h).toFixed(1)} width={bw} height={h.toFixed(1)} rx="2">
                    <title>{`Week ${w} ${label} ${money(val)}`}</title>
                  </rect>
                );
              })}
              <text x={cx} y={H - 10} textAnchor="middle">{'W' + w}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SCurve({ S, a, b }) {
  const Nw = nW(S), W = 680, H = 250, L = 52, R = 12, T = 14, Bm = 30;
  const pw = W - L - R, ph = H - T - Bm, cw = pw / Nw;
  const cum = { pv: [], ev: [], ac: [] };
  const tot = { pv: 0, ev: 0, ac: 0 };
  let mx = 1;
  for (let w = 1; w <= Nw; w++) {
    const x = wk(S, w);
    ['pv', 'ev', 'ac'].forEach((k) => {
      if (x[k] != null) {
        tot[k] += x[k];
        cum[k].push({ w, v: tot[k] });
        if (tot[k] > mx) mx = tot[k];
      }
    });
  }
  const nc = nice(mx);
  const xp = (w) => L + cw * (w - 0.5);
  const yp = (v) => T + ph - (v / nc.top) * ph;
  const st = Nw > 13 ? 2 : 1;
  const ticks = [];
  for (let w = 1; w <= Nw; w++) if (w % st === 1 || st === 1 || w === Nw) ticks.push(w);
  const names = { pv: 'planned', ev: 'earned', ac: 'actual' };
  return (
    <div className="scroll">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: 'block' }} role="img" aria-label="Cumulative planned, earned and actual cost">
        <rect className="band" x={(L + cw * (a - 1)).toFixed(1)} y={T} width={(cw * (b - a + 1)).toFixed(1)} height={ph} rx="3" />
        {[0, 1, 2, 3, 4].map((g) => {
          const y = T + ph - (g / 4) * ph;
          return (
            <g key={g}>
              <line className="grid" x1={L} x2={W - R} y1={y} y2={y} />
              <text x={L - 6} y={y + 4} textAnchor="end">{kf(nc.step * g)}</text>
            </g>
          );
        })}
        {ticks.map((w) => (
          <text key={w} x={xp(w).toFixed(1)} y={H - 10} textAnchor="middle">{w}</text>
        ))}
        {['pv', 'ac', 'ev'].map((k) => {
          const pts = cum[k];
          if (!pts.length) return null;
          return (
            <g key={k}>
              {pts.length > 1 && <polyline className={'ln ln-' + k} points={pts.map((p) => xp(p.w).toFixed(1) + ',' + yp(p.v).toFixed(1)).join(' ')} />}
              {pts.map((p) => (
                <circle key={p.w} className={'pt-' + k} cx={xp(p.w).toFixed(1)} cy={yp(p.v).toFixed(1)} r="3.5">
                  <title>{`Week ${p.w} cumulative ${names[k]} ${money(p.v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
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
