import { addDays, today } from './dates';
import { statusesOf, typeOf } from './tasks';
import { leafTasks } from './hier';

/* A daily record of the project, kept in the project itself (S.history), so charts can show how things changed over time:
     d   the day
     w   work items per status       { statusId: count }          (cumulative flow)
     k   open risks                  { hi, me, lo, un, emv, score, closed }   (risk burn-down)
     est true when the day was rebuilt from the activity log instead of recorded on the day
   One entry per day, the last one of the day wins. Opening the project or changing anything records today. */
export const HISTORY_MAX = 540;

const localDay = (at) => {
  const d = new Date(at);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
};

export function snapshotOf(S, d) {
  const w = {};
  S.sprints.forEach((sp) => leafTasks(sp.tasks).forEach((t) => {
    if (typeOf(S, t.type).milestone) return;
    const k = t.status || '';
    w[k] = (w[k] || 0) + 1;
  }));
  const k = { hi: 0, me: 0, lo: 0, un: 0, emv: 0, score: 0, closed: 0 };
  (S.raid || []).forEach((r) => {
    if (r.type !== 'Risk') return;
    if (r.status === 'Closed') { k.closed++; return; }
    if (!(r.p >= 1 && r.p <= 5 && r.i >= 1 && r.i <= 5)) { k.un++; return; }
    const sc = r.p * r.i;
    k.score += sc;
    if (sc >= 15) k.hi++; else if (sc >= 8) k.me++; else k.lo++;
    if (r.probPct != null && r.cost != null) k.emv += r.probPct * r.cost;
  });
  k.emv = Math.round(k.emv);
  return { d, w, k };
}

// Work item statuses on earlier days, rebuilt by undoing the activity log from today backwards.
// Only changes the log records with their old value can be undone; anything else is carried back unchanged, so these days are estimates.
function rebuild(S, now) {
  const acts = S.activity || [];
  if (!acts.length) return [];
  const idByLabel = new Map(statusesOf(S).map((s) => [s.label, s.id]));
  const codeToId = new Map();
  S.sprints.forEach((sp) => sp.tasks.forEach((t) => codeToId.set(t.code, t.id)));
  const state = new Map();
  S.sprints.forEach((sp) => leafTasks(sp.tasks).forEach((t) => { if (!typeOf(S, t.type).milestone) state.set(t.id, t.status || ''); }));
  const byDay = new Map();
  acts.forEach((e) => { const k = localDay(e.at); (byDay.get(k) || byDay.set(k, []).get(k)).push(e); });
  const oldest = [...byDay.keys()].sort()[0];
  const undo = (e) => {
    if (e.cat !== 'work') return;
    if (e.act === 'created') {
      (e.ref ? [e.ref.id] : (e.items || []).map((c) => codeToId.get(c)).filter(Boolean)).forEach((id) => state.delete(id));
    } else if (e.act === 'updated' && e.ref && state.has(e.ref.id)) {
      const x = (e.d || []).find((q) => q.k === 'status' || q.f === 'Status');
      const m = x ? null : /: Status (.+) → (.+)$/.exec(e.text || '');
      const from = x ? x.a : m ? m[1] : null;
      if (from != null && idByLabel.has(from)) state.set(e.ref.id, idByLabel.get(from));
    }
  };
  const entry = (d) => {
    const w = {};
    state.forEach((s) => { w[s] = (w[s] || 0) + 1; });
    return { d, w, est: true };
  };
  const out = [];
  let day = now, guard = 0;
  while (day >= oldest && guard++ < 420) {
    if (day !== now) out.push(entry(day));
    (byDay.get(day) || []).slice().reverse().forEach(undo);
    day = addDays(day, -1);
  }
  out.push(entry(day));
  return out.reverse();
}

// Called after every edit and every time the project opens
export function recordHistory(S) {
  const now = today();
  if (!Array.isArray(S.history)) S.history = rebuild(S, now);
  const snap = snapshotOf(S, now);
  const last = S.history[S.history.length - 1];
  if (last && last.d === now) S.history[S.history.length - 1] = snap;
  else S.history.push(snap);
  if (S.history.length > HISTORY_MAX) S.history = S.history.slice(-HISTORY_MAX);
}
