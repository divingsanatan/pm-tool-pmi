import { DAY, fsh, pd } from './dates';
import { nz } from './format';

/* ---------------------------------------------------------------------------------------------
   Day-by-day budget.

   The budget is NOT "weekly amount x number of weeks". It is built from the real calendar:

     for every calendar day from the project start to the project end
       working day?      (a weekday the team works, and not a non-working date)
       labour            = capacity x hours per day x hourly rate, for each stakeholder available that day
       recurring items   = per-day / per-week / per-month / per-sprint amounts, charged on the days they cover
       one-time items    = charged once (on their date when they have one)

   A project that ends on a Tuesday therefore only pays for the days up to that Tuesday, never for the
   rest of the week. Everything the Budget tab shows is read from this one model, so the tab and the
   Dashboard can never disagree.
   --------------------------------------------------------------------------------------------- */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MAX_DAYS = 104 * 7;

export const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dowOf = (ms) => (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
const daysInMonth = (ms) => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};
export const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(pd(s));

// Weekdays the team works, as numbers (Mon = 0 ... Sun = 6). Older projects only had "days per week": Mon..Nth day.
export function workDaysOf(m) {
  let w = Array.isArray(m.workDays) ? m.workDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  w = Array.from(new Set(w)).sort((a, b) => a - b);
  if (!w.length) {
    const n = Math.max(1, Math.min(7, Math.round(nz(m.sprintDays)) || 5));
    w = Array.from({ length: n }, (_, i) => i);
  }
  return w;
}

// Where the project ends: the latest planned date (sprints and their tasks), or a fixed date chosen by the user
function planEnd(S, start) {
  const m = S.meta;
  const dates = [];
  (S.sprints || []).forEach((sp) => {
    dates.push([sp.start, sp.name + ' starts']);
    dates.push([sp.end, sp.name + ' ends']);
    (sp.tasks || []).forEach((t) => {
      dates.push([t.start, (t.code || 'A work item') + ' starts']);
      dates.push([t.due, (t.code || 'A work item') + ' is due']);
    });
  });
  let latest = null, why = '', before = 0;
  dates.forEach(([d, text]) => {
    if (!validDate(d)) return;
    const t = pd(d);
    if (t < start) before++;
    if (latest == null || t > latest) {
      latest = t;
      why = text;
    }
  });
  const fixed = m.endMode === 'fixed' && validDate(m.end);
  let end, source;
  if (fixed) {
    end = Math.max(pd(m.end), start);
    source = { kind: 'fixed', text: 'Fixed end date' };
  } else if (latest != null && latest >= start) {
    end = latest;
    source = { kind: 'plan', text: why + ' ' + fsh(latest) };
  } else {
    end = start + 6 * DAY;
    source = { kind: 'default', text: 'No dated work yet, so one week is shown' };
  }
  const capped = end - start > (MAX_DAYS - 1) * DAY;
  if (capped) end = start + (MAX_DAYS - 1) * DAY;
  const after = fixed ? dates.filter(([d]) => validDate(d) && pd(d) > end).length : 0;
  return { end, source, latest, before, after, capped, fixed };
}

/**
 * Builds the whole budget. Pure: the same project always gives the same numbers.
 * Returns { start, end, endSource, days[], weeks[], people[], lines[], totals, std, warnings[] }.
 */
