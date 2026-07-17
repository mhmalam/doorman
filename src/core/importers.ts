// Spreadsheet/paste → parsed room list. Pure functions over row arrays;
// actual xlsx decoding happens in the UI layer (SheetJS) and feeds rows here.

import { BuildingDef, matchBuilding, REGISTRY } from './registry';
import { parseRoom, ParsedRoom } from './parser';

export interface ImportResult {
  rooms: ParsedRoom[];
  /** Column index rooms were read from (for the override UI). */
  column: number;
  /** Ratio of cells in that column that matched a registry prefix. */
  matchRatio: number;
  /** Non-empty cells that were skipped (headers, group labels, etc.). */
  skipped: string[];
}

/**
 * Detect the room column: the one with the highest count of registry-prefix
 * matches. Handles both real-export layouts — grouped (building label in
 * col A once per group, rooms in col B) and flat two-column.
 */
export function detectRoomColumn(
  rows: unknown[][],
  registry: BuildingDef[] = REGISTRY,
): { column: number; hits: number } {
  const width = Math.max(0, ...rows.map(r => r.length));
  let bestCol = 0;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (const row of rows) {
      const v = row[c];
      if (typeof v === 'string' && v.trim() && matchBuilding(v, registry)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = c;
    }
  }
  return { column: bestCol, hits: bestHits };
}

/** Extract and parse rooms from tabular rows, using a given or detected column. */
export function importRows(
  rows: unknown[][],
  registry: BuildingDef[] = REGISTRY,
  columnOverride?: number,
): ImportResult {
  const detected = detectRoomColumn(rows, registry);
  const column = columnOverride ?? detected.column;

  const rooms: ParsedRoom[] = [];
  const skipped: string[] = [];
  let nonEmpty = 0;
  let matched = 0;

  for (const row of rows) {
    const v = row[column];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).trim();
    if (!s) continue;
    nonEmpty++;
    const parsed = parseRoom(s, registry);
    if (parsed.building) matched++;
    // Unknown-prefix rows still flow through (surfaced for user assignment),
    // but obvious group labels / headers containing no digits are skipped.
    if (!parsed.building && !/\d/.test(s)) {
      skipped.push(s);
      continue;
    }
    rooms.push(parsed);
  }

  return {
    rooms,
    column,
    matchRatio: nonEmpty ? matched / nonEmpty : 0,
    skipped,
  };
}

/** Pasted text → rows. Tab- or comma-separated columns; one row per line. */
export function pasteToRows(text: string): unknown[][] {
  return text
    .split(/\r?\n/)
    .map(line => (line.includes('\t') ? line.split('\t') : [line]))
    .filter(row => row.some(cell => String(cell).trim()));
}

/** Extract an Asana project GID from any URL form the app accepts. */
export function extractProjectGid(url: string): string | null {
  const trimmed = url.trim();
  // https://app.asana.com/0/{project_gid}/{task_gid}
  let m = trimmed.match(/app\.asana\.com\/0\/(\d{6,})/);
  if (m) return m[1];
  // https://app.asana.com/1/{workspace}/project/{project_gid}/...
  m = trimmed.match(/\/project\/(\d{6,})/);
  if (m) return m[1];
  // Bare GID pasted directly
  m = trimmed.match(/^(\d{6,})$/);
  if (m) return m[1];
  return null;
}
