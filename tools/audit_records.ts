/**
 * Dev-only audit: does every field the records carry mean what the weapon does?
 *
 *   bun run tools/audit_records.ts [ModsFolder]
 *
 * Three passes:
 *
 * 1. **Coverage** — every group/field a corpus record declares, checked against
 *    what the editor's model can express. Anything outside `missile`,
 *    `clusters`, `handling`, `gun`, `mine`, `strike` is a field the editor
 *    cannot 设计 or re-emit.
 * 2. **Invariants** — the engine's own rules: an action needs its group, a burst
 *    needs its table, masks must not overlap, record sprite fields take stock
 *    ids or pack paths only, and so on.
 * 3. **Implicit behaviour** — the stock slots whose native behaviour implies a
 *    shape (a sheep roams and does not gas, a petrol bomb spreads fire, the
 *    utilities toggle an effect) checked against the donor records.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readBundles, readWeapons, flattenRecord, type ModFile } from '../src/utils/modLib/scan';
import type { LuaTable } from '../src/utils/modLib/luaTable';
import { parseWepBinary } from '../src/utils/wepParser';
import { STOCK_WEAPONS } from '../src/data/stockWeapons';
import { resolveStockSprite } from '../src/data/stockSprites';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { generateLuaCode } from '../src/utils/luaGenerator';
import { scanLua } from '../src/utils/modLib/luaTable';
import { stockDonor } from '../src/data/stockDonors';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';

const MODS = process.argv[2] ?? 'D:/Worms Armageddon/WormForge/Mods';
const DONOR_DIR = 'C:/Users/lucia/AppData/Local/Temp/wf_px/default';

const MODEL_GROUPS = new Set([
  'missile',
  'clusters',
  'handling',
  'gun',
  'mine',
  'strike',
  // `sheep.flight_1/2` is modelled as `roamConfig.flight_1/2`.
  'sheep',
]);
/** Every group `crates/weapons/src/record.rs` names. */
const ENGINE_GROUPS = new Set([
  'fires',
  'handling',
  'stock_handling',
  'utility',
  'missile',
  'clusters',
  'gun',
  'mine',
  'strike',
  'arrow',
  'baseball_bat',
  'fire_punch',
  'drill',
  'jet_pack',
  'parachute',
  'sheep',
  'projectile',
  'raw',
]);
/** Groups the editor now emits from `recordOverrides` (flat scalar tables). */
const NATIVE_GROUPS = new Set([
  'fires',
  'arrow',
  'baseball_bat',
  'fire_punch',
  'drill',
  'jet_pack',
  'parachute',
  'utility',
]);
const WORM_SHORTCUTS = ['worms_normal', 'worms_acting', 'worms_jumping', 'worms_roping'];

const problems: string[] = [];
const note = (where: string, message: string) => problems.push(`${where}: ${message}`);

