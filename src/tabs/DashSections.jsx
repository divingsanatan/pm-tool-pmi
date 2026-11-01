import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { BarChart, HBars, HeatGrid, HeatLegend, Legend, RiskGrid, StackedArea, TimeChart, fmtNum, heat } from '../components/DashCharts';
import { hasValidDates } from '../lib/offdays';
import { DAY, fdate, pd, today } from '../lib/dates';
import { kf, money, pc } from '../lib/format';
import { inPlan, projectEvm } from '../lib/calc';
import { projectCapacity } from '../lib/capacity';
import { raidJump } from '../lib/deps';
import { burnSeries, changeMix, costByElement, dueWork, eacScenarios, flowSeries, indexTrend, peopleLoad, raidMix, riskMatrix, riskSeries, scheduleHealth, spiFinish, sprintPerformance, statusMix, velocity, weeklyLoad } from '../lib/insights';

const h1 = (v) => (v == null ? '–' : Math.round(v * 10) / 10 + ' h');
const Big = ({ items }) => (
  <div className="dc-big">{items.map((x) => (<div key={x.l}><span>{x.l}</span><b style={x.c ? { color: x.c } : undefined}>{x.v}</b>{x.s && <small>{x.s}</small>}</div>))}</div>
);
const Empty = ({ children }) => <p className="msg" style={{ margin: 0 }}>{children}</p>;
const Card = ({ title, hint, children, tools }) => (
  <section className="card">
    <div className="row sp" style={{ alignItems: 'flex-start' }}>
      <div><h2 style={{ margin: 0 }}>{title}</h2>{hint && <p className="hint" style={{ margin: '4px 0 12px' }}>{hint}</p>}</div>
      {tools}
    </div>
    {children}
  </section>
);
const COL = { pv: 'var(--c-pv)', ev: 'var(--c-ev)', ac: 'var(--c-ac)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', acc: 'var(--accent)' };

