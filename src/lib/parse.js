import { addDays } from './dates';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => ('0' + n).slice(-2);

// "2026-09-07", "7/9/2026", "07-09-26", "7 Sep 2026"  ->  "2026-09-07"  (day first for dd/mm/yyyy)
export function parseDate(txt) {
  const t = String(txt || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) [d, mo, y] = [+m[1], +m[2], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
  else if ((m = t.match(/^(\d{1,2})[ \-]([A-Za-z]{3,4})[a-z]*[ \-,]*(\d{2}|\d{4})$/)) && MONTHS[m[2].toLowerCase()]) [d, mo, y] = [+m[1], MONTHS[m[2].toLowerCase()], m[3].length === 2 ? 2000 + +m[3] : +m[3]];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return addDays(iso, 0) === iso ? iso : null; // rejects 31 Feb and similar
}

export function parseAmount(txt) {
  let t = String(txt == null ? '' : txt).trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  t = t.replace(/[^\d.]/g, '');
  const n = parseFloat(t);
  return isNaN(n) ? null : neg ? -n : n;
}

/**
 * Parses pasted spreadsheet rows into cost entries.
 * Columns: date, element, description, amount  (3 columns = date, element, amount; 2 = element, amount)
 */
export function parseCosts(text, defaultDate) {
  const rows = [], errors = [];
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((line, i) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const c = line.split(sep).map((x) => x.trim());
    let date, element, desc = '', amt;
    if (c.length >= 4) [date, element, desc, amt] = [c[0], c[1], c.slice(2, -1).join(sep), c[c.length - 1]];
    else if (c.length === 3) [date, element, amt] = c;
    else if (c.length === 2) [element, amt] = c;
    else {
      errors.push({ line: i + 1, why: 'needs at least an element and an amount' });
      return;
    }
    const amount = parseAmount(amt);
    const iso = date == null ? defaultDate : parseDate(date);
    if (amount == null) {
      if (i === 0) return; // looks like a header row
      errors.push({ line: i + 1, why: `amount “${amt}” is not a number` });
      return;
    }
    if (!iso) {
      if (i === 0 && !/\d/.test(date || '')) return; // header row
      errors.push({ line: i + 1, why: `date “${date}” was not understood` });
      return;
    }
    rows.push({ date: iso, element, desc, amount });
  });
  return { rows, errors };
}
