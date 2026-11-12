/**
 * Dev-only test pack generator.
 *
 * Writes one WormForge bundle with one component per test plus a profile that
 * places all of them, so an engine behaviour can be checked in one match.
 * Every sheet is derived from `spec/default_grenade.png`:
 *
 *   - the main missile art is the single grenade frame, drawn by the sprite
 *     builder (`sb.flight`) where the test uses it;
 *   - cluster bits use rotation strips baked here (full 360°, frame 0 up,
 *     clockwise) — the same convention `src/utils/rotateSheet.ts` produces in
 *     the editor;
 *   - native trail puffs use a four-frame rotation strip;
 *   - records that cannot simply draw stock sprite 50 (a strike's munition, a
 *     cluster bit, a claim-level body sheet) get a pack sheet instead.
 *
 * Run: `bun run tools/gen_test_pack.ts`
 * Output: `test_pack/wftest_pack/` (git-ignored) — copy that folder into
 * `WormForge/Mods/`, pick the "WF Test Pack" profile, and every weapon is on
 * the panel with infinite ammo.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { WeaponProject, PackArtSlot } from '../src/types/weapon';
import {
  generateLuaCode,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  missileFlightSheetPath,
  roamSheetPath,
  roamSheetPaths,
  packArtPath,
  sanitizeModFolder,
} from '../src/utils/luaGenerator';
import { DEFAULT_EXPLOSION_EFFECT, EXPLOSION_PRESETS } from '../src/data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import {
  DEFAULT_ROLE_ART,
  bitBuilderMode,
  resolveBehaviorStates,
} from '../src/data/spriteBuilder';
import { getStockPanelPosition } from '../src/data/stockWeapons';

// ---------------------------------------------------------------------------
// PNG: just enough to read the RGBA source and write RGBA sheets.
// ---------------------------------------------------------------------------
interface Bitmap {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, Buffer.from(data), crc]);
}

function encodePng(bitmap: Bitmap): Buffer {
  const { width, height, rgba } = bitmap;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** 8-bit, non-interlaced RGB/RGBA only (the grenade source is RGBA). */
function decodePng(bytes: Buffer): Bitmap {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colour = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('only 8-bit PNGs are supported');
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
      colour = data[9];
      if (colour !== 6 && colour !== 2) {
        throw new Error(`unsupported PNG colour type ${colour}`);
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    line = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 1:
          line[x] = (line[x] + a) & 0xff;
          break;
        case 2:
          line[x] = (line[x] + b) & 0xff;
          break;
        case 3:
          line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x] + pred) & 0xff;
          break;
        }
        default:
          break;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, rgba: out };
}

/** Full 360° rotation strip: frame 0 up, turning clockwise (WA airmisl order). */
function rotationSheet(source: Bitmap, frames: number): Bitmap {
  const cell = Math.ceil(Math.hypot(source.width, source.height));
  const out = new Uint8Array(cell * cell * frames * 4);
  const { width: sw, height: sh, rgba: src } = source;
  for (let f = 0; f < frames; f += 1) {
    const angle = (f * Math.PI * 2) / frames;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let y = 0; y < cell; y += 1) {
      for (let x = 0; x < cell; x += 1) {
        // Inverse rotate the destination pixel into the source image.
        const dx = x + 0.5 - cell / 2;
        const dy = y + 0.5 - cell / 2;
        const sx = Math.floor(cos * dx + sin * dy + sw / 2);
        const sy = Math.floor(-sin * dx + cos * dy + sh / 2);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const from = (sy * sw + sx) * 4;
        const to = ((f * cell + y) * cell + x) * 4;
        out[to] = src[from];
        out[to + 1] = src[from + 1];
        out[to + 2] = src[from + 2];
        out[to + 3] = src[from + 3];
      }
    }
  }
  return { width: cell, height: cell * frames, rgba: out };
}

// ---------------------------------------------------------------------------
// Art shared by the tests.
// ---------------------------------------------------------------------------
const grenade = decodePng(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'spec', 'default_grenade.png')));
const GRENADE_PNG = encodePng(grenade);
const ROT_32 = encodePng(rotationSheet(grenade, 32));
const ROT_16 = encodePng(rotationSheet(grenade, 16));
const TRAIL_4 = encodePng(rotationSheet(grenade, 4));

const file = (bytes: Buffer, name: string) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

function art(slot: PackArtSlot, bytes: Buffer, frames: number) {
  return {
    file: file(bytes, `${slot}.png`),
    fileName: `${slot}.png`,
    previewUrl: '',
    frames,
    fps: 15,
    play: 'loop' as const,
  };
}

/**
 * A short mono 16-bit PCM tone, so the test pack ships real WAVs for
 * `sounds = {...}` / `wa.sound.play`. `fade` ramps the edges to avoid clicks.
 */
