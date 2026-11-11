import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useSelect } from '../lib/useSelect';
import RaciBar, { AssignDialog } from '../components/RaciBulk';
import { TriBox } from '../components/ListBits';
import { Avatar, TypeBadge } from '../components/Bits';
import { Fld } from '../components/Field';
import { wkE, wkS, nW } from '../lib/calc';
import { findTask, statusOf, typeOf, typesOf } from '../lib/tasks';
import { fdate } from '../lib/dates';
import { CHECK_FILTERS, DEFAULT_RF, DEFAULT_RX, RACI_ROLES, RF_SCOPES, ROLE_INFO, matchesRx, raciInsights, raciIssue, rxActive, workItems } from '../lib/raci';
import '../raci.css';

const ROLES = ['', 'A', 'R', 'C', 'I'];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// true on phones and small tablets: the table turns into one card per work item
function useNarrow(px = 720) {
  const q = '(max-width:' + px + 'px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

function Check({ roles, needs = true }) {
  const issue = raciIssue(roles);
  if (!issue) return <span className="pill good">OK</span>;
  if (!needs) return <span className="pill neutral" title="This type of work item does not need a full RACI">Optional</span>;
  return <span className="pill warn">{issue === 'multiA' ? 'Multiple A' : issue === 'noA' ? 'No A' : 'No R'}</span>;
}

function Role({ v, size }) {
  return <span className={'rx-role r-' + v + (size ? ' ' + size : '')} title={ROLE_INFO[v].name}>{v}</span>;
}

/* ------------------------------ insight cards ------------------------------ */
function Insights({ I, onFilter, onPerson }) {
  const top = (key) => I.rows.slice().sort((a, b) => b[key] - a[key]).filter((r) => r[key] > 0).slice(0, 4);
  const topA = top('A'), topR = top('openR');
  const maxA = topA.length ? topA[0].A : 1, maxR = topR.length ? topR[0].openR : 1;
  const concentrated = I.rows.length >= 3 && I.aShare >= 60 && I.totalA >= 4;
  return (
    <div className="rx-cards" aria-label="RACI insights">
      <section className="rx-card-i">
        <div className="l">RACI coverage</div>
        <div className="v">{I.pct}<small>%</small></div>
        <div className="rx-prog" role="img" aria-label={I.pct + ' percent of work items have a complete RACI'}><i style={{ width: I.pct + '%' }} className={I.pct >= 90 ? 'good' : I.pct >= 60 ? 'warn' : 'bad'} /></div>
        <div className="s">{I.ok} of {I.applicable} work items have exactly one A and at least one R</div>
      </section>

      <section className="rx-card-i">
        <div className="l">Needs attention</div>
        <div className={'v ' + (I.attention ? 'bad' : 'good')}>{I.attention}</div>
        {I.attention ? (
          <div className="rx-issues">
            {[['noA', 'No A', I.noA], ['multiA', 'Multiple A', I.multiA], ['noR', 'No R', I.noR]].filter((x) => x[2] > 0).map(([id, l, n]) => (
              <button key={id} type="button" className="rx-ichip" onClick={() => onFilter(id)} title={'Show only work items with: ' + l}>{l} <b>{n}</b></button>
            ))}
          </div>
        ) : <div className="s">Every work item has a clear owner and a doer.</div>}
        {I.empty > 0 && <div className="s">{I.empty} have no roles at all.</div>}
      </section>

      <section className="rx-card-i">
        <div className="l">Who is accountable</div>
        {topA.length ? (
          <>
            <div className={'v sm' + (concentrated ? ' warn' : '')}>{I.topA.p.name}</div>
            <div className="s">{I.aShare}% of all A roles ({I.topA.A} of {I.totalA}){concentrated ? '. Consider spreading ownership.' : ''}</div>
            <div className="rx-mini">
              {topA.map((r) => (
                <button key={r.p.id} type="button" className="rx-mrow" onClick={() => onPerson(r.p.id, 'A')} title={'Show work items where ' + r.p.name + ' is Accountable'}>
                  <span className="n">{r.p.name}</span><span className="b"><i style={{ width: (r.A / maxA) * 100 + '%' }} /></span><span className="c">{r.A}</span>
                </button>
              ))}
            </div>
          </>
        ) : <div className="s" style={{ marginTop: 10 }}>Nobody is Accountable yet.</div>}
      </section>

      <section className="rx-card-i">
        <div className="l">Who is doing the work</div>
        {topR.length ? (
          <>
            <div className="v sm">{I.topR.p.name}</div>
            <div className="s">{I.topR.openR} open work item{I.topR.openR > 1 ? 's' : ''} as Responsible</div>
            <div className="rx-mini">
              {topR.map((r) => (
                <button key={r.p.id} type="button" className="rx-mrow" onClick={() => onPerson(r.p.id, 'R')} title={'Show open work items where ' + r.p.name + ' is Responsible'}>
                  <span className="n">{r.p.name}</span><span className="b"><i className="g" style={{ width: (r.openR / maxR) * 100 + '%' }} /></span><span className="c">{r.openR}</span>
                </button>
              ))}
            </div>
          </>
        ) : <div className="s" style={{ marginTop: 10 }}>Nobody is Responsible for open work yet.</div>}
      </section>

      <section className="rx-card-i">
        <div className="l">Communication</div>
        <div className={'v ' + (I.noneInformed ? 'warn' : 'good')}>{I.noneInformed}</div>
        <div className="s">open work item{I.noneInformed === 1 ? '' : 's'} where nobody is Informed</div>
        {I.crowded > 0 && <div className="s">{I.crowded} with 3 or more people Consulted (may slow decisions)</div>}
        {I.idle.length > 0 && I.rows.length > 1 && <div className="s">No role yet: {I.idle.slice(0, 3).map((r) => r.p.name).join(', ')}{I.idle.length > 3 ? ' +' + (I.idle.length - 3) : ''}</div>}
      </section>
    </div>
  );
}

/* ------------------------------ filters ------------------------------ */
function Filters({ rx, setRx, S, counts, people, open, setOpen, narrow }) {
  const active = rxActive(rx);
  const nActive = ['q', 'person'].filter((k) => rx[k]).length + ['check', 'state', 'type'].filter((k) => rx[k] !== 'all').length;
  const set = (patch) => setRx((cur) => ({ ...cur, ...patch }));
  const types = typesOf(S);
  return (
    <div className="rx-filters">
      <div className="rx-fbar">
        <div className="rx-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={rx.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search work items or IDs" aria-label="Search work items" />
        </div>
        {narrow && <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>Filters{nActive ? ' (' + nActive + ')' : ''}</button>}
        {active && <button type="button" className="btn" onClick={() => setRx({ ...DEFAULT_RX })}>Reset filters</button>}
      </div>

      {(!narrow || open) && (
        <div className="rx-fpanel">
          <div className="rx-fgroup" role="group" aria-label="Check">
            <span className="rx-flabel">Check</span>
            <div className="chips">
              {CHECK_FILTERS.map(([id, l]) => (
                <button key={id} type="button" className="chip" aria-pressed={rx.check === id} onClick={() => set({ check: id })}>{l}<span className="rx-count">{counts[id]}</span></button>
              ))}
            </div>
          </div>
          <div className="rx-frow">
            <Fld label="Status">
              <div className="seg" role="group" aria-label="Status">
                {[['all', 'All'], ['open', 'Open'], ['done', 'Done']].map(([id, l]) => (<button key={id} aria-pressed={rx.state === id} onClick={() => set({ state: id })}>{l}</button>))}
              </div>
            </Fld>
            <Fld label="Type">
              <select className="c" value={rx.type} onChange={(e) => set({ type: e.target.value })} aria-label="Type">
                <option value="all">All types</option>
                {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
              </select>
            </Fld>
            <Fld label="Involving stakeholder">
              <select className="c" value={rx.person} onChange={(e) => set({ person: e.target.value, role: e.target.value ? rx.role : '' })} aria-label="Involving stakeholder">
                <option value="">Anyone</option>
                {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </Fld>
            {rx.person && (
              <Fld label="As">
                <div className="seg" role="group" aria-label="Role of that stakeholder">
                  <button aria-pressed={!rx.role} onClick={() => set({ role: '' })}>Any</button>
                  {RACI_ROLES.map((r) => (<button key={r} aria-pressed={rx.role === r} title={ROLE_INFO[r].name} onClick={() => set({ role: r })}>{r}</button>))}
                </div>
              </Fld>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// RACI is marked for every work item of the sprints. Rows and stakeholders are read-only here:
// work items are managed in the sprints, people in the Stakeholders tab.
export default function Raci() {
  const { S, update, setNav } = useStore();
  const narrow = useNarrow(720);
  const rf = { ...DEFAULT_RF, ...(S.rf || {}) };
  const setRf = (patch) => update((p) => { p.rf = { ...DEFAULT_RF, ...(p.rf || {}), ...patch }; });
  const [rx, setRx] = useState({ ...DEFAULT_RX });
  const [fOpen, setFOpen] = useState(false);
  const [assign, setAssign] = useState(null); // work item id whose stakeholders are being edited
  const [cols, setCols] = useState(() => new Set()); // ticked stakeholder columns

  const { R, groups: scoped, shown: inScope, total } = workItems(S, rf);
  const people = S.people;
  const scopeItems = useMemo(() => scoped.flatMap((g) => g.tasks), [scoped]);
  const I = useMemo(() => raciInsights(S, scopeItems), [S, scopeItems]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = Object.fromEntries(CHECK_FILTERS.map(([id]) => [id, scopeItems.filter((t) => matchesRx(S, t, { ...rx, check: id })).length]));

  const groups = scoped
    .map((g) => ({ ...g, tasks: g.tasks.filter((t) => matchesRx(S, t, rx)) }))
    .filter((g) => g.tasks.length);
  const flat = groups.flatMap((g) => g.tasks);
  const shown = flat.length;
  const pick = useSelect(flat.map((t) => t.id), flat.map((t) => t.id), S.id);
  const pickedPeople = people.filter((p) => cols.has(p.id)).map((p) => p.id);

  const cycle = (taskId, pid) =>
    update((p) => {
      const roles = findTask(p, taskId).t.raci;
      const next = ROLES[(ROLES.indexOf(roles[pid] || '') + 1) % ROLES.length];
      if (next) roles[pid] = next;
      else delete roles[pid];
    });
  const toggleCol = (pid) => setCols((c) => { const n = new Set(c); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  const filterCheck = (id) => { setRx((c) => ({ ...c, check: id })); setFOpen(false); };
  const filterPerson = (pid, role) => setRx((c) => ({ ...c, person: pid, role, state: role === 'R' ? 'open' : c.state }));

  const weeks = [];
  for (let w = 1; w <= nW(S); w++) weeks.push(w);
  const colCount = people.length + 3;
  const assignTask = assign ? (findTask(S, assign) || {}).t : null;

  return (
    <div className="card rx">
      <div className="rx-head">
        <div>
          <h2>RACI chart</h2>
          <p className="hint">
            Every work item from your sprints appears here automatically. Click a role to cycle A, R, C, I and empty, or press <b>Assign</b> to give one work item roles for many stakeholders at once. Tick work items and stakeholder columns to set roles in bulk. Each work item needs one A and at least one R. Work items are managed in the sprints and people on the <button className="linkbtn" onClick={() => setNav({ tab: 'people' })}>Stakeholders</button> tab.
          </p>
        </div>
      </div>

      <Insights I={I} onFilter={filterCheck} onPerson={filterPerson} />

      <div className="rx-scope">
        <Fld label="Show work items for">
          <div className="seg" role="group" aria-label="RACI range">
            {RF_SCOPES.map(([id, l]) => (<button key={id} aria-pressed={R.scope === id} onClick={() => setRf({ scope: id })}>{l}</button>))}
          </div>
        </Fld>
        {R.scope === 'sprint' && (
          <Fld label="Sprint">
            <select className="c" value={R.sprint.id} onChange={(e) => setRf({ sprintId: e.target.value })} aria-label="Sprint">
              {S.sprints.concat([S.backlog]).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Fld>
        )}
        {R.scope === 'week' && (
          <Fld label="Week">
            <select className="c" value={R.week} onChange={(e) => setRf({ week: parseInt(e.target.value, 10) })} aria-label="Week">
              {weeks.map((w) => (<option key={w} value={w}>Week {w} · {fdate(iso(wkS(S, w)))} – {fdate(iso(wkE(S, w)))}</option>))}
            </select>
          </Fld>
        )}
        {R.scope === 'month' && (
          <Fld label="Month">
            <select className="c" value={R.month.key} onChange={(e) => setRf({ month: e.target.value })} aria-label="Month">
              {R.months.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
            </select>
          </Fld>
        )}
        {R.scope === 'custom' && (
          <>
            <Fld label="From"><input className="c" type="date" value={rf.from} onChange={(e) => setRf({ from: e.target.value })} aria-label="From date" /></Fld>
            <Fld label="To"><input className="c" type="date" value={rf.to} onChange={(e) => setRf({ to: e.target.value })} aria-label="To date" /></Fld>
          </>
        )}
        <span className="msg rx-showing">Showing {shown} of {total} work items{R.scope !== 'project' && R.scope !== 'sprint' ? '. A work item belongs to a period when its dates overlap it; work items without dates are hidden.' : ''}</span>
      </div>

      <Filters rx={rx} setRx={setRx} S={S} counts={counts} people={people} open={fOpen} setOpen={setFOpen} narrow={narrow} />

      <RaciBar ids={pick.chosen} items={scopeItems} people={people} pickedPeople={pickedPeople} shownIds={flat.map((t) => t.id)} onDone={pick.clear} onClearPeople={() => setCols(new Set())} />

      {narrow ? (
        <div className="rx-list">
          {groups.map((g) => {
            const all = g.tasks.every((t) => pick.sel.has(t.id)), some = g.tasks.some((t) => pick.sel.has(t.id));
            return (
              <section key={g.id} className="rx-sec">
                <div className="rx-sec-h">
                  <TriBox all={all} some={some} onChange={(e) => pick.setMany(g.tasks.map((t) => t.id), e.target.checked)} label={'Select all in ' + g.name} />
                  <span>{g.name} <span className="msg">· {g.tasks.length}</span></span>
                </div>
                {g.tasks.map((t) => {
                  const ty = typeOf(S, t.type), st = statusOf(S, t.status);
                  const withRole = people.filter((p) => (t.raci || {})[p.id]);
                  return (
                    <article key={t.id} className={'rx-wi' + (pick.sel.has(t.id) ? ' sel' : '')} style={{ marginLeft: Math.min(g.depth.get(t.id) || 0, 3) * 10 }}>
                      <div className="rx-wi-top">
                        <input type="checkbox" className="tg-sel" checked={pick.sel.has(t.id)} onChange={() => {}} onClick={(e) => pick.toggleOne(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
                        <TypeBadge type={ty} size={16} />
                        <span className="mono msg">{t.code}</span>
                        <span style={{ flex: 1 }} />
                        <Check roles={t.raci} needs={ty.raci !== false} />
                      </div>
                      <button type="button" className="rx-wi-name" onClick={() => setAssign(t.id)}>{t.name}</button>
                      <div className="rx-wi-st"><i className="rx-sdot" style={{ background: st.color || 'var(--muted)' }} />{st.label}</div>
                      <div className="rx-chips">
                        {withRole.length ? withRole.map((p) => (
                          <span key={p.id} className={'rx-pchip r-' + t.raci[p.id]}><b>{t.raci[p.id]}</b>{p.name}</span>
                        )) : <span className="msg">No stakeholders assigned yet</span>}
                      </div>
                      <button type="button" className="btn rx-assign" onClick={() => setAssign(t.id)}>{withRole.length ? 'Edit roles' : 'Assign stakeholders'}</button>
                    </article>
                  );
                })}
              </section>
            );
          })}
          {!groups.length && <Empty total={total} rx={rx} reset={() => setRx({ ...DEFAULT_RX })} />}
        </div>
      ) : (
        <div className="scroll raci-scroll">
          <table className="tbl raci">
            <thead>
              <tr>
                <th className="sticky-l"><TriBox all={flat.length > 0 && pick.chosen.length === flat.length} some={pick.chosen.length > 0} onChange={(e) => pick.setMany(flat.map((t) => t.id), e.target.checked)} label="Select all work items" /> Work item</th>
                {people.map((p) => {
                  const row = I.rows.find((r) => r.p.id === p.id) || { A: 0, R: 0, C: 0, I: 0 };
                  return (
                    <th key={p.id} className={'rx-col' + (cols.has(p.id) ? ' on' : '')}>
                      <label className="rx-colhd" title={'Tick to give ' + p.name + ' a role on many work items at once'}>
                        <input type="checkbox" className="tg-sel" checked={cols.has(p.id)} onChange={() => toggleCol(p.id)} aria-label={'Select stakeholder ' + p.name} />
                        <Avatar name={p.name} size={26} />
                        <span className="raci-name">{p.name}</span>
                        {p.role ? <span className="raci-role">{p.role}</span> : null}
                        <span className="rx-tally" aria-label={row.A + ' accountable, ' + row.R + ' responsible'}>A {row.A} · R {row.R}</span>
                      </label>
                    </th>
                  );
                })}
                <th>Check</th>
                <th className="rx-act-h"><span className="sr-only">Assign</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <RowsFor key={g.id} g={g} people={people} cols={colCount} colSet={cols} onCycle={cycle} sel={pick.sel} onSelect={pick.toggleOne} onGroup={pick.setMany} onAssign={setAssign} />
              ))}
              {!groups.length && (<tr><td colSpan={colCount}><Empty total={total} rx={rx} reset={() => setRx({ ...DEFAULT_RX })} /></td></tr>)}
              {!people.length && groups.length > 0 && (<tr><td colSpan={colCount}><span className="cell msg">There are no stakeholders yet. Add them on the Stakeholders tab to start marking roles.</span></td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      <Legend />
      {assignTask && <AssignDialog ids={[assign]} items={scopeItems} people={people} onClose={() => setAssign(null)} />}
    </div>
  );
}

function Legend() {
  return (
    <div className="rx-legend" aria-label="Role legend">
      {RACI_ROLES.map((r) => (<span key={r}><Role v={r} size="sm" /> <b>{ROLE_INFO[r].name}</b> <span className="msg">{ROLE_INFO[r].hint}</span></span>))}
    </div>
  );
}

function Empty({ total, rx, reset }) {
  return (
    <div className="rx-empty">
      <p className="msg">{total ? 'No work items match these filters.' : 'No work items yet. Add tasks to a sprint and they will show up here.'}</p>
      {total > 0 && rxActive(rx) && <button className="btn" onClick={reset}>Reset filters</button>}
    </div>
  );
}

function RowsFor({ g, people, cols, colSet, onCycle, sel, onSelect, onGroup, onAssign }) {
  const { S } = useStore();
  const all = g.tasks.length > 0 && g.tasks.every((t) => sel.has(t.id));
  const some = g.tasks.some((t) => sel.has(t.id));
  return (
    <>
      <tr className="grp">
        <td colSpan={cols}>
          <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <TriBox all={all} some={some} onChange={(e) => onGroup(g.tasks.map((t) => t.id), e.target.checked)} label={'Select all in ' + g.name} />
            <span>{g.name} <span className="msg">· {g.tasks.length} work item{g.tasks.length === 1 ? '' : 's'}</span></span>
          </span>
        </td>
      </tr>
      {g.tasks.map((t) => {
        const ty = typeOf(S, t.type), st = statusOf(S, t.status);
        const isParent = g.tasks.some((x) => x.parent === t.id);
        return (
          <tr key={t.id} className={sel.has(t.id) ? 'sel' : ''}>
            <td className="sticky-l" title={t.name}>
              <div className="rx-first">
                <input type="checkbox" className="tg-sel" checked={sel.has(t.id)} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
                <span className="rx-wi-cell" style={{ paddingLeft: (g.depth.get(t.id) || 0) * 14 }}>
                  <TypeBadge type={ty} size={14} />
                  <span className="mono msg">{t.code}</span>
                  <button type="button" className="rx-name" style={{ fontWeight: isParent ? 600 : 400 }} onClick={() => onAssign(t.id)} title="Assign stakeholders to this work item">{t.name}</button>
                  <i className="rx-sdot" style={{ background: st.color || 'var(--muted)' }} title={st.label} />
                </span>
              </div>
            </td>
            {people.map((p) => {
              const v = (t.raci || {})[p.id] || '';
              return (
                <td key={p.id} className={'rx-cell' + (colSet.has(p.id) ? ' on' : '')}>
                  <button type="button" className={'rc ' + (v ? 'r-' + v : 'rx-empty-cell')} onClick={() => onCycle(t.id, p.id)} title={v ? ROLE_INFO[v].name : 'No role. Click to set'} aria-label={p.name + ' role ' + (v || 'none') + ' on ' + t.name}>{v || '·'}</button>
                </td>
              );
            })}
            <td><Check roles={t.raci} needs={ty.raci !== false} /></td>
            <td className="rx-act"><button type="button" className="btn rx-assign-btn" onClick={() => onAssign(t.id)} aria-label={'Assign stakeholders to ' + t.name}>Assign</button></td>
          </tr>
        );
      })}
    </>
  );
}
