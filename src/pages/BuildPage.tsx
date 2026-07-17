import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { extractProjectGid } from '../core/importers';
import { AsanaSnapshot, useStore } from '../store';
import { AsanaProject } from '../components/AsanaProject';
import { PILL_COLORS } from '../components/fields';
import { BrandTile } from '../components/Brand';

export function BuildPage() {
  const hasProject = useStore(s => !!s.staging);
  return hasProject ? <AsanaProject /> : <EmptyState />;
}

function EmptyState() {
  const loadFile = useStore(s => s.loadFile);
  const loadAsana = useStore(s => s.loadAsana);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      loadFile(rows, file.name);
    },
    [loadFile],
  );

  const importFromAsana = useCallback(async () => {
    setError(null);
    const gid = extractProjectGid(url);
    if (!gid) {
      setError("That doesn't look like an Asana project link.");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch(`/api/project/${gid}/snapshot`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg: string = body?.errors?.[0]?.message ?? `Asana returned an error (${res.status}).`;
        setError(
          msg.includes('ASANA_TOKEN')
            ? 'The server has no Asana access token yet — add ASANA_TOKEN to the server .env and restart it.'
            : msg,
        );
        return;
      }
      loadAsana(body as AsanaSnapshot);
    } catch {
      setError("Couldn't reach the Doorman server. Make sure it's running (npm run dev:server).");
    } finally {
      setImporting(false);
    }
  }, [url, loadAsana]);

  return (
    <div className="h-full overflow-auto">
      <div className="min-h-full flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-xl">
          <div className="mb-8">
            <div className="flex items-center gap-4">
              <BrandTile size={56} icon={30} className="rounded-2xl -rotate-6 shadow-xl shadow-coral/20" />
              <div className="min-w-0">
                <h1 className="font-display font-bold tracking-tight text-3xl leading-tight">
                  Asana made eZ
                </h1>
                <p className="text-weak text-sm font-medium mt-0.5">Mohammed's Builder</p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-5" aria-hidden>
              {PILL_COLORS.slice(0, 9).map((c, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full"
                  style={{ background: c, width: `${22 + ((i * 17) % 26)}px` }}
                />
              ))}
            </div>
          </div>

          <div
            className={
              'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ' +
              (dragOver ? 'border-accent bg-accent/10' : 'border-line bg-raised hover:border-weak')
            }
            onClick={() => fileInput.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
          >
            <p className="font-medium">Drop your spreadsheet here</p>
            <p className="text-weak text-sm mt-1">Excel or CSV — or click to browse.</p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,.xls"
              className="hidden"
              aria-label="Upload a spreadsheet of rooms"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="flex items-center gap-3 my-5">
            <span className="flex-1 h-px bg-linesoft" />
            <span className="text-weak text-xs uppercase tracking-[0.14em]">or import from Asana</span>
            <span className="flex-1 h-px bg-linesoft" />
          </div>

          <label htmlFor="asana-url" className="sr-only">
            Asana project link
          </label>
          <div className="flex gap-2">
            <input
              id="asana-url"
              type="url"
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && !importing && url.trim() && importFromAsana()}
              placeholder="Paste an Asana project link — https://app.asana.com/…"
              className="flex-1 min-w-0 bg-raised border border-line rounded-lg px-3 py-2 text-sm placeholder:text-weak/60"
            />
            <button
              onClick={importFromAsana}
              disabled={importing || !url.trim()}
              className="bg-accent text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-40"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
          {error && <p className="text-danger text-sm mt-2">{error}</p>}

          <p className="text-center mt-6">
            <button
              onClick={() => useStore.getState().newBlankProject()}
              className="text-sm text-weak hover:text-fg underline underline-offset-4"
            >
              …or start blank and add rooms later
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