function wavTone(freq: number, ms: number, volume = 0.35): Buffer {
  const rate = 22050;
  const samples = Math.max(1, Math.round((rate * ms) / 1000));
  const data = Buffer.alloc(samples * 2);
  const ramp = Math.min(240, Math.floor(samples / 4));
  for (let i = 0; i < samples; i += 1) {
    const edge = Math.min(1, (i + 1) / ramp, (samples - i) / ramp);
    const sample = Math.sin((2 * Math.PI * freq * i) / rate) * volume * edge;
    data.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const EXPLOSION_WAV = wavTone(180, 420);
const INTERVAL_WAV = wavTone(880, 70);

function soundAsset(bytes: Buffer, name: string) {
  return {
    file: new File([new Uint8Array(bytes)], name, { type: 'audio/wav' }),
    fileName: name,
    previewUrl: '',
    size: bytes.length,
  };
}

// ---------------------------------------------------------------------------
// Project factory.
// ---------------------------------------------------------------------------
const DEFAULTS = {
  clustlet: {
    sprite: 'clustlet',
    sprite_count: 1,
    count: 5,
    angle: 0,
    spread: 60,
    power: 40,
    power_variation: 0,
    damage: 18,
    trail: '',
    trail_power: 0,
    trail_speed: 0,
    trail_bubbles: 0,
    contact: 'impact' as const,
    bounce_explode: false,
    bounce_power: 0,
    bounces: 0,
    fuse: 3000,
    proximity: 0,
    homing: 'off' as const,
    homing_arm_ms: 0,
    homing_time_ms: 0,
    gravity_pct: 100,
    wind_pct: 100,
    bounciness: 0,
    animation: 0,
    bit_action: 'none' as const,
  },
  roam: {
    walk_speed: 2,
    step_height: 4,
    terrain_offset: 0,
    edge_jump_angle_deg: 0,
    edge_jump_speed: 0,
    edge_jump_sound: 0,
    jump_angle_deg: 25,
    jump_speed: 6,
    jump_sound: 50,
    gas_start_delay_ms: 0,
    gas_poison_power: 0,
    gas_animal_sprite: 0,
    flight_1: 0,
    flight_2: 0,
    hits: { land: true, worms: true, mines: true, crates: true, water: true },
    flight_hits: { land: true, worms: true, mines: true, crates: true, water: true },
  },
  ribbon: {
    enabled: false,
    max: 12,
    every: 2,
    vanish: 2,
    coreWidth: 8,
    glowWidth: 13,
    color: '#ffffff',
    target: 'main' as 'main' | 'all',
  },
};

interface TestCase {
  project: WeaponProject;
  /** What the component is meant to do. */
  intent: string;
  /** What to watch for in a match. */
  expect: string;
  /** How the test fails, so a bug is easy to name. */
  watch: string;
}

function makeOp(partial: {
  id: string;
  name: string;
  slot: string;
  fireType?: WeaponProject['fireType'];
  body?: Partial<WeaponProject['body']>;
  clustlet?: Partial<typeof DEFAULTS.clustlet>;
  action?: WeaponProject['action'];
  burst?: WeaponProject['burst'];
  overrides?: Record<string, any>;
  missileSprite?: Partial<WeaponProject['missileSprite']>;
  bitFlight?: Partial<WeaponProject['bitFlight']>;
  behaviorArt?: WeaponProject['behaviorArt'];
  trailer?: Partial<typeof DEFAULTS.ribbon>;
  explosion?: Partial<WeaponProject['explosionEffect']>;
  customSounds?: Partial<WeaponProject['customSounds']>;
  roam?: Partial<typeof DEFAULTS.roam>;
  fire?: Partial<WeaponProject['fireConfig']>;
  packArt?: Partial<WeaponProject['packArt']>;
  /** The roaming animal's two flying sheets (`sheep_sprites`). */
  roamSheets?: WeaponProject['roamSheets'];
  defaults?: Partial<WeaponProject['defaults']>;
}): WeaponProject {
  return {
    id: partial.id,
    name: partial.name,
    description: partial.name,
    version: '0.1.0',
    author: 'WormForge Test Pack',
    slot: partial.slot,
    based_on: partial.slot,
    fireType: partial.fireType ?? 'power',
    specialSubtype: 1,
    teleport: false,
    panel_icon: 'grenade',
    defaults: { ammo: -1, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: '', ...partial.defaults },
    body: {
      sprite: 'grenade',
      damage: 30,
      gravity_pct: 100,
      wind_pct: 100,
      bounce_pct: 0,
      fuse: false,
      fuse_time_ms: 0,
      countdown_ms: 0,
      homing: 'off',
      homing_arm_ms: 0,
      homing_time_ms: 0,
      cluster: false,
      custom_cluster: false,
      custom_site: 'explode',
      proximity: 0,
      arm_delay_ms: 0,
      trigger_delay_ms: 0,
      detect_mask: 0,
      clustlet: { ...DEFAULTS.clustlet, ...partial.clustlet },
      ...partial.body,
    },
    action: partial.action ?? 'none',
    burst: partial.burst ?? 'nothing',
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
      ...partial.missileSprite,
    },
    bitFlight: { ...DEFAULT_ROLE_ART, ...partial.bitFlight },
    behaviorArt: { ...(partial.behaviorArt || {}) },
    roamConfig: { ...DEFAULTS.roam, ...partial.roam },
    roamSheets: partial.roamSheets ?? { flight1: {}, flight2: {} },
    digConfig: { sound: 90, dive_sprite: 0, sprite_1: 0, sprite_2: 0, sprite_3: 0 },
    fireConfig: {
      spread_delay_ms: 30,
      burn_time_ms: 1500,
      spread_generations: 10,
      decay_mode: 'resting',
      ...partial.fire,
    },
    ribbonTrail: { ...DEFAULTS.ribbon, ...partial.trailer },
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, ...partial.explosion },
    customSounds: { ...DEFAULT_CUSTOM_SOUNDS, ...partial.customSounds },
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
    packArt: { ...(partial.packArt || {}) },
    customSprites: {},
    recordOverrides: { ...(partial.overrides || {}) },
    enableCustomLua: false,
    useWepFile: false,
  };
}

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------
const TESTS: TestCase[] = [
  {
    project: makeOp({
      id: 'wftest.01_builder_track',
      name: 'WF 01 Builder Track',
      slot: 'bazooka',
      missileSprite: { enabled: true, mode: 'custom', anim: 'track', hideStock: true },
    }),
    intent: 'Sprite builder on a plain rocket: WA sprite hidden, sheet turned to the flight vector.',
    expect: 'A grenade image follows the rocket, pointing along its flight; it mirrors when fired left.',
    watch: 'WA rocket still visible (hideStock), or sheet fixed upright (ANIM_TYPE.track).',
  },
  {
    project: makeOp({
      id: 'wftest.02_stock_cycle',
      name: 'WF 02 Stock Cycle',
      slot: 'grenade',
      body: { sprite: 'grenade', bounce_pct: 60 },
      overrides: { 'missile.animation': 1 },
    }),
    intent: 'Baseline: stock grenade art (sprite 50), native animation 1 = cycle.',
    expect: "WA's own grenade sprite, tumbling/cycling as a grenade always does.",
    watch: 'Compare against 04/16: the pack-sheet tests should match this motion.',
  },
  {
    project: makeOp({
      id: 'wftest.03_builder_homing',
      name: 'WF 03 Builder Homing',
      slot: 'homing_missile',
      action: 'homing',
      body: { homing: 'lock', homing_arm_ms: 1000, homing_time_ms: 8000 },
      missileSprite: { enabled: true, mode: 'custom', anim: 'rotation', hideStock: true },
    }),
    intent: 'Sprite builder on a homing missile, spinning sheet.',
    expect: 'Grenade sheet spins while the missile locks and turns; the follower never detaches.',
    watch: 'WA homing sprite reappearing mid-flight, or the sheet freezing after lock.',
  },
  {
    project: makeOp({
      id: 'wftest.04_claim_track',
      name: 'WF 04 Claim Track',
      slot: 'mortar',
      body: { sprite: 'grenade' },
      overrides: { 'missile.animation': 2 },
      packArt: { strike_sprite: art('strike_sprite', GRENADE_PNG, 1) },
    }),
    intent: 'No sprite builder: the claim `sprite` sheet replaces the record body, native animation 2 = track.',
    expect: 'The mortar draws our single grenade frame, turned to its flight direction.',
    watch: 'Stock mortar sprite instead of ours (claim not applied), or no turning (animation).',
  },
  {
    project: makeOp({
      id: 'wftest.05_cluster_dir',
      name: 'WF 05 Cluster Direction',
      slot: 'cluster_bomb',
      burst: 'clusters',
      clustlet: { count: 5, sprite_count: 1, bit_action: 'none', animation: 2 },
      missileSprite: { enabled: true, mode: 'custom', anim: 'rotation', hideStock: true },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_32, 32) },
    }),
    intent: 'Cluster bit art through the claim: 32-frame 360° rotation sheet, bit animation 2 = direction.',
    expect: 'Five bits, each a grenade pointing along its own velocity (a compass).',
    watch: 'Bits showing petrol bomb / holy grenade art (sprite_count not 1), or all bits pointing up (animation).',
  },
  {
    project: makeOp({
      id: 'wftest.06_cluster_cycle',
      name: 'WF 06 Cluster Cycle',
      slot: 'banana_bomb',
      burst: 'clusters',
      clustlet: { count: 5, sprite_count: 1, bounciness: 60, animation: 1 },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_32, 32) },
    }),
    intent: 'Same sheet as 05 but bit animation 1 = cycle.',
    expect: 'Bits spin through the 32 frames at a steady rate instead of facing their flight.',
    watch: 'Bits identical to 05 (animation ignored), or frozen art.',
  },
  {
    project: makeOp({
      id: 'wftest.07_cluster_fast',
      name: 'WF 07 Cluster Fast Cycle',
      slot: 'super_banana',
      burst: 'clusters',
      clustlet: { count: 4, sprite_count: 1, animation: 5 },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_16, 16) },
    }),
    intent: '16-frame sheet with bit animation 5, PX calls "faster cycle".',
    expect: 'Bits spin noticeably faster than 06 with coarser steps (16 frames).',
    watch: 'Same speed as 06 (animation 5 treated as 1), or art clamped at one frame.',
  },
  {
    project: makeOp({
      id: 'wftest.08_native_trail_art',
      name: 'WF 08 Native Trail Art',
      slot: 'petrol_bomb',
      body: { sprite: 'grenade' },
      packArt: { missile_trail: art('missile_trail', TRAIL_4, 4) },
      overrides: {
        'missile.trail.enabled': true,
        'missile.trail.power': 35,
        'missile.trail.speed': 150,
      },
    }),
    intent: 'Native particle trail with a pack sheet (`missile.trail.sprite`), stock body sprite.',
    expect: 'The projectile trails grenade puffs from our four-frame sheet; its own art stays stock.',
    watch: 'Stock smoke instead of our puffs (path not accepted), or no trail at all (power/speed).',
  },
  {
    project: makeOp({
      id: 'wftest.09_ribbon_main',
      name: 'WF 09 Ribbon Main',
      slot: 'dynamite',
      fireType: 'drop',
      body: { sprite: 'grenade', fuse: true, fuse_time_ms: 5000 },
      trailer: { enabled: true, max: 10, every: 1, vanish: 2, coreWidth: 3, glowWidth: 6, color: '#ffffff' },
    }),
    intent: 'Effects-SDK ribbon trail on a dropped fused weapon, main round only.',
    expect: 'A thin white ribbon follows the falling dynamite and fades after it explodes.',
    watch: 'No ribbon (effects.sdk missing / hook not firing), or ribbon never fading (drop).',
  },
  {
    project: makeOp({
      id: 'wftest.10_strike_still',
      name: 'WF 10 Strike Still',
      slot: 'air_strike',
      fireType: 'cursor',
      body: { sprite: 'grenade' },
      packArt: { strike_sprite: art('strike_sprite', GRENADE_PNG, 1) },
      overrides: { 'missile.animation': 2, 'strike.count': 3 },
    }),
    intent: 'Air strike munition art through the claim `sprite`, single frame.',
    expect: 'The jet drops three grenade images; each stays upright (one frame, nothing to turn).',
    watch: 'Stock airmisl instead of our image (strike retarget failed).',
  },
  {
    project: makeOp({
      id: 'wftest.11_strike_dir',
      name: 'WF 11 Strike Direction',
      slot: 'napalm_strike',
      fireType: 'cursor',
      body: { sprite: 'grenade' },
      packArt: { strike_sprite: art('strike_sprite', ROT_32, 32) },
      overrides: { 'missile.animation': 2, 'strike.count': 3 },
    }),
    intent: 'Air strike munition with a 32-frame direction sheet (the PX homing-air-strike layout).',
    expect: 'Each dropped bomb points along its fall direction.',
    watch: 'Bombs stuck on frame 0 (sheet slicing), or a blur (animation 1 would cycle).',
  },
  {
    project: makeOp({
      id: 'wftest.12_strike_bits',
      name: 'WF 12 Strike Bits',
      slot: 'mine_strike',
      fireType: 'cursor',
      burst: 'clusters',
      body: { sprite: 'grenade' },
      clustlet: { count: 4, sprite_count: 1, animation: 2 },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_32, 32) },
      overrides: { 'strike.count': 3 },
    }),
    intent: 'Strike munition cluster bits with pack art (claim `cluster.sprite` -> strike 0x138).',
    expect: 'Dropped munitions burst into grenades that face their own velocity.',
    watch: 'Bits with stock clustlet art (strike cluster slot not retargeted).',
  },
  {
    project: makeOp({
      id: 'wftest.13_strike_homing',
      name: 'WF 13 Strike Homing Art',
      slot: 'carpet_bomb',
      fireType: 'cursor',
      action: 'homing',
      body: { sprite: 'grenade', homing: 'lock', homing_arm_ms: 500, homing_time_ms: 3500 },
      packArt: { strike_sprite: art('strike_sprite', GRENADE_PNG, 1) },
      overrides: { 'missile.animation': 2, 'strike.count': 3 },
    }),
    intent: 'Homing strike bombs: the claim `sprite` should follow into the homing sprite (0xC0).',
    expect: 'Bombs keep our grenade art while they home, not WA homing art.',
    watch: 'Homing art replacing ours mid-flight (0xC0 retarget missed).',
  },
  {
    project: makeOp({
      id: 'wftest.14_roam_claim',
      name: 'WF 14 Roam Claim',
      slot: 'sheep_launcher',
      action: 'roam',
      body: { sprite: 'grenade' },
      packArt: { strike_sprite: art('strike_sprite', GRENADE_PNG, 1) },
      overrides: { 'missile.animation': 2 },
    }),
    intent: 'Roaming animal with a claim body sheet.',
    expect: 'Our image is used in flight and while the animal walks/jumps after landing.',
    watch: 'Stock sheep art returning after landing (roam art not the pack sheet).',
  },
  {
    project: makeOp({
      id: 'wftest.15_roam_ribbon',
      name: 'WF 15 Roam Ribbon',
      slot: 'skunk',
      action: 'roam',
      body: { sprite: 'grenade' },
      roam: { gas_start_delay_ms: 500, gas_poison_power: 10 },
      trailer: { enabled: true, max: 14, every: 1, vanish: 2, coreWidth: 4, glowWidth: 8, color: '#7cff5a' },
    }),
    intent: 'Ribbon trail on a roaming animal that emits gas.',
    expect: 'Green ribbon follows the launch and the walk; it fades when the animal settles/explodes.',
    watch: 'Ribbon frozen mid-walk (missile frames stopped) or absent.',
  },
  {
    project: makeOp({
      id: 'wftest.16_claim_cycle',
      name: 'WF 16 Claim Cycle',
      slot: 'mb_bomb',
      body: { sprite: 'grenade', gravity_pct: 20, wind_pct: 170 },
      packArt: { strike_sprite: art('strike_sprite', ROT_32, 32) },
      overrides: { 'missile.animation': 1 },
    }),
    intent: 'Claim body sheet with native animation 1 = cycle, on a slow wind-blown bomb.',
    expect: 'The floating bomb image spins continuously through the sheet.',
    watch: 'Static image (animation/looping) or the spin stopping when wind pushes it.',
  },
  {
    project: makeOp({
      id: 'wftest.17_bit_trail_art',
      name: 'WF 17 Bit Trail Art',
      slot: 'salvation_army',
      burst: 'clusters',
      body: { sprite: 'grenade' },
      clustlet: { count: 5, sprite_count: 1, trail_power: 40, trail_speed: 120 },
      packArt: { cluster_trail: art('cluster_trail', TRAIL_4, 4) },
    }),
    intent: 'Cluster bit trail through a pack sheet (`clusters.bit.trail.sprite`).',
    expect: 'Bits leave grenade puffs, not stock smoke.',
    watch: 'Stock smoke (bit trail path rejected) or no bit trail.',
  },
  {
    project: makeOp({
      id: 'wftest.18_burst_ribbon_all',
      name: 'WF 18 Burst Ribbon All',
      slot: 'ming_vase',
      burst: 'clusters',
      body: { sprite: 'grenade' },
      clustlet: { count: 5, sprite_count: 1, animation: 2 },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_16, 16) },
      trailer: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 4,
        glowWidth: 8,
        color: '#ff8800',
        target: 'all',
      },
    }),
    intent: 'Ribbon trail with target "all": the main bomb and every cluster bit after the burst.',
    expect: 'Orange ribbon on the bomb, then one ribbon per bit once it bursts.',
    watch: 'Only the main ribbon (target ignored) or a ribbon per bit even before the burst.',
  },
  {
    project: makeOp({
      id: 'wftest.19_fire_burst',
      name: 'WF 19 Fire Burst',
      slot: 'sheep',
      burst: 'fire',
      body: { sprite: 'grenade', damage: 15 },
      fire: { spread_delay_ms: 30, burn_time_ms: 1500, spread_generations: 10 },
      packArt: { missile_trail: art('missile_trail', TRAIL_4, 4) },
      overrides: {
        'missile.trail.enabled': true,
        'missile.trail.power': 25,
        'missile.trail.speed': 250,
      },
    }),
    intent: 'Fire payload (burst = "fire") plus a native trail pack sheet.',
    expect: 'The grenade leaves our puffs, then bursts into spreading flames (no cluster bits).',
    watch: 'Cluster bits instead of fire, or flames not spreading (generations/delay).',
  },
  {
    project: makeOp({
      id: 'wftest.20_builder_avoid',
      name: 'WF 20 Builder Avoid',
      slot: 'homing_pigeon',
      action: 'homing',
      body: { homing: 'dodge', homing_arm_ms: 800, homing_time_ms: 6000 },
      missileSprite: { enabled: true, mode: 'custom', anim: 'rotation', hideStock: true, mirror: true },
    }),
    intent: 'Sprite builder on a dodging homing missile (record copied from the pigeon).',
    expect: 'A spinning grenade sheet homes and dodges; the sprite follows every turn.',
    watch: 'Follower lagging or detaching on sharp turns.',
  },
  {
    project: makeOp({
      id: 'wftest.21_explosion_blast',
      name: 'WF 21 Explosion Blast',
      slot: 'bazooka',
      body: { sprite: 'grenade', damage: 45 },
      explosion: { enabled: true, mode: 'blast', preset: 'electric', sound: 'default' },
    }),
    intent: 'Effects-SDK custom explosion replacing WA blast (electric ring + squashed lens).',
    expect: 'The rocket leaves WA damage/knockback to the SDK: one blue ring + lens, smoke, and the terrain crater; blast sound plays.',
    watch: 'A second native blast (power not zeroed), no burst, or the ring not re-noising at frame 16.',
  },
  {
    project: makeOp({
      id: 'wftest.22_explosion_overlay',
      name: 'WF 22 Explosion Overlay',
      slot: 'mine',
      fireType: 'drop',
      body: { sprite: 'mine', damage: 45, fuse: false, proximity: 25, arm_delay_ms: 1000, trigger_delay_ms: 2000 },
      explosion: { enabled: true, mode: 'effect', preset: 'pyro', ...EXPLOSION_PRESETS.pyro.patch },
    }),
    intent: 'Mine keeps its ordinary blast and draws the Pyro blue burst on top of it.',
    expect: 'The mine still damages, pushes and craters as a stock mine; a round blue ring appears at the same point.',
    watch: 'No damage (native blast silenced in effect mode), no burst, or a burst only where the mine was placed.',
  },
  {
    project: makeOp({
      id: 'wftest.23_custom_sounds',
      name: 'WF 23 Custom Sounds',
      slot: 'grenade',
      body: { sprite: 'grenade', fuse: true, fuse_time_ms: 5000 },
      customSounds: {
        explosionEnabled: true,
        explosion: soundAsset(EXPLOSION_WAV, 'explosion.wav'),
        explosionPriority: 10,
        intervalEnabled: true,
        interval: soundAsset(INTERVAL_WAV, 'interval.wav'),
        intervalMs: 500,
        intervalDelayMs: 500,
        intervalLimit: 4,
        intervalPriority: 8,
      },
    }),
    intent: 'Uploaded WAVs: a low blast tone from `on_explode`, and a tick every 500 ms (4 times) while the grenade flies.',
    expect: 'A short low tone at the blast and four high ticks, the first half a second after the throw, then silence.',
    watch: 'Silence (a path not declared in `sounds`), a stock WA sound instead, or ticks that never stop.',
  },
  {
    project: makeOp({
      id: 'wftest.24_builder_bits',
      name: 'WF 24 Builder Bits',
      slot: 'cluster_bomb',
      burst: 'clusters',
      clustlet: { count: 5, sprite_count: 1, bit_action: 'none', animation: 0 },
      missileSprite: { enabled: true, mode: 'custom', anim: 'rotation', hideStock: true },
      bitFlight: { mode: 'builder', anim: 'rotation', frames: 16, fps: 15 },
      packArt: { cluster_sprite: art('cluster_sprite', ROT_32, 32) },
    }),
    intent: 'WFWS builder owns the cluster bits: a 16-frame sheet, the claim `cluster.sprite` skipped.',
    expect: 'The parent is the static grenade; the five bits are our 16-frame sheet spinning as they fly.',
    watch: 'Bits drawing the claim 32-frame sheet (builder not owning the bits), the bits vanishing, or stock clustlets.',
  },
  {
    project: makeOp({
      id: 'wftest.25_builder_state',
      name: 'WF 25 Builder State',
      slot: 'homing_pigeon',
      action: 'homing',
      body: { homing: 'lock', homing_arm_ms: 800, homing_time_ms: 6000 },
      missileSprite: { enabled: true, mode: 'custom', anim: 'rotation', hideStock: true },
      behaviorArt: {
        homing: { ...DEFAULT_ROLE_ART, mode: 'builder', anim: 'rotation', frames: 32, fps: 15 },
      },
    }),
    intent:
      'Timed homing art: the flight sheet until `arm` (800 ms), then the homing sheet for `time` (6000 ms), then back.',
    expect:
      'Static grenade for 0.8 s, then the 32-frame sheet spins while the missile steers, and the static art returns after 6.8 s.',
    watch:
      'The homing sheet from launch (arm ignored), no swap at 800 ms (timing), art that never ends (time), or the pigeon sprite showing under it.',
  },
  {
    project: makeOp({
      id: 'wftest.26_builder_dig',
      name: 'WF 26 Builder Dig',
      slot: 'mole_bomb',
      action: 'dig',
      body: { sprite: 'grenade', fuse: true, fuse_time_ms: 6000 },
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'none',
        frames: 32,
        hideStock: true,
      },
      behaviorArt: { dig: { ...DEFAULT_ROLE_ART, mode: 'inherit' } },
    }),
    intent:
      'Digging with the WFWS builder: the record dig sprites are zeroed and the builder animates the flight sheet on terrain probes.',
    expect:
      'Upright and cycling in flight; once it enters the land it turns to the heading and keeps cycling, with no mole and no Salvation-Army `wsv*` art.',
    watch:
      'The mole (dig sprites not zeroed), a `wsv*` frame, art frozen underground (probes never firing), or the sheet turning in mid-air.',
  },
  {
    project: makeOp({
      id: 'wftest.27_roam_sheets',
      name: 'WF 27 Roam Sheets',
      slot: 'super_sheep',
      action: 'roam',
      body: { sprite: 'sheep' },
      roamSheets: {
        // WA rotates the flying animal itself by picking a frame from the
        // sheet, exactly as PX's Ghost Sheep does (60x1920 = 32 cells). Both
        // strips are declared with their frame count; 16 vs 32 makes a wrong
        // slice obvious (16 would show every other direction).
        flight1: {
          file: file(ROT_32, 'sheep_flight1.png'),
          fileName: 'sheep_flight1.png',
          frames: 32,
          rotationFrames: 32,
        },
        flight2: {
          file: file(ROT_16, 'sheep_flight2.png'),
          fileName: 'sheep_flight2.png',
          frames: 16,
          rotationFrames: 16,
        },
      },
    }),
    intent:
      'Roaming art through `sheep_sprites`: two rotation strips installed as WA sprites and written to `sheep.flight_1` / `flight_2` (`frames` in mod.toml slices them).',
    expect:
      'Steer the sheep after take-off: the flying art points along the heading and steps round as you steer (32-frame sheet), while the ground walk and fart poses stay WA\'s.',
    watch:
      'Stock sheep sheets in flight (nothing installed), art stuck facing up (no `frames` declared), the whole tall strip drawn as one image, or our art on the ground / while farting.',
  },
];

