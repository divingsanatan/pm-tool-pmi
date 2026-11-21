import { supabase } from './supabase';

// Files attached to work items. The project data keeps only a small record per file (name, type, size, where it is stored);
// the file itself is in Supabase Storage (bucket "attachments", private, under <project id>/<work item id>/). When the app runs
// without the cloud (saving to this browser only), the files are kept in this browser's own database (IndexedDB) instead.
export const BUCKET = 'attachments';
export const MAX_BYTES = 25 * 1024 * 1024;
// Images and documents only. The type is worked out from the file's ending (reliable), because browsers often report documents,
// CSV and Markdown files with a wrong or empty type. Not allowed on purpose: video, audio, SVG, HTML, scripts, programs and archives.
const BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', md: 'text/markdown',
};
const OK = new Set(Object.values(BY_EXT));
export const ACCEPT = Object.keys(BY_EXT).map((e) => '.' + e).join(',');
export const TYPES_TEXT = 'Images (JPG, PNG, GIF, WebP) and documents (PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV, RTF, Markdown), up to 25 MB each';

export const extOf = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
// the type to store and send for a file, or '' when it is not allowed
export const mimeOf = (f) => BY_EXT[extOf(f.name)] || (OK.has(f.type) && f.type !== 'text/plain' ? f.type : '');
export const kindOf = (mime) => (String(mime).startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'doc');
export const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// '' when the file can be attached, otherwise what is wrong with it
export function checkFile(f) {
  if (!mimeOf(f)) return '“' + f.name + '” cannot be attached. Use ' + TYPES_TEXT + '.';
  if (!f.size) return '“' + f.name + '” is empty.';
  if (f.size > MAX_BYTES) return '“' + f.name + '” is ' + fmtSize(f.size) + ', over the 25 MB limit.';
  return '';
}

const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
const seg = (s) => {
  if (!/^[\w-]+$/.test(String(s))) throw new Error('This project cannot store files yet (its ID has unusual characters).');
  return String(s);
};
const friendly = (e) => {
  const m = String((e && (e.message || e.error)) || e || '');
  if (/row-level security|not authorized|unauthorized|permission/i.test(m)) return 'You do not have permission to add or remove files on this project.';
  if (/bucket not found/i.test(m)) return 'File storage is not set up for this project yet.';
  if (/exceeded|too large|size/i.test(m)) return 'The file is too large (25 MB limit).';
  if (/mime|type/i.test(m)) return 'This file type is not allowed. Attach images or documents (PDF, Word, Excel, PowerPoint, TXT, CSV).';
  return m || 'The file could not be saved.';
};

// ---- this browser's own file store (used only when the app is not signed in to the cloud)
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('sprint-control-files', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const idbDo = async (mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', mode);
    const rq = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
  });
};

// Saves one file. online = signed in to the cloud. Returns where it is stored.
export async function putFile(file, { online, projectId, taskId, id }) {
  if (online && supabase) {
    const path = [seg(projectId), seg(taskId), id + '-' + safeName(file.name)].join('/');
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mimeOf(file), upsert: false, cacheControl: '3600' });
    if (error) throw new Error(friendly(error));
    return { path, store: 'cloud' };
  }
  const path = 'local/' + id;
  try { await idbDo('readwrite', (s) => s.put(file, path)); } catch (e) { throw new Error('This browser could not keep the file.'); }
  return { path, store: 'local' };
}

// A link that shows the file. Cloud files get a private link that expires after an hour; links are kept for 50 minutes and reused.
const links = new Map();
export function urlOf(att, download = false) {
  const key = att.path + (download ? '#dl' : '');
  const hit = links.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = (async () => {
    if (att.store === 'local') {
      const blob = await idbDo('readonly', (s) => s.get(att.path));
      if (!blob) throw new Error('This file was added on another browser and is not available here.');
      return URL.createObjectURL(blob);
    }
    if (!supabase) throw new Error('Sign in to see this file.');
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.path, 3600, download ? { download: att.name } : undefined);
    if (error || !data) throw new Error(friendly(error) || 'The file could not be opened.');
    return data.signedUrl;
  })();
  links.set(key, { p, exp: att.store === 'local' ? Infinity : Date.now() + 50 * 60 * 1000 });
  p.catch(() => links.delete(key));
  return p;
}

export async function dropFile(att) {
  links.delete(att.path);
  links.delete(att.path + '#dl');
  if (att.store === 'local') { await idbDo('readwrite', (s) => s.delete(att.path)); return; }
  if (supabase) await supabase.storage.from(BUCKET).remove([att.path]);
}