export function budgetModel(S) {
  const m = S.meta;
  const start = pd(m.start);
  const work = workDaysOf(m);
  const ws = new Set(work);
  const wpw = work.length; // standard working days in a full week
  const hpd = nz(m.hoursPerDay);
  const sw = Math.max(1, nz(m.sprintWeeks) || 2);
  const pe = planEnd(S, start);
  const end = pe.end;
  const nDays = Math.round((end - start) / DAY) + 1;

  // non-working dates (public holidays, shutdowns...) inside the project
  const off = new Map();
  (S.holidays || []).forEach((h) => {
    if (!h || !validDate(h.from)) return;
    let a = pd(h.from), b = validDate(h.to) ? pd(h.to) : a;
    if (b < a) [a, b] = [b, a];
    for (let t = Math.max(a, start); t <= Math.min(b, end); t += DAY) if (!off.has(t)) off.set(t, h.label || 'Non-working day');
  });

  const people = (S.team || [])
    .map((t) => {
      const per = (S.people || []).find((p) => p.id === t.person);
      if (!per) return null;
      return {
        id: per.id, name: per.name || '(unnamed)', role: per.role || '', rate: nz(per.rate), cap: nz(per.cap),
        from: validDate(t.from) ? pd(t.from) : null, to: validDate(t.to) ? pd(t.to) : null, fromS: t.from || '', toS: t.to || '',
        days: 0, hours: 0, cost: 0,
      };
    })
    .filter(Boolean);

  const lines = (S.lines || []).map((l, i) => ({
    i, name: l.name || 'Line item', per: l.per, spread: l.spread === 'work' ? 'work' : 'cal', amount: nz(l.amount),
    from: validDate(l.from) ? pd(l.from) : null, to: validDate(l.to) ? pd(l.to) : null, fromS: l.from || '', toS: l.to || '',
    total: 0, days: 0, phased: false, note: '',
  }));

  // one-time items: charged in full; they land on their date when it falls inside the project
  const onceAt = new Map();
  let onceTotal = 0, onceUnphased = 0;
  lines.forEach((L) => {
    if (L.per !== 'project' || !L.amount) return;
    L.total = L.amount;
    onceTotal += L.amount;
    if (L.from != null && L.from >= start && L.from <= end) {
      onceAt.set(L.from, (onceAt.get(L.from) || 0) + L.amount);
      L.phased = true;
    } else {
      onceUnphased += L.amount;
      L.note = L.from != null ? 'Dated outside the project, so it is not placed in a week' : 'No date, so it is not placed in a week';
    }
  });

  // working days in a calendar month (weekday pattern only), used by "per month, spread over working days"
  const mw = new Map();
  const monthWork = (ms) => {
    const d = new Date(ms), y = d.getUTCFullYear(), mo = d.getUTCMonth(), k = y * 12 + mo;
    if (!mw.has(k)) {
      let c = 0;
      for (let i = 1, n = daysInMonth(ms); i <= n; i++) if (ws.has(dowOf(Date.UTC(y, mo, i)))) c++;
      mw.set(k, c);
    }
    return mw.get(k);
  };

  const days = [];
  let labourT = 0, recurT = 0, hoursT = 0, workT = 0;
  for (let i = 0, ms = start; i < nDays; i++, ms += DAY) {
    const d = dowOf(ms);
    const planned = ws.has(d);
    const holiday = off.get(ms) || '';
    const working = planned && !holiday;
    let hours = 0, labour = 0, rec = 0;
    if (working) {
      workT++;
      people.forEach((p) => {
        if ((p.from != null && ms < p.from) || (p.to != null && ms > p.to)) return;
        const h = p.cap * hpd;
        p.days++;
        p.hours += h;
        p.cost += h * p.rate;
        hours += h;
        labour += h * p.rate;
      });
    }
    lines.forEach((L) => {
      if (L.per === 'project' || !L.amount) return;
      if ((L.from != null && ms < L.from) || (L.to != null && ms > L.to)) return;
      const byWork = L.per === 'day' || L.spread === 'work';
      if (byWork && !working) return;
      let a;
      if (L.per === 'day') a = L.amount;
      else if (L.per === 'week') a = byWork ? L.amount / wpw : L.amount / 7;
      else if (L.per === 'month') a = byWork ? L.amount / monthWork(ms) : L.amount / daysInMonth(ms);
      else if (L.per === 'sprint') a = byWork ? L.amount / (wpw * sw) : L.amount / (7 * sw);
      else return;
      L.total += a;
      L.days++;
      rec += a;
    });
    const once = onceAt.get(ms) || 0;
    labourT += labour;
    recurT += rec;
    hoursT += hours;
    days.push({ i, ms, date: isoOf(ms), dow: d, planned, working, holiday, hours, labour, lines: rec, once, total: labour + rec + once });
  }

  // calendar weeks counted from the start date, so they match the Dashboard weeks
  const weeks = [];
  for (let w = 1, n = Math.ceil(nDays / 7); w <= n; w++) {
    const s = start + (w - 1) * 7 * DAY;
    const o = { w, s, e: s + 6 * DAY, cal: 0, work: 0, hours: 0, labour: 0, lines: 0, once: 0, total: 0 };
    for (let k = (w - 1) * 7; k < Math.min(nDays, w * 7); k++) {
      const x = days[k];
      o.cal++;
      if (x.working) o.work++;
      o.hours += x.hours;
      o.labour += x.labour;
      o.lines += x.lines;
      o.once += x.once;
      o.total += x.total;
    }
    weeks.push(o);
  }

  const totals = {
    labour: labourT, recurring: recurT, once: onceTotal, onceUnphased,
    bac: labourT + recurT + onceTotal,
    calDays: nDays, workDays: workT, hours: hoursT,
    equivWeeks: workT / wpw, // working days expressed as full working weeks
    calWeeks: nDays / 7,
  };

  const warnings = [];
  if (!people.length) warnings.push({ cls: 'warn', text: 'Nobody is in the labour budget, so team labour is zero.' });
  else if (!hpd) warnings.push({ cls: 'warn', text: 'Working hours per day is 0, so team labour is zero.' });
  people.forEach((p) => {
    if (p.rate * p.cap > 0 && hpd && !p.days) warnings.push({ cls: 'warn', text: p.name + ' has no working days inside the project (check the From and To dates).' });
  });
  if (pe.before) warnings.push({ cls: 'warn', text: pe.before + ' planned date' + (pe.before > 1 ? 's fall' : ' falls') + ' before the project start date (' + fsh(start) + '). Those days are not budgeted.' });
  if (pe.fixed && pe.after) warnings.push({ cls: 'warn', text: pe.after + ' planned date' + (pe.after > 1 ? 's fall' : ' falls') + ' after the fixed end date (' + fsh(end) + '). The budget stops at the fixed end date.' });
  if (pe.capped) warnings.push({ cls: 'warn', text: 'The project is longer than 104 weeks, so the budget stops at week 104.' });
  lines.forEach((L) => {
    if (L.per !== 'project' && L.amount && !L.total) warnings.push({ cls: 'warn', text: '“' + L.name + '” adds nothing: its dates fall outside the project or it only runs on non-working days.' });
  });

  return { start, end, endSource: pe.source, days, weeks, people, lines, totals, warnings, std: { wpw, hpd, sprintWeeks: sw, work } };
}

