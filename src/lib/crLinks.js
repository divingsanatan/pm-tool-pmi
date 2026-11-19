// Links between change requests and work items / RAID items.
// The links live on the change request (cr.tasks = work item ids, cr.raid = RAID item keys), so there is one source of truth:
// the list view, the RAID log and the change request all read the same lists, and the links can be changed at any status.
export const crsFor = (S, kind, id) => (S.cr || []).filter((c) => Array.isArray(c[kind]) && c[kind].includes(id));
export const crLabel = (c) => c.code + (c.title ? ' · ' + c.title : '');
