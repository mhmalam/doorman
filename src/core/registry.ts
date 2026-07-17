// Building registry — prefix → display name + floor-rule id. Nothing else.
// Floors and room counts are always derived from imported data, never stored here.

export type FloorRuleId =
  | 'hundreds'            // floor = room number minus last two digits
  | 'floor_wing'          // leading digit(s) before a letter = floor
  | 'first_digit'         // small walk-up: first digit of core = floor
  | 'floor_suite_letter'  // [floor][suite][letter]; single-digit+letter = 1st floor
  | 'front_rear'          // [floor][F|R]; G = Ground
  | 'first_digit_b_garden'// first_digit, plus B-prefixed rooms = garden level (treat as floor 1)
  | 'hundreds_mezz'       // hundreds, plus M-coded rooms = Mezzanine
  | 'hundreds_townhouse'; // hundreds, plus H-prefixed rooms = Townhouse

export interface BuildingDef {
  prefix: string;
  name: string;
  rule: FloorRuleId;
}

export const FLOOR_RULE_IDS: FloorRuleId[] = [
  'hundreds',
  'floor_wing',
  'first_digit',
  'floor_suite_letter',
  'front_rear',
  'first_digit_b_garden',
  'hundreds_mezz',
  'hundreds_townhouse',
];

export const FLOOR_RULE_LABELS: Record<FloorRuleId, string> = {
  hundreds: 'Hundreds (512 → floor 5)',
  floor_wing: 'Floor + wing (10A1 → floor 10)',
  first_digit: 'First digit (41 → floor 4)',
  floor_suite_letter: 'Floor+suite+letter (21A → 2, 2A → 1)',
  front_rear: 'Front/Rear (3R → 3, G1 → Ground)',
  first_digit_b_garden: 'First digit + B = Garden (B11 → Garden)',
  hundreds_mezz: 'Hundreds + M = Mezzanine (M01 → Mezz)',
  hundreds_townhouse: 'Hundreds + H = Townhouse (H1003A → TH)',
};

export const REGISTRY: BuildingDef[] = [
  { prefix: '47C',   name: '47 Claremont',            rule: 'floor_suite_letter' },
  { prefix: 'BR523', name: '523 West 113',            rule: 'first_digit' },
  { prefix: 'BR531', name: '531 West 113',            rule: 'first_digit' },
  { prefix: 'BC537', name: '537 West 121 (Barnard)',  rule: 'floor_wing' },
  { prefix: '538',   name: '538 West 114',            rule: 'floor_suite_letter' },
  { prefix: '542',   name: '542 West 112',            rule: 'floor_wing' },
  { prefix: 'BR542', name: '542 West 114',            rule: 'first_digit' },
  { prefix: 'BR548', name: '548 West 113',            rule: 'front_rear' },
  { prefix: 'BRKDR', name: '548 West 114',            rule: 'first_digit' },
  { prefix: '600',   name: '600 West 113',            rule: 'floor_wing' },
  { prefix: 'BC600', name: '600 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BC601', name: '601 West 110 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BR604', name: '604 West 114',            rule: 'front_rear' },
  { prefix: 'BR606', name: '606 West 114',            rule: 'front_rear' },
  { prefix: '611',   name: '611 West 112',            rule: 'hundreds' },
  { prefix: 'BC616', name: '616 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BC620', name: '620 West 116 (Barnard)',  rule: 'floor_wing' },
  { prefix: 'BR627', name: '627 West 115',            rule: 'floor_wing' },
  { prefix: 'BR536', name: 'AXO - 536 West 114',      rule: 'first_digit_b_garden' },
  { prefix: 'BWY',   name: 'Broadway',                rule: 'hundreds' },
  { prefix: 'CRL',   name: 'Carlton',                 rule: 'floor_wing' },
  { prefix: 'CAR',   name: 'Carman',                  rule: 'hundreds_mezz' },
  { prefix: 'BCCG',  name: 'Cathedral Gardens (Barnard)', rule: 'floor_wing' },
  { prefix: 'BRDG',  name: 'DG - 552 West 113',       rule: 'first_digit' },
  { prefix: 'EC',    name: 'East Campus',             rule: 'hundreds_townhouse' },
  { prefix: 'FUR',   name: 'Furnald',                 rule: 'hundreds' },
  { prefix: 'HMY',   name: 'Harmony',                 rule: 'hundreds_mezz' },
  { prefix: 'HOG',   name: 'Hogan',                   rule: 'floor_wing' },
  { prefix: 'BRICH', name: 'ICH - 554 West 114',      rule: 'front_rear' },
  { prefix: 'BRIRC', name: 'IRC - 552 West 114',      rule: 'first_digit' },
  { prefix: 'JJ',    name: 'John Jay',                rule: 'hundreds' },
  { prefix: 'BRKAT', name: 'KAT - 534 West 114',      rule: 'first_digit' },
  { prefix: 'MCB',   name: 'McBain',                  rule: 'hundreds' },
  { prefix: 'BCPLI', name: 'Plimpton Hall (Barnard)', rule: 'floor_wing' },
  { prefix: 'BR546', name: 'Q House - 546 West 114',  rule: 'first_digit' },
  { prefix: 'RIV',   name: 'River',                   rule: 'hundreds' },
  { prefix: 'RUG',   name: 'Ruggles',                 rule: 'hundreds' },
  { prefix: 'SHP',   name: 'Schapiro',                rule: 'hundreds' },
  { prefix: 'BRSDT', name: 'SDT - 540 West 114',      rule: 'first_digit' },
  { prefix: 'BRSIC', name: 'SIC - 619 West 113',      rule: 'hundreds' },
  { prefix: 'BRSN',  name: 'SN - 556 West 113',       rule: 'first_digit' },
  { prefix: 'BRSPE', name: 'SPE - 550 West 113',      rule: 'first_digit' },
  { prefix: 'WAL',   name: 'Wallach',                 rule: 'hundreds' },
  { prefix: 'WTT',   name: 'Watt',                    rule: 'floor_wing' },
  { prefix: 'WIN',   name: 'Wien',                    rule: 'hundreds' },
  { prefix: 'WBH',   name: 'Woodbridge',              rule: 'floor_wing' },
];

/**
 * Longest-prefix match against a merged registry (static + custom overrides).
 * Room strings start with the prefix followed by a space, dash, or digits
 * (e.g. "BWY 1119-1", "BC537 - 3C2-1"). BR542 must beat 542, BC600 beats 600.
 */
export function matchBuilding(
  room: string,
  registry: BuildingDef[] = REGISTRY,
): BuildingDef | null {
  const upper = room.trim().toUpperCase();
  let best: BuildingDef | null = null;
  for (const def of registry) {
    const p = def.prefix.toUpperCase();
    if (upper.startsWith(p) && (!best || p.length > best.prefix.length)) {
      best = def;
    }
  }
  return best;
}

/** Merge custom building defs over the static list (custom prefix wins). */
export function mergeRegistry(custom: BuildingDef[]): BuildingDef[] {
  const byPrefix = new Map<string, BuildingDef>();
  for (const def of REGISTRY) byPrefix.set(def.prefix.toUpperCase(), def);
  for (const def of custom) byPrefix.set(def.prefix.toUpperCase(), def);
  return [...byPrefix.values()];
}
