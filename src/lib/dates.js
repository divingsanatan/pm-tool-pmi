// All date maths is UTC based so time zones never shift a week.
export const DAY = 86400000;

export function pd(s) {
  const p = String(s).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

export function fsh(ms) {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function fdate(s) {
  return s ? fsh(pd(s)) : '';
}

export function addDays(s, n) {
  return new Date(pd(s) + n * DAY).toISOString().slice(0, 10);
}

export function mondayOfToday() {
  const ms = pd(today());
  const dow = new Date(ms).getUTCDay();
  return new Date(ms - ((dow + 6) % 7) * DAY).toISOString().slice(0, 10);
}