// ---------------------------------------------------------------------------
// Bundle writer.
// ---------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'test_pack');
const BUNDLE = join(OUT, 'wftest_pack');
const MOD_ID = 'wftest.pack';
const PROFILE = 'WF Test Pack';

rmSync(BUNDLE, { recursive: true, force: true });
mkdirSync(join(BUNDLE, 'weapons'), { recursive: true });
mkdirSync(join(BUNDLE, 'profiles'), { recursive: true });

const quote = (value: string) => JSON.stringify(value);
const componentBlocks: string[] = [];
const spriteDecls = new Map<string, { frames: number; fps: number; play: string }>();
const usedSheets = new Set<string>();
let usesBuilders = false;
let usesRibbon = false;
let usesExplosion = false;

for (const test of TESTS) {
  const project = test.project;
  const folder = sanitizeModFolder(project.id);

  // Lua
  writeFileSync(join(BUNDLE, 'weapons', `${folder}.lua`), generateLuaCode(project));

  // Pack-art files the Lua points at.
  for (const slot of Object.keys(project.packArt) as PackArtSlot[]) {
    const asset = project.packArt[slot];
    const path = packArtPath(project, slot);
    if (!asset?.file || !path) continue;
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    // The File was made from one of the shared sheets; write those bytes.
    const source =
      slot === 'missile_trail' || slot === 'cluster_trail'
        ? TRAIL_4
        : asset.frames >= 32
          ? ROT_32
          : asset.frames === 16
            ? ROT_16
            : GRENADE_PNG;
    writeFileSync(join(BUNDLE, path), source);
    usedSheets.add(path);
    if (asset.frames > 1) {
      spriteDecls.set(path, { frames: asset.frames, fps: asset.fps || 15, play: asset.play || 'loop' });
    }
  }

  // Sprite-builder flight sheet.
  if (project.missileSprite.enabled && project.missileSprite.mode === 'custom') {
    usesBuilders = true;
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    const path = missileFlightSheetPath(project);
    // A multi-frame primary sheet uses the rotation strip, so a test can see the
    // frame cycle (digging animates the round's own sheet).
    const primaryFrames = project.missileSprite.frames ?? 1;
    writeFileSync(
      join(BUNDLE, path),
      primaryFrames >= 32 ? ROT_32 : primaryFrames === 16 ? ROT_16 : GRENADE_PNG
    );
    if (primaryFrames > 1) {
      spriteDecls.set(path, { frames: primaryFrames, fps: project.missileSprite.fps || 15, play: 'loop' });
    }
    usedSheets.add(path);

    // WFWS extra roles. The exporter writes the uploaded sheet or the default
    // missile art, so a declared path always exists.
    if (bitBuilderMode(project) === 'builder') {
      const bitPath = bitFlightSheetPath(project);
      writeFileSync(join(BUNDLE, bitPath), ROT_16);
      usedSheets.add(bitPath);
      spriteDecls.set(bitPath, { frames: 16, fps: 15, play: 'loop' });
    }
    for (const state of resolveBehaviorStates(project)) {
      if (state.art.mode !== 'builder') continue;
      const statePath = behaviorStateSheetPath(project, state.def.key);
      writeFileSync(join(BUNDLE, statePath), ROT_32);
      usedSheets.add(statePath);
      spriteDecls.set(statePath, { frames: 32, fps: 15, play: 'loop' });
    }
  }

  // A roaming animal's two flying sheets (`sheep_sprites`). WA rotates the
  // flying animal, so the sheet is a rotation strip and its frame count is
  // what mod.toml has to declare.
  if (roamSheetPaths(project)) {
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    for (const [which, asset] of [
      ['flight1', project.roamSheets?.flight1],
      ['flight2', project.roamSheets?.flight2],
    ] as const) {
      if (!asset?.file) continue;
      const path = roamSheetPath(project, which);
      const frames = asset.frames ?? 1;
      const source = frames >= 32 ? ROT_32 : frames === 16 ? ROT_16 : GRENADE_PNG;
      writeFileSync(join(BUNDLE, path), source);
      usedSheets.add(path);
      if (frames > 1) spriteDecls.set(path, { frames, fps: 15, play: 'loop' });
    }
  }

  // Custom WAVs the claim declares in `sounds`. The editor writes these bytes
  // from the uploaded File; the test pack regenerates the same tones.
  if (project.customSounds.explosionEnabled && project.customSounds.explosion?.file) {
    mkdirSync(join(BUNDLE, 'sounds', folder), { recursive: true });
    writeFileSync(join(BUNDLE, 'sounds', folder, 'explosion.wav'), EXPLOSION_WAV);
  }
  if (project.customSounds.intervalEnabled && project.customSounds.interval?.file) {
    mkdirSync(join(BUNDLE, 'sounds', folder), { recursive: true });
    writeFileSync(join(BUNDLE, 'sounds', folder, 'interval.wav'), INTERVAL_WAV);
  }

  if (project.ribbonTrail.enabled) usesRibbon = true;
  if (
    project.explosionEffect?.enabled &&
    (project.fireType === 'power' || project.fireType === 'drop')
  ) {
    usesExplosion = true;
  }

  const position = getStockPanelPosition(project.slot);
  componentBlocks.push(
    [
      '[[components]]',
      `id = ${quote(project.id)}`,
      'type = "weapon"',
      `name = ${quote(project.name)}`,
      `description = ${quote(test.intent)}`,
      `entry = ${quote(`weapons/${folder}.lua`)}`,
      `icon = ${quote(project.panel_icon)}`,
      `default_position = { row = ${quote(position.row)}, column = ${position.column} }`,
      '',
    ].join('\n')
  );
}

