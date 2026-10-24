import { useEffect } from 'react';
import { useStore } from '../store/StoreContext';
import { useChange } from '../store/useChange';
import { useUI } from '../components/UI';
import { Area, Cell, SelectCell } from '../components/Field';
import { addDays, fdate } from '../lib/dates';
import { money, nz } from '../lib/format';
import { allContainers } from '../lib/tasks';
import { AREAS, CR_PRIORITIES, KINDS, NEXT, WORKFLOW, checksFor, crCls, currentBaseline, missing, reconcile, signedDays, signedMoney, stageOf } from '../lib/change';

// A list of chosen items shown as chips, with a dropdown to add more
function Picker({ ids, options, onChange, disabled, label }) {
  const name = (id) => (options.find((o) => o[0] === id) || [id, '(removed)'])[1];
  const left = options.filter((o) => !ids.includes(o[0]));
  return (
    <div className="chips-a">
      {ids.map((id) => (
        <span key={id} className="chip-a">
          {name(id)}
          {!disabled && <button className="x" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={'Remove ' + name(id)}>✕</button>}
        </span>
      ))}
      {!disabled && left.length > 0 && (
        <select className="c" style={{ width: 'auto', borderColor: 'var(--line)' }} value="" aria-label={label} onChange={(e) => e.target.value && onChange(ids.concat(e.target.value))}>
          <option value="">+ Add…</option>
          {left.map((o) => (<option key={o[0]} value={o[0]}>{o[1]}</option>))}
        </select>
      )}
      {disabled && !ids.length && <span className="msg">None</span>}
    </div>
  );
}

function Checklist({ list }) {
  return (
    <ul className="ck">
      {list.map((c) => (
        <li key={c.key}>
          <span className={'m ' + (c.ok ? 'ok' : c.req ? 'no' : 'rec')} aria-hidden="true">{c.ok ? '✓' : c.req ? '!' : '○'}</span>
          <span>{c.label} <span className="tag">{c.req ? 'Required' : 'Recommended'}</span></span>
        </li>
      ))}
    </ul>
  );
}

