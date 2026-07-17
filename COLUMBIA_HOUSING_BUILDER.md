# Doorman — Columbia Housing × Asana Project Builder

A web app that lets Columbia Housing managers and staff build, edit, and mass-manipulate Asana projects for residential buildings — with full preview before anything touches the API, and bulk operations Asana's own UI doesn't offer.

---

## 1. Problem & Goals

Housing runs Asana projects per building (door installs, inspections, microfridge delivery, turnover, etc.). Today this requires hand-written Apps Script per building (see "Reference workflow" §10) because:

- Every building has a **different room-naming scheme** — floor can't be parsed with one universal rule.
- Asana has **no bulk operations**: no select-all, no mass field set, no project reset, no bulk rename, 50-task multi-select cap in the UI.
- Setting up sections per floor + custom fields per room is pure manual labor.

**Goals**

1. Import rooms from **any spreadsheet** (full building or ad-hoc list like a Microfridge project), or from an **existing Asana project URL**, or from a **preset building picker**.
2. Parse building + floor from room names using a **per-building rule registry** (prefix → rule; nothing else hardcoded — floors and room counts are always derived from the imported data, never stored).
3. Let the user fully customize the build in an **Asana-like blueprint editor**: sections, custom-field rule sets, extra tasks, naming — then **preview** the exact result.
4. Apply via the Asana API with **diff preview, live progress, logs, and resume**.
5. Provide a **mass-operations toolbox** on any project: select everything/by rule, reset project, clear due dates, mark all incomplete, bulk rename, bulk field set, etc.

**Non-goals (v1):** multi-workspace support, Asana webhooks/real-time sync, auth/roles (single shared token), mobile app.

---

## 2. Stack & Setup

- **Frontend:** React + Vite + TypeScript. Tailwind for layout; design tokens in CSS variables (§8). Zustand (or similar light store) for the staging/diff state.
- **Backend:** Node + Express (thin proxy). Its only jobs: hold the Asana token, proxy/batch API calls, enforce rate limiting, stream progress via SSE.
- **No database required for v1.** Registry is a static TS module; build manifests/snapshots persist to local JSON files (`/data/manifests`, `/data/snapshots`) so resume and undo survive a restart.
- **Spreadsheet parsing:** `xlsx` (SheetJS) client-side; also accept CSV and raw pasted text.

**Environment**

```
ASANA_TOKEN=            # personal access token — SERVER ONLY, never sent to the client
ASANA_WORKSPACE_GID=    # optional; discovered via /users/me if absent
PORT=3001
```

> ⚠️ **Security:** the Asana PAT lives only in server env. The client never sees it. All Asana calls go through the backend proxy. (A token was previously shared in plaintext during planning — it must be revoked and regenerated before this app is used.)

---

## 3. Architecture

```
┌────────────────────────── React app ──────────────────────────┐
│  Import        Blueprint       Preview        Operate          │
│  (xlsx/csv/    (sections,      (Asana-style   (mass-select     │
│  paste/URL/    field rules,    render, diff)  toolbox, logs)   │
│  presets)      extra tasks)                                    │
└───────────────┬────────────────────────────────────────────────┘
                │ REST + SSE
┌───────────────▼───────────── Node proxy ───────────────────────┐
│  /api/asana/* passthrough  │  /api/build (batched, resumable)  │
│  /api/project/:gid/snapshot│  /api/ops (mass operations)       │
│  rate limiter + retry      │  manifest & snapshot store        │
└───────────────┬────────────────────────────────────────────────┘
                │
        Asana REST API (incl. /batch)
```

**Core modules (shared TS package `/src/core`):**

| Module | Responsibility |
|---|---|
| `registry.ts` | Building prefix → name + floor-rule id. **Static, tiny, hand-auditable.** |
| `parser.ts` | Pure functions: room string → `{prefix, core, slot, tags[], floor}` |
| `blueprint.ts` | Blueprint model + field-rule engine (predicate → field values) |
| `diff.ts` | (currentState, desiredState) → ordered list of API mutations |
| `executor.ts` (server) | Runs a diff via `/batch`, writes manifest, emits SSE progress |
| `snapshot.ts` (server) | Full project state capture (pre-op) → enables undo/revert |

---

## 4. Building Registry — prefix check ONLY

The registry maps a **prefix** to a **display name** and a **floor-rule id**. That is all.
**Do not store floors, floor ranges, or room counts** — buildings change, spreadsheets change; floors are always computed from whatever rooms are actually imported.

