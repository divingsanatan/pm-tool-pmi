import { DAY, pd, today } from './dates';
import { nW, sprintOf } from './calc';

export const SCALES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
export const SCOPES = [['project', 'Whole project'], ['sprint', 'Sprint'], ['custom', 'Custom']];
export const PX_PER_DAY = { day: 34, week: 6, month: 2.4 };
export const DEFAULT_TL = { scale: 'week', scope: 'project', sprintId: '', from: '', to: '' };

const dt = (ms) => new Date(ms);
const monthStart = (ms) => Date.UTC(dt(ms).getUTCFullYear(), dt(ms).getUTCMonth(), 1);
const nextMonth = (ms) => Date.UTC(dt(ms).getUTCFullYear(), dt(ms).getUTCMonth() + 1, 1);
const fmt = (ms, o) => dt(ms).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });

function span(tasks) {
  let a = null, b = null;
  tasks.forEach((t) =>
    [t.start, t.due].forEach((d) => {
      if (!d) return;
      const m = pd(d);
      if (a == null || m < a) a = m;
      if (b == null || m > b) b = m;
    })
  );
  return [a, b];
}

// The sprint shown when Scope = Sprint and none was picked: the one containing today, else the Active one, else the first.
export function autoSprint(S) {
  const td = pd(today());
  return (
    S.sprints.find((s) => s.start && s.end && pd(s.start) <= td && td <= pd(s.end)) ||
    S.sprints.find((s) => s.status === 'Active') ||
    S.sprints[0] ||
    null
  );
}

export function pickedSprint(S, tl) {
  return S.sprints.find((s) => s.id === tl.sprintId) || autoSprint(S);
}

function rawRange(S, tl) {
  const projStart = pd(S.meta.start);
  const projEnd = projStart + (nW(S) * 7 - 1) * DAY;
  const all = S.sprints.flatMap((c) => c.tasks);
  if (tl.scope === 'sprint') {
    const sp = pickedSprint(S, tl);
    if (sp) {
      const [a, b] = span(sp.tasks);
      const lo = [sp.start && pd(sp.start), a].filter((v) => v != null);
      const hi = [sp.end && pd(sp.end), b].filter((v) => v != null);
      if (lo.length && hi.length) return [Math.min(...lo), Math.max(...hi)];
    }
  }
  if (tl.scope === 'custom') {
    let a = tl.from ? pd(tl.from) : projStart;
    let b = tl.to ? pd(tl.to) : projEnd;
    if (b < a) [a, b] = [b, a];
    return [a, b];
  }
  const [a, b] = span(all);
  return [Math.min(projStart, a == null ? projStart : a), Math.max(projEnd, b == null ? projEnd : b)];
}

/** Everything the chart needs to draw one axis: range, scale, header cells, grid lines, sprint band, today. */
// minTotal: the width (px) of the chart area. When the range is short the chart stretches to fill it, so it never leaves empty space.
export function buildAxis(S, tl, minTotal = 0) {
  let [r0, r1] = rawRange(S, tl);
  let scale = tl.scale;
  let notice = '';
  const rawDays = (r1 - r0) / DAY + 1;
  if (scale === 'day' && rawDays > 400) {
    scale = 'week';
    notice = 'That range is too long for the Day view, so weeks are shown.';
  }
  if (scale === 'week' && rawDays > 3650) scale = 'month';

  const projStart = pd(S.meta.start);
  if (scale === 'week') {
    r0 = projStart + Math.floor((r0 - projStart) / (7 * DAY)) * 7 * DAY;
    r1 = r0 + Math.ceil(((r1 - r0) / DAY + 1) / 7) * 7 * DAY - DAY;
  } else if (scale === 'month') {
    r0 = monthStart(r0);
    r1 = nextMonth(r1) - DAY;
  }

  const days = (r1 - r0) / DAY + 1;
  const ppd = Math.max(PX_PER_DAY[scale], minTotal > 0 ? minTotal / days : 0);
  const total = days * ppd;
  const x = (ms) => ((ms - r0) / DAY) * ppd;
  const w = (a, b) => ((b - a) / DAY + 1) * ppd;
  const td = pd(today());
  const top = [], bot = [], lines = [], weekend = [];
  const Nw = nW(S);

  const monthCells = (labelOpts) => {
    for (let m = monthStart(r0); m <= r1; m = nextMonth(m)) {
      const a = Math.max(m, r0), b = Math.min(nextMonth(m) - DAY, r1);
      top.push({ l: x(a), w: w(a, b), label: fmt(m, labelOpts) });
    }
  };

  if (scale === 'day') {
    monthCells({ month: 'short', year: 'numeric' });
    for (let d = r0; d <= r1; d += DAY) {
      const dow = dt(d).getUTCDay();
      const isWe = dow === 0 || dow === 6;
      bot.push({ l: x(d), w: ppd, label: String(dt(d).getUTCDate()), title: fmt(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), cls: (isWe ? 'we ' : '') + (d === td ? 'now' : '') });
      if (d > r0) lines.push(x(d));
      if (isWe) weekend.push({ l: x(d), w: ppd });
    }
  } else if (scale === 'week') {
    monthCells({ month: 'short', year: '2-digit' });
    for (let ws = r0; ws <= r1; ws += 7 * DAY) {
      const n = Math.round((ws - projStart) / (7 * DAY)) + 1;
      const inProj = n >= 1 && n <= Nw;
      bot.push({
        l: x(ws), w: 7 * ppd, label: inProj ? String(n) : '',
        title: (inProj ? 'Week ' + n + ' · ' : '') + fmt(ws, { day: 'numeric', month: 'short' }) + ' – ' + fmt(ws + 6 * DAY, { day: 'numeric', month: 'short' }),
        cls: (inProj && sprintOf(S, n) % 2 === 0 ? 'alt ' : '') + (td >= ws && td < ws + 7 * DAY ? 'now' : ''),
      });
      if (ws > r0) lines.push(x(ws));
    }
  } else {
    for (let y = dt(r0).getUTCFullYear(); y <= dt(r1).getUTCFullYear(); y++) {
      const a = Math.max(Date.UTC(y, 0, 1), r0), b = Math.min(Date.UTC(y + 1, 0, 1) - DAY, r1);
      top.push({ l: x(a), w: w(a, b), label: String(y) });
    }
    for (let m = r0; m <= r1; m = nextMonth(m)) {
      const b = nextMonth(m) - DAY;
      bot.push({ l: x(m), w: w(m, b), label: fmt(m, { month: 'short' }), title: fmt(m, { month: 'long', year: 'numeric' }), cls: td >= m && td <= b ? 'now' : '' });
      if (m > r0) lines.push(x(m));
    }
  }

  const band = [];
  S.sprints.forEach((sp, i) => {
    if (!sp.start || !sp.end) return;
    const a = Math.max(pd(sp.start), r0), b = Math.min(pd(sp.end), r1);
    if (b < a) return;
    band.push({ l: x(a), w: w(a, b), label: sp.name, alt: i % 2 === 1, title: sp.name + ' · ' + fmt(pd(sp.start), { day: 'numeric', month: 'short' }) + ' – ' + fmt(pd(sp.end), { day: 'numeric', month: 'short' }) });
  });

  const todayX = td >= r0 && td <= r1 ? x(td) + (scale === 'day' ? ppd / 2 : 0) : null;
  return { scale, r0, r1, ppd, total, top, bot, lines, weekend, band, todayX, notice };
}
