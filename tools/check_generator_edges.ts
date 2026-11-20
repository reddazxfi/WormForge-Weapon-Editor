/**
 * Generator edge cases a user's own data can reach. No server, exits 1 on a
 * failure.
 *
 *   bun run tools/check_generator_edges.ts
 *
 * Three of them, each one a bug that was found by the audit and could be hit
 * again by an import:
 *
 *  - an **array** in `recordExtra` used to be written as `= nil` and lost;
 *  - a **non-identifier key** used to be written as `rec.["k"]`, which is a Lua
 *    syntax error, so the whole weapon module failed to compile;
 *  - `parseCustomLua` counted `end`/`if`/`for` inside comments and strings, so a
 *    custom `on_explode` with "the end" in a comment was truncated and the rest
 *    of the snippet was emitted as broken Lua.
 */
import {
  parseCustomLua,
  hookBodyOf,
  autoDependenciesForProject,
  generateLuaCode,
  generateModToml,
  generateProfileToml,
  customSoundPath,
  meleeSoundPath,
} from '../src/utils/luaGenerator';
import { DEFAULT_ROLE_ART, DEFAULT_DIG_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_CLUSTLET } from '../src/data/defaults';
import { stockDonor, stockDonorBaseline } from '../src/data/stockDonors';
import { DEFAULT_BODY } from '../src/data/defaults';
import { DEFAULT_MELEE } from '../src/data/melee';
import { DEFAULT_EMITTER, DEFAULT_EMITTER_RING, DEFAULT_EMITTER_TRAIL } from '../src/data/emitter';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { scanLua } from '../src/utils/modLib/luaTable';
import { parseWepBinary } from '../src/utils/wepParser';
import { DEFAULT_IMPORT_HOLD, readBundleFeatures } from '../src/utils/modLib/importFeatures';
import { weaponBundlePart } from '../src/utils/packExporter';
import type { WeaponProject } from '../src/types/weapon';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};

const makeProject = (patch: Partial<WeaponProject> = {}): WeaponProject => {
  const base = stockDonor('grenade') as Partial<WeaponProject>;
  return {
    ...(base as WeaponProject),
    id: 'wfws.check.edges',
    name: 'Edges',
    based_on: 'stock.grenade',
    defaults: { ammo: 1, delay: 0, crateChance: 0, cratePool: 'default', afterFire: 'end_turn' },
    fireType: 'power',
    hold: { enabled: false } as WeaponProject['hold'],
    donorBaseline: stockDonorBaseline('grenade'),
    body: { ...DEFAULT_BODY, ...(base.body ?? {}) },
    action: 'bounce',
    burst: 'nothing',
    recordOverrides: { ...(base.recordOverrides ?? {}) },
    ...patch,
  } as WeaponProject;
};

// ---- ctx.option settings: declared in the manifest, valued in the profile --
{
  // `ctx.option` is a load contract: an undeclared key raises `"<id> has no
  // option <key>"`, so the declarations are written back verbatim and only a
  // value that differs from the declared default reaches the profile (the
  // engine's own editor stores the default as *no* value).
  const project = makeProject({
    customSprites: {},
    options: [
      {
        key: 'direction',
        kind: 'choice',
        label: 'After a collision',
        description: 'Keeps charging, turns around, or rolls a direction.',
        choices: ['straight', 'opposite', 'random'],
        default: 'straight',
      },
      { key: 'charges', kind: 'int', min: 1, max: 5, default: 3, data: true },
      { key: 'trail', kind: 'bool', default: true, fromBool: undefined },
    ],
  });
  const toml = generateModToml(project);
  const order = toml.indexOf('key = "direction"');
  const second = toml.indexOf('key = "charges"');
  const third = toml.indexOf('key = "trail"');
  check(
    'every declared option is written back in order, after the component',
    toml.indexOf('[[components.options]]') > toml.indexOf('default_position') &&
      order > 0 &&
      order < second &&
      second < third,
    `direction ${order}, charges ${second}, trail ${third}`,
  );
  check(
    'a choice keeps its list and default',
    toml.includes('choices = ["straight", "opposite", "random"]') && toml.includes('default = "straight"'),
  );
  check(
    'an int keeps its range',
    toml.includes('min = 1') && toml.includes('max = 5') && toml.includes('default = 3'),
  );
  check('data = true is written, because it makes the option a record field', toml.includes('data = true'));
  check(
    'a bool default is a TOML boolean',
    toml.includes('type = "bool"\ndefault = true'),
    toml.slice(toml.lastIndexOf('[[components.options]]')),
  );
  check(
    'and no value is written while every option is at its default',
    !generateProfileToml(project).includes('[options.'),
  );
  const changed = makeProject({
    customSprites: {},
    options: [
      { key: 'direction', kind: 'choice', choices: ['straight', 'opposite'], default: 'straight', value: 'opposite' },
      { key: 'trail', kind: 'bool', default: true, value: false },
    ],
  });
  const profile = generateProfileToml(changed);
  check(
    'a changed value lands in the profile under the component id',
    profile.includes('[options."wfws.check.edges"]') && profile.includes('"direction" = "opposite"') && profile.includes('"trail" = false'),
    profile,
  );
  check(
    'and a value equal to the default writes nothing',
    !generateProfileToml(
      makeProject({
        customSprites: {},
        options: [{ key: 'trail', kind: 'bool', default: true, value: true }],
      }),
    ).includes('[options.'),
  );
}

