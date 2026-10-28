import { useState } from 'react';
import { Modal } from './UI';
import { fdate } from '../lib/dates';
import { currentBaseline, sprintCrs } from '../lib/change';
import { baselinedDates } from '../lib/sprintGuard';

// Opens a baselined sprint's dates for change: through a new change request, or by adding the sprint to an open one.
export default function DateChangeDialog({ S, c, onPick, onClose }) {
  const [reason, setReason] = useState('');
  const bw = baselinedDates(S, c.id), b = currentBaseline(S);
  const open = sprintCrs(S).slice().reverse();
  return (
    <Modal title="Request a date change" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        {c.name} is fixed{bw ? ' at ' + fdate(bw.start) + ' \u2013 ' + fdate(bw.end) : ''} by baseline {b ? b.version : ''}. Its dates change only through a change request.
        Once a request is open, the start and end dates unlock so you can enter the new ones, and the next baseline records them.
      </p>
      <label className="fld">Why do the dates need to change?
        <textarea className="c" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the client moved the review, or the team lost two weeks to an outage." />
      </label>
      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onPick({ reason })}>Raise a new change request</button>
      </div>
      {open.length > 0 && (
        <>
          <h4 className="d-h" style={{ margin: '18px 0 8px' }}>Or add it to an open request</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {open.slice(0, 5).map((cr) => (
              <button key={cr.id} className="btn" style={{ textAlign: 'left' }} onClick={() => onPick({ crId: cr.id, reason })}>
                {cr.code}{cr.title ? ' \u00b7 ' + cr.title : ''} <span className="msg">({cr.status})</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
