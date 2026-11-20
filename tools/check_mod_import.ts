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
import { parseToml } from '../src/utils/modLib/modToml';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import {
  extraHandSheetPath,
  generateLuaCode,
  generateModToml,
  holdSheetPath,
} from '../src/utils/luaGenerator';
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
// Two bundles: the pack itself and the `wf-lib/wfws_sdk` library it ships (the
// reader finds nested bundles by their own mod.toml, and the editor's exports
// carry that library the same way).
check('test pack has two bundles', bundles.length === 2, String(bundles.length));
check(
  'test pack ships the wfws.sdk library',
  bundles.some((bundle) => bundle.id === 'wfws.sdk'),
  bundles.map((bundle) => bundle.id).join(', '),
);
check('test pack has 60 weapons', weapons.length === 60, String(weapons.length));

const byName = new Map(weapons.map((weapon) => [weapon.name, weapon]));
const projects = new Map<string, WeaponProject>();
const notesByName = new Map<string, string[]>();
for (const weapon of weapons) {
  if (!weapon.record) {
    check(`${weapon.name} has a record`, false, weapon.error ?? 'no record');
    continue;
  }
  const { project, notes } = await importBundleWeapon(weapon, files);
  projects.set(weapon.name, project as WeaponProject);
  notesByName.set(weapon.name, notes);
}

const project = (name: string): WeaponProject | undefined => projects.get(name);
const luaOf = (name: string): string => {
  const weapon = byName.get(name);
  return files.find((file) => file.path === weapon?.modulePath)?.text ?? '';
};
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
  // `spec/famas.png` is 90x90: the sheet's own cell, kept so `px_hold_art` draws
  // it at the right size.
  near('WF 31: hold sheet width kept', p.hold.sheetWidth, 90);
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
  near('WF 26: dig spins', dig.behaviorArt.dig?.anim, 'rotation');
  near('WF 26: dig spin rate', dig.behaviorArt.dig?.spinRate, 2);

  const tilt = project('WF 34 Roam Tilt')!;
  near('WF 34: anim', tilt.missileSprite.anim, 'roam');
  near('WF 34: tilt up', tilt.missileSprite.roamTilt?.up, 35);
  near('WF 34: tilt down', tilt.missileSprite.roamTilt?.down, 25);
  near('WF 34: tilt rest (lays the walk flat)', tilt.missileSprite.roamTilt?.rest, 90);

  const roamRole = project('WF 35 Roam Own Sheet')!;
  near('WF 35: action', roamRole.action, 'roam');
  near('WF 35: roam role mode', roamRole.behaviorArt.roam?.mode, 'builder');
  near('WF 35: roam role anim', roamRole.behaviorArt.roam?.anim, 'roam');
  near('WF 35: roam role frames', roamRole.behaviorArt.roam?.frames, 4);
  near('WF 35: roam role scale', roamRole.behaviorArt.roam?.scale, 1.5);
  check(
    'WF 35: roam role sheet attached',
    !!roamRole.behaviorArt.roam?.sheetFile,
    'no sheet attached',
  );
  check(
    'WF 35: primary params untouched',
    roamRole.missileSprite.anim === 'track' && (roamRole.missileSprite.scale ?? 1) === 1,
    `${roamRole.missileSprite.anim}/${roamRole.missileSprite.scale}`,
  );

  const roam = project('WF 28 Roam Builder')!;
  near('WF 28: action', roam.action, 'roam');
  check(
    'WF 28: walk sprite kept',
    roam.body.sprite === '153' || roam.body.sprite === 'sheepwlk',
    String(roam.body.sprite),
  );
  near('WF 28: flight_1 sentinel 699', roam.roamConfig.flight_1, 699);
  near('WF 28: flight_2 sentinel 699', roam.roamConfig.flight_2, 699);
  near('WF 28: builder anim', roam.missileSprite.anim, 'track');
  near('WF 28: builder frames', roam.missileSprite.frames, 1);
  near('WF 28: builder angle (up-left sheet)', roam.missileSprite.angle, 45);
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

  // The builder identity decides bit vs round; the guard is what is read back.
  const bits = project('WF 51 Trail Bits Only')!;
  near('WF 51: target', bits.ribbonTrail.target, 'bit');
  check(
    'WF 51: the bit test reads the builder role',
    /sb\.role and sb\.role\(m\.id\)/.test(luaOf('WF 51 Trail Bits Only')),
  );
}

// ---- explosion burst (WF 21, WF 22) -------------------------------------
{
  const mainOnly = project('WF 52 Burst Main Only')!;
  near('WF 52: target', mainOnly.explosionEffect.target, 'main');
  near('WF 52: mode', mainOnly.explosionEffect.mode, 'effect');

  const blast = project('WF 21 Explosion Blast')!;
  near('WF 21: target', blast.explosionEffect.target, 'all');
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
  noise: 0,
  rainbow: false,
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
    terrainStamp: p.terrainStamp,
    emitter: p.emitter,
    fireSequence: p.fireSequence ?? DEFAULT_FIRE_SEQUENCE,
    customSounds: p.customSounds ?? DEFAULT_CUSTOM_SOUNDS,
    extraDependencies: p.extraDependencies ?? [],
    hold: p.hold ?? DEFAULT_IMPORT_HOLD,
    aimClip: p.aimClip,
    melee: p.melee,
    packArt: p.packArt ?? {},
    customSprites: {},
    recordOverrides: p.recordOverrides ?? {},
    recordExtra: p.recordExtra,
    carriedLua: p.carriedLua,
    enableCustomLua: p.enableCustomLua ?? false,
    customLuaSnippet: p.customLuaSnippet ?? '',
    useWepFile: false,
  };
}

