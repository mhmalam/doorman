// Blueprint: how parsed rooms become sections. Pure functions — the preview
// and the executor both consume this.

import { Floor, floorLabel, floorSortKey, ParsedRoom } from './parser';

export type SectionPreset = 'none' | 'floor-desc' | 'floor-asc' | 'building';

export interface Blueprint {
  preset: SectionPreset;
  /** Section name template; supports {prefix} {building} {floor} {floorlabel}. */
  template: string;
}

export const PRESET_LABELS: Record<SectionPreset, string> = {
  none: 'No grouping — one section',
  'floor-desc': 'By floor — top floor first',
  'floor-asc': 'By floor — ground floor first',
  building: 'By building',
};

export const PRESET_DEFAULT_TEMPLATE: Record<SectionPreset, string> = {
  none: 'Untitled section',
  'floor-desc': '{prefix} - {floorlabel}',
  'floor-asc': '{prefix} - {floorlabel}',
  building: '{building}',
};

// Sections are never created automatically — grouping is opt-in via Customize.
export const DEFAULT_BLUEPRINT: Blueprint = {
  preset: 'none',
  template: PRESET_DEFAULT_TEMPLATE.none,
};

export interface TemplateContext {
  prefix: string;
  building: string;
  floor: string;      // "5", "Mezzanine", "" when not grouped by floor
  floorlabel: string; // "5th Floor", "Mezzanine", ""
}

export const TEMPLATE_VARS: Array<{ name: keyof TemplateContext; example: string }> = [
  { name: 'prefix', example: 'CRL' },
  { name: 'building', example: 'Carlton' },
  { name: 'floor', example: '5' },
  { name: 'floorlabel', example: '5th Floor' },
];

/** Replace {var} tokens (case-insensitive); unknown tokens are left as typed. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{(\w+)\}/gi, (match, name: string) => {
      const key = name.toLowerCase() as keyof TemplateContext;
      return key in ctx ? ctx[key] : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function contextForRoom(room: ParsedRoom, preset: SectionPreset): TemplateContext {
  const byFloor = preset === 'floor-desc' || preset === 'floor-asc';
  return {
    prefix: room.building?.prefix ?? '',
    building: room.building?.name ?? '',
    floor: byFloor && room.floor !== null ? String(room.floor) : '',
    floorlabel: byFloor && room.floor !== null ? floorLabel(room.floor as Floor) : '',
  };
}

export interface BlueprintSection {
  key: string;
  label: string;
  floorKey: string | null;
  rooms: ParsedRoom[];
  review?: boolean;
}

const REVIEW_KEY = '!review';

/** Group + order + name sections per the blueprint. With grouping on,
 *  unrecognized rooms land in a trailing "Needs review" section. */
export function buildSections(rooms: ParsedRoom[], bp: Blueprint): BlueprintSection[] {
  const byFloor = bp.preset === 'floor-desc' || bp.preset === 'floor-asc';

  if (bp.preset === 'none') {
    return [{ key: 'all', label: 'Untitled section', floorKey: null, rooms: [...rooms] }];
  }

  const map = new Map<string, BlueprintSection>();
  for (const room of rooms) {
    let key: string;
    if (!room.building) {
      key = REVIEW_KEY;
    } else if (byFloor) {
      key = `${room.building.prefix}|${room.floor ?? '!'}`;
    } else {
      key = room.building.prefix;
    }

    let section = map.get(key);
    if (!section) {
      let label: string;
      if (key === REVIEW_KEY) {
        label = 'Needs review';
      } else if (byFloor && room.floor === null) {
        label = `${room.building!.prefix} - Needs review`;
      } else {
        label = renderTemplate(bp.template, contextForRoom(room, bp.preset)) || 'Untitled section';
      }
      section = {
        key,
        label,
        floorKey: byFloor && room.floor !== null ? String(room.floor) : null,
        rooms: [],
        review: key === REVIEW_KEY || undefined,
      };
      map.set(key, section);
    }
    section.rooms.push(room);
  }

  const sections = [...map.values()];
  sections.sort((a, b) => {
    if (a.key === REVIEW_KEY) return 1;
    if (b.key === REVIEW_KEY) return -1;
    const an = a.rooms[0].building?.name ?? '';
    const bn = b.rooms[0].building?.name ?? '';
    if (an !== bn) return an.localeCompare(bn);
    if (!byFloor) return 0;
    const af = a.rooms[0].floor;
    const bf = b.rooms[0].floor;
    if (af === null) return 1;
    if (bf === null) return -1;
    const cmp = floorSortKey(af) - floorSortKey(bf);
    return bp.preset === 'floor-asc' ? -cmp : cmp;
  });
  return sections;
}