```ts
// src/core/registry.ts
export type FloorRuleId =
  | 'hundreds'            // floor = room number minus last two digits
  | 'floor_wing'          // leading digit(s) before a letter = floor
  | 'first_digit'         // small walk-up: first digit of core = floor
  | 'floor_suite_letter'  // [floor][suite][letter]; single-digit+letter = 1st floor
  | 'front_rear'          // [floor][F|R]; G = Ground
  | 'first_digit_b_garden'// first_digit, plus B-prefixed rooms = garden level (treat as floor 1)
  | 'hundreds_mezz'       // hundreds, plus M-coded rooms = Mezzanine
  | 'hundreds_townhouse'; // hundreds, plus H-prefixed rooms = Townhouse

export interface BuildingDef { prefix: string; name: string; rule: FloorRuleId; }

// Longest-prefix match wins (BR542 before 542, BC600 before 600, etc.)
export const REGISTRY: BuildingDef[] = [
  { prefix: '47C',   name: '47 Claremont',            rule: 'floor_suite_letter' },
  { prefix: 'BR523', name: '523 West 113',            rule: 'first_digit' },
  { prefix: 'BR531', name: '531 West 113',            rule: 'first_digit' },
  { prefix: 'BC537', name: '537 West 121 (Barnard)',  rule: 'floor_wing' },
  { prefix: '538',   name: '538 West 114',            rule: 'floor_suite_letter' },
  { prefix: '542',   name: '542 West 112',            rule: 'floor_wing' },
  { prefix: 'BR542', name: '542 West 114',            rule: 'first_digit' },
  { prefix: 'BR548', name: '548 West 113',            rule: 'front_rear' },
  { prefix: 'BRKDR', name: '548 West 114',            rule: 'first_digit' },
  { prefix: '600',   name: '600 West 113',            rule: 'floor_wing' },
  { prefix: 'BC600', name: '600 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BC601', name: '601 West 110 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BR604', name: '604 West 114',            rule: 'front_rear' },
  { prefix: 'BR606', name: '606 West 114',            rule: 'front_rear' },
  { prefix: '611',   name: '611 West 112',            rule: 'hundreds' },
  { prefix: 'BC616', name: '616 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BC620', name: '620 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BR627', name: '627 West 115',            rule: 'floor_wing' },
  { prefix: 'BR536', name: 'AXO - 536 West 114',      rule: 'first_digit_b_garden' },
  { prefix: 'BWY',   name: 'Broadway',                rule: 'hundreds' },
  { prefix: 'CRL',   name: 'Carlton',                 rule: 'floor_wing' },
  { prefix: 'CAR',   name: 'Carman',                  rule: 'hundreds_mezz' },
  { prefix: 'BCCG',  name: 'Cathedral Gardens (Barnard)', rule: 'floor_wing' },
  { prefix: 'BRDG',  name: 'DG - 552 West 113',       rule: 'first_digit' },
  { prefix: 'EC',    name: 'East Campus',             rule: 'hundreds_townhouse' },
  { prefix: 'FUR',   name: 'Furnald',                 rule: 'hundreds' },
  { prefix: 'HMY',   name: 'Harmony',                 rule: 'hundreds_mezz' },
  { prefix: 'HOG',   name: 'Hogan',                   rule: 'floor_wing' },
  { prefix: 'BRICH', name: 'ICH - 554 West 114',      rule: 'front_rear' },
  { prefix: 'BRIRC', name: 'IRC - 552 West 114',      rule: 'first_digit' },
  { prefix: 'JJ',    name: 'John Jay',                rule: 'hundreds' },
  { prefix: 'BRKAT', name: 'KAT - 534 West 114',      rule: 'first_digit' },
  { prefix: 'MCB',   name: 'McBain',                  rule: 'hundreds' },
  { prefix: 'BCPLI', name: 'Plimpton Hall (Barnard)', rule: 'floor_wing' },
  { prefix: 'BR546', name: 'Q House - 546 West 114',  rule: 'first_digit' },
  { prefix: 'RIV',   name: 'River',                   rule: 'hundreds' },
  { prefix: 'RUG',   name: 'Ruggles',                 rule: 'hundreds' },
  { prefix: 'SHP',   name: 'Schapiro',                rule: 'hundreds' },
  { prefix: 'BRSDT', name: 'SDT - 540 West 114',      rule: 'first_digit' },
  { prefix: 'BRSIC', name: 'SIC - 619 West 113',      rule: 'hundreds' },
  { prefix: 'BRSN',  name: 'SN - 556 West 113',       rule: 'first_digit' },
  { prefix: 'BRSPE', name: 'SPE - 550 West 113',      rule: 'first_digit' },
  { prefix: 'WAL',   name: 'Wallach',                 rule: 'hundreds' },
  { prefix: 'WTT',   name: 'Watt',                    rule: 'floor_wing' },
  { prefix: 'WIN',   name: 'Wien',                    rule: 'hundreds' },
  { prefix: 'WBH',   name: 'Woodbridge',              rule: 'floor_wing' },
];
```

