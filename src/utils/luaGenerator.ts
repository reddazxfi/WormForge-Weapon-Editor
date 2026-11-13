import {
  BodyConfig,
  BehaviorArtKey,
  ClustletConfig,
  DigActionConfig,
  FlightRoleArt,
  HoldConfig,
  PackArtSlot,
  RoamActionConfig,
  WeaponProject,
} from '../types/weapon';
import { getStockPanelPosition } from '../data/stockWeapons';
import { stockDonorBaseline } from '../data/stockDonors';
import { resolveStockSprite } from '../data/stockSprites';
import { supportsFireSequence } from '../data/fireSequence';
import { COLLISION_FLAGS } from '../data/recordSchema';
import { defaultArtFor } from './defaultArt';
import {
  bitActionOf,
  bitBuilderMode,
  primaryBuilderOn,
  resolveBehaviorStates,
  usesWfwsBuilder,
} from '../data/spriteBuilder';

/**
 * One `dig.*` sprite row.
 *
 * The builder owns the dig art once its probes say the round is in the land, so
 * the record's indexes are zeroed: any id left there (WA's mole 158-161, PX's
 * wsvr/wsvru/wsvrd/wsvb 245-248) would be drawn under our sheet.
 *
 * A `native` dig role hands the art back to WA, and then a zero is not an
 * answer -- it would erase the donor's own mole frames. Native only writes an
 * id the author actually set.
 */
function digSpriteRow(
  value: number | undefined,
  zeroed: boolean,
  native: boolean
): number | undefined {
  if (zeroed) return 0;
  if (native) return value !== undefined && value > 0 ? value : undefined;
  return value;
}

export function sanitizeModFolder(id: string): string {
  const parts = id.trim().split('.');
  const last = parts[parts.length - 1] || 'custom_weapon';
  return last.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'custom_weapon';
}

function luaQuote(str: string): string {
  return JSON.stringify(str);
}

/**
 * A plain object as Lua table rows. Used for `recordExtra`: the tables a bundle
 * declared, written back with the engine's own key names. `null` means the
 * reader could not follow a value, so the key is left out rather than written
 * as `nil` (which would be a no-op inside a table constructor anyway).
 */
function luaTableRows(value: unknown, indent: string): string[] {
  const rows: string[] = [];
  if (!value || typeof value !== 'object') return rows;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || entry === undefined) continue;
    const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaQuote(key)}]`;
    if (Array.isArray(entry)) {
      rows.push(`${indent}${name} = { ${entry.map((item) => luaValue(item)).join(', ')} },`);
    } else if (typeof entry === 'object') {
      rows.push(`${indent}${name} = {`);
      rows.push(...luaTableRows(entry, `${indent}  `));
      rows.push(`${indent}},`);
    } else {
      rows.push(`${indent}${name} = ${luaValue(entry)},`);
    }
  }
  return rows;
}

/**
 * `{ missile: { sprite: 51 } }` -> `rec.missile.sprite = 51`, with a guard for
 * every parent table so a group the generated record did not create still
 * exists. Arrays and scalars are written inline.
 */
function recordAssignments(extra: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const ensured = new Set<string>();

  const ensure = (path: string[]) => {
    for (let i = 1; i <= path.length; i += 1) {
      const prefix = path.slice(0, i).join('.');
      if (ensured.has(prefix)) continue;
      ensured.add(prefix);
      lines.push(`    rec.${prefix} = rec.${prefix} or {}`);
    }
  };

  const walk = (value: Record<string, unknown>, path: string[]) => {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaQuote(key)}]`;
      const next = [...path, name];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        walk(entry as Record<string, unknown>, next);
        continue;
      }
      ensure(path);
      lines.push(`    rec.${next.join('.')} = ${luaValue(entry)}`);
    }
  };

  walk(extra, []);
  return lines;
}

function luaValue(value: unknown): string {
  if (typeof value === 'string') return luaQuote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return formatNumber(value);
  return 'nil';
}

const WORM_GROUP_KEYS = [
  'worms_normal',
  'worms_acting',
  'worms_jumping',
  'worms_roping',
  'worms_frozen',
  'worms_frozen_moving',
] as const;

/** The groups the `worms` shortcut stands for (bit 60 = normal|acting|jumping|roping). */
const WORM_SHORTCUT_KEYS = WORM_GROUP_KEYS.filter(
  (key) => (COLLISION_FLAGS.worms & COLLISION_FLAGS[key]) !== 0
);

/** A named collision-target table (`ends_on_contact`, `bounce.hits`, ...).
 *  Only `true` entries are written; `extra_bits` preserves imported bits the
 *  editor does not name. Returns null when the mask selects nothing, which is
 *  the engine's `{}` (clear every inherited target) rather than "inherit". */
function luaMaskTable(mask: Record<string, unknown> | undefined): string | null {
  if (!mask) return null;
  // Only the shortcut's own groups overlap it; the frozen groups are separate
  // bits and may sit next to `worms`.
  const hasIndividualWorms = WORM_SHORTCUT_KEYS.some((key) => mask[key] === true);
  const parts: string[] = [];
  const written = new Set<string>();
  const write = (key: string) => {
    if (written.has(key)) return;
    written.add(key);
    parts.push(`${key} = true`);
  };
  for (const [key, value] of Object.entries(mask)) {
    if (key === 'extra_bits' || value !== true) continue;
    if (key === 'worms') {
      // The engine rejects `worms` together with any individual worm group.
      // Expand the shortcut instead of dropping it so the mask keeps meaning.
      if (hasIndividualWorms) WORM_SHORTCUT_KEYS.forEach(write);
      else write('worms');
      continue;
    }
    write(key);
  }
  const extra = Number((mask as { extra_bits?: unknown }).extra_bits);
  if (Number.isFinite(extra) && extra !== 0) parts.push(`extra_bits = ${extra}`);
  return `{ ${parts.join(', ')} }`;
}

function formatNumber(value: number, digits = 4): string {
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

/** `#rrggbb` (or `rrggbb`) to the 0-255 components the trail module takes. */
function hexToRgb(color: string): { r: number; g: number; b: number } {
  const hex = (color || '').replace('#', '').trim();
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// Where the hold sheet lives in the exported pack. The Lua and mod.toml must
// agree with each other and with modExporter, which writes an uploaded sheet to
// sprites/<mod folder>/hold.png. A path stored earlier (project.hold.sheet) can
// be stale: it was built from the id the weapon had when the PNG was uploaded,
// so a renamed weapon kept pointing at sprites/moon_grenade/hold.png.
export function holdSheetPath(project: WeaponProject): string {
  const own = `sprites/${sanitizeModFolder(project.id)}/`;
  if (project.hold?.sheetFile) return `${own}hold.png`;
  const sheet = project.hold?.sheet;
  return sheet && sheet.startsWith(own) ? sheet : `${own}hold.png`;
}

/**
 * The firing-state sprite (`hold.flash.sheet`): a still drawn over the worm
 * while WA is in its firing states, at the gun's muzzle. The engine loads it
 * like the hold sheet, so it has no record slot and no `mod.toml` declaration —
 * the file only has to exist at the declared path.
 */
export function flashSheetPath(project: WeaponProject): string {
  return `sprites/${sanitizeModFolder(project.id)}/flash.png`;
}

/**
 * Resolves engine-space `hold.flash` parameters (`out`, `side`, `scale`) so
 * the firing sprite follows the normal weapon's `weapRadius`, `weapRotation`,
 * and `scale` (`weap_scale`) consistently in both preview and Lua export.
 */
export function resolvedHoldFlash(hold: HoldConfig): {
  out: number;
  side: number;
  scale: number;
} {
  const weapRadius = Number(hold.weapRadius ?? 6);
  const weapScale = Number(hold.scale) || 1;
  const weapRotRad = ((Number(hold.weapRotation) || 0) * Math.PI) / 180;
  const localOut = Number(hold.flashOut ?? 0) * weapScale;
  const localSide = Number(hold.flashSide ?? 0) * weapScale;
  const cos = Math.cos(weapRotRad);
  const sin = Math.sin(weapRotRad);
  return {
    out: -weapRadius + localOut * cos + localSide * sin,
    side: -localOut * sin + localSide * cos,
    scale: (Number(hold.flashScale ?? 1) || 1) * weapScale,
  };
}

/** Every record slot that accepts pack art during installation. */
export const PACK_ART_SLOTS: PackArtSlot[] = [
  'strike_sprite',
  'missile_trail',
  'cluster_sprite',
  'cluster_homing_sprite',
  'cluster_trail',
];

/** Bundle filenames for the pack art. They are fixed per slot so the file name
 *  cannot collide with hold.png / missile.png / icon.png in the same folder. */
const PACK_ART_STEM: Record<PackArtSlot, string> = {
  missile_trail: 'trail',
  cluster_sprite: 'bit',
  cluster_homing_sprite: 'bit_homing',
  cluster_trail: 'bit_trail',
  strike_sprite: 'body',
};

/** Whether an uploaded sheet for this slot reaches the record at all. The
 *  engine writes a strike's cluster render timer with `set_cluster_render_timer`
 *  (entry+0x170) and no strike shift; the shifted slot is 0x184, so
 *  `cluster.homing_sprite` would land on another field of a fire type 3 record.
 *  A strike's munition homing art follows the claim `sprite` (0xC0) instead. */
export function packArtSlotApplies(project: WeaponProject, slot: PackArtSlot): boolean {
  if (slot === 'cluster_homing_sprite') {
    return !(project.fireType === 'cursor' && !project.teleport);
  }
  return true;
}

/** Where an uploaded pack-art sheet is written in the exported bundle, or null
 *  when that slot has no upload. Worked out from the current weapon id on every
 *  export, so a rename cannot leave a stale `sprites/<old id>/...` path. */
export function packArtPath(project: WeaponProject, slot: PackArtSlot): string | null {
  const asset = project.packArt?.[slot];
  // The generator, mod.toml and the exporter must agree: no file, no path, so a
  // declaration can never point at an image the archive does not contain.
  if (!asset?.file || !packArtSlotApplies(project, slot)) return null;
  const fileName = asset.file.name || asset.fileName || '';
  if (!fileName) return null;
  // The engine slices by file type: PNG strips are sliced by `frames`, GIFs
  // carry their own timing, so keep the real extension.
  const extension = fileName.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
  return `sprites/${sanitizeModFolder(project.id)}/${PACK_ART_STEM[slot]}.${extension}`;
}

/** Bundle path of the primary WFWS flight sheet. */
export function missileFlightSheetPath(project: WeaponProject): string {
  return `sprites/${sanitizeModFolder(project.id)}/missile.png`;
}

/** Bundle path of the cluster-bit WFWS flight sheet. */
export function bitFlightSheetPath(project: WeaponProject): string {
  return `sprites/${sanitizeModFolder(project.id)}/bit_flight.png`;
}

/** Bundle path of one of a roaming animal's two flying sheets. */
export function roamSheetPath(project: WeaponProject, which: 'flight1' | 'flight2'): string {
  return `sprites/${sanitizeModFolder(project.id)}/sheep_${which}.png`;
}

/**
 * The two paths `sheep_sprites` needs, or null. The engine takes exactly two
 * sheets (they are written to the record's `sheep.flight_1` / `sheep.flight_2`
 * and alternated while the animal is steered), so one upload alone emits none.
 */
export function roamSheetPaths(
  project: WeaponProject
): { first: string; second: string } | null {
  const first = project.roamSheets?.flight1?.file;
  const second = project.roamSheets?.flight2?.file;
  if (!first || !second) return null;
  return { first: roamSheetPath(project, 'flight1'), second: roamSheetPath(project, 'flight2') };
}

/**
 * True when the uploaded roaming sheets are what WA draws in the flying state.
 * A builder sheet (`sb.flight`) replaces that state outright: the generator
 * zeroes `sheep.flight_1` / `sheep.flight_2`, so the two WA sheets are neither
 * installed nor referenced and the uploads stay dormant while it is on.
 */
export function roamSheetsOwnFlight(project: WeaponProject): boolean {
  if (primaryBuilderOn(project) && project.action === 'roam') return false;
  return !!roamSheetPaths(project);
}

/** Bundle path of one behaviour-state sheet. */
export function behaviorStateSheetPath(
  project: WeaponProject,
  key: BehaviorArtKey,
): string {
  return `sprites/${sanitizeModFolder(project.id)}/state_${key}.png`;
}

/** `arm` / `time` in ms for `sb.flight`'s homing art, from the record's own
 *  homing numbers (the primary and the cluster bit use the same field names). */
function homingWindowRow(
  cfg: { homing_arm_ms?: number; homing_time_ms?: number },
  indent: string
): string {
  // Same fallbacks as the record emission below (`?? 1000` / `?? 8000`), so the
  // builder's window and the record's own numbers can never disagree. A stored 0
  // is kept: `arm = 0` is valid (WA's Cheap Shot homes from launch).
  const arm = Math.max(0, Math.round(cfg.homing_arm_ms ?? 1000));
  const time = Math.max(0, Math.round(cfg.homing_time_ms ?? 8000));
  return `${indent}arm = ${arm}, time = ${time},`;
}

/** The `sb.flight` keys shared by the primary, bit and state roles. */
function roleArtRows(cfg: FlightRoleArt, indent: string): string[] {
  const rows = [`${indent}anim = ${luaQuote(cfg.anim || 'rotation')},`];
  if (cfg.frames > 1) rows.push(`${indent}cyclical = ${cfg.frames},`);
  if (cfg.animSpeed && cfg.animSpeed !== 1) {
    rows.push(`${indent}anim_speed = ${formatNumber(cfg.animSpeed)},`);
  }
  if (cfg.spinRate && cfg.spinRate !== 1) {
    rows.push(`${indent}spin = ${formatNumber(cfg.spinRate)},`);
  }
  if (cfg.scale && cfg.scale !== 1) {
    rows.push(`${indent}scale = ${formatNumber(cfg.scale)},`);
  }
  if (cfg.mirror === false) rows.push(`${indent}mirror = false,`);
  if (cfg.z !== undefined && cfg.z !== 5) {
    rows.push(`${indent}z = ${formatNumber(cfg.z)},`);
  }
  return rows;
}

/** Optional animation/transform overrides applied only while `dig` probes are inside terrain. */
export function digArtOverrideRows(cfg: FlightRoleArt | undefined, indent: string): string[] {
  if (!cfg) return [];
  const rows: string[] = [];
  if (cfg.anim && cfg.anim !== 'track') {
    rows.push(`${indent}anim = ${luaQuote(cfg.anim)},`);
  }
  if (cfg.frames > 1) rows.push(`${indent}cyclical = ${cfg.frames},`);
  if (cfg.animSpeed && cfg.animSpeed !== 1) {
    rows.push(`${indent}anim_speed = ${formatNumber(cfg.animSpeed)},`);
  }
  if (cfg.spinRate && cfg.spinRate !== 1) {
    rows.push(`${indent}spin = ${formatNumber(cfg.spinRate)},`);
  }
  if (cfg.scale && cfg.scale !== 1) {
    rows.push(`${indent}scale = ${formatNumber(cfg.scale)},`);
  }
  if (cfg.mirror === false) rows.push(`${indent}mirror = false,`);
  if (cfg.z !== undefined && cfg.z !== 5) {
    rows.push(`${indent}z = ${formatNumber(cfg.z)},`);
  }
  return rows;
}

/** `require("wf-lib/wfws_sprite_builder")`, the bundle this editor ships. */
export const WFWS_BUILDER_MODULE = 'wf-lib/wfws_sprite_builder';

/**
 * Which WFWS art roles the builder owns: one source for the generator, the
 * exporter and `mod.toml`, so the three cannot disagree about a sheet.
 *
 * - `homing` / `bitHoming`: timed art. WA arms the missile `arm` ms after it is
 *   fired and steers it for `time` ms, so the builder swaps to the homing sheet
 *   in that window. The record's own homing sprite is zeroed while the builder
 *   owns it (0xAC / 0x170 are safe to zero; they are art only).
 * - `zeroMainDig` / `zeroBitDig`: digging names no art. The four dig sprite
 *   indexes are zeroed and the builder probes the terrain and cycles the flight
 *   sheet; `native` on the dig role leaves them alone.
 * - Roaming art is not here: WA draws the walking, two flying and gas poses from
 *   separate record fields, so it goes through `sheep_sprites` and the record.
 */
export function wfwsRoleFlags(project: WeaponProject) {
  const builderOn = primaryBuilderOn(project);
  const bitMode = bitBuilderMode(project);
  const clusters = project.burst === 'clusters';
  const bitAction = bitActionOf(project);
  const mode = (key: BehaviorArtKey) => project.behaviorArt?.[key]?.mode;
  const digUsesBuilder = (mode('dig') ?? 'builder') !== 'native';
  return {
    builderOn,
    bitMode,
    clusters,
    bitAction,
    digUsesBuilder,
    homing: builderOn && project.action === 'homing' && mode('homing') === 'builder',
    bitHoming:
      builderOn &&
      bitMode !== null &&
      clusters &&
      bitAction === 'homing' &&
      mode('homing_bit') === 'builder',
    zeroMainDig: builderOn && digUsesBuilder && project.action === 'dig',
    zeroBitDig:
      builderOn && digUsesBuilder && bitMode !== null && clusters && bitAction === 'dig',
  };
}

/**
 * Safe, high-performance O(N) parser to extract `on_explode` from custom Lua snippets.
 * Guaranteed never to stall or hang the main thread (zero ReDoS, bounded iterations).
 */
export interface ParsedCustomLua {
  paramName: string;
  onExplodeBody: string;
  remainingSnippet: string;
  hasOnExplode: boolean;
}

export function parseCustomLua(snippet: string): ParsedCustomLua {
  if (!snippet || !snippet.trim() || snippet.length > 200_000) {
    return { paramName: 'ev', onExplodeBody: '', remainingSnippet: snippet || '', hasOnExplode: false };
  }

  // Fast check before doing regex
  if (snippet.indexOf('on_explode') === -1) {
    return { paramName: 'ev', onExplodeBody: '', remainingSnippet: snippet, hasOnExplode: false };
  }

  // Locate on_explode =
  const declMatch = snippet.match(/(?:^|\n)[ \t]*on_explode\s*=/);
  if (!declMatch || declMatch.index === undefined) {
    return { paramName: 'ev', onExplodeBody: '', remainingSnippet: snippet, hasOnExplode: false };
  }

  const matchStart = declMatch.index + (declMatch[0].startsWith('\n') ? 1 : 0);
  const afterEquals = matchStart + declMatch[0].length - (declMatch[0].startsWith('\n') ? 1 : 0);
  const rest = snippet.slice(afterEquals);

  // Look for either function(param) or { ... on = function(param)
  const fnMatch = rest.match(/^[ \t]*(?:\{[ \t\r\n]*(?:[a-zA-Z0-9_]+[ \t]*=[ \t]*[^,]+,[ \t\r\n]*)*\bon[ \t]*=[ \t]*)?function[ \t]*\([ \t]*([a-zA-Z0-9_]*)[ \t]*\)/);
  if (!fnMatch) {
    return { paramName: 'ev', onExplodeBody: '', remainingSnippet: snippet, hasOnExplode: true };
  }

  const isTable = rest.trimStart().startsWith('{');
  const paramName = fnMatch[1] || 'ev';
  const fnBodyStart = afterEquals + fnMatch[0].length;

  // Scan forward for matching `end` using linear token search with max 5000 iterations
  const searchSlice = snippet.slice(fnBodyStart);
  const tokenRegex = /\b(function|if|for|while|end)\b/g;
  let depth = 1;
  let fnBodyEnd = -1;
  let iterations = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(searchSlice)) !== null && iterations < 5000) {
    iterations += 1;
    if (m[1] === 'end') {
      depth -= 1;
      if (depth === 0) {
        fnBodyEnd = fnBodyStart + m.index;
        break;
      }
    } else {
      depth += 1;
    }
  }

  if (fnBodyEnd === -1) {
    fnBodyEnd = snippet.length;
  }

  const onExplodeBody = snippet.slice(fnBodyStart, fnBodyEnd).trim();

  // Find the end of the entire on_explode statement
  let stmtEnd = fnBodyEnd + 3; // past 'end'
  const afterEnd = snippet.slice(stmtEnd);

  if (isTable) {
    const braceIdx = afterEnd.indexOf('}');
    if (braceIdx !== -1 && braceIdx < 100) {
      stmtEnd += braceIdx + 1;
    }
  }

  // Skip trailing whitespace or comma
  while (stmtEnd < snippet.length && /[ \t\r\n,]/.test(snippet[stmtEnd])) {
    const ch = snippet[stmtEnd];
    stmtEnd += 1;
    if (ch === ',') break;
  }

  const before = snippet.slice(0, matchStart).trim();
  const after = snippet.slice(stmtEnd).trim();
  const remainingSnippet = [before, after].filter(Boolean).join('\n');

  return {
    paramName,
    onExplodeBody,
    remainingSnippet,
    hasOnExplode: true,
  };
}

export function reindentCode(code: string, targetIndent: string): string[] {
  const lines = code.split('\n');
  if (lines.length === 0) return [];
  if (lines.length === 1) return [`${targetIndent}${lines[0].trim()}`];

  let subIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]*/);
    const len = match ? match[0].length : 0;
    if (len < subIndent) subIndent = len;
  }

  if (!lines[0].startsWith(' ') && subIndent !== Infinity && subIndent > 0) {
    return lines.map((line, idx) => {
      if (!line.trim()) return '';
      if (idx === 0) return `${targetIndent}${line.trim()}`;
      return `${targetIndent}${line.slice(subIndent)}`;
    });
  }

  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]*/);
    const len = match ? match[0].length : 0;
    if (len < minIndent) minIndent = len;
  }
  if (minIndent === Infinity) minIndent = 0;

  return lines.map((line) => {
    if (!line.trim()) return '';
    return `${targetIndent}${line.slice(minIndent)}`;
  });
}