const NONE = { cal: 0, work: 0, hours: 0, labour: 0, lines: 0, once: 0, total: 0 };
// Budget of project week w (counted from the start date); weeks after the project end have no budget
export const weekOf = (M, w) => M.weeks[w - 1] || { w, s: 0, e: 0, ...NONE };

// Budget of every day from a to b (UTC milliseconds, both included)
export function sumRange(M, a, b) {
  const o = { ...NONE };
  M.days.forEach((x) => {
    if (x.ms < a || x.ms > b) return;
    o.cal++;
    if (x.working) o.work++;
    o.hours += x.hours;
    o.labour += x.labour;
    o.lines += x.lines;
    o.once += x.once;
    o.total += x.total;
  });
  return o;
}

const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
// The day-by-day calculation as CSV, so it can be checked in a spreadsheet
export function daysCsv(M) {
  const r = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const head = ['Date', 'Weekday', 'Working day', 'Non-working reason', 'Labour hours', 'Labour cost', 'Line items', 'One-time', 'Day total', 'Cumulative'];
  let cum = 0;
  const rows = M.days.map((x) => {
    cum += x.total;
    return [x.date, WEEKDAYS[x.dow], x.working ? 'yes' : 'no', x.holiday || (x.planned ? '' : 'Not a working weekday'), r(x.hours), r(x.labour), r(x.lines), r(x.once), r(x.total), r(cum)].map(q).join(',');
  });
  rows.push(['Total', '', String(M.totals.workDays), '', r(M.totals.hours), r(M.totals.labour), r(M.totals.recurring), r(M.totals.onceUnphased ? M.totals.once - M.totals.onceUnphased : M.totals.once), r(M.totals.bac - M.totals.onceUnphased), ''].map(q).join(','));
  if (M.totals.onceUnphased) rows.push(['One-time items without a place in the calendar', '', '', '', '', '', '', r(M.totals.onceUnphased), r(M.totals.onceUnphased), ''].map(q).join(','));
  return head.map(q).join(',') + '\n' + rows.join('\n');
}
