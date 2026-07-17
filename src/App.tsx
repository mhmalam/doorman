import { useEffect } from 'react';
import { useStore } from './store';
import { BuildPage } from './pages/BuildPage';
import { ListGlyph, XIcon } from './components/icons';
import { RunTray } from './components/RunTray';

/** Transient confirmation pop-up (auto-dismisses). */
function Toast() {
  const toast = useStore(s => s.toast);
  const setToast = useStore(s => s.setToast);
  const hasUndo = useStore(s => !!s.pendingUndo);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div
      className={
        'fixed left-6 z-[60] bg-raised border border-line rounded-lg shadow-2xl px-4 py-2 text-sm flex items-center gap-2 ' +
        (hasUndo ? 'bottom-20' : 'bottom-6')
      }
    >
      <span className="w-2 h-2 rounded-full bg-ok inline-block" />
      {toast}
    </div>
  );
}

/** Post-delete pop-up with a 10-second Undo window. */
function UndoToast() {
  const pendingUndo = useStore(s => s.pendingUndo);
  const undoDelete = useStore(s => s.undoDelete);
  const clearUndo = useStore(s => s.clearUndo);
  useEffect(() => {
    if (!pendingUndo) return;
    const snapshot = pendingUndo;
    const t = setTimeout(() => {
      // Only dismiss if a newer delete hasn't replaced this one.
      if (useStore.getState().pendingUndo === snapshot) clearUndo();
    }, 10000);
    return () => clearTimeout(t);
  }, [pendingUndo, clearUndo]);
  if (!pendingUndo) return null;
  return (
    <div className="fixed bottom-6 left-6 z-[60] bg-raised border border-line rounded-lg shadow-2xl pl-4 pr-2 py-2 text-sm flex items-center gap-3">
      <span className="w-2 h-2 rounded-full bg-danger inline-block" />
      {pendingUndo.label}
      <button
        onClick={undoDelete}
        className="text-accent font-medium hover:bg-accent/15 rounded px-2.5 py-1"
      >
        Undo
      </button>
      <button onClick={clearUndo} className="text-weak hover:text-fg text-xs px-1" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function App() {
  const savedList = useStore(s => s.savedList);
  const currentId = useStore(s => s.currentId);
  const newProject = useStore(s => s.newProject);
  const loadProject = useStore(s => s.loadProject);
  const deleteProject = useStore(s => s.deleteProject);

  return (
    <div className="flex flex-col md:flex-row h-full">
      <nav className="shrink-0 bg-sidebar flex md:flex-col md:w-56 border-b md:border-b-0 md:border-r border-linesoft min-h-0">
        <div className="flex items-center gap-2.5 px-4 h-14 md:border-b border-linesoft shrink-0">
          <span className="w-7 h-7 rounded-lg bg-coral flex items-center justify-center text-white shrink-0">
            <ListGlyph size={16} />
          </span>
          <p className="font-display font-semibold tracking-tight leading-tight">Mohammed's Builder</p>
        </div>

        <div className="flex md:flex-col md:flex-1 md:min-h-0 items-center md:items-stretch gap-1 p-2 overflow-x-auto md:overflow-x-visible">
          <button
            onClick={newProject}
            className={
              'shrink-0 text-left px-3 py-2.5 md:py-1.5 rounded-md text-sm whitespace-nowrap ' +
              (currentId === null ? 'bg-activebg text-fg font-medium' : 'text-weak hover:bg-rowhover hover:text-fg')
            }
          >
            Home
          </button>

          {savedList.length > 0 && (
            <p className="max-md:hidden text-[10px] uppercase tracking-wide text-weak/70 px-3 mt-3 mb-1">
              Projects
            </p>
          )}
          <div className="flex md:flex-col gap-1 md:gap-0.5 md:overflow-y-auto md:min-h-0">
            {savedList.map(p => (
              <div
                key={p.id}
                className={
                  'group flex items-center rounded-md shrink-0 md:shrink ' +
                  (currentId === p.id ? 'bg-activebg' : 'hover:bg-rowhover')
                }
              >
                <button
                  onClick={() => loadProject(p.id)}
                  className={
                    'flex-1 min-w-0 text-left px-3 py-2.5 md:py-1.5 text-sm ' +
                    (currentId === p.id ? 'text-fg font-medium' : 'text-weak hover:text-fg')
                  }
                >
                  <span className="block truncate max-w-40">{p.title}</span>
                  <span className="block text-[10px] text-weak/70 max-md:hidden">{timeAgo(p.savedAt)}</span>
                </button>
                <button
                  onClick={() => deleteProject(p.id)}
                  className="opacity-0 group-hover:opacity-100 text-weak hover:text-danger p-1.5 mr-1 shrink-0"
                  aria-label={`Delete ${p.title}`}
                >
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </nav>
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <BuildPage />
      </main>
      <Toast />
      <UndoToast />
      <RunTray />
    </div>
  );
}
