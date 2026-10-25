import { Fragment, useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell } from '../components/Field';
import Menu from '../components/Menu';
import WeeksControl from '../components/WeeksControl';
import { agg, curWeek, nW, portfolio, projectBAC, sprintOf, started, stCls, wk, wkS, wkE, wlabel, worst, workPlan } from '../lib/calc';
import { fsh } from '../lib/dates';
import { money, pc } from '../lib/format';

const label = (st) => (st === 'good' ? 'On track' : st === 'warn' ? 'At risk' : 'Off track');
const range = (a, b) => fsh(a) + ' – ' + fsh(b);

function Status({ spi, cpi }) {
  if (spi == null && cpi == null) return null;
  const st = worst(stCls(spi), stCls(cpi));
  return <span className={'pill ' + st}>{label(st)}</span>;
}

function Controls() {
  const { W, nav, setNav } = useStore();
  return (
    <div className="row" style={{ gap: 12 }}>
      <div className="seg" role="group" aria-label="Which projects to show">
        <button aria-pressed={nav.weeklyScope !== 'all'} onClick={() => setNav({ weeklyScope: 'project' })}>This project</button>
        <button aria-pressed={nav.weeklyScope === 'all'} onClick={() => setNav({ weeklyScope: 'all' })} title={'All ' + W.projects.length + ' projects together'}>All projects</button>
      </div>
      <div className="seg" role="group" aria-label="Week order">
        <button aria-pressed={!nav.weeklyDesc} onClick={() => setNav({ weeklyDesc: false })}>Oldest first</button>
        <button aria-pressed={!!nav.weeklyDesc} onClick={() => setNav({ weeklyDesc: true })}>Newest first</button>
      </div>
    </div>
  );
}

/* ---------- one project ---------- */
function ProjectWeekly() {
  const { S, nav, update } = useStore();
  const m = S.meta;
  const Nw = nW(S);
  const cur = curWeek(S);
  const P = workPlan(S);

  const clearWeek = (w) => update((s) => { const r = s.report[w - 1]; if (r) Object.assign(r, { planPct: null, note: '' }); });

  const rows = [];
  for (let w = 1; w <= Nw; w++) {
    const x = wk(S, w);
    const spi = x.pv && x.ev != null ? x.ev / x.pv : null;
    const cpi = x.ac && x.ev != null ? x.ev / x.ac : null;
    const cls = (w === cur && started(S) ? 'cur ' : '') + (w > 1 && sprintOf(S, w) !== sprintOf(S, w - 1) ? 'sprint-start' : '');
    const typed = (S.report[w - 1] || {}).planPct;
    rows.push(
      <tr key={w} className={cls}>
        <td data-l="Week" className="mono"><span className="cell"><b>{w}</b></span></td>
        <td data-l="Dates"><span className="cell" style={{ whiteSpace: 'nowrap' }}>{wlabel(S, w)}</span></td>
        <td data-l="Sprint" className="mono"><span className="cell">{sprintOf(S, w) ? 'S' + sprintOf(S, w) : '–'}</span></td>
        <td data-l="Planned %">
          <Cell sec="report" i={w - 1} f="planPct" value={typed} type="pct" cls="w-sm n" placeholder={x.plan == null ? '–' : pc(x.plan)} label={'Week ' + w + ' planned percent of the project budget. Follows due dates; type a number to override'} />
        </td>
        <td data-l="Earned %" className="r mono"><span className="cell">{pc(x.earn)}</span></td>
        <td data-l="Actual cost" className="r mono"><span className="cell">{x.ac == null ? '–' : money(x.ac)}</span></td>
        <td data-l="PV" className="r mono"><span className="cell">{money(x.pv)}</span></td>
        <td data-l="EV" className="r mono"><span className="cell">{money(x.ev)}</span></td>
        <td data-l="SPI" className="r mono"><span className="cell">{pc(spi)}</span></td>
        <td data-l="CPI" className="r mono"><span className="cell">{pc(cpi)}</span></td>
        <td data-l="Status"><span className="cell"><Status spi={spi} cpi={cpi} /></span></td>
        <td data-l="Notes"><Cell sec="report" i={w - 1} f="note" value={x.note} type="text" cls="w-note" placeholder="Add a note" label={'Week ' + w + ' note'} /></td>
        <td data-l="">
          <Menu
            className="x"
            label="⋯"
            title={'Week ' + w + ' actions'}
            align="right"
            items={[{ label: 'Clear typed planned % and note', onClick: () => clearWeek(w) }]}
          />
        </td>
      </tr>
    );
  }
  if (nav.weeklyDesc) rows.reverse();

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
            <p className="hint">
              Everything here is worked out from your work items and costs. {P.mode === 'sprint-hours'
                ? <>Each sprint carries a share of the project budget ({money(projectBAC(S))}) equal to its planned hours divided by the planned hours of all sprints ({Math.round(P.total * 100) / 100} h in total), so the shares always add up to 100%. <b>Planned</b> follows each sprint's own dates, <b>Earned</b> is the sprint's done work item hours against its planned hours, counted in the week each item was marked done,</>
                : <>Each work item carries a share of the project budget ({money(projectBAC(S))}),{' '}
              {P.weighted ? 'weighted by its effort hours' : 'shared equally (add effort hours to weight them)'}. <b>Planned</b> follows due dates, <b>Earned</b> follows when items were marked done,</>}
              and <b>Actual cost</b> is the cost entries on the Budget tab. Planned % and Earned % are shares of the project budget ({money(projectBAC(S))}), so each column adds up to 100% over the whole project. You can type a Planned % (share of the project budget) to override a week; clear it to go back to the sprint plan.
            </p>
          </div>
          <Controls />
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
        {P.count === 0 && <p className="msg" style={{ marginTop: 10 }}>No work items in the sprints yet, so planned and earned values stay empty.</p>}
        {P.undated > 0 && <p className="msg" style={{ marginTop: 10 }}>{P.undated} work item{P.undated > 1 ? 's have' : ' has'} no dates, so {P.undated > 1 ? 'they are' : 'it is'} not in the plan yet.</p>}
        {P.noStamp > 0 && <p className="msg" style={{ marginTop: 6 }}>{P.noStamp} finished item{P.noStamp > 1 ? 's have' : ' has'} no completion date and count{P.noStamp > 1 ? '' : 's'} on {P.noStamp > 1 ? 'their due dates' : 'its due date'}. Open an item to set when it was completed.</p>}
      </div>
    </>
  );
}

