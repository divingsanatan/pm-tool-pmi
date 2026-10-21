import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { seedWorkspace } from '../lib/seed';
import { normalize } from '../lib/calc';
import { fixNav, isV3, toWorkspace } from '../lib/migrate';

export const KEY = 'sprint-control-v3';
const OLD_KEY = 'sprint-control-v2';

function load() {
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
    /* storage blocked or corrupt: fall through to seed */
  }
  return toWorkspace(seedWorkspace());
}

const curOf = (W) => W.projects.find((p) => p.id === W.nav.projectId) || W.projects[0];
const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [W, setW] = useState(load);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(W));
      setSaved('Saved in this browser');
    } catch (e) {
      setSaved('Not saved (storage blocked)');
    }
  }, [W]);

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

  const S = curOf(W);
  return <Ctx.Provider value={{ W, S, nav: W.nav, saved, update, updateW, setNav, replace, setField }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>');
  return v;
}