// ---- recordExtra: arrays survive, keys stay valid Lua ---------------------
{
  const project = makeProject();
  project.recordExtra = {
    missile: { some_list: [1, 2, 3], nested: [{ a: 1 }, { b: 2 }] },
    'weird-key': { x: 1 },
  } as unknown as WeaponProject['recordExtra'];
  const lines = generateLuaCode(project).split('\n');
  const text = lines.join('\n');

  check(
    'a list in recordExtra is written as a table',
    text.includes('rec.missile.some_list = { 1, 2, 3 }'),
    lines.find((l) => l.includes('some_list')) ?? 'no line',
  );
  check(
    'a list of tables is written as tables',
    text.includes('rec.missile.nested = { { a = 1 }, { b = 2 } }'),
    lines.find((l) => l.includes('nested')) ?? 'no line',
  );
  check(
    'no recordExtra value is dropped as nil',
    !/rec\.[\w."']+ = nil$/.test(text),
    lines.find((l) => / = nil$/.test(l)) ?? '',
  );
  check(
    'a quoted key uses brackets, not `rec.[`',
    text.includes('rec["weird-key"].x = 1'),
    lines.find((l) => l.includes('weird')) ?? 'no line',
  );
  check(
    'no `rec.[` anywhere (invalid Lua)',
    !text.includes('rec.['),
    lines.find((l) => l.includes('rec.[')) ?? '',
  );
}

// ---- parseCustomLua: comments and strings are not blocks ------------------
{
  const snippet = [
    'on_explode = function(ev)',
    '  -- the end of it, honestly; if only',
    '  local label = "if you see this, do not stop"',
    '  wa.explosion(ev.x, ev.y, 40)',
    'end',
    '',
    'local extra = 1',
  ].join('\n');
  const parsed = parseCustomLua(snippet);
  check(
    'the body keeps its last real statement',
    parsed.onExplodeBody.includes('wa.explosion(ev.x, ev.y, 40)'),
    parsed.onExplodeBody.replace(/\n/g, ' | '),
  );
  check(
    'the body stops at the function end',
    !parsed.onExplodeBody.includes('local extra'),
    parsed.onExplodeBody.replace(/\n/g, ' | '),
  );
  check('the rest of the snippet survives', parsed.remainingSnippet.includes('local extra = 1'));
  check('the comment stays out of the rest', !parsed.remainingSnippet.includes('the end of it'));
}

// ---- a template the engine does not know writes no copy_from -------------
// The engine refuses the whole bundle for `stock.<unknown>`, so one typo took
// every other weapon down with it. An unknown slot now writes the record
// without a template instead.
{
  const known = generateLuaCode(makeProject());
  check(
    'a real template is still written',
    known.includes('copy_from = "stock.grenade"'),
    'a known donor lost its copy_from',
  );
  const unknown = generateLuaCode(makeProject({ based_on: 'stock.famas' }));
  check(
    'an unknown template is not written',
    !/^\s*copy_from = /m.test(unknown),
    unknown.split(String.fromCharCode(10)).find((l) => /copy_from = /.test(l)) ?? 'no assignment',
  );
  check(
    'and the Lua says why',
    unknown.includes("not one of WA's own weapons"),
    'the fallback is silent',
  );
}

// ---- a commented-out on_explode is not a declaration ---------------------
{
  const snippet = ['-- on_explode = function(ev) end', 'local x = 1'].join('\n');
  const parsed = parseCustomLua(snippet);
  check('a commented-out on_explode is not extracted', !parsed.hasOnExplode);
  check(
    'and the snippet passes through untouched',
    parsed.remainingSnippet.includes('local x = 1'),
  );
}

// ---- the launch WAV rides WEAPON_RELEASED (or inside an existing on_fire) -
{
  // Claiming `on_fire` replaces WA's shot dispatch, so a normal weapon plays
  // its launch WAV from `wa.on.worm_message` filtered to `WEAPON_RELEASED`.
  const wav = new File([new Uint8Array([82, 73, 70, 70])], 'launch.wav', { type: 'audio/wav' });
  const asset = { file: wav, fileName: 'launch.wav', previewUrl: '', size: 4 };
  const plain = makeProject({
    customSounds: {
      launchEnabled: true,
      launch: asset,
      launchPriority: 10,
      explosionEnabled: false,
      explosionPriority: 8,
      shotEnabled: false,
      shotEvery: 1,
      shotPriority: 8,
      intervalEnabled: false,
      intervalMs: 400,
      intervalDelayMs: 0,
      intervalLimit: 0,
      intervalPriority: 8,
    },
  });
  const launchPath = customSoundPath(plain, 'launch')!;
  const text = generateLuaCode(plain);
  check(
    'a standalone launch WAV does not emit on_fire (which would eat WA shot)',
    !text.includes('on_fire = function') &&
      text.includes('local LAUNCH_SOUND = {') &&
      text.includes(`path = "${launchPath}",`) &&
      text.includes('wa.msg.WEAPON_RELEASED'),
    text.split(String.fromCharCode(10)).find((l) => l.includes('on_fire') || l.includes('LAUNCH_SOUND')) ?? 'no play',
  );
  check(
    'and its path is declared in the claim sounds list',
    text.includes(`sounds = { "${launchPath}" },`),
    'the engine would have nothing to load',
  );

  // Commented `-- on_fire =` must not disable the launch WAV or fireSequence.
  const commentedOut = {
    ...plain,
    enableCustomLua: true,
    customLuaSnippet: '-- on_fire = function(ev) end',
  };
  const commentedText = generateLuaCode(commentedOut);
  check(
    'a commented -- on_fire does not suppress the launch WAV',
    commentedText.includes('local LAUNCH_SOUND = {') && commentedText.includes(`sounds = { "${launchPath}" },`),
  );

  // An author's own `on_fire` owns the trigger: keeping launch WAV out avoids conflict.
  const hand = {
    ...plain,
    enableCustomLua: true,
    customLuaSnippet: 'on_fire = function(ev) wa.sound.play(ev.worm, "sounds/x/y.wav", 8) end',
  };
  const handText = generateLuaCode(hand);
  check(
    'a custom on_fire keeps the launch WAV out of the file',
    !handText.includes(launchPath),
    'two on_fire keys, one of them silently lost',
  );

  // Sequential fire already owns `on_fire`; the launch play goes inside it, so a
  // burst reports the trigger once instead of once per shot.
  const seq = makeProject({
    customSounds: plain.customSounds,
    fireSequence: {
      enabled: true,
      mode: 'missiles',
      count: 3,
      delay: 6,
      speed: 20,
      standoff: 6,
      spreadX: 0,
      spreadY: 0,
      offsetX: 0,
      offsetY: 0,
      liveAim: false,
      cancelOnWeaponChange: true,
    },
  } as Partial<WeaponProject>);
  const seqText = generateLuaCode(seq);
  const fireAt = seqText.indexOf('on_fire = function(ev)');
  // The path is also in the claim's `sounds` list, which comes first; the play
  // call itself is what has to sit inside the trigger.
  const playAt = seqText.indexOf(`wa.sound.play(ev.worm, "${launchPath}"`);
  check(
    'a burst plays the launch WAV inside its own on_fire',
    fireAt >= 0 && playAt > fireAt && playAt < seqText.indexOf('seq.fire_seq_mis{') && !seqText.includes('LAUNCH_SOUND'),
    playAt < 0 ? 'no play' : 'the play is outside the trigger',
  );
}

// ---- a melee strike's uploaded WAV ---------------------------------------
{
  // The swing plays the file by path, so the path has to be declared in the
  // claim's `sounds` list and the native id must step aside (a WAV wins).
  const wav = new File([new Uint8Array([82, 73, 70, 70])], 'hit.wav', { type: 'audio/wav' });
  const melee = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: {
      ...DEFAULT_MELEE,
      enabled: true,
      hitSound: {
        id: 96,
        priority: 16,
        file: { file: wav, fileName: 'hit.wav', previewUrl: '', size: 4 },
      },
      missSound: { id: 96, priority: 8 },
    },
  });
  const text = generateLuaCode(melee);
  const hitPath = meleeSoundPath(melee, 'hit')!;
  const rows = text.split(String.fromCharCode(10));
  check(
    'a melee WAV is played by path and its id steps aside',
    text.includes(`hit_wav = "${hitPath}"`) && !rows.some((l) => /^\s*hit_sound = /.test(l)),
    rows.find((l) => l.includes('hit_')) ?? 'no row',
  );
  check(
    'and the strike WAV is declared in the claim sounds list',
    rows.some((l) => l.startsWith('      sounds = {') && l.includes(hitPath)),
    'the engine would have nothing to play',
  );
  check(
    'the whiff keeps its native id and no priority row',
    rows.some((l) => /^\s*miss_sound = 96,$/.test(l)) &&
      !rows.some((l) => l.includes('miss_priority')),
    'the default 8 needs no row',
  );
}

