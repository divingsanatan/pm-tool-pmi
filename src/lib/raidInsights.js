import { DAY, pd, today } from './dates';
import { rating, score, emv, expo } from './calc';

/* Insights across the whole RAID log (risks, assumptions, issues and dependencies), as of a date.
   An item "needs attention" when it is still open and has at least one of these flags:
     overdue   its due date has passed                    high    a risk rated High (score 15 or more)
     soon      due within the next 7 days                 noOwner nobody owns it
     noResp    a risk or issue with no response yet       stale   not reviewed for more than 30 days (or never) */
export const RAID_TYPES = ['Risk', 'Assumption', 'Issue', 'Dependency'];
export const PLURAL = { Risk: 'Risks', Assumption: 'Assumptions', Issue: 'Issues', Dependency: 'Dependencies' };
export const FLAGS = {
  overdue: { label: 'Overdue', cls: 'bad', w: 4 },
  high: { label: 'High risk', cls: 'bad', w: 4 },
  soon: { label: 'Due in 7 days', cls: 'warn', w: 3 },
  noOwner: { label: 'No owner', cls: 'warn', w: 2 },
  noResp: { label: 'No response', cls: 'warn', w: 2 },
  stale: { label: 'Not reviewed in 30 days', cls: 'neutral', w: 1 },
};

export const isOpenItem = (r) => r.status !== 'Closed';

export function flagsOf(r, asOf = today()) {
  if (!isOpenItem(r)) return [];
  const f = [];
  if (r.due && r.due < asOf) f.push('overdue');
  else if (r.due && pd(r.due) - pd(asOf) <= 7 * DAY) f.push('soon');
  if (r.type === 'Risk' && rating(score(r)) === 'High') f.push('high');
  if (!r.owner) f.push('noOwner');
  if ((r.type === 'Risk' || r.type === 'Issue') && !(r.resp || '').trim()) f.push('noResp');
  if (!r.rev || (pd(asOf) - pd(r.rev)) / DAY > 30) f.push('stale');
  return f.sort((a, b) => FLAGS[b].w - FLAGS[a].w);
}

export function raidInsights(S, asOf = today()) {
  const items = S.raid || [];
  const types = RAID_TYPES.map((type) => {
    const mine = items.filter((r) => r.type === type);
    const open = mine.filter(isOpenItem);
    return { type, total: mine.length, open: open.length, closed: mine.length - open.length, overdue: open.filter((r) => r.due && r.due < asOf).length };
  });
  const attention = items
    .map((r) => ({ r, flags: flagsOf(r, asOf) }))
    .filter((x) => x.flags.length)
    .map((x) => ({ ...x, rank: x.flags.reduce((a, k) => a + FLAGS[k].w, 0) }))
    .sort((a, b) => b.rank - a.rank);
  const open = items.filter(isOpenItem);
  const risks = open.filter((r) => r.type === 'Risk');
  return {
    types,
    total: items.length,
    open: open.length,
    closed: items.length - open.length,
    overdue: open.filter((r) => r.due && r.due < asOf).length,
    dueSoon: open.filter((r) => flagsOf(r, asOf).includes('soon')).length,
    openRisks: risks.length,
    highRisks: risks.filter((r) => rating(score(r)) === 'High').length,
    emv: risks.reduce((a, r) => a + (emv(r) || 0), 0),
    exposure: risks.reduce((a, r) => a + (expo(r) || 0), 0),
    attention,
  };
}