// mod.toml
const dependencies: string[] = [];
// The WFWS builder is its own bundle; `wf.sdk` is only needed for holds.
if (usesBuilders) dependencies.push('wfws.sdk');
if (usesRibbon || usesExplosion) dependencies.push('effects.sdk');

const toml: string[] = [
  `id = ${quote(MOD_ID)}`,
  `name = "WormForge Test Pack"`,
  'version = "0.1.0"',
  'author = "WormForge Weapon Editor"',
  'api_version = 4',
  'format_version = 2',
];
if (dependencies.length > 0) toml.push(`dependencies = [${dependencies.map(quote).join(', ')}]`);
toml.push('', ...componentBlocks);

for (const [path, decl] of spriteDecls) {
  toml.push(`[sprites.${quote(path)}]`);
  if (decl.frames > 1) toml.push(`frames = ${decl.frames}`);
  toml.push(`fps = ${decl.fps}`, `play = ${quote(decl.play)}`, '');
}

writeFileSync(join(BUNDLE, 'mod.toml'), toml.join('\n'));

// Profile: every test weapon placed, infinite ammo, plus the stock donors and
// the two always-available utilities.
const profile: string[] = [
  `description = "All ${TESTS.length} WormForge behaviour tests in one match."`,
  '',
  '[weapons]',
];
for (const test of TESTS) {
  profile.push(`${quote(test.project.id)} = true`);
  profile.push(`${quote(`stock.${test.project.slot}`)} = true`);
}
profile.push('"stock.ninja_rope" = true', '"stock.skip_go" = true', '');
for (const test of TESTS) {
  profile.push(`[weapon_settings.${quote(test.project.id)}]`, 'ammo = -1', '');
}
writeFileSync(join(BUNDLE, 'profiles', `${PROFILE}.toml`), profile.join('\n'));

