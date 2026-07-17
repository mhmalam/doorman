// Pure room-string parsing: room string → { prefix, core, slot, tags, floor, confidence }.
// No I/O, no state — every function here is unit-testable in isolation.

import { BuildingDef, FloorRuleId, matchBuilding, REGISTRY } from './registry';

export type Floor = number | 'Ground' | 'Garden' | 'Mezzanine' | 'Townhouse';

export type Confidence = 'exact' | 'assumed' | 'unknown';

/** Machine-readable cause when confidence < exact — the UI turns these into plain English. */
export type RoomIssueReason =
  | 'no-prefix'
  | 'empty-core'
  | 'no-floor'
  | 'odd-core'
  | 'unknown-tag';

export interface ParsedRoom {
  /** Original input string, untouched. */
  raw: string;
  building: BuildingDef | null;
  /** Room identifier after the prefix, before the slot (e.g. "1119", "21A", "602/4"). */
  core: string;
  /** Occupant/bed number from the trailing "-N" group, if present. */
  slot: string | null;
  /** Normalized suffix tags (RA, SIC, FSL, ...). */
  tags: string[];
  floor: Floor | null;
  confidence: Confidence;
  /** Human-readable note when confidence < exact. */
  note?: string;
  reason?: RoomIssueReason;
  /** Suffix tokens that didn't normalize to a known tag. */
  unknownTags?: string[];
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Known tags, keyed by their normalized form; values are accepted raw spellings. */
const TAG_ALIASES: Record<string, string[]> = {
  RA:  ['RA', 'RAR'],
  SIC: ['SIC'],
  FSL: ['FSL'],
  RHD: ['RHD', 'RHDR'],
  AD:  ['AD', 'ADR'],
  GHD: ['GHD'],
  FIR: ['FIR', 'FIRR'],
  gender: ['MALE', 'FEMALE', 'M/F'],
};

const TAG_LOOKUP = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(TAG_ALIASES)) {
  for (const alias of aliases) TAG_LOOKUP.set(alias, canonical);
}

