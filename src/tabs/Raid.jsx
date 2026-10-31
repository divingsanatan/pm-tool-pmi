import { useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { Cell, Fld, SelectCell } from '../components/Field';
import RichText from '../components/RichText';
import Kpi from '../components/Kpi';
import { emv, expo, newRaidId, overdue, rating, score } from '../lib/calc';
import { FLAGS, PLURAL, flagsOf, raidInsights } from '../lib/raidInsights';
import { fdate, today } from '../lib/dates';
import { uid } from '../lib/tasks';
import { raidJump } from '../lib/deps';
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
  const auto = r.auto === 'dependency'; // created and kept up to date from a dependency between work items
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
            {auto ? <Fld label="Type"><span className="c ro-field">Dependency</span></Fld> : <Fld label="Type"><SelectCell value={r.type} options={TYPES} onCommit={setType} /></Fld>}
            {auto ? <Fld label="Status"><span className="c ro-field">{r.status}{r.depRemoved ? ' (dependency removed)' : ''}</span></Fld> : <Fld label="Status"><SelectCell value={r.status} options={STAT} onCommit={(v) => set('status', v)} /></Fld>}
            <Fld label="Owner"><SelectCell value={r.owner} options={ownerOpts} onCommit={(v) => set('owner', v)} /></Fld>
            <Fld label="ID"><Cell value={r.id} cls={dupId ? 'bad' : ''} label="ID" onCommit={(v) => set('id', v)} /></Fld>
            {auto ? <Fld label="Due date"><span className="c ro-field">{r.due ? fdate(r.due) : '–'}</span></Fld> : <Fld label="Due date"><Cell value={r.due} type="date" label="Due date" cls={late ? 'od' : ''} onCommit={(v) => set('due', v)} /></Fld>}
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
          {auto ? (
            <>
              <p style={{ margin: 0 }}>{r.desc}</p>
              <p className="msg" style={{ margin: '6px 0 0' }}>{r.depRemoved ? 'The dependency was removed, so this entry was closed and is kept as a record.' : 'Created automatically from a dependency between work items. The description, due date (the predecessor\u2019s date) and status follow the dependency: it closes here when the dependency is satisfied. Edit the dependency on the work item (Dependencies view or work item details). The owner, impact and response below are yours to edit.'}</p>
            </>
          ) : (
            <RichText html={r.descHtml} text={r.desc} label="Description" placeholder="What is this? Add context, links and details." rows={5} autoFocus={fresh} onCommit={setRich('desc')} />
          )}
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
          {auto && !r.depRemoved ? (
            <span className="msg">To remove this entry, remove the dependency on the work item.</span>
          ) : (
            <button className="btn danger" onClick={() => (arm ? update((s) => { s.raid = s.raid.filter((x) => x.key !== k); }) : setArm(true))} onBlur={() => setArm(false)}>
              {arm ? 'Click again to delete' : 'Delete item'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </aside>
    </>
  );
}

const SORTS = [['log', 'Log order'], ['rating', 'Rating, highest first'], ['due', 'Due date, soonest first'], ['status', 'Status']];
const STAT_ORDER = { Open: 0, Mitigating: 1, Closed: 2 };
const Flag = ({ k }) => <span className={'pill ' + FLAGS[k].cls}>{FLAGS[k].label}</span>;

export default function Raid() {
  const { S, update } = useStore();
  const [fType, setFType] = useState('All');
  const [fStat, setFStat] = useState('All');
  const [fOwner, setFOwner] = useState('all');
  const [fAtt, setFAtt] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('log');
  const [newType, setNewType] = useState('Risk');
  const [open, setOpen] = useState(null); // key of the item shown in the drawer
  const [fresh, setFresh] = useState(false);

  const I = raidInsights(S);
  const attKeys = new Set(I.attention.map((x) => x.r.key));
  const nameOf = (id) => {
    const p = S.people.find((x) => x.id === id);
    return p ? p.name : id || '';
  };
  const ql = q.trim().toLowerCase();
  const rows = S.raid
    .filter((r) => (fType === 'All' || r.type === fType) && (fStat === 'All' || r.status === fStat))
    .filter((r) => fOwner === 'all' || (fOwner === 'none' ? !r.owner : r.owner === fOwner))
    .filter((r) => !fAtt || attKeys.has(r.key))
    .filter((r) => !ql || [r.id, r.desc, r.resp, r.type, nameOf(r.owner)].some((x) => (x || '').toLowerCase().includes(ql)));
  const sorted = rows.slice().sort((a, b) => {
    if (sort === 'rating') return (score(b) || 0) - (score(a) || 0);
    if (sort === 'due') return (a.due || '9999').localeCompare(b.due || '9999');
    if (sort === 'status') return (STAT_ORDER[a.status] ?? 9) - (STAT_ORDER[b.status] ?? 9);
    return 0;
  });
  const statCount = (st) => S.raid.filter((r) => (fType === 'All' || r.type === fType) && (st === 'All' || r.status === st)).length;
  const filtered = fType !== 'All' || fStat !== 'All' || fOwner !== 'all' || fAtt || ql;
  const clear = () => { setFType('All'); setFStat('All'); setFOwner('all'); setFAtt(false); setQ(''); };
  const people = S.people.filter((p) => p.name);
  const mix = I.types.filter((t) => t.open).map((t) => t.open + ' ' + (t.open === 1 ? t.type : PLURAL[t.type]).toLowerCase()).join(' · ');

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
  // arriving from a dependency's RAID ID opens that entry
  useEffect(() => { if (raidJump.key) { const k = raidJump.key; raidJump.key = null; setFresh(false); setOpen(k); } }, []);

  return (
    <>
      <section className="kpis">
        <Kpi l="Open items" v={I.open} s={mix || (I.total ? 'Everything is closed' : 'Nothing logged yet')} />
        <Kpi l="Need attention" v={I.attention.length} s={I.attention.length ? <button className="linkbtn" onClick={() => { setFAtt(true); setFType('All'); }}>Show them in the log</button> : <span className="pill good">All clear</span>} />
        <Kpi l="Past due" v={I.overdue} s={I.overdue ? <span className="pill bad">Needs action</span> : I.dueSoon ? I.dueSoon + ' more due in 7 days' : <span className="pill good">None</span>} />
        <Kpi l="High-rated risks" v={I.highRisks} s={'of ' + I.openRisks + ' open risk' + (I.openRisks === 1 ? '' : 's')} />
        <Kpi l="Risk exposure" v={money(I.emv)} s={hrsf(I.exposure) + ' days of schedule exposure'} />
      </section>

      <section className="rd-types" aria-label="Filter the log by type">
        {[{ type: 'All', open: I.open, closed: I.closed, overdue: I.overdue }].concat(I.types).map((t) => (
          <button key={t.type} type="button" className="rd-type" aria-pressed={fType === t.type} onClick={() => setFType(fType === t.type ? 'All' : t.type)}>
            <span className="rd-type-n">{t.open}</span>
            <span className="rd-type-l">{t.type === 'All' ? 'All open items' : 'Open ' + PLURAL[t.type].toLowerCase()}</span>
            <span className="rd-type-s">{t.overdue ? <b className="lateTxt">{t.overdue} overdue</b> : 'None overdue'} · {t.closed} closed</span>
          </button>
        ))}
      </section>

      <div className="grid2e">
        <div className="card">
          <h2>Needs attention</h2>
          <p className="hint">Open items that are overdue, due within 7 days, high-rated, without an owner or response, or not reviewed for 30 days.</p>
          {I.attention.length === 0 ? (
            <p className="msg" style={{ margin: 0 }}>Nothing flagged. Every open item has an owner, a response where needed, and a recent review.</p>
          ) : (
            <ul className="rd-att">
              {I.attention.slice(0, 6).map(({ r, flags }) => (
                <li key={r.key}>
                  <button type="button" className="rd-att-b" onClick={() => show(r.key)}>
                    <span className="rd-att-top"><b className="mono">{r.id}</b><span className="msg">{r.type}</span><span className="rd-att-d">{r.desc || 'No description yet'}</span></span>
                    <span className="rd-flags">{flags.slice(0, 3).map((k) => <Flag key={k} k={k} />)}{flags.length > 3 && <span className="msg">+{flags.length - 3}</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {I.attention.length > 6 && <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => { setFAtt(true); setFType('All'); }}>Show all {I.attention.length} in the log</button>}
        </div>
        <div className="card">
          <h2>Risk matrix</h2>
          <p className="hint">Open risks by likelihood and impact.</p>
          <Matrix S={S} onOpen={show} />
        </div>
      </div>

      <div className="card">
        <div className="rd-head">
          <div>
            <h2>RAID log</h2>
            <p className="hint" style={{ margin: 0 }}>Click an item to open and edit it. Risk score is likelihood × impact: High is 15 or more, Medium 8 to 14, Low below 8.</p>
          </div>
          <div className="rd-add">
            <select className="c" value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="New item type">
              {TYPES.map((t) => (<option key={t}>{t}</option>))}
            </select>
            <button className="btn primary" onClick={addRaid}>+ Add {newType.toLowerCase()}</button>
          </div>
        </div>

        <div className="rd-tools">
          <input className="c rd-search" type="search" placeholder="Search ID, description, owner" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the RAID log" />
          <label className="fld rd-sel">Owner
            <select className="c" value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
              <option value="all">Everyone</option><option value="none">No owner</option>
              {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </label>
          <label className="fld rd-sel">Sort by
            <select className="c" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
          </label>
        </div>
        <div className="filters">
          <div className="fgroup">
            <span className="flabel">Status</span>
            <div className="chips" role="group" aria-label="Filter by status">
              {['All', ...STAT].map((t) => (
                <button key={t} className="chip" aria-pressed={fStat === t} onClick={() => setFStat(t)}>{t === 'All' ? 'All statuses' : t}<span className="cnt">{statCount(t)}</span></button>
              ))}
              <button className="chip" aria-pressed={fAtt} onClick={() => setFAtt(!fAtt)}>Needs attention<span className="cnt">{I.attention.length}</span></button>
            </div>
          </div>
          {filtered && <button className="linkbtn" onClick={clear}>Clear filters</button>}
          <span className="msg rd-count">{sorted.length} of {S.raid.length} item{S.raid.length === 1 ? '' : 's'}</span>
        </div>

        <div className="scroll">
          <table className="tbl rwd rd-tbl">
            <thead>
              <tr><th>ID</th><th>Type</th><th>Description</th><th>Owner</th><th>Rating</th><th>Status</th><th>Due</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const sc = score(r), rt = rating(sc), fl = flagsOf(r);
                return (
                  <tr key={r.key} className="rd-row" onClick={() => show(r.key)}>
                    <td data-l="ID" className="rd-c-id"><button type="button" className="linkbtn mono" onClick={(e) => { e.stopPropagation(); show(r.key); }}>{r.id || '(no ID)'}</button>{r.auto === 'dependency' && <span className="msg" title="Created automatically from a dependency between work items"> · auto</span>}</td>
                    <td data-l="Type" className="rd-c-nw"><span className={'cell rd-ty ty-' + r.type}>{r.type}</span></td>
                    <td data-l="Description"><div className="rd-prev">{r.desc ? r.desc : <span className="msg">No description yet</span>}</div></td>
                    <td data-l="Owner" className="rd-c-nw"><span className="cell">{nameOf(r.owner) || <span className="msg">–</span>}</span></td>
                    <td data-l="Rating" className="rd-c-nw"><span className="cell">{r.type === 'Risk' && rt ? <span className={'pill ' + ratingCls(rt)} title={'Likelihood ' + r.p + ' × impact ' + r.i}>{rt} · {sc}</span> : <span className="msg">–</span>}</span></td>
                    <td data-l="Status" className="rd-c-nw"><span className="cell"><span className={'pill ' + (statCls[r.status] || 'neutral')}>{r.status}</span></span></td>
                    <td data-l="Due" className="rd-c-nw"><span className={'cell' + (overdue(r) ? ' lateTxt' : '')}>{r.due ? fdate(r.due) : <span className="msg">–</span>}</span></td>
                    <td data-l="Flags"><span className="cell rd-flags">{fl.length ? fl.slice(0, 2).map((k) => <Flag key={k} k={k} />) : <span className="msg">–</span>}{fl.length > 2 && <span className="msg">+{fl.length - 2}</span>}</span></td>
                  </tr>
                );
              })}
              {!sorted.length && (<tr className="empty-row"><td colSpan="8"><span className="cell msg">{S.raid.length ? 'No items match these filters.' : 'Nothing logged yet. Use “Add” to log the first risk, assumption, issue or dependency.'}</span></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {open && <RaidDrawer k={open} fresh={fresh} onClose={() => setOpen(null)} />}
    </>
  );
}
