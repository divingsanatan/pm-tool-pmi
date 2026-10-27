import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useCosts } from '../store/useCosts';
import { Cell, SelectCell } from '../components/Field';
import { Modal, useUI } from '../components/UI';
import WeeksControl from '../components/WeeksControl';
import { ITER_UNIT, baseLine, baseOf, costBy, labourOf, labourTotal, ledgerTotal, lineOnce, lineRecurring, lineState, lineTotal, maxIter, personOf, planBAC, projectBAC, reserves, suggestIter } from '../lib/calc';
import LineCrDialog from './LineCrDialog';
import { addLineViaCr, changeLineViaCr, dropPendingLine, lineEditable, revertLine, syncClaim } from '../lib/lineChange';
import { fdate, today } from '../lib/dates';
import { hrsf, money, nz, pc } from '../lib/format';
import { parseCosts } from '../lib/parse';
import { claimLabour, crCls, labourControl, labourCrs, recordBaselineTeam } from '../lib/change';

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
              : 'Planned is the budget spread evenly over the project’s days. One-time line items are not time-phased, so they appear only under By element.'}
          </p>
        </>
      )}
      {paste && <PasteCosts onClose={() => setPaste(false)} />}
    </div>
  );
}

const NEW_CR = '__new';

// Extra labour budget must be claimed through a change request: link it to an open one, or raise a new one for the difference.
function LabourCrDialog({ who, amount, total, baseTotal, version, onConfirm, onCancel }) {
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
        The labour budget would be <b>{money(total)}</b> against <b>{money(baseTotal)}</b> in baseline {version}. The <b>{money(amount)}</b> difference ({who}) is additional budget, so it has to be claimed through a change request.
        Budget freed up by removing someone is used first and needs no request.
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
  const free = S.people.filter((p) => !S.team.some((t) => t.person === p.id));
  const fmtCap = (e) => String(Math.round(nz(e.cap) * 1000) / 10);
  const [pid, setPid] = useState(free[0] ? free[0].id : '');
  const [rate, setRate] = useState(free[0] ? String(free[0].rate == null ? '' : free[0].rate) : '');
  const [cap, setCap] = useState(free[0] ? fmtCap(free[0]) : '100');
  const [hrs, setHrs] = useState('');
  const [off, setOff] = useState('');
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
    if (cap !== '') per.cap = (parseFloat(cap) || 0) / 100;
    if (!p.team.some((t) => t.person === pid)) p.team.push({ person: pid, hours: Math.max(0, parseFloat(hrs) || 0), off: Math.max(0, parseFloat(off) || 0) });
  };
  const save = () => {
    if (!pid) return;
    // after a baseline, extra budget needs a change request. Try the change on a copy first.
    const trial = structuredClone(S);
    build(trial);
    const ctl = labourControl(trial);
    if (ctl.active && ctl.needsCr) {
      const who = (S.people.find((x) => x.id === pid) || {}).name || 'The new stakeholder';
      setNeed({ ctl, who, amount: ctl.short });
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
  if (need) return <LabourCrDialog who={need.who} amount={need.amount} total={need.ctl.nowTotal} baseTotal={need.ctl.baseTotal} version={need.ctl.b.version} onConfirm={confirmClaim} onCancel={() => setNeed(null)} />;
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
        <label className="fld">Total hours on the project<input className="c n" type="number" step="any" inputMode="decimal" value={hrs} onChange={(e) => setHrs(e.target.value)} placeholder="0" /></label>
        <label className="fld">Off hours (to deduct)<input className="c n" type="number" step="any" inputMode="decimal" value={off} onChange={(e) => setOff(e.target.value)} placeholder="0" /></label>
        <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>Available hours = (total hours − off hours) × capacity. Cost = available hours × hourly rate.</p>
        <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Add to budget</button>
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
  const ctl = labourControl(S);
  const rowCtl = Object.fromEntries((ctl.rows || []).map((r) => [r.i, r]));
  const crOf = (id) => S.cr.find((c) => c.id === id);
  const replaces = ctl.active && ctl.removed.length ? ctl.removed.map((x) => x.name).join(', ') : '';
  const used = new Set(S.team.map((t) => t.person));
  const setPerson = (id, patch) => update((s) => void Object.assign(s.people.find((x) => x.id === id), patch));
  const setTeam = (i, patch) => update((s) => void Object.assign(s.team[i], patch));
  const rows = S.team.map((t, i) => ({ t, i, per: personOf(S, t.person), L: labourOf(S, t) })).filter((r) => r.per && r.L);
  const sum = (f) => rows.reduce((a, r) => a + f(r.L), 0);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>Labour budget</h2>
          <p className="hint">Pick a stakeholder, then set their hourly rate, the share of their time available to this project (capacity), the total hours on the project and any off hours to deduct. Available hours = (total hours − off hours) × capacity. Cost = available hours × hourly rate.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add stakeholder</button>
      </div>
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
          <thead><tr><th>Stakeholder</th><th className="r">Hourly rate</th><th className="r">Capacity for project</th><th className="r">Total hrs</th><th className="r">Off hours</th><th className="r">Available hrs</th><th className="r">Total cost</th>{ctl.active && <th>Against baseline</th>}<th></th></tr></thead>
          <tbody>
            {rows.map(({ t, i, per, L }) => (
              <tr key={per.id + ':' + i}>
                <td data-l="Stakeholder"><SelectCell value={t.person} options={S.people.filter((x) => x.id === t.person || !used.has(x.id)).map((x) => [x.id, x.name || '(unnamed)'])} cls="w-md" onCommit={(v) => update((s) => { s.team[i].person = v; })} /></td>
                <td data-l="Hourly rate"><Cell value={per.rate} type="num" cls="w-md n" label="Hourly rate" onCommit={(v) => setPerson(per.id, { rate: v == null ? 0 : v })} /></td>
                <td data-l="Capacity %"><Cell value={per.cap} type="pct" cls="w-md n" label="Capacity for this project in percent" onCommit={(v) => setPerson(per.id, { cap: v == null ? 0 : v })} /></td>
                <td data-l="Total hrs"><Cell value={t.hours} type="num" cls="w-md n" label="Total hours on the project" onCommit={(v) => setTeam(i, { hours: v == null ? 0 : Math.max(0, v) })} /></td>
                <td data-l="Off hours"><Cell value={t.off} type="num" cls="w-md n" label="Off hours deducted from the total" onCommit={(v) => setTeam(i, { off: v == null ? 0 : Math.max(0, v) })} /></td>
                <td data-l="Available hrs" className="r mono"><span className="cell" title={L.overOff ? 'Off hours are more than the total hours, so no hours are available' : undefined} style={L.overOff ? { color: 'var(--bad)' } : undefined}>{hrsf(L.avail)}</span></td>
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
                <td data-l=""><button className="x" onClick={() => update((s) => { s.team.splice(i, 1); })} aria-label="Remove from the labour budget" title="Remove from the labour budget (they stay in RACI)">✕</button></td>
              </tr>
            ))}
            {!rows.length && (<tr className="empty-row"><td colSpan={ctl.active ? 9 : 8}><span className="cell msg">Nobody in the labour budget yet. Use “+ Add stakeholder”.</span></td></tr>)}
          </tbody>
          {rows.length > 0 && (<tfoot><tr><td>Total</td><td></td><td></td><td className="r mono">{hrsf(sum((l) => l.total))}</td><td className="r mono">{hrsf(sum((l) => l.off))}</td><td className="r mono">{hrsf(sum((l) => l.avail))}</td><td className="r mono">{money(sum((l) => l.cost))}</td>{ctl.active && <td className="msg"><span className="cell">Baseline {money(ctl.baseTotal)}</span></td>}<td></td></tr></tfoot>)}
        </table>
      </div>
      {ctl.active && ctl.removed.length > 0 && <p className="msg" style={{ marginTop: 8 }}>Removed since baseline {ctl.b.version}: {ctl.removed.map((x) => x.name + ' (' + money(x.cost) + ' released)').join(', ')}.</p>}
      {rows.some((r) => r.L.overOff) && <p className="msg lateTxt" style={{ marginTop: 8 }}>Off hours are higher than total hours for at least one stakeholder, so their available hours are counted as 0.</p>}
      {adding && <AddLabour onClose={() => setAdding(false)} />}
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
        <p className="hint">The weekly budget is multiplied by the number of weeks, and the number of weeks follows your dated work items, sprints and costs.</p>
        <div className="fields">
          <label className="fld">Start date (Monday of week 1)<Cell sec="meta" f="start" value={S.meta.start} type="date" cls="w-date" disabled={baselined} /></label>
          {baselined && <p className="msg" style={{ margin: 0 }}>The start date is part of baseline {baseOf(S).version}. A change goes through a change request.</p>}
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