/* ---------------------------------------------------------------- Progress */
export function ProgressSection() {
  const { S } = useStore();
  const asOf = today();
  const [spId, setSpId] = useState('');
  const [mode, setMode] = useState('up');
  const B = useMemo(() => burnSeries(S, spId, asOf), [S, spId, asOf]);
  const whole = useMemo(() => burnSeries(S, '', asOf), [S, asOf]);
  const trend = useMemo(() => indexTrend(S, asOf), [S, asOf]);
  const vel = useMemo(() => velocity(S), [S]);
  const mix = useMemo(() => statusMix(S), [S]);
  const due = useMemo(() => dueWork(S, asOf), [S, asOf]);
  const fin = useMemo(() => spiFinish(S, asOf), [S, asOf]);
  const flow = useMemo(() => flowSeries(S, asOf), [S, asOf]);
  const spr = S.sprints.filter((sp) => inPlan(S, sp) && hasValidDates(sp));

  const slip = whole && whole.slip != null ? whole.slip : null;
  const slipTxt = slip == null ? '' : slip > 0 ? slip + ' day' + (slip === 1 ? '' : 's') + ' later than planned' : slip < 0 ? Math.abs(slip) + ' day' + (slip === -1 ? '' : 's') + ' earlier than planned' : 'on the planned date';
  const mc = whole && whole.mc;
  const slipOf = (d) => (d && whole ? Math.round((pd(d) - pd(whole.planEnd)) / DAY) : null);
  const late = (n) => (n == null ? '' : n > 0 ? n + ' day' + (n === 1 ? '' : 's') + ' after the planned ' + fdate(whole.planEnd) : n < 0 ? Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' before the planned ' + fdate(whole.planEnd) : 'on the planned date');
  const tiles = [
    { l: 'Work done', v: whole ? pc(whole.scope ? whole.doneNow / whole.scope : 0, 0) : '–', s: whole ? h1(whole.doneNow) + ' of ' + h1(whole.scope) : 'No planned hours yet' },
    { l: 'Pace (last 2 weeks)', v: whole ? (Math.round(whole.pace * 7 * 10) / 10) + ' h/week' : '–', s: whole && whole.pace > 0 ? 'Hours of work finished per week' : 'Nothing finished yet' },
    mc && mc.p50
      ? { l: 'Likely finish (P50)', v: fdate(mc.p50), s: late(slipOf(mc.p50)), c: slipOf(mc.p50) > 7 ? COL.bad : slipOf(mc.p50) > 0 ? COL.warn : undefined }
      : { l: 'Finish at this pace', v: whole && whole.finish ? fdate(whole.finish) : '–', s: whole && whole.finish ? slipTxt : 'Needs some finished work', c: slip > 7 ? COL.bad : slip > 0 ? COL.warn : undefined },
    mc ? { l: 'Safe finish (P80)', v: mc.p80 ? fdate(mc.p80) : 'Beyond 2 years', s: mc.p80 ? '8 in 10 futures finish by then' : 'At the pace seen so far', c: mc.p80 && slipOf(mc.p80) > 14 ? COL.bad : undefined }
      : { l: 'Safe finish (P80)', v: '–', s: whole && whole.samples < 3 ? 'Needs 3 weeks of finished work (' + whole.samples + ' so far)' : 'Needs finished work' },
    { l: 'Finish by schedule index', v: fin ? fdate(fin.forecastEnd) : '–', s: fin ? 'SPI ' + pc(fin.spi, 0) + ': ' + (fin.slipDays > 0 ? fin.slipDays + ' days late' : fin.slipDays < 0 ? Math.abs(fin.slipDays) + ' days early' : 'on time') : 'Needs earned value' },
  ];

  let burn = null;
  if (B) {
    const rem = (arr) => arr.map((v) => (v == null ? null : Math.max(0, B.scope - v)));
    const series = mode === 'up'
      ? [
        { name: 'Scope', color: COL.pv, values: B.ms.map(() => B.scope), dash: true, w: 1.6 },
        { name: 'Ideal', color: 'var(--muted)', values: B.ideal, w: 1.8 },
        ...(B.mc ? [{ name: 'Likely range (20% to 80%)', color: COL.acc, values: B.mc.hi, base: B.mc.lo }] : []),
        { name: 'Done', color: COL.ev, values: B.done, area: true, w: 2.6 },
        B.mc ? { name: 'Most likely (P50)', color: COL.acc, values: B.mc.mid, dash: true } : { name: 'At today’s pace', color: COL.acc, values: B.proj, dash: true },
      ]
      : [
        { name: 'Ideal remaining', color: 'var(--muted)', values: rem(B.ideal), w: 1.8 },
        ...(B.mc ? [{ name: 'Likely range (20% to 80%)', color: COL.acc, values: B.mc.lo.map((v) => (v == null ? null : B.scope - v)), base: B.mc.hi.map((v) => (v == null ? null : B.scope - v)) }] : []),
        { name: 'Remaining', color: COL.ev, values: rem(B.done), area: true, w: 2.6 },
        B.mc ? { name: 'Most likely (P50)', color: COL.acc, values: rem(B.mc.mid), dash: true } : { name: 'At today’s pace', color: COL.acc, values: rem(B.proj), dash: true },
      ];
    burn = (
      <>
        <TimeChart ms={B.ms} series={series} nowIdx={B.nowIdx} fmt={h1} yFmt={(v) => Math.round(v)} yMax={undefined} marks={B.planEndIdx < B.n ? [{ i: B.planEndIdx, label: 'Planned end', color: COL.bad }] : []} label={mode === 'up' ? 'Burn-up chart' : 'Burn-down chart'} />
        <Legend items={series.map((s) => ({ name: s.name, color: s.color, dash: s.dash }))} />
        {B.mc ? (
          <p className="dc-note">The shaded range comes from <b>1,500 simulated futures</b>, drawn from your own {B.samples} weeks of finished work: 5 in 10 finish by <b>{B.mc.p50 ? fdate(B.mc.p50) : 'a date beyond two years'}</b> and 8 in 10 by <b>{B.mc.p80 ? fdate(B.mc.p80) : 'a date beyond two years'}</b>. It is wide when your weekly output has been uneven.</p>
        ) : (
          <p className="dc-note">The dashed line assumes the pace of the last two weeks continues. After <b>3 full weeks</b> of finished work this becomes a range of likely finish dates, based on how much your weekly output varies{B.samples ? ' (' + B.samples + ' so far)' : ''}.</p>
        )}
        {B.undated > 0 && <p className="dc-note"><b>{B.undated}</b> finished work item{B.undated === 1 ? ' has' : 's have'} no completion date, so the due date is used for {B.undated === 1 ? 'it' : 'them'}. Work finished from now on is dated automatically. To correct older items, set “Completed on” in the work item details.</p>}
        <p className="dc-note">
          {mode === 'up'
            ? <>The <b>done</b> line should follow the <b>ideal</b> line. The gap is how far ahead or behind you are, and the <b>scope</b> line shows how much work there is in total.</>
            : <>The <b>remaining</b> line should fall along the <b>ideal</b> line to zero by the planned end.</>}
          {!B.mc && B.finish ? ' At today’s pace the work finishes on ' + fdate(B.finish) + '.' : ''}
        </p>
      </>
    );
  }

  // roadmap
  const lo = spr.length ? Math.min(...spr.map((sp) => pd(sp.start))) : 0, hi = spr.length ? Math.max(...spr.map((sp) => pd(sp.end)), pd(asOf)) : 0;
  const pos = (ms) => ((ms - lo) / Math.max(1, hi - lo + DAY)) * 100;
  const perf = sprintPerformance(S, asOf);

  const mixCats = mix.rows.map((r) => ({ label: r.name, values: mix.statuses.map((s) => r.by[s.id] || 0), sub: r.n + ' items' }));
  const lateN = due.late.length;
  return (
    <div className="dc-sec">
      <Big items={tiles} />
      <Card title="Burn-up and burn-down" hint="How much work is done against how much there is, day by day, in hours."
        tools={(
          <div className="dc-tools">
            <select className="c" value={spId} onChange={(e) => setSpId(e.target.value)} aria-label="Scope of the chart">
              <option value="">Whole project</option>
              {spr.map((sp) => (<option key={sp.id} value={sp.id}>{sp.name}</option>))}
            </select>
            <div className="seg" role="group" aria-label="Chart type"><button aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Burn-up</button><button aria-pressed={mode === 'down'} onClick={() => setMode('down')}>Burn-down</button></div>
          </div>
        )}>
        {burn || <Empty>Add planned hours and dates to a sprint to see the burn chart.</Empty>}
      </Card>

      <Card title="Cumulative flow" hint="How many work items sit in each status, every day. A band that keeps widening is where work is piling up; parallel bands mean steady flow.">
        {flow.points >= 2 ? (
          <>
            <div className="dc-big">
              <div><span>Work in progress now</span><b>{flow.wipNow}</b><small>Items started, not finished (average {Math.round(flow.wipAvg * 10) / 10} over 2 weeks)</small></div>
              <div><span>Throughput</span><b>{Math.round(flow.thr * 10) / 10} / week</b><small>Items finished per week, last 4 weeks</small></div>
              <div><span>Average time in progress</span><b>{flow.cycle == null ? '–' : Math.round(flow.cycle * 10) / 10 + ' days'}</b><small>Work in progress ÷ throughput</small></div>
            </div>
            <StackedArea ms={flow.ms} nowIdx={flow.nowIdx} layers={flow.layers.map((l) => ({ name: l.label, color: l.color, values: l.values }))} label="Cumulative flow diagram" />
            <Legend items={flow.layers.slice().reverse().map((l) => ({ name: l.label, color: l.color }))} />
            {flow.estUntil && <p className="dc-note">Before <b>{fdate(flow.estUntil)}</b> the chart is rebuilt from the activity log, so it is an estimate. From that day on it is recorded every day.</p>}
          </>
        ) : <Empty>The app now records a daily snapshot of every work item’s status. The chart appears once two days have been recorded.</Empty>}
      </Card>

      <div className="grid2e">
        <Card title="Velocity" hint="Hours planned against hours finished, sprint by sprint.">
          {vel.length ? (
            <>
              <BarChart cats={vel.map((v) => ({ label: v.name, values: [v.planned, v.done], sub: v.pct == null ? '' : pc(v.pct, 0) + ' done' }))} series={[{ name: 'Planned', color: COL.pv }, { name: 'Done', color: COL.good }]} fmt={fmtNum} label="Planned and finished hours per sprint" w={470} height={250} />
              <Legend items={[{ name: 'Planned hours', color: COL.pv }, { name: 'Done hours', color: COL.good }]} />
            </>
          ) : <Empty>No sprint has planned hours yet.</Empty>}
        </Card>
        <Card title="Schedule and cost index trend" hint="SPI and CPI each week. Above 1.0 is ahead of plan and under budget.">
          {trend ? (
            <>
              <TimeChart ms={trend.ms} series={[{ name: 'SPI (schedule)', color: COL.ev, values: trend.spi }, { name: 'CPI (cost)', color: COL.ac, values: trend.cpi }]} yMax={Math.min(3, Math.max(1.5, Math.ceil(Math.max(0, ...trend.spi.filter((v) => v != null), ...trend.cpi.filter((v) => v != null)) * 2) / 2))} refs={[{ y: 1, label: 'On plan', color: COL.good }]} fmt={(v) => (Math.round(v * 100) / 100).toString()} label="SPI and CPI by week" w={470} height={250} />
              <Legend items={[{ name: 'SPI (schedule)', color: COL.ev }, { name: 'CPI (cost)', color: COL.ac }]} />
            </>
          ) : <Empty>Needs a plan and some earned value.</Empty>}
        </Card>
      </div>

      <Card title="Sprint roadmap" hint="Each sprint on the calendar. The dark fill is the share of its work that is done; the line is today.">
        {spr.length ? (
          <div className="dc-road">
            {spr.map((sp) => {
              const p = perf.find((x) => x.id === sp.id);
              const done = p && p.budget > 0 ? Math.min(1, p.ev / p.budget) : 0;
              const a = pos(pd(sp.start)), w = pos(pd(sp.end) + DAY) - a;
              return (
                <div key={sp.id} className="dc-road-r">
                  <b style={{ fontSize: 13 }}>{sp.name}</b>
                  <div className="dc-road-t">
                    <div className="dc-road-b" style={{ left: a + '%', width: w + '%' }} title={fdate(sp.start) + ' to ' + fdate(sp.end) + ' · ' + pc(done, 0) + ' of its budget earned'}><i style={{ width: done * 100 + '%' }} /><span>{pc(done, 0)}</span></div>
                    {pd(asOf) >= lo && pd(asOf) <= hi && <div className="dc-road-today" style={{ left: pos(pd(asOf)) + '%' }} title="Today" />}
                  </div>
                </div>
              );
            })}
            <div className="dc-road-ax"><span>{fdate(new Date(lo).toISOString().slice(0, 10))}</span><span>{fdate(new Date(hi).toISOString().slice(0, 10))}</span></div>
          </div>
        ) : <Empty>No sprint has dates yet.</Empty>}
      </Card>

      <div className="grid2e">
        <Card title="Work items by status" hint="Where every work item stands in each sprint.">
          {mixCats.length ? (
            <>
              <BarChart stacked cats={mixCats.map((c, i) => ({ ...c, colors: mix.statuses.map((s) => s.color) }))} series={mix.statuses.map((s) => ({ name: s.label, color: s.color }))} fmt={fmtNum} label="Work items by status in each sprint" w={470} height={250} />
              <Legend items={mix.statuses.map((s) => ({ name: s.label, color: s.color }))} />
            </>
          ) : <Empty>No work items yet.</Empty>}
        </Card>
        <Card title="Late and due soon" hint="Open work items past their due date, and those due in the next 7 days.">
          <div className="flabel">Late ({lateN})</div>
          <ul className="dc-list">
            {due.late.slice(0, 6).map((x) => (<li key={x.t.id}><span><b className="mono">{x.t.code}</b> {x.t.name}</span><span className="mono" style={{ color: 'var(--bad)' }}>{x.days} d late</span></li>))}
            {!lateN && <li className="msg">Nothing is late.</li>}
            {lateN > 6 && <li className="msg">and {lateN - 6} more</li>}
          </ul>
          <div className="flabel" style={{ marginTop: 14 }}>Due in the next 7 days ({due.soon.length})</div>
          <ul className="dc-list">
            {due.soon.slice(0, 6).map((x) => (<li key={x.t.id}><span><b className="mono">{x.t.code}</b> {x.t.name}</span><span className="mono">{x.days === 0 ? 'today' : 'in ' + x.days + ' d'}</span></li>))}
            {!due.soon.length && <li className="msg">Nothing is due this week.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Resources */
export function ResourcesSection() {
  const { S } = useStore();
  const asOf = today();
  const ppl = useMemo(() => peopleLoad(S, asOf), [S, asOf]);
  const X = useMemo(() => projectCapacity(S, asOf), [S, asOf]);
  const wk = useMemo(() => weeklyLoad(S), [S]);
  const over = ppl.filter((p) => p.util > 1.0005).length;
  const tiles = [
    { l: 'Team utilisation', v: X.cap > 0 ? pc(X.util, 0) : '–', s: Math.round(X.load) + ' h planned of ' + Math.round(X.cap) + ' h available', c: X.util > 1 ? COL.bad : X.util > 0.85 ? COL.warn : undefined },
    { l: 'People over capacity', v: over, s: over ? 'Over 100% across the project' : 'Everyone is within capacity', c: over ? COL.bad : undefined },
    { l: 'Work with no owner', v: h1(X.unassigned), s: X.unassigned > 0 ? 'Hours not assigned to anyone' : 'All planned work is assigned' },
    { l: 'Capacity lost to leave', v: h1(X.lostCap), s: X.upcomingDays ? X.upcomingDays + ' day' + (X.upcomingDays === 1 ? '' : 's') + ' of leave in the next 30 days' : 'No leave in the next 30 days' },
  ];
  const stat = (u, cap, load) => (cap <= 0 && load > 0 ? { cls: 'warn', label: 'No capacity set' } : u > 1.0005 ? { cls: 'bad', label: 'Over' } : u >= 0.85 ? { cls: 'warn', label: 'Near limit' } : u > 0 ? { cls: 'good', label: 'Healthy' } : null);
  const rows = ppl.map((p) => ({
    label: p.name, sub: Math.round(p.load) + ' h of ' + Math.round(p.cap) + ' h',
    parts: p.cap > 0 ? [{ v: (p.done / p.cap) * 100, color: COL.good, title: 'Done ' + h1(p.done) }, { v: (p.open / p.cap) * 100, color: p.util > 1.0005 ? COL.bad : p.util >= 0.85 ? COL.warn : COL.acc, title: 'Still to do ' + h1(p.open) }] : [{ v: 100, color: COL.warn, title: 'No capacity set' }],
    text: p.cap > 0 ? pc(p.util, 0) : '–', flag: stat(p.util, p.cap, p.load),
  }));
  const hmax = Math.max(120, ...ppl.map((p) => (p.util === Infinity ? 0 : p.util * 100)));

  return (
    <div className="dc-sec">
      <Big items={tiles} />
      <Card title="Utilisation by person" hint="Planned hours against the hours each person has for this project, across all sprints. The line is 100% of capacity.">
        {rows.length ? (
          <>
            <HBars rows={rows} max={hmax} mark={100} markLabel="100% of capacity" label="Utilisation by person" />
            <Legend items={[{ name: 'Done', color: COL.good }, { name: 'Still to do', color: COL.acc }, { name: 'Over capacity', color: COL.bad }]} />
          </>
        ) : <Empty>Give stakeholders a capacity on the Budget tab and assign work items to them.</Empty>}
      </Card>

      <Card title="Workload heat map" hint="Each person’s planned hours against their capacity, week by week. Hours are spread over the working days of each work item, and leave and holidays reduce capacity.">
        {wk && wk.rows.length ? (
          <>
            <HeatGrid label="Weekly workload heat map" cols={wk.weeks.map((w) => ({ label: new Date(w.a).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), title: 'Week of ' + fdate(w.from) }))}
              rows={wk.rows.map((r) => ({
                label: r.name, sub: Math.round(r.load) + ' h planned',
                cells: r.cells.map((c) => ({
                  bg: heat(c.util, c.cap > 0 || c.load > 0.05), text: c.load > 0.05 ? (c.util === Infinity ? '!' : Math.round(c.util * 100) + '%') : c.cap > 0 ? '' : '–',
                  title: r.name + ': ' + h1(c.load) + ' planned of ' + h1(c.cap) + ' available' + (c.cap > 0 ? ' (' + Math.round(c.util * 100) + '%)' : ''),
                })),
              }))} />
            <HeatLegend />
          </>
        ) : <Empty>No scheduled, assigned work yet. Give work items hours, dates and assignees.</Empty>}
      </Card>

      <Card title="Resource histogram" hint="Hours the team has each week against the hours of work planned for it.">
        {wk && wk.totals.some((t) => t.load > 0 || t.cap > 0) ? (
          <>
            <BarChart cats={wk.weeks.map((w, i) => ({ label: new Date(w.a).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), values: [wk.totals[i].cap, wk.totals[i].load] }))} series={[{ name: 'Capacity', color: COL.pv }, { name: 'Planned work', color: COL.acc }]} fmt={fmtNum} label="Weekly capacity and planned work" />
            <Legend items={[{ name: 'Team capacity', color: COL.pv }, { name: 'Planned work', color: COL.acc }]} />
            <p className="dc-note">Weeks where the work bar is taller than the capacity bar are over-booked: move work, add people, or move dates.</p>
          </>
        ) : <Empty>Nothing to show yet.</Empty>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ Risk & change */
export function RiskSection() {
  const { S, setNav } = useStore();
  const R = useMemo(() => riskMatrix(S), [S]);
  const RS = useMemo(() => riskSeries(S, today()), [S]);
  const [rm, setRm] = useState('rating');
  const mix = useMemo(() => raidMix(S), [S]);
  const C = useMemo(() => changeMix(S), [S]);
  const H = useMemo(() => scheduleHealth(S), [S]);
  const high = R.cells.flatMap((row, i) => row.flatMap((l, p) => (l.length && (i + 1) * (p + 1) >= 15 ? l : []))).length;
  const goRaid = (r) => { raidJump.key = r.key; setNav({ tab: 'raid' }); };
  const covered = R.contingency > 0 ? R.emvTotal / R.contingency : null;
  const tiles = [
    { l: 'Open risks', v: R.open, s: R.unrated ? R.unrated + ' not rated yet' : 'All rated' },
    { l: 'High risks', v: high, s: 'Score 15 or more', c: high ? COL.bad : undefined },
    { l: 'Risk exposure (EMV)', v: money(R.emvTotal), s: R.contingency > 0 ? pc(covered, 0) + ' of the contingency reserve' : 'No contingency reserve', c: covered > 1 ? COL.bad : covered > 0.75 ? COL.warn : undefined },
    { l: 'Change requests open', v: C.pendingN, s: C.pendingN ? 'Cost ' + money(C.costPending) + ' · ' + C.daysPending + ' days if approved' : 'Nothing waiting' },
  ];
  return (
    <div className="dc-sec">
      <Big items={tiles} />
      <div className="grid2e">
        <Card title="Probability and impact matrix" hint="Open risks by how likely and how damaging they are. Tap a risk to open it.">
          {R.open ? <RiskGrid cells={R.cells} onPick={goRaid} /> : <Empty>No open risks. Add them in the RAID log.</Empty>}
        </Card>
        <Card title="Biggest risk exposures" hint="Expected monetary value: probability × cost. The line is the contingency reserve.">
          {R.emv.length ? (
            <HBars max={Math.max(R.contingency, R.emvTotal, ...R.emv.map((x) => x.v)) * 1.05} mark={R.contingency > 0 ? R.contingency : undefined} markLabel="Contingency reserve"
              rows={[{ label: 'All open risks', sub: R.emv.length + ' with an EMV', parts: [{ v: R.emvTotal, color: covered > 1 ? COL.bad : COL.warn, title: money(R.emvTotal) }], text: money(R.emvTotal) }].concat(R.emv.slice(0, 6).map((x) => ({ label: x.r.id, sub: x.r.desc ? (x.r.desc.length > 26 ? x.r.desc.slice(0, 25) + '…' : x.r.desc) : '', parts: [{ v: x.v, color: COL.acc, title: money(x.v) }], text: money(x.v) })))} label="Risk exposure" />
          ) : <Empty>Add a probability % and a cost to risks in the RAID log to see exposure.</Empty>}
        </Card>
      </div>

      <Card title="Risk burn-down" hint="Open risks over time. The aim is a falling line as risks are mitigated or closed."
        tools={RS.points >= 2 ? (
          <div className="seg" role="group" aria-label="Measure"><button aria-pressed={rm === 'rating'} onClick={() => setRm('rating')}>By rating</button><button aria-pressed={rm === 'emv'} onClick={() => setRm('emv')}>Exposure</button><button aria-pressed={rm === 'score'} onClick={() => setRm('score')}>Total score</button></div>
        ) : null}>
        {RS.points >= 2 ? (
          <>
            {rm === 'rating' && (<>
              <StackedArea ms={RS.ms} nowIdx={RS.nowIdx} layers={[{ name: 'High', color: COL.bad, values: RS.hi }, { name: 'Medium', color: COL.warn, values: RS.me }, { name: 'Low', color: COL.good, values: RS.lo }, { name: 'Not rated', color: COL.pv, values: RS.un }]} label="Open risks by rating over time" />
              <Legend items={[{ name: 'High (score 15+)', color: COL.bad }, { name: 'Medium (8 to 14)', color: COL.warn }, { name: 'Low (under 8)', color: COL.good }, { name: 'Not rated', color: COL.pv }]} />
            </>)}
            {rm === 'emv' && (<>
              <TimeChart ms={RS.ms} nowIdx={RS.nowIdx} series={[{ name: 'Risk exposure (EMV)', color: COL.acc, values: RS.emv, area: true }]} refs={R.contingency > 0 ? [{ y: R.contingency, label: 'Contingency reserve', color: COL.good }] : []} fmt={(v) => money(Math.round(v))} yFmt={kf} label="Risk exposure over time" />
              <Legend items={[{ name: 'Risk exposure (EMV)', color: COL.acc }, ...(R.contingency > 0 ? [{ name: 'Contingency reserve', color: COL.good, dash: true }] : [])]} />
            </>)}
            {rm === 'score' && (<>
              <TimeChart ms={RS.ms} nowIdx={RS.nowIdx} series={[{ name: 'Total risk score', color: COL.bad, values: RS.score, area: true }, { name: 'Risks closed', color: COL.good, values: RS.closed }]} fmt={fmtNum} label="Total risk score over time" />
              <Legend items={[{ name: 'Total risk score (probability × impact, summed)', color: COL.bad }, { name: 'Risks closed so far', color: COL.good }]} />
            </>)}
            <p className="dc-note">Recorded every day since <b>{fdate(RS.since)}</b>. Today: <b>{RS.open[RS.nowIdx]}</b> open risk{RS.open[RS.nowIdx] === 1 ? '' : 's'}, <b>{RS.hi[RS.nowIdx]}</b> high, exposure <b>{money(RS.emv[RS.nowIdx])}</b>.</p>
          </>
        ) : <Empty>The app now records the state of your risks every day, so this chart fills in as time passes. Risk history from before today cannot be recovered.</Empty>}
      </Card>

      <div className="grid2e">
        <Card title="RAID log" hint="Open, overdue and closed items by type.">
          <BarChart stacked cats={mix.map((m) => ({ label: m.type === 'Dependency' ? 'Dependencies' : m.type + 's', values: [m.open, m.overdue, m.closed], colors: [COL.acc, COL.bad, COL.pv] }))} series={[{ name: 'Open', color: COL.acc }, { name: 'Overdue', color: COL.bad }, { name: 'Closed', color: COL.pv }]} fmt={fmtNum} label="RAID items by type" w={470} height={250} />
          <Legend items={[{ name: 'Open', color: COL.acc }, { name: 'Overdue', color: COL.bad }, { name: 'Closed', color: COL.pv }]} />
        </Card>
        <Card title="Change requests" hint="Where each request is in the change process.">
          {C.total ? (
            <>
              <BarChart cats={C.rows.map((r) => ({ label: r.status, values: [r.n] }))} series={[{ name: 'Requests', color: COL.acc }]} fmt={fmtNum} label="Change requests by status" height={220} w={470} />
              <p className="dc-note">Implemented so far: <b>{money(C.costDone)}</b> and <b>{C.daysDone} days</b>. Waiting for a decision: <b>{money(C.costPending)}</b> and <b>{C.daysPending} days</b>.</p>
            </>
          ) : <Empty>No change requests yet.</Empty>}
        </Card>
      </div>

      <Card title="Schedule logic and critical path" hint="From the dependencies between work items.">
        {H.total ? (
          <>
            <Big items={[
              { l: 'Dependencies', v: H.total, s: H.external + ' on someone outside' },
              { l: 'Blocked work items', v: H.blocked.length, c: H.blocked.length ? COL.warn : undefined, s: 'Waiting on an unfinished predecessor' },
              { l: 'Broken by the plan', v: H.conflicts.length, c: H.conflicts.length ? COL.bad : undefined, s: 'Dates or progress break the rule' },
              { l: 'Critical path', v: H.critical.length + ' items', s: H.critical.length ? H.length + ' working days, ends ' + fdate(H.end) : 'No zero-float chain yet' },
            ]} />
            <div className="grid2e">
              <div><div className="flabel">On the critical path</div>
                <ul className="dc-list">{H.critical.slice(0, 8).map((x) => (<li key={x.task.id}><span><b className="mono">{x.task.code}</b> {x.task.name}</span><span className="mono">{x.sprint.name}</span></li>))}{!H.critical.length && <li className="msg">None yet.</li>}</ul>
              </div>
              <div><div className="flabel">Blocked now</div>
                <ul className="dc-list">{H.blocked.slice(0, 8).map((x) => (<li key={x.t.id}><span><b className="mono">{x.t.code}</b> {x.t.name}</span><span className="mono">{x.c.name}</span></li>))}{!H.blocked.length && <li className="msg">Nothing is blocked.</li>}</ul>
              </div>
            </div>
          </>
        ) : <Empty>No dependencies yet. Add them from a work item or a sprint’s Dependencies tab.</Empty>}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------------- Cost */
export function CostSection() {
  const { S } = useStore();
  const asOf = today();
  const E = projectEvm(S, asOf);
  const els = useMemo(() => costByElement(S), [S]);
  const sc = useMemo(() => eacScenarios(S, asOf), [S, asOf]);
  const perf = useMemo(() => sprintPerformance(S, asOf), [S, asOf]);
  const max = sc ? Math.max(sc.total, sc.bac, ...sc.list.map((x) => x.eac)) * 1.08 : 0;
  const tiles = [
    { l: 'Budget at completion', v: money(E.bac), s: 'Work budget plus contingency' },
    { l: 'Spent so far', v: money(E.ac), s: pc(E.pctSpent, 0) + ' of the budget' },
    { l: 'Forecast at completion', v: E.eac == null ? '–' : money(Math.round(E.eac)), s: E.vac == null ? 'Needs actual cost' : (E.vac >= 0 ? 'Under' : 'Over') + ' budget by ' + money(Math.abs(Math.round(E.vac))), c: E.vac != null && E.vac < 0 ? COL.bad : undefined },
    { l: 'Cost needed from here', v: E.tcpi == null ? '–' : pc(E.tcpi, 0), s: 'TCPI: the efficiency needed to finish on budget', c: E.tcpi > 1.1 ? COL.bad : E.tcpi > 1 ? COL.warn : undefined },
  ];
  return (
    <div className="dc-sec">
      <Big items={tiles} />
      <Card title="Budget against actual cost" hint="Planned cost and cost spent so far, for each cost element.">
        {els.length ? (
          <>
            <BarChart cats={els.map((e) => ({ label: e.name, values: [e.planned, e.actual] }))} series={[{ name: 'Planned', color: COL.pv }, { name: 'Actual so far', color: COL.ac }]} fmt={(v) => money(v)} axisFmt={kf} label="Budget and actual cost by cost element" />
            <Legend items={[{ name: 'Planned (whole project)', color: COL.pv }, { name: 'Actual so far', color: COL.ac }]} />
          </>
        ) : <Empty>No budget lines or cost entries yet.</Empty>}
      </Card>

      <div className="grid2e">
        <Card title="Forecast at completion: three views" hint="PMI gives three ways to forecast the final cost, depending on what you expect from here. The line is the budget at completion.">
          {sc ? (
            <>
              <HBars max={max} mark={sc.bac} markLabel="Budget at completion"
                rows={sc.list.map((x) => ({ label: x.name, sub: x.f, parts: [{ v: x.eac, color: x.eac > sc.total ? COL.bad : x.eac > sc.bac ? COL.warn : COL.good, title: money(Math.round(x.eac)) }], text: money(Math.round(x.eac)) }))} label="Estimate at completion scenarios" />
              <p className="dc-note">Green is within the budget, amber uses the management reserve, red is beyond the total project budget of <b>{money(sc.total)}</b>.</p>
            </>
          ) : <Empty>Needs a plan with planned hours.</Empty>}
        </Card>
        <Card title="Variance by sprint" hint="Schedule variance (earned − planned) and cost variance (earned − actual). Below zero is behind or over budget.">
          {perf.length ? (
            <>
              <BarChart cats={perf.map((p) => ({ label: p.name, values: [p.sv, p.cv == null ? null : p.cv] }))} series={[{ name: 'Schedule variance', color: COL.ev }, { name: 'Cost variance', color: COL.ac }]} fmt={(v) => money(Math.round(v))} axisFmt={kf} label="Schedule and cost variance per sprint" w={470} height={250} />
              <Legend items={[{ name: 'Schedule variance', color: COL.ev }, { name: 'Cost variance', color: COL.ac }]} />
            </>
          ) : <Empty>No sprint is in the plan yet.</Empty>}
        </Card>
      </div>

      <Card title="Planned, earned and actual by sprint" hint="The three earned-value measures for every sprint, as of today.">
        {perf.length ? (
          <>
            <BarChart cats={perf.map((p) => ({ label: p.name, values: [p.pv, p.ev, p.ac] }))} series={[{ name: 'Planned (PV)', color: COL.pv }, { name: 'Earned (EV)', color: COL.ev }, { name: 'Actual (AC)', color: COL.ac }]} fmt={(v) => money(Math.round(v))} axisFmt={kf} label="Planned, earned and actual cost per sprint" />
            <Legend items={[{ name: 'Planned (PV)', color: COL.pv }, { name: 'Earned (EV)', color: COL.ev }, { name: 'Actual (AC)', color: COL.ac }]} />
          </>
        ) : <Empty>No sprint is in the plan yet.</Empty>}
      </Card>
    </div>
  );
}