// ---- the roam role's own sheet does not touch the primary (WF 35) --------
{
  const p = fullProject(project('WF 35 Roam Own Sheet')!, 'WF 35 Roam Own Sheet');
  const lua = generateLuaCode(p);
  check(
    'WF 35: roam role emitted with its own sheet',
    lua.includes('roam = {') &&
      lua.includes('state_roam.png') &&
      lua.includes('anim = "roam"') &&
      lua.includes('scale = 1.5'),
    'roam role table missing',
  );
  check(
    'WF 35: primary track stays top level',
    /\/missile\.png",\n\s+anim = "track",/.test(lua),
    'primary anim changed',
  );
  check(
    'WF 35: mod.toml declares the roam sheet',
    generateModToml(p).includes('state_roam.png'),
    'sheet not declared',
  );
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
  // `wf-lib/electric/damage` reads `wa.depth` and loads its taze sheets while it
  // loads, and a component file is data: the engine has no `wa` until
  // `install(ctx)`. Required at module level it fails the whole bundle with
  // "a component's file only returns its data; use wa in install(ctx)".
  const damageRequire = lua.indexOf('require("wf-lib/electric/damage")');
  check(
    `${name}: the taze module is required inside install`,
    damageRequire === -1 || damageRequire > lua.indexOf('install = function(ctx)'),
    'a load-time require of a module that reads wa',
  );
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
      sounds = { "sounds/x/explosion.wav" },
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
  // M5: the bundle's hook is carried code, not the author's snippet. The snippet
  // box is the user's, so an import must leave it untouched.
  const carried = features.carriedHooks.find((hook) => hook.key === 'on_explode')?.text ?? '';
  check('custom on_explode is carried', carried.length > 0);
  check("custom on_explode is not the author's snippet", !features.project.customLuaSnippet);
  check('custom on_explode keeps its own lines', carried.includes('local x = ev.x'));
  check('custom on_explode drops the generated burst', !carried.includes('blast.explode'));
  check(
    'custom on_explode drops the generated WAV line',
    !carried.includes('wa.sound.play(ev.worm'),
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
      carriedLua: {
        preamble: [],
        prologue: [],
        hooks: features.carriedHooks,
        unresolved: [],
      },
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
  // The firing role is a `fire` table inside the `sb.hold` spec. PX's FAMAS
  // leaves its placement unset and inherits the gun's; this one owns every
  // number (including its own nudge channels), so the whole role has to survive
  // the round trip.
  check('WF 32: firing sheet attached', !!p.hold.flashFile, 'no file attached');
  near('WF 32: firing sheet width', p.hold.flashWidth, 100);
  near('WF 32: keep while firing', p.hold.keepWhileFiring, true);
  check('WF 32: old overlay geometry gone', p.hold.flashOut === undefined, 'flashOut set');
  near('WF 32: its own strip frames', p.hold.fireFrames, 2);
  near('WF 32: its own strip rate', p.hold.fireFps, 12);
  near('WF 32: its own radius', p.hold.fireWeapRadius, -4);
  near('WF 32: its own rotation', p.hold.fireWeapRotation, 15);
  near('WF 32: its own scale', p.hold.fireScale, 1.2);
  near('WF 32: its own hand radius', p.hold.fireHandRadius, 14);
  near('WF 32: its own hand rotation', p.hold.fireHandRotation, -10);
  near('WF 32: its own hand scale', p.hold.fireHandScale, 0.9);
  near('WF 32: its own offset x', p.hold.fireOffsetX, 6);
  near('WF 32: its own offset y', p.hold.fireOffsetY, -4);
  near('WF 32: its own hand offset x', p.hold.fireHandOffsetX, -2);
  near('WF 32: its own hand offset y', p.hold.fireHandOffsetY, 3);
  const lua = generateLuaCode(fullProject(p, 'WF 32 Hold Flash'));
  check(
    'WF 32: the firing role is emitted with its own numbers',
    lua.includes('weap_radius = -4,') &&
      lua.includes('frames = 2,') &&
      lua.includes('anim_speed = 4,') &&
      lua.includes('hand_radius = 14,') &&
      lua.includes('hand_scale = 0.9,') &&
      lua.includes('offset = { x = 6, y = -4 },') &&
      lua.includes('hand_offset = { x = -2, y = 3 },'),
    'the firing table fell back to the aiming numbers',
  );
}

// ---- burst + firing sheet (WF 36) ---------------------------------------
{
  const p = project('WF 36 Sequential Flash')!;
  check(
    'WF 36: hold and firing sheets both attached',
    !!p.hold.sheetFile && !!p.hold.flashFile,
    `hold ${!!p.hold.sheetFile}, flash ${!!p.hold.flashFile}`,
  );
  check('WF 36: burst came back', !!p.fireSequence?.enabled, 'no fire sequence');
  const lua = generateLuaCode(fullProject(p, 'WF 36 Sequential Flash'));
  check(
    'WF 36: the held art fills the burst frames',
    lua.includes('keep_firing = true,'),
    'firing frames left to WA',
  );
  check(
    'WF 36: no px_hold_art at all',
    !lua.includes('px_hold_art') && !lua.includes('hold_art.'),
    'the old helper is still required',
  );
  check(
    'WF 36: the firing sheet rides the aim layer',
    lua.includes('fire = {') && lua.includes('ticks = '),
    'firing role missing',
  );
  // The burst launches its own rounds, so it carries WA's fuse option: a
  // grenade record holds `missile.fuse = 0`, which explodes on the first frame.
  const seqLua = generateLuaCode(fullProject(project('WF 29 Sequential Fire')!, 'WF 29 Sequential Fire'));
  check(
    'WF 29: the burst carries the fuse',
    seqLua.includes('missile = { fuse = fuse_of(ev.worm) },'),
    'launched rounds get the record fuse (0)',
  );
  check(
    'WF 29: the fuse option is sampled from the digit keys',
    seqLua.includes('keys.digit') &&
      seqLua.includes('fuse_by_worm[w.id] = digit * 1000') &&
      /FUSE_DEFAULT = \d+/.test(seqLua),
    'no fuse tracker',
  );
  // A record with its own fuse keeps it: WA only offers the 1-5 keys for the
  // records that have none, so a pinned timer must not be overridden.
  const seqBase = project('WF 29 Sequential Fire')!;
  const pinnedLua = generateLuaCode(
    fullProject(
      { ...seqBase, body: { ...seqBase.body, fuse_time_ms: 5000 } } as WeaponProject,
      'Pinned Fuse',
    ),
  );
  check(
    'WF 29: a pinned fuse is left to the record',
    !pinnedLua.includes('fuse_of') && !pinnedLua.includes('FUSE_DEFAULT'),
    'a pinned timer was overridden by the fuse keys',
  );
  const flashLua = generateLuaCode(fullProject(project('WF 32 Hold Flash')!, 'WF 32 Hold Flash'));
  check(
    'WF 32: the firing window is emitted',
    flashLua.includes('ticks = 9,'),
    'window missing',
  );
  check(
    'WF 32: the main weapon yields to the firing sheet',
    flashLua.includes('hide_main = true,'),
    'hide_main missing',
  );
}

// ---- terrain stamp (WF 37 impact / WF 38 fixed) -------------------------
{
  const impact = project('WF 37 Stamp Impact')!;
  check('WF 37: stamp read back', !!impact.terrainStamp?.enabled, 'not enabled');
  near('WF 37: impact angle mode', impact.terrainStamp?.onImpact, true);
  near('WF 37: soften', impact.terrainStamp?.soften, 3);
  near('WF 37: blend', impact.terrainStamp?.blend, 'mix');
  near('WF 37: true colours off', impact.terrainStamp?.trueColour, false);
  near('WF 37: strip frames', impact.terrainStamp?.sheet?.frames, 32);
  check(
    'WF 37: strip attached',
    !!impact.terrainStamp?.sheet?.file,
    'no file attached',
  );
  near('WF 37: worm clearance', impact.terrainStamp?.wormClearance, 12);
  check(
    'WF 37: the guard is not left behind as custom Lua',
    !impact.enableCustomLua && !(impact.customLuaSnippet ?? '').includes('stamp_clear'),
    impact.customLuaSnippet ?? '(empty)',
  );
  const lua = generateLuaCode(fullProject(impact, 'WF 37 Stamp Impact'));
  check(
    'WF 37: stamp is guarded by the worm check',
    lua.includes('local STAMP_CLEAR = 12') && lua.includes('if stamp_clear(ev.x, ev.y) then'),
    'guard missing',
  );
  check(
    'WF 37: stamped from the impact heading',
    lua.includes('frame = stamp_orientation(ev.vx or 0, ev.vy or 0)'),
    'helper call missing',
  );
  check(
    'WF 37: stamp is last in the one hook',
    lua.indexOf('wa.land.stamp{') > lua.indexOf('blast.explode{') &&
      lua.split('on_explode = ').length === 2,
    'stamp not inside the merged on_explode',
  );

  const fixed = project('WF 38 Stamp Fixed')!;
  near('WF 38: fixed angle mode', fixed.terrainStamp?.onImpact, false);
  near('WF 38: angle degrees', fixed.terrainStamp?.fixedAngle, 90);
  near('WF 38: soften', fixed.terrainStamp?.soften, 5);
  near('WF 38: blend', fixed.terrainStamp?.blend, 'dither');
  near('WF 38: true colours', fixed.terrainStamp?.trueColour, true);
  near('WF 38: worm clearance off', fixed.terrainStamp?.wormClearance, 0);
  const fixedLua = generateLuaCode(fullProject(fixed, 'WF 38 Stamp Fixed'));
  check('WF 38: fixed frame 8', fixedLua.includes('frame = 8,'), 'frame missing');
  check('WF 38: true colours emitted', fixedLua.includes('true_colour = true,'), 'missing');
  check(
    'WF 38: no heading helper for a fixed frame',
    !fixedLua.includes('stamp_orientation'),
    'helper emitted without impact mode',
  );
  check(
    'WF 38: no worm guard at clearance 0',
    !fixedLua.includes('stamp_clear'),
    'guard emitted for clearance 0',
  );
  check(
    'WF 38: mod.toml declares the strip',
    /stamp\.png"\]\nframes = 32/.test(
      generateModToml(fullProject(fixed, 'WF 38 Stamp Fixed')),
    ),
    'declaration missing',
  );
}

// ---- impact damage / pierce (WF 39) -------------------------------------
{
  const p = project('WF 39 Stamp Pierce')!;
  check('WF 39: impact damage read back', !!p.terrainStamp?.impact?.enabled, 'not enabled');
  near('WF 39: damage', p.terrainStamp?.impact?.damage, 25);
  near('WF 39: search radius', p.terrainStamp?.impact?.radius, 18);
  near('WF 39: knockback', p.terrainStamp?.impact?.impulse, 0.25);
  near('WF 39: hit kind', p.terrainStamp?.impact?.kind, 'fire');
  near('WF 39: spare the shooter', p.terrainStamp?.impact?.spareShooter, false);
  near('WF 39: stamp still on', p.terrainStamp?.enabled, true);
  check(
    'WF 39: the pierce guard is not left behind as custom Lua',
    !p.enableCustomLua && !(p.customLuaSnippet ?? '').includes('stamp_hit'),
    p.customLuaSnippet ?? '(empty)',
  );
  const lua = generateLuaCode(fullProject(p, 'WF 39 Stamp Pierce'));
  check(
    'WF 39: pierce guard emitted',
    lua.includes('if stamp_hit(ev) then return end'),
    'guard missing',
  );
  check(
    'WF 39: the record blast is zeroed',
    /explosion = \{\s*power = 0,\s*push_pct = 0,\s*\}/.test(lua),
    'power not zeroed',
  );
  check(
    'WF 39: hit table carries the panel values',
    lua.includes('local STAMP_HIT = { damage = 25, radius = 18, impulse = 0.25, kind = "fire", spare_shooter = false }'),
    'STAMP_HIT rows differ',
  );
  check(
    'WF 39: stamp still comes last in the one hook',
    lua.indexOf('if stamp_hit(ev) then return end') < lua.indexOf('wa.land.stamp{') &&
      lua.split('on_explode = ').length === 2,
    'order or hook count changed',
  );
}

// ---- PingPong sheet animation (WF 40) ------------------------------------
{
  const p = project('WF 40 Builder PingPong')!;
  near('WF 40: pingpong read back', p.missileSprite?.pingpong, true);
  near('WF 40: frames', p.missileSprite?.frames, 6);
  near('WF 40: anim', p.missileSprite?.anim, 'none');
  const lua = generateLuaCode(fullProject(p, 'WF 40 Builder PingPong'));
  check(
    'WF 40: pingpong emitted after cyclical',
    /cyclical = 6,\s*\n\s*pingpong = true,/.test(lua),
    'pingpong row missing',
  );
}

