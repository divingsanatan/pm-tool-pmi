import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { Cell, SelectCell } from '../components/Field';
import { Modal, useUI } from '../components/UI';
import WeeksControl from '../components/WeeksControl';
import '../capacity.css';
import { calendarHours, planWindow } from '../lib/capacity';
import { ITER_UNIT, baseLine, baseOf, costBy, labourOf, labourTotal, lastDay, ledgerTotal, lineOnce, lineRecurring, lineState, lineTotal, maxIter, personOf, planBAC, projectBAC, reserves, suggestIter, workBudget } from '../lib/calc';
import LineCrDialog from './LineCrDialog';
import StrayCrLines from '../components/StrayCrLines';
import { addLineViaCr, changeLineViaCr, dropPendingLine, lineEditable, revertLine, syncClaim } from '../lib/lineChange';
import { fdate, fsh, today } from '../lib/dates';
import { hrsf, money, nz, pc } from '../lib/format';
import { parseCosts } from '../lib/parse';
import { baselineFigures, claimLabour, crCls, currentBaseline, labourControl, labourCrs, recordBaselineTeam, signedMoney, signedWorkDays } from '../lib/change';
import '../breakdown.css';

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
              ? 'Planned comes from team labour and your budget line items over the whole project, plus the contingency reserve, so the total equals BAC. Costs recorded with a name that is not in the plan show as Unplanned.'
              : 'Planned is the budget spread evenly over the project’s days, including the contingency reserve (BAC basis; the management reserve is excluded). One-time line items are not time-phased, so they appear only under By element.'}
          </p>
        </>
      )}
      {paste && <PasteCosts onClose={() => setPaste(false)} />}
    </div>
  );
}

const NEW_CR = '__new';

