// Who may do what. Roles: admin (whole app), pm / member / viewer (per project).
// The database enforces who can read, edit, delete and invite. The rules below also shape the screen
// (hidden tabs, disabled buttons) so people only see what they can use.

export const ROLE_LABEL = { admin: 'Admin', pm: 'Project Manager', member: 'Team member', viewer: 'Viewer' };
export const ROLE_HINT = {
  pm: 'Full control of this project. Can invite team members and viewers.',
  member: 'Edits work items, RACI and RAID. Does not see Budget, Change control or settings.',
  viewer: 'Read only. Does not see Budget, Change control or settings.',
};

export const NO_ACCESS = { admin: false, roles: {} };

export const roleOf = (access, pid) => (access && access.admin ? 'admin' : (access && access.roles && access.roles[pid]) || null);

export const canEdit = (role) => role === 'admin' || role === 'pm' || role === 'member';
export const canSeeBudget = (role) => role === 'admin' || role === 'pm';
export const canManageMembers = (role) => role === 'admin' || role === 'pm';
export const canSeeSettings = (role) => role === 'admin' || role === 'pm';

// roles one person may hand out
export const grantable = (role) => (role === 'admin' ? ['pm', 'member', 'viewer'] : role === 'pm' ? ['member', 'viewer'] : []);

// tabs each role can open
const TAB_RULE = { budget: canSeeBudget, change: canSeeBudget, people: canSeeSettings };
export const tabAllowed = (role, id) => (TAB_RULE[id] ? TAB_RULE[id](role) : true);
