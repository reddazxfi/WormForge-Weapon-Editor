/**
 * WFWS bundle import check.
 *
 * Imports every weapon in the generated test pack (`bun run
 * tools/gen_test_pack.ts`) and asserts that the features the editor can set
 * come back: held art and its scale, the sprite builder's roles and parameters,
 * the ribbon trail, the explosion burst (overlay and blast), the sequential-fire
 * burst, custom WAVs, pack sheets and roaming strips -- with their files.
 *
 * Run: `bun run tools/check_mod_import.ts` (exits 1 on a failure).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeaponProject } from '../src/types/weapon';
import type { ModFile } from '../src/utils/modLib/scan';
import { readBundles, readWeapons } from '../src/utils/modLib/scan';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { generateLuaCode, generateModToml } from '../src/utils/luaGenerator';
import {
  DEFAULT_IMPORT_HOLD,
  DEFAULT_IMPORT_MISSILE,
  readBundleFeatures,
  unmodelledClaimKeys,
} from '../src/utils/modLib/importFeatures';
import { scanLua } from '../src/utils/modLib/luaTable';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_FIRE_SEQUENCE } from '../src/data/fireSequence';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(ROOT, 'test_pack', 'wftest_pack');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files: ModFile[] = walk(BUNDLE).map((full) => {
  const path = relative(ROOT, full).split(sep).join('/');
  if (/\.(lua|toml)$/i.test(full)) return { path, text: readFileSync(full, 'utf8') };
  return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
});

const bundles = readBundles(files);
const weapons = readWeapons(bundles, files);
check('test pack has one bundle', bundles.length === 1, String(bundles.length));
check('test pack has 32 weapons', weapons.length === 32, String(weapons.length));

const byName = new Map(weapons.map((weapon) => [weapon.name, weapon]));
const projects = new Map<string, WeaponProject>();
for (const weapon of weapons) {
  if (!weapon.record) {
    check(`${weapon.name} has a record`, false, weapon.error ?? 'no record');
    continue;
  }
  const { project } = await importBundleWeapon(weapon, files);
  projects.set(weapon.name, project as WeaponProject);
}

const project = (name: string): WeaponProject | undefined => projects.get(name);
const near = (label: string, actual: unknown, expected: unknown) =>
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
const hasFile = (label: string, asset: { file?: File; sheetFile?: File } | undefined) =>
  check(label, !!asset?.file || !!asset?.sheetFile, 'no file attached');

for (const weapon of weapons) {
  if (!weapon.record) continue;
  const text = files.find((file) => file.path === weapon.modulePath)?.text ?? '';
  const p = project(weapon.name)!;
  const name = weapon.name;

  if (text.includes('wf-lib/holds')) {
    check(`${name}: hold enabled`, p.hold.enabled);
    hasFile(`${name}: hold sheet`, p.hold);
  }
  if (text.includes('sb.flight')) {
    check(`${name}: builder enabled`, p.missileSprite.enabled);
    hasFile(`${name}: builder sheet`, p.missileSprite);
  }
  if (text.includes('local TRAIL =')) check(`${name}: ribbon trail enabled`, p.ribbonTrail.enabled);
  if (text.includes('fx.burst{') || text.includes('blast.explode{')) {
    check(`${name}: explosion burst enabled`, p.explosionEffect.enabled);
  }
  if (text.includes('seq.fire_seq_mis') || text.includes('seq.fire_sequential_actor')) {
    check(`${name}: fire sequence enabled`, !!p.fireSequence?.enabled);
  }
  if (text.includes('sheep_sprites')) {
    hasFile(`${name}: roam sheet 1`, p.roamSheets?.flight1);
    hasFile(`${name}: roam sheet 2`, p.roamSheets?.flight2);
  }
  if (text.includes('sounds = {')) {
    const sounds = p.customSounds;
    check(
      `${name}: a custom sound is enabled`,
      sounds.explosionEnabled || sounds.intervalEnabled || sounds.shotEnabled,
    );
  }
}

// ---- held art + sequential fire (WF 31) ----------------------------------
{
  const p = project('WF 31 Sequential Hold')!;
  near('WF 31: hold scale', p.hold.scale, 0.7);
  near('WF 31: hold frames', p.hold.frames, 1);
  near('WF 31: hold put away', p.hold.putAway, true);
  near('WF 31: hold hand type', p.hold.handType, 'mid');
  near('WF 31: hold rotation', p.hold.weapRotation, 0);
  near('WF 31: hold sheet width kept', p.hold.sheetWidth, 46);
  near('WF 31: fire mode', p.fireSequence?.mode, 'missiles');
  near('WF 31: fire count', p.fireSequence?.count, 6);
  near('WF 31: fire delay', p.fireSequence?.delay, 4);
  near('WF 31: fire speed', p.fireSequence?.speed, 14);
  near('WF 31: fire standoff', p.fireSequence?.standoff, 20);
  near('WF 31: fire offset y', p.fireSequence?.offsetY, -3);
  near('WF 31: fire live aim', p.fireSequence?.liveAim, true);
  near('WF 31: fire cancel', p.fireSequence?.cancelOnWeaponChange, true);
  // The burst no longer forces the Minigun's subtype (4): the record's own
  // fire subtype (the Grenade's 2 here) is what the worm plays.
  near('WF 31: fire subtype kept', p.specialSubtype, 2);
}

// ---- builder parameters (WF 30) -----------------------------------------
{
  const p = project('WF 30 Builder Size Angle')!;
  near('WF 30: size', p.missileSprite.size, 1.6);
  near('WF 30: angle', p.missileSprite.angle, -90);
  near('WF 30: anim', p.missileSprite.anim, 'none');
}

// ---- builder bits and timed homing (WF 24, WF 25) -----------------------
{
  const bits = project('WF 24 Builder Bits')!;
  near('WF 24: bit mode', bits.bitFlight.mode, 'builder');
  near('WF 24: bit frames', bits.bitFlight.frames, 16);
  hasFile('WF 24: bit sheet', bits.bitFlight);
  check('WF 24: bit claim sheet skipped', !bits.packArt?.cluster_sprite, 'cluster_sprite still set');

  const homing = project('WF 25 Builder State')!;
  near('WF 25: homing role', homing.behaviorArt.homing?.mode, 'builder');
  near('WF 25: homing frames', homing.behaviorArt.homing?.frames, 32);
  hasFile('WF 25: homing sheet', homing.behaviorArt.homing);
  near('WF 25: homing animation', homing.missileSprite.anim, 'rotation');
}

// ---- dig and roam queued on the builder (WF 26, WF 28) ------------------
{
  const dig = project('WF 26 Builder Dig')!;
  near('WF 26: action', dig.action, 'dig');
  check('WF 26: dig is builder-owned', dig.behaviorArt.dig?.mode !== 'native');

  const roam = project('WF 28 Roam Builder')!;
  near('WF 28: action', roam.action, 'roam');
  check(
    'WF 28: walk sprite kept',
    roam.body.sprite === '153' || roam.body.sprite === 'sheepwlk',
    String(roam.body.sprite),
  );
  near('WF 28: flight_1 zeroed', roam.roamConfig.flight_1, 0);
  near('WF 28: flight_2 zeroed', roam.roamConfig.flight_2, 0);
  near('WF 28: builder anim', roam.missileSprite.anim, 'track');
  near('WF 28: builder frames', roam.missileSprite.frames, 32);
  check('WF 28: roam sheets dormant', !roam.roamSheets?.flight1?.file, 'sheep sheet attached');
}

// ---- roaming strips (WF 27) ---------------------------------------------
{
  const p = project('WF 27 Roam Sheets')!;
  near('WF 27: sheet 1 frames', p.roamSheets?.flight1.frames, 32);
  near('WF 27: sheet 2 frames', p.roamSheets?.flight2.frames, 16);
}

// ---- ribbon trail (WF 09, WF 18) ----------------------------------------
{
  const main = project('WF 09 Ribbon Main')!;
  near('WF 09: max', main.ribbonTrail.max, 10);
  near('WF 09: every', main.ribbonTrail.every, 1);
  near('WF 09: core', main.ribbonTrail.coreWidth, 3);
  near('WF 09: glow', main.ribbonTrail.glowWidth, 6);
  near('WF 09: colour', main.ribbonTrail.color, '#ffffff');
  near('WF 09: target', main.ribbonTrail.target, 'main');

  const all = project('WF 18 Burst Ribbon All')!;
  near('WF 18: target', all.ribbonTrail.target, 'all');
}

// ---- explosion burst (WF 21, WF 22) -------------------------------------
{
  const blast = project('WF 21 Explosion Blast')!;
  near('WF 21: mode', blast.explosionEffect.mode, 'blast');
  near('WF 21: damage', blast.explosionEffect.damage, 45);
  near('WF 21: push', blast.explosionEffect.push, 90);
  near('WF 21: hole', blast.explosionEffect.hole, 45);
  near('WF 21: sound', blast.explosionEffect.sound, 'default');
  near('WF 21: radius', blast.explosionEffect.radius, 94);
  near('WF 21: colour', blast.explosionEffect.color, '#6496dc');
  near('WF 21: smoke', blast.explosionEffect.smoke, true);
  near('WF 21: rebuffer', blast.explosionEffect.rebuffer, true);
  near('WF 21: preset', blast.explosionEffect.preset, 'electric');

  const overlay = project('WF 22 Explosion Overlay')!;
  near('WF 22: mode', overlay.explosionEffect.mode, 'effect');
  near('WF 22: radius', overlay.explosionEffect.radius, 30);
  near('WF 22: colour', overlay.explosionEffect.color, '#8282ff');
  near('WF 22: smoke', overlay.explosionEffect.smoke, false);
  near('WF 22: preset', overlay.explosionEffect.preset, 'pyro');
}

// ---- custom WAVs (WF 23, WF 29) -----------------------------------------
{
  const p = project('WF 23 Custom Sounds')!;
  near('WF 23: blast sound', p.customSounds.explosionEnabled, true);
  hasFile('WF 23: blast WAV', p.customSounds.explosion);
  near('WF 23: interval sound', p.customSounds.intervalEnabled, true);
  near('WF 23: interval ms', p.customSounds.intervalMs, 500);
  near('WF 23: interval delay', p.customSounds.intervalDelayMs, 500);
  near('WF 23: interval limit', p.customSounds.intervalLimit, 4);
  near('WF 23: interval priority', p.customSounds.intervalPriority, 8);
  near('WF 23: blast priority', p.customSounds.explosionPriority, 10);

  const seq = project('WF 29 Sequential Fire')!;
  near('WF 29: fire count', seq.fireSequence?.count, 12);
  near('WF 29: fire delay', seq.fireSequence?.delay, 3);
  near('WF 29: fire spread x', seq.fireSequence?.spreadX, 0.3);
  near('WF 29: fire spread y', seq.fireSequence?.spreadY, 0.3);
  near('WF 29: shot sound', seq.customSounds.shotEnabled, true);
  hasFile('WF 29: shot WAV', seq.customSounds.shot);
  near('WF 29: shot every', seq.customSounds.shotEvery, 1);
  near('WF 29: shot priority', seq.customSounds.shotPriority, 8);
  near('WF 29: ammo', seq.defaults.ammo, -1);
  near('WF 29: crate chance', seq.defaults.crateChance, 0);
  near('WF 29: after use', seq.defaults.afterUse, '');
}

// ---- pack sheets (WF 04, WF 08, WF 11, WF 17) --------------------------
{
  const body = project('WF 04 Claim Track')!;
  hasFile('WF 04: body sheet', body.packArt?.strike_sprite);
  near('WF 04: body frames', body.packArt?.strike_sprite?.frames, 1);

  const trail = project('WF 08 Native Trail Art')!;
  hasFile('WF 08: native trail sheet', trail.packArt?.missile_trail);
  near('WF 08: native trail frames', trail.packArt?.missile_trail?.frames, 4);

  const strike = project('WF 11 Strike Direction')!;
  near('WF 11: body frames', strike.packArt?.strike_sprite?.frames, 32);

  const bitTrail = project('WF 17 Bit Trail Art')!;
  hasFile('WF 17: bit trail sheet', bitTrail.packArt?.cluster_trail);
  near('WF 17: bit trail frames', bitTrail.packArt?.cluster_trail?.frames, 4);
}

// ---- round trip: regenerating keeps the features ------------------------
const RIBBON_OFF = {
  enabled: false,
  max: 12,
  every: 2,
  vanish: 2,
  coreWidth: 8,
  glowWidth: 13,
  color: '#ffffff',
  target: 'main' as const,
};

function fullProject(p: WeaponProject, name: string): WeaponProject {
  return {
    id: 'wfws.roundtrip',
    name,
    description: '',
    version: '0.1.0',
    author: 'check',
    slot: p.slot ?? 'grenade',
    based_on: p.based_on ?? 'grenade',
    fireType: p.fireType ?? 'power',
    specialSubtype: p.specialSubtype ?? 0,
    teleport: false,
    panel_icon: p.panel_icon ?? 'grenade',
    defaults: { ammo: 1, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: '' },
    body: {
      ...DEFAULT_BODY,
      ...p.body,
      clustlet: { ...DEFAULT_BODY.clustlet, ...(p.body?.clustlet ?? {}) },
    },
    action: p.action ?? 'none',
    burst: p.burst ?? 'nothing',
    missileSprite: p.missileSprite ?? DEFAULT_IMPORT_MISSILE,
    bitFlight: p.bitFlight ?? DEFAULT_ROLE_ART,
    behaviorArt: p.behaviorArt ?? {},
    roamConfig: { ...DEFAULT_ROAM, ...(p.roamConfig ?? {}) },
    roamSheets: p.roamSheets ?? { flight1: {}, flight2: {} },
    digConfig: { ...DEFAULT_DIG, ...(p.digConfig ?? {}) },
    fireConfig: { ...DEFAULT_FIRE, ...(p.fireConfig ?? {}) },
    ribbonTrail: p.ribbonTrail ?? RIBBON_OFF,
    explosionEffect: p.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT,
    fireSequence: p.fireSequence ?? DEFAULT_FIRE_SEQUENCE,
    customSounds: p.customSounds ?? DEFAULT_CUSTOM_SOUNDS,
    extraDependencies: p.extraDependencies ?? [],
    hold: p.hold ?? DEFAULT_IMPORT_HOLD,
    packArt: p.packArt ?? {},
    customSprites: {},
    recordOverrides: p.recordOverrides ?? {},
    recordExtra: p.recordExtra,
    enableCustomLua: p.enableCustomLua ?? false,
    customLuaSnippet: p.customLuaSnippet ?? '',
    useWepFile: false,
  };
}

for (const [name, p] of projects) {
  const original = files.find(
    (file) => file.path === weapons.find((weapon) => weapon.name === name)?.modulePath,
  )?.text ?? '';
  const lua = generateLuaCode(fullProject(p, name));
  generateModToml(fullProject(p, name));
  const markers: [string, string][] = [
    ['wf-lib/holds', 'worm_sprites = holds.PX_POSTURE'],
    ['sb.flight', 'sb.flight(ctx, {'],
    ['local TRAIL =', 'local TRAIL = {'],
    ['fx.burst{', 'fx.burst{'],
    ['blast.explode{', 'blast.explode{'],
    ['seq.fire_seq_mis', 'seq.fire_seq_mis{'],
    ['seq.fire_sequential_actor', 'seq.fire_sequential_actor{'],
    ['sheep_sprites', 'sheep_sprites = {'],
    ['flash = {', 'flash = {'],
  ];
  for (const [from, to] of markers) {
    if (!original.includes(from)) continue;
    check(`${name}: regen keeps ${from}`, lua.includes(to));
  }
  if (original.includes('sounds = {')) {
    check(`${name}: regen keeps sounds`, lua.includes('sounds = {'));
  }
  check(`${name}: regen is non-empty`, lua.includes('wa.weapons.replace'));
}

// ---- custom on_explode survives, generated lines do not ------------------
{
  const sample = `
local fx = require("wf-lib/effects/px_effects")
return {
  install = function(ctx)
    fx.install{ trail = false }
    wa.weapons.replace{
      name = "Callback sample",
      copy_from = "stock.grenade",
      on_explode = { on = function(ev)
        blast.explode{
          x = ev.x, y = ev.y,
          damage = 20,
          effect = { radius = 30, smoke = false },
        }
        local x = ev.x
        if x then
          if ev.worm then wa.sound.play(ev.worm, "sounds/x/explosion.wav", 10) end
        end
      end },
    }
  end,
}
`;
  const scan = scanLua(sample);
  const source = scan.calls['wa.weapons.replace'];
  const features = await readBundleFeatures({
    weapon: {
      bundleId: 'x',
      bundleName: 'x',
      bundleDir: '',
      dependencies: [],
      spriteDecls: {},
      componentId: 'x',
      name: 'x',
      modulePath: '',
      source,
    },
    files: [],
    moduleText: sample,
    mappedPackArt: {},
    digging: false,
  });
  const snippet = features.project.customLuaSnippet ?? '';
  check('custom on_explode is carried', features.project.enableCustomLua === true);
  check('custom on_explode keeps its own lines', snippet.includes('local x = ev.x'));
  check('custom on_explode drops the generated burst', !snippet.includes('blast.explode'));
  check(
    'custom on_explode drops the generated WAV line',
    !snippet.includes('wa.sound.play(ev.worm'),
  );
  check(
    'unmodelled callback is reported',
    unmodelledClaimKeys({ ...(source ?? {}), on_update: null }).includes('on_update'),
  );

  // The extracted body must survive the export merge next to the burst.
  const sampleProject = fullProject(
    {
      ...features.project,
      body: DEFAULT_BODY,
      action: 'none',
      burst: 'nothing',
      recordOverrides: {},
    } as WeaponProject,
    'Callback sample',
  );
  const lua = generateLuaCode(sampleProject);
  check(
    'custom on_explode is exported once',
    lua.split('local x = ev.x').length - 1 === 1,
    String(lua.split('local x = ev.x').length - 1),
  );
  check('custom on_explode keeps the burst beside it', lua.includes('blast.explode{'));
}

// ---- firing-state sprite (WF 32) ---------------------------------------
{
  const p = project('WF 32 Hold Flash')!;
  near('WF 32: flash frames', p.hold.flashFrames, 3);
  near('WF 32: flash out', p.hold.flashOut, 14);
  near('WF 32: flash side', p.hold.flashSide, 2);
  near('WF 32: flash scale', p.hold.flashScale, 1.5);
  near('WF 32: keep while firing', p.hold.keepWhileFiring, true);
  check('WF 32: flash sheet attached', !!p.hold.flashFile, 'no file attached');
}

// ---- fire subtype is settable, and not forced to the Minigun's -----------
{
  const grenade = project('WF 31 Sequential Hold')!;
  const projectile = fullProject(
    {
      ...grenade,
      // A missile (not a special): the choice has to reach the record for any
      // family, since `fires.subtype` is not family-specific.
      specialSubtype: 5,
    } as WeaponProject,
    'Subtype check',
  );
  const shot = generateLuaCode(projectile);
  check('fire subtype 5 is written for a missile', shot.includes('fires = { subtype = 5 }'));
  check('the burst does not force subtype 4', !shot.includes('subtype = 4'));
}

// ---- dependencies are not duplicated into extras -----------------------
for (const [name, p] of projects) {
  check(
    `${name}: no auto dependency leaked`,
    (p.extraDependencies ?? []).length === 0,
    (p.extraDependencies ?? []).join(', '),
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nWFWS bundle import: all checks passed (${projects.size} weapons)`);

