// Power / interest grid (the PMBOK stakeholder grid). Each stakeholder is scored 1 to 10 for power (how much they can influence the project)
// and interest (how much the project matters to them). Scores of 6 and above count as high.
export const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const HIGH_FROM = 6;

export const QUADRANTS = [
  { id: 'closely', label: 'Manage closely', power: 'high', interest: 'high', how: 'Involve them in decisions and talk often. Their support makes or breaks the project.' },
  { id: 'satisfied', label: 'Keep satisfied', power: 'high', interest: 'low', how: 'Keep them comfortable with short, focused updates. Do not overload them.' },
  { id: 'informed', label: 'Keep informed', power: 'low', interest: 'high', how: 'Share progress regularly and listen to their feedback. They can be good allies.' },
  { id: 'monitor', label: 'Monitor', power: 'low', interest: 'low', how: 'Watch for changes and give minimal effort.' },
];

export const scoreOf = (v) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return n >= 1 && n <= 10 ? Math.round(n) : null;
};
export const isPlaced = (p) => scoreOf(p.power) != null && scoreOf(p.interest) != null;

export function quadrantOf(p) {
  if (!isPlaced(p)) return null;
  const hp = scoreOf(p.power) >= HIGH_FROM;
  const hi = scoreOf(p.interest) >= HIGH_FROM;
  return QUADRANTS.find((q) => (q.power === 'high') === hp && (q.interest === 'high') === hi);
}
