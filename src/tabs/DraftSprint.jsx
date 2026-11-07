import { useStore } from '../store/StoreContext';
import { useUI } from '../components/UI';
import { Cell } from '../components/Field';
import { crJump, crAllows, activateDraft, clashAll, draftsOf } from '../lib/drafts';
import { fdate, pd, DAY } from '../lib/dates';
import { hrsf } from '../lib/format';
import { sane } from '../lib/sprintGuard';
import '../drafts.css';

// The page of a draft sprint: a sprint that is only proposed, waiting for its change request (see lib/drafts.js).
export default function DraftSprint() {
  const { S, nav, setNav, update } = useStore();
  const ui = useUI();
  const d = draftsOf(S).find((x) => x.id === nav.draftId);
  if (!d) return null;
  const cr = (S.cr || []).find((c) => c.id === d.crId) || null;
  const ready = crAllows(cr);
  const dead = cr && ['Rejected', 'Deferred'].includes(cr.status);
  const clash = d.start && d.end ? clashAll(S, d.id, d.start, d.end) : [];
  const days = d.start && d.end && d.start <= d.end ? Math.round((pd(d.end) - pd(d.start)) / DAY) + 1 : null;

  const patch = (p) => update((pr) => { const x = (pr.drafts || []).find((y) => y.id === d.id); if (x) Object.assign(x, p); });
  const setDates = (k) => (v) => {
    const n = { start: d.start, end: d.end, [k]: v };
    if (!sane(n.start) || !sane(n.end) || n.start > n.end) { ui.toast({ id: 'dr-dates', tone: 'bad', ttl: 6000, text: 'The end date must be on or after the start date.' }); return; }
    const hit = clashAll(S, d.id, n.start, n.end);
    if (hit.length) { ui.toast({ id: 'dr-dates', tone: 'bad', ttl: 7000, text: 'These dates overlap ' + hit.map((s) => s.name).join(', ') + '. Sprints in one project cannot overlap.' }); return; }
    patch(n);
  };
  const openCr = () => { if (cr) crJump.id = cr.id; setNav({ view: 'project', tab: 'change', draftId: null }); };
  const activate = () => {
    update((pr) => { activateDraft(pr, d.id); });
    setNav({ view: 'sprint', sprintId: d.id, draftId: null });
  };
  const del = () =>
    ui.ask({
      title: 'Delete this draft sprint?',
      body: '“' + d.name + '” is only a draft, so no work items are lost. The change request ' + (cr ? cr.code : '') + ' stays as it is.',
      confirm: 'Delete draft',
      danger: true,
      onConfirm: () => { update((pr) => { pr.drafts = (pr.drafts || []).filter((x) => x.id !== d.id); }); setNav({ view: 'project', draftId: null }); },
    });

  return (
    <div className="sprint dr-page">
      <div className="crumb"><span>{S.meta.name}</span><span aria-hidden="true">/</span><span>Draft sprint</span></div>
      <div className="s-head">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <h2 className="h-title">{d.name}</h2>
          <span className="dr-chip">Draft</span>
        </div>
        <div className="row s-meta">
          {d.start && d.end && <span className="chip-d">{fdate(d.start)} – {fdate(d.end)}</span>}
          {d.plannedHours != null && <span className="chip-d mono">{hrsf(d.plannedHours)} h planned</span>}
        </div>
      </div>

      <div className="dr-card">
        {!cr && (<><h3>Its change request is missing</h3><p>This draft is no longer linked to a change request, so it can never be approved. Delete it, and add the sprint again through a new request if you still need it.</p></>)}
        {cr && !ready && !dead && (
          <>
            <h3>Waiting for approval of {cr.code}{cr.title ? ' · ' + cr.title : ''}</h3>
            <p>The change request is <b>{cr.status}</b>. This sprint is a proposal until the request is approved, so it is not part of the plan, the budget or the timeline, and work items cannot be moved into it yet.</p>
            <ol className="dr-steps">
              <li>Complete the change request: what changes, why, and its impact on scope, schedule, cost and risk.</li>
              <li>Submit it and take it through review.</li>
              <li>When it is marked <b>Approved</b>, this draft becomes a regular sprint automatically. If it is not approved, delete the draft here at any time.</li>
            </ol>
          </>
        )}
        {cr && dead && (<><h3>{cr.code} was {cr.status.toLowerCase()}</h3><p>The sprint cannot be added while its request is {cr.status.toLowerCase()}. Delete this draft, or reopen the request if the decision is reversed.</p></>)}
        {cr && ready && (
          <>
            <h3>{cr.code} is {cr.status.toLowerCase()}</h3>
            <p>{clash.length ? 'The dates now overlap ' + clash.map((s) => s.name).join(', ') + '. Change the dates below, then activate the sprint.' : 'This sprint can now become a regular sprint.'}</p>
          </>
        )}
        <div className="dr-actions">
          {cr && <button className="btn primary" onClick={openCr}>Open change request {cr.code}</button>}
          {ready && <button className="btn primary" disabled={clash.length > 0} onClick={activate}>Activate sprint</button>}
          <button className="btn" onClick={del} style={{ color: 'var(--bad)' }}>Delete draft</button>
        </div>
      </div>

      <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Proposed sprint</h3>
      <div className="dr-grid">
        <label className="fld">Name<Cell value={d.name} label="Draft sprint name" onCommit={(v) => v.trim() && patch({ name: v.trim() })} /></label>
        <label className="fld">Start date<Cell value={d.start} type="date" label="Start date" onCommit={setDates('start')} /></label>
        <label className="fld">End date<Cell value={d.end} type="date" label="End date" onCommit={setDates('end')} /></label>
        <label className="fld">Planned hours<Cell value={d.plannedHours} type="num" min={0} label="Planned hours" onCommit={(v) => v != null && v !== '' && patch({ plannedHours: v })} /></label>
      </div>
      {days != null && <p className="hint" style={{ marginTop: 8 }}>{days} calendar day{days === 1 ? '' : 's'}. Dates and hours can be edited until the sprint is activated.</p>}
    </div>
  );
}
