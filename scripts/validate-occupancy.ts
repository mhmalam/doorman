// Dev harness: run the parser over every room in the master occupancy export
// and report match/confidence stats per building. Usage: npx tsx scripts/validate-occupancy.ts
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseRoom, ParsedRoom } from '../src/core/parser';

const path = process.argv[2] ?? 'Occupancy Graph All Buildings.xlsx';
const wb = XLSX.read(readFileSync(path));

console.log('Sheets:', wb.SheetNames.join(', '));

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  console.log(`\n=== Sheet "${sheetName}" — ${rows.length} rows ===`);
  console.log('First 5 rows:');
  for (const row of rows.slice(0, 5)) console.log('  ', JSON.stringify(row));

  // Find the column with the highest ratio of parseable room strings.
  const width = Math.max(...rows.map(r => r.length));
  let bestCol = -1, bestHits = 0;
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (const row of rows) {
      const v = row[c];
      if (typeof v === 'string' && parseRoom(v).building) hits++;
    }
    if (hits > bestHits) { bestHits = hits; bestCol = c; }
  }
  if (bestCol < 0) { console.log('No room column detected.'); continue; }
  console.log(`Room column: ${bestCol} (${bestHits} prefix matches)`);

  const stats = new Map<string, { exact: number; assumed: number; samples: ParsedRoom[] }>();
  let unknown = 0;
  const unknownSamples: string[] = [];
  for (const row of rows) {
    const v = row[bestCol];
    if (typeof v !== 'string' || !v.trim()) continue;
    const p = parseRoom(v);
    if (!p.building) {
      unknown++;
      if (unknownSamples.length < 15 && !unknownSamples.includes(v)) unknownSamples.push(v);
      continue;
    }
    const key = `${p.building.prefix} (${p.building.name})`;
    const s = stats.get(key) ?? { exact: 0, assumed: 0, samples: [] };
    if (p.confidence === 'exact') s.exact++;
    else { s.assumed++; if (s.samples.length < 5) s.samples.push(p); }
    stats.set(key, s);
  }

  let totalExact = 0, totalAssumed = 0;
  for (const [key, s] of [...stats.entries()].sort()) {
    totalExact += s.exact; totalAssumed += s.assumed;
    const flag = s.assumed ? ` ⚠ ${s.assumed} assumed` : '';
    console.log(`  ${key}: ${s.exact} exact${flag}`);
    for (const p of s.samples) {
      console.log(`      assumed: "${p.raw}" → floor=${p.floor} (${p.note})`);
    }
  }
  console.log(`TOTAL: ${totalExact} exact, ${totalAssumed} assumed, ${unknown} unmatched`);
  if (unknownSamples.length) console.log('Unmatched samples:', unknownSamples);
}
