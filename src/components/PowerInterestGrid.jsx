import { useStore } from '../store/StoreContext';
import { Avatar } from './Bits';
import { QUADRANTS, isPlaced, quadrantOf, scoreOf } from '../lib/stakeholderGrid';

// Power / interest grid built from the stakeholder list: power up the side, interest along the bottom. Stakeholders appear as soon as both
// scores are set in the table above. Below the grid, each box lists its people with how to engage them.
export default function PowerInterestGrid() {
  const { S } = useStore();
  const placed = S.people.filter(isPlaced);
  const loose = S.people.filter((p) => !isPlaced(p));
  // people with the same two scores would sit on top of each other: spread them sideways a little
  const spot = new Map();
  placed.forEach((p) => {
    const k = scoreOf(p.power) + '-' + scoreOf(p.interest);
    spot.set(k, (spot.get(k) || []).concat(p.id));
  });
  const pos = (p) => {
    const w = spot.get(scoreOf(p.power) + '-' + scoreOf(p.interest));
    const i = w.indexOf(p.id);
    return {
      left: `calc(${6 + ((scoreOf(p.interest) - 1) / 4) * 88}% + ${(i - (w.length - 1) / 2) * 30}px)`,
      bottom: `${6 + ((scoreOf(p.power) - 1) / 4) * 88}%`,
    };
  };
  return (
    <div className="card">
      <h2>Power / interest grid</h2>
      <p className="hint">Where each stakeholder sits by how much power they have over the project and how interested they are in it. Set the two scores (1 to 5; 4 and 5 count as high) for each stakeholder in the table above and they appear here.</p>
      {!S.people.length ? (
        <p className="msg">Add stakeholders above to build the grid.</p>
      ) : (
        <>
          <div className="pi-body">
          <div className="pi-layout">
          <div className="pi-wrap">
            <div className="pi-axis-y" aria-hidden="true">Power →</div>
            <div className="pi-grid" role="img" aria-label={'Power and interest grid with ' + placed.length + ' stakeholder' + (placed.length === 1 ? '' : 's')}>
              <div className="pi-q q-satisfied"><span>Keep satisfied</span></div>
              <div className="pi-q q-closely"><span>Manage closely</span></div>
              <div className="pi-q q-monitor"><span>Monitor</span></div>
              <div className="pi-q q-informed"><span>Keep informed</span></div>
              {placed.map((p) => (
                <div key={p.id} className="pi-dot" style={pos(p)} title={p.name + ' · power ' + scoreOf(p.power) + ', interest ' + scoreOf(p.interest)}>
                  <Avatar name={p.name || '?'} size={30} />
                </div>
              ))}
            </div>
            <div className="pi-axis-x" aria-hidden="true">Interest →</div>
          </div>
          <div className="pi-list">
            {QUADRANTS.map((q) => {
              const who = placed.filter((p) => quadrantOf(p).id === q.id);
              return (
                <div key={q.id} className={'pi-card q-' + q.id}>
                  <b>{q.label}</b>
                  <span className="msg">{q.power === 'high' ? 'High' : 'Low'} power · {q.interest === 'high' ? 'high' : 'low'} interest</span>
                  <p className="pi-how">{q.how}</p>
                  <div className="pi-who">
                    {who.length ? who.map((p) => (<span key={p.id} className="pi-p"><Avatar name={p.name || '?'} size={20} />{p.name}{p.role ? <span className="msg"> · {p.role}</span> : null}</span>)) : <span className="msg">Nobody here yet</span>}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          </div>
          {loose.length > 0 && (
            <p className="msg" style={{ marginTop: 10 }}>
              Not on the grid yet, because power or interest is not set: <b>{loose.map((p) => p.name).join(', ')}</b>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
