export const nz = (v) => (v == null || isNaN(v) ? 0 : v);

export function cl(v, a, b) {
  v = parseInt(v, 10);
  if (isNaN(v)) v = a;
  return Math.max(a, Math.min(b, v));
}

export function money(n) {
  if (n == null || isNaN(n)) return '–';
  const f = Math.abs(n % 1) > 0.0001;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: f ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function kf(v) {
  return Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v * 10) / 10);
}

export function pc(x, d) {
  if (x == null || isNaN(x) || !isFinite(x)) return '–';
  return (x * 100).toFixed(d == null ? 1 : d).replace(/\.0$/, '') + '%';
}

export function hrsf(x) {
  return x == null || isNaN(x) ? '–' : Math.round(x * 100) / 100 + '';
}
