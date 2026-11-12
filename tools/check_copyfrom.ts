/**
 * `copy_from` re-basing check.
 *
 * A weapon that copies a stock donor shows that donor's record in the panels,
 * and the generator diffs against it so untouched values are left to the engine.
 * The bug this guards: the diff base stayed on the *previous* donor after the
 * donor changed, so every value the two donors shared was treated as
 * "unchanged" and never written. A Mortar carrying the Grenade's record -- burst
 * `nothing`, `push_pct` 100 -- exported neither, so the engine played the
 * Mortar's own clusters and its 0% push even though the author had turned both
 * off and set the push to 100.
 *
 * Run: `bun run tools/check_copyfrom.ts` (exits 1 on a failure).
 */
import type { WeaponProject } from '../src/types/weapon';
import { stockDonor, stockDonorBaseline } from '../src/data/stockDonors';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { generateLuaCode } from '../src/utils/luaGenerator';
import { rebaseToDonor } from '../src/utils/donorRebase';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};

/** A copy_from project seeded from `slot`, the way a fresh/imported one is. */
function projectFor(slot: string): WeaponProject {
  const donor = stockDonor(slot) ?? {};
  return {
    ...donor,
    id: `wftest.${slot}_check`,
    name: `${slot} check`,
    description: '',
    version: '0.1.0',
    author: 'test',
    slot,
    based_on: slot,
    fireType: donor.fireType ?? 'power',
    specialSubtype: donor.specialSubtype ?? 1,
    teleport: false,
    panel_icon: slot,
    defaults: { ammo: 3, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: 'retreat' },
    body: { ...DEFAULT_BODY, ...(donor.body ?? {}), clustlet: { ...DEFAULT_BODY.clustlet, ...(donor.body?.clustlet ?? {}) } },
    action: donor.action ?? 'none',
    burst: donor.burst ?? 'nothing',
    missileSprite: {
      enabled: false, mode: 'stock', stockSprite: slot, sheet: '', anim: 'rotation',
      frames: 1, fps: 15, animSpeed: 1, spinRate: 1, scale: 1, mirror: true, z: 5,
      animate: false, spin: true, hideStock: true,
    },
    bitFlight: { ...DEFAULT_ROLE_ART },
    behaviorArt: {},
    roamSheets: { flight1: {}, flight2: {} },
    ribbonTrail: { enabled: false, max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, color: '#ffffff', target: 'main' },
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
    customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
    fireSequence: undefined,
    extraDependencies: [],
    hold: {
      enabled: false, sheet: '', handType: 'mid', handRadius: 10, weapRadius: -8,
      weapRotation: 0, scale: 1, handScale: 1, frames: 1, fps: 15, animate: false,
      drawHand: true, keepWhileFiring: false, thrown: true, putAway: false,
      handRad: 10, handRadLower: 0, handRadUpper: 0,
    },
    packArt: {},
    customSprites: {},
    enableCustomLua: false,
    customLuaSnippet: '',
    useWepFile: false,
    recordOverrides: { ...(donor.recordOverrides ?? {}) },
    roamConfig: { ...DEFAULT_ROAM, ...(donor.roamConfig ?? {}) },
    digConfig: { ...DEFAULT_DIG, ...(donor.digConfig ?? {}) },
    fireConfig: { ...DEFAULT_FIRE, ...(donor.fireConfig ?? {}) },
    donorBaseline: stockDonorBaseline(slot),
  } as WeaponProject;
}

/** Turn the Mortar's clustlets off and give it the Grenade's 100% push. */
function edit(user: WeaponProject): WeaponProject {
  return {
    ...user,
    burst: 'nothing',
    recordOverrides: { ...user.recordOverrides, 'missile.explosion.push_pct': 100 },
  };
}

const has = (lua: string, text: string) => lua.includes(text);

// 1. Untouched Mortar: everything it shares with its donor stays inherited.
{
  const lua = generateLuaCode(projectFor('mortar'));
  check('untouched mortar emits no burst', !has(lua, 'burst ='));
  check('untouched mortar emits no clusters table', !has(lua, 'clusters = {'));
  check('untouched mortar emits no missile table', !has(lua, 'missile = {'));
}

// 2. The reported case, on a correct baseline.
{
  const lua = generateLuaCode(edit(projectFor('mortar')));
  check('edited mortar writes burst = "nothing"', has(lua, 'burst = "nothing"'));
  check('edited mortar writes its push', has(lua, 'push_pct = 100'));
  check('edited mortar writes no clusters table', !has(lua, 'clusters = {'));
}

// 3. The same project whose baseline was decoded from the Grenade: the
//    generator must not diff a Mortar `copy_from` against the Grenade.
{
  const stale: WeaponProject = {
    ...edit(projectFor('grenade')),
    based_on: 'mortar',
    slot: 'mortar',
    donorBaseline: stockDonorBaseline('grenade'),
  };
  const lua = generateLuaCode(stale);
  check('stale baseline still writes burst = "nothing"', has(lua, 'burst = "nothing"'));
  check('stale baseline still writes its push', has(lua, 'push_pct = 100'));
  check('stale baseline writes no clusters table', !has(lua, 'clusters = {'));
}

// 4. Re-basing the donor: inherited values follow the Mortar, the author's own
//    edits survive, and the user's two changes then export.
{
  const grenade = projectFor('grenade');
  const mortar = rebaseToDonor(grenade, 'mortar');
  check('rebase adopts the mortar burst', mortar.burst === 'clusters', `got ${mortar.burst}`);
  check('rebase adopts the mortar push', mortar.recordOverrides['missile.explosion.push_pct'] === 0, String(mortar.recordOverrides['missile.explosion.push_pct']));
  check('rebase adopts the mortar damage', mortar.body.damage === 15, String(mortar.body.damage));
  check('rebase records the new baseline', mortar.donorBaseline?.slot === 'mortar', String(mortar.donorBaseline?.slot));
  const lua = generateLuaCode(edit(mortar));
  check('rebased mortar writes burst = "nothing"', has(lua, 'burst = "nothing"'));
  check('rebased mortar writes its push', has(lua, 'push_pct = 100'));

  const editedGrenade: WeaponProject = {
    ...grenade,
    body: { ...grenade.body, damage: 77 },
    recordOverrides: { ...grenade.recordOverrides, 'missile.explosion.push_pct': 42 },
  };
  const kept = rebaseToDonor(editedGrenade, 'mortar');
  check('rebase keeps an edited damage', kept.body.damage === 77, String(kept.body.damage));
  check('rebase keeps an edited push', kept.recordOverrides['missile.explosion.push_pct'] === 42, String(kept.recordOverrides['missile.explosion.push_pct']));
  check('rebase drops the old donor gravity_pct edit', kept.body.gravity_pct === 100, String(kept.body.gravity_pct));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\ncopy_from re-base: all checks passed');