// ---- melee: a swing always exists, and a strike owns its lift ------------
{
  // `sb.hold` builds the strike only when there is a clip, and the Swing
  // handler (which owns the Space edge) only runs when there is one: `melee`
  // with no keys was a weapon whose Space press did nothing. The panel refuses
  // to delete the last key, an imported bundle does not.
  const noKeys = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: { ...DEFAULT_MELEE, enabled: true },
  });
  const empty = generateLuaCode(noKeys);
  const emptyRows = empty.split(String.fromCharCode(10));
  const keyT = Number(/\{ t = (\d+), angle = 0,/.exec(empty)?.[1]);
  const hitFrame = Number(/hit_frame = (\d+),/.exec(empty)?.[1]);
  check(
    'a melee weapon with no clip keys still exports a swing',
    /^\s*swing = \{$/m.test(empty) && Number.isFinite(keyT),
    emptyRows.filter((l) => /swing|t = /.test(l)).join(' | ') || 'no swing at all',
  );
  check(
    'its single key sits on the strike frame, so the hit can land',
    keyT === hitFrame && Number.isFinite(hitFrame),
    `key at ${keyT}, hit frame ${hitFrame}`,
  );
  check(
    'and the file says why it invented that key',
    empty.includes('one pose at the strike frame'),
  );
  check('the strike is emitted with it', empty.includes('melee = {'));

  // A listed strike that throws flat used to omit `lift`, and `hold_melee_hits`
  // reads a missing key as the weapon's `lift`: the second strike of a combo was
  // thrown with the first one's.
  const combo = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [{ t: 8, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' }],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: {
      ...DEFAULT_MELEE,
      enabled: true,
      lift: 5,
      hits: [
        { frame: 8, damage: 10, power: 2, lift: 5 },
        { frame: 16, damage: 12, power: 4, lift: 0 },
      ],
    },
  });

// ---- a custom body is marked as not generated ----------------------------
{
  // `checkLua` answers "did the editor generate this" from these two comment
  // lines, so the generator has to write exactly one pair per custom body, around
  // the body and nothing else. A missing pair leaves a carried `start_vortex`
  // reading as a generated line; a duplicate makes a re-import nest them.
  const nl = String.fromCharCode(10);
  const carried = makeProject({
    enableCustomLua: true,
    customLuaSnippet: `on_explode = { on = function(ev)${nl}  start_vortex(ev.x, ev.y, ev.worm)${nl}end }`,
  });
  const text = generateLuaCode(carried);
  const lines = text.split(nl);
  const open = lines.filter((l) => l.includes('not generated by the editor')).length;
  const close = lines.filter((l) => /^\s*-- end not generated\s*$/.test(l)).length;
  check('one marker pair around the custom body', open === 1 && close === 1, `open ${open}, close ${close}`);
  const openAt = lines.findIndex((l) => l.includes('not generated by the editor'));
  check(
    'the body sits between the markers',
    lines[openAt + 1]?.trim() === 'start_vortex(ev.x, ev.y, ev.worm)' &&
      /^\s*-- end not generated\s*$/.test(lines[openAt + 2] ?? ''),
    lines.slice(openAt, openAt + 3).join(' / '),
  );
  check(
    'a weapon with no custom body writes no marker',
    !generateLuaCode(makeProject()).includes('not generated by the editor'),
  );
}

  const twice = generateLuaCode(combo).split(String.fromCharCode(10));
  check(
    'every listed strike writes its own lift, zero included',
    twice.some((l) => /^\s*\{ frame = 16, damage = 12, power = 4, lift = 0 \},$/.test(l)),
    twice.find((l) => l.includes('frame = 16')) ?? 'no second strike',
  );
}

