// Power / interest grid (the PMBOK stakeholder grid). Each stakeholder is scored 1 to 5 for power (how much they can influence the project)
// and interest (how much the project matters to them). Scores of 4 and 5 count as high; 1 to 3 as low.
export const SCORES = [1, 2, 3, 4, 5];
export const HIGH_FROM = 4;

export const QUADRANTS = [
  { id: 'closely', label: 'Manage closely', power: 'high', interest: 'high', how: 'Involve them in decisions and talk often. Their support makes or breaks the project.', cadence: 'Weekly check-in and a say in key decisions', raci: 'A / R / C' },
  { id: 'satisfied', label: 'Keep satisfied', power: 'high', interest: 'low', how: 'Keep them comfortable with short, focused updates. Do not overload them.', cadence: 'Short brief every sprint, escalate risks early', raci: 'C' },
  { id: 'informed', label: 'Keep informed', power: 'low', interest: 'high', how: 'Share progress regularly and listen to their feedback. They can be good allies.', cadence: 'Sprint-end update and open feedback channel', raci: 'I / C' },
  { id: 'monitor', label: 'Monitor', power: 'low', interest: 'low', how: 'Watch for changes and give minimal effort.', cadence: 'Light check once a month', raci: 'I (optional)' },
];

// Scores saved earlier on the 1 to 10 scale are shown on the 1 to 5 scale (6 to 10 become 3 to 5 ... 2 per step)
export const scoreOf = (v) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!(n >= 1 && n <= 10)) return null;
  return n <= 5 ? Math.round(n) : Math.ceil(n / 2);
};
export const isPlaced = (p) => scoreOf(p.power) != null && scoreOf(p.interest) != null;

export function quadrantOf(p) {
  if (!isPlaced(p)) return null;
  const hp = scoreOf(p.power) >= HIGH_FROM;
  const hi = scoreOf(p.interest) >= HIGH_FROM;
  return QUADRANTS.find((q) => (q.power === 'high') === hp && (q.interest === 'high') === hi);
}

// numbers behind the insight cards. tasks: every work item of the project (to see how involved each person is in the RACI).
export function gridInsights(S, tasks) {
  const placed = S.people.filter(isPlaced);
  const loose = S.people.filter((p) => !isPlaced(p));
  const by = Object.fromEntries(QUADRANTS.map((q) => [q.id, []]));
  placed.forEach((p) => by[quadrantOf(p).id].push(p));
  const rolesBy = new Map(S.people.map((p) => {
    const r = { A: 0, R: 0, C: 0, I: 0, total: 0 };
    tasks.forEach((t) => { const v = t.raci && t.raci[p.id]; if (v && r[v] !== undefined) { r[v] += 1; r.total += 1; } });
    return [p.id, r];
  }));
  const key = by.closely.concat(by.satisfied); // the people with high power
  const gap = key.filter((p) => rolesBy.get(p.id).total === 0);
  const avg = (f) => (placed.length ? placed.reduce((a, p) => a + scoreOf(p[f]), 0) / placed.length : 0);
  return { placed, loose, by, key, gap, rolesOf: (id) => rolesBy.get(id) || { A: 0, R: 0, C: 0, I: 0, total: 0 }, avgPower: avg('power'), avgInterest: avg('interest'), hasTasks: tasks.length > 0 };
}
