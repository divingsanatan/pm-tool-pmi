import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useChange } from '../store/useChange';
import { useUI } from '../components/UI';
import Kpi from '../components/Kpi';
import { Cell } from '../components/Field';
import { fdate } from '../lib/dates';
import { hrsf, money, nz, pc } from '../lib/format';
import { reserves } from '../lib/calc';
import { CR_STATUSES, crCls, currentBaseline, drift, pendingOf, signedDays, signedMoney, signedWorkDays, snapshot, stageOf, baselineFigures } from '../lib/change';
import '../breakdown.css';
import { calendarOf, workDaysAfter } from '../lib/offdays';
import { crJump } from '../lib/drafts';
import ChangeDrawer from './ChangeDrawer';

export default function Change() {
  const { S } = useStore();
  const ch = useChange();
  const ui = useUI();
  const [open, setOpen] = useState(null);
  // sent here from a draft sprint: open its change request so the details can be completed
  useEffect(() => { if (crJump.id) { const k = crJump.id; crJump.id = null; setOpen(k); } }); // runs after every render, so it also works when this tab is already showing
  const [f, setF] = useState('All');
  const [note, setNote] = useState('');

  const base = currentBaseline(S);
  const d = drift(S);
  const P = pendingOf(S);
  const who = (id) => (S.people.find((p) => p.id === id) || {}).name || '';
  const count = (s) => S.cr.filter((c) => s === 'All' || c.status === s).length;
  const rows = S.cr.filter((c) => f === 'All' || c.status === f).slice().reverse();
  const live = snapshot(S);
  const RS = reserves(S);
  const br = base && base.reserve; // the reserves frozen in the current baseline
  const bTotal = base ? base.bac + (br ? nz(br.management) : 0) : 0; // base.bac already includes the contingency

  const setBase = () =>
    ui.ask({
      title: 'Set baseline v1.0?',
      body: 'The plan as it stands now (work budget ' + money(RS.base) + ' + contingency ' + money(RS.contingency) + ' = budget at completion ' + money(live.bac) + ', plus management reserve ' + money(RS.management) + ' = total project budget ' + money(RS.total) + ', finish ' + fdate(live.end) + ', ' + live.items + ' work items) becomes the approved baseline. After this, every change to it goes through a change request.',
      confirm: 'Set baseline',
      onConfirm: () => ch.setInitialBaseline(note),
    });
  const raise = () => setOpen(ch.add({}));

  return (
    <>
      {!base && (
        <section className="card">
          <h2>Set the baseline first</h2>
          <p className="hint">A change request measures its impact against an approved baseline: the scope, schedule and cost you committed to. Capture the plan as it stands now. This should be the version the sponsor approved.</p>
          <div className="totals" style={{ maxWidth: 420 }}>
            <span>Work budget</span><span className="mono">{money(RS.base)}</span>
            <span>Contingency reserve ({pc(RS.contPct, 1)})</span><span className="mono">{money(RS.contingency)}</span>
            <span>Budget at completion (BAC = work budget + contingency)</span><span className="mono">{money(live.bac)}</span>
            <span>Management reserve ({pc(RS.mgmtPct, 1)})</span><span className="mono">{money(RS.management)}</span>
            <span>Total project budget</span><span className="mono">{money(RS.total)}</span>
            <span>Finish date</span><span className="mono">{fdate(live.end)}</span>
            <span>Work items in sprints</span><span className="mono">{live.items}</span>
            <span>Planned effort (hours)</span><span className="mono">{hrsf(live.effort)}</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input className="c" style={{ maxWidth: 360, borderColor: 'var(--line)' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. approved by the sponsor on 7 Sep" aria-label="Baseline note" />
            <button className="btn primary" onClick={setBase}>Set baseline v1.0</button>
          </div>
        </section>
      )}

      {base && (
        <section className="kpis">
          <Kpi l="Current baseline" v={base.version} s={'Set ' + fdate(base.date) + (base.crCode ? ' by ' + base.crCode : '')} />
          <Kpi l="Baseline BAC" v={money(base.bac)} s={d && Math.abs(d.dCost) > 0.5 ? 'Plan now ' + money(d.live.bac) + ' (' + signedMoney(d.dCost, money) + ')' : 'Plan matches'} />
          <Kpi l="Total project budget" v={money(bTotal)} s={br ? 'BAC (incl. contingency ' + money(br.contingency) + ') + management reserve ' + money(br.management) : 'BAC only'} />
          <Kpi l="Awaiting decision" v={P.open.length} s={P.open.length ? signedMoney(P.openCost, money) + ' · ' + signedWorkDays(P.openDays) + ' if all approved' : 'Nothing pending'} />
          <Kpi l="Approved, not in baseline" v={P.appr.length} s={P.appr.length ? signedMoney(P.apprCost, money) + ' · ' + signedWorkDays(P.apprDays) : 'None'} />
        </section>
      )}

      <section className="card">
        <div className="row sp">
          <div>
            <h2>Change requests</h2>
            <p className="hint">Every change to scope, schedule or cost is raised here, assessed, decided, then folded into a new baseline.</p>
          </div>
          <button className="btn primary" onClick={raise} disabled={!base} title={base ? '' : 'Set the baseline first'}>Raise change request</button>
        </div>
        <div className="filters">
          <div className="fgroup">
            <span className="flabel">Status</span>
            <div className="chips" role="group" aria-label="Filter by status">
              {['All'].concat(CR_STATUSES).map((s) => (
                <button key={s} className="chip" aria-pressed={f === s} onClick={() => setF(s)}>{s === 'All' ? 'All' : s}<span className="cnt">{count(s)}</span></button>
              ))}
            </div>
          </div>
        </div>
        <div className="scroll">
          <table className="tbl rwd">
            <thead>
              <tr><th>ID</th><th>Title</th><th>Type</th><th>Priority</th><th>Status</th><th>Raised by</th><th>Raised</th><th className="r">Cost</th><th className="r">Days</th><th>Next step</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const sg = stageOf(c, S);
                const money_ = c.status === 'Approved' || c.status === 'Implemented' || c.status === 'Closed' ? c.apCost : c.cost;
                const days_ = c.status === 'Approved' || c.status === 'Implemented' || c.status === 'Closed' ? c.apDays : c.days;
                return (
                  <tr key={c.id}>
                    <td data-l="ID" className="mono"><span className="cell">{c.code}</span></td>
                    <td data-l="Title"><button className="tg-title" onClick={() => setOpen(c.id)}>{c.title || '(untitled)'}</button></td>
                    <td data-l="Type"><span className="cell">{c.kind || '–'}</span></td>
                    <td data-l="Priority"><span className="cell">{c.priority === 'Emergency' ? <span className="pill bad">Emergency</span> : c.priority}</span></td>
                    <td data-l="Status"><span className="cell"><span className={'pill ' + crCls(c.status)}>{c.status}</span></span></td>
                    <td data-l="Raised by"><span className="cell">{who(c.by) || '–'}</span></td>
                    <td data-l="Raised"><span className="cell">{fdate(c.on)}</span></td>
                    <td data-l="Cost" className="r mono"><span className="cell">{money_ == null ? '–' : signedMoney(nz(money_), money)}</span></td>
                    <td data-l="Days" className="r mono"><span className="cell">{days_ == null ? '–' : signedWorkDays(nz(days_))}</span></td>
                    <td data-l="Next step"><span className="cell">{sg ? (<span className={'pill ' + (sg.done === sg.total ? 'good' : 'warn')}>{sg.to}: {sg.done}/{sg.total}</span>) : ''}</span></td>
                    <td data-l=""><button className="btn" onClick={() => setOpen(c.id)}>Open</button></td>
                  </tr>
                );
              })}
              {!rows.length && (<tr className="empty-row"><td colSpan="11"><span className="cell msg">{S.cr.length ? 'No change requests match this filter.' : 'No change requests yet.'}</span></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Baseline history</h2>
        <p className="hint">Each version is a frozen copy of scope, schedule and cost. A new version appears when an approved change is implemented. You can correct a version’s name, date, finish and note here (the amount is set by the plan and its change requests), delete the newest version, or re-capture it from the plan as it is now.</p>
        <div className="scroll">
          <table className="tbl rwd bl">
            <thead>
              <tr><th>Version</th><th>Date</th><th>Source</th><th className="r" title="The work budget">Amount</th><th className="r" title="Contingency and management reserve">Reserves</th><th className="r" title="Amount plus both reserves">Total budget</th><th className="r" title="Total budget compared with the version before">Change</th><th>Finish</th><th className="r" title="Schedule change as approved, in working days">Shift</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {S.baselines.slice().reverse().map((b, i, arr) => {
                const prev = arr[i + 1];
                const f = baselineFigures(b), pf = prev ? baselineFigures(prev) : null;
                // The shift is the request's schedule change in working days (as approved), so the baseline and its request agree.
                // The finish date can move by more calendar days: weekends, holidays and gaps between sprints sit in between.
                const crOf = prev && b.crId ? S.cr.find((c) => c.id === b.crId) : null;
                const dd = prev ? Math.round((Date.parse(b.end) - Date.parse(prev.end)) / 86400000) : 0;
                const wdShift = !prev ? null : crOf && crOf.apDays != null ? nz(crOf.apDays) : dd >= 0 ? workDaysAfter(calendarOf(S), prev.end, b.end) : -workDaysAfter(calendarOf(S), b.end, prev.end);
                const shiftTxt = wdShift == null ? '–' : signedWorkDays(wdShift);
                const shiftTip = !prev ? '' : (crOf && crOf.apDays != null ? 'As approved in ' + crOf.code + '. ' : '') + 'The finish date moved ' + Math.abs(dd) + ' calendar day' + (Math.abs(dd) === 1 ? '' : 's') + ' (' + fdate(prev.end) + ' → ' + fdate(b.end) + '), which includes any weekend, holiday or gap between sprints.';
                return (
                  <tr key={b.id} className={i === 0 ? 'bl-current' : ''}>
                    <td data-l="Version" className="mono"><span className="cell"><Cell value={b.version} cls="w-sm" label="Version name" onCommit={(v) => v.trim() && ch.patchBaseline(b.id, { version: v.trim() })} />{i === 0 && <span className="pill neutral">Current</span>}</span></td>
                    <td data-l="Date"><Cell type="date" value={b.date} cls="w-date" label="Baseline date" onCommit={(v) => ch.patchBaseline(b.id, { date: v || b.date })} /></td>
                    <td data-l="Source"><span className="cell" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className={'chip' + (b.crCode ? ' chg' : '')}>{b.crCode || 'Original plan'}</span>{crOf && crOf.title && <small className="msg" style={{ fontSize: 11 }}>{crOf.title}</small>}</span></td>
                    <td data-l="Amount" className="r mono"><span className="cell bl-amt" title="The work budget. It comes from the plan and approved change requests, so it cannot be edited here.">{money(f.work)}</span></td>
                    <td data-l="Reserves" className="r mono">
                      <span className="cell bstack" title={b.reserve ? 'Contingency ' + money(f.contingency) + ' + management reserve ' + money(f.management) : ''}>
                        {b.reserve ? money(f.contingency + f.management) : '–'}
                        {b.reserve && <small>contingency {money(f.contingency)} ({pc(f.contPct, 1)})</small>}
                        {b.reserve && <small>management {money(f.management)} ({pc(f.mgmtPct, 1)})</small>}
                      </span>
                    </td>
                    <td data-l="Total budget" className="r mono">
                      <span className="cell bstack" title="Amount + contingency + management reserve"><b>{money(f.total)}</b><small>BAC {money(f.bac)}</small></span>
                    </td>
                    <td data-l="Change" className="r mono">
                      <span className="cell bstack">
                        {pf ? <span className={f.total - pf.total >= 0.005 ? 'up' : f.total - pf.total <= -0.005 ? 'down' : ''}>{signedMoney(f.total - pf.total, money)}</span> : '–'}
                        {pf && <small>amount {signedMoney(f.work - pf.work, money)} · reserves {signedMoney(f.contingency + f.management - pf.contingency - pf.management, money)}</small>}
                      </span>
                    </td>
                    <td data-l="Finish">{b.sprints && b.sprints.some((x) => x.start && x.end) ? (<span className="cell mono" title="Latest sprint end of this baseline">{fdate(b.end)}</span>) : (<Cell type="date" value={b.end} cls="w-date" label="Baseline finish date" onCommit={(v) => ch.patchBaseline(b.id, { end: v || b.end })} />)}</td>
                    <td data-l="Shift" className="r mono"><span className="cell" title={shiftTip}>{shiftTxt}</span></td>
                    <td data-l="Note"><Cell value={b.note} cls="w-desc" label="Baseline note" placeholder="Note" onCommit={(v) => ch.patchBaseline(b.id, { note: v })} /></td>
                    <td data-l="">
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {i === 0 && (<button className="linkbtn" title="Replace this version’s figures with the plan as it is now" onClick={() => ui.ask({ title: 'Re-capture ' + b.version + '?', body: 'This version’s budget, finish date, work items and effort are replaced with the plan as it stands now (budget ' + money(live.bac) + ', finish ' + fdate(live.end) + ').', confirm: 'Re-capture', onConfirm: () => ch.recaptureBaseline(b.id) })}>Re-capture</button>)}
                        {i === 0 && (<button className="x" aria-label={'Delete baseline ' + b.version} title="Delete the newest baseline" onClick={() => ui.ask({ title: 'Delete baseline ' + b.version + '?', body: (<><p style={{ margin: '0 0 8px' }}>{b.crCode ? b.crCode + ' goes back to Approved, so you can correct its approved cost and days and implement it again.' : 'This is the initial baseline.'}{' '}{prev ? 'Baseline ' + prev.version + ' (budget ' + money(prev.bac) + ', finish ' + fdate(prev.end) + ') becomes the current baseline again.' : 'No baseline will remain, so change requests have nothing to measure against until you set a new one.'}</p><p style={{ margin: 0 }}>Only the newest baseline can be deleted. This cannot be undone.</p></>), confirm: 'Delete baseline', danger: true, onConfirm: () => ch.removeBaseline(b.id) })}>✕</button>)}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!S.baselines.length && (<tr className="empty-row"><td colSpan="11"><span className="cell msg">No baseline yet.</span></td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="bl-legend"><b>Amount</b> is the work budget. <b>Reserves</b> are contingency (for identified risks) plus management reserve (held outside the baseline). <b>Total budget</b> = amount + reserves; <b>BAC</b> = amount + contingency, what progress is measured against. <b>Change</b> compares the total with the version before.</p>
      </section>

      {open && <ChangeDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
