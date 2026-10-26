import { useStore } from '../store/StoreContext';
import { SelectCell, Fld } from '../components/Field';
import Kpi from '../components/Kpi';
import { Spark, Gauge, Donut, BarsChart, SCurve, Legend3 } from '../components/Charts';
import { agg, alerts, curWeek, emv, lineWeekly, nSp, nW, projectBAC, rating, reserves, rlabel, rng, roll, score, sprintCap, sprintOf, sprintWeeks, stCls, wbsOf, weeklyBAC, worst, wps, wstat, wkS } from '../lib/calc';
import { fdate, fsh } from '../lib/dates';
import { cl, money, nz, pc } from '../lib/format';
import { changeAlerts } from '../lib/change';
import BaselinePanel from '../components/BaselinePanel';

function Delta({ cur, prev }) {
  if (cur == null || prev == null) return <span className="delta flat">No previous period to compare</span>;
  const d = (cur - prev) * 100;
  if (Math.abs(d) < 0.05) return <span className="delta flat">Same as previous period</span>;
  return (
    <span className={'delta ' + (d > 0 ? 'up' : 'down')}>
      {d > 0 ? '▲ ' : '▼ '}
      {Math.abs(d).toFixed(1)} pts vs previous period
    </span>
  );
}

export default function Dashboard() {
  const { S, update } = useStore();
  const Nw = nW(S);
  const [a, b] = rng(S);
  const A = agg(S, a, b);
  const len = b - a + 1;
  const P = a - len >= 1 ? agg(S, a - len, a - 1) : null;
  const noData = A.spi == null && A.cpi == null;
  const health = worst(stCls(A.spi), stCls(A.cpi));
  const hlabel = noData ? 'No data in range' : health === 'good' ? 'On track' : health === 'warn' ? 'At risk' : 'Off track';
  const m = S.ui.mode;

  const wopts = [];
  for (let w = 1; w <= Nw; w++) wopts.push([w, 'Week ' + w + ' · ' + fsh(wkS(S, w))]);
  const spopts = [];
  S.sprints.forEach((sp, i) => {
    const r = sprintWeeks(S, sp);
    spopts.push([i + 1, sp.name + (r ? ' · ' + (r[0] === r[1] ? 'week ' + r[0] : 'weeks ' + r[0] + '–' + r[1]) : ' · no dates')]);
  });

  const setMode = (v) =>
    update((s) => {
      const u = s.ui;
      u.mode = v;
      if (v === 'week') u.week = curWeek(s);
      if (v === 'sprint') u.sprint = sprintOf(s, curWeek(s)) || 1;
      if (v === 'custom') {
        u.from = 1;
        u.to = curWeek(s);
      }
    });
  const step = (d) =>
    update((s) => {
      const u = s.ui;
      if (u.mode === 'week') u.week = cl(u.week + d, 1, nW(s));
      else u.sprint = cl(u.sprint + d, 1, nSp(s));
    });

  const T = agg(S, 1, Nw);
  const pb = projectBAC(S);
  const eac = T.cpi ? pb / T.cpi : null;
  // the budget as a structure: work budget, contingency, management reserve, and how much of the reserves the actual cost has used
  const RS = reserves(S);
  const contUsed = Math.min(RS.contingency, Math.max(0, T.ac - RS.base));
  const mgmtUsed = Math.min(RS.management, Math.max(0, T.ac - RS.costBaseline));
  const seg = (v) => (RS.total ? (v / RS.total) * 100 : 0) + '%';

  const parts = [{ n: 'Team labour', v: sprintCap(S) }].concat(S.lines.filter((l) => l.per !== 'project').map((l) => ({ n: l.name || 'Line item', v: lineWeekly(S, l) })));
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

  const spiText = A.spi == null ? 'No data' : A.spi >= 1 ? 'On or ahead of plan' : A.spi >= 0.9 ? 'Slightly behind' : 'Behind plan';
  const cpiText = A.cpi == null ? 'No data' : A.cpi >= 1 ? 'Under budget' : A.cpi >= 0.9 ? 'Slightly over' : 'Over budget';

  return (
    <>
      <section className="card">
        <div className="row sp">
          <div className="seg" role="group" aria-label="Time range">
            {[['week', 'Week'], ['sprint', 'Sprint'], ['custom', 'Custom'], ['project', 'Whole project']].map(([id, label]) => (
              <button key={id} aria-pressed={m === id} onClick={() => setMode(id)}>{label}</button>
            ))}
          </div>
          <span className={'pill lg ' + (noData ? 'neutral' : health)}>{hlabel}</span>
        </div>
        <div className="ctl" style={{ marginTop: 14 }}>
          {m === 'week' && (
            <>
              <button className="btn icon" onClick={() => step(-1)} aria-label="Previous week">‹</button>
              <SelectCell sec="ui" f="week" value={S.ui.week} options={wopts} type="int" />
              <button className="btn icon" onClick={() => step(1)} aria-label="Next week">›</button>
            </>
          )}
          {m === 'sprint' && (
            <>
              <button className="btn icon" onClick={() => step(-1)} aria-label="Previous sprint">‹</button>
              <SelectCell sec="ui" f="sprint" value={S.ui.sprint} options={spopts} type="int" />
              <button className="btn icon" onClick={() => step(1)} aria-label="Next sprint">›</button>
            </>
          )}
          {m === 'custom' && (
            <>
              <Fld label="From"><SelectCell sec="ui" f="from" value={S.ui.from} options={wopts} type="int" /></Fld>
              <Fld label="To"><SelectCell sec="ui" f="to" value={S.ui.to} options={wopts} type="int" /></Fld>
            </>
          )}
          <span className="rangelbl">{rlabel(S, a, b)}</span>
        </div>
      </section>

      <section className="kpis">
        <Kpi l="Planned value" v={money(A.pv)} s="What the plan said to deliver" />
        <Kpi l="Earned value" v={money(A.ev)} s={A.pv ? pc(A.ev / A.pv, 0) + ' of planned value' : 'No plan entered'} />
        <Kpi l="Actual cost" v={money(A.ac)} s={A.budget ? pc(A.ac / A.budget, 0) + ' of period budget' : ''} />
        <Kpi l="Period budget" v={money(A.budget)} s={len + ' week' + (len > 1 ? 's' : '') + ' × ' + money(weeklyBAC(S))}>
          <div className={'bar ' + (A.ac > A.budget ? 'bad' : '')} style={{ marginTop: 8 }}>
            <i style={{ width: Math.min(100, A.budget ? (A.ac / A.budget) * 100 : 0) + '%' }} />
          </div>
        </Kpi>
      </section>

      <div className="grid3">
        <div className="card">
          <h2>Schedule performance</h2>
          <p className="hint">SPI = earned ÷ planned. Above 100% is ahead.</p>
          <div className="gauge">
            <Gauge v={A.spi} />
            <div className="info">
              <span className={'pill ' + stCls(A.spi)} style={{ alignSelf: 'flex-start' }}>{spiText}</span>
              <Delta cur={A.spi} prev={P && P.spi} />
              <Spark vals={A.spiS} />
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Cost performance</h2>
          <p className="hint">CPI = earned ÷ actual cost. Above 100% is under budget.</p>
          <div className="gauge">
            <Gauge v={A.cpi} />
            <div className="info">
              <span className={'pill ' + stCls(A.cpi)} style={{ alignSelf: 'flex-start' }}>{cpiText}</span>
              <Delta cur={A.cpi} prev={P && P.cpi} />
              <Spark vals={A.cpiS} />
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Forecast for the whole project</h2>
          <p className="hint">Uses cost performance to date.</p>
          <div className="totals">
            <span>Project budget (BAC)</span><span className="mono">{money(pb)}</span>
            <span>Spent so far</span><span className="mono">{money(T.ac)}</span>
            <span>Earned so far</span><span className="mono">{money(T.ev)}</span>
            <span>Forecast at completion</span><span className="mono">{eac == null ? '–' : money(eac)}</span>
            <span>Forecast variance</span>
            <span className="mono" style={eac != null ? { color: pb - eac < 0 ? 'var(--bad)' : 'var(--good)' } : undefined}>{eac == null ? '–' : money(pb - eac)}</span>
          </div>
          <div className="bar" style={{ marginTop: 12 }}><i style={{ width: Math.min(100, pb ? (T.ac / pb) * 100 : 0) + '%' }} /></div>
          <div className="msg" style={{ marginTop: 4 }}>{pc(pb ? T.ac / pb : null)} of project budget spent · {T.reported} of {Nw} weeks reported</div>
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
            <span>Actual cost to date</span><span className="mono">{money(T.ac)}</span>
            <span>Contingency used (cost above BAC)</span><span className="mono" style={contUsed > 0 ? { color: 'var(--warn)' } : undefined}>{money(contUsed)}</span>
            <span>Contingency left</span><span className="mono">{money(RS.contingency - contUsed)}</span>
            <span>Management reserve used (cost above cost baseline)</span><span className="mono" style={mgmtUsed > 0 ? { color: 'var(--bad)' } : undefined}>{money(mgmtUsed)}</span>
            <span>Management reserve left</span><span className="mono">{money(RS.management - mgmtUsed)}</span>
          </div>
        </div>
        <div role="img" aria-label="Work budget, contingency and management reserve, with actual cost marked" style={{ position: 'relative', display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: 14, background: 'var(--line)' }}>
          <i style={{ width: seg(RS.base), background: 'var(--accent, #3e9fd9)' }} title={'Work budget ' + money(RS.base)} />
          <i style={{ width: seg(RS.contingency), background: 'var(--warn)' }} title={'Contingency ' + money(RS.contingency)} />
          <i style={{ width: seg(RS.management), background: 'var(--muted)' }} title={'Management reserve ' + money(RS.management)} />
          <b style={{ position: 'absolute', left: 'min(100%, ' + seg(T.ac) + ')', top: 0, bottom: 0, width: 2, background: 'var(--ink)' }} title={'Actual cost ' + money(T.ac)} />
        </div>
        <div className="msg" style={{ marginTop: 6 }}>Blue is the work budget, amber the contingency reserve, grey the management reserve. The line marks the actual cost so far.</div>
      </section>

      <BaselinePanel />

      <div className="grid2">
        <div className="card">
          <h2>Cumulative cost across the project</h2>
          <p className="hint">Shaded area is your selected range.</p>
          <SCurve S={S} a={a} b={b} />
          <Legend3 />
        </div>
        <div className="card">
          <h2>Weekly values in range</h2>
          <p className="hint">Hover a bar for the figure.</p>
          <BarsChart S={S} a={a} b={b} />
          <Legend3 />
        </div>
      </div>

      <div className="grid2e">
        <div className="card">
          <h2>Weekly budget makeup</h2>
          <p className="hint">Team labour plus every weekly line item.</p>
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <Donut parts={parts} />
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
        <div className="card">
          <h2>Delivery status</h2>
          <p className="hint">{tw} tasks across all sprints.</p>
          <div className="stack" role="img" aria-label="Work package status">
            {STATUSES.map((k) => (cnt[k] ? <i key={k} style={{ flex: cnt[k], background: cc[k] }} title={k + ': ' + cnt[k]} /> : null))}
          </div>
          <div className="legend">
            {STATUSES.map((k) => (
              <span key={k}><i style={{ background: cc[k] }} />{k} {cnt[k]}</span>
            ))}
          </div>
          <ul className="list" style={{ marginTop: 14 }}>
            {wbsOf(S).filter((x) => x.type === 'Phase').map((p) => {
              const o = roll(S, p);
              return (
                <li key={p.sprintId} className="wp">
                  <span className="nm"><span className="mono" style={{ color: 'var(--muted)' }}>{p.id}</span>&nbsp; {p.name}</span>
                  <span className="mono" style={{ textAlign: 'right' }}>{pc(o.pct, 0)}</span>
                  <div className="bar"><i style={{ width: Math.min(100, nz(o.pct) * 100) + '%' }} /></div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

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
    </>
  );
}
