# Sprint Control

React (Vite) port of the single-file Sprint Control dashboard: earned-value tracking (PV / EV / AC, SPI / CPI, forecast), weekly tracker, work breakdown, Gantt timeline, budget, RACI and RAID log.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the build locally
```

Deploys as a static site on Vercel, Netlify, GitHub Pages or Cloudflare Pages (build command `npm run build`, output folder `dist`).

## What the app does

ClickUp-style workspace:

- **Left sidebar**: projects, each with its sprints and a Backlog. `+` adds a project or sprint, `⋯` renames or deletes, a red badge shows unfinished tasks. On phones it becomes a slide-out menu.
- **Sprint view** (click a sprint; tasks can have several assignees and the project has custom, editable statuses): List and Board layouts, search, group by status / assignee / priority, assignee filter, inline add, status / assignee / priority menus, subtasks, drag and drop on the Board, task drawer (description, dates, effort, move between sprints), summary cards (tasks added, % assigned, missing effort), and an "unfinished tasks" banner on a Done sprint with one-click move to the next sprint or the Backlog.
- **Backlog** (click it in the left menu): not a sprint. A flat holding area for work items that are not planned yet, with no statuses, no dates and no Board. Group by priority or assignee, and use **Move to sprint** on any item to plan it (it starts at the first open status). Moving work back to the Backlog clears its status. Backlog items are left out of the Timeline, the Dashboard delivery counts and the project's auto week count; the RACI still lists them under "Backlog" for the entire project.
- **Project view** (click the project name): Dashboard (earned value), Weekly tracker, Timeline, Budget, RACI, RAID log.
  - **Timeline:** driven by the sprint tasks, with Zoom (Day / Week / Month) and Range (Whole project / one Sprint / Custom dates), a sprint band, a today marker and a Today button.
  - **Budget:** project length (start date, number of weeks, always worked out from your tasks, sprints, completion dates and costs), a **Labour budget** (pick stakeholders, set each one's hourly rate and the capacity they have for the project; shared with RACI), planned line items that repeat per week / month / sprint or once, and an **Actual costs ledger**. "Actual cost to date" is the sum of the ledger. Entries can be added inline, pasted from a spreadsheet, and viewed by week, month, sprint or cost element against the plan.
  - **Weekly tracker:** everything is calculated. Each sprint work item carries a share of the project budget (by effort hours when any item has effort, otherwise equally). **Planned** follows due dates, **Earned** follows the week items were marked done (the completion date is stamped when an item moves to a finished status, and can be edited in the item), **Actual cost** is the ledger (read-only here). A typed Planned % overrides a week; notes stay editable. Switch to **All projects** for a roll-up lined up by calendar week, with a per-project breakdown, and **Newest first** to reverse the order.
  - **Stakeholders:** the single list of people (name, optional role). Work items, RACI and the labour budget all pick from it; names can only be added or renamed here.
  - **RACI:** every work item of every sprint (and the Backlog) is listed automatically; only the roles can be marked. Filters: Entire project, a Sprint, a Week, a Month, or Custom dates (a work item belongs to a period when its dates overlap it). Stakeholder columns come from the Stakeholders list.
- **Responsive:** sidebar becomes a slide-out menu, task lists and tables become cards on phones, the Board scrolls with snapping, 16px inputs avoid iOS zoom, larger tap targets on touch screens.

## Work items, types and the WBS

- Every sprint (and the Backlog) holds a flat list of work items. Each item has a **type** (`type`) and an optional **parent** (`parent`, the id of another item in the same list). The order of the list is the order of siblings, so the tree needs no extra storage and nothing changes in Supabase.
- **Types** are per project and editable (WBS tab or any type badge > *Manage types*): Milestone, Epic, Feature, Story, Task, Subtask and Bug come standard, add your own with a name, icon letter and colour. *Milestone* = a point in time (no effort, left out of earned value). *Needs RACI* = whether the RACI completeness check expects an A and an R for that type. A new child gets the next type down (Epic > Feature > Story > Task > Subtask).
- **Roll-up** (`src/lib/hier.js`, run inside `normalize`): a parent's effort is the sum of its children, its start is the earliest child start, its due date the latest child due date, and its status and progress are calculated from the children (weighted by effort, else equally). Those fields are read-only on a parent (shown with a Σ). A parent keeps its own estimate only while none of its children has hours. Earned value, late counts and sprint totals use the lowest-level items only, so nothing is counted twice.
- **WBS tab** (whole project: every sprint is a branch, the Backlog last) and the **WBS view** inside a sprint: numbered WBS codes (1, 1.1, 1.1.1), expand / collapse, show N levels, type filter, search. Keyboard: Enter = item below, Tab / Shift+Tab = indent / outdent, Alt+Up / Down = reorder. Drag the grip to reorder, or drop onto the middle of an item to nest under it. The List view, Backlog, Timeline and RACI chart all show the same tree.
- Deleting, moving or duplicating an item applies to everything below it. Old checklist subtasks are converted to real child items of type Subtask the first time a project loads.

## Project layout

```
src/
  main.jsx, App.jsx        entry point and layout (sidebar + content)
  styles.css               all styling (original sheet + new layout section at the bottom)
  store/
    StoreContext.jsx       workspace state, localStorage save, update()/updateW()/setNav()/setField()
    useTasks.js            every task / sprint action (add, patch, move, subtasks, moveOpen...)
    useCosts.js            actual cost ledger actions (add, addMany, patch, remove, sort)
  lib/
    gantt.js               Timeline axis: range, zoom, header cells, grid lines
    parse.js               pasted spreadsheet rows -> cost entries
    raci.js                RACI filters (project / sprint / week / month / custom)
    calc.js                earned value, budget, RAID scoring, alerts, wbsOf() (sprints -> flat rows)
    tasks.js               statuses, priorities, task/sprint/project factories and finders
    seed.js                sample workspace (also used by "Reset to sample data")
    migrate.js             accepts the new format AND the earlier single-file format
    format.js, dates.js    money / percent / UTC date helpers
  components/
    Sidebar.jsx, Menu.jsx (portal dropdown), UI.jsx (confirm dialog + Data modal), Bits.jsx (icons, avatars)
    Field.jsx              <Cell>, <SelectCell>, <Area> inputs; Charts.jsx; Header.jsx; DataPanel.jsx; Kpi.jsx
  tabs/
    SprintView.jsx, Board.jsx, TaskDrawer.jsx     the ClickUp-style sprint view
    BacklogView.jsx                               the Backlog (no statuses, move to sprint)
    Stakeholders.jsx                              the people list
    Dashboard, Weekly, Timeline, Budget, Raci, Raid   project-level views