// ---- the emitter ---------------------------------------------------------
// PX's effect manager is an actor with a follow closure, so what matters is
// which closer the generator writes: a muzzle emitter is moved from
// `worm_message` filtered to `FRAME_FINISH` (scanning `wa.worms.all()` for the
// turn worm so standing still to aim still spawns it before Space), a round
// emitter latches each missile frame, and a family with no missile must never
// be given one.
{
  const ring = { ...DEFAULT_EMITTER_RING, enabled: true };
  const muzzle = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle', ring } }),
  );
  check(
    'a muzzle emitter moves on FRAME_FINISH for the turn worm',
    muzzle.includes('wa.on.worm_message(function()') &&
      muzzle.includes('wa.msg.FRAME_FINISH') &&
      muzzle.includes('wa.worms.all()') &&
      muzzle.includes('EMITTER:move_to(x, y)'),
  );
  check(
    'by default it only shows while the worm is aiming',
    muzzle.includes('local held = w and w.weapon == ctx.id and (w.aiming)') &&
      !muzzle.includes('w.state == "firing"'),
  );
  const keepFiringMuzzle = generateLuaCode(
    makeProject({
      hold: { ...makeProject().hold, keepWhileFiring: true },
      emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle' },
    }),
  );
  check(
    'with keepWhileFiring on it also stays through firing/fired frames',
    keepFiringMuzzle.includes('w.aiming or w.state == "firing" or w.state == "fired"'),
  );
  check(
    'and it spawns an independent emitter per round without dropping the aim emitter',
    muzzle.includes('EMITTER_ROUNDS[m.id]') &&
      muzzle.includes('emitter_round(m.id)') &&
      !muzzle.includes('EMITTER_CARRIED') &&
      muzzle.includes('wa.on.missile_frame(function(m)'),
  );
  check(
    'the hand-off writes no on_fire',
    !muzzle.includes('on_fire = function'),
    'a claim on_fire replaces WA\'s shot, so the round was never fired',
  );
  check('the ring is emitted bent', muzzle.includes('ellipse = { 1, 1 }'));
  check('a round follower is written per round', muzzle.includes('local function emitter_round(id)'));

  const round = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'round' } }),
  );
  check(
    'a round emitter starts on the missile',
    round.includes('emitter_start(m.x, m.y, w,') &&
      round.includes('wa.on.missile_frame(function(m)'),
  );
  check('and needs no muzzle hook', !round.includes('wa.on.body_move') && !round.includes('wa.on.worm_message'));

  const noCarry = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, carry: false } }),
  );
  check(
    'carry off keeps the emitter an aiming effect',
    !noCarry.includes('EMITTER_ROUNDS') && !noCarry.includes('on_fire = function'),
    'an on_fire or round tracker was written for an emitter that never leaves the muzzle',
  );

  // A placed mine has no missile of the weapon, so a stored `round` anchor has
  // to fall back rather than emit a follower that can never latch.
  const mine = makeProject({
    fireType: 'drop',
    body: { ...DEFAULT_BODY, fuse: false },
    emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'round' },
  });
  const mineLua = generateLuaCode(mine);
  check(
    'a mine falls back to the muzzle',
    mineLua.includes('emitter_muzzle(') && !mineLua.includes('EMITTER_ROUNDS'),
    'the round anchor was emitted for a family with no missile',
  );

  // The muzzle anchor on that same mine still may not spawn round emitters
  // for rounds that never exist.
  const mineCarry = makeProject({
    fireType: 'drop',
    body: { ...DEFAULT_BODY, fuse: false },
    emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle', carry: true },
  });
  const mineCarryLua = generateLuaCode(mineCarry);
  check(
    'a mine keeps its carry on the muzzle',
    !mineCarryLua.includes('EMITTER_ROUNDS') &&
      !mineCarryLua.includes('EMITTER_CARRIED') &&
      !mineCarryLua.includes('on_fire = function'),
    'the emitter spawned round trackers for a placed mine that never fires a missile',
  );

  // The emitter's own ribbon needs `fx.install{ trail = true }`, which calls
  // `trail.install()` and registers the hook that draws the ribbon. This is
  // independent of the projectile trail card.
  const ribbonOnly = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        trail: { ...DEFAULT_EMITTER_TRAIL, enabled: true },
      },
    }),
  );
  check(
    'an emitter ribbon installs the trail module',
    /fx\.install\{ trail = true,/.test(ribbonOnly),
    'fx.install disabled the trail, so the emitter ribbon would never be drawn',
  );
  const noRibbon = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true } }),
  );
  check(
    'and nothing asks for it without one',
    /fx\.install\{ trail = false,/.test(noRibbon),
    'the trail module was installed for a weapon with no ribbon at all',
  );

  const projectileTrailOnly = generateLuaCode(
    makeProject({
      ribbonTrail: { enabled: true, max: 10, every: 1, vanish: 2, coreWidth: 3, glowWidth: 6, color: '#ffffff', target: 'main', noise: 0, rainbow: false },
      emitter: { ...DEFAULT_EMITTER, enabled: false, trail: { ...DEFAULT_EMITTER_TRAIL, enabled: false } },
    }),
  );
  check(
    'projectile ribbon installs without enabling the emitter',
    /fx\.install\{ trail = true,/.test(projectileTrailOnly) &&
      projectileTrailOnly.includes('local TRAIL = {') &&
      !projectileTrailOnly.includes('local function emitter_for(') &&
      !projectileTrailOnly.includes('trail.install()'),
    'the round trail was coupled to the emitter actor',
  );

  const emitterTrailOnly = generateLuaCode(
    makeProject({
      ribbonTrail: { enabled: false, max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, color: '#ffffff', target: 'main', noise: 0, rainbow: false },
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        trail: { ...DEFAULT_EMITTER_TRAIL, enabled: true },
      },
    }),
  );
  check(
    'emitter ribbon installs without enabling the projectile ribbon',
    /fx\.install\{ trail = true,/.test(emitterTrailOnly) &&
      emitterTrailOnly.includes('local function emitter_for(') &&
      !emitterTrailOnly.includes('local TRAIL = {'),
    'the emitter ribbon enabled a projectile trail sampler',
  );

  const tracking = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true, track: true },
      },
    }),
  );
  check(
    'a tracking ring writes track = true in its ring table',
    /ring = \{[\s\S]{0,400}track = true,/.test(tracking),
    'the ring table lost its heading tracking',
  );

  const radialMuzzle = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        anchor: 'muzzle',
        offsetX: 28,
        offsetY: 6,
        radialAngle: 15,
      },
    }),
  );
  check(
    'radialAngle and offsetY emit facing-symmetric radial muzzle math',
    radialMuzzle.includes('local a = (w.aim or 0.5) * math.pi + 0.2618') &&
      radialMuzzle.includes('return w.x + dx * 28 + w.facing * c * 6,') &&
      radialMuzzle.includes('w.y + dy * 28 - s * 6'),
    'emitter_muzzle did not emit radial angle or facing-symmetric side offset',
  );

  // Projectile Exclusive disables muzzle aiming emission while keeping fired
  // projectile emission active, unless the family has no projectile at all.
  const projExcl = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        anchor: 'muzzle',
        projectileExclusive: true,
        posX: 12,
        posY: -6,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true, angle: 0, track: false },
      },
    }),
  );
  check(
    'projectileExclusive omits muzzle aim handler and emits projectile tracker',
    projExcl.includes('projectile_exclusive = true,') &&
      !projExcl.includes('emitter_muzzle(') &&
      !projExcl.includes('wa.on.worm_message') &&
      projExcl.includes('EMITTER_ROUNDS') &&
      projExcl.includes('wa.on.missile_frame') &&
      projExcl.includes('emitter_start(m.x + 12, m.y - 6, w,'),
    'projectileExclusive either kept muzzle aim code or dropped projectile tracking',
  );
  check(
    'followFireAngle is enabled by default for ring projectiles when not tracking velocity',
    projExcl.includes('local function emitter_fire_angle(w)') &&
      projExcl.includes('spec.ring.angle = emitter_fire_angle(owner) + (spec.ring.angle or 0)') &&
      !projExcl.includes('follow_fire_angle = false,'),
    'default followFireAngle did not orient the ring to owner fire angle',
  );

  const mineProjExcl = generateLuaCode(
    makeProject({
      fireType: 'drop',
      body: { ...DEFAULT_BODY, fuse: false },
      emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle', projectileExclusive: true },
    }),
  );
  check(
    'a placed mine falls back to muzzle even when projectileExclusive is checked',
    mineProjExcl.includes('emitter_muzzle(') && !mineProjExcl.includes('EMITTER_ROUNDS'),
    'a mine without a missile dropped its emitter completely',
  );

  // Pure positional offsets without radial offsets emit no aim trig in emitter_muzzle.
  const purePosMuzzle = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        anchor: 'muzzle',
        offsetX: 0,
        offsetY: 0,
        radialAngle: 0,
        posX: 12,
        posY: -6,
        followFireAngle: false,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true, speed: 4, track: false },
      },
    }),
  );
  check(
    'pure posX/posY emit direct coordinate offsets without radial trig when radial offsets are zero',
    purePosMuzzle.includes('return w.x + w.facing * 12,\n        w.y - 6') &&
      !purePosMuzzle.includes('local a = (w.aim or 0.5) * math.pi') &&
      purePosMuzzle.includes('return p.x + 12, p.y - 6, p.vx, p.vy'),
    'pure positional offsets emitted radial trig or dropped round offsets',
  );
  check(
    'followFireAngle opt-out emits follow_fire_angle = false and omits emitter_fire_angle',
    purePosMuzzle.includes('follow_fire_angle = false,') &&
      !purePosMuzzle.includes('emitter_fire_angle') &&
      !purePosMuzzle.includes('EMITTER_SPIN'),
    'opt-out followFireAngle still emitted fire angle rotation',
  );

  // Follow owner fire angle with ring spin accumulates EMITTER_SPIN on muzzle ticks.
  const followSpinLua = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        anchor: 'muzzle',
        followFireAngle: true,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true, speed: 4, angle: 15, track: false },
      },
    }),
  );
  check(
    'followFireAngle + nonzero ring speed accumulates EMITTER_SPIN and updates EMITTER.ring.angle',
    followSpinLua.includes('local EMITTER_SPIN = 0') &&
      followSpinLua.includes('EMITTER.ring.angle = emitter_fire_angle(w) + 0.2618 + EMITTER_SPIN'),
    'EMITTER_SPIN accumulation or EMITTER.ring.angle assignment missing',
  );

  // Combined radial + pure positional offsets, plus round-trip re-import check.
  const combinedLua = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        anchor: 'muzzle',
        projectileExclusive: false,
        followFireAngle: false,
        offsetX: 28,
        offsetY: 6,
        radialAngle: 15,
        posX: -10,
        posY: 4,
      },
    }),
  );
  check(
    'radial offsets and pure positional offsets combine cleanly',
    combinedLua.includes('return w.x + dx * 28 + w.facing * c * 6 - w.facing * 10,') &&
      combinedLua.includes('w.y + dy * 28 - s * 6 + 4'),
    'combined radial + pure positional muzzle expression mismatch',
  );

  const parseFeatures = async (luaText: string) => {
    const scan = scanLua(luaText);
    return readBundleFeatures({
      weapon: {
        bundleId: 'x',
        bundleName: 'x',
        bundleDir: '',
        dependencies: [],
        spriteDecls: {},
        componentId: 'x',
        name: 'x',
        modulePath: '',
        source: scan.calls['wa.weapons.replace'],
      },
      files: [],
      moduleText: luaText,
      mappedPackArt: {},
      digging: false,
    });
  };
  const reimportedProjExcl = (await parseFeatures(projExcl)).project.emitter;
  check(
    'round-trip re-import preserves projectileExclusive, default followFireAngle, and posX/posY',
    reimportedProjExcl?.projectileExclusive === true &&
      reimportedProjExcl?.followFireAngle === true &&
      reimportedProjExcl?.posX === 12 &&
      reimportedProjExcl?.posY === -6,
    JSON.stringify(reimportedProjExcl),
  );
  const reimportedCombined = (await parseFeatures(combinedLua)).project.emitter;
  check(
    'round-trip re-import preserves followFireAngle = false alongside radial + pure offsets',
    reimportedCombined?.projectileExclusive === false &&
      reimportedCombined?.followFireAngle === false &&
      reimportedCombined?.offsetX === 28 &&
      reimportedCombined?.offsetY === 6 &&
      Math.round(reimportedCombined?.radialAngle ?? 0) === 15 &&
      reimportedCombined?.posX === -10 &&
      reimportedCombined?.posY === 4,
    JSON.stringify(reimportedCombined),
  );

  const disabledReachLua = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        reach: false,
        color: '#c06040',
      },
    }),
  );
  const importedDisabledReach = (await parseFeatures(disabledReachLua)).project.emitter;
  check(
    'disabled reach stays disabled across import/export',
    disabledReachLua.includes('reach = false,') && importedDisabledReach?.reach === false,
    JSON.stringify(importedDisabledReach),
  );
  check(
    'top-level emitter color survives when reach is disabled',
    importedDisabledReach?.color === '#c06040',
    String(importedDisabledReach?.color),
  );

  const zeroCountLua = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        reach: true,
        reachCount: 0,
      },
    }),
  );
  const importedZeroCount = (await parseFeatures(zeroCountLua)).project.emitter;
  check(
    'enabled reach with zero bolts stays enabled across re-import',
    importedZeroCount?.reach === true && importedZeroCount.reachCount === 0,
    JSON.stringify(importedZeroCount),
  );

  const rainbow = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        rainbow: true,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true },
        trail: { ...DEFAULT_EMITTER_TRAIL, enabled: true },
      },
    }),
  );
  const lines = rainbow.split(String.fromCharCode(10));
  const keys = lines.filter((l) => /^\s+rainbow = true,$/.test(l));
  // One switch, on the emitter's own table: `fx.emitter` hands it to the spark,
  // the glow, the reach, the ribbon and the ring that do not set one, which is
  // PX's single `SetRainbowMode`. A per-part key would say the same thing twice.
  check('the emitter rainbow is one switch', keys.length === 1, `${keys.length} rainbow keys`);
  check(
    'and it sits on the emitter, not a part',
    keys.length === 1 && /^ {8}rainbow = true,$/.test(keys[0]),
    JSON.stringify(keys[0] || ''),
  );
  check(
    'a part can still opt out',
    !/rainbow = false,/.test(rainbow),
    'no part writes rainbow = false',
  );
}

