import { useStore } from '../store/StoreContext';
import { labourControl } from '../lib/change';
import { money } from '../lib/format';
import { projectGlance } from '../lib/projectCapacity';
import { hrsf } from '../lib/format';
import '../capacity.css';

const Stat = ({ l, v, s, cls = '' }) => (
  <div className={'cp-stat ' + cls}>
    <div className="l">{l}</div>
    <div className="v">{v}</div>
    <div className="s">{s}</div>
  </div>
);

// Project time and capacity at a glance. Every figure is worked out from the sprints' dates, the Working calendar, the hours-per-day
// default and the people's allocation, focus factor and leave below, so nothing is typed here.
export default function CapacityCards() {
  const { S, setNav } = useStore();
  const ctl = labourControl(S);
  const G = projectGlance(S);
  const h = (n) => hrsf(n) + ' h';
  const offParts = [G.weekly ? G.weekly + ' weekly (' + G.weeklyNames.join(', ') + ')' : '', G.holiday ? G.holiday + ' holiday' + (G.holiday === 1 ? '' : 's') : ''].filter(Boolean);
  return (
    <div className="card">
      <h2>Project capacity at a glance</h2>
      <p className="hint">
        Worked out from the sprint dates, the Working calendar and the capacity settings below. Only days inside a sprint count; gaps between sprints are left out.
        <b> Available days = sprint days − off days. Available hours = available days × hours per day</b> (for one person at 100% allocation and 100% focus); the team rows below apply allocation, focus factor and leave.
      </p>
      {ctl.active && Math.abs(ctl.net) > 0.5 && (
        <div className={'banner ' + (ctl.needsCr ? 'bad' : 'warn')} style={{ marginBottom: 10 }}>
          <span>
            Calendar, leave and capacity settings now give a labour budget of <b>{money(ctl.nowTotal)}</b> against <b>{money(ctl.baseTotal)}</b> in baseline {ctl.b.version} ({ctl.net > 0 ? '+' : '−'}{money(Math.abs(ctl.net))}).{' '}
            {ctl.needsCr ? <><b>{money(ctl.short)}</b> of the increase still needs a change request.</> : ctl.net > 0 ? 'The increase is covered by a change request.' : 'The saving stays inside the baseline; the planned budget and earned value do not move.'}
          </span>
          <button className="btn" onClick={() => setNav({ tab: 'budget' })}>{ctl.needsCr ? 'Open Budget to raise the change request' : 'Open the labour budget'}</button>
        </div>
      )}
      {!G.hasDates && <p className="msg lateTxt" style={{ marginBottom: 8 }}>No sprint has start and end dates yet, so one default week is shown. Date a sprint to see the real project length.</p>}
      <div className="cp-stats">
        <Stat l="Hours per day" v={h(G.hpd)} s={G.customHpd ? 'Project default · ' + G.customHpd + ' ' + (G.customHpd === 1 ? 'person has' : 'people have') + ' their own' : 'Project default for everybody'} />
        <Stat l="Days in sprints" v={G.cal + ' days'} s={G.startLbl + ' – ' + G.endLbl + (G.gap ? ' · ' + G.gap + ' gap day' + (G.gap === 1 ? '' : 's') + ' between sprints left out' : '')} />
        <Stat l="Total off days" v={G.off} s={offParts.length ? offParts.join(' · ') : 'No weekly off days or holidays set'} cls={G.off ? 'warn' : ''} />
        <Stat l="Total available days" v={G.avail} s={G.cal + ' sprint days − ' + G.off + ' off'} cls={G.avail > 0 ? 'good' : 'bad'} />
        <Stat l="Total available hours" v={h(G.availHrs)} s={G.avail + ' days × ' + hrsf(G.hpd) + ' h, per person at 100%'} cls={G.avail > 0 ? 'good' : 'bad'} />
        <Stat l="Team leave" v={G.leaveDays + (G.leaveDays === 1 ? ' day' : ' days')} s={G.team ? 'Person-days off, across ' + G.team + ' on the delivery team' : 'No delivery team yet'} cls={G.leaveDays ? 'warn' : ''} />
        <Stat l="Team effective hours / day" v={h(G.perDay)} s={'After allocation and focus factor (' + (Math.round(G.focus * 100) / 100) + ' default)'} />
        <Stat l="Team effective capacity" v={h(G.cap)} s="Over the project, after allocation, focus factor and leave" cls={G.team && G.cap > 0 ? 'good' : ''} />
      </div>
    </div>
  );
}