// README for the in-game run.
const readme: string[] = [
  '# WormForge Test Pack',
  '',
  `Drop \`wftest_pack/\` into \`WormForge/Mods/\`, pick the **${PROFILE}** profile, and`,
  'every test weapon is on the panel with infinite ammo.',
  '',
  'All art is derived from `spec/default_grenade.png`: the main missile sheets are',
  'single frames for the sprite builder, cluster bits use 360° rotation strips',
  '(32 or 16 frames, frame 0 up, clockwise), and native trail puffs use a 4-frame',
  'rotation strip. Records that cannot draw stock sprite 50 (strike munitions,',
  'cluster bits, claim-level body sheets) carry their own pack sheet.',
  '',
  '`WF 23 Custom Sounds` also ships two generated PCM WAVs under `sounds/`,',
  'declared in its claim\'s `sounds` list and played with `wa.sound.play`.',
  '',
  '| # | Weapon | Slot | Tests | Expected in game |',
  '|---|---|---|---|---|',
];
for (const test of TESTS) {
  readme.push(
    `| ${test.project.id.split('.')[1].slice(0, 2)} | ${test.project.name} | ${test.project.slot} | ${test.intent} | ${test.expect} |`
  );
}
readme.push('', '## Per-weapon notes', '');
for (const test of TESTS) {
  readme.push(
    `### ${test.project.name}`,
    '',
    `- id: \`${test.project.id}\``,
    `- slot: \`${test.project.slot}\``,
    `- intent: ${test.intent}`,
    `- expect: ${test.expect}`,
    `- if it looks wrong: ${test.watch}`,
    ''
  );
}
writeFileSync(join(OUT, 'README.md'), readme.join('\n'));

console.log(`wrote ${TESTS.length} test weapons to ${BUNDLE}`);
console.log(`profile: ${PROFILE}`);
console.log(`sheets: ${usedSheets.size}, dependencies: ${dependencies.join(', ') || 'none'}`);
