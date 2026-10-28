import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell } from './Field';
import { fdate, today } from '../lib/dates';
import { uid } from '../lib/tasks';
import { WEEKDAYS_SHORT, WEEK_ORDER, calendarOf, okDate, sprintCalendar } from '../lib/offdays';

// The project's working calendar: weekdays the team always rests, and holidays. Both apply to every sprint,
// so planned % and planned value count working days only. Days off for one sprint only are marked on that sprint.
export default function WorkCalendar() {
  const { S, update } = useStore();
  const cal = calendarOf(S);
  const hols = S.holidays || [];
  const [f, setF] = useState({ label: '', from: '', to: '' });
  const weekly = cal.weekly;
  const toggleDay = (d) =>
    update((p) => {
      const cur = Array.isArray(p.meta.weeklyOff) ? p.meta.weeklyOff : [];
      p.meta.weeklyOff = cur.includes(d) ? cur.filter((x) => x !== d) : cur.concat(d);
    });
  const patchHol = (id, patch) =>
    update((p) => {
      const h = (p.holidays || []).find((x) => x.id === id);
      if (h) Object.assign(h, patch);
    });
  const addOk = okDate(f.from) && (!f.to || (okDate(f.to) && f.to >= f.from));
  const add = () => {
    if (!addOk) return;
    update((p) => {
      if (!Array.isArray(p.holidays)) p.holidays = [];
      p.holidays.push({ id: uid(), label: f.label.trim() || 'Holiday', from: f.from, to: f.to && f.to !== f.from ? f.to : '' });
      p.holidays.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    });
    setF({ label: '', from: '', to: '' });
  };
  const remove = (id) => update((p) => void (p.holidays = (p.holidays || []).filter((x) => x.id !== id)));
  const rows = S.sprints.map((sp) => ({ sp, c: sprintCalendar(sp, null, cal) })).filter((r) => r.c);
  const key = (e) => e.key === 'Enter' && e.target.tagName !== 'SELECT' && add();

  return (
    <div className="card">
      <h2>Working calendar</h2>
      <p className="hint">
        Set the days the team does not work once, and every sprint follows. Planned %, planned value, SPI and the Dashboard count <b>working days</b> only (calendar days − off days).
        A day off for one sprint only (team leave, an event) is marked on that sprint's Dashboard tab instead.
      </p>

      <div className="flabel" style={{ margin: '4px 0 6px' }}>Weekly off days</div>
      <div className="chips" role="group" aria-label="Weekly off days">
        {WEEK_ORDER.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={weekly.includes(d)} onClick={() => toggleDay(d)}>{WEEKDAYS_SHORT[d]}</button>
        ))}
      </div>
      <p className="msg" style={{ margin: '6px 0 0' }}>{weekly.length ? 'The team rests every ' + weekly.map((d) => WEEKDAYS_SHORT[d]).join(', ') + '.' : 'No weekly off day: every weekday counts as a working day.'}</p>

      <div className="flabel" style={{ margin: '16px 0 6px' }}>Holidays and shutdowns</div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Name</th><th>From</th><th>To (optional)</th><th className="r"></th></tr></thead>
          <tbody>
            {hols.map((h) => (
              <tr key={h.id}>
                <td data-l="Name"><Cell value={h.label} type="text" label="Holiday name" onCommit={(v) => patchHol(h.id, { label: v })} /></td>
                <td data-l="From"><Cell value={h.from} type="date" cls="w-date" label="Holiday start" onCommit={(v) => v && okDate(v) && patchHol(h.id, { from: v, ...(h.to && h.to < v ? { to: '' } : {}) })} /></td>
                <td data-l="To"><Cell value={h.to} type="date" cls="w-date" label="Holiday end" onCommit={(v) => patchHol(h.id, { to: v && okDate(v) && v >= h.from ? v : '' })} /></td>
                <td data-l="" className="r"><button className="x" onClick={() => remove(h.id)} aria-label={'Remove ' + (h.label || 'holiday')} title="Remove">✕</button></td>
              </tr>
            ))}
            {!hols.length && <tr className="empty-row"><td colSpan="4"><span className="cell msg">No holidays added yet.</span></td></tr>}
            <tr>
              <td data-l="Name"><input className="c" placeholder="e.g. Diwali" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} onKeyDown={key} aria-label="New holiday name" /></td>
              <td data-l="From"><input className="c w-date" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} onKeyDown={key} aria-label="New holiday start" /></td>
              <td data-l="To"><input className="c w-date" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} onKeyDown={key} aria-label="New holiday end" /></td>
              <td data-l="" className="r"><button className="btn primary" disabled={!addOk} onClick={add}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="msg" style={{ margin: '6px 0 0' }}>A holiday can be one day (leave “To” empty) or a range. Holidays outside every sprint change nothing.</p>

      {rows.length > 0 && (
        <>
          <div className="flabel" style={{ margin: '16px 0 6px' }}>Effect on each sprint · as of {fdate(today())}</div>
          <div className="scroll">
            <table className="tbl rwd">
              <thead><tr><th>Sprint</th><th className="r">Calendar days</th><th className="r">Weekly off</th><th className="r">Holidays</th><th className="r">Sprint-only off</th><th className="r">Working days</th></tr></thead>
              <tbody>
                {rows.map(({ sp, c }) => (
                  <tr key={sp.id}>
                    <td data-l="Sprint"><span className="cell"><b>{sp.name}</b></span></td>
                    <td data-l="Calendar days" className="r mono"><span className="cell">{c.cal}</span></td>
                    <td data-l="Weekly off" className="r mono"><span className="cell">{c.offWeekly}</span></td>
                    <td data-l="Holidays" className="r mono"><span className="cell">{c.offHoliday}</span></td>
                    <td data-l="Sprint-only off" className="r mono"><span className="cell">{c.offOwn}</span></td>
                    <td data-l="Working days" className="r mono"><span className="cell"><b>{c.work}</b></span></td>
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
