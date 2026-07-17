// Asana dark list view — the fully editable staging area.
// Columns (Floor, Due date, custom fields) are orderable, resizable, removable.
// Multi-select: click / ctrl+click / shift+click / drag across rows / section
// checkbox / Ctrl+A — and cell edits apply to the whole selection.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { floorLabel } from '../core/parser';
import {
  ColumnId, DEFAULT_FIELD_WIDTH, DEFAULT_WIDTHS, StagedSection, StagedTask, useStore,
} from '../store';
import { CustomizePanel } from './CustomizePanel';
import { ApplyModal } from './ApplyModal';
import { InsertRoomsModal } from './InsertRoomsModal';
import { DueCell, FieldCell, FieldsPicker, PILL_COLORS } from './fields';
import { Checkbox } from './Checkbox';
import {
  Caret, CheckCircle, ChevronDown, Grip, ListGlyph, XIcon,
} from './icons';

type Panel = 'customize' | null;

type Drag = { type: 'task' | 'section'; id: string } | null;
type DropHint = { sectionId: string; index: number } | null;

const colWidth = (widths: Record<string, number>, id: ColumnId) =>
  widths[id] ?? DEFAULT_WIDTHS[id] ?? DEFAULT_FIELD_WIDTH;

export function AsanaProject() {
  const staging = useStore(s => s.staging) ?? [];
  const title = useStore(s => s.title);
  const setTitle = useStore(s => s.setTitle);
  const columns = useStore(s => s.columns);
  const widths = useStore(s => s.widths);
  const fieldDefs = useStore(s => s.fieldDefs);
  const {
    addTask, renameTask, deleteTasksWithUndo, duplicateTasks, moveTask, toggleComplete, setCompleted, setTaskDue,
    renameSection, addSection, moveSection, deleteSection, deleteSectionKeepTasks,
    moveColumn, removeColumn, setColumnWidth,
  } = useStore();

  const deleteWithUndo = (ids: string[]) => {
    deleteTasksWithUndo(ids);
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<'add' | 'fields' | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [composer, setComposer] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StagedSection | null>(null);
  /** Right-click context menu. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const linkedProjectGid = useStore(s => s.linkedProjectGid);
  const linkedProjectUrl = useStore(s => s.linkedProjectUrl);
  const syncFromAsana = useStore(s => s.syncFromAsana);
  const [syncConfirm, setSyncConfirm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const doSync = async () => {
    if (!linkedProjectGid) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/project/${linkedProjectGid}/snapshot`);
      const body = await res.json();
      if (!res.ok) {
        setSyncError(body?.errors?.[0]?.message ?? `Asana returned an error (${res.status}).`);
        return;
      }
      syncFromAsana(body);
      setSelected(new Set());
      setSyncConfirm(false);
    } catch {
      setSyncError("Couldn't reach the Doorman server.");
    } finally {
      setSyncing(false);
    }
  };

  // Task/section move-drag (from the grip); column reorder drag.
  const drag = useRef<Drag>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [sectionHint, setSectionHint] = useState<number | null>(null);
  const colDrag = useRef<ColumnId | null>(null);
  const [colHint, setColHint] = useState<number | null>(null);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectAnchor = useRef<number>(-1);
  const dragSelecting = useRef(false);
  const [bulkDue, setBulkDue] = useState(false);

  const tasks = useMemo(() => staging.flatMap(s => s.tasks), [staging]);

  const floorColor = useMemo(() => {
    const keys: string[] = [];
    for (const t of tasks) {
      if (t.room.floor !== null && !keys.includes(String(t.room.floor))) keys.push(String(t.room.floor));
    }
    return new Map(keys.map((k, i) => [k, PILL_COLORS[i % PILL_COLORS.length]]));
  }, [tasks]);

  const canEdit = true;

  /** Visible tasks in order (for shift/drag range selection). */
  const flat = useMemo(() => {
    const out: string[] = [];
    for (const s of staging) if (!collapsed.has(s.id)) for (const t of s.tasks) out.push(t.id);
    return out;
  }, [staging, collapsed]);
  const flatIndex = useMemo(() => new Map(flat.map((id, i) => [id, i])), [flat]);

  const gridTemplate = useMemo(
    () => `minmax(0,1fr) ${columns.map(c => `${colWidth(widths, c)}px`).join(' ')} 44px`.replace(/\s+/g, ' '),
    [columns, widths],
  );
  const minWidth = 340 + columns.reduce((n, c) => n + colWidth(widths, c), 0) + 44;

  const buildings = useMemo(
    () => [...new Set(tasks.map(t => t.room.building?.name).filter(Boolean))] as string[],
    [tasks],
  );
  const projectTitle =
    title || (buildings.length === 1 ? buildings[0] : 'Untitled project');

  // ------- selection helpers -------

  const selectRange = useCallback(
    (a: number, b: number, additive: boolean) => {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(prev => {
        const next = additive ? new Set(prev) : new Set<string>();
        for (let i = lo; i <= hi; i++) next.add(flat[i]);
        return next;
      });
    },
    [flat],
  );

  const onRowMouseDown = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      if (e.button !== 0) return;
      const el = e.target as HTMLElement;
      if (el.closest('button, input, select, a, [data-stop]')) return;
      e.preventDefault(); // no text selection while drag-selecting
      const index = flatIndex.get(taskId) ?? -1;
      if (e.shiftKey && selectAnchor.current >= 0) {
        selectRange(selectAnchor.current, index, e.ctrlKey || e.metaKey);
      } else if (e.ctrlKey || e.metaKey) {
        setSelected(prev => {
          const next = new Set(prev);
          next.has(taskId) ? next.delete(taskId) : next.add(taskId);
          return next;
        });
        selectAnchor.current = index;
      } else {
        setSelected(new Set([taskId]));
        selectAnchor.current = index;
        dragSelecting.current = true;
      }
    },
    [flatIndex, selectRange],
  );

  const onRowMouseEnter = useCallback(
    (taskId: string) => {
      if (!dragSelecting.current || selectAnchor.current < 0) return;
      const index = flatIndex.get(taskId) ?? -1;
      if (index >= 0) selectRange(selectAnchor.current, index, false);
    },
    [flatIndex, selectRange],
  );

  useEffect(() => {
    const up = () => { dragSelecting.current = false; };
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, []);

  // The context menu closes on any click or Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [ctxMenu]);

  const onRowContextMenu = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.preventDefault();
      // Right-clicking outside the selection retargets it (like Asana).
      setSelected(prev => (prev.has(taskId) ? prev : new Set([taskId])));
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth - 200),
        y: Math.min(e.clientY, window.innerHeight - 190),
        taskId,
      });
    },
    [],
  );

  // Clicking blank space (not a row, control, menu, or a scrollbar) clears
  // the selection.
  useEffect(() => {
    const clear = (e: MouseEvent) => {
      if (selected.size === 0) return;
      const el = e.target as HTMLElement;
      if (el.closest('button, input, select, a, [data-selzone]')) return;
      // Grabbing a scrollbar isn't "clicking away". Scrollbar hits land
      // directly on the scroll container: in the gutter past the client box
      // (classic scrollbars) or hugging the edge (overlay scrollbars).
      const rect = el.getBoundingClientRect();
      const scrollableY = el.scrollHeight > el.clientHeight;
      const scrollableX = el.scrollWidth > el.clientWidth;
      if (
        (scrollableY &&
          (e.clientX - rect.left >= el.clientLeft + el.clientWidth ||
            e.clientX >= rect.right - 20)) ||
        (scrollableX &&
          (e.clientY - rect.top >= el.clientTop + el.clientHeight ||
            e.clientY >= rect.bottom - 20))
      ) {
        return;
      }
      setSelected(new Set());
    };
    document.addEventListener('mousedown', clear);
    return () => document.removeEventListener('mousedown', clear);
  }, [selected.size]);

  // Any open menu closes on a click outside it (clicking another menu's
  // button switches to that menu instead).
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-root]')) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(flat));
      }
      if (e.key === 'Escape') setSelected(new Set());
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [flat]);

  const toggleSectionSelect = (section: StagedSection) =>
    setSelected(prev => {
      const next = new Set(prev);
      const allIn = section.tasks.length > 0 && section.tasks.every(t => next.has(t.id));
      for (const t of section.tasks) allIn ? next.delete(t.id) : next.add(t.id);
      return next;
    });

  // ------- misc -------

  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const endDrag = () => {
    drag.current = null;
    setDropHint(null);
    setSectionHint(null);
  };

  const addTaskTop = () => {
    const first = staging[0];
    if (first && first.name === 'Untitled section') setComposer(first.id);
    else setComposer(addSection('Untitled section', 0));
  };

  const startResize = (e: React.MouseEvent, id: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidth(widths, id);
    const move = (ev: MouseEvent) => setColumnWidth(id, startW + (ev.clientX - startX));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const columnLabel = (id: ColumnId) =>
    id === 'floor' ? 'Floor' : id === 'due' ? 'Due date' : fieldDefs[id.slice(2)]?.name ?? '?';

  return (
    <div className="h-full flex flex-col select-none">
      {/* Top bar */}
      <div className="h-9 shrink-0 flex items-center px-4 text-xs text-weak border-b border-linesoft">
        <span className="truncate">Mohammed's Builder | {projectTitle}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {linkedProjectGid && (
            <a
              href={linkedProjectUrl ?? `https://app.asana.com/0/${linkedProjectGid}`}
              target="_blank"
              rel="noreferrer"
              className="border border-line text-fg text-xs font-medium rounded px-3 py-1 hover:bg-rowhover"
            >
              Open in Asana ↗
            </a>
          )}
          {linkedProjectGid && (
            <button
              onClick={() => setSyncConfirm(true)}
              className="border border-line text-fg text-xs font-medium rounded px-3 py-1 hover:bg-rowhover"
              title="Pull the latest from Asana"
            >
              Sync
            </button>
          )}
          <button
            onClick={() => setApplyOpen(true)}
            className="bg-accent text-white text-xs font-medium rounded px-3 py-1 hover:opacity-90"
          >
            {linkedProjectGid ? 'Apply to Asana' : 'Create in Asana'}
          </button>
        </div>
      </div>

      {/* Project header */}
      <div className="shrink-0 flex items-center gap-3 px-6 pt-4">
        <span className="w-9 h-9 rounded-lg bg-coral flex items-center justify-center text-white shrink-0">
          <ListGlyph size={18} />
        </span>
        {editingTitle ? (
          <InlineInput
            initial={title}
            placeholder="Project title"
            onCommit={v => { setTitle(v.trim() || 'Untitled project'); setEditingTitle(false); }}
            onCancel={() => setEditingTitle(false)}
            className="text-xl font-semibold"
          />
        ) : (
          <h1
            className="text-xl font-semibold truncate cursor-text hover:bg-rowhover rounded px-1 -mx-1"
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
          >
            {projectTitle}
          </h1>
        )}
        {!linkedProjectGid && (
          <span className="flex items-center gap-1.5 bg-accent/25 text-[#9db9e8] text-xs font-medium rounded-md px-2 py-1 whitespace-nowrap shrink-0">
            <CheckCircle size={13} /> Preview — not in Asana yet
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex items-center gap-5 px-6 mt-3 border-b border-linesoft text-sm">
        <span className="pb-2 cursor-default text-fg font-medium border-b-2 border-fg -mb-px">List</span>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center px-4 py-2 gap-2">
        <div className="relative" data-menu-root>
          <div className="flex items-center border border-line rounded overflow-hidden">
            <button
              onClick={addTaskTop}
              disabled={!canEdit}
              className="px-2.5 py-1 text-sm font-medium hover:bg-rowhover disabled:opacity-40"
            >
              + Add task
            </button>
            <button
              onClick={() => setMenu(m => (m === 'add' ? null : 'add'))}
              disabled={!canEdit}
              className="border-l border-line px-1.5 py-1.5 text-weak hover:bg-rowhover disabled:opacity-40"
              aria-label="Add options"
            >
              <ChevronDown />
            </button>
          </div>
          {menu === 'add' && (
            <div className="absolute left-0 top-9 z-30 w-60 bg-raised border border-line rounded-lg shadow-xl py-1">
              <MenuItem active={false} onClick={() => { addTaskTop(); setMenu(null); }}>Add task</MenuItem>
              <MenuItem active={false} onClick={() => { addSection('Untitled section', 0); setMenu(null); }}>
                Add section
              </MenuItem>
              <MenuItem active={false} onClick={() => { setInsertOpen(true); setMenu(null); }}>
                Insert rooms from spreadsheet…
              </MenuItem>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center text-sm">
          <button
            onClick={() => setPanel(p => (p === 'customize' ? null : 'customize'))}
            className={
              'flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold border transition-colors ' +
              (panel === 'customize'
                ? 'border-accent bg-accent/15 text-fg'
                : 'border-line text-fg hover:border-accent hover:bg-accent/10')
            }
          >
            <span className="grid grid-cols-2 gap-[3px]" aria-hidden>
              {['#f06a6a', '#f1bd6c', '#83c9a9', '#6a9ee0'].map(c => (
                <span key={c} className="w-[5px] h-[5px] rounded-full" style={{ background: c }} />
              ))}
            </span>
            Customize
          </button>
        </div>
      </div>

      {/* Grid + side panel */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="flex-1 min-w-0 overflow-auto">
          <div style={{ minWidth: `${minWidth}px` }}>
            {/* Column headers */}
            <div
              className="grid items-stretch sticky top-0 z-10 bg-app border-y border-linesoft text-xs text-weak"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span className="pl-4 pr-2 py-2 flex items-center gap-3">
                <Checkbox
                  checked={flat.length > 0 && selected.size >= flat.length}
                  indeterminate={selected.size > 0 && selected.size < flat.length}
                  onClick={() =>
                    setSelected(prev => (prev.size >= flat.length ? new Set() : new Set(flat)))
                  }
                  label="Select all tasks"
                />
                Name
              </span>
              {columns.map((id, i) => (
                <span
                  key={id}
                  draggable
                  onDragStart={() => { colDrag.current = id; }}
                  onDragEnd={() => { colDrag.current = null; setColHint(null); }}
                  onDragOver={e => {
                    if (colDrag.current) { e.preventDefault(); setColHint(i); }
                  }}
                  onDrop={e => {
                    if (colDrag.current) {
                      e.preventDefault();
                      moveColumn(colDrag.current, i);
                      colDrag.current = null;
                      setColHint(null);
                    }
                  }}
                  className={
                    'relative px-3 py-2 border-l border-linesoft flex items-center gap-1 group/fh min-w-0 cursor-grab active:cursor-grabbing ' +
                    (colHint === i ? 'border-l-2 border-l-accent ' : '')
                  }
                  title="Drag to reorder"
                >
                  <span className="truncate">{columnLabel(id)}</span>
                  <button
                    onClick={() => removeColumn(id)}
                    className="opacity-0 group-hover/fh:opacity-100 text-weak hover:text-danger shrink-0"
                    aria-label={`Remove ${columnLabel(id)} column`}
                  >
                    <XIcon size={10} />
                  </button>
                  <span
                    data-stop
                    onMouseDown={e => startResize(e, id)}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/60"
                    aria-hidden
                  />
                </span>
              ))}
              <span className="relative border-l border-linesoft flex items-center justify-center" data-menu-root>
                <button
                  onClick={() => setMenu(m => (m === 'fields' ? null : 'fields'))}
                  className="text-weak hover:text-fg text-base leading-none px-2 py-1 rounded"
                  aria-label="Add a column"
                  title="Add a field column"
                >
                  +
                </button>
                {menu === 'fields' && <FieldsPicker onClose={() => setMenu(null)} />}
              </span>
            </div>

            {staging.map((section, sectionIndex) => (
              <SectionBlock
                key={section.id}
                section={section}
                sectionIndex={sectionIndex}
                gridTemplate={gridTemplate}
                columns={columns}
                fieldDefs={fieldDefs}
                collapsed={collapsed.has(section.id)}
                onToggle={() => toggle(section.id)}
                canEdit={canEdit}
                floorColor={floorColor}
                composerOpen={composer === section.id}
                setComposer={setComposer}
                drag={drag}
                dropHint={dropHint}
                setDropHint={setDropHint}
                sectionHint={sectionHint}
                setSectionHint={setSectionHint}
                endDrag={endDrag}
                selected={selected}
                onRowMouseDown={onRowMouseDown}
                onRowMouseEnter={onRowMouseEnter}
                onToggleSectionSelect={() => toggleSectionSelect(section)}
                onRowContextMenu={onRowContextMenu}
                actions={{
                  addTask, renameTask, moveTask,
                  // Toggling a selected task's check applies to the whole selection.
                  toggleCompleteSmart: task =>
                    selected.has(task.id)
                      ? setCompleted([...selected], !task.completed)
                      : toggleComplete(task.id),
                  deleteTask: id => deleteWithUndo([id]),
                  renameSection, moveSection,
                  requestDeleteSection: s =>
                    s.tasks.length === 0 ? deleteSection(s.id) : setDeleteTarget(s),
                }}
              />
            ))}

            {canEdit && (
              <div className="px-4 pt-5">
                {addingSection ? (
                  <InlineInput
                    initial=""
                    placeholder="Section name"
                    onCommit={name => {
                      if (name.trim()) addSection(name.trim());
                      setAddingSection(false);
                    }}
                    onCancel={() => setAddingSection(false)}
                    className="font-semibold"
                  />
                ) : (
                  <button onClick={() => setAddingSection(true)} className="text-weak hover:text-fg text-sm font-medium">
                    + Add section
                  </button>
                )}
              </div>
            )}
            <div className="h-32" />
          </div>
        </div>

        {panel === 'customize' && <CustomizePanel onClose={() => setPanel(null)} />}

        {/* Selection action bar */}
        {selected.size > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-raised border border-line rounded-lg shadow-2xl px-3 py-2 text-sm">
            <span className="font-medium mr-2 whitespace-nowrap">{selected.size} selected</span>
            <BarButton onClick={() => { setCompleted([...selected], true); }}>Mark complete</BarButton>
            <BarButton onClick={() => { setCompleted([...selected], false); }}>Mark incomplete</BarButton>
            {bulkDue ? (
              <input
                autoFocus
                type="date"
                onChange={e => {
                  if (e.target.value) setTaskDue([...selected], e.target.value);
                }}
                onBlur={() => setBulkDue(false)}
                className="bg-app border border-accent rounded px-2 py-1 text-sm [color-scheme:dark]"
              />
            ) : (
              <BarButton onClick={() => setBulkDue(true)}>Set due date…</BarButton>
            )}
            <BarButton onClick={() => deleteWithUndo([...selected])} danger>
              Delete
            </BarButton>
            <span className="w-px h-5 bg-linesoft mx-1" />
            <BarButton onClick={() => setSelected(new Set(flat))}>Select all</BarButton>
            <BarButton onClick={() => setSelected(new Set())}>Clear</BarButton>
          </div>
        )}
      </div>

      {applyOpen && <ApplyModal onClose={() => setApplyOpen(false)} />}
      {insertOpen && <InsertRoomsModal onClose={() => setInsertOpen(false)} />}

      {/* Right-click task menu */}
      {ctxMenu && (
        <div
          className="fixed z-[70] w-48 bg-raised border border-line rounded-lg shadow-2xl py-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {(() => {
            const targets = selected.has(ctxMenu.taskId) ? [...selected] : [ctxMenu.taskId];
            const n = targets.length;
            const suffix = n > 1 ? ` (${n})` : '';
            const item = 'w-full text-left px-3 py-1.5 text-sm hover:bg-rowhover';
            return (
              <>
                <button className={item} onClick={() => { setCompleted(targets, true); setCtxMenu(null); }}>
                  Mark complete{suffix}
                </button>
                <button className={item} onClick={() => { setCompleted(targets, false); setCtxMenu(null); }}>
                  Mark incomplete{suffix}
                </button>
                <button className={item} onClick={() => { duplicateTasks(targets); setCtxMenu(null); }}>
                  Duplicate{suffix}
                </button>
                <button
                  className={item + ' text-danger border-t border-linesoft mt-1'}
                  onClick={() => { deleteWithUndo(targets); setCtxMenu(null); }}
                >
                  Delete{suffix}
                </button>
              </>
            );
          })()}
        </div>
      )}


      {syncConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => !syncing && setSyncConfirm(false)}>
          <div className="w-full max-w-md bg-raised border border-linesoft rounded-lg shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Sync from Asana?</h2>
            <p className="text-sm text-weak mt-1.5 leading-relaxed">
              Pulls the latest sections, tasks, and field values from Asana and replaces
              what's here. Changes made only in Doorman are lost.
            </p>
            {syncError && <p className="text-sm text-danger mt-2">{syncError}</p>}
            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setSyncConfirm(false)}
                disabled={syncing}
                className="px-3 h-8 text-sm rounded-md text-weak hover:text-fg hover:bg-rowhover disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={doSync}
                disabled={syncing}
                className="px-3 h-8 text-sm font-medium rounded-md bg-accent text-white disabled:opacity-60"
              >
                {syncing ? 'Syncing…' : 'Pull from Asana'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-md bg-raised border border-linesoft rounded-lg shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Delete "{deleteTarget.name}"?</h2>
            <p className="text-sm text-weak mt-1.5 leading-relaxed">
              Keep its {deleteTarget.tasks.length} task{deleteTarget.tasks.length === 1 ? '' : 's'} or delete
              them too.
            </p>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 h-8 text-sm rounded-md text-weak hover:text-fg hover:bg-rowhover"
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteSectionKeepTasks(deleteTarget.id); setDeleteTarget(null); }}
                className="px-3 h-8 text-sm font-medium rounded-md border border-line hover:bg-rowhover"
              >
                Delete, keep tasks
              </button>
              <button
                onClick={() => { deleteSection(deleteTarget.id); setDeleteTarget(null); }}
                className="px-3 h-8 text-sm font-medium rounded-md bg-danger text-white hover:opacity-90"
              >
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BarButton({
  children, onClick, danger,
}: {
  children: React.ReactNode; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-2 py-1 rounded whitespace-nowrap ' +
        (danger ? 'text-danger hover:bg-danger/15' : 'text-weak hover:text-fg hover:bg-rowhover')
      }
    >
      {children}
    </button>
  );
}

