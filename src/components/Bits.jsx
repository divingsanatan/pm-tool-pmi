import { priorityOf } from '../lib/tasks';

export function Avatar({ name, size = 24 }) {
  if (!name) {
    return (
      <span className="av none" style={{ width: size, height: size }} title="Unassigned">
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" /></svg>
      </span>
    );
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  const ini = name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  return (
    <span className="av" style={{ width: size, height: size, background: `var(--s${(h % 6) + 1})`, fontSize: size * 0.42 }} title={name}>
      {ini}
    </span>
  );
}

// status is a status object { label, color, pct, done }: dashed ring = not started, pie = partly done, check = done
export function StatusIcon({ status, size = 18 }) {
  const s = status || {};
  const color = s.color || 'var(--muted)';
  const f = s.done ? 1 : Math.max(0, Math.min(1, s.pct || 0));
  const r = 7.5;
  let pie = null;
  if (!s.done && f > 0) {
    const th = f * 2 * Math.PI;
    pie = <path d={`M10 10 L10 ${10 - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(10 + r * Math.sin(th)).toFixed(2)} ${(10 - r * Math.cos(th)).toFixed(2)} Z`} fill={color} />;
  }
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-label={s.label} role="img">
      <circle cx="10" cy="10" r={r} fill={s.done ? color : 'none'} stroke={color} strokeWidth="1.8" strokeDasharray={!s.done && f === 0 ? '2.6 2.4' : undefined} />
      {pie}
      {s.done && <path d="M6.3 10.2l2.5 2.5 4.9-5" fill="none" stroke="var(--surface)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// overlapping avatars for several assignees
export function AvatarStack({ names, size = 24, max = 3 }) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return <Avatar name="" size={size} />;
  const shown = list.slice(0, max);
  return (
    <span className="av-stack" title={list.join(', ')}>
      {shown.map((n, i) => (<Avatar key={i} name={n} size={size} />))}
      {list.length > max && <span className="av more" style={{ width: size, height: size, fontSize: size * 0.4 }}>+{list.length - max}</span>}
    </span>
  );
}

export function SprintIcon({ status, size = 16 }) {
  const color = status === 'Done' ? 'var(--good)' : status === 'Active' ? 'var(--accent)' : 'var(--muted)';
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke={color} strokeWidth="1.8" />
      {status === 'Active' && <path d="M8.2 6.8l5 3.2-5 3.2z" fill={color} />}
      {status === 'Done' && <path d="M6.3 10.2l2.5 2.5 4.9-5" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function Flag({ priority, size = 16 }) {
  const p = priorityOf(priority);
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-label={p ? p.label + ' priority' : 'No priority'} role="img">
      <path d="M5 17V3.5M5 4h9l-2 3.2L14 10.5H5" fill={p ? p.color : 'none'} stroke={p ? p.color : 'var(--muted)'} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

// an inbox tray: the Backlog is a holding area, not a sprint
export function BacklogIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" data-icon="backlog" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M3 11l2.2-5.6A1.5 1.5 0 0 1 6.6 4.5h6.8a1.5 1.5 0 0 1 1.4.9L17 11v3.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
      <path d="M3 11h4l.8 1.8h4.4L13 11h4" />
    </svg>
  );
}

// small coloured badge for a work item type (a milestone is drawn as a bare diamond)
export function TypeBadge({ type, size = 18 }) {
  const t = type || {};
  const color = t.color || 'var(--muted)';
  if (t.milestone) return <span className="tb ms" style={{ width: size, height: size, color, fontSize: size * 0.95 }} title={t.label}>{t.icon || '◆'}</span>;
  return <span className="tb" style={{ width: size, height: size, background: color, fontSize: size * 0.58 }} title={t.label}>{t.icon || (t.label || '?').charAt(0)}</span>;
}
