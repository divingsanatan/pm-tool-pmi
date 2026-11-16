import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { svg2pdf } from 'svg2pdf.js';
import { fdate } from './dates';
import { hrsf, money, pc } from './format';

/* Draws the report model (lib/report.js) as an A4 PDF. Loaded only when someone presses Download, so it does not slow the app down. */

const PW = 210, PH = 297, M = 14, CW = PW - 2 * M, TOP = 17, BOT = 17;
const INK = [26, 36, 32], MUTED = [91, 106, 101], LINE = [216, 223, 220], BLUE = [27, 94, 140];
const TONE = { good: [30, 122, 76], warn: [143, 90, 0], bad: [169, 46, 28], neutral: [91, 106, 101] };
const TONE_BG = { good: [221, 240, 229], warn: [251, 235, 200], bad: [248, 221, 215], neutral: [246, 248, 247] };
const DOT = { good: [30, 122, 76], warn: [201, 137, 43], bad: [169, 46, 28], neutral: [141, 157, 151] };

// The built-in PDF fonts know Western European letters only. Anything else is swapped for a close plain character.
const CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2212\u2012]/g, '-').replace(/[\u2009\u202f\u00a0]/g, ' ').replace(/\u2192/g, '->').replace(/\u2265/g, '>=').replace(/\u2264/g, '<=')
    .replace(/[^\n\x20-\x7e\u00a1-\u00ff]/g, (c) => (CP1252.includes(c) ? c : '?'));
}

