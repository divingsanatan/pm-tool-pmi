const N = null;

function rk(id, p, i, pp, cost, days, st, due) {
  return { id, type: 'Risk', desc: '', owner: '', p, i, probPct: pp, cost, days, status: st, resp: '', due, rev: '2026-10-16' };
}
function ot(id, type, cost, days, st, due) {
  return { id, type, desc: '', owner: '', p: N, i: N, probPct: N, cost, days, status: st, resp: '', due, rev: '2026-10-16' };
}
function task(code, name, status, effort, start, due) {
  return { id: 't' + code.replace('.', ''), code, name, status, assignees: ['u2'], priority: 'normal', start, due, effort, description: '', subtasks: [], raci: { u1: 'A', u2: 'R', u3: 'I', u4: 'C', u5: 'I' } };
}

export function seedProject() {
  const rep = [];
  for (let w = 0; w < 26; w++) rep.push({ planPct: N, earnPct: N, note: '' });
  rep[0] = { planPct: 0.2, earnPct: 0.165, note: '' };
  return {
    id: 'p1',
    meta: { name: 'Sprint Control', start: '2026-09-07', weeks: 26, sprintWeeks: 2, hoursPerDay: 8, sprintDays: 6 },
    ui: { mode: 'project', week: 1, sprint: 1, from: 1, to: 26 },
    report: rep,
    lines: [
      { name: 'Licenses', amount: 100, per: 'week' },
      { name: 'Contingency reserve', amount: 610, per: 'week' },
    ],
    sprints: [
      {
        id: 's1', name: 'Week 7', status: 'Done', start: '2026-09-07', end: '2026-09-13',
        tasks: [
          task('1.1', 'Implement total budget functionality.', 'done', 2, '2026-09-07', '2026-09-07'),
          task('1.2', 'Compare campaign metrics across multiple platforms like google analytics, appsflyer and firebase.', 'done', 1, '2026-09-07', '2026-09-07'),
          task('1.3', 'AI should be able to determine the budget allocation for each platform.', 'done', 4, '2026-09-07', '2026-09-08'),
        ],
      },
      {
        id: 's2', name: 'Sprint 2', status: 'Done', start: '2026-10-01', end: '2026-10-14',
        tasks: [
          task('2.1', 'Custom budget allocation for each platform.', 'progress', 8, '2026-10-01', '2026-10-14'),
          task('2.2', 'Unapproved errors should be visible to the advertiser.', 'progress', 1, '2026-10-01', '2026-10-14'),
        ],
      },
      {
        id: 's3', name: 'Sprint 3', status: 'Active', start: '2026-10-15', end: '2026-10-30',
        tasks: [
          task('2.3', 'Improve creative generation prompt using the actual product data.', 'progress', 8, '2026-10-15', '2026-10-30'),
          task('2.4', 'Video generation pipeline.', 'done', 8, '2026-10-15', '2026-10-26'),
          task('2.5', 'Provide advertisers the option to add product links for better generation of creatives.', 'review', 4, '2026-10-15', '2026-10-26'),
        ],
      },
    ],
    backlog: { id: 'backlog', name: 'Backlog', tasks: [] },
    counter: 1,
    team: [{ person: 'u1' }, { person: 'u2' }, { person: 'u6' }],
    people: [
      { id: 'u1', name: 'Nikhil', cap: 1, rate: 60 },
      { id: 'u2', name: 'Shubham', cap: 1, rate: 40 },
      { id: 'u3', name: 'Nora', cap: 0, rate: 0 },
      { id: 'u4', name: 'Ritik sir', cap: 0, rate: 0 },
      { id: 'u5', name: 'Tester', cap: 0.5, rate: 50 },
      { id: 'u6', name: 'Ravindra', cap: 0.5, rate: 50 },
    ],
    raci: [{ id: '', name: 'Testing', roles: { u1: 'A', u2: 'C', u3: 'I', u4: 'I', u5: 'R' } }],
    ledger: [{ id: 'c1', date: '2026-09-07', element: 'Team labour', desc: 'Week 1 actual cost', amount: 900 }],
    raid: [
      rk('R-01', 4, 4, 0.7, 8000, 5, 'Mitigating', '2026-10-23'),
      rk('R-02', 2, 4, 0.3, 12000, 10, 'Open', '2026-10-30'),
      rk('R-03', 3, 4, 0.5, 10000, 6, 'Open', '2026-11-06'),
      rk('R-04', 4, 3, 0.7, 6000, 4, 'Mitigating', '2026-10-26'),
      rk('R-05', 2, 2, 0.3, 2000, 2, 'Open', '2026-11-02'),
      rk('R-06', 3, 3, 0.5, 3000, 5, 'Open', '2026-11-13'),
      rk('R-07', 2, 5, 0.3, 15000, 8, 'Open', '2026-11-06'),
      ot('A-01', 'Assumption', N, N, 'Open', '2026-10-09'),
      ot('A-02', 'Assumption', N, N, 'Closed', '2026-09-30'),
      ot('A-03', 'Assumption', N, N, 'Open', '2026-09-18'),
      ot('I-01', 'Issue', 4500, 3, 'Open', '2026-10-16'),
      ot('I-02', 'Issue', 1500, 2, 'Closed', '2026-10-09'),
      ot('I-03', 'Issue', 2000, 2, 'Closed', '2026-10-02'),
      ot('D-01', 'Dependency', N, N, 'Open', '2026-10-14'),
      ot('D-02', 'Dependency', N, N, 'Closed', '2026-10-09'),
      ot('D-03', 'Dependency', N, N, 'Open', '2026-11-10'),
    ],
  };
}

export function seedWorkspace() {
  const p = seedProject();
  return { v: 3, projects: [p], nav: { projectId: p.id, view: 'sprint', sprintId: 's2', tab: 'dash', sprintView: 'list' } };
}
