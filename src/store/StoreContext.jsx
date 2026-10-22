import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { seedWorkspace } from '../lib/seed';
import { normalize } from '../lib/calc';
import { fixNav, isV3, toWorkspace } from '../lib/migrate';
import { supabase } from '../lib/supabase';
import { createCloud, fetchCloud, markSynced, newSyncState, pushCloud, workspaceFromRows } from '../lib/cloud';
import { CloudImport, Splash } from '../components/CloudScreens';

export const KEY = 'sprint-control-v3';
const OLD_KEY = 'sprint-control-v2';

// What this browser has saved, or null. Never falls back to sample data.
function loadLocal() {
  try {
    const j = localStorage.getItem(KEY);
    if (j) {
      const o = JSON.parse(j);
      if (isV3(o)) return toWorkspace(o);
    }
    const old = localStorage.getItem(OLD_KEY); // data saved by the earlier single-file version
    if (old) {
      const w = toWorkspace(JSON.parse(old));
      if (w) return w;
    }
  } catch (e) {
    /* storage blocked or corrupt */
  }
  return null;
}
const load = () => loadLocal() || toWorkspace(seedWorkspace());

const curOf = (W) => W.projects.find((p) => p.id === W.nav.projectId) || W.projects[0];
const Ctx = createContext(null);

// cloud = { userId, email, signOut } when signed in to Supabase, otherwise undefined (saves to this browser only).
// In cloud mode this browser's saved copy is deliberately left untouched, so it stays a backup.
export function StoreProvider({ children, cloud }) {
  const isCloud = !!cloud;
  const userId = cloud ? cloud.userId : null;
  const [W, setW] = useState(() => (isCloud ? toWorkspace(seedWorkspace()) : load()));
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState(isCloud ? 'loading' : 'ready'); // loading | import | error | ready
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState(false);

  const sync = useRef(newSyncState());
  const latest = useRef(W);
  latest.current = W;
  const timer = useRef(null);
  const busy = useRef(false);
  const again = useRef(false);
  const halted = useRef(false);
  const local = useMemo(() => (isCloud ? loadLocal() : null), [isCloud]);

  const loadCloud = useCallback(async () => {
    setStatus('loading');
    setProblem('');
    try {
      const { rows, navRow } = await fetchCloud(supabase);
      if (!rows.length) {
        setStatus('import');
        return;
      }
      const w = workspaceFromRows(rows, navRow);
      if (!w) throw new Error('The cloud data is not in the expected format.');
      markSynced(sync.current, w, rows);
      setW(w);
      setSaved('Loaded from cloud');
      setStatus('ready');
    } catch (e) {
      setProblem((e && e.message) || 'Unknown error');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (isCloud) loadCloud();
  }, [isCloud, loadCloud]);

  // First run: upload this browser's work (or the sample workspace) to the cloud
  const startCloud = useCallback(
    async (w) => {
      const first = w || toWorkspace(seedWorkspace());
      await createCloud(supabase, sync.current, userId, first);
      setW(first);
      setSaved('Saved to cloud');
      setStatus('ready');
    },
    [userId]
  );

  const flush = useCallback(async () => {
    if (halted.current) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        await pushCloud(supabase, sync.current, userId, latest.current);
      } while (again.current);
      setSaved('Saved to cloud');
    } catch (e) {
      if (e && e.conflict) {
        halted.current = true;
        setConflict(true);
        setSaved('Not saved: changed elsewhere');
      } else {
        setSaved('Cloud save failed, retrying…');
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 5000);
      }
    } finally {
      busy.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    if (!isCloud) {
      try {
        localStorage.setItem(KEY, JSON.stringify(W));
        setSaved('Saved in this browser');
      } catch (e) {
        setSaved('Not saved (storage blocked)');
      }
      return undefined;
    }
    if (halted.current) return undefined;
    setSaved('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
    return () => clearTimeout(timer.current);
  }, [W, status, isCloud, flush]);

  // Save right away when the tab is hidden or the app is switched away from
  useEffect(() => {
    if (!isCloud) return undefined;
    const h = () => {
      if (document.visibilityState === 'hidden' && status === 'ready') {
        clearTimeout(timer.current);
        flush();
      }
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [isCloud, status, flush]);

  // update((project, workspace) => { ...mutate... }) edits the CURRENT project on a clone
  const update = useCallback((fn) => {
    setW((prev) => {
      const next = structuredClone(prev);
      const p = curOf(next);
      fn(p, next);
      normalize(p);
      return next;
    });
  }, []);

  // updateW(workspace => { ... }) edits anything (projects list, navigation)
  const updateW = useCallback((fn) => {
    setW((prev) => {
      const next = structuredClone(prev);
      fn(next);
      next.projects.forEach(normalize);
      return fixNav(next);
    });
  }, []);

  const setNav = useCallback((patch) => setW((prev) => fixNav({ ...prev, nav: { ...prev.nav, ...patch } })), []);

  const replace = useCallback((next) => {
    const w = toWorkspace(next);
    if (w) setW(w);
    return !!w;
  }, []);

  // setField(section, index, field, value) edits project-level tables (meta, report, team, raid...)
  const setField = useCallback(
    (sec, i, f, v) => {
      update((p) => {
        const o = sec === 'meta' || sec === 'ui' ? p[sec] : p[sec] ? p[sec][i] : undefined;
        if (!o) return;
        if (sec === 'meta' && (f === 'weeks' || f === 'sprintWeeks') && !(v >= 1)) v = f === 'weeks' ? 26 : 2;
        if (sec === 'meta' && f === 'start' && !v) return;
        o[f] = v;
      });
    },
    [update]
  );

  if (status === 'loading') return <Splash><div className="msg">Loading your workspace…</div></Splash>;
  if (status === 'error') {
    return (
      <Splash>
        <h1>Could not load your workspace</h1>
        <div className="msg" style={{ color: 'var(--bad)' }}>{problem}</div>
        <button className="btn primary" onClick={loadCloud}>Try again</button>
        <button className="btn" onClick={cloud.signOut}>Sign out</button>
      </Splash>
    );
  }
  if (status === 'import') return <CloudImport local={local} onStart={startCloud} email={cloud.email} signOut={cloud.signOut} />;

  const S = curOf(W);
  return (
    <Ctx.Provider value={{ W, S, nav: W.nav, saved, cloud: cloud ? { email: cloud.email, signOut: cloud.signOut } : null, update, updateW, setNav, replace, setField }}>
      {children}
      {conflict && (
        <div role="alert" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: '12px 16px', background: 'var(--bad-bg)', color: 'var(--bad)', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--bad)' }}>
          <span>This workspace was changed in another tab or device. Your latest edits here are not saved. Reload to get the newest version.</span>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>');
  return v;
}
