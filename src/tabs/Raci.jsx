import { useStore } from '../store/StoreContext';
import { useSelect } from '../lib/useSelect';
import RaciBar from '../components/RaciBulk';
import { TriBox } from '../components/ListBits';
import { TypeBadge } from '../components/Bits';
import { Fld } from '../components/Field';
import { raciOkFor, wkE, wkS, nW } from '../lib/calc';
import { findTask, typeOf } from '../lib/tasks';
import { fdate } from '../lib/dates';
import { DEFAULT_RF, RF_SCOPES, workItems } from '../lib/raci';

const ROLES = ['', 'A', 'R', 'C', 'I'];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function Check({ roles }) {
  const v = Object.values(roles || {});
  const A = v.filter((x) => x === 'A').length, R = v.filter((x) => x === 'R').length;
  return raciOkFor(roles) ? <span className="pill good">OK</span> : <span className="pill warn">{A !== 1 ? (A ? 'Multiple A' : 'No A') : R < 1 ? 'No R' : ''}</span>;
}

// RACI is marked for every work item of the sprints. Rows and stakeholders are read-only here:
// work items are managed in the sprints, people in the Stakeholders tab.
export default function Raci() {
  const { S, update, setNav } = useStore();
  const rf = { ...DEFAULT_RF, ...(S.rf || {}) };
  const setRf = (patch) => update((p) => { p.rf = { ...DEFAULT_RF, ...(p.rf || {}), ...patch }; });
  const { R, groups, shown, total } = workItems(S, rf);
  const people = S.people;
  const cols = people.length + 2;

  const cycle = (taskId, pid) =>
    update((p) => {
      const roles = findTask(p, taskId).t.raci;
      const next = ROLES[(ROLES.indexOf(roles[pid] || '') + 1) % ROLES.length];
      if (next) roles[pid] = next;
      else delete roles[pid];
    });

  const flat = groups.flatMap((g) => g.tasks);
  const pick = useSelect(flat.map((t) => t.id), flat.map((t) => t.id), S.id);

  const weeks = [];
  for (let w = 1; w <= nW(S); w++) weeks.push(w);

  return (
    <div className="card">
      <div className="row sp">
        <div>
          <h2>RACI chart</h2>
          <p className="hint">
            Every work item from your sprints appears here automatically. Click a cell to cycle A, R, C, I and empty, or tick several work items to set roles for all of them at once. Each work item needs one A and at least one R.
            Work items are managed in the sprints and people on the <button className="linkbtn" onClick={() => setNav({ tab: 'people' })}>Stakeholders</button> tab.
          </p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 16, alignItems: 'flex-end' }}>
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
        <span className="msg" style={{ marginLeft: 'auto' }}>Showing {shown} of {total} work items{R.scope !== 'project' && R.scope !== 'sprint' ? ' (a work item belongs to a period when its dates overlap it; work items without dates are hidden)' : ''}</span>
      </div>

      <RaciBar ids={pick.chosen} items={flat} people={people} onDone={pick.clear} />

      <div className="scroll raci-scroll">
        <table className="tbl raci">
          <thead>
            <tr>
              <th className="sticky-l"><TriBox all={flat.length > 0 && pick.chosen.length === flat.length} some={pick.chosen.length > 0} onChange={(e) => pick.setMany(flat.map((t) => t.id), e.target.checked)} label="Select all work items" /> Work item</th>
              {people.map((p) => (
                <th key={p.id} style={{ minWidth: 96, textAlign: 'center' }}>
                  <div className="raci-name">{p.name}</div>
                  {p.role ? <div className="raci-role">{p.role}</div> : null}
                </th>
              ))}
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowsFor key={g.id} g={g} people={people} cols={cols} onCycle={cycle} sel={pick.sel} onSelect={pick.toggleOne} onGroup={pick.setMany} />
            ))}
            {!groups.length && (<tr><td colSpan={cols}><span className="cell msg">{total ? 'No work items match this filter.' : 'No work items yet. Add tasks to a sprint and they will show up here.'}</span></td></tr>)}
            {!people.length && groups.length > 0 && (<tr><td colSpan={cols}><span className="cell msg">There are no stakeholders yet. Add them on the Stakeholders tab to start marking roles.</span></td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowsFor({ g, people, cols, onCycle, sel, onSelect, onGroup }) {
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
      {g.tasks.map((t) => (
        <tr key={t.id} className={sel.has(t.id) ? 'sel' : ''}>
          <td className="sticky-l" title={t.name}>
            <input type="checkbox" className="tg-sel" checked={sel.has(t.id)} onChange={() => {}} onClick={(e) => onSelect(t.id, e.shiftKey)} aria-label={'Select ' + t.name} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: (g.depth.get(t.id) || 0) * 14 }}>
              <TypeBadge type={typeOf(S, t.type)} size={14} />
              <span className="mono msg">{t.code}</span> <span className="cell" style={{ display: 'inline', fontWeight: g.depth.has(t.id) && g.tasks.some((x) => x.parent === t.id) ? 600 : 400 }}>{t.name}</span>
            </span>
          </td>
          {people.map((p) => {
            const v = (t.raci || {})[p.id] || '';
            return (
              <td key={p.id} style={{ textAlign: 'center' }}>
                <button type="button" className={'rc ' + (v ? 'r-' + v : '')} onClick={() => onCycle(t.id, p.id)} aria-label={p.name + ' role ' + (v || 'none') + ' on ' + t.name}>{v || '·'}</button>
              </td>
            );
          })}
          <td><Check roles={t.raci} /></td>
        </tr>
      ))}
    </>
  );
}