The registry must be **user-extensible at runtime**: an "Add building" form (prefix, name, rule picker with live examples) writes to a local `registry.custom.json` merged over the static list. Unknown prefixes during import are surfaced as "Unrecognized — assign a building/rule" rather than guessed.

---

## 5. Parser Specification

### 5.1 Room string anatomy

```
BWY 1119-1 RA
└┬┘ └┬─┘│ └┬┘
prefix core slot tags
```

Tokenizer (applies after longest-prefix match):

1. Strip prefix; strip an optional stray `- ` (BC537 writes `BC537 - 3C2-1`).
2. `core` = chars up to the **last** `-digits` group → `slot` (occupant/bed number).
3. Everything after the slot = whitespace-separated `tags[]`.
4. Cores may contain `/` (`EC 602/4`) — keep intact, floor-parse the first number.

### 5.2 Floor rules (pure functions, unit-tested)

| Rule | Logic | Examples |
|---|---|---|
| `hundreds` | `floor(int(leadingDigits) / 100)` | `MCB 512 → 5`, `BWY 1119 → 11`, `JJ 1401 → 14` |
| `floor_wing` | Leading 1–2 digits before a letter | `542 10A1 → 10`, `WTT 3A → 3`, `BCPLI 12D5 → 12` |
| `first_digit` | First digit of core | `BR531 41 → 4`, `BRKDR 22 → 2` |
| `floor_suite_letter` | Core is `[floor][suite][letter]`. Two digits + letter → first digit is floor. **One digit + letter → floor 1.** | `47C 21A → 2`, `538 31B → 3`, `47C 2A → 1` ⚠️ |
| `front_rear` | `[digit][F\|R]` → digit; `G…` → Ground | `BR604 3R → 3`, `BR548 G1 → Ground` |
| `first_digit_b_garden` | `first_digit`; core starting `B` → Garden (grouped with floor 1) | `BR536 B11 → 1 (garden)`, `BR536 41 → 4` |
| `hundreds_mezz` | `hundreds`; core starting `M` or matching `\dM` → Mezzanine | `CAR M01 → Mezz`, `HMY 1M03 → Mezz` |
| `hundreds_townhouse` | `hundreds`; core starting `H` → Townhouse | `EC H1003A → Townhouse`, `EC 1401A → 14` |

Floors are a union type: `number | 'Ground' | 'Mezzanine' | 'Townhouse'`. Section ordering: Lobby/custom-top sections first, then numeric floors **descending**, then Mezzanine near its neighbor floor, Ground/Garden last (configurable in the blueprint).

### 5.3 Suffix tags

Normalize known tags (case-insensitive, typo-tolerant): `RA` (incl. source typo `RAr`), `SIC`, `FSL`, `RHD` (`RHDr`), `AD` (`ADr`), `GHD`, `FIR` (`FIRr`), `Male/Female/MALE/FEMALE` → `gender`. Tags become filterable attributes and are usable as predicates in field rules ("all RA rooms → Door Type: RA Room").

### 5.4 Required unit tests (ground truth, verified against the master occupancy file)

```
MCB 512-1        → McBain, floor 5
BWY 1119-1 RA    → Broadway, floor 11, tags [RA]
47C 21A-1        → 47 Claremont, floor 2      // NOT floor 21
47C 2A-1         → 47 Claremont, floor 1      // floor digit omitted on 1st
538 21A-1 RA     → 538 West 114, floor 2, tags [RA]
542 10A1-1       → 542 West 112, floor 10
BR542 22-1 SIC   → 542 West 114, floor 2, tags [SIC]   // BR542 beats 542 (longest match)
BR548 G1-1       → 548 West 113, Ground
BR604 3R-2       → 604 West 114, floor 3
BR536 B11-1      → AXO - 536 West 114, floor 1 (garden)
CAR M01-2        → Carman, Mezzanine
HMY 1M03-1       → Harmony, Mezzanine
EC H1003A-1 FSL  → East Campus, Townhouse, tags [FSL]
EC 1401B-1       → East Campus, floor 14
EC 602/4-1       → East Campus, floor 6       // slash room
BC537 - 3C2-1    → 537 West 121, floor 3      // stray dash
611 101A-1       → 611 West 112, floor 1      // mixed formats within building
611 201-1        → 611 West 112, floor 2
CRL 2A1-1 RAr    → Carlton, floor 2, tags [RA]  // typo-normalized
WIN 342A-1       → Wien, floor 3
```

