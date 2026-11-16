/* Charts for the Reports tab, drawn as plain SVG text with fixed colours (the report is always a white page).
   Each function returns one SVG string, so the same drawing can be shown on screen now and placed into the PDF later. */

export const PAL = {
  ink: '#1A2420', muted: '#5B6A65', line: '#D8DFDC', grid: '#E7ECEA',
  pv: '#8D9D97', ev: '#1B5E8C', ac: '#C9892B', good: '#1E7A4C', warn: '#B7791F', bad: '#A92E1C',
  series: ['#1B5E8C', '#C9892B', '#2E8B6A', '#7C5BA8', '#C2503C', '#5F7A74'],
};
const FONT = 'Helvetica, Arial, sans-serif';

export const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const open = (w, h, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label || 'Chart')}" font-family="${FONT}" style="width:100%;height:auto;max-width:${w}px;font-family:${FONT}">`;
const txt = (x, y, s, o = {}) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size || 11}" fill="${o.fill || PAL.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// a round top value for an axis
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
export const axisNum = (v) => (Math.abs(v) >= 1e6 ? r1(v / 1e6) + 'M' : Math.abs(v) >= 1000 ? r1(v / 1000) + 'k' : String(r1(v)));
const dShort = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/* Lines over time. series: [{ name, color, values (null = no point), dash }], ms: one date (UTC ms) per value.
   nowIdx marks the "as of" day. refs: [{ value, label, color }] horizontal reference lines. */
export function lineChart({ ms, series, nowIdx = -1, refs = [], fmt = axisNum, w = 720, h = 250, label = 'Chart', unit = '' }) {
  const L = 58, R = 16, T = 30, B = 28, pw = w - L - R, ph = h - T - B;
  const n = ms.length;
  if (n < 2) return open(w, 60, label) + txt(w / 2, 34, 'Not enough dates to draw this chart.', { anchor: 'middle' }) + '</svg>';
  let mx = 0;
  series.forEach((s) => s.values.forEach((v) => { if (v != null && v > mx) mx = v; }));
  refs.forEach((r) => { if (r.value > mx) mx = r.value; });
  const top = niceMax(mx * 1.04);
  const X = (i) => L + (pw * i) / (n - 1);
  const Y = (v) => T + ph - (ph * v) / top;
  let o = open(w, h, label);
  for (let k = 0; k <= 4; k++) {
    const v = (top * k) / 4, y = Y(v);
    o += `<line x1="${L}" y1="${r1(y)}" x2="${w - R}" y2="${r1(y)}" stroke="${k ? PAL.grid : PAL.line}" stroke-width="1"/>` + txt(L - 6, y + 4, fmt(v) + (k === 4 ? unit : ''), { anchor: 'end', size: 10 });
  }
  const ticks = Math.min(6, n);
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(((n - 1) * k) / (ticks - 1));
    o += txt(X(i), h - 8, dShort(ms[i]), { anchor: k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle', size: 10 });
  }
  refs.forEach((r) => {
    const y = Y(r.value);
    o += `<line x1="${L}" y1="${r1(y)}" x2="${w - R}" y2="${r1(y)}" stroke="${r.color || PAL.muted}" stroke-width="1" stroke-dasharray="5 4"/>` + txt(L + 4, y - 4, r.label, { anchor: 'start', size: 10, fill: r.color || PAL.muted });
  });
  if (nowIdx >= 0 && nowIdx < n) {
    const x = X(nowIdx);
    o += `<line x1="${r1(x)}" y1="${T}" x2="${r1(x)}" y2="${T + ph}" stroke="${PAL.muted}" stroke-width="1" stroke-dasharray="2 3"/>` + txt(x, T - 5, 'As of ' + dShort(ms[nowIdx]), { anchor: nowIdx > n * 0.8 ? 'end' : 'start', size: 10 });
  }
  series.forEach((s) => {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(v)) + ' ';
      pen = true;
    });
    if (d) o += `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
  });
  let lx = L;
  series.forEach((s) => {
    o += `<line x1="${lx}" y1="12" x2="${lx + 18}" y2="12" stroke="${s.color}" stroke-width="2.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>` + txt(lx + 23, 15.5, s.name, { size: 11, fill: PAL.ink });
    lx += 34 + s.name.length * 6;
  });
  return o + '</svg>';
}

/* One bar per row, with the figure at the end. rows: [{ label, value, color, text }] */
export function hbars({ rows, w = 720, labelW = 170, fmt = axisNum, label = 'Chart', barH = 20 }) {
  if (!rows.length) return open(w, 40, label) + txt(8, 24, 'Nothing to show yet.') + '</svg>';
  const gap = 10, T = 6, pw = w - labelW - 92;
  const mx = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value || 0)));
  const h = T * 2 + rows.length * (barH + gap) - gap;
  let o = open(w, h, label);
  rows.forEach((r, i) => {
    const y = T + i * (barH + gap), len = Math.max(r.value ? 2 : 0, (pw * Math.abs(r.value || 0)) / mx);
    o += txt(labelW - 8, y + barH / 2 + 4, short(r.label, 26), { anchor: 'end', fill: PAL.ink }) + `<rect x="${labelW}" y="${y}" width="${r1(len)}" height="${barH}" rx="3" fill="${r.color || PAL.ev}"/>` + txt(labelW + len + 6, y + barH / 2 + 4, r.text != null ? r.text : fmt(r.value), { fill: PAL.ink, weight: 'bold' });
  });
  return o + '</svg>';
}

