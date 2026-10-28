import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell, Fld, SelectCell } from '../components/Field';
import RichText from '../components/RichText';
import Kpi from '../components/Kpi';
import { emv, expo, newRaidId, overdue, rating, score } from '../lib/calc';
import { fdate, today } from '../lib/dates';
import { uid } from '../lib/tasks';
import { hrsf, money, nz } from '../lib/format';
import '../raid.css';

const TYPES = ['Risk', 'Assumption', 'Issue', 'Dependency'];
const STAT = ['Open', 'Mitigating', 'Closed'];
const statCls = { Open: 'warn', Mitigating: 'neutral', Closed: 'good' };
const P_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const I_LABELS = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];
const ratingCls = (rt) => (rt === 'High' ? 'bad' : rt === 'Medium' ? 'warn' : 'good');

function Matrix({ S, onOpen }) {
  const rows = [];
  for (let im = 5; im >= 1; im--) {
    rows.push(<div key={'a' + im} className="ax">{im}</div>);
    for (let p = 1; p <= 5; p++) {
      const s = p * im;
      const cl = s >= 15 ? 'hi' : s >= 8 ? 'me' : 'lo';
      const ids = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed' && r.p === p && r.i === im);
      rows.push(
        <div key={p + '-' + im} className={'hc ' + cl} title={'Probability ' + p + ', impact ' + im}>
          {ids.map((r) => (<button key={r.key} type="button" className="hc-id" onClick={() => onOpen(r.key)} title={'Open ' + r.id}>{r.id}</button>))}
        </div>
      );
    }
  }
  return (
    <>
      <div className="heat">
        {rows}
        <div />
        {[1, 2, 3, 4, 5].map((q) => (<div key={q} className="ax">{q}</div>))}
      </div>
      <div className="msg" style={{ marginTop: 8 }}>Rows are impact (5 at top), columns are probability. Click an ID to open the item.</div>
    </>
  );
}

// 1-5 picker: easier to read than a number box, and the meaning of the chosen level is spelled out underneath
function Scale({ value, onPick, labels, name }) {
  return (
    <div>
      <div className="chips" role="group" aria-label={name}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="chip rd-n" aria-pressed={value === n} onClick={() => onPick(n)}>{n}</button>
        ))}
      </div>
      <div className="msg" style={{ marginTop: 4 }}>{value >= 1 && value <= 5 ? value + ' · ' + labels[value - 1] : 'Not set yet'}</div>
    </div>
  );
}

