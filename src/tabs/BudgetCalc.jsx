import { Fragment, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { budgetModel, sumRange } from '../lib/calc';
import { WEEKDAYS, daysCsv } from '../lib/budget';
import { fdate, fsh, pd, today } from '../lib/dates';
import { hrsf, money, pc } from '../lib/format';
import '../budget.css';

const r2 = (n) => Math.round(n * 100) / 100;
const MAX_STRIP = 150;

function lineRule(L, M) {
  const a = money(L.amount);
  const w = M.std.wpw, sw = M.std.sprintWeeks;
  if (L.per === 'project') return L.phased ? `${a} once, on ${fdate(L.fromS)}` : `${a} once (${L.note.charAt(0).toLowerCase() + L.note.slice(1)})`;
  const win = L.fromS || L.toS ? ` · only ${L.fromS ? fdate(L.fromS) : 'from the start'} to ${L.toS ? fdate(L.toS) : 'the end'}` : '';
  const work = L.spread === 'work';
  if (L.per === 'day') return `${a} × ${L.days} working day${L.days === 1 ? '' : 's'}${win}`;
  if (L.per === 'week') return (work ? `${a} ÷ ${w} working days × ${L.days} working day${L.days === 1 ? '' : 's'}` : `${a} ÷ 7 × ${L.days} calendar day${L.days === 1 ? '' : 's'}`) + win;
  if (L.per === 'month') return (work ? `${a} ÷ working days in that month × ${L.days} working day${L.days === 1 ? '' : 's'}` : `${a} ÷ days in that month × ${L.days} calendar day${L.days === 1 ? '' : 's'}`) + win;
  if (L.per === 'sprint') return (work ? `${a} ÷ (${w} working days × ${sw} wk) × ${L.days} working day${L.days === 1 ? '' : 's'}` : `${a} ÷ (7 days × ${sw} wk) × ${L.days} calendar day${L.days === 1 ? '' : 's'}`) + win;
  return a;
}

export default function BudgetCalc() {
  const { S } = useStore();
  const M = budgetModel(S);
  const [open, setOpen] = useState({});
  const [all, setAll] = useState(false);
  const t = M.totals, sd = M.std;
  const now = pd(today());
  const toDate = sumRange(M, M.start, now);

  const download = () => {
    const blob = new Blob([daysCsv(M)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (S.meta.name || 'project').replace(/[^\w-]+/g, '_') + '-budget-by-day.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const strip = M.days.slice(0, MAX_STRIP);
  const sumWeeks = M.weeks.reduce((a, w) => a + w.total, 0);
  const diffWeeks = r2(sumWeeks + t.onceUnphased - t.bac);
  const diffParts = r2(t.labour + t.recurring + t.once - t.bac);
  const pattern = sd.work.map((d) => WEEKDAYS[d]).join(', ');
  const cum = [];
  M.weeks.reduce((a, w, i) => (cum[i] = a + w.total), 0);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>How this budget is calculated</h2>
          <p className="hint">Nothing here is typed in. Every figure is worked out from the calendar below, day by day, so you can check it by hand. The Dashboard, Weekly tracker and cost views all read this same calculation.</p>
        </div>
        <button className="btn" onClick={download}>Download day-by-day (CSV)</button>
      </div>

      {M.warnings.map((w, i) => (<div key={i} className="banner warn" style={{ marginBottom: 8 }}><span>{w.text}</span></div>))}

      <div className="bstep"><span>1</span>The days that are counted</div>
      <p className="msg" style={{ margin: '0 0 4px' }}>
        <b>{fdate(M.days[0].date)}</b> to <b>{fdate(M.days[M.days.length - 1].date)}</b> ({M.endSource.text.toLowerCase()}): <b>{t.calDays}</b> calendar day{t.calDays === 1 ? '' : 's'}, of which <b>{t.workDays}</b> are working days.
        Team works {pattern}, {hrsf(sd.hpd)} h a day. Equivalent to <b>{r2(t.equivWeeks)}</b> work weeks ({t.workDays} ÷ {sd.wpw}), not a whole number of weeks.
      </p>
      <div className="bkey"><span><i className="on" />Working day</span><span><i className="off" />Weekend / not a working weekday</span><span><i className="hol" />Non-working date</span></div>
      <div className="bcal" role="img" aria-label="Calendar of counted days">
        {strip.map((d) => (
          <span key={d.i} className={'bday ' + (d.holiday ? 'hol' : d.working ? 'on' : 'off') + (d.ms === now ? ' today' : '')} title={`${fdate(d.date)} (${WEEKDAYS[d.dow]})${d.holiday ? ' · ' + d.holiday : d.working ? '' : ' · not a working day'} · ${money(d.total)}`}>
            {WEEKDAYS[d.dow].slice(0, 2)}<b>{new Date(d.ms).getUTCDate()}</b>
          </span>
        ))}
      </div>
      {M.days.length > MAX_STRIP && <p className="msg">Showing the first {MAX_STRIP} days. The week-by-week table below covers all {t.calDays}.</p>}

      <div className="bstep"><span>2</span>Team labour = rate × capacity × hours per day × working days</div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Stakeholder</th><th>Calculation</th><th className="r">Working days</th><th className="r">Hours</th><th className="r">Cost</th></tr></thead>
          <tbody>
            {M.people.map((p) => (
              <tr key={p.id}>
                <td data-l="Stakeholder"><span className="cell"><b>{p.name}</b></span></td>
                <td data-l="Calculation"><span className="cell bformula">{money(p.rate)}/h × {pc(p.cap, 0)} × {hrsf(sd.hpd)} h × {p.days} day{p.days === 1 ? '' : 's'}{p.fromS || p.toS ? ' · available ' + (p.fromS ? fdate(p.fromS) : 'from the start') + ' to ' + (p.toS ? fdate(p.toS) : 'the end') : ''}</span></td>
                <td data-l="Working days" className="r mono"><span className="cell">{p.days}</span></td>
                <td data-l="Hours" className="r mono"><span className="cell">{hrsf(p.hours)}</span></td>
                <td data-l="Cost" className="r mono"><span className="cell">{money(p.cost)}</span></td>
              </tr>
            ))}
            {!M.people.length && (<tr className="empty-row"><td colSpan="5"><span className="cell msg">Nobody is in the labour budget yet.</span></td></tr>)}
          </tbody>
          {M.people.length > 0 && (<tfoot><tr><td>Team labour</td><td></td><td></td><td className="r mono">{hrsf(t.hours)}</td><td className="r mono">{money(t.labour)}</td></tr></tfoot>)}
        </table>
      </div>

      <div className="bstep"><span>3</span>Line items, charged on the days they cover</div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Line item</th><th>Calculation</th><th className="r">Total</th></tr></thead>
          <tbody>
            {M.lines.map((L) => (
              <tr key={L.i}>
                <td data-l="Line item"><span className="cell"><b>{L.name}</b></span></td>
                <td data-l="Calculation"><span className="cell bformula">{lineRule(L, M)}</span></td>
                <td data-l="Total" className="r mono"><span className="cell">{money(L.total)}</span></td>
              </tr>
            ))}
            {!M.lines.length && (<tr className="empty-row"><td colSpan="3"><span className="cell msg">No line items.</span></td></tr>)}
          </tbody>
          {M.lines.length > 0 && (<tfoot><tr><td>Line items</td><td></td><td className="r mono">{money(t.recurring + t.once)}</td></tr></tfoot>)}
        </table>
      </div>

      <div className="bstep"><span>4</span>Week by week (open a week to see its days)</div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn" onClick={() => { const o = {}; if (!all) M.weeks.forEach((w) => (o[w.w] = true)); setOpen(o); setAll(!all); }}>{all ? 'Collapse all weeks' : 'Open all weeks'}</button>
      </div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead>
            <tr><th></th><th>Week</th><th>Days counted</th><th className="r">Working days</th><th className="r">Labour h</th><th className="r">Labour</th><th className="r">Line items</th><th className="r">One-time</th><th className="r">Week budget</th><th className="r">Cumulative</th></tr>
          </thead>
          <tbody>
            {M.weeks.map((w, i) => {
              const isOpen = !!open[w.w];
              const days = M.days.slice((w.w - 1) * 7, w.w * 7);
              const cur = now >= w.s && now <= w.e;
              return (
                <Fragment key={w.w}>
                  <tr className={cur ? 'cur' : ''}>
                    <td data-l=""><button className="x" onClick={() => setOpen({ ...open, [w.w]: !isOpen })} aria-expanded={isOpen} aria-label={(isOpen ? 'Hide' : 'Show') + ' days of week ' + w.w}>{isOpen ? '▾' : '▸'}</button></td>
                    <td data-l="Week" className="mono"><span className="cell"><b>{w.w}</b></span></td>
                    <td data-l="Days counted"><span className="cell" style={{ whiteSpace: 'nowrap' }}>{fsh(days[0].ms)} – {fsh(days[days.length - 1].ms)} {w.cal < 7 && <span className="pill neutral" style={{ marginLeft: 6 }}>{w.cal} of 7 days</span>}</span></td>
                    <td data-l="Working days" className="r mono"><span className="cell">{w.work}</span></td>
                    <td data-l="Labour h" className="r mono"><span className="cell">{hrsf(w.hours)}</span></td>
                    <td data-l="Labour" className="r mono"><span className="cell">{money(w.labour)}</span></td>
                    <td data-l="Line items" className="r mono"><span className="cell">{money(w.lines)}</span></td>
                    <td data-l="One-time" className="r mono"><span className="cell">{w.once ? money(w.once) : '–'}</span></td>
                    <td data-l="Week budget" className="r mono"><span className="cell"><b>{money(w.total)}</b></span></td>
                    <td data-l="Cumulative" className="r mono"><span className="cell">{money(cum[i])}</span></td>
                  </tr>
                  {isOpen && days.map((d) => (
                    <tr key={d.i} className={'bsub' + (d.working ? '' : ' off')}>
                      <td data-l=""></td>
                      <td data-l="Day" className="mono"><span className="cell">{WEEKDAYS[d.dow]}</span></td>
                      <td data-l="Date"><span className="cell">{fdate(d.date)}{d.holiday ? ' · ' + d.holiday : d.working ? '' : ' · not a working day'}</span></td>
                      <td data-l="Working" className="r mono"><span className="cell">{d.working ? '1' : '0'}</span></td>
                      <td data-l="Labour h" className="r mono"><span className="cell">{hrsf(d.hours)}</span></td>
                      <td data-l="Labour" className="r mono"><span className="cell">{money(d.labour)}</span></td>
                      <td data-l="Line items" className="r mono"><span className="cell">{money(d.lines)}</span></td>
                      <td data-l="One-time" className="r mono"><span className="cell">{d.once ? money(d.once) : '–'}</span></td>
                      <td data-l="Day total" className="r mono"><span className="cell">{money(d.total)}</span></td>
                      <td data-l=""></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td></td><td>Total</td><td></td><td className="r mono">{t.workDays}</td><td className="r mono">{hrsf(t.hours)}</td><td className="r mono">{money(t.labour)}</td><td className="r mono">{money(t.recurring)}</td><td className="r mono">{money(t.once - t.onceUnphased)}</td><td className="r mono">{money(sumWeeks)}</td><td></td></tr>
            {t.onceUnphased > 0 && (<tr><td></td><td colSpan="7">One-time items without a place in the calendar</td><td className="r mono">{money(t.onceUnphased)}</td><td></td></tr>)}
          </tfoot>
        </table>
      </div>

      <div className="bstep"><span>5</span>Cross-checks</div>
      <div className="bcheck">
        <div><span className={'m ' + (diffParts === 0 ? 'ok' : 'no')}>{diffParts === 0 ? '✓' : '!'}</span><span>Labour {money(t.labour)} + recurring items {money(t.recurring)} + one-time items {money(t.once)} = <b>{money(t.bac)}</b> project BAC.</span></div>
        <div><span className={'m ' + (diffWeeks === 0 ? 'ok' : 'no')}>{diffWeeks === 0 ? '✓' : '!'}</span><span>The {M.weeks.length} week budgets add up to {money(sumWeeks)}{t.onceUnphased > 0 ? ' + ' + money(t.onceUnphased) + ' of one-time items without a date' : ''} = {money(sumWeeks + t.onceUnphased)}. {diffWeeks === 0 ? 'Same as the BAC.' : 'This differs from the BAC by ' + money(Math.abs(diffWeeks)) + '.'}</span></div>
        <div><span className="m ok">i</span><span>Planned to date (through today, {fdate(new Date(now).toISOString().slice(0, 10))}): {toDate.work} working day{toDate.work === 1 ? '' : 's'}, {hrsf(toDate.hours)} labour h, <b>{money(toDate.total)}</b>.</span></div>
      </div>
    </div>
  );
}
