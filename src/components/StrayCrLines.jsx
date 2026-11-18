import { useStore } from '../store/StoreContext';
import { useChange } from '../store/useChange';
import { useUI } from './UI';
import { strayCrLines } from '../lib/change';
import { money } from '../lib/format';

/* Budget lines named after a change request that no longer exists (deleted, or implemented more than once).
   They are never removed silently: this notice lists them and lets the user remove or keep them. */
export default function StrayCrLines() {
  const { S } = useStore();
  const ch = useChange();
  const ui = useUI();
  const list = strayCrLines(S);
  if (!list.length) return null;
  const ids = list.map((l) => l.id);
  const total = list.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return (
    <div className="card" role="status" style={{ borderColor: 'var(--warn)' }}>
      <h2>Budget lines left behind by change requests</h2>
      <p className="hint">
        {list.length === 1 ? 'This line looks' : 'These ' + list.length + ' lines look'} like {list.length === 1 ? 'it was' : 'they were'} created by a change request that was deleted or implemented more than once, so no request owns {list.length === 1 ? 'it' : 'them'} any more. {list.length === 1 ? 'It is' : 'They are'} still part of the plan’s budget ({money(total)}).
      </p>
      <ul style={{ margin: '6px 0 10px', paddingLeft: 18 }}>
        {list.map((l) => (<li key={l.id}><b>{l.name}</b> · {money(l.amount)}</li>))}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn danger"
          onClick={() => ui.ask({
            title: 'Remove ' + (list.length === 1 ? 'this budget line' : 'these ' + list.length + ' budget lines') + '?',
            body: (
              <>
                <p style={{ margin: '0 0 8px' }}>{list.map((l) => '“' + l.name + '” (' + money(l.amount) + ')').join(', ')} will be removed from the plan’s budget, and from the newest baseline’s copy of the lines if it was frozen there. The baseline’s own budget figure is not changed.</p>
                <p style={{ margin: 0 }}>This cannot be undone.</p>
              </>
            ),
            confirm: 'Remove',
            danger: true,
            onConfirm: () => ch.removeLines(ids),
          })}
        >Remove {list.length === 1 ? 'this line' : 'these lines'}</button>
        <button className="btn" onClick={() => ch.keepLines(ids)} title="They are real costs; stop flagging them">Keep {list.length === 1 ? 'it' : 'them'}</button>
      </div>
    </div>
  );
}
