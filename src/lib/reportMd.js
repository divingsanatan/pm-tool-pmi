import { fdate } from './dates';
import { hrsf, money, pc } from './format';

/* Writes the report model (lib/report.js) as Markdown: the same sections and figures as the PDF, with tables in place of charts. */

const cell = (v) => String(v == null || v === '' ? '–' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (head, rows, right = []) => {
  if (!rows.length) return '';
  const sep = head.map((_, i) => (right.includes(i) ? '---:' : '---'));
  return ['| ' + head.map(cell).join(' | ') + ' |', '| ' + sep.join(' | ') + ' |'].concat(rows.map((r) => '| ' + r.map(cell).join(' | ') + ' |')).join('\n') + '\n';
};
const due = (d) => (d ? fdate(d) : '–');
const mark = (tone) => ({ good: '🟢', warn: '🟡', bad: '🔴' }[tone] || '⚪');

export function reportMarkdown(R) {
  const out = [];
  const add = (...l) => out.push(...l);
  const has = (id) => R.sections.includes(id);
  const { schedule: sc, cost, work, pending: pe, risks, changes, team, fig } = R;
  let n = 1;

  add('# ' + R.title, '');
  add('**' + R.scopeLabel + '** · Period: ' + R.period + ' · Figures as of ' + R.asOfLabel + (R.preparedBy ? ' · Prepared by ' + R.preparedBy : '') + ' · Generated ' + new Date(R.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), '');
  add('| Overall | Schedule | Cost |', '| --- | --- | --- |',
    '| ' + mark(R.status.overall.cls) + ' **' + R.status.overall.label + '** | ' + mark(R.status.schedule.cls) + ' ' + R.status.schedule.label + (R.status.schedule.spi != null ? ' (SPI ' + R.status.schedule.spi.toFixed(2) + ')' : '') + ' | ' + mark(R.status.cost.cls) + ' ' + R.status.cost.label + (R.status.cost.cpi != null ? ' (CPI ' + R.status.cost.cpi.toFixed(2) + ')' : '') + ' |', '');

  add('## Summary', '');
  if (R.notes) add(...R.notes.split('\n').map((l) => '> ' + l), '');
  R.keyPoints.forEach((p) => add('- ' + mark(p.tone) + ' **' + p.area + ':** ' + p.text));
  add('');
  if (R.decisions.length) {
    add('### Decisions and attention needed', '');
    R.decisions.forEach((d) => add('- **' + d.tag + '** ' + d.text));
    add('');
  }

  const kp = (list) => { if (list && list.length) add(table(['Measure', 'Value', 'Note'], list.map((k) => [k.l, '**' + k.v + '**', k.s]))); };

  if (has('schedule')) {
    add('## ' + n++ + '. Schedule', '');
    if (!fig.ok) add('_The plan is not set up for this scope, so schedule performance cannot be measured._', '');
    kp(sc.kpis);
    if (sc.chartNote) add('_' + sc.chartNote + ' (The chart is in the PDF.)_', '');
    add('### Forecast finish', '');
    kp(sc.forecast);
    add('### ' + (R.scope === 'sprint' ? 'Sprint status' : 'Sprints'), '');
    add(table(['Sprint', 'Dates', 'Status', 'Planned', 'Earned', 'SPI', 'Hours done'], sc.sprints.map((s) => [s.name + (s.inPlan ? '' : ' (outside baseline)'), due(s.start) + ' – ' + due(s.end), s.status, pc(s.plannedPct, 0), pc(s.earnedPct, 0), s.spi == null ? '–' : s.spi.toFixed(2), hrsf(s.doneH) + ' / ' + hrsf(s.plannedH)]), [3, 4, 5, 6]));
    if (sc.milestones.length) add('### Milestones', '', table(['Milestone', 'Sprint', 'Date', 'State'], sc.milestones.map((m) => [m.code + ' ' + m.name, m.sprint, fdate(m.date), m.state])));
    if (sc.critical && sc.critical.n > 0) add('Critical path: ' + sc.critical.n + ' work item' + (sc.critical.n === 1 ? '' : 's') + (sc.critical.end ? ', ending ' + fdate(sc.critical.end) : '') + '.', '');
  }

  if (has('cost')) {
    add('## ' + n++ + '. Cost', '');
    if (!fig.ok) add('_The budget is not set up for this scope, so cost performance cannot be measured._', '');
    kp(cost.kpis);
    if (fig.period) add('**In this period** (' + fdate(R.from) + ' – ' + R.asOfLabel + '): planned value moved by ' + money(fig.period.dPV) + ', earned value by ' + money(fig.period.dEV) + ', and ' + money(fig.period.dAC) + ' of cost was recorded.', '');
    if (fig.ok) add(table(['Budget, planned, earned, actual', 'Amount'], [[(R.scope === 'sprint' ? 'Sprint budget' : 'Budget (BAC)'), money(fig.bac)], ['Planned value (PV)', money(fig.pv)], ['Earned value (EV)', money(fig.ev)], ['Actual cost (AC)', money(fig.ac)], ['Forecast at completion (EAC)', fig.eac == null ? '–' : money(fig.eac)]], [1]));
    if (cost.eac.length) add('### Forecast cost at completion', '', table(['If…', 'Formula', 'Forecast', 'Against budget'], cost.eac.map((e) => [e.name, e.f, money(e.v), e.vac >= 0 ? money(e.vac) + ' under' : money(-e.vac) + ' over']), [2, 3]));
    if (cost.reserve) {
      const r = cost.reserve;
      add('### Reserves and pending changes', '', table(['Item', 'Amount', 'Note'], [['Contingency reserve', money(r.contingency), 'inside the budget, for known risks'], ['Management reserve', money(r.management), 'held outside the budget'], ['Total with reserves', money(r.total), r.locked ? 'baseline ' + r.version : 'no baseline yet'], ['Pending change requests', String(r.pendingN), r.pendingN ? '+' + money(r.pendingCost) + ' / ' + r.pendingDays + ' days' : 'none waiting']], [1]));
    }
    add('### Cost by element', '');
    if (cost.elements.length) add(table(['Cost element', 'Planned', 'Actual'], cost.elements.map((e) => [e.name, e.planned == null ? '–' : money(e.planned), money(e.actual)]), [1, 2]));
    else add('_No cost has been recorded in this scope._', '');
    if (cost.elementsNote) add('_' + cost.elementsNote + '_', '');
    if (cost.spends && cost.spends.length) add('### Largest cost entries', '', table(['Date', 'Element', 'Description', 'Amount'], cost.spends.map((e) => [due(e.date), e.element, e.desc, money(e.amount)]), [3]));
  }

  if (has('work')) {
    add('## ' + n++ + '. Work progress', '');
    kp(work.kpis);
    if (work.byStatus.length) add('**By status:** ' + work.byStatus.map((s) => s.label + ' ' + s.n).join(' · '), '');
    if (work.sprints.length) add(table(['Sprint', 'Items done', 'Hours done', 'Hours planned'], work.sprints.map((s) => [s.name, s.done + ' of ' + s.n, hrsf(s.hDone), hrsf(s.hPlanned)]), [1, 2, 3]));
    if (work.backlog) add('Backlog (not yet planned): ' + work.backlog.n + ' work item' + (work.backlog.n === 1 ? '' : 's') + ', ' + hrsf(work.backlog.hours) + ' h.', '');
  }

  if (has('pending')) {
    add('## ' + n++ + '. Pending tasks', '');
    kp(pe.kpis);
    const rows = (l) => l.map((r) => [r.code + ' ' + r.name, r.sprint, r.who, r.status, due(r.due), r.days == null ? '–' : r.days, r.hours ? hrsf(r.hours) : '–']);
    add('### Overdue', '');
    add(pe.late.length ? table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'Days late', 'Hours'], rows(pe.late), [5, 6]) + (pe.moreLate ? '\n_…and ' + pe.moreLate + ' more overdue items._\n' : '') : '_Nothing is overdue._\n');
    add('### Due in the next 7 days', '');
    add(pe.soon.length ? table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'In days', 'Hours'], rows(pe.soon), [5, 6]) + (pe.moreSoon ? '\n_…and ' + pe.moreSoon + ' more._\n' : '') : '_Nothing falls due in the next 7 days._\n');
    if (pe.blocked.length) add('### Blocked by a dependency', '', table(['Work item', 'Sprint'], pe.blocked.map((b) => [b.code + ' ' + b.name, b.sprint])));
    if (pe.noDue.length) add('### Open items with no due date', '', table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'In days', 'Hours'], rows(pe.noDue), [5, 6]) + (pe.moreNoDue ? '\n_…and ' + pe.moreNoDue + ' more._\n' : ''));
  }

  if (has('risks')) {
    add('## ' + n++ + '. Risks and issues', '');
    if (risks.scopeNote) add('_' + risks.scopeNote + '_', '');
    kp(risks.kpis);
    add('### Log summary', '', table(['Type', 'Open', 'Overdue', 'Closed'], risks.mix.map((m) => [m.type, m.open, m.overdue, m.closed]), [1, 2, 3]));
    if (risks.addedInPeriod != null) add(risks.addedInPeriod + ' RAID item' + (risks.addedInPeriod === 1 ? '' : 's') + ' added in this period (Activity log, kept since ' + fdate(risks.logSince) + ').', '');
    add('### Top risks', '');
    add(risks.top.length ? table(['Item', 'Description', 'Owner', 'Rating', 'Expected cost', 'Response'], risks.top.map((r) => [r.id, r.desc, r.owner, r.rating + (r.score ? ' (' + r.score + ')' : ''), r.exposure == null ? '–' : money(r.exposure), r.resp || 'none recorded']), [4]) : '_There are no open risks._\n');
    const oi = (r) => [r.id, r.desc, r.owner, r.status + (r.overdue ? ' (overdue)' : ''), due(r.due)];
    if (risks.issues.length) add('### Open issues', '', table(['Item', 'Description', 'Owner', 'Status', 'Due'], risks.issues.map(oi)));
    if (risks.overdue.length) add('### Overdue RAID items', '', table(['Item', 'Description', 'Owner', 'Status', 'Due'], risks.overdue.map(oi)));
  }

  if (has('changes')) {
    add('## ' + n++ + '. Change requests', '');
    add(changes.total + ' change request' + (changes.total === 1 ? '' : 's') + ' in total' + (changes.baseline ? '; current baseline ' + changes.baseline : '; no baseline recorded yet') + '.', '');
    if (changes.mix.length) add('**By status:** ' + changes.mix.map((m) => m.status + ' ' + m.n).join(' · '), '');
    const wait = changes.awaiting.concat(changes.approved);
    add(wait.length ? table(['Request', 'Status', 'Cost', 'Days'], wait.map((c) => [c.code + ' ' + c.title, c.status, money(c.cost), c.days]), [2, 3]) : '_No change request is waiting for a decision or implementation._\n');
    if (changes.implementedInPeriod.length) add('### Implemented in this period', '', table(['Request', 'Cost', 'Days'], changes.implementedInPeriod.map((c) => [c.code + ' ' + c.title, money(c.cost), c.days]), [1, 2]));
  }

  if (has('team')) {
    add('## ' + n++ + '. Team workload', '', '_Work items in this report, by assignee. The hours of a shared item are split equally._', '');
    add(team.rows.length ? table(['Person', 'Open items', 'Overdue', 'Open hours', 'Done items', 'Done hours'], team.rows.map((p) => [p.name, p.open, p.late, hrsf(p.openH), p.done, hrsf(p.doneH)]), [1, 2, 3, 4, 5]) : '_No work items in this scope._\n');
  }

  if (has('appendix')) {
    add('## ' + n++ + '. How the figures are calculated', '');
    if (R.calc.length) add(table(['Figure', 'How it is worked out', 'Value'], R.calc.map((c) => [c.label, c.how, c.value]), [2]));
    R.notes_scope.forEach((t) => add('- ' + t));
    add('');
  }
  add('---', '_' + R.project + ' · ' + R.scopeLabel + ' · figures as of ' + R.asOfLabel + '_', '');
  return out.join('\n');
}
