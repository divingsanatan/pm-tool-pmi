import { useStore } from '../store/StoreContext';
import { fdate } from '../lib/dates';
import { hrsf, money } from '../lib/format';
import { CR_STATUSES, crCls, currentBaseline, drift, pendingOf, signedDays, signedMoney } from '../lib/change';

const tone = (n, bad = 1) => (!n ? undefined : { color: n * bad > 0 ? 'var(--bad)' : 'var(--good)' });

// Dashboard section: baseline versus the live plan, and where the change requests stand
export default function BaselinePanel() {
  const { S, setNav } = useStore();
  const b = currentBaseline(S);
  const d = drift(S);
  const P = pendingOf(S);
  const go = () => setNav({ view: 'project', tab: 'change' });
  const cnt = {};
  CR_STATUSES.forEach((s) => (cnt[s] = S.cr.filter((c) => c.status === s).length));
  const live = S.cr.filter((c) => !['Closed', 'Rejected'].includes(c.status));
  const maxB = Math.max(1, ...S.baselines.map((x) => x.bac));
  // The table only shows totals, so say what moved when the totals still match (for example one work item replaced by another of the same size)
  const nameOf = (code) => { const t = S.sprints.flatMap((sp) => sp.tasks).find((x) => x.code === code); return t ? code + ' ' + t.name : code; };
  const reasons = [];
  if (d && d.moved) {
    if (d.added.length) reasons.push('Work items added since the baseline: ' + d.added.map(nameOf).join(', ') + '.');
    if (d.removed.length) reasons.push('Work items removed since the baseline: ' + d.removed.join(', ') + '.');
    if (d.addedSprints.length) reasons.push('Sprints added since the baseline: ' + d.addedSprints.join(', ') + '.');
    if (d.outside.length) reasons.push('Sprint dates now reach outside the baselined dates: ' + d.outside.join(', ') + '.');
    if (!reasons.length && Math.abs(d.dCost) > 0.5) reasons.push('The budget differs by a small amount that the table rounds.');
    if (!reasons.length && Math.abs(d.dEffort) > 0.01) reasons.push('The planned effort differs by a fraction of an hour that the table rounds.');
  }

  return (
    <div className="grid2e">
      <div className="card">
        <div className="row sp">
          <h2>Baseline and plan</h2>
          {b && <span className="pill neutral">{b.version}</span>}
        </div>
        {!b ? (
          <>
            <p className="hint">No baseline is set yet, so changes cannot be measured.</p>
            <button className="btn primary" onClick={go}>Set the baseline</button>
          </>
        ) : (
          <>
            <p className="hint">Baseline set {fdate(b.date)}{b.crCode ? ' by ' + b.crCode : ''}. The plan is what the Budget and Timeline tabs say now.</p>
            <div className="scroll">
              <table className="tbl">
                <thead><tr><th>Measure</th><th className="r">Baseline</th><th className="r">Plan now</th><th className="r">Variance</th></tr></thead>
                <tbody>
                  <tr><td><span className="cell">Budget at completion</span></td><td className="r mono"><span className="cell">{money(b.bac)}</span></td><td className="r mono"><span className="cell">{money(d.live.bac)}</span></td><td className="r mono"><span className="cell" style={tone(d.dCost)}>{signedMoney(d.dCost, money)}</span></td></tr>
                  <tr><td><span className="cell">Finish date</span></td><td className="r mono"><span className="cell">{fdate(b.end)}</span></td><td className="r mono"><span className="cell">{fdate(d.live.end)}</span></td><td className="r mono"><span className="cell" style={tone(d.dDays)}>{signedDays(d.dDays)}</span></td></tr>
                  <tr><td><span className="cell">Work items</span></td><td className="r mono"><span className="cell">{b.items}</span></td><td className="r mono"><span className="cell">{d.live.items}</span></td><td className="r mono"><span className="cell">{d.dItems > 0 ? '+' : d.dItems < 0 ? '−' : ''}{Math.abs(d.dItems)}</span></td></tr>
                  <tr><td><span className="cell">Planned effort (h)</span></td><td className="r mono"><span className="cell">{hrsf(b.effort)}</span></td><td className="r mono"><span className="cell">{hrsf(d.live.effort)}</span></td><td className="r mono"><span className="cell">{d.dEffort > 0 ? '+' : d.dEffort < 0 ? '−' : ''}{hrsf(Math.abs(d.dEffort))}</span></td></tr>
                </tbody>
              </table>
            </div>
            {d.moved && !P.appr.length && (
              <div className="msg" style={{ color: 'var(--bad)', marginTop: 8 }}>
                <p style={{ margin: 0 }}>The plan differs from the baseline and no approved change request covers it.</p>
                {reasons.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {reasons.map((r, i) => (<li key={i}>{r}</li>))}
                  </ul>
                )}
              </div>
            )}
            {P.appr.length > 0 && <p className="msg" style={{ marginTop: 8 }}>Approved, not yet in the baseline: {P.appr.map((c) => c.code).join(', ')} ({signedMoney(P.apprCost, money)}, {signedDays(P.apprDays)}).</p>}
            {S.baselines.length > 1 && (
              <>
                <div className="flabel" style={{ margin: '14px 0 6px' }}>Budget by baseline version</div>
                <ul className="list">
                  {S.baselines.map((x) => (
                    <li key={x.id} className="wp">
                      <span className="nm"><span className="mono" style={{ color: 'var(--muted)' }}>{x.version}</span>&nbsp; {x.crCode || 'Original'} · {fdate(x.date)}</span>
                      <span className="mono" style={{ textAlign: 'right' }}>{money(x.bac)}</span>
                      <div className="bar"><i style={{ width: (x.bac / maxB) * 100 + '%' }} /></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="row sp">
          <h2>Change requests</h2>
          <button className="btn" onClick={go}>Open change control</button>
        </div>
        <p className="hint">{S.cr.length} on record · {P.open.length} awaiting a decision · {P.appr.length} approved, not yet in the baseline.</p>
        <div className="stack" role="img" aria-label="Change requests by status">
          {CR_STATUSES.map((s) => (cnt[s] ? <i key={s} style={{ flex: cnt[s], background: { neutral: 'var(--muted)', warn: 'var(--warn)', good: 'var(--good)', bad: 'var(--bad)' }[crCls(s)] }} title={s + ': ' + cnt[s]} /> : null))}
        </div>
        <div className="legend">
          {CR_STATUSES.filter((s) => cnt[s]).map((s) => (<span key={s}>{s} {cnt[s]}</span>))}
          {!S.cr.length && <span>No change requests yet</span>}
        </div>
        <div className="scroll" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Title</th><th>Status</th><th className="r">Cost</th><th className="r">Days</th></tr></thead>
            <tbody>
              {live.slice(-5).reverse().map((c) => {
                const fin = ['Approved', 'Implemented'].includes(c.status);
                return (
                  <tr key={c.id}>
                    <td className="mono"><span className="cell">{c.code}</span></td>
                    <td><span className="cell">{c.title || '(untitled)'}</span></td>
                    <td><span className="cell"><span className={'pill ' + crCls(c.status)}>{c.status}</span></span></td>
                    <td className="r mono"><span className="cell">{signedMoney(fin ? c.apCost || 0 : c.cost || 0, money)}</span></td>
                    <td className="r mono"><span className="cell">{signedDays(fin ? c.apDays || 0 : c.days || 0)}</span></td>
                  </tr>
                );
              })}
              {!live.length && <tr><td colSpan="5"><span className="cell msg">No open change requests.</span></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
