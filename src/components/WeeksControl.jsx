import { useStore } from '../store/StoreContext';
import { Cell } from './Field';
import { autoWeeks, nW, wkE } from '../lib/calc';
import { fdate } from '../lib/dates';

// Project length: follow the data (Auto) or type the number of weeks (Manual)
export default function WeeksControl() {
  const { S, update } = useStore();
  const m = S.meta;
  const auto = m.weeksMode === 'auto';
  const need = autoWeeks(S);
  const setMode = (mode) => update((p) => { p.meta.weeksMode = mode; });
  return (
    <div className="weeks-ctl">
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="fld">Number of weeks
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <div className="seg" role="group" aria-label="Week count mode">
              <button aria-pressed={auto} onClick={() => setMode('auto')} title="Weeks follow your tasks, sprints and costs">Auto</button>
              <button aria-pressed={!auto} onClick={() => setMode('manual')} title="Type the number of weeks yourself">Manual</button>
            </div>
            <Cell sec="meta" f="weeks" value={m.weeks} type="int" cls="w-sm n" disabled={auto} label="Number of weeks" />
          </div>
        </label>
        <span className="msg">Ends {fdate(new Date(wkE(S, nW(S))).toISOString().slice(0, 10))}</span>
      </div>
      <p className="msg" style={{ marginTop: 6 }}>
        {auto
          ? `Auto: ${m.weeks} week${m.weeks > 1 ? 's' : ''}, enough to cover your latest dated task, sprint or cost.`
          : need > m.weeks
            ? `Some dated items fall after week ${m.weeks}; they need ${need} weeks.`
            : 'Manual: you set the length. Switch to Auto to follow your data.'}
        {!auto && need > m.weeks && (
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => update((p) => { p.meta.weeks = need; })}>Extend to {need} weeks</button>
        )}
      </p>
    </div>
  );
}
