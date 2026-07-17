// Compact bottom-right progress card for create/apply runs. The app stays
// fully usable while a run is in flight; when it finishes, the staging is
// re-synced from Asana so gids stay fresh and the deletion queue clears.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export interface RunProgress {
  phase: 'starting' | 'project' | 'sections' | 'tasks' | 'done' | 'failed';
  total: number;
  done: number;
  errors: string[];
  warnings: string[];
  projectUrl?: string;
  projectGid?: string;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(5, Math.round(seconds / 5) * 5)}s left`;
  return `~${Math.round(seconds / 60)} min left`;
}

export function RunTray() {
  const activeRun = useStore(s => s.activeRun);
  const setActiveRun = useStore(s => s.setActiveRun);
  const setLinkedProject = useStore(s => s.setLinkedProject);
  const syncFromAsana = useStore(s => s.syncFromAsana);

  const [progress, setProgress] = useState<RunProgress | null>(null);
  const startedAt = useRef(0);
  const finishedHandled = useRef(false);

  useEffect(() => {
    if (!activeRun) {
      setProgress(null);
      return;
    }
    startedAt.current = Date.now();
    finishedHandled.current = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/build/${activeRun.runId}`);
        if (!res.ok) return;
        const p: RunProgress = await res.json();
        setProgress(p);
        if ((p.phase === 'done' || p.phase === 'failed') && !finishedHandled.current) {
          finishedHandled.current = true;
          clearInterval(timer);
          if (p.phase === 'done' && p.projectGid) {
            setLinkedProject(p.projectGid, p.projectUrl);
            try {
              const snap = await fetch(`/api/project/${p.projectGid}/snapshot`);
              if (snap.ok) syncFromAsana(await snap.json());
            } catch {
              // best-effort; the Sync button covers it
            }
          }
          // Success card lingers briefly, then dismisses itself — unless a
          // newer run has taken over the tray in the meantime.
          if (p.phase === 'done' && p.errors.length === 0) {
            const thisRun = activeRun.runId;
            setTimeout(() => {
              if (useStore.getState().activeRun?.runId === thisRun) {
                useStore.getState().setActiveRun(null);
              }
            }, 6000);
          }
        }
      } catch {
        // keep polling
      }
    }, 800);
    return () => clearInterval(timer);
  }, [activeRun, setLinkedProject, syncFromAsana]);

  if (!activeRun) return null;

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const running = !progress || (progress.phase !== 'done' && progress.phase !== 'failed');
  const label = activeRun.mode === 'apply' ? 'Applying to Asana' : 'Creating in Asana';
  const elapsed = (Date.now() - startedAt.current) / 1000;
  const eta =
    running && progress && progress.done >= 5 && elapsed > 3
      ? formatEta((progress.total - progress.done) / (progress.done / elapsed))
      : null;

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-80 bg-raised border border-line rounded-lg shadow-2xl p-3.5">
      <div className="flex items-center gap-2.5">
        {running && (
          <span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />
        )}
        {!running && progress?.phase === 'done' && (
          <span className="w-4 h-4 rounded-full bg-ok text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            ✓
          </span>
        )}
        {!running && progress?.phase === 'failed' && (
          <span className="w-4 h-4 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            !
          </span>
        )}
        <span className="text-sm font-medium truncate">
          {running ? label : progress?.phase === 'done' ? 'Done' : 'Failed'}
        </span>
        <span className="ml-auto text-xs text-weak tabular-nums shrink-0">
          {progress ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : '…'}
        </span>
        <button
          onClick={() => setActiveRun(null)}
          className="text-weak hover:text-fg text-xs px-1 shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="h-1.5 bg-app rounded-full overflow-hidden border border-linesoft mt-2.5">
        <div
          className={
            'h-full rounded-full transition-[width] duration-500 ease-out ' +
            (progress?.phase === 'failed' ? 'bg-danger' : progress?.phase === 'done' ? 'bg-ok' : 'bg-accent')
          }
          style={{ width: `${progress?.phase === 'done' ? 100 : pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-xs text-weak">
        <span className="tabular-nums">{progress?.phase === 'done' ? '100%' : `${pct}%`}</span>
        <span>{eta ?? ''}</span>
        {progress?.projectUrl && progress.phase === 'done' && (
          <a href={progress.projectUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Open in Asana ↗
          </a>
        )}
      </div>
      {progress && progress.errors.length > 0 && (
        <p className="text-xs text-danger mt-1.5">
          {progress.errors.length} error{progress.errors.length === 1 ? '' : 's'} — {progress.errors[0].slice(0, 80)}
        </p>
      )}
      {progress?.warnings.slice(0, 1).map((w, i) => (
        <p key={i} className="text-xs text-warn mt-1.5">{w.slice(0, 100)}</p>
      ))}
    </div>
  );
}
