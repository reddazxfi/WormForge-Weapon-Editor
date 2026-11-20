/**
 * Dev-only test pack generator.
 *
 * Writes one WormForge bundle with one component per test plus a profile that
 * places all of them, so an engine behaviour can be checked in one match.
 *
 * Every entry's slot is one of WA's own weapons, checked before anything is
 * written: the engine refuses the whole bundle for a `copy_from` it does not
 * know, so one wrong name costs the other 53 weapons too.
 *
 * Every role draws a different sheet from `spec/`, so a test that draws the wrong
 * role is obvious in the match instead of "another grenade":
 *
 *   held / aiming      `famas.png`      (90x90, the held gun)
 *   firing sprite      `fire_famas.png` (100x100, muzzle flash on the gun)
 *   primary flight     `fire_famas.png`
 *   homing (primary)   `famas.png`      (the timed 0.8 s / 6 s swap)
 *   cluster bit        `famas.png`
 *   homing bit         `oildrum1.png`   (20 cells of 90x90, 20 fps)
 *   roaming sheep      `sspsheep1.png`  (points up-LEFT: `angle`)
 *
 * The two FAMAS sheets are the author's own, so a test pack never has to ship
 * Team17 art either.
 *
 * Multi-frame roles bake a rotation strip from their base sheet (full 360°,
 * frame 0 up, clockwise), the same convention `src/utils/rotateSheet.ts`
 * produces in the editor, or use the strip they already ship as (the drum).
 * Records that cannot simply draw a stock sprite (a strike's munition, a
 * cluster bit, a claim-level body sheet) get a pack sheet instead.
 *
 * Run: `bun run tools/gen_test_pack.ts`
 * Output: `test_pack/wftest_pack/` (git-ignored), copy that folder into
 * `WormForge/Mods/`, pick the "WF Test Pack" profile, and every weapon is on
 * the panel with infinite ammo.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { WeaponProject, PackArtSlot, ClustletConfig, RibbonTrailConfig } from '../src/types/weapon';
import {
  generateLuaCode,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  missileFlightSheetPath,
  holdSheetPath,
  holdNeedsAimLayer,
  roamSheetPath,
  silentHoldSheetPath,
  roamSheetsOwnFlight,
  packArtPath,
  sanitizeModFolder,
  wfwsRoleFlags,
  extraHandSheetPath,
  flashSheetPath,
  terrainStampPath,
} from '../src/utils/luaGenerator';
import { DEFAULT_EXPLOSION_EFFECT, EXPLOSION_PRESETS } from '../src/data/explosionPresets';
import { stockDonor } from '../src/data/stockDonors';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_FIRE_SEQUENCE } from '../src/data/fireSequence';
import { DEFAULT_TERRAIN_STAMP, STAMP_FRAMES } from '../src/data/terrainStamp';
import { DEFAULT_EMITTER, DEFAULT_EMITTER_RING, DEFAULT_EMITTER_TRAIL } from '../src/data/emitter';
import { DEFAULT_AIM_CLIP } from '../src/data/aimClip';
import { DEFAULT_MELEE } from '../src/data/melee';
import {
  DEFAULT_ROAM_ROLE_ART,
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

/**
 * 8-bit, non-interlaced PNGs: RGB, RGBA, or palette with optional `tRNS`
 * (WA's own `spec/` sheets are mostly palettized).
 */
function decodePng(bytes: Buffer): Bitmap {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colour = 0;
  let palette: Buffer = Buffer.alloc(0);
  let alpha: Buffer = Buffer.alloc(0);
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
      if (colour !== 6 && colour !== 2 && colour !== 3) {
        throw new Error(`unsupported PNG colour type ${colour}`);
      }
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      alpha = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : 1;
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
      if (colour === 3) {
        const index = line[src];
        out[dst] = palette[index * 3] ?? 0;
        out[dst + 1] = palette[index * 3 + 1] ?? 0;
        out[dst + 2] = palette[index * 3 + 2] ?? 0;
        out[dst + 3] = index < alpha.length ? alpha[index] : 255;
        continue;
      }
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
//
// Every role draws a different sheet from `spec/`, so a test that draws the wrong
// role is obvious in the match instead of "another grenade":
//
//   held (aiming)      famas.png       90x90   the held gun
//   firing sprite      fire_famas.png  100x100 muzzle flash over the gun
//   primary flight     fire_famas.png  100x100 (`missile.png`)
//   homing (primary)   famas.png       90x90   the 0.8 s / 6 s swap
//   cluster bit        famas.png       90x90
//   homing bit         oildrum1.png    20 cells of 90x90, 20 fps
//   roaming sheep      sspsheep1.png   60x60, points up-LEFT
//
// Multi-frame roles bake a rotation strip from their base sheet (frame 0 up,
// clockwise), the same convention `src/utils/rotateSheet.ts` produces.
// ---------------------------------------------------------------------------
const specDir = join(fileURLToPath(new URL('..', import.meta.url)), 'spec');
const specPng = (name: string) => decodePng(readFileSync(join(specDir, name)));

const AIM_BMP = specPng('famas.png');
const GRENADE_BMP = specPng('famas.png');
const ICE_BMP = specPng('fire_famas.png');
const DRUM_BMP = specPng('oildrum1.png');
const SHEEP_BMP = specPng('sspsheep1.png');

/**
 * The stamp picture: an arrow pointing up, built rather than taken from `spec/`
 * (none of the shipped sheets point up). A wrong frame index is unmistakable in
 * the match, frame 8 must point right, 16 down.
 */
function upArrowBitmap(size = 40): Bitmap {
  const rgba = new Uint8Array(size * size * 4);
  const mid = size / 2;
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };
  for (let y = 0; y < size; y += 1) {
    // Head (a triangle over the top half) then shaft, both around the centre.
    const halfWidth = y < mid ? (y / mid) * (size * 0.4) : size * 0.12;
    for (let x = Math.round(mid - halfWidth); x <= Math.round(mid + halfWidth); x += 1) {
      if (y < size * 0.3) put(x, y, 220, 60, 40);
      else put(x, y, 230, 230, 200);
    }
  }
  return { width: size, height: size, rgba };
}

/**
 * "On Explosion": the stamp tests that are about the picture, not the damage,
 * turn the pierce off explicitly. The pierce defaults on, and a pierce that hits
 * something skips the stamp (that is the javelin shape), which would leave the
 * arrow untested whenever the shot lands on a worm.
 */
const NO_PIERCE = {
  enabled: false,
  damage: 20,
  radius: 20,
  impulse: 0.5,
  kind: 'bullet' as const,
  spareShooter: true,
};

const STAMP_BMP = upArrowBitmap();
/** 32 cells, frame 0 up, clockwise: the strip `wa.land.stamp` indexes into. */
const STAMP_PNG = encodePng(rotationSheet(STAMP_BMP, STAMP_FRAMES));

const AIM_PNG = encodePng(AIM_BMP);
/**
 * A two-frame firing strip: the gun's own cell, then a bright one, stacked the
 * way WA slices a firing sheet (`height / frames`). The panel reads the frame
 * count from exactly this shape, so the test has to be a real strip.
 */
function firingStrip(source: Bitmap): Bitmap {
  const { width, height, rgba } = source;
  const out = new Uint8Array(width * height * 2 * 4);
  out.set(rgba, 0);
  const second = width * height * 4;
  for (let i = 0; i < width * height; i += 1) {
    out[second + i * 4] = 255;
    out[second + i * 4 + 1] = 236;
    out[second + i * 4 + 2] = 180;
    out[second + i * 4 + 3] = 255;
  }
  return { width, height: height * 2, rgba: out };
}
const FIRING_STRIP_PNG = encodePng(firingStrip(ICE_BMP));
/** The aiming manager's mute: 1x1 and fully transparent, never drawn. */
const SILENT_PNG = encodePng({ width: 1, height: 1, rgba: new Uint8Array(4) });
const GRENADE_PNG = encodePng(GRENADE_BMP);
const ICE_PNG = encodePng(ICE_BMP);
/** The drum ships as its own 20-cell strip: nothing to bake. */
const DRUM_PNG = encodePng(DRUM_BMP);
const SHEEP_PNG = encodePng(SHEEP_BMP);
const TRAIL_4 = encodePng(rotationSheet(GRENADE_BMP, 4));

/**
 * The sheet one role plays: its own art at a single frame, a baked rotation
 * strip above it, or the art it already ships as a strip (the drum's 20 cells).
 * A declared `frames` always matches the cells written.
 */
function roleSheet(base: Bitmap, png: Buffer, frames: number): Buffer {
  const count = Math.max(1, Math.round(frames));
  if (count <= 1) return png;
  if (base.height === base.width * count) return png;
  return encodePng(rotationSheet(base, count));
}

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

/**
 * A baked stamp strip as the project's `terrainStamp.sheet`. The 32 cells are
 * what `frames` declares, and `sourceFile` is the single up-pointing frame the
 * editor would have baked from.
 */
