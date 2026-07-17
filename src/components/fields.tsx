// Custom-field UI: the "+" column browser (organization field library) and
// per-task cells. Cells are full-size click targets; edits apply to every
// selected task when the edited row is part of the selection.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FieldDef, StagedTask, useStore } from '../store';

// Asana enum-option color names → dark-theme pill hexes.
export const ASANA_COLORS: Record<string, string> = {
  red: '#f06a6a', orange: '#ec8d71', 'yellow-orange': '#f1bd6c', yellow: '#f8df72',
  'yellow-green': '#b3df97', green: '#83c9a9', 'blue-green': '#4ecbc4', aqua: '#9ee7e3',
  blue: '#6a9ee0', indigo: '#a69ff2', purple: '#cf94e6', magenta: '#f26fb2',
  'hot-pink': '#f9aaef', pink: '#f9aaef', 'cool-gray': '#c7c4c4', none: '#c7c4c4',
};
export const fieldColor = (c?: string) => ASANA_COLORS[c ?? 'none'] ?? '#c7c4c4';

// Floor-pill palette, assigned to floors top-down. Shared by the grid,
// filter menus, and customize previews.
export const PILL_COLORS = [
  '#f06a6a', '#ec8d71', '#f1bd6c', '#f8df72', '#b3df97', '#83c9a9',
  '#4ecbc4', '#9ee7e3', '#6a9ee0', '#a69ff2', '#cf94e6', '#f26fb2',
];

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="rounded-full inline-block shrink-0"
      style={{ background: color, width: size, height: size }}
      aria-hidden
    />
  );
}

const TYPE_LABELS: Record<string, string> = {
  enum: 'Dropdown', multi_enum: 'Multi-select', text: 'Text', number: 'Number',
  date: 'Date', people: 'People',
};

interface Library {
  loading: boolean;
  mock: boolean;
  error: string | null;
  fields: FieldDef[];
}

let cache: Library | null = null;

function useFieldsLibrary(open: boolean): Library {
  const [lib, setLib] = useState<Library>(cache ?? { loading: true, mock: false, error: null, fields: [] });
  useEffect(() => {
    if (!open || cache) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/fields');
        const body = await res.json();
        if (!res.ok) throw new Error(body?.errors?.[0]?.message ?? `Error ${res.status}`);
        cache = { loading: false, mock: !!body.mock, error: null, fields: body.fields };
      } catch (err) {
        cache = {
          loading: false, mock: false, fields: [],
          error: err instanceof Error && err.message.includes('fetch')
            ? "Couldn't reach the Doorman server (npm run dev:server)."
            : String(err instanceof Error ? err.message : err),
        };
      }
      if (alive && cache) setLib(cache);
    })();
    return () => { alive = false; };
  }, [open]);
  return lib;
}

