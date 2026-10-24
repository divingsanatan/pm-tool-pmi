import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { Cell, SelectCell } from '../components/Field';
import { Modal } from '../components/UI';
import WeeksControl from '../components/WeeksControl';
import { costBy, curWeek, dailyCap, hourly, ledgerTotal, lineOnce, lineWeekly, lineWeeklySum, nW, personOf, projectBAC, sprintCap, weekAc, weeklyBAC } from '../lib/calc';
import { fdate, today } from '../lib/dates';
import { hrsf, money, nz, pc } from '../lib/format';
import { parseCosts } from '../lib/parse';

const BASES = [['week', 'Per week'], ['month', 'Per month'], ['sprint', 'Per sprint'], ['project', 'One-time']];
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
              : 'Planned is the recurring weekly budget spread over the days of each period. One-time line items are not time-phased, so they appear only under By element.'}
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
  const [adding, setAdding] = useState(false);
  const used = new Set(S.team.map((t) => t.person));
  const setPerson = (id, patch) => update((s) => void Object.assign(s.people.find((x) => x.id === id), patch));
  const hpw = (per) => nz(per.cap) * nz(S.meta.hoursPerDay) * nz(S.meta.sprintDays);
  const rows = S.team.map((t, i) => ({ t, i, per: personOf(S, t.person) })).filter((r) => r.per);
  const totalH = rows.reduce((a, r) => a + hpw(r.per), 0);
  const totalC = rows.reduce((a, r) => a + nz(r.per.rate) * hpw(r.per), 0);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Labour budget</h2>
          <p className="hint">Pick a stakeholder from your list, then set their hourly rate and the share of their time available to this project. People are added and renamed on the Stakeholders tab.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add stakeholder</button>
      </div>
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Stakeholder</th><th className="r">Hourly rate</th><th className="r">Capacity for project</th><th className="r">Hours / week</th><th className="r">Weekly cost</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ t, i, per }) => (
              <tr key={per.id + ':' + i}>
                <td data-l="Stakeholder"><SelectCell value={t.person} options={S.people.filter((x) => x.id === t.person || !used.has(x.id)).map((x) => [x.id, x.name || '(unnamed)'])} cls="w-md" onCommit={(v) => update((s) => { s.team[i].person = v; })} /></td>
                <td data-l="Hourly rate"><Cell value={per.rate} type="num" cls="w-md n" label="Hourly rate" onCommit={(v) => setPerson(per.id, { rate: v == null ? 0 : v })} /></td>
                <td data-l="Capacity %"><Cell value={per.cap} type="pct" cls="w-md n" label="Capacity for this project in percent" onCommit={(v) => setPerson(per.id, { cap: v == null ? 0 : v })} /></td>
                <td data-l="Hours / week" className="r mono"><span className="cell">{hrsf(hpw(per))}</span></td>
                <td data-l="Weekly cost" className="r mono"><span className="cell">{money(nz(per.rate) * hpw(per))}</span></td>
                <td data-l=""><button className="x" onClick={() => update((s) => { s.team.splice(i, 1); })} aria-label="Remove from the labour budget" title="Remove from the labour budget (they stay in RACI)">✕</button></td>
              </tr>
            ))}
            {!rows.length && (<tr className="empty-row"><td colSpan="6"><span className="cell msg">Nobody in the labour budget yet. Use “+ Add stakeholder”.</span></td></tr>)}
          </tbody>
          {rows.length > 0 && (<tfoot><tr><td>Total</td><td className="r mono">{money(hourly(S))}/h</td><td></td><td className="r mono">{hrsf(totalH)}</td><td className="r mono">{money(totalC)}</td><td></td></tr></tfoot>)}
        </table>
      </div>
      {adding && <AddLabour onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function Budget() {
  const { S, update } = useStore();
  const dc = dailyCap(S), sc = sprintCap(S), wB = weeklyBAC(S), pB = projectBAC(S), Nw = nW(S);
  const ac = ledgerTotal(S);
  const cw = curWeek(S);
  const thisWeek = weekAc(S, cw);
  const ym = today().slice(0, 7);
  const thisMonth = S.ledger.reduce((a, e) => a + (e.date && e.date.slice(0, 7) === ym ? nz(e.amount) : 0), 0);

  return (
    <>
      <div className="card">
        <h2>Project length</h2>
        <p className="hint">The weekly budget is multiplied by the number of weeks, and the number of weeks follows your dated work items, sprints and costs.</p>
        <div className="fields">
          <label className="fld">Start date (Monday of week 1)<Cell sec="meta" f="start" value={S.meta.start} type="date" cls="w-date" /></label>
          <WeeksControl />
          <label className="fld">Sprint length (weeks)<Cell sec="meta" f="sprintWeeks" value={S.meta.sprintWeeks} type="int" cls="w-sm n" /></label>
        </div>
      </div>

      <div className="grid2 bud-grid">
        <LabourRegister />

        <div className="card">
          <h2>Budget summary</h2>
          <p className="hint">Planned cost baseline, and what has actually been spent.</p>
          <div className="totals">
            <span>Working hours per day</span><Cell sec="meta" f="hoursPerDay" value={S.meta.hoursPerDay} type="num" cls="w-sm n" />
            <span>Working days per week</span><Cell sec="meta" f="sprintDays" value={S.meta.sprintDays} type="num" cls="w-sm n" />
            <span>Daily team cap</span><span className="mono">{money(dc)}</span>
            <span>Weekly team cap</span><span className="mono">{money(sc)}</span>
            <span>Recurring line items (per week)</span><span className="mono">{money(lineWeeklySum(S))}</span>
            <div className="sep" />
            <span className="big">Weekly BAC</span><span className="mono big">{money(wB)}</span>
            <span>× {Nw} weeks</span><span className="mono">{money(wB * Nw)}</span>
            <span>One-time line items</span><span className="mono">{money(lineOnce(S))}</span>
            <span className="big">Project BAC</span><span className="mono big">{money(pB)}</span>
            <div className="sep" />
            <span className="big">Actual cost to date</span><span className="mono big">{money(ac)}</span>
            <span>Remaining</span><span className="mono" style={pB - ac < 0 ? { color: 'var(--bad)' } : undefined}>{money(pB - ac)}</span>
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
            <p className="hint">Beyond team labour: licenses, cloud, tools, travel, contingency. Choose how each amount repeats: every week, every month, every sprint, or once.</p>
          </div>
          <button className="btn primary" onClick={() => update((s) => s.lines.push({ name: '', amount: 0, per: 'week' }))}>Add line item</button>
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead><tr><th>Line item</th><th className="r">Amount</th><th>Basis</th><th className="r">Per week</th><th className="r">Project total</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td data-l="Line item"><span className="cell">Team labour (from the register)</span></td>
                <td data-l="Amount" className="r mono"><span className="cell">{money(sc)}</span></td>
                <td data-l="Basis"><span className="cell msg">Per week</span></td>
                <td data-l="Per week" className="r mono"><span className="cell">{money(sc)}</span></td>
                <td data-l="Project total" className="r mono"><span className="cell">{money(sc * Nw)}</span></td>
                <td data-l=""></td>
              </tr>
              {S.lines.map((l, i) => {
                const once = l.per === 'project';
                return (
                  <tr key={i}>
                    <td data-l="Line item"><Cell sec="lines" i={i} f="name" value={l.name} cls="w-name" placeholder="Line item name" /></td>
                    <td data-l="Amount"><Cell sec="lines" i={i} f="amount" value={l.amount} type="num" cls="w-md n" /></td>
                    <td data-l="Basis"><SelectCell sec="lines" i={i} f="per" value={l.per} options={BASES} cls="w-md" /></td>
                    <td data-l="Per week" className="r mono"><span className="cell">{once ? '–' : money(lineWeekly(S, l))}</span></td>
                    <td data-l="Project total" className="r mono"><span className="cell">{money(once ? nz(l.amount) : lineWeekly(S, l) * Nw)}</span></td>
                    <td data-l=""><button className="x" onClick={() => update((s) => s.lines.splice(i, 1))} aria-label="Delete line item">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>Total</td><td></td><td></td><td className="r mono">{money(wB)}</td><td className="r mono">{money(pB)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>

      <Ledger />
    </>
  );
}
