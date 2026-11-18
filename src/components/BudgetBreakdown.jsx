import { money, pc } from '../lib/format';
import { signedMoney } from '../lib/change';
import '../breakdown.css';

/* Amount, reserves and total budget before and after a change request.
   res comes from reserveAfter(): the work budget moves by the cost change and both reserves follow the percentages. */
export default function BudgetBreakdown({ res }) {
  if (!res) return null;
  const delta = (n) => (Math.abs(n) < 0.005 ? <span>–</span> : <span className={n > 0 ? 'plus' : 'minus'}>{signedMoney(n, money)}</span>);
  const row = (cls, label, sub, before, after) => (
    <tr className={cls}>
      <td>{label}{sub && <small>{sub}</small>}</td>
      <td>{money(before)}</td>
      <td>{delta(after - before)}</td>
      <td>{money(after)}</td>
    </tr>
  );
  return (
    <table className="bk" aria-label="Budget breakdown before and after this change">
      <thead><tr><th>Budget</th><th>Before</th><th>Change</th><th>After</th></tr></thead>
      <tbody>
        {row('', 'Amount', 'the work budget', res.workBefore, res.work)}
        {row('sub', 'Contingency reserve', pc(res.contPct, 1) + ' of the amount, for identified risks', res.before.contingency, res.contingency)}
        {row('sum', 'Cost baseline (BAC)', 'amount + contingency: what progress is measured against', res.bacBefore, res.bac)}
        {row('sub', 'Management reserve', pc(res.mgmtPct, 1) + ' of the amount, held outside the baseline', res.before.management, res.management)}
        {row('tot', 'Total budget', 'amount + both reserves', res.totalBefore, res.totalAfter)}
      </tbody>
    </table>
  );
}