// ---- the trail and burst rainbow/noise -----------------------------------
{
  const lua = generateLuaCode(
    makeProject({
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 5,
        glowWidth: 9,
        noise: 3,
        rainbow: true,
        color: '#66ccff',
        target: 'main',
      },
      explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true, rainbow: true },
    }),
  );
  check('the ribbon writes its crackle noise', /^\s+noise = 3,$/m.test(lua));
  check('the ribbon writes its rainbow', /^\s+rainbow = true,$/m.test(lua));
  check(
    'the burst writes its rainbow',
    /fx\.burst\{[\s\S]{0,600}rainbow = true,/.test(lua),
    'the burst has no rainbow row',
  );
  const plain = generateLuaCode(
    makeProject({
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 5,
        glowWidth: 9,
        noise: 0,
        rainbow: false,
        color: '#66ccff',
        target: 'main',
      },
    }),
  );
  check(
    'a straight trail writes neither key',
    !/^\s+noise = 0,$/m.test(plain) && !/^\s+rainbow = false,$/m.test(plain),
  );
}

// ---- the trail asks the builder who the missile is, in the right order ----
// `sb.flight` and the ribbon trail both register `wa.on.missile_frame`, and the
// engine runs a mod's handlers in registration order. The builder has to decide
// the missile's identity before the trail asks for it, and a burst listed on the
// round's last frame is deliberately undecided for one frame, so the hook waits
// instead of guessing: guessing "not a bit" is what cost every cluster bit its
// ribbon when the trail card was set to "bits only".
{
  const base = makeProject();
  const bitTrail = generateLuaCode(
    makeProject({
      burst: 'clusters',
      missileSprite: { ...base.missileSprite!, enabled: true, mode: 'custom', anim: 'track', hideStock: true },
      bitFlight: { ...base.bitFlight!, mode: 'builder', anim: 'track', frames: 1 },
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 4,
        glowWidth: 8,
        color: '#66ccff',
        target: 'bit',
        noise: 0,
        rainbow: false,
      },
    }),
  );
  const flightAt = bitTrail.indexOf('sb.flight(ctx');
  const trailHookAt = bitTrail.indexOf('wa.on.missile_frame(function(m)');
  check(
    'the builder is registered before the trail hook',
    flightAt >= 0 && trailHookAt > flightAt,
    'the trail asked `sb.role` before the builder had seen the missile, so every bit read as nil',
  );
  check(
    'and the trail waits for an undecided identity',
    bitTrail.includes('if sb.role and sb.role(m.id) == nil then return end'),
    'a deferred burst was decided on its first frame instead of the next one',
  );
  check(
    'a bits-only trail keeps its bit guard',
    bitTrail.includes('if not trail_is_bit(m) then return end') && bitTrail.includes('bits = {'),
    'the emitted trail lost the bit target, the builder lost its bit role, or the guard was dropped',
  );

  // Without the builder there is no bit identity at all, and the hook would
  // silently trail nothing. The generated file says so instead of pretending.
  const noBuilderBits = generateLuaCode(
    makeProject({
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 4,
        glowWidth: 8,
        color: '#66ccff',
        target: 'bit',
        noise: 0,
        rainbow: false,
      },
    }),
  );
  check(
    'a bits-only trail without the builder says it cannot tell them apart',
    noBuilderBits.includes('no missile is trailed') &&
      !noBuilderBits.includes('local role = sb.role and sb.role(m.id)'),
    'the file claims a bit identity it does not have',
  );

  // A builder that owns the round art but leaves the bits to WA answers "main"
  // for every frag. Using that for Main Round would trail the bits too, so the
  // live-ribbon test is the better answer there.
  const nativeBits = generateLuaCode(
    makeProject({
      burst: 'clusters',
      missileSprite: { ...base.missileSprite!, enabled: true, mode: 'custom', anim: 'track', hideStock: true },
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 4,
        glowWidth: 8,
        color: '#66ccff',
        target: 'main',
        noise: 0,
        rainbow: false,
      },
    }),
  );
  check(
    'a builder with no bit role falls back to the live-ribbon test',
    nativeBits.includes('return trail_live()') &&
      !nativeBits.includes('local role = sb.role and sb.role(m.id)'),
    'a builder with no bit role called every frag "main", so Main Round trailed the bits too',
  );
}

// ---- every effects named in the file has its module in scope --------------
// A claim that names `trail.BEAM` has to have `trail` in scope, and the same
// holds for `fx` and `blast`: the SDK sheets are named by module, so a weapon
// that installs one library without requiring it fails to load with
// "attempt to index a nil value (global 'trail')", which is what a burst-only
// weapon did once the ribbon card stopped deciding the require.
{
  const projects: [string, WeaponProject][] = [
    [
      'a burst-only weapon',
      makeProject({ explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true } }),
    ],
    [
      'a blast replacement',
      makeProject({
        explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true, mode: 'blast' },
      }),
    ],
    [
      'a ribbon trail',
      makeProject({
        ribbonTrail: {
          enabled: true,
          max: 10,
          every: 1,
          vanish: 2,
          coreWidth: 5,
          glowWidth: 9,
          noise: 0,
          rainbow: false,
          color: '#66ccff',
          target: 'main',
        },
      }),
    ],
    [
      'an emitter',
      makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true } }),
    ],
  ];
  // Quoted pack paths can contain the same word (`sprites/x/trail.png`), so
  // the test looks for the module's own members, not the bare prefix.
  const usedBy: Record<'trail' | 'fx' | 'blast', RegExp> = {
    trail: /trail\.(?:BEAM|GLOW|add|install|has)\b/,
    fx: /fx\.(?:burst|emitter|install|SPARK|BLOB|SMOKE|spark|glow|smoke)\b/,
    blast: /blast\.explode\b/,
  };
  for (const [name, project] of projects) {
    const lua = generateLuaCode(project);
    for (const mod of ['trail', 'fx', 'blast'] as const) {
      const used = usedBy[mod].test(lua);
      const declared = lua.includes(`local ${mod} = require(`);
      check(
        `${name} that names ${mod} requires it`,
        !used || declared,
        `the file reads ${mod}. without \`local ${mod} = require(...)\``,
      );
    }
  }
}

