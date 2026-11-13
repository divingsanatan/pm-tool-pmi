import { toWorkspace } from './migrate';
import { canEdit, roleOf } from './access';

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

export async function fetchCloud(sb, userId) {
  const [pr, wr, ad, mb] = await Promise.all([
    sb.from('projects').select('id,data,rev,position').order('position', { ascending: true }),
    sb.from('workspaces').select('nav').maybeSingle(),
    sb.from('app_admins').select('user_id').maybeSingle(),
    sb.from('project_members').select('project_id,role').eq('user_id', userId),
  ]);
  if (pr.error) throw pr.error;
  if (wr.error) throw wr.error;
  // If the sharing tables are not set up yet (migration 0003 not run) the app keeps working as before: the signed-in person is the Admin.
  const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));
  const legacy = missing(ad.error) || missing(mb.error);
  if (!legacy && ad.error) throw ad.error;
  if (!legacy && mb.error) throw mb.error;
  const roles = {};
  (mb.data || []).forEach((m) => { roles[m.project_id] = m.role; });
  const access = { admin: legacy ? true : !!ad.data, roles };
  return { rows: pr.data || [], navRow: wr.data || null, access };
}

// Turns an invitation for this person's email into a membership (does nothing if there is none)
export async function claimInvites(sb) {
  try {
    const r = await sb.rpc('claim_invites');
    return r.error ? 0 : r.data || 0;
  } catch (e) {
    return 0;
  }
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
export async function pushCloud(sb, state, userId, w, access) {
  const ids = new Set(w.projects.map((p) => p.id));
  const admin = !!(access && access.admin);

  for (const id of Object.keys(state.projects)) {
    if (ids.has(id) || !admin) continue; // only an Admin deletes projects
    const del = await sb.from('projects').delete().eq('id', id);
    if (del.error) throw del.error;
    delete state.projects[id];
  }

  for (let i = 0; i < w.projects.length; i++) {
    const p = w.projects[i];
    const json = JSON.stringify(p);
    const prev = state.projects[p.id];
    if (prev && prev.json === json && (prev.pos === i || !admin)) continue; // only an Admin's ordering is saved
    if (!canEdit(roleOf(access, p.id))) continue; // a Viewer's copy is never sent back

    if (!prev) {
      if (!admin) continue; // only an Admin creates projects
      const ins = await sb.from('projects').insert({ ...rowOf(p, i), rev: 1 });
      if (ins.error) {
        if (ins.error.code === '23505') throw new ConflictError();
        throw ins.error;
      }
      state.projects[p.id] = { json, pos: i, rev: 1 };
    } else {
      const rev = prev.rev + 1;
      const row = { ...rowOf(p, i), rev };
      if (!admin) delete row.position; // a shared project keeps the position the Admin gave it
      const up = await sb.from('projects').update(row).eq('id', p.id).eq('rev', prev.rev).select('rev');
      if (up.error) throw up.error;
      if (!up.data || !up.data.length) throw new ConflictError();
      state.projects[p.id] = { json, pos: admin ? i : prev.pos, rev };
    }
  }

  const nav = JSON.stringify(w.nav);
  if (nav !== state.nav) {
    const up = await sb.from('workspaces').upsert({ user_id: userId, nav: w.nav }, { onConflict: 'user_id' });
    if (up.error) throw up.error;
    state.nav = nav;
  }
}
