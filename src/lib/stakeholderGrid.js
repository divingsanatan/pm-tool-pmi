// Power / interest grid (the PMBOK stakeholder grid). Each stakeholder is scored 1 to 5 for power (how much they can influence the project)
// and interest (how much the project matters to them). Scores of 4 and 5 count as high; 1 to 3 as low.
export const SCORES = [1, 2, 3, 4, 5];
export const HIGH_FROM = 4;

export const QUADRANTS = [
  { id: 'closely', label: 'Manage closely', power: 'high', interest: 'high', how: 'Involve them in decisions and talk often. Their support makes or breaks the project.' },
  { id: 'satisfied', label: 'Keep satisfied', power: 'high', interest: 'low', how: 'Keep them comfortable with short, focused updates. Do not overload them.' },
  { id: 'informed', label: 'Keep informed', power: 'low', interest: 'high', how: 'Share progress regularly and listen to their feedback. They can be good allies.' },
  { id: 'monitor', label: 'Monitor', power: 'low', interest: 'low', how: 'Watch for changes and give minimal effort.' },
];

// Scores saved earlier on the 1 to 10 scale are shown on the 1 to 5 scale (6 to 10 become 3 to 5 ... 2 per step)
export const scoreOf = (v) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!(n >= 1 && n <= 10)) return null;
  return n <= 5 ? Math.round(n) : Math.ceil(n / 2);
};
export const isPlaced = (p) => scoreOf(p.power) != null && scoreOf(p.interest) != null;

export function quadrantOf(p) {
  if (!isPlaced(p)) return null;
  const hp = scoreOf(p.power) >= HIGH_FROM;
  const hi = scoreOf(p.interest) >= HIGH_FROM;
  return QUADRANTS.find((q) => (q.power === 'high') === hp && (q.interest === 'high') === hi);
}