// ---- a hold picture with more cells than the hold plays --------------------
// PX's Buffalo of Lies holds frame 0 of a 20-cell run cycle (`frames = 1` over a
// sheet the manifest declares as 20). The engine slices the PNG by the manifest
// and only indexes it with `hold.frames`, so the declaration has to keep the
// picture's own count or all 20 cells are squeezed into the cell.
{
  const holdOf = (patch: Partial<WeaponProject['hold']>): WeaponProject['hold'] =>
    ({
      ...DEFAULT_IMPORT_HOLD,
      enabled: true,
      sheet: 'sprites/edges/hold.png',
      sheetPreview: undefined,
      sheetFile: undefined,
      ...patch,
    }) as WeaponProject['hold'];
  const cells = makeProject({
    hold: holdOf({ frames: 1, fps: 15, sheetFrames: 20 }),
    customSprites: {},
    packArt: {},
  });
  const cellToml = generateModToml(cells);
  const cellDecl = cellToml.indexOf('[sprites."sprites/edges/hold.png"]');
  check(
    'a hold of one frame over a 20-cell picture declares the cells',
    cellDecl >= 0 && /frames = 20/.test(cellToml.slice(cellDecl, cellDecl + 120)),
    cellDecl < 0 ? 'the hold sheet is not declared at all' : cellToml.slice(cellDecl, cellDecl + 120),
  );
  const cellLua = generateLuaCode(cells);
  check(
    'the hold still plays one frame',
    !/^\s+frames = 1,$/m.test(cellLua),
    'the claim table names a frame count the engine would read as a strip',
  );
  // The editor's own uploads slice exactly what they play, so an ordinary hold
  // keeps one number.
  const plainToml = generateModToml(
    makeProject({ hold: holdOf({ frames: 4, fps: 15 }), customSprites: {}, packArt: {} }),
  );
  const plainDecl = plainToml.indexOf('[sprites."sprites/edges/hold.png"]');
  check(
    'an ordinary hold declares the frames it plays',
    plainDecl >= 0 && /frames = 4/.test(plainToml.slice(plainDecl, plainDecl + 120)),
    plainDecl < 0 ? 'the hold sheet is not declared' : plainToml.slice(plainDecl, plainDecl + 120),
  );
}