// ---- electric blast taze (WF 41) ----------------------------------------
{
  const p = project('WF 41 Electric Blast')!;
  near('WF 41: damage type read back', p.explosionEffect?.damageType, 'electric');
  near('WF 41: blast mode', p.explosionEffect?.mode, 'blast');
  near('WF 41: damage', p.explosionEffect?.damage, 30);
  const lua = generateLuaCode(fullProject(p, 'WF 41 Electric Blast'));
  check(
    'WF 41: taze module declared, required in install',
    /^local zap$/m.test(lua) &&
      lua.includes('    zap = require("wf-lib/electric/damage")'),
    'zap declaration or install require missing',
  );
  check(
    'WF 41: the taze module is not required at load',
    lua.indexOf('require("wf-lib/electric/damage")') >
      lua.indexOf('install = function(ctx)'),
    'a load-time require of a module that reads wa fails the bundle',
  );
  check(
    'WF 41: the hurt is armed before the blast',
    lua.indexOf('zap.set_message_electric(20') > 0 &&
      lua.indexOf('zap.set_message_electric(20') < lua.indexOf('blast.explode{'),
    'arm missing or after the blast',
  );
  check(
    'WF 41: the hit still travels as the taze kind',
    lua.includes('kind = "taze"'),
    'kind row missing',
  );
  check(
    'WF 41: custom_explosion is handed no taze module',
    !/zap = zap,/.test(lua),
    'an option the SDK does not have',
  );
  check(
    'WF 41: px.electric declared',
    generateModToml(fullProject(p, 'WF 41 Electric Blast')).includes('"px.electric"'),
    'dependency missing',
  );
  // The overlay mode arms WA's own blast instead: it stays, and still tazes.
  const overlay = fullProject(
    { ...p, explosionEffect: { ...p.explosionEffect!, mode: 'effect' } } as WeaponProject,
    'WF 41 Overlay',
  );
  const overlayLua = generateLuaCode(overlay);
  check(
    'WF 41 overlay: WA blast is armed, not replaced',
    overlayLua.includes('zap.set_message_electric_missile(20, ev.worm, 2)') &&
      !overlayLua.includes('blast.explode{'),
    'overlay arm or blast replacement wrong',
  );
  check(
    'WF 41 overlay: px.electric still declared',
    generateModToml(overlay).includes('"px.electric"'),
    'dependency missing',
  );
}

// ---- electric overlay burst (WF 42) --------------------------------------
{
  const p = project('WF 42 Electric Overlay')!;
  near('WF 42: overlay mode', p.explosionEffect?.mode, 'effect');
  near('WF 42: damage type read back without a kind', p.explosionEffect?.damageType, 'electric');
  check(
    'WF 42: the arm is not left behind as custom Lua',
    !p.enableCustomLua && !(p.customLuaSnippet ?? '').includes('set_message_electric'),
    p.customLuaSnippet ?? '(empty)',
  );
  const lua = generateLuaCode(fullProject(p, 'WF 42 Electric Overlay'));
  check(
    'WF 42: WA blast is armed, not replaced',
    lua.includes('zap.set_message_electric_missile(20, ev.worm, 2)') &&
      !lua.includes('blast.explode{'),
    'arm or replacement wrong',
  );
  check(
    'WF 42: px.electric declared',
    generateModToml(fullProject(p, 'WF 42 Electric Overlay')).includes('"px.electric"'),
    'dependency missing',
  );
}

// ---- stamp frame from the builder's angle (WF 44) -------------------------
{
  const p = project('WF 44 Stamp Builder Angle')!;
  near('WF 44: the stamp is on', p.terrainStamp?.enabled, true);
  near('WF 44: impact angle mode', p.terrainStamp?.onImpact, true);
  near('WF 44: the pierce is off', p.terrainStamp?.impact?.enabled, false);
  near('WF 44: the spin survives', p.missileSprite?.anim, 'slow');
  near('WF 44: the spin rate survives', p.missileSprite?.spinRate, 2);
  const lua = generateLuaCode(fullProject(p, 'WF 44 Stamp Builder Angle'));
  check(
    'WF 44: the frame comes from the builder angle',
    lua.includes(
      'frame = stamp_orientation(ev.vx or 0, ev.vy or 0, sb.heading and sb.heading(ev.missile))',
    ),
    'the velocity helper is used instead',
  );
  check(
    'WF 44: the helper falls back to the velocity',
    lua.indexOf('if deg then return math.floor(deg / 11.25 + 0.5) % 32 end') > 0 &&
      lua.includes('if vx == 0 then return vy > 0 and 16 or 0 end'),
    'the fallback chain is missing',
  );
  check(
    'WF 44: the builder is required for the lookup',
    lua.includes('local sb = require("wf-lib/wfws_sprite_builder")') &&
      lua.indexOf('local sb = require') < lua.indexOf('sb.heading and sb.heading(ev.missile)'),
    'sb is not in scope where the frame is written',
  );
}

// ---- builder offset (WF 45) ----------------------------------------------
{
  const p = project('WF 45 Builder Offset')!;
  near('WF 45: the size survives', p.missileSprite?.size, 2);
  near('WF 45: offset x', p.missileSprite?.offsetX, 6);
  near('WF 45: offset y', p.missileSprite?.offsetY, -6);
  const lua = generateLuaCode(fullProject(p, 'WF 45 Builder Offset'));
  check(
    'WF 45: the offset reaches the builder',
    lua.includes('offset = { x = 6, y = -6 },'),
    'the sb.flight call has no offset',
  );
  // Re-exporting the imported project must keep the same call, or the round
  // imports with its art centred and silently loses the pivot fix.
  check(
    'WF 45: a re-export keeps the offset',
    generateLuaCode(fullProject(p, 'WF 45 Builder Offset')).includes(
      'offset = { x = 6, y = -6 },',
    ),
    'the offset is dropped on re-export',
  );
}

