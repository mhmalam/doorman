import { create } from 'zustand';
import { floorSortKey, ParsedRoom, parseRoom } from './core/parser';
import { importRows, ImportResult } from './core/importers';
import {
  Blueprint, buildSections, contextForRoom, DEFAULT_BLUEPRINT, PRESET_DEFAULT_TEMPLATE,
  renderTemplate, SectionPreset,
} from './core/blueprint';

export interface AsanaSnapshot {
  project: { gid: string; name: string; permalink_url?: string };
  sections: Array<{ gid: string; name: string }>;
  /** The project's custom fields (for columns). */
  fields?: FieldDef[];
  tasks: Array<{
    gid: string;
    name: string;
    completed: boolean;
    due_on?: string | null;
    memberships?: Array<{ section?: { gid: string; name?: string } }>;
    custom_fields?: Array<{
      gid: string;
      enum_value?: { gid: string } | null;
      text_value?: string | null;
      number_value?: number | null;
    }>;
  }>;
}

/** What each Asana task/section looked like at the last sync — Apply pushes
 *  only what differs from this. */
export interface Baseline {
  /** Project name at last sync — title renames count as changes. */
  title?: string;
  tasks: Record<string, { sig: string; sectionGid: string | null }>;
  sections: Record<string, string>;
  /** Task-gid order per section at last sync — reorders count as changes. */
  sectionOrder?: Record<string, string[]>;
  /** Section-gid order at last sync — moving sections counts as a change. */
  projectSectionOrder?: string[];
}

