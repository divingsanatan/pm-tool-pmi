import { useState } from 'react';
import { useStore } from '../store/StoreContext';
import WbsTree from '../components/WbsTree';
import TaskDrawer from './TaskDrawer';

// The whole project as one work breakdown structure: every sprint is a branch, the Backlog is the last one
export default function Wbs() {
  const { S } = useStore();
  const [open, setOpen] = useState(null);
  return (
    <div className="card">
      <h2>Work breakdown structure</h2>
      <p className="hint">Break the project into Epics, Features, Stories, Tasks and Subtasks (or your own types). Hours, dates and progress add up from the lowest level to every level above it.</p>
      <WbsTree ids={S.sprints.map((s) => s.id).concat(['backlog'])} onOpen={setOpen} />
      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
