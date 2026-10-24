import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { Cell, SelectCell } from '../components/Field';
import { Modal } from '../components/UI';
import WeeksControl from '../components/WeeksControl';
import { budgetModel, costBy, curWeek, hourly, ledgerTotal, lineWeekly, personOf, sprintCap, sumRange, weekAc, workDaysOf } from '../lib/calc';
import { WEEKDAYS, isoOf } from '../lib/budget';
import { fdate, pd, today } from '../lib/dates';
import { hrsf, money, nz, pc } from '../lib/format';
import { parseCosts } from '../lib/parse';
import { uid } from '../lib/tasks';
import BudgetCalc from './BudgetCalc';

const BASES = [['day', 'Per working day'], ['week', 'Per week'], ['month', 'Per month'], ['sprint', 'Per sprint'], ['project', 'One-time']];
const SPREADS = [['cal', 'Calendar days'], ['work', 'Working days']];
const VIEWS = [['entries', 'Entries'], ['week', 'By week'], ['month', 'By month'], ['sprint', 'By sprint'], ['element', 'By element']];

function PasteCosts({ onClose }) {
  const costs = useCosts();
  const [txt, setTxt] = useState('');
  const { rows, errors } = parseCosts(txt, today());
  return (
    <Modal title="Paste costs from a spreadsheet" onClose={onClose} wide>
      <p className="hint" style={{ marginBottom: 10 }}>
        One cost per line. Columns: <b>date, element, description, amount</b> (description is optional). Tab, comma or semicolon separated, so you can paste straight from Excel or Google Sheets.
        Dates can be YYYY-MM-DD or DD/MM/YYYY.
      </p>
      <textarea className="c paste" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={'2026-10-05\tCloud\tAWS bill\t1250\n12/10/2026\tLicenses\tFigma seats\t300'} aria-label="Pasted costs" autoFocus />
      <div className="msg" style={{ margin: '8px 0' }}>
        {txt.trim() ? `${rows.length} row${rows.length === 1 ? '' : 's'} ready${errors.length ? ` · ${errors.length} skipped` : ''}` : 'Nothing pasted yet.'}
      </div>
      {errors.slice(0, 5).map((e) => (<div key={e.line} className="msg lateTxt">Line {e.line}: {e.why}</div>))}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!rows.length} onClick={() => { costs.addMany(rows); onClose(); }}>Import {rows.length || ''} {rows.length === 1 ? 'cost' : 'costs'}</button>
      </div>
    </Modal>
  );
}

