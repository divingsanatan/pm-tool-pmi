import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import WeeksControl from '../components/WeeksControl';
import { curWeek, nW, sprintOf, started, stCls, weeklyBAC, wk, wkE, wkS, wlabel, worst } from '../lib/calc';
import { DAY, pd, today } from '../lib/dates';
import { money, pc } from '../lib/format';

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export default function Weekly() {
  const { S, update } = useStore();
  const ui = useUI();
  const [fill, setFill] = useState('20');
  const [more, setMore] = useState('4');
  const m = S.meta;
  const Nw = nW(S);
  const cur = curWeek(S);
  const B = weeklyBAC(S);
  const auto = m.weeksMode === 'auto';

  const applyFill = () =>
    update((s) => {
      const pv = parseFloat(fill);
      if (isNaN(pv)) return;
      s.report.forEach((r, k) => {
        if (k < nW(s) && r.planPct == null) r.planPct = pv / 100;
      });
    });
  const addWeeks = (n) => update((s) => { s.meta.weeks = Math.min(104, s.meta.weeks + n); });
  const clearWeek = (w) => update((s) => { const r = s.report[w - 1]; if (r) Object.assign(r, { planPct: null, earnPct: null, note: '' }); });
  const removeLast = () =>
    ui.ask({
      title: 'Remove the last week?',
      body: `Week ${Nw} will no longer be part of the project. Cost entries dated in that week stay in your cost list, but they will fall outside the project weeks.`,
      confirm: 'Remove week',
      danger: true,
      onConfirm: () => update((s) => { s.meta.weeks = Math.max(1, s.meta.weeks - 1); }),
    });
  const costDate = (w) => {
    const t = pd(today());
    return t >= wkS(S, w) && t <= wkE(S, w) ? today() : iso(wkS(S, w));
  };

  const rows = [];
  for (let w = 1; w <= Nw; w++) {
    const x = wk(S, w);
    const spi = x.pv && x.ev != null ? x.ev / x.pv : null;
    const cpi = x.ac && x.ev != null ? x.ev / x.ac : null;
    const st = worst(stCls(spi), stCls(cpi));
    const cls = (w === cur && started(S) ? 'cur ' : '') + ((w - 1) % m.sprintWeeks === 0 && w > 1 ? 'sprint-start' : '');
    rows.push(
      <tr key={w} className={cls}>
        <td data-l="Week" className="mono"><span className="cell"><b>{w}</b></span></td>
        <td data-l="Dates"><span className="cell" style={{ whiteSpace: 'nowrap' }}>{wlabel(S, w)}</span></td>
        <td data-l="Sprint" className="mono"><span className="cell">S{sprintOf(S, w)}</span></td>
        <td data-l="Planned %"><Cell sec="report" i={w - 1} f="planPct" value={x.plan} type="pct" cls="w-sm n" label={'Week ' + w + ' planned percent'} /></td>
        <td data-l="Earned %"><Cell sec="report" i={w - 1} f="earnPct" value={x.earn} type="pct" cls="w-sm n" label={'Week ' + w + ' earned percent'} /></td>
        <td data-l="Actual cost" className="r mono">
          <span className="cell" style={{ gap: 6 }}>
            {x.ac == null ? '–' : money(x.ac)}
            <button className="x" onClick={() => ui.addCost({ date: costDate(w) })} aria-label={'Add a cost to week ' + w} title="Add a cost to this week">＋</button>
          </span>
        </td>
        <td data-l="PV" className="r mono"><span className="cell">{money(x.pv)}</span></td>
        <td data-l="EV" className="r mono"><span className="cell">{money(x.ev)}</span></td>
        <td data-l="SPI" className="r mono"><span className="cell">{pc(spi)}</span></td>
        <td data-l="CPI" className="r mono"><span className="cell">{pc(cpi)}</span></td>
        <td data-l="Status">
          <span className="cell">
            {!(spi == null && cpi == null) && <span className={'pill ' + st}>{st === 'good' ? 'On track' : st === 'warn' ? 'At risk' : 'Off track'}</span>}
          </span>
        </td>
        <td data-l="Notes"><Cell sec="report" i={w - 1} f="note" value={x.note} type="text" cls="w-note" placeholder="Add a note" label={'Week ' + w + ' note'} /></td>
        <td data-l="">
          <Menu
            className="x"
            label="⋯"
            title={'Week ' + w + ' actions'}
            align="right"
            items={[
              { label: 'Add a cost to this week', onClick: () => ui.addCost({ date: costDate(w) }) },
              { label: 'Clear planned %, earned % and note', onClick: () => clearWeek(w) },
              { sep: true },
              { label: w === Nw && !auto && Nw > 1 ? 'Remove this week' : auto ? 'Remove week (switch to Manual first)' : 'Only the last week can be removed', danger: true, disabled: !(w === Nw && !auto && Nw > 1), onClick: removeLast },
            ]}
          />
        </td>
      </tr>
    );
  }

  return (
    <>
      <div className="card">
        <h2>Project timeline</h2>
        <p className="hint">Set these once. Weeks run from the start date, and sprints group weeks together. Every tab follows this setup.</p>
        <div className="fields">
          <label className="fld">Project name<Cell sec="meta" f="name" value={m.name} cls="w-name" /></label>
          <label className="fld">Start date (Monday of week 1)<Cell sec="meta" f="start" value={m.start} type="date" cls="w-date" /></label>
          <WeeksControl />
          <label className="fld">Sprint length (weeks)<Cell sec="meta" f="sprintWeeks" value={m.sprintWeeks} type="int" cls="w-sm n" /></label>
        </div>
      </div>
      <div className="card">
        <div className="row sp">
          <div>
            <h2>Weekly tracker</h2>
            <p className="hint">Enter planned % and earned % of the week's budget ({money(B)}). Actual cost adds up the costs dated in that week, so record them with ＋ or on the Budget tab.</p>
          </div>
          <div className="row">
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              Fill empty planned % with
              <input className="c n w-sm" type="number" step="any" inputMode="decimal" value={fill} onChange={(e) => setFill(e.target.value)} style={{ borderColor: 'var(--line)' }} aria-label="Planned percent to fill" />
            </label>
            <button className="btn" onClick={applyFill}>Apply</button>
          </div>
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead>
              <tr>
                <th>Week</th><th>Dates</th><th>Sprint</th>
                <th className="r">Planned %</th><th className="r">Earned %</th><th className="r">Actual cost</th>
                <th className="r">PV</th><th className="r">EV</th><th className="r">SPI</th><th className="r">CPI</th>
                <th>Status</th><th>Notes, highlights and blockers</th><th></th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={auto || Nw >= 104} onClick={() => addWeeks(1)} title={auto ? 'Weeks follow your data in Auto mode' : 'Add a week at the end'}>+ Add week</button>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input className="c n w-sm" type="number" min="1" max="104" inputMode="numeric" value={more} onChange={(e) => setMore(e.target.value)} style={{ borderColor: 'var(--line)' }} aria-label="Number of weeks to add" disabled={auto} />
            <button className="btn" disabled={auto} onClick={() => addWeeks(Math.max(1, Math.min(104, parseInt(more, 10) || 1)))}>Add weeks</button>
          </span>
          {auto && <span className="msg">Weeks follow your data in Auto mode. Switch to Manual above to add or remove weeks.</span>}
        </div>
      </div>
    </>
  );
}