/* ---------- all projects together ---------- */
function AllWeekly() {
  const { W, nav, setNav } = useStore();
  const [open, setOpen] = useState({});
  const { rows: calRows, cur } = useMemo(() => portfolio(W.projects), [W.projects]);

  const per = W.projects.map((p) => ({ p, T: agg(p, 1, nW(p)), bac: projectBAC(p) }));
  const tot = per.reduce((a, { T, bac }) => ({ bac: a.bac + bac, pv: a.pv + T.pvR, ev: a.ev + T.evR, ac: a.ac + T.ac, evC: a.evC + T.evC, acC: a.acC + T.acC }), { bac: 0, pv: 0, ev: 0, ac: 0, evC: 0, acC: 0 });
  const tSpi = tot.pv ? tot.ev / tot.pv : null, tCpi = tot.acC ? tot.evC / tot.acC : null;

  const openProject = (p) => setNav({ projectId: p.id, view: 'project', sprintId: null, tab: 'weekly', weeklyScope: 'project' });

  const rows = calRows.map((r) => {
    const isOpen = !!open[r.k];
    const list = [
      <tr key={r.k} className={r.k === cur ? 'cur' : ''}>
        <td data-l="Week" className="mono"><span className="cell"><b>{r.k}</b></span></td>
        <td data-l="Dates"><span className="cell" style={{ whiteSpace: 'nowrap' }}>{range(r.s, r.e)}</span></td>
        <td data-l="Projects" className="mono"><span className="cell">{r.parts.length}</span></td>
        <td data-l="PV" className="r mono"><span className="cell">{money(r.pv)}</span></td>
        <td data-l="EV" className="r mono"><span className="cell">{money(r.ev)}</span></td>
        <td data-l="Actual cost" className="r mono"><span className="cell">{money(r.ac)}</span></td>
        <td data-l="SPI" className="r mono"><span className="cell">{pc(r.spi)}</span></td>
        <td data-l="CPI" className="r mono"><span className="cell">{pc(r.cpi)}</span></td>
        <td data-l="Status"><span className="cell"><Status spi={r.spi} cpi={r.cpi} /></span></td>
        <td data-l="">
          {r.parts.length > 0 && (
            <button className="x" onClick={() => setOpen({ ...open, [r.k]: !isOpen })} aria-expanded={isOpen} aria-label={(isOpen ? 'Hide' : 'Show') + ' projects in week ' + r.k} title="Show each project">{isOpen ? '▾' : '▸'}</button>
          )}
        </td>
      </tr>,
    ];
    if (isOpen) {
      r.parts.forEach(({ p, w, x }) => {
        const spi = x.pv && x.ev != null ? x.ev / x.pv : null;
        const cpi = x.ac && x.ev != null ? x.ev / x.ac : null;
        list.push(
          <tr key={r.k + p.id} style={{ background: 'var(--row)' }}>
            <td data-l="Week" className="mono"><span className="cell msg">{' '}</span></td>
            <td data-l="Project" colSpan={2}><span className="cell"><b>{p.meta.name}</b><span className="msg">&nbsp;week {w}</span></span></td>
            <td data-l="PV" className="r mono"><span className="cell">{money(x.pv)}</span></td>
            <td data-l="EV" className="r mono"><span className="cell">{money(x.ev)}</span></td>
            <td data-l="Actual cost" className="r mono"><span className="cell">{x.ac == null ? '–' : money(x.ac)}</span></td>
            <td data-l="SPI" className="r mono"><span className="cell">{pc(spi)}</span></td>
            <td data-l="CPI" className="r mono"><span className="cell">{pc(cpi)}</span></td>
            <td data-l="Status"><span className="cell"><Status spi={spi} cpi={cpi} /></span></td>
            <td data-l=""></td>
          </tr>
        );
      });
    }
    return <Fragment key={r.k}>{list}</Fragment>;
  });
  if (nav.weeklyDesc) rows.reverse();

  return (
    <>
      <div className="card">
        <div className="row sp">
          <div>
            <h2>All projects</h2>
            <p className="hint">Each project's position to date. Planned, earned and actual cost are counted up to the latest reported week.</p>
          </div>
          <Controls />
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead>
              <tr>
                <th>Project</th><th>Runs</th><th className="r">Budget</th><th className="r">Planned to date</th><th className="r">Earned to date</th>
                <th className="r">Actual to date</th><th className="r">SPI</th><th className="r">CPI</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {per.map(({ p, T, bac }) => (
                <tr key={p.id} className={p.id === nav.projectId ? 'cur' : ''}>
                  <td data-l="Project"><span className="cell"><b>{p.meta.name}</b></span></td>
                  <td data-l="Runs"><span className="cell" style={{ whiteSpace: 'nowrap' }}>{range(wkS(p, 1), wkE(p, nW(p)))}</span></td>
                  <td data-l="Budget" className="r mono"><span className="cell">{money(bac)}</span></td>
                  <td data-l="Planned to date" className="r mono"><span className="cell">{money(T.pvR)}</span></td>
                  <td data-l="Earned to date" className="r mono"><span className="cell">{money(T.evR)}</span></td>
                  <td data-l="Actual to date" className="r mono"><span className="cell">{money(T.ac)}</span></td>
                  <td data-l="SPI" className="r mono"><span className="cell">{pc(T.spi)}</span></td>
                  <td data-l="CPI" className="r mono"><span className="cell">{pc(T.cpi)}</span></td>
                  <td data-l="Status"><span className="cell"><Status spi={T.spi} cpi={T.cpi} /></span></td>
                  <td data-l=""><button className="btn" onClick={() => openProject(p)}>Open</button></td>
                </tr>
              ))}
            </tbody>
            {per.length > 1 && (
              <tfoot>
                <tr>
                  <td data-l="Project"><span className="cell"><b>All projects</b></span></td>
                  <td data-l="Runs"></td>
                  <td data-l="Budget" className="r mono"><span className="cell"><b>{money(tot.bac)}</b></span></td>
                  <td data-l="Planned to date" className="r mono"><span className="cell"><b>{money(tot.pv)}</b></span></td>
                  <td data-l="Earned to date" className="r mono"><span className="cell"><b>{money(tot.ev)}</b></span></td>
                  <td data-l="Actual to date" className="r mono"><span className="cell"><b>{money(tot.ac)}</b></span></td>
                  <td data-l="SPI" className="r mono"><span className="cell"><b>{pc(tSpi)}</b></span></td>
                  <td data-l="CPI" className="r mono"><span className="cell"><b>{pc(tCpi)}</b></span></td>
                  <td data-l="Status"><span className="cell"><Status spi={tSpi} cpi={tCpi} /></span></td>
                  <td data-l=""></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Week by week, all projects</h2>
        <p className="hint">Projects are lined up by calendar week, so projects that start on different dates still add up correctly. Open a row to see each project's share. This view is read-only: change values inside each project.</p>
        <div className="scroll">
          <table className="tbl rwd">
            <thead>
              <tr>
                <th>Week</th><th>Dates</th><th>Projects</th>
                <th className="r">PV</th><th className="r">EV</th><th className="r">Actual cost</th><th className="r">SPI</th><th className="r">CPI</th>
                <th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function Weekly() {
  const { nav } = useStore();
  return nav.weeklyScope === 'all' ? <AllWeekly /> : <ProjectWeekly />;
}