// ---- single `fires` block + native group gating ----------------------------
{
  const combined = makeProject({
    specialSubtype: 4,
    recordOverrides: { 'fires.launch_power_pct': 150 },
  });
  const combinedLua = generateLuaCode(combined);
  check(
    'fires.subtype and fires.launch_power_pct share one fires table',
    (combinedLua.match(/^\s*fires = \{/gm) || []).length === 1 &&
      combinedLua.includes('subtype = 4,') &&
      combinedLua.includes('launch_power_pct = 150,'),
    'duplicate or missing fires entries',
  );

  const nonMissile = makeProject({
    fireType: 'hitscan',
    based_on: 'uzi',
    slot: 'uzi',
    recordOverrides: { 'fires.launch_power_pct': 150 },
  });
  check(
    'non-missile family omits fires.launch_power_pct',
    !generateLuaCode(nonMissile).includes('launch_power_pct'),
  );

  const staleSpecial = makeProject({
    fireType: 'special',
    based_on: 'drill',
    slot: 'drill',
    specialSubtype: 8,
    recordOverrides: { 'fire_punch.damage': 50, 'drill.duration_ms': 4000 },
  });
  const staleLua = generateLuaCode(staleSpecial);
  check(
    'special subtype 8 (drill) omits stale fire_punch table and emits drill',
    !staleLua.includes('fire_punch =') && staleLua.includes('drill = {') && staleLua.includes('duration_ms = 4000'),
  );
}

// ---- unsorted melee hits WAVs, hold cell_h with sheetFrames, extraHand firing reset ----
{
  const jabWav = new File([new Uint8Array([82, 73, 70, 70])], 'jab.wav', { type: 'audio/wav' });
  const pngFile = new File([new Uint8Array([137, 80, 78, 71])], 'sheet.png', { type: 'image/png' });
  const meleeUnsorted = makeProject({
    fireType: 'melee',
    hold: {
      ...DEFAULT_IMPORT_HOLD,
      enabled: true,
      sheetFile: pngFile,
      sheetWidth: 60,
      sheetHeight: 1200,
      frames: 1,
      sheetFrames: 20,
      offsetX: 5,
      flashFile: pngFile,
      flashWidth: 60,
      flashHeight: 40,
      extraHand: {
        enabled: true,
        radius: 6,
        rotation: 0,
        scale: 1.5,
        offsetX: 10,
        offsetY: 5,
        fireScale: 1,
        fireOffsetX: 0,
        fireOffsetY: 0,
      },
    } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [{ t: 4, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' }],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: {
      ...DEFAULT_MELEE,
      enabled: true,
      hits: [
        { frame: 12, damage: 20, power: 4, lift: 0 },
        {
          frame: 4,
          damage: 10,
          power: 2,
          lift: 0,
          sound: { id: 0, priority: 8, file: { file: jabWav, fileName: 'jab.wav', previewUrl: '', size: 4 } },
        },
      ],
    },
  });
  const mLua = generateLuaCode(meleeUnsorted);
  const mPart = await weaponBundlePart(meleeUnsorted);
  check(
    'unsorted melee hits align per-strike wav path with sounds list and packed file',
    mLua.includes('wav = "sounds/edges/melee_hit1.wav"') &&
      mLua.includes('"sounds/edges/melee_hit1.wav"') &&
      !mLua.includes('melee_hit2.wav') &&
      mPart.plain.some((entry) => entry.path === 'sounds/edges/melee_hit1.wav'),
    mLua,
  );
  check(
    'hold cell_h divides sheetHeight by sheetFrames rather than played frames',
    mLua.includes('cell_w = 60,') && mLua.includes('cell_h = 60,') && !mLua.includes('cell_h = 1200,'),
    mLua.split('\n').filter((l) => l.includes('cell_')).join(' | '),
  );
  check(
    'extraHand emits fire_scale = 1 and fire_offset = {0, 0} when aiming values differ',
    mLua.includes('fire_scale = 1,') && mLua.includes('fire_offset = { x = 0, y = 0 },'),
    mLua,
  );
}

// ---- F8: fullGroup, bounce_power, inherit+homing_bit, 0 spin/anim, carried on_fire, parseCustomLua/hookBodyOf, NaN guard ----
{
  // 1. formatNumber NaN guard
  const pngFile = new File([new Uint8Array([137, 80, 78, 71])], 'm.png', { type: 'image/png' });
  const nanProj = makeProject({
    missileSprite: {
      enabled: true,
      mode: 'custom',
      stockSprite: '',
      sheet: '',
      anim: 'rotation',
      frames: 1,
      fps: 15,
      animSpeed: 1,
      spinRate: 1,
      scale: 1,
      mirror: true,
      z: 5,
      hideStock: true,
      animate: false,
      spin: false,
      size: Number.NaN,
      sheetFile: pngFile,
    },
  });
  const nanLua = generateLuaCode(nanProj);
  check('formatNumber guards NaN to 0 without emitting NaN', !nanLua.includes('NaN') && nanLua.includes('size = 0,'), nanLua);

  // 2a. fullGroup keeps bounce.explosion.push_pct = 100 when donor slab also had 100
  const homingBase = stockDonorBaseline('homing_missile')!;
  const hToBounce = makeProject({
    ...(stockDonor('homing_missile') as Partial<WeaponProject>),
    id: 'wfws.check.htob',
    name: 'HToBounce',
    based_on: 'stock.homing_missile',
    donorBaseline: homingBase,
    useWepFile: false,
    action: 'bounce',
    body: {
      ...(stockDonor('homing_missile')!.body!),
      bounce_pct: 50,
    },
    recordOverrides: { ...homingBase.recordOverrides },
  });
  const hToBounceLua = generateLuaCode(hToBounce);
  check(
    'fullGroup bounce preserves push_pct = 100 even when homing_missile donor slab matches 100',
    hToBounceLua.includes('push_pct = 100,') && !hToBounceLua.includes('push_pct = 0,'),
    hToBounceLua,
  );

  // 2b. fullGroup homing keeps user homing.trail.sprite instead of overwriting with 0
  const grenadeToHoming = makeProject({
    action: 'homing',
    body: { ...DEFAULT_BODY, homing: 'lock', homing_arm_ms: 500, homing_time_ms: 4000 },
    recordOverrides: {
      'missile.homing.trail.sprite': '131',
    },
  });
  const gToHomingLua = generateLuaCode(grenadeToHoming);
  check(
    'fullGroup homing preserves user missile.homing.trail.sprite = 131',
    gToHomingLua.includes('sprite = 131,'),
    gToHomingLua,
  );

  // 3. clustlet bounce_power-only edit emits bounce.explosion.power
  const baseBounce = stockDonorBaseline('grenade')!;
  const clustBounceProj = makeProject({
    donorBaseline: {
      ...baseBounce,
      body: {
        ...baseBounce.body,
        cluster: true,
        clustlet: { ...DEFAULT_CLUSTLET, bit_action: 'bounce', contact: 'bounce', bounce_explode: true, bounce_power: 15 },
      },
      burst: 'clusters',
    },
    burst: 'clusters',
    body: {
      ...baseBounce.body,
      cluster: true,
      clustlet: { ...DEFAULT_CLUSTLET, bit_action: 'bounce', contact: 'bounce', bounce_explode: true, bounce_power: 42 },
    },
  });
  const clustBounceLua = generateLuaCode(clustBounceProj);
  check(
    'clustlet bounce_power-only change emits bounce = { explosion = { power = 42 } }',
    clustBounceLua.includes('bounce = {') && clustBounceLua.includes('power = 42,'),
    clustBounceLua,
  );

  // 4. bitFlight inherit + homing_bit emits bits table with primary sheet and homing block
  // 5. spinRate = 0 and animSpeed = 0 emit explicitly on main, bit, and dig roles
  const inheritBitProj = makeProject({
    action: 'dig',
    burst: 'clusters',
    body: {
      ...DEFAULT_BODY,
      cluster: true,
      clustlet: { ...DEFAULT_CLUSTLET, bit_action: 'homing', homing: 'lock', homing_arm_ms: 400, homing_time_ms: 3000 },
    },
    missileSprite: {
      enabled: true,
      mode: 'custom',
      stockSprite: '',
      sheet: '',
      anim: 'rotation',
      frames: 1,
      fps: 15,
      animSpeed: 0,
      spinRate: 0,
      scale: 0,
      mirror: true,
      z: 5,
      hideStock: true,
      animate: false,
      spin: false,
      sheetFile: pngFile,
    },
    bitFlight: { ...DEFAULT_ROLE_ART, mode: 'inherit' },
    behaviorArt: {
      homing_bit: { ...DEFAULT_ROLE_ART, mode: 'builder', animSpeed: 0, spinRate: 0, sheetFile: pngFile },
      dig: { ...DEFAULT_DIG_ROLE_ART, mode: 'builder', animSpeed: 0, spinRate: 0, scale: 0 },
    },
  });
  const inheritBitLua = generateLuaCode(inheritBitProj);
  check(
    'bitFlight inherit with homing_bit emits bits table (not bare "inherit") with primary sheet and homing block',
    !inheritBitLua.includes('bits = "inherit"') &&
      inheritBitLua.includes('bits = {\n        sheet = "sprites/edges/missile.png"') &&
      inheritBitLua.includes('sheet = "sprites/edges/state_homing_bit.png"'),
    inheritBitLua,
  );
  check(
    'animSpeed = 0, spinRate = 0, scale = 0 emit on primary, roleArtRows, and digArtOverrideRows',
    (inheritBitLua.match(/anim_speed = 0,/g)?.length ?? 0) === 4 &&
      (inheritBitLua.match(/spin = 0,/g)?.length ?? 0) === 4 &&
      (inheritBitLua.match(/scale = 0,/g)?.length ?? 0) === 3,
    inheritBitLua,
  );

  // 6. hasCarriedOnFire suppresses fireSequence emission AND px.fire_seq auto-dependency
  const carriedFireProj = makeProject({
    fireSequence: {
      enabled: true,
      mode: 'missiles',
      count: 3,
      delay: 5,
      speed: 18,
      standoff: 0,
      spreadX: 0,
      spreadY: 0,
      offsetX: 0,
      offsetY: 0,
      liveAim: true,
      cancelOnWeaponChange: true,
      actorSprite: '',
      actorGravity: false,
      actorCollide: false,
      actorPersist: false,
    },
    carriedLua: {
      preamble: [],
      prologue: [],
      hooks: [{ key: 'on_fire', text: 'function(ev)\n  wa.log("custom")\nend', line: 1 }],
      unresolved: [],
    },
  });
  const carriedFireLua = generateLuaCode(carriedFireProj);
  const carriedFireDeps = autoDependenciesForProject(carriedFireProj).map((d) => d.id);
  check(
    'carried on_fire suppresses fire_seq emission and px.fire_seq dependency',
    !carriedFireLua.includes('wf-lib/fire_seq') &&
      !carriedFireLua.includes('fire_seq_mis') &&
      !carriedFireDeps.includes('px.fire_seq'),
    `${carriedFireDeps.join(',')} | ${carriedFireLua}`,
  );

  // 7. parseCustomLua handles bare `do ... end` and `repeat ... until`
  const blockSnippet = `on_explode = function(ev)
  do
    local inner = 1
  end
  local x = 0
  repeat
    x = x + 1
  until x >= 2
  wa.log("after_repeat")
end
local afterHook = 42`;
  const parsedBlock = parseCustomLua(blockSnippet);
  check(
    'parseCustomLua uses scanBlockEnd so do..end and repeat..until stay inside on_explode',
    parsedBlock.hasOnExplode &&
      parsedBlock.onExplodeBody.includes('after_repeat') &&
      parsedBlock.remainingSnippet.trim() === 'local afterHook = 42',
    JSON.stringify(parsedBlock),
  );

  // 8. hookBodyOf ignores substring "end" inside trailing identifiers like `blend` or `send`
  const blendHook = hookBodyOf('{ on = function(ev)\n  wa.log("ok")\nend, blend = 1 }');
  check(
    'hookBodyOf closes at whole-word end rather than trailing "blend"',
    blendHook.body === 'wa.log("ok")',
    blendHook.body,
  );
}

// ---- F9: wepParser decodes fire bursts, burstRaw=3, before timings, masked sprites, handling flags ----
{
  const buildWep = (words: Record<number, number>): ArrayBuffer => {
    const buf = new ArrayBuffer(4 + 0x1d0);
    const bytes = new Uint8Array(buf);
    bytes[0] = 0x06;
    bytes[1] = 0xdd;
    bytes[2] = 0xbb;
    bytes[3] = 0x5a;
    const dv = new DataView(buf);
    for (const [off, val] of Object.entries(words)) {
      dv.setInt32(4 + Number(off), val, true);
    }
    return buf;
  };

  const fireWep = parseWepBinary(
    buildWep({
      0x0c: 1,
      0x10: 1,
      0x14: 1,
      0x18: 0,
      0x1c: 0,
      0x30: 1,
      0x38: 0,
      0x9c: 70000,
      0xf0: 2,
      0xf8: 10,
      0xfc: 250,
      0x100: 4000,
      0x104: 1,
    }),
    'fire_test.wep',
  );
  check('fire burst .wep decodes burst = "fire"', fireWep.projectState.burst === 'fire');
  check(
    'fire burst .wep decodes fireConfig (generations halved, decay_mode 1 = on_hit)',
    fireWep.projectState.fireConfig?.spread_generations === 5 &&
      fireWep.projectState.fireConfig?.spread_delay_ms === 250 &&
      fireWep.projectState.fireConfig?.burn_time_ms === 4000 &&
      fireWep.projectState.fireConfig?.decay_mode === 'on_hit',
    JSON.stringify(fireWep.projectState.fireConfig),
  );
  check(
    '.wep keeps full 32-bit explosion_sound.before without recNum truncation',
    fireWep.projectState.recordOverrides?.['missile.explosion_sound.before'] === 70000,
    String(fireWep.projectState.recordOverrides?.['missile.explosion_sound.before']),
  );
  check(
    '.wep decodes handling.remember_selection, available_in_caves, ends_turn, and retreat = 0',
    fireWep.projectState.recordOverrides?.['handling.remember_selection'] === true &&
      fireWep.projectState.recordOverrides?.['handling.available_in_caves'] === true &&
      fireWep.projectState.recordOverrides?.['handling.ends_turn'] === false &&
      fireWep.projectState.recordOverrides?.['handling.retreat'] === 0,
    JSON.stringify({
      rem: fireWep.projectState.recordOverrides?.['handling.remember_selection'],
      caves: fireWep.projectState.recordOverrides?.['handling.available_in_caves'],
      ends: fireWep.projectState.recordOverrides?.['handling.ends_turn'],
      retreat: fireWep.projectState.recordOverrides?.['handling.retreat'],
    }),
  );

  const clustHomingWep = parseWepBinary(
    buildWep({
      0xf0: 3,
      0x160: 75000,
      0x168: 1,
      0x170: 0x10025,
      0x178: 0x10083,
    }),
    'clust_homing.wep',
  );
  check(
    '.wep treats burstRaw = 3 as clusters',
    clustHomingWep.projectState.burst === 'clusters' &&
      clustHomingWep.projectState.body?.cluster === true,
  );
  check(
    '.wep keeps clustlet explosion_sound.before = 75000 and masks cHoming sprites with recNum',
    clustHomingWep.projectState.body?.clustlet?.explosion_sound_before === 75000 &&
      clustHomingWep.projectState.body?.clustlet?.homing_sprite === 0x25 &&
      clustHomingWep.projectState.body?.clustlet?.homing_trail_sprite === 0x83,
    JSON.stringify({
      before: clustHomingWep.projectState.body?.clustlet?.explosion_sound_before,
      hs: clustHomingWep.projectState.body?.clustlet?.homing_sprite,
      hts: clustHomingWep.projectState.body?.clustlet?.homing_trail_sprite,
    }),
  );

  const digStrikeWep = parseWepBinary(
    buildWep({
      0xa4: 4,
      0xb4: 0x1009e,
      0xb8: 0x1009f,
    }),
    'dig.wep',
  );
  check(
    '.wep masks dig sprites with recNum',
    digStrikeWep.projectState.digConfig?.dive_sprite === 0x9e &&
      digStrikeWep.projectState.digConfig?.sprite_1 === 0x9f,
  );

  const strikeWep = parseWepBinary(
    buildWep({
      0x30: 3,
      0x38: 0x1003c,
    }),
    'strike.wep',
  );
  check(
    '.wep masks strike.plane with recNum',
    strikeWep.projectState.recordOverrides?.['strike.plane'] === 0x3c,
    String(strikeWep.projectState.recordOverrides?.['strike.plane']),
  );
}

// ---- hold_as: the held pose a zeroed record sprite took away ---------------
{
  // The builder zeroes the record's sprite, and a thrown weapon's held pose is
  // read from it, so WF 33 (a Cluster Bomb) aimed with empty hands. The claim
  // lends the pose of the stock weapon the record's own sprite would give.
  const builder = (patch: Partial<WeaponProject> = {}) =>
    makeProject({
      missileSprite: { ...(makeProject().missileSprite as any), enabled: true, mode: 'custom', anim: 'track' },
      ...patch,
    });
  const holdAsLine = (p: WeaponProject) => /hold_as = "([^"]+)"/.exec(generateLuaCode(p))?.[1];
  check('a grenade with the builder aims as a grenade', holdAsLine(builder()) === 'stock.grenade', String(holdAsLine(builder())));
  const cluster = builder({
    based_on: 'stock.cluster_bomb',
    donorBaseline: stockDonorBaseline('cluster_bomb'),
    recordOverrides: { ...(stockDonor('cluster_bomb')?.recordOverrides ?? {}) },
  });
  check('a cluster bomb aims as a cluster bomb', holdAsLine(cluster) === 'stock.cluster_bomb', String(holdAsLine(cluster)));
  const petrol = builder({
    based_on: 'stock.petrol_bomb',
    donorBaseline: stockDonorBaseline('petrol_bomb'),
    recordOverrides: { ...(stockDonor('petrol_bomb')?.recordOverrides ?? {}) },
  });
  check('a pose sprite given as an id resolves (petrol bomb, 55)', holdAsLine(petrol) === 'stock.petrol_bomb', String(holdAsLine(petrol)));
  const hidden = builder({ recordOverrides: { 'missile.sprite': 0 } });
  check("the builder's own zero falls back to the donor's sprite", holdAsLine(hidden) === 'stock.grenade', String(holdAsLine(hidden)));
  const bazooka = builder({
    based_on: 'stock.bazooka',
    donorBaseline: stockDonorBaseline('bazooka'),
    recordOverrides: { ...(stockDonor('bazooka')?.recordOverrides ?? {}) },
  });
  check('a launcher gets none (its pose is not the record sprite)', holdAsLine(bazooka) === undefined, String(holdAsLine(bazooka)));
  check('no builder, no hold_as', holdAsLine(makeProject()) === undefined, String(holdAsLine(makeProject())));
  const ownHold = builder({ hold: { ...(makeProject().hold as any), enabled: true } });
  check('own hold art keeps the empty-handed pose', holdAsLine(ownHold) === undefined, String(holdAsLine(ownHold)));
  const imported = builder({ holdAs: 'stock.banana_bomb' });
  check('an imported hold_as is written as it came', holdAsLine(imported) === 'stock.banana_bomb', String(holdAsLine(imported)));
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ngenerator edge cases: all checks passed');