```

## How data flows

- Everything lives in one workspace object: `{ v: 3, projects: [...], nav: {...} }`. Each project holds its sprints, backlog, budget, people, RACI and RAID.
- `const { S } = useStore()` gives the **current project**. Change it with `update((project) => { ... })`; use `updateW((workspace) => { ... })` to touch the projects list.
- Saved to `localStorage` under `sprint-control-v3`. Data saved by the earlier single-file version (`sprint-control-v2`) is migrated automatically on first load: each WBS phase becomes a sprint, and a task's status comes from its old percent complete.
- Task status maps to percent complete in `lib/tasks.js` (To do 0, In progress 50%, In review 80%, Done 100%). Change `STATUSES` there to adjust roll-ups.
- Stakeholders live in `project.people` (name, hourly rate `rate`, project capacity `cap`). The Budget's labour budget is just a list of which stakeholders are included (`project.team = [{ person: id }]`), so rate and capacity edited in Budget or RACI are the same numbers. Old budget rows are migrated into stakeholders automatically.
- RACI roles live on each task (`task.raci`, keyed by person id), so the chart always matches the sprints. The RACI shows only stakeholders, work items and roles; rates and capacity are managed in Budget. Work items cannot be typed into RACI: rows added there by earlier versions are converted into Backlog tasks automatically.
- Work items can have several assignees (`task.assignees`, a list of stakeholder ids; subtasks have a single `person`). Statuses are per project (`project.statuses`: label, colour, `done`, `pct`) and edited from the Statuses button or the status menu; deleting a status moves its tasks to another one.
- Actual cost is `project.ledger` (date, element, description, amount). Weekly, monthly and sprint figures are always calculated from it, never typed twice.
- The number of weeks is always computed from the data in `normalize()` (`meta.weeksMode` no longer exists). Earned value is derived in `workPlan()` / `wk()` in `calc.js`; old typed `earnPct` values stay in saved data but are ignored. Data saved by earlier versions is migrated automatically (typed weekly costs become ledger entries; old RACI rows move onto their tasks).

## Cloud storage (Supabase)

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`) and the app asks for a login, then loads and saves the workspace in Supabase. Leave them unset and it works exactly as before, saving to this browser only.

- Schema: `supabase/migrations/0001_init_workspaces_and_projects.sql`. One row per project in `projects` (the whole project as JSONB) and one row in `workspaces` for navigation. Row-level security lets a signed-in user see only their own rows.
- First sign-in with an empty cloud: choose "Import the work saved in this browser" or "Start with sample data". In cloud mode this browser's saved copy is never modified, so it stays as a backup.
- Saves are debounced (about 1 second) and only changed projects are sent. Each project has a `rev` number; if another tab or device saved a newer version, the app shows a banner and asks you to reload instead of overwriting it.
- Create your user in Supabase (Authentication > Users) and turn off public sign-ups. Only the publishable key belongs in the browser, never a service_role or secret key.

## Known limits (by design, for now)

- Without the Supabase settings, data is stored per browser. There is no sharing or real-time collaboration.
- Not built: Calendar, Mind map and Reporting views, custom statuses, comments, attachments, notifications, time tracking, integrations.
- `seed.js` contains placeholder project data (names, hourly rates, budgets). Replace it before making the repo public.
