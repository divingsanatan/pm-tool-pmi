import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { outsideSprint } from '../lib/calc';

// Work items can no longer be dated outside their sprint, but older data may still have some. They stretch the project end
// and the budget, so the app points them out on every tab and lets the user decide what to do with them.
export default function OutsideBanner() {
  const { S, setNav } = useStore();
  const tk = useTasks();
  const out = outsideSprint(S);
  if (!out.length) return null;
  const names = Array.from(new Set(out.map((x) => x.sp.name)));
  return (
    <div className="banner warn" style={{ marginTop: 14 }}>
      <span>
        {out.length} work item{out.length > 1 ? 's are' : ' is'} dated outside {out.length > 1 ? 'their sprints' : 'its sprint'} ({names.join(', ')}). Work items must stay inside their sprint; until fixed they stretch the project end and the budget. What would you like to do?
      </span>
      <span className="row">
        <button className="btn primary" onClick={() => tk.resolveOutside('inside')}>Set dates inside the sprint</button>
        <button className="btn" onClick={() => tk.resolveOutside('sprint')}>Move to a new sprint</button>
        <button className="btn" onClick={() => tk.resolveOutside('backlog')}>Move to Backlog</button>
        <button className="btn" onClick={() => { const sp = out[0].sp; setNav({ view: 'sprint', sprintId: sp.id }); }}>Review</button>
      </span>
    </div>
  );
}