/** Normalize a raw suffix token to its canonical tag, or null if unknown. */
export function normalizeTag(token: string): string | null {
  return TAG_LOOKUP.get(token.trim().toUpperCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Floor rules — pure functions of the core string
// ---------------------------------------------------------------------------

type FloorResult = { floor: Floor; exact: boolean } | null;

function leadingDigits(core: string): string {
  const m = core.match(/^\d+/);
  return m ? m[0] : '';
}

const floorRules: Record<FloorRuleId, (core: string) => FloorResult> = {
  hundreds(core) {
    const d = leadingDigits(core);
    if (!d) return null;
    return { floor: Math.floor(parseInt(d, 10) / 100), exact: true };
  },

  floor_wing(core) {
    // Leading 1–2 digits before a letter = floor (542 10A1 → 10, WTT 3A → 3).
    const m = core.match(/^(\d{1,2})[A-Z]/i);
    if (m) return { floor: parseInt(m[1], 10), exact: true };
    // Digits-only core still yields a floor guess from the leading digits.
    const d = leadingDigits(core);
    if (d) return { floor: parseInt(d.slice(0, d.length > 2 ? 2 : 1), 10), exact: false };
    return null;
  },

  first_digit(core) {
    const m = core.match(/^(\d)/);
    if (!m) return null;
    return { floor: parseInt(m[1], 10), exact: true };
  },

  floor_suite_letter(core) {
    // [floor][suite][letter]: two digits + letter → first digit is floor;
    // ONE digit + letter → the floor digit is omitted, meaning 1st floor.
    let m = core.match(/^(\d)(\d+)[A-Z]/i);
    if (m) return { floor: parseInt(m[1], 10), exact: true };
    m = core.match(/^\d[A-Z]/i);
    if (m) return { floor: 1, exact: true };
    const d = leadingDigits(core);
    if (d) return { floor: parseInt(d[0], 10), exact: false };
    return null;
  },

  front_rear(core) {
    if (/^G/i.test(core)) return { floor: 'Ground', exact: true };
    const m = core.match(/^(\d)[FR]/i);
    if (m) return { floor: parseInt(m[1], 10), exact: true };
    const d = leadingDigits(core);
    if (d) return { floor: parseInt(d[0], 10), exact: false };
    return null;
  },

  first_digit_b_garden(core) {
    if (/^B/i.test(core)) return { floor: 'Garden', exact: true };
    return floorRules.first_digit(core);
  },

  hundreds_mezz(core) {
    // M01 → Mezz; 1M03 → Mezz (M in the floor position of a hundreds code).
    if (/^M/i.test(core) || /^\dM/i.test(core)) return { floor: 'Mezzanine', exact: true };
    return floorRules.hundreds(core);
  },

  hundreds_townhouse(core) {
    if (/^H/i.test(core)) return { floor: 'Townhouse', exact: true };
    return floorRules.hundreds(core);
  },
};

export function parseFloor(rule: FloorRuleId, core: string): FloorResult {
  return floorRules[rule](core);
}

// ---------------------------------------------------------------------------
// Tokenizer + full parse
// ---------------------------------------------------------------------------

/**
 * Parse one room string. Registry match is longest-prefix; the remainder is
 * tokenized as: [stray dash] core [-slot] [tags...].
 */
export function parseRoom(
  raw: string,
  registry: BuildingDef[] = REGISTRY,
): ParsedRoom {
  const input = raw.trim();
  const building = matchBuilding(input, registry);

  if (!building) {
    return {
      raw, building: null, core: input, slot: null, tags: [],
      floor: null, confidence: 'unknown',
      note: 'No registry prefix matched',
      reason: 'no-prefix',
    };
  }

  // Strip prefix, then an optional stray "- " (BC537 writes "BC537 - 3C2-1").
  let rest = input.slice(building.prefix.length).trim();
  rest = rest.replace(/^-\s*/, '').trim();

  // Split off whitespace-separated suffix tokens; the first token is core[-slot].
  const tokens = rest.split(/\s+/).filter(Boolean);
  const head = tokens[0] ?? '';
  const rawTags = tokens.slice(1);

  // core = chars up to the LAST "-digits" group → slot.
  let core = head;
  let slot: string | null = null;
  const slotMatch = head.match(/^(.*)-(\d+)$/);
  if (slotMatch && slotMatch[1]) {
    core = slotMatch[1];
    slot = slotMatch[2];
  }

  const tags: string[] = [];
  const unknownTags: string[] = [];
  for (const t of rawTags) {
    const norm = normalizeTag(t);
    if (norm) tags.push(norm);
    else unknownTags.push(t);
  }

  const floorResult = core ? parseFloor(building.rule, core) : null;

  let confidence: Confidence = 'exact';
  let note: string | undefined;
  let reason: RoomIssueReason | undefined;
  if (!core) {
    confidence = 'assumed';
    note = 'Empty room core after prefix';
    reason = 'empty-core';
  } else if (!floorResult) {
    confidence = 'assumed';
    note = `Core "${core}" did not match rule "${building.rule}"`;
    reason = 'no-floor';
  } else if (!floorResult.exact) {
    confidence = 'assumed';
    note = `Core "${core}" has an unusual shape for rule "${building.rule}"`;
    reason = 'odd-core';
  } else if (unknownTags.length) {
    confidence = 'assumed';
    note = `Unrecognized suffix token(s): ${unknownTags.join(', ')}`;
    reason = 'unknown-tag';
  }

  return {
    raw, building, core, slot, tags,
    floor: floorResult ? floorResult.floor : null,
    confidence, note, reason,
    unknownTags: unknownTags.length ? unknownTags : undefined,
  };
}

// ---------------------------------------------------------------------------
// Floor ordering & labels
// ---------------------------------------------------------------------------

/**
 * Sort value for section ordering: numeric floors descending; Mezzanine sits
 * between floors 1 and 2 (near its neighbor); Ground/Garden last.
 */
export function floorSortKey(floor: Floor): number {
  if (typeof floor === 'number') return -floor;
  switch (floor) {
    case 'Townhouse': return -0.5;   // above floor-0, below floor 1... configurable later
    case 'Mezzanine': return -1.5;   // between 1 and 2
    case 'Garden':    return 100;
    case 'Ground':    return 101;
  }
}

export function sortFloors(floors: Floor[]): Floor[] {
  return [...floors].sort((a, b) => floorSortKey(a) - floorSortKey(b));
}

const ORDINAL_EXCEPTIONS: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ORDINAL_EXCEPTIONS[n % 10] ?? 'th';
}

export function floorLabel(floor: Floor): string {
  if (typeof floor === 'number') return `${floor}${ordinal(floor)} Floor`;
  return floor;
}
