import { useEffect, useState } from 'react';
import MembersPanel from './MembersPanel';
import { ROLE_LABEL, canManageMembers, canSeeBudget, tabAllowed } from '../lib/access';
import { leftWithWork } from '../lib/people';
import { useStore } from '../store/StoreContext';
import { curWeek, lastDay, nW, started, planBAC } from '../lib/calc';
import { fdate, fsh, pd } from '../lib/dates';
import { money } from '../lib/format';

export const TABS = [
  ['dash', 'Dashboard'],
  ['people', 'Stakeholders'],
  ['budget', 'Budget'],
  ['raci', 'RACI'],
  ['raid', 'RAID log'],
  ['change', 'Change control'],
  ['time', 'Timeline'],
  ['activity', 'Activity'],
];

export default function Header() {
  const { S, nav, setNav, role, cloud } = useStore();
  const [members, setMembers] = useState(false);
  const title = S.meta.name || 'Project';

  useEffect(() => {
    document.title = title + ' · Sprint Control';
  }, [title]);

  const sub =
    (started(S) ? 'Week ' + curWeek(S) + ' of ' + nW(S) + ' · ' : 'Starts ' + fdate(S.meta.start) + ' · ') +
    fsh(pd(S.meta.start)) + ' – ' + fsh(lastDay(S)) + (canSeeBudget(role) ? ' · BAC ' + money(planBAC(S)) : '');

  return (
    <header className="top">
      <div className="top-row">
        <div>
          <h1>{title}</h1>
          <div className="sub">{sub}</div>
        </div>
        {cloud && (
          <div className="row">
            <span className={'pill ' + (role === 'viewer' ? 'neutral' : 'good')} title="Your role on this project">{ROLE_LABEL[role]}</span>
            {canManageMembers(role) && <button className="btn" onClick={() => setMembers(true)}>People</button>}
          </div>
        )}
      </div>
      {members && <MembersPanel onClose={() => setMembers(false)} />}
      {canManageMembers(role) && leftWithWork(S).length > 0 && (
        <div className="msg lateTxt" role="status" style={{ margin: '6px 0' }}>
          {leftWithWork(S).map((x) => x.p.name + ' (' + x.n + ' open)').join(', ')} left the project but still own open work. <button className="btn" onClick={() => setNav({ tab: 'people' })}>Reassign on Stakeholders</button>
        </div>
      )}
      {role === 'viewer' && <div className="msg" role="status" style={{ margin: '6px 0' }}>You have view-only access to this project. Changes are not saved.</div>}
      <nav className="tabs" role="tablist">
        {TABS.filter(([id]) => tabAllowed(role, id)).map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={nav.tab === id} onClick={() => setNav({ tab: id })}>
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}
