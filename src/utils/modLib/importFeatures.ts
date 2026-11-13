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
  WeaponProject,
} from '../../types/weapon';
import { DEFAULT_ROLE_ART } from '../../data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT, EXPLOSION_PRESETS } from '../../data/explosionPresets';
import { DEFAULT_FIRE_SEQUENCE } from '../../data/fireSequence';
import { DEFAULT_CUSTOM_SOUNDS } from '../../data/soundPresets';
import {
  firstTable,
  isTable,
  readCallTable,
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
}

const num = (value: LuaValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const numFrom = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: LuaValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const bool = (value: LuaValue | undefined): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

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
async function readAsset(
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
  if (!entry) return undefined;
  const bytes = await bytesOf(entry);
  if (!bytes) return undefined;
  const extension = base.split('.').pop()?.toLowerCase() ?? '';
  const type = MIME[extension] ?? 'application/octet-stream';
  const file = new File([bytes as BlobPart], base, { type });
  const size = imageSize(bytes);
  return { file, preview: objectUrl(file), bytes, width: size?.width, height: size?.height };
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
    frames: num(table.cyclical) ?? base.frames,
    fps: numFrom(decl?.fps) ?? base.fps,
    animSpeed: num(table.anim_speed) ?? base.animSpeed,
    spinRate: num(table.spin) ?? base.spinRate,
    scale: num(table.scale) ?? base.scale,
    mirror: bool(table.mirror) ?? base.mirror,
    z: num(table.z) ?? base.z,
  };
}

/** `hold` table -> the hold panel. */
function readHold(table: LuaTable, fallback: HoldConfig): HoldConfig {
  const handType =
    table.hand_type === 1
      ? 'lower'
      : table.hand_type === 3
        ? 'upper'
        : table.hand_type === 2
          ? 'mid'
          : fallback.handType;
  const frames = Math.max(1, Math.round(num(table.frames) ?? 1));
  // `anim_speed` is the engine's multiplier: it plays `1.5 × frames × speed`
  // frames per second (worm_hold.rs), which is the FPS the panel asks for.
  const animSpeed = num(table.anim_speed) ?? 1;
  const rotation = num(table.weap_rotation);
  return {
    ...fallback,
    enabled: true,
    sheet: str(table.sheet) ?? fallback.sheet,
    handType,
    handRadius: num(table.hand_radius) ?? fallback.handRadius,
    // The record stores PX's rotation unit (`1 + degrees/180`).
    weapRotation:
      rotation !== undefined
        ? Math.round(((rotation - 1) * 180 + Number.EPSILON) * 1000) / 1000
        : fallback.weapRotation,
    weapRadius: num(table.weap_radius) ?? fallback.weapRadius,
    scale: num(table.weap_scale) ?? fallback.scale,
    handScale: num(table.hand_scale) ?? fallback.handScale,
    frames,
    fps: frames > 1 ? Math.max(1, Math.round(animSpeed * 1.5 * frames)) : fallback.fps,
    drawHand: bool(table.draw_hand) ?? true,
    keepWhileFiring: bool(table.keep_while_firing) ?? false,
    thrown: bool(table.thrown) ?? false,
    putAway: bool(table.put_away) ?? false,
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
  };
  return { ...next, preset: presetFor(next) };
}