// ---- hold offset / aiming manager (WF 46) --------------------------------
{
  const p = project('WF 46 Hold Offset')!;
  near('WF 46: the hold offset survives', p.hold?.offsetX, 8);
  near('WF 46: the hold offset y survives', p.hold?.offsetY, -10);
  const lua = generateLuaCode(fullProject(p, 'WF 46 Hold Offset'));
  check(
    'WF 46: the hold is built by the aiming manager',
    lua.includes('local hold = sb.hold(ctx, {') && lua.includes('hold = hold,'),
    'the quad layer is not used, so the offset cannot reach the engine',
  );
  check(
    'WF 46: the offset and the mute are emitted',
    lua.includes('offset = { x = 8, y = -10 },') && lua.includes('silent_sheet = "sprites/'),
    'the SB call is missing the offset or the silent sheet',
  );
  // A hold without an offset must stay on the engine's own table: no quad
  // layer, no extra atlas slot, no silent sheet in the bundle.
  const plain = fullProject({ ...p, hold: { ...p.hold!, offsetX: 0, offsetY: 0 } }, 'WF 46 Hold Offset');
  const plainLua = generateLuaCode(plain);
  check(
    'WF 46: a centred hold keeps the engine draw',
    !plainLua.includes('sb.hold') &&
      !plainLua.includes('silent.png') &&
      /^\s+hold = \{$/m.test(plainLua),
    'a hold with no offset was pushed onto the quad layer',
  );
  check(
    'WF 46: a re-export keeps the offset',
    generateLuaCode(fullProject(p, 'WF 46 Hold Offset')).includes('offset = { x = 8, y = -10 },'),
    'the offset is dropped on re-export',
  );
  // The quad layer resolves its sheet through the claim `sprites` registry, so
  // an aim-layer hold has to claim hold.png even when it is the default art.
  // Without it the engine's own draw is muted and the quads cannot resolve,
  // and the hold swings only for authors who happened to upload a sheet.
  check(
    'WF 46: the aim layer claims the hold sheet',
    lua.includes(`sprites = { "${holdSheetPath(fullProject(p, 'WF 46 Hold Offset'))}" }`),
    'wa.draw.quad cannot resolve the hold path, so the quad layer draws nothing',
  );
}

// ---- the Space swing (WF 47) ---------------------------------------------
{
  const p = project('WF 47 Swing Idle')!;
  const clip = p.aimClip;
  near('WF 47: the clip imports enabled', clip?.enabled, true);
  near('WF 47: the clip length', clip?.ticks, 16);
  near('WF 47: the finish', clip?.finish, 'endTurn');
  near('WF 47: the keys come back', clip?.keys.length, 4);
  near('WF 47: the strike key angle', clip?.keys[2]?.angle, 60);
  near('WF 47: the strike key easing', clip?.keys[2]?.ease, 'out_cubic');
  // `fade = false` on the last key: opacity steps at the key instead of easing
  // into it, which is what keeps a return home from fading out on the way.
  near('WF 47: the return keeps its alpha', clip?.keys[3]?.alpha, 0.6);
  near('WF 47: the return does not fade', clip?.keys[3]?.fade, false);
  near('WF 47: an untagged key fades', clip?.keys[2]?.fade, undefined);
  const lua = generateLuaCode(fullProject(p, 'WF 47 Swing Idle'));
  check(
    'WF 47: the return key is written with fade = false',
    lua.includes('alpha = 0.6, fade = false, ease = "out_quad"'),
    'a key that should step its opacity was written without `fade = false`',
  );
  check(
    'WF 47: the clip is emitted as keys',
    lua.includes('swing = {') &&
      lua.includes('{ t = 8, angle = 60, dx = 3, dy = -3, scale = 1.1, ease = "out_cubic" },'),
    'the swing table is missing or the keys are not in ticks',
  );
  check(
    'WF 47: Space does not fire',
    /eat_fire = true,/.test(lua),
    'the weapon would fire as well as swing',
  );
  check(
    'WF 47: the swing forces the quad layer',
    lua.includes('local hold = sb.hold(ctx, {') && lua.includes('silent_sheet = '),
    'the clip cannot be drawn by the engine hold',
  );
  check(
    'WF 47: a re-export keeps the clip',
    generateLuaCode(fullProject(p, 'WF 47 Swing Idle')).includes('{ t = 16, angle = 0,'),
    'the swing is dropped on re-export',
  );
  check(
    'WF 47: the swing claims its hold sheet',
    lua.includes(`sprites = { "${holdSheetPath(fullProject(p, 'WF 47 Swing Idle'))}" }`),
    'the swing cannot draw: the sheet is not in the claim sprites',
  );
}

// ---- a wide firing sheet and a hand that is off (WF 32, re-celled) -------
// The firing sheet is WA's strip: the cell is the sheet's width and its height
// over the frame count. Forcing it square drew a 113x32 muzzle flash into a
// 32x32 quad (squashed), and the hand key did not follow the aim hand's off
// switch, so the firing pass kept drawing a hand the panel said was hidden.
{
  const base = fullProject(project('WF 32 Hold Flash')!, 'Wide Flash');
  near('WF 32: the case has a firing sheet', !!base.hold?.flashFile, true);
  const wide: WeaponProject = {
    ...base,
    hold: {
      ...base.hold!,
      // The author's own numbers: one 113x32 frame, hands off on both tabs.
      fireFrames: 1,
      flashWidth: 113,
      flashHeight: 32,
      drawHand: false,
      fireDrawHand: undefined,
    },
  };
  const lua = generateLuaCode(wide);
  check(
    'WF 32: a one-frame firing sheet keeps its own shape',
    lua.includes('cell_w = 113,') && lua.includes('cell_h = 32,'),
    'the quad is square, so a wide muzzle flash is drawn squashed',
  );
  check(
    'WF 32: the firing hand follows the aim hand',
    lua.includes('draw_hand = false,'),
    'the firing pass keeps drawing a hand the panel shows as off',
  );
  const strip: WeaponProject = {
    ...base,
    hold: { ...base.hold!, fireFrames: 4, flashWidth: 60, flashHeight: 240 },
  };
  const stripLua = generateLuaCode(strip);
  check(
    'WF 32: a strip is cut out of the height',
    stripLua.includes('cell_w = 60,') && stripLua.includes('cell_h = 60,'),
    'the strip cell is not width x (height / frames)',
  );
}

// ---- the ghost trail (WF 48) ---------------------------------------------
{
  const p = project('WF 48 Echo Trail')!;
  const echo = p.aimClip?.echo;
  near('WF 48: the trail imports enabled', echo?.enabled, true);
  near('WF 48: the ghost count', echo?.count, 5);
  near('WF 48: the spacing', echo?.every, 3);
  near('WF 48: the fade', echo?.fade, 0.6);
  near('WF 48: the blend', echo?.blend, 'add');
  const lua = generateLuaCode(fullProject(p, 'WF 48 Echo Trail'));
  check(
    'WF 48: the trail is emitted with the clip',
    lua.includes('echo = { count = 5, every = 3, fade = 0.6, blend = "add" },'),
    'the ghosts are dropped, so the swing draws a single blade',
  );
  check(
    'WF 48: a re-export keeps the trail',
    generateLuaCode(fullProject(p, 'WF 48 Echo Trail')).includes('echo = { count = 5,'),
    'the ghost trail is lost on re-export',
  );
}

// ---- the second hand (WF 49) ---------------------------------------------
{
  const p = project('WF 49 Second Hand')!;
  const extra = p.hold?.extraHand;
  near('WF 49: the second hand imports enabled', extra?.enabled, true);
  near('WF 49: its radius', extra?.radius, -6);
  near('WF 49: its scale', extra?.scale, 0.9);
  near('WF 49: its nudge', `${extra?.offsetX},${extra?.offsetY}`, '2,-3');
  near('WF 49: its art comes with it', !!extra?.file, true);
  const full = fullProject(p, 'WF 49 Second Hand');
  const lua = generateLuaCode(full);
  check(
    'WF 49: the second hand is emitted',
    lua.includes('extra_hand = {') &&
      lua.includes(`  sheet = "${extraHandSheetPath(full)}",`) &&
      lua.includes('  radius = -6,') &&
      lua.includes('  offset = { x = 2, y = -3 },') &&
      lua.includes('  radial_rotation = 1,'),
    'the engine has one hand slot, so a layer-drawn second hand is the only way it draws',
  );
  check(
    'WF 49: the aim layer is required for it',
    lua.includes('local hold = sb.hold(ctx, {') && lua.includes('silent_sheet = '),
    'the second hand cannot be drawn by the engine hold',
  );
  check(
    'WF 49: its sheet is in the claim sprites',
    lua.includes(`"${extraHandSheetPath(full)}"`),
    'wa.draw.quad cannot resolve hand2.png',
  );
  check(
    'WF 49: no firing pass, so no firing grip keys',
    !lua.includes('fire_radius =') && !lua.includes('fire_draw ='),
    'the firing grip is emitted for a weapon that never fires a sheet',
  );
}

// ---- the second hand's own firing grip (WF 32) ---------------------------
// The firing pass is its own pose, so the support hand has its own numbers for
// it; the keys are only written when there is a firing pass at all.
{
  const p = project('WF 32 Hold Flash')!;
  const extra = p.hold?.extraHand;
  near('WF 32: the second hand is on this weapon', extra?.enabled, true);
  near('WF 32: its aim radius', extra?.radius, -6);
  near('WF 32: its firing radius', extra?.fireRadius, -14);
  near('WF 32: its firing rotation', extra?.fireRotation, 20);
  near('WF 32: its firing scale', extra?.fireScale, 0.8);
  near('WF 32: its firing nudge', `${extra?.fireOffsetX},${extra?.fireOffsetY}`, '-3,5');
  const lua = generateLuaCode(fullProject(p, 'WF 32 Hold Flash'));
  check(
    'WF 32: the firing grip is emitted next to the aim grip',
    lua.includes('  radius = -6,') &&
      lua.includes('  fire_radius = -14,') &&
      lua.includes('  fire_offset = { x = -3, y = 5 },') &&
      lua.includes('  fire_scale = 0.8,'),
    'the support hand cannot sit anywhere else on the firing sheet',
  );
  check(
    'WF 32: a re-export keeps the firing grip',
    generateLuaCode(fullProject(p, 'WF 32 Hold Flash')).includes('fire_radius = -14,'),
    'the firing grip is lost on re-export',
  );
}

// ---- the melee strike (WF 50) --------------------------------------------
{
  const p = project('WF 50 Melee Strike')!;
  const m = p.melee;
  near('WF 50: the strike imports enabled', m?.enabled, true);
  near('WF 50: the reach', m?.radius, 40);

  // The combo: three strikes, each with its own frame, damage and throw.
  const combo = project('WF 55 Melee Combo')!;
  const comboHits = combo.melee?.hits ?? [];
  check('WF 55: three strikes import', comboHits.length === 3, String(comboHits.length));
  check(
    'WF 55: their frames come back',
    comboHits.map((hit) => hit.frame).join(',') === '8,16,22',
    comboHits.map((hit) => hit.frame).join(','),
  );
  check(
    'WF 55: their damage comes back',
    comboHits.map((hit) => hit.damage).join(',') === '10,12,16',
    comboHits.map((hit) => hit.damage).join(','),
  );
  check(
    'WF 55: their throws come back',
    comboHits.map((hit) => `${hit.power}/${hit.lift}`).join(',') === '2/0,4/1,6/3',
    comboHits.map((hit) => `${hit.power}/${hit.lift}`).join(','),
  );
  check(
    'WF 55: a melee claim imports as the melee family',
    combo.fireType === 'melee',
    `fireType is ${combo.fireType}: the record is an ordinary power one, so only the claim says melee`,
  );
  check(
    'WF 55: the strike sounds come back',
    combo.melee?.hitSound.id === 96 &&
      combo.melee?.hitSound.priority === 10 &&
      combo.melee?.missSound.id === 96 &&
      combo.melee?.missSound.priority === 8,
    `${combo.melee?.hitSound.id}@${combo.melee?.hitSound.priority} / ${combo.melee?.missSound.id}@${combo.melee?.missSound.priority}`,
  );
  const comboLua = generateLuaCode(fullProject(combo, 'WF 55 Melee Combo'));
  check(
    'WF 55: the combo is emitted again',
    // Every listed strike writes its own `lift` now, zero included: a missing
    // key inherits the weapon's `lift`, which threw the flat strike with the
    // first one's.
    /hits = \{\s*\{ frame = 8, damage = 10, power = 2, lift = 0, sound = 6 \}/.test(comboLua),
    'the `hits` table is missing from the regenerated Lua',
  );
  // A strike with a sample of its own: a light jab and a heavier second hit,
  // and the strike that names none keeps playing the weapon's hit sound.
  check(
    'WF 55: each strike keeps its own sample',
    comboHits[0]?.sound?.id === 6 &&
      comboHits[1]?.sound?.id === 32 &&
      comboHits[1]?.sound?.priority === 9 &&
      comboHits[2]?.sound === undefined,
    comboHits.map((hit) => hit.sound?.id ?? '-').join(','),
  );
  check(
    'WF 55: and the per-strike samples are emitted again',
    /frame = 8, damage = 10, power = 2, lift = 0, sound = 6 \}/.test(comboLua) &&
      /frame = 16, damage = 12, power = 4, lift = 1, sound = 32, priority = 9 \}/.test(comboLua) &&
      /frame = 22, damage = 16, power = 6, lift = 3 \}/.test(comboLua),
    'a strike row lost its `sound`, or gained one it never had',
  );
  check(
    'WF 55: both sounds are emitted',
    comboLua.includes('hit_sound = 96,') && comboLua.includes('miss_sound = 96,'),
    'the strike sounds are missing from the melee table',
  );
  check(
    'WF 55: the callback reads the strike',
    /hit = function\(victim, vx, vy, hit\) victim:hurt\{ amount = hit and hit\.damage/.test(
      comboLua,
    ),
    'the hit callback does not take the strike',
  );

  // The emitter: the ring, its bend, the anchors and the rainbow, read back out
  // of the table `emitter_for` returns rather than guessed from a call.
  const emitterWeapon = project('WF 56 Emitter Ring')!;
  const em = emitterWeapon.emitter;
  near('WF 56: the emitter imports enabled', em?.enabled, true);
  check('WF 56: its anchor', em?.anchor === 'muzzle', String(em?.anchor));
  check('WF 56: it hands over to the round', em?.carry === true, String(em?.carry));
  near('WF 56: the muzzle offset', em?.offsetX, 25);
  near('WF 56: reach direction round-trips', em?.reachDirection, -90);
  near('WF 56: reach spread round-trips', em?.reachSpread, 120);
  near('WF 56: emitter color round-trips', em?.color, '#8fc4ff');
  check('WF 56: reach stays enabled', em?.reach === true, String(em?.reach));
  check(
    'WF 56: the ring comes back',
    em?.ring.enabled === true && Math.round(em.ring.radius) === 26,
    JSON.stringify(em?.ring),
  );
  // The file stores radians; the panel stores degrees.
  near('WF 56: the ring spin', em?.ring.speed, 4);
  near('WF 56: the ring bend', em?.ring.ellipseX, 1.2);
  near('WF 56: the ring bend the other way', em?.ring.ellipseY, 0.45);
  check(
    'WF 56: the ring tracks the heading',
    em?.ring.track === true,
    String(em?.ring.track),
  );
  check('WF 56: the emitter ribbon', em?.trail.enabled === true, String(em?.trail.enabled));
  near('WF 56: its noise', em?.trail.noise, 1.5);
  const emitterLua = generateLuaCode(fullProject(emitterWeapon, 'WF 56 Emitter Ring'));
  check(
    'WF 56: the emitter is emitted again',
    emitterLua.includes('local function emitter_for(') &&
      emitterLua.includes('ellipse = { 1.2, 0.45 }') &&
      emitterLua.includes('track = true,') &&
      emitterLua.includes('wa.on.missile_frame(function(m)') &&
      emitterLua.includes('EMITTER_ROUNDS[m.id]') &&
      emitterLua.includes('emitter_round(m.id)') &&
      !emitterLua.includes('on_fire = function'),
    'the emitter block is missing from the regenerated Lua, or it claimed on_fire (which replaces WA\'s shot)',
  );
  check(
    'WF 56: the emitter carries effects.sdk',
    /dependencies = \[[^\]]*"effects\.sdk"/.test(
      generateModToml(fullProject(emitterWeapon, 'WF 56 Emitter Ring')),
    ),
    'effects.sdk is not in the manifest',
  );
  // WF 57 and WF 58: the code the two pack weapons were written to carry.
  const hurtWeapon = project('WF 57 Carried Hurt')!;
  check(
    'WF 57: a foreign handler is carried',
    hurtWeapon.carriedLua?.registrations?.length === 1 &&
      hurtWeapon.carriedLua.registrations[0].event === 'hurt',
    String(hurtWeapon.carriedLua?.registrations?.map((registration) => registration.event)),
  );
  check(
    'WF 57: and the helper it closes over comes with it',
    hurtWeapon.carriedLua?.prologue.some((block) => block.declares.includes('label_for')) === true,
    hurtWeapon.carriedLua?.prologue.map((block) => block.declares.join(',')).join(' | '),
  );
  const hurtLua = generateLuaCode(fullProject(hurtWeapon, 'WF 57 Carried Hurt'));
  check(
    'WF 57: the carried handler is emitted again',
    hurtLua.includes('wa.on.hurt(function(hit)') &&
      hurtLua.includes('local function label_for(amount)') &&
      hurtLua.indexOf('local function label_for(amount)') < hurtLua.indexOf('wa.on.hurt(function(hit)'),
    'the carried handler or its helper is missing from the regenerated Lua',
  );
  const mergeWeapon = project('WF 58 Carried Merge')!;
  // An export merges the bundle's body and the author's into one handler, so a
  // re-import of that export sees one body: both halves arrive as carried code,
  // and the snippet box stays empty. That is the shape of the round trip, not a
  // loss: the two bodies are still there, in order, and the claim still has one
  // `on_explode`.
  const mergedBody = mergeWeapon.carriedLua?.hooks?.[0];
  check(
    'WF 58: the merged body comes back whole',
    mergeWeapon.carriedLua?.hooks?.length === 1 &&
      mergedBody?.key === 'on_explode' &&
      mergedBody.text.includes('wa.sound.play(ev.worm, 88, 5)') &&
      mergedBody.text.includes('wa.sound.play(ev.worm, 96, 6)') &&
      mergeWeapon.customLuaSnippet === '',
    mergedBody?.text ?? 'no carried on_explode',
  );
  const mergeLua = generateLuaCode(fullProject(mergeWeapon, 'WF 58 Carried Merge'));
  check(
    'WF 58: one on_explode, bundle first, then the author, then the stamp',
    mergeLua.split('on_explode = { on = function').length - 1 === 1 &&
      mergeLua.indexOf('wa.sound.play(ev.worm, 88, 5)') <
        mergeLua.indexOf('wa.sound.play(ev.worm, 96, 6)') &&
      mergeLua.indexOf('wa.sound.play(ev.worm, 96, 6)') < mergeLua.indexOf('wa.land.stamp{'),
    `keys ${mergeLua.split('on_explode = { on = function').length - 1}, order ${mergeLua.indexOf('wa.sound.play(ev.worm, 88, 5)')}/${mergeLua.indexOf('wa.sound.play(ev.worm, 96, 6)')}/${mergeLua.indexOf('wa.land.stamp{')}`,
  );
  check(
    'WF 56: its own handlers are not carried back',
    !emitterWeapon.carriedLua?.registrations?.some(
      (r) => r.event === 'worm_message' || r.event === 'body_move' || r.event === 'missile_frame',
    ) && !emitterWeapon.carriedLua?.hooks?.some((h) => h.key === 'on_fire'),
    'a re-import carried our own emitter registrations or on_fire, which would ship two emitters',
  );

  // The aim clamp: degrees either side of level, read back out of `aim_clamp`.
  const clamp = project('WF 53 Aim Clamp')!;
  near('WF 53: the clamp imports enabled', clamp.hold.aimClamp?.enabled, true);
  near('WF 53: the clamp up', clamp.hold.aimClamp?.up, 45);
  near('WF 53: the clamp down', clamp.hold.aimClamp?.down, 45);
  // The same clamp on a firearm reaches `seq_dir`, which is the launch vector.
  const firearm = project('WF 54 Fire Angle Clamp')!;
  near('WF 54: the clamp imports', firearm.hold.aimClamp?.up, 30);
  const firearmLua = generateLuaCode(fullProject(firearm, 'WF 54 Fire Angle Clamp'));
  check(
    'WF 54: the clamp limits the burst direction',
    /local AIM_LO, AIM_HI = 0\.3333, 0\.6667/.test(firearmLua) &&
      /local ang = \(1 - aim_clamped\(w\.aim\)\) \* math\.pi/.test(firearmLua),
    'seq_dir does not use the clamped aim',
  );
  check(
    'WF 53: the clamp is emitted into the hold spec',
    /aim_clamp = \{ up = 45, down = 45 \}/.test(generateLuaCode(fullProject(clamp, 'WF 53 Aim Clamp'))),
    'the aim clamp is missing from the generated hold table',
  );
  near('WF 50: the arc width', m?.width, 18);
  near('WF 50: it follows the swing', m?.followSwing, true);
  near('WF 50: the hit frame', m?.hitFrame, 8);
  near('WF 50: the damage', m?.damage, 24);
  near('WF 50: the throw', `${m?.pushMode},${m?.pushPower},${m?.lift}`, 'aim,3.5,2');
  near('WF 50: the strike log', m?.log, true);
  const full = fullProject(p, 'WF 50 Melee Strike');
  const lua = generateLuaCode(full);
  check(
    'WF 50: the strike is emitted inside the hold spec',
    lua.includes('melee = {') &&
      lua.includes('  hit_frame = 8,') &&
      lua.includes('  follow_swing = true,') &&
      lua.includes('  push = "aim",') &&
      lua.includes('  power = 3.5,') &&
      lua.includes('  lift = 2,') &&
      lua.includes('  log = true,'),
    'the swing has no box to land',
  );
  check(
    "WF 50: the hit is the weapon's own callback",
    // The strike is the callback's fourth argument now, so a combo can give each
    // hit its own damage; the literal keeps a three-argument caller working.
    lua.includes(
      'hit = function(victim, vx, vy, hit) victim:hurt{ amount = hit and hit.damage or 24, vx = vx, vy = vy } end,',
    ),
    'the damage (and its kind) has to stay in the weapon, not in the library',
  );
  // A strike used to keep the trigger with `eat_fire`, which skipped WA's whole
  // shot: no ammo, no launch step, and the clip then zeroed the turn clock, so
  // the turn ended whether or not the record asked for it. Now the record fires
  // a ghost and WA owns the turn.
  check(
    'WF 50: a strike does not eat the trigger',
    !lua.includes('eat_fire') && lua.includes('local hold = sb.hold(ctx, {'),
    'the claim still swallows FireWeapon, so WA never takes the shot',
  );
  check(
    'WF 50: the shot it fires is a ghost',
    ['sprite = 0,', 'trail = { sprite = 0 },', 'action = "none",', 'burst = "nothing",', 'retreat = 5000,'].every(
      (row) => lua.includes(row),
    ),
    'a melee that fires a real shot would draw, blast and hurt',
  );
  // WA hands the turn over when the shot it fired is gone or the retreat runs
  // out, so a ghost that detonated on contact at the worm's feet still ended the
  // turn a frame after the swing. A nonzero `fuse` is also WA's "timed, not
  // impact detonated" switch, so the ghost lives exactly the retreat window.
  check(
    'WF 50: the ghost outlives the retreat',
    lua.includes('fuse = 5000,'),
    'a contact-detonated ghost ends the turn before the retreat window is seen',
  );
  const ownRetreat: WeaponProject = {
    ...full,
    recordOverrides: { ...full.recordOverrides, 'handling.retreat': 8000 },
  };
  const ownRetreatLua = generateLuaCode(ownRetreat);
  check(
    'WF 50: an author retreat moves the fuse with it',
    ownRetreatLua.includes('retreat = 8000,') && ownRetreatLua.includes('fuse = 8000,'),
    'the window and the ghost lifetime disagreed, so the shorter one ended the turn',
  );
  check(
    'WF 50: the clip leaves the turn to the game',
    !lua.includes('finish = "end_turn"'),
    'zeroing the turn clock at the clip end is the arbitrary turn end',
  );
  check(
    'WF 50: the base is the Sheep Launcher',
    lua.includes('copy_from = "stock.sheep_launcher"'),
    "WA's bat resolves its own hit in one frame, so the worm never animates",
  );
  check(
    'WF 50: a re-export keeps the strike',
    generateLuaCode(full).includes('hit_frame = 8,'),
    'the strike is dropped on re-export',
  );
  // The electrical hit is `px.electric`'s own `hurt_electric`, which needs the
  // module declared as `zap` and the dependency that ships it.
  const taze: WeaponProject = { ...full, melee: { ...m!, kind: 'taze' } };
  const tazeLua = generateLuaCode(taze);
  check(
    'WF 50: an electrical strike tazes through px.electric',
    /^local zap$/m.test(tazeLua) &&
      tazeLua.includes('zap = require("wf-lib/electric/damage")') &&
      tazeLua.includes('zap.hurt_electric(victim, hit and hit.damage or 24,'),
    "WA's taze kind alone is a Prod: the worm would not spark",
  );
  check(
    'WF 50: the electrical strike declares px.electric',
    generateModToml(taze).includes('px.electric'),
    'the module would not resolve at load',
  );
}

