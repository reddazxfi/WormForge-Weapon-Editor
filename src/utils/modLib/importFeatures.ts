/**
 * Reading a WFWS weapon's *features* back out of its Lua.
 *
 * `mapRecord` turns the claim's record tables into the typed record panels.
 * A weapon's hold art, sprite-builder roles, ribbon trail, explosion burst,
 * custom WAVs and `fire_seq` burst live outside those tables -- some as claim
 * keys (`hold`, `sprites`, `sounds`), some as calls in `install` (`sb.flight`,
 * `fx.burst`, `trail.install`), and some inside callbacks (`fx.burst` in
 * `on_explode`, `seq.fire_seq_mis` in `on_fire`) that a table reader skips.
 *
 * This module is the inverse of the generator's feature emission. It targets
 * the shapes the editor itself writes (a WFWS bundle), because that is the
 * only corpus where the meaning of every key is known. A PX port that builds
 * its callbacks at runtime still imports its record and reports the rest.
 *
 * Art and sounds are attached as `File`s, so re-exporting writes the same
 * pixels/samples instead of the default art.
 */
import type {
  BehaviorArtKey,
  CustomSoundsConfig,
  ExplosionEffectConfig,
  ExplosionPreset,
  FireSequenceConfig,
  FlightRoleArt,
  HoldConfig,
  MissileSpriteConfig,
  PackArtAsset,
  PackArtSlot,
  RibbonTrailConfig,
  RoamSheetAsset,
  TerrainStampImpactConfig,
  WeaponProject,
} from '../../types/weapon';
import { DEFAULT_MELEE } from '../../data/melee';
import { CLAIM_KEYS_CARRIED, CLAIM_KEYS_MODELLED } from '../../data/luaHooks';
import { NOT_GENERATED_MARKER, maskLuaCode } from '../luaText';
import type { MeleeHit, MeleeSound } from '../../types/weapon';
import {
  CLIP_EASES,
  DEFAULT_AIM_ECHO,
  type AimClipKey,
  type ClipEase,
} from '../../data/aimClip';
import {
  DEFAULT_DIG_ROLE_ART,
  DEFAULT_ROAM_ROLE_ART,
  DEFAULT_ROAM_TILT,
  DEFAULT_ROLE_ART,
} from '../../data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT, EXPLOSION_PRESETS } from '../../data/explosionPresets';
import { DEFAULT_EMITTER } from '../../data/emitter';
import { DEFAULT_FIRE_SEQUENCE } from '../../data/fireSequence';
import { DEFAULT_CUSTOM_SOUNDS } from '../../data/soundPresets';
import {
  DEFAULT_TERRAIN_STAMP,
  STAMP_FRAMES,
  STAMP_HIT_KINDS,
  stampAngleForFrame,
} from '../../data/terrainStamp';
import {
  firstTable,
  isTable,
  readCallTable,
  readReturnedTable,
  scanLua,
  type LuaTable,
  type LuaValue,
} from './luaTable';
import { bytesOf } from './loadFiles';
import type { ModFile, ModWeapon } from './scan';

export interface BundleFeatures {
  /** Fields to merge over the imported record. */
  project: Partial<WeaponProject>;
  notes: string[];
  /**
   * The bundle's own claim hooks, as the literals they were (M5). They are not
   * the author's snippet: that box is the user's, and a hook that came out of a
   * bundle has to be able to say so (round trip, markers, the panel).
   */
  carriedHooks: { key: string; text: string; line: number }[];
}

const num = (value: LuaValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const numFrom = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: LuaValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const bool = (value: LuaValue | undefined): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/**
 * `hand = sb.PX_HANDS[2]` to the panel's hand type.
 *
 * PX and this editor's own `sb.hold` spec both pick the hand sheet by index into
 * the SDK's `PX_HANDS` table, and the generator writes that index from the
 * panel's own `handType` (`1` lower, `2` mid, `3` upper), so reading it back is
 * the editor's own convention and not a guess. Buffalo of Lies names the hand
 * this way and came back on the wrong sheet.
 */
function handTypeOfHand(
  value: LuaValue | undefined,
  moduleText?: string,
): HoldConfig['handType'] | undefined {
  const literal = str(value);
  const source = literal ?? moduleText;
  if (!source) return undefined;
  const match = /PX_HANDS\s*\[\s*([123])\s*\]/.exec(source);
  if (!match) return undefined;
  if (!literal && !moduleText) return undefined;
  return match[1] === '1' ? 'lower' : match[1] === '3' ? 'upper' : 'mid';
}

const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/^\.?\//, '');

export const DEFAULT_IMPORT_HOLD: HoldConfig = {
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
};

export const DEFAULT_IMPORT_MISSILE: MissileSpriteConfig = {
  enabled: false,
  mode: 'stock',
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
  animate: false,
  spin: true,
  hideStock: true,
};

interface LoadedAsset {
  file: File;
  preview: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  /** Frames joined from a folder of PNGs, when the art was a folder. */
  frames?: number;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  wav: 'audio/wav',
};

/** PNG's IHDR and GIF's logical screen size: enough to size a hold cell. */
function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const be32 = (at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const le16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: be32(16), height: be32(20) };
  }
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { width: le16(6), height: le16(8) };
  }
  return undefined;
}

function objectUrl(file: File): string {
  try {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : '';
  } catch {
    return '';
  }
}

/**
 * A bundle path (`sprites/<mod>/hold.png`) as a `File`.
 *
 * Claim paths are relative to the bundle root, but a module may also name a
 * path assembled at runtime; the base name is the fallback, which is how the
 * scanner already matches `.wep` files.
 */
export async function readAsset(
  files: ModFile[],
  bundleDir: string,
  rawPath: string | undefined,
): Promise<LoadedAsset | undefined> {
  const rel = rawPath ? normalize(rawPath) : '';
  if (!rel) return undefined;
  const full = bundleDir ? `${bundleDir}/${rel}` : rel;
  const base = rel.split('/').pop()!;
  const inBundle = (path: string) =>
    !bundleDir || path === bundleDir || path.startsWith(`${bundleDir}/`);
  const entry =
    files.find((file) => normalize(file.path) === full) ??
    files.find((file) => inBundle(normalize(file.path)) && file.path.endsWith(`/${base}`)) ??
    files.find((file) => normalize(file.path) === base);
  if (!entry) {
    // A folder of per-frame PNGs (`sprites/i_bomb/body/00.png`, `…/aim/01.png`):
    // the engine reads it natively as one strip, frames in file-name order
    // (`load_png_sequence`), so the import joins it into the single sheet an
    // export writes. It needs a canvas, so a headless run reports the folder
    // instead of silently importing no art.
    const folder = frameFolderFiles(files, bundleDir, rel);
    if (folder.length === 0) return undefined;
    return composeFrameFolder(folder, base);
  }
  const bytes = await bytesOf(entry);
  if (!bytes) return undefined;
  const extension = base.split('.').pop()?.toLowerCase() ?? '';
  const type = MIME[extension] ?? 'application/octet-stream';
  const file = new File([bytes as BlobPart], base, { type });
  const size = imageSize(bytes);
  return { file, preview: objectUrl(file), bytes, width: size?.width, height: size?.height };
}

/**
 * The PNG frames of a sprite folder, in the order the engine loads them.
 * `dirPath` is bundle-relative and may name the folder without an extension.
 */
export function frameFolderFiles(files: ModFile[], bundleDir: string, dirPath: string): ModFile[] {
  const rel = normalize(dirPath).replace(/\/$/, '');
  if (!rel) return [];
  const full = bundleDir ? `${bundleDir}/${rel}/` : `${rel}/`;
  return files
    .filter((file) => {
      const path = normalize(file.path);
      return (
        (path.startsWith(full) || path.startsWith(`${rel}/`)) && /\.png$/i.test(path)
      );
    })
    // The engine sorts the paths, so `10.png` comes before `9.png` there too.
    .sort((a, b) => (normalize(a.path) < normalize(b.path) ? -1 : 1));
}

/**
 * Stack a folder's frames into one vertical strip, the shape `wa.assets.load`
 * slices with `frames`. Returns nothing where there is no canvas (a headless
 * check, or a Tauri build without a DOM): the caller reports the folder rather
 * than importing a weapon whose art would be silently missing.
 */
