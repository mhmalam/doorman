# Mohammed's Builder — Asana Project Builder

Build, edit, and sync Asana projects for residential buildings: import rooms
from a spreadsheet or an existing Asana project, edit everything in an
Asana-style staging view, and push only what changed.

## Run locally

```bash
npm install
npm run dev          # Vite frontend → http://localhost:5173
npm run dev:server   # Express/Asana proxy → :3001 (needs .env, see .env.example)
```

The frontend proxies `/api/*` to the Express server. Secrets live only in
server env — copy `.env.example` to `.env` and fill it in.

## Deploy (Docker)

```bash
docker build -t doorman .
docker run -p 3001:3001 \
  -e ASANA_TOKEN=... \
  -e ASANA_WORKSPACE_GID=... \
  -e APP_PASSWORD=... \
  doorman
```

One container: the Express server serves both the API and the built frontend
on `PORT` (default 3001). `APP_PASSWORD` gates the whole app behind a login
screen (leave it unset to disable auth for local dev). To enable the
"Occupancy report" quick-pick in Insert Rooms, mount the spreadsheet and set
`OCCUPANCY_FILE=/path/to/it.xlsx` (spreadsheets are deliberately not committed).

## Test

```bash
npm test                                 # parser unit tests (§5.4 ground-truth table)
npx tsx scripts/validate-occupancy.ts    # parser vs. the master occupancy export
```

## Layout

- `src/core/` — pure shared modules: `registry.ts` (prefix → building/rule),
  `parser.ts` (room string → building/floor/tags/confidence), `importers.ts`
  (rows → parsed rooms, column auto-detect), `blueprint.ts` (section presets +
  name templates with `{prefix}/{building}/{floor}/{floorlabel}` variables)
- `src/pages/BuildPage.tsx` — import screen: spreadsheet drop or Asana URL
  (no paste), plus the room-code format reference card
- `src/components/AsanaProject.tsx` — Asana dark list view of the staged
  project, fully editable: add/rename/delete tasks, drag tasks between
  sections, rename/reorder/add sections, working Filter and Sort
- `src/components/CustomizePanel.tsx` — organize presets + section-name
  template editor with live example
- `src/components/SourcePanel.tsx` — source info, column picker for files,
  plain-English issue list
- `src/store.ts` — staging model (`StagedSection`/`StagedTask`) + edit actions
- `server/` — Express proxy: token holder, rate limiter, project snapshots
- `data/` — manifests & snapshots (gitignored), written by the server

## Milestone status

- **M1 — Core parse: done.** 34 unit tests green; 6,549/6,558 rooms (99.86%)
  parse `exact` against the master occupancy file, remainder correctly flagged.
- **M2 — Import & Preview: done.** Spreadsheet and Asana-URL import; fully
  editable Asana-clone staging view (add/rename/delete/drag tasks and
  sections, single-click rename, completion toggle, editable title).
- **M3 — Blueprint & Build: done.** No auto-grouping by default; Customize
  panel offers group-by presets (floor desc/asc, building, label) + section
  name templates with variables. Custom-field columns from the org library
  ("+" header button, `GET /api/fields`; sample library when no token).
  "Create in Asana" runs the batched executor (`POST /api/build`) with live
  progress polling and per-run manifests — verified live against the real
  API (ordered sections, tasks in sections, custom-field values).
- **Projects auto-save to localStorage** (sidebar list, load/delete);
  database later.
- **M4 — Mass ops (staging): largely done.** Multi-select (click / ctrl /
  shift / drag-range / section checkbox / Ctrl+A), bulk action bar
  (complete/incomplete/due date/delete), multi-task field edits. Columns
  (Floor, Due date, custom fields) reorder, resize, remove/restore.
  "Insert rooms" pulls buildings/rooms from any spreadsheet into the
  active project.
- Not built (from the original spec): ops applied to existing Asana
  projects in place (reset/cascade dates), snapshot undo, field *rules*
  (predicate → value automation), registry editor UI, audits.