Every parse returns a **confidence**: `exact` (prefix + rule matched), `assumed` (prefix matched, core shape unusual), `unknown` (no prefix). The import review screen color-codes these; `unknown`/`assumed` rows require user confirmation before build.

---

## 6. Feature Spec

### 6.1 Import (three entry points)

1. **Spreadsheet / paste.** Accept .xlsx, .csv, or pasted rows. Auto-detect the room column (highest ratio of registry-prefix matches); user can override. Handles both layouts seen in real exports: grouped (building label in col A appears once per group) and flat two-column (`Summary Room Location Description` / `Summary Room Space Description`). Output: parsed room list with building, floor, tags, confidence.
2. **Existing Asana project URL.** Extract project GID from any Asana URL form (`/0/{gid}/…`, `/1/{ws}/project/{gid}`). Fetch full state (sections in order; tasks with name, completed, assignee, due_on, memberships, custom_fields; paginated, `limit=100`). This snapshot becomes the staging copy.
3. **Preset picker.** Choose building(s) from the registry — but since floors/rooms are never hardcoded, presets require a source: either "from master spreadsheet" (user uploads it once per session) or "from an existing project."

### 6.2 Blueprint editor

The staging model users manipulate before anything is applied:

- **Sections strategy:** by floor (default; descending, Lobby on top), by building (multi-building projects), by tag, single flat list, or fully custom. Drag to reorder; rename with templates (`{PREFIX} - {floor}{ord} Floor`).
- **Extra tasks:** e.g. "Building Door" task pinned in a Lobby section, with its own field overrides. Definable per section.
- **Field rule engine:** ordered list of rules `predicate → { field: value }`. Predicates: all tasks, floor =/range, section, name matches regex, has tag, building. Later rules override earlier. Example set replicating the reference script: `all → Door Access: Not Started`, `all → Door Type: Room Door`, `name == "BR627 - Building Door" → Door Type: Building Door`.
- **Field resolution:** when a target project is attached, fetch its `custom_field_settings`, resolve enum option GIDs by normalized name (trim, strip trailing `:`, case-insensitive). Unresolvable field/option → non-blocking warning chip on the rule, blocking error at apply time.

### 6.3 Preview

Pixel-faithful-ish Asana list view of the *result*: sections with headers, tasks with field chips, completion checkmarks, due dates. Toggle: **Result / Diff** (diff view badges every row: `+ create`, `→ move`, `± field`, `✓ complete`, `− delete`). Nothing is sent to Asana from this screen.

### 6.4 Diff & Execute

- `diff.ts` compares staging vs. live snapshot and emits an ordered mutation list: create sections → create tasks → move tasks → update fields/dates/completion → deletes last (deletes always require typed confirmation).
- Executor batches mutations through **`POST /batch` (10 actions/request)**; on 429, honor `Retry-After`. Free-tier limit ~150 req/min → batch gives ~1,500 mutations/min ceiling.
- **Manifest:** before applying, write `{ runId, mutations[], cursor }` to disk; update cursor as batches succeed. A crashed/stopped run resumes from cursor — idempotent by design (creates are checked against a re-fetch on resume).
- **Live feedback:** SSE stream → progress bar, per-mutation log lines, error list with retry buttons, final summary ("Created 2 sections, moved 41 tasks, updated 123 fields, 0 errors").
- **Snapshot & Undo:** every run stores the pre-apply snapshot. "Revert this run" computes and applies the inverse diff.

### 6.5 Mass-operations toolbox (the Asana-doesn't-have-this suite)

Operates on any imported project via the same staging→diff→apply pipeline:

- **Selection:** select all (no 50-task cap), by section, by floor, by building, by tag, by field value, by name regex, complete/incomplete, has/lacks due date or assignee; invert; saved selections.
- **One-click ops on selection:** mark incomplete/complete · clear due dates · cascade due dates (start date + per-floor/per-section step, top-down or bottom-up) · clear assignees · set/clear any custom field · move to section · rename (find/replace + template with `{floor}`, `{room}`, `{tags}`) · delete.
- **Project-level presets:** **Reset Project** (all incomplete + clear dues + reset chosen fields to defaults — the "new semester" button, with a summary confirm) · **Re-sectionize by floor** (retrofit a flat legacy project using the parser) · **Normalize section order** · **Export snapshot to .xlsx**.
- **Registry-aware audits:** flag task names that don't parse (typos), duplicate rooms, and — when a master room list is loaded — missing rooms per floor.

---

