// Customize sections — scoped to the entire project (grouping presets that
// rebuild the layout) or to one section (rename, sort its tasks, break it up).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  contextForRoom, PRESET_DEFAULT_TEMPLATE, renderTemplate, SectionPreset, TEMPLATE_VARS,
} from '../core/blueprint';
import {
  groupTasksForSplit, SectionSortMode, SplitPreset, useStore,
} from '../store';
import { Dot, PILL_COLORS } from './fields';
import { XIcon } from './icons';

// "floor" toggles direction on repeat clicks.
const PROJECT_PRESETS: Array<{ key: 'none' | 'floor' | 'building'; label: string; color: string }> = [
  { key: 'none', label: 'No grouping', color: '#c7c4c4' },
  { key: 'floor', label: 'By floor', color: '#f06a6a' },
  { key: 'building', label: 'By building', color: '#6a9ee0' },
];

const SORTS: Array<{ mode: SectionSortMode; label: string; color: string }> = [
  { mode: 'name-asc', label: 'Lowest room first', color: '#83c9a9' },
  { mode: 'name-desc', label: 'Highest room first', color: '#ec8d71' },
];

const BREAKUPS: Array<{ preset: SplitPreset; label: string }> = [
  { preset: 'floor-desc', label: 'One section per floor' },
  { preset: 'building', label: 'One section per building' },
];

