import { useMemo } from 'react';
import { useStore } from './StoreContext';
import { allContainers, cleanTag, cleanTags, okColor } from '../lib/tasks';

const today = () => new Date().toISOString().slice(0, 10);
const key = (g) => String(g).toLowerCase();

// make sure a tag has a registry entry (new tags get today as their creation date); returns the entry
function ensure(p, name, color) {
  p.tagDefs = p.tagDefs || {};
  const d = p.tagDefs[key(name)];
  if (d) {
    if (color !== undefined) d.color = color;
    return d;
  }
  return (p.tagDefs[key(name)] = { name, color: color !== undefined ? color : '', created: today() });
}

// every work item of the project, whatever sprint or the Backlog it is in
const eachTask = (p, fn) => allContainers(p).forEach((c) => c.tasks.forEach((t) => fn(t, c)));

/* Tag actions for the current project. Tags stay plain text on the work items; the registry (project.tagDefs) holds their colour and date.
     create(name, color)    a new tag (existing one: returned as it is). Returns the tag's name.
     setColor(tag, color)   '' = automatic, 'none' = no colour, '#rrggbb'
     rename(tag, to)        renames it on every work item. Renaming to a tag that already exists merges the two. Returns the new name.
     remove(tags)           deletes tags from the registry and from every work item
     tagMany(ids, tag, on)  adds (on) or removes the tag on every listed work item (bulk tagging)
     clearMany(ids)         takes every tag off the listed work items */
export function useTags() {
  const { update } = useStore();
  return useMemo(
    () => ({
      create(name, color) {
        const g = cleanTag(name);
        if (!g) return '';
        let out = g;
        update((p) => {
          const d = ensure(p, g, okColor(color) || color === 'none' ? color : undefined);
          out = d.name;
        });
        return out;
      },
      setColor(tag, color) {
        const c = okColor(color) || color === 'none' ? color : '';
        update((p) => void ensure(p, tag, c));
      },
      rename(tag, to) {
        const g = cleanTag(to);
        if (!g || g === tag) return tag;
        let out = g;
        update((p) => {
          const from = ensure(p, tag);
          const same = key(g) === key(tag);
          const target = !same && p.tagDefs[key(g)];
          if (target) out = target.name; // merge into the tag that already has this name
          else {
            const keep = { ...from, name: g };
            delete p.tagDefs[key(tag)];
            p.tagDefs[key(g)] = keep;
          }
          if (target) delete p.tagDefs[key(tag)];
          eachTask(p, (t) => {
            if ((t.tags || []).some((x) => key(x) === key(tag))) t.tags = cleanTags((t.tags || []).map((x) => (key(x) === key(tag) ? out : x)));
          });
        });
        return out;
      },
      remove(tags) {
        const gone = new Set(tags.map(key));
        update((p) => {
          gone.forEach((k) => p.tagDefs && delete p.tagDefs[k]);
          eachTask(p, (t) => {
            if ((t.tags || []).some((x) => gone.has(key(x)))) t.tags = t.tags.filter((x) => !gone.has(key(x)));
          });
        });
      },
      tagMany(ids, tag, on) {
        const g = cleanTag(tag);
        if (!g) return;
        const set = new Set(ids);
        update((p) => {
          const name = ensure(p, g).name;
          eachTask(p, (t) => {
            if (!set.has(t.id)) return;
            const rest = (t.tags || []).filter((x) => key(x) !== key(name));
            t.tags = on ? cleanTags(rest.concat(name)) : rest;
          });
        });
      },
      clearMany(ids) {
        const set = new Set(ids);
        update((p) => eachTask(p, (t) => { if (set.has(t.id) && (t.tags || []).length) t.tags = []; }));
      },
    }),
    [update]
  );
}