/** Change-detection signature for a task's pushable state. */
export function taskSig(t: Pick<StagedTask, 'name' | 'completed' | 'due' | 'fields'>): string {
  return JSON.stringify({
    n: t.name,
    c: !!t.completed,
    d: t.due ?? null,
    f: Object.entries(t.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
}

/** Mirror an Asana snapshot into staging: its sections, its order, its values. */
function snapshotToStaging(snapshot: AsanaSnapshot): StagedSection[] {
  const sections = snapshot.sections.map(s => ({
    gid: s.gid,
    section: { id: uid('s'), name: s.name, tasks: [] as StagedTask[], asanaGid: s.gid },
  }));
  const byGid = new Map(sections.map(s => [s.gid, s.section]));
  const orphans: StagedTask[] = [];
  for (const t of snapshot.tasks) {
    const fields: Record<string, string | number> = {};
    for (const f of t.custom_fields ?? []) {
      if (f.enum_value?.gid) fields[f.gid] = f.enum_value.gid;
      else if (f.text_value != null && f.text_value !== '') fields[f.gid] = f.text_value;
      else if (f.number_value != null) fields[f.gid] = f.number_value;
    }
    const task: StagedTask = {
      id: uid('t'),
      name: t.name,
      room: parseRoom(t.name),
      completed: t.completed || undefined,
      due: t.due_on ?? undefined,
      fields: Object.keys(fields).length ? fields : undefined,
      asanaGid: t.gid,
    };
    const sectionGid = t.memberships?.find(m => m.section)?.section?.gid;
    const home = sectionGid ? byGid.get(sectionGid) : undefined;
    (home ? home.tasks : orphans).push(task);
  }
  const staging: StagedSection[] = sections.map(s => s.section);
  if (orphans.length) staging.push({ id: uid('s'), name: 'Untitled section', tasks: orphans });
  return staging;
}

/** Mirror the project's Asana fields into the columns: new fields appear
 *  (before Due date), definitions refresh, and fields removed on the Asana
 *  side disappear. Built-in columns (Floor, Due date) are untouched. */
function mergeSnapshotFields(
  snapshot: AsanaSnapshot,
  columns: ColumnId[],
  fieldDefs: Record<string, FieldDef>,
): { columns: ColumnId[]; fieldDefs: Record<string, FieldDef> } {
  const defs = { ...fieldDefs };
  let cols = [...columns];
  for (const field of snapshot.fields ?? []) {
    defs[field.gid] = field;
    const id = `f:${field.gid}`;
    if (!cols.includes(id)) {
      const dueIdx = cols.indexOf('due');
      if (dueIdx >= 0) cols.splice(dueIdx, 0, id);
      else cols.push(id);
    }
  }
  if (snapshot.fields) {
    const onProject = new Set(snapshot.fields.map(f => `f:${f.gid}`));
    cols = cols.filter(c => !c.startsWith('f:') || onProject.has(c));
  }
  return { columns: cols, fieldDefs: defs };
}

function snapshotBaseline(staging: StagedSection[], title: string): Baseline {
  const baseline: Baseline = {
    title,
    tasks: {},
    sections: {},
    sectionOrder: {},
    projectSectionOrder: staging.map(s => s.asanaGid).filter(Boolean) as string[],
  };
  for (const s of staging) {
    if (s.asanaGid) {
      baseline.sections[s.asanaGid] = s.name;
      baseline.sectionOrder![s.asanaGid] = s.tasks
        .map(t => t.asanaGid)
        .filter(Boolean) as string[];
    }
    for (const t of s.tasks) {
      if (t.asanaGid) baseline.tasks[t.asanaGid] = { sig: taskSig(t), sectionGid: s.asanaGid ?? null };
    }
  }
  return baseline;
}

export interface FieldOption {
  gid: string;
  name: string;
  color?: string;
}

export interface FieldDef {
  gid: string;
  name: string;
  /** Asana resource_subtype: enum, multi_enum, text, number, date, people. */
  type: string;
  enum_options?: FieldOption[];
}

/**
 * Column ids: 'floor', 'due', or 'f:<fieldGid>'. Name is always first and not
 * part of this list. Columns are orderable, resizable, and removable.
 */
export type ColumnId = string;

// New projects start with just Due date — Floor is added from the "+" picker.
export const DEFAULT_COLUMNS: ColumnId[] = ['due'];
export const DEFAULT_WIDTHS: Record<string, number> = { floor: 130, due: 130 };
export const DEFAULT_FIELD_WIDTH = 150;
export const MIN_COL_WIDTH = 70;
export const MAX_COL_WIDTH = 480;

export interface StagedTask {
  id: string;
  name: string;
  room: ParsedRoom;
  isCustom?: boolean;
  completed?: boolean;
  /** YYYY-MM-DD */
  due?: string;
  /** fieldGid → enum option gid | text | number. */
  fields?: Record<string, string | number>;
  /** Set when this task exists in the linked Asana project. */
  asanaGid?: string;
}

export interface StagedSection {
  id: string;
  name: string;
  review?: boolean;
  tasks: StagedTask[];
  /** Set when this section exists in the linked Asana project. */
  asanaGid?: string;
}

export interface SavedProjectMeta {
  id: string;
  title: string;
  savedAt: number;
}

interface SavedProject extends SavedProjectMeta {
  sourceKind: 'file' | 'asana' | null;
  sourceName: string | null;
  blueprint: Blueprint;
  staging: StagedSection[];
  columns: ColumnId[];
  widths: Record<ColumnId, number>;
  fieldDefs: Record<string, FieldDef>;
  templates?: { floor: string; building: string };
  linkedProjectGid?: string | null;
  linkedProjectUrl?: string | null;
  deletedTaskGids?: string[];
  deletedSectionGids?: string[];
  baseline?: Baseline | null;
  // legacy (pre-column-model) saves:
  fieldColumns?: FieldDef[];
  showFloor?: boolean;
}

let nextId = 1;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${nextId++}`;

function toStaging(rooms: ParsedRoom[], bp: Blueprint): StagedSection[] {
  return buildSections(rooms, bp).map(s => ({
    id: uid('s'),
    name: s.label,
    review: s.review,
    tasks: s.rooms.map(r => ({ id: uid('t'), name: r.raw.trim(), room: r })),
  }));
}

export type SectionSortMode = 'name-asc' | 'name-desc' | 'floor-desc' | 'floor-asc';
export type SplitPreset = Exclude<SectionPreset, 'none'>;

/** Group existing tasks (keeping their fields/due/completion) into new sections. */
export function groupTasksForSplit(
  tasks: StagedTask[],
  preset: SplitPreset,
  template: string,
): Array<{ name: string; tasks: StagedTask[] }> {
  const byFloor = preset === 'floor-desc' || preset === 'floor-asc';
  const map = new Map<string, { name: string; tasks: StagedTask[] }>();
  for (const task of tasks) {
    const room = task.room;
    let key: string;
    let name: string;
    if (!room.building) {
      key = '!review';
      name = 'Needs review';
    } else if (byFloor) {
      key = `${room.building.prefix}|${room.floor ?? '!'}`;
      name =
        room.floor === null
          ? `${room.building.prefix} - Needs review`
          : renderTemplate(template, contextForRoom(room, preset)) || 'Untitled section';
    } else {
      key = room.building.prefix;
      name = renderTemplate(template, contextForRoom(room, preset)) || 'Untitled section';
    }
    let g = map.get(key);
    if (!g) {
      g = { name, tasks: [] };
      map.set(key, g);
    }
    g.tasks.push(task);
  }
  return [...map.entries()]
    .sort(([ka, a], [kb, b]) => {
      if (ka === '!review') return 1;
      if (kb === '!review') return -1;
      const an = a.tasks[0].room.building?.name ?? '';
      const bn = b.tasks[0].room.building?.name ?? '';
      if (an !== bn) return an.localeCompare(bn);
      if (!byFloor) return 0;
      const af = a.tasks[0].room.floor;
      const bf = b.tasks[0].room.floor;
      if (af === null) return 1;
      if (bf === null) return -1;
      const cmp = floorSortKey(af) - floorSortKey(bf);
      return preset === 'floor-asc' ? -cmp : cmp;
    })
    .map(([, g]) => g);
}

// ---------------------------------------------------------------------------
// Local persistence ("database later" — localStorage for now, auto-saved)
// ---------------------------------------------------------------------------

const STORE_KEY = 'doorman.projects.v1';

function readSaved(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as SavedProject[]) : [];
  } catch {
    return [];
  }
}

function writeSaved(projects: SavedProject[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(projects));
  } catch (err) {
    console.warn('Doorman: auto-save skipped', err);
  }
}

/** Legacy saves stored fieldColumns/showFloor instead of the column model. */
function migrateColumns(p: SavedProject): Pick<SavedProject, 'columns' | 'widths' | 'fieldDefs'> {
  if (p.columns) return { columns: p.columns, widths: p.widths ?? {}, fieldDefs: p.fieldDefs ?? {} };
  const columns: ColumnId[] = [];
  if (p.showFloor ?? true) columns.push('floor');
  const fieldDefs: Record<string, FieldDef> = {};
  for (const f of p.fieldColumns ?? []) {
    columns.push(`f:${f.gid}`);
    fieldDefs[f.gid] = f;
  }
  columns.push('due');
  return { columns, widths: {}, fieldDefs };
}

// ---------------------------------------------------------------------------

interface DoormanState {
  currentId: string | null;
  title: string;
  sourceKind: 'file' | 'asana' | null;
  sourceName: string | null;
  sourceRows: unknown[][] | null;
  snapshot: AsanaSnapshot | null;
  importResult: ImportResult | null;

  blueprint: Blueprint;
  staging: StagedSection[] | null;
  columns: ColumnId[];
  widths: Record<ColumnId, number>;
  fieldDefs: Record<string, FieldDef>;
  /** User's section-name templates, remembered per grouping kind. */
  templates: { floor: string; building: string };
  /** Asana project this staging is linked to (imported from, or created as). */
  linkedProjectGid: string | null;
  linkedProjectUrl: string | null;
  /** Asana gids deleted locally — removed from Asana on the next Apply. */
  deletedTaskGids: string[];
  deletedSectionGids: string[];
  /** State at last sync; Apply pushes only differences from this. */
  baseline: Baseline | null;
  /** A build/apply run in flight (progress shown in the RunTray). */
  activeRun: { runId: string; mode: 'create' | 'apply' } | null;
  setActiveRun: (run: { runId: string; mode: 'create' | 'apply' } | null) => void;
  /** Snapshot to restore if the user hits Undo after a delete. */
  pendingUndo: {
    label: string;
    staging: StagedSection[];
    deletedTaskGids: string[];
    deletedSectionGids: string[];
  } | null;

  savedList: SavedProjectMeta[];

  /** Transient confirmation message; auto-dismissed by the Toast component. */
  toast: string | null;
  setToast: (toast: string | null) => void;

  setTitle: (title: string) => void;
  setPreset: (preset: SectionPreset) => void;
  setTemplate: (template: string) => void;

  loadFile: (rows: unknown[][], name: string) => void;
  loadAsana: (snapshot: AsanaSnapshot) => void;
  /** Replace staging with a fresh pull of the linked Asana project. */
  syncFromAsana: (snapshot: AsanaSnapshot) => void;
  /** Link this staging to an Asana project (set after Create in Asana). */
  setLinkedProject: (gid: string, url?: string) => void;
  setRoomColumn: (column: number) => void;

  newProject: () => void;
  /** Start an empty project (no spreadsheet — add rooms later). */
  newBlankProject: () => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;

  addTask: (sectionId: string, name: string) => void;
  addTasksBulk: (sectionId: string, names: string[]) => void;
  renameTask: (taskId: string, name: string) => void;
  deleteTasks: (taskIds: string[]) => void;
  /** Delete immediately, offering a 10-second Undo (UndoToast). */
  deleteTasksWithUndo: (taskIds: string[]) => void;
  undoDelete: () => void;
  clearUndo: () => void;
  /** Insert copies right after the originals (new tasks, not yet in Asana). */
  duplicateTasks: (taskIds: string[]) => void;
  moveTask: (taskId: string, toSectionId: string, toIndex: number) => void;
  toggleComplete: (taskId: string) => void;
  setCompleted: (taskIds: string[], completed: boolean) => void;
  setTaskField: (taskIds: string[], fieldGid: string, value: string | number | null) => void;
  setTaskDue: (taskIds: string[], due: string | null) => void;

  renameSection: (sectionId: string, name: string) => void;
  addSection: (name: string, index?: number) => string;
  moveSection: (sectionId: string, toIndex: number) => void;
  deleteSection: (sectionId: string) => void;
  deleteSectionKeepTasks: (sectionId: string) => void;
  /** Reorder tasks inside one section (one-time, mutates staging order). */
  sortSection: (sectionId: string, mode: SectionSortMode) => void;
  /** Replace one section with new sections grouped from its own tasks. */
  splitSection: (sectionId: string, preset: SplitPreset, template: string) => void;

  addFieldColumn: (field: FieldDef) => void;
  addBuiltinColumn: (id: 'floor' | 'due') => void;
  removeColumn: (id: ColumnId) => void;
  moveColumn: (id: ColumnId, toIndex: number) => void;
  setColumnWidth: (id: ColumnId, width: number) => void;
}

const savedMeta = (): SavedProjectMeta[] =>
  readSaved().map(p => ({ id: p.id, title: p.title, savedAt: p.savedAt }));

/**
 * Give new groupings the EXISTING Asana sections where possible (matched by
 * name first, then by position) — regrouping renames/moves sections in Asana
 * instead of deleting and recreating them. Only truly-leftover sections
 * (empty after the moves) are queued for removal. Tasks are never deleted
 * here — they keep their Asana identity and just move.
 */
function reuseSectionGids(
  groups: Array<{ name: string; tasks: StagedTask[] }>,
  oldSections: StagedSection[],
): { sections: StagedSection[]; leftover: string[] } {
  const available = oldSections
    .filter(s => s.asanaGid)
    .map(s => ({ gid: s.asanaGid!, name: s.name, used: false }));
  const assigned: Array<string | undefined> = groups.map(g => {
    const match = available.find(a => !a.used && a.name === g.name);
    if (match) {
      match.used = true;
      return match.gid;
    }
    return undefined;
  });
  groups.forEach((_, i) => {
    if (assigned[i] === undefined) {
      const next = available.find(a => !a.used);
      if (next) {
        next.used = true;
        assigned[i] = next.gid;
      }
    }
  });
  return {
    sections: groups.map((g, i) => ({
      id: uid('s'),
      name: g.name,
      tasks: g.tasks,
      asanaGid: assigned[i],
    })),
    leftover: available.filter(a => !a.used).map(a => a.gid),
  };
}

/**
 * Regroup for preset/template changes. Rebuilds from the STAGED TASKS (not the
 * raw import) so Asana gids, field values, due dates, and completion survive.
 */
function regroup(
  state: Pick<DoormanState, 'staging' | 'importResult' | 'deletedSectionGids'>,
  blueprint: Blueprint,
): Partial<Pick<DoormanState, 'staging' | 'deletedSectionGids'>> {
  if (state.staging) {
    const tasks = state.staging.flatMap(s => s.tasks);
    const groups =
      blueprint.preset === 'none'
        ? [{ name: 'Untitled section', tasks }]
        : groupTasksForSplit(tasks, blueprint.preset, blueprint.template);
    const { sections, leftover } = reuseSectionGids(groups, state.staging);
    return {
      staging: sections,
      deletedSectionGids: [...state.deletedSectionGids, ...leftover],
    };
  }
  if (state.importResult) return { staging: toStaging(state.importResult.rooms, blueprint) };
  return {};
}

function mapTasks(
  staging: StagedSection[] | null,
  ids: string[],
  fn: (t: StagedTask) => StagedTask,
): StagedSection[] | null {
  if (!staging) return null;
  const idSet = new Set(ids);
  return staging.map(s => ({
    ...s,
    tasks: s.tasks.map(t => (idSet.has(t.id) ? fn(t) : t)),
  }));
}

const DEFAULT_TEMPLATES = {
  floor: PRESET_DEFAULT_TEMPLATE['floor-desc'],
  building: PRESET_DEFAULT_TEMPLATE.building,
};

/** Which remembered template a preset uses. */
const templateKind = (preset: SectionPreset): 'floor' | 'building' =>
  preset === 'building' ? 'building' : 'floor';

const EMPTY_PROJECT = {
  currentId: null as string | null,
  title: '',
  sourceKind: null as 'file' | 'asana' | null,
  sourceName: null as string | null,
  sourceRows: null as unknown[][] | null,
  snapshot: null as AsanaSnapshot | null,
  importResult: null as ImportResult | null,
  staging: null as StagedSection[] | null,
  columns: DEFAULT_COLUMNS,
  widths: {} as Record<ColumnId, number>,
  fieldDefs: {} as Record<string, FieldDef>,
  templates: { ...DEFAULT_TEMPLATES },
  linkedProjectGid: null as string | null,
  linkedProjectUrl: null as string | null,
  deletedTaskGids: [] as string[],
  deletedSectionGids: [] as string[],
  baseline: null as Baseline | null,
  blueprint: DEFAULT_BLUEPRINT,
};

export const useStore = create<DoormanState>(set => ({
  ...EMPTY_PROJECT,
  savedList: savedMeta(),

  toast: null,
  setToast: toast => set({ toast }),

  activeRun: null,
  setActiveRun: activeRun => set({ activeRun }),
  pendingUndo: null,

  setTitle: title => set({ title }),

  // Switching presets keeps the user's template (remembered per grouping kind)
  // instead of resetting it to the default.
  setPreset: preset =>
    set(state => {
      const template =
        preset === 'none' ? PRESET_DEFAULT_TEMPLATE.none : state.templates[templateKind(preset)];
      const blueprint = { preset, template };
      return { blueprint, ...regroup(state, blueprint) };
    }),
  setTemplate: template =>
    set(state => {
      const blueprint = { ...state.blueprint, template };
      const templates =
        state.blueprint.preset === 'none'
          ? state.templates
          : { ...state.templates, [templateKind(state.blueprint.preset)]: template };
      return { blueprint, templates, ...regroup(state, blueprint) };
    }),

  loadFile: (rows, name) =>
    set(state => {
      const importResult = importRows(rows);
      return {
        ...EMPTY_PROJECT,
        currentId: uid('p'),
        title: name.replace(/\.(xlsx|xls|csv)$/i, ''),
        sourceKind: 'file',
        sourceName: name,
        sourceRows: rows,
        importResult,
        blueprint: state.blueprint,
        staging: toStaging(importResult.rooms, state.blueprint),
        toast: `Imported ${importResult.rooms.length.toLocaleString()} rooms from ${name}`,
      };
    }),

  // Importing from Asana mirrors the project as-is: its sections, its order,
  // completion, due dates, and field values.
  loadAsana: snapshot =>
    set(() => {
      const staging = snapshotToStaging(snapshot);
      const rooms = snapshot.tasks.map(t => parseRoom(t.name));
      const importResult: ImportResult = {
        rooms,
        column: 0,
        matchRatio: rooms.length ? rooms.filter(r => r.building).length / rooms.length : 0,
        skipped: [],
      };
      return {
        ...EMPTY_PROJECT,
        currentId: uid('p'),
        title: snapshot.project.name,
        sourceKind: 'asana',
        sourceName: snapshot.project.name,
        snapshot,
        importResult,
        linkedProjectGid: snapshot.project.gid,
        linkedProjectUrl: snapshot.project.permalink_url ?? null,
        staging,
        baseline: snapshotBaseline(staging, snapshot.project.name),
        ...mergeSnapshotFields(snapshot, DEFAULT_COLUMNS, {}),
        toast: `Imported "${snapshot.project.name}" from Asana`,
      };
    }),

  syncFromAsana: snapshot =>
    set(state => {
      const staging = snapshotToStaging(snapshot);
      const rooms = snapshot.tasks.map(t => parseRoom(t.name));
      return {
        ...mergeSnapshotFields(snapshot, state.columns, state.fieldDefs),
        title: snapshot.project.name,
        snapshot,
        linkedProjectGid: snapshot.project.gid,
        linkedProjectUrl: snapshot.project.permalink_url ?? null,
        importResult: {
          rooms,
          column: 0,
          matchRatio: rooms.length ? rooms.filter(r => r.building).length / rooms.length : 0,
          skipped: [],
        },
        staging,
        baseline: snapshotBaseline(staging, snapshot.project.name),
        deletedTaskGids: [],
        deletedSectionGids: [],
        toast: 'Synced from Asana',
      };
    }),

  setLinkedProject: (gid, url) =>
    set(state => ({ linkedProjectGid: gid, linkedProjectUrl: url ?? state.linkedProjectUrl })),

  setRoomColumn: column =>
    set(state => {
      if (!state.sourceRows) return {};
      const importResult = importRows(state.sourceRows, undefined, column);
      return { importResult, staging: toStaging(importResult.rooms, state.blueprint) };
    }),

  newProject: () => set({ ...EMPTY_PROJECT }),

  newBlankProject: () =>
    set({
      ...EMPTY_PROJECT,
      currentId: uid('p'),
      title: 'Untitled project',
      staging: [{ id: uid('s'), name: 'Untitled section', tasks: [] }],
    }),

  loadProject: id => {
    const project = readSaved().find(p => p.id === id);
    if (!project) return;
    markLoaded(project);
    set({
      ...EMPTY_PROJECT,
      currentId: project.id,
      title: project.title,
      sourceKind: project.sourceKind,
      sourceName: project.sourceName,
      blueprint: project.blueprint,
      staging: project.staging,
      templates: project.templates ?? { ...DEFAULT_TEMPLATES },
      linkedProjectGid: project.linkedProjectGid ?? null,
      linkedProjectUrl: project.linkedProjectUrl ?? null,
      deletedTaskGids: project.deletedTaskGids ?? [],
      deletedSectionGids: project.deletedSectionGids ?? [],
      baseline: project.baseline ?? null,
      ...migrateColumns(project),
    });
  },

  deleteProject: id => {
    writeSaved(readSaved().filter(p => p.id !== id));
    set(state => ({
      savedList: savedMeta(),
      ...(state.currentId === id ? { ...EMPTY_PROJECT } : {}),
    }));
  },

  addTask: (sectionId, name) =>
    set(state => ({
      staging: state.staging?.map(s =>
        s.id === sectionId
          ? { ...s, tasks: [...s.tasks, { id: uid('t'), name, room: parseRoom(name), isCustom: true }] }
          : s,
      ) ?? null,
    })),

  addTasksBulk: (sectionId, names) =>
    set(state => ({
      staging: state.staging?.map(s =>
        s.id === sectionId
          ? {
              ...s,
              tasks: [
                ...s.tasks,
                ...names.map(name => ({ id: uid('t'), name, room: parseRoom(name) })),
              ],
            }
          : s,
      ) ?? null,
      toast: `Added ${names.length.toLocaleString()} room${names.length === 1 ? '' : 's'}`,
    })),

  renameTask: (taskId, name) =>
    set(state => ({
      staging: mapTasks(state.staging, [taskId], t => ({ ...t, name, room: parseRoom(name) })),
    })),

  deleteTasks: taskIds =>
    set(state => {
      const ids = new Set(taskIds);
      const gone: string[] = [];
      state.staging?.forEach(s =>
        s.tasks.forEach(t => {
          if (ids.has(t.id) && t.asanaGid) gone.push(t.asanaGid);
        }),
      );
      return {
        staging: state.staging?.map(s => ({ ...s, tasks: s.tasks.filter(t => !ids.has(t.id)) })) ?? null,
        deletedTaskGids: [...state.deletedTaskGids, ...gone],
      };
    }),

  deleteTasksWithUndo: taskIds =>
    set(state => {
      if (!state.staging) return {};
      const ids = new Set(taskIds);
      const doomed = state.staging.flatMap(s => s.tasks.filter(t => ids.has(t.id)));
      if (!doomed.length) return {};
      const gone = doomed.map(t => t.asanaGid).filter(Boolean) as string[];
      return {
        pendingUndo: {
          label:
            doomed.length === 1 ? `Deleted "${doomed[0].name}"` : `Deleted ${doomed.length} tasks`,
          staging: state.staging,
          deletedTaskGids: state.deletedTaskGids,
          deletedSectionGids: state.deletedSectionGids,
        },
        staging: state.staging.map(s => ({ ...s, tasks: s.tasks.filter(t => !ids.has(t.id)) })),
        deletedTaskGids: [...state.deletedTaskGids, ...gone],
      };
    }),

  undoDelete: () =>
    set(state =>
      state.pendingUndo
        ? {
            staging: state.pendingUndo.staging,
            deletedTaskGids: state.pendingUndo.deletedTaskGids,
            deletedSectionGids: state.pendingUndo.deletedSectionGids,
            pendingUndo: null,
          }
        : {},
    ),

  clearUndo: () => set({ pendingUndo: null }),

  duplicateTasks: taskIds =>
    set(state => {
      const ids = new Set(taskIds);
      return {
        staging: state.staging?.map(s => {
          if (!s.tasks.some(t => ids.has(t.id))) return s;
          const tasks: StagedTask[] = [];
          for (const t of s.tasks) {
            tasks.push(t);
            if (ids.has(t.id)) {
              tasks.push({
                ...t,
                id: uid('t'),
                asanaGid: undefined,
                completed: undefined,
                isCustom: true,
                fields: t.fields ? { ...t.fields } : undefined,
              });
            }
          }
          return { ...s, tasks };
        }) ?? null,
      };
    }),

  moveTask: (taskId, toSectionId, toIndex) =>
    set(state => {
      if (!state.staging) return {};
      let moved: StagedTask | undefined;
      let fromSection = -1;
      let fromIndex = -1;
      state.staging.forEach((s, si) => {
        const ti = s.tasks.findIndex(t => t.id === taskId);
        if (ti >= 0) {
          fromSection = si;
          fromIndex = ti;
          moved = s.tasks[ti];
        }
      });
      if (!moved) return {};
      const staging = state.staging.map(s => ({ ...s, tasks: [...s.tasks] }));
      staging[fromSection].tasks.splice(fromIndex, 1);
      const target = staging.find(s => s.id === toSectionId);
      if (!target) return {};
      let idx = toIndex;
      if (staging[fromSection].id === toSectionId && fromIndex < toIndex) idx--;
      idx = Math.max(0, Math.min(idx, target.tasks.length));
      target.tasks.splice(idx, 0, moved);
      return { staging };
    }),

  toggleComplete: taskId =>
    set(state => ({
      staging: mapTasks(state.staging, [taskId], t => ({ ...t, completed: !t.completed })),
    })),

  setCompleted: (taskIds, completed) =>
    set(state => ({
      staging: mapTasks(state.staging, taskIds, t => ({ ...t, completed })),
    })),

  setTaskField: (taskIds, fieldGid, value) =>
    set(state => ({
      staging: mapTasks(state.staging, taskIds, t => {
        const fields = { ...t.fields };
        if (value === null || value === '') delete fields[fieldGid];
        else fields[fieldGid] = value;
        return { ...t, fields };
      }),
    })),

  setTaskDue: (taskIds, due) =>
    set(state => ({
      staging: mapTasks(state.staging, taskIds, t => ({ ...t, due: due ?? undefined })),
    })),

  renameSection: (sectionId, name) =>
    set(state => ({
      staging: state.staging?.map(s => (s.id === sectionId ? { ...s, name } : s)) ?? null,
    })),

  addSection: (name, index) => {
    const id = uid('s');
    set(state => {
      if (!state.staging) return {};
      const staging = [...state.staging];
      staging.splice(index ?? staging.length, 0, { id, name, tasks: [] });
      return { staging };
    });
    return id;
  },

  moveSection: (sectionId, toIndex) =>
    set(state => {
      if (!state.staging) return {};
      const fromIndex = state.staging.findIndex(s => s.id === sectionId);
      if (fromIndex < 0) return {};
      const staging = [...state.staging];
      const [section] = staging.splice(fromIndex, 1);
      let idx = toIndex;
      if (fromIndex < toIndex) idx--;
      idx = Math.max(0, Math.min(idx, staging.length));
      staging.splice(idx, 0, section);
      return { staging };
    }),

  deleteSection: sectionId =>
    set(state => {
      const doomed = state.staging?.find(s => s.id === sectionId);
      return {
        staging: state.staging?.filter(s => s.id !== sectionId) ?? null,
        deletedTaskGids: [
          ...state.deletedTaskGids,
          ...(doomed?.tasks.map(t => t.asanaGid).filter(Boolean) as string[] ?? []),
        ],
        deletedSectionGids: doomed?.asanaGid
          ? [...state.deletedSectionGids, doomed.asanaGid]
          : state.deletedSectionGids,
      };
    }),

  deleteSectionKeepTasks: sectionId =>
    set(state => {
      if (!state.staging) return {};
      const index = state.staging.findIndex(s => s.id === sectionId);
      if (index < 0) return {};
      const doomed = state.staging[index];
      const deletedSectionGids = doomed.asanaGid
        ? [...state.deletedSectionGids, doomed.asanaGid]
        : state.deletedSectionGids;
      const staging = state.staging.filter(s => s.id !== sectionId);
      const untitled = staging.find(s => s.name === 'Untitled section');
      if (untitled) {
        return {
          staging: staging.map(s =>
            s.id === untitled.id ? { ...s, tasks: [...s.tasks, ...doomed.tasks] } : s,
          ),
          deletedSectionGids,
        };
      }
      staging.splice(Math.min(index, staging.length), 0, {
        id: uid('s'),
        name: 'Untitled section',
        tasks: [...doomed.tasks],
      });
      return { staging, deletedSectionGids };
    }),

  sortSection: (sectionId, mode) =>
    set(state => ({
      staging: state.staging?.map(s => {
        if (s.id !== sectionId) return s;
        const dir = mode.endsWith('asc') ? 1 : -1;
        const tasks = [...s.tasks].sort((a, b) => {
          if (mode.startsWith('name')) {
            return dir * a.name.localeCompare(b.name, undefined, { numeric: true });
          }
          const af = a.room.floor;
          const bf = b.room.floor;
          if (af === null && bf === null) return 0;
          if (af === null) return 1;
          if (bf === null) return -1;
          const cmp = floorSortKey(af) - floorSortKey(bf);
          return mode === 'floor-asc' ? -cmp : cmp;
        });
        return { ...s, tasks };
      }) ?? null,
    })),

  splitSection: (sectionId, preset, template) =>
    set(state => {
      if (!state.staging) return {};
      const index = state.staging.findIndex(s => s.id === sectionId);
      if (index < 0) return {};
      const replaced = state.staging[index];
      // The split's first group inherits the existing Asana section (renamed
      // in place) rather than deleting and recreating it.
      const { sections, leftover } = reuseSectionGids(
        groupTasksForSplit(replaced.tasks, preset, template),
        [replaced],
      );
      const staging = [...state.staging];
      staging.splice(index, 1, ...sections);
      return {
        staging,
        deletedSectionGids: [...state.deletedSectionGids, ...leftover],
      };
    }),

  addFieldColumn: field =>
    set(state => {
      const id = `f:${field.gid}`;
      if (state.columns.includes(id)) return {};
      return {
        columns: [...state.columns, id],
        fieldDefs: { ...state.fieldDefs, [field.gid]: field },
      };
    }),

  addBuiltinColumn: id =>
    set(state => (state.columns.includes(id) ? {} : { columns: [...state.columns, id] })),

  removeColumn: id =>
    set(state => ({ columns: state.columns.filter(c => c !== id) })),

  moveColumn: (id, toIndex) =>
    set(state => {
      const fromIndex = state.columns.indexOf(id);
      if (fromIndex < 0) return {};
      const columns = [...state.columns];
      columns.splice(fromIndex, 1);
      let idx = toIndex;
      if (fromIndex < toIndex) idx--;
      idx = Math.max(0, Math.min(idx, columns.length));
      columns.splice(idx, 0, id);
      return { columns };
    }),

  setColumnWidth: (id, width) =>
    set(state => ({
      widths: {
        ...state.widths,
        [id]: Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(width))),
      },
    })),
}));

// ---------------------------------------------------------------------------
// Auto-save
// ---------------------------------------------------------------------------

let lastSavedJson = '';

function markLoaded(project: SavedProject) {
  lastSavedJson = JSON.stringify({ ...project, savedAt: 0 });
}

function persistNow() {
  const s = useStore.getState();
  if (!s.currentId || !s.staging) return;
  const project: SavedProject = {
    id: s.currentId,
    title: s.title || 'Untitled project',
    savedAt: Date.now(),
    sourceKind: s.sourceKind,
    sourceName: s.sourceName,
    blueprint: s.blueprint,
    staging: s.staging,
    columns: s.columns,
    widths: s.widths,
    fieldDefs: s.fieldDefs,
    templates: s.templates,
    linkedProjectGid: s.linkedProjectGid,
    linkedProjectUrl: s.linkedProjectUrl,
    deletedTaskGids: s.deletedTaskGids,
    deletedSectionGids: s.deletedSectionGids,
    baseline: s.baseline,
  };
  const json = JSON.stringify({ ...project, savedAt: 0 });
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  const rest = readSaved().filter(p => p.id !== project.id);
  writeSaved([project, ...rest]);
  useStore.setState({ savedList: savedMeta() });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 600);
});

/** Rooms from the current import, or [] if nothing loaded. */
export function useRooms(): ParsedRoom[] {
  return useStore(s => s.importResult?.rooms ?? []);
}