## 7. Asana API Notes (hard-won specifics)

- Task fetch opt_fields: `name,completed,assignee,due_on,resource_subtype,memberships.project.gid,memberships.section.gid,memberships.section.name,custom_fields`. Skip `resource_subtype ∈ {section, milestone}` when treating tasks as rooms.
- Section membership is set via `POST /sections/{gid}/addTask` (not on task create); custom fields via `PUT /tasks/{gid}` with `{ data: { custom_fields: { [fieldGid]: enumOptionGid | value } } }`.
- Enum fields need option **GIDs**, resolved per-project from `/projects/{gid}/custom_field_settings` — never assume option GIDs are stable across projects.
- Pagination: follow `next_page.uri` until null. Always `muteHttpExceptions`-style handling: parse error bodies, surface `errors[].message` in the log.
- Batch endpoint: `POST /batch` body `{ data: { actions: [{ method, relative_path, data }] } }`, max 10 actions; each action result has its own status code — treat partial failure per-action.

---

## 8. UI & Design System — "Columbia × Asana"

**Concept:** the institutional calm of Columbia's brand carrying a tool with Asana's operational clarity. Think facilities blueprint, not marketing site: a working document for people who manage buildings.

**Color tokens** (CSS variables, light theme first):

```css
--columbia:        #B9D9EB;  /* Columbia blue — headers, selection washes, section tints */
--columbia-deep:   #1D4F91;  /* deep collegiate blue — primary actions, active nav */
--ink:             #1E1F21;  /* Asana's near-black text */
--paper:           #FFFFFF;
--canvas:          #F7F9FB;  /* app background, faint blue-grey */
--line:            #E3E9EF;
--accent-coral:    #F06A6A;  /* Asana coral — RESERVED for destructive/apply moments and diff "change" badges */
--ok:              #58A182;  /* diff create / success */
--warn:            #E9B44C;  /* assumed-confidence rows */
```

**Type:** display/headers in a collegiate-leaning serif (e.g. *Source Serif 4* or *Lora*) used sparingly — page titles, building names, section headers. Everything operational (tables, chips, buttons, logs) in a clean grotesque (*Inter*). Room codes and logs in a mono (*JetBrains Mono*) — room names like `BWY 1119-1` are the atomic unit of this app and should always render in mono so codes scan like codes.

**Signature element:** the **building spine** — a slim vertical floor ladder rendered beside every project view (top floor at top, Lobby, Mezz, Ground marked), acting as both minimap and floor-filter. Clicking a rung selects that floor's tasks. It's drawn from parsed data, echoes an architectural elevation, and is the one flourish; everything else stays quiet.

**Layout:** Asana-style shell — left nav (Import / Blueprint / Preview / Operate / Runs), main pane is the list view, right side panel for task/rule details. Sticky bottom **action bar** appears when a selection exists: "142 selected — Mark incomplete · Clear due dates · Set field… · More ▾" (this bar IS the product; make it excellent). Section headers get a `--columbia` tint band. Diff badges: green +, coral ±, grey →.

**States & polish:** empty states instruct ("Paste an Asana project URL or drop a spreadsheet"); destructive ops use coral with typed confirmation; keyboard: `⌘A` select-all-in-view, `Esc` clear selection; visible focus rings; reduced-motion respected. Loading = skeleton rows, never spinners over blank space.

---

## 9. Milestones

1. **M1 — Core parse.** Registry + parser + full unit-test table (§5.4) green. CLI or dev page: paste rooms → parsed table.
2. **M2 — Import & Preview.** Spreadsheet/paste import with confidence review; Asana URL import via proxy; read-only Asana-style render with building spine.
3. **M3 — Blueprint & Build.** Sections strategy, field rule engine, diff view, batch executor with SSE progress, manifest resume. (Parity with the reference script, generalized.)
4. **M4 — Mass ops.** Selection engine + action bar + project presets (Reset, Re-sectionize, cascade dates) + snapshot/undo + xlsx export.
5. **M5 — Polish.** Registry editor UI, audits (missing/duplicate/typo rooms), run history page, error-retry UX.

---

## 10. Reference workflow being generalized

The existing Apps Script for one building (627 W 115) does, in order: fetch all project tasks (paginated) → parse floor from each name → resolve custom-field enum GIDs by name → create sections top-down (Lobby, then max→min floor, full range so empty floors still get sections) → create a "Building Door" task in Lobby with an overridden Door Type → move every task to its floor section → set Door Type/Door Access on every task → time-boxed with a resume trigger + per-building lock. Every one of those behaviors must be expressible in the Blueprint editor — that script is the acceptance test for M3.
