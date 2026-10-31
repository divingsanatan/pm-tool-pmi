import { useStore } from '../store/StoreContext';
import { fdate, today } from '../lib/dates';
import { calendarOf, hasValidDates, WEEKDAYS_SHORT } from '../lib/offdays';
import { capacityInsights, dayStates, leaveMap, projectCapacity, sprintCapacity } from '../lib/capacity';
import { hrsf } from '../lib/format';
import '../capacity.css';

const r1 = (n) => Math.round(n * 10) / 10;
const h = (n) => hrsf(r1(n)) + ' h';
const pct = (u) => (u === Infinity ? '∞' : Math.round(u * 100) + '%');

/* ---------- Off days of every stakeholder (inside the sprint's Off days card) ---------- */
export function StakeholderOffDays({ c }) {
  const { S, setNav } = useStore();
  if (!hasValidDates(c) || !S.people.length) return null;
  const cal = calendarOf(S), now = today();
  const rows = S.people.map((p) => {
    const days = dayStates(S, p, c.start, c.end, cal, leaveMap(p));
    const full = days.filter((d) => d.state === 'leave').length, half = days.filter((d) => d.state === 'half').length;
    return { p, days, full, half, away: full + half * 0.5 };
  });
  const n = rows[0].days.length;
  if (n > 62) return <p className="hint" style={{ marginTop: 12 }}>This sprint is longer than 62 days, so the stakeholder calendar is not drawn. Leave is still counted in the capacity plan.</p>;
  const totalAway = rows.reduce((a, r) => a + r.away, 0), people = rows.filter((r) => r.away > 0).length;

  return (
    <div className="sd-wrap">
      <div className="row sp" style={{ alignItems: 'baseline', margin: '16px 0 6px' }}>
        <div className="flabel" style={{ margin: 0 }}>
          Stakeholder leave · {totalAway ? (Math.round(totalAway * 10) / 10) + ' person-day' + (totalAway === 1 ? '' : 's') + ' across ' + people + ' stakeholder' + (people === 1 ? '' : 's') : 'nobody is on leave in this sprint'}
        </div>
        <button className="linkbtn" onClick={() => setNav({ view: 'project', tab: 'people' })}>Edit leave</button>
      </div>
      <div className="scroll">
        <div className="sd-grid" style={{ gridTemplateColumns: 'minmax(110px,150px) repeat(' + n + ', minmax(26px,1fr)) 40px' }} role="table" aria-label="Stakeholder leave in this sprint">
          <div className="sd-name" />
          {rows[0].days.map((d) => (
            <div key={d.date} className={'sd-h' + (d.date === now ? ' today' : '') + (d.dow === 0 || d.dow === 6 ? ' we' : '')}><span>{WEEKDAYS_SHORT[d.dow][0]}</span><b>{d.day}</b></div>
          ))}
          <div className="sd-h sd-sum">Off</div>
          {rows.map((r) => (
            <div key={r.p.id} style={{ display: 'contents' }} role="row">
              <div className="sd-name" title={r.p.name}>{r.p.name || '(unnamed)'}</div>
              {r.days.map((d) => (
                <div
                  key={d.date}
                  className={'sd-c ' + d.state + (d.date === now ? ' today' : '')}
                  title={(r.p.name || 'Stakeholder') + ' · ' + fdate(d.date) + ' · ' + (d.state === 'work' ? 'working day' : d.label)}
                  role="cell"
                  aria-label={(r.p.name || 'Stakeholder') + ' ' + fdate(d.date) + ': ' + (d.state === 'work' ? 'working' : d.state === 'half' ? 'half day leave' : d.state === 'leave' ? 'on leave' : 'team off day')}
                >
                  {d.state === 'leave' ? '✕' : d.state === 'half' ? '½' : ''}
                </div>
              ))}
              <div className={'sd-sum mono' + (r.away ? ' hot' : '')}>{r.away ? Math.round(r.away * 10) / 10 : '–'}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="lv-legend">
        <span><i className="lv-k leave" /> On leave: no work can be allocated</span>
        <span><i className="lv-k half" /> Half day</span>
        <span><i className="lv-k weekly" /> Team off day</span>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
function Stat({ l, v, s, cls = '', title }) {
  return (
    <div className={'cp-stat ' + cls} title={title}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      {s != null && <div className="s">{s}</div>}
    </div>
  );
}

// The bar runs to 125% of capacity; the tick marks 100%. Anything past the tick is overload.
function UtilBar({ util, cls, label }) {
  const w = util === Infinity ? 125 : Math.min(125, util * 100);
  return (
    <div className="cp-util">
      <div className="cp-track" role="img" aria-label={label}>
        <i className={cls} style={{ width: (w / 125) * 100 + '%' }} />
        <u />
      </div>
      <span className="mono">{pct(util)}</span>
    </div>
  );
}


/* ---------- Capacity plan of one sprint (Sprint dashboard) ---------- */
export function SprintCapacity({ c }) {
  const { S, setNav } = useStore();
  const X = sprintCapacity(S, c, today());
  if (!X) return null;
  const tips = capacityInsights(X);
  const none = !X.rows.length;
  const st = X.status;
  const gross = X.rows.reduce((a, r) => a + r.gross, 0);

  return (
    <div className="card cp-card">
      <div className="row sp" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 className="sp-h" style={{ margin: 0 }}>Capacity plan <span className={'pill ' + st.cls}>{st.label}</span></h3>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            What the team can really do in this sprint, against the work assigned. <b>Capacity = available days × hours per day × focus factor × allocation</b>; leave and
            team off days are not available days. A work item&apos;s hours are shared equally between its assignees.
          </p>
        </div>
        <button className="btn" onClick={() => setNav({ view: 'project', tab: 'people' })}>Capacity settings</button>
      </div>

      {none ? (
        <p className="msg" style={{ marginTop: 12 }}>No capacity yet. Give stakeholders an allocation % (and, if needed, hours per day and focus factor) on the Stakeholders tab, and assign them work items.</p>
      ) : (
        <>
          <div className="cp-stats">
            <Stat l="Effective capacity" v={h(X.cap)} s={h(gross) + ' working hours × focus × allocation'} title="Hours the team can deliver in this sprint after leave, focus factor and allocation" />
            <Stat l="Assigned work" v={h(X.load)} s={X.unassigned > 0.05 ? '+ ' + h(X.unassigned) + ' not assigned yet' : 'all work is assigned'} />
            <Stat l="Utilisation" v={pct(X.util)} cls={X.util > 1.0005 ? 'bad' : X.util >= 0.85 ? 'warn' : 'good'} s={X.free >= 0 ? h(X.free) + ' free' : h(-X.free) + ' over'} />
            <Stat l="Leave impact" v={X.lostCap > 0.05 ? '−' + h(X.lostCap) : 'None'} cls={X.lostCap > 0.05 ? 'warn' : ''} s={X.leaveDays ? r1(X.leaveDays) + ' person-day' + (X.leaveDays === 1 ? '' : 's') + ' away' : 'nobody on leave'} />
            <Stat
              l="Plan vs capacity"
              v={X.planned == null ? '–' : h(X.planned)}
              cls={X.planGap != null && X.planGap > 0.5 ? 'bad' : X.planned != null ? 'good' : ''}
              s={X.planned == null ? 'no planned hours typed' : X.planGap > 0.5 ? 'plan is ' + h(X.planGap) + ' above capacity' : 'plan fits the capacity'}
              title="The sprint's planned hours compared with what the team can actually do"
            />
          </div>

          <div className="flabel" style={{ margin: '14px 0 6px' }}>By stakeholder</div>
          <div className="scroll">
            <table className="tbl rwd cp-tbl">
              <thead>
                <tr>
                  <th>Stakeholder</th>
                  <th className="r">Hours / day</th>
                  <th className="r">Days available</th>
                  <th className="r">Capacity</th>
                  <th className="r">Assigned</th>
                  <th>Utilisation</th>
                  <th>Status</th>
                  <th className="r">From today</th>
                </tr>
              </thead>
              <tbody>
                {X.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-l="Stakeholder"><span className="cell"><b>{r.name}</b></span></td>
                    <td data-l="Hours / day" className="r mono"><span className="cell" title={r.hpd + ' h × ' + (Math.round(r.focus * 100) / 100) + ' focus × ' + Math.round(r.alloc * 100) + '% allocation'}>{r.perDay > 0 ? r1(r.perDay) : '–'}</span></td>
                    <td data-l="Days available" className="r mono"><span className="cell" title={r.workDays + ' working days − ' + r.leaveFull + ' leave' + (r.leaveHalf ? ' − ' + r.leaveHalf + ' half day' + (r.leaveHalf === 1 ? '' : 's') : '')}>{r1(r.availDays)} <span className="msg">of {r.workDays}</span></span></td>
                    <td data-l="Capacity" className="r mono"><span className="cell">{h(r.cap)}</span></td>
                    <td data-l="Assigned" className="r mono"><span className="cell">{h(r.load)}</span></td>
                    <td data-l="Utilisation"><UtilBar util={r.cap > 0 ? r.util : 0} cls={r.status.cls} label={r.name + ' utilisation ' + pct(r.util)} /></td>
                    <td data-l="Status"><span className={'pill ' + r.status.cls}>{r.status.label}</span></td>
                    <td data-l="From today" className="r mono">
                      <span className="cell" title="Open work ÷ capacity left from today to the end of the sprint">
                        {r.remCap > 0 || r.open > 0 ? h(r.open) + ' ÷ ' + h(r.remCap) : '–'}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="tot">
                  <td data-l="Team"><span className="cell"><b>Team</b></span></td>
                  <td></td><td></td>
                  <td data-l="Capacity" className="r mono"><span className="cell"><b>{h(X.cap)}</b></span></td>
                  <td data-l="Assigned" className="r mono"><span className="cell"><b>{h(X.load)}</b></span></td>
                  <td data-l="Utilisation"><UtilBar util={X.util === Infinity ? Infinity : X.util} cls={X.status.cls} label={'Team utilisation ' + pct(X.util)} /></td>
                  <td></td>
                  <td data-l="From today" className="r mono"><span className="cell">{X.remCap > 0 || X.open > 0 ? h(X.open) + ' ÷ ' + h(X.remCap) : '–'}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          {tips.length > 0 && (
            <ul className="cp-tips" aria-label="Capacity insights">
              {tips.map((t, i) => (<li key={i} className={t.cls}><span aria-hidden="true">{t.cls === 'bad' ? '!' : t.cls === 'warn' ? '!' : t.cls === 'good' ? '✓' : 'i'}</span>{t.text}</li>))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Capacity outlook for the whole project (Dashboard) ---------- */
export function ProjectCapacity() {
  const { S, setNav } = useStore();
  const P = projectCapacity(S, today());
  if (!P.sprints.length || !(P.cap > 0 || P.load > 0)) return null;
  const maxH = Math.max(1, ...P.sprints.map((x) => Math.max(x.cap, x.totalLoad)));
  const tips = P.sprints
    .flatMap((x) => capacityInsights(x).filter((t) => t.cls === 'bad' || t.cls === 'warn').map((t) => ({ ...t, sp: x.sp.name })))
    .sort((a, b) => (a.cls === b.cls ? 0 : a.cls === 'bad' ? -1 : 1))
    .slice(0, 6);
  const cls = P.util > 1.0005 ? 'bad' : P.util >= 0.85 ? 'warn' : 'good';

  return (
    <section className="card cp-card">
      <div className="row sp" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>Capacity outlook</h2>
          <p className="hint" style={{ margin: '4px 0 0' }}>Capacity (after leave, focus factor and allocation) against assigned work, sprint by sprint and person by person.</p>
        </div>
        <button className="btn" onClick={() => setNav({ view: 'project', tab: 'people' })}>Capacity and leave</button>
      </div>

      <div className="cp-stats">
        <Stat l="Capacity, all sprints" v={h(P.cap)} s={P.sprints.length + ' sprint' + (P.sprints.length === 1 ? '' : 's') + ' with dates'} />
        <Stat l="Assigned work" v={h(P.load)} s={P.unassigned > 0.05 ? '+ ' + h(P.unassigned) + ' not assigned' : 'all work is assigned'} />
        <Stat l="Utilisation" v={P.cap > 0 ? pct(P.util) : '–'} cls={P.cap > 0 ? cls : ''} s={P.cap > 0 ? (P.cap - P.load >= 0 ? h(P.cap - P.load) + ' free' : h(P.load - P.cap) + ' over') : 'no capacity set'} />
        <Stat l="Over-capacity cases" v={String(P.over)} cls={P.over ? 'bad' : 'good'} s={P.over ? 'person-sprints above 100%' : 'nobody overloaded'} />
        <Stat l="Leave, next 30 days" v={P.upcomingDays ? (Math.round(P.upcomingDays * 10) / 10) + ' day' + (P.upcomingDays === 1 ? '' : 's') : 'None'} cls={P.upcomingDays ? 'warn' : ''} s={P.upcoming.length ? P.upcoming.map((u) => u.name + ' ' + u.days).join(' · ') : 'nobody away'} />
      </div>

      <div className="flabel" style={{ margin: '16px 0 6px' }}>Capacity and work by sprint</div>
      <div className="cp-sprints">
        {P.sprints.map((x) => (
          <div key={x.sp.id} className="cp-srow">
            <div className="nm"><b>{x.sp.name}</b><span className="msg">{fdate(x.sp.start)} – {fdate(x.sp.end)}</span></div>
            <div className="bars" role="img" aria-label={x.sp.name + ': ' + h(x.totalLoad) + ' of work against ' + h(x.cap) + ' of capacity'}>
              <div className="cap" style={{ width: (x.cap / maxH) * 100 + '%' }} title={'Capacity ' + h(x.cap)} />
              <div className={'load ' + x.status.cls} style={{ width: (x.load / maxH) * 100 + '%' }} title={'Assigned ' + h(x.load)} />
              {x.unassigned > 0.05 && <div className="unas" style={{ width: (x.unassigned / maxH) * 100 + '%', left: (x.load / maxH) * 100 + '%' }} title={'Not assigned ' + h(x.unassigned)} />}
            </div>
            <div className="tx mono">{h(x.totalLoad)} / {h(x.cap)} <span className={'pill ' + x.status.cls}>{x.cap > 0 ? pct(x.teamUtil) : x.status.label}</span></div>
          </div>
        ))}
      </div>
      <div className="lv-legend">
        <span><i className="cp-k cap" /> Capacity</span>
        <span><i className="cp-k load" /> Assigned work</span>
        <span><i className="cp-k unas" /> Not assigned yet</span>
      </div>

      {P.people.length > 0 && (
        <>
          <div className="flabel" style={{ margin: '16px 0 6px' }}>Utilisation by stakeholder and sprint</div>
          <div className="scroll">
            <table className="tbl cp-heat">
              <thead><tr><th>Stakeholder</th>{P.sprints.map((x) => <th key={x.sp.id} className="r">{x.sp.name}</th>)}</tr></thead>
              <tbody>
                {P.people.map((p) => (
                  <tr key={p.id}>
                    <td><span className="cell"><b>{p.name}</b></span></td>
                    {p.cells.map((r, i) => (
                      <td key={i} className="r">
                        {r ? (
                          <span className={'cp-cell ' + r.status.cls} title={r.name + ' · ' + P.sprints[i].sp.name + ': ' + h(r.load) + ' of ' + h(r.cap) + (r.leaveFull + r.leaveHalf ? ' · ' + (r.leaveFull + r.leaveHalf * 0.5) + ' leave day(s)' : '')}>
                            {r.cap > 0 ? pct(r.util) : r.load > 0 ? 'no cap.' : '–'}
                            {r.leaveFull + r.leaveHalf > 0 && <sup>{r.leaveFull + r.leaveHalf * 0.5}d</sup>}
                          </span>
                        ) : <span className="msg">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="msg" style={{ margin: '6px 0 0' }}>Green is healthy (50–85%), amber is near the limit, red is over capacity, grey has room to take more. A small figure shows leave days in that sprint.</p>
        </>
      )}

      {tips.length > 0 && (
        <ul className="cp-tips" aria-label="Capacity warnings">
          {tips.map((t, i) => (<li key={i} className={t.cls}><span aria-hidden="true">!</span><b>{t.sp}:</b>&nbsp;{t.text}</li>))}
        </ul>
      )}
    </section>
  );
}