/** The custom part of `on_explode`, with the features' own calls removed. */
function customExplodeBody(moduleText: string): string {
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
  // Same bounded block scan `parseCustomLua` uses: every opener needs one `end`.
  const token = /\b(function|if|for|while|end)\b/g;
  let depth = 1;
  let end = -1;
  let iterations = 0;
  let found: RegExpExecArray | null;
  while ((found = token.exec(rest)) !== null && iterations < 5000) {
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
  const body = rest.slice(0, end === -1 ? rest.length : end);

  const kept: string[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    // The generated burst/blast blocks and the custom-WAV play line are the
    // features' own emission; they are rebuilt from the panels on export.
    if (trimmed.startsWith('fx.burst{') || trimmed.startsWith('blast.explode{')) {
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
    if (/^if\s+ev\.worm\s+then\s+wa\.sound\.play\(/.test(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
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

  // ---- hold ---------------------------------------------------------------
  const sourceHold = source?.hold;
  const holdTable = isTable(sourceHold) ? sourceHold : firstTable(scan, 'hold');
  if (
    holdTable &&
    (str(holdTable.sheet) !== undefined ||
      num(holdTable.weap_radius) !== undefined ||
      num(holdTable.hand_radius) !== undefined)
  ) {
    const sheetPath = str(holdTable.sheet);
    const asset = await readAsset(files, bundleDir, sheetPath);
    project.hold = {
      ...readHold(holdTable, args.holdBase ?? DEFAULT_IMPORT_HOLD),
      sheetFile: asset?.file,
      sheetPreview: asset?.preview,
      sheetWidth: asset?.width,
      sheetHeight: asset?.height,
    };
    notes.push('hold art');
  }

  // ---- sprite builder -----------------------------------------------------
  const flight = readCallTable(moduleText, 'sb.flight');
  if (flight) {
    const f = flight.table;
    const sheetPath = str(f.sheet);
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
      fps: numFrom(decl?.fps) ?? missileBase.fps,
      animSpeed: num(f.anim_speed) ?? 1,
      spinRate: num(f.spin) ?? 1,
      scale: num(f.scale) ?? 1,
      mirror: bool(f.mirror) ?? true,
      z: num(f.z) ?? 5,
      hideStock: true,
      size: num(f.size) ?? 1,
      angle: num(f.angle) ?? 0,
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
    // Digging is a probe, not a state: `dig = true` means the builder owns the
    // animation and the record's four dig indexes were zeroed. Without it the
    // original left WA's dig art alone.
    if (f.dig === true) {
      behaviorArt.dig = { ...DEFAULT_ROLE_ART, mode: 'builder' };
    } else if (args.digging) {
      behaviorArt.dig = { ...DEFAULT_ROLE_ART, mode: 'native' };
    }
    project.behaviorArt = behaviorArt;
    if (isTable(f.states)) {
      notes.push('legacy state art not imported');
    }
    notes.push('sprite builder');
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
      color: hexColor(rgb.r, rgb.g, rgb.b),
      // `target = "main"` is the only variant that emits the live-id guard.
      target: moduleText.includes('trail_live') ? 'main' : 'all',
    } satisfies RibbonTrailConfig;
    notes.push('ribbon trail');
  }

  // ---- explosion burst ----------------------------------------------------
  const blastCall = readCallTable(moduleText, 'blast.explode');
  const burstCall = readCallTable(moduleText, 'fx.burst');
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
        sound:
          b.sound === true ? 'default' : (num(b.sound) ?? 'none'),
      };
      const inner = isTable(b.effect) ? b.effect : undefined;
      if (inner) effect = readBurstRows(inner, effect);
    } else {
      effect = readBurstRows(burstCall!.table, effect);
    }
    project.explosionEffect = {
      ...effect,
      enabled: true,
      mode: isBlast ? 'blast' : 'effect',
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
      if (!match) return axis === 'y' ? -3 : 0;
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
      repeatFirePose: isTable(source?.fires),
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
  if (shotSound) soundPaths.add(shotSound.path);

  if (soundPaths.size > 0) {
    const sounds: CustomSoundsConfig = {
      ...soundBase,
      ...(project.customSounds ?? {}),
    } as CustomSoundsConfig;
    for (const path of soundPaths) {
      const base = path.split('/').pop()?.toLowerCase() ?? '';
      const role =
        base.includes('explosion')
          ? 'explosion'
          : base.includes('shot')
            ? 'shot'
            : base.includes('interval')
              ? 'interval'
              : moduleText.includes(`wa.sound.play(ev.worm, "${path}"`) ||
                  moduleText.includes(`wa.sound.play(ev.worm, '${path}'`)
                ? 'explosion'
                : moduleText.includes(`path = "${path}"`)
                  ? 'interval'
                  : undefined;
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
      if (role === 'explosion') {
        sounds.explosionEnabled = true;
        sounds.explosion = sound;
        const priority = /wa\.sound\.play\(ev\.worm,\s*["'][^"']+["']\s*,\s*(\d+)\)/.exec(
          moduleText,
        );
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
  const sourceSprites = source?.sprites;
  const claimSprites = isTable(sourceSprites) ? sourceSprites : undefined;
  if (claimSprites) {
    for (const value of Object.values(claimSprites)) {
      if (typeof value !== 'string') continue;
      // Our own exports name the files by role (`trail.png`, `bit.png`,
      // `bit_homing.png`, `bit_trail.png`, `body.png`), so match the stem
      // exactly: `bit_flight.png` is the builder's bit sheet, not cluster art.
      const base = value.split('/').pop()?.toLowerCase() ?? '';
      const stem = base.replace(/\.[^.]+$/, '');
      const slot: PackArtSlot | undefined =
        stem === 'trail'
          ? 'missile_trail'
          : stem === 'bit'
            ? 'cluster_sprite'
            : stem === 'bit_homing'
              ? 'cluster_homing_sprite'
              : stem === 'bit_trail'
                ? 'cluster_trail'
                : stem === 'body'
                  ? 'strike_sprite'
                  : undefined;
      if (slot) setPackPath(slot, value);
    }
  }
  const sourceCluster = source?.cluster;
  const claimCluster = isTable(sourceCluster) ? sourceCluster : undefined;
  setPackPath('cluster_sprite', str(claimCluster?.sprite));
  setPackPath('cluster_homing_sprite', str(claimCluster?.homing_sprite));
  setPackPath('strike_sprite', str(source?.sprite));

  const packArt: Partial<Record<PackArtSlot, PackArtAsset>> = {};
  for (const [slot, path] of Object.entries(packPaths) as [PackArtSlot, string][]) {
    const loaded = await readAsset(files, bundleDir, path);
    if (!loaded) continue;
    const decl = spriteDecl(weapon, path);
    packArt[slot] = {
      file: loaded.file,
      fileName: path.split('/').pop(),
      previewUrl: loaded.preview,
      frames: numFrom(decl?.frames) ?? 1,
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
        (loaded?.width && loaded.height
          ? Math.max(1, Math.round(loaded.height / loaded.width))
          : 1);
      return {
        file: loaded?.file,
        fileName: path.split('/').pop(),
        preview: loaded?.preview,
        frames,
      };
    };
    const first = await readSheet(sheep['1'] ?? sheep[1]);
    const second = await readSheet(sheep['2'] ?? sheep[2]);
    if (first && second) {
      project.roamSheets = { flight1: first, flight2: second };
      notes.push('roam sheets');
    }
  }

  // ---- custom on_explode body --------------------------------------------
  const custom = customExplodeBody(moduleText);
  if (custom) {
    project.enableCustomLua = true;
    project.customLuaSnippet = `on_explode = { on = function(ev)\n${custom
      .split('\n')
      .map((line) => (line ? `  ${line}` : ''))
      .join('\n')}\nend }`;
    notes.push('custom on_explode');
  }

  // ---- manifest dependencies and icon -------------------------------------
  const automatic = new Set(['wf.sdk', 'wfws.sdk', 'effects.sdk', 'px.fire_seq']);
  const extras = (weapon.dependencies ?? []).filter((dep) => dep && !automatic.has(dep));
  if (extras.length > 0) {
    project.extraDependencies = extras;
    notes.push(`dependencies: ${extras.join(', ')}`);
  }

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

  return { project, notes };
}

/**
 * Claim keys that hold a function and that the reader does not model, so the
 * import can say what it could not carry instead of silently dropping it.
 */
export function unmodelledClaimKeys(source: LuaTable | undefined): string[] {
  if (!source) return [];
  const handled = new Set([
    'name',
    'copy_from',
    'wep',
    'panel_icon',
    'sprites',
    'sounds',
    'params',
    'cluster',
    'sprite',
    'sheep_sprites',
    'worm_sprites',
    'hold',
    'fires',
    'on_fire',
    'on_explode',
  ]);
  return Object.entries(source)
    .filter(([key, value]) => !handled.has(key) && value === null)
    .map(([key]) => key);
}
