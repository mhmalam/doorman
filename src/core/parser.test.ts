import { describe, expect, it } from 'vitest';
import { parseRoom, sortFloors, floorLabel, Floor } from './parser';
import { matchBuilding } from './registry';

// Ground-truth table from the spec (§5.4), verified against the master occupancy file.
const GROUND_TRUTH: Array<{
  raw: string;
  name: string;
  floor: Floor;
  tags?: string[];
}> = [
  { raw: 'MCB 512-1',        name: 'McBain',               floor: 5 },
  { raw: 'BWY 1119-1 RA',    name: 'Broadway',             floor: 11, tags: ['RA'] },
  { raw: '47C 21A-1',        name: '47 Claremont',         floor: 2 },   // NOT floor 21
  { raw: '47C 2A-1',         name: '47 Claremont',         floor: 1 },   // floor digit omitted on 1st
  { raw: '538 21A-1 RA',     name: '538 West 114',         floor: 2, tags: ['RA'] },
  { raw: '542 10A1-1',       name: '542 West 112',         floor: 10 },
  { raw: 'BR542 22-1 SIC',   name: '542 West 114',         floor: 2, tags: ['SIC'] }, // BR542 beats 542
  { raw: 'BR548 G1-1',       name: '548 West 113',         floor: 'Ground' },
  { raw: 'BR604 3R-2',       name: '604 West 114',         floor: 3 },
  { raw: 'BR536 B11-1',      name: 'AXO - 536 West 114',   floor: 'Garden' },
  { raw: 'CAR M01-2',        name: 'Carman',               floor: 'Mezzanine' },
  { raw: 'HMY 1M03-1',       name: 'Harmony',              floor: 'Mezzanine' },
  { raw: 'EC H1003A-1 FSL',  name: 'East Campus',          floor: 'Townhouse', tags: ['FSL'] },
  { raw: 'EC 1401B-1',       name: 'East Campus',          floor: 14 },
  { raw: 'EC 602/4-1',       name: 'East Campus',          floor: 6 },   // slash room
  { raw: 'BC537 - 3C2-1',    name: '537 West 121 (Barnard)', floor: 3 }, // stray dash
  { raw: '611 101A-1',       name: '611 West 112',         floor: 1 },   // mixed formats within building
  { raw: '611 201-1',        name: '611 West 112',         floor: 2 },
  { raw: 'CRL 2A1-1 RAr',    name: 'Carlton',              floor: 2, tags: ['RA'] }, // typo-normalized
  { raw: 'WIN 342A-1',       name: 'Wien',                 floor: 3 },
  { raw: 'JJ 1401-1',        name: 'John Jay',             floor: 14 },
];

describe('parseRoom — ground truth table (§5.4)', () => {
  for (const row of GROUND_TRUTH) {
    it(row.raw, () => {
      const parsed = parseRoom(row.raw);
      expect(parsed.building?.name).toBe(row.name);
      expect(parsed.floor).toBe(row.floor);
      expect(parsed.tags).toEqual(row.tags ?? []);
      expect(parsed.confidence).toBe('exact');
    });
  }
});

describe('longest-prefix matching', () => {
  it('BR542 beats 542', () => {
    expect(matchBuilding('BR542 22-1')?.prefix).toBe('BR542');
  });
  it('BC600 beats 600', () => {
    expect(matchBuilding('BC600 4A1-1')?.prefix).toBe('BC600');
  });
  it('BC601 does not fall through to 600', () => {
    expect(matchBuilding('BC601 4A1-1')?.prefix).toBe('BC601');
  });
});

describe('tokenizer details', () => {
  it('extracts slot from last -digits group', () => {
    const p = parseRoom('BWY 1119-1 RA');
    expect(p.core).toBe('1119');
    expect(p.slot).toBe('1');
  });
  it('keeps slash cores intact', () => {
    const p = parseRoom('EC 602/4-1');
    expect(p.core).toBe('602/4');
    expect(p.slot).toBe('1');
  });
  it('handles missing slot', () => {
    const p = parseRoom('MCB 512');
    expect(p.core).toBe('512');
    expect(p.slot).toBeNull();
    expect(p.floor).toBe(5);
  });
  it('normalizes gender tags', () => {
    expect(parseRoom('MCB 512-1 Female').tags).toEqual(['gender']);
  });
  it('normalizes RHDr / ADr / FIRr typos', () => {
    expect(parseRoom('MCB 512-1 RHDr').tags).toEqual(['RHD']);
    expect(parseRoom('MCB 512-1 ADr').tags).toEqual(['AD']);
    expect(parseRoom('MCB 512-1 FIRr').tags).toEqual(['FIR']);
  });
});

describe('confidence levels', () => {
  it('unknown prefix → unknown', () => {
    const p = parseRoom('ZZZ 123-1');
    expect(p.confidence).toBe('unknown');
    expect(p.building).toBeNull();
    expect(p.floor).toBeNull();
  });
  it('unusual core shape → assumed', () => {
    // front_rear rule with a core that is neither G nor [digit][F|R]
    const p = parseRoom('BR604 42-1');
    expect(p.confidence).toBe('assumed');
    expect(p.floor).toBe(4); // best-effort fallback
  });
  it('unknown suffix token → assumed with note', () => {
    const p = parseRoom('MCB 512-1 XYZZY');
    expect(p.confidence).toBe('assumed');
    expect(p.note).toContain('XYZZY');
  });
});

describe('floor ordering', () => {
  it('numeric descending, Mezz between 1 and 2, Ground/Garden last', () => {
    const sorted = sortFloors([1, 'Ground', 5, 'Mezzanine', 2, 'Garden', 11]);
    expect(sorted).toEqual([11, 5, 2, 'Mezzanine', 1, 'Garden', 'Ground']);
  });
  it('labels', () => {
    expect(floorLabel(1)).toBe('1st Floor');
    expect(floorLabel(2)).toBe('2nd Floor');
    expect(floorLabel(3)).toBe('3rd Floor');
    expect(floorLabel(11)).toBe('11th Floor');
    expect(floorLabel(14)).toBe('14th Floor');
    expect(floorLabel('Mezzanine')).toBe('Mezzanine');
  });
});
