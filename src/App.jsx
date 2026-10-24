import { useState } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import { useStore } from './store/StoreContext';
import Dashboard from './tabs/Dashboard';
import Weekly from './tabs/Weekly';
import Timeline from './tabs/Timeline';
import Wbs from './tabs/Wbs';
import Budget from './tabs/Budget';
import Raci from './tabs/Raci';
import Stakeholders from './tabs/Stakeholders';
import Raid from './tabs/Raid';
import Change from './tabs/Change';
import SprintView from './tabs/SprintView';
import BacklogView from './tabs/BacklogView';

const VIEWS = { dash: Dashboard, weekly: Weekly, wbs: Wbs, time: Timeline, budget: Budget, people: Stakeholders, raci: Raci, raid: Raid, change: Change };

export default function App() {
  const { S, nav } = useStore();
  const [sb, setSb] = useState(false);
  const View = VIEWS[nav.tab] || Dashboard;

  return (
    <div className={'app' + (sb ? ' sb-open' : '')}>
      <Sidebar onNavigate={() => { setSb(false); window.scrollTo(0, 0); }} />
      <div className="sb-bg" onClick={() => setSb(false)} />
      <div className="content">
        <div className="mbar">
          <button className="btn icon" onClick={() => setSb(true)} aria-label="Open menu">☰</button>
          <b>{S.meta.name}</b>
        </div>
        {nav.view === 'sprint' ? (
          <div className="wrap" key={S.id + ':' + nav.sprintId}>
            {nav.sprintId === 'backlog' ? <BacklogView /> : <SprintView />}
          </div>
        ) : (
          <div className="wrap" key={S.id}>
            <Header />
            <main>
              <View />
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