function stampAsset() {
  return {
    file: file(STAMP_PNG, 'stamp_rot32.png'),
    fileName: 'stamp_rot32.png',
    previewUrl: '',
    frames: STAMP_FRAMES,
    fps: 15,
    play: 'loop' as const,
    sourceFile: file(encodePng(STAMP_BMP), 'stamp.png'),
    sourceName: 'stamp.png',
    rotationFrames: STAMP_FRAMES,
  };
}

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
    homing: 'off' as ClustletConfig['homing'],
    homing_arm_ms: 0,
    homing_time_ms: 0,
    gravity_pct: 100,
    wind_pct: 100,
    bounciness: 0,
    animation: 0,
    bit_action: 'none' as ClustletConfig['bit_action'],
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
    noise: 0,
    rainbow: false,
    color: '#ffffff',
    target: 'main' as RibbonTrailConfig['target'],
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
  specialSubtype?: WeaponProject['specialSubtype'];
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
  /** `wf-lib/fire_seq` burst from one `on_fire`. */
  fireSequence?: Partial<NonNullable<WeaponProject['fireSequence']>>;
  /** Held art (`hold`), e.g. the repeat-fire draw with `keep_firing`. */
  hold?: Partial<WeaponProject['hold']>;
  /** The Space swing played on the held art (`aimClip`). */
  aimClip?: Partial<NonNullable<WeaponProject['aimClip']>>;
  /** The melee strike the swing lands (`sb.hold`'s `melee`). */
  melee?: Partial<NonNullable<WeaponProject['melee']>>;
  /** `wa.land.stamp` picture burned into the terrain (`terrainStamp`). */
  terrainStamp?: Partial<WeaponProject['terrainStamp']>;
  /** PX's effect manager as a live emitter (`fx.emitter`). */
  emitter?: Partial<NonNullable<WeaponProject['emitter']>>;
  defaults?: Partial<WeaponProject['defaults']>;
  /** Code an imported bundle carried in, written verbatim (`carriedLua`). */
  carried?: Partial<NonNullable<WeaponProject['carriedLua']>>;
  /** The author's own snippet box, for a test that merges it with a carry. */
  customLua?: string;
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
    // The donor's own fire subtype (the worm fire animation + sound), not an
    // invented one: an untouched weapon writes no `fires` table.
    specialSubtype: partial.specialSubtype ?? stockDonor(partial.slot)?.specialSubtype ?? 0,
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
    terrainStamp: { ...DEFAULT_TERRAIN_STAMP, ...partial.terrainStamp },
    emitter: { ...DEFAULT_EMITTER, ...partial.emitter },
    customSounds: { ...DEFAULT_CUSTOM_SOUNDS, ...partial.customSounds },
    fireSequence: { ...DEFAULT_FIRE_SEQUENCE, ...partial.fireSequence },
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
      ...partial.hold,
    },
    aimClip: {
      ...DEFAULT_AIM_CLIP,
      keys: DEFAULT_AIM_CLIP.keys.map((key) => ({ ...key })),
      ...partial.aimClip,
      ...(partial.aimClip?.keys
        ? { keys: partial.aimClip.keys.map((key) => ({ ...key })) }
        : {}),
    },
    melee: { ...DEFAULT_MELEE, ...partial.melee },
    packArt: { ...(partial.packArt || {}) },
    customSprites: {},
    recordOverrides: { ...(partial.overrides || {}) },
    enableCustomLua: !!partial.customLua,
    customLuaSnippet: partial.customLua ?? '',
    carriedLua: partial.carried
      ? {
          preamble: partial.carried.preamble ?? [],
          prologue: partial.carried.prologue ?? [],
          hooks: partial.carried.hooks ?? [],
          registrations: partial.carried.registrations ?? [],
          unresolved: partial.carried.unresolved ?? [],
          origin: 'wftest.pack',
        }
      : undefined,
    useWepFile: false,
  };
}