// ---------------------------------------------------------------------------
// Corpus: coverage + invariants
// ---------------------------------------------------------------------------
const files: ModFile[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(lua|toml)$/i.test(entry.name)) {
      files.push({ path: relative(MODS, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
    } else if (/\.wep$/i.test(entry.name)) {
      files.push({
        path: relative(MODS, full).split(sep).join('/'),
        text: '',
        bytes: new Uint8Array(readFileSync(full)),
      });
    }
  }
};
walk(MODS);

const bundles = readBundles(files);
const weapons = readWeapons(bundles, files);

const unmodelled = new Map<string, number>();
const maskConflicts: string[] = [];
const trailNames = new Map<string, number>();

for (const weapon of weapons) {
  if (!weapon.record) continue;
  const record = weapon.record as LuaTable;
  const flat = flattenRecord(record);
  const where = weapon.componentId;

  // Coverage: every *record* group the engine names (`crates/weapons/src/
  // record.rs`) that the editor cannot express. Claim-level keys (`sprites`,
  // `hold`, `sounds`, callbacks) are deliberately not imported: they name art
  // inside the source bundle.
  const sourceFlat = flattenRecord(weapon.source);
  for (const [key, value] of Object.entries(sourceFlat)) {
    const group = key.split('.')[0];
    if (value === null) continue;
    if (ENGINE_GROUPS.has(group) && !MODEL_GROUPS.has(group) && !NATIVE_GROUPS.has(group)) {
      unmodelled.set(group, (unmodelled.get(group) ?? 0) + 1);
    }
  }

  // `worms` must never sit beside its own constituent groups.
  for (const [key, value] of Object.entries(flat)) {
    if (!/\.(ends_on_contact|hits|detects)$/.test(key)) continue;
    if (value !== true) continue;
    if (!key.endsWith('worms') && !key.endsWith('_worms')) continue;
    const prefix = key.slice(0, -'worms'.length);
    const clash = WORM_SHORTCUTS.some((group) => `${prefix}${group}` in flat);
    if (clash) maskConflicts.push(`${where}: ${key} + constituents`);
  }

  // A record sprite field takes a stock name/id, or (trails only) a pack path.
  for (const [key, value] of Object.entries(flat)) {
    if (!/sprite$/.test(key) || typeof value !== 'string' || !value) continue;
    if (value.includes('/')) {
      if (!/trail\.sprite$/.test(key)) {
        note(where, `${key} is a path ("${value}") — the engine reads this field as a sprite name`);
      }
      continue;
    }
    if (value !== '0' && resolveStockSprite(value) === undefined) {
      note(where, `${key} = "${value}" is not a stock sprite or id`);
    }
    if (/trail\.sprite$/.test(key) && value !== '0') {
      trailNames.set(value, (trailNames.get(value) ?? 0) + 1);
    }
  }

  // Structural consistency: a declared group with no matching selector is dead
  // data, and a selector with no group loses the values it needs.
  const action = flat['missile.action'];
  const groups = ['bounce', 'homing', 'roam', 'dig'].filter((g) =>
    Object.keys(flat).some((k) => k.startsWith(`missile.${g}.`)),
  );
  if (typeof action === 'string' && action !== 'none' && !groups.includes(action)) {
    // PX relies on the base record's action; the editor infers it, so this is
    // informational only.
  }
  const burst = flat['missile.burst'];
  if (burst === 'clusters' && !('clusters.count' in flat || 'clusters.bit.sprite' in flat)) {
    note(where, 'burst = "clusters" without a clusters table');
  }
  if (burst === 'fire' && !Object.keys(flat).some((k) => k.startsWith('missile.fire.'))) {
    note(where, 'burst = "fire" without missile.fire');
  }
}

// ---------------------------------------------------------------------------
// Stock donors: implicit behaviour
// ---------------------------------------------------------------------------
type Expectation = {
  slot: string;
  /** Field -> expected value (or predicate). */
  want: Record<string, unknown>;
  why: string;
};
const EXPECT: Expectation[] = [
  { slot: 'sheep', want: { 'missile.action': 'roam', 'missile.roam.gas.poison_power': 0 }, why: 'the sheep walks, is steered, and does not gas' },
  { slot: 'super_sheep', want: { 'missile.action': 'roam', 'missile.roam.gas.poison_power': 0 }, why: 'the super sheep flies when steered and does not gas' },
  { slot: 'aqua_sheep', want: { 'missile.action': 'roam' }, why: 'the aqua sheep flies when steered' },
  { slot: 'skunk', want: { 'missile.action': 'roam', 'clusters.bit.roam.gas.poison_power': '>0' }, why: 'the skunk walks and its bits gas' },
  { slot: 'petrol_bomb', want: { 'missile.burst': 'fire' }, why: 'the petrol bomb spreads fire' },
  { slot: 'napalm_strike', want: { 'strike.count': '>0' }, why: 'a strike drops munitions' },
  // WA's mole bomb is a roam record: the mole walks and burrows with its own
  // art (PX's Gravler port declares `action = "roam"` too).
  { slot: 'mole_bomb', want: { 'missile.action': 'roam' }, why: 'the mole bomb walks and burrows' },
  { slot: 'mole_squadron', want: { 'strike.count': '>0' }, why: 'a strike drops munitions' },
  { slot: 'banana_bomb', want: { 'missile.action': 'bounce', 'missile.burst': 'clusters' }, why: 'it bounces and bursts into bananas' },
  { slot: 'cluster_bomb', want: { 'missile.burst': 'clusters' }, why: 'it splits into cluster bits' },
  { slot: 'mine', want: { 'mine.proximity': '>0' }, why: 'a mine detects by proximity' },
  { slot: 'air_strike', want: { 'strike.count': '>0' }, why: 'a strike drops munitions' },
  { slot: 'holy_grenade', want: { 'missile.impact_particles': true }, why: 'the holy hand grenade leaves its particle burst' },
  { slot: 'dynamite', want: { 'missile.countdown': '>0' }, why: 'the dynamite is timed' },
  { slot: 'ming_vase', want: { 'missile.action': 'bounce' }, why: 'the vase shatters after bouncing' },
  { slot: 'super_banana', want: { 'missile.burst': 'clusters' }, why: 'it splits into bananas' },
  { slot: 'fast_walk', want: { 'utility.effect': 'fast_walk' }, why: 'a turn utility toggles its own effect' },
  { slot: 'low_gravity', want: { 'utility.effect': 'low_gravity' }, why: 'a turn utility toggles its own effect' },
  { slot: 'laser_sight', want: { 'utility.effect': 'laser_sight' }, why: 'a turn utility toggles its own effect' },
  { slot: 'invisibility', want: { 'utility.effect': 'invisibility' }, why: 'a turn utility toggles its own effect' },
  { slot: 'damage_x2', want: { 'utility.effect': 'damage_x2' }, why: 'a turn utility toggles its own effect' },
  { slot: 'crate_spy', want: { 'utility.effect': 'crate_spy' }, why: 'a turn utility toggles its own effect' },
  { slot: 'double_turn_time', want: { 'utility.effect': 'double_turn_time' }, why: 'a turn utility toggles its own effect' },
  { slot: 'crate_shower', want: { 'utility.effect': 'crate_shower' }, why: 'a turn utility toggles its own effect' },
  { slot: 'fire_punch', want: { 'fire_punch.damage': '>0' }, why: 'the fire punch hits for damage' },
  { slot: 'drill', want: { 'drill.duration_ms': '>0' }, why: 'the drill runs for a duration' },
  { slot: 'jet_pack', want: { 'jet_pack.fuel': '>=0' }, why: 'the jet pack has a fuel setting' },
  { slot: 'parachute', want: { 'parachute.wind_pct': '>=0' }, why: 'the parachute has a wind response' },
];

const donorProblems: string[] = [];
const readDonor = (slot: string): Record<string, unknown> | undefined => {
  const path = join(DONOR_DIR, `${slot}.wep`);
  try {
    const bytes = readFileSync(path);
    const decoded = parseWepBinary(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      `${slot}.wep`,
    );
    if (!decoded.success) return undefined;
    const state = decoded.projectState as Record<string, any>;
    // The parser keeps the record's own fields in `recordOverrides`; the typed
    // fields are folded in below under their record names.
    const flat = flattenRecord((state.recordOverrides ?? {}) as LuaTable);
    // The typed fields the parser decodes are not in `recordOverrides`; fold
    // them in under their record names so expectations read the same way.
    const body = state.body ?? {};
    flat['missile.explosion.power'] = body.damage;
    flat['missile.gravity_pct'] = body.gravity_pct;
    flat['missile.wind_pct'] = body.wind_pct;
    flat['missile.countdown'] = body.countdown_ms;
    flat['missile.fuse'] = body.fuse_time_ms;
    flat['missile.action'] = state.action;
    flat['missile.burst'] = state.burst;
    flat['clusters.count'] = body.clustlet?.count;
    flat['mine.proximity'] = body.proximity;
    flat['missile.roam.gas.poison_power'] = state.roamConfig?.gas_poison_power;
    flat['clusters.bit.roam.gas.poison_power'] = state.body?.clustlet?.roam?.gas_poison_power;
    flat['strike.count'] = state.recordOverrides?.['strike.count'];
    flat['fire_punch.damage'] = state.recordOverrides?.['fire_punch.damage'];
    flat['drill.duration_ms'] = state.recordOverrides?.['drill.duration_ms'];
    flat['jet_pack.fuel'] = state.recordOverrides?.['jet_pack.fuel'];
    flat['parachute.wind_pct'] = state.recordOverrides?.['parachute.wind_pct'];
    flat['utility.effect'] = state.recordOverrides?.['utility.effect'];
    return flat;
  } catch {
    return undefined;
  }
};

const matches = (want: unknown, got: unknown): boolean => {
  if (want === '>0') return typeof got === 'number' && got > 0;
  if (want === '>=0') return typeof got === 'number' && got >= 0;
  return want === got;
};

for (const expectation of EXPECT) {
  if (!STOCK_WEAPONS.some((weapon) => weapon.id === expectation.slot)) continue;
  const donor = readDonor(expectation.slot);
  if (!donor) {
    donorProblems.push(`${expectation.slot}: no decoded donor`);
    continue;
  }
  for (const [key, want] of Object.entries(expectation.want)) {
    const got = donor[key];
    if (got === undefined) {
      donorProblems.push(`${expectation.slot}: ${key} not decoded (want ${String(want)} — ${expectation.why})`);
    } else if (!matches(want, got)) {
      donorProblems.push(`${expectation.slot}: ${key} = ${JSON.stringify(got)}, expected ${String(want)} — ${expectation.why}`);
    }
  }
}


// ---------------------------------------------------------------------------
// Pass 4: the editor's own output. Import each weapon, generate its Lua, and
// check the record the engine would end up with (donor + emitted diffs).
// ---------------------------------------------------------------------------
const outputProblems: string[] = [];
const shell: Record<string, any> = {
  ...(stockDonor('grenade') as any),
  body: { ...DEFAULT_BODY, ...(stockDonor('grenade')?.body ?? {}) },
  action: stockDonor('grenade')?.action,
  burst: stockDonor('grenade')?.burst,
  recordOverrides: { ...(stockDonor('grenade')?.recordOverrides ?? {}) },
  id: 'wfws.audit',
  name: 'Audit',
  description: '',
  version: '0.1.0',
  author: 'audit',
  slot: 'grenade',
  based_on: 'grenade',
  fireType: 'power',
  specialSubtype: 1,
  teleport: false,
  panel_icon: 'grenade',
  defaults: { ammo: 1, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: '' },
  roamConfig: { ...DEFAULT_ROAM },
  digConfig: { ...DEFAULT_DIG },
  fireConfig: { ...DEFAULT_FIRE },
  missileSprite: {
    enabled: false,
    mode: 'stock',
    stockSprite: 'grenade',
    sheet: '',
    anim: 'rotation',
    frames: 1,
    fps: 15,
    animSpeed: 1,
    spinRate: 1,
    scale: 1,
    mirror: true,
    z: 5,
    animate: false,
    spin: true,
    hideStock: true,
  },
  bitFlight: { ...DEFAULT_ROLE_ART },
  behaviorArt: {},
  roamSheets: { flight1: {}, flight2: {} },
  ribbonTrail: { enabled: false, max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, color: '#fff', target: 'main' },
  explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
  customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
  extraDependencies: [],
  hold: {
    enabled: false,
    sheet: '',
    handType: 'mid',
    handRadius: 10,
    weapRadius: -8,
    weapRotation: 0,
    scale: 1,
    handScale: 1,
    frames: 1,
    fps: 15,
    animate: false,
    drawHand: true,
    keepWhileFiring: false,
    thrown: true,
    putAway: false,
    handRad: 10,
    handRadLower: 0,
    handRadUpper: 0,
  },
  packArt: {},
  customSprites: {},
  enableCustomLua: false,
  customLuaSnippet: '',
  useWepFile: false,
};

const donorViews = new Map<string, Record<string, unknown>>();
const viewOf = (slot: string): Record<string, unknown> => {
  const cached = donorViews.get(slot);
  if (cached) return cached;
  const donor = stockDonor(slot) ?? {};
  const project: any = {
    ...shell,
    ...donor,
    donorBaseline: undefined,
    body: { ...DEFAULT_BODY, ...(donor.body ?? {}) },
  };
  const scan = scanLua(generateLuaCode(project));
  const view = flattenRecord(scan.calls['wa.weapons.replace'] ?? scan.assignments['rec']);
  donorViews.set(slot, view);
  return view;
};

for (const weapon of weapons) {
  if (!weapon.record || weapon.wepPath) continue;
  // The installed copy of the test pack is a fixture from an older run; the
  // generated one under `test_pack/` is what the generator tests.
  if (weapon.bundleId.startsWith('wftest.')) continue;
  let lua = '';
  let merged: any;
  try {
    const { project } = importBundleWeapon(weapon, files);
    merged = {
      ...shell,
      ...project,
      body: { ...DEFAULT_BODY, ...(project.body ?? {}), clustlet: { ...(project.body?.clustlet ?? {}) } },
    };
    lua = generateLuaCode(merged);
  } catch (error) {
    outputProblems.push(`${weapon.componentId}: threw ${(error as Error).message}`);
    continue;
  }
  const scan = scanLua(lua);
  const emitted = flattenRecord(scan.calls['wa.weapons.replace'] ?? scan.assignments['rec']);
  const extra: Record<string, unknown> = {};
  for (const line of lua.split('\n')) {
    const m = /^\s*rec\.([\w.]+) = (.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].replace(/,$/, '');
    try {
      extra[m[1]] = JSON.parse(raw);
    } catch {
      extra[m[1]] = raw;
    }
  }
  const view = { ...viewOf(merged.based_on), ...emitted, ...extra };
  const where = weapon.componentId;

  const action = view['missile.action'];
  const groups = ['bounce', 'homing', 'roam', 'dig'].filter((g) =>
    Object.keys(view).some((k) => k.startsWith(`missile.${g}.`)),
  );
  if (typeof action === 'string' && action !== 'none' && !groups.includes(action)) {
    outputProblems.push(`${where}: action = ${action} but no ${action} group in the record`);
  }
  // A donor's old group is reinterpreted by the engine when the action changes,
  // so only the emitted record's own declaration is checked.
  const emittedAction = emitted['missile.action'];
  if (typeof emittedAction === 'string' && emittedAction !== 'none') {
    const emittedGroups = ['bounce', 'homing', 'roam', 'dig'].filter((g) =>
      Object.keys(emitted).some((k) => k.startsWith(`missile.${g}.`)),
    );
    if (!emittedGroups.includes(emittedAction)) {
      outputProblems.push(`${where}: emits action = ${emittedAction} without its group`);
    }
  }
  const burst = view['missile.burst'];
  if (burst === 'clusters' && !('clusters.count' in view)) {
    outputProblems.push(`${where}: burst = clusters without clusters.count`);
  }
  if (burst === 'fire' && !Object.keys(view).some((k) => k.startsWith('missile.fire.'))) {
    outputProblems.push(`${where}: burst = fire without missile.fire`);
  }
  for (const [key, value] of Object.entries(view)) {
    if (!/\.(ends_on_contact|hits|detects)$/.test(key) || value !== true) continue;
    if (!key.endsWith('worms')) continue;
    const prefix = key.slice(0, -'worms'.length);
    if (WORM_SHORTCUTS.some((group) => `${prefix}${group}` in view)) {
      outputProblems.push(`${where}: ${key} + constituents (the engine refuses this)`);
    }
  }
  for (const [key, value] of Object.entries(view)) {
    if (!/sprite$/.test(key) || typeof value !== 'string' || !value) continue;
    if (value.includes('/')) {
      if (!/trail\.sprite$/.test(key)) {
        outputProblems.push(`${where}: ${key} = "${value}" is a path in a sprite-id field`);
      }
      continue;
    }
    if (value !== '0' && resolveStockSprite(value) === undefined) {
      outputProblems.push(`${where}: ${key} = "${value}" is not a stock sprite`);
    }
  }
  if ('clusters.bit.sprite' in view && !('clusters.bit.sprite_count' in view)) {
    outputProblems.push(`${where}: clusters.bit.sprite without sprite_count`);
  }
  // `sprite_count` counts sprite ids, not frames: a bit with a stock sprite and
  // a count of 0 draws nothing.
  const bitCount = view['clusters.bit.sprite_count'];
  if (typeof bitCount === 'number' && bitCount < 1 && 'clusters.bit.sprite' in view) {
    outputProblems.push(`${where}: clusters.bit.sprite_count = ${bitCount} draws no bit`);
  }
  // A homing record with no duration never guides: `time = 0` means "until it
  // lands", which is only right when the record also arms late.
  if (view['missile.action'] === 'homing') {
    const time = view['missile.homing.time'];
    const arm = view['missile.homing.arm'];
    if (typeof time === 'number' && time === 0 && typeof arm === 'number' && arm === 0) {
      outputProblems.push(`${where}: homing with arm = 0 and time = 0 (no guidance window)`);
    }
  }
  // Gas armed but harmless: a countdown with no poison does nothing.
  for (const prefix of ['missile.roam.gas', 'clusters.bit.roam.gas']) {
    const delay = view[`${prefix}.start_delay_ms`];
    const poison = view[`${prefix}.poison_power`];
    if (typeof delay === 'number' && delay > 0 && poison === 0) {
      outputProblems.push(`${where}: ${prefix} arms after ${delay} ms but poison_power is 0`);
    }
  }
  // A special's declared group must match its subtype, or the engine reads the
  // fields as another behaviour's.
  if (merged.fireType === 'special') {
    const subtype = merged.specialSubtype;
    const expected: Record<number, string> = {
      1: 'fire_punch',
      2: 'baseball_bat',
      8: 'drill',
      12: 'parachute',
      19: 'utility',
      23: 'jet_pack',
    };
    const group = expected[subtype];
    if (group && !Object.keys(view).some((k) => k.startsWith(`${group}.`))) {
      outputProblems.push(`${where}: special subtype ${subtype} without a ${group} group`);
    }
  }
  // The new firing-header field must survive the round trip.
  const sourceLaunch = weapon.record?.missile
    ? (weapon.source?.fires as Record<string, unknown> | undefined)?.launch_power_pct
    : undefined;
  if (typeof sourceLaunch === 'number' && view['fires.launch_power_pct'] !== sourceLaunch) {
    outputProblems.push(
      `${where}: fires.launch_power_pct ${String(sourceLaunch)} -> ${String(view['fires.launch_power_pct'])}`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log(`corpus: ${weapons.length} weapons (${weapons.filter((w) => w.record).length} with a record)\n`);
console.log('groups the editor cannot express:', [...unmodelled.entries()].sort((a, b) => b[1] - a[1]));
console.log(`\ncollision-mask conflicts: ${maskConflicts.length}`);
for (const entry of maskConflicts.slice(0, 10)) console.log(`  ${entry}`);
console.log(`\nrecord-field problems: ${problems.length}`);
for (const entry of problems.slice(0, 20)) console.log(`  ${entry}`);
console.log(`\nstock-donor expectation failures: ${donorProblems.length}`);
for (const entry of donorProblems.slice(0, 40)) console.log(`  ${entry}`);
console.log(`\neditor output problems: ${outputProblems.length}`);
for (const entry of outputProblems.slice(0, 30)) console.log(`  ${entry}`);
