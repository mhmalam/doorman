// Create/Apply confirmation. Apply mode diffs against the last-sync baseline
// and pushes only what changed — unchanged tasks are left alone. The run
// itself is non-blocking: progress lives in the RunTray.

import { useMemo, useState } from 'react';
import { taskSig, useStore } from '../store';

export function ApplyModal({ onClose }: { onClose: () => void }) {
  const title = useStore(s => s.title);
  const staging = useStore(s => s.staging) ?? [];
  const linkedProjectGid = useStore(s => s.linkedProjectGid);
  const baseline = useStore(s => s.baseline);
  const deletedTaskGids = useStore(s => s.deletedTaskGids);
  const deletedSectionGids = useStore(s => s.deletedSectionGids);
  const setActiveRun = useStore(s => s.setActiveRun);
  const columns = useStore(s => s.columns);
  const fieldDefs = useStore(s => s.fieldDefs);

  const mode: 'create' | 'apply' = linkedProjectGid ? 'apply' : 'create';
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const realFields = useMemo(
    () =>
      columns
        .filter(c => c.startsWith('f:'))
        .map(c => fieldDefs[c.slice(2)])
        .filter(Boolean)
        .filter(f => !f.gid.startsWith('sample-')),
    [columns, fieldDefs],
  );
  const sampleFields = columns.filter(c => c.startsWith('f:')).length - realFields.length;

  const cleanFields = (fields?: Record<string, string | number>) =>
    fields
      ? Object.fromEntries(Object.entries(fields).filter(([gid]) => !gid.startsWith('sample-')))
      : undefined;

  // Delta plan: unchanged tasks (same content, same section, same order as at
  // last sync) are skipped entirely.
  const plan = useMemo(() => {
    let updates = 0;
    let creates = 0;
    let unchanged = 0;
    let reorders = 0;
    const titleChanged =
      mode === 'apply' && baseline?.title !== undefined && title !== baseline.title;
    // Whole-section moves: current section-gid sequence vs last sync.
    const currentSectionSeq = staging.map(s => s.asanaGid).filter(Boolean) as string[];
    const baseSectionSeq = baseline?.projectSectionOrder?.filter(g =>
      currentSectionSeq.includes(g),
    );
    const sectionOrderChanged =
      mode === 'apply' &&
      !!baseSectionSeq &&
      JSON.stringify(currentSectionSeq) !== JSON.stringify(baseSectionSeq);
    const sections = staging
      .map(s => {
        // A section is "reordered" when its surviving Asana tasks are in a
        // different sequence than at last sync.
        const gidSeq = s.tasks.map(t => t.asanaGid).filter(Boolean) as string[];
        const baseSeq = s.asanaGid ? baseline?.sectionOrder?.[s.asanaGid] : undefined;
        const reordered =
          mode === 'apply' &&
          !!baseSeq &&
          JSON.stringify(gidSeq) !==
            JSON.stringify(baseSeq.filter(g => gidSeq.includes(g)));
        if (reordered) reorders++;

        const tasks = s.tasks
          .filter(t => {
            if (mode === 'create') {
              creates++;
              return true;
            }
            if (!t.asanaGid) {
              creates++;
              return true;
            }
            const base = baseline?.tasks[t.asanaGid];
            const moved = !base || (s.asanaGid ?? null) !== base.sectionGid;
            const changed = !base || taskSig(t) !== base.sig;
            if (moved || changed) {
              updates++;
              return true;
            }
            unchanged++;
            return false;
          })
          .map(t => ({
            gid: t.asanaGid,
            name: t.name,
            completed: !!t.completed,
            due: t.due,
            fields: cleanFields(t.fields),
          }));
        return {
          gid: s.asanaGid,
          name: s.name,
          rename:
            mode === 'apply' && !!s.asanaGid && baseline?.sections[s.asanaGid] !== s.name,
          tasks,
          ...(reordered ? { orderedGids: gidSeq } : {}),
        };
      })
      .filter(
        s =>
          mode === 'create' ||
          sectionOrderChanged || // full section list needed to reposition
          !s.gid || // new section → create
          s.tasks.length > 0 || // has changes to push
          'orderedGids' in s || // needs reordering
          baseline?.sections[s.gid] !== s.name, // renamed
      );
    return { sections, updates, creates, unchanged, reorders, titleChanged, sectionOrderChanged };
  }, [staging, baseline, mode, title]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(mode === 'apply' ? '/api/apply' : '/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'apply'
            ? {
                projectGid: linkedProjectGid,
                // Only touch the project record when the name actually changed —
                // task edits alone must not require project-level permissions.
                title: plan.titleChanged ? title : undefined,
                fieldGids: realFields.map(f => f.gid),
                sections: plan.sections,
                reorderSections: plan.sectionOrderChanged,
                deleteTaskGids: deletedTaskGids,
                deleteSectionGids: deletedSectionGids,
              }
            : {
                title: title || 'Untitled project',
                fieldGids: realFields.map(f => f.gid),
                sections: plan.sections,
              },
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.errors?.[0]?.message ?? `Server error ${res.status}`);
        return;
      }
      setActiveRun({ runId: body.runId, mode });
      onClose();
    } catch {
      setError("Couldn't reach the Doorman server. Make sure it's running (npm run dev:server).");
    } finally {
      setStarting(false);
    }
  };

  const nothingToDo =
    mode === 'apply' &&
    plan.updates === 0 &&
    plan.creates === 0 &&
    plan.reorders === 0 &&
    !plan.titleChanged &&
    !plan.sectionOrderChanged &&
    deletedTaskGids.length === 0 &&
    deletedSectionGids.length === 0 &&
    plan.sections.every(s => s.gid && baseline?.sections[s.gid] === s.name);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-md bg-raised border border-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-lg">{mode === 'apply' ? 'Apply to Asana' : 'Create in Asana'}</h2>

        {mode === 'apply' ? (
          nothingToDo ? (
            <p className="text-sm text-weak mt-2">Everything already matches Asana — nothing to push.</p>
          ) : (
            <p className="text-sm text-weak mt-2">
              Pushes only what changed: {plan.updates.toLocaleString()} update
              {plan.updates === 1 ? '' : 's'}
              {plan.creates > 0 && `, ${plan.creates.toLocaleString()} new`}
              {plan.titleChanged && ', the project name'}
              {plan.reorders > 0 && `, reorders ${plan.reorders} section${plan.reorders === 1 ? '' : 's'}`}
              {plan.sectionOrderChanged && ', moves sections'}
              {deletedTaskGids.length > 0 && (
                <span className="text-danger">
                  , {deletedTaskGids.length.toLocaleString()} deletion
                  {deletedTaskGids.length === 1 ? '' : 's'}
                </span>
              )}
              {deletedSectionGids.length > 0 && (
                <span className="text-danger">
                  , {deletedSectionGids.length} section deletion{deletedSectionGids.length === 1 ? '' : 's'}
                </span>
              )}
              . {plan.unchanged.toLocaleString()} unchanged task{plan.unchanged === 1 ? '' : 's'} left alone.
            </p>
          )
        ) : (
          <p className="text-sm text-weak mt-2">
            Creates a new project "{title || 'Untitled project'}" with {staging.length} section
            {staging.length === 1 ? '' : 's'} and {plan.creates.toLocaleString()} task
            {plan.creates === 1 ? '' : 's'}
            {realFields.length > 0 && `, ${realFields.length} custom field${realFields.length === 1 ? '' : 's'}`}.
          </p>
        )}
        {sampleFields > 0 && (
          <p className="text-xs text-warn mt-2">
            {sampleFields} sample field{sampleFields === 1 ? '' : 's'} will be skipped.
          </p>
        )}
        {error && <p className="text-sm text-danger mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-md border border-line text-weak hover:text-fg">
            Cancel
          </button>
          <button
            onClick={start}
            disabled={starting || nothingToDo}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-accent text-white disabled:opacity-40"
          >
            {starting ? 'Starting…' : mode === 'apply' ? 'Apply changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
