// Insert rooms into the ACTIVE project from a spreadsheet — whole buildings,
// whole floors, shift-click ranges, or single rooms.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { importRows } from '../core/importers';
import { floorLabel, floorSortKey, ParsedRoom } from '../core/parser';
import { useStore } from '../store';
import { Caret } from './icons';
import { Checkbox } from './Checkbox';

interface FloorGroup {
  key: string;
  label: string;
  rooms: ParsedRoom[];
}

interface BuildingGroup {
  name: string;
  floors: FloorGroup[];
  all: ParsedRoom[];
}

function groupRooms(rooms: ParsedRoom[]): BuildingGroup[] {
  const buildings = new Map<string, Map<string, FloorGroup>>();
  for (const room of rooms) {
    const bName = room.building?.name ?? 'Unrecognized';
    let floors = buildings.get(bName);
    if (!floors) {
      floors = new Map();
      buildings.set(bName, floors);
    }
    const fKey = room.floor === null ? '!' : String(room.floor);
    let f = floors.get(fKey);
    if (!f) {
      f = { key: fKey, label: room.floor === null ? 'No floor' : floorLabel(room.floor), rooms: [] };
      floors.set(fKey, f);
    }
    f.rooms.push(room);
  }
  return [...buildings.entries()]
    .map(([name, floors]) => {
      const sorted = [...floors.values()].sort((a, b) => {
        if (a.key === '!') return 1;
        if (b.key === '!') return -1;
        return floorSortKey(a.rooms[0].floor!) - floorSortKey(b.rooms[0].floor!);
      });
      return { name, floors: sorted, all: sorted.flatMap(f => f.rooms) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function InsertRoomsModal({ onClose }: { onClose: () => void }) {
  const staging = useStore(s => s.staging) ?? [];
  const addTasksBulk = useStore(s => s.addTasksBulk);
  const addSection = useStore(s => s.addSection);

  const [rooms, setRooms] = useState<ParsedRoom[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  /** Name of the server-side occupancy report; null until it loads once. */
  const [occName, setOccName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<string>('new');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOcc, setLoadingOcc] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  // For shift-click ranges: last clicked room within a building's flat list.
  const lastPick = useRef<{ building: string; index: number } | null>(null);

  const loadOccupancy = async () => {
    setLoadError(null);
    setLoadingOcc(true);
    try {
      const res = await fetch('/api/occupancy');
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body?.errors?.[0]?.message ?? `Error ${res.status}`);
        return;
      }
      setRooms(importRows(body.rows).rooms);
      setFileName(body.name);
      setOccName(body.name);
      setPicked(new Set());
      lastPick.current = null;
    } catch {
      setLoadError("Couldn't reach the Doorman server.");
    } finally {
      setLoadingOcc(false);
    }
  };

  // The occupancy report is the baseline — load it as soon as the modal opens.
  useEffect(() => {
    void loadOccupancy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: null,
    });
    setRooms(importRows(rows).rooms);
    setFileName(file.name);
    setPicked(new Set());
    lastPick.current = null;
  };

  const stagedNames = useMemo(
    () => new Set(staging.flatMap(s => s.tasks.map(t => t.name))),
    [staging],
  );

  const buildings = useMemo(() => (rooms ? groupRooms(rooms) : []), [rooms]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return buildings;
    return buildings
      .map(b => {
        if (b.name.toLowerCase().includes(q)) return b;
        const floors = b.floors
          .map(f => ({ ...f, rooms: f.rooms.filter(r => r.raw.toLowerCase().includes(q)) }))
          .filter(f => f.rooms.length);
        return { ...b, floors, all: floors.flatMap(f => f.rooms) };
      })
      .filter(b => b.all.length);
  }, [buildings, q]);

  const setMany = (raws: string[], on: boolean) =>
    setPicked(prev => {
      const next = new Set(prev);
      for (const r of raws) on ? next.add(r) : next.delete(r);
      return next;
    });

  const clickRoom = (e: React.MouseEvent, building: BuildingGroup, room: ParsedRoom) => {
    e.preventDefault();
    const flatList = building.all;
    const index = flatList.findIndex(r => r.raw === room.raw);
    const turningOn = !picked.has(room.raw);
    if (e.shiftKey && lastPick.current?.building === building.name && lastPick.current.index >= 0) {
      const [lo, hi] =
        lastPick.current.index < index
          ? [lastPick.current.index, index]
          : [index, lastPick.current.index];
      setMany(flatList.slice(lo, hi + 1).map(r => r.raw), turningOn);
    } else {
      setMany([room.raw], turningOn);
    }
    lastPick.current = { building: building.name, index };
  };

  const toggleExpand = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const insert = () => {
    const names = [...picked].map(r => r.trim()).filter(n => !stagedNames.has(n));
    if (!names.length) {
      onClose();
      return;
    }
    const sectionId = destination === 'new' ? addSection('Untitled section', 0) : destination;
    addTasksBulk(sectionId, names);
    onClose();
  };

  const duplicates = [...picked].filter(r => stagedNames.has(r.trim())).length;
  const toInsert = Math.max(0, picked.size - duplicates);

  const triState = (all: ParsedRoom[]) => {
    const count = all.filter(r => picked.has(r.raw)).length;
    return { checked: count > 0 && count === all.length, some: count > 0 && count < all.length };
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-raised border border-linesoft rounded-lg shadow-2xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 pb-3 shrink-0">
          <h2 className="text-base font-semibold">Insert rooms</h2>
          <p className="text-sm text-weak mt-1">
            Check a building, a floor, or single rooms — shift-click selects a range.
          </p>
        </div>

        <div className="px-5 flex items-center gap-2 shrink-0">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search buildings or rooms…"
            className="flex-1 bg-app border border-line rounded px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="border border-line rounded px-3 py-1.5 text-xs font-medium text-weak hover:text-fg shrink-0"
          >
            Upload…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.xls"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
        {fileName && (
          <p className="px-5 text-xs text-weak mt-2 truncate shrink-0 leading-normal">
            From {fileName}
            {occName && fileName !== occName && (
              <button onClick={loadOccupancy} className="text-accent hover:underline ml-2">
                Back to occupancy report
              </button>
            )}
          </p>
        )}
        {loadError && <p className="px-5 text-xs text-danger mt-2 shrink-0">{loadError}</p>}

        <div className="flex-1 overflow-auto px-5 py-3 min-h-40 select-none">
          {loadingOcc && !rooms && <p className="text-sm text-weak">Loading the occupancy report…</p>}
          {!loadingOcc && !rooms && (
            <p className="text-sm text-weak">
              Couldn't load the occupancy report — upload a spreadsheet instead.
            </p>
          )}
          {rooms && visible.length === 0 && <p className="text-sm text-weak">No matches.</p>}
          {visible.map(b => {
            const bState = triState(b.all);
            const bOpen = expanded.has(b.name) || !!q;
            return (
              <div key={b.name} className="mb-0.5">
                <div className="flex items-center gap-2 py-1">
                  <button onClick={() => toggleExpand(b.name)} className="text-weak hover:text-fg p-0.5">
                    <Caret open={bOpen} />
                  </button>
                  <Checkbox
                    checked={bState.checked}
                    indeterminate={bState.some}
                    onClick={() => setMany(b.all.map(r => r.raw), !bState.checked)}
                    label={`Select all of ${b.name}`}
                    size={16}
                  />
                  <span className="text-sm font-medium">{b.name}</span>
                  <span className="text-xs text-weak">{b.all.length}</span>
                </div>
                {bOpen &&
                  b.floors.map(f => {
                    const fKey = `${b.name}|${f.key}`;
                    const fState = triState(f.rooms);
                    const fOpen = expanded.has(fKey) || !!q;
                    return (
                      <div key={fKey} className="ml-7">
                        <div className="flex items-center gap-2 py-0.5">
                          <button onClick={() => toggleExpand(fKey)} className="text-weak hover:text-fg p-0.5">
                            <Caret open={fOpen} size={10} />
                          </button>
                          <Checkbox
                            checked={fState.checked}
                            indeterminate={fState.some}
                            onClick={() => setMany(f.rooms.map(r => r.raw), !fState.checked)}
                            label={`Select all of ${b.name} ${f.label}`}
                            size={14}
                          />
                          <span className="text-sm">{f.label}</span>
                          <span className="text-xs text-weak">{f.rooms.length}</span>
                        </div>
                        {fOpen && (
                          <div className="ml-10 grid grid-cols-2 gap-x-4">
                            {f.rooms.map(r => (
                              <label
                                key={r.raw}
                                onClick={e => clickRoom(e, b, r)}
                                className="flex items-center gap-2 py-0.5 cursor-pointer"
                              >
                                <Checkbox checked={picked.has(r.raw)} size={14} visualOnly />
                                <span className="room-code truncate">
                                  {r.raw.trim()}
                                  {stagedNames.has(r.raw.trim()) && (
                                    <span className="text-weak text-[10px] ml-1.5">already in project</span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>

        <div className="border-t border-linesoft p-4 flex items-center gap-3 shrink-0">
          <label className="text-xs text-weak shrink-0">Add to</label>
          <select
            value={destination}
            onChange={e => setDestination(e.target.value)}
            className="bg-app border border-line rounded px-2 py-1.5 text-sm max-w-56 truncate"
          >
            <option value="new">New Untitled section</option>
            {staging.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-3">
            {duplicates > 0 && (
              <span className="text-[11px] text-weak">{duplicates} already in project — skipped</span>
            )}
            <button onClick={onClose} className="px-3 h-8 text-sm rounded-md text-weak hover:text-fg hover:bg-rowhover">
              Cancel
            </button>
            <button
              onClick={insert}
              disabled={toInsert <= 0}
              className="px-3 h-8 text-sm font-medium rounded-md bg-accent text-white disabled:opacity-40"
            >
              Insert {toInsert} room{toInsert === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