function Ledger() {
  const { S } = useStore();
  const costs = useCosts();
  const [view, setView] = useState('entries');
  const [paste, setPaste] = useState(false);
  const names = Array.from(new Set(['Team labour'].concat(S.lines.map((l) => l.name), S.ledger.map((e) => e.element)).filter(Boolean)));
  const total = ledgerTotal(S);
  const grouped = view === 'entries' ? null : costBy(S, view);
  const gp = grouped ? grouped.reduce((a, r) => a + r.planned, 0) : 0;

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Actual costs</h2>
          <p className="hint">Every cost you record. “Actual cost to date” everywhere in the app is the sum of these entries.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setPaste(true)}>Paste from spreadsheet</button>
          <button className="btn" onClick={costs.sortByDate} disabled={S.ledger.length < 2}>Sort by date</button>
          <button className="btn primary" onClick={() => costs.add()}>+ Add cost</button>
        </div>
      </div>
      <div className="row" style={{ margin: '4px 0 12px', justifyContent: 'space-between' }}>
        <div className="seg" role="group" aria-label="Cost view">
          {VIEWS.map(([id, l]) => (<button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{l}</button>))}
        </div>
        <span className="msg">{S.ledger.length} entr{S.ledger.length === 1 ? 'y' : 'ies'} · <b className="mono">{money(total)}</b> in total</span>
      </div>

      {view === 'entries' ? (
        <div className="scroll">
          <datalist id="cost-elements">{names.map((n) => (<option key={n} value={n} />))}</datalist>
          <table className="tbl rwd">
            <thead><tr><th>Date</th><th>Cost element</th><th>Description</th><th className="r">Amount</th><th></th></tr></thead>
            <tbody>
              {S.ledger.map((e) => (
                <tr key={e.id}>
                  <td data-l="Date"><Cell value={e.date} type="date" cls="w-date" label="Date" onCommit={(v) => costs.patch(e.id, { date: v })} /></td>
                  <td data-l="Element"><Cell value={e.element} cls="w-md" list="cost-elements" placeholder="Element" label="Cost element" onCommit={(v) => costs.patch(e.id, { element: v.trim() })} /></td>
                  <td data-l="Description"><Cell value={e.desc} cls="w-desc" placeholder="Description" label="Description" onCommit={(v) => costs.patch(e.id, { desc: v })} /></td>
                  <td data-l="Amount"><Cell value={e.amount} type="num" cls="w-md n" placeholder="0" label="Amount" onCommit={(v) => costs.patch(e.id, { amount: v })} /></td>
                  <td data-l=""><button className="x" onClick={() => costs.remove(e.id)} aria-label="Delete cost">✕</button></td>
                </tr>
              ))}
              {!S.ledger.length && (<tr className="empty-row"><td colSpan="5"><span className="cell msg">No costs recorded yet. Use “+ Add cost”, or paste rows from a spreadsheet.</span></td></tr>)}
            </tbody>
            {S.ledger.length > 0 && (<tfoot><tr><td colSpan="3">Total actual cost</td><td className="r mono">{money(total)}</td><td></td></tr></tfoot>)}
          </table>
        </div>
      ) : (
        <>
          <div className="scroll">
            <table className="tbl rwd">
              <thead><tr><th>{view === 'week' ? 'Week' : view === 'month' ? 'Month' : view === 'sprint' ? 'Sprint' : 'Cost element'}</th><th className="r">Planned</th><th className="r">Actual</th><th className="r">Variance</th><th style={{ minWidth: 120 }}>Used</th></tr></thead>
              <tbody>
                {grouped.map((r) => {
                  const used = r.planned ? r.actual / r.planned : null;
                  const v = r.planned - r.actual;
                  return (
                    <tr key={r.key}>
                      <td data-l={view === 'week' ? 'Week' : view === 'month' ? 'Month' : view === 'sprint' ? 'Sprint' : 'Element'}><span className="cell"><b>{r.label}</b>{r.sub ? <span className="msg"> · {r.sub}</span> : null}{r.n ? <span className="msg"> · {r.n} entr{r.n === 1 ? 'y' : 'ies'}</span> : null}</span></td>
                      <td data-l="Planned" className="r mono"><span className="cell">{r.planned ? money(r.planned) : '–'}</span></td>
                      <td data-l="Actual" className="r mono"><span className="cell">{r.actual ? money(r.actual) : '–'}</span></td>
                      <td data-l="Variance" className="r mono"><span className="cell" style={r.planned && v < 0 ? { color: 'var(--bad)' } : undefined}>{r.planned || r.actual ? money(v) : '–'}</span></td>
                      <td data-l="Used"><span className="cell" style={{ width: '100%' }}>{used == null ? (r.actual ? <span className="pill warn">Unplanned</span> : '') : (<span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}><span className={'bar ' + (used > 1 ? 'bad' : '')} style={{ flex: 1 }}><i style={{ width: Math.min(100, used * 100) + '%' }} /></span><span className="mono msg">{pc(used, 0)}</span></span>)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Total</td><td className="r mono">{money(gp)}</td><td className="r mono">{money(grouped.reduce((a, r) => a + r.actual, 0))}</td><td className="r mono">{money(gp - grouped.reduce((a, r) => a + r.actual, 0))}</td><td></td></tr></tfoot>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {view === 'element'
              ? 'Planned comes from team labour and your budget line items over the whole project. Costs recorded with a name that is not in the plan show as Unplanned.'
              : 'Planned is the budget of the days that fall in each period: labour on working days plus the line items that run on those days. One-time items with a date land in their period; ones without a date have their own row. The steps are laid out in “How this budget is calculated” below.'}
          </p>
        </>
      )}
      {paste && <PasteCosts onClose={() => setPaste(false)} />}
    </div>
  );
}

// Add someone from the stakeholder list to the labour budget (names are managed on the Stakeholders tab)
function AddLabour({ onClose }) {
  const { S, update, setNav } = useStore();
  const free = S.people.filter((p) => !S.team.some((t) => t.person === p.id));
  const fmtCap = (e) => String(Math.round(nz(e.cap) * 1000) / 10);
  const [pid, setPid] = useState(free[0] ? free[0].id : '');
  const [rate, setRate] = useState(free[0] ? String(free[0].rate == null ? '' : free[0].rate) : '');
  const [cap, setCap] = useState(free[0] ? fmtCap(free[0]) : '100');
  const pick = (id) => {
    setPid(id);
    const e = S.people.find((p) => p.id === id);
    if (e) {
      setRate(String(e.rate == null ? '' : e.rate));
      setCap(fmtCap(e));
    }
  };
  const save = () => {
    if (!pid) return;
    update((p) => {
      const per = p.people.find((x) => x.id === pid);
      if (!per) return;
      if (rate !== '') per.rate = parseFloat(rate) || 0;
      if (cap !== '') per.cap = (parseFloat(cap) || 0) / 100;
      if (!p.team.some((t) => t.person === pid)) p.team.push({ person: pid });
    });
    onClose();
  };
  if (!free.length)
    return (
      <Modal title="Add to the labour budget" onClose={onClose}>
        <p className="hint" style={{ marginBottom: 14 }}>{S.people.length ? 'Everyone on the stakeholder list is already in the labour budget.' : 'There are no stakeholders yet.'} People are added on the Stakeholders tab.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={() => { onClose(); setNav({ tab: 'people' }); }}>Open Stakeholders</button>
        </div>
      </Modal>
    );
  return (
    <Modal title="Add to the labour budget" onClose={onClose}>
      <div className="d-grid" onKeyDown={(e) => e.key === 'Enter' && save()}>
        <label className="fld" style={{ gridColumn: '1 / -1' }}>Stakeholder
          <select className="c" value={pid} onChange={(e) => pick(e.target.value)} aria-label="Stakeholder">
            {free.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.role ? ' · ' + p.role : ''}</option>))}
          </select>
        </label>
        <label className="fld">Hourly rate<input className="c n" type="number" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></label>
        <label className="fld">Capacity for this project (%)<input className="c n" type="number" step="any" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="100" /></label>
        <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Capacity is the share of their working time available to this project.</p>
        <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Add to budget</button>
        </div>
      </div>
    </Modal>
  );
}