async function composeFrameFolder(frames: ModFile[], base: string): Promise<LoadedAsset | undefined> {
  if (typeof document === 'undefined') return undefined;
  const images: HTMLImageElement[] = [];
  const urls: string[] = [];
  try {
    for (const frame of frames) {
      const bytes = await bytesOf(frame);
      if (!bytes) continue;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
      urls.push(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      images.push(image);
    }
    if (images.length === 0) return undefined;
    const width = Math.max(...images.map((image) => image.naturalWidth));
    const height = images.reduce((total, image) => total + image.naturalHeight, 0);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    let y = 0;
    for (const image of images) {
      ctx.drawImage(image, 0, y);
      y += image.naturalHeight;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return undefined;
    const file = new File([blob], `${base}.png`, { type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      file,
      preview: objectUrl(file),
      bytes,
      width,
      height,
      frames: images.length,
    };
  } catch (error) {
    // A folder that cannot be joined must not look like a folder that was never
    // there: the import would quietly ship the fallback sheet instead of the art.
    console.warn(`${base}: the frame folder could not be joined`, error);
    return undefined;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

/** `[sprites."sprites/<mod>/missile.png"]` values for a sheet path. */
function spriteDecl(
  weapon: ModWeapon,
  path: string | undefined,
): Record<string, unknown> | undefined {
  if (!path) return undefined;
  const rel = normalize(path);
  return (
    weapon.spriteDecls[rel] ??
    Object.entries(weapon.spriteDecls).find(([key]) => normalize(key) === rel)?.[1]
  );
}

const animOf = (value: LuaValue | undefined, fallback: MissileSpriteConfig['anim']) =>
  value === 'track' ||
  value === 'rotation' ||
  value === 'slow' ||
  value === 'medium' ||
  value === 'fast' ||
  value === 'roam' ||
  value === 'none'
    ? value
    : fallback;

/** A role's builder art (`bits`, `bits.homing`, `homing`) from its table. */
async function readRoleArt(
  table: LuaTable,
  sheetPath: string | undefined,
  files: ModFile[],
  bundleDir: string,
  weapon: ModWeapon,
  base: FlightRoleArt,
): Promise<FlightRoleArt> {
  const asset = await readAsset(files, bundleDir, sheetPath);
  const decl = spriteDecl(weapon, sheetPath);
  return {
    ...base,
    mode: 'builder',
    sheetFile: asset?.file ?? base.sheetFile,
    sheetPreview: asset?.preview || base.sheetPreview,
    anim: animOf(table.anim, base.anim),
    frames: num(table.cyclical) ?? asset?.frames ?? base.frames,
    pingpong: bool(table.pingpong) ?? false,
    fps: numFrom(decl?.fps) ?? base.fps,
    animSpeed: num(table.anim_speed) ?? base.animSpeed,
    spinRate: num(table.spin) ?? base.spinRate,
    scale: num(table.scale) ?? base.scale,
    mirror: bool(table.mirror) ?? base.mirror,
    z: num(table.z) ?? base.z,
  };
}

/** `hold` table -> the hold panel. */
/**
 * The `{ x, y }` nudge channels, as `offsetX`/`offsetY` style fields: a key is
 * only set when it is non-zero, so an untouched role keeps inheriting.
 */
function readOffset(
  table: LuaValue | undefined,
  prefix: 'fireOffset' | 'fireHandOffset',
): Partial<HoldConfig> {
  if (!isTable(table)) return {};
  const out: Partial<HoldConfig> = {};
  const x = num(table.x) ?? 0;
  const y = num(table.y) ?? 0;
  if (x !== 0) out[`${prefix}X`] = x;
  if (y !== 0) out[`${prefix}Y`] = y;
  return out;
}

function readHold(
  table: LuaTable,
  fallback: HoldConfig,
  moduleText?: string,
  sheetFrames?: number,
  declFps?: number,
  declCells?: number,
): HoldConfig {
  const handType =
    table.hand_type === 1
      ? 'lower'
      : table.hand_type === 3
        ? 'upper'
        : table.hand_type === 2
          ? 'mid'
          : handTypeOfHand(table.hand, moduleText) ?? fallback.handType;
  // A folder of frames joins into one strip, and its frame count is the art's
  // own: `hold.frames` is what the engine slices with, so it must be that count.
  const frames = Math.max(1, Math.round(num(table.frames) ?? sheetFrames ?? 1));
  // The picture's own cell count, when the bundle declared one that the hold does
  // not play: the engine slices by the declaration and only indexes by `frames`,
  // so PX's buffalo holds frame 0 of a 20-frame strip (`frames = 1`). Dropping it
  // would re-declare the strip as one cell and squeeze all 20 into the cell.
  const cells = declCells !== undefined && declCells > frames ? Math.round(declCells) : undefined;
  // `anim_speed` is the engine's multiplier: it plays `1.5 × frames × speed`
  // frames per second (worm_hold.rs), which is the FPS the panel asks for. A
  // bundle that declares `fps` on the sheet instead gets that rate back, so the
  // panel shows what the art actually plays at rather than the engine default.
  const animSpeed =
    num(table.anim_speed) ?? (declFps && frames > 1 ? declFps / (1.5 * frames) : 1);
  const rotation = num(table.weap_rotation);
  const drawHand = bool(table.draw_hand) ?? true;
  const rawHandRadius = num(table.hand_radius);
  return {
    ...fallback,
    enabled: true,
    sheet: str(table.sheet) ?? fallback.sheet,
    handType,
    handRadius:
      !drawHand && rawHandRadius === 0.01
        ? fallback.handRadius
        : (rawHandRadius ?? fallback.handRadius),
    // The record stores PX's rotation unit (`1 + degrees/180`).
    weapRotation:
      rotation !== undefined
        ? Math.round(((rotation - 1) * 180 + Number.EPSILON) * 1000) / 1000
        : fallback.weapRotation,
    weapRadius: num(table.weap_radius) ?? fallback.weapRadius,
    // PX turns of PI, the same unit the engine multiplies: a source bundle's 0
    // hangs the arm on the other side of the worm, and writing 1 there moved the
    // art a half turn (the javelin's `weap_radius = -11.8` then read as +11.8).
    ...(num(table.weap_radial_rotation) !== undefined &&
    Math.abs((num(table.weap_radial_rotation) as number) - (fallback.weapRadialRotation ?? 1)) > 1e-6
      ? { weapRadialRotation: num(table.weap_radial_rotation) }
      : {}),
    ...(num(table.hand_radial_rotation) !== undefined &&
    Math.abs((num(table.hand_radial_rotation) as number) - (fallback.handRadialRotation ?? 1)) > 1e-6
      ? { handRadialRotation: num(table.hand_radial_rotation) }
      : {}),
    scale: num(table.weap_scale) ?? fallback.scale,
    handScale: num(table.hand_scale) ?? fallback.handScale,
    // `hand_rotation` is in turns of PI (`1 + degrees/180`), like `weap_rotation`.
    ...(num(table.hand_rotation) !== undefined
      ? {
          handRotation:
            Math.round((((num(table.hand_rotation) as number) - 1) * 180 + Number.EPSILON) * 1000) /
            1000,
        }
      : {}),
    // `hand_offset = { x, y }` (sheet pixels): what put the hand on the quad
    // layer, so a re-export must keep it.
    ...(isTable(table.hand_offset)
      ? {
          handOffsetX: num((table.hand_offset as LuaTable).x) ?? 0,
          handOffsetY: num((table.hand_offset as LuaTable).y) ?? 0,
        }
      : {}),
    frames,
    ...(cells !== undefined ? { sheetFrames: cells } : {}),
    fps: frames > 1 ? Math.max(1, Math.round(animSpeed * 1.5 * frames)) : fallback.fps,
    drawHand,
    keepWhileFiring: bool(table.keep_while_firing) ?? false,
    thrown: bool(table.thrown) ?? false,
    putAway: bool(table.put_away) ?? false,
    // `offset = { x, y }` (sheet pixels) is what put the hold on the aiming
    // manager's quad layer; without it the re-export would silently go back to
    // the engine's centred draw.
    ...(isTable(table.offset)
      ? {
          offsetX: num((table.offset as LuaTable).x) ?? 0,
          offsetY: num((table.offset as LuaTable).y) ?? 0,
        }
      : {}),
  };
}

function hexColor(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbOf(table: LuaTable): { r: number; g: number; b: number } | undefined {
  const r = num(table.r);
  const g = num(table.g);
  const b = num(table.b);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return { r, g, b };
}

/** Which named preset the numbers came from, for the panel's selector. */
function presetFor(config: ExplosionEffectConfig): ExplosionPreset | 'custom' {
  const keys = Object.keys(EXPLOSION_PRESETS) as ExplosionPreset[];
  for (const key of keys) {
    const patch = EXPLOSION_PRESETS[key].patch;
    const match = Object.entries(patch).every(([field, value]) => {
      if (field === 'color' && typeof value === 'string') {
        return value.toLowerCase() === config.color.toLowerCase();
      }
      return (config as unknown as Record<string, unknown>)[field] === value;
    });
    if (match) return key;
  }
  return 'custom';
}

/** `fx.burst{ … }` or `blast.explode{ effect = { … } }` -> the burst panel. */
function readBurstRows(table: LuaTable, config: ExplosionEffectConfig): ExplosionEffectConfig {
  const rgb = rgbOf(table);
  const ellipse = isTable(table.ellipse) ? table.ellipse : undefined;
  const smoke = table.smoke;
  const rebuffer = table.rebuffer;
  const next: ExplosionEffectConfig = {
    ...config,
    radius: num(table.radius) ?? config.radius,
    color: rgb ? hexColor(rgb.r, rgb.g, rgb.b) : config.color,
    thickness: num(table.thickness) ?? config.thickness,
    core: num(table.core) ?? 0,
    noise: num(table.noise) ?? config.noise,
    duration: num(table.duration) ?? config.duration,
    fade: num(table.fade) ?? config.fade,
    grow: num(table.grow) ?? config.grow,
    live: num(table.live) ?? config.live,
    // The generator omits `segments` when it is 0 (the SDK derives them from
    // the radius), so an absent key is a real 0, not the preset's number.
    segments: num(table.segments) ?? 0,
    ellipseX: num(ellipse?.['1']) ?? num(ellipse?.x) ?? config.ellipseX,
    ellipseY: num(ellipse?.['2']) ?? num(ellipse?.y) ?? config.ellipseY,
    smoke: isTable(smoke) ? true : bool(smoke) ?? false,
    rebuffer: isTable(rebuffer) ? true : bool(rebuffer) ?? false,
    // `rainbow = true` (or PX's `{ speed, offset }`) on the manager.
    rainbow: isTable(table.rainbow) || table.rainbow === true,
  };
  return { ...next, preset: presetFor(next) };
}

/**
 * The custom part of `on_explode`, with the features' own calls removed.
 *
 * `stripStamp` is set only when `wa.land.stamp` was recognised as this editor's
 * own emission: a hand-written stamp call is the author's custom Lua, so it is
 * kept (and reported) instead of being silently deleted.
 */
function extractOnExplodeHookBody(moduleText: string): string {
  const tableForm = /on_explode\s*=\s*\{\s*on\s*=\s*function\s*\(\s*(\w*)\s*\)/.exec(
    moduleText,
  );
  const callForm = tableForm
    ? undefined
    : /on_explode\s*=\s*function\s*\(\s*(\w*)\s*\)/.exec(moduleText);
  const match = tableForm ?? callForm;
  if (!match) return '';

  const start = match.index + match[0].length;
  const rest = moduleText.slice(start);
  const maskedRest = maskLuaCode(rest);
  const token = /\b(function|if|for|while|end)\b/g;
  let depth = 1;
  let end = -1;
  let iterations = 0;
  let found: RegExpExecArray | null;
  while ((found = token.exec(maskedRest)) !== null && iterations < 5000) {
    iterations += 1;
    if (found[1] === 'end') {
      depth -= 1;
      if (depth === 0) {
        end = found.index;
        break;
      }
    } else {
      depth += 1;
    }
  }
  return rest.slice(0, end === -1 ? rest.length : end);
}

function customExplodeBody(
  moduleText: string,
  stripStamp = false,
  /**
   * True when the claim declares `sounds/<mod>/explosion.wav`, the file this
   * editor's custom-WAV card writes. Without one it never emitted a play line,
   * so nothing is stripped: the shape alone is not ownership.
   */
  stripOwnedSound = false,
  /**
   * True when the effects-SDK burst was recognised as this editor's, which also
   * means the target guard above it (`local explode_role = sb.role …`) is ours.
   */
  stripOwnedBurst = false,
): string {
  const tableForm = /on_explode\s*=\s*\{\s*on\s*=\s*function\s*\(\s*(\w*)\s*\)/.exec(
    moduleText,
  );
  const callForm = tableForm
    ? undefined
    : /on_explode\s*=\s*function\s*\(\s*(\w*)\s*\)/.exec(moduleText);
  const match = tableForm ?? callForm;
  if (!match) return '';

  const body = extractOnExplodeHookBody(moduleText);

  const kept: string[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    // The generated burst/blast blocks and the custom-WAV play line are the
    // features' own emission; they are rebuilt from the panels on export.
    // The pierce guard is one line (`if stamp_hit(ev) then return end`).
    if (stripStamp && /^if stamp_hit\(ev\) then return end/.test(trimmed)) continue;
    // The worm guard wraps our stamp (`if stamp_clear(ev.x, ev.y) then … end`),
    // so the whole block goes: skipping only the call would leave a dangling
    // `then`/`end` in the author's custom body.
    if (stripStamp && trimmed.startsWith('if stamp_clear(')) {
      let depth = 0;
      for (; i < lines.length; i += 1) {
        for (const token of maskLuaCode(lines[i]).match(/\b(if|function|for|while|end)\b/g) ?? []) {
          depth += token === 'end' ? -1 : 1;
        }
        if (depth <= 0) break;
      }
      continue;
    }
    const ownedCall =
      trimmed.startsWith('fx.burst{') ||
      trimmed.startsWith('blast.explode{') ||
      (stripStamp && trimmed.startsWith('wa.land.stamp{'));
    if (ownedCall) {
      let braceDepth = 0;
      for (; i < lines.length; i += 1) {
        for (const ch of lines[i]) {
          if (ch === '{') braceDepth += 1;
          else if (ch === '}') braceDepth -= 1;
        }
        if (braceDepth <= 0) break;
      }
      continue;
    }
    // Our custom-WAV play, and only that one: `if ev.worm then
    // wa.sound.play(ev.worm, "sounds/<mod>/explosion.wav", n) end`. The shape
    // alone is not enough to claim the line, a bundle's own body plays stock
    // samples in exactly that shape (WF 58 merged one into this handler), and
    // stripping it lost the bundle's code.
    // The burst's target guard: `local explode_role = sb.role and ev.missile and
    // sb.role(ev.missile) or nil` and the `return` line that acts on it. Both are
    // generated from the burst card's Target select, and left in they come back
    // as the bundle's body (WF 52 carried the pair as its whole hook).
    if (
      stripOwnedBurst &&
      (/^local explode_role = sb\.role /.test(trimmed) ||
        /^if explode_role (?:==|~=) "bit" then return end$/.test(trimmed))
    ) {
      continue;
    }
    if (stripOwnedSound) {
      // Exactly the line the card emits, and only that one: one `wa.sound.play`
      // of the explosion sample in the module's own folder, on one line, guarded
      // by the event's `worm`. A bundle's own body plays stocks in the same shape
      // (WF 58 merges one into this very handler), which is why the file name and
      // the folder are part of the test rather than the shape alone.
      const ownedPlay = new RegExp(
        String.raw`^if\s+${match[1] || 'ev'}\.worm\s+then\s+wa\.sound\.play\(${match[1] || 'ev'}\.worm, "sounds\/[^"\/]+\/explosion\.wav", \d+\)\s*end$`,
      );
      if (ownedPlay.test(trimmed)) continue;
    }
    // The editor's own not-generated markers (a re-import of an export whose
    // custom body was already marked). Dropping them here keeps them from
    // nesting, which `checkLua` reads to tell generated from custom code.
    if (NOT_GENERATED_MARKER.test(trimmed)) continue;
    // The electric burst's arm (`px.electric`'s set_message_electric`, or its
    // `_missile` form for WA's own blast) is generated from the Damage Type
    // toggle, so it is one of ours too. Left in, it would be re-emitted as the
    // author's custom Lua and then armed twice on the next export.
    if (stripOwnedBurst && /^zap\.set_message_electric(?:_missile)?\(/.test(trimmed)) continue;
    kept.push(line);
  }
  // A body of comments is not code: nothing to carry, and carrying it would put a
  // claim key the author never wrote into the export. WF 52 is the case: its
  // `on_explode` is the burst's own target explanation and nothing else.
  const live = kept.some((line) => line.trim() !== '' && !line.trim().startsWith('--'));
  return live ? kept.join('\n').trim() : '';
}

/** Reads every feature the editor models, and attaches the bundle's own files. */
export async function readBundleFeatures(args: {
  weapon: ModWeapon;
  files: ModFile[];
  moduleText: string;
  /** Claim-level `sprite` / `cluster` art paths the record mapper found. */
  mappedPackArt: Partial<Record<PackArtSlot, string>>;
  /** True when the record's own action or cluster bits dig. */
  digging: boolean;
  holdBase?: HoldConfig;
  missileBase?: MissileSpriteConfig;
  soundBase?: CustomSoundsConfig;
  fireBase?: FireSequenceConfig;
  explosionBase?: ExplosionEffectConfig;
}): Promise<BundleFeatures> {
  const { weapon, files, moduleText, mappedPackArt } = args;
  const source = weapon.source;
  const scan = scanLua(moduleText);
  const bundleDir = weapon.bundleDir;
  const notes: string[] = [];
  const project: Partial<WeaponProject> = {};
  const soundBase = args.soundBase ?? DEFAULT_CUSTOM_SOUNDS;
  const fireBase = args.fireBase ?? DEFAULT_FIRE_SEQUENCE;
  const explosionBase = args.explosionBase ?? DEFAULT_EXPLOSION_EFFECT;
  const emitterBase = DEFAULT_EMITTER;

  // ---- hold ---------------------------------------------------------------
  // Two emission shapes: the inline `hold = { ... }` the engine reads, and the
  // aiming manager's `sb.hold(ctx, { ... })` call, which returns the same table
  // plus the Lua-only keys its layer draws with.
  const sbHold = readCallTable(moduleText, 'sb.hold');
  const sourceHold = source?.hold;
  const holdTable = isTable(sourceHold)
    ? sourceHold
    : (sbHold?.table ?? firstTable(scan, 'hold'));
  if (
    holdTable &&
    (str(holdTable.sheet) !== undefined ||
      num(holdTable.weap_radius) !== undefined ||
      num(holdTable.hand_radius) !== undefined)
  ) {
    const sheetPath = str(holdTable.sheet);
    const asset = await readAsset(files, bundleDir, sheetPath);
    const hold = readHold(
      holdTable,
      args.holdBase ?? DEFAULT_IMPORT_HOLD,
      moduleText,
      asset?.frames,
      numFrom(spriteDecl(weapon, sheetPath)?.fps),
      numFrom(spriteDecl(weapon, sheetPath)?.frames),
    );
    // The firing-state sprite has two emission shapes: the old `hold.flash`
    // overlay (out/side/scale pre-resolved against the gun), the FAMAS-style
    // second hold entry handed to `px_hold_art` (`local firing = { ... }`), and
    // the current shape: the firing role inside the `sb.hold` spec
    // (`fire = { sheet, cell_w, cell_h, scale, frames, ticks, hide_main, ... }`).
    const holdFireTable = isTable(holdTable.fire) ? holdTable.fire : undefined;
    const firingTable = holdFireTable
      ? undefined
      : isTable(scan.assignments['firing'])
        ? scan.assignments['firing']
        : undefined;
    // One name for both shapes: the aim layer's `fire` role when present, the
    // old `firing` table otherwise.
    const fireTable = holdFireTable ?? firingTable;
    const flashTable = isTable(holdTable.flash) ? holdTable.flash : undefined;
    const flashSource = flashTable ?? fireTable;
    const flashAsset = flashSource
      ? await readAsset(files, bundleDir, str(flashSource.sheet))
      : undefined;
    // The firing sheet's cell, the way the generator slices it: the sheet's
    // width, and its height over the frame count (one frame is the whole
    // picture, so a wide flash stays wide). `size` is that cell times the
    // role's scale, so the scale can be read back from older bundles.
    const fireFrameCount = Math.max(1, Math.round(num(fireTable?.frames) ?? 1));
    const flashCell =
      flashAsset?.width && flashAsset.height
        ? fireFrameCount > 1
          ? Math.floor(flashAsset.height / fireFrameCount)
          : flashAsset.width
        : 0;
    const weapRadius = Number(hold.weapRadius ?? 6);
    const weapScale = Number(hold.scale) || 1;
    const weapRotRad = ((Number(hold.weapRotation) || 0) * Math.PI) / 180;
    const dx = flashTable ? (num(flashTable.out) ?? 0) + weapRadius : 0;
    const dy = flashTable ? (num(flashTable.side) ?? 0) : 0;
    const cos = Math.cos(weapRotRad);
    const sin = Math.sin(weapRotRad);
    project.hold = {
      ...hold,
      sheetFile: asset?.file,
      sheetPreview: asset?.preview,
      sheetWidth: asset?.width,
      sheetHeight: asset?.height,
      ...(flashSource
        ? {
            flashFile: flashAsset?.file,
            flashPreview: flashAsset?.preview,
            flashWidth: flashAsset?.width,
            flashHeight: flashAsset?.height,
            // Only the old overlay form carries geometry: it lives in 50 Hz
            // ticks (`flash_left`) and in offsets relative to the gun's pivot,
            // rotation and scale. The FAMAS form inherits all of that.
            ...(flashTable
              ? {
                  flashFrames: Math.max(1, Math.round(num(flashTable.frames) ?? 3)),
                  flashOut: Math.round(((dx * cos - dy * sin) / weapScale) * 100) / 100,
                  flashSide: Math.round(((dx * sin + dy * cos) / weapScale) * 100) / 100,
                  flashScale:
                    Math.round(((num(flashTable.scale) ?? 1) / weapScale) * 1000) / 1000,
                }
              : {}),
            // The FAMAS entry carries its own geometry only when the author
            // copied and changed it (`firing` for `px_hold_art`); unset means
            // "the aiming numbers", which is the common case.
            ...(fireTable
              ? {
                  ...(num(fireTable.weap_radius) !== undefined &&
                  num(fireTable.weap_radius) !== Number(hold.weapRadius ?? 6)
                    ? { fireWeapRadius: num(fireTable.weap_radius) }
                    : {}),
                  ...(num(fireTable.weap_rotation) !== undefined &&
                  (num(fireTable.weap_rotation) as number) !==
                    Math.round((1 + (Number(hold.weapRotation) || 0) / 180) * 1e4) / 1e4
                    ? {
                        fireWeapRotation:
                          Math.round(
                            (((num(fireTable.weap_rotation) as number) - 1) * 180 +
                              Number.EPSILON) *
                              1000,
                          ) / 1000,
                      }
                    : {}),
                  // The firing hand: its own numbers when they differ from the
                  // aiming hand, which is the usual case (`px_hold_art` draws it
                  // from the same table, so the keys are the hand's own).
                  ...(num(fireTable.hand_radius) !== undefined &&
                  (num(fireTable.hand_radius) as number) !==
                    Number(hold.handRadius ?? 10)
                    ? { fireHandRadius: num(fireTable.hand_radius) }
                    : {}),
                  ...(num(fireTable.hand_rotation) !== undefined &&
                  (num(fireTable.hand_rotation) as number) !==
                    Math.round((1 + (Number(hold.handRotation) || 0) / 180) * 1e4) / 1e4
                    ? {
                        fireHandRotation:
                          Math.round(
                            (((num(fireTable.hand_rotation) as number) - 1) * 180 +
                              Number.EPSILON) *
                              1000,
                          ) / 1000,
                      }
                    : {}),
                  ...(num(fireTable.hand_scale) !== undefined &&
                  (num(fireTable.hand_scale) as number) !== Number(hold.handScale ?? 1)
                    ? { fireHandScale: num(fireTable.hand_scale) }
                    : {}),
                  // `size` is the sheet's cell times the scale (the helper has
                  // no `weap_scale` of its own), so it is also the only place
                  // the firing scale is written.
                  ...(num(fireTable.size) !== undefined &&
                  flashCell > 0 &&
                  Math.abs((num(fireTable.size) as number) / flashCell - Number(hold.scale ?? 1)) >
                    0.001
                    ? {
                        fireScale:
                          Math.round(
                            ((num(fireTable.size) as number) / flashCell) * 1000,
                          ) / 1000,
                      }
                    : {}),
                  ...(fireTable.draw_hand === false
                    ? { fireDrawHand: false }
                    : fireTable.draw_hand === true
                      ? { fireDrawHand: true }
                      : {}),
                  // The firing window and the main weapon, both new with the
                  // `fire` role (an old `firing` table has neither).
                  ...(holdFireTable
                    ? {
                        fireTicks: Math.max(0, Math.round(num(holdFireTable.ticks) ?? 0)),
                        ...(holdFireTable.hide_main === true ? { fireHideMain: true } : {}),
                      }
                    : {}),
                  // `scale` is the role's own number; the old shape only has
                  // `size` (the cell times that scale).
                  ...(num(holdFireTable?.scale) !== undefined
                    ? { fireScale: num(holdFireTable?.scale) }
                    : {}),
                  // Its own nudge channels, read the way the held art's are
                  // (a `{ x, y }` table the generator only writes when used).
                  ...readOffset(fireTable?.offset, 'fireOffset'),
                  ...readOffset(fireTable?.hand_offset, 'fireHandOffset'),
                  // The firing strip: `frames` slices the sheet, `anim_speed`
                  // is the engine's multiplier for `fps / (1.5 x frames)`.
                  ...(num(fireTable.frames) !== undefined
                    ? {
                        fireFrames: Math.max(1, Math.round(num(fireTable.frames) as number)),
                        fireFps: Math.max(
                          1,
                          Math.round(
                            (num(fireTable.anim_speed) ?? 1) *
                              1.5 *
                              Math.max(1, Math.round(num(fireTable.frames) as number)),
                          ),
                        ),
                      }
                    : {}),
                }
              : {}),
          }
        : {}),
    };
    // `swing = { ticks, finish, keys = { { t, angle, dx, dy, ... } } }`: the
    // Space clip `sb.hold` plays on the held art. Keys are data, so they read
    // back exactly; an unrecognised easing falls back to the default.
    const swingTable = isTable(holdTable.swing)
      ? holdTable.swing
      : isTable(scan.assignments.swing)
        ? scan.assignments.swing
        : undefined;
    if (swingTable && isTable(swingTable.keys)) {
      const raw = swingTable.keys;
      const keys: AimClipKey[] = [];
      // A Lua array reads as `1..n` string keys; gaps end the walk.
      for (let i = 1; raw[String(i)] !== undefined; i += 1) {
        const key = raw[String(i)];
        if (!isTable(key)) continue;
        const t = num(key.t);
        if (t === undefined) continue;
        const ease = str(key.ease);
        keys.push({
          t,
          angle: num(key.angle) ?? 0,
          dx: num(key.dx) ?? 0,
          dy: num(key.dy) ?? 0,
          scale: num(key.scale) ?? 1,
          frame: num(key.frame),
          alpha: num(key.alpha) ?? 1,
          // `fade = false` makes the opacity step at this key instead of easing;
          // an unset key fades, which is the type's default.
          fade: key.fade === false ? false : undefined,
          ease: (CLIP_EASES.some((entry) => entry.id === ease) ? ease : 'inout_quad') as ClipEase,
        });
      }
      if (keys.length > 0) {
        // The ghost trail rides the clip, so it is read with it.
        const echoTable = isTable(swingTable.echo) ? swingTable.echo : undefined;
        const echo = echoTable
          ? {
              enabled: true,
              count: Math.max(1, Math.min(8, Math.round(num(echoTable.count) ?? 4))),
              every: Math.max(1, Math.round(num(echoTable.every) ?? 2)),
              fade: Math.max(0.05, Math.min(0.95, num(echoTable.fade) ?? 0.55)),
              blend: (str(echoTable.blend) === 'alpha' ? 'alpha' : 'add') as 'alpha' | 'add',
            }
          : { ...DEFAULT_AIM_ECHO, enabled: false };
        project.aimClip = {
          enabled: true,
          ticks: Math.max(1, Math.round(num(swingTable.ticks) ?? keys[keys.length - 1].t)),
          finish: str(swingTable.finish) === 'end_turn' ? 'endTurn' : 'none',
          keys,
          echo,
        };
        if (echo.enabled) notes.push('ghost trail');
      }
    }
    // The aim clamp: degrees either side of level. Two numbers, so the reader
    // takes them straight back out of the same table the generator wrote.
    const clampTable = isTable(holdTable.aim_clamp) ? holdTable.aim_clamp : undefined;
    if (clampTable) {
      project.hold = {
        ...project.hold,
        aimClamp: {
          enabled: true,
          up: Math.min(90, Math.max(0, num(clampTable.up) ?? 60)),
          down: Math.min(90, Math.max(0, num(clampTable.down) ?? 60)),
        },
      };
      notes.push('aim clamp');
    }

    // The second hand: the aim layer's own `extra_hand` table (the engine's
    // `HoldSpec` has one hand slot, so it is only ever emitted for the layer).
    const extraHandTable = isTable(holdTable.extra_hand) ? holdTable.extra_hand : undefined;
    if (extraHandTable) {
      const extraSheet = str(extraHandTable.sheet);
      const extraAsset = extraSheet
        ? await readAsset(files, bundleDir, extraSheet)
        : undefined;
      // `rotation` is written in the engine's turn unit (`1 + deg/180`).
      const extraRotation =
        num(extraHandTable.rotation) !== undefined
          ? Math.round(((num(extraHandTable.rotation) as number) - 1) * 180 * 1e4) / 1e4
          : 0;
      const extraOffset = isTable(extraHandTable.offset) ? extraHandTable.offset : undefined;
      const extraFireOffset = isTable(extraHandTable.fire_offset)
        ? extraHandTable.fire_offset
        : undefined;
      // The firing grip is written only where it differs, so an unset key means
      // "the aiming numbers" (and `fire_draw` absent means "shown").
      const fireRadius = num(extraHandTable.fire_radius);
      const fireRotation = num(extraHandTable.fire_rotation);
      const fireScale = num(extraHandTable.fire_scale);
      const fireOffsetX = num(extraFireOffset?.x);
      const fireOffsetY = num(extraFireOffset?.y);
      project.hold = {
        ...project.hold,
        extraHand: {
          enabled: true,
          file: extraAsset?.file,
          preview: extraAsset?.preview,
          sheetWidth: extraAsset?.width,
          sheetHeight: extraAsset?.height,
          radius: num(extraHandTable.radius) ?? 10,
          rotation: extraRotation,
          scale: num(extraHandTable.scale) ?? 1,
          offsetX: num(extraOffset?.x) ?? 0,
          offsetY: num(extraOffset?.y) ?? 0,
          ...(extraHandTable.fire_draw === false ? { fireDraw: false } : {}),
          ...(fireRadius !== undefined ? { fireRadius } : {}),
          ...(fireRotation !== undefined
            ? { fireRotation: Math.round((fireRotation - 1) * 180 * 1e4) / 1e4 }
            : {}),
          ...(fireScale !== undefined ? { fireScale } : {}),
          ...(fireOffsetX !== undefined ? { fireOffsetX } : {}),
          ...(fireOffsetY !== undefined ? { fireOffsetY } : {}),
        },
      };
      notes.push(extraSheet ? 'second hand + its art' : 'second hand');
    }
    // The melee strike: the box, the tick and the callback the swing hands a
    // victim to. Damage and kind live in that callback's text, because what a
    // hit does is the weapon's own code (`victim:hurt{ amount = 24 }` or
    // `zap.hurt_electric(victim, 24, ...)`).
    const meleeTable = isTable(holdTable.melee) ? holdTable.melee : undefined;
    if (meleeTable) {
      const meleeText = sbHold?.text ?? '';
      const hitAt = meleeText.indexOf('hit = function');
      const hitLine = hitAt >= 0 ? meleeText.slice(hitAt) : '';
      // The generated callback reads the strike (`hit and hit.damage or 24`), so
      // the literal after `or` is the weapon's single-hit damage; a hand-written
      // callback still has the plain form.
      const amount =
        /hit and hit\.damage or (-?\d+(?:\.\d+)?)/.exec(hitLine) ??
        /(?:amount\s*=\s*|hurt_electric\(victim,\s*)(-?\d+(?:\.\d+)?)/.exec(hitLine);
      const push = meleeTable.push;
      // A combo writes `hits = { { frame, damage, power, lift }, ... }`; one hit
      // writes `hit_frame` / `damage` / `power` and no list. Both come back as
      // the same table, so the panel always has rows to edit.
      const hitRows = isTable(meleeTable.hits) ? (meleeTable.hits as LuaTable) : undefined;
      const hits: MeleeHit[] = [];
      if (hitRows) {
        // A Lua array reads as `1..n` string keys; gaps end the walk.
        for (let i = 1; hitRows[String(i)] !== undefined; i += 1) {
          const row = hitRows[String(i)];
          if (!isTable(row)) continue;
          const vx = num(row.vx);
          const vy = num(row.vy);
          // Each strike's own damage lives in the `hit` callback as
          // `hit and hit.damage or <fallback>`, so the table is the answer and
          // the callback's literal is only the fallback for a three-argument
          // caller.
          // A strike can name its own sample (`wav` / `sound` / `priority`), and
          // the weapon's own hit sound is the fallback for the ones that do not.
          const rowWav = str(row.wav);
          const rowId = Math.max(0, Math.round(num(row.sound) ?? 0));
          let sound: MeleeSound | undefined;
          if (rowWav || rowId > 0) {
            const asset = rowWav ? await readAsset(files, bundleDir, rowWav) : undefined;
            sound = {
              id: rowId,
              priority: Math.max(0, Math.round(num(row.priority) ?? 8)),
              ...(asset
                ? {
                    file: {
                      file: asset.file,
                      fileName: asset.file.name,
                      previewUrl: asset.preview,
                      size: asset.bytes.length,
                    },
                  }
                : {}),
            };
          }
          hits.push({
            frame: Math.max(0, Math.round(num(row.frame) ?? 0)),
            damage: Math.max(0, Math.round(num(row.damage) ?? 0)),
            power: num(row.power) ?? 0,
            lift: num(row.lift) ?? 0,
            ...(vx === undefined ? {} : { vx }),
            ...(vy === undefined ? {} : { vy }),
            ...(sound ? { sound } : {}),
          });
        }
      }
      const meleeSoundOf = async (role: 'hit' | 'miss'): Promise<MeleeSound> => {
        const wav = str(meleeTable[`${role}_wav`]);
        const id = Math.max(0, Math.round(num(meleeTable[`${role}_sound`]) ?? 0));
        const priority = Math.max(
          0,
          Math.round(num(meleeTable[`${role}_priority`]) ?? 8),
        );
        if (!wav) return { id, priority };
        const asset = await readAsset(files, bundleDir, wav);
        return {
          id,
          priority,
          ...(asset
            ? {
                file: {
                  file: asset.file,
                  fileName: asset.file.name,
                  previewUrl: asset.preview,
                  size: asset.bytes.length,
                },
              }
            : {}),
        };
      };
      project.melee = {
        enabled: true,
        radius: num(meleeTable.radius) ?? DEFAULT_MELEE.radius,
        width: num(meleeTable.width) ?? DEFAULT_MELEE.width,
        followSwing: meleeTable.follow_swing !== false,
        hitFrame: Math.max(0, Math.round(num(meleeTable.hit_frame) ?? 0)),
        damage: amount ? Number(amount[1]) : DEFAULT_MELEE.damage,
        kind: /hurt_electric/.test(hitLine) ? 'taze' : 'normal',
        pushMode: isTable(push) ? 'fixed' : 'aim',
        pushPower: num(meleeTable.power) ?? DEFAULT_MELEE.pushPower,
        pushVx: isTable(push) ? num(push.x) ?? 0 : 0,
        pushVy: isTable(push) ? num(push.y) ?? 0 : 0,
        lift: num(meleeTable.lift) ?? 0,
        // A bundle written before the strike had sounds carries neither key, so
        // it comes back with the editor's default whiff (96) and a silent hit.
        // `hit_wav` / `miss_wav` are uploaded files: the file wins over the id.
        hitSound: await meleeSoundOf('hit'),
        missSound: await meleeSoundOf('miss'),
        oncePerTarget: meleeTable.once !== false,
        spareShooter: meleeTable.spare_shooter !== false,
        log: meleeTable.log === true,
        ...(hits.length > 1 ? { hits } : {}),
      };
      notes.push(hits.length > 1 ? `melee strike (${hits.length} hits)` : 'melee strike');
    }
    notes.push(flashSource ? 'hold art + firing sprite' : 'hold art');
    if (project.aimClip) notes.push('space swing');
  }

  // ---- local string sheet helpers ---------------------------------------
  const collectLocalStrings = (): Map<string, string> => {
    const localStrings = new Map<string, string>();
    for (const match of moduleText.matchAll(
      /\blocal\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']+)["']/g,
    )) {
      localStrings.set(match[1], match[2]);
    }
    for (const match of moduleText.matchAll(
      /\blocal\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\.\s*["']([^"']+)["']/g,
    )) {
      const baseVar = localStrings.get(match[2]);
      if (baseVar) localStrings.set(match[1], `${baseVar}${match[3]}`);
    }
    return localStrings;
  };
  const resolveTopSheetInTable = (
    tableText: string,
    localStrings: Map<string, string>,
  ): string | undefined => {
    const masked = maskLuaCode(tableText);
    const firstBrace = masked.indexOf('{');
    if (firstBrace < 0) return undefined;
    let depth = 0;
    for (let i = firstBrace; i < masked.length; i += 1) {
      const ch = masked[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth <= 0) break;
      } else if (depth === 1 && (i === 0 || !/[A-Za-z0-9_.]/.test(masked[i - 1]))) {
        const rhs = /^sheet\s*=\s*/.exec(masked.slice(i));
        if (rhs) {
          const tail = tableText.slice(i + rhs[0].length);
          const expr =
            /^(?:["']([^"']+)["']|([A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\.\s*["']([^"']+)["'])?)/.exec(
              tail,
            );
          if (expr) {
            if (expr[1]) return expr[1];
            if (expr[2]) {
              const baseVar = localStrings.get(expr[2]);
              if (baseVar) return expr[3] ? `${baseVar}${expr[3]}` : baseVar;
            }
          }
        }
      }
    }
    return undefined;
  };

  // ---- sprite builder -----------------------------------------------------
  const flight = readCallTable(moduleText, 'sb.flight');
  if (flight) {
    const f = flight.table;
    const sheetPath = str(f.sheet) ?? resolveTopSheetInTable(flight.text, collectLocalStrings());
    const sheet = await readAsset(files, bundleDir, sheetPath);
    const decl = spriteDecl(weapon, sheetPath);
    const missileBase = args.missileBase ?? DEFAULT_IMPORT_MISSILE;
    project.missileSprite = {
      ...missileBase,
      enabled: true,
      mode: 'custom',
      sheet: sheetPath ?? missileBase.sheet,
      sheetFile: sheet?.file,
      sheetPreview: sheet?.preview,
      anim: animOf(f.anim, missileBase.anim),
      frames: num(f.cyclical) ?? 1,
      pingpong: bool(f.pingpong) ?? false,
      fps: numFrom(decl?.fps) ?? missileBase.fps,
      animSpeed: num(f.anim_speed) ?? 1,
      spinRate: num(f.spin) ?? 1,
      scale: num(f.scale) ?? 1,
      mirror: bool(f.mirror) ?? true,
      z: num(f.z) ?? 5,
      hideStock: true,
      size: num(f.size) ?? 1,
      angle: num(f.angle) ?? 0,
      // `offset = { x, y }`: the sheet-pixel nudge for an off-centre pivot.
      ...(isTable(f.offset)
        ? {
            offsetX: num((f.offset as LuaTable).x) ?? 0,
            offsetY: num((f.offset as LuaTable).y) ?? 0,
          }
        : {}),
      // `tilt = { up, down, rest }`: the `anim = "roam"` preset.
      ...(isTable(f.tilt)
        ? {
            roamTilt: {
              up: num((f.tilt as LuaTable).up) ?? DEFAULT_ROAM_TILT.up,
              down: num((f.tilt as LuaTable).down) ?? DEFAULT_ROAM_TILT.down,
              rest: num((f.tilt as LuaTable).rest) ?? DEFAULT_ROAM_TILT.rest,
            },
          }
        : {}),
      logIdentity: f.log === true,
    };

    const behaviorArt: Partial<Record<BehaviorArtKey, FlightRoleArt>> = {};
    const bits = f.bits;
    if (isTable(bits)) {
      project.bitFlight = await readRoleArt(
        bits,
        str(bits.sheet),
        files,
        bundleDir,
        weapon,
        DEFAULT_ROLE_ART,
      );
      const bitHoming = isTable(bits.homing) ? bits.homing : undefined;
      if (bitHoming) {
        behaviorArt.homing_bit = await readRoleArt(
          bitHoming,
          str(bitHoming.sheet),
          files,
          bundleDir,
          weapon,
          DEFAULT_ROLE_ART,
        );
      }
    } else if (bits === 'inherit') {
      project.bitFlight = { ...DEFAULT_ROLE_ART, mode: 'inherit' };
    } else {
      project.bitFlight = { ...DEFAULT_ROLE_ART, mode: 'native' };
    }

    const homing = isTable(f.homing) ? f.homing : undefined;
    if (homing) {
      behaviorArt.homing = await readRoleArt(
        homing,
        str(homing.sheet),
        files,
        bundleDir,
        weapon,
        DEFAULT_ROLE_ART,
      );
    }
    // Digging is a probe, not a state: `dig = true` or `dig = { ... }` means
    // the builder owns the animation and the record's four dig indexes were
    // zeroed. Without it the original left WA's dig art alone.
    if (f.dig === true) {
      behaviorArt.dig = { ...DEFAULT_DIG_ROLE_ART, mode: 'builder' };
    } else if (isTable(f.dig)) {
      behaviorArt.dig = {
        ...DEFAULT_DIG_ROLE_ART,
        mode: 'builder',
        anim: animOf(f.dig.anim, 'track'),
        frames: num(f.dig.cyclical) ?? 1,
        pingpong: bool(f.dig.pingpong) ?? false,
        animSpeed: num(f.dig.anim_speed) ?? 1,
        spinRate: num(f.dig.spin) ?? 1,
        scale: num(f.dig.scale) ?? 1,
        mirror: bool(f.dig.mirror) ?? true,
        z: num(f.dig.z) ?? 5,
      };
    } else if (args.digging) {
      behaviorArt.dig = { ...DEFAULT_DIG_ROLE_ART, mode: 'native' };
    }
    // A roaming animal's own flight art rides in the same `roam` table as the
    // takeoff ids: a `sheet` there is the role, its absence the primary sheet.
    if (f.roam === true || isTable(f.roam)) {
      const roam = isTable(f.roam) ? f.roam : undefined;
      if (roam && str(roam.sheet)) {
        behaviorArt.roam = await readRoleArt(
          roam,
          str(roam.sheet),
          files,
          bundleDir,
          weapon,
          DEFAULT_ROAM_ROLE_ART,
        );
      } else {
        // Roam has no native role of its own: the round's own sheet flies.
        behaviorArt.roam = { ...DEFAULT_ROAM_ROLE_ART, mode: 'inherit' };
      }
    }
    project.behaviorArt = behaviorArt;
    if (isTable(f.states)) {
      notes.push('legacy state art not imported');
    }
    notes.push('sprite builder');
  } else {
    // ---- PX runtime missile_sprite fallback ------------------------------
    // PX ports declare `weapon.missile_sprite` (a single table or `{ primary,
    // clustlet }`) consumed by `lib/missile_sprites.lua`. Read it when `sb.flight`
    // is absent so imported PX flight art survives without reverting to stock.
    const pxSprite =
      firstTable(scan, 'weapon.missile_sprite', 'missile_sprite') ??
      (isTable(scan.assignments['weapon']?.missile_sprite)
        ? (scan.assignments['weapon']!.missile_sprite as LuaTable)
        : undefined) ??
      (isTable(scan.returned?.missile_sprite)
        ? (scan.returned!.missile_sprite as LuaTable)
        : undefined);
    if (pxSprite) {
      const entries: LuaTable[] = isTable(pxSprite['1'])
        ? [pxSprite['1'], ...(isTable(pxSprite['2']) ? [pxSprite['2']] : [])]
        : [pxSprite];
      const primary = entries[0];
      const bitEntry = entries[1];
      if (primary) {
        const localStrings = collectLocalStrings();
        // Extract the brace-balanced `missile_sprite = { ... }` slice to resolve `ART .. "file.png"`.
        let spriteBlock = '';
        const maskedModule = maskLuaCode(moduleText);
        const startMatch = /(?:weapon\s*\.\s*)?missile_sprite\s*=\s*\{/.exec(maskedModule);
        if (startMatch) {
          const openAt = startMatch.index + startMatch[0].length - 1;
          let braceDepth = 0;
          let closeAt = maskedModule.length;
          for (let i = openAt; i < maskedModule.length; i += 1) {
            if (maskedModule[i] === '{') braceDepth += 1;
            else if (maskedModule[i] === '}') {
              braceDepth -= 1;
              if (braceDepth === 0) {
                closeAt = i + 1;
                break;
              }
            }
          }
          spriteBlock = moduleText.slice(openAt, closeAt);
        }
        const resolvedSheets: (string | undefined)[] = [];
        for (const match of spriteBlock.matchAll(
          /\bsheet\s*=\s*(?:["']([^"']+)["']|([A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\.\s*["']([^"']+)["'])?)/g,
        )) {
          if (match[1]) {
            resolvedSheets.push(match[1]);
          } else if (match[2]) {
            const baseVar = localStrings.get(match[2]);
            resolvedSheets.push(baseVar ? (match[3] ? `${baseVar}${match[3]}` : baseVar) : undefined);
          }
        }
        const sheetFor = (table: LuaTable, idx: number): string | undefined =>
          str(table.sheet) ?? resolvedSheets[idx];

        const sheetPath = sheetFor(primary, 0);
        const sheet = await readAsset(files, bundleDir, sheetPath);
        const decl = spriteDecl(weapon, sheetPath);
        const missileBase = args.missileBase ?? DEFAULT_IMPORT_MISSILE;
        const frames = Math.max(1, Math.round(num(primary.frames) ?? 1));
        const spin = primary.spin === true;
        const upright = primary.upright === true;
        project.missileSprite = {
          ...missileBase,
          enabled: true,
          mode: 'custom',
          sheet: sheetPath ?? missileBase.sheet,
          sheetFile: sheet?.file,
          sheetPreview: sheet?.preview,
          anim: spin ? 'rotation' : upright ? 'none' : 'track',
          frames,
          animate: bool(primary.animate) ?? frames > 1,
          spin,
          fps: numFrom(decl?.fps) ?? missileBase.fps,
          animSpeed: num(primary.anim_speed) ?? 1,
          spinRate: num(primary.spin_speed) ?? (spin ? 0.5 : 1),
          scale: num(primary.scale) ?? 1,
          hideStock: bool(primary.hide) ?? false,
        };
        if (bitEntry) {
          const bitSheetPath = sheetFor(bitEntry, 1);
          const bitAsset = await readAsset(files, bundleDir, bitSheetPath);
          const bitDecl = spriteDecl(weapon, bitSheetPath);
          const bitFrames = Math.max(1, Math.round(num(bitEntry.frames) ?? 1));
          const bitSpin = bitEntry.spin === true;
          const bitUpright = bitEntry.upright === true;
          project.bitFlight = {
            ...DEFAULT_ROLE_ART,
            mode: 'builder',
            sheetFile: bitAsset?.file,
            sheetPreview: bitAsset?.preview,
            anim: bitSpin ? 'rotation' : bitUpright ? 'none' : 'track',
            frames: bitFrames,
            fps: numFrom(bitDecl?.fps) ?? DEFAULT_ROLE_ART.fps,
            animSpeed: num(bitEntry.anim_speed) ?? 1,
            spinRate: num(bitEntry.spin_speed) ?? (bitSpin ? 0.5 : 1),
            scale: num(bitEntry.scale) ?? 1,
          };
        }
        const extras: string[] = [];
        if (entries.some((e) => e.first_sprite !== undefined)) extras.push('first_sprite');
        if (entries.some((e) => e.sink_tint !== undefined)) extras.push('sink_tint');
        notes.push(
          extras.length > 0
            ? `PX missile_sprite (${extras.join(', ')} not modelled in sb.flight)`
            : 'PX missile_sprite',
        );
      }
    }
  }

  // ---- ribbon trail -------------------------------------------------------
  const trailTable = firstTable(scan, 'TRAIL');
  if (trailTable && moduleText.includes('wf-lib/effects/trail')) {
    const rgb = rgbOf(trailTable) ?? { r: 255, g: 255, b: 255 };
    project.ribbonTrail = {
      enabled: true,
      max: num(trailTable.max) ?? 12,
      every: num(trailTable.every) ?? 2,
      vanish: num(trailTable.vanish) ?? 2,
      coreWidth: num(trailTable.core_w) ?? 8,
      glowWidth: num(trailTable.glow_w) ?? 13,
      noise: num(trailTable.noise) ?? 0,
      rainbow: trailTable.rainbow === true || isTable(trailTable.rainbow),
      color: hexColor(rgb.r, rgb.g, rgb.b),
      // The target is read off the guard the generator emits: `trail_is_bit`
      // says "not the round" or "not a bit", and `trail_live` on its own is the
      // builder-off heuristic for `main`.
      target: moduleText.includes('if not trail_is_bit(m) then return end')
        ? 'bit'
        : moduleText.includes('if (trail_is_bit(m)) then return end') ||
            moduleText.includes('if trail_is_bit(m) then return end')
          ? 'main'
          : moduleText.includes('trail_live')
            ? 'main'
            : 'all',
    } satisfies RibbonTrailConfig;
    notes.push('ribbon trail');
  }

  // ---- emitter ------------------------------------------------------------
  // PX's effect manager as a live emitter. The generator writes its options as
  // the table `emitter_for` returns, so the reader is named rather than guessed:
  // a hand-written bundle that calls `fx.emitter{ … }` directly is not one of
  // ours and is carried as code instead (M6 of the import plan).
  const emitterArgs = readReturnedTable(moduleText, 'emitter_for');
  if (emitterArgs && moduleText.includes('fx.emitter')) {
    const t = emitterArgs.table;
    const ring = isTable(t.ring) ? t.ring : undefined;
    const trailTable2 = isTable(t.trail) ? t.trail : undefined;
    const reach = isTable(t.reach) ? t.reach : undefined;
    const spark = isTable(t.spark) ? t.spark : undefined;
    const glow = isTable(t.glow) ? t.glow : undefined;
    const ellipse = isTable(ring?.ellipse) ? ring.ellipse : undefined;
    const base = project.emitter ?? emitterBase;
    const rgb =
      rgbOf(reach ?? {}) ??
      rgbOf(spark ?? {}) ??
      rgbOf(glow ?? {}) ??
      (isTable(t.color) ? rgbOf(t.color) : undefined) ??
      rgbOf(t) ??
      {
        r: 130,
        g: 180,
        b: 255,
      };
    const ringRgb = ring ? rgbOf(ring) : undefined;
    const emTrailRgb = trailTable2 ? rgbOf(trailTable2) : undefined;
    // The ring's spin and start angle are radians in the file and degrees in
    // the panel, which is what an author sets.
    const degrees = (value: number | undefined): number | undefined =>
      value === undefined ? undefined : Math.round((value * 180) / Math.PI * 100) / 100;
    // `emitter_muzzle` computes a radial point around the worm's aim angle
    // (`(w.aim or 0.5) * math.pi +/- radialRad`), optionally shifted across the
    // radial arm (`w.facing * c * Y, -s * Y` or legacy `dy * Y, -dx * Y`).
    const muzzleBlockMatch =
      /local\s+function\s+emitter_muzzle\(w\)([\s\S]*?)\n\s*end\b/.exec(moduleText);
    const muzzleSource = muzzleBlockMatch?.[1] ?? '';
    const muzzleAngleMatch =
      /local\s+a\s*=\s*\(w\.aim\s+or\s+0\.5\)\s*\*\s*math\.pi(?:\s*([+-])\s*([\d.]+))?/.exec(
        muzzleSource,
      );
    const radialAngle = muzzleAngleMatch?.[2]
      ? degrees((muzzleAngleMatch[1] === '-' ? -1 : 1) * Number(muzzleAngleMatch[2])) ?? 0
      : 0;
    const muzzleReturnMatch = /return\s+([^\n,]+),\s*\n?\s*([^\n]+)/.exec(muzzleSource);
    const muzzleXExpr = muzzleReturnMatch?.[1] ?? '';
    const muzzleYExpr = muzzleReturnMatch?.[2] ?? '';
    const muzzleOffsetXMatch = /\bdx\s*\*\s*(-?[\d.]+)/.exec(muzzleXExpr);
    const muzzleOffsetYMatch =
      /\bw\.facing\s*\*\s*c\s*\*\s*(-?[\d.]+)/.exec(muzzleXExpr) ??
      /\+\s*dy\s*\*\s*(-?[\d.]+)/.exec(muzzleXExpr);
    const muzzlePosXMatch = /([+-])\s*w\.facing\s*\*\s*([\d.]+)/.exec(muzzleXExpr);
    const muzzleYStripped = muzzleYExpr
      .replace(/w\.y/, '')
      .replace(/[+-]\s*dy\s*\*\s*-?[\d.]+/, '')
      .replace(/[+-]\s*(?:s|dx)\s*\*\s*-?[\d.]+/, '');
    const muzzlePosYMatch = /([+-])\s*([\d.]+)/.exec(muzzleYStripped);
    const roundReturnMatch =
      /return\s+p\.x(?:\s*([+-])\s*([\d.]+))?,\s*p\.y(?:\s*([+-])\s*([\d.]+))?,\s*p\.vx,\s*p\.vy/.exec(
        moduleText,
      );
    const signed = (sign?: string, mag?: string): number =>
      mag === undefined ? 0 : (sign === '-' ? -1 : 1) * Number(mag);
    const anchor: 'round' | 'muzzle' =
      str(t.anchor) === 'round' || /emitter_start\(ev\.worm\.x/.test(moduleText)
        ? 'round'
        : 'muzzle';
    const speed = isTable(reach?.speed) ? num(reach.speed['1']) : undefined;
    project.emitter = {
      ...base,
      enabled: true,
      anchor,
      // `carry` is written into the table; older exports only set the flag in
      // the hand-off.
      carry:
        t.carry === true || (t.carry === undefined && /EMITTER_CARRIED\s*=\s*true/.test(moduleText)),
      projectileExclusive: t.projectile_exclusive === true,
      followFireAngle: t.follow_fire_angle !== false,
      offsetX: muzzleBlockMatch
        ? muzzleOffsetXMatch
          ? Number(muzzleOffsetXMatch[1])
          : 0
        : base.offsetX,
      offsetY: muzzleBlockMatch
        ? muzzleOffsetYMatch
          ? Number(muzzleOffsetYMatch[1])
          : 0
        : base.offsetY,
      radialAngle,
      posX: muzzleBlockMatch
        ? signed(muzzlePosXMatch?.[1], muzzlePosXMatch?.[2])
        : signed(roundReturnMatch?.[1], roundReturnMatch?.[2]),
      posY: muzzleBlockMatch
        ? signed(muzzlePosYMatch?.[1], muzzlePosYMatch?.[2])
        : signed(roundReturnMatch?.[3], roundReturnMatch?.[4]),
      preset: str(t.preset) === 'thunder' ? 'thunder' : 'electric',
      spark: t.spark !== false,
      glow: t.glow !== false,
      reach: !!reach,
      reachDirection:
        num(reach?.direction) ??
        (str(reach?.from) === 'below'
          ? 90
          : base.reachDirection ?? 0),
      reachSpread:
        num(reach?.spread) ??
        (str(reach?.from) === 'below'
          ? 0
          : base.reachSpread ?? 360),
      reachCount: num(reach?.count) ?? base.reachCount,
      reachDistance: num(reach?.distance) ?? base.reachDistance,
      reachSpeed: speed === undefined ? base.reachSpeed : Math.round(speed * 100),
      reachCurve:
        str(reach?.curve) === 'line' ||
        str(reach?.curve) === 'bezier' ||
        str(reach?.curve) === 'px'
          ? (str(reach?.curve) as 'line' | 'bezier' | 'px')
          : 'arc',
      reachBulge: isTable(reach?.bulge)
        ? (num(reach.bulge['1']) ?? base.reachBulge)
        : base.reachBulge,
      reachNoise: num(reach?.noise) ?? base.reachNoise,
      reachSegments: num(reach?.segments) ?? base.reachSegments,
      reachCoreWidth: num(reach?.core_w) ?? base.reachCoreWidth,
      reachGlowWidth: num(reach?.glow_w) ?? base.reachGlowWidth,
      color: hexColor(rgb.r, rgb.g, rgb.b),
      ring: ring
        ? {
            ...base.ring,
            enabled: true,
            radius: num(ring.radius) ?? base.ring.radius,
            segments: num(ring.segments) ?? base.ring.segments,
            noise: num(ring.noise) ?? base.ring.noise,
            speed: degrees(num(ring.speed)) ?? base.ring.speed,
            angle: degrees(num(ring.angle)) ?? base.ring.angle,
            // An absent width is the library's own derivation from the radius.
            coreWidth: num(ring.core_w) ?? 0,
            glowWidth: num(ring.glow_w) ?? 0,
            thin: ring.thin === true,
            ellipseX: num(ellipse?.['1']) ?? num(ellipse?.x) ?? base.ring.ellipseX,
            ellipseY: num(ellipse?.['2']) ?? num(ellipse?.y) ?? base.ring.ellipseY,
            track: ring.track === true,
            color: ringRgb
              ? hexColor(ringRgb.r, ringRgb.g, ringRgb.b)
              : base.ring.color,
            rainbow: ring.rainbow === true || isTable(ring.rainbow),
          }
        : { ...base.ring, enabled: false },
      trail: trailTable2
        ? {
            ...base.trail,
            enabled: true,
            max: num(trailTable2.max) ?? base.trail.max,
            every: num(trailTable2.every) ?? base.trail.every,
            noise: num(trailTable2.noise) ?? base.trail.noise,
            coreWidth: num(trailTable2.core_w) ?? base.trail.coreWidth,
            glowWidth: num(trailTable2.glow_w) ?? base.trail.glowWidth,
            color: emTrailRgb
              ? hexColor(emTrailRgb.r, emTrailRgb.g, emTrailRgb.b)
              : base.trail.color,
            rainbow: trailTable2.rainbow === true || isTable(trailTable2.rainbow),
          }
        : { ...base.trail, enabled: false },
      rainbow: t.rainbow === true || isTable(t.rainbow),
    };
    notes.push('emitter');
  }

  // ---- explosion burst ----------------------------------------------------
  const blastCall = readCallTable(moduleText, 'blast.explode');
  const burstCall = readCallTable(moduleText, 'fx.burst');
  // The Damage Type toggle. A replacement blast names the kind inside its
  // table, but an overlay arms WA's own blast instead (`set_message_electric_
  // missile`) and carries no kind, so the arm itself is the other half of the
  // signal. Either way the module is required only for an electric burst.
  const onExplodeText = extractOnExplodeHookBody(moduleText);
  const armedElectric =
    /zap\.set_message_electric(?:_missile)?\(/.test(onExplodeText) &&
    moduleText.includes('wf-lib/electric/damage');
  if (blastCall || burstCall) {
    let effect = explosionBase;
    const isBlast = !!blastCall;
    if (blastCall) {
      const b = blastCall.table;
      effect = {
        ...effect,
        damage: num(b.damage) ?? effect.damage,
        push: num(b.push) ?? effect.push,
        // `destroy = false` is the generator's "no crater"; `hole` is absent.
        hole: num(b.hole) ?? (b.destroy === false ? 0 : effect.hole),
        // The scripted hit kind; the generator only ever writes `"taze"`.
        damageType:
          str(b.kind) === 'taze' || armedElectric ? 'electric' : 'blast',
        sound:
          b.sound === true ? 'default' : (num(b.sound) ?? 'none'),
      };
      const inner = isTable(b.effect) ? b.effect : undefined;
      if (inner) effect = readBurstRows(inner, effect);
    } else {
      effect = readBurstRows(burstCall!.table, effect);
      if (armedElectric) effect = { ...effect, damageType: 'electric' };
    }
    project.explosionEffect = {
      ...effect,
      enabled: true,
      mode: isBlast ? 'blast' : 'effect',
      // The guard the generator puts at the top of the hook: it returns for the
      // part the author did not pick.
      target: moduleText.includes('if explode_role == "bit" then return end')
        ? 'main'
        : moduleText.includes('if explode_role ~= "bit" then return end')
          ? 'bit'
          : 'all',
    };
    notes.push(isBlast ? 'explosion burst (blast)' : 'explosion burst (overlay)');
  }

  // ---- sequential fire ----------------------------------------------------
  const actorCall = readCallTable(moduleText, 'seq.fire_sequential_actor');
  const seqCall = readCallTable(moduleText, 'seq.fire_seq_mis') ?? actorCall;
  let shotSound: { path: string; priority: number; every: number } | undefined;
  if (seqCall) {
    const t = seqCall.table;
    const text = seqCall.text;
    const numberAfter = (pattern: RegExp): number | undefined => {
      const match = pattern.exec(text);
      if (!match) return undefined;
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : undefined;
    };
    const offset = (axis: string): number => {
      const match = new RegExp(
        `\\b${axis}\\s*=[^\\n]*?\\.${axis}\\s*([+-])\\s*([\\d.]+)`,
      ).exec(text);
      if (!match) return 0;
      const value = Number(match[2]);
      return match[1] === '-' ? -value : value;
    };
    const spread = isTable(t.spread) ? t.spread : undefined;
    const shotCall = /wa\.sound\.play\([^,]+,\s*["']([^"']+)["']\s*,\s*(\d+)\)/.exec(text);
    const shotEvery = /i\s*%\s*(\d+)\s*==\s*0/.exec(text);
    project.fireSequence = {
      ...fireBase,
      enabled: true,
      mode: actorCall ? 'actors' : 'missiles',
      count: num(t.count) ?? fireBase.count,
      delay: num(t.delay) ?? fireBase.delay,
      speed: numberAfter(/\bvx\s*=[^\n]*?\*\s*(-?[\d.]+)/) ?? fireBase.speed,
      standoff: num(t.standoff) ?? 0,
      spreadX: num(spread?.x) ?? 0,
      spreadY: num(spread?.y) ?? 0,
      offsetX: offset('x'),
      offsetY: offset('y'),
      // The generator locks the aim with `local dx, dy = seq_dir(ev.worm)`.
      liveAim: !/local\s+dx,\s*dy\s*=\s*seq_dir\(ev\.worm\)/.test(moduleText),
      cancelOnWeaponChange: t.cancel_weapon !== undefined,
      actorSprite: str(t.sprite) ?? '',
      actorGravity: bool(t.gravity) ?? false,
      actorCollide: bool(t.collide) ?? false,
      actorPersist: bool(t.persist) ?? false,
    } satisfies FireSequenceConfig;
    notes.push('sequential fire');

    if (shotCall) {
      shotSound = {
        path: shotCall[1],
        priority: Math.max(0, Number(shotCall[2])),
        every: shotEvery ? Math.max(1, Number(shotEvery[1])) : 1,
      };
    }
  }

  // ---- custom WAVs --------------------------------------------------------
  const sourceSounds = source?.sounds;
  const soundsTable = isTable(sourceSounds) ? sourceSounds : undefined;
  const soundPaths = new Set<string>();
  if (soundsTable) {
    for (const value of Object.values(soundsTable)) {
      if (typeof value === 'string') soundPaths.add(value);
    }
  }
  const intervalTable = firstTable(scan, 'SOUND');
  const intervalPath = str(intervalTable?.path);
  if (intervalPath) soundPaths.add(intervalPath);
  const launchTable = firstTable(scan, 'LAUNCH_SOUND');
  const launchPathFromTable = str(launchTable?.path);
  if (launchPathFromTable) soundPaths.add(launchPathFromTable);
  if (shotSound) soundPaths.add(shotSound.path);

  if (soundPaths.size > 0) {
    const sounds: CustomSoundsConfig = {
      ...soundBase,
      ...(project.customSounds ?? {}),
    } as CustomSoundsConfig;
    // The generated roles name their own file (`launch.wav`, `explosion.wav`), so
    // the name answers it. A hand-written bundle may call the file anything, and
    // the launch and explosion plays are the same shape (`wa.sound.play(ev.worm,
    // "<path>", n)`); which hook the play sits in is what tells them apart, so
    // take the nearest enclosing one.
    const playHookOf = (path: string): 'launch' | 'explosion' | null => {
      const quoted = [`wa.sound.play(ev.worm, "${path}"`, `wa.sound.play(ev.worm, '${path}'`];
      const at = quoted.map((needle) => moduleText.indexOf(needle)).filter((i) => i >= 0);
      if (at.length === 0) return null;
      const playAt = Math.min(...at);
      const fireAt = moduleText.lastIndexOf('on_fire', playAt);
      const explodeAt = moduleText.lastIndexOf('on_explode', playAt);
      return fireAt > explodeAt ? 'launch' : 'explosion';
    };
    for (const path of soundPaths) {
      const base = path.split('/').pop()?.toLowerCase() ?? '';
      const role =
        base.includes('launch')
          ? 'launch'
          : base.includes('explosion')
            ? 'explosion'
            : base.includes('shot')
              ? 'shot'
              : base.includes('interval')
                ? 'interval'
                : (playHookOf(path) ??
                  (moduleText.includes(`path = "${path}"`) ? 'interval' : undefined));
      if (!role) continue;
      const asset = await readAsset(files, bundleDir, path);
      const sound = asset
        ? {
            file: asset.file,
            fileName: asset.file.name,
            previewUrl: asset.preview,
            size: asset.bytes.length,
          }
        : undefined;
      if (role === 'launch') {
        sounds.launchEnabled = true;
        sounds.launch = sound;
        const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fromTable =
          launchTable && str(launchTable.path) === path ? num(launchTable.priority) : undefined;
        const priority = new RegExp(
          `wa\\.sound\\.play\\(ev\\.worm,\\s*["']${escaped}["']\\s*,\\s*(\\d+)\\)`,
        ).exec(moduleText);
        if (fromTable !== undefined) sounds.launchPriority = fromTable;
        else if (priority) sounds.launchPriority = Number(priority[1]);
      } else if (role === 'explosion') {
        sounds.explosionEnabled = true;
        sounds.explosion = sound;
        const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const priority = new RegExp(
          `wa\\.sound\\.play\\(ev\\.worm,\\s*["']${escaped}["']\\s*,\\s*(\\d+)\\)`,
        ).exec(moduleText);
        sounds.explosionPriority = priority ? Number(priority[1]) : sounds.explosionPriority;
      } else if (role === 'interval') {
        sounds.intervalEnabled = true;
        sounds.interval = sound;
        if (intervalTable) {
          sounds.intervalPriority = num(intervalTable.priority) ?? sounds.intervalPriority;
          // The module ticks on 50 Hz game frames; the panel shows milliseconds.
          sounds.intervalMs = Math.max(1, Math.round((num(intervalTable.every) ?? 20) * 20));
          sounds.intervalDelayMs = Math.max(0, Math.round((num(intervalTable.delay) ?? 0) * 20));
          sounds.intervalLimit = Math.max(0, Math.round(num(intervalTable.limit) ?? 0));
        }
      } else {
        sounds.shotEnabled = true;
        sounds.shot = sound;
        if (shotSound) {
          sounds.shotEvery = shotSound.every;
          sounds.shotPriority = shotSound.priority;
        }
      }
    }
    project.customSounds = sounds;
    notes.push('custom sounds');
  }

  // ---- pack art and claim sheets -----------------------------------------
  const packPaths: Partial<Record<PackArtSlot, string>> = {};
  const setPackPath = (slot: PackArtSlot, path: string | undefined) => {
    if (path) packPaths[slot] = path;
  };
  for (const [slot, path] of Object.entries(mappedPackArt) as [PackArtSlot, string][]) {
    setPackPath(slot, path);
  }
  const stampCall = readCallTable(moduleText, 'wa.land.stamp');
  const sourceCluster = source?.cluster;
  const claimCluster = isTable(sourceCluster) ? sourceCluster : undefined;
  setPackPath('cluster_sprite', str(claimCluster?.sprite));
  setPackPath('cluster_homing_sprite', str(claimCluster?.homing_sprite));
  setPackPath('strike_sprite', str(source?.sprite));

  const packArt: Partial<Record<PackArtSlot, PackArtAsset>> = {};
  for (const [slot, path] of Object.entries(packPaths) as [PackArtSlot, string][]) {
    const loaded = await readAsset(files, bundleDir, path);
    if (!loaded) {
      // A folder of frames the engine reads natively, joined here only where
      // there is a canvas: a headless import says so instead of importing a
      // weapon whose art silently turned into the fallback sheet.
      const folder = frameFolderFiles(files, bundleDir, path);
      if (folder.length > 0) {
        notes.push(`${path}: ${folder.length} PNG frames in a folder, not joined without a browser`);
      }
      continue;
    }
    const decl = spriteDecl(weapon, path);
    packArt[slot] = {
      file: loaded.file,
      fileName: path.split('/').pop(),
      previewUrl: loaded.preview,
      frames: numFrom(decl?.frames) ?? loaded.frames ?? 1,
      fps: numFrom(decl?.fps) ?? 15,
      play:
        decl?.play === 'once' || decl?.play === 'pingpong' || decl?.play === 'loop'
          ? decl.play
          : 'loop',
    };
  }
  if (Object.keys(packArt).length > 0) {
    project.packArt = packArt;
    notes.push(`${Object.keys(packArt).length} pack sheet(s)`);
  }

  // ---- roaming animal's two flying sheets ---------------------------------
  const sourceSheep = source?.sheep_sprites;
  const sheep = isTable(sourceSheep) ? sourceSheep : undefined;
  if (sheep) {
    const readSheet = async (value: LuaValue | undefined): Promise<RoamSheetAsset | undefined> => {
      const path = str(value);
      if (!path) return undefined;
      const loaded = await readAsset(files, bundleDir, path);
      const decl = spriteDecl(weapon, path);
      const frames =
        numFrom(decl?.frames) ??
        loaded?.frames ??
        (loaded?.width && loaded.height
          ? Math.max(1, Math.round(loaded.height / loaded.width))
          : 1);
      return {
        file: loaded?.file,
        fileName: path.split('/').pop(),
        preview: loaded?.preview,
        frames,
        fps: numFrom(decl?.fps),
        play: decl?.play === 'pingpong' ? 'pingpong' : decl?.play === 'loop' ? 'loop' : undefined,
      };
    };
    const first = await readSheet(sheep['1'] ?? sheep[1]);
    const second = await readSheet(sheep['2'] ?? sheep[2]);
    if (first && second) {
      project.roamSheets = { flight1: first, flight2: second };
      notes.push('roam sheets');
    }
  }

  // ---- terrain stamp ------------------------------------------------------
  // `wa.land.stamp{ sprite, frame, x, y, buried }` inside `on_explode`. Only the
  // shape this editor emits is read: a bundle path, `x`/`y` from the event, and
  // a frame that is either a number or the generated `stamp_orientation(...)`.
  // Anything else stays custom Lua.
  const stampSprite = str(stampCall?.table.sprite);
  const generatedStamp =
    !!stampCall &&
    !!stampSprite &&
    stampSprite.includes('/') &&
    /\bx\s*=\s*ev\.x\b/.test(stampCall.text) &&
    (typeof stampCall.table.frame === 'number' ||
      /frame\s*=\s*stamp_orientation\s*\(/.test(stampCall.text));
  if (generatedStamp && stampCall && stampSprite) {
    const t = stampCall.table;
    const onImpact = /frame\s*=\s*stamp_orientation\s*\(/.test(stampCall.text);
    const buried = isTable(t.buried) ? t.buried : undefined;
    // The worm guard is emitted as `local STAMP_CLEAR = <px>`; no guard means
    // the stamp runs regardless, which is 0. `exec` hands back a string.
    const clearMatch = /local STAMP_CLEAR = (\d+)/.exec(moduleText);
    const wormClearance = clearMatch ? Number(clearMatch[1]) : 0;
    const asset = await readAsset(files, bundleDir, stampSprite);
    const decl = spriteDecl(weapon, stampSprite);
    // The strip is 32 cells whatever its pixel size; the manifest carries the
    // frame count, and the fallback is the height/width ratio of the file.
    const frames =
      numFrom(decl?.frames) ??
      (asset?.width && asset.height
        ? Math.max(1, Math.round(asset.height / asset.width))
        : STAMP_FRAMES);
    project.terrainStamp = {
      ...DEFAULT_TERRAIN_STAMP,
      enabled: true,
      onImpact,
      // A fixed frame is read back as the angle it points, so the panel shows
      // degrees (frame × 11.25) rather than a raw index.
      fixedAngle: stampAngleForFrame(num(t.frame) ?? 0),
      soften: num(buried?.soften) ?? DEFAULT_TERRAIN_STAMP.soften,
      blend: str(buried?.blend) === 'dither' ? 'dither' : 'mix',
      trueColour: t.true_colour === true || isTable(t.true_colour),
      wormClearance,
      sheet: asset
        ? {
            file: asset.file,
            fileName: stampSprite.split('/').pop(),
            previewUrl: asset.preview,
            frames,
            fps: numFrom(decl?.fps) ?? 15,
            play: 'loop',
            rotationFrames: frames,
          }
        : undefined,
    };
    notes.push('terrain stamp');
  }

  // ---- impact damage (PX's javelin) ---------------------------------------
  // `local STAMP_HIT = { … }` plus `if stamp_hit(ev) then return end`. A bundle
  // that only pierces has the table and no `wa.land.stamp` call at all, so the
  // two features are read apart: the stamp's `enabled` stays tied to a real
  // stamp call, and the impact table fills in whether or not there is one.
  const hitTable = isTable(scan.assignments['STAMP_HIT'])
    ? scan.assignments['STAMP_HIT']
    : undefined;
  const pierces = !!hitTable && moduleText.includes('stamp_hit(ev)');
  if (pierces) {
    const base = project.terrainStamp ?? DEFAULT_TERRAIN_STAMP;
    const kind = str(hitTable!.kind);
    project.terrainStamp = {
      ...base,
      // The pierce rides the card's Enable Stamp now (`usesImpactDamage`), so a
      // bundle that only pierces, with no picture, comes back with the card on:
      // without it the re-export would drop the damage the bundle had.
      enabled: true,
      impact: {
        enabled: true,
        damage: num(hitTable!.damage) ?? DEFAULT_TERRAIN_STAMP.impact.damage,
        radius: num(hitTable!.radius) ?? DEFAULT_TERRAIN_STAMP.impact.radius,
        impulse: num(hitTable!.impulse) ?? DEFAULT_TERRAIN_STAMP.impact.impulse,
        // An unknown name would be rejected by `object:hit` (`hit_kind_arg`), so
        // a bundle naming one keeps the javelin's bullet instead of a broken hit.
        kind: STAMP_HIT_KINDS.some((option) => option.id === kind)
          ? (kind as TerrainStampImpactConfig['kind'])
          : 'bullet',
        spareShooter: bool(hitTable!.spare_shooter) ?? true,
      },
    };
    notes.push('impact damage');
  } else {
    // `impact.enabled` defaults to true, but a bundle without `STAMP_HIT` did
    // not pierce: leaving the default in place would make the panel promise a
    // pierce the weapon never had, and the next export would add one.
    project.terrainStamp = {
      ...(project.terrainStamp ?? DEFAULT_TERRAIN_STAMP),
      impact: {
        ...(project.terrainStamp?.impact ?? DEFAULT_TERRAIN_STAMP.impact),
        enabled: false,
      },
    };
  }

  // ---- the bundle's own on_explode ----------------------------------------
  // M5: a carried hook, not the author's snippet. The two used to share
  // `customLuaSnippet`, so an import silently filled the box the user types in
  // and a hook could not be told apart from a snippet. The literal is kept, not
  // just the body, so the generator can inline it between its own `before` and
  // `after` parts and a re-import finds the same text again.
  const carriedHooks: { key: string; text: string; line: number }[] = [];
  const custom = customExplodeBody(
    moduleText,
    !!generatedStamp || pierces,
    // The card writes the WAV into the claim's `sounds` list, so the list is what
    // says the play line is ours.
    // `scanLua` reads a list into a `1`-keyed table, so both shapes count.
    Object.values((source?.sounds ?? {}) as Record<string, unknown>).some(
      (path) => typeof path === 'string' && /explosion\.wav$/.test(path),
    ),
    // The burst is ours when the claim's our-features list has one: the export
    // writes `fx.burst{` / `blast.explode{` only from the card.
    /(?:fx\.burst|blast\.explode)\s*\{/.test(moduleText),
  );
  if (custom) {
    carriedHooks.push({
      key: 'on_explode',
      text: `function(ev)\n${custom
        .split('\n')
        .map((line) => (line ? `  ${line}` : ''))
        .join('\n')}\nend`,
      line: 0,
    });
    notes.push('custom on_explode');
  }

  // ---- manifest dependencies and icon -------------------------------------
  // `px.electric` is automatic for an electric blast: the generator emits
  // `zap = require("wf-lib/electric/damage")` and declares the bundle itself.
  const automatic = new Set([
    'wf.sdk',
    'wfws.sdk',
    'effects.sdk',
    'px.fire_seq',
    'px.electric',
  ]);
  const extras = (weapon.dependencies ?? []).filter((dep) => dep && !automatic.has(dep));
  if (extras.length > 0) {
    project.extraDependencies = extras;
    notes.push(`dependencies: ${extras.join(', ')}`);
  }

  // `hold_as` lends a stock weapon's held pose. The generator derives the same
  // value for its own output, so a re-export writes it back either way.
  const holdAs = str(source?.hold_as);
  if (holdAs) project.holdAs = holdAs;

  const iconPath = str(weapon.icon);
  if (iconPath) {
    const loaded = await readAsset(files, bundleDir, iconPath);
    if (loaded) {
      project.customIconFile = loaded.file;
      project.customIconPreview = loaded.preview;
    } else if (!iconPath.includes('/')) {
      // A stock icon name, not a bundle path.
      project.panel_icon = iconPath;
    }
  }

  return { project, notes, carriedHooks };
}

/**
 * Claim keys that hold a value the reader cannot read as a literal (a function,
 * an expression) and that nothing in the import accounts for, so the summary can
 * say what it could not carry instead of silently dropping it.
 *
 * `absorbed` is how a caller says "this key is handled after all": the
 * sequential-fire reader passes `on_fire` once it has reconstructed the burst
 * that lives inside it, so the editor's own weapons stay quiet while a bundle
 * with a hand-written `on_fire` (the Conductor's whole weapon) is reported.
 * `on_explode` is carried unconditionally: `customExplodeBody` keeps the part of
 * the body that is not ours.
 */
export function unmodelledClaimKeys(
  source: LuaTable | undefined,
  absorbed: readonly string[] = [],
): string[] {
  if (!source) return [];
  const handled = new Set<string>([...CLAIM_KEYS_MODELLED, ...CLAIM_KEYS_CARRIED, ...absorbed]);
  return Object.entries(source)
    .filter(([key, value]) => !handled.has(key) && value === null)
    .map(([key]) => key);
}