/* Two bars per row (for example planned and actual). rows: [{ label, a, b }], names: [nameA, nameB] */
export function groupedBars({ rows, names, colors = [PAL.pv, PAL.ev], w = 720, labelW = 170, fmt = axisNum, label = 'Chart' }) {
  if (!rows.length) return open(w, 40, label) + txt(8, 24, 'Nothing to show yet.') + '</svg>';
  const bh = 12, pad = 12, T = 26, pw = w - labelW - 92;
  const mx = Math.max(1e-9, ...rows.map((r) => Math.max(r.a || 0, r.b || 0)));
  const h = T + rows.length * (bh * 2 + pad) + 4;
  let o = open(w, h, label);
  [0, 1].forEach((k) => { o += `<rect x="${labelW + k * 130}" y="6" width="12" height="12" rx="2" fill="${colors[k]}"/>` + txt(labelW + k * 130 + 17, 16, names[k], { fill: PAL.ink }); });
  rows.forEach((r, i) => {
    const y = T + i * (bh * 2 + pad);
    o += txt(labelW - 8, y + bh + 4, short(r.label, 26), { anchor: 'end', fill: PAL.ink });
    [r.a, r.b].forEach((v, k) => {
      const len = v ? Math.max(2, (pw * v) / mx) : 0;
      o += `<rect x="${labelW}" y="${y + k * bh}" width="${r1(len)}" height="${bh - 1}" rx="2" fill="${colors[k]}"/>` + txt(labelW + len + 5, y + k * bh + bh - 2, fmt(v || 0), { size: 10, fill: PAL.ink });
    });
  });
  return o + '</svg>';
}

/* Each row is a bar split into coloured parts (a row always fills the full width). rows: [{ label, segs: [{ v, color }], total }] */
export function stackedRows({ rows, legend, w = 720, labelW = 170, label = 'Chart' }) {
  if (!rows.length) return open(w, 40, label) + txt(8, 24, 'Nothing to show yet.') + '</svg>';
  const bh = 20, gap = 10, T = 28, pw = w - labelW - 50;
  const h = T + rows.length * (bh + gap);
  let o = open(w, h, label);
  let lx = labelW;
  legend.forEach((l) => { o += `<rect x="${lx}" y="6" width="11" height="11" rx="2" fill="${l.color}"/>` + txt(lx + 15, 15.5, l.label, { size: 10, fill: PAL.ink }); lx += 26 + l.label.length * 5.6; });
  rows.forEach((r, i) => {
    const y = T + i * (bh + gap);
    o += txt(labelW - 8, y + bh / 2 + 4, short(r.label, 26), { anchor: 'end', fill: PAL.ink });
    let x = labelW;
    r.segs.forEach((s) => {
      if (!(s.v > 0)) return;
      const len = (pw * s.v) / r.total;
      o += `<rect x="${r1(x)}" y="${y}" width="${r1(len)}" height="${bh}" fill="${s.color}" stroke="#fff" stroke-width="1"/>`;
      if (len > 18) o += txt(x + len / 2, y + bh / 2 + 4, s.v, { anchor: 'middle', size: 10, fill: '#fff', weight: 'bold' });
      x += len;
    });
    o += txt(labelW + pw + 6, y + bh / 2 + 4, r.total, { fill: PAL.ink, weight: 'bold' });
  });
  return o + '</svg>';
}

/* 5 x 5 risk grid: impact up, probability across; each cell shows how many open risks sit there. cells[i][p] = list (impact i+1, probability p+1) */
export function riskGrid({ cells, w = 360, label = 'Risk matrix' }) {
  const cs = 46, L = 64, T = 8, h = T + 5 * cs + 34;
  let o = open(Math.max(w, L + 5 * cs + 10), h, label);
  for (let im = 5; im >= 1; im--) {
    const row = 5 - im;
    o += txt(L - 8, T + row * cs + cs / 2 + 4, String(im), { anchor: 'end', fill: PAL.ink });
    for (let p = 1; p <= 5; p++) {
      const sc = im * p, n = (cells[im - 1] && cells[im - 1][p - 1] ? cells[im - 1][p - 1].length : 0);
      const fill = sc >= 15 ? '#F2B8AE' : sc >= 8 ? '#F6D99A' : '#BFE3CB';
      o += `<rect x="${L + (p - 1) * cs}" y="${T + row * cs}" width="${cs - 2}" height="${cs - 2}" rx="3" fill="${fill}"/>`;
      if (n) o += txt(L + (p - 1) * cs + cs / 2 - 1, T + row * cs + cs / 2 + 5, n, { anchor: 'middle', size: 15, fill: PAL.ink, weight: 'bold' });
    }
  }
  for (let p = 1; p <= 5; p++) o += txt(L + (p - 1) * cs + cs / 2 - 1, T + 5 * cs + 13, String(p), { anchor: 'middle', fill: PAL.ink });
  o += txt(L + (5 * cs) / 2, T + 5 * cs + 28, 'Probability (1 low – 5 high)', { anchor: 'middle', size: 10 });
  o += `<text x="12" y="${T + (5 * cs) / 2}" font-size="10" fill="${PAL.muted}" text-anchor="middle" transform="rotate(-90 12 ${T + (5 * cs) / 2})">Impact</text>`;
  return o + '</svg>';
}