export default function ChangeDrawer({ id, onClose }) {
  const { S, setNav } = useStore();
  const ch = useChange();
  const ui = useUI();
  const cr = S.cr.find((x) => x.id === id);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    if (!cr) onClose();
  }, [cr, onClose]);
  if (!cr) return null;

  const st = cr.status;
  const set = (patch) => ch.patch(cr.id, patch);
  const base = currentBaseline(S);
  const people = [['', '— select —']].concat(S.people.filter((p) => p.name).map((p) => [p.id, p.name]));
  const who = (pid) => (S.people.find((p) => p.id === pid) || {}).name || '';
  const tasks = allContainers(S).flatMap((c) => c.tasks.map((t) => [t.id, t.code + ' · ' + t.name]));
  const raid = S.raid.map((r) => [r.id, r.id + ' · ' + (r.desc || r.type)]);
  const informed = S.people.filter((p) => p.name).map((p) => [p.id, p.name]);

  const lockReq = st !== 'Draft';
  const lockImp = !['Draft', 'Submitted', 'Under review'].includes(st);
  const lockDec = st !== 'Under review';
  const lockOwn = !['Under review', 'Approved'].includes(st);
  const lockImpl = st !== 'Approved';
  const lockClose = st !== 'Implemented';
  const showDecision = ['Under review', 'Approved', 'Rejected', 'Deferred', 'Implemented', 'Closed'].includes(st);
  const showImpl = ['Approved', 'Implemented', 'Closed'].includes(st);
  const showClose = ['Implemented', 'Closed'].includes(st);

  const sg = stageOf(cr, S);
  const go = (to, label) => {
    const m = missing(cr, to, S);
    return { to, label, m, ok: !m.length };
  };
  const rec = st === 'Approved' ? reconcile(cr, S) : null;
  const visit = (tab) => {
    setNav({ view: 'project', tab });
    onClose();
  };
  const toggleArea = (a) => set({ affects: cr.affects.includes(a) ? cr.affects.filter((x) => x !== a) : cr.affects.concat(a) });
  const tick = (k) => (e) => set({ chk: { ...cr.chk, [k]: e.target.checked } });

  const moveBtn = (to, label, cls = 'btn', ask) => {
    const g = go(to, label);
    return (
      <button
        key={to}
        className={cls}
        disabled={!g.ok}
        title={g.ok ? '' : 'Still needed: ' + g.m.map((x) => x.label).join('; ')}
        onClick={() => (ask ? ui.ask({ ...ask, onConfirm: () => ch.setStatus(cr.id, to) }) : ch.setStatus(cr.id, to))}
      >
        {label}
      </button>
    );
  };

  const newBac = base ? base.bac + nz(cr.cost) : null;
  const newEnd = base ? addDays(base.end, nz(cr.days)) : null;

  return (
    <>
      <div className="drawer-bg" onMouseDown={onClose} />
      <aside className="drawer wide" role="dialog" aria-label="Change request">
        <div className="row sp">
          <span className="row" style={{ gap: 8 }}>
            <span className="msg mono">{cr.code}</span>
            <span className={'pill ' + crCls(st)}>{st}</span>
          </span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <Area value={cr.title} single rows={2} cls="h-name d-name" label="Change request title" placeholder="Title of the change" disabled={lockReq} onCommit={(v) => v.trim() && set({ title: v.trim() })} />

        <div className="steps" aria-label="Progress">
          {WORKFLOW.map((s) => (<span key={s} className={s === st ? 'on' : WORKFLOW.indexOf(s) < WORKFLOW.indexOf(st) ? 'past' : ''}>{s}</span>))}
          {(st === 'Rejected' || st === 'Deferred') && <span className="on bad">{st}</span>}
        </div>

        {sg && (
          <div className="d-panel">
            <h3 className="d-h" style={{ marginTop: 0 }}>Before this can move to “{sg.to}” · {sg.done} of {sg.total} required done</h3>
            <Checklist list={sg.list} />
          </div>
        )}
        {st === 'Under review' && (
          <div className="d-panel" style={{ marginTop: 10 }}>
            <h3 className="d-h" style={{ marginTop: 0 }}>To approve, reject or defer</h3>
            <Checklist list={checksFor(cr, 'Approved', S)} />
          </div>
        )}
        {st === 'Rejected' && <p className="msg">Rejected requests stay on record and cannot be changed. Raise a new request if the situation changes.</p>}
        {st === 'Deferred' && <p className="msg">Deferred: resume the review when the board is ready to decide again.</p>}

        <h3 className="d-h">1 · The request</h3>
        <div className="d-grid">
          <label className="fld">Type of change
            <SelectCell value={cr.kind} options={[['', '— select —']].concat(KINDS)} disabled={lockReq} onCommit={(v) => set({ kind: v })} />
          </label>
          <label className="fld">Priority
            <SelectCell value={cr.priority} options={CR_PRIORITIES} disabled={lockReq} onCommit={(v) => set({ priority: v })} />
          </label>
          <label className="fld">Raised by
            <SelectCell value={cr.by} options={people} disabled={lockReq} onCommit={(v) => set({ by: v })} />
          </label>
          <label className="fld">Date raised
            <Cell type="date" value={cr.on} disabled={lockReq} onCommit={(v) => set({ on: v || '' })} />
          </label>
          <div className="fld" style={{ gridColumn: '1 / -1' }}>Baselines affected
            <div className="chips" role="group" aria-label="Baselines affected">
              {AREAS.map((a) => (<button key={a} className="chip" aria-pressed={cr.affects.includes(a)} disabled={lockReq} onClick={() => toggleArea(a)}>{a}</button>))}
            </div>
          </div>
          <label className="fld" style={{ gridColumn: '1 / -1' }}>Description: what is changing
            <Area value={cr.desc} rows={3} label="Description" disabled={lockReq} placeholder="Describe the change precisely" onCommit={(v) => set({ desc: v })} />
          </label>
          <label className="fld" style={{ gridColumn: '1 / -1' }}>Justification: why it is needed
            <Area value={cr.why} rows={3} label="Justification" disabled={lockReq} placeholder="The problem, opportunity, requirement or defect behind the request" onCommit={(v) => set({ why: v })} />
          </label>
          <label className="fld" style={{ gridColumn: '1 / -1' }}>Evidence or reference
            <Cell value={cr.ref} label="Reference" disabled={lockReq} placeholder="Link, document name or ticket number" onCommit={(v) => set({ ref: v || '' })} />
          </label>
        </div>

        <h3 className="d-h">2 · Links</h3>
        <div className="d-grid">
          <div className="fld" style={{ gridColumn: '1 / -1' }}>Work items affected
            <Picker ids={cr.tasks} options={tasks} disabled={lockImp} label="Add work item" onChange={(v) => set({ tasks: v })} />
          </div>
          <div className="fld" style={{ gridColumn: '1 / -1' }}>Related RAID items
            <Picker ids={cr.raid} options={raid} disabled={lockImp} label="Add RAID item" onChange={(v) => set({ raid: v })} />
          </div>
          <div className="fld" style={{ gridColumn: '1 / -1' }}>Stakeholders to inform
            <Picker ids={cr.informed} options={informed} disabled={lockImp} label="Add stakeholder" onChange={(v) => set({ informed: v })} />
          </div>
        </div>

        <h3 className="d-h">3 · Impact assessment</h3>
        <div className="d-grid">
          <label className="fld">Cost impact (money, negative saves)
            <Cell type="num" cls="n" value={cr.cost} placeholder="0" disabled={lockImp} onCommit={(v) => set({ cost: v })} />
          </label>
          <label className="fld">Schedule impact (days, negative is earlier)
            <Cell type="num" cls="n" value={cr.days} placeholder="0" disabled={lockImp} onCommit={(v) => set({ days: v })} />
          </label>
          {base && (
            <p className="msg" style={{ gridColumn: '1 / -1', margin: 0 }}>
              If approved as assessed: budget {money(base.bac)} → <b>{money(newBac)}</b> ({signedMoney(nz(cr.cost), money)}), finish {fdate(base.end)} → <b>{fdate(newEnd)}</b> ({signedDays(nz(cr.days))}).
            </p>
          )}
          {[['iScope', 'Scope impact'], ['iQuality', 'Quality impact'], ['iResources', 'Resource impact'], ['iRisk', 'Risk impact (new or changed risks)'], ['alt', 'Alternatives considered'], ['noop', 'If the change is not made']].map(([k, l]) => (
            <label key={k} className="fld" style={{ gridColumn: '1 / -1' }}>{l}
              <Area value={cr[k]} rows={2} label={l} disabled={lockImp} onCommit={(v) => set({ [k]: v })} />
            </label>
          ))}
        </div>

        {showDecision && (
          <>
            <h3 className="d-h">4 · Decision</h3>
            <div className="d-grid">
              <label className="fld">Decided by
                <SelectCell value={cr.decidedBy} options={people} disabled={lockDec} onCommit={(v) => set({ decidedBy: v })} />
              </label>
              <label className="fld">Decision date
                <Cell type="date" value={cr.decidedOn} disabled={lockDec} onCommit={(v) => set({ decidedOn: v || '' })} />
              </label>
              <label className="fld" style={{ gridColumn: '1 / -1' }}>Reason for the decision
                <Area value={cr.rationale} rows={2} label="Reason for the decision" disabled={lockDec} onCommit={(v) => set({ rationale: v })} />
              </label>
              <label className="fld">Approved cost impact
                <Cell type="num" cls="n" value={cr.apCost} disabled={lockDec} onCommit={(v) => set({ apCost: v })} />
              </label>
              <label className="fld">Approved schedule impact (days)
                <Cell type="num" cls="n" value={cr.apDays} disabled={lockDec} onCommit={(v) => set({ apDays: v })} />
              </label>
              <label className="fld">Implementation owner
                <SelectCell value={cr.owner} options={people} disabled={lockOwn} onCommit={(v) => set({ owner: v })} />
              </label>
              <label className="fld">Target date
                <Cell type="date" value={cr.target} disabled={lockOwn} onCommit={(v) => set({ target: v || '' })} />
              </label>
              <label className="fld" style={{ gridColumn: '1 / -1' }}>Conditions or constraints
                <Area value={cr.conditions} rows={2} label="Conditions" disabled={lockOwn} onCommit={(v) => set({ conditions: v })} />
              </label>
            </div>
          </>
        )}

        {showImpl && (
          <>
            <h3 className="d-h">5 · Implementation and baseline</h3>
            <div className="ck-box">
              {[['comms', 'Decision communicated to the requester and affected stakeholders'], ['docs', 'Project plan documents updated (scope, schedule, budget, RACI)'], ['raid', 'RAID log updated for new or changed risks'], ['wbs', 'Work items and budget changed to match the approval']].map(([k, l]) => (
                <label key={k} className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={!!cr.chk[k]} disabled={lockImpl} onChange={tick(k)} style={{ marginTop: 3 }} /> <span>{l}</span>
                </label>
              ))}
            </div>
            {st === 'Approved' && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="msg">Make the changes here:</span>
                <button className="linkbtn" onClick={() => visit('budget')}>Budget</button>
                <button className="linkbtn" onClick={() => visit('time')}>Timeline</button>
                <button className="linkbtn" onClick={() => visit('raid')}>RAID log</button>
                <button className="linkbtn" onClick={() => visit('people')}>Stakeholders</button>
              </div>
            )}
            {rec && (
              <div className="d-panel" style={{ marginTop: 10 }}>
                <div className="totals">
                  <span>Baseline {rec.b.version} budget</span><span className="mono">{money(rec.b.bac)}</span>
                  <span>Approved cost impact</span><span className="mono">{signedMoney(nz(cr.apCost), money)}</span>
                  <span>Expected new budget</span><span className="mono">{money(rec.expCost)}</span>
                  <span>Budget in the plan now</span><span className="mono">{money(rec.live.bac)}</span>
                  <span>Baseline finish</span><span className="mono">{fdate(rec.b.end)}</span>
                  <span>Expected finish ({signedDays(nz(cr.apDays))})</span><span className="mono">{fdate(rec.expEnd)}</span>
                  <span>Finish in the plan now</span><span className="mono">{fdate(rec.live.end)}</span>
                </div>
                <p className="msg" style={{ margin: '8px 0 0', color: rec.mismatch ? 'var(--bad)' : 'var(--good)' }}>
                  {rec.mismatch
                    ? 'The plan does not match the approval (budget off by ' + money(Math.abs(rec.diffCost)) + ', finish off by ' + Math.abs(rec.diffDays) + ' days). Update the plan, or explain the difference below.'
                    : 'The plan matches the approved impact.' + (rec.b.calc === 'days' ? '' : ' This baseline was taken before the budget was counted day by day, so a finish within a week of the expected date counts as matching.')}
                </p>
                {rec.mismatch && (
                  <label className="fld" style={{ marginTop: 8 }}>Why the plan differs from the approval
                    <Area value={cr.reconcile} rows={2} label="Reconciliation note" onCommit={(v) => set({ reconcile: v })} />
                  </label>
                )}
              </div>
            )}
            {st !== 'Approved' && cr.reconcile && <p className="msg">Note on differences: {cr.reconcile}</p>}
            {cr.baselineId && <p className="msg">Created baseline <b>{(S.baselines.find((b) => b.id === cr.baselineId) || {}).version}</b> on {fdate(cr.implementedOn)}.</p>}
          </>
        )}

        {showClose && (
          <>
            <h3 className="d-h">6 · Verification</h3>
            <Area value={cr.verified} rows={2} label="Verification" disabled={lockClose} placeholder="How you confirmed the change works and the new baseline is correct" onCommit={(v) => set({ verified: v })} />
          </>
        )}

        <h3 className="d-h">History</h3>
        <ul className="ck">
          {cr.log.slice().reverse().map((l, i) => (<li key={i}><span className="msg mono" style={{ flex: 'none' }}>{fdate(l.on)}</span><span>{l.text}</span></li>))}
        </ul>
        {cr.by && <p className="msg">Raised by {who(cr.by) || '(removed stakeholder)'}.</p>}

        <div className="d-actions">
          {st === 'Draft' && (
            <button className="btn danger" onClick={() => ui.ask({ title: 'Delete draft?', body: 'This draft change request will be deleted. Submitted requests cannot be deleted.', confirm: 'Delete draft', danger: true, onConfirm: () => { ch.remove(cr.id); onClose(); } })}>Delete draft</button>
          )}
          <span style={{ flex: 1 }} />
          {NEXT[st].includes('Draft') && moveBtn('Draft', 'Return to draft')}
          {st === 'Draft' && moveBtn('Submitted', 'Submit for review', 'btn primary')}
          {st === 'Submitted' && moveBtn('Under review', 'Send to review board', 'btn primary')}
          {st === 'Deferred' && moveBtn('Under review', 'Resume review', 'btn primary')}
          {st === 'Under review' && (
            <>
              {moveBtn('Deferred', 'Defer')}
              {moveBtn('Rejected', 'Reject', 'btn danger', { title: 'Reject this change request?', body: 'A rejected request stays on record and cannot be reopened.', confirm: 'Reject', danger: true })}
              {moveBtn('Approved', 'Approve', 'btn primary')}
            </>
          )}
          {st === 'Approved' && (
            <button
              className="btn primary"
              disabled={!go('Implemented').ok || !base}
              title={go('Implemented').ok ? '' : 'Still needed: ' + go('Implemented').m.map((x) => x.label).join('; ')}
              onClick={() =>
                ui.ask({
                  title: 'Implement and create a new baseline?',
                  body: 'The current plan becomes the next baseline version. This cannot be undone.',
                  confirm: 'Create baseline',
                  onConfirm: () => ch.implement(cr.id),
                })
              }
            >
              Implement and update baseline
            </button>
          )}
          {st === 'Implemented' && moveBtn('Closed', 'Close change request', 'btn primary')}
        </div>
      </aside>
    </>
  );
}