function LabourRegister() {
  const { S, update } = useStore();
  const M = budgetModel(S);
  const [adding, setAdding] = useState(false);
  const used = new Set(S.team.map((t) => t.person));
  const setPerson = (id, patch) => update((s) => void Object.assign(s.people.find((x) => x.id === id), patch));
  const calc = new Map(M.people.map((p) => [p.id, p]));
  const rows = S.team.map((t, i) => ({ t, i, per: personOf(S, t.person), m: calc.get(t.person) })).filter((r) => r.per && r.m);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Labour budget</h2>
          <p className="hint">Pick a stakeholder, then set their hourly rate and the share of their time available to this project. Cost = rate × capacity × {hrsf(S.meta.hoursPerDay)} h × the working days they are available. Set From / To when someone joins late or leaves early.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add stakeholder</button>
      </div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Stakeholder</th><th className="r">Hourly rate</th><th className="r">Capacity</th><th>Available from</th><th>Available to</th><th className="r">Working days</th><th className="r">Hours</th><th className="r">Project cost</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ t, i, per, m }) => (
              <tr key={per.id + ':' + i}>
                <td data-l="Stakeholder"><SelectCell value={t.person} options={S.people.filter((x) => x.id === t.person || !used.has(x.id)).map((x) => [x.id, x.name || '(unnamed)'])} cls="w-md" onCommit={(v) => update((s) => { s.team[i].person = v; })} /></td>
                <td data-l="Hourly rate"><Cell value={per.rate} type="num" cls="w-md n" label="Hourly rate" onCommit={(v) => setPerson(per.id, { rate: v == null ? 0 : v })} /></td>
                <td data-l="Capacity %"><Cell value={per.cap} type="pct" cls="w-md n" label="Capacity for this project in percent" onCommit={(v) => setPerson(per.id, { cap: v == null ? 0 : v })} /></td>
                <td data-l="Available from"><Cell value={t.from} type="date" cls="w-date" label="Available from (blank = project start)" onCommit={(v) => update((s) => { s.team[i].from = v || ''; })} /></td>
                <td data-l="Available to"><Cell value={t.to} type="date" cls="w-date" label="Available to (blank = project end)" onCommit={(v) => update((s) => { s.team[i].to = v || ''; })} /></td>
                <td data-l="Working days" className="r mono"><span className="cell">{m.days}</span></td>
                <td data-l="Hours" className="r mono"><span className="cell">{hrsf(m.hours)}</span></td>
                <td data-l="Project cost" className="r mono"><span className="cell">{money(m.cost)}</span></td>
                <td data-l=""><button className="x" onClick={() => update((s) => { s.team.splice(i, 1); })} aria-label="Remove from the labour budget" title="Remove from the labour budget (they stay in RACI)">✕</button></td>
              </tr>
            ))}
            {!rows.length && (<tr className="empty-row"><td colSpan="9"><span className="cell msg">Nobody in the labour budget yet. Use “+ Add stakeholder”.</span></td></tr>)}
          </tbody>
          {rows.length > 0 && (<tfoot><tr><td>Total</td><td className="r mono">{money(hourly(S))}/h</td><td></td><td></td><td></td><td className="r mono">{M.totals.workDays}</td><td className="r mono">{hrsf(M.totals.hours)}</td><td className="r mono">{money(M.totals.labour)}</td><td></td></tr></tfoot>)}
        </table>
      </div>
      {adding && <AddLabour onClose={() => setAdding(false)} />}
    </div>
  );
}

