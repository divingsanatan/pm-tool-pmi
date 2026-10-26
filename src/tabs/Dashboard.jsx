import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import Kpi from '../components/Kpi';
import { Gauge, Donut, SCurve, Legend3 } from '../components/Charts';
import { alerts, emv, evmSeries, labourTotal, lineTotal, projectEvm, rating, reserves, score, stCls, worst, wps, wstat } from '../lib/calc';
import { fdate, today } from '../lib/dates';
import { money, nz, pc } from '../lib/format';
import { changeAlerts, signedMoney } from '../lib/change';
import BaselinePanel from '../components/BaselinePanel';

const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// The Dashboard is real time: every figure is worked out from the live plan as of today, on every change,
// every minute, and when the tab is shown again. There are no week, sprint or custom ranges to pick.
export default function Dashboard() {
  const { S } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const t = setInterval(bump, 60000);
    const vis = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const asOf = today();
  const E = projectEvm(S, asOf);
  const series = evmSeries(S, asOf);
  const RS = reserves(S);
  const noData = E.spi == null && E.cpi == null;
  const health = worst(stCls(E.spi), stCls(E.cpi));
  const hlabel = noData ? 'No data yet' : health === 'good' ? 'On track' : health === 'warn' ? 'At risk' : 'Off track';
  const spiText = E.spi == null ? 'No data' : E.spi >= 1 ? 'On or ahead of plan' : E.spi >= 0.9 ? 'Slightly behind' : 'Behind plan';
  const cpiText = E.cpi == null ? 'No data' : E.cpi >= 1 ? 'Under budget' : E.cpi >= 0.9 ? 'Slightly over' : 'Over budget';

  // the budget as a structure: work budget, contingency, management reserve, and how much of the reserves the actual cost has used
  const contUsed = Math.min(RS.contingency, Math.max(0, E.ac - RS.base));
  const mgmtUsed = Math.min(RS.management, Math.max(0, E.ac - RS.costBaseline));
  const seg = (v) => (RS.total ? (v / RS.total) * 100 : 0) + '%';
  // the same reserves seen from the forecast: where the cost lands if today's cost performance continues
  const fcCont = E.eac == null ? null : Math.min(RS.contingency, Math.max(0, E.eac - RS.base));
  const fcMgmt = E.eac == null ? null : Math.min(RS.management, Math.max(0, E.eac - RS.costBaseline));
  const fcBeyond = E.eac == null ? null : Math.max(0, E.eac - RS.total);

  // what the budget is made of, over the whole project; the pieces add up to the budget at completion
  const parts = [{ n: 'Team labour', v: labourTotal(S) }]
    .concat(S.lines.map((l) => ({ n: l.name || 'Line item', v: lineTotal(S, l) })))
    .filter((p) => p.v > 0);
  const ptot = parts.reduce((x, p) => x + p.v, 0);

  const cnt = { Done: 0, 'In progress': 0, Late: 0, 'Not started': 0 };
  wps(S).forEach((x) => cnt[wstat(x)]++);
  const tw = wps(S).length;
  const cc = { Done: 'var(--good)', 'In progress': 'var(--accent)', Late: 'var(--bad)', 'Not started': 'var(--line)' };
  const STATUSES = ['Done', 'In progress', 'Late', 'Not started'];

  const op = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed');
  const rc = { High: 0, Medium: 0, Low: 0 };
  op.forEach((r) => {
    const t = rating(score(r));
    if (t) rc[t]++;
  });
  const top = op.filter((r) => emv(r) != null).sort((x, y) => emv(y) - emv(x)).slice(0, 3);

  // schedule and cost checks plus change-control checks, with one "nothing flagged" line only when both are clean
  const needs = alerts(S).filter((x) => x.cls !== 'good').concat(changeAlerts(S));
  if (!needs.length) needs.push({ cls: 'good', text: 'Nothing flagged.' });

  const varStyle = (v) => (v == null || Math.abs(v) < 0.005 ? undefined : { color: v < 0 ? 'var(--bad)' : 'var(--good)' });

  return (
    <>
      <section className="card">
        <div className="row sp">
          <div>
            <h2 style={{ margin: 0 }}>Project status today</h2>
            <p className="hint" style={{ margin: '4px 0 0' }}>
              <span className="pill good" style={{ marginRight: 8 }}>Live</span>
              As of {fdate(asOf)} · whole project · recalculated on every change
            </p>
          </div>
          <span className={'pill lg ' + (noData ? 'neutral' : health)}>{hlabel}</span>
        </div>
      </section>

      <section className="kpis">
        <Kpi l="Planned value (PV)" v={money(E.pv)} s={E.hasPlan ? pc(E.bac ? E.pv / E.bac : null, 0) + ' of the budget was due by today' : 'No plan yet: add planned hours and dates to the sprints'} />
        <Kpi l="Earned value (EV)" v={money(E.ev)} s={E.hasPlan ? 'Schedule variance ' + signedMoney(r2(E.sv), money) : ''} />
        <Kpi l="Actual cost (AC)" v={money(E.ac)} s={E.hasPlan ? 'Cost variance ' + signedMoney(r2(E.cv), money) : ''} />
        <Kpi l="Budget at completion (BAC)" v={money(E.bac)} s={pc(E.pctSpent, 0) + ' spent · ' + (E.pctComplete == null ? '–' : pc(E.pctComplete, 0)) + ' complete'}>
          <div className={'bar ' + (E.ac > E.bac ? 'bad' : '')} style={{ marginTop: 8 }}>
            <i style={{ width: Math.min(100, E.bac ? (E.ac / E.bac) * 100 : 0) + '%' }} />
          </div>
        </Kpi>
      </section>

      <div className="grid3">
        <div className="card">
          <h2>Schedule performance</h2>
          <p className="hint">SPI = earned ÷ planned, as of today. Above 100% is ahead.</p>
          <div className="gauge">
            <Gauge v={E.spi} />
            <div className="info">
              <span className={'pill ' + stCls(E.spi)} style={{ alignSelf: 'flex-start' }}>{spiText}</span>
              {E.spi != null && <span className="msg mono">{money(E.ev)} ÷ {money(E.pv)}</span>}
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Cost performance</h2>
          <p className="hint">CPI = earned ÷ actual cost, as of today. Above 100% is under budget.</p>
          <div className="gauge">
            <Gauge v={E.cpi} />
            <div className="info">
              <span className={'pill ' + stCls(E.cpi)} style={{ alignSelf: 'flex-start' }}>{cpiText}</span>
              {E.cpi != null && <span className="msg mono">{money(E.ev)} ÷ {money(E.ac)}</span>}
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Forecast for the whole project</h2>
          <p className="hint">If cost performance so far continues: EAC = BAC ÷ CPI.</p>
          <div className="totals">
            <span>Budget at completion (BAC)</span><span className="mono">{money(E.bac)}</span>
            <span>Spent so far (AC)</span><span className="mono">{money(E.ac)}</span>
            <span>Earned so far (EV)</span><span className="mono">{money(E.ev)}</span>
            <span>Forecast at completion (EAC)</span><span className="mono">{E.eac == null ? '–' : money(r2(E.eac))}</span>
            <span>Cost still to come (ETC)</span><span className="mono">{E.etc == null ? '–' : money(r2(E.etc))}</span>
            <span>Forecast variance (BAC − EAC)</span>
            <span className="mono" style={varStyle(E.vac)}>{E.vac == null ? '–' : money(r2(E.vac))}</span>
            <span title="The cost performance needed on the remaining work to finish on budget. Above 100% is harder than so far.">Needed from here (TCPI)</span>
            <span className="mono">{E.tcpi == null ? (E.hasPlan && E.bac <= E.ac ? 'Budget spent' : '–') : pc(E.tcpi, 0)}</span>
          </div>
          <div className="bar" style={{ marginTop: 12 }}><i style={{ width: Math.min(100, E.bac ? (E.ac / E.bac) * 100 : 0) + '%' }} /></div>
          <div className="msg" style={{ marginTop: 4 }}>
            {pc(E.pctSpent)} of the budget spent · {E.pctComplete == null ? '–' : pc(E.pctComplete)} complete
            {E.laterN > 0 ? ' · ' + money(E.later) + ' more is recorded for later dates' : ''}
          </div>
        </div>
      </div>

      <section className="card">
        <h2>Budget and reserves</h2>
        <p className="hint">Earned value, SPI and CPI are measured against the work budget (BAC). The reserves are held on top of it{RS.locked ? ' and are locked by baseline ' + RS.version : ' until a baseline is set'}.</p>
        <div className="grid2e" style={{ alignItems: 'start' }}>
          <div className="totals">
            <span>Work budget (BAC)</span><span className="mono">{money(RS.base)}</span>
            <span>Contingency reserve ({pc(RS.contPct, 1)})</span><span className="mono">{money(RS.contingency)}</span>
            <span>Cost baseline (BAC + contingency)</span><span className="mono">{money(RS.costBaseline)}</span>
            <span>Management reserve ({pc(RS.mgmtPct, 1)})</span><span className="mono">{money(RS.management)}</span>
            <span className="big">Total project budget</span><span className="mono big">{money(RS.total)}</span>
          </div>
          <div className="totals">
            <span>Actual cost to date</span><span className="mono">{money(E.ac)}</span>
            <span>Contingency used (cost above BAC)</span><span className="mono" style={contUsed > 0 ? { color: 'var(--warn)' } : undefined}>{money(contUsed)}</span>
            <span>Contingency left</span><span className="mono">{money(RS.contingency - contUsed)}</span>
            <span>Management reserve used (cost above cost baseline)</span><span className="mono" style={mgmtUsed > 0 ? { color: 'var(--bad)' } : undefined}>{money(mgmtUsed)}</span>
            <span>Management reserve left</span><span className="mono">{money(RS.management - mgmtUsed)}</span>
          </div>
        </div>
        {E.eac != null && (
          <>
            <div className="flabel" style={{ margin: '16px 0 6px' }}>If today’s cost performance continues (forecast {money(r2(E.eac))})</div>
            <div className="totals">
              <span>Forecast cost above the work budget, met by the contingency reserve</span><span className="mono" style={fcCont > 0 ? { color: 'var(--warn)' } : undefined}>{money(r2(fcCont))} of {money(RS.contingency)}</span>
              <span>Forecast cost above the cost baseline, needing the management reserve</span><span className="mono" style={fcMgmt > 0 ? { color: 'var(--bad)' } : undefined}>{money(r2(fcMgmt))} of {money(RS.management)}</span>
              <span>Forecast cost above the total project budget</span><span className="mono" style={fcBeyond > 0 ? { color: 'var(--bad)' } : undefined}>{money(r2(fcBeyond))}</span>
            </div>
          </>
        )}
        <div role="img" aria-label="Work budget, contingency and management reserve, with actual cost marked" style={{ position: 'relative', display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: 14, background: 'var(--line)' }}>
          <i style={{ width: seg(RS.base), background: 'var(--accent, #3e9fd9)' }} title={'Work budget ' + money(RS.base)} />
          <i style={{ width: seg(RS.contingency), background: 'var(--warn)' }} title={'Contingency ' + money(RS.contingency)} />
          <i style={{ width: seg(RS.management), background: 'var(--muted)' }} title={'Management reserve ' + money(RS.management)} />
          <b style={{ position: 'absolute', left: 'min(100%, ' + seg(E.ac) + ')', top: 0, bottom: 0, width: 2, background: 'var(--ink)' }} title={'Actual cost ' + money(E.ac)} />
        </div>
        <div className="msg" style={{ marginTop: 6 }}>Blue is the work budget, amber the contingency reserve, grey the management reserve. The line marks the actual cost so far.</div>
      </section>

      <BaselinePanel />

      <section className="card">
        <h2>Cumulative cost across the project</h2>
        <p className="hint">Planned runs to the end of the plan. Earned and actual stop at today.</p>
        <SCurve s={series} />
        <Legend3 />
      </section>

      <div className="grid2e">
        <div className="card">
          <h2>Needs attention</h2>
          <p className="hint">Checks run against your data.</p>
          <ul className="list">
            {needs.map((x, i) => (
              <li key={i} className="alert"><span className={'dot ' + x.cls} /><span>{x.text}</span></li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Open risks</h2>
          <p className="hint">{op.length} open · total EMV {money(op.reduce((x, r) => x + nz(emv(r)), 0))}</p>
          <div className="stack" role="img" aria-label="Open risks by rating">
            {[['High', 'var(--bad)'], ['Medium', 'var(--warn)'], ['Low', 'var(--good)']].map(([k, c]) => (rc[k] ? <i key={k} style={{ flex: rc[k], background: c }} title={k + ': ' + rc[k]} /> : null))}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--bad)' }} />High {rc.High}</span>
            <span><i style={{ background: 'var(--warn)' }} />Medium {rc.Medium}</span>
            <span><i style={{ background: 'var(--good)' }} />Low {rc.Low}</span>
          </div>
          <div className="scroll" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead><tr><th>ID</th><th>Rating</th><th className="r">EMV</th><th>Due</th></tr></thead>
              <tbody>
                {top.map((r) => {
                  const rt = rating(score(r));
                  return (
                    <tr key={r.id}>
                      <td className="mono"><span className="cell">{r.id}</span></td>
                      <td><span className="cell"><span className={'pill ' + (rt === 'High' ? 'bad' : rt === 'Medium' ? 'warn' : 'good')}>{rt}</span></span></td>
                      <td className="r mono"><span className="cell">{money(emv(r))}</span></td>
                      <td><span className="cell">{fdate(r.due)}</span></td>
                    </tr>
                  );
                })}
                {!top.length && <tr><td colSpan="4"><span className="cell msg">No open risks.</span></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid2e">
        <div className="card">
          <h2>Delivery status</h2>
          <p className="hint">{tw} work package{tw === 1 ? '' : 's'} in the plan.</p>
          <div className="stack" role="img" aria-label="Work package status">
            {STATUSES.map((k) => (cnt[k] ? <i key={k} style={{ flex: cnt[k], background: cc[k] }} title={k + ': ' + cnt[k]} /> : null))}
          </div>
          <div className="legend">
            {STATUSES.map((k) => (
              <span key={k}><i style={{ background: cc[k] }} />{k} {cnt[k]}</span>
            ))}
          </div>
          <div className="row sp" style={{ marginTop: 14 }}>
            <span>Work complete (earned value ÷ budget)</span>
            <span className="mono">{E.pctComplete == null ? '–' : pc(E.pctComplete, 0)}</span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}><i style={{ width: Math.min(100, nz(E.pctComplete) * 100) + '%' }} /></div>
        </div>
        <div className="card">
          <h2>Budget makeup</h2>
          <p className="hint">Team labour plus every budget line, over the whole project.</p>
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <Donut parts={parts} unit="total" label="Budget makeup" />
            <ul className="list" style={{ flex: 1, minWidth: 150 }}>
              {parts.map((p, i) => (
                <li key={i} className="row sp" style={{ flexWrap: 'nowrap' }}>
                  <span><i className={'sw' + ((i % 6) + 1)} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 8 }} />{p.n}</span>
                  <span className="mono">{money(p.v)} · {pc(ptot ? p.v / ptot : null, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
