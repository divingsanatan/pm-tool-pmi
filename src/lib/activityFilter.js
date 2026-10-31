import { CATS } from './activity';

/* Smarter Activity: filters, a plain-language search ("change requests added this week"), the history of one item,
   counts for every filter chip and a day-by-day strip. Everything here is a pure function of the activity list. */

const DAY = 86400000;
export const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = (ms) => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }; // Monday
const startOfMonth = (ms) => { const d = new Date(startOfDay(ms)); d.setDate(1); return d.getTime(); };
export const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
const localMs = (s) => (s ? new Date(s + 'T00:00:00').getTime() : NaN);

// What happened, in everyday words (several internal actions share one chip)
export const ACTS = { added: 'Added', changed: 'Changed', moved: 'Moved', removed: 'Removed', auto: 'Automatic' };
export const actKey = (e) => ({ created: 'added', updated: 'changed', renamed: 'changed', moved: 'moved', deleted: 'removed', auto: 'auto' }[e.act] || 'changed');

export const RANGES = [
  ['all', 'All time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['since', 'Since my last visit'], ['custom', 'Pick dates…'],
];
// the time window of a range choice, as { a, b } in milliseconds (b exclusive), or null for all time
export function rangeBounds(r, now, seen, from, to) {
  if (r === 'today') return { a: startOfDay(now), b: Infinity };
  if (r === 'yesterday') return { a: startOfDay(now) - DAY, b: startOfDay(now) };
  if (r === 'week') return { a: startOfWeek(now), b: Infinity };
  if (r === '7d') return { a: startOfDay(now) - 6 * DAY, b: Infinity };
  if (r === '30d') return { a: startOfDay(now) - 29 * DAY, b: Infinity };
  if (r === 'since') return { a: seen || 0, b: Infinity };
  if (r === 'custom') {
    const a = localMs(from), b = localMs(to);
    return { a: isNaN(a) ? 0 : a, b: isNaN(b) ? Infinity : b + DAY };
  }
  return null;
}

/* ---------- the plain-language search ---------- */
const CAT_WORDS = {
  change: ['change request', 'change requests', 'change control', 'crs', 'cr', 'baseline', 'baselines'],
  work: ['work item', 'work items', 'task', 'tasks', 'story', 'stories', 'bug', 'bugs', 'epic', 'epics', 'subtask', 'subtasks'],
  people: ['stakeholder', 'stakeholders', 'people', 'person', 'member', 'members', 'team'],
  budget: ['budget', 'cost', 'costs', 'ledger', 'spend', 'expense', 'expenses', 'tracker'],
  raid: ['raid', 'risk', 'risks', 'issue', 'issues', 'assumption', 'assumptions', 'dependency', 'dependencies'],
  sprint: ['sprint', 'sprints'],
  project: ['settings', 'setting', 'holiday', 'holidays', 'calendar'],
  data: ['import', 'imported', 'export', 'exported'],
};
const ACT_WORDS = {
  added: ['added', 'add', 'created', 'create', 'new', 'raised', 'adding'],
  changed: ['updated', 'update', 'edited', 'edit', 'modified', 'renamed'],
  moved: ['moved', 'move', 'nested', 'reordered'],
  removed: ['deleted', 'delete', 'removed', 'remove', 'dropped'],
  auto: ['automatic', 'automatically', 'calculated'],
};
const STOP = new Set(['show', 'me', 'all', 'the', 'of', 'in', 'on', 'for', 'when', 'i', 'did', 'what', 'were', 'was', 'a', 'an', 'and', 'to', 'my', 'from', 'were', 'is', 'are', 'have', 'has', 'been', 'any', 'that', 'with', 'changes', 'change', 'by', 'who', 'which']);
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (s, w) => new RegExp('(^|[^a-z0-9-])' + esc(w) + '(?=$|[^a-z0-9-])').test(s);
const cut = (s, w) => s.replace(new RegExp('(^|[^a-z0-9-])' + esc(w) + '(?=$|[^a-z0-9-])', 'g'), '$1 ');

/* Reads a sentence such as "change requests added this week" or "deleted work items by Nikhil yesterday".
   Returns the filters it found (cats, acts, range, by) and what is left over as search words. */
export function parseQuery(text, authors = [], now = Date.now()) {
  let s = ' ' + String(text || '').toLowerCase().replace(/[“”"',?!]/g, ' ') + ' ';
  const out = { cats: new Set(), acts: new Set(), range: null, by: '', words: [], notes: [] };
  const note = (label) => out.notes.push(label);

  // time
  let m;
  if ((m = s.match(/\blast (\d+) (hour|hours|day|days|week|weeks)\b/))) {
    const n = +m[1], u = m[2].startsWith('hour') ? 3600000 : m[2].startsWith('day') ? DAY : 7 * DAY;
    out.range = { a: now - n * u, b: Infinity, label: 'Last ' + n + ' ' + m[2] };
    s = s.replace(m[0], ' ');
  } else if (hasWord(s, 'last week')) {
    out.range = { a: startOfWeek(now) - 7 * DAY, b: startOfWeek(now), label: 'Last week' };
    s = cut(s, 'last week');
  } else if (hasWord(s, 'this week')) {
    out.range = { a: startOfWeek(now), b: Infinity, label: 'This week' };
    s = cut(s, 'this week');
  } else if (hasWord(s, 'this month')) {
    out.range = { a: startOfMonth(now), b: Infinity, label: 'This month' };
    s = cut(s, 'this month');
  } else if (hasWord(s, 'yesterday')) {
    out.range = { a: startOfDay(now) - DAY, b: startOfDay(now), label: 'Yesterday' };
    s = cut(s, 'yesterday');
  } else if (hasWord(s, 'today')) {
    out.range = { a: startOfDay(now), b: Infinity, label: 'Today' };
    s = cut(s, 'today');
  } else if (hasWord(s, 'recently') || hasWord(s, 'recent')) {
    out.range = { a: startOfDay(now) - 6 * DAY, b: Infinity, label: 'Last 7 days' };
    s = cut(cut(s, 'recently'), 'recent');
  }
  if (out.range) note(out.range.label);

  // "by Nikhil"
  if ((m = s.match(/\bby ([a-z0-9][a-z0-9 ._-]*?)(?= (?:today|yesterday|this|last)\b|\s*$)/))) {
    const who = m[1].trim();
    const hit = authors.find((a) => a.toLowerCase() === who || a.toLowerCase().startsWith(who.split(' ')[0]));
    if (hit) { out.by = hit; note('By ' + hit); s = s.replace(m[0], ' '); }
  }

  // what kind of thing (longest phrases first)
  const cw = [];
  Object.entries(CAT_WORDS).forEach(([k, ws]) => ws.forEach((w) => cw.push([k, w])));
  cw.sort((a, b) => b[1].length - a[1].length).forEach(([k, w]) => {
    if (hasWord(s, w)) { out.cats.add(k); s = cut(s, w); }
  });
  out.cats.forEach((k) => note((CATS[k] || [k])[0]));

  // what was done to it
  Object.entries(ACT_WORDS).forEach(([k, ws]) => ws.forEach((w) => {
    if (hasWord(s, w)) { out.acts.add(k); s = cut(s, w); }
  }));
  out.acts.forEach((k) => note(ACTS[k]));

  out.words = s.split(/\s+/).filter((w) => w && !STOP.has(w));
  return out;
}

/* ---------- filtering ---------- */
export const subOf = (e) => e.sub || (e.ref && e.ref.type === 'task' ? 'task:' + e.ref.id : '');
const hay = (e) => (e.text + ' ' + (e.subName || '') + ' ' + (e.by || '') + ' ' + (e.d || []).map((x) => x.f + ' ' + x.a + ' ' + x.b).join(' ') + ' ' + (e.items || []).join(' ')).toLowerCase();

// F: { cats:Set, acts:Set, a, b (ms window), by, subject, words:[] }; skip names one facet to leave out (for the counts on its own chips)
export function matches(e, F, skip = '') {
  if (skip !== 'cat' && F.cats.size && !F.cats.has(e.cat)) return false;
  if (skip !== 'act' && F.acts.size && !F.acts.has(actKey(e))) return false;
  if (skip !== 'range' && F.b != null) {
    const t = new Date(e.at).getTime();
    if (t < F.a || t >= F.b) return false;
  }
  if (F.by && e.by !== F.by) return false;
  if (F.subject) {
    const k = subOf(e);
    if (k !== F.subject && !(e.subs && e.subs.includes(F.subject))) return false;
  }
  if (F.words.length) {
    const h = hay(e);
    if (!F.words.every((w) => h.includes(w))) return false;
  }
  return true;
}

// Every filter chip shows how many events it would give with the OTHER filters kept
export function facets(all, F) {
  const cats = {}, acts = {};
  all.forEach((e) => {
    if (matches(e, F, 'cat')) cats[e.cat] = (cats[e.cat] || 0) + 1;
    if (matches(e, F, 'act')) acts[actKey(e)] = (acts[actKey(e)] || 0) + 1;
  });
  return { cats, acts };
}

// events per day for the last n days (the chosen date window itself is ignored, so you can see where the activity was)
export function perDay(all, F, now, n = 30) {
  const t0 = startOfDay(now) - (n - 1) * DAY;
  const days = Array.from({ length: n }, (_, i) => ({ t0: t0 + i * DAY, key: dayKey(t0 + i * DAY), n: 0 }));
  all.forEach((e) => {
    if (!matches(e, F, 'range')) return;
    const i = Math.floor((startOfDay(new Date(e.at).getTime()) - t0) / DAY);
    if (i >= 0 && i < n) days[i].n++;
  });
  return days;
}

// the records and work items that appear in the log, for "history of …"
export function subjects(all, nameOf) {
  const m = new Map();
  all.forEach((e) => {
    const k = subOf(e);
    if (!k) return;
    let x = m.get(k);
    if (!x) {
      const name = e.subName || (nameOf && nameOf(k)) || '';
      if (!name) return;
      x = { key: k, name, type: e.subType || (k.startsWith('task:') ? 'work item' : ''), n: 0, last: '' };
      m.set(k, x);
    }
    x.n++;
    if (e.at > x.last) { x.last = e.at; if (e.subName) x.name = e.subName; }
  });
  return [...m.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}