// Dates, working week and non-working days: everything that decides which days are counted
function CalendarCard() {
  const { S, update } = useStore();
  const M = budgetModel(S);
  const m = S.meta;
  const work = new Set(workDaysOf(m));
  const toggleDay = (d) =>
    update((s) => {
      const cur = new Set(workDaysOf(s.meta));
      if (cur.has(d)) {
        if (cur.size > 1) cur.delete(d); // at least one working day
      } else cur.add(d);
      s.meta.workDays = Array.from(cur).sort((a, b) => a - b);
    });
  const setMode = (mode) =>
    update((s) => {
      s.meta.endMode = mode;
      if (mode === 'fixed' && !s.meta.end) s.meta.end = isoOf(budgetModel(s).end);
    });
  const patchHol = (id, patch) => update((s) => void Object.assign(s.holidays.find((h) => h.id === id), patch));

  return (
    <div className="card">
      <h2>Project dates and working calendar</h2>
      <p className="hint">The budget is counted day by day between the start and end date, on the days the team works. A project that ends midweek is only charged up to that day.</p>
      <div className="fields">
        <label className="fld">Start date (day 1)<Cell sec="meta" f="start" value={m.start} type="date" cls="w-date" /></label>
        <div className="fld">Project end
          <div className="seg" role="group" aria-label="How the project end is set">
            <button aria-pressed={m.endMode !== 'fixed'} onClick={() => setMode('auto')}>Follow the plan</button>
            <button aria-pressed={m.endMode === 'fixed'} onClick={() => setMode('fixed')}>Fixed date</button>
          </div>
        </div>
        {m.endMode === 'fixed' && <label className="fld">End date<Cell sec="meta" f="end" value={m.end} type="date" cls="w-date" /></label>}
        <WeeksControl />
        <label className="fld">Working hours per day<Cell sec="meta" f="hoursPerDay" value={m.hoursPerDay} type="num" cls="w-sm n" /></label>
        <label className="fld">Sprint length (weeks)<Cell sec="meta" f="sprintWeeks" value={m.sprintWeeks} type="int" cls="w-sm n" /></label>
      </div>

      <div className="flabel" style={{ margin: '14px 0 6px' }}>Working days of the week</div>
      <div className="chips" role="group" aria-label="Working days of the week">
        {WEEKDAYS.map((d, i) => (<button key={d} className="chip" aria-pressed={work.has(i)} onClick={() => toggleDay(i)}>{d}</button>))}
      </div>
      <p className="msg" style={{ marginTop: 6 }}>Labour is only charged on these days. A weekly or monthly line item can be spread over calendar days or over working days (see the line items below).</p>

      <div className="flabel" style={{ margin: '14px 0 2px' }}>Non-working dates</div>
      <p className="msg" style={{ margin: '0 0 4px' }}>Public holidays, shutdowns or breaks. No labour is charged on these days, and line items spread over working days skip them.</p>
      {S.holidays.map((h) => (
        <div key={h.id} className="hol-row">
          <Cell value={h.from} type="date" cls="w-date" label="Non-working from" onCommit={(v) => patchHol(h.id, { from: v || '', to: h.to && v && h.to < v ? v : h.to })} />
          <Cell value={h.to} type="date" cls="w-date" label="Non-working to (blank = one day)" onCommit={(v) => patchHol(h.id, { to: v || '' })} />
          <span className="c-lbl"><Cell value={h.label} cls="w-md" placeholder="Reason, e.g. Diwali" label="Reason" onCommit={(v) => patchHol(h.id, { label: v.trim() })} /></span>
          <button className="x" onClick={() => update((s) => { s.holidays = s.holidays.filter((x) => x.id !== h.id); })} aria-label="Delete non-working dates">✕</button>
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => update((s) => void s.holidays.push({ id: uid(), from: '', to: '', label: '' }))}>+ Add non-working dates</button>
      </div>
    </div>
  );
}

export default function Budget() {
  const { S, update } = useStore();
  const M = budgetModel(S);
  const t = M.totals;
  const pB = t.bac;
  const ac = ledgerTotal(S);
  const cw = curWeek(S);
  const thisWeek = weekAc(S, cw);
  const ym = today().slice(0, 7);
  const thisMonth = S.ledger.reduce((a, e) => a + (e.date && e.date.slice(0, 7) === ym ? nz(e.amount) : 0), 0);
  const ptd = sumRange(M, M.start, pd(today())); // planned, day by day, up to today
  const r2 = (n) => Math.round(n * 100) / 100;

  return (
    <>
      <CalendarCard />

      <div className="grid2 bud-grid">
        <LabourRegister />

        <div className="card">
          <h2>Budget summary</h2>
          <p className="hint">Planned cost baseline, and what has actually been spent. Step-by-step working is in “How this budget is calculated” below.</p>
          <div className="totals">
            <span>Project length</span><span className="mono">{t.calDays} day{t.calDays === 1 ? '' : 's'} · {t.workDays} working</span>
            <span>Equivalent work weeks</span><span className="mono">{r2(t.equivWeeks)}</span>
            <div className="sep" />
            <span>Team labour ({hrsf(t.hours)} h)</span><span className="mono">{money(t.labour)}</span>
            <span>Recurring line items</span><span className="mono">{money(t.recurring)}</span>
            <span>One-time line items</span><span className="mono">{money(t.once)}</span>
            <span className="big">Project BAC</span><span className="mono big">{money(pB)}</span>
            <div className="sep" />
            <span>Planned to date (today)</span><span className="mono">{money(ptd.total)}</span>
            <span className="big">Actual cost to date</span><span className="mono big">{money(ac)}</span>
            <span>Actual vs planned to date</span><span className="mono" style={ac - ptd.total > 0 ? { color: 'var(--bad)' } : undefined}>{money(ac - ptd.total)}</span>
            <span>Remaining against BAC</span><span className="mono" style={pB - ac < 0 ? { color: 'var(--bad)' } : undefined}>{money(pB - ac)}</span>
            <span>Spent</span><span className="mono">{pc(pB ? ac / pB : null)}</span>
            <span>This week (week {cw})</span><span className="mono">{thisWeek == null ? '–' : money(thisWeek)}</span>
            <span>This month</span><span className="mono">{money(thisMonth)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row sp">
          <div>
            <h2>Planned budget line items</h2>
            <p className="hint">Beyond team labour: licenses, cloud, tools, travel, contingency. Choose how each amount repeats. Optional From / To dates limit when a line runs; for a one-time item the From date is the day it is paid.</p>
          </div>
          <button className="btn primary" onClick={() => update((s) => s.lines.push({ name: '', amount: 0, per: 'week', spread: 'cal', from: '', to: '' }))}>Add line item</button>
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead><tr><th>Line item</th><th className="r">Amount</th><th>Basis</th><th>Spread over</th><th>From / on</th><th>To</th><th className="r">Project total</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td data-l="Line item"><span className="cell">Team labour (from the register)</span></td>
                <td data-l="Amount" className="r mono"><span className="cell">{money(sprintCap(S))}</span></td>
                <td data-l="Basis"><span className="cell msg">Per full week</span></td>
                <td data-l="Spread over"><span className="cell msg">Working days</span></td>
                <td data-l="From / on"></td>
                <td data-l="To"></td>
                <td data-l="Project total" className="r mono"><span className="cell">{money(t.labour)}</span></td>
                <td data-l=""></td>
              </tr>
              {S.lines.map((l, i) => {
                const once = l.per === 'project';
                const canSpread = l.per === 'week' || l.per === 'month' || l.per === 'sprint';
                const L = M.lines[i];
                return (
                  <tr key={i}>
                    <td data-l="Line item"><Cell sec="lines" i={i} f="name" value={l.name} cls="w-name" placeholder="Line item name" /></td>
                    <td data-l="Amount"><Cell sec="lines" i={i} f="amount" value={l.amount} type="num" cls="w-md n" /></td>
                    <td data-l="Basis"><SelectCell sec="lines" i={i} f="per" value={l.per} options={BASES} cls="w-md" /></td>
                    <td data-l="Spread over"><SelectCell sec="lines" i={i} f="spread" value={canSpread ? l.spread : l.per === 'day' ? 'work' : 'cal'} options={SPREADS} cls="w-md" disabled={!canSpread} /></td>
                    <td data-l="From / on"><Cell sec="lines" i={i} f="from" value={l.from} type="date" cls="w-date" label={once ? 'Date paid (optional)' : 'Runs from (blank = project start)'} /></td>
                    <td data-l="To"><Cell sec="lines" i={i} f="to" value={l.to} type="date" cls="w-date" label="Runs until (blank = project end)" disabled={once} /></td>
                    <td data-l="Project total" className="r mono"><span className="cell" title={L && L.note ? L.note : undefined}>{money(L ? L.total : 0)}{L && L.note ? ' *' : ''}</span></td>
                    <td data-l=""><button className="x" onClick={() => update((s) => s.lines.splice(i, 1))} aria-label="Delete line item">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>Total (labour + line items)</td><td></td><td></td><td></td><td></td><td></td><td className="r mono">{money(pB)}</td><td></td></tr></tfoot>
          </table>
        </div>
        {M.lines.some((x) => x.note) && <p className="msg" style={{ marginTop: 8 }}>* One-time items without a date inside the project count in the BAC but are not placed in a particular week.</p>}
      </div>

      <BudgetCalc />

      <Ledger />
    </>
  );
}
