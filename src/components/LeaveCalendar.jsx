import { useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell } from './Field';
import { fdate, today } from '../lib/dates';
import { calendarOf, okDate, WEEKDAYS_SHORT } from '../lib/offdays';
import { LEAVE_TYPES, datesBetween, dayStates, leaveMap, leaveTypeLabel, onDeliveryTeam, projectDefaults, rangeText, setLeaveDays, settingsOf } from '../lib/capacity';
import { hrsf } from '../lib/format';
import '../capacity.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TYPE_MARK = { leave: 'L', sick: 'S', training: 'T', other: 'O' };

// Hours per day, allocation and focus factor: set once for the project, then overridden per person where needed.
// Total hours per day = hours per day x allocation.  Effective hours per day = total hours per day x focus factor.
export function PeopleCapacity() {
  const { S, update } = useStore();
  const D = projectDefaults(S);
  const setDefault = (patch) =>
    update((p) => {
      Object.keys(patch).forEach((k) => (patch[k] == null ? delete p.meta[k] : (p.meta[k] = patch[k])));
    });
  const set = (id, patch) =>
    update((p) => {
      const x = p.people.find((q) => q.id === id);
      if (!x) return;
      Object.keys(patch).forEach((k) => (patch[k] == null ? delete x[k] : (x[k] = patch[k])));
    });
  const all = S.people.map((p) => ({ p, st: settingsOf(S, p), team: onDeliveryTeam(S, p) }));
  const team = all.filter((r) => r.team), others = all.filter((r) => !r.team);
  const teamPerDay = team.reduce((a, r) => a + r.st.perDay, 0);
  const teamTotalDay = team.reduce((a, r) => a + r.st.hpd * r.st.alloc, 0);

  const row = ({ p, st }) => (
    <tr key={p.id}>
      <td data-l="Stakeholder"><span className="cell"><b>{p.name || '(unnamed)'}</b>{p.role ? <span className="msg"> · {p.role}</span> : null}</span></td>
      <td data-l="Hours per day" className="r">
        <Cell value={p.hpd} type="num" cls="w-sm n" placeholder={String(D.hpd)} label={'Working hours per day of ' + p.name} onCommit={(v) => set(p.id, { hpd: v != null && v > 0 ? Math.min(24, v) : null })} />
        <div className={'inh' + (st.customHpd ? ' own' : '')}>{st.customHpd ? <>own value · <button type="button" className="linkbtn" onClick={() => set(p.id, { hpd: null })}>use default</button></> : 'follows project default (' + D.hpd + ')'}</div>
      </td>
      <td data-l="Allocation" className="r">
        <Cell value={p.cap} type="pct" cls="w-sm n" label={'Allocation to this project of ' + p.name} onCommit={(v) => set(p.id, { cap: v == null ? 0 : Math.max(0, v) })} />
      </td>
      <td data-l="Total hours / day" className="r mono">
        <span className={'cell' + (st.hpd * st.alloc > 0 ? '' : ' msg')} title={st.hpd + ' h × ' + Math.round(st.alloc * 100) + '% allocation'}>
          {st.hpd * st.alloc > 0 ? <b>{hrsf(Math.round(st.hpd * st.alloc * 100) / 100)} h</b> : '–'}
        </span>
      </td>
      <td data-l="Focus factor" className="r">
        <Cell value={p.focus} type="factor" cls="w-sm n" placeholder={String(Math.round(D.focus * 100) / 100)} label={'Focus factor of ' + p.name} onCommit={(v) => set(p.id, { focus: v == null ? null : Math.max(0, Math.min(1, v)) })} />
        <div className={'inh' + (st.customFocus ? ' own' : '')}>{st.customFocus ? <>own value · <button type="button" className="linkbtn" onClick={() => set(p.id, { focus: null })}>use default</button></> : 'follows project default (' + (Math.round(D.focus * 100) / 100) + ')'}</div>
      </td>
      <td data-l="Effective hours / day" className="r mono">
        <span className={'cell' + (st.perDay > 0 ? '' : ' msg')} title={hrsf(Math.round(st.hpd * st.alloc * 100) / 100) + ' h total × ' + (Math.round(st.focus * 100) / 100) + ' focus factor'}>
          {st.perDay > 0 ? <b>{hrsf(Math.round(st.perDay * 100) / 100)} h</b> : 'Set an allocation'}
        </span>
      </td>
    </tr>
  );

  return (
    <div className="card">
      <h2>Capacity and availability</h2>
      <p className="hint">
        Set the project default once; everybody follows it and updates when it changes. Type a value on a person only where they differ (part-time, shift work, a role with more meetings); “use default” takes them back to following the project default.
        <b> Total hours per day = hours per day × allocation. Effective hours per day = total hours per day × focus factor.</b> Focus factor is a number from 0 to 1 with up to 2 decimals (0.8 = 80% of the day is productive work, 1 = full focus). It is the share of the day that goes to productive work (meetings, email and context switching take the rest).
        Allocation is the share of their time given to this project and is the same number as the Capacity % in the Budget.
      </p>

      <div className="cp-defaults">
        <div className="flabel" style={{ margin: 0 }}>Project default</div>
        <label className="fld">Hours per day
          <Cell value={S.meta.hoursPerDay} type="num" cls="w-sm n" placeholder="8" label="Project default working hours per day" onCommit={(v) => setDefault({ hoursPerDay: v != null && v > 0 ? Math.min(24, v) : null })} />
        </label>
        <label className="fld">Focus factor (0–1)
          <Cell value={S.meta.focus} type="factor" cls="w-sm n" placeholder="0.8" label="Project default focus factor" onCommit={(v) => setDefault({ focus: v == null ? null : Math.max(0, Math.min(1, v)) })} />
        </label>
        <span className="msg">= {Math.round(D.hpd * D.focus * 100) / 100} productive hours per day at 100% allocation. Hours per day is the same figure the Budget uses.</span>
        {D.focus < 0.1 && <span className="msg lateTxt">A focus factor of {Math.round(D.focus * 100) / 100} is very low. Use 1 for full focus or 0.8 for 80%.</span>}
      </div>

      <div className="flabel" style={{ margin: '14px 0 6px' }}>Delivery team · {team.length}</div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead>
            <tr>
              <th>Stakeholder</th>
              <th className="r">Hours per day</th>
              <th className="r">Allocation %</th>
              <th className="r">Total hours / day</th>
              <th className="r">Focus factor</th>
              <th className="r">Effective hours / day</th>
            </tr>
          </thead>
          <tbody>
            {team.map(row)}
            {!team.length && <tr className="empty-row"><td colSpan="6"><span className="cell msg">{all.length ? 'Nobody has an allocation yet. Open “Not on the delivery team” below and give people an allocation %.' : 'Add stakeholders above first.'}</span></td></tr>}
            {team.length > 0 && (
              <tr className="tot">
                <td data-l="Team"><span className="cell"><b>Team</b></span></td>
                <td></td><td></td>
                <td data-l="Total hours / day" className="r mono"><span className="cell"><b>{hrsf(Math.round(teamTotalDay * 100) / 100)} h</b></span></td>
                <td></td>
                <td data-l="Effective hours / day" className="r mono"><span className="cell"><b>{hrsf(Math.round(teamPerDay * 100) / 100)} h</b></span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {others.length > 0 && (
        <details className="cp-others">
          <summary>Not on the delivery team · {others.length}</summary>
          <p className="msg" style={{ margin: '6px 0' }}>No allocation and no assigned work, so they are left out of the capacity planner (sponsors, customers, people who only need to be informed). Give someone an allocation % to bring them in.</p>
          <div className="scroll">
            <table className="tbl rwd">
              <thead><tr><th>Stakeholder</th><th className="r">Hours per day</th><th className="r">Allocation %</th><th className="r">Total hours / day</th><th className="r">Focus factor</th><th className="r">Effective hours / day</th></tr></thead>
              <tbody>{others.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// Month grid: one row per stakeholder, one column per day. Click a day to cycle  working > leave > half day > working.
// Weekly off days and holidays are set once for everybody (above) and are locked here.
export default function LeaveCalendar() {
  const { S, update } = useStore();
  const t0 = today();
  const [ym, setYm] = useState({ y: +t0.slice(0, 4), m: +t0.slice(5, 7) - 1 });
  const [f, setF] = useState({ person: '', from: '', to: '', type: 'leave', half: false, label: '' });
  const cal = useMemo(() => calendarOf(S), [S]);
  const nDays = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const first = new Date(Date.UTC(ym.y, ym.m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(ym.y, ym.m, nDays)).toISOString().slice(0, 10);
  const move = (d) => setYm((c) => { const t = new Date(Date.UTC(c.y, c.m + d, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });

  const grid = S.people.map((p) => {
    const lm = leaveMap(p);
    return { p, days: dayStates(S, p, first, last, cal, lm), lm };
  });
  const monthLeave = (g) => g.days.reduce((a, d) => a + (d.state === 'leave' ? 1 : d.state === 'half' ? 0.5 : 0), 0);

  const cycle = (pid, d) => {
    update((s) => {
      const per = s.people.find((x) => x.id === pid);
      if (!per) return;
      const cur = leaveMap(per).get(d.date);
      if (!cur) setLeaveDays(per, [d.date], 'full');
      else if (!cur.half) setLeaveDays(per, [d.date], 'half');
      else setLeaveDays(per, [d.date], null);
    });
  };

  const addOk = f.person && okDate(f.from) && (!f.to || (okDate(f.to) && f.to >= f.from));
  const add = () => {
    if (!addOk) return;
    update((s) => {
      const per = s.people.find((x) => x.id === f.person);
      if (per) setLeaveDays(per, datesBetween(f.from, f.to || f.from), f.half ? 'half' : 'full', { type: f.type, label: f.label.trim() });
    });
    const goTo = f.from;
    setF({ ...f, from: '', to: '', label: '' });
    setYm({ y: +goTo.slice(0, 4), m: +goTo.slice(5, 7) - 1 });
  };
  const remove = (pid, id) => update((s) => { const per = s.people.find((x) => x.id === pid); if (per) per.leaves = (per.leaves || []).filter((l) => l.id !== id); });

  // every leave entry of every person, upcoming first, with the working days it takes out
  const list = S.people
    .flatMap((p) => (p.leaves || []).map((l) => ({ p, l })))
    .filter(({ l }) => okDate(l.from))
    .map((x) => {
      const to = okDate(x.l.to) ? x.l.to : x.l.from;
      const ds = dayStates(S, x.p, x.l.from, to < x.l.from ? x.l.from : to, cal, new Map()).filter((d) => !d.teamOff);
      return { ...x, to, days: ds.length * (x.l.half ? 0.5 : 1) };
    })
    .sort((a, b) => (a.l.from < b.l.from ? -1 : a.l.from > b.l.from ? 1 : 0));
  const key = (e) => e.key === 'Enter' && e.target.tagName !== 'SELECT' && add();

  return (
    <div className="card">
      <h2>Team leave</h2>
      <p className="hint">
        Mark the days each stakeholder is away. On those days <b>no work can be allocated to them</b>: the sprint capacity planner leaves the days out of their capacity, and a work item cannot be assigned to someone who is on leave for all of its dates.
        Click a day to cycle <b>leave → half day → working</b>, or add a range below. Weekly off days and holidays are shared by everybody and are set in the Working calendar above.
      </p>

      <div className="lv-nav">
        <button className="btn" onClick={() => move(-1)} aria-label="Previous month">‹</button>
        <b className="lv-month">{MONTHS[ym.m]} {ym.y}</b>
        <button className="btn" onClick={() => move(1)} aria-label="Next month">›</button>
        <button className="btn" onClick={() => setYm({ y: +t0.slice(0, 4), m: +t0.slice(5, 7) - 1 })}>Today</button>
      </div>

      {grid.length > 0 && (
        <div className="scroll">
          <div className="lv-grid" style={{ gridTemplateColumns: 'minmax(120px,150px) repeat(' + nDays + ', minmax(26px,1fr)) 44px' }} role="grid" aria-label="Team leave calendar">
            <div className="lv-h lv-name" />
            {Array.from({ length: nDays }, (_, i) => {
              const ms = Date.UTC(ym.y, ym.m, i + 1), dow = new Date(ms).getUTCDay(), date = new Date(ms).toISOString().slice(0, 10);
              return (
                <div key={i} className={'lv-h' + (dow === 0 || dow === 6 ? ' we' : '') + (date === t0 ? ' today' : '')}>
                  <span>{WEEKDAYS_SHORT[dow][0]}</span>
                  <b>{i + 1}</b>
                </div>
              );
            })}
            <div className="lv-h lv-sum">Days</div>
            {grid.map((g) => (
              <div key={g.p.id} className="lv-row" role="row" style={{ display: 'contents' }}>
                <div className="lv-name" title={g.p.name}>{g.p.name || '(unnamed)'}</div>
                {g.days.map((d) => {
                  const lv = g.lm.get(d.date);
                  const txt = d.state === 'leave' ? TYPE_MARK[(lv && lv.type) || 'leave'] : d.state === 'half' ? '½' : '';
                  return (
                    <button
                      key={d.date}
                      type="button"
                      className={'lv-c ' + d.state + (d.date === t0 ? ' today' : '')}
                      disabled={d.teamOff}
                      onClick={() => cycle(g.p.id, d)}
                      title={(g.p.name || 'Stakeholder') + ' · ' + fdate(d.date) + (d.state === 'work' ? ' · working day (click to mark leave)' : ' · ' + d.label + (d.teamOff ? '' : ' (click to change)'))}
                      aria-label={(g.p.name || 'Stakeholder') + ', ' + fdate(d.date) + ': ' + (d.state === 'work' ? 'working' : d.state === 'half' ? 'half day leave' : d.state === 'leave' ? 'on leave' : 'team off day')}
                    >
                      {txt}
                    </button>
                  );
                })}
                <div className="lv-sum mono">{monthLeave(g) || '–'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!grid.length && <p className="msg">Add stakeholders above to plan their leave.</p>}
      <div className="lv-legend">
        <span><i className="lv-k work" /> Working</span>
        <span><i className="lv-k leave" /> Leave (L annual, S sick, T training, O other)</span>
        <span><i className="lv-k half" /> Half day</span>
        <span><i className="lv-k weekly" /> Team off day (weekly off or holiday)</span>
      </div>

      <div className="flabel" style={{ margin: '16px 0 6px' }}>Add leave for a range of days</div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Stakeholder</th><th>From</th><th>To (optional)</th><th>Type</th><th>Half day</th><th>Note</th><th className="r"></th></tr></thead>
          <tbody>
            <tr>
              <td data-l="Stakeholder">
                <select className="c w-md" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} aria-label="Stakeholder on leave">
                  <option value="">Choose…</option>
                  {S.people.map((p) => <option key={p.id} value={p.id}>{p.name || '(unnamed)'}</option>)}
                </select>
              </td>
              <td data-l="From"><input className="c w-date" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} onKeyDown={key} aria-label="Leave starts" /></td>
              <td data-l="To"><input className="c w-date" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} onKeyDown={key} aria-label="Leave ends" /></td>
              <td data-l="Type">
                <select className="c w-md" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type of leave">
                  {LEAVE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </td>
              <td data-l="Half day"><label className="cell"><input type="checkbox" checked={f.half} onChange={(e) => setF({ ...f, half: e.target.checked })} /> Half days</label></td>
              <td data-l="Note"><input className="c w-md" placeholder="e.g. Family trip" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} onKeyDown={key} aria-label="Leave note" /></td>
              <td data-l="" className="r"><button className="btn primary" disabled={!addOk} onClick={add}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      {list.length > 0 && (
        <>
          <div className="flabel" style={{ margin: '16px 0 6px' }}>All leave · {list.length} entr{list.length === 1 ? 'y' : 'ies'}</div>
          <div className="scroll">
            <table className="tbl rwd">
              <thead><tr><th>Stakeholder</th><th>Type</th><th>Dates</th><th className="r">Working days</th><th>Note</th><th className="r"></th></tr></thead>
              <tbody>
                {list.map(({ p, l, to, days }) => (
                  <tr key={p.id + l.id} className={to < t0 ? 'lv-past' : ''}>
                    <td data-l="Stakeholder"><span className="cell"><b>{p.name || '(unnamed)'}</b></span></td>
                    <td data-l="Type"><span className="cell">{leaveTypeLabel(l.type)}{l.half ? ' · half days' : ''}</span></td>
                    <td data-l="Dates"><span className="cell">{fdate(l.from)}{to !== l.from ? ' – ' + fdate(to) : ''}</span></td>
                    <td data-l="Working days" className="r mono"><span className="cell">{days}</span></td>
                    <td data-l="Note"><span className="cell msg">{l.label || '–'}</span></td>
                    <td data-l="" className="r"><button className="x" onClick={() => remove(p.id, l.id)} aria-label={'Remove leave of ' + p.name + ' ' + rangeText(datesBetween(l.from, to))} title="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