/**
 * Bundle path of an uploaded custom WAV, or null when the role is off or has no
 * file. Rebuilt from the current weapon id on every export (like `packArtPath`),
 * so a rename cannot leave a stale `sounds/<old id>/...` path. The engine loads
 * it from the claim's `sounds` list as `sounds/<mod>/<role>.wav`.
 */
export function customSoundPath(
  project: WeaponProject,
  role: 'explosion' | 'interval' | 'shot',
): string | null {
  const sounds = project.customSounds;
  if (!sounds) return null;
  const enabled =
    role === 'explosion'
      ? sounds.explosionEnabled
      : role === 'shot'
        ? sounds.shotEnabled
        : sounds.intervalEnabled;
  const asset =
    role === 'explosion' ? sounds.explosion : role === 'shot' ? sounds.shot : sounds.interval;
  if (!enabled || !asset?.file) return null;
  return `sounds/${sanitizeModFolder(project.id)}/${role}.wav`;
}

/** A safe `.wep` filename for the exported bundle. */
export function sanitizeWepFileName(name: string): string {
  const base = (name || 'weapon.wep').replace(/\\/g, '/').split('/').pop() || 'weapon.wep';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_') || 'weapon.wep';
  return cleaned.toLowerCase().endsWith('.wep') ? cleaned : `${cleaned}.wep`;
}

/** Bundle-relative path of the imported `.wep`, or null when `copy_from` is
 *  the firing source. The engine reads `wep` relative to the bundle root. */
export function wepBundlePath(project: WeaponProject): string | null {
  if (!project.useWepFile || !project.wepFile) return null;
  return `weps/${sanitizeWepFileName(project.wepFileName || project.wepFile.name)}`;
}

