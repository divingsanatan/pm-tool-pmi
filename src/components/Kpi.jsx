export default function Kpi({ l, v, s, children }) {
  return (
    <div className="kpi">
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s}</div>
      {children}
    </div>
  );
}