// Extra labour budget must be claimed through a change request: link it to an open one, or raise a new one for the difference.
function LabourCrDialog({ who, amount, total, baseTotal, version, adding, onConfirm, onCancel }) {
  const { S } = useStore();
  const opts = labourCrs(S);
  const [sel, setSel] = useState(opts.length ? '' : NEW_CR);
  const [title, setTitle] = useState('Add ' + who + ' to the labour budget');
  const [cost, setCost] = useState(String(Math.round(amount * 100) / 100));
  const [days, setDays] = useState('0');
  const cr = opts.find((c) => c.id === sel);
  const costN = parseFloat(cost);
  const ok = sel === NEW_CR ? title.trim() !== '' && !isNaN(costN) && costN + 0.005 >= amount && days !== '' && !isNaN(parseInt(days, 10)) : !!cr;
  const go = () => ok && onConfirm(sel === NEW_CR ? { new: { title: title.trim(), cost: costN, days: parseInt(days, 10) } } : { crId: sel });
  return (
    <Modal title="Change request needed" onClose={onCancel}>
      <p className="hint" style={{ marginBottom: 12 }}>
        {adding
          ? <>Baseline {version} is set, so the team is locked. Adding <b>{who}</b> changes the baseline and needs a change request. Their labour cost is <b>{money(amount)}</b>, which takes the labour budget from <b>{money(baseTotal)}</b> to <b>{money(total)}</b>. They are added to the team only after you link or raise a request.</>
          : <>The labour budget would be <b>{money(total)}</b> against <b>{money(baseTotal)}</b> in baseline {version}. The <b>{money(amount)}</b> difference ({who}) is additional budget, so it has to be claimed through a change request. Budget freed up by removing someone is used first and needs no request.</>}
      </p>
      <div className="form" onKeyDown={(e) => e.key === 'Enter' && e.target.tagName !== 'SELECT' && go()}>
        <label className="fld">Change request *
          <select className="c" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Change request">
            {!sel && <option value="">Choose a change request…</option>}
            {opts.map((c) => (<option key={c.id} value={c.id}>{c.code} · {c.title || '(untitled)'} · {c.status}</option>))}
            <option value={NEW_CR}>+ Raise a new change request for {money(amount)}</option>
          </select>
        </label>
        {cr && <p className="msg" style={{ margin: 0 }}>{cr.code}’s cost change goes from {money(nz(cr.cost))} to <b>{money(nz(cr.cost) + amount)}</b> (+{money(amount)} for {who}). Only requests still awaiting a decision are listed.</p>}
        {sel === NEW_CR && (
          <>
            <label className="fld">Title *<input className="c" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <label className="fld" style={{ flex: 1, minWidth: 140 }}>Cost change *<input className="c n" type="number" step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-invalid={isNaN(costN) || costN + 0.005 < amount || undefined} /></label>
              <label className="fld" style={{ flex: 1, minWidth: 140 }}>Schedule change (days) *<input className="c n" type="number" step="1" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
            </div>
            {!isNaN(costN) && costN + 0.005 < amount && <p className="msg lateTxt" style={{ margin: 0 }}>The cost change must cover the {money(amount)} difference.</p>}
          </>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={go}>Link and continue</button>
      </div>
    </Modal>
  );
}

// Add someone from the stakeholder list to the labour budget (names are managed on the Stakeholders tab)
function AddLabour({ onClose }) {
  const { S, update, setNav } = useStore();
  const free = S.people.filter((p) => !p.left && !S.team.some((t) => t.person === p.id));
  const fmtCap = (e) => String(Math.round(nz(e.cap) * 1000) / 10);
  const [pid, setPid] = useState(free[0] ? free[0].id : '');
  const [rate, setRate] = useState(free[0] ? String(free[0].rate == null ? '' : free[0].rate) : '');
  const [cap, setCap] = useState(free[0] ? fmtCap(free[0]) : '100');
  const [hrs, setHrs] = useState('');
  const calHrs = pid ? calendarHours(S, S.people.find((p) => p.id === pid) || {}).hours : 0;
  const [need, setNeed] = useState(null); // set when the budget would go above the baseline: a change request is needed first
  const pick = (id) => {
    setPid(id);
    const e = S.people.find((p) => p.id === id);
    if (e) {
      setRate(String(e.rate == null ? '' : e.rate));
      setCap(fmtCap(e));
    }
  };
  const build = (p) => {
    const per = p.people.find((x) => x.id === pid);
    if (!per) return;
    if (rate !== '') per.rate = parseFloat(rate) || 0;
    // the capacity belongs to this budget row only. It is stored just when it differs from the stakeholder's allocation;
    // otherwise the row keeps following the allocation. The stakeholder's allocation is never touched from here.
    const row = hrs === '' ? { person: pid } : { person: pid, hours: Math.max(0, parseFloat(hrs) || 0) };
    if (cap !== '') {
      const own = Math.max(0, parseFloat(cap) || 0) / 100;
      if (Math.abs(own - nz(per.cap)) > 1e-9) row.cap = own;
    }
    if (!p.team.some((t) => t.person === pid)) p.team.push(row);
  };
  const save = () => {
    if (!pid) return;
    // after a baseline the team is locked: every new stakeholder needs a change request (new or an open one), even at no extra cost.
    // Try the change on a copy first so the request can show the real cost.
    if (currentBaseline(S)) {
      const trial = structuredClone(S);
      build(trial);
      const L = labourOf(trial, trial.team[trial.team.length - 1]);
      const cost = L ? Math.round(nz(L.cost) * 100) / 100 : 0;
      const before = S.team.reduce((a, t) => { const x = labourOf(S, t); return a + (x ? nz(x.cost) : 0); }, 0);
      const c0 = labourControl(S);
      const baseTotal = c0.active ? c0.baseTotal : Math.round(before * 100) / 100;
      const who = (S.people.find((x) => x.id === pid) || {}).name || 'The new stakeholder';
      setNeed({ version: currentBaseline(S).version, who, amount: cost, total: Math.round((before + cost) * 100) / 100, baseTotal });
      return;
    }
    update(build);
    onClose();
  };
  const confirmClaim = (choice) => {
    update((p) => {
      build(p);
      claimLabour(p, choice, need.amount, need.who, [{ i: p.team.length - 1, claim: need.amount }]);
    });
    onClose();
  };
  if (need) return <LabourCrDialog adding who={need.who} amount={need.amount} total={need.total} baseTotal={need.baseTotal} version={need.version} onConfirm={confirmClaim} onCancel={() => setNeed(null)} />;
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
        <label className="fld">Total available hours (optional)<input className="c n" type="number" step="any" inputMode="decimal" value={hrs} onChange={(e) => setHrs(e.target.value)} placeholder={'From calendar: ' + hrsf(calHrs)} /></label>
        <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Leave the hours blank to use the Stakeholders calendar (working days × hours per day, after off days and leave). Hours at capacity = total available hours × capacity. Cost = hours at capacity × hourly rate.</p>
        <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Add to budget</button>
        </div>
      </div>
    </Modal>
  );
}

// After a baseline the labour figures are locked. This is the only way to change a stakeholder's rate, capacity or hours:
// a change that keeps the labour budget inside the baseline is applied after confirming; one that takes it above the baseline needs a change request.
function LabourChange({ i, win, onClose }) {
  const { S, update } = useStore();
  const t = S.team[i];
  const per = t ? personOf(S, t.person) : null;
  const L = t && per ? labourOf(S, t, win) : null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const [rate, setRate] = useState(L ? String(L.rate) : '');
  const [cap, setCap] = useState(L ? String(Math.round(L.cap * 10000) / 100) : '');
  const [hrs, setHrs] = useState(L ? String(r2(L.total)) : '');
  const [asking, setAsking] = useState(false);
  if (!L) return null;
  const num = (v) => (v === '' || isNaN(parseFloat(v)) ? null : parseFloat(v));
  const rt = num(rate), cp = num(cap), h = num(hrs);
  const ok = rt != null && rt >= 0 && cp != null && cp >= 0 && h != null && h >= 0;
  const dirty = ok && (Math.abs(rt - L.rate) > 0.0005 || Math.abs(cp / 100 - L.cap) > 0.00005 || Math.abs(h - L.total) > 0.005);
  // the change itself, run on the project (or on a copy of it to see what it would do)
  const run = (p) => {
    const tt = p.team[i];
    const pp = p.people.find((x) => x.id === tt.person);
    pp.rate = rt;
    if (Math.abs(cp / 100 - L.capAuto) < 0.00005) delete tt.cap; else tt.cap = cp / 100; // the suggested value is kept as "follows the allocation"
    if (Math.abs(h - L.auto.hours) < 0.005) delete tt.hours; else tt.hours = h; // the calendar value is kept as "follows the calendar"
  };
  let trial = null, c2 = null, L2 = null;
  if (dirty) {
    trial = structuredClone(S);
    run(trial);
    c2 = labourControl(trial);
    L2 = labourOf(trial, trial.team[i], win);
  }
  const untracked = dirty && c2 && c2.reason === 'untracked';
  const needsCr = !!(dirty && c2 && c2.active && c2.needsCr);
  const who = per.name || 'this stakeholder';
  if (asking && needsCr) {
    return (
      <LabourCrDialog
        who={who} amount={c2.short} total={c2.nowTotal} baseTotal={c2.baseTotal} version={c2.b.version}
        onCancel={() => setAsking(false)}
        onConfirm={(choice) => {
          update((p) => { run(p); claimLabour(p, choice, c2.short, who, [{ i, claim: c2.short }]); });
          onClose();
        }}
      />
    );
  }
  return (
    <Modal title={'Change labour: ' + who} onClose={onClose}>
      <div className="form">
        <p className="hint" style={{ margin: 0 }}>The labour budget is locked by the baseline. A change that keeps it inside the baseline is applied after you confirm. A change that takes it above the baseline needs a change request.</p>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <label className="fld" style={{ flex: 1, minWidth: 120 }}>Hourly rate<input className="c" type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="fld" style={{ flex: 1, minWidth: 120 }}>Capacity for project (%)<input className="c" type="number" min="0" step="any" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <label className="fld" style={{ flex: 1, minWidth: 120 }}>Total available hrs<input className="c" type="number" min="0" step="any" value={hrs} onChange={(e) => setHrs(e.target.value)} /></label>
        </div>
        <p className="msg" style={{ margin: 0 }}>Now: {money(L.cost)} ({hrsf(L.avail)} h at {money(L.rate)}).{dirty && L2 ? ' After: ' + money(L2.cost) + ' (' + hrsf(L2.avail) + ' h at ' + money(L2.rate) + ').' : ''}</p>
        {dirty && c2 && c2.active && (
          <div className={'banner ' + (needsCr ? 'bad' : 'good')} style={{ margin: 0 }}>
            <span>{needsCr
              ? <>The labour budget would be <b>{money(c2.nowTotal)}</b> against <b>{money(c2.baseTotal)}</b> in baseline {c2.b.version}: <b>{money(c2.short)}</b> above it, which needs a change request.</>
              : <>The labour budget would be <b>{money(c2.nowTotal)}</b>, inside baseline {c2.b.version} ({money(c2.baseTotal)}), so no change request is needed.</>}</span>
          </div>
        )}
        {untracked && <div className="banner warn" style={{ margin: 0 }}><span>Baseline {c2.b.version} did not record who was in the labour budget, so a change cannot be checked against it yet. Use “Record the current team as the baseline team” at the top of this section first.</span></div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          {needsCr
            ? <button className="btn primary" disabled={!dirty} onClick={() => setAsking(true)}>Continue to change request</button>
            : <button className="btn primary" disabled={!dirty || untracked} onClick={() => { update(run); onClose(); }}>Apply change</button>}
        </div>
      </div>
    </Modal>
  );
}

function LabourRegister() {
  const { S, update, setNav } = useStore();
  const ui = useUI();
  const [adding, setAdding] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [editing, setEditing] = useState(null); // index of the team row being changed through the locked-labour dialog
  const ctl = labourControl(S);
  const rowCtl = Object.fromEntries((ctl.rows || []).map((r) => [r.i, r]));
  const crOf = (id) => S.cr.find((c) => c.id === id);
  const replaces = ctl.active && ctl.removed.length ? ctl.removed.map((x) => x.name).join(', ') : '';
  const used = new Set(S.team.map((t) => t.person));
  // After a baseline the team is locked. Someone who is in the baseline's team can never be removed or swapped here.
  // Someone added after it can be taken out again only while the change request that adds them is still awaiting a decision
  // (their share is taken back out of that request's cost).
  const base = currentBaseline(S);
  const openCr = (id) => labourCrs(S).some((c) => c.id === id);
  const canRemove = (i) => {
    if (!base) return true;
    const r = rowCtl[i];
    return !!(r && r.isNew && r.crId && openCr(r.crId));
  };
  const lockWhy = base ? 'Locked by baseline ' + base.version + '. A stakeholder in the baseline team cannot be removed. To add someone, raise a change request.' : '';
  const removeRow = (i) => {
    if (!canRemove(i)) return;
    update((s) => {
      const t = s.team[i];
      if (!t) return;
      const c = t.crId ? s.cr.find((x) => x.id === t.crId) : null;
      if (c && nz(t.crClaim) > 0 && ['Draft', 'Submitted', 'Under review'].includes(c.status)) {
        c.cost = Math.max(0, Math.round((nz(c.cost) - nz(t.crClaim)) * 100) / 100);
        c.log.push({ on: today(), text: 'Cost change −' + Math.round(nz(t.crClaim) * 100) / 100 + ' (stakeholder taken out of the labour budget before approval)' });
      }
      s.team.splice(i, 1);
    });
  };
  const setPerson = (id, patch) => update((s) => void Object.assign(s.people.find((x) => x.id === id), patch));
  const setTeam = (i, patch) => update((s) => void Object.assign(s.team[i], patch));
  const win = planWindow(S);
  const rows = S.team.map((t, i) => ({ t, i, per: personOf(S, t.person), L: labourOf(S, t, win) })).filter((r) => r.per && r.L);
  const adjusted = rows.filter((r) => r.L.manual);
  const useCalendar = (idx) => update((s) => { idx.forEach((i) => { delete s.team[i].hours; }); });
  const sum = (f) => rows.reduce((a, r) => a + f(r.L), 0);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Labour budget</h2>
          <p className="hint">Pick a stakeholder and set their hourly rate. Capacity for the project starts as their allocation % from the Stakeholders tab; type a value to use your own and it stays until you reset it (changing it here never changes the allocation, and the allocation never changes it once you have typed your own). Total available hours come from the Stakeholders calendar (working days × hours per day, after team off days and their leave); type a value to adjust it and it stays until you reset it. Hours at capacity = total available hours × capacity. Cost = hours at capacity × hourly rate.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add stakeholder</button>
      </div>
      {base && <p className="msg" style={{ margin: '8px 0 0' }}>🔒 Locked by baseline {base.version}. Rates, capacity and hours cannot be typed in any more: use “Change…” on a row. A change that takes the labour budget above the baseline needs a change request.</p>}
      {ctl.reason === 'untracked' && (
        <div className="banner warn" style={{ margin: '10px 0' }}>
          <span>Baseline {ctl.b.version} did not record who was in the labour budget, so new stakeholders cannot be told apart yet.</span>
          <span className="row"><button className="btn" onClick={() => ui.ask({ title: 'Record the current team as the baseline team?', body: 'The people and costs listed below become the labour budget of baseline ' + ctl.b.version + '. Anyone added after this needs a change request unless budget has been freed up. Do this only if the team below is the team the baseline was approved with.', confirm: 'Record team', onConfirm: () => update((p) => recordBaselineTeam(p)) })}>Record current team in {ctl.b.version}</button></span>
        </div>
      )}
      {ctl.active && ctl.needsCr && (
        <div className="banner bad" style={{ margin: '10px 0' }}>
          <span>The labour budget is <b>{money(ctl.extra)}</b> above baseline {ctl.b.version} ({money(ctl.baseTotal)} → {money(ctl.nowTotal)}). {ctl.covered > 0 ? money(ctl.covered) + ' is covered by ' + ctl.crs.map((c) => c.code).join(', ') + '; ' : ''}<b>{money(ctl.short)}</b> still needs a change request.</span>
          <span className="row"><button className="btn primary" onClick={() => setClaiming(true)}>Link or raise a change request</button></span>
        </div>
      )}
      {ctl.active && !ctl.needsCr && ctl.rows.some((r) => r.isNew) && ctl.extra <= 0.5 && (
        <p className="msg" style={{ margin: '8px 0 0' }}>New stakeholders fit inside the baseline labour budget ({money(ctl.baseTotal)}){replaces ? ', which was freed up by removing ' + replaces : ''}, so no change request is needed.</p>
      )}
      <div className="scroll">
        <table className="tbl rwd">
          <thead><tr><th>Stakeholder</th><th className="r">Hourly rate</th><th className="r">Capacity for project</th><th className="r">Total available hrs</th><th className="r">Hours at capacity</th><th className="r">Total cost</th>{ctl.active && <th>Against baseline</th>}<th></th></tr></thead>
          <tbody>
            {rows.map(({ t, i, per, L }) => (
              <tr key={per.id + ':' + i}>
                <td data-l="Stakeholder">{base
                  ? <span className="cell" title="The team is locked by the baseline. Add a stakeholder through a change request.">{per.name || '(unnamed)'}</span>
                  : <SelectCell value={t.person} options={S.people.filter((x) => x.id === t.person || !used.has(x.id)).map((x) => [x.id, x.name || '(unnamed)'])} cls="w-md" onCommit={(v) => update((s) => { s.team[i].person = v; })} />}</td>
                <td data-l="Hourly rate">{base ? <span className="cell n mono" title="Locked by the baseline. Use Change…">{money(per.rate)}</span> : <Cell value={per.rate} type="num" cls="w-md n" label="Hourly rate" onCommit={(v) => setPerson(per.id, { rate: v == null ? 0 : v })} />}</td>
                <td data-l="Capacity %">
                  {base ? <span className="cell n mono" title="Locked by the baseline. Use Change…">{pc(L.cap, 0)}</span> : <Cell value={L.cap} type="pct" cls="w-md n" label="Capacity for this project in percent" onCommit={(v) => setTeam(i, v == null ? { cap: undefined } : { cap: Math.max(0, v) })} />}
                  <div className={'inh' + (L.capManual ? ' own' : '')} title="The stakeholder's allocation % (Stakeholders tab) is only a suggestion here. Type a value to use your own; it is never changed by the allocation or by assigned work items.">
                    {L.capManual
                      ? <>own value · allocation {pc(L.capAuto, 0)} {!base && <button type="button" className="linkbtn" onClick={() => setTeam(i, { cap: undefined })}>reset</button>}</>
                      : <>suggested from allocation %</>}
                  </div>
                </td>
                <td data-l="Total available hrs">
                  {base ? <span className="cell n mono" title="Locked by the baseline. Use Change…">{hrsf(L.total)}</span> : <Cell value={L.total} type="num" cls="w-md n" label="Total available hours on the project, before capacity" onCommit={(v) => setTeam(i, v == null || Math.abs(v - L.auto.hours) < 0.005 ? { hours: undefined } : { hours: Math.max(0, v) })} />}
                  <div className={'inh' + (L.manual ? ' own' : '')} title={L.auto.cal + ' sprint days − ' + L.auto.teamOff + ' team off days − ' + L.auto.leave + ' leave days = ' + L.auto.days + ' days × ' + hrsf(L.auto.hpd) + ' h'}>
                    {L.manual
                      ? <>adjusted · calendar {hrsf(L.auto.hours)} h ({L.diff > 0 ? '+' : ''}{hrsf(L.diff)}) {!base && <button type="button" className="linkbtn" onClick={() => useCalendar([i])}>reset</button>}</>
                      : <>from calendar · {hrsf(L.auto.days)} d × {hrsf(L.auto.hpd)} h</>}
                  </div>
                </td>
                <td data-l="Hours at capacity" className="r mono"><span className="cell">{hrsf(L.avail)}</span></td>
                <td data-l="Total cost" className="r mono"><span className="cell">{money(L.cost)}</span></td>
                {ctl.active && (
                  <td data-l="Against baseline">
                    {(() => {
                      const r = rowCtl[i];
                      if (!r) return null;
                      const c = r.crId && crOf(r.crId);
                      const chip = c ? <button className={'pill ' + crCls(c.status)} onClick={() => setNav({ tab: 'change' })} title={c.title}>{c.code} · {c.status}{r.claim ? ' · +' + money(r.claim) : ''}</button> : null;
                      if (r.isNew) return <span className="cell" style={{ flexWrap: 'wrap', gap: 6 }}><span className="pill neutral">New resource</span>{chip || (ctl.extra > 0.5 ? <span className="pill warn">CR needed</span> : <span className="msg">{replaces ? 'Replaces ' + replaces + ' · ' : ''}within baseline</span>)}</span>;
                      if (r.delta > 0.5) return <span className="cell" style={{ flexWrap: 'wrap', gap: 6 }}><span className="pill warn">+{money(r.delta)} over baseline</span>{chip || <span className="pill warn">CR needed</span>}</span>;
                      return <span className="cell msg">{c ? chip : 'In baseline'}</span>;
                    })()}
                  </td>
                )}
                <td data-l="">{base && <button className="btn" onClick={() => setEditing(i)} title="Change this stakeholder's rate, capacity or hours. Above the baseline it needs a change request.">Change…</button>}{canRemove(i)
                  ? <button className="x" onClick={() => removeRow(i)} aria-label="Remove from the labour budget" title={base ? 'Take out again: their change request has not been decided yet' : 'Remove from the labour budget (they stay in RACI)'}>✕</button>
                  : <button className="x" disabled aria-label="Locked by the baseline" title={lockWhy} style={{ opacity: 0.45, cursor: 'not-allowed' }}>🔒</button>}</td>
              </tr>
            ))}
            {!rows.length && (<tr className="empty-row"><td colSpan={ctl.active ? 8 : 7}><span className="cell msg">Nobody in the labour budget yet. Use “+ Add stakeholder”.</span></td></tr>)}
          </tbody>
          {rows.length > 0 && (<tfoot><tr><td>Total</td><td></td><td></td><td className="r mono">{hrsf(sum((l) => l.total))}</td><td className="r mono">{hrsf(sum((l) => l.avail))}</td><td className="r mono">{money(sum((l) => l.cost))}</td>{ctl.active && <td className="msg"><span className="cell">Baseline {money(ctl.baseTotal)}</span></td>}<td></td></tr></tfoot>)}
        </table>
      </div>
      {ctl.active && ctl.removed.length > 0 && <p className="msg" style={{ marginTop: 8 }}>Removed since baseline {ctl.b.version}: {ctl.removed.map((x) => x.name + ' (' + money(x.cost) + ' released)').join(', ')}.</p>}
      {adjusted.length > 0 && (
        <p className="msg" style={{ marginTop: 8 }}>
          {adjusted.length} stakeholder{adjusted.length === 1 ? ' has' : 's have'} adjusted hours that differ from the Stakeholders calendar.{' '}
          {!base && (<button type="button" className="linkbtn" onClick={() => ui.ask({ title: 'Use calendar hours for everyone?', body: 'Total available hours for ' + adjusted.map((r) => r.per.name || '(unnamed)').join(', ') + ' will follow the Stakeholders calendar again, so the labour cost changes' + (ctl.active ? ' and may need a change request against baseline ' + ctl.b.version : '') + '.', confirm: 'Use calendar', onConfirm: () => useCalendar(adjusted.map((r) => r.i)) })}>Use calendar hours for all</button>)}
        </p>
      )}
      {adding && <AddLabour onClose={() => setAdding(false)} />}
      {editing != null && <LabourChange i={editing} win={win} onClose={() => setEditing(null)} />}
      {claiming && ctl.active && (
        <LabourCrDialog
          who={ctl.claimRows.map((r) => r.name).join(', ') || 'the extra labour'}
          amount={ctl.short} total={ctl.nowTotal} baseTotal={ctl.baseTotal} version={ctl.b.version}
          onCancel={() => setClaiming(false)}
          onConfirm={(choice) => {
            const pos = ctl.claimRows.reduce((a, r) => a + Math.max(0, r.delta), 0) || 1;
            update((p) => void claimLabour(p, choice, ctl.short, ctl.claimRows.map((r) => r.name).join(', ') || 'extra labour', ctl.claimRows.map((r) => ({ i: r.i, claim: (ctl.short * Math.max(0, r.delta)) / pos }))));
            setClaiming(false);
          }}
        />
      )}
    </div>
  );
}


// How the budget was built at the first baseline and how every approved change request moved it, one row per baseline.
function BudgetHistory({ lab }) {
  const { S, setNav } = useStore();
  const bs = S.baselines || [];
  if (!bs.length) return null;
  const r2 = (n) => Math.round(n * 100) / 100;
  const rows = bs.map((b) => {
    const f = baselineFigures(b);
    const known = Array.isArray(b.labour); // older baselines did not record the team
    const labour = known ? r2(nz(b.labourCost)) : null;
    return { b, f, labour, other: known ? r2(f.work - labour) : null };
  });
  const first = rows[0], cur = rows[rows.length - 1];
  const liveWork = r2(workBudget(S)), liveLab = r2(lab);
  const gap = r2(liveWork - cur.f.work);
  const crOf = (id) => S.cr.find((c) => c.id === id);
  const d = (now, was) => (was == null || now == null ? null : r2(now - was));
  // an amount with the change since the baseline before, in small type underneath
  const amt = (v, dv, note) => (
    <span className="cell bstack">
      {v == null ? '–' : money(v)}
      {note && <small>{note}</small>}
      {dv != null && Math.abs(dv) >= 0.005 && <small className={dv > 0 ? 'up' : 'down'}>{signedMoney(dv, money)}</small>}
    </span>
  );
  const bar = (r) => {
    const parts = [[r.labour == null ? r.f.work : r.labour, 'l', r.labour == null ? 'Work budget' : 'Team labour'], [Math.max(0, r.other || 0), 'o', 'Other line items and approved changes'], [r.f.contingency, 'c', 'Contingency reserve'], [r.f.management, 'm', 'Management reserve']];
    const tot = parts.reduce((a, x) => a + x[0], 0) || 1;
    return (
      <span className="bh-bar" aria-hidden="true" title={parts.filter((x) => x[0]).map((x) => x[2] + ' ' + money(x[0])).join(' · ')}>
        {parts.filter((x) => x[0] > 0).map((x) => (<i key={x[1]} className={x[1]} style={{ width: (x[0] / tot) * 100 + '%' }} />))}
      </span>
    );
  };
  return (
    <div className="card">
      <h2>Budget history by baseline</h2>
      <p className="hint">Each row is a frozen baseline: the first one is the original plan, every later one comes from an implemented change request. The small figure under an amount is how much it changed since the baseline before. Team labour is the labour cost recorded in that baseline; other line items is the rest of the work budget (budget line items and approved change requests).</p>
      <div className="scroll">
        <table className="tbl rwd bl">
          <thead>
            <tr><th>Baseline</th><th>Source</th><th className="r" title="Labour cost of the team recorded in that baseline">Team labour</th><th className="r" title="Work budget minus team labour: budget line items and approved change requests">Other line items</th><th className="r" title="Team labour plus other line items">Work budget</th><th className="r">Contingency</th><th className="r" title="Work budget plus contingency: what progress is measured against">BAC</th><th className="r">Management reserve</th><th className="r" title="BAC plus management reserve">Total budget</th><th className="r" title="Total budget compared with the baseline before, and with the first baseline">Change</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = i ? rows[i - 1] : null;
              const { b, f } = r;
              const c = b.crId ? crOf(b.crId) : null;
              const dTot = prev ? r2(f.total - prev.f.total) : null;
              const since = i > 1 ? r2(f.total - first.f.total) : null;
              return (
                <tr key={b.id} className={i === rows.length - 1 ? 'bl-current' : ''}>
                  <td data-l="Baseline" className="mono"><span className="cell bstack" style={{ alignItems: 'flex-start' }}><span>{b.version}{i === rows.length - 1 && <span className="pill neutral">Current</span>}</span><small>{fdate(b.date)}</small></span></td>
                  <td data-l="Source"><span className="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                    {b.crCode ? <button type="button" className="chip chg" onClick={() => setNav({ tab: 'change' })} title="Open Change control">{b.crCode}</button> : <span className="chip">Original plan</span>}
                    {(c && c.title) || (!c && b.note) ? <small className="msg" style={{ fontSize: 11 }}>{(c && c.title) || b.note}</small> : null}
                    {prev && <small className="msg" style={{ fontSize: 11 }}>approved {signedMoney(nz(b.approvedCost), money)} · {signedWorkDays(nz(b.approvedDays))}</small>}
                  </span></td>
                  <td data-l="Team labour" className="r mono">{r.labour == null ? <span className="cell msg" title="This baseline did not record the team">not recorded</span> : amt(r.labour, d(r.labour, prev && prev.labour))}</td>
                  <td data-l="Other line items" className="r mono">{r.other == null ? <span className="cell msg">–</span> : amt(r.other, d(r.other, prev && prev.other))}</td>
                  <td data-l="Work budget" className="r mono">{amt(f.work, d(f.work, prev && prev.f.work))}</td>
                  <td data-l="Contingency" className="r mono">{amt(f.contingency, d(f.contingency, prev && prev.f.contingency), f.contPct == null ? '' : pc(f.contPct, 1) + ' of work')}</td>
                  <td data-l="BAC" className="r mono">{amt(f.bac, d(f.bac, prev && prev.f.bac))}</td>
                  <td data-l="Management reserve" className="r mono">{amt(f.management, d(f.management, prev && prev.f.management), f.mgmtPct == null ? '' : pc(f.mgmtPct, 1) + ' of work')}</td>
                  <td data-l="Total budget" className="r mono"><span className="cell bstack"><b>{money(f.total)}</b>{bar(r)}</span></td>
                  <td data-l="Change" className="r mono"><span className="cell bstack">{dTot == null ? <span className="msg">start</span> : <span className={dTot >= 0.005 ? 'up' : dTot <= -0.005 ? 'down' : ''}>{signedMoney(dTot, money)}</span>}{prev && prev.f.total > 0 && <small>{(dTot >= 0 ? '+' : '') + Math.round((dTot / prev.f.total) * 1000) / 10}%</small>}{since != null && <small>{signedMoney(since, money)} since {first.b.version}</small>}</span></td>
                </tr>
              );
            })}
            <tr className="bl-now">
              <td data-l="Baseline" className="mono"><span className="cell">Plan now<span className="pill neutral" title="The live plan on this screen, not yet frozen">live</span></span></td>
              <td data-l="Source"><span className="cell msg">Labour and line items as they stand today</span></td>
              <td data-l="Team labour" className="r mono">{amt(liveLab, d(liveLab, cur.labour))}</td>
              <td data-l="Other line items" className="r mono">{amt(r2(liveWork - liveLab), cur.other == null ? null : d(r2(liveWork - liveLab), cur.other))}</td>
              <td data-l="Work budget" className="r mono">{amt(liveWork, gap)}</td>
              <td data-l="Contingency"></td><td data-l="BAC"></td><td data-l="Management reserve"></td>
              <td data-l="Total budget" className="r"><span className="cell bstack">{Math.abs(gap) > 0.5 ? <span className={'pill ' + (gap > 0 ? 'warn' : 'neutral')}>{gap > 0 ? 'Above ' + cur.b.version + ' by ' + money(gap) + ': needs a change request' : 'Below ' + cur.b.version + ' by ' + money(-gap)}</span> : <span className="pill good">Matches {cur.b.version}</span>}</span></td>
              <td data-l="Change"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="bl-legend bh-key"><span><i className="l" />Team labour</span><span><i className="o" />Other line items and approved changes</span><span><i className="c" />Contingency reserve</span><span><i className="m" />Management reserve</span> · The bar under each total shows what it is made of. “Plan now” compares today’s labour and line items with the current baseline: anything above it is not in the budget until a change request is approved and implemented.</p>
    </div>
  );
}

