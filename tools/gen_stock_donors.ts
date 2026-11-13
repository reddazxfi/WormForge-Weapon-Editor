/**
 * Dev-only: dump one stock record per panel slot as `src/data/stockDonors.json`.
 *
 * A bundle weapon whose Lua declares only a few fields inherits the rest from
 * its `copy_from` donor, so the editor needs that donor's real record. The
 * source is PX's default scheme, extracted one `.wep` per slot:
 *
 *   python tools/px_scheme_weps.py "<WA+PX>/PXSchemes/default.pxs" OUT --all
 *
 * Run: `bun run tools/gen_stock_donors.ts [folder]`
 * Default folder: `C:/Users/lucia/AppData/Local/Temp/wf_px/default`
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWepBinary } from '../src/utils/wepParser';
import { STOCK_WEAPONS } from '../src/data/stockWeapons';

const FOLDER = process.argv[2] ?? 'C:/Users/lucia/AppData/Local/Temp/wf_px/default';
const OUT = 'src/data/stockDonors.json';

/** Record fields only: the parts a `copy_from` donor supplies. */
const transient = new Set([
  'id',
  'name',
  'description',
  'version',
  'author',
  'slot',
  'based_on',
  'defaults',
  'panel_icon',
  'hold',
  'missileSprite',
  'bitFlight',
  'behaviorArt',
  'ribbonTrail',
  'explosionEffect',
  'customSounds',
  'fireSequence',
  'extraDependencies',
  'packArt',
  'customSprites',
  'roamSheets',
  'enableCustomLua',
  'customLuaSnippet',
  'useWepFile',
  'wepFile',
  'wepFileName',
  'wepBaseline',
]);

const donors: Record<string, unknown> = {};
const known = new Set(STOCK_WEAPONS.map((weapon) => weapon.id));
const problems: string[] = [];

for (const file of readdirSync(FOLDER)) {
  if (!file.toLowerCase().endsWith('.wep')) continue;
  const slot = file.slice(0, -4).toLowerCase();
  const bytes = readFileSync(join(FOLDER, file));
  const decoded = parseWepBinary(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    file,
  );
  if (!decoded.success) {
    problems.push(`${file}: ${decoded.error}`);
    continue;
  }
  if (!known.has(slot)) {
    // `none.wep` is the scheme's "no weapon" slot, not a stock slot a claim can
    // copy from: skip it so the table only names slots the UI offers.
    problems.push(`${file}: "${slot}" is not a stock slot id`);
    continue;
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(decoded.projectState)) {
    if (transient.has(key) || value === undefined) continue;
    record[key] = value;
  }
  // `body.sprite` is the parser's family guess ("missile" for anything that is
  // not a mine/gun/timed explosive); the record's own sprite id is decoded into
  // `recordOverrides`, which is what the generator writes. The donor table
  // wants the real art, so the override wins.
  const overrides = (record.recordOverrides ?? {}) as Record<string, unknown>;
  const body = record.body as { sprite: string; clustlet: Record<string, unknown> };
  const realSprite = overrides['missile.sprite'];
  if (typeof realSprite === 'string' && realSprite) body.sprite = realSprite;
  const bitSprite = overrides['clusters.bit.sprite'];
  if (typeof bitSprite === 'string' && bitSprite) body.clustlet.sprite = bitSprite;
  const bitTrail = overrides['clusters.bit.trail.sprite'];
  if (typeof bitTrail === 'string' && bitTrail) body.clustlet.trail = bitTrail;
  donors[slot] = record;
}

writeFileSync(OUT, `${JSON.stringify(donors)}\n`);
console.log(
  `wrote ${Object.keys(donors).length} donors to ${OUT} (${readFileSync(OUT).length} bytes)`,
);
if (problems.length) console.log(`problems:\n  ${problems.join('\n  ')}`);
