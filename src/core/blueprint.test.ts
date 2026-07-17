import { describe, expect, it } from 'vitest';
import { buildSections, renderTemplate } from './blueprint';
import { parseRoom } from './parser';

const ROOMS = [
  'CRL 2A1-1', 'CRL 5B2-1', 'CRL 12D5-1', 'MCB 512-1', 'CAR M01-2', 'ZZZ 999-1',
].map(r => parseRoom(r));

describe('renderTemplate', () => {
  const ctx = { prefix: 'CRL', building: 'Carlton', floor: '5', floorlabel: '5th Floor', tag: '' };

  it('substitutes all variables', () => {
    expect(renderTemplate('{prefix} - {floorlabel}', ctx)).toBe('CRL - 5th Floor');
    expect(renderTemplate('{building} · Floor {floor}', ctx)).toBe('Carlton · Floor 5');
  });
  it('handles the user example {prefix}{floor} - HELLO', () => {
    expect(renderTemplate('{prefix}{floor} - HELLO', ctx)).toBe('CRL5 - HELLO');
  });
  it('is case-insensitive and leaves unknown tokens as typed', () => {
    expect(renderTemplate('{PREFIX} {nope}', ctx)).toBe('CRL {nope}');
  });
  it('collapses whitespace left by empty variables', () => {
    expect(renderTemplate('{prefix} - {floorlabel}', { ...ctx, floorlabel: '' })).toBe('CRL -');
  });
});

describe('buildSections', () => {
  it('floor-desc: top floor first, needs-review last', () => {
    const s = buildSections(ROOMS, { preset: 'floor-desc', template: '{prefix} - {floorlabel}' });
    const carlton = s.filter(x => x.key.startsWith('CRL'));
    expect(carlton.map(x => x.label)).toEqual(['CRL - 12th Floor', 'CRL - 5th Floor', 'CRL - 2nd Floor']);
    expect(s[s.length - 1].label).toBe('Needs review');
  });
  it('floor-asc reverses floor order within a building', () => {
    const s = buildSections(ROOMS, { preset: 'floor-asc', template: '{prefix} - {floorlabel}' });
    const carlton = s.filter(x => x.key.startsWith('CRL'));
    expect(carlton.map(x => x.label)).toEqual(['CRL - 2nd Floor', 'CRL - 5th Floor', 'CRL - 12th Floor']);
  });
  it('custom template applies', () => {
    const s = buildSections(ROOMS, { preset: 'floor-desc', template: '{prefix}{floor} - HELLO' });
    expect(s.some(x => x.label === 'CRL12 - HELLO')).toBe(true);
    expect(s.some(x => x.label === 'CARMezzanine - HELLO')).toBe(true);
  });
  it('named floors render through {floor}', () => {
    const s = buildSections(ROOMS, { preset: 'floor-desc', template: '{prefix} {floor}' });
    expect(s.some(x => x.label === 'CAR Mezzanine')).toBe(true);
  });
  it('building preset makes one section per building', () => {
    const s = buildSections(ROOMS, { preset: 'building', template: '{building}' });
    expect(s.map(x => x.label)).toEqual(['Carlton', 'Carman', 'McBain', 'Needs review']);
  });
  it('none preset: one untitled section with everything, no auto-grouping', () => {
    const s = buildSections(ROOMS, { preset: 'none', template: 'Untitled section' });
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe('Untitled section');
    expect(s[0].rooms).toHaveLength(6);
  });
});