// One RAID item, laid out in groups: what it is, what it says, how big it is, what we do about it.
function RaidDrawer({ k, fresh, onClose }) {
  const { S, update, setField } = useStore();
  const [arm, setArm] = useState(false);
  const i = S.raid.findIndex((r) => r.key === k);
  const r = S.raid[i];
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    if (!r) onClose();
  }, [r, onClose]);
  if (!r) return null;

  const isR = r.type === 'Risk';
  const sc = score(r), rt = rating(sc);
  const set = (f, v) => setField('raid', i, f, v);
  const edit = (fn) => update((s) => { const o = s.raid.find((x) => x.key === k); if (o) fn(o); });
  const setType = (t) =>
    edit((o) => {
      o.type = t;
      if (t === 'Risk') {
        if (o.p == null) o.p = 3;
        if (o.i == null) o.i = 3;
        if (o.probPct == null) o.probPct = 0.5;
      }
    });
  // the rich text keeps its html next to a plain copy; the plain copy is what lists and change requests show
  const setRich = (f) => ({ html, text }) => edit((o) => { o[f + 'Html'] = html; o[f] = text; });
  const ownerOpts = (() => {
    const o = [['', '— none —']].concat(S.people.filter((p) => p.name).map((p) => [p.id, p.name]));
    if (r.owner && !S.people.some((p) => p.id === r.owner)) o.push([r.owner, r.owner + ' (not on the stakeholder list)']);
    return o;
  })();
  const dupId = r.id && S.raid.some((x, j) => j !== i && x.id === r.id);
  const late = overdue(r);

  return (
    <>
      <div className="drawer-bg" onMouseDown={onClose} />
      <aside className="drawer wide" role="dialog" aria-label="RAID item">
        <div className="row sp">
          <div className="row" style={{ gap: 8 }}>
            <span className="pill neutral">{r.type}</span>
            <span className="mono rd-id">{r.id || '(no ID)'}</span>
            {isR && rt && <span className={'pill ' + ratingCls(rt)}>{rt} risk</span>}
            {late && <span className="pill bad">Overdue</span>}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rd-sec">
          <h3 className="d-h">Basics</h3>
          <div className="d-grid">
            <Fld label="Type"><SelectCell value={r.type} options={TYPES} onCommit={setType} /></Fld>
            <Fld label="Status"><SelectCell value={r.status} options={STAT} onCommit={(v) => set('status', v)} /></Fld>
            <Fld label="Owner"><SelectCell value={r.owner} options={ownerOpts} onCommit={(v) => set('owner', v)} /></Fld>
            <Fld label="ID"><Cell value={r.id} cls={dupId ? 'bad' : ''} label="ID" onCommit={(v) => set('id', v)} /></Fld>
            <Fld label="Due date"><Cell value={r.due} type="date" label="Due date" cls={late ? 'od' : ''} onCommit={(v) => set('due', v)} /></Fld>
            <Fld label="Last reviewed">
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <Cell value={r.rev} type="date" label="Last reviewed" onCommit={(v) => set('rev', v)} />
                <button type="button" className="btn" onClick={() => set('rev', today())} title="Set to today">Today</button>
              </span>
            </Fld>
          </div>
          {dupId && <p className="msg" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>Another item already uses the ID {r.id}.</p>}
        </div>

        <div className="rd-sec">
          <h3 className="d-h">Description</h3>
          <RichText html={r.descHtml} text={r.desc} label="Description" placeholder="What is this? Add context, links and details." rows={5} autoFocus={fresh} onCommit={setRich('desc')} />
        </div>

        {isR && (
          <div className="rd-sec">
            <h3 className="d-h">How serious is it?</h3>
            <div className="d-grid">
              <div className="fld">Likelihood<Scale value={r.p} onPick={(n) => set('p', n)} labels={P_LABELS} name="Likelihood 1 to 5" /></div>
              <div className="fld">Impact<Scale value={r.i} onPick={(n) => set('i', n)} labels={I_LABELS} name="Impact 1 to 5" /></div>
            </div>
            <div className="rd-calc">
              <div className="kpi"><div className="l">Score</div><div className="v">{sc != null ? sc : '–'}</div><div className="s">{sc != null ? r.p + ' × ' + r.i + ' · ' : ''}{rt ? <span className={'pill ' + ratingCls(rt)}>{rt}</span> : 'Set likelihood and impact'}</div></div>
              <div className="kpi"><div className="l">Cost exposure (EMV)</div><div className="v">{emv(r) == null ? '–' : money(emv(r))}</div><div className="s">Probability × cost impact</div></div>
              <div className="kpi"><div className="l">Schedule exposure</div><div className="v">{expo(r) == null ? '–' : hrsf(expo(r)) + ' d'}</div><div className="s">Probability × days</div></div>
            </div>
          </div>
        )}

        <div className="rd-sec">
          <h3 className="d-h">{isR ? 'If it happens' : 'Impact'}</h3>
          <div className="d-grid">
            {isR && <Fld label="Chance it happens (%)"><Cell value={r.probPct} type="pct" cls="n" label="Probability in percent" onCommit={(v) => set('probPct', v)} /></Fld>}
            <Fld label="Cost impact"><Cell value={r.cost} type="num" cls="n" label="Cost impact" onCommit={(v) => set('cost', v)} /></Fld>
            <Fld label="Schedule impact (days)"><Cell value={r.days} type="num" cls="n" label="Schedule impact in days" onCommit={(v) => set('days', v)} /></Fld>
          </div>
          {isR && <p className="msg" style={{ margin: '6px 0 0' }}>The chance (%) drives the exposure figures above. Likelihood and impact (1 to 5) place the risk on the matrix.</p>}
        </div>

        <div className="rd-sec">
          <h3 className="d-h">{isR ? 'Response or mitigation' : 'Response / next steps'}</h3>
          <RichText html={r.respHtml} text={r.resp} label="Response" placeholder="What will we do about it, and who does what?" rows={4} onCommit={setRich('resp')} />
        </div>

        <div className="d-actions">
          <button className="btn danger" onClick={() => (arm ? update((s) => { s.raid = s.raid.filter((x) => x.key !== k); }) : setArm(true))} onBlur={() => setArm(false)}>
            {arm ? 'Click again to delete' : 'Delete item'}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </aside>
    </>
  );
}

