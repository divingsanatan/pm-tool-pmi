import { toWorkspace } from './migrate';

// Cloud storage: one row per project in public.projects (the whole project as JSONB) plus one
// public.workspaces row for navigation. `state` remembers what the cloud already holds so that
// only changed projects are sent. Every update is guarded by `rev`, so a stale tab or device can
// never overwrite newer data.

export class ConflictError extends Error {
  constructor() {
    super('This workspace was changed somewhere else.');
    this.conflict = true;
  }
}

export const newSyncState = () => ({ projects: {}, nav: '' });

const nameOf = (p) => (p.meta && p.meta.name) || '';
const rowOf = (p, i) => ({ id: p.id, position: i, name: nameOf(p), data: p });

export async function fetchCloud(sb) {
  const [pr, wr] = await Promise.all([
    sb.from('projects').select('id,data,rev,position').order('position', { ascending: true }),
    sb.from('workspaces').select('nav').maybeSingle(),
  ]);
  if (pr.error) throw pr.error;
  if (wr.error) throw wr.error;
  return { rows: pr.data || [], navRow: wr.data || null };
}

// Rows -> normalized workspace (null if the stored data is not in the expected shape)
export function workspaceFromRows(rows, navRow) {
  if (!rows.length) return null;
  const projects = rows.map((r) => ({ ...r.data, id: r.id }));
  return toWorkspace({ v: 3, projects, nav: (navRow && navRow.nav) || {} });
}

// Remember what the cloud holds for this workspace
export function markSynced(state, w, rows) {
  const revs = {};
  const pos = {};
  rows.forEach((r) => { revs[r.id] = r.rev; pos[r.id] = r.position; });
  state.projects = {};
  w.projects.forEach((p, i) => {
    state.projects[p.id] = { json: JSON.stringify(p), pos: pos[p.id] == null ? i : pos[p.id], rev: revs[p.id] || 1 };
  });
  state.nav = JSON.stringify(w.nav);
}

// First upload: the cloud is empty, send the whole workspace
export async function createCloud(sb, state, userId, w) {
  const rows = w.projects.map((p, i) => ({ ...rowOf(p, i), rev: 1 }));
  const ins = await sb.from('projects').insert(rows);
  if (ins.error) throw ins.error;
  const nav = await sb.from('workspaces').upsert({ user_id: userId, nav: w.nav }, { onConflict: 'user_id' });
  if (nav.error) throw nav.error;
  markSynced(state, w, rows.map((r) => ({ id: r.id, rev: 1, position: r.position })));
}

// Send what changed since the last push
export async function pushCloud(sb, state, userId, w) {
  const ids = new Set(w.projects.map((p) => p.id));

  for (const id of Object.keys(state.projects)) {
    if (ids.has(id)) continue;
    const del = await sb.from('projects').delete().eq('id', id);
    if (del.error) throw del.error;
    delete state.projects[id];
  }

  for (let i = 0; i < w.projects.length; i++) {
    const p = w.projects[i];
    const json = JSON.stringify(p);
    const prev = state.projects[p.id];
    if (prev && prev.json === json && prev.pos === i) continue;

    if (!prev) {
      const ins = await sb.from('projects').insert({ ...rowOf(p, i), rev: 1 });
      if (ins.error) {
        if (ins.error.code === '23505') throw new ConflictError();
        throw ins.error;
      }
      state.projects[p.id] = { json, pos: i, rev: 1 };
    } else {
      const rev = prev.rev + 1;
      const up = await sb.from('projects').update({ ...rowOf(p, i), rev }).eq('id', p.id).eq('rev', prev.rev).select('rev');
      if (up.error) throw up.error;
      if (!up.data || !up.data.length) throw new ConflictError();
      state.projects[p.id] = { json, pos: i, rev };
    }
  }

  const nav = JSON.stringify(w.nav);
  if (nav !== state.nav) {
    const up = await sb.from('workspaces').upsert({ user_id: userId, nav: w.nav }, { onConflict: 'user_id' });
    if (up.error) throw up.error;
    state.nav = nav;
  }
}