export function CustomizePanel({ onClose }: { onClose: () => void }) {
  const blueprint = useStore(s => s.blueprint);
  const setPreset = useStore(s => s.setPreset);
  const setTemplate = useStore(s => s.setTemplate);
  const staging = useStore(s => s.staging) ?? [];
  const sortSection = useStore(s => s.sortSection);
  const splitSection = useStore(s => s.splitSection);
  const renameSection = useStore(s => s.renameSection);

  const [scope, setScope] = useState<'project' | string>('project');
  const [flash, setFlash] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const templateInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // If the targeted section disappears (deleted/split), fall back to project scope.
  useEffect(() => {
    if (scope !== 'project' && !staging.some(s => s.id === scope)) setScope('project');
  }, [scope, staging]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  const section = scope === 'project' ? null : staging.find(s => s.id === scope) ?? null;
  const byFloor = blueprint.preset === 'floor-desc' || blueprint.preset === 'floor-asc';

  // Section-name variables resolve from the section's first recognized room.
  const nameCtx = useMemo(() => {
    const t = section?.tasks.find(x => x.room.building) ?? section?.tasks[0];
    return t ? contextForRoom(t.room, 'floor-desc') : null;
  }, [section]);

  useEffect(() => {
    setNameDraft(section?.name ?? '');
  }, [section?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderedName = nameCtx ? renderTemplate(nameDraft, nameCtx) : nameDraft.trim();

  // Live rename: every keystroke (and chip insert) updates the section
  // immediately — the draft keeps the raw {variables} for further editing.
  const applyName = (draft: string) => {
    setNameDraft(draft);
    if (!section) return;
    const rendered = (nameCtx ? renderTemplate(draft, nameCtx) : draft.trim()) || 'Untitled section';
    if (rendered !== section.name) renameSection(section.id, rendered);
  };

  // Break-up options that would actually produce more than one section.
  const breakups = useMemo(
    () =>
      section
        ? BREAKUPS.map(b => ({
            ...b,
            groups: groupTasksForSplit(section.tasks, b.preset, PRESET_DEFAULT_TEMPLATE[b.preset]),
          })).filter(b => b.groups.length > 1)
        : [],
    [section],
  );

  const insertVar = (
    input: HTMLInputElement | null,
    current: string,
    set: (v: string) => void,
    name: string,
  ) => {
    const token = `{${name}}`;
    if (!input) {
      set(current + token);
      return;
    }
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? start;
    set(current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const varChips = (
    input: HTMLInputElement | null,
    current: string,
    set: (v: string) => void,
    showFloorVars: boolean,
  ) => (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {TEMPLATE_VARS.filter(v =>
        v.name === 'floor' || v.name === 'floorlabel' ? showFloorVars : true,
      ).map((v, i) => (
        <button
          key={v.name}
          onClick={() => insertVar(input, current, set, v.name)}
          title={`Example: ${v.example}`}
          className="room-code text-xs bg-raised border border-line rounded px-2 py-1 hover:border-accent hover:text-fg text-weak flex items-center gap-1.5"
        >
          <Dot color={PILL_COLORS[(i * 3 + 5) % PILL_COLORS.length]} size={7} />
          {'{' + v.name + '}'}
        </button>
      ))}
    </div>
  );

  return (
    <aside className="w-[340px] max-sm:w-full shrink-0 border-l border-linesoft flex flex-col bg-app max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-2xl">
      <div className="flex items-center justify-between px-4 h-11 border-b border-linesoft shrink-0">
        <h2 className="font-semibold text-sm">Customize sections</h2>
        <button onClick={onClose} className="text-weak hover:text-fg p-1 rounded" aria-label="Close panel">
          <XIcon />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Scope */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-weak mb-2">Apply to</p>
          <div className="flex gap-2 items-stretch">
            <button
              onClick={() => setScope('project')}
              className={
                'shrink-0 rounded-md px-3 py-2 text-sm font-medium border transition-colors ' +
                (scope === 'project'
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-line text-weak hover:text-fg hover:border-weak')
              }
            >
              Entire project
            </button>
            <select
              id="customize-scope"
              value={scope === 'project' ? '' : scope}
              onChange={e => e.target.value && setScope(e.target.value)}
              className={
                'flex-1 min-w-0 bg-raised border rounded-md px-3 py-2 text-sm ' +
                (scope !== 'project' ? 'border-accent' : 'border-line text-weak')
              }
            >
              <option value="" disabled>
                …or edit one section
              </option>
              {staging.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.tasks.length})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ------- Entire project ------- */}
        {scope === 'project' && (
          <>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-weak mb-2">
                Group by
              </legend>
              <div className="space-y-1.5">
                {PROJECT_PRESETS.map(({ key, label, color }) => {
                  const isFloor = key === 'floor';
                  const active = isFloor
                    ? blueprint.preset === 'floor-desc' || blueprint.preset === 'floor-asc'
                    : blueprint.preset === key;
                  const desc =
                    key === 'none'
                      ? 'Everything in one section'
                      : key === 'building'
                        ? 'One section per building'
                        : !active
                          ? 'Top floor first'
                          : blueprint.preset === 'floor-desc'
                            ? '↓ Top floor first — click to flip'
                            : '↑ Ground floor first — click to flip';
                  const nextPreset: SectionPreset = isFloor
                    ? active && blueprint.preset === 'floor-desc'
                      ? 'floor-asc'
                      : 'floor-desc'
                    : (key as SectionPreset);
                  return (
                    <button
                      key={key}
                      onClick={() => setPreset(nextPreset)}
                      aria-pressed={active}
                      className={
                        'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left border transition-colors ' +
                        (active
                          ? 'border-accent bg-accent/10'
                          : 'border-line hover:border-weak hover:bg-rowhover')
                      }
                    >
                      <Dot color={color} size={11} />
                      <span className="min-w-0">
                        <span className="block text-sm text-fg">{label}</span>
                        <span className="block text-xs text-weak">{desc}</span>
                      </span>
                      {active && <span className="ml-auto text-accent text-xs font-medium">✓</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-weak mt-3">Regrouping resets any manual changes.</p>
            </fieldset>

            {blueprint.preset !== 'none' && (
              <div>
                <label htmlFor="section-template" className="text-xs font-semibold uppercase tracking-wide text-weak block mb-2">
                  Section names
                </label>
                <input
                  id="section-template"
                  ref={templateInput}
                  value={blueprint.template}
                  onChange={e => setTemplate(e.target.value)}
                  className="room-code w-full bg-raised border border-line rounded-md px-3 py-2"
                />
                <p className="text-xs text-weak mt-2">Click to insert:</p>
                {varChips(templateInput.current, blueprint.template, setTemplate, byFloor)}
                {blueprint.template !== PRESET_DEFAULT_TEMPLATE[blueprint.preset] && (
                  <button
                    onClick={() => setTemplate(PRESET_DEFAULT_TEMPLATE[blueprint.preset])}
                    className="text-xs text-accent hover:underline mt-3"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ------- One section ------- */}
        {section && (
          <>
            <div>
              <label htmlFor="section-name" className="text-xs font-semibold uppercase tracking-wide text-weak block mb-2">
                Section name
              </label>
              <input
                id="section-name"
                ref={nameInput}
                value={nameDraft}
                onChange={e => applyName(e.target.value)}
                className="room-code w-full bg-raised border border-line rounded-md px-3 py-2"
              />
              <p className="text-xs text-weak mt-2">Click to insert:</p>
              {varChips(nameInput.current, nameDraft, applyName, true)}
              {renderedName !== nameDraft.trim() && (
                <p className="text-xs mt-2 text-weak">
                  Becomes{' '}
                  <span className="room-code text-fg bg-raised border border-line rounded px-1.5 py-0.5">
                    {renderedName || 'Untitled section'}
                  </span>
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-weak mb-2">
                Sort tasks
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {SORTS.map(({ mode, label, color }) => (
                  <button
                    key={mode}
                    onClick={() => {
                      sortSection(section.id, mode);
                      setFlash(mode);
                    }}
                    className={
                      'border rounded-md px-2 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ' +
                      (flash === mode
                        ? 'border-ok text-ok'
                        : 'border-line text-weak hover:text-fg hover:border-weak')
                    }
                  >
                    {flash === mode ? (
                      'Sorted ✓'
                    ) : (
                      <>
                        <Dot color={color} size={8} />
                        {label}
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {breakups.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-weak mb-1">
                  Break this section up
                </p>
                <p className="text-xs text-weak mb-2">
                  Moves its tasks into their own sections. Other sections aren't touched.
                </p>
                <div className="space-y-1.5">
                  {breakups.map(({ preset, label, groups }) => (
                    <button
                      key={preset}
                      onClick={() => {
                        splitSection(section.id, preset, PRESET_DEFAULT_TEMPLATE[preset]);
                        setScope('project');
                      }}
                      className="w-full text-left border border-line rounded-md px-3 py-2 hover:border-accent hover:bg-accent/10"
                    >
                      <span className="flex items-center justify-between text-sm text-fg">
                        {label}
                        <span className="text-xs text-weak">{groups.length} sections</span>
                      </span>
                      <span className="flex items-center gap-2.5 mt-1.5 min-w-0">
                        {groups.slice(0, 3).map((g, i) => (
                          <span key={g.name} className="flex items-center gap-1 min-w-0 text-[11px] text-weak">
                            <Dot color={PILL_COLORS[i % PILL_COLORS.length]} size={8} />
                            <span className="truncate max-w-24">{g.name}</span>
                          </span>
                        ))}
                        {groups.length > 3 && (
                          <span className="text-[11px] text-weak shrink-0">+{groups.length - 3}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