// ---- electrical pierce (WF 43) -------------------------------------------
{
  const p = project('WF 43 Electric Pierce')!;
  near('WF 43: impact enabled', p.terrainStamp?.impact?.enabled, true);
  near('WF 43: hit kind', p.terrainStamp?.impact?.kind, 'taze');
  near('WF 43: the card is on, the impact rides it', p.terrainStamp?.enabled, true);
  near('WF 43: no stamp sprite', !!p.terrainStamp?.sheet, false);
  const lua = generateLuaCode(fullProject(p, 'WF 43 Electric Pierce'));
  check(
    'WF 43: zap is a local before stamp_hit',
    /^local zap$/m.test(lua) && lua.indexOf('local zap') < lua.indexOf('local function stamp_hit'),
    'the arm would read a nil global',
  );
  check(
    'WF 43: stamp_hit reads it after install assigns it',
    lua.indexOf('    zap = require("wf-lib/electric/damage")') >
      lua.indexOf('install = function(ctx)'),
    'required at load, where wa does not exist',
  );
  check(
    'WF 43: the pierce arms its hurt before it lands',
    lua.indexOf('zap.set_message_electric(20') > lua.indexOf('local function stamp_hit') &&
      lua.indexOf('zap.set_message_electric(20') < lua.indexOf('o:hurt{'),
    'arm missing or after the hurt',
  );
  check(
    'WF 43: px.electric declared',
    generateModToml(fullProject(p, 'WF 43 Electric Pierce')).includes('"px.electric"'),
    'dependency missing',
  );
  check(
    'WF 43: no stamp is written',
    !lua.includes('wa.land.stamp{') && !generateModToml(fullProject(p, 'WF 43 Electric Pierce')).includes('stamp.png'),
    'a stamp the author did not enable',
  );
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

// ---- what the import says it could not carry ----------------------------
// The three real bundles this was built against: the Conductor's hand-written
// `on_fire` (its whole weapon), a `shot` WAV with no sequential-fire burst to
// play it, and a module whose `copy_from` is built at load (PX's `px.ports`).
{
  // `on_fire` is reported unless the `fire_seq` burst inside it was rebuilt, so
  // the editor's own weapons stay quiet while an author's own handler does not.
  const claim = {
    name: 'X',
    copy_from: 'stock.grenade',
    on_fire: null,
    on_explode: null,
    on_click: null,
  } as unknown as Parameters<typeof unmodelledClaimKeys>[0];
  check(
    'a hand-written on_fire is reported as not carried',
    unmodelledClaimKeys(claim).join(',') === 'on_fire,on_click',
    unmodelledClaimKeys(claim).join(','),
  );
  check(
    'and an absorbed on_fire (the fire_seq burst) is not',
    unmodelledClaimKeys(claim, ['on_fire']).join(',') === 'on_click',
    unmodelledClaimKeys(claim, ['on_fire']).join(','),
  );
  check(
    'on_explode is carried into the snippet, so it is never "not carried"',
    !unmodelledClaimKeys(claim).includes('on_explode'),
  );

  // The editor's own `on_fire` is a `fire_seq` burst, so it is carried as the
  // fire-sequence feature and must not be reported. If the burst stopped being
  // read, this is the check that notices: `on_fire` would then be "not carried".
  const seqWeapon = weapons.find((w) => w.modulePath.includes('29_fire_seq'));
  const seqProject = seqWeapon ? projects.get(seqWeapon.name) : undefined;
  check('the pack has the sequential-fire weapon', !!seqWeapon && !!seqProject);
  check(
    "its on_fire is carried as the fire_seq feature",
    !!seqProject?.fireSequence?.enabled,
    String(seqProject?.fireSequence?.enabled),
  );
  check(
    'so the import does not report it as lost',
    !!seqWeapon &&
      unmodelledClaimKeys(seqWeapon.source, ['on_fire']).length === 0 &&
      unmodelledClaimKeys(seqWeapon.source).includes('on_fire'),
    seqWeapon ? unmodelledClaimKeys(seqWeapon.source).join(',') : 'no weapon',
  );
}

// ---- this editor's own wa.on handlers are recognised ---------------------
// M1.5: the ribbon trail, the interval sound and the fuse sampler are the
// editor's own emission, so an import must say a panel writes them again rather
// than reporting them as code nothing models. If this regresses, a re-import
// would carry them as foreign code on top of the features (two ribbons).
{
  const withHandlers: string[] = [];
  // The two weapons written to carry a bundle's code say so instead: WF 57's
  // `wa.on.hurt` is nothing the panels model, and M6 carries it. A "not modelled"
  // line is only a failure for a handler this editor's own panels *do* emit.
  const carriedOnPurpose = new Set(['WF 57 Carried Hurt']);
  for (const [name, notes] of notesByName) {
    const line = notes.find((note) => note.startsWith('wa.on handlers:'));
    if (!line) continue;
    withHandlers.push(name);
    check(
      `${name}: its wa.on handlers are rebuilt from the panels`,
      carriedOnPurpose.has(name) ? /not modelled \(hurt\)/.test(line) : !/not modelled/.test(line),
      line,
    );
  }
  check(
    'the pack has weapons whose own handlers were recognised',
    withHandlers.length >= 5,
    String(withHandlers.length),
  );
}

// ---- no bundle requires the retired held-art helper ---------------------
// `px_hold_art` is absorbed into `sb.hold` (`keep_firing` + the `fire` role), so
// nothing the editor writes may require it or its `size` key.
for (const [name, p] of projects) {
  const lua = generateLuaCode(fullProject(p, name));
  check(
    `${name}: no px_hold_art`,
    !lua.includes('px_hold_art') && !lua.includes('hold_art.'),
    'the retired helper is still required',
  );
}

// ---- a hold of one frame over a multi-cell picture ------------------------
// PX's Buffalo of Lies holds frame 0 of a 20-cell run cycle, which the manifest
// declares as `frames = 20`. The import has to keep both numbers: the cell count
// is what slices the PNG, `frames` is what the hold plays. Reading only
// `hold.frames` made the export declare the strip as one cell.
{
  const sheet = readFileSync(join(ROOT, 'public/assets/defaults/default_hand_grenade.png'));
  const cellsFiles: ModFile[] = [
    {
      path: 'cells/mod.toml',
      text: `id = "t.cells"
name = "Cells Test"
version = "1.0.0"
[sprites."sprites/cells/s.png"]
frames = 20
fps = 32
play = "loop"

[[components]]
id = "t.cells.herd"
type = "weapon"
name = "Herd"
entry = "weapons/herd.lua"
`,
    },
    {
      path: 'cells/weapons/herd.lua',
      text: `return {
  copy_from = "stock.grenade",
  sprites = { "sprites/cells/s.png" },
  hold = { sheet = "sprites/cells/s.png", frames = 1, weap_radius = -8 },
}`,
    },
    { path: 'cells/sprites/cells/s.png', text: '', bytes: new Uint8Array(sheet) },
  ];
  const cellsBundle = readBundles(cellsFiles);
  const cellsWeapon = readWeapons(cellsBundle, cellsFiles)[0];
  if (cellsWeapon) {
    const imported = await importBundleWeapon(cellsWeapon, cellsFiles);
    const hold = (imported.project as WeaponProject).hold;
    check(
      'a hold over a 20-cell picture keeps its cell count',
      hold?.frames === 1 && hold?.sheetFrames === 20,
      `frames ${hold?.frames}, sheetFrames ${hold?.sheetFrames}`,
    );
    const toml = generateModToml(imported.project as WeaponProject);
    // The export writes the hold into the weapon's own folder, so the path is
    // the component id's segment, not the source bundle's.
    const decl = toml.indexOf('[sprites."sprites/herd/hold.png"]');
    check(
      'and the export declares the cells, not the played frame',
      decl >= 0 && /frames = 20/.test(toml.slice(decl, decl + 120)),
      decl < 0 ? 'the hold sheet is not declared' : toml.slice(decl, decl + 120),
    );
  }
}

// ---- launch WAV + explosion WAV round-trip cleanly without duplication ----
{
  const wavBytes = new Uint8Array([82, 73, 70, 70]);
  const baseProject: WeaponProject = {
    ...fullProject(
      {
        ...projects.get('WF 23 Custom Sounds')!,
        customSounds: {
          launchEnabled: true,
          launch: { file: new File([wavBytes], 'launch.wav', { type: 'audio/wav' }), fileName: 'launch.wav', previewUrl: '', size: 4 },
          launchPriority: 4,
          explosionEnabled: true,
          explosion: { file: new File([wavBytes], 'explosion.wav', { type: 'audio/wav' }), fileName: 'explosion.wav', previewUrl: '', size: 4 },
          explosionPriority: 16,
          shotEnabled: false,
          shotEvery: 1,
          shotPriority: 8,
          intervalEnabled: false,
          intervalMs: 400,
          intervalDelayMs: 0,
          intervalLimit: 0,
          intervalPriority: 8,
        },
      } as WeaponProject,
      'Launch Boom',
    ),
    id: 't.launch.boom',
  };
  const lua1 = generateLuaCode(baseProject);
  const toml1 = generateModToml(baseProject);
  const sFiles: ModFile[] = [
    { path: 'launch_boom/mod.toml', text: toml1 },
    { path: 'launch_boom/weapons/boom.lua', text: lua1 },
    { path: 'launch_boom/sounds/boom/launch.wav', text: '', bytes: wavBytes },
    { path: 'launch_boom/sounds/boom/explosion.wav', text: '', bytes: wavBytes },
  ];
  const sBundle = readBundles(sFiles);
  const sWeapon = readWeapons(sBundle, sFiles)[0];
  check('launch + explosion bundle scans', !!sWeapon);
  if (sWeapon) {
    const imp = await importBundleWeapon(sWeapon, sFiles);
    const ip = imp.project as WeaponProject;
    near('launch WAV priority round-trips', ip.customSounds?.launchPriority, 4);
    near('explosion WAV priority does not collide with launch priority', ip.customSounds?.explosionPriority, 16);
    near('no carried hooks from own launch WAV', ip.carriedLua?.hooks?.length ?? 0, 0);
    near('no carried registrations from own launch WAV', ip.carriedLua?.registrations?.length ?? 0, 0);
    const lua2 = generateLuaCode({
      ...fullProject(ip, baseProject.name),
      id: baseProject.id,
      name: baseProject.name,
      donorBaseline: ip.donorBaseline,
    });
    check('launch + explosion WAV Lua round-trip is byte-identical', lua2 === lua1, 'lua changed on re-export');
  }
  // Even when `on_fire` itself contains an earlier `wa.sound.play(ev.worm, ...)`
  // (e.g. a sequential-fire burst with launch WAV), `explosionPriority` must
  // still match the explosion WAV's own priority.
  const seqBoomProject: WeaponProject = {
    ...baseProject,
    fireSequence: {
      ...DEFAULT_FIRE_SEQUENCE,
      enabled: true,
      mode: 'missiles',
      count: 2,
      delay: 6,
      speed: 20,
    },
  };
  const seqFiles: ModFile[] = [
    { path: 'seq_boom/mod.toml', text: generateModToml(seqBoomProject) },
    { path: 'seq_boom/weapons/boom.lua', text: generateLuaCode(seqBoomProject) },
    { path: 'seq_boom/sounds/boom/launch.wav', text: '', bytes: wavBytes },
    { path: 'seq_boom/sounds/boom/explosion.wav', text: '', bytes: wavBytes },
  ];
  const seqW = readWeapons(readBundles(seqFiles), seqFiles)[0];
  if (seqW) {
    const imp = await importBundleWeapon(seqW, seqFiles);
    const ip = imp.project as WeaponProject;
    near('launch WAV priority inside on_fire', ip.customSounds?.launchPriority, 4);
    near('explosion WAV priority ignores earlier on_fire play', ip.customSounds?.explosionPriority, 16);
  }

  // `fires.subtype` must survive import and re-export.
  const subFiles: ModFile[] = [
    {
      path: 'sub/mod.toml',
      text: 'id = "t.sub"\nname = "Sub"\nversion = "0.1.0"\n\n[[components]]\nid = "t.sub.item"\ntype = "weapon"\nname = "Sub"\nentry = "weapons/item.lua"\n',
    },
    {
      path: 'sub/weapons/item.lua',
      text: 'return {\n  install = function(ctx)\n    wa.weapons.replace{\n      name = "Sub",\n      copy_from = "stock.grenade",\n      fires = { subtype = 4 },\n    }\n  end,\n}',
    },
  ];
  const subW = readWeapons(readBundles(subFiles), subFiles)[0];
  if (subW) {
    const imp = await importBundleWeapon(subW, subFiles);
    const ip = imp.project as WeaponProject;
    near('fires.subtype survives import in specialSubtype', ip.specialSubtype, 4);
    const reLua = generateLuaCode(fullProject(ip, 'Sub'));
    check('fires.subtype survives re-export', reLua.includes('subtype = 4'), reLua);
  }

  // ---- F11: import / re-export symmetry ------------------------------------
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const pngSheet = new File([pngBytes], 'sheet.png', { type: 'image/png' });
  const holdSymProj = {
    ...fullProject(projects.get('WF 01 Builder Track')!, 'Hold Sym'),
    id: 't.hold_sym',
    hold: {
      ...DEFAULT_IMPORT_HOLD,
      enabled: true,
      sheetFile: pngSheet,
      sheetWidth: 60,
      sheetHeight: 60,
      frames: 1,
      drawHand: false,
      handScale: 2,
      flashFile: pngSheet,
      flashWidth: 60,
      flashHeight: 60,
      fireDrawHand: true,
      fireHandRadius: 0,
      fireHandScale: 1,
    },
  } as WeaponProject;
  const holdSymFiles: ModFile[] = [
    { path: 'hold_sym/mod.toml', text: generateModToml(holdSymProj) },
    { path: 'hold_sym/weapons/hold_sym.lua', text: generateLuaCode(holdSymProj) },
    { path: 'hold_sym/sprites/hold_sym/hold.png', text: '', bytes: pngBytes },
    { path: 'hold_sym/sprites/hold_sym/flash.png', text: '', bytes: pngBytes },
  ];
  const holdSymW = readWeapons(readBundles(holdSymFiles), holdSymFiles)[0];
  if (holdSymW) {
    const imp = await importBundleWeapon(holdSymW, holdSymFiles);
    const ip = imp.project as WeaponProject;
    check(
      'hold firing role preserves fireDrawHand=true, fireHandRadius=0, fireHandScale=1',
      ip.hold?.fireDrawHand === true && ip.hold?.fireHandRadius === 0 && ip.hold?.fireHandScale === 1,
      JSON.stringify({
        draw: ip.hold?.fireDrawHand,
        rad: ip.hold?.fireHandRadius,
        scale: ip.hold?.fireHandScale,
      }),
    );
  }

  // 2. Melee omitted sounds default to 0 / priority 8
  const meleeMinLua = `local sb = require("wf-lib/wfws_sprite_builder")
return {
  install = function(ctx)
    local hold = sb.hold(ctx, {
      sheet = "sprites/mm/hold.png",
      cell_w = 60,
      cell_h = 60,
      melee = {
        radius = 30,
        width = 12,
        hits = { { frame = 4, damage = 10, power = 2, lift = 0 } },
      },
    })
    wa.weapons.replace{ name = "Melee Min", copy_from = "stock.grenade", hold = hold }
  end,
}`;
  const mmFiles: ModFile[] = [
    { path: 'mm/mod.toml', text: 'id = "t.mm"\nname = "MM"\nversion = "0.1.0"\ndependencies = ["wf.sdk", "wfws.sdk"]\n\n[[components]]\nid = "t.mm.item"\ntype = "weapon"\nname = "Melee Min"\nentry = "weapons/mm.lua"\n' },
    { path: 'mm/weapons/mm.lua', text: meleeMinLua },
    { path: 'mm/sprites/mm/hold.png', text: '', bytes: pngBytes },
  ];
  const mmW = readWeapons(readBundles(mmFiles), mmFiles)[0];
  if (mmW) {
    const imp = await importBundleWeapon(mmW, mmFiles);
    check(
      'omitted melee sounds default to miss id = 0 and priority = 8',
      imp.project.melee?.missSound.id === 0 &&
        imp.project.melee?.missSound.priority === 8 &&
        imp.project.melee?.hitSound.priority === 8,
      JSON.stringify({ hit: imp.project.melee?.hitSound, miss: imp.project.melee?.missSound }),
    );
  }

  // 3. stamp_hit electric does not force fx.burst damageType to 'electric'; comment in stamp_clear respected
  const pierceOverlayLua = `local zap = require("wf-lib/electric/damage")
local fx = require("wf-lib/effects/px_effects")
local function stamp_hit(ev)
  zap.set_message_electric(20, 0, -4, true, 2)
end
return {
  install = function(ctx)
    wa.weapons.replace{
      name = "Pierce Overlay",
      copy_from = "stock.bazooka",
      on_explode = function(ev)
        if stamp_hit(ev) then return end
        if stamp_clear(ev.x, ev.y) then
          -- end
          wa.land.stamp{ sprite = "sprites/po/stamp.png", frame = 0, x = ev.x, y = ev.y }
        end
        fx.burst{ x = ev.x, y = ev.y }
        wa.log("keep_custom")
      end,
    }
  end,
}`;
  const poFiles: ModFile[] = [
    { path: 'po/mod.toml', text: 'id = "t.po"\nname = "PO"\nversion = "0.1.0"\ndependencies = ["effects.sdk", "px.electric"]\n\n[[components]]\nid = "t.po.item"\ntype = "weapon"\nname = "Pierce Overlay"\nentry = "weapons/po.lua"\n' },
    { path: 'po/weapons/po.lua', text: pierceOverlayLua },
    { path: 'po/sprites/po/stamp.png', text: '', bytes: pngBytes },
  ];
  const poW = readWeapons(readBundles(poFiles), poFiles)[0];
  if (poW) {
    const imp = await importBundleWeapon(poW, poFiles);
    const carriedExplode = imp.project.carriedLua?.hooks?.find((h) => h.key === 'on_explode')?.text ?? '';
    check(
      'stamp_hit zap does not flip fx.burst overlay damageType to electric and masked stamp_clear keeps custom body',
      imp.project.explosionEffect?.damageType === 'blast' &&
        carriedExplode.includes('wa.log("keep_custom")'),
      `${imp.project.explosionEffect?.damageType} | ${carriedExplode}`,
    );
  }
  const customZapFiles: ModFile[] = [
    { path: 'cz/mod.toml', text: 'id = "t.cz"\nname = "CZ"\nversion = "0.1.0"\n\n[[components]]\nid = "t.cz.item"\ntype = "weapon"\nname = "Custom Zap"\nentry = "weapons/cz.lua"\n' },
    {
      path: 'cz/weapons/cz.lua',
      text: 'local zap = require("wf-lib/electric/damage")\nreturn {\n  install = function(ctx)\n    wa.weapons.replace{\n      name = "Custom Zap",\n      copy_from = "stock.bazooka",\n      on_explode = function(ev)\n        zap.set_message_electric_missile(20, ev.worm, 2)\n      end,\n    }\n  end,\n}',
    },
  ];
  const czW = readWeapons(readBundles(customZapFiles), customZapFiles)[0];
  if (czW) {
    const imp = await importBundleWeapon(czW, customZapFiles);
    const czExplode = imp.project.carriedLua?.hooks?.find((h) => h.key === 'on_explode')?.text ?? '';
    check(
      'standalone zap.set_message_electric_missile is preserved in carried on_explode when stripOwnedBurst is false',
      czExplode.includes('zap.set_message_electric_missile(20, ev.worm, 2)'),
      czExplode,
    );
  }

  // 4. Sequential fire offsetY = 0 & liveAim = false
  const seqZeroProj = {
    ...fullProject(projects.get('WF 01 Builder Track')!, 'Seq Zero'),
    id: 't.seqzero',
    fireSequence: {
      ...DEFAULT_FIRE_SEQUENCE,
      enabled: true,
      offsetX: 0,
      offsetY: 0,
      liveAim: false,
    },
  } as WeaponProject;
  const seqZeroFiles: ModFile[] = [
    { path: 'sz/mod.toml', text: generateModToml(seqZeroProj) },
    { path: 'sz/weapons/seqzero.lua', text: generateLuaCode(seqZeroProj) },
  ];
  const szW = readWeapons(readBundles(seqZeroFiles), seqZeroFiles)[0];
  if (szW) {
    const imp = await importBundleWeapon(szW, seqZeroFiles);
    check(
      'seq zero offsetY=0 and liveAim=false round-trip without custom on_fire warning',
      imp.project.fireSequence?.offsetY === 0 &&
        imp.project.fireSequence?.liveAim === false &&
        !imp.notes.some((n) => n.includes('custom code beyond the sequential-fire burst')),
      `${imp.project.fireSequence?.offsetY} | notes=${imp.notes.join(';')}`,
    );
  }

  // 5. Air Strike fireType, Teleport on_select, single-weapon slot
  const strikeTeleFiles: ModFile[] = [
    {
      path: 'st/mod.toml',
      text: `id = "t.st"\nname = "ST"\nversion = "0.1.0"\n\n[[components]]\nid = "t.st.strike"\ntype = "weapon"\nname = "Strike"\nentry = "weapons/strike.lua"\ndefault_position = { row = "F2", column = 1 }\n\n[[components]]\nid = "t.st.tele"\ntype = "weapon"\nname = "Tele"\nentry = "weapons/tele.lua"\n`,
    },
    {
      path: 'st/weapons/strike.lua',
      text: 'return {\n  install = function(ctx)\n    wa.weapons.replace{\n      name = "Strike",\n      copy_from = "stock.air_strike",\n      missile = { wind_pct = 80 },\n    }\n  end,\n}',
    },
    {
      path: 'st/weapons/tele.lua',
      text: 'return {\n  install = function(ctx)\n    wa.weapons.replace{\n      name = "Tele",\n      copy_from = "stock.grenade",\n      on_select = { cursor = true },\n    }\n  end,\n}',
    },
  ];
  const stWs = readWeapons(readBundles(strikeTeleFiles), strikeTeleFiles);
  if (stWs.length === 2) {
    const sImp = await importBundleWeapon(stWs[0], strikeTeleFiles);
    const tImp = await importBundleWeapon(stWs[1], strikeTeleFiles);
    check(
      'air strike keeps cursor fireType and single-weapon slot reads manifest default_position',
      sImp.project.fireType === 'cursor' && sImp.project.slot === 'grenade',
      `${sImp.project.fireType} | ${sImp.project.slot}`,
    );
    check(
      'teleport on_select = { cursor = true } sets fireType = cursor',
      tImp.project.fireType === 'cursor',
      String(tImp.project.fireType),
    );
  }

  // 6. Partial missile.trail & clusters.bit.homing stock names
  // 7. Unreferenced sprites = { "sprites/x/trail.png" } does not become packArt.missile_trail
  // 8. rec.<path> = <literal> merges into recordExtra
  const extraFiles: ModFile[] = [
    {
      path: 'ex/mod.toml',
      text: 'id = "t.ex"\nname = "Ex"\nversion = "0.1.0"\n\n[[components]]\nid = "t.ex.item"\ntype = "weapon"\nname = "Ex"\nentry = "weapons/ex.lua"\n',
    },
    {
      path: 'ex/weapons/ex.lua',
      text: `return {
  install = function(ctx)
    local rec = {
      name = "Ex",
      copy_from = "stock.grenade",
      sprites = { "sprites/ex/trail.png" },
      missile = {
        trail = { power = 7 },
      },
      clusters = {
        bit = {
          action = "homing",
          homing = { kind = "lock", sprite = "missile", trail = { sprite = "smklt25" } },
        },
      },
    }
    rec.missile = rec.missile or {}
    rec.missile.extra_tag = "ok"
    wa.weapons.replace(rec)
  end,
}`,
    },
    { path: 'ex/sprites/ex/trail.png', text: '', bytes: pngBytes },
  ];
  const exW = readWeapons(readBundles(extraFiles), extraFiles)[0];
  if (exW) {
    const imp = await importBundleWeapon(exW, extraFiles);
    check(
      'partial missile.trail without sprite does not force enabled = false',
      imp.project.recordOverrides?.['missile.trail.enabled'] === true &&
        imp.project.recordOverrides?.['missile.trail.power'] === 7,
      String(imp.project.recordOverrides?.['missile.trail.enabled']),
    );
    check(
      'clusters.bit.homing resolves stock sprite names missile and smklt25 to numeric ids',
      imp.project.body?.clustlet.homing_sprite === 48 &&
        imp.project.body?.clustlet.homing_trail_sprite === 609,
      JSON.stringify({
        hs: imp.project.body?.clustlet.homing_sprite,
        hts: imp.project.body?.clustlet.homing_trail_sprite,
      }),
    );
    check(
      'unreferenced sprites/ex/trail.png stem is not promoted to packArt.missile_trail',
      imp.project.packArt?.missile_trail === undefined,
      String(imp.project.packArt?.missile_trail),
    );
    check(
      'post-literal rec.missile.extra_tag = "ok" round-trips through recordExtra',
      (imp.project.recordExtra?.missile as Record<string, unknown> | undefined)?.extra_tag === 'ok',
      JSON.stringify(imp.project.recordExtra),
    );
  }

  // 9. modToml handles trailing comments, escaped quotes, and typed arrays
  const parsedToml = parseToml(`
id = "t.toml" # package id
nums = [1, 2, "three"] # mixed array
quoted = ["a\\"b,c", "d"] # escaped quote with comma
`);
  check(
    'modToml strips inline comments, preserves escapes in arrays, and types array elements',
    parsedToml.values.id === 't.toml' &&
      Array.isArray(parsedToml.values.nums) &&
      parsedToml.values.nums[0] === 1 &&
      parsedToml.values.nums[2] === 'three' &&
      Array.isArray(parsedToml.values.quoted) &&
      parsedToml.values.quoted.length === 2 &&
      parsedToml.values.quoted[0] === 'a"b,c',
    JSON.stringify(parsedToml.values),
  );
}

// ---- hold_as: a thrown builder weapon keeps its held pose ----------------
// WF 33 is a Cluster Bomb whose record sprite the builder zeroes; the claim
// lends the stock pose back, and an import must carry it so a re-export does.
{
  const name = 'WF 33 Builder Bit Homing';
  const p = project(name);
  check('WF 33 imports its hold_as', p?.holdAs === 'stock.cluster_bomb', String(p?.holdAs));
  const lua = p ? generateLuaCode(fullProject(p, name)) : '';
  check(
    'and writes it back once',
    (lua.match(/\bhold_as = "stock\.cluster_bomb"/g) ?? []).length === 1,
    String((lua.match(/\bhold_as = /g) ?? []).length),
  );
  const bazooka = project('WF 01 Builder Track');
  check('a builder weapon on a launcher has none', !!bazooka && bazooka.holdAs === undefined, String(bazooka?.holdAs));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nWFWS bundle import: all checks passed (${projects.size} weapons)`);

