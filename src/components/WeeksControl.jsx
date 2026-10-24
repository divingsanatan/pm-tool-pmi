import { useStore } from '../store/StoreContext';
import { nW, wkE } from '../lib/calc';
import { fdate } from '../lib/dates';

// Project length is always worked out from the data: the latest dated work item, sprint, completion or cost
export default function WeeksControl() {
  const { S } = useStore();
  const n = nW(S);
  return (
    <div className="weeks-ctl">
      <div className="fld">Number of weeks
        <div className="row" style={{ gap: 10 }}>
          <b className="mono">{n}</b>
          <span className="msg">Ends {fdate(new Date(wkE(S, n)).toISOString().slice(0, 10))}</span>
        </div>
      </div>
      <p className="msg" style={{ marginTop: 6 }}>Follows your work items, sprints and costs automatically.</p>
    </div>
  );
}