export function generateLuaCode(project: WeaponProject): string {
  const modFolder = sanitizeModFolder(project.id);
  const donor = project.based_on.startsWith('stock.') ? project.based_on : `stock.${project.based_on}`;
  const lines: string[] = [];

  // Uploaded pack art. Trails and cluster sheets are loaded by the engine for
  // this weapon only (the path is an installation declaration, not something a
  // simulation-time `launch` override can use).
  const strikeBodyArt = packArtPath(project, 'strike_sprite');
  const missileTrailArt = packArtPath(project, 'missile_trail');
  const clusterBitArt = packArtPath(project, 'cluster_sprite');
  const clusterBitHomingArt = packArtPath(project, 'cluster_homing_sprite');
  const clusterBitTrailArt = packArtPath(project, 'cluster_trail');

  const usesHold = project.hold && project.hold.enabled;
  const missileSpriteEnabled = !!project.missileSprite?.enabled;
  // The primary WFWS builder. Bits and behaviour states are drawn by the same
  // `sb.flight` call, so they only exist while it is on.
  const builderOn = primaryBuilderOn(project);
  const usesMissileSprite = builderOn;
  const bitMode = bitBuilderMode(project);
  const bitRoleActive = bitMode === 'builder';
  const behaviorStates = resolveBehaviorStates(project);
  const clusterBitAction = bitActionOf(project);

  // Which art roles the builder owns (homing timing, dig probes), shared with
  // `generateModToml` and the exporter so every sheet is declared and written.
  //
  // Digging has no art of its own: the builder animates the flight sheet while
  // its terrain probes say the round is in the land, so the record's own dig
  // sprites have to go -- a stock mole (moledive/moledig1..3) or PX's
  // wsvr/wsvru/wsvrd/wsvb (245-248) would be drawn under our sheet, and those
  // ids only exist because PX points `sprite_overrides` at them. `native` on
  // the dig role keeps WA's dig art (and no `dig =` is passed to the builder).
  const {
    digUsesBuilder,
    homing: homingBuilder,
    bitHoming: bitHomingBuilder,
    zeroMainDig,
    zeroBitDig,
  } = wfwsRoleFlags(project);

  // Which record families WA blasts at all: a gun, arrow, spray or special has
  // no explosion to decorate, and neither does an air strike. A strike's bombs
  // are built by AirStrikeEntity::release_missile from the strike's own record
  // copy, not from a weapon-table slot, so the engine never maps them to this
  // claim (`missile_boom::weapon_of` has no slot for them) and `on_explode`
  // cannot fire. A mine is a drop without a fuse; the rest are missiles.
  const explodesNatively = project.fireType === 'power' || project.fireType === 'drop';

  // Parse custom Lua callbacks to extract any `on_explode` hook.
  // This allows custom Lua logic, custom explosion WAV sound, and the effects-SDK
  // explosion burst to merge seamlessly into a single `on_explode` hook.
  const parsedLua = project.enableCustomLua && project.customLuaSnippet
    ? parseCustomLua(project.customLuaSnippet)
    : { paramName: 'ev', onExplodeBody: '', remainingSnippet: project.customLuaSnippet || '', hasOnExplode: false };

  // The effects SDK's px_effects burst: the electric ring + lens, an optional
  // PX-style blast replacement, and the smoke and re-buffer passes.
  const explosionEffect = project.explosionEffect;
  const usesExplosionEffect = !!explosionEffect?.enabled && explodesNatively;
  // Replacing WA's blast needs the claim to own the blast, which a missile and
  // a mine do; the custom explosion supplies damage, push, crater and sound.
  const silencesBlast = usesExplosionEffect && explosionEffect!.mode === 'blast';
  // Uploaded WAVs.
  const customSounds = project.customSounds;
  const explosionSoundPath = customSoundPath(project, 'explosion');
  const intervalSoundPath = customSoundPath(project, 'interval');
  const usesExplosionSound = !!explosionSoundPath && explodesNatively;
  const usesIntervalSound =
    !!intervalSoundPath &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));
  const hasCustomExplodeCode = project.enableCustomLua && !!parsedLua.onExplodeBody.trim();
  // `wf-lib/fire_seq` (px.fire_seq): one `on_fire` fires a burst. A custom
  // `on_fire` in the snippet owns the trigger, so the card is skipped then.
  const fireSequence = project.fireSequence;
  const hasCustomOnFire =
    project.enableCustomLua && /(?:^|\n)[ \t]*on_fire\s*=/.test(project.customLuaSnippet || '');
  const usesFireSequence =
    !!fireSequence?.enabled && !hasCustomOnFire && supportsFireSequence(project);
  // A held weapon loses its sheet on the repeat-fire frames (WA state 0x6A/0x6B
  // alternate) from the second shot of a burst: the engine's `hold` only draws
  // them while `h.firing` is set, and only the turn's fire message sets it.
  // `wf-lib/px_hold_art` redraws those two states through `wa.on.draw`.
  const usesHoldArt = !!usesHold && usesFireSequence;
  const shotSoundPath = usesFireSequence ? customSoundPath(project, 'shot') : null;
  // The effects SDK's ribbon trail follows a missile WA builds from this
  // record, so it only applies to the missile families (a strike's bombs are
  // not one: their `m.weapon` is nil).
  const ribbonTrail = project.ribbonTrail;
  const usesRibbonTrail =
    !!ribbonTrail?.enabled &&
    (project.fireType === 'power' || (project.fireType === 'drop' && project.body.fuse));

  if (usesHold) {
    lines.push('local holds = require("wf-lib/holds")');
  }
  if (usesHoldArt) {
    // Part of the px.fire_seq bundle: covers WA's two repeat-fire frames.
    lines.push('local hold_art = require("wf-lib/px_hold_art")');
  }
  if (usesMissileSprite) {
    // WFWS's fork: primary + cluster-bit + per-behaviour art in one call.
    lines.push(`local sb = require(${luaQuote(WFWS_BUILDER_MODULE)})`);
  }
  if (usesFireSequence) {
    lines.push('local seq = require("wf-lib/fire_seq")');
    // The worm's live aim as a unit vector: aim 0 is straight down, 1 straight
    // up, and `facing` mirrors it. `wa.math` keeps it deterministic.
    lines.push('local function seq_dir(w)');
    lines.push('  local ang = (1 - w.aim) * math.pi');
    lines.push('  if w.facing < 0 then ang = 2 * math.pi - ang end');
    lines.push('  return wa.math.sin(ang), -wa.math.cos(ang)');
    lines.push('end');
  }
  if (usesRibbonTrail) {
    lines.push('local trail = require("wf-lib/effects/trail")');
  }
  if (usesExplosionEffect) {
    lines.push('local fx = require("wf-lib/effects/px_effects")');
    if (!usesRibbonTrail) {
      // px_effects falls back to the trail module's beam and glow sheets.
      lines.push('local trail = require("wf-lib/effects/trail")');
    }
    if (silencesBlast) {
      lines.push('local blast = require("wf-lib/effects/custom_explosion")');
    }
  }
  if (usesHold || usesMissileSprite || usesRibbonTrail || usesExplosionEffect || usesFireSequence) {
    lines.push('');
  }

  // Record tables read from another bundle (`recordExtra`): the engine's own
  // key names, written back over the base record so the module's declared
  // values win and every key it does not declare keeps the `.wep`/donor value.
  // They are emitted as explicit assignments rather than a `pairs` merge: the
  // order is then fixed in the file, which is what wfcheck's `lockstep-pairs`
  // rule wants, and the result reads like the record it came from.
  const extraAssignments = project.recordExtra ? recordAssignments(project.recordExtra) : [];

  lines.push('return {');

  // Defaults block
  const d = project.defaults;
  const defRows: string[] = [];
  if (d.ammo !== undefined && d.ammo !== null) {
    defRows.push(`    ammo = { round_start = ${d.ammo} },`);
  }
  if (d.delay && d.delay > 0) {
    defRows.push(`    delay = ${d.delay},`);
  }
  if (d.crateChance && d.crateChance > 0) {
    defRows.push(`    crate = { chance_pct = ${d.crateChance}, type = ${luaQuote(d.crateType || 'weapon')} },`);
  }
  if (d.afterUse) {
    defRows.push(`    after_use = ${luaQuote(d.afterUse)},`);
  }

  if (defRows.length > 0) {
    lines.push('  defaults = {');
    lines.push(...defRows);
    lines.push('  },');
    lines.push('');
  }

  // The held-art table. Computed once: with `px_hold_art` it has to exist as a
  // local before the claim (the helper keeps the table and reads it on every
  // draw), otherwise it stays inline in the claim.
  const holdRows: string[] = [];
  let holdArtSize = 0;
  if (usesHold) {
    const h = project.hold;
    const handIdx = h.handType === 'lower' ? 1 : h.handType === 'upper' ? 3 : 2;
    holdRows.push(`sheet = ${luaQuote(holdSheetPath(project))},`);
    holdRows.push(`hand = holds.PX_HANDS[${handIdx}],`);
    holdRows.push(`hand_type = ${handIdx},`);
    const drawHand = h.drawHand !== false;
    holdRows.push(`hand_radius = ${drawHand ? (h.handRadius ?? 10) : 0.01},`);
    holdRows.push('hand_rotation = 1,');
    holdRows.push('hand_radial_rotation = 1,');
    holdRows.push(`weap_radius = ${h.weapRadius ?? 6},`);
    holdRows.push(`weap_rotation = ${(1 + (h.weapRotation || 0) / 180).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')},`);
    holdRows.push('weap_radial_rotation = 1,');
    holdRows.push(`weap_scale = ${h.scale ?? 1},`);
    if (h.frames > 1) {
      holdRows.push(`frames = ${h.frames},`);
      // worm_hold.rs advances `phase` by anim_speed * 0.03 on every 50 Hz
      // game frame, so one full cycle takes 0.667 / anim_speed seconds and the
      // sheet shows 1.5 * frames * anim_speed frames per second. The builder
      // asks for that real in-game FPS; convert it to the engine multiplier
      // here so the number on screen is what the game plays.
      const fps = Math.max(1, Number(h.fps) || 15);
      const animSpeed = fps / (1.5 * h.frames);
      if (Math.abs(animSpeed - 1) > 0.0005) {
        holdRows.push(`anim_speed = ${formatNumber(animSpeed)},`);
      }
    }
    if (h.handScale && h.handScale !== 1) holdRows.push(`hand_scale = ${h.handScale},`);
    if (!drawHand) holdRows.push('draw_hand = false,');
    if (h.keepWhileFiring) holdRows.push('keep_while_firing = true,');
    if (h.thrown) holdRows.push('thrown = true,');
    if (h.putAway) holdRows.push('put_away = true,');
    if (h.flashFile) {
      // The firing-state sprite. The engine draws it on the firing states
      // (0x6A/0x6B) for `frames` + 1 ticks, with `out` / `side` relative to
      // the worm centre and `scale` standalone — fold the normal weapon's
      // radius, rotation, and scale in so the muzzle flash stays locked to it.
      const resolvedFlash = resolvedHoldFlash(h);
      holdRows.push('flash = {');
      holdRows.push(`  sheet = ${luaQuote(flashSheetPath(project))},`);
      holdRows.push(`  out = ${formatNumber(resolvedFlash.out)},`);
      holdRows.push(`  side = ${formatNumber(resolvedFlash.side)},`);
      holdRows.push(`  scale = ${formatNumber(resolvedFlash.scale)},`);
      holdRows.push(`  frames = ${Math.max(1, Math.round(h.flashFrames ?? 3))},`);
      holdRows.push('},');
    }
    if (usesHoldArt) {
      // `px_hold_art` takes the same table plus these two presentation keys
      // (the engine ignores them). It has no scale key: `weap_scale` is folded
      // into `size`, the cell's pixel extent, or the firing frames would draw
      // at a different size from the aiming frames.
      const fallback = defaultArtFor(project);
      const frames = Math.max(1, h.frames || 1);
      const width = h.sheetWidth ?? fallback.width;
      // An uploaded sheet is already a strip; the exporter stacks the default
      // art to `frames`, so its cell is the original image.
      const cellHeight = h.sheetFile
        ? (h.sheetHeight ?? fallback.height) / frames
        : fallback.height;
      holdArtSize =
        Math.max(1, Math.round(Math.min(width, cellHeight) * (h.scale ?? 1) * 100) / 100);
      holdRows.push('weapon = ctx.id,');
      holdRows.push(`size = ${holdArtSize},`);
    }
  }

  // Install function
  lines.push('  install = function(ctx)');
  if (usesExplosionEffect) {
    // px_effects draws through a hidden driver actor, so it has to be installed
    // before a round can explode; `trail = true` also installs the ribbon
    // module the trail block below samples with.
    lines.push(`    fx.install{ trail = ${usesRibbonTrail ? 'true' : 'false'} }`);
  }
  if (usesHoldArt) {
    lines.push('    local hold = {');
    for (const row of holdRows) lines.push(`      ${row}`);
    lines.push('    }');
  }
  lines.push(extraAssignments.length > 0 ? '    local rec = {' : '    wa.weapons.replace{');
  lines.push(`      name = ${luaQuote(project.name)},`);
  const wepPath = wepBundlePath(project);
  if (wepPath) {
    // `wep` and `copy_from` are mutually exclusive. The .wep supplies the
    // complete native record; the tables below only carry edits.
    lines.push(`      wep = ${luaQuote(wepPath)},`);
  } else {
    lines.push(`      copy_from = ${luaQuote(donor)},`);
  }

  // Panel Icon
  if (project.customIconFile) {
    lines.push(`      panel_icon = ${luaQuote(`sprites/${modFolder}/icon.png`)},`);
  } else if (project.panel_icon) {
    lines.push(`      panel_icon = ${luaQuote(project.panel_icon)},`);
  }

  // Cluster bit art is a claim-level declaration: the engine loads the sheet
  // and writes its installed id into `clusters.bit.sprite` (or the strike's
  // cluster sprite) / the cluster render timer. A pack path cannot go into the
  // record tables themselves; those take stock names or numeric ids.
  const clusterArt: string[] = [];
  // While the bit builder owns the bits, `clusters.bit.sprite` must stay a
  // stock id: it is the classification marker (`m.sprite ~= 0`) and the sheet
  // the claim would install is hidden by the builder anyway. The same applies
  // to the homing render timer: a state's own sheet replaces it.
  if (!bitRoleActive) {
    if (clusterBitArt) clusterArt.push(`sprite = ${luaQuote(clusterBitArt)}`);
    // `cluster.homing_sprite` is applied with `set_cluster_render_timer`, which
    // writes entry+0x170 with no strike shift. `packArtPath` refuses it on a
    // fire type 3 record (see `packArtSlotApplies`), so this is safe for every
    // family.
    if (clusterBitHomingArt) {
      clusterArt.push(`homing_sprite = ${luaQuote(clusterBitHomingArt)}`);
    }
  }
  if (clusterArt.length > 0) {
    lines.push(`      cluster = { ${clusterArt.join(', ')} },`);
  }

  // A roaming animal's two flying sheets. `sheep_sprites` installs them as WA
  // sprites and writes `sheep.flight_1` / `sheep.flight_2`, which WA alternates
  // while the animal is steered -- the walking pose stays the record body and
  // the gas pose `roam.gas.animal_sprite`. A builder sheet replaces the flying
  // state instead, so the uploads are dormant while it is on.
  const roamSheets = roamSheetsOwnFlight(project) ? roamSheetPaths(project) : null;
  if (roamSheets) {
    lines.push(`      sheep_sprites = { ${luaQuote(roamSheets.first)}, ${luaQuote(roamSheets.second)} },`);
  }

  // The weapon's own body sheet. For an air strike this is the only art path:
  // the sprite builder follows a placed weapon's missile, and `missile.sprite`
  // in a record takes stock ids only. `retarget_strike_sprite_id` writes the
  // strike munition (0x74) and carries the sheet into its homing sprite (0xC0)
  // and cluster sprite (0x138) when they shared the stock body.
  if (strikeBodyArt) {
    lines.push(`      sprite = ${luaQuote(strikeBodyArt)},`);
  }

  // Pack art the claim uses. `sb.flight` (below) reads its sheet through this
  // field; the hold sheet is registered the same way so both paths agree.
  // Claim `sprites`: pack paths (quoted) and the effects SDK's own ribbon
  // sheets (bare module fields, resolved from its asset namespace).
  const packSprites: string[] = [];
  if (usesHold && project.hold?.sheetFile) {
    packSprites.push(luaQuote(holdSheetPath(project)));
  }
  if (usesHold && project.hold?.flashFile) {
    packSprites.push(luaQuote(flashSheetPath(project)));
  }
  if (usesMissileSprite) {
    packSprites.push(luaQuote(missileFlightSheetPath(project)));
    if (bitMode === 'builder') {
      packSprites.push(luaQuote(bitFlightSheetPath(project)));
    }
    for (const state of behaviorStates) {
      if (state.art.mode === 'builder') {
        packSprites.push(luaQuote(behaviorStateSheetPath(project, state.def.key)));
      }
    }
    // Timed homing sheets are not `states` any more, so they are claimed here.
    if (homingBuilder) packSprites.push(luaQuote(behaviorStateSheetPath(project, 'homing')));
    if (bitHomingBuilder) {
      packSprites.push(luaQuote(behaviorStateSheetPath(project, 'homing_bit')));
    }
  }
  if (usesRibbonTrail) {
    packSprites.push('trail.BEAM', 'trail.GLOW');
  }
  if (usesExplosionEffect) {
    // The burst draws with the same beam/glow pair and, when enabled, the
    // cloud sheet. Listing the module fields registers the pack paths for this
    // claim, exactly as the electric mine does.
    if (!usesRibbonTrail) packSprites.push('trail.BEAM', 'trail.GLOW');
    if (explosionEffect!.smoke) packSprites.push('fx.SMOKE');
  }
  if (packSprites.length > 0) {
    lines.push(`      sprites = { ${packSprites.join(', ')} },`);
  }

  // `px_hold_art` draws the hold sheet through `wa.draw.quad`, which resolves a
  // pack path through the same sprite-key registry the claim fills. The engine
  // already packs every `hold.sheet` into the GPU atlas by itself
  // (`apply.rs`'s `hold_sheet` test), so this is belt-and-braces: it is the key
  // PX's own fire_seq weapons pass (`params = { gpu_prefix = "sprites/" }`),
  // and it keeps the quad's path resolving if a build ever stops claiming the
  // hold sheet implicitly.
  //
  // It is skipped when the claim has art WA itself has to draw from a real slot:
  // `gpu_prefix` moves every matching path to a virtual atlas id, and a body or
  // cluster sheet needs the stock id the record points at.
  if (usesHoldArt && !strikeBodyArt && !clusterBitArt && !clusterBitHomingArt) {
    lines.push('      params = { gpu_prefix = "sprites/" },');
  }

  // Pack WAVs are declared by path in `sounds`; the engine loads them into
  // WormForge's own sample bank (WA's record sound fields take native ids).
  const packSounds: string[] = [];
  if (usesExplosionSound) packSounds.push(luaQuote(explosionSoundPath!));
  if (usesIntervalSound) packSounds.push(luaQuote(intervalSoundPath!));
  if (shotSoundPath) packSounds.push(luaQuote(shotSoundPath));
  if (packSounds.length > 0) {
    lines.push(`      sounds = { ${packSounds.join(', ')} },`);
  }

  // Fire type specific properties
  const body = project.body;
  // With an imported .wep the file is the record. Compare against the decoded
  // baseline so untouched fields are inherited and only real edits are written.
  // With a `.wep` the file is the record; with `copy_from` the engine applies
  // the donor's record, so the donor's decoded values are the baseline. Untouched
  // fields are then left to the engine instead of being written over with the
  // editor's defaults (which is how a donor weapon used to inherit a preset).
  // `copy_from` supplies the donor's record sight-unseen, so the diff base has
  // to be *that* donor. A baseline decoded from another donor (the Grenade
  // default, or the donor a project was re-based from) makes every value the
  // two donors share look "unchanged" and skips it: a mortar carrying the
  // grenade's burst `nothing` and 100% push exported neither, so the engine's
  // own clustlets and 0% push survived the user turning them off.
  const donorSlot = (project.based_on || project.slot || '').replace(/^stock\./, '');
  const donorBaseline = project.donorBaseline;
  const baselineMatchesDonor =
    !donorBaseline?.slot || !donorSlot || donorBaseline.slot === donorSlot;
  const currentDonorBaseline = stockDonorBaseline(donorSlot) ?? donorBaseline;
  const baseline = project.useWepFile
    ? project.wepBaseline
    : baselineMatchesDonor
      ? (donorBaseline ?? currentDonorBaseline)
      : currentDonorBaseline;
  const baseBody = baseline?.body;
  const baseOverrides = baseline?.recordOverrides || {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const bodyChanged = <K extends keyof BodyConfig>(key: K) =>
    !baseline || !same(body[key], baseBody?.[key]);
  const clustletChanged = <K extends keyof ClustletConfig>(key: K) =>
    bitActionChangedEarly || !baseline || !same(body.clustlet[key], baseBody?.clustlet[key]);
  // `fullGroup` (an action switch, or a fresh donor) forces every field of the
  // active group to be written: they share one native slab, so an inherited
  // value belongs to the previous action (the grenade's bounce sound 113 is the
  // homing trail's sprite).
  const roamChanged = <K extends keyof RoamActionConfig>(key: K) =>
    fullGroup || !baseline || !same(project.roamConfig?.[key], baseline.roamConfig?.[key]);
  const digChanged = <K extends keyof DigActionConfig>(key: K) =>
    fullGroup || !baseline || !same(project.digConfig?.[key], baseline.digConfig?.[key]);
  const override = (key: string): any => {
    const value = project.recordOverrides[key];
    if (value === undefined) return undefined;
    if (baseline && same(value, baseOverrides[key])) return undefined;
    return value;
  };
  const overrideTouched = (...keys: string[]) => keys.some((key) => override(key) !== undefined);
  const action = project.action || (body.bounce_pct > 0 ? 'bounce' : body.homing !== 'off' ? 'homing' : 'none');
  const actionChanged = !baseline || action !== baseline.action;
  // The action groups share one native slab (+0xA8..+0xD0): a bounce sound at
  // 0xB4 is the homing trail's sprite, a dig sound at 0xB0 is the homing
  // animation, and so on. Switching the action (or starting from a donor whose
  // own action is not ours) therefore has to write the *whole* destination
  // group, or the donor's leftovers come back as another feature's value -- a
  // stock grenade's bounce sound 113 turned into a homing trail drawing
  // `oildrum4`. `fullGroup` also covers a fresh `copy_from`, where the donor's
  // slab is simply unknown.
  const fullGroup = actionChanged;
  // The cluster bits' action groups share a slab of their own, so their fields
  // get the same treatment (`clustletChanged` includes this).
  const clustletAction = (c: {
    bit_action?: string;
    homing?: string;
    contact?: string;
  }): string =>
    c.bit_action ?? (c.homing !== 'off' ? 'homing' : c.contact === 'bounce' ? 'bounce' : 'none');
  const bitActionChangedEarly =
    !baseline ||
    clustletAction(project.body.clustlet) !== clustletAction(baseline.body.clustlet);
  const burst = project.burst || (body.cluster ? 'clusters' : 'nothing');
  const burstChanged = !baseline || burst !== baseline.burst;
  const clustletTouched = (Object.keys(body.clustlet) as (keyof ClustletConfig)[]).some(clustletChanged);
  const fireTouched = !baseline || !same(project.fireConfig, baseline.fireConfig);
  const roamTouched = !baseline || !same(project.roamConfig, baseline.roamConfig);
  const digTouched = !baseline || !same(project.digConfig, baseline.digConfig);
  // Behaviour states write their sentinel sprite ids into the record so the
  // builder always has a nonzero `m.sprite` to match. One lookup per group.
  const stateByKey = new Map(behaviorStates.map((state) => [state.def.key, state]));
  const homingState = stateByKey.get('homing');
  const homingBitState = stateByKey.get('homing_bit');
  const digState = stateByKey.get('dig');
  const roamFlightState = stateByKey.get('roam_flight');
  const gasState = stateByKey.get('gas');

  // Handling is shared by every family. Only fields present (or changed since
  // the .wep import) are written; the rest stay inherited.
  const handlingRows: string[] = [];
  const handlingBool = (key: string, name: string) => {
    const v = override(key);
    if (v !== undefined) handlingRows.push(`        ${name} = ${v ? 'true' : 'false'},`);
  };
  const handlingInt = (key: string, name: string) => {
    const v = override(key);
    if (v !== undefined) handlingRows.push(`        ${name} = ${v},`);
  };
  handlingBool('handling.remember_selection', 'remember_selection');
  handlingBool('handling.available_in_caves', 'available_in_caves');
  handlingInt('handling.shots', 'shots');
  handlingBool('handling.ends_turn', 'ends_turn');
  handlingInt('handling.retreat', 'retreat');
  if (handlingRows.length > 0) {
    lines.push('      handling = {');
    lines.push(...handlingRows);
    lines.push('      },');
  }

  // `fires.subtype` (+0x34) is not family-specific: every record has it, and
  // WA plays that number's own fire animation and sound (4 = Minigun, 5 =
  // Shotgun, …). Write it when the author's choice differs from the inherited
  // record; the archetype buttons and a donor change re-base it with the
  // donor's own number, so an untouched weapon still writes nothing. It is a
  // firing-header value only: it never touches the held-art animation.
  {
    const subtype = override('fires.subtype') ?? project.specialSubtype;
    if (subtype !== undefined && (!baseline || subtype !== baseline.specialSubtype)) {
      lines.push(`      fires = { subtype = ${subtype} },`);
    }
  }

  if (project.fireType === 'hitscan') {
    const gunTouched =
      !baseline ||
      bodyChanged('damage') ||
      overrideTouched(
        'gun.bullets',
        'gun.spread_deg',
        'gun.shot_interval_ms',
        'gun.burst_size',
        'gun.burst_spread_deg',
        'gun.hits',
        'gun.explosion.bias',
        'gun.explosion.push_pct',
        'gun.explosion.variation',
        'gun.impact_effect'
      );
    if (gunTouched) {
      lines.push('      gun = {');
      if (!baseline || bodyChanged('damage')) {
        lines.push(`        damage = ${body.damage ?? 25},`);
      }
      const gunInt = (key: string, name: string) => {
        const v = override(key);
        if (v !== undefined) lines.push(`        ${name} = ${v},`);
      };
      gunInt('gun.bullets', 'bullets');
      gunInt('gun.spread_deg', 'spread_deg');
      gunInt('gun.shot_interval_ms', 'shot_interval_ms');
      gunInt('gun.burst_size', 'burst_size');
      gunInt('gun.burst_spread_deg', 'burst_spread_deg');
      gunInt('gun.impact_effect', 'impact_effect');
      const gunHits = luaMaskTable(override('gun.hits'));
      if (gunHits !== null) lines.push(`        hits = ${gunHits},`);
      const gunExplosionBias = override('gun.explosion.bias');
      const gunExplosionPush = override('gun.explosion.push_pct');
      const gunExplosionVariation = override('gun.explosion.variation');
      if (
        gunExplosionBias !== undefined ||
        gunExplosionPush !== undefined ||
        gunExplosionVariation !== undefined
      ) {
        lines.push('        explosion = {');
        if (gunExplosionBias !== undefined) lines.push(`          bias = ${gunExplosionBias},`);
        if (gunExplosionPush !== undefined) lines.push(`          push_pct = ${gunExplosionPush},`);
        if (gunExplosionVariation !== undefined) {
          lines.push(`          variation = ${gunExplosionVariation},`);
        }
        lines.push('        },');
      }
      lines.push('      },');
    }
  } else if (project.fireType === 'drop' && !body.fuse) {
    const mineTouched =
      silencesBlast ||
      !baseline ||
      bodyChanged('proximity') ||
      bodyChanged('arm_delay_ms') ||
      bodyChanged('trigger_delay_ms') ||
      bodyChanged('damage') ||
      overrideTouched('mine.detects', 'mine.explosion.bias', 'mine.explosion.push_pct');
    if (mineTouched) {
      lines.push('      mine = {');
      if (!baseline || bodyChanged('proximity')) {
        lines.push(`        proximity = ${body.proximity ?? 25},`);
      }
      if (!baseline || bodyChanged('arm_delay_ms')) {
        lines.push(`        arm = ${body.arm_delay_ms ?? 3000},`);
      }
      if (!baseline || bodyChanged('trigger_delay_ms')) {
        lines.push(`        fuse = ${body.trigger_delay_ms ?? 2000},`);
      }
      const detects = luaMaskTable(override('mine.detects'));
      if (detects !== null) lines.push(`        detects = ${detects},`);
      const mineExplosionBias = override('mine.explosion.bias');
      const mineExplosionPush = override('mine.explosion.push_pct');
      if (
        silencesBlast ||
        !baseline ||
        bodyChanged('damage') ||
        mineExplosionBias !== undefined ||
        mineExplosionPush !== undefined
      ) {
        lines.push('        explosion = {');
        if (silencesBlast) {
          // The custom explosion in `on_explode` replaces the mine's own blast
          // (the electric mine silences it the same way).
          lines.push('          power = 0,');
          lines.push('          push_pct = 0,');
        } else if (!baseline || bodyChanged('damage')) {
          lines.push(`          power = ${body.damage ?? 50},`);
        }
        if (!silencesBlast && mineExplosionBias !== undefined) {
          lines.push(`          bias = ${mineExplosionBias},`);
        }
        if (!silencesBlast && mineExplosionPush !== undefined) {
          lines.push(`          push_pct = ${mineExplosionPush},`);
        }
        lines.push('        },');
      }
      lines.push('      },');
    }
  } else if (project.fireType === 'cursor' && project.teleport) {
    lines.push('      on_select = { cursor = true },');
  } else if (
    project.fireType === 'power' ||
    (project.fireType === 'drop' && body.fuse) ||
    // An air strike is a missile record too: the engine reads the munition
    // body 0x14 bytes further in (record.rs STRIKE_SHIFT), and every
    // `missile.*` / `clusters.*` name resolves to that shifted slab.
    (project.fireType === 'cursor' && !project.teleport)
  ) {
    // Missile family only. Arrow, spray and special records have their own
    // layouts; giving them `missile` tables is refused by the engine.
    const missileStart = lines.length;
    lines.push('      missile = {');

    const powerChanged = bodyChanged('damage');
    const pushPct = override('missile.explosion.push_pct');
    const explosionBias = override('missile.explosion.bias');
    const explosionVariation = override('missile.explosion.variation');
    if (
      powerChanged ||
      pushPct !== undefined ||
      explosionBias !== undefined ||
      explosionVariation !== undefined ||
      silencesBlast
    ) {
      lines.push('        explosion = {');
      if (silencesBlast) {
        // The custom explosion in `on_explode` does the damage, push and
        // crater; a power here would blast a second time.
        lines.push('          power = 0,');
        lines.push('          push_pct = 0,');
      } else if (powerChanged) lines.push(`          power = ${body.damage},`);
      if (!silencesBlast && pushPct !== undefined) {
        lines.push(`          push_pct = ${pushPct},`);
      }
      if (explosionBias !== undefined) lines.push(`          bias = ${explosionBias},`);
      if (explosionVariation !== undefined) {
        lines.push(`          variation = ${explosionVariation},`);
      }
      lines.push('        },');
    }

    // Emit whenever the value differs from the imported baseline, even if it
    // is the API's 100 default: the base `.wep` may have had another value.
    if (bodyChanged('gravity_pct')) {
      lines.push(`        gravity_pct = ${body.gravity_pct},`);
    }
    if (bodyChanged('wind_pct')) {
      lines.push(`        wind_pct = ${body.wind_pct},`);
    }

    // `fuse` (0x8C) and `countdown` (0x88) are separate native timers.
    const fuseChanged = bodyChanged('fuse') || bodyChanged('fuse_time_ms');
    if (fuseChanged) {
      if (body.fuse && body.fuse_time_ms > 0) {
        lines.push(`        fuse = ${body.fuse_time_ms},`);
      } else {
        // 0 restores impact detonation when the base had a timer.
        lines.push('        fuse = 0,');
      }
    }
    if (bodyChanged('countdown_ms')) {
      lines.push(`        countdown = ${body.countdown_ms ?? 0},`);
    }

    const explodeOnSpace = override('missile.explode_on_space');
    if (explodeOnSpace !== undefined) {
      lines.push(`        explode_on_space = ${explodeOnSpace ? 'true' : 'false'},`);
    }

    // Optional native pre-explosion sound: `{ enabled, sound, before }`.
    const explosionSoundEnabled = override('missile.explosion_sound.enabled');
    const explosionSound = override('missile.explosion_sound.sound');
    const explosionSoundBefore = override('missile.explosion_sound.before');
    if (
      explosionSoundEnabled !== undefined ||
      explosionSound !== undefined ||
      explosionSoundBefore !== undefined
    ) {
      lines.push('        explosion_sound = {');
      if (explosionSoundEnabled !== undefined) {
        lines.push(`          enabled = ${explosionSoundEnabled ? 'true' : 'false'},`);
      }
      if (explosionSound !== undefined) lines.push(`          sound = ${explosionSound},`);
      if (explosionSoundBefore !== undefined) {
        lines.push(`          before = ${explosionSoundBefore},`);
      }
      lines.push('        },');
    }

    // Native flight sprite and animation. A custom `sb.flight` sheet is drawn
    // by a follower actor, not by WA's missile, so the sprite-builder's
    // ANIM_TYPE (`track`, `rotation`, `slow`, ...) must NOT be written to the
    // record's `animation`: that field is WA's native selector (0..5).
    const spriteOverride = override('missile.sprite');
    if (builderOn && action !== 'roam') {
      // The builder classifies a missile as the primary only when `m.sprite` is
      // zero at first sight. This write is unconditional: an imported `.wep`
      // baseline or a `missile.sprite` override must not leave WA's sprite in
      // place, or the primary would classify as a cluster bit.
      //
      // Roaming is the exception: its `sprite` is the walking pose WA draws
      // before the player presses Space, and `m.sprite` is not what draws the
      // flown animal (that is `sheep.flight_1/2`, zeroed below). Zeroing it
      // here would delete the walk, so a roam record keeps normal diffing.
      lines.push('        sprite = 0,');
    } else if (spriteOverride !== undefined) {
      if (spriteOverride === 0 || spriteOverride === '0') {
        lines.push('        sprite = 0,');
      } else if (!isNaN(Number(spriteOverride))) {
        lines.push(`        sprite = ${Number(spriteOverride)},`);
      } else {
        lines.push(`        sprite = ${luaQuote(String(spriteOverride))},`);
      }
    } else if (
      missileSpriteEnabled &&
      action !== 'roam' &&
      project.missileSprite?.hideStock &&
      (!baseline || !same(project.missileSprite?.hideStock, baseline.missileSprite?.hideStock))
    ) {
      // `hideStock` hides WA's normal flight sprite; a roam record's `sprite`
      // is the walking pose, so it never applies there.
      lines.push('        sprite = 0,');
    } else if (
      missileSpriteEnabled &&
      !usesMissileSprite &&
      project.missileSprite?.stockSprite &&
      (!baseline || !same(project.missileSprite?.stockSprite, baseline.missileSprite?.stockSprite))
    ) {
      lines.push(`        sprite = ${luaQuote(project.missileSprite.stockSprite)},`);
    }

    const animation = override('missile.animation');
    if (animation !== undefined) {
      lines.push(`        animation = ${animation},`);
    }
    const speedPct = override('missile.speed_pct');
    if (speedPct !== undefined) {
      lines.push(`        speed_pct = ${speedPct},`);
    }
    const randomMotion = override('missile.random_motion');
    if (randomMotion !== undefined) {
      lines.push(`        random_motion = ${randomMotion},`);
    }
    const collisionShape = override('missile.collision_shape');
    if (collisionShape !== undefined) {
      lines.push(`        collision_shape = ${collisionShape},`);
    }
    const alarmWorms = override('missile.alarm_worms');
    if (alarmWorms !== undefined) {
      lines.push(`        alarm_worms = ${alarmWorms ? 'true' : 'false'},`);
    }

    // `ends_on_contact` stops the projectile. It is deliberately separate from
    // `bounce.hits`, which only adds targets the bounce action reacts to.
    const endsOnContact = luaMaskTable(override('missile.ends_on_contact'));
    if (endsOnContact !== null) {
      lines.push(`        ends_on_contact = ${endsOnContact},`);
    }

    // Particle Trail Settings
    const trailKeys = [
      'missile.trail.enabled',
      'missile.trail.sprite',
      'missile.trail.power',
      'missile.trail.speed',
      'missile.trail.bubbles_per_second',
    ];
    const trailEnabled = project.recordOverrides['missile.trail.enabled'];
    if (missileTrailArt) {
      // A pack image replaces the stock trail sprite for this weapon only; the
      // engine loads it and writes its id into the native trail field.
      lines.push('        trail = {');
      lines.push(`          sprite = ${luaQuote(missileTrailArt)},`);
      const packTrailPower = project.recordOverrides['missile.trail.power'];
      if (packTrailPower !== undefined) {
        lines.push(`          power = ${packTrailPower},`);
      }
      const packTrailSpeed = project.recordOverrides['missile.trail.speed'];
      if (packTrailSpeed !== undefined) {
        lines.push(`          speed = ${packTrailSpeed},`);
      }
      const packTrailBubbles = project.recordOverrides['missile.trail.bubbles_per_second'];
      if (packTrailBubbles !== undefined) {
        lines.push(`          bubbles_per_second = ${packTrailBubbles},`);
      }
      lines.push('        },');
    } else if (trailEnabled === false && baseOverrides['missile.trail.enabled']) {
      // Clearing a trail inherited from the imported record: sprite 0 is the
      // engine's "no trail" value.
      lines.push('        trail = { sprite = 0 },');
    } else if (overrideTouched(...trailKeys) && trailEnabled) {
      lines.push('        trail = {');
      // A name must be a *stock* sprite (`smklt25`, ...). The engine resolves
      // stock names and treats anything else as a bundle path, so an unknown
      // name fails the whole install ("sprites entry 'smoke' must be a pack
      // PNG/GIF or frame folder"). Fall back to WA's own trail sprite rather
      // than emit a broken one; the editor flags the value in the UI.
      const trSprite =
        resolveStockSprite(project.recordOverrides['missile.trail.sprite'] ?? 'smklt25') ??
        'smklt25';
      if (typeof trSprite === 'number') {
        lines.push(`          sprite = ${trSprite},`);
      } else {
        lines.push(`          sprite = ${luaQuote(trSprite)},`);
      }
      lines.push(`          power = ${project.recordOverrides['missile.trail.power'] ?? 25},`);
      lines.push(`          speed = ${project.recordOverrides['missile.trail.speed'] ?? 250},`);
      if (project.recordOverrides['missile.trail.bubbles_per_second'] !== undefined) {
        lines.push(`          bubbles_per_second = ${project.recordOverrides['missile.trail.bubbles_per_second']},`);
      }
      lines.push('        },');
    }

    const impactParticles = override('missile.impact_particles');
    if (impactParticles !== undefined) {
      lines.push(`        impact_particles = ${impactParticles ? 'true' : 'false'},`);
    }

    const flightSound = override('missile.flight_sound');
    if (flightSound !== undefined) {
      lines.push(`        flight_sound = ${flightSound},`);
    }
    const launchSound = override('missile.launch_sound');
    if (launchSound !== undefined) {
      lines.push(`        launch_sound = ${launchSound},`);
    }

    // Single Missile Action (only one wins: none | bounce | homing | roam | dig)
    if (actionChanged) {
      lines.push(`        action = ${luaQuote(action)},`);
    }
    const bounceTouched =
      actionChanged ||
      bodyChanged('bounce_pct') ||
      overrideTouched(
        'missile.bounce.terrain_keep_speed_pct',
        'missile.bounce.max_bounces',
        'missile.bounce.sound',
        'missile.bounce.hits',
        'missile.bounce.contact_sides',
        'missile.bounce.extra_reverse_chance_pct',
        'missile.bounce.explosion.bias',
        'missile.bounce.explosion.push_pct',
        'missile.bounce.explosion.power',
        'missile.bounce.explosion.variation'
      );
    if (action === 'bounce' && bounceTouched) {
      lines.push('        bounce = {');
      if (fullGroup || bodyChanged('bounce_pct')) {
        lines.push(`          bounciness = ${body.bounce_pct ?? 0},`);
      }
      // Every other field of the group is written in full on an action change:
      // each one shares its slot with the previous action's field (see
      // `fullGroup`).
      const groupInt = (key: string, name: string, fallback = 0) => {
        const v = override(key);
        if (v === undefined && !fullGroup) return;
        lines.push(`          ${name} = ${v ?? fallback},`);
      };
      // Fallbacks match what the bounce panel shows when a field is unset
      // (terrain keep-speed is 75 there, not 0).
      groupInt('missile.bounce.terrain_keep_speed_pct', 'terrain_keep_speed_pct', 75);
      groupInt('missile.bounce.max_bounces', 'max_bounces');
      // 0xB4: bounce sound / homing trail sprite / dig dive sprite / roam step.
      groupInt('missile.bounce.sound', 'sound');
      groupInt('missile.bounce.contact_sides', 'contact_sides');
      groupInt('missile.bounce.extra_reverse_chance_pct', 'extra_reverse_chance_pct');

      const bounceExplosionBias = override('missile.bounce.explosion.bias');
      const bounceExplosionPush = override('missile.bounce.explosion.push_pct');
      const bounceExplosionPower = override('missile.bounce.explosion.power');
      const bounceExplosionVariation = override('missile.bounce.explosion.variation');
      if (
        fullGroup ||
        bounceExplosionBias !== undefined ||
        bounceExplosionPush !== undefined ||
        bounceExplosionPower !== undefined ||
        bounceExplosionVariation !== undefined
      ) {
        lines.push('          explosion = {');
        if (fullGroup || bounceExplosionBias !== undefined) {
          lines.push(`            bias = ${bounceExplosionBias ?? 0},`);
        }
        if (fullGroup || bounceExplosionPush !== undefined) {
          lines.push(`            push_pct = ${bounceExplosionPush ?? 0},`);
        }
        if (fullGroup || bounceExplosionPower !== undefined) {
          lines.push(`            power = ${bounceExplosionPower ?? 0},`);
        }
        if (fullGroup || bounceExplosionVariation !== undefined) {
          lines.push(`            variation = ${bounceExplosionVariation ?? 0},`);
        }
        lines.push('          },');
      }

      // `bounce.hits` is the bounce action's own target selection. It is added
      // to `ends_on_contact`, never a replacement for it. The mask leaves the
      // `impact_particles` bit alone (it shares this dword).
      const bounceHits = luaMaskTable(override('missile.bounce.hits'));
      if (bounceHits !== null) {
        lines.push(`          hits = ${bounceHits},`);
      } else if (fullGroup) {
        lines.push('          hits = {},');
      }
      lines.push('        },');
    } else if (
      action === 'homing' &&
      (!!homingState ||
        homingBuilder ||
        actionChanged ||
        bodyChanged('homing') ||
        bodyChanged('homing_arm_ms') ||
        bodyChanged('homing_time_ms') ||
        overrideTouched(
          'missile.homing.sprite',
          'missile.homing.animation',
          'missile.homing.trail.sprite',
          'missile.homing.trail.power',
          'missile.homing.trail.speed',
          'missile.homing.trail.bubbles_per_second'
        ))
    ) {
      lines.push('        homing = {');
      lines.push(`          kind = ${luaQuote(body.homing !== 'off' ? body.homing : 'lock')},`);
      lines.push(`          arm = ${body.homing_arm_ms ?? 1000},`);
      lines.push(`          time = ${body.homing_time_ms ?? 8000},`);

      // The builder draws the homing sheet in the arm/time window, so WA's own
      // homing sprite has to go or it draws under ours (0xAC is art only).
      const homingSprite = homingBuilder
        ? 0
        : homingState?.assigned.homing_sprite !== undefined
          ? homingState.assigned.homing_sprite
          : fullGroup
            ? (override('missile.homing.sprite') ?? 0)
            : override('missile.homing.sprite');
      if (homingSprite !== undefined) {
        if (homingSprite === 0 || homingSprite === '0' || homingSprite === '') {
          lines.push('          sprite = 0,');
        } else if (!isNaN(Number(homingSprite))) {
          lines.push(`          sprite = ${Number(homingSprite)},`);
        } else {
          lines.push(`          sprite = ${luaQuote(String(homingSprite))},`);
        }
      }
      const homingAnimation = override('missile.homing.animation');
      if (fullGroup || homingAnimation !== undefined) {
        lines.push(`          animation = ${homingAnimation ?? 0},`);
      }

      const homingTrailSprite = override('missile.homing.trail.sprite');
      const homingTrailPower = override('missile.homing.trail.power');
      const homingTrailSpeed = override('missile.homing.trail.speed');
      const homingTrailBubbles = override('missile.homing.trail.bubbles_per_second');
      // Written in full on an action switch: 0xB4 is also the bounce sound, so
      // a donor's leftover (the grenade's 113) would be drawn as the homing
      // trail's sprite -- `oildrum4` with its own odd particle gravity.
      if (
        fullGroup ||
        homingTrailSprite !== undefined ||
        homingTrailPower !== undefined ||
        homingTrailSpeed !== undefined ||
        homingTrailBubbles !== undefined
      ) {
        lines.push('          trail = {');
        if (fullGroup) {
          lines.push('            sprite = 0,');
        } else if (homingTrailSprite !== undefined) {
          if (homingTrailSprite === 0 || homingTrailSprite === '0' || homingTrailSprite === '') {
            lines.push('            sprite = 0,');
          } else if (!isNaN(Number(homingTrailSprite))) {
            lines.push(`            sprite = ${Number(homingTrailSprite)},`);
          } else {
            lines.push(`            sprite = ${luaQuote(String(homingTrailSprite))},`);
          }
        }
        if (fullGroup || homingTrailPower !== undefined) {
          lines.push(`            power = ${homingTrailPower ?? 0},`);
        }
        if (fullGroup || homingTrailSpeed !== undefined) {
          lines.push(`            speed = ${homingTrailSpeed ?? 0},`);
        }
        if (fullGroup || homingTrailBubbles !== undefined) {
          lines.push(`            bubbles_per_second = ${homingTrailBubbles ?? 0},`);
        }
        lines.push('          },');
      }
      lines.push('        },');
    } else if (
      action === 'roam' &&
      project.roamConfig &&
      (roamTouched || !!roamFlightState || !!gasState)
    ) {
      const r = project.roamConfig;
      lines.push('        roam = {');
      if (roamChanged('walk_speed')) {
        lines.push(`          walk_speed = ${r.walk_speed ?? 2},`);
      }
      if (roamChanged('step_height')) {
        lines.push(`          step_height = ${r.step_height ?? 4},`);
      }
      if (roamChanged('terrain_offset')) {
        lines.push(`          terrain_offset = ${r.terrain_offset ?? 0},`);
      }
      if (roamChanged('hits')) {
        const roamHits = luaMaskTable(r.hits as Record<string, unknown>);
        if (roamHits !== null) lines.push(`          hits = ${roamHits},`);
      }
      if (roamChanged('flight_hits')) {
        const roamFlightHits = luaMaskTable(r.flight_hits as Record<string, unknown>);
        if (roamFlightHits !== null) lines.push(`          flight_hits = ${roamFlightHits},`);
      }
      if (
        roamChanged('edge_jump_angle_deg') ||
        roamChanged('edge_jump_speed') ||
        roamChanged('edge_jump_sound')
      ) {
        lines.push('          edge_jump = {');
        if (roamChanged('edge_jump_angle_deg')) {
          lines.push(`            angle_deg = ${r.edge_jump_angle_deg ?? 0},`);
        }
        if (roamChanged('edge_jump_speed')) {
          lines.push(`            speed = ${r.edge_jump_speed ?? 0},`);
        }
        if (roamChanged('edge_jump_sound')) {
          lines.push(`            sound = ${r.edge_jump_sound ?? 0},`);
        }
        lines.push('          },');
      }
      if (
        roamChanged('jump_angle_deg') ||
        roamChanged('jump_speed') ||
        roamChanged('jump_sound')
      ) {
        lines.push('          jump = {');
        if (roamChanged('jump_angle_deg')) {
          lines.push(`            angle_deg = ${r.jump_angle_deg ?? 0},`);
        }
        if (roamChanged('jump_speed')) {
          lines.push(`            speed = ${r.jump_speed ?? 0},`);
        }
        if (roamChanged('jump_sound')) {
          lines.push(`            sound = ${r.jump_sound ?? 0},`);
        }
        lines.push('          },');
      }
      if (
        !!gasState ||
        roamChanged('gas_start_delay_ms') ||
        roamChanged('gas_poison_power') ||
        roamChanged('gas_animal_sprite')
      ) {
        lines.push('          gas = {');
        if (roamChanged('gas_start_delay_ms')) {
          lines.push(`            start_delay_ms = ${r.gas_start_delay_ms ?? 0},`);
        }
        if (roamChanged('gas_poison_power')) {
          lines.push(`            poison_power = ${r.gas_poison_power ?? 0},`);
        }
        const gasSprite =
          gasState?.assigned.gas_sprite !== undefined
            ? gasState.assigned.gas_sprite
            : roamChanged('gas_animal_sprite')
              ? r.gas_animal_sprite ?? 0
              : undefined;
        if (gasSprite !== undefined) {
          lines.push(`            animal_sprite = ${gasSprite},`);
        }
        lines.push('          },');
      }
      lines.push('        },');
    } else if (
      action === 'dig' &&
      project.digConfig &&
      (zeroMainDig || digTouched || (digState?.scope === 'main' && !!digState))
    ) {
      const d = project.digConfig;
      const digMainState = digState?.scope === 'main' ? digState : undefined;
      const nativeDig = builderOn && !digUsesBuilder;
      const digRows: string[] = [];
      const digField = (
        field: 'dig_dive' | 'dig_1' | 'dig_2' | 'dig_3',
        key: 'dive_sprite' | 'sprite_1' | 'sprite_2' | 'sprite_3',
        name: string
      ) => {
        const assigned = digMainState?.assigned[field];
        const value =
          assigned !== undefined
            ? assigned
            : digChanged(key)
              ? d[key] ?? 0
              : undefined;
        const row = digSpriteRow(value, zeroMainDig, nativeDig);
        if (row !== undefined) digRows.push(`          ${name} = ${row},`);
      };
      digField('dig_dive', 'dive_sprite', 'dive_sprite');
      digField('dig_1', 'sprite_1', 'sprite_1');
      digField('dig_2', 'sprite_2', 'sprite_2');
      digField('dig_3', 'sprite_3', 'sprite_3');
      if (zeroMainDig || digChanged('sound') || digRows.length > 0) {
        lines.push('        dig = {');
        // 0xB0 is also `homing.animation` and the bounce keep-speed: on an
        // action switch the donor's number would be played as the dig sound.
        if (zeroMainDig || fullGroup || digChanged('sound')) {
          lines.push(`          sound = ${d.sound ?? 90},`);
        }
        lines.push(...digRows);
        lines.push('        },');
      }
    }

    // Payload Burst Selection
    const burstTouched = burstChanged || clustletTouched || fireTouched;
    if (burstTouched) {
      if (burst === 'fire' && project.fireConfig) {
        lines.push('        burst = "fire",');
        lines.push('        fire = {');
        lines.push(`          spread_delay_ms = ${project.fireConfig.spread_delay_ms ?? 30},`);
        lines.push(`          burn_time_ms = ${project.fireConfig.burn_time_ms ?? 1500},`);
        lines.push(`          spread_generations = ${project.fireConfig.spread_generations ?? 10},`);
        lines.push(`          decay_mode = ${luaQuote(project.fireConfig.decay_mode || 'resting')},`);
        lines.push('        },');
      } else if (burst === 'clusters') {
        lines.push('        burst = "clusters",');
      } else {
        lines.push('        burst = "nothing",');
      }
    }

    if (lines.length === missileStart + 1) {
      // Nothing to override: leave the .wep record untouched.
      lines.pop();
    } else {
      lines.push('      },');
    }

    // Roaming sheep art is a top-level `sheep` group, not part of `missile`.
    const roamFlightOne = project.roamConfig?.flight_1 ?? 0;
    const roamFlightTwo = project.roamConfig?.flight_2 ?? 0;
    const sheepTouched =
      !!baseline &&
      !same(
        { flight_1: roamFlightOne, flight_2: roamFlightTwo },
        {
          flight_1: baseline.roamConfig?.flight_1,
          flight_2: baseline.roamConfig?.flight_2,
        }
      );
    // `sheep_sprites` installs both sheets and writes these two fields itself
    // after the record tables are applied, so numbering them here would only be
    // overwritten (and a 0 would look like it did something).
    const builderOwnsRoamFlight = builderOn && action === 'roam';
    const roamSheetsOwnFlyingState = roamSheetsOwnFlight(project);
    // A stock-based project has no baseline and starts at 0/0, so writing the
    // group on "no baseline" alone would delete WA's flying art on an untouched
    // weapon. Only an explicit id, a changed import, or the builder owning the
    // state writes it.
    const writesSheep =
      builderOwnsRoamFlight ||
      !!roamFlightState ||
      sheepTouched ||
      roamFlightOne !== 0 ||
      roamFlightTwo !== 0;
    if (action === 'roam' && !roamSheetsOwnFlyingState && writesSheep) {
      lines.push('      sheep = {');
      // A builder sheet is drawn by its follower, so WA's two flown sprites
      // have to go or they draw underneath it. `missile.sprite` is untouched:
      // for roaming it is the walking pose, not flight art.
      const flightOne = builderOwnsRoamFlight
        ? 0
        : roamFlightState?.assigned.roam_flight_1 !== undefined
          ? roamFlightState.assigned.roam_flight_1
          : roamFlightOne;
      const flightTwo = builderOwnsRoamFlight
        ? 0
        : roamFlightState?.assigned.roam_flight_2 !== undefined
          ? roamFlightState.assigned.roam_flight_2
          : roamFlightTwo;
      lines.push(`        flight_1 = ${flightOne},`);
      lines.push(`        flight_2 = ${flightTwo},`);
      lines.push('      },');
    }

    // Clusters block. `clusters.bit` is the child missile body, so it takes
    // the same action groups as `missile` (bounce/homing), not just a damage
    // number. The `.wep` importer decodes the child action at 0x168.
    if (
      burst === 'clusters' &&
      (burstTouched ||
        clustletTouched ||
        clusterBitTrailArt ||
        bitRoleActive ||
        !!homingBitState ||
        digState?.scope === 'bit')
    ) {
      const c = body.clustlet;
      const baseCluster = baseBody?.clustlet;
      lines.push('      clusters = {');
      if (clustletChanged('count')) lines.push(`        count = ${c.count ?? 5},`);
      if (clustletChanged('angle')) lines.push(`        angle = ${c.angle ?? 0},`);
      if (clustletChanged('spread')) lines.push(`        spread = ${c.spread ?? 45},`);
      if (clustletChanged('power')) {
        lines.push(`        launch_power_pct = ${c.power ?? 0},`);
      }
      if (clustletChanged('power_variation')) {
        lines.push(`        power_variation_pct = ${c.power_variation ?? 0},`);
      }

      const bitAction =
        c.bit_action ??
        (c.homing !== 'off' ? 'homing' : c.contact === 'bounce' ? 'bounce' : 'none');
      // `clustletChanged` already covers a bit action switch (it is the same
      // shared-slab problem as the primary's `fullGroup`).
      const bitRoamChanged = (key: keyof RoamActionConfig) =>
        bitActionChangedEarly || !same(c.roam?.[key], baseCluster?.roam?.[key]);
      const bitDigChanged = (key: keyof DigActionConfig) =>
        bitActionChangedEarly || !same(c.dig?.[key], baseCluster?.dig?.[key]);

      const bitTouched = [
        'bit_action',
        'roam',
        'dig',
        'sprite',
        'sprite_count',
        'animation',
        'damage',
        'explosion_bias',
        'explosion_push_pct',
        'explosion_variation',
        'gravity_pct',
        'wind_pct',
        'speed_pct',
        'countdown_ms',
        'fuse',
        'flight_sound',
        'explosion_sound_enabled',
        'explosion_sound',
        'explosion_sound_before',
        'explode_on_space',
        'ends_on_contact',
        'homing',
        'homing_arm_ms',
        'homing_time_ms',
        'homing_sprite',
        'homing_animation',
        'homing_trail_sprite',
        'homing_trail_power',
        'homing_trail_speed',
        'homing_trail_bubbles',
        'trail',
        'trail_power',
        'trail_speed',
        'trail_bubbles',
        'contact',
        'bounce_explode',
        'bounce_power',
        'bounces',
        'bounciness',
        'bounce_hits',
        'bounce_terrain_keep_speed_pct',
        'bounce_sound',
        'bounce_contact_sides',
        'bounce_extra_reverse_chance_pct',
        'bounce_explosion_bias',
        'bounce_explosion_push_pct',
        'bounce_explosion_variation',
      ].some((key) => clustletChanged(key as keyof ClustletConfig));

      if (
        bitTouched ||
        bitActionChangedEarly ||
        clusterBitTrailArt ||
        bitRoleActive ||
        !!homingBitState ||
        digState?.scope === 'bit'
      ) {
        lines.push('        bit = {');
        if (bitActionChangedEarly) lines.push(`          action = ${luaQuote(bitAction)},`);

        if (bitRoleActive) {
          // The builder's classifier reads `m.sprite` at first sight; a zero
          // bit sprite would classify as the primary. Keep a real stock id and
          // one sheet id (`sprite_count` counts ids, not frames).
          const raw = String(c.sprite ?? '');
          const numeric = Number(raw);
          const unusable =
            !raw ||
            raw === '0' ||
            raw.includes('/') ||
            (Number.isFinite(numeric) && numeric === 0);
          if (unusable) lines.push('          sprite = "clustlet",');
          lines.push('          sprite_count = 1,');
        } else if (clustletChanged('sprite')) {
          const s = c.sprite;
          if (s === '' || s === '0') lines.push('          sprite = 0,');
          else if (!isNaN(Number(s))) lines.push(`          sprite = ${Number(s)},`);
          else lines.push(`          sprite = ${luaQuote(String(s))},`);
        }
        if (!bitRoleActive && clustletChanged('sprite_count')) {
          // `sprite_count` counts sprite ids, and WA divides by it: a record
          // that makes bits with 0 here divides by zero (the engine's own note
          // on `c_sprite_count`). One sheet is the safe floor.
          lines.push(`          sprite_count = ${Math.max(1, c.sprite_count ?? 0)},`);
        }
        if (clustletChanged('animation')) {
          lines.push(`          animation = ${c.animation ?? 0},`);
        }

        if (
          clusterBitTrailArt ||
          clustletChanged('trail') ||
          clustletChanged('trail_power') ||
          clustletChanged('trail_speed') ||
          clustletChanged('trail_bubbles')
        ) {
          lines.push('          trail = {');
          const t = c.trail;
          if (clusterBitTrailArt) {
            // Pack image: `clusters.bit.trail.sprite` accepts a bundle path
            // (unlike `bit.sprite`, which only takes stock ids in the record).
            // The engine loads the sheet for this weapon and writes its id in.
            lines.push(`            sprite = ${luaQuote(clusterBitTrailArt)},`);
          } else if (!t || t === 'none' || t === '0') {
            lines.push('            sprite = 0,');
          } else {
            // Same rule as the primary's trail: an unknown name would be read
            // as a bundle path and break the install.
            const bitTrailSprite = resolveStockSprite(t);
            if (typeof bitTrailSprite === 'number') {
              lines.push(`            sprite = ${bitTrailSprite},`);
            } else if (typeof bitTrailSprite === 'string') {
              lines.push(`            sprite = ${luaQuote(bitTrailSprite)},`);
            }
          }
          if (clustletChanged('trail_power')) {
            lines.push(`            power = ${c.trail_power ?? 0},`);
          }
          if (clustletChanged('trail_speed')) {
            lines.push(`            speed = ${c.trail_speed ?? 0},`);
          }
          if (clustletChanged('trail_bubbles')) {
            lines.push(`            bubbles_per_second = ${c.trail_bubbles ?? 0},`);
          }
          lines.push('          },');
        }

        if (
          clustletChanged('damage') ||
          clustletChanged('explosion_bias') ||
          clustletChanged('explosion_push_pct') ||
          clustletChanged('explosion_variation')
        ) {
          lines.push('          explosion = {');
          if (clustletChanged('damage')) {
            lines.push(`            power = ${c.damage ?? 30},`);
          }
          if (clustletChanged('explosion_bias')) {
            lines.push(`            bias = ${c.explosion_bias ?? 0},`);
          }
          if (clustletChanged('explosion_push_pct')) {
            lines.push(`            push_pct = ${c.explosion_push_pct ?? 100},`);
          }
          if (clustletChanged('explosion_variation')) {
            lines.push(`            variation = ${c.explosion_variation ?? 0},`);
          }
          lines.push('          },');
        }
        // Emit a value whenever it differs from the imported baseline, even
        // when it equals the API's default: the base record may not.
        if (clustletChanged('speed_pct')) {
          lines.push(`          speed_pct = ${c.speed_pct ?? 100},`);
        }
        if (clustletChanged('gravity_pct')) {
          lines.push(`          gravity_pct = ${c.gravity_pct},`);
        }
        if (clustletChanged('wind_pct')) {
          lines.push(`          wind_pct = ${c.wind_pct},`);
        }
        if (clustletChanged('countdown_ms')) {
          lines.push(`          countdown = ${c.countdown_ms ?? 0},`);
        }
        if (clustletChanged('fuse')) {
          lines.push(`          fuse = ${c.fuse ?? 0},`);
        }
        if (clustletChanged('flight_sound')) {
          lines.push(`          flight_sound = ${c.flight_sound ?? 0},`);
        }
        if (
          clustletChanged('explosion_sound_enabled') ||
          clustletChanged('explosion_sound') ||
          clustletChanged('explosion_sound_before')
        ) {
          lines.push('          explosion_sound = {');
          lines.push(
            `            enabled = ${c.explosion_sound_enabled ? 'true' : 'false'},`
          );
          if (clustletChanged('explosion_sound')) {
            lines.push(`            sound = ${c.explosion_sound ?? 0},`);
          }
          if (clustletChanged('explosion_sound_before')) {
            lines.push(`            before = ${c.explosion_sound_before ?? 0},`);
          }
          lines.push('          },');
        }
        if (clustletChanged('explode_on_space')) {
          lines.push(`          explode_on_space = ${c.explode_on_space ? 'true' : 'false'},`);
        }
        if (clustletChanged('ends_on_contact')) {
          const cEndsOnContact = luaMaskTable(c.ends_on_contact as Record<string, unknown>);
          if (cEndsOnContact !== null) {
            lines.push(`          ends_on_contact = ${cEndsOnContact},`);
          }
        }

        const bounceTouched = [
          'contact',
          'bounciness',
          'bounces',
          'bounce_explode',
          'bounce_hits',
          'bounce_terrain_keep_speed_pct',
          'bounce_sound',
          'bounce_contact_sides',
          'bounce_extra_reverse_chance_pct',
          'bounce_explosion_bias',
          'bounce_explosion_push_pct',
          'bounce_explosion_variation',
        ].some((key) => clustletChanged(key as keyof ClustletConfig));
        if (bitAction === 'bounce' && bounceTouched) {
          lines.push('          bounce = {');
          if (clustletChanged('bounciness')) {
            lines.push(`            bounciness = ${c.bounciness ?? 0},`);
          }
          if (clustletChanged('bounce_terrain_keep_speed_pct')) {
            lines.push(
              `            terrain_keep_speed_pct = ${c.bounce_terrain_keep_speed_pct ?? 75},`
            );
          }
          if (clustletChanged('bounce_sound')) {
            lines.push(`            sound = ${c.bounce_sound ?? 0},`);
          }
          if (clustletChanged('bounce_contact_sides')) {
            lines.push(`            contact_sides = ${c.bounce_contact_sides ?? 0},`);
          }
          if (clustletChanged('bounce_extra_reverse_chance_pct')) {
            lines.push(
              `            extra_reverse_chance_pct = ${c.bounce_extra_reverse_chance_pct ?? 0},`
            );
          }
          if (clustletChanged('bounces')) {
            lines.push(`            max_bounces = ${c.bounces ?? 0},`);
          }
          if (
            clustletChanged('bounce_explode') ||
            clustletChanged('bounce_power') ||
            clustletChanged('bounce_explosion_bias') ||
            clustletChanged('bounce_explosion_push_pct') ||
            clustletChanged('bounce_explosion_variation')
          ) {
            lines.push('            explosion = {');
            if (
              clustletChanged('bounce_explode') ||
              clustletChanged('bounce_power')
            ) {
              lines.push(`              power = ${c.bounce_explode ? (c.bounce_power ?? 0) : 0},`);
            }
            if (clustletChanged('bounce_explosion_bias')) {
              lines.push(`              bias = ${c.bounce_explosion_bias ?? 0},`);
            }
            if (clustletChanged('bounce_explosion_push_pct')) {
              lines.push(`              push_pct = ${c.bounce_explosion_push_pct ?? 100},`);
            }
            if (clustletChanged('bounce_explosion_variation')) {
              lines.push(`              variation = ${c.bounce_explosion_variation ?? 0},`);
            }
            lines.push('            },');
          }
          if (clustletChanged('bounce_hits')) {
            const cBounceHits = luaMaskTable(c.bounce_hits as Record<string, unknown>);
            if (cBounceHits !== null) {
              lines.push(`            hits = ${cBounceHits},`);
            }
          }
          lines.push('          },');
        }

        if (
          bitAction === 'homing' &&
          (!!homingBitState ||
            bitHomingBuilder ||
            clustletChanged('homing') ||
            clustletChanged('homing_arm_ms') ||
            clustletChanged('homing_time_ms') ||
            clustletChanged('homing_sprite') ||
            clustletChanged('homing_animation') ||
            clustletChanged('homing_trail_sprite') ||
            clustletChanged('homing_trail_power') ||
            clustletChanged('homing_trail_speed') ||
            clustletChanged('homing_trail_bubbles'))
        ) {
          lines.push('          homing = {');
          if (clustletChanged('homing')) {
            lines.push(`            kind = ${luaQuote(c.homing)},`);
          }
          const bitHomingSprite = bitHomingBuilder
            ? 0
            : homingBitState?.assigned.bit_homing_sprite !== undefined
              ? homingBitState.assigned.bit_homing_sprite
              : clustletChanged('homing_sprite')
                ? c.homing_sprite ?? 0
                : undefined;
          if (bitHomingSprite !== undefined) {
            lines.push(`            sprite = ${bitHomingSprite},`);
          }
          if (clustletChanged('homing_animation')) {
            lines.push(`            animation = ${c.homing_animation ?? 0},`);
          }
          if (clustletChanged('homing_arm_ms')) {
            lines.push(`            arm = ${c.homing_arm_ms ?? 1000},`);
          }
          if (clustletChanged('homing_time_ms')) {
            lines.push(`            time = ${c.homing_time_ms ?? 8000},`);
          }
          if (
            clustletChanged('homing_trail_sprite') ||
            clustletChanged('homing_trail_power') ||
            clustletChanged('homing_trail_speed') ||
            clustletChanged('homing_trail_bubbles')
          ) {
            lines.push('            trail = {');
            if (clustletChanged('homing_trail_sprite')) {
              lines.push(`              sprite = ${c.homing_trail_sprite ?? 0},`);
            }
            if (clustletChanged('homing_trail_power')) {
              lines.push(`              power = ${c.homing_trail_power ?? 0},`);
            }
            if (clustletChanged('homing_trail_speed')) {
              lines.push(`              speed = ${c.homing_trail_speed ?? 0},`);
            }
            if (clustletChanged('homing_trail_bubbles')) {
              lines.push(`              bubbles_per_second = ${c.homing_trail_bubbles ?? 0},`);
            }
            lines.push('            },');
          }
          lines.push('          },');
        }

        if (
          bitAction === 'roam' &&
          c.roam &&
          (clustletChanged('bit_action') || clustletChanged('roam'))
        ) {
          const r = c.roam;
          lines.push('          roam = {');
          if (bitRoamChanged('walk_speed')) {
            lines.push(`            walk_speed = ${r.walk_speed ?? 2},`);
          }
          if (bitRoamChanged('step_height')) {
            lines.push(`            step_height = ${r.step_height ?? 4},`);
          }
          if (bitRoamChanged('terrain_offset')) {
            lines.push(`            terrain_offset = ${r.terrain_offset ?? 0},`);
          }
          if (bitRoamChanged('hits')) {
            const hits = luaMaskTable(r.hits as Record<string, unknown>);
            if (hits !== null) lines.push(`            hits = ${hits},`);
          }
          if (bitRoamChanged('flight_hits')) {
            const hits = luaMaskTable(r.flight_hits as Record<string, unknown>);
            if (hits !== null) lines.push(`            flight_hits = ${hits},`);
          }
          if (
            bitRoamChanged('edge_jump_angle_deg') ||
            bitRoamChanged('edge_jump_speed') ||
            bitRoamChanged('edge_jump_sound')
          ) {
            lines.push('            edge_jump = {');
            if (bitRoamChanged('edge_jump_angle_deg')) {
              lines.push(`              angle_deg = ${r.edge_jump_angle_deg ?? 0},`);
            }
            if (bitRoamChanged('edge_jump_speed')) {
              lines.push(`              speed = ${r.edge_jump_speed ?? 0},`);
            }
            if (bitRoamChanged('edge_jump_sound')) {
              lines.push(`              sound = ${r.edge_jump_sound ?? 0},`);
            }
            lines.push('            },');
          }
          if (
            bitRoamChanged('jump_angle_deg') ||
            bitRoamChanged('jump_speed') ||
            bitRoamChanged('jump_sound')
          ) {
            lines.push('            jump = {');
            if (bitRoamChanged('jump_angle_deg')) {
              lines.push(`              angle_deg = ${r.jump_angle_deg ?? 0},`);
            }
            if (bitRoamChanged('jump_speed')) {
              lines.push(`              speed = ${r.jump_speed ?? 0},`);
            }
            if (bitRoamChanged('jump_sound')) {
              lines.push(`              sound = ${r.jump_sound ?? 0},`);
            }
            lines.push('            },');
          }
          if (
            bitRoamChanged('gas_start_delay_ms') ||
            bitRoamChanged('gas_poison_power') ||
            bitRoamChanged('gas_animal_sprite')
          ) {
            lines.push('            gas = {');
            if (bitRoamChanged('gas_start_delay_ms')) {
              lines.push(`              start_delay_ms = ${r.gas_start_delay_ms ?? 0},`);
            }
            if (bitRoamChanged('gas_poison_power')) {
              lines.push(`              poison_power = ${r.gas_poison_power ?? 0},`);
            }
            if (bitRoamChanged('gas_animal_sprite')) {
              lines.push(`              animal_sprite = ${r.gas_animal_sprite ?? 0},`);
            }
            lines.push('            },');
          }
          lines.push('          },');
        }

        if (
          bitAction === 'dig' &&
          (zeroBitDig || c.dig || digState?.scope === 'bit') &&
          (zeroBitDig ||
            clustletChanged('bit_action') ||
            clustletChanged('dig') ||
            digState?.scope === 'bit')
        ) {
          const d = c.dig ?? {
            sound: 90,
            dive_sprite: 0,
            sprite_1: 0,
            sprite_2: 0,
            sprite_3: 0,
          };
          const digBitState = digState?.scope === 'bit' ? digState : undefined;
          const nativeBitDig = builderOn && !digUsesBuilder;
          const bitRows: string[] = [];
          const bitDigField = (
            field: 'dig_dive' | 'dig_1' | 'dig_2' | 'dig_3',
            key: 'dive_sprite' | 'sprite_1' | 'sprite_2' | 'sprite_3',
            name: string
          ) => {
            const assigned = digBitState?.assigned[field];
            const value =
              assigned !== undefined
                ? assigned
                : c.dig && bitDigChanged(key)
                  ? d[key] ?? 0
                  : undefined;
            const row = digSpriteRow(value, zeroBitDig, nativeBitDig);
            if (row !== undefined) bitRows.push(`            ${name} = ${row},`);
          };
          bitDigField('dig_dive', 'dive_sprite', 'dive_sprite');
          bitDigField('dig_1', 'sprite_1', 'sprite_1');
          bitDigField('dig_2', 'sprite_2', 'sprite_2');
          bitDigField('dig_3', 'sprite_3', 'sprite_3');
          if (zeroBitDig || (c.dig && bitDigChanged('sound')) || bitRows.length > 0) {
            lines.push('          dig = {');
            if (zeroBitDig || (c.dig && bitDigChanged('sound'))) {
              lines.push(`            sound = ${d.sound ?? 90},`);
            }
            lines.push(...bitRows);
            lines.push('          },');
          }
        }

        lines.push('        },');
      }
      lines.push('      },');
    }

    // Air strike header: the plane drops `strike.count` munitions, whose body
    // is the `missile` / `clusters` tables above (the engine reads them from
    // the shifted strike slab). `strike.plane` is the plane's sprite.
    if (project.fireType === 'cursor') {
      const strikeTouched =
        !baseline ||
        overrideTouched(
          'strike.count',
          'strike.spacing',
          'strike.munition_speed',
          'strike.plane',
          'strike.plane_sound',
          'strike.munition'
        );
      if (strikeTouched) {
        lines.push('      strike = {');
        const count = override('strike.count');
        if (count !== undefined) lines.push(`        count = ${count},`);
        const spacing = override('strike.spacing');
        if (spacing !== undefined) lines.push(`        spacing = ${spacing},`);
        const munitionSpeed = override('strike.munition_speed');
        if (munitionSpeed !== undefined) {
          lines.push(`        munition_speed = ${munitionSpeed},`);
        }
        const plane = override('strike.plane');
        if (plane !== undefined) {
          if (plane === '' || plane === '0') lines.push('        plane = 0,');
          else if (!isNaN(Number(plane))) lines.push(`        plane = ${Number(plane)},`);
          else lines.push(`        plane = ${luaQuote(String(plane))},`);
        }
        const planeSound = override('strike.plane_sound');
        if (planeSound !== undefined) lines.push(`        plane_sound = ${planeSound},`);
        const munition = override('strike.munition');
        if (munition !== undefined) {
          if (munition === 0 || munition === 'mines') {
            lines.push('        munition = "mines",');
          } else if (munition === 2 || munition === 'missiles') {
            lines.push('        munition = "missiles",');
          } else {
            lines.push(`        munition = ${munition},`);
          }
        }
        lines.push('      },');
      }
    }
  }

  // Native family parameters that are not part of `missile`/`clusters`: the
  // firing header's launch power, and the per-family or per-special-subtype
  // groups (`arrow`, `fire_punch`, `drill`, `jet_pack`, `parachute`,
  // `baseball_bat`, `utility`). Each is a flat table of scalars, so one loop
  // covers them; a value equal to the baseline is left to the engine.
  const nativeGroupRows = (group: string, fields: string[]): string[] => {
    const rows: string[] = [];
    for (const field of fields) {
      const value = override(`${group}.${field}`);
      if (value === undefined) continue;
      if (typeof value === 'string') rows.push(`        ${field} = ${luaQuote(value)},`);
      else if (typeof value === 'boolean') rows.push(`        ${field} = ${value ? 'true' : 'false'},`);
      else if (typeof value === 'number' && Number.isFinite(value)) {
        rows.push(`        ${field} = ${formatNumber(value)},`);
      }
    }
    return rows;
  };
  const NATIVE_GROUPS: { group: string; fields: string[] }[] = [
    { group: 'fires', fields: ['launch_power_pct', 'creates_projectile'] },
    { group: 'arrow', fields: ['damage'] },
    { group: 'baseball_bat', fields: ['damage', 'knockback_scale'] },
    { group: 'fire_punch', fields: ['damage', 'knockback'] },
    { group: 'drill', fields: ['duration_ms'] },
    { group: 'jet_pack', fields: ['fuel'] },
    { group: 'parachute', fields: ['wind_pct'] },
    { group: 'utility', fields: ['effect'] },
  ];
  for (const { group, fields } of NATIVE_GROUPS) {
    const rows = nativeGroupRows(group, fields);
    if (rows.length === 0) continue;
    lines.push(`      ${group} = {`);
    lines.push(...rows);
    lines.push('      },');
  }

  // Hold Art
  if (usesHold) {
    lines.push('      worm_sprites = holds.PX_POSTURE,');
    if (usesHoldArt) {
      // The table itself is declared before the claim (px_hold_art needs it as
      // a table too); the engine sees the same values here.
      lines.push('      hold = hold,');
    } else {
      lines.push('      hold = {');
      for (const row of holdRows) lines.push(`        ${row}`);
      lines.push('      },');
    }
  }

  // Custom Lua callback (only when checkbox is explicitly enabled)
  if (project.enableCustomLua && parsedLua.remainingSnippet && parsedLua.remainingSnippet.trim()) {
    lines.push('      -- Custom weapon callbacks');
    lines.push(
      parsedLua.remainingSnippet
        .split('\n')
        .map((l) => (l ? `      ${l}` : ''))
        .join('\n')
    );
  }

  // Sequential fire: the first shot leaves from `on_fire`, the rest from
  // fire_seq's hidden timer, which holds WA's shot counters so the worm stays
  // in the firing pose. The pose's animation and sound are the record's own
  // `fires.subtype` (chosen in Flight & Physics); nothing is forced here, so a
  // burst no longer inherits the Minigun's subtype (shells + firing loop).
  if (usesFireSequence) {
    const f = fireSequence!;
    const count = Math.max(1, Math.round(f.count));
    const delay = Math.max(1, Math.round(f.delay));
    const speed = formatNumber(f.speed);
    const standoff = formatNumber(Math.max(0, f.standoff));
    const spreadX = formatNumber(Math.max(0, f.spreadX));
    const spreadY = formatNumber(Math.max(0, f.spreadY));
    // `w.x + 0` / `w.y + -3` read badly; emit a signed term only when nonzero.
    const offsetTerm = (value: number) => {
      const n = Number(value) || 0;
      if (n === 0) return '';
      return n > 0 ? ` + ${formatNumber(n)}` : ` - ${formatNumber(-n)}`;
    };
    const offX = offsetTerm(f.offsetX);
    const offY = offsetTerm(f.offsetY);
    const live = f.liveAim;
    const shotSound = shotSoundPath
      ? {
          path: shotSoundPath,
          every: Math.max(1, Math.round(customSounds?.shotEvery ?? 1)),
          priority: Math.max(0, Math.round(customSounds?.shotPriority ?? 8)),
        }
      : null;
    lines.push('      -- Sequential fire (`wf-lib/fire_seq`): one trigger, a burst.');
    lines.push('      on_fire = function(ev)');
    if (!live) {
      // Lock the aim to the moment the trigger was pulled.
      lines.push('        local dx, dy = seq_dir(ev.worm)');
    }
    const call = f.mode === 'actors' ? 'fire_sequential_actor' : 'fire_seq_mis';
    lines.push(`        seq.${call}{`);
    if (f.mode !== 'actors') {
      lines.push('          weapon = ctx.id,');
    }
    lines.push('          owner = ev.worm,');
    if (f.cancelOnWeaponChange || f.mode === 'actors') {
      // Actors have no default: without it the burst ends on the first tick.
      lines.push('          cancel_weapon = ctx.id,');
    }
    lines.push(`          count = ${count}, delay = ${delay},`);
    if (f.mode === 'actors') {
      if (f.actorSprite.trim()) {
        lines.push(`          sprite = ${luaQuote(f.actorSprite.trim())},`);
      }
      lines.push(
        `          gravity = ${f.actorGravity ? 'true' : 'false'}, collide = ${
          f.actorCollide ? 'true' : 'false'
        }, persist = ${f.actorPersist ? 'true' : 'false'},`,
      );
    }
    if (f.spreadX > 0 || f.spreadY > 0) {
      lines.push(`          spread = { x = ${spreadX}, y = ${spreadY} },`);
    }
    if (f.standoff > 0) {
      lines.push(`          standoff = ${standoff},`);
    }
    if (live) {
      lines.push(`          x = function(i, w) return w.x${offX} end,`);
      lines.push(`          y = function(i, w) return w.y${offY} end,`);
      lines.push(`          vx = function(i, w) local dx = seq_dir(w) return dx * ${speed} end,`);
      lines.push(`          vy = function(i, w) local _, dy = seq_dir(w) return dy * ${speed} end,`);
    } else {
      lines.push(`          x = ev.worm.x${offX}, y = ev.worm.y${offY},`);
      lines.push(`          vx = dx * ${speed}, vy = dy * ${speed},`);
    }
    if (shotSound) {
      const every = shotSound.every;
      const guard = every > 1 ? `if i % ${every} == 0 then ` : '';
      const close = every > 1 ? ' end' : '';
      lines.push(
        `          on_shot = function(i, w) ${guard}wa.sound.play(w, ${luaQuote(
          shotSound.path,
        )}, ${shotSound.priority})${close} end,`,
      );
    }
    lines.push('        }');
    lines.push('      end,');
  }

  // Unified explosion hook: merges effects-SDK burst, custom WAV, and custom Lua logic.
  // The claim's `on_explode` runs before WA's own blast, which is the frame PX draws on:
  // `effect` mode leaves the native blast alone, `blast` mode has already
  // silenced it in the record above, so the custom explosion does the damage,
  // push, crater and sound and then draws the same burst.
  const hasExplodeHook = usesExplosionEffect || usesExplosionSound || hasCustomExplodeCode;
  if (hasExplodeHook) {
    const parts = [
      usesExplosionEffect ? 'effects-SDK burst' : '',
      usesExplosionSound ? 'custom WAV' : '',
      hasCustomExplodeCode ? 'custom Lua logic' : '',
    ].filter(Boolean).join(' + ');
    lines.push(`      -- Explosion hook: merged ${parts}.`);
    lines.push('      on_explode = { on = function(ev)');
    if (usesExplosionSound) {
      // `ev.worm` is the firing worm; WA needs an entity for a positional
      // custom voice, and `wa.sound.play` takes its handle.
      lines.push(
        `        if ev.worm then wa.sound.play(ev.worm, ${luaQuote(
          explosionSoundPath!,
        )}, ${Math.max(0, Math.round(customSounds?.explosionPriority ?? 10))}) end`,
      );
    }
    if (usesExplosionEffect) {
      const e = explosionEffect!;
      const { r, g, b } = hexToRgb(e.color);
      const fxField = (indent: string, name: string, value: string) =>
        `${indent}${name} = ${value},`;
      const burstRows = (indent: string): string[] => {
        const rows = [
          fxField(indent, 'radius', formatNumber(Math.max(1, e.radius))),
          `${indent}r = ${r}, g = ${g}, b = ${b},`,
          fxField(indent, 'thickness', formatNumber(Math.max(0.5, e.thickness))),
          // The sharp core pass. The SDK derives it from `thickness` today
          // (0.9 x, floored at 1.8 half-width); the key is written when the
          // author sets one so a build that reads it draws the same ring.
          ...(e.core && e.core > 0
            ? [fxField(indent, 'core', formatNumber(Math.max(2.5, e.core)))]
            : []),
          fxField(indent, 'noise', formatNumber(Math.max(0, e.noise))),
          fxField(indent, 'duration', String(Math.max(1, Math.round(e.duration)))),
          fxField(indent, 'fade', formatNumber(e.fade)),
          fxField(indent, 'grow', formatNumber(Math.max(0, e.grow))),
          fxField(indent, 'live', String(Math.max(1, Math.round(e.live)))),
          fxField(
            indent,
            'ellipse',
            `{ ${formatNumber(e.ellipseX)}, ${formatNumber(e.ellipseY)} }`,
          ),
        ];
        if (Math.round(e.segments) > 0) {
          rows.push(fxField(indent, 'segments', String(Math.round(e.segments))));
        }
        // `smoke` is a nested spec: a bare `true` would inherit the preset's
        // fixed blue numbers, so hand it the same colour as the ring.
        rows.push(
          e.smoke
            ? `${indent}smoke = { count = 7, kinds = 2, r = ${r}, g = ${g}, b = ${b} },`
            : `${indent}smoke = false,`,
        );
        // PX's BufferChange re-noise and recolour at frame 16 (fade -0.85).
        rows.push(
          e.rebuffer
            ? `${indent}rebuffer = { at = 16, noise = ${formatNumber(
                Math.max(1.8, e.noise * 1.6),
              )}, r = ${r}, g = ${g}, b = ${b}, fade = -0.85 },`
            : `${indent}rebuffer = false,`,
        );
        return rows;
      };

      if (e.mode === 'blast') {
        const blastRows = [
          '          x = ev.x, y = ev.y, owner = ev.worm,',
          fxField('          ', 'damage', formatNumber(Math.max(0, Math.round(e.damage)))),
          fxField('          ', 'push', formatNumber(Math.max(0, Math.round(e.push)))),
        ];
        const hole = Math.max(0, Math.round(e.hole));
        if (hole > 0) {
          blastRows.push(fxField('          ', 'hole', String(hole)));
        } else {
          blastRows.push('          destroy = false,');
        }
        // PX's own default is a random 69-71 blast; `sound = true` asks for it.
        // A pack WAV already covers the blast, so the native one stays off.
        if (!usesExplosionSound) {
          if (e.sound === 'default') blastRows.push('          sound = true,');
          else if (typeof e.sound === 'number') blastRows.push(`          sound = ${e.sound},`);
        }
        lines.push('        blast.explode{');
        for (const row of blastRows) lines.push(row);
        lines.push('          effect = {');
        for (const row of burstRows('            ')) lines.push(row);
        lines.push('          },');
        lines.push('        }');
      } else {
        lines.push('        fx.burst{');
        lines.push('          x = ev.x, y = ev.y,');
        for (const row of burstRows('          ')) lines.push(row);
        lines.push('        }');
      }
    }
    if (hasCustomExplodeCode) {
      if (parsedLua.paramName !== 'ev') {
        lines.push(`        local ${parsedLua.paramName} = ev`);
      }
      for (const line of reindentCode(parsedLua.onExplodeBody, '        ')) {
        lines.push(line);
      }
    }
    lines.push('      end },');
  }

  if (extraAssignments.length > 0) {
    lines.push('    }');
    lines.push('    -- Values the source bundle declared, over the base record.');
    lines.push(...extraAssignments);
    lines.push('    wa.weapons.replace(rec)');
  } else {
    lines.push('    }');
  }

  if (usesHoldArt) {
    // WA draws the held sheet on the firing frames only while `h.firing` is
    // set, and the engine sets that on the fire message alone; a fire_seq burst
    // repeats the shot without one, so 0x6A/0x6B would hide it every other
    // frame. The helper redraws exactly those two states.
    lines.push('    -- Keep the held art on WA\'s repeat-fire frames (0x6A/0x6B).');
    lines.push('    hold_art.add(hold)');
    lines.push('');
  }

  // Effects-SDK ribbon trail (`wf-lib/effects/trail`): PX's effect manager
  // samples the round's position on game frames and draws a tapering ribbon,
  // so its colour, widths and length are ours to choose. Attached on the
  // round's first missile frame, exactly as the PX ports do (famas, megashark,
  // px_ninja_star): WA fires this record itself, so there is no
  // `wa.weapons.launch` id to hand `trail.add`.
  if (usesRibbonTrail) {
    const t = ribbonTrail!;
    const { r, g, b } = hexToRgb(t.color);
    const max = Math.max(2, Math.round(t.max));
    const every = Math.max(1, Math.round(t.every));
    const vanish = Math.max(1, Math.round(t.vanish));
    // An exploding bundle already installed the SDK (fx.install runs trail.install).
    if (!usesExplosionEffect) lines.push('    trail.install()');
    lines.push('    local TRAIL = {');
    lines.push(`      max = ${max}, every = ${every}, vanish = ${vanish},`);
    lines.push(`      core_w = ${formatNumber(Math.max(0, t.coreWidth))},`);
    lines.push(`      glow_w = ${formatNumber(Math.max(0, t.glowWidth))},`);
    lines.push(`      r = ${r}, g = ${g}, b = ${b},`);
    lines.push('    }');
    lines.push('    -- The driver needs an owner: whose turn it is, else any living worm.');
    lines.push('    local function trail_worm()');
    lines.push('      local first');
    lines.push('      for _, w in ipairs(wa.worms.all()) do');
    lines.push('        if w.turn then return w end');
    lines.push('        if not first and w.hp > 0 then first = w end');
    lines.push('      end');
    lines.push('      return first');
    lines.push('    end');
    if (t.target === 'main') {
      // Cluster bits are born where their parent died, while its ribbon is
      // still shedding points, so a first-seen round with a ribbon already
      // live for this weapon is a bit and is left alone. The live ids are an
      // array: `pairs` order is not lockstep-safe (wfcheck's lockstep-pairs).
      lines.push('    local trailed = {}');
      lines.push('    local function trail_live()');
      lines.push('      for i = 1, #trailed do');
      lines.push('        if trail.has(trailed[i]) then return true end');
      lines.push('      end');
      lines.push('      return false');
      lines.push('    end');
    }
    lines.push('    local seen = {}');
    lines.push('    wa.on.missile_frame(function(m)');
    lines.push('      if m.weapon ~= ctx.id or m.phase ~= "pre" then return end');
    lines.push('      if seen[m.id] then return end');
    lines.push('      seen[m.id] = true');
    if (t.target === 'main') {
      lines.push('      if trail_live() then return end');
    }
    if (t.target === 'main') {
      lines.push('      if trail.add(m.id, trail_worm(), TRAIL) then trailed[#trailed + 1] = m.id end');
    } else {
      lines.push('      trail.add(m.id, trail_worm(), TRAIL)');
    }
    lines.push('    end)');
    lines.push('');
  }

  // A pack WAV on a fixed interval while the round flies. `wa.on.missile_frame`
  // has no owner handle, so the voice rides the firing worm (whose turn it is,
  // else any living worm): WA's positional sound needs a game entity, and a
  // missile is not one Lua can name. Stored by `m.id` (an array, never
  // `pairs`), because the order must match on every peer.
  if (usesIntervalSound) {
    const s = customSounds!;
    // WA's game frame is 20 ms; the module ticks on the `pre` frame.
    const every = Math.max(1, Math.round(s.intervalMs / 20));
    const delay = Math.max(0, Math.round(s.intervalDelayMs / 20));
    const limit = Math.max(0, Math.round(s.intervalLimit));
    lines.push('    local SOUND = {');
    lines.push(`      path = ${luaQuote(intervalSoundPath!)},`);
    lines.push(
      `      every = ${every}, delay = ${delay}, limit = ${limit}, priority = ${Math.max(
        0,
        Math.round(s.intervalPriority),
      )},`,
    );
    lines.push('    }');
    lines.push('    local sound_ticks = {}');
    lines.push('    local function sound_worm()');
    lines.push('      local first');
    lines.push('      for _, w in ipairs(wa.worms.all()) do');
    lines.push('        if w.turn then return w end');
    lines.push('        if not first and w.hp > 0 then first = w end');
    lines.push('      end');
    lines.push('      return first');
    lines.push('    end');
    lines.push('    wa.on.missile_frame(function(m)');
    lines.push('      if m.weapon ~= ctx.id or m.phase ~= "pre" then return end');
    lines.push('      local t = (sound_ticks[m.id] or 0) + 1');
    lines.push('      sound_ticks[m.id] = t');
    lines.push('      local n = t - SOUND.delay - 1');
    lines.push('      if n < 0 or n % SOUND.every ~= 0 then return end');
    lines.push('      if SOUND.limit > 0 and n / SOUND.every >= SOUND.limit then return end');
    lines.push('      local w = sound_worm()');
    lines.push('      if w then wa.sound.play(w, SOUND.path, SOUND.priority) end');
    lines.push('    end)');
    lines.push('');
  }

  // px_sprite_builder draws the flight sheet with a follower actor and hides
  // WA's missile (`m.sprite = 0`). Its `anim` is PX's ANIM_TYPE, not the
  // record's native `animation`; the two are deliberately kept apart.
  if (usesMissileSprite) {
    const m = project.missileSprite!;
    lines.push('    sb.flight(ctx, {');
    lines.push('      weapon = ctx.id,');
    lines.push(`      sheet = ${luaQuote(missileFlightSheetPath(project))},`);
    lines.push(`      anim = ${luaQuote(m.anim || 'rotation')},`);
    if (m.frames > 1) {
      lines.push(`      cyclical = ${m.frames},`);
    }
    if (m.animSpeed && m.animSpeed !== 1.0) {
      lines.push(`      anim_speed = ${m.animSpeed},`);
    }
    if (m.spinRate && m.spinRate !== 1.0) {
      lines.push(`      spin = ${m.spinRate},`);
    }
    if (m.scale && m.scale !== 1.0) {
      lines.push(`      scale = ${m.scale},`);
    }
    if (m.mirror === false) {
      lines.push('      mirror = false,');
    }
    if (m.z !== undefined && m.z !== 5.0) {
      lines.push(`      z = ${m.z},`);
    }
    // Weapon-wide builder parameters: one size multiplier for every role's
    // sheet, and a rotation offset for art that does not point up.
    if (m.size !== undefined && m.size !== 1) {
      lines.push(`      size = ${formatNumber(m.size)},`);
    }
    if (m.angle) {
      lines.push(`      angle = ${formatNumber(m.angle)},`);
    }

    // Cluster-bit art. `inherit` gives the bits the primary sheet; a builder
    // role gets its own. Anything else leaves WA's bit sprite alone.
    if (bitMode === 'builder') {
      lines.push('      bits = {');
      lines.push(`        sheet = ${luaQuote(bitFlightSheetPath(project))},`);
      for (const row of roleArtRows(project.bitFlight, '        ')) lines.push(row);
      if (bitHomingBuilder) {
        lines.push('        homing = {');
        lines.push(
          `          sheet = ${luaQuote(behaviorStateSheetPath(project, 'homing_bit'))},`,
        );
        lines.push(homingWindowRow(project.body.clustlet, '          '));
        for (const row of roleArtRows(project.behaviorArt!.homing_bit!, '          ')) {
          lines.push(row);
        }
        lines.push('        },');
      }
      lines.push('      },');
    } else if (bitMode === 'inherit') {
      lines.push('      bits = "inherit",');
    }

    // Homing art for the primary: WA arms the missile after `arm` ms and steers
    // it for `time` ms (0 = until it lands), so the builder swaps sheets in
    // that window instead of guessing from a sprite id.
    if (homingBuilder) {
      lines.push('      homing = {');
      lines.push(`        sheet = ${luaQuote(behaviorStateSheetPath(project, 'homing'))},`);
      lines.push(homingWindowRow(project.body, '        '));
      for (const row of roleArtRows(project.behaviorArt!.homing!, '        ')) lines.push(row);
      lines.push('      },');
    }

    // Digging: terrain probes around the nose detect solid land (PX's Bunker
    // Buster test). Emit `dig = true` at defaults, or `dig = { ... }` when the
    // author overrides underground animation parameters (e.g. faster spin/speed).
    if (zeroMainDig || zeroBitDig) {
      const digRows = digArtOverrideRows(project.behaviorArt?.dig, '        ');
      if (digRows.length > 0) {
        lines.push('      dig = {');
        for (const row of digRows) lines.push(row);
        lines.push('      },');
      } else {
        lines.push('      dig = true,');
      }
    }

    // A roaming animal walks until the turn's player presses Space, then
    // flies. The builder owns that flying state: it waits for the press and
    // then draws the sheet (the record's `sheep.flight_1/2` are zeroed above).
    if (project.action === 'roam') {
      lines.push('      roam = true,');
    }

    // Identity debugging: one log line per missile's first frames, so the
    // zero-means-bit convention can be confirmed from the game log.
    if (m.logIdentity) {
      lines.push('      log = true,');
    }

    // Per-behaviour art, only for the states the action/burst really has. The
    // `sig` ids are the same ones written into the record above.
    if (behaviorStates.length > 0) {
      lines.push('      states = {');
      for (const state of behaviorStates) {
        lines.push('        {');
        lines.push(`          scope = ${luaQuote(state.scope)},`);
        lines.push(
          `          sig = ${
            state.sig.length === 1 ? state.sig[0] : `{ ${state.sig.join(', ')} }`
          },`,
        );
        if (state.art.mode === 'native') {
          lines.push('          native = true,');
        } else {
          lines.push(
            `          sheet = ${luaQuote(behaviorStateSheetPath(project, state.def.key))},`,
          );
          for (const row of roleArtRows(state.art, '          ')) lines.push(row);
        }
        lines.push('        },');
      }
      lines.push('      },');
    }
    lines.push('    })');
  }

  lines.push('  end,');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

export function generateModToml(project: WeaponProject): string {
  const modFolder = sanitizeModFolder(project.id);
  const pos = getStockPanelPosition(project.slot);
  const icon = project.customIconFile ? `sprites/${modFolder}/icon.png` : (project.panel_icon || project.slot);
  const usesHold = project.hold && project.hold.enabled;
  // The primary, bit and state roles all come from the WFWS builder, which is
  // its own library bundle (`wfws.sdk`). It depends on `wf.sdk` for `holds`.
  const usesWfws = usesWfwsBuilder(project);
  const bitMode = bitBuilderMode(project);
  const behaviorStates = resolveBehaviorStates(project);
  // The ribbon trail lives in its own library bundle (`effects.sdk`), which
  // exports `wf-lib/effects/trail` and the beam/glow sheets.
  const usesRibbonTrail =
    !!project.ribbonTrail?.enabled &&
    (project.fireType === 'power' || (project.fireType === 'drop' && project.body.fuse));
  // The explosion burst is px_effects, and the optional blast replacement is
  // custom_explosion: both live in the effects SDK. Air strikes are excluded:
  // their bombs have no weapon slot, so the claim hook cannot run.
  const explodesNatively = project.fireType === 'power' || project.fireType === 'drop';
  const usesExplosionEffect =
    !!project.explosionEffect?.enabled && explodesNatively;
  // `wf-lib/fire_seq` is its own library bundle (`px.fire_seq`).
  const usesFireSequence =
    !!project.fireSequence?.enabled &&
    !(project.enableCustomLua && /(?:^|\n)[ \t]*on_fire\s*=/.test(project.customLuaSnippet || '')) &&
    supportsFireSequence(project);

  const lines: string[] = [
    `id = ${luaQuote(project.id)}`,
    `name = ${luaQuote(project.name)}`,
    `version = ${luaQuote(project.version || '0.1.0')}`,
    `author = ${luaQuote(project.author || 'WormForge Creator')}`,
    'api_version = 4',
    'format_version = 2',
  ];

  const dependencies: string[] = [];
  if (usesHold) dependencies.push('wf.sdk');
  if (usesWfws) dependencies.push('wfws.sdk');
  if (usesRibbonTrail || usesExplosionEffect) dependencies.push('effects.sdk');
  if (usesFireSequence) dependencies.push('px.fire_seq');
  // Extra library bundles the author asked for (they may be used from the
  // custom Lua snippet, or by a component this editor does not model).
  for (const dependency of project.extraDependencies || []) {
    const id = (dependency || '').trim();
    if (id && !dependencies.includes(id)) dependencies.push(id);
  }
  if (dependencies.length > 0) {
    lines.push(`dependencies = [${dependencies.map(luaQuote).join(', ')}]`);
  }

  if (project.customIconFile) {
    lines.push(`mod_icon = ${luaQuote(`sprites/${modFolder}/icon.png`)}`);
  }

  const weaponFileName = `${modFolder}.lua`;
  lines.push('');
  lines.push('[[components]]');
  lines.push(`id = ${luaQuote(project.id)}`);
  lines.push('type = "weapon"');
  lines.push(`name = ${luaQuote(project.name)}`);
  lines.push(`description = ${luaQuote(project.description)}`);
  lines.push(`entry = "weapons/${weaponFileName}"`);
  lines.push(`icon = ${luaQuote(icon)}`);
  lines.push(`default_position = { row = ${luaQuote(pos.row)}, column = ${pos.column} }`);

  // Sprites declarations
  const emitted = new Set<string>();
  if (project.missileSprite?.enabled && project.missileSprite.mode === 'custom') {
    const missilePath = missileFlightSheetPath(project);
    emitted.add(missilePath);
    lines.push('');
    lines.push(`[sprites.${luaQuote(missilePath)}]`);
    if (project.missileSprite.frames > 1) lines.push(`frames = ${project.missileSprite.frames}`);
    lines.push(`fps = ${project.missileSprite.fps || 15}`);
    lines.push('play = "loop"');
  }

  // Cluster-bit and behaviour-state sheets drawn by the WFWS builder.
  if (bitMode === 'builder') {
    const bitPath = bitFlightSheetPath(project);
    if (!emitted.has(bitPath)) {
      emitted.add(bitPath);
      lines.push('');
      lines.push(`[sprites.${luaQuote(bitPath)}]`);
      if (project.bitFlight.frames > 1) lines.push(`frames = ${project.bitFlight.frames}`);
      lines.push(`fps = ${project.bitFlight.fps || 15}`);
      lines.push('play = "loop"');
    }
  }
  // A roaming animal's two flying sheets (`sheep_sprites`). WA rotates the
  // flying animal itself and picks the frame from the strip, so the declared
  // frame count is what makes the art turn (PX ships 32). A builder sheet owns
  // the flying state instead, so nothing is declared while it is on.
  const roamSheets = roamSheetsOwnFlight(project) ? roamSheetPaths(project) : null;
  if (roamSheets) {
    for (const [path, asset] of [
      [roamSheets.first, project.roamSheets?.flight1],
      [roamSheets.second, project.roamSheets?.flight2],
    ] as const) {
      if (emitted.has(path)) continue;
      emitted.add(path);
      lines.push('');
      lines.push(`[sprites.${luaQuote(path)}]`);
      const frames = asset?.frames ?? 1;
      if (frames > 1) lines.push(`frames = ${frames}`);
      lines.push('fps = 15');
      lines.push('play = "loop"');
    }
  }

  // Timed homing sheets (`homing` / `bits.homing` art).
  const tomlFlags = wfwsRoleFlags(project);
  for (const [owned, key] of [
    [tomlFlags.homing, 'homing'] as const,
    [tomlFlags.bitHoming, 'homing_bit'] as const,
  ]) {
    if (!owned) continue;
    const statePath = behaviorStateSheetPath(project, key);
    if (emitted.has(statePath)) continue;
    emitted.add(statePath);
    const role = project.behaviorArt![key]!;
    lines.push('');
    lines.push(`[sprites.${luaQuote(statePath)}]`);
    if (role.frames > 1) lines.push(`frames = ${role.frames}`);
    lines.push(`fps = ${role.fps || 15}`);
    lines.push('play = "loop"');
  }
  for (const state of behaviorStates) {
    if (state.art.mode !== 'builder') continue;
    const statePath = behaviorStateSheetPath(project, state.def.key);
    if (emitted.has(statePath)) continue;
    emitted.add(statePath);
    lines.push('');
    lines.push(`[sprites.${luaQuote(statePath)}]`);
    if (state.art.frames > 1) lines.push(`frames = ${state.art.frames}`);
    lines.push(`fps = ${state.art.fps || 15}`);
    lines.push('play = "loop"');
  }

  if (usesHold && project.hold.frames > 1) {
    const sheetPath = holdSheetPath(project);
    emitted.add(sheetPath);
    lines.push('');
    lines.push(`[sprites.${luaQuote(sheetPath)}]`);
    lines.push(`frames = ${project.hold.frames}`);
    lines.push(`fps = ${project.hold.fps || 15}`);
    lines.push('play = "loop"');
  }

  // Sheets uploaded for the fields that accept pack art. The engine slices and
  // times them from these declarations, keyed by the same pack path Lua uses.
  for (const slot of PACK_ART_SLOTS) {
    const asset = project.packArt?.[slot];
    const path = packArtPath(project, slot);
    if (!asset || !path || emitted.has(path)) continue;
    emitted.add(path);
    lines.push('');
    lines.push(`[sprites.${luaQuote(path)}]`);
    // `frames` slices a vertical PNG; a GIF carries its own frame timing.
    if (path.endsWith('.png') && asset.frames > 1) lines.push(`frames = ${asset.frames}`);
    lines.push(`fps = ${asset.fps || 15}`);
    lines.push(`play = ${luaQuote(asset.play || 'loop')}`);
  }

  for (const cs of Object.values(project.customSprites)) {
    if (emitted.has(cs.path)) continue;
    emitted.add(cs.path);
    lines.push('');
    lines.push(`[sprites.${luaQuote(cs.path)}]`);
    if (cs.frames > 1) lines.push(`frames = ${cs.frames}`);
    lines.push(`fps = ${cs.fps || 15}`);
    lines.push(`play = ${luaQuote(cs.play || 'loop')}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function generateProfileToml(project: WeaponProject): string {
  const lines: string[] = [
    `description = ${luaQuote(project.description || `${project.name} test profile.`)}`,
    '',
    '[weapons]',
    `${luaQuote(project.id)} = true`,
    `${luaQuote('stock.' + project.slot)} = true`,
    '"stock.ninja_rope" = true',
    '"stock.skip_go" = true',
    '',
  ];

  if (project.defaults.ammo === -1) {
    lines.push(`[weapon_settings.${luaQuote(project.id)}]`);
    lines.push('ammo = -1');
    lines.push('');
  }

  return lines.join('\n');
}