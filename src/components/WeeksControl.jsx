import { useStore } from '../store/StoreContext';
import { budgetModel } from '../lib/calc';
import { fdate } from '../lib/dates';
import { isoOf } from '../lib/budget';

// Project length is worked out from the data (the latest planned date) unless a fixed end date is chosen on the Budget tab.
// The budget is counted day by day, so a part week is never rounded up to a whole week.
export default function WeeksControl() {
  const { S } = useStore();
  const M = budgetModel(S);
  const t = M.totals;
  const r = (n) => Math.round(n * 100) / 100;
  return (
    <div className="weeks-ctl">
      <div className="fld">Project length
        <div className="row" style={{ gap: 10 }}>
          <b className="mono">{t.calDays} day{t.calDays === 1 ? '' : 's'}</b>
          <span className="msg">Ends {fdate(isoOf(M.end))} · {t.workDays} working day{t.workDays === 1 ? '' : 's'} ({r(t.equivWeeks)} work weeks)</span>
        </div>
      </div>
      <p className="msg" style={{ marginTop: 6 }}>End date: {M.endSource.text}. Change it on the Budget tab.</p>
    </div>
  );
}
