# Sprint Control

React (Vite) port of the single-file Sprint Control dashboard: earned-value tracking (PV / EV / AC, SPI / CPI, forecast), work breakdown, Gantt timeline, budget, RACI and RAID log.

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
- **Project view** (click the project name): Dashboard (earned value), Timeline, Budget, RACI, RAID log.
  - **Timeline:** driven by the sprint tasks, with Zoom (Day / Week / Month) and Range (Whole project / one Sprint / Custom dates), a sprint band, a today marker and a Today button.
  - **Budget:** project length (start date, number of weeks, always worked out from your tasks, sprints, completion dates and costs), a **Labour budget** (pick stakeholders, set each one's hourly rate and the capacity they have for the project; shared with RACI), planned line items that repeat per week / month / sprint or once, and an **Actual costs ledger**. "Actual cost to date" is the sum of the ledger. Entries can be added inline, pasted from a spreadsheet, and viewed by week, month, sprint or cost element against the plan.
  - **Stakeholders:** the single list of people (name, optional role). Work items, RACI and the labour budget all pick from it; names can only be added or renamed here.
  - **RACI:** every work item of every sprint (and the Backlog) is listed automatically; only the roles can be marked. Filters: Entire project, a Sprint, a Week, a Month, or Custom dates (a work item belongs to a period when its dates overlap it). Stakeholder columns come from the Stakeholders list.
- **Responsive:** sidebar becomes a slide-out menu, task lists and tables become cards on phones, the Board scrolls with snapping, 16px inputs avoid iOS zoom, larger tap targets on touch screens.

## Work items, types and the WBS

- Every sprint (and the Backlog) holds a flat list of work items. Each item has a **type** (`type`) and an optional **parent** (`parent`, the id of another item in the same list). The order of the list is the order of siblings, so the tree needs no extra storage and nothing changes in Supabase.
- **Types** are per project and editable (WBS tab or any type badge > *Manage types*): Milestone, Epic, Feature, Story, Task, Subtask and Bug come standard, add your own with a name, icon letter and colour. *Milestone* = a point in time (no effort, left out of earned value). *Needs RACI* = whether the RACI completeness check expects an A and an R for that type. A new child gets the next type down (Epic > Feature > Story > Task > Subtask).
- **Roll-up** (`src/lib/hier.js`, run inside `normalize`): a parent's effort is the sum of its children, its start is the earliest child start, its due date the latest child due date, and its status and progress are calculated from the children (weighted by effort, else equally). Those fields are read-only on a parent (shown with a Σ). A parent keeps its own estimate only while none of its children has hours. Earned value, late counts and sprint totals use the lowest-level items only, so nothing is counted twice.
- **WBS tab** (whole project: every sprint is a branch, the Backlog last) and the **WBS view** inside a sprint: numbered WBS codes (1, 1.1, 1.1.1), expand / collapse, show N levels, type filter, search. Keyboard: Enter = item below, Tab / Shift+Tab = indent / outdent, Alt+Up / Down = reorder. Drag the grip to reorder, or drop onto the middle of an item to nest under it. The List view, Backlog, Timeline and RACI chart all show the same tree.
- Deleting, moving or duplicating an item applies to everything below it. Old checklist subtasks are converted to real child items of type Subtask the first time a project loads.

## Activity log

- **Activity tab** (next to Change control) lists everything that happens in the project, newest first, each entry with the exact time it happened (to the second, in your local time; hover for the full timestamp), who did it, and what changed (for example *T-4 “Login”: Status To do → In progress*). It updates live and highlights new entries for a few seconds.
- It is built by comparing the project before and after every edit (`src/lib/activity.js`, called from the store), so any screen or action is covered: work items (create, delete, move, nest, rename, status, assignees, priority, dates, effort, description, RACI), sprints, stakeholders, budget lines, the budget team, cost entries, RAID items, change requests and baselines, statuses, work item types, project settings, and data imports and exports. A parent that becomes Done because its children are done is logged too. A bulk change (one action touching 4 or more items) is one entry. View settings (selected week, timeline zoom) are not logged.
- Stored in `project.activity` (inside the same project data, nothing to change in Supabase). The latest 1000 events are kept; **Export CSV** saves the log. The History section of a work item shows that item's own changes.

## Rules for values

- **Effort in hours is never negative.** The field refuses a negative number (it snaps back and flags the cell), bulk "Set effort" will not apply one, and anything negative that arrives through an import or an old file is set to 0.

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

- **Dates stay inside the sprint** (`src/lib/sprintGuard.js`, wired in `src/store/useTasks.js`): a work item cannot be dated outside its sprint. An edit that would do so (task date, bulk date, or shrinking the sprint's own dates) is held back and a notice asks: set the date inside the sprint, move the item to a new sprint (or the existing sprint that covers the date), or move it to the Backlog. Cancel keeps things as they were. Moving an item into a sprint pulls its dates inside that sprint. Older data that is already outside shows a banner with the same three choices.

- **Sprint plan** (`New sprint` form in `src/components/UI.jsx`, panel at the top of `src/tabs/SprintView.jsx`): a sprint can only be created from a form that requires a name, start date, end date and planned hours (hours are typed by the user). All four stay editable on the sprint page. The sprint page shows start, end, planned hours, work item hours (live total of the sprint's work items and how much is done) and the difference. Sprints without planned hours (older data, or created by the "move to a new sprint" choice) are highlighted and listed under Needs attention on the Dashboard, as is a sprint whose work items exceed its planned hours.

- **Planned value from sprint hours** (`sprintShares`, `workPlan` in `src/lib/calc.js`): each sprint's share of the project budget (BAC) is its planned hours divided by the planned hours of all sprints, so the shares add up to 100% automatically (two sprints of 42.5 h are 50% each). Planned value is placed on the sprint's own dates (spread over the weeks by days). Earned value is the sprint's done work item hours against its planned hours, capped at the sprint's share, counted in the week each item was marked done. A sprint without planned hours falls back to its work item hours and is flagged. The Budget tab is not changed by any of this.
- **Sprints after the baseline need a change request** (New sprint form in `src/components/UI.jsx`): once the project has a baseline, a new sprint must be added through a change request. Pick an open one, or raise a new one in the same form (title, cost change, schedule change). The sprint is linked to it (`sprint.crId`) and all work items in that sprint are listed on the request automatically. The same form is used when the date rule offers "Move to a new sprint".
- **New baselines include the approved change** (`implement` in `src/store/useChange.js`): the new baseline is the previous baseline plus the request's approved cost and approved days (budget at completion and finish date), with scope and the sprint plan taken from the live plan. When you click Implement, a confirmation dialog shows the old and new budget and finish date. If the Budget tab does not already hold the approved cost, you choose: add it as one cost line named after the request, or say you have updated the Budget yourself. Nothing is added to the Budget without that choice. Baselines also record the sprint plan, and the Dashboard flags sprints added since the baseline.

- **Labour budget after the baseline** (`labourControl` and `claimLabour` in `src/lib/change.js`, labour table and planned budget in `src/tabs/Budget.jsx`): a baseline records who was in the labour budget and what each person costs. After that, the baseline's labour budget is the allowance. Replacing someone at the same or a lower cost needs no change request, and budget freed up by removing people is used first. Only the amount above the baseline's labour budget has to be claimed through a change request, for exactly that difference. Adding a stakeholder that would go over opens a dialog to link an open request (its cost change grows by the difference) or raise a new one; the same prompt appears as a banner if hours or rates are raised later. New resources are listed separately in the planned budget and marked in the labour table with the request number. A baseline made before teams were recorded shows a one-click "Record current team" prompt; nothing is enforced until you do it.

- **Weekly tracker removed.** The Weekly tracker tab, its typed Planned %, and the weekly earned-value engine behind the old Dashboard (`wk`, `agg`, `workPlan`, `rng` and the Week / Sprint / Custom range picker) are gone, and `src/tabs/Weekly.jsx` is deleted. Planned value always comes from the sprint plan.
- **Dashboard is real time** (`projectEvm` and `evmSeries` in `src/lib/calc.js`, `src/tabs/Dashboard.jsx`): one whole-project view, as of today, recalculated on every change, every minute and when the tab is shown again. There is no week, sprint or custom range. BAC is the live work budget (Budget tab). PV = sum over the sprints of sprint budget x share of the sprint's days gone (today counts); the sprint budgets are BAC x each sprint's share of the planned hours, so they add up to BAC. EV = sum over the sprints of sprint budget x done hours / planned hours (at most 100% per sprint). AC = cost entries dated today or earlier, plus undated ones; entries dated later are shown apart until their date. SPI = EV/PV, CPI = EV/AC, SV = EV-PV, CV = EV-AC, EAC = BAC/CPI, ETC = EAC-AC, VAC = BAC-EAC, TCPI = (BAC-EV)/(BAC-AC). The Budget and reserves card also shows where the forecast lands against the contingency and management reserves, and Needs attention warns when the forecast passes the work budget, the cost baseline or the total project budget. The budget makeup chart uses whole-project amounts (labour plus every line, one-time items included), so it adds up to BAC. The S-curve is cumulative by day: planned runs to the end of the plan, earned and actual stop at today. The Needs attention list no longer compares a week's cost with an even weekly budget; it flags sprints dated before the project start and sprints without dates (their budget is left out of planned value).
- **Sprint performance panel** (`sprintEvm` in `src/lib/calc.js`, `SprintPanel` in `src/tabs/SprintView.jsx`): the Dashboard tab of every sprint page (next to List, Board and WBS) shows Plan (start, end, planned hours, sprint budget), live progress (work item hours, planned %, earned %, status) and earned value (PV, EV, AC, SPI, CPI), all as of today and recalculated on every change and every minute. Planned % is the days of the sprint gone (today counts) divided by the days in it; earned % is done work item hours divided by planned hours, at most 100%; PV and EV are the sprint budget (BAC times its share of the planned hours) times those percentages; AC is the cost entries dated inside the sprint up to today; SPI is EV over PV and CPI is EV over AC. A "How these numbers are calculated" section on the page shows each step with the sprint's own numbers and lists the cost entries counted. Status is Complete, Overdue, or by SPI Ahead / On track / At risk / Behind.

- **Contingency and management reserve** (`reserves` in `src/lib/calc.js`, rows in `src/tabs/Budget.jsx`): two built-in lines at the bottom of the planned budget line items, defaults 10% and 5% of the work budget. They cannot be deleted. Until a baseline exists the percentages can be edited and the amounts follow the work budget. From the first baseline on they are locked: percentages and amounts are the baseline's own (`baseline.reserve`), are carried unchanged into every later baseline, and cannot be edited in the Budget tab (the store and `normalize` also restore them). Structure: work budget (BAC) + contingency = cost baseline; + management reserve = total project budget. Earned value, SPI and CPI stay measured against the work budget (BAC). A baseline made before reserves existed gets its reserves recorded from its own budget at completion.

- **Changing reserves through a change request** (`reserveAfter` in `src/lib/change.js`, Impact assessment in `src/tabs/ChangeDrawer.jsx`): once a baseline locks the reserves, a change request can set a new contingency and/or management reserve percentage (leave a field blank to keep it). The drawer and the Implement dialog show old and new reserve amounts and the total project budget. On implement the new baseline applies the new percentage to its own work budget (BAC after the request's approved cost); a reserve the request leaves blank is carried over unchanged. The percentages are fixed once the request is decided, so what was approved is what is implemented. **Dashboard and Change tab:** the Dashboard has a Budget and reserves card (work budget, contingency, cost baseline, management reserve, total project budget, reserve used and left, and a bar with actual cost marked); the Needs attention list warns when actual cost goes above BAC (contingency in use) or above the cost baseline (management reserve in use). The Change tab shows the total project budget next to the baseline budget, and a Reserves column in the baseline history.
