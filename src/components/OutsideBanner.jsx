import { useStore } from '../store/StoreContext';
import { useTasks } from '../store/useTasks';
import { outsideSprint } from '../lib/calc';

// Older data can still have work items dated outside their sprint. They stretch the project end and the budget,
// so the app points them out on every tab and fixes them in one click.
export default function OutsideBanner() {
  const { S, setNav } = useStore();
  const tk = useTasks();
  const out = outsideSprint(S);
  if (!out.length) return null;
  const names = Array.from(new Set(out.map((x) => x.sp.name)));
  return (
    <div className="banner warn" style={{ marginTop: 14 }}>
      <span>
        {out.length} work item{out.length > 1 ? 's are' : ' is'} dated outside {out.length > 1 ? 'their sprints' : 'its sprint'} ({names.join(', ')}). Dates must stay inside the sprint; until fixed they stretch the project end and the budget.
      </span>
      <span className="row">
        <button className="btn" onClick={() => tk.alignDates()}>Move all dates inside their sprints</button>
        <button className="btn" onClick={() => { const sp = out[0].sp; setNav({ view: 'sprint', sprintId: sp.id }); }}>Review</button>
      </span>
    </div>
  );
}
