import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useChange } from '../store/useChange';
import { useUI } from '../components/UI';
import Kpi from '../components/Kpi';
import { Cell } from '../components/Field';
import { fdate } from '../lib/dates';
import { hrsf, money, nz } from '../lib/format';
import { CR_STATUSES, crCls, currentBaseline, drift, pendingOf, signedDays, signedMoney, snapshot, stageOf } from '../lib/change';
import ChangeDrawer from './ChangeDrawer';

export default function Change() {
  const { S } = useStore();
  const ch = useChange();
  const ui = useUI();
  const [open, setOpen] = useState(null);
  const [f, setF] = useState('All');
  const [note, setNote] = useState('');

  const base = currentBaseline(S);
  const d = drift(S);
  const P = pendingOf(S);
  const who = (id) => (S.people.find((p) => p.id === id) || {}).name || '';
  const count = (s) => S.cr.filter((c) => s === 'All' || c.status === s).length;
  const rows = S.cr.filter((c) => f === 'All' || c.status === f).slice().reverse();
  const live = snapshot(S);

  const setBase = () =>
    ui.ask({
      title: 'Set baseline v1.0?',
      body: 'The plan as it stands now (budget ' + money(live.bac) + ', finish ' + fdate(live.end) + ', ' + live.items + ' work items) becomes the approved baseline. After this, every change to it goes through a change request.',
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
            <span>Budget at completion</span><span className="mono">{money(live.bac)}</span>
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
          <Kpi l="Baseline budget" v={money(base.bac)} s={d && Math.abs(d.dCost) > 0.5 ? 'Plan now ' + money(d.live.bac) + ' (' + signedMoney(d.dCost, money) + ')' : 'Plan matches'} />
          <Kpi l="Awaiting decision" v={P.open.length} s={P.open.length ? signedMoney(P.openCost, money) + ' · ' + signedDays(P.openDays) + ' if all approved' : 'Nothing pending'} />
          <Kpi l="Approved, not in baseline" v={P.appr.length} s={P.appr.length ? signedMoney(P.apprCost, money) + ' · ' + signedDays(P.apprDays) : 'None'} />
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
                    <td data-l="Days" className="r mono"><span className="cell">{days_ == null ? '–' : signedDays(nz(days_))}</span></td>
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
        <p className="hint">Each version is a frozen copy of scope, schedule and cost. A new version appears when an approved change is implemented. You can correct a version’s name, date, budget, finish and note here, delete a version, or re-capture the latest one from the plan as it is now.</p>
        <div className="scroll">
          <table className="tbl rwd">
            <thead>
              <tr><th>Version</th><th>Date</th><th>Source</th><th className="r">Budget</th><th className="r">Change</th><th>Finish</th><th className="r">Shift</th><th className="r">Work items</th><th className="r">Effort (h)</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {S.baselines.slice().reverse().map((b, i, arr) => {
                const prev = arr[i + 1];
                return (
                  <tr key={b.id}>
                    <td data-l="Version" className="mono"><span className="cell"><Cell value={b.version} cls="w-sm" label="Version name" onCommit={(v) => v.trim() && ch.patchBaseline(b.id, { version: v.trim() })} />{i === 0 && <span className="pill neutral">Current</span>}</span></td>
                    <td data-l="Date"><Cell type="date" value={b.date} cls="w-date" label="Baseline date" onCommit={(v) => ch.patchBaseline(b.id, { date: v || b.date })} /></td>
                    <td data-l="Source"><span className="cell">{b.crCode || 'Original plan'}</span></td>
                    <td data-l="Budget"><Cell type="num" value={b.bac} cls="w-md n" label="Baseline budget" onCommit={(v) => ch.patchBaseline(b.id, { bac: v == null ? 0 : v })} /></td>
                    <td data-l="Change" className="r mono"><span className="cell">{prev ? signedMoney(b.bac - prev.bac, money) : '–'}</span></td>
                    <td data-l="Finish"><Cell type="date" value={b.end} cls="w-date" label="Baseline finish date" onCommit={(v) => ch.patchBaseline(b.id, { end: v || b.end })} /></td>
                    <td data-l="Shift" className="r mono"><span className="cell">{prev ? signedDays(Math.round((Date.parse(b.end) - Date.parse(prev.end)) / 86400000)) : '–'}</span></td>
                    <td data-l="Work items" className="r mono"><span className="cell">{b.items}</span></td>
                    <td data-l="Effort (h)" className="r mono"><span className="cell">{hrsf(b.effort)}</span></td>
                    <td data-l="Note"><Cell value={b.note} cls="w-desc" label="Baseline note" placeholder="Note" onCommit={(v) => ch.patchBaseline(b.id, { note: v })} /></td>
                    <td data-l="">
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {i === 0 && (<button className="linkbtn" title="Replace this version’s figures with the plan as it is now" onClick={() => ui.ask({ title: 'Re-capture ' + b.version + '?', body: 'This version’s budget, finish date, work items and effort are replaced with the plan as it stands now (budget ' + money(live.bac) + ', finish ' + fdate(live.end) + ').', confirm: 'Re-capture', onConfirm: () => ch.recaptureBaseline(b.id) })}>Re-capture</button>)}
                        <button className="x" aria-label={'Delete baseline ' + b.version} onClick={() => ui.ask({ title: 'Delete baseline ' + b.version + '?', body: (S.baselines.length === 1 ? 'This is the only baseline, so change requests will have nothing to measure against until you set a new one. ' : '') + 'Change requests stay on record, but ' + (b.crCode ? b.crCode + ' will no longer point to this version. ' : '') + 'This cannot be undone.', confirm: 'Delete baseline', danger: true, onConfirm: () => ch.removeBaseline(b.id) })}>✕</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!S.baselines.length && (<tr className="empty-row"><td colSpan="11"><span className="cell msg">No baseline yet.</span></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {open && <ChangeDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