/** Dropdown from the "+" column header: browse and add columns. */
export function FieldsPicker({ onClose }: { onClose: () => void }) {
  const lib = useFieldsLibrary(true);
  const addFieldColumn = useStore(s => s.addFieldColumn);
  const addBuiltinColumn = useStore(s => s.addBuiltinColumn);
  const columns = useStore(s => s.columns);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      lib.fields
        .filter(f => !columns.includes(`f:${f.gid}`))
        .filter(f => !q || f.name.toLowerCase().includes(q)),
    [lib.fields, columns, q],
  );
  const missingBuiltins = (['floor', 'due'] as const).filter(
    id => !columns.includes(id) && (!q || (id === 'floor' ? 'floor' : 'due date').includes(q)),
  );

  return (
    <div className="absolute right-0 top-8 z-30 w-80 bg-raised border border-line rounded-lg shadow-xl">
      <div className="p-2 border-b border-linesoft">
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && onClose()}
          placeholder="Find a field…"
          className="w-full bg-app border border-line rounded px-2 py-1.5 text-sm"
        />
        {lib.mock && (
          <p className="text-[11px] text-warn mt-1.5">
            Sample fields — connect Asana (server .env) to see your real library.
          </p>
        )}
      </div>
      <div className="max-h-96 overflow-auto py-1">
        {missingBuiltins.map(id => (
          <button
            key={id}
            onClick={() => { addBuiltinColumn(id); onClose(); }}
            className="w-full text-left px-3 py-2 hover:bg-rowhover flex items-center gap-2 border-b border-linesoft"
          >
            <span className="text-sm">{id === 'floor' ? 'Floor' : 'Due date'}</span>
            <span className="ml-auto text-[11px] text-weak">Built-in</span>
          </button>
        ))}
        {lib.loading && <p className="px-3 py-2 text-sm text-weak">Loading fields…</p>}
        {lib.error && <p className="px-3 py-2 text-sm text-danger">{lib.error}</p>}
        {!lib.loading && !lib.error && shown.length === 0 && missingBuiltins.length === 0 && (
          <p className="px-3 py-2 text-sm text-weak">No matching fields.</p>
        )}
        {shown.map(field => (
          <button
            key={field.gid}
            onClick={() => { addFieldColumn(field); onClose(); }}
            className="w-full text-left px-3 py-2 hover:bg-rowhover"
          >
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{field.name}</span>
              <span className="ml-auto text-[11px] text-weak shrink-0">
                {TYPE_LABELS[field.type] ?? field.type}
              </span>
            </span>
            {field.enum_options && field.enum_options.length > 0 && (
              <span className="flex items-center gap-2.5 mt-1 min-w-0">
                {field.enum_options.slice(0, 3).map(o => (
                  <span key={o.gid} className="flex items-center gap-1 min-w-0 text-[11px] text-weak">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: fieldColor(o.color) }}
                    />
                    <span className="truncate max-w-24">{o.name}</span>
                  </span>
                ))}
                {field.enum_options.length > 3 && (
                  <span className="text-[11px] text-weak shrink-0">+{field.enum_options.length - 3}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onClose]);
  return ref;
}

/** One field cell. `targets` = task ids the edit applies to (selection-aware). */
export function FieldCell({
  task, field, canEdit, targets,
}: {
  task: StagedTask;
  field: FieldDef;
  canEdit: boolean;
  targets: string[];
}) {
  const setTaskField = useStore(s => s.setTaskField);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const value = task.fields?.[field.gid];

  if (field.type === 'enum' || field.type === 'multi_enum') {
    const option = field.enum_options?.find(o => o.gid === value);
    return (
      <div ref={ref} className="relative h-full border-l border-linesoft min-w-0">
        <button
          onClick={() => canEdit && setOpen(v => !v)}
          className={
            'w-full h-full flex items-center px-3 text-left min-w-0 ' +
            (canEdit ? 'hover:bg-activebg/60' : 'cursor-default')
          }
        >
          {option ? (
            <span
              className="text-xs font-medium rounded-md px-2 py-0.5 truncate"
              style={{ background: fieldColor(option.color), color: '#1e1f21' }}
            >
              {option.name}
            </span>
          ) : (
            <span className="text-weak/40 text-xs">{canEdit ? '—' : ''}</span>
          )}
        </button>
        {open && (
          <div className="absolute left-0 top-full z-30 w-52 bg-raised border border-line rounded-lg shadow-xl py-1">
            {value !== undefined && (
              <button
                onClick={() => { setTaskField(targets, field.gid, null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-rowhover text-weak text-sm border-b border-linesoft mb-1"
              >
                Clear
              </button>
            )}
            <div className="max-h-44 overflow-y-auto">
              {field.enum_options?.map(o => (
                <button
                  key={o.gid}
                  onClick={() => { setTaskField(targets, field.gid, o.gid); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-rowhover flex items-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: fieldColor(o.color) }} />
                  <span className="text-sm truncate">{o.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (field.type === 'text' || field.type === 'number') {
    return (
      <div className="h-full border-l border-linesoft min-w-0">
        {editing ? (
          <input
            autoFocus
            type={field.type === 'number' ? 'number' : 'text'}
            defaultValue={value ?? ''}
            onBlur={e => {
              const v = e.target.value;
              setTaskField(targets, field.gid, v === '' ? null : field.type === 'number' ? Number(v) : v);
              setEditing(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full h-full bg-raised border border-accent rounded-none px-3 text-sm"
          />
        ) : (
          <button
            onClick={() => canEdit && setEditing(true)}
            className={
              'w-full h-full flex items-center px-3 text-left text-sm min-w-0 ' +
              (canEdit ? 'hover:bg-activebg/60' : 'cursor-default')
            }
          >
            <span className="truncate">
              {value !== undefined ? String(value) : <span className="text-weak/40 text-xs">—</span>}
            </span>
          </button>
        )}
      </div>
    );
  }

  return <div className="h-full border-l border-linesoft flex items-center px-3 text-weak/40 text-xs">—</div>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDue(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  if (!y || !m || !d) return due;
  return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ''}`;
}

/** Due-date cell: full-size click target opening a native date input. */
export function DueCell({
  task, canEdit, targets,
}: {
  task: StagedTask;
  canEdit: boolean;
  targets: string[];
}) {
  const setTaskDue = useStore(s => s.setTaskDue);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="h-full border-l border-linesoft min-w-0">
        <input
          autoFocus
          type="date"
          defaultValue={task.due ?? ''}
          onChange={e => {
            setTaskDue(targets, e.target.value || null);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') setEditing(false);
          }}
          className="w-full h-full bg-raised border border-accent px-2 text-sm [color-scheme:dark]"
        />
      </div>
    );
  }

  return (
    <div className="h-full border-l border-linesoft min-w-0">
      <button
        onClick={() => canEdit && setEditing(true)}
        className={
          'w-full h-full flex items-center px-3 text-left text-sm min-w-0 ' +
          (canEdit ? 'hover:bg-activebg/60' : 'cursor-default')
        }
      >
        {task.due ? (
          <span className="truncate">{formatDue(task.due)}</span>
        ) : (
          <span className="text-weak/40 text-xs">{canEdit ? '—' : ''}</span>
        )}
      </button>
    </div>
  );
}
