import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import { useUI } from './UI';
import Menu from './Menu';
import { BacklogIcon, FolderIcon, SprintIcon } from './Bits';
import { blankProject, isOpen, newSprint, uid } from '../lib/tasks';

function InlineEdit({ value, onDone }) {
  const [v, setV] = useState(value);
  const finish = (save) => onDone(save && v.trim() ? v.trim() : null);
  return (
    <input
      className="c sb-edit"
      autoFocus
      value={v}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      aria-label="Name"
    />
  );
}

export default function Sidebar({ onNavigate }) {
  const { W, nav, updateW, setNav, saved, cloud } = useStore();
  const ui = useUI();
  const [closed, setClosed] = useState({});
  const [editing, setEditing] = useState(null);
  const go = (patch) => {
    setNav(patch);
    onNavigate && onNavigate();
  };

  const addProject = () => {
    const p = blankProject('New project');
    updateW((w) => {
      w.projects.push(p);
      w.nav = { ...w.nav, projectId: p.id, view: 'project', sprintId: null, tab: 'dash' };
    });
    setClosed((c) => ({ ...c, [p.id]: false }));
    setEditing('p:' + p.id);
  };
  const addSprint = (pid) => {
    const sid = uid();
    updateW((w) => {
      const p = w.projects.find((x) => x.id === pid);
      p.sprints.push(newSprint(p, sid));
      w.nav = { ...w.nav, projectId: pid, view: 'sprint', sprintId: sid };
    });
    setClosed((c) => ({ ...c, [pid]: false }));
    setEditing('s:' + sid);
  };
  const rename = (kind, pid, sid, name) => {
    setEditing(null);
    if (!name) return;
    updateW((w) => {
      const p = w.projects.find((x) => x.id === pid);
      if (kind === 'p') p.meta.name = name;
      else p.sprints.find((s) => s.id === sid).name = name;
    });
  };
  const delProject = (p) =>
    ui.ask({
      title: 'Delete project?',
      body: `“${p.meta.name}” and everything in it (sprints, tasks, budget, RACI, RAID) will be permanently deleted.`,
      confirm: 'Delete project',
      danger: true,
      onConfirm: () => updateW((w) => (w.projects = w.projects.filter((x) => x.id !== p.id))),
    });
  const delSprint = (p, s) =>
    ui.ask({
      title: 'Delete sprint?',
      body: `“${s.name}” and its ${s.tasks.length} task${s.tasks.length === 1 ? '' : 's'} will be permanently deleted.`,
      confirm: 'Delete sprint',
      danger: true,
      onConfirm: () =>
        updateW((w) => {
          const pr = w.projects.find((x) => x.id === p.id);
          pr.sprints = pr.sprints.filter((x) => x.id !== s.id);
        }),
    });

  return (
    <aside className="sb" aria-label="Projects and sprints">
      <div className="sb-head">
        <span className="sb-logo" aria-hidden="true">S</span>
        <span className="sb-ws">Sprint Control</span>
        <button className="btn icon" onClick={addProject} title="New project" aria-label="New project">+</button>
      </div>

      <div className="sb-scroll">
        <div className="sb-sec">Projects</div>
        {W.projects.map((p) => {
          const isCur = p.id === nav.projectId;
          const open = !closed[p.id];
          const key = 'p:' + p.id;
          return (
            <div key={p.id}>
              <div className={'sb-row' + (isCur && nav.view === 'project' ? ' on' : '')}>
                <button className="sb-chev" onClick={() => setClosed((c) => ({ ...c, [p.id]: open }))} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
                {editing === key ? (
                  <InlineEdit value={p.meta.name} onDone={(n) => rename('p', p.id, null, n)} />
                ) : (
                  <button className="sb-main" onClick={() => go({ projectId: p.id, view: 'project' })}>
                    <FolderIcon />
                    <span className="sb-name">{p.meta.name}</span>
                  </button>
                )}
                <button className="sb-act" title="Add sprint" aria-label="Add sprint" onClick={() => addSprint(p.id)}>+</button>
                <Menu
                  className="sb-act"
                  label="⋯"
                  title="Project actions"
                  items={[
                    { label: 'Rename', onClick: () => setEditing(key) },
                    { label: 'Add sprint', onClick: () => addSprint(p.id) },
                    { sep: true },
                    { label: W.projects.length > 1 ? 'Delete project' : 'Delete project (keep at least one)', danger: true, disabled: W.projects.length < 2, onClick: () => delProject(p) },
                  ]}
                />
              </div>
              {open && (
                <div className="sb-kids">
                  {p.sprints.map((s) => {
                    const sk = 's:' + s.id;
                    const n = s.tasks.filter((t) => isOpen(p, t)).length;
                    return (
                      <div key={s.id} className={'sb-row kid' + (isCur && nav.view === 'sprint' && nav.sprintId === s.id ? ' on' : '')}>
                        {editing === sk ? (
                          <InlineEdit value={s.name} onDone={(v) => rename('s', p.id, s.id, v)} />
                        ) : (
                          <button className="sb-main" onClick={() => go({ projectId: p.id, view: 'sprint', sprintId: s.id })}>
                            <SprintIcon status={s.status} />
                            <span className="sb-name">{s.name}</span>
                            {n > 0 && <span className="badge">{n}</span>}
                          </button>
                        )}
                        <Menu
                          className="sb-act"
                          label="⋯"
                          title="Sprint actions"
                          items={[
                            { label: 'Rename', onClick: () => setEditing(sk) },
                            { sep: true },
                            { label: 'Delete sprint', danger: true, onClick: () => delSprint(p, s) },
                          ]}
                        />
                      </div>
                    );
                  })}
                  <div className={'sb-row kid' + (isCur && nav.view === 'sprint' && nav.sprintId === 'backlog' ? ' on' : '')}>
                    <button className="sb-main" onClick={() => go({ projectId: p.id, view: 'sprint', sprintId: 'backlog' })}>
                      <BacklogIcon />
                      <span className="sb-name">Backlog</span>
                      {p.backlog.tasks.length > 0 && <span className="badge">{p.backlog.tasks.length}</span>}
                    </button>
                  </div>
                  <button className="sb-add" onClick={() => addSprint(p.id)}>+ Add sprint</button>
                </div>
              )}
            </div>
          );
        })}
        <button className="sb-add top" onClick={addProject}>+ New project</button>
      </div>

      <div className="sb-foot">
        <button className="btn" onClick={() => { ui.openData(); onNavigate && onNavigate(); }}>Data</button>
        {cloud && <button className="btn" onClick={cloud.signOut} title={cloud.email}>Sign out</button>}
        <span className="msg">{saved}</span>
      </div>
    </aside>
  );
}