export default function Budget() {
  const { S, update, setNav } = useStore();
  const ui = useUI();
  const [lineDlg, setLineDlg] = useState(null); // { id } of a baselined line being changed, or {} for a new line
  const lab = labourTotal(S), live = projectBAC(S), pB = planBAC(S), baselined = !!baseOf(S), pending = Math.round((live - pB) * 100) / 100;
  // after a baseline, people who joined the labour budget are listed on their own, with the change request that claims their budget
  const ctl = labourControl(S);
  const newRes = ctl.active ? ctl.rows.filter((r) => r.isNew) : [];
  const newSum = newRes.reduce((a, r) => a + r.cost, 0);
  const crOf = (id) => S.cr.find((c) => c.id === id);
  const freed = ctl.active && ctl.removed.length ? ctl.removed.map((x) => x.name).join(', ') : '';
  const recur = lineRecurring(S);
  const ac = ledgerTotal(S);
  // contingency and management reserve: built-in lines. Their percentages can be changed until a baseline exists, then they are locked.
  const R = reserves(S);
  const gapWork = Math.round((workBudget(S) - R.base) * 100) / 100; // live labour and line items against the work budget the baseline allows
  const setReserve = (key, v) => update((p) => {
    if (p.baselines && p.baselines.length) return; // locked by the baseline
    const n = parseFloat(v);
    if (!isNaN(n)) p.reserve[key] = Math.min(1, Math.max(0, n / 100));
  });
  const reserveRow = (key, label, pct, amount, what) => (
    <tr key={key} className="res-row">
      <td data-l="Line item"><span className="cell" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><b>{label}</b><span className="pill neutral" title="Built in: this line cannot be deleted">Required</span></span></td>
      <td data-l="Amount" className="r">
        {R.locked
          ? <span className="cell mono" style={{ display: 'flex', justifyContent: 'flex-end' }} title={'Locked by baseline ' + R.version + '. A change needs a change request.'}>{pc(pct, 1)}</span>
          : <span className="cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, whiteSpace: 'nowrap' }}><Cell value={Math.round(pct * 1000) / 10} type="num" min={0} cls="w-sm n" label={label + ' percent'} onCommit={(v) => setReserve(key, v)} /><span className="msg">%</span></span>}
      </td>
      <td data-l="Basis"><span className="cell msg">{what}</span></td>
      <td data-l="Iterations"><span className="cell msg">–</span></td>
      <td data-l="Project total" className="r mono"><span className="cell">{money(amount)}</span></td>
      <td data-l="">{R.locked ? <span className="pill warn" title={'Percentages and amounts are fixed by baseline ' + R.version + '. A change needs a change request.'}>Locked · {R.version}</span> : <span className="msg" title="Cannot be deleted. Only the percentage can change, until a baseline is set.">Fixed line</span>}</td>
    </tr>
  );

  return (
    <>
      <div className="card">
        <h2>Project length</h2>
        <p className="hint">The project start and end are never typed in: they come from your sprints (the earliest sprint start and the latest date in the plan). The number of weeks follows them.</p>
        <div className="fields">
          <div className="fld">Project start<span className="cell mono"><b>{fdate(S.meta.start)}</b></span><span className="msg">First sprint's start</span></div>
          <div className="fld">Project end<span className="cell mono"><b>{fsh(lastDay(S))}</b></span><span className="msg">Latest sprint, work item or cost date</span></div>
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
            <span>Team labour</span><span className="mono">{money(lab)}</span>
            {newRes.length > 0 && (<><span className="msg">· of which new resources</span><span className="mono msg">{money(newSum)}</span></>)}
            <span>Recurring line items</span><span className="mono">{money(recur)}</span>
            <span>One-time line items</span><span className="mono">{money(lineOnce(S))}</span>
            <span className="big">Work budget</span><span className="mono big">{money(R.base)}</span>
            {baselined && Math.abs(pending) > 0.5 && (<><span className="msg">· pending change requests (not in BAC yet)</span><span className="mono msg" title="Live plan minus the approved baseline. It joins BAC when the change request is implemented.">{pending > 0 ? '+' : '−'}{money(Math.abs(pending))}</span></>)}
            <span>Contingency reserve ({pc(R.contPct, 1)})</span><span className="mono">{money(R.contingency)}</span>
            <span className="big">Budget at completion (BAC = work budget + contingency)</span><span className="mono big">{money(R.costBaseline)}</span>
            <span>Management reserve ({pc(R.mgmtPct, 1)})</span><span className="mono">{money(R.management)}</span>
            <span className="big">Total project budget</span><span className="mono big">{money(R.total)}</span>
            <div className="sep" />
            <span className="big">Actual cost to date</span><span className="mono big">{money(ac)}</span>
            <span>Remaining</span><span className="mono" style={pB - ac < 0 ? { color: 'var(--bad)' } : undefined}>{money(pB - ac)}</span>
            <span>Spent</span><span className="mono">{pc(pB ? ac / pB : null)}</span>
          </div>
          <p className="msg" style={{ margin: '12px 0 0', lineHeight: 1.6 }}>
            Contingency = {pc(R.contPct, 1)} × work budget {money(R.base)} = {money(R.contingency)}. Management reserve = {pc(R.mgmtPct, 1)} × work budget = {money(R.management)}.
            {R.locked ? ' Locked by baseline ' + R.version + ': the percentages and amounts stay as approved, even if the work budget moves.' : ' Until a baseline is set the amounts follow the work budget; the percentages can be changed in the planned budget line items.'}
            {' '}Earned value, SPI and CPI are measured against the budget at completion (BAC), which is the work budget plus the contingency reserve. The management reserve is held on top of BAC.
          </p>
        </div>
      </div>

      <StrayCrLines />
      <BudgetHistory lab={lab} />
      <div className="card">
        <div className="row sp">
          <div>
            <h2>Planned budget line items</h2>
            <p className="hint">Beyond team labour: licenses, cloud, tools, travel. Contingency and management reserve are built in at the bottom. Choose how each amount repeats (every week, month or sprint) and enter how many times it recurs, or choose one-time. A cost cannot repeat more often than the project is long.{baselined ? ' Baseline ' + baseOf(S).version + ' has locked these items: any change is made through a change request, and the new baseline it creates becomes the base for every calculation.' : ''}</p>
          </div>
          <button className="btn primary" onClick={() => (baselined ? setLineDlg({}) : update((s) => s.lines.push({ name: '', amount: 0, per: 'week', iterations: Math.min(suggestIter(s, 'week'), maxIter(s, 'week')) })))}>{baselined ? 'Add line item via change request' : 'Add line item'}</button>
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead><tr><th>Line item</th><th className="r">Amount</th><th>Basis</th><th>Iterations</th><th className="r">Project total</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td data-l="Line item"><span className="cell">{newRes.length ? 'Team labour (baseline team)' : 'Team labour (from the labour budget)'}</span></td>
                <td data-l="Amount" className="r mono"><span className="cell">{money(lab - newSum)}</span></td>
                <td data-l="Basis"><span className="cell msg">Project total</span></td>
                <td data-l="Iterations"></td>
                <td data-l="Project total" className="r mono"><span className="cell">{money(lab - newSum)}</span></td>
                <td data-l=""></td>
              </tr>
              {newRes.map((r) => {
                const c = r.crId && crOf(r.crId);
                return (
                  <tr key={'nr' + r.t.person}>
                    <td data-l="Line item"><span className="cell">New resource: {r.name}</span></td>
                    <td data-l="Amount" className="r mono"><span className="cell">{money(r.cost)}</span></td>
                    <td data-l="Basis">
                      <span className="cell" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {c ? <button className={'pill ' + crCls(c.status)} onClick={() => setNav({ tab: 'change' })} title={c.title}>{c.code} · {c.status}</button>
                          : ctl.extra > 0.5 ? <span className="pill warn">CR needed</span>
                          : <span className="msg">Within baseline{freed ? ' (replaces ' + freed + ')' : ''}</span>}
                      </span>
                    </td>
                    <td data-l="Iterations"></td>
                    <td data-l="Project total" className="r mono"><span className="cell">{money(r.cost)}</span></td>
                    <td data-l=""></td>
                  </tr>
                );
              })}
              {S.lines.map((l, i) => {
                const once = l.per === 'project';
                const st = lineState(S, l);
                const edit = lineEditable(S, l);
                const cr = l.crId && crOf(l.crId);
                const was = baseLine(S, l);
                const cap = maxIter(S, l.per);
                const over = !once && nz(l.iterations) > cap;
                // every edit goes through here: iterations are capped, and a line that belongs to a change request keeps its claim in step
                const edited = (patch) => {
                  if ('iterations' in patch && patch.iterations != null && patch.iterations > cap) {
                    ui.toast({ id: 'iter', tone: 'warn', ttl: 7000, text: 'The project has only ' + cap + ' ' + ITER_UNIT[l.per] + ', so “' + (l.name || 'this line') + '” cannot repeat ' + patch.iterations + ' times.' });
                    return;
                  }
                  update((p) => {
                    const x = p.lines.find((y) => y.id === l.id);
                    if (!x) return;
                    Object.assign(x, patch);
                    if (x.per === 'project') x.iterations = 0;
                    syncClaim(p, x);
                  });
                };
                return (
                  <tr key={l.id || i}>
                    <td data-l="Line item"><Cell value={l.name} cls="w-name" placeholder="Line item name" label="Line item name" disabled={!edit} onCommit={(v) => edited({ name: v })} /></td>
                    <td data-l="Amount"><Cell value={l.amount} type="num" cls="w-md n" label="Amount" disabled={!edit} onCommit={(v) => edited({ amount: v })} /></td>
                    <td data-l="Basis"><SelectCell value={l.per} options={BASES} cls="w-md" disabled={!edit} onCommit={(v) => edited({ per: v, iterations: Math.min(suggestIter(S, v), maxIter(S, v)) })} /></td>
                    <td data-l="Iterations">{once ? <span className="cell msg">–</span> : (<span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Cell value={l.iterations} type="num" cls="w-sm n" min={0} label={'How many ' + ITER_UNIT[l.per] + ' this cost recurs (at most ' + cap + ')'} disabled={!edit} onCommit={(v) => edited({ iterations: v == null ? 0 : v })} /><span className="msg" style={over ? { color: 'var(--bad)' } : undefined}>× {ITER_UNIT[l.per]}{over ? ' · max ' + cap : ''}</span></span>)}</td>
                    <td data-l="Project total" className="r mono"><span className="cell">{money(lineTotal(S, l))}</span></td>
                    <td data-l="">
                      <span className="cell" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {st === 'locked' && (<><span className="pill neutral" title={'Locked by baseline ' + baseOf(S).version}>🔒 {baseOf(S).version}</span><button className="btn" onClick={() => setLineDlg({ id: l.id })}>Change via CR</button></>)}
                        {(st === 'new' || st === 'changed') && (<>
                          {cr ? <button className={'pill ' + crCls(cr.status)} onClick={() => setNav({ tab: 'change' })} title={cr.title}>{cr.code} · {cr.status}{st === 'changed' && was ? ' · was ' + money(lineTotal(S, was)) : ''}</button> : <span className="pill bad">Needs a change request</span>}
                          {edit && (st === 'new'
                            ? <button className="x" onClick={() => update((p) => dropPendingLine(p, l.id))} aria-label="Remove this pending line" title="Remove (takes it off the change request)">✕</button>
                            : <button className="btn" onClick={() => update((p) => revertLine(p, l.id))} title="Put back to the baseline values">Revert</button>)}
                        </>)}
                        {st === 'free' && <button className="x" onClick={() => update((s) => { s.lines.splice(i, 1); })} aria-label="Delete line item">✕</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {baselined && Math.abs(gapWork) > 0.5 && (
                <tr className="gap-row"><td data-l="Line item"><span className="cell">{gapWork > 0 ? 'Listed above but not in baseline ' + baseOf(S).version + ' yet (needs a change request)' : 'Below baseline ' + baseOf(S).version + ' (budget not used)'}</span></td><td data-l=""></td><td data-l=""></td><td data-l=""></td><td data-l="Project total" className="r mono"><span className="cell">{signedMoney(-gapWork, money)}</span></td><td data-l=""><span className={'pill ' + (gapWork > 0 ? 'warn' : 'neutral')}>{gapWork > 0 ? 'Not in budget' : 'Freed up'}</span></td></tr>
              )}
              <tr className="sub-row"><td data-l="Line item"><span className="cell">Work budget</span></td><td data-l=""></td><td data-l=""></td><td data-l=""></td><td data-l="Project total" className="r mono"><span className="cell">{money(R.base)}</span></td><td data-l=""></td></tr>
              {reserveRow('contingency', 'Contingency reserve', R.contPct, R.contingency, 'of the work budget, for identified risks')}
              <tr className="sub-row"><td data-l="Line item"><span className="cell">Budget at completion (BAC)</span></td><td data-l=""></td><td data-l=""></td><td data-l=""></td><td data-l="Project total" className="r mono"><span className="cell">{money(R.costBaseline)}</span></td><td data-l=""></td></tr>
              {reserveRow('management', 'Management reserve', R.mgmtPct, R.management, 'of the work budget, for unknown risks')}
            </tbody>
            <tfoot><tr><td>Total project budget</td><td></td><td></td><td></td><td className="r mono">{money(R.total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>

      {lineDlg && (
        <LineCrDialog
          existing={lineDlg.id ? S.lines.find((x) => x.id === lineDlg.id) : null}
          onCancel={() => setLineDlg(null)}
          onConfirm={(choice, v) => {
            update((p) => (lineDlg.id ? changeLineViaCr(p, lineDlg.id, choice, v) : addLineViaCr(p, choice, v)));
            setLineDlg(null);
          }}
        />
      )}

      <Ledger />
    </>
  );
}
