import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell, SelectCell } from '../components/Field';
import Kpi from '../components/Kpi';
import { emv, expo, newRaidId, overdue, rating, score } from '../lib/calc';
import { today } from '../lib/dates';
import { uid } from '../lib/tasks';
import { hrsf, money, nz } from '../lib/format';

const TYPES = ['Risk', 'Assumption', 'Issue', 'Dependency'];
const STAT = ['Open', 'Mitigating', 'Closed'];
const ratingCls = (rt) => (rt === 'High' ? 'bad' : rt === 'Medium' ? 'warn' : 'good');

function Matrix({ S }) {
  const rows = [];
  for (let im = 5; im >= 1; im--) {
    rows.push(<div key={'a' + im} className="ax">{im}</div>);
    for (let p = 1; p <= 5; p++) {
      const s = p * im;
      const cl = s >= 15 ? 'hi' : s >= 8 ? 'me' : 'lo';
      const ids = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed' && r.p === p && r.i === im).map((r) => r.id);
      rows.push(
        <div key={p + '-' + im} className={'hc ' + cl} title={'Probability ' + p + ', impact ' + im}>
          {ids.map((x) => (<span key={x}>{x}</span>))}
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
      <div className="msg" style={{ marginTop: 8 }}>Rows are impact (5 at top), columns are probability.</div>
    </>
  );
}

export default function Raid() {
  const { S, update } = useStore();
  const [fType, setFType] = useState('All');
  const [fStat, setFStat] = useState('All');
  const [newType, setNewType] = useState('Risk');

  const count = (type, status) => S.raid.filter((r) => (type === 'All' || r.type === type) && (status === 'All' || r.status === status)).length;
  const rows = S.raid.map((r, i) => ({ r, i })).filter((o) => (fType === 'All' || o.r.type === fType) && (fStat === 'All' || o.r.status === fStat));
  // stakeholders to pick from; an owner typed earlier that is not on the list stays selectable until it is changed
  const ownerOpts = (cur) => {
    const o = [['', '— none —']].concat(S.people.filter((p) => p.name).map((p) => [p.id, p.name]));
    if (cur && !S.people.some((p) => p.id === cur)) o.push([cur, cur + ' (not on the stakeholder list)']);
    return o;
  };
  const risks = S.raid.filter((r) => r.type === 'Risk' && r.status !== 'Closed');
  const tE = risks.reduce((s, r) => s + nz(emv(r)), 0);
  const tX = risks.reduce((s, r) => s + nz(expo(r)), 0);
  const od = S.raid.filter(overdue).length;

  const addRaid = () =>
    update((s) => {
      const isR = newType === 'Risk';
      s.raid.push({ key: uid(), id: newRaidId(s, newType), type: newType, desc: '', owner: '', p: isR ? 3 : null, i: isR ? 3 : null, probPct: isR ? 0.5 : null, cost: null, days: null, status: 'Open', resp: '', due: '', rev: today() });
    });

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
          <div className="row sp">
            <div>
              <h2>RAID log</h2>
              <p className="hint">Score is probability × impact. High is 15 or more, Medium 8 to 14, Low below 8.</p>
            </div>
            <div className="row">
              <select className="c" value={newType} onChange={(e) => setNewType(e.target.value)} style={{ width: 'auto', borderColor: 'var(--line)' }} aria-label="New item type">
                {TYPES.map((t) => (<option key={t}>{t}</option>))}
              </select>
              <button className="btn primary" onClick={addRaid}>Add item</button>
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
            <table className="tbl rwd">
              <thead>
                <tr>
                  <th>ID</th><th>Type</th><th>Description</th><th>Owner</th><th className="r">P</th><th className="r">I</th><th className="r">Score</th><th>Rating</th>
                  <th className="r">Prob %</th><th className="r">Cost impact</th><th className="r">Days</th><th className="r">EMV</th><th className="r">Exposure</th>
                  <th>Status</th><th>Response</th><th>Due</th><th>Reviewed</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, i }) => {
                  const isR = r.type === 'Risk';
                  const sc = score(r);
                  const rt = rating(sc);
                  return (
                    <tr key={i}>
                      <td data-l="ID"><Cell sec="raid" i={i} f="id" value={r.id} cls="w-id mono" /></td>
                      <td data-l="Type"><SelectCell sec="raid" i={i} f="type" value={r.type} options={TYPES} cls="w-md" /></td>
                      <td data-l="Description"><Cell sec="raid" i={i} f="desc" value={r.desc} cls="w-desc" placeholder="Describe" /></td>
                      <td data-l="Owner"><SelectCell sec="raid" i={i} f="owner" value={r.owner} options={ownerOpts(r.owner)} cls="w-md" /></td>
                      <td data-l="P">{isR && <Cell sec="raid" i={i} f="p" value={r.p} type="num" cls="w-sm n" />}</td>
                      <td data-l="I">{isR && <Cell sec="raid" i={i} f="i" value={r.i} type="num" cls="w-sm n" />}</td>
                      <td data-l="Score" className="r mono"><span className="cell">{isR && sc != null ? sc : ''}</span></td>
                      <td data-l="Rating"><span className="cell">{isR && rt ? <span className={'pill ' + ratingCls(rt)}>{rt}</span> : ''}</span></td>
                      <td data-l="Prob %">{isR && <Cell sec="raid" i={i} f="probPct" value={r.probPct} type="pct" cls="w-sm n" />}</td>
                      <td data-l="Cost impact"><Cell sec="raid" i={i} f="cost" value={r.cost} type="num" cls="w-md n" /></td>
                      <td data-l="Days"><Cell sec="raid" i={i} f="days" value={r.days} type="num" cls="w-sm n" /></td>
                      <td data-l="EMV" className="r mono"><span className="cell">{isR ? money(emv(r)) : ''}</span></td>
                      <td data-l="Exposure" className="r mono"><span className="cell">{isR ? hrsf(expo(r)) : ''}</span></td>
                      <td data-l="Status"><SelectCell sec="raid" i={i} f="status" value={r.status} options={STAT} cls="w-md" /></td>
                      <td data-l="Response"><Cell sec="raid" i={i} f="resp" value={r.resp} cls="w-desc" placeholder="Response or mitigation" /></td>
                      <td data-l="Due"><Cell sec="raid" i={i} f="due" value={r.due} type="date" cls={'w-date' + (overdue(r) ? ' od' : '')} /></td>
                      <td data-l="Reviewed"><Cell sec="raid" i={i} f="rev" value={r.rev} type="date" cls="w-date" /></td>
                      <td data-l=""><button className="x" onClick={() => update((s) => s.raid.splice(i, 1))} aria-label="Delete item">✕</button></td>
                    </tr>
                  );
                })}
                {!rows.length && (<tr><td colSpan="18"><span className="cell msg">No items match these filters.</span></td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Risk matrix</h2>
          <p className="hint">Open risks by probability and impact.</p>
          <Matrix S={S} />
        </div>
      </div>
    </>
  );
}