export default function Raid() {
  const { S, update } = useStore();
  const [fType, setFType] = useState('All');
  const [fStat, setFStat] = useState('All');
  const [newType, setNewType] = useState('Risk');
  const [open, setOpen] = useState(null); // key of the item shown in the drawer
  const [fresh, setFresh] = useState(false);

  const count = (type, status) => S.raid.filter((r) => (type === 'All' || r.type === type) && (status === 'All' || r.status === status)).length;
  const rows = S.raid.filter((r) => (fType === 'All' || r.type === fType) && (fStat === 'All' || r.status === fStat));
  const nameOf = (id) => {
    const p = S.people.find((x) => x.id === id);
    return p ? p.name : id || '';
  };
  const risks = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed');
  const tE = risks.reduce((s, r) => s + nz(emv(r)), 0);
  const tX = risks.reduce((s, r) => s + nz(expo(r)), 0);
  const od = S.raid.filter(overdue).length;

  // a new item opens straight away, with the cursor in its description
  const addRaid = () => {
    const key = uid();
    update((s) => {
      const isR = newType === 'Risk';
      s.raid.push({ key, id: newRaidId(s, newType), type: newType, desc: '', owner: '', p: isR ? 3 : null, i: isR ? 3 : null, probPct: isR ? 0.5 : null, cost: null, days: null, status: 'Open', resp: '', due: '', rev: today() });
    });
    setFresh(true);
    setOpen(key);
  };
  const show = (key) => { setFresh(false); setOpen(key); };

  return (
    <>
      <section className="kpis">
        <Kpi l="Open risks" v={risks.length} s={'of ' + S.raid.filter((r) => r.type === 'Risk').length + ' total'} />
        <Kpi l="Open risk EMV" v={money(tE)} s="Probability × cost impact" />
        <Kpi l="Schedule exposure" v={hrsf(tX) + ' days'} s="Probability × days" />
        <Kpi l="Past due" v={od} s={od ? <span className="pill bad">Needs action</span> : <span className="pill good">None</span>} />
      </section>

      <div className="grid2">
        <div className="card">
          <div className="rd-head">
            <div>
              <h2>RAID log</h2>
              <p className="hint" style={{ margin: 0 }}>Risks, assumptions, issues and dependencies. Click an item to open and edit it. Score is likelihood × impact: High is 15 or more, Medium 8 to 14, Low below 8.</p>
            </div>
            <div className="rd-add">
              <select className="c" value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="New item type">
                {TYPES.map((t) => (<option key={t}>{t}</option>))}
              </select>
              <button className="btn primary" onClick={addRaid}>+ Add {newType.toLowerCase()}</button>
            </div>
          </div>
          <div className="filters">
            <div className="fgroup">
              <span className="flabel">Type</span>
              <div className="chips" role="group" aria-label="Filter by type">
                {['All', ...TYPES].map((t) => (
                  <button key={t} className="chip" aria-pressed={fType === t} onClick={() => setFType(t)}>{t === 'All' ? 'All types' : t}<span className="cnt">{count(t, fStat)}</span></button>
                ))}
              </div>
            </div>
            <div className="fgroup">
              <span className="flabel">Status</span>
              <div className="chips" role="group" aria-label="Filter by status">
                {['All', ...STAT].map((t) => (
                  <button key={t} className="chip" aria-pressed={fStat === t} onClick={() => setFStat(t)}>{t === 'All' ? 'All statuses' : t}<span className="cnt">{count(fType, t)}</span></button>
                ))}
              </div>
            </div>
            {(fType !== 'All' || fStat !== 'All') && (
              <button className="linkbtn" onClick={() => { setFType('All'); setFStat('All'); }}>Clear filters</button>
            )}
          </div>
          <div className="scroll">
            <table className="tbl rwd rd-tbl">
              <thead>
                <tr><th>ID</th><th>Type</th><th>Description</th><th>Owner</th><th>Rating</th><th>Status</th><th>Due</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sc = score(r), rt = rating(sc);
                  return (
                    <tr key={r.key} className="rd-row" onClick={() => show(r.key)}>
                      <td data-l="ID"><button type="button" className="linkbtn mono" onClick={(e) => { e.stopPropagation(); show(r.key); }}>{r.id || '(no ID)'}</button></td>
                      <td data-l="Type"><span className="cell">{r.type}</span></td>
                      <td data-l="Description"><div className="rd-prev">{r.desc ? r.desc : <span className="msg">No description yet</span>}</div></td>
                      <td data-l="Owner"><span className="cell">{nameOf(r.owner) || <span className="msg">–</span>}</span></td>
                      <td data-l="Rating"><span className="cell">{r.type === 'Risk' && rt ? <span className={'pill ' + ratingCls(rt)} title={'Likelihood ' + r.p + ' × impact ' + r.i}>{rt} · {sc}</span> : <span className="msg">–</span>}</span></td>
                      <td data-l="Status"><span className="cell"><span className={'pill ' + (statCls[r.status] || 'neutral')}>{r.status}</span></span></td>
                      <td data-l="Due"><span className={'cell' + (overdue(r) ? ' lateTxt' : '')}>{r.due ? fdate(r.due) : <span className="msg">–</span>}{overdue(r) ? ' · overdue' : ''}</span></td>
                    </tr>
                  );
                })}
                {!rows.length && (<tr className="empty-row"><td colSpan="7"><span className="cell msg">{S.raid.length ? 'No items match these filters.' : 'Nothing logged yet. Use “Add” to log the first risk, assumption, issue or dependency.'}</span></td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Risk matrix</h2>
          <p className="hint">Open risks by likelihood and impact.</p>
          <Matrix S={S} onOpen={show} />
        </div>
      </div>

      {open && <RaidDrawer k={open} fresh={fresh} onClose={() => setOpen(null)} />}
    </>
  );
}