export async function reportPdf(R) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: clean(R.title), subject: clean(R.scopeLabel + ' · ' + R.period), creator: 'Sprint Control' });
  let y = TOP;
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const ensure = (h) => { if (y + h > PH - BOT) { doc.addPage(); y = TOP; } };
  const lines = (s, w, size = 9, style = 'normal') => { font(size, style); return doc.splitTextToSize(clean(s), w); };
  const LH = (size) => size * 0.42; // line height in mm

  function para(s, { size = 9, style = 'normal', color = INK, x = M, w = CW, gap = 2 } = {}) {
    const ls = lines(s, w, size, style);
    ensure(ls.length * LH(size) + gap);
    font(size, style, color);
    ls.forEach((l, i) => doc.text(l, x, y + LH(size) * (i + 0.8)));
    y += ls.length * LH(size) + gap;
  }
  function h2(title, n, need = 60) {
    ensure(need); // the heading stays with the figures that follow it
    y += 3;
    if (n != null) {
      doc.setFillColor(...BLUE); doc.circle(M + 3, y + 3.2, 3, 'F');
      font(8.5, 'bold', [255, 255, 255]); doc.text(String(n), M + 3, y + 4.3, { align: 'center' });
    }
    font(14, 'bold'); doc.text(clean(title), M + (n != null ? 9 : 0), y + 4.6);
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.6); doc.line(M, y + 7.5, M + CW, y + 7.5);
    y += 11.5;
  }
  function h3(title) { ensure(16); y += 2; font(10.5, 'bold'); doc.text(clean(title), M, y + 3.5); y += 6.5; }

  // a row of figure tiles
  function kpis(list, perRowMax = 3) {
    if (!list || !list.length) return;
    const per = list.length <= 4 ? list.length : perRowMax, gap = 3, w = (CW - gap * (per - 1)) / per, h = 19;
    for (let i = 0; i < list.length; i += per) {
      ensure(h + 3);
      list.slice(i, i + per).forEach((k, j) => {
        const x = M + j * (w + gap);
        doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
        font(6.8, 'bold', MUTED); doc.text(clean(k.l).toUpperCase(), x + 2.5, y + 4.4, { maxWidth: w - 5 });
        font(13, 'bold', k.cls && TONE[k.cls] ? TONE[k.cls] : INK); doc.text(clean(k.v), x + 2.5, y + 10.4, { maxWidth: w - 5 });
        font(6.8, 'normal', MUTED); doc.text(doc.splitTextToSize(clean(k.s), w - 5).slice(0, 2), x + 2.5, y + 14.2);
      });
      y += h + 3;
    }
  }

  // a chart drawn as SVG, placed at the given width
  async function chart(svg, maxW = CW) {
    if (!svg) return;
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!m) return;
    const vw = +m[1], vh = +m[2], w = Math.min(maxW, CW), h = (w * vh) / vw;
    ensure(h + 3);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px';
    host.innerHTML = svg.replace(/ style="[^"]*"/, '');
    document.body.appendChild(host);
    try {
      await svg2pdf(host.firstElementChild, doc, { x: M + (maxW >= CW ? (CW - w) / 2 : 0), y, width: w, height: h });
    } finally { host.remove(); }
    y += h + 3;
  }

  // a table that breaks across pages and repeats its heading
  function table(head, rows, { right = [], widths = {}, startX = M, width = CW, tone = {} } = {}) {
    if (!rows.length) return;
    ensure(22);
    const columnStyles = {};
    head.forEach((_, i) => { columnStyles[i] = {}; if (right.includes(i)) columnStyles[i].halign = 'right'; if (widths[i]) columnStyles[i].cellWidth = widths[i]; });
    autoTable(doc, {
      startY: y, head: [head.map((h) => clean(h).toUpperCase())], body: rows.map((r) => r.map((c, i) => {
        const t = tone[i] && c && typeof c === 'object' ? c.tone : null;
        const txt = clean(c && typeof c === 'object' ? c.t : c);
        return t ? { content: txt, styles: { textColor: TONE[t] || INK, fontStyle: 'bold' } } : txt;
      })),
      margin: { left: startX, right: PW - startX - width, top: TOP, bottom: BOT }, theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 }, textColor: INK, overflow: 'linebreak', valign: 'top' },
      headStyles: { fontStyle: 'bold', fontSize: 6.8, textColor: MUTED, lineWidth: { bottom: 0.3 }, lineColor: INK },
      bodyStyles: { lineWidth: { bottom: 0.12 }, lineColor: LINE },
      alternateRowStyles: { fillColor: [248, 250, 249] }, columnStyles,
      didParseCell: (d) => { if (d.section === 'head' && right.includes(d.column.index)) d.cell.styles.halign = 'right'; }, // a heading sits over its figures
    });
    y = doc.lastAutoTable.finalY + 4;
  }
  const note = (s) => para(s, { size: 8, color: MUTED, gap: 2.5 });
  const T = (t, tone) => ({ t, tone }); // a cell with a colour
  const due = (d) => (d ? fdate(d) : '-');

  /* ---------- cover ---------- */
  font(8, 'bold', BLUE); doc.text(clean(R.scopeLabel).toUpperCase(), M, y + 2); y += 5;
  const tl = lines(R.title, CW, 21, 'bold');
  font(21, 'bold'); tl.forEach((l, i) => doc.text(l, M, y + 7 + i * 8.6)); y += tl.length * 8.6 + 4;
  para([['Period', R.period], ['Figures as of', R.asOfLabel], R.preparedBy ? ['Prepared by', R.preparedBy] : null, ['Generated', new Date(R.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })]].filter(Boolean).map((p) => p[0] + ': ' + p[1]).join('     '), { size: 8.5, color: MUTED, gap: 4 });
  {
    const items = [['Overall', R.status.overall, ''], ['Schedule', R.status.schedule, R.status.schedule.spi != null ? 'SPI ' + R.status.schedule.spi.toFixed(2) : ''], ['Cost', R.status.cost, R.status.cost.cpi != null ? 'CPI ' + R.status.cost.cpi.toFixed(2) : '']];
    const gap = 3, w = (CW - 2 * gap) / 3, h = 20;
    items.forEach(([l, st, sub], i) => {
      const x = M + i * (w + gap);
      doc.setFillColor(...(TONE_BG[st.cls] || TONE_BG.neutral)); doc.roundedRect(x, y, w, h, 2, 2, 'F');
      font(7, 'bold', MUTED); doc.text(l.toUpperCase(), x + 3, y + 5);
      font(12.5, 'bold', TONE[st.cls] || INK); doc.text(clean(st.label), x + 3, y + 12, { maxWidth: w - 6 });
      font(7.5, 'normal', MUTED); doc.text(clean(sub), x + 3, y + 17);
    });
    y += h + 4;
  }

  /* ---------- summary ---------- */
  h2('Summary');
  if (R.notes) {
    const ls = lines(R.notes, CW - 10, 9);
    const h = ls.length * LH(9) + 11;
    ensure(h + 3);
    doc.setFillColor(227, 238, 245); doc.rect(M, y, CW, h, 'F'); doc.setFillColor(...BLUE); doc.rect(M, y, 1.2, h, 'F');
    font(8.5, 'bold', BLUE); doc.text('Comment', M + 4, y + 5);
    font(9); ls.forEach((l, i) => doc.text(l, M + 4, y + 9.5 + i * LH(9)));
    y += h + 4;
  }
  R.keyPoints.forEach((p) => {
    const ls = lines(p.text, CW - 38, 9);
    const h = Math.max(5, ls.length * LH(9)) + 2.2;
    ensure(h);
    doc.setFillColor(...(DOT[p.tone] || DOT.neutral)); doc.circle(M + 1.6, y + 2.2, 1.3, 'F');
    font(8.5, 'bold'); doc.text(clean(p.area), M + 5, y + 3);
    font(9); ls.forEach((l, i) => doc.text(l, M + 36, y + 3 + i * LH(9)));
    y += h;
  });
  if (R.decisions.length) {
    h3('Decisions and attention needed');
    R.decisions.forEach((d) => {
      const ls = lines(d.tag + '  ' + d.text, CW - 6, 9);
      ensure(ls.length * LH(9) + 1.5);
      font(9); doc.text('\u2022', M + 1, y + 3);
      ls.forEach((l, i) => doc.text(l, M + 5, y + 3 + i * LH(9)));
      y += ls.length * LH(9) + 1.5;
    });
  }

  let n = 1;
  const has = (id) => R.sections.includes(id);
  const { schedule: sc, cost, work, pending: pe, risks, changes, team, fig } = R;

  /* ---------- schedule ---------- */
  if (has('schedule')) {
    h2('Schedule', n++, 115);
    if (!fig.ok) note('The plan is not set up for this scope, so schedule performance cannot be measured.');
    kpis(sc.kpis, 4);
    await chart(sc.chart);
    if (sc.chartNote) note(sc.chartNote);
    h3('Forecast finish');
    kpis(sc.forecast, 4);
    h3(R.scope === 'sprint' ? 'Sprint status' : 'Sprints');
    table(['Sprint', 'Dates', 'Status', 'Planned', 'Earned', 'SPI', 'Hours done'], sc.sprints.map((s) => [s.name + (s.inPlan ? '' : ' (outside baseline)'), due(s.start) + ' - ' + due(s.end), T(s.status, s.cls), pc(s.plannedPct, 0), pc(s.earnedPct, 0), s.spi == null ? '-' : s.spi.toFixed(2), hrsf(s.doneH) + ' / ' + hrsf(s.plannedH)]), { right: [3, 4, 5, 6], tone: { 2: 1 } });
    if (sc.milestones.length) { h3('Milestones'); table(['Milestone', 'Sprint', 'Date', 'State'], sc.milestones.map((m) => [m.code + ' ' + m.name, m.sprint, fdate(m.date), T(m.state, m.cls)]), { tone: { 3: 1 } }); }
    if (sc.critical && sc.critical.n > 0) note('Critical path: ' + sc.critical.n + ' work item' + (sc.critical.n === 1 ? '' : 's') + (sc.critical.end ? ', ending ' + fdate(sc.critical.end) : '') + '.');
  }

  /* ---------- cost ---------- */
  if (has('cost')) {
    h2('Cost', n++, 120);
    if (!fig.ok) note('The budget is not set up for this scope, so cost performance cannot be measured.');
    kpis(cost.kpis, 3);
    if (fig.period) note('In this period (' + fdate(R.from) + ' - ' + R.asOfLabel + '): planned value moved by ' + money(fig.period.dPV) + ', earned value by ' + money(fig.period.dEV) + ', and ' + money(fig.period.dAC) + ' of cost was recorded.');
    await chart(cost.compare);
    await chart(cost.curve);
    if (cost.curve) note('The blue line is the budget value of the work done; the amber line is the money spent. Amber above blue means the work is costing more than planned.');
    if (cost.eac.length) { h3('Forecast cost at completion'); table(['If...', 'Formula', 'Forecast', 'Against budget'], cost.eac.map((e) => [e.name, e.f, money(e.v), T(e.vac >= 0 ? money(e.vac) + ' under' : money(-e.vac) + ' over', e.vac >= 0 ? 'good' : 'bad')]), { right: [2, 3], tone: { 3: 1 } }); }
    if (cost.reserve) {
      const r = cost.reserve;
      h3('Reserves and pending changes');
      kpis([{ l: 'Contingency reserve', v: money(r.contingency), s: 'inside the budget, for known risks' }, { l: 'Management reserve', v: money(r.management), s: 'held outside the budget' }, { l: 'Total with reserves', v: money(r.total), s: r.locked ? 'baseline ' + r.version : 'no baseline yet' }, { l: 'Pending change requests', v: String(r.pendingN), s: r.pendingN ? '+' + money(r.pendingCost) + ' / ' + r.pendingDays + ' days' : 'none waiting', cls: r.pendingN ? 'warn' : '' }], 4);
    }
    h3('Cost by element');
    await chart(cost.elementsChart);
    if (cost.elements.length) table(['Cost element', 'Planned', 'Actual'], cost.elements.map((e) => [e.name, e.planned == null ? '-' : money(e.planned), money(e.actual)]), { right: [1, 2] });
    else note('No cost has been recorded in this scope.');
    if (cost.elementsNote) note(cost.elementsNote);
    if (cost.spends && cost.spends.length) { h3('Largest cost entries'); table(['Date', 'Element', 'Description', 'Amount'], cost.spends.map((e) => [due(e.date), e.element, e.desc, money(e.amount)]), { right: [3] }); }
  }

  /* ---------- work progress ---------- */
  if (has('work')) {
    h2('Work progress', n++, 90);
    kpis(work.kpis, 4);
    await chart(work.chart);
    if (work.byStatus.length) note(work.byStatus.map((s) => s.label + ' ' + s.n).join('   |   '));
    await chart(work.velocityChart);
    if (work.sprints.length) table(['Sprint', 'Items done', 'Hours done', 'Hours planned'], work.sprints.map((s) => [s.name, s.done + ' of ' + s.n, hrsf(s.hDone), hrsf(s.hPlanned)]), { right: [1, 2, 3] });
    if (work.backlog) note('Backlog (not yet planned): ' + work.backlog.n + ' work item' + (work.backlog.n === 1 ? '' : 's') + ', ' + hrsf(work.backlog.hours) + ' h.');
  }

  /* ---------- pending tasks ---------- */
  if (has('pending')) {
    h2('Pending tasks', n++);
    kpis(pe.kpis, 4);
    const tw = { 1: 21, 2: 25, 3: 19, 4: 14, 5: 14, 6: 14 };
    const rowsOf = (l) => l.map((r) => [r.code + ' ' + r.name, r.sprint, r.who, r.status, due(r.due), r.days == null ? '-' : String(r.days), r.hours ? hrsf(r.hours) : '-']);
    h3('Overdue');
    if (pe.late.length) { table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'Days late', 'Hours'], rowsOf(pe.late), { right: [5, 6], widths: tw }); if (pe.moreLate) note('...and ' + pe.moreLate + ' more overdue items.'); } else note('Nothing is overdue.');
    h3('Due in the next 7 days');
    if (pe.soon.length) { table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'In days', 'Hours'], rowsOf(pe.soon), { right: [5, 6], widths: tw }); if (pe.moreSoon) note('...and ' + pe.moreSoon + ' more.'); } else note('Nothing falls due in the next 7 days.');
    if (pe.blocked.length) { h3('Blocked by a dependency'); table(['Work item', 'Sprint'], pe.blocked.map((b) => [b.code + ' ' + b.name, b.sprint]), { widths: { 1: 40 } }); }
    if (pe.noDue.length) { h3('Open items with no due date'); table(['Work item', 'Sprint', 'Assigned to', 'Status', 'Due', 'In days', 'Hours'], rowsOf(pe.noDue), { right: [5, 6], widths: tw }); if (pe.moreNoDue) note('...and ' + pe.moreNoDue + ' more.'); }
  }

  /* ---------- risks and issues ---------- */
  if (has('risks')) {
    h2('Risks and issues', n++, 112);
    if (risks.scopeNote) note(risks.scopeNote);
    kpis(risks.kpis, 4);
    {
      ensure(80);
      const top = y;
      h3('Open risks by probability and impact');
      await chart(risks.grid, 78);
      const gridBottom = y;
      y = top + 2;
      doc.setPage(doc.getNumberOfPages());
      font(10.5, 'bold'); doc.text('Log summary', M + 86, y + 3.5); y += 6.5;
      table(['Type', 'Open', 'Overdue', 'Closed'], risks.mix.map((m) => [m.type, m.open, m.overdue, m.closed]), { right: [1, 2, 3], startX: M + 86, width: CW - 86 });
      if (risks.addedInPeriod != null) para(risks.addedInPeriod + ' RAID item' + (risks.addedInPeriod === 1 ? '' : 's') + ' added in this period (Activity log, kept since ' + fdate(risks.logSince) + ').', { size: 8, color: MUTED, x: M + 86, w: CW - 86 });
      y = Math.max(y, gridBottom) + 1;
    }
    const rr = (r) => [r.id, r.desc, r.owner, T(r.rating + (r.score ? ' (' + r.score + ')' : ''), r.rating === 'High' ? 'bad' : r.rating === 'Medium' ? 'warn' : 'neutral'), r.exposure == null ? '-' : money(r.exposure), r.resp || 'none recorded'];
    h3('Top risks');
    if (risks.top.length) table(['Item', 'Description', 'Owner', 'Rating', 'Expected cost', 'Response'], risks.top.map(rr), { right: [4], widths: { 0: 12, 2: 22, 3: 20, 4: 20 }, tone: { 3: 1 } }); else note('There are no open risks.');
    const oi = (r) => [r.id, r.desc, r.owner, r.status + (r.overdue ? ' (overdue)' : ''), due(r.due)];
    if (risks.issues.length) { h3('Open issues'); table(['Item', 'Description', 'Owner', 'Status', 'Due'], risks.issues.map(oi), { widths: { 0: 12, 2: 24, 3: 30, 4: 16 } }); }
    if (risks.overdue.length) { h3('Overdue RAID items'); table(['Item', 'Description', 'Owner', 'Status', 'Due'], risks.overdue.map(oi), { widths: { 0: 12, 2: 24, 3: 30, 4: 16 } }); }
  }

  /* ---------- change requests ---------- */
  if (has('changes')) {
    h2('Change requests', n++);
    para(changes.total + ' change request' + (changes.total === 1 ? '' : 's') + ' in total' + (changes.baseline ? '; current baseline ' + changes.baseline : '; no baseline recorded yet') + '.', { size: 9 });
    if (changes.mix.length) note(changes.mix.map((m) => m.status + ' ' + m.n).join('   |   '));
    const wait = changes.awaiting.concat(changes.approved);
    if (wait.length) table(['Request', 'Status', 'Cost', 'Days'], wait.map((c) => [c.code + ' ' + c.title, T(c.status, c.status === 'Approved' ? 'good' : 'warn'), money(c.cost), c.days]), { right: [2, 3], widths: { 1: 28, 2: 26, 3: 14 }, tone: { 1: 1 } }); else note('No change request is waiting for a decision or implementation.');
    if (changes.implementedInPeriod.length) { h3('Implemented in this period'); table(['Request', 'Cost', 'Days'], changes.implementedInPeriod.map((c) => [c.code + ' ' + c.title, money(c.cost), c.days]), { right: [1, 2], widths: { 1: 26, 2: 14 } }); }
  }

  /* ---------- team workload ---------- */
  if (has('team')) {
    h2('Team workload', n++);
    note('Work items in this report, by assignee. The hours of a shared item are split equally.');
    if (team.rows.length) table(['Person', 'Open items', 'Overdue', 'Open hours', 'Done items', 'Done hours'], team.rows.map((p) => [p.name, p.open, p.late ? T(String(p.late), 'bad') : '0', hrsf(p.openH), p.done, hrsf(p.doneH)]), { right: [1, 2, 3, 4, 5], tone: { 2: 1 } }); else note('No work items in this scope.');
  }

  /* ---------- how the figures are calculated ---------- */
  if (has('appendix')) {
    h2('How the figures are calculated', n++);
    if (R.calc.length) table(['Figure', 'How it is worked out', 'Value'], R.calc.map((c) => [c.label, c.how, c.value]), { right: [2], widths: { 0: 42, 2: 28 } });
    R.notes_scope.forEach((t) => note('- ' + t));
  }

  /* ---------- page headers and footers ---------- */
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
    if (p > 1) { font(7.5, 'normal', MUTED); doc.text(clean(R.project), M, 10); doc.text(clean(R.scopeLabel), PW - M, 10, { align: 'right' }); doc.line(M, 12, PW - M, 12); }
    doc.line(M, PH - 12, PW - M, PH - 12);
    font(7.5, 'normal', MUTED); doc.text('Figures as of ' + clean(R.asOfLabel), M, PH - 8); doc.text('Page ' + p + ' of ' + total, PW - M, PH - 8, { align: 'right' });
  }
  return doc;
}

export const reportFilename = (R, ext) => {
  const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'report';
  const part = R.scope === 'sprint' ? R.scopeLabel.replace(/^Sprint:\s*/, '') : R.scope === 'custom' ? R.from + '-to-' + R.to : 'project';
  return slug(R.project) + '-' + slug(part) + '-report-' + R.asOf + '.' + ext;
};