interface SectionActions {
  addTask: (sectionId: string, name: string) => void;
  renameTask: (taskId: string, name: string) => void;
  deleteTask: (taskId: string) => void;
  moveTask: (taskId: string, toSectionId: string, toIndex: number) => void;
  toggleCompleteSmart: (task: StagedTask) => void;
  renameSection: (sectionId: string, name: string) => void;
  moveSection: (sectionId: string, toIndex: number) => void;
  requestDeleteSection: (section: StagedSection) => void;
}

function SectionBlock({
  section, sectionIndex, gridTemplate, columns, fieldDefs, collapsed, onToggle, canEdit, floorColor,
  composerOpen, setComposer, drag, dropHint, setDropHint, sectionHint, setSectionHint, endDrag,
  selected, onRowMouseDown, onRowMouseEnter, onRowContextMenu, onToggleSectionSelect, actions,
}: {
  section: StagedSection;
  sectionIndex: number;
  gridTemplate: string;
  columns: ColumnId[];
  fieldDefs: Record<string, import('../store').FieldDef>;
  collapsed: boolean;
  onToggle: () => void;
  canEdit: boolean;
  floorColor: Map<string, string>;
  composerOpen: boolean;
  setComposer: (id: string | null) => void;
  drag: React.MutableRefObject<Drag>;
  dropHint: DropHint;
  setDropHint: (hint: DropHint) => void;
  sectionHint: number | null;
  setSectionHint: (i: number | null) => void;
  endDrag: () => void;
  selected: Set<string>;
  onRowMouseDown: (e: React.MouseEvent, taskId: string) => void;
  onRowMouseEnter: (taskId: string) => void;
  onRowContextMenu: (e: React.MouseEvent, taskId: string) => void;
  onToggleSectionSelect: () => void;
  actions: SectionActions;
}) {
  const [editingName, setEditingName] = useState(false);
  const untitled = section.name === 'Untitled section';
  const allSelected = section.tasks.length > 0 && section.tasks.every(t => selected.has(t.id));

  return (
    <div
      className={sectionHint === sectionIndex ? 'border-t-2 border-accent' : ''}
      onDragOver={e => {
        if (drag.current?.type === 'section') {
          e.preventDefault();
          setSectionHint(sectionIndex);
        }
      }}
      onDrop={e => {
        if (drag.current?.type === 'section') {
          e.preventDefault();
          actions.moveSection(drag.current.id, sectionIndex);
          endDrag();
        }
      }}
    >
      <div
        className="flex items-center gap-1.5 px-4 pt-5 pb-1.5 group/sh"
        draggable={canEdit && !editingName}
        onDragStart={e => {
          drag.current = { type: 'section', id: section.id };
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={endDrag}
        onDragOver={e => {
          if (drag.current?.type === 'task') {
            e.preventDefault();
            setDropHint({ sectionId: section.id, index: 0 });
          }
        }}
        onDrop={e => {
          if (drag.current?.type === 'task') {
            e.preventDefault();
            actions.moveTask(drag.current.id, section.id, 0);
            endDrag();
          }
        }}
      >
        <button
          onClick={onToggle}
          className="text-weak hover:text-fg p-0.5 rounded"
          aria-label={collapsed ? 'Expand section' : 'Collapse section'}
        >
          <Caret open={!collapsed} />
        </button>
        {section.tasks.length > 0 && (
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && section.tasks.some(t => selected.has(t.id))}
            onClick={onToggleSectionSelect}
            label={`Select all tasks in ${section.name}`}
            size={14}
          />
        )}
        {editingName ? (
          <InlineInput
            initial={untitled ? '' : section.name}
            placeholder="Section name"
            commitOnEmpty
            onCommit={name => {
              actions.renameSection(section.id, name.trim() || 'Untitled section');
              setEditingName(false);
            }}
            onCancel={() => setEditingName(false)}
            className="font-semibold"
          />
        ) : (
          <h3
            className={
              'font-semibold rounded px-1 -mx-1 ' +
              (untitled ? 'text-weak font-medium ' : '') +
              (canEdit ? 'cursor-text hover:bg-rowhover' : '')
            }
            onClick={() => canEdit && setEditingName(true)}
            title={canEdit ? 'Click to rename · drag to reorder' : undefined}
          >
            {section.name}
          </h3>
        )}
        <span className="text-weak text-xs ml-1">{section.tasks.length}</span>
        {canEdit && !editingName && (
          <button
            onClick={() => actions.requestDeleteSection(section)}
            className="opacity-0 group-hover/sh:opacity-100 text-weak hover:text-danger p-1 rounded"
            aria-label={`Delete section ${section.name}`}
          >
            <XIcon size={11} />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {section.tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              gridTemplate={gridTemplate}
              columns={columns}
              fieldDefs={fieldDefs}
              color={task.room.floor !== null ? floorColor.get(String(task.room.floor)) : undefined}
              canEdit={canEdit}
              isSelected={selected.has(task.id)}
              targets={selected.has(task.id) ? [...selected] : [task.id]}
              hintAbove={dropHint?.sectionId === section.id && dropHint.index === index}
              onMouseDown={e => onRowMouseDown(e, task.id)}
              onMouseEnter={() => onRowMouseEnter(task.id)}
              onContextMenu={e => onRowContextMenu(e, task.id)}
              onDragStart={() => { drag.current = { type: 'task', id: task.id }; }}
              onDragEnd={endDrag}
              onDragOver={e => {
                if (drag.current?.type === 'task') {
                  e.preventDefault();
                  setDropHint({ sectionId: section.id, index });
                }
              }}
              onDrop={e => {
                if (drag.current?.type === 'task') {
                  e.preventDefault();
                  actions.moveTask(drag.current.id, section.id, index);
                  endDrag();
                }
              }}
              onRename={name => actions.renameTask(task.id, name)}
              onDelete={() => actions.deleteTask(task.id)}
              onToggleComplete={() => actions.toggleCompleteSmart(task)}
            />
          ))}

          <div
            className={
              'px-10 py-1.5 text-sm border-b border-linesoft ' +
              (dropHint?.sectionId === section.id && dropHint.index === section.tasks.length
                ? 'border-t-2 border-t-accent '
                : '')
            }
            onDragOver={e => {
              if (drag.current?.type === 'task') {
                e.preventDefault();
                setDropHint({ sectionId: section.id, index: section.tasks.length });
              }
            }}
            onDrop={e => {
              if (drag.current?.type === 'task') {
                e.preventDefault();
                actions.moveTask(drag.current.id, section.id, section.tasks.length);
                endDrag();
              }
            }}
          >
            {composerOpen ? (
              <InlineInput
                initial=""
                placeholder="Task name"
                mono
                onCommit={name => {
                  if (name.trim()) actions.addTask(section.id, name.trim());
                  setComposer(null);
                }}
                onCancel={() => setComposer(null)}
              />
            ) : (
              <button
                onClick={() => canEdit && setComposer(section.id)}
                disabled={!canEdit}
                className="text-weak hover:text-fg disabled:hover:text-weak text-left w-full"
              >
                Add task...
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TaskRow({
  task, gridTemplate, columns, fieldDefs, color, canEdit, isSelected, targets, hintAbove,
  onMouseDown, onMouseEnter, onContextMenu, onDragStart, onDragEnd, onDragOver, onDrop,
  onRename, onDelete, onToggleComplete,
}: {
  task: StagedTask;
  gridTemplate: string;
  columns: ColumnId[];
  fieldDefs: Record<string, import('../store').FieldDef>;
  color?: string;
  canEdit: boolean;
  isSelected: boolean;
  targets: string[];
  hintAbove: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={
        'grid items-stretch h-9 border-b border-linesoft group ' +
        (isSelected
          ? 'bg-accent/[0.14] hover:bg-accent/[0.2] shadow-[inset_0_1px_0_0_rgba(105,145,215,0.25),inset_0_-1px_0_0_rgba(105,145,215,0.25)] '
          : 'hover:bg-rowhover ') +
        (hintAbove ? 'border-t-2 border-t-accent ' : '')
      }
      style={{ gridTemplateColumns: gridTemplate }}
      data-selzone
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="relative flex items-center gap-2 pl-10 pr-2 min-w-0">
        {canEdit && !editing && (
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            data-stop
            className="absolute left-2 opacity-0 group-hover:opacity-100 text-weak cursor-grab active:cursor-grabbing"
            title="Drag to move"
          >
            <Grip />
          </span>
        )}
        <button
          onClick={onToggleComplete}
          className={
            'shrink-0 rounded-full ' +
            (task.completed ? 'text-white bg-ok' : 'text-weak hover:text-ok')
          }
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          <CheckCircle size={16} />
        </button>
        {editing ? (
          <InlineInput
            initial={task.name}
            mono
            onCommit={name => {
              if (name.trim()) onRename(name.trim());
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span
            data-stop
            className={
              'truncate ' +
              (task.completed ? 'text-weak ' : '') +
              (canEdit ? 'cursor-text' : '')
            }
            onClick={() => canEdit && setEditing(true)}
            title={canEdit ? 'Click to rename' : undefined}
          >
            {task.name}
          </span>
        )}
        {canEdit && !editing && (
          <button
            onClick={onDelete}
            className="ml-auto mr-1 shrink-0 opacity-0 group-hover:opacity-100 text-weak hover:text-danger p-1 rounded"
            aria-label={`Delete ${task.name}`}
          >
            <XIcon size={12} />
          </button>
        )}
      </span>

      {columns.map(id => {
        if (id === 'floor') {
          return (
            <span key={id} className="px-3 border-l border-linesoft h-full flex items-center min-w-0">
              {task.room.floor !== null && color && (
                <span
                  className="text-xs font-medium rounded-md px-2 py-0.5 truncate"
                  style={{ background: color, color: '#1e1f21' }}
                >
                  {floorLabel(task.room.floor)}
                </span>
              )}
            </span>
          );
        }
        if (id === 'due') {
          return <DueCell key={id} task={task} canEdit={true} targets={targets} />;
        }
        const field = fieldDefs[id.slice(2)];
        if (!field) return <span key={id} className="border-l border-linesoft" />;
        return <FieldCell key={id} task={task} field={field} canEdit={true} targets={targets} />;
      })}
      <span className="border-l border-linesoft h-full" />
    </div>
  );
}

function InlineInput({
  initial, onCommit, onCancel, placeholder, mono, commitOnEmpty, className = '',
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
  mono?: boolean;
  commitOnEmpty?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onCommit(value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() =>
        value !== initial && (value.trim() || commitOnEmpty) ? onCommit(value) : onCancel()
      }
      className={
        (mono ? 'room-code ' : '') +
        'bg-raised border border-accent rounded px-2 py-0.5 text-sm min-w-0 w-full max-w-md ' +
        className
      }
    />
  );
}

function MenuItem({
  children, active, onClick,
}: {
  children: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'w-full text-left px-3 py-1.5 text-sm hover:bg-rowhover ' + (active ? 'text-fg font-medium' : 'text-weak')
      }
    >
      {children}
    </button>
  );
}