// ---------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------
/** Multi-line Lua in a carried block, without a backslash-n in every string. */
const lines = (...parts: string[]) => parts.join(String.fromCharCode(10));

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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 16), 16) },
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
      packArt: { strike_sprite: art('strike_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      packArt: { strike_sprite: art('strike_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 16), 16) },
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
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 32), 32) },
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
      'The ice sprite for 0.8 s, then the 32-frame bazooka sheet spins while the missile steers, and the flight art returns after 6.8 s.',
    watch:
      'The homing sheet from launch (arm ignored), no swap at 800 ms (timing), art that never ends (time), or the pigeon sprite showing under it.',
  },
  {
    project: makeOp({
      id: 'wftest.33_builder_bit_homing',
      name: 'WF 33 Builder Bit Homing',
      slot: 'cluster_bomb',
      burst: 'clusters',
      clustlet: {
        count: 4,
        sprite_count: 1,
        bit_action: 'homing',
        homing: 'lock',
        homing_arm_ms: 600,
        homing_time_ms: 5000,
        animation: 0,
      },
      missileSprite: { enabled: true, mode: 'custom', anim: 'track', frames: 1, hideStock: true },
      bitFlight: { mode: 'builder', anim: 'track', frames: 1 },
      // The cluster bits' homing art is the drum's own 20-cell strip at 20 fps,
      // so a bit that keeps the flight sheet (or shows all 20 cells at once) is
      // obvious; the record's `clusters.bit.homing.sprite` is zeroed for it.
      behaviorArt: {
        homing_bit: { ...DEFAULT_ROLE_ART, mode: 'builder', anim: 'track', frames: 20, fps: 20 },
      },
    }),
    intent:
      'Timed homing art for cluster bits: the bit sheet until `arm` (600 ms), then the drum strip for `time` (5000 ms).',
    expect:
      'The parent tracks with the ice sprite and bursts into four bits; each bit tracks with the grenade for 0.6 s, swaps to the spinning drum for 5 s, then returns to the grenade.',
    watch:
      'Bits keeping the flight sheet (the timed window is lost), the drum never appearing (the arm/time rows), the whole 20-cell strip drawn as one frame (frames not declared), or the parent drawing bit art (`m.sprite` identity).',
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
        anim: 'track',
        frames: 32,
        hideStock: true,
      },
      // Underground overrides: the round spins instead of tracking, at twice the
      // base spin, and keeps its sheet cycling, a dig is unmistakable.
      behaviorArt: {
        dig: { ...DEFAULT_ROLE_ART, mode: 'inherit', anim: 'rotation', spinRate: 2, frames: 32 },
      },
    }),
    intent:
      'Digging with the WFWS builder: the record dig sprites are zeroed, the round tracks in the air and spins once it is underground.',
    expect:
      'Tracks its arc in flight; once the nose is in the land it spins (twice the base speed) while it tunnels, with no mole and no Salvation-Army `wsv*` art, then tracks again in open air.',
    watch:
      'The mole (dig sprites not zeroed), a `wsv*` frame, art frozen underground (probes never firing), no spin in the dirt (`dig.anim`/`dig.spin` lost), or the sheet spinning in mid-air.',
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
          file: file(roleSheet(SHEEP_BMP, SHEEP_PNG, 32), 'sheep_flight1.png'),
          fileName: 'sheep_flight1.png',
          frames: 32,
          rotationFrames: 32,
        },
        flight2: {
          file: file(roleSheet(SHEEP_BMP, SHEEP_PNG, 16), 'sheep_flight2.png'),
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
  {
    project: makeOp({
      id: 'wftest.28_roam_builder',
      name: 'WF 28 Roam Builder',
      slot: 'super_sheep',
      action: 'roam',
      body: { sprite: 'sheepwlk' },
      // A builder sheet owns the flying state: the export keeps the record
      // `sprite` (WA's walking pose; `sheepwlk` is a real stock id), zeroes
      // `sheep.flight_1/2` and passes the pose's id as `walk`, so the builder
      // still knows the primary while WA animates the walk.
      //
      // The sheet is `spec/sspsheep1.png`, which points up-LEFT: the weapon-wide
      // `angle` modifier (45) stands it up, and `track` then follows the flight
      // vector. Without it the sheep flies 45 degrees off its heading.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'track',
        frames: 1,
        angle: 45,
        hideStock: true,
      },
    }),
    intent:
      'Roaming art through the sprite builder: the record `sprite` keeps WA\'s walk and its id goes to `sb.flight` as `walk`, `sheep.flight_1/2` are zeroed, and `roam = true` waits for Space. The sheet points up-left, so `angle = 45` stands it up.',
    expect:
      'The sheep walks with WA\'s pose after firing; on the first Space press it takes off into our sheet and points along its heading (not 45 degrees off it), and any cluster bits still use our bit sheet.',
    watch:
      'A missing walk pose (`sprite` zeroed although `sheepwlk` draws), stock flown art under ours (`sheep.flight_1/2` not zeroed), the sheep flying 45 degrees off its heading (`angle` lost), art frozen upright in the air (`track` never applied), bits drawn with the primary sheet (`walk` id matching the bit sprite), or nothing after Space (`wa.world.keys().space`/turn worm).',
  },
  {
    project: makeOp({
      id: 'wftest.34_roam_tilt',
      name: 'WF 34 Roam Tilt',
      slot: 'super_sheep',
      action: 'roam',
      body: { sprite: 'sheepwlk' },
      // `anim = "roam"`: the ground pose is side-on (rest), leaning up/down by
      // the limits as the animal steps; once it flies it tracks its heading
      // like `track`. WA still draws the stock walk pose here, so the rest only
      // shows while the animal has no velocity and the builder is drawing it.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'roam',
        frames: 1,
        roamTilt: { up: 35, down: 25, rest: 90 },
        hideStock: true,
      },
    }),
    intent:
      'The roam tilt preset: `anim = roam` with `tilt = { up = 35, down = 25, rest = 90 }`, WA keeping the ground pose.',
    expect:
      'The sheep walks with WA\'s pose; after Space it flies on the builder sheet, pointing exactly along its heading (the ground lean does not apply in the air). A record whose walk pose cannot draw instead rests flat (90°) while it walks and leans at most 35° up / 25° down as it steps.',
    watch:
      'The art resting upright on the ground while the editor shows it flat (the builder default rest is not 90), the flying art stuck near horizontal (the ground clamp still applied in the air), the lean limits swapped (up tilts down), a leftward walk tilting up by itself (the signed vx used instead of the mirrored heading), or the sheet 45 degrees off (that is WF 28 and its `angle`).',
  },
  {
    project: makeOp({
      id: 'wftest.35_roam_role',
      name: 'WF 35 Roam Own Sheet',
      slot: 'super_sheep',
      action: 'roam',
      body: { sprite: 'sheepwlk' },
      // The roaming animal's flown art as a role of its own: its own sheet,
      // animation, frames and scale. WA keeps the walk; the builder takes over
      // on the Space press. Nothing here may change Slot 1's sheet or params.
      missileSprite: { enabled: true, mode: 'custom', anim: 'track', frames: 1, hideStock: true },
      behaviorArt: {
        roam: {
          ...DEFAULT_ROAM_ROLE_ART,
          mode: 'builder',
          anim: 'roam',
          frames: 4,
          animSpeed: 1.5,
          scale: 1.5,
          sheetFile: file(roleSheet(SHEEP_BMP, SHEEP_PNG, 4), 'state_roam.png'),
        },
      },
    }),
    intent:
      'A roaming animal\'s flown art as its own role: `roam = { sheet = state_roam.png, anim = roam, cyclical = 4, scale = 1.5 }` with `walk`/`fly` for the takeoff.',
    expect:
      'The sheep walks with WA\'s pose, then on Space flies on the sheep sheet at 1.5x with its own four-frame cycle; the primary sheet and its `track` animation are unchanged on Slot 1.',
    watch:
      'The primary sheet after takeoff (`roam.sheet` missing or overridden by Slot 1), the sheep at the primary scale (role params leaking into or out of Slot 1), no takeoff (`fly` lost), or WA\'s two flight strips drawing under ours.',
  },
  {
    project: makeOp({
      id: 'wftest.29_fire_seq',
      name: 'WF 29 Sequential Fire',
      slot: 'mortar',
      // A mortar record fired as a burst: the first shell from `on_fire`, the
      // rest from fire_seq's timer, which holds WA's shot counters so the worm
      // stays in its firing pose. Live aim means the player can keep steering
      // the stream while it runs.
      fireSequence: {
        enabled: true,
        mode: 'missiles',
        count: 12,
        delay: 3,
        speed: 14,
        standoff: 24,
        spreadX: 0.3,
        spreadY: 0.3,
        offsetY: -3,
        liveAim: true,
        cancelOnWeaponChange: true,
      },
      // One report per shot, from `on_shot(i, w)`.
      customSounds: {
        shotEnabled: true,
        shot: soundAsset(INTERVAL_WAV, 'shot.wav'),
        shotEvery: 1,
        shotPriority: 8,
      },
    }),
    intent:
      '`wf-lib/fire_seq` (`px.fire_seq`): one trigger fires twelve mortar shells three frames apart, with live aim and a repeat-fire pose.',
    expect:
      'One Space press fires a stream of twelve shells; the worm keeps its firing pose until the last one, the aim follows the arrow keys during the burst, and the turn ends after the burst.',
    watch:
      'Only one shell (the `on_fire` block missing or `fires.subtype` not set), the worm leaving its pose after the first shot, shells spawning inside the worm (standoff), a burst that never ends (counters not released), or a second burst starting from WA’s queued re-fire.',
  },
  {
    project: makeOp({
      id: 'wftest.30_builder_size_angle',
      name: 'WF 30 Builder Size Angle',
      slot: 'grenade',
      // The grenade sheet points up; `angle = -90` turns it to point right, so
      // the two weapon-wide builder parameters are visible on one round: the
      // sprite is 1.6x its own size and lying on its side.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'none',
        size: 1.6,
        angle: -90,
        hideStock: true,
      },
    }),
    intent:
      '`sb.flight` weapon-wide parameters: `size = 1.6` scales the sheet, `angle = -90` rotates it.',
    expect:
      'The grenade flies 1.6x its normal size and points sideways (right, then mirrored left), not up.',
    watch:
      'Sheet drawn at its own size (`size` not reaching the builder), still pointing up (`angle` ignored), or the offset applied twice on the mirrored side.',
  },
  {
    project: makeOp({
      id: 'wftest.31_seq_hold',
      name: 'WF 31 Sequential Hold',
      slot: 'grenade',
      // A held sheet plus a burst: WA's repeat-fire frames (0x6A/0x6B) alternate
      // and the engine only draws them while `h.firing` is set, which a
      // fire_seq burst does not refresh. `keep_firing` covers those two states,
      // so the grenade must stay visible for the whole burst. `size` is the
      // 46 px default cell times the 0.7 scale.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: -8,
        weapRotation: 0,
        scale: 0.7,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      fireSequence: {
        enabled: true,
        mode: 'missiles',
        count: 6,
        delay: 4,
        speed: 14,
        standoff: 20,
        offsetY: -3,
        liveAim: true,
        cancelOnWeaponChange: true,
      },
    }),
    intent:
      '`keep_firing` with `wf-lib/fire_seq`: the held grenade stays on WA\'s repeat-fire frames through the aim layer, at the sheet\'s own size times `weap_scale`.',
    expect:
      'After the first shot the held art stays on screen every frame for the rest of the burst, at the same size and place as while aiming (0.7x), and still follows the live aim and the hand.',
    watch:
      'The grenade blinking out on every other frame (no `keep_firing`), the firing frames drawing at 1x instead of 0.7x (`weap_scale` dropped), or the art jumping to a fixed position (the aim geometry not copied).',
  },
  {
    project: makeOp({
      id: 'wftest.32_hold_flash',
      name: 'WF 32 Hold Flash',
      slot: 'minigun',
      fireType: 'hitscan',
      body: { sprite: 'minigun', damage: 6 },
      // The firing role: a sheet of its own drawn on WA's firing frames, for a
      // window of its own (`ticks`), instead of the held gun.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: -8,
        weapRotation: 0,
        scale: 1,
        drawHand: true,
        thrown: false,
        keepWhileFiring: true,
        flashFile: file(FIRING_STRIP_PNG, 'flash.png'),
        flashWidth: ICE_BMP.width,
        flashHeight: ICE_BMP.height * 2,
        // The firing role's own numbers: its own two-frame strip, placement and
        // hand, so the round trip has something real to carry.
        fireFrames: 2,
        fireFps: 12,
        // One strip cycle at 12 fps, and the gun gives way to it.
        fireTicks: 9,
        fireHideMain: true,
        fireWeapRadius: -4,
        fireWeapRotation: 15,
        fireScale: 1.2,
        // The role's own nudge channels, so the offsets are carried too.
        fireOffsetX: 6,
        fireOffsetY: -4,
        fireHandOffsetX: -2,
        fireHandOffsetY: 3,
        fireHandRadius: 14,
        fireHandRotation: -10,
        fireHandScale: 0.9,
        // A support hand that is on the gun in both roles, with its own firing
        // grip: the firing pass is its own pose, so the hand can sit elsewhere
        // on the sheet without moving the aiming hand.
        extraHand: {
          enabled: true,
          radius: -6,
          rotation: 0,
          scale: 0.9,
          offsetX: 2,
          offsetY: -3,
          fireRadius: -14,
          fireRotation: 20,
          fireScale: 0.8,
          fireOffsetX: -3,
          fireOffsetY: 5,
        },
      },
    }),
    intent:
      "The firing role: `sb.hold`'s `fire` table draws its own two-frame strip on WA's firing frames (0x6A/0x6B), with its own placement and hand, and hides the held gun while it plays.",
    expect:
      "Every shot shows the firing strip where the gun draws (its own radius, rotation and scale), animating for 9 ticks instead of WA's two frames, with the gun hidden behind it and the role's own hand.",
    watch:
      'A single flash frame (the `ticks` window missing), the held gun showing under the strip (`hide_main` missing), the strip at the aim placement instead of its own, or the hand missing while firing.',
  },
  {
    project: makeOp({
      id: 'wftest.36_seq_flash',
      name: 'WF 36 Sequential Flash',
      slot: 'grenade',
      // Both art roles on one burst: `keep_firing` holds the held sheet on WA's
      // firing frames for the whole burst, and the firing role replaces it for
      // its own window (`ticks`) from each shot, which is PX's
      // `OnFiringAnim(isFiring)`.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: -8,
        weapRotation: 0,
        scale: 0.7,
        frames: 1,
        drawHand: true,
        thrown: false,
        flashFile: file(AIM_PNG, 'flash.png'),
      },
      fireSequence: {
        enabled: true,
        mode: 'missiles',
        count: 6,
        delay: 6,
        speed: 14,
        standoff: 20,
        offsetY: -3,
        liveAim: true,
        cancelOnWeaponChange: true,
      },
    }),
    intent:
      '`keep_firing` + `wf-lib/fire_seq` with both a hold sheet and a firing sheet: the aim sheet fills the burst\'s firing frames, and the firing sheet plays for its own window from each shot.',
    expect:
      'During the six-shot burst the held grenade stays visible at 0.7x between shots, and the firing sheet plays over it from every shot for its own window (not for the whole burst).',
    watch:
      'The firing sheet stuck on for the whole burst (the window ignored), the gun blinking out between shots (no `keep_firing`), or the hand disappearing on firing frames.',
  },
  {
    project: makeOp({
      id: 'wftest.37_stamp_impact',
      name: 'WF 37 Stamp Impact',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      // The crater has to be carved inside `on_explode`, before the stamp: WA's
      // own blast runs after the callback and would erase a stamp that is
      // already in the land.
      explosion: { enabled: true, mode: 'blast', damage: 35, push: 100, hole: 40, sound: 'none' },
      terrainStamp: {
        enabled: true,
        onImpact: true,
        soften: 3,
        blend: 'mix',
        trueColour: false,
        // A live worm within 12 px of the impact point cancels the stamp
        // (`stamp_clear`), so nothing is sealed under the picture.
        wormClearance: 12,
        sheet: stampAsset(),
        impact: NO_PIERCE,
      },
    }),
    intent:
      '`wa.land.stamp` at the impact angle: the arrow is burned into the terrain where the rocket bursts, turned to the heading it came in at.',
    expect:
      'A crater appears and the arrow stays inside it, pointing the way the rocket was travelling (a rocket flying right leaves a right-pointing arrow). Hitting a worm leaves no stamp, so the worm is never sealed in.',
    watch:
      'No arrow at all (the stamp is not claimed, or the sheet frame count is not 32), the arrow erased by the crater (native blast instead of the custom one), the arrow always pointing up (the heading helper missing), or no arrow when the blast lands away from worms (the clearance check too wide).',
  },
  {
    project: makeOp({
      id: 'wftest.38_stamp_fixed',
      name: 'WF 38 Stamp Fixed',
      slot: 'grenade',
      body: { sprite: 'grenade', damage: 30 },
      explosion: { enabled: true, mode: 'blast', damage: 30, push: 80, hole: 34, sound: 'none' },
      terrainStamp: {
        enabled: true,
        onImpact: false,
        // Frame 8: a quarter turn clockwise, so the arrow always points right,
        // whichever way the grenade arrived.
        fixedAngle: 90,
        soften: 5,
        blend: 'dither',
        trueColour: true,
        // Off, so the same test covers the unguarded call too.
        wormClearance: 0,
        sheet: stampAsset(),
        impact: NO_PIERCE,
      },
    }),
    intent:
      'Fixed stamp angle (frame 8) with `buried.blend = "dither"` and `true_colour`: the same orientation, and the upload colours rather than the terrain palette, on every impact.',
    expect:
      'Every grenade leaves a right-pointing arrow in its crater, with a hard dithered edge, the red tip and pale shaft of the upload instead of terrain colours.',
    watch:
      'The arrow following the throw direction (fixed frame ignored), a soft mixed edge (`blend` not written), or terrain-coloured pixels (`true_colour` missing).',
  },
  {
    project: makeOp({
      id: 'wftest.39_stamp_pierce',
      name: 'WF 39 Stamp Pierce',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      terrainStamp: {
        enabled: true,
        onImpact: true,
        soften: 3,
        blend: 'mix',
        trueColour: false,
        wormClearance: 12,
        sheet: stampAsset(),
        // PX's javelin shape: pierce what the rocket lands on, stick in the
        // ground only when nothing was there. Non-default numbers so the
        // round-trip proves the mapping rather than a default reading back.
        impact: {
          enabled: true,
          damage: 25,
          radius: 18,
          impulse: 0.25,
          kind: 'fire',
          spareShooter: false,
        },
      },
    }),
    intent:
      '`stamp_hit` (PX\u2019s javelin): the rocket damages every worm, mine, crate and oil drum inside 18 px of where it lands, and only burns the arrow into the ground when it hit nothing. The record\u2019s own blast is zeroed.',
    expect:
      'A rocket that lands on a worm or object damages it and throws it along the flight (no crater, no arrow there); one that lands on bare ground leaves the arrow and no burst at all.',
    watch:
      'A crater or push from WA\u2019s own blast (power not zeroed), no damage at all (a bad `kind` fails the whole bundle at load), an arrow burned on top of a target, or a rocket fired at your own feet doing nothing (this test turns Spare the shooter off).',
  },
  {
    project: makeOp({
      id: 'wftest.40_builder_pingpong',
      name: 'WF 40 Builder PingPong',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 40 },
      // `anim = "none"` so the sheet cycle is the only motion: the glyph turns
      // one way through the six frames and then unwinds, instead of snapping
      // from the last frame back to the first.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'none',
        frames: 6,
        pingpong: true,
        hideStock: true,
      },
    }),
    intent:
      '`pingpong = true` on the primary sheet: the frame strip plays 0..5 and then 5..0, so a six-frame cycle reverses instead of looping hard.',
    expect:
      'The rocket glyph rotates through the six orientations and then back the other way, smoothly and repeatedly, with no jump from the last frame to the first.',
    watch:
      'A hard loop (the glyph snapping back to frame 0), no cycle at all (`pingpong` left out of `sb.flight`), or WAÕs own rocket under the sheet (`sprite = 0` not written).',
  },
  {
    project: makeOp({
      id: 'wftest.41_electric_blast',
      name: 'WF 41 Electric Blast',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 40 },
      // The taze is `px.electric`'s damage module: the weapon arms the hurt
      // before the custom blast, and every worm the blast takes health from is
      // held and thrown. `damageType` is what the card's Damage Type sends.
      explosion: {
        enabled: true,
        mode: 'blast',
        preset: 'electric',
        damageType: 'electric',
        damage: 30,
        push: 70,
        hole: 30,
        sound: 'none',
      },
    }),
    intent:
      'Electrical damage type on the custom blast: every worm the blast reaches is held in the sparking taze pose and thrown when the hold releases.',
    expect:
      'The rocket bursts, the ring appears, and each worm in range crackles for about 0.4 s and is then thrown outward by the blast falloff; the damage lands once, not twice.',
    watch:
      'Worms taking damage but never sparking (`px.electric` missing, so the require fails and the whole weapon does not load), no knockback on release (the arm not passed `retain`), or double damage (the arm carrying damage the blast already took).',
  },
  {
    project: makeOp({
      id: 'wftest.42_electric_overlay',
      name: 'WF 42 Electric Overlay',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 40 },
      // WA's own blast stays, so nothing in the record changes: the weapon arms
      // its blast-kind hurt and `px.electric`'s taze holds whoever it reaches.
      explosion: {
        enabled: true,
        mode: 'effect',
        preset: 'electric',
        damageType: 'electric',
      },
    }),
    intent:
      'Electrical damage type while WA keeps its own blast: the burst is only the overlay, and the worms the native blast hurts are tazed all the same.',
    expect:
      'A stock rocket blast (native damage, push and crater) with the blue ring over it, and every worm it damaged crackling for about 0.4 s and then thrown outward.',
    watch:
      'The native blast missing or doubled (the arm is not a blast replacement), no taze at all (`set_message_electric_missile` not emitted, or `ev.worm` filtered out the hurt), or the taze firing for a later, unrelated explosion.',
  },
  {
    project: makeOp({
      id: 'wftest.43_pierce_taze',
      name: 'WF 43 Electric Pierce',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      // PX's javelin with an electric tip. The card is on because the pierce
      // rides its checkbox, but there is no sheet: the picture and the damage
      // are separate, so this is a pure pierce with no stamp call. The taze is
      // `px.electric`'s arm around the pierce's one `o:hurt`.
      terrainStamp: {
        enabled: true,
        onImpact: false,
        soften: 1,
        blend: 'dither',
        trueColour: false,
        wormClearance: 12,
        impact: {
          enabled: true,
          damage: 25,
          radius: 20,
          impulse: 0.4,
          kind: 'taze',
          spareShooter: true,
        },
      },
    }),
    intent:
      'An electrical pierce: the round stabs the first worm or object it lands on and sends the scripted taze kind, which `px.electric` turns into the sparking hold.',
    expect:
      'No blast and no crater, the round sticks in the land only when it hit nothing, and the worm it stabbed crackles for about 0.4 s and is thrown along the flight. A mine or crate in the way is hit instead.',
    watch:
      'A worm taking damage but never sparking (`zap` missing, or the arm placed after the hurt), a native blast on top of the pierce, or the firing worm tazed by its own round (`spare_shooter` is on).',
  },
  {
    project: makeOp({
      id: 'wftest.44_stamp_builder_angle',
      name: 'WF 44 Stamp Builder Angle',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      // The stamp follows the rotation the builder drew the round at, not the
      // velocity, so a round the builder spins keeps spinning into the land.
      // `slow` is a fixed spin: the art turns steadily whatever the heading is,
      // which is what makes the difference visible. The custom blast carves the
      // crater inside `on_explode` so WA's own crater cannot erase the stamp.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'slow',
        frames: 4,
        spinRate: 2,
        hideStock: true,
      },
      explosion: { enabled: true, mode: 'blast', damage: 35, push: 100, hole: 40, sound: 'none' },
      terrainStamp: {
        enabled: true,
        onImpact: true,
        soften: 3,
        blend: 'mix',
        trueColour: false,
        wormClearance: 0,
        sheet: stampAsset(),
        // The arrow has to land on a worm too, so the pierce stays off and the
        // custom blast carves the crater.
        impact: NO_PIERCE,
      },
    }),
    intent:
      'The stamp frame comes from `sb.heading(ev.missile)`: the arrow lies the way the builder had the round drawn when it burst, and only falls back to the velocity heading when the round is a stock one.',
    expect:
      'The rocket spins in flight and the arrow is burned in at whatever angle the art had reached, so two shots fired alike leave arrows at different angles, none of them tracking the trajectory.',
    watch:
      'The arrow always pointing along the flight (the velocity helper used instead of the builder angle), or a `nil` heading crashing the callback (it has to fall back, not index it).',
  },
  {
    project: makeOp({
      id: 'wftest.45_builder_offset',
      name: 'WF 45 Builder Offset',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      // `offset = { x, y }`: the art moved inside its own cell, in sheet pixels,
      // scaled with the art (size 2 doubles both numbers to 12 px). `anim = none`
      // leaves the sheet upright, so the nudge is plain on screen: the art rides
      // 12 px up and 12 px to the firing side, never on the rocket's own point.
      missileSprite: {
        enabled: true,
        mode: 'custom',
        anim: 'none',
        size: 2,
        offsetX: 6,
        offsetY: -6,
        hideStock: true,
      },
    }),
    intent:
      'The builder nudges the drawn art inside its own cell (`offset`), scaled with the art and mirrored with the side, without moving the round itself.',
    expect:
      'The rocket flies its normal arc while the sheet sits 12 px up and 12 px to the firing side of it; fired to the left the sheet sits on the other side, still 12 px up.',
    watch:
      'The art back on the trajectory (the offset not emitted, or emitted in screen space so it fails to mirror), or the round itself veering (`offset` must only move the follower).',
  },
  {
    project: makeOp({
      id: 'wftest.46_hold_offset',
      name: 'WF 46 Hold Offset',
      slot: 'grenade',
      body: { sprite: 'grenade', damage: 30 },
      // The aiming manager (`sb.hold`): the engine's `HoldSpec` has no offset,
      // so a non-zero one hands the aiming poses to quads of the same sheet and
      // points the engine at a 1x1 silent sheet while it draws. Nothing else
      // changes: the walk pose, the put-away and the fire pose stay the
      // engine's, and the grow-in is the engine's own.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
        // Sheet pixels, scaled with `weap_scale`. Positive Y is down the sheet
        // (toward the grip), positive X across it, so 8/-10 lifts the art off
        // the hand and 8 to the sheet's right.
        offsetX: 8,
        offsetY: -10,
      },
    }),
    intent:
      'A held weapon whose art does not sit at its cell centre: the aiming poses come from the WFWS quad layer (`sb.hold`), drawn at the engine`s own geometry plus `offset`.',
    expect:
      'The grenade is held 8 px across and 10 px up the sheet from the hand at every aim angle, and it still matches the engine exactly in everything else: the same grow-in on select, the same walk/put-away retreat, the same scale.',
    watch:
      'A grenade in the hand exactly where an unoffset hold would be (the layer not taken over, or `offset` dropped), two grenades (the engine still drawing its sheet, so the mute did not apply), no grenade at all (the quad failed to load, so the silent sheet is what draws), or a grenade that jumps when the worm starts walking (the layer should not own the walk pose).',
  },
  {
    project: makeOp({
      id: 'wftest.47_swing_idle',
      name: 'WF 47 Swing Idle',
      // A thrown record: WA's bat resolves its own hit in one native frame, so
      // its worm never stays in a state long enough to animate a custom clip.
      slot: 'sheep',
      fireType: 'special',
      body: { sprite: 'sheep', damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      // A readable cut: wind up away from the target, swing through it, come
      // back. `eat_fire` follows the clip, so Space never fires this weapon.
      aimClip: {
        enabled: true,
        ticks: 16,
        finish: 'endTurn',
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 4, angle: -25, dx: -2, dy: 2, scale: 1, ease: 'in_quad' },
          { t: 8, angle: 60, dx: 3, dy: -3, scale: 1.1, ease: 'out_cubic' },
          // The return home does not fade: `fade = false` holds the alpha for the
          // segment and steps at the key, so a weapon coming back to the worm
          // never goes see-through on the way.
          { t: 16, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 0.6, fade: false, ease: 'out_quad' },
        ],
      },
    }),
    intent:
      'The aiming clip: Space plays a keyframed swing on the held art instead of firing, and the turn ends when the clip runs out. The last key sets alpha 0.6 with `fade = false`, so the art stays fully opaque through the return and only drops to 0.6 as it lands.',
    expect:
      'The bat is held while aiming; pressing Space winds it back, swings it through, and returns it to the aim pose, with no shot, no projectile and no ammo change. The turn then ends by itself.',
    watch:
      'The weapon firing instead of swinging (`eat_fire` missing), the art not moving at all (the quad layer not taken over, or `swing` not emitted), the art moving but snapping back the instant Space is released (the clip read from the render clock instead of the 50 Hz one), the return fading out and back in (a key written without `fade = false`), or the turn never ending (a swing with no finish).',
  },
  {
    project: makeOp({
      id: 'wftest.48_echo_trail',
      name: 'WF 48 Echo Trail',
      // A thrown record: WA's bat resolves its own hit in one native frame, so
      // its worm never stays in a state long enough to animate a custom clip.
      slot: 'sheep',
      fireType: 'special',
      body: { sprite: 'sheep', damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      // The same cut as WF 47, with five additive ghosts three ticks apart so
      // the arc is visible as a smear instead of a single blade.
      aimClip: {
        enabled: true,
        ticks: 20,
        finish: 'endTurn',
        echo: { enabled: true, count: 5, every: 3, fade: 0.6, blend: 'add' },
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 5, angle: -25, dx: -2, dy: 2, scale: 1, ease: 'in_quad' },
          { t: 12, angle: 70, dx: 4, dy: -3, scale: 1.1, ease: 'out_cubic' },
          { t: 20, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
    }),
    intent:
      'The ghost trail behind a swing: the same clip at earlier ticks, each ghost fainter and additive, drawn under the live art.',
    expect:
      'Pressing Space leaves a bright smear of the bat behind the blade, fading over three ticks per ghost at 60 percent each, strongest at the blade and gone once the clip ends. The hand does not smear, only the blade.',
    watch:
      'No trail at all (`echo` dropped from the `swing` table, or `sb.hold` compiled it away), a solid white blob (the ghosts drawn on top of the blade instead of under it, or `blend` leaking into the live quad so it draws additively too), the hand smearing as well, or a trail that keeps growing after the swing ends (`t - k*every` not clamped to 0).',
  },
  {
    project: makeOp({
      id: 'wftest.49_second_hand',
      name: 'WF 49 Second Hand',
      // A thrown record: WA's bat resolves its own hit in one native frame, so
      // its worm never stays in a state long enough to animate a custom clip.
      slot: 'sheep',
      fireType: 'special',
      body: { sprite: 'sheep', damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
        // A support hand much further up the shaft, its own art, and a nudge
        // that puts it on the grip rather than in the middle of the blade.
        extraHand: {
          enabled: true,
          file: file(ICE_PNG, 'hand2.png'),
          preview: '',
          sheetWidth: 60,
          sheetHeight: 60,
          radius: -6,
          rotation: 0,
          scale: 0.9,
          offsetX: 2,
          offsetY: -3,
        },
      },
    }),
    intent:
      'A second hand on the weapon: `HoldSpec` has one hand slot, so the aiming layer draws it with the engine`s own hand maths from `extra_hand`.',
    expect:
      'The worm holds the bat with two hands: the usual one at the grip and a second one further up the shaft, both swinging together when Space is pressed, and both drawn at every aim angle including straight up and straight down.',
    watch:
      'Only one hand (the layer not taken over for `extra_hand`), the second hand stuck at the worm`s feet (`radius` ignored), the second hand drawn but missing its sheet (the claim `sprites` does not list `hand2.png`, so the quad cannot resolve), the two hands sliding apart during a swing (the clip`s `dx`/`dy` not carried), or the second hand drawn twice during a firearm burst (`weapon_only` not honoured for the firing pass).',
  },
  {
    project: makeOp({
      id: 'wftest.50_melee_strike',
      name: 'WF 50 Melee Strike',
      // The Sheep Launcher, not WA's bat: a special melee subtype resolves its
      // own hit in one native frame and never animates, while a power record
      // gives the worm a real aim phase for the swing to take over.
      slot: 'sheep_launcher',
      fireType: 'melee',
      body: { damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      // A cut that lands mid-swing, with the box following the blade so it
      // sweeps through the arc instead of pointing where the aim does.
      aimClip: {
        enabled: true,
        ticks: 16,
        finish: 'endTurn',
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 4, angle: -25, dx: -2, dy: 2, scale: 1, ease: 'in_quad' },
          { t: 8, angle: 55, dx: 3, dy: -3, scale: 1.1, ease: 'out_cubic' },
          { t: 16, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
      melee: {
        enabled: true,
        // Two worm widths of reach and a wide arc: the box is drawn on the aim
        // preview, and this is what "inside the red box" means in game.
        radius: 40,
        width: 18,
        followSwing: true,
        hitFrame: 8,
        damage: 24,
        kind: 'normal',
        pushMode: 'aim',
        pushPower: 3.5,
        lift: 2,
        // The default pair: nothing on the hit, WA's 96 whiff when the swing
        // comes off nothing.
        hitSound: { id: 0, priority: 10 },
        missSound: { id: 96, priority: 8 },
        oncePerTarget: true,
        spareShooter: true,
        log: true,
      },
    }),
    intent:
      'The melee strike: Space swings the held art, and on the hit frame the scan box the panel draws in red is tested against the living worms in front of the striker. The swing takes the worm (`worm:take{ turn = "freeze" }`), so the clip is the clock rather than WA`s worm states, and the weapon fires for real: an invisible ghost shot (no art, no trail, no blast, no damage, no sound) is what lets WA take the ammo, play its launch step and end the turn by its own rules, with a 5 s retreat window.',
    expect:
      'Pressing Space freezes the worm and plays all 16 ticks of the swing, a worm standing in the box (in front, within the reach and the arc) takes 24 damage on tick 8 and is thrown away from the striker with a little lift, the swinger is never hit, and each worm only takes it once per swing. One ammo is used, nothing visible leaves the worm (the shot has no art, no trail, no blast and no damage), and the turn ends when WA says so: the retreat window (5 s) is the control kept until the ghost dies or Space is pressed. The hit itself is silent (the default `hit_sound = 0`), while a swing that takes nobody plays the default whiff, `miss_sound = 96`, at the striker.',
    watch:
      'No damage at all (the `melee` table not registered because `sb.hold` took the engine path, the hit frame past the end of the clip, or the swing never starting: the log would then show no `swing at tick` line), nothing drawn for the whole clip while the strike lands (the draw pass comparing worm handles instead of `worm.id`), the animation playing for one frame and stopping (the clip still gated on an aim state instead of the swing), damage on every frame the box overlaps (the once-per-worm table not resetting per swing), the swinger hurting itself (spare_shooter), a worm behind the striker taking it (the scan vector mirrored wrongly, so the box points backwards on one side), a sheep or any art flying out of the worm (the record is not a ghost: check `missile.sprite = 0` and `action = "none"`), a boom or a crater (the ghost still blasts), or the turn hanging with no end (no retreat window and no `after_use`). Set `log = true` (it is on here) and read the `[melee]` lines.',
  },
  {
    project: makeOp({
      id: 'wftest.55_melee_combo',
      name: 'WF 55 Melee Combo',
      slot: 'sheep_launcher',
      fireType: 'melee',
      body: { damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      aimClip: {
        enabled: true,
        ticks: 24,
        finish: 'endTurn',
        // A cut that goes one way and comes back, so a strike per swing angle is
        // visible: the clip's own angle turns each box.
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 8, angle: -35, dx: 1, dy: -1, scale: 1.1, ease: 'out_cubic' },
          { t: 16, angle: 30, dx: -1, dy: -1, scale: 1.1, ease: 'inout_quad' },
          { t: 24, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
      melee: {
        enabled: true,
        radius: 40,
        width: 18,
        followSwing: true,
        // Three strikes, each with its own damage and throw: 10 then 12 then a
        // heavy finisher that throws harder and lifts. The first two name their
        // own sample (a light id and a heavier one), so a combo is heard as well
        // as felt; the third falls back to the weapon's `hitSound`.
        hits: [
          { frame: 8, damage: 10, power: 2, lift: 0, sound: { id: 6, priority: 8 } },
          { frame: 16, damage: 12, power: 4, lift: 1, sound: { id: 32, priority: 9 } },
          { frame: 22, damage: 16, power: 6, lift: 3 },
        ],
        hitFrame: 8,
        damage: 10,
        kind: 'normal',
        pushMode: 'aim',
        pushPower: 2,
        pushVx: 0,
        pushVy: 0,
        lift: 0,
        hitSound: { id: 96, priority: 10 },
        missSound: { id: 96, priority: 8 },
        oncePerTarget: true,
        spareShooter: true,
        log: true,
      },
    }),
    intent:
      'A three-hit melee combo: the swing lands one strike at frame 8, another at 16 and a finisher at 22, each with its own damage and throw, each following the clip`s angle at its own frame. `hits = { { frame, damage, power, lift }, ... }` in the `sb.hold` spec; the `hit` callback receives the strike as its fourth argument so it can use `hit.damage`.',
    expect:
      'One Space press, three separate hits on a worm standing in the box: 10 damage, then 12, then 16 (38 in all), thrown harder by each, with the third lifting the victim. Each hit lands once, on its own tick; the swing plays its full 24 ticks, and the turn ends by its own rules once the ghost shot it fired resolves. Each landed strike plays its own sample when it names one (id 6, then id 32) and `hit_sound` (96) otherwise, at the victim, and a strike that takes nobody plays `miss_sound` at the striker, so a swing into thin air is heard as a whiff. Read the `[melee] hit n/3 at frame ...` lines.',
    watch:
      'One hit only (the SDK reading `hit_frame` and ignoring `hits`), all three landing on the same tick (the strikes not sorted, or `tick >=` compared against the wrong frame), the same damage three times (the callback ignoring its fourth argument), every strike throwing the same (per-hit `power`/`lift` not read), a worm hit twice by one strike (`once` not kept per strike), the swing ending after the first hit, three sounds on a single landed strike (the sound played per worm instead of per strike), one sample for all three strikes (a row own `sound`/`wav`/`priority` not read, so every strike plays the weapon hit sound), or no whiff on an empty swing (`miss_sound` dropped, or `wa.sound` missing from the engine build).',
  },
  {
    project: makeOp({
      id: 'wftest.53_aim_clamp',
      name: 'WF 53 Aim Clamp',
      slot: 'sheep_launcher',
      fireType: 'melee',
      body: { damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
        // 45 degrees either side of level: the pose and the strike stop there,
        // the way WA's bat pipes its own aim.
        aimClamp: { enabled: true, up: 45, down: 45 },
      },
      aimClip: {
        enabled: true,
        ticks: 16,
        finish: 'endTurn',
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 8, angle: 45, dx: 2, dy: -2, scale: 1.1, ease: 'out_cubic' },
          { t: 16, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
      melee: {
        enabled: true,
        radius: 40,
        width: 18,
        followSwing: false,
        hitFrame: 8,
        damage: 20,
        kind: 'normal',
        pushMode: 'aim',
        pushPower: 3,
        lift: 1,
        oncePerTarget: true,
        spareShooter: true,
        log: true,
      },
    }),
    intent:
      'The aim clamp (`aim_clamp`): WA`s own aim target is clamped, not only our draw. `worm.aim_target` is read-only, but `worm:input{ aim = deg }` writes the same value `control_aim` writes, so the tool writes it every frame from `wa.on.body_move` while the aim is outside 45 degrees either side of level. The drawn pose, the swing and the strike follow, and the engine`s hand is parked (`hand_radius = 0.01`) because the layer draws the clamped one.',
    expect:
      'Aim well above or below 45 degrees: the aim itself stops at the limit (not only the art: WA adds at most one of its own 1.41 degree steps after the write, so the crosshair may sit a hair past 45 and no further), the held art stops with it, only one hand is visible, and a Space press struck from a vertical aim still swings along the clamped direction (the worm in front at level takes the hit, one overhead does not). The log prints `aim clamped` when the press was past the limit.',
    watch:
      'The aim running all the way to straight up or down (the `body_move` hook not installed: this engine build has no `wa.on.body_move`, and the log then says so), the art following the crosshair past the limit (the mask or the layer not reading `aim_clamp`), two hands past the limit (the engine hand not parked to 0.01), the strike landing on a worm straight above (the press latching the unclamped aim), or the whole weapon not swinging (an aim clamp alone should not need anything else on the card).',
  },
  {
    project: makeOp({
      id: 'wftest.54_fire_angle_clamp',
      name: 'WF 54 Fire Angle Clamp',
      // `uzi`: the firearm family's donor. A template has to be one of WA's own
      // weapons (`stock.<name>`), and a name that is not takes the whole bundle
      // down with it, so the pack checks every slot before it writes.
      slot: 'uzi',
      fireType: 'hitscan',
      // The same clamp a swing weapon uses, worn by a firearm: the burst's
      // launch direction comes from `seq_dir(w)` (live aim), so the limit is a
      // real limit on the fire angle, not only on the drawn pose.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
        aimClamp: { enabled: true, up: 30, down: 30 },
      },
      fireSequence: {
        enabled: true,
        mode: 'missiles',
        count: 6,
        delay: 3,
        speed: 16,
        standoff: 20,
        spreadX: 0.1,
        spreadY: 0.1,
        offsetY: -3,
        liveAim: true,
        cancelOnWeaponChange: true,
      },
    }),
    intent:
      'The aim clamp on a firearm, both halves at once: WA`s own aim target is clamped to 30 degrees either side of level (`worm:input` from a `body_move` hook), and `seq_dir(w)` launches the burst along that clamped aim as well, so a shot cannot leave at an angle the held art cannot hold even on the first frame.',
    expect:
      'Aim straight up or straight down and press Space: the crosshair itself stops at 30 degrees from level, the stream leaves along it, and the held art stops at the same limit. Aiming inside the limit changes nothing.',
    watch:
      'Shells flying fully vertical (the clamp not emitted into `seq_dir`, or emitted after it, and the `body_move` hook absent), a stationary aim still firing vertically on the first shot only (the clamp latched but not used by `vx`/`vy`), the whole burst missing (`aim_clamped` placed after its first use, so `seq_dir` reads a nil local), the aim running to straight up on a weapon whose art stops (the native write failing: the log says so once), or the art not clamped (the hold table missing `aim_clamp`).',
  },
  {
    project: makeOp({
      id: 'wftest.51_trail_bits_only',
      name: 'WF 51 Trail Bits Only',
      slot: 'ming_vase',
      burst: 'clusters',
      body: { sprite: 'grenade' },
      clustlet: { count: 5, sprite_count: 1, animation: 2 },
      // The primary builder has to be on, and it needs a bit role: `sb.role` is
      // what classifies each missile, and a builder with no `bits` art answers
      // "main" for every frag.
      missileSprite: { enabled: true, mode: 'custom', anim: 'track', hideStock: true },
      bitFlight: { mode: 'builder', anim: 'track', frames: 1 },
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 16), 16) },
      trailer: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 4,
        glowWidth: 8,
        color: '#66ccff',
        target: 'bit',
      },
    }),
    intent:
      'Ribbon trail with target "bit": the round flies bare and only its cluster bits trail. The builder is on for this weapon, so the identity is the one it decided on each missile`s first frame (`sb.role`), not the PX live-ribbon guess.',
    expect: 'No ribbon on the bomb; five blue ribbons once it bursts.',
    watch:
      'A ribbon on the bomb (the guard inverted or dropped), no ribbons at all (the trail hook deciding on the frame before the builder has classified the bit: the two `wa.on.missile_frame` handlers are in the wrong order, or the wait line is gone), a builder with no bit role (every frag answers "main", so nothing trails), or five ribbons plus the parent`s (the hook attaching before the identity is cached).',
  },
  {
    project: makeOp({
      id: 'wftest.52_burst_main_only',
      name: 'WF 52 Burst Main Only',
      slot: 'ming_vase',
      burst: 'clusters',
      body: { sprite: 'grenade' },
      clustlet: { count: 5, sprite_count: 1, animation: 2 },
      // Same reason as WF 51: the round/bit split is the builder's identity,
      // and the builder only has one when it owns the bit art too.
      missileSprite: { enabled: true, mode: 'custom', anim: 'track', hideStock: true },
      bitFlight: { mode: 'builder', anim: 'track', frames: 1 },
      packArt: { cluster_sprite: art('cluster_sprite', roleSheet(GRENADE_BMP, GRENADE_PNG, 16), 16) },
      explosion: {
        enabled: true,
        mode: 'effect',
        target: 'main',
        preset: 'pyro',
        radius: 40,
        color: '#ffaa33',
      },
    }),
    intent:
      'Explosion burst with target "main": only the round`s own blast draws the ring, and the five bit blasts stay plain even though they are missiles of the same weapon. The guard sits at the top of the merged claim `on_explode`, so the custom WAV and custom Lua in the same hook follow it too.',
    expect: 'One orange ring where the bomb bursts; five silent bit blasts, no rings.',
    watch:
      'Six rings (the guard not emitted, the builder owning no bit role so every frag answers "main", or `sb.role` returning nil for the bits), no ring at all (the guard reading the round as a bit: `sb.role` must answer "main"), or the bits` own blast silenced (the burst in `blast` mode, where the record is zeroed for every missile).',
  },
  {
    project: makeOp({
      id: 'wftest.56_emitter_ring',
      name: 'WF 56 Emitter Ring',
      slot: 'grenade',
      // The aim the muzzle offset is measured along: the held art has to be on
      // for a muzzle emitter to read against anything.
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: -6,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      emitter: {
        enabled: true,
        // PX's railgun: the ring sits at the muzzle while aiming and then rides
        // the round it fired (`weaponEffect->targetObj`).
        anchor: 'muzzle',
        carry: true,
        offsetX: 25,
        offsetY: 0,
        preset: 'electric',
        spark: true,
        glow: true,
        reach: true,
        reachCount: 2,
        reachDirection: -90,
        reachSpread: 120,
        reachDistance: 22,
        reachSpeed: 14,
        reachCurve: 'arc',
        reachBulge: 60,
        reachNoise: 4,
        reachSegments: 14,
        reachCoreWidth: 6,
        reachGlowWidth: 12,
        color: '#8fc4ff',
        ring: {
          ...DEFAULT_EMITTER_RING,
          enabled: true,
          radius: 26,
          segments: 22,
          noise: 0.9,
          speed: 4,
          ellipseX: 1.2,
          ellipseY: 0.45,
          // The lens turns with the grenade: the bend follows the round's
          // velocity, which is the whole reason the switch exists.
          track: true,
          color: '#a9d7ff',
        },
        trail: {
          ...DEFAULT_EMITTER_TRAIL,
          enabled: true,
          max: 14,
          every: 2,
          noise: 1.5,
          coreWidth: 5,
          glowWidth: 11,
          color: '#8fc4ff',
        },
        rainbow: false,
      },
    }),
    intent:
      'PX`s effect manager as a live emitter (`fx.emitter`). It rides the muzzle while the turn`s worm aims with this weapon (a `FRAME_FINISH` worm message, at PX`s 25 px along the fire angle), and when WA writes the grenade`s first missile frame the emitter is handed to it (`emitter_round`, keyed by `m.id`). The claim writes no `on_fire`: that would replace WA`s shot. The ring is bent into PX`s lens (`ellipse = { 1.2, 0.45 }`), spins while aiming, and tracks the round`s heading in flight (`track = true`), so the lens faces the way the grenade is going. The emitter carries its own short ribbon, which needs `fx.install{ trail = true }` even though the round has no trail card.',
    expect:
      'Select the weapon: a bent, spinning ring with sparks and two short crackling bolts sits just in front of the held grenade and follows the aim as the mouse moves. The bolts point up and within 60 degrees either side of straight up (`direction = -90`, `spread = 120`). Press Space: the grenade leaves the worm (WA fires it) and the ring travels with it, its long axis turning through the arc to stay along the flight, leaving a thin ribbon, and it ends with the grenade`s blast. Aiming away, or another weapon selected, and it is gone.',
    watch:
      'Nothing at all, and the log says `attempt to index a boolean value (local `src`)` (an older `effects.sdk` whose `merge` indexes `spark = true` as a table: this is what 0.3.5 does, so the bundle needs 0.4.2), no ring while aiming (the `FRAME_FINISH` registration missing, or `w.weapon == ctx.id` never true: the worm`s selected weapon is the id, not the slot), no grenade at all on Space (the claim has an `on_fire`: it replaces WA`s shot, so the emitter must never write one), the ring stuck at the spot it appeared (the muzzle handler not calling `move_to`, or the SDK`s ring not following its emitter), the ring staying behind after the shot (the `missile_frame` latch did not set `EMITTER.follow`), a ring left on the map after the grenade bursts (the follower returning a stale point instead of nil once the round is gone), a ring drawn flat rather than bent (`ellipse` dropped), a lens that keeps its angle while the grenade arcs (`track` dropped, so `angle + speed * t` is all there is), a ribbon that leaves no trail (`fx.install{ trail = false }` because the round trail card is off: the emitter`s ribbon needs the same install), bolts spraying in every direction (an `effects.sdk` older than 0.4.2 whose reach copy drops `direction`/`spread`), or two emitters at once (a re-import carrying our own `FRAME_FINISH` or `missile_frame` registration as foreign code).',
  },
  {
    project: makeOp({
      id: 'wftest.57_carried_hurt',
      name: 'WF 57 Carried Hurt',
      slot: 'grenade',
      // The point is the code: an imported bundle's `wa.on.hurt` and the helper
      // local it closes over, carried verbatim (the Carried Lua panel). Nothing
      // in the panels models a hurt handler, so this is what the reader does
      // with one: it writes it, and the helper comes with it.
      carried: {
        prologue: [
          {
            origin: 'prologue',
            text: lines(
              'local function label_for(amount)',
              '  return "WF 57 carried hurt saw " .. tostring(amount) .. " electric"',
              'end',
            ),
            declares: ['label_for'],
            requires: [],
            line: 4,
            neededBy: ['wa.on.hurt'],
          },
        ],
        registrations: [
          {
            event: 'hurt',
            text: lines(
              'wa.on.hurt(function(hit)',
              '  if hit.kind ~= "taze" then return end',
              '  wa.log(label_for(hit.amount))',
              'end)',
            ),
            line: 9,
          },
        ],
      },
    }),
    intent:
      'A carried `wa.on.hurt` and the helper local it closes over. The handler is written verbatim after everything the editor installs, and `label_for` is carried into the install body because the handler reads it.',
    expect:
      'Zap any worm with an electric weapon from this pack: the engine log prints `WF 57 carried hurt saw N electric` once per taze hit, where N is the damage. Nothing in the match changes, the handler only reports.',
    watch:
      "Nothing in the log (the registration was dropped, or a re-import carried our own handlers as foreign code and doubled them), `attempt to call a nil value (global 'label_for')` (the helper not carried, which is the closure rule), an error mentioning `hit.kind` (the event table read wrongly), or the line printing on every hit rather than only electric ones (the filter lost).",
  },
  {
    project: makeOp({
      id: 'wftest.58_carried_merge',
      name: 'WF 58 Carried Merge',
      slot: 'bazooka',
      body: { sprite: 'bazooka', damage: 35 },
      // The crater is carved by `blast` mode inside the callback, which is what
      // lets the stamp survive: WA's own blast runs afterwards and would erase
      // it.
      explosion: { enabled: true, mode: 'blast', damage: 35, push: 100, hole: 40, sound: 'none' },
      terrainStamp: {
        enabled: true,
        onImpact: true,
        soften: 3,
        blend: 'mix',
        trueColour: false,
        wormClearance: 12,
        sheet: stampAsset(),
        impact: NO_PIERCE,
      },
      // The bundle's own `on_explode` (a carried body) and the author's own box
      // (a snippet) are two different owners of one claim key: the editor merges
      // them into the handler it emits, bundle first, author second, and the
      // stamp last.
      carried: {
        hooks: [
          {
            key: 'on_explode',
            text: lines(
              'function(ev)',
              "  -- the bundle's own body: it runs before the author's",
              '  if ev.worm then wa.sound.play(ev.worm, 88, 5) end',
              'end',
            ),
            line: 6,
          },
        ],
      },
      customLua: lines(
        'on_explode = { on = function(ev)',
        "  -- the author's own body: it runs after the bundle's",
        '  if ev.worm then wa.sound.play(ev.worm, 96, 6) end',
        'end },',
      ),
    }),
    intent:
      "One claim key with three owners: the effects-SDK burst, a body an imported bundle carried, and the author's own `on_explode` snippet. The editor emits one handler, in that order, with the terrain stamp last.",
    expect:
      "Fire at the ground: the blast carves a crater, plays a zap (the bundle's body) and then a throw (the author's body), and the arrow is stamped inside the crater pointing the way the rocket came in. The claim holds a single `on_explode`, so no owner replaces another.",
    watch:
      "Only one of the two sounds (one body overwrote the other: two `on_explode` keys, which is the bug the merge exists to prevent), no stamp (the bodies ran after it, or `effect` mode let WA's blast erase it), the stamp before the sounds (order reversed), or a load error naming `ev` (a merged body whose parameter was not renamed).",
  },
  {
    project: makeOp({
      id: 'wftest.59_melee_reach',
      name: 'WF 59 Melee Reach',
      // A power record, like WF 50: a special melee subtype resolves its own hit
      // in one native frame and never animates. `holy_grenade` is an ordinary
      // power slot no other test uses, so this weapon gets a panel entry of its
      // own.
      slot: 'holy_grenade',
      fireType: 'melee',
      body: { damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      // A straight cut: the box points where the worm aims on every tick, so the
      // only thing that decides a hit here is distance and the arc. That is the
      // point of this weapon, the geometry test for the two culls.
      aimClip: {
        enabled: true,
        ticks: 16,
        finish: 'endTurn',
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 16, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
      melee: {
        enabled: true,
        // A narrow arc on purpose: 8 px either side of the weapon, 40 px of
        // reach. A worm at 40 px but 20 px off the line is outside, and a worm
        // at the same distance behind the striker is behind, not in front.
        radius: 40,
        width: 8,
        followSwing: false,
        hitFrame: 8,
        damage: 24,
        kind: 'normal',
        pushMode: 'aim',
        pushPower: 3,
        lift: 1,
        hitSound: { id: 0, priority: 10 },
        missSound: { id: 96, priority: 8 },
        oncePerTarget: true,
        spareShooter: true,
        log: true,
      },
    }),
    intent:
      'The two culls that are not distance: a worm **behind** the striker and one **outside the arc** must both survive a swing whose box covers the ground between them. The arc is deliberately narrow (8 px) and the reach 40 px, so the three cases are easy to set up by hand.',
    expect:
      'Aiming level with the turn worm: a worm **in front** and within 40 px takes 24 damage; a worm the same distance **behind** the striker takes nothing; a worm 40 px ahead but about 20 px off the line takes nothing. Three `[melee]` lines in the log, one per worm, say which is `inside` and which is `outside`, with its own `along`/`across`, and the swing plays the whiff (96) at the striker when it takes nobody.',
    watch:
      'The worm behind taking it (the scan vector mirrored wrongly: the aim and `facing` are the whole direction, so `facing * sin(aim*PI)` must be positive ahead), the off-line worm taking it (`width` ignored, or tested as a radius instead of a half-width), nothing at all taking it (the reach measured from the wrong origin, or `follow_swing` left on with a clip angle of 0 read as a rotation), or a `[melee]` line with no `along`/`across` (the log printing only the total).',
  },
  {
    project: makeOp({
      id: 'wftest.60_melee_overhead',
      name: 'WF 60 Melee Overhead',
      slot: 'dragon_ball',
      fireType: 'melee',
      body: { damage: 0 },
      hold: {
        enabled: true,
        handType: 'mid',
        handRadius: 10,
        weapRadius: 4,
        weapRotation: 0,
        scale: 1,
        frames: 1,
        drawHand: true,
        thrown: false,
        putAway: true,
      },
      // The cut rises at the hit frame. The drawn angle is clockwise on screen
      // (world y is down), so NEGATIVE turns the box up: the scan rotates the aim
      // vector by the clip angle, and +55 there pointed it at the ground, which
      // `tools/lua/harness_melee.py` now pins in both directions.
      aimClip: {
        enabled: true,
        ticks: 20,
        finish: 'endTurn',
        keys: [
          { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
          { t: 8, angle: -55, dx: 2, dy: -4, scale: 1.08, ease: 'out_cubic' },
          { t: 20, angle: 0, dx: 0, dy: 0, scale: 1, ease: 'out_quad' },
        ],
      },
      melee: {
        enabled: true,
        radius: 44,
        width: 14,
        // The whole weapon: with this on, the box turns with the blade at the hit
        // frame. Turn it off in the panel and the same swing reaches nothing
        // overhead, which is the difference the flag makes.
        followSwing: true,
        hitFrame: 8,
        damage: 24,
        kind: 'normal',
        pushMode: 'aim',
        pushPower: 3.5,
        lift: 2,
        hitSound: { id: 0, priority: 10 },
        missSound: { id: 96, priority: 8 },
        oncePerTarget: true,
        spareShooter: true,
        log: true,
      },
    }),
    intent:
      '`follow_swing`: the box is the worm aim turned by the clip angle at the strike tick, so a cut that rises (a negative drawn angle: the screen angle is clockwise, world y is down) catches a worm overhead that the level aim cannot reach. With the flag off the same strike points where the worm aims and misses it. The panel toggle and the emitted `follow_swing` are the same value, and the red box on the aim preview draws both.',
    expect:
      'Aiming level at a worm standing **above** the striker (about 40 px up and 20 px ahead, inside the 44 px reach but about 55 degrees off the level aim): with `follow_swing` on it takes 24 damage on tick 8 and is thrown up-and-away, while a worm straight ahead takes nothing because the box has turned away from it. Turn Follow the swing off in the panel, export again, and the same overhead worm survives while the worm ahead now takes the hit. The `[melee]` lines name the scan vector, which is the difference between the two runs.',
    watch:
      'The overhead worm never hit with the flag on (the clip angle not applied, `follow_swing` not emitted, or the strike using the clip angle of its own tick rather than the hit frame), both worms hit (the box widened instead of turned: the angle must rotate the vector, not add width), the worm ahead hit as well with the flag on (the angle applied twice, or mirrored with `facing` in the wrong order so the box sweeps both ways), or the toggle changing nothing (the panel writing `followSwing` and the generator reading a stale `follow_swing`).',
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
// The taze the electric blast hands to custom_explosion comes from `px.electric`.
let usesElectric = false;
let usesFireSeq = false;
let usesHolds = false;

// A template has to be one of WA's own weapons: the engine refuses the whole
// bundle for a name it does not know, which takes every other weapon with it.
// One typo here once cost a whole in-game pass, so the pack checks its own slots
// before it writes a byte.
const badSlots = TESTS.map((test) => (test.project.based_on || test.project.slot || 'grenade')
  .replace(/^stock\./, ''))
  .filter((slot) => !stockDonor(slot));
if (badSlots.length > 0) {
  console.error(`not one of WA's own weapons: ${[...new Set(badSlots)].join(', ')}`);
  process.exit(1);
}

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
        : roleSheet(GRENADE_BMP, GRENADE_PNG, asset.frames);
    writeFileSync(join(BUNDLE, path), source);
    usedSheets.add(path);
    if (asset.frames > 1) {
      spriteDecls.set(path, { frames: asset.frames, fps: asset.fps || 15, play: asset.play || 'loop' });
    }
  }

  // Held art. The engine loads `hold.sheet` itself, so no `sprites` entry; the
  // file only has to exist. The aim layer redraws the same sheet on the
  // repeat-fire frames, so a sequential-fire test needs the pixels too.
  if (project.hold?.enabled) {
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    writeFileSync(join(BUNDLE, holdSheetPath(project)), AIM_PNG);
    // The firing-state sheet. Loaded through the hold table, so it needs no
    // `mod.toml` declaration, only the file. The ice sprite keeps it visibly
    // different from the held gun, so a missing or stuck flash is obvious.
    if (project.hold.flashFile) {
      // A strip has to be a real strip: WA slices the height by the frame count
      // at load, and the panel reads the count back from the picture.
      const fireFrames = Math.max(1, Math.round(project.hold.fireFrames ?? 1));
      const flashPath = flashSheetPath(project);
      writeFileSync(join(BUNDLE, flashPath), fireFrames > 1 ? FIRING_STRIP_PNG : ICE_PNG);
      // A strip's cell count has to be declared, or the engine slices the sheet
      // by its own height / width rule and the quads show half a cell each.
      if (fireFrames > 1) {
        spriteDecls.set(flashPath, {
          frames: fireFrames,
          fps: Math.max(1, Number(project.hold.fireFps) || 15),
          play: 'loop',
        });
      }
    }
    // A second hand's own art. `sb.hold` resolves it through the claim
    // `sprites`, so the file has to exist at the path the Lua names.
    const hand2Path = extraHandSheetPath(project);
    if (hand2Path) writeFileSync(join(BUNDLE, hand2Path), ICE_PNG);
    // The aiming manager's mute: `hold.sheets` is loaded by the claim, so the
    // 1x1 transparent sheet only has to exist at the path the Lua names.
    if (holdNeedsAimLayer(project)) {
      writeFileSync(join(BUNDLE, silentHoldSheetPath(project)), SILENT_PNG);
    }
  }

  // Sprite-builder flight sheet.
  if (project.missileSprite.enabled && project.missileSprite.mode === 'custom') {
    usesBuilders = true;
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    const path = missileFlightSheetPath(project);
    // The ice sprite (a directional glyph): a multi-frame sheet is baked into a
    // rotation strip so a test can see the frame cycle, and digging animates the
    // round's own sheet.
    const primaryFrames = project.missileSprite.frames ?? 1;
    writeFileSync(join(BUNDLE, path), roleSheet(ICE_BMP, ICE_PNG, primaryFrames));
    if (primaryFrames > 1) {
      spriteDecls.set(path, { frames: primaryFrames, fps: project.missileSprite.fps || 15, play: 'loop' });
    }
    usedSheets.add(path);

    // WFWS extra roles. The exporter writes the uploaded sheet or the default
    // missile art, so a declared path always exists.
    if (bitBuilderMode(project) === 'builder') {
      const bitPath = bitFlightSheetPath(project);
      const bitFrames = Math.max(1, project.bitFlight?.frames ?? 1);
      writeFileSync(join(BUNDLE, bitPath), roleSheet(GRENADE_BMP, GRENADE_PNG, bitFrames));
      usedSheets.add(bitPath);
      spriteDecls.set(bitPath, { frames: bitFrames, fps: project.bitFlight?.fps || 15, play: 'loop' });
    }
    for (const state of resolveBehaviorStates(project)) {
      if (state.art.mode !== 'builder') continue;
      const statePath = behaviorStateSheetPath(project, state.def.key);
      const frames = Math.max(1, state.art.frames ?? 1);
      writeFileSync(join(BUNDLE, statePath), roleSheet(ICE_BMP, ICE_PNG, frames));
      usedSheets.add(statePath);
      spriteDecls.set(statePath, { frames, fps: state.art.fps || 15, play: 'loop' });
    }
    // Timed homing art is not a `states` entry any more; its sheets are
    // declared by `wfwsRoleFlags`. Write them, or a declared path dangles.
    const roles = wfwsRoleFlags(project);
    for (const [owned, key] of [
      [roles.homing, 'homing'] as const,
      [roles.bitHoming, 'homing_bit'] as const,
      [roles.roam, 'roam'] as const,
    ]) {
      if (!owned) continue;
      const statePath = behaviorStateSheetPath(project, key);
      const role = project.behaviorArt![key]!;
      const frames = Math.max(1, role.frames ?? 1);
      // The homing *bit* is the drum's own 20-cell sheet; the primary's homing
      // art is the bazooka and a roaming animal is the sheep, so the three
      // roles are never the same picture.
      const [base, png] =
        key === 'homing_bit'
          ? [DRUM_BMP, DRUM_PNG]
          : key === 'roam'
            ? [SHEEP_BMP, SHEEP_PNG]
            : [AIM_BMP, AIM_PNG];
      writeFileSync(join(BUNDLE, statePath), roleSheet(base, png, frames));
      usedSheets.add(statePath);
      spriteDecls.set(statePath, { frames, fps: role.fps || 15, play: 'loop' });
    }
  }

  // A roaming animal's two flying sheets (`sheep_sprites`). WA rotates the
  // flying animal, so the sheet is a rotation strip and its frame count is
  // what mod.toml has to declare. A builder sheet owns that state instead.
  if (roamSheetsOwnFlight(project)) {
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    for (const [which, asset] of [
      ['flight1', project.roamSheets?.flight1],
      ['flight2', project.roamSheets?.flight2],
    ] as const) {
      if (!asset?.file) continue;
      const path = roamSheetPath(project, which);
      const frames = asset.frames ?? 1;
      writeFileSync(join(BUNDLE, path), roleSheet(SHEEP_BMP, SHEEP_PNG, frames));
      usedSheets.add(path);
      if (frames > 1) spriteDecls.set(path, { frames, fps: 15, play: 'loop' });
    }
  }

  // The terrain stamp strip. `wa.land.stamp` names the claimed sheet, and the
  // engine slices it by the declared frame count, so both halves are written
  // from the same project state.
  const stampPath = terrainStampPath(project);
  if (stampPath) {
    mkdirSync(join(BUNDLE, 'sprites', folder), { recursive: true });
    writeFileSync(join(BUNDLE, stampPath), STAMP_PNG);
    usedSheets.add(stampPath);
    spriteDecls.set(stampPath, { frames: STAMP_FRAMES, fps: 15, play: 'loop' });
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
  if (project.customSounds.shotEnabled && project.customSounds.shot?.file) {
    mkdirSync(join(BUNDLE, 'sounds', folder), { recursive: true });
    writeFileSync(join(BUNDLE, 'sounds', folder, 'shot.wav'), INTERVAL_WAV);
  }

  if (project.ribbonTrail.enabled) usesRibbon = true;
  if (project.fireSequence?.enabled) usesFireSeq = true;
  if (project.hold?.enabled) usesHolds = true;
  if (
    project.explosionEffect?.enabled &&
    (project.fireType === 'power' || project.fireType === 'drop')
  ) {
    usesExplosion = true;
    // Either mode: the overlay arms WA's own blast, the replacement arms its
    // own, and both go through the same module.
    if (project.explosionEffect.damageType === 'electric') usesElectric = true;
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
// The WFWS builder is its own bundle; `wf.sdk` carries the hold art module.
if (usesHolds) dependencies.push('wf.sdk');
if (usesBuilders) dependencies.push('wfws.sdk');
if (usesRibbon || usesExplosion) dependencies.push('effects.sdk');
// An electric burst tazes through this module, which the weapon requires.
if (usesElectric) dependencies.push('px.electric');
if (usesFireSeq) dependencies.push('px.fire_seq');

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

// The editor's own library bundle travels with every export, so the pack has to
// carry it too: without it the weapons resolve `wf-lib/wfws_sprite_builder` from
// whatever copy happens to be installed in `Mods/`, which may be an older
// version without the API they use (that is how WF 44 lost its stamp:
// `sb.heading` did not exist and the callback aborted on the nil call).
for (const rel of ['mod.toml', 'lib/wfws_sprite_builder.lua']) {
  const dest = join(BUNDLE, 'wf-lib', 'wfws_sdk', rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(join(ROOT, 'spec', 'lua_sdk', 'wfws_sdk', rel)));
}

// Profile: every test weapon placed, infinite ammo, plus the stock donors and
// the two always-available utilities.
const profile: string[] = [
  `description = "All ${TESTS.length} WormForge behaviour tests in one match."`,
  '',
  '[weapons]',
];
// Each stock slot once: tests share donor slots, and a repeated key is a TOML
// error, so the loader refused the whole profile.
const stockListed = new Set<string>();
for (const test of TESTS) {
  profile.push(`${quote(test.project.id)} = true`);
  const stock = `stock.${test.project.slot}`;
  if (stockListed.has(stock)) continue;
  stockListed.add(stock);
  profile.push(`${quote(stock)} = true`);
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
  'All art is derived from the FAMAS sheets in `spec/`, not from WA: the main missile sheets are',
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
