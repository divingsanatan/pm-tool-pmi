import { useEffect } from 'react';
import { useStore } from '../store/StoreContext';
import { curWeek, nW, started, projectBAC, wkE, wkS } from '../lib/calc';
import { fdate, fsh } from '../lib/dates';
import { money } from '../lib/format';

export const TABS = [
  ['dash', 'Dashboard'],
  ['wbs', 'WBS'],
  ['time', 'Timeline'],
  ['budget', 'Budget'],
  ['people', 'Stakeholders'],
  ['raci', 'RACI'],
  ['raid', 'RAID log'],
  ['change', 'Change control'],
  ['activity', 'Activity'],
];

export default function Header() {
  const { S, nav, setNav } = useStore();
  const title = S.meta.name || 'Project';

  useEffect(() => {
    document.title = title + ' · Sprint Control';
  }, [title]);

  const sub =
    (started(S) ? 'Week ' + curWeek(S) + ' of ' + nW(S) + ' · ' : 'Starts ' + fdate(S.meta.start) + ' · ') +
    fsh(wkS(S, 1)) + ' – ' + fsh(wkE(S, nW(S))) + ' · BAC ' + money(projectBAC(S));

  return (
    <header className="top">
      <div className="top-row">
        <div>
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={nav.tab === id} onClick={() => setNav({ tab: id })}>
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}
