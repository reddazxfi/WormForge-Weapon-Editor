import {
  BodyConfig,
  BehaviorArtKey,
  ClustletConfig,
  DigActionConfig,
  EmitterConfig,
  FlightRoleArt,
  HoldConfig,
  MeleeSound,
  PackArtSlot,
  PackProject,
  RoamActionConfig,
  WeaponOptionConfig,
  WeaponProject,
} from '../types/weapon';
import { getStockPanelPosition } from '../data/stockWeapons';
import { stockDonor, stockDonorBaseline } from '../data/stockDonors';
import { resolveStockSprite, stockSpriteId } from '../data/stockSprites';
import { supportsFireSequence } from '../data/fireSequence';
import { STAMP_FRAMES, stampFrameForAngle, supportsTerrainStamp } from '../data/terrainStamp';
import { COLLISION_FLAGS } from '../data/recordSchema';
import { meleeStrikes } from '../data/melee';
import { SDK_MODULE_EXPORTS, SDK_MODULE_PREFIXES } from '../data/sdkModules';
import { maskLuaCode, NOT_GENERATED_CLOSE, NOT_GENERATED_OPEN, scanBlockEnd } from './luaText';
import { recordField } from './recordField';
import { defaultArtFor } from './defaultArt';
import {
  DEFAULT_ROAM_TILT,
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

/**
 * The claim hooks whose key is a single function the editor also emits a part of,
 * so a carried one has to be inlined into that function rather than written as a
 * second key: `on_explode` (burst + stamp) and `on_fire` (launch WAV + burst).
 */
const MERGEABLE_HOOKS = new Set(['on_explode', 'on_fire']);

export function sanitizeModFolder(id: string): string {
  const parts = id.trim().split('.');
  const last = parts[parts.length - 1] || 'custom_weapon';
  return last.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'custom_weapon';
}

function luaQuote(str: string): string {
  // `JSON.stringify(undefined)` is `undefined`, not a string, so a missing value
  // would reach the manifest as the bare word `undefined` and make the whole
  // bundle unparseable. Nothing that lands in a manifest is a value the engine
  // can do without: an absent one is the empty string.
  return JSON.stringify(str ?? '');
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
 * A value as one Lua expression. Arrays and tables are written inline, so a
 * record table the reader produced (a list of numbers, a list of tables) is
 * carried through instead of being flattened to `nil`.
 */
function luaInline(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => luaInline(item));
    return `{ ${items.join(', ')} }`;
  }
  if (value && typeof value === 'object') {
    const rows: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === null || entry === undefined) continue;
      const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaQuote(key)}]`;
      rows.push(`${name} = ${luaInline(entry)}`);
    }
    return `{ ${rows.join(', ')} }`;
  }
  return luaValue(value);
}

/**
 * One Lua access path: `rec.missile.sprite`, or `rec["odd-key"].x` when a
 * segment is not an identifier. Building the path as text and joining with `.`
 * produced `rec.["odd-key"]`, which is a syntax error in the whole module, so
 * each segment decides its own form here.
 */
function luaPath(root: string, segments: string[]): string {
  let out = root;
  for (const segment of segments) {
    out += /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
      ? `.${segment}`
      : `[${luaQuote(segment)}]`;
  }
  return out;
}

/**
 * `{ missile: { sprite: 51 } }` -> `rec.missile.sprite = 51`, with a guard for
 * every parent table so a group the generated record did not create still
 * exists. Arrays and tables are written inline; a key that is not an identifier
 * is bracketed at every level it appears in.
 */
function recordAssignments(extra: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const ensured = new Set<string>();

  const ensure = (path: string[]) => {
    for (let i = 1; i <= path.length; i += 1) {
      const target = luaPath('rec', path.slice(0, i));
      if (ensured.has(target)) continue;
      ensured.add(target);
      lines.push(`    ${target} = ${target} or {}`);
    }
  };

  const walk = (value: Record<string, unknown>, path: string[]) => {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      const next = [...path, key];
      // A nested table is walked so each leaf is its own assignment (and the
      // guards are written once); everything else, arrays included, is one
      // expression.
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        walk(entry as Record<string, unknown>, next);
        continue;
      }
      ensure(path);
      lines.push(`    ${luaPath('rec', next)} = ${luaInline(entry)}`);
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
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

/** `#rrggbb` (or `rrggbb`) to the 0-255 components the trail module takes. */
/** Degrees to radians, for the ring's spin and start angle. */
function radians(degrees: number): string {
  return formatNumber((Number(degrees) || 0) * (Math.PI / 180));
}

interface EmitterEmitOptions {
  /** Where the emitter sits: the fired round, or the worm's muzzle. */
  anchor: 'round' | 'muzzle';
  /** Muzzle aiming emitter is active (`anchor === 'muzzle' && !projectileExclusive`). */
  usesAim: boolean;
  /** Projectile emitter is active (`roundOk && (anchor === 'round' || carry || projectileExclusive)`). */
  usesRound: boolean;
  /** Muzzle only: hand the emitter to the round the trigger creates. */
  carries: boolean;
  /** Disable the emitter while aiming so it only appears on fired projectiles. */
  projectileExclusive: boolean;
  /** The family has a missile to follow. */
  roundOk: boolean;
  /** Muzzle only: keep the emitter visible on firing/fired worm states too. */
  keepWhileFiring: boolean;
}

/**
 * PX's effect manager as a live emitter (`fx.emitter`, `effects.sdk`). The
 * library already exists and PX's ports call it by hand, so this only writes
 * the table: the preset, which of sparks / glow / reach / ribbon / ring are on,
 * and the two closers that make it live.
 *
 * The point is `emitter_for`'s `(x, y, owner, follow)`. Everything is
 * turn-based (`AGENTS.md` §0): `wa.on.worm_message` filtered to
 * `wa.msg.FRAME_FINISH` (scanning `wa.worms.all()` for the turn worm, since
 * `body_move` only fires when a body moves and `worm_message` callbacks do not
 * reliably receive a worm table) keeps one aim emitter at the muzzle while the
 * turn's worm aims with the weapon (and through firing frames when
 * `keepWhileFiring` is on) unless `projectileExclusive` is checked, and
 * `wa.on.missile_frame` spawns an independent emitter per fired round
 * (`EMITTER_ROUNDS[m.id]`). Both are simulation callbacks, so a replay draws
 * the same emitters on the same frames. The claim writes no `on_fire`: that key
 * replaces WA's shot, so a hand-off from it fired nothing at all.
 */
function emitEmitterBlock(
  lines: string[],
  em: EmitterConfig,
  o: EmitterEmitOptions,
): void {
  const { r, g, b } = hexToRgb(em.color);
  const ringRgb = hexToRgb(em.ring.color);
  const trailRgb = hexToRgb(em.trail.color);
  const offsetXNum = Number(em.offsetX) || 0;
  const offsetX = formatNumber(em.offsetX);
  const offsetY = formatNumber(em.offsetY);
  const sideOffset = Number(em.offsetY) || 0;
  const posXNum = Number(em.posX) || 0;
  const posYNum = Number(em.posY) || 0;
  const signedTerm = (value: number): string =>
    value === 0 ? '' : value > 0 ? ` + ${formatNumber(value)}` : ` - ${formatNumber(-value)}`;
  const muzzlePosXTerm =
    posXNum === 0
      ? ''
      : posXNum > 0
        ? ` + w.facing * ${formatNumber(posXNum)}`
        : ` - w.facing * ${formatNumber(-posXNum)}`;
  const roundPosXTerm = signedTerm(posXNum);
  const posYTerm = signedTerm(posYNum);
  const followFireAngle = em.followFireAngle !== false;
  const hasRing = !!em.ring?.enabled;
  const ringAngleNum = Number(em.ring?.angle) || 0;
  const ringSpeedNum = Number(em.ring?.speed) || 0;
  const ringAngleTerm =
    ringAngleNum === 0
      ? ''
      : ringAngleNum > 0
        ? ` + ${radians(ringAngleNum)}`
        : ` - ${radians(-ringAngleNum)}`;
  const usesFireAngle =
    followFireAngle && hasRing && (o.usesAim || (o.usesRound && !em.ring.track));
  const usesSpinAccum =
    followFireAngle && hasRing && o.usesAim && ringSpeedNum !== 0 && !em.ring.track;
  // PX's reach speed is progress per frame (0.08 = 8%), so the panel's whole
  // percent is divided once here. The library reads a `{ lo, hi }` pair, and one
  // number is a fixed speed.
  const reachSpeed = formatNumber(Math.max(0.001, Math.min(1, em.reachSpeed / 100)));
  const reachBulge = formatNumber(em.reachBulge);
  lines.push("    -- PX's effect manager, live (`fx.emitter`): an emitter actor that draws");
  lines.push('    -- sparks, a glow, short reach bolts, a ring and a ribbon at one point.');
  lines.push('    -- The muzzle holds one aim emitter while the weapon is selected, and each');
  lines.push('    -- fired round carries its own emitter keyed by `m.id`.');
  if (o.usesAim) {
    lines.push('    local EMITTER');
    lines.push('    local EMITTER_FRAME');
    if (usesSpinAccum) lines.push('    local EMITTER_SPIN = 0');
    if (o.carries) lines.push('    local EMITTER_OWNER');
  }
  if (o.usesRound) {
    lines.push('    local EMITTER_ROUNDS = {}');
  }
  lines.push('    local function emitter_for(x, y, owner, follow)');
  lines.push('      return {');
  lines.push('        x = x, y = y, owner = owner, follow = follow,');
  lines.push(`        anchor = ${luaQuote(o.anchor)},`);
  lines.push(`        carry = ${o.carries ? 'true' : 'false'},`);
  if (o.projectileExclusive) lines.push('        projectile_exclusive = true,');
  if (!followFireAngle) lines.push('        follow_fire_angle = false,');
  lines.push(`        preset = ${luaQuote(em.preset)},`);
  lines.push(`        spark = ${em.spark ? 'true' : 'false'},`);
  lines.push(`        glow = ${em.glow ? 'true' : 'false'},`);
  lines.push(`        color = { r = ${r}, g = ${g}, b = ${b} },`);
  if (em.reach) {
    lines.push('        reach = {');
    lines.push(`          count = ${Math.max(0, Math.round(em.reachCount))},`);
    lines.push(`          direction = ${formatNumber(em.reachDirection ?? 0)},`);
    lines.push(`          spread = ${formatNumber(Math.max(0, Math.min(360, em.reachSpread ?? 360)))},`);
    lines.push(`          distance = ${formatNumber(Math.max(0, em.reachDistance))},`);
    lines.push(`          speed = { ${reachSpeed}, ${reachSpeed} },`);
    lines.push(`          bulge = { ${reachBulge}, ${reachBulge} },`);
    lines.push(`          curve = ${luaQuote(em.reachCurve)},`);
    lines.push(`          noise = ${formatNumber(Math.max(0, em.reachNoise))},`);
    lines.push(`          segments = ${Math.max(1, Math.round(em.reachSegments))},`);
    lines.push(`          core_w = ${formatNumber(Math.max(0, em.reachCoreWidth))},`);
    lines.push(`          glow_w = ${formatNumber(Math.max(0, em.reachGlowWidth))},`);
    lines.push(`          r = ${r}, g = ${g}, b = ${b},`);
    lines.push('        },');
  } else {
    lines.push('        reach = false,');
  }
  if (em.trail.enabled) {
    lines.push('        trail = {');
    lines.push(`          max = ${Math.max(2, Math.round(em.trail.max))},`);
    lines.push(`          every = ${Math.max(1, Math.round(em.trail.every))},`);
    lines.push(`          noise = ${formatNumber(Math.max(0, em.trail.noise))},`);
    lines.push(`          core_w = ${formatNumber(Math.max(0, em.trail.coreWidth))},`);
    lines.push(`          glow_w = ${formatNumber(Math.max(0, em.trail.glowWidth))},`);
    if (em.trail.rainbow) lines.push('          rainbow = true,');
    lines.push(`          r = ${trailRgb.r}, g = ${trailRgb.g}, b = ${trailRgb.b},`);
    lines.push('        },');
  } else {
    lines.push('        trail = false,');
  }
  if (em.ring.enabled) {
    lines.push('        ring = {');
    lines.push(`          radius = ${formatNumber(Math.max(1, em.ring.radius))},`);
    lines.push(`          segments = ${Math.max(8, Math.round(em.ring.segments))},`);
    lines.push(`          noise = ${formatNumber(Math.max(0, em.ring.noise))},`);
    lines.push(`          speed = ${radians(em.ring.speed)},`);
    lines.push(`          angle = ${radians(em.ring.angle)},`);
    lines.push(
      `          ellipse = { ${formatNumber(em.ring.ellipseX)}, ${formatNumber(
        em.ring.ellipseY,
      )} },`,
    );
    // 0 asks the library to derive the widths from the radius, which is PX's
    // own `sizeValue` rule.
    if (em.ring.coreWidth > 0) {
      lines.push(`          core_w = ${formatNumber(em.ring.coreWidth)},`);
    }
    if (em.ring.glowWidth > 0) {
      lines.push(`          glow_w = ${formatNumber(em.ring.glowWidth)},`);
    }
    if (em.ring.thin) lines.push('          thin = true,');
    // The bend follows the round instead of a fixed angle. `angle` stays as the
    // offset the library adds to the heading.
    if (em.ring.track) lines.push('          track = true,');
    if (em.ring.rainbow) lines.push('          rainbow = true,');
    lines.push(`          r = ${ringRgb.r}, g = ${ringRgb.g}, b = ${ringRgb.b},`);
    lines.push('        },');
  }
  if (em.rainbow) lines.push('        rainbow = true,');
  lines.push('      }');
  lines.push('    end');
  if (usesFireAngle) {
    lines.push("    -- Owner's fire angle in world/ring radians (`atan2(dy, dx)`).");
    lines.push('    local function emitter_fire_angle(w)');
    lines.push('      local fa = (w.aim or 0.5) * math.pi');
    lines.push('      return wa.math.atan(wa.math.cos(fa), w.facing * wa.math.sin(fa))');
    lines.push('    end');
  }
  if (o.usesRound) {
    lines.push('    local function emitter_worm()');
    lines.push('      local first');
    lines.push('      for _, w in ipairs(wa.worms.all()) do');
    lines.push('        if w.turn then return w end');
    lines.push('        if not first and w.hp > 0 then first = w end');
    lines.push('      end');
    lines.push('      return first');
    lines.push('    end');
    lines.push('    local function emitter_start(x, y, owner, follow)');
    if (followFireAngle && hasRing && !em.ring.track) {
      lines.push('      local spec = emitter_for(x, y, owner, follow)');
      lines.push('      if spec.ring and owner then');
      lines.push('        spec.ring.angle = emitter_fire_angle(owner) + (spec.ring.angle or 0)');
      lines.push('      end');
      lines.push('      return fx.emitter(spec)');
    } else {
      lines.push('      return fx.emitter(emitter_for(x, y, owner, follow))');
    }
    lines.push('    end');
  }
  const radialDeg = Number(em.radialAngle) || 0;
  const hasRadial = offsetXNum !== 0 || sideOffset !== 0 || radialDeg !== 0;
  const aimAngleExpr =
    radialDeg === 0
      ? '(w.aim or 0.5) * math.pi'
      : radialDeg > 0
        ? `(w.aim or 0.5) * math.pi + ${radians(radialDeg)}`
        : `(w.aim or 0.5) * math.pi - ${radians(-radialDeg)}`;
  if (o.usesAim) {
    lines.push("    -- The muzzle: a radial point from the worm along its fire angle (PX's");
    lines.push("    -- `curDist`), optionally tilted by `radialAngle`, shifted across the");
    lines.push('    -- radial arm, and nudged by pure positional `(posX, posY)` offsets.');
    lines.push('    local function emitter_muzzle(w)');
    if (!hasRadial) {
      lines.push(`      return w.x${muzzlePosXTerm},`);
      lines.push(`        w.y${posYTerm}`);
    } else {
      lines.push(`      local a = ${aimAngleExpr}`);
      if (sideOffset !== 0) {
        lines.push('      local s, c = wa.math.sin(a), wa.math.cos(a)');
        lines.push('      local dx, dy = w.facing * s, c');
        lines.push(`      return w.x + dx * ${offsetX} + w.facing * c * ${offsetY}${muzzlePosXTerm},`);
        lines.push(`        w.y + dy * ${offsetX} - s * ${offsetY}${posYTerm}`);
      } else {
        lines.push('      local dx, dy = w.facing * wa.math.sin(a), wa.math.cos(a)');
        lines.push(`      return w.x + dx * ${offsetX}${muzzlePosXTerm},`);
        lines.push(`        w.y + dy * ${offsetX}${posYTerm}`);
      }
    }
    lines.push('    end');
  }
  if (o.usesRound) {
    lines.push('    -- Track every live missile of this weapon by `m.id`: `wa.on.missile_frame`');
    lines.push('    -- is the only place `m.id`, `m.weapon` and the velocity are readable, and');
    lines.push('    -- `m.id` counts up per match without reuse. Each round gets its own');
    lines.push('    -- follower closure and drops itself once frames stop arriving.');
    lines.push('    local function emitter_round(id)');
    lines.push('      return function()');
    lines.push('        local p = EMITTER_ROUNDS[id]');
    lines.push('        if not p or wa.world.frame() - p.seen > 3 then');
    lines.push('          EMITTER_ROUNDS[id] = nil');
    lines.push('          return nil');
    lines.push('        end');
    lines.push(`        return p.x${roundPosXTerm}, p.y${posYTerm}, p.vx, p.vy`);
    lines.push('      end');
    lines.push('    end');
    lines.push('    wa.on.missile_frame(function(m)');
    lines.push('      if m.weapon ~= ctx.id then return end');
    lines.push('      local p = EMITTER_ROUNDS[m.id]');
    lines.push('      if p and p.emitter and p.emitter.dead then');
    lines.push('        EMITTER_ROUNDS[m.id] = nil');
    lines.push('        p = nil');
    lines.push('      end');
    lines.push('      if p == nil then');
    lines.push('        -- Only a shot from the worm holding this weapon starts a round;');
    lines.push('        -- a cluster bit still alive after the turn is not it.');
    lines.push('        local w = emitter_worm()');
    lines.push('        if not (w and w.weapon == ctx.id) then return end');
    lines.push('        p = { x = m.x, y = m.y, vx = m.vx, vy = m.vy,');
    lines.push('          seen = wa.world.frame() }');
    lines.push('        EMITTER_ROUNDS[m.id] = p');
    const ownerExpr = o.carries ? 'EMITTER_OWNER or w' : 'w';
    lines.push(`        local e = emitter_start(m.x${roundPosXTerm}, m.y${posYTerm}, ${ownerExpr},`);
    lines.push('          emitter_round(m.id))');
    lines.push('        if e then');
    lines.push('          p.emitter = e');
    lines.push('        else');
    lines.push('          EMITTER_ROUNDS[m.id] = nil');
    lines.push('        end');
    lines.push('        return');
    lines.push('      end');
    lines.push('      p.x, p.y, p.vx, p.vy = m.x, m.y, m.vx, m.vy');
    lines.push('      p.seen = wa.world.frame()');
    lines.push('    end)');
  }
  if (o.usesAim) {
    // `FRAME_FINISH` runs every 50 Hz tick even while the worm stands still to
    // aim (`body_move` only fires when WA steps a moving body, which made the
    // emitter wait for Space recoil or walking). Scan `wa.worms.all()` rather
    // than trusting the callback arg, matching the fuse sampler and melee hook.
    lines.push('    wa.on.worm_message(function()');
    lines.push('      local now = wa.world.frame() or 0');
    lines.push('      if now == EMITTER_FRAME then return end');
    lines.push('      EMITTER_FRAME = now');
    lines.push('      if EMITTER and EMITTER.dead then EMITTER = nil end');
    lines.push('      local w');
    lines.push('      for _, c in ipairs(wa.worms.all()) do');
    lines.push('        if c.turn and (c.hp == nil or c.hp > 0) then w = c; break end');
    lines.push('      end');
    const heldExpr = o.keepWhileFiring
      ? 'w.aiming or w.state == "firing" or w.state == "fired"'
      : 'w.aiming';
    lines.push(`      local held = w and w.weapon == ctx.id and (${heldExpr})`);
    lines.push('      if not held then');
    lines.push('        if EMITTER then EMITTER:remove(); EMITTER = nil end');
    lines.push('        return');
    lines.push('      end');
    lines.push('      local x, y = emitter_muzzle(w)');
    if (o.carries) lines.push('      EMITTER_OWNER = w');
    lines.push('      if EMITTER then');
    lines.push('        EMITTER:move_to(x, y)');
    if (usesSpinAccum) lines.push(`        EMITTER_SPIN = EMITTER_SPIN + ${radians(ringSpeedNum)}`);
    lines.push('      else');
    lines.push('        EMITTER = fx.emitter(emitter_for(x, y, w))');
    if (usesSpinAccum) lines.push('        EMITTER_SPIN = 0');
    lines.push('      end');
    if (followFireAngle && hasRing) {
      lines.push('      if EMITTER and EMITTER.ring then');
      lines.push(
        `        EMITTER.ring.angle = emitter_fire_angle(w)${ringAngleTerm}${usesSpinAccum ? ' + EMITTER_SPIN' : ''}`,
      );
      lines.push('      end');
    }
    lines.push('    end, { msgs = { wa.msg.FRAME_FINISH } })');
  }
  lines.push('');
}

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
 * like the hold sheet, so it has no record slot and no `mod.toml` declaration
 * the file only has to exist at the declared path.
 */
export function flashSheetPath(project: WeaponProject): string {
  return `sprites/${sanitizeModFolder(project.id)}/flash.png`;
}

/**
 * The second hand's own art, when the author uploaded one. Without it the layer
 * reuses the first hand's sheet (`PX_HANDS`), so nothing is written and nothing
 * is claimed.
 */
export function extraHandSheetPath(project: WeaponProject): string | null {
  if (!project.hold?.extraHand?.enabled || !project.hold.extraHand.file) return null;
  return `sprites/${sanitizeModFolder(project.id)}/hand2.png`;
}

/**
 * The 1x1 transparent sheet the aiming manager points the engine at while its
 * quads draw (`hold.sheets[1]` / `wa.weapons.hold_sheet`). It is written by the
 * exporter, never declared in `mod.toml`: `worm_hold::claim` loads `hold.sheets`
 * itself, and the file only has to exist.
 */
export function silentHoldSheetPath(project: WeaponProject): string {
  return `sprites/${sanitizeModFolder(project.id)}/silent.png`;
}

/**
 * True when the aiming manager (`sb.hold`) has to draw the held art itself.
 * The engine's `HoldSpec` has no offset field, so an offset on the hold is the
 * reason today; the same test gates the generator's `sb.hold` call, the silent
 * sheet the exporter writes and the UI's Atlas Mode line.
 */
/** The active aim clamp, or null. One place decides what "clamped" means. */
export function aimClampOf(
  project: WeaponProject,
): { up: number; down: number } | null {
  const clamp = project.hold?.aimClamp;
  if (!clamp?.enabled || !project.hold?.enabled) return null;
  const clampDeg = (value: number) => Math.min(90, Math.max(0, Number(value) || 0));
  return { up: clampDeg(clamp.up), down: clampDeg(clamp.down) };
}

export function holdNeedsAimLayer(project: WeaponProject): boolean {
  const h = project.hold;
  if (!h?.enabled) return false;
  if ((h.offsetX ?? 0) !== 0 || (h.offsetY ?? 0) !== 0) return true;
  if ((h.handOffsetX ?? 0) !== 0 || (h.handOffsetY ?? 0) !== 0) return true;
  // The firing role is ours: WA draws nothing after its two firing frames, so a
  // firing sheet that has to be seen for longer (or replace the gun) is a window
  // the aim layer owns.
  if (h.flashFile) return true;
  // The held art on WA's firing frames: a burst repeats the shot without the
  // fire message that keeps `h.firing` set, which is what px_hold_art used to
  // patch around. The layer draws it instead.
  if (!h.fireHideMain && (project.fireType === 'hitscan' || !!project.fireSequence?.enabled)) {
    return true;
  }
  // The swing is a clip on the held art, which only the quad layer can draw.
  if (project.aimClip?.enabled) return true;
  // A melee strike lands on the swing's hit frame, so it is the layer's too.
  if (project.melee?.enabled) return true;
  // An aim clamp is the layer's too: the engine draws its own aim, so stopping
  // the pose short of the ends of WA's sweep is something only the quads can do.
  if (aimClampOf(project)) return true;
  // `HoldSpec` has one hand slot, so a second hand is the layer's.
  return !!h.extraHand?.enabled;
}

/** True when a Space press plays the aiming clip instead of firing. */
export function swingOn(project: WeaponProject): boolean {
  // A melee strike is the swing: its hit frame is a tick of the clip, so it
  // turns the clip on rather than depending on the author ticking two boxes.
  return !!project.hold?.enabled && (!!project.aimClip?.enabled || !!project.melee?.enabled);
}

/**
 * The terrain stamp's baked 32-frame strip, or null when the card is off or has
 * no sheet. `wa.land.stamp` names this path inside the claim `sprites`, and the
 * engine keeps the source pixels so it can write terrain with them.
 */
export function terrainStampPath(project: WeaponProject): string | null {
  const stamp = project.terrainStamp;
  if (!stamp?.enabled || !stamp.sheet?.file) return null;
  return `sprites/${sanitizeModFolder(project.id)}/stamp.png`;
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

/**
 * The sprite id the generator writes into a builder-owned roaming record's
 * `sheep.flight_1/2`. WA reads a zero there as "this animal cannot fly" and the
 * Space takeoff does nothing, so the fields need a nonzero value that draws
 * nothing: 699 is not a stock sprite and no pack gets that slot. It is also the
 * marker the builder watches for, since WA moves the flown sprite into the
 * render slot at the takeoff.
 */
export const ROAM_FLY_SENTINEL = 699;

/** WA keeps its own sprites below 800; packs are assigned slots from 800 up. */
const STOCK_SPRITE_LIMIT = 800;

/**
 * A roaming animal's walking pose: the record `missile.sprite`, which WA
 * animates while the animal is on the ground (`sheep.flight_1/2` is the flown
 * art and `m.sprite` is not what draws it). Returns the id, or `0` when the
 * value cannot draw, unset, a bundle path, or a number outside WA's stock
 * range. An imported Project X record holds PX's own sprite numbers (the Super
 * Queen Bee's `34464`, its sheep's `713`); WA masks those to a pack slot that
 * nothing was installed at, so they draw nothing and the builder has to draw
 * the walk itself.
 */
export function roamWalkPoseId(value: unknown): number {
  const resolved = resolveStockSprite(value);
  const id =
    typeof resolved === 'number'
      ? resolved
      : typeof resolved === 'string'
        ? (stockSpriteId(resolved) ?? 0)
        : 0;
  return id > 0 && id < STOCK_SPRITE_LIMIT ? id : 0;
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
function roleArtRows(
  cfg: Pick<FlightRoleArt, 'anim' | 'frames' | 'pingpong' | 'animSpeed' | 'spinRate' | 'scale' | 'mirror' | 'z'>,
  indent: string,
): string[] {
  const rows = [`${indent}anim = ${luaQuote(cfg.anim || 'rotation')},`];
  if (cfg.frames > 1) rows.push(`${indent}cyclical = ${cfg.frames},`);
  // One frame has nothing to play backwards, so `pingpong` is only meaningful
  // with a real strip.
  if (cfg.pingpong && cfg.frames > 1) rows.push(`${indent}pingpong = true,`);
  if (cfg.animSpeed !== undefined && cfg.animSpeed !== 1) {
    rows.push(`${indent}anim_speed = ${formatNumber(cfg.animSpeed)},`);
  }
  if (cfg.spinRate !== undefined && cfg.spinRate !== 1) {
    rows.push(`${indent}spin = ${formatNumber(cfg.spinRate)},`);
  }
  if (cfg.scale !== undefined && cfg.scale !== 1) {
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
  if (cfg.pingpong && cfg.frames > 1) rows.push(`${indent}pingpong = true,`);
  if (cfg.animSpeed !== undefined && cfg.animSpeed !== 1) {
    rows.push(`${indent}anim_speed = ${formatNumber(cfg.animSpeed)},`);
  }
  if (cfg.spinRate !== undefined && cfg.spinRate !== 1) {
    rows.push(`${indent}spin = ${formatNumber(cfg.spinRate)},`);
  }
  if (cfg.scale !== undefined && cfg.scale !== 1) {
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
    // A roaming animal's flown art can be its own role. `native` (or no row)
    // keeps the primary sheet, which is what every bundle written so far does.
    roam: builderOn && project.action === 'roam' && mode('roam') === 'builder',
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

  // Locate on_explode =. The masked copy has the same length, so an index is
  // the same in both, and a commented-out `-- on_explode =` no longer wins.
  const masked = maskLuaCode(snippet);
  const declMatch = masked.match(/(?:^|\n)[ \t]*on_explode\s*=/);
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

  // Scan forward for matching `end` using `scanBlockEnd` over the masked text:
  // a keyword in a comment or a string is not a block, and bare `do ... end` or
  // `repeat ... until` blocks inside the body must match too.
  const foundEnd = scanBlockEnd(masked, fnBodyStart);
  const fnBodyEnd = foundEnd === -1 ? snippet.length : foundEnd;

  const onExplodeBody = snippet.slice(fnBodyStart, fnBodyEnd).trim();

  // Find the end of the entire on_explode statement
  let stmtEnd = foundEnd === -1 ? snippet.length : foundEnd + 3; // past 'end'
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

/**
 * The body of a claim hook literal, and the name the bundle gave its parameter.
 *
 * The carried hook is kept as the literal it was (`function(ev) ... end`, or the
 * `{ on = function(ev) ... end }` table form), because that is what the bundle
 * wrote and what its declarations agree with. To merge it into the handler the
 * editor emits, the body is what matters: `on_explode` has one `on` slot, so the
 * carried statements go between our burst and our stamp rather than becoming a
 * second key.
 *
 * The closing `end` is found on the masked copy, so a body whose last statement
 * is a comment saying "end" still ends where the block does.
 */
export function hookBodyOf(text: string): { param: string; body: string } {
  const masked = maskLuaCode(text);
  const at = masked.indexOf('function');
  if (at < 0) return { param: 'ev', body: '' };
  const open = masked.indexOf('(', at);
  const close = open < 0 ? -1 : masked.indexOf(')', open);
  if (open < 0 || close < 0) return { param: 'ev', body: '' };
  const param = text.slice(open + 1, close).split(',')[0]?.trim() || 'ev';
  // `end` is a keyword, so the last whole-word one in the masked copy closes
  // the outermost block: partial matches like `send` or `blend` do not count.
  let end = -1;
  const endRe = /\bend\b/g;
  let em: RegExpExecArray | null;
  while ((em = endRe.exec(masked)) !== null) end = em.index;
  if (end <= close) return { param, body: '' };
  return { param, body: text.slice(close + 1, end).trim() };
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
 * The names an emitted weapon file binds, and what it binds them to.
 *
 * M2/M3's carry has to know this before it decides what to copy: a bundle's
 * `local fx = require("wf-lib/effects/px_effects")` against the file's own `fx`
 * is one declaration, not two, and the same name bound to a *different* module is
 * the shadowing case the plan calls out. The answer comes from the generator
 * itself (`generateLuaCode` on the project without its carried blocks), so the
 * list cannot drift from what is really emitted.
 *
 * A `require` binding maps to its module id; every other local maps to `''`.
 */
export function declaredNames(code: string): Map<string, string> {
  // Line by line, because every one of these is a one-line declaration in the
  // emitted file, and because `maskLuaCode` blanks a string's contents: the
  // module id has to be read from the original text at the masked line.
  const maskedLines = maskLuaCode(code).split('\n');
  const rawLines = code.split('\n');
  const out = new Map<string, string>();
  const bind = (name: string, module: string) => {
    // A module-level `local zap` followed by an install-time
    // `zap = require("…")` is one binding: the later assignment is what says
    // which module the name is, so it upgrades a plain local.
    if (!out.has(name) || (out.get(name) === '' && module !== '')) out.set(name, module);
  };
  const moduleAfter = (raw: string): string => {
    const at = raw.search(/require\s*\(/);
    if (at === -1) return '';
    const quote = raw.indexOf('"', at);
    const single = raw.indexOf("'", at);
    const open = quote === -1 ? single : single === -1 ? quote : Math.min(quote, single);
    if (open === -1) return '';
    const close = raw.indexOf(raw[open], open + 1);
    return close === -1 ? '' : raw.slice(open + 1, close);
  };
  for (let i = 0; i < maskedLines.length; i += 1) {
    const masked = maskedLines[i];
    const raw = rawLines[i] ?? '';
    // `local x = require("M")`, and `x = require("M")` (a module-level
    // declaration followed by an install-time assignment, which is how a bundle
    // whose module reads `wa` at load is written: lesson 21).
    const requireLocal = /^[ 	]*local[ 	]+([A-Za-z_][A-Za-z0-9_]*)[ 	]*=[ 	]*require[ 	]*\(/.exec(masked);
    if (requireLocal) {
      bind(requireLocal[1], moduleAfter(raw));
      continue;
    }
    const requireAssign = /^[ 	]*([A-Za-z_][A-Za-z0-9_]*)[ 	]*=[ 	]*require[ 	]*\(/.exec(masked);
    if (requireAssign) {
      bind(requireAssign[1], moduleAfter(raw));
      continue;
    }
    const localFunction = /^[ 	]*local[ 	]+function[ 	]+([A-Za-z_][A-Za-z0-9_]*)/.exec(masked);
    if (localFunction) {
      bind(localFunction[1], '');
      continue;
    }
    const local = /^[ \t]*local[ \t]+([^=\n]+)/.exec(masked);
    if (!local) continue;
    for (const part of local[1].split(',')) {
      const name = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (name) bind(name[1], '');
    }
  }
  return out;
}

/**
 * Bundle path of an uploaded custom WAV, or null when the role is off or has no
 * file. Rebuilt from the current weapon id on every export (like `packArtPath`),
 * so a rename cannot leave a stale `sounds/<old id>/...` path. The engine loads
 * it from the claim's `sounds` list as `sounds/<mod>/<role>.wav`.
 */
export function customSoundPath(
  project: WeaponProject,
  role: 'launch' | 'explosion' | 'interval' | 'shot',
): string | null {
  const sounds = project.customSounds;
  if (!sounds) return null;
  const enabled =
    role === 'launch'
      ? sounds.launchEnabled
      : role === 'explosion'
        ? sounds.explosionEnabled
        : role === 'shot'
          ? sounds.shotEnabled
          : sounds.intervalEnabled;
  const asset =
    role === 'launch'
      ? sounds.launch
      : role === 'explosion'
        ? sounds.explosion
        : role === 'shot'
          ? sounds.shot
          : sounds.interval;
  if (!enabled || !asset?.file) return null;
  return `sounds/${sanitizeModFolder(project.id)}/${role}.wav`;
}

/**
 * Bundle path of an uploaded melee strike WAV, or null when that role has no
 * file. The claim plays it by path, so it needs no stock sample slot; the id in
 * `MeleeSound` is the native fallback.
 */
export function meleeSoundPath(
  project: WeaponProject,
  role: 'hit' | 'miss',
  /** Which strike of a combo: its own sample is a file of its own. */
  strike?: number,
): string | null {
  const sound =
    strike === undefined
      ? role === 'hit'
        ? project.melee?.hitSound
        : project.melee?.missSound
      : project.melee
        ? meleeStrikes(project.melee)[strike]?.sound
        : undefined;
  if (!sound?.file) return null;
  const suffix = strike === undefined ? role : `${role}${strike + 1}`;
  return `sounds/${sanitizeModFolder(project.id)}/melee_${suffix}.wav`;
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
  const file = sanitizeWepFileName(project.wepFileName || project.wepFile.name);
  // One bundle has one `weps/` folder, so a weapon inside a pack of more than one
  // names its own: two records both called `weapon.wep` would otherwise be one
  // file, and one of the two weapons would load the other's record.
  const slug = project.packSlug ? `${sanitizeModFolder(project.packSlug)}/` : '';
  return `weps/${slug}${file}`;
}

/**
 * Donors whose worm pose WA picks by the record's `sprite` (its
 * `Weapon__hold_sheet`): the thrown weapons, and the placed ones it knows by
 * their flight sprite. Zeroing that sprite to hide the round leaves the worm
 * aiming with empty hands, so the claim lends the donor's pose (`hold_as`).
 */
const POSE_BY_SPRITE_DONORS = new Set([
  'grenade', 'cluster_bomb', 'banana_bomb', 'super_banana', 'holy_grenade', 'petrol_bomb',
  'ming_vase', 'dynamite', 'sheep', 'super_sheep', 'aqua_sheep', 'old_woman',
  'salvation_army', 'mad_cow', 'mole_bomb', 'skunk',
]);

export function generateLuaCode(project: WeaponProject): string {
  /**
   * A melee claim is a real weapon now, and Space fires it.
   *
   * WA ends a turn when a projectile is built (`after_use`, plus the retreat
   * window), takes the ammo, plays its own launch step and gives the player
   * control of the shot. `eat_fire` skipped every one of those, and the clip then
   * zeroed the turn clock itself, which ended the turn whether or not the record
   * asked for it. So the record fires a **ghost**: no art, no trail, no blast, no
   * damage, no payload, no action, and an invisible 5 s retreat window. Nothing
   * leaves the worm that a player can see or feel, and the turn is WA's to end.
   */
  const meleeGhost = !!project.melee?.enabled;
  // An incomplete project (a hand-built object, a half-restored draft) must not
  // die with `undefined is not an object` in the middle of an export.
  const modFolder = sanitizeModFolder(project.id || 'custom.weapon');
  const basedOn = project.based_on || project.slot || 'grenade';
  const donorName = basedOn.replace(/^stock\./, '');
  // A template has to be one of WA's own weapons. The engine refuses the whole
  // bundle for a name it does not know (`stock.famas: a template is one of WA's
  // own weapons`), so an unknown slot writes no `copy_from` and the weapon takes
  // its own slot's record instead of taking every other weapon down with it.
  const donorKnown = !!stockDonor(donorName);
  const donor = `stock.${donorName}`;
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
  // Set where the missile table writes `sprite = 0` for a real shot.
  let zeroedSprite = false;
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
    roam: roamRole,
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

  // Carried claim hooks (M5): the bundle's own `on_explode` and `on_fire`. The
  // key is single-valued, so they are inlined into the handler the editor emits
  // rather than written as a second key, which would replace one of the two.
  // One switch per block (the Carried Lua panel): a disabled block stays in the
  // project so its text is not lost, and is simply not written. That can leave a
  // helper reading a name nothing declares, which is the author's call and shows
  // in the panel's report, not something to guess around.
  const carriedHookList = (project.carriedLua?.hooks ?? []).filter((hook) => !hook.disabled);
  const carriedHooks = new Map(carriedHookList.map((hook) => [hook.key, hook]));
  const carriedExplode = carriedHooks.has('on_explode')
    ? hookBodyOf(carriedHooks.get('on_explode')!.text)
    : null;

  // The effects SDK's px_effects burst: the electric ring + lens, an optional
  // PX-style blast replacement, and the smoke and re-buffer passes.
  const explosionEffect = project.explosionEffect;
  const usesExplosionEffect = !!explosionEffect?.enabled && explodesNatively;
  // Uploaded WAVs.
  const customSounds = project.customSounds;
  const explosionSoundPath = customSoundPath(project, 'explosion');
  const intervalSoundPath = customSoundPath(project, 'interval');
  const usesExplosionSound = !!explosionSoundPath && explodesNatively;
  // `wa.land.stamp` is a built-in verb, not a library: the round's picture is
  // burned into the terrain at the blast point. It only works on a family whose
  // rounds WA blasts (`on_explode` never runs for a strike's bombs) and it needs
  // the baked strip, which is the file the exporter writes.
  const terrainStamp = project.terrainStamp;
  const stampSheetPath = terrainStampPath(project);
  const usesTerrainStamp = !!stampSheetPath && supportsTerrainStamp(project);
  // A worm inside the stamp would be sealed into the land (WA's stamp is the
  // girder routine: the terrain is rewritten around it), so the emitted call is
  // skipped when one is at the impact point. 0 keeps the plain call.
  const stampClearance = usesTerrainStamp
    ? Math.max(0, Math.min(64, Math.round(terrainStamp?.wormClearance ?? 0)))
    : 0;
  // Impact damage (PX's javelin): the round pierces what it hits instead of
  // exploding. It rides the stamp card's own Enable Stamp checkbox, because the
  // pierce is part of the same `on_explode` claim: with the card off, a ticked
  // "Pierce Targets" is a stored preference and nothing more, so turning it on
  // cannot silently take a weapon's blast away. It does not need a stamp sheet
  // (the picture and the damage are separate), so a card with no sprite still
  // pierces. `stamp_hit` walks `wa.world.electrical_nearby`, which is only valid
  // in a simulation callback: `on_explode` is one.
  const stampImpact = terrainStamp?.impact;
  const usesImpactDamage =
    !!stampImpact?.enabled && !!terrainStamp?.enabled && supportsTerrainStamp(project);
  // Replacing WA's blast needs the claim to own the blast, which a missile and
  // a mine do; the custom explosion supplies damage, push, crater and sound.
  // Impact damage silences it for the same reason: a power left in the record
  // would blast once more on top of the pierce (and crater over a stamp).
  const silencesBlast =
    (usesExplosionEffect && explosionEffect!.mode === 'blast') || usesImpactDamage;
  // Electric damage. WA has no electric hit kind, so `kind = "taze"` only names
  // the hit (WA takes it as the Prod's) and nothing about the worm changes.
  // What tazes is `px.electric`'s damage module, which is already installed as
  // `wf-lib/electric/damage`: arm the blast, let it hurt, and the module holds
  // every worm that lost health in the sparking pose and throws it when the
  // hold releases. It works on WA's own blast too, so an overlay burst can taze
  // without replacing anything (`set_message_electric_missile`), and it needs
  // no change to `effects.sdk` beyond the `kind` it already forwards.
  const usesElectricBlast =
    !!usesExplosionEffect && explosionEffect!.damageType === 'electric';
  // The javelin's pierce takes the same hit kinds, so its `taze` needs the same
  // arm: `o:hurt{ kind = "taze" }` is a Prod to WA and nothing more.
  const usesElectricImpact = usesImpactDamage && stampImpact!.kind === 'taze';
  // A melee strike's electrical hit is `px.electric`'s own `hurt_electric`: WA's
  // "taze" kind alone is a Prod to it and nothing more.
  const usesElectricMelee = !!project.melee?.enabled && project.melee.kind === 'taze';
  const usesZap = usesElectricBlast || usesElectricImpact || usesElectricMelee;
  const usesIntervalSound =
    !!intervalSoundPath &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));
  const hasSnippetExplodeCode = project.enableCustomLua && !!parsedLua.onExplodeBody.trim();
  const hasCarriedExplodeCode = !!carriedExplode?.body.trim();
  const hasCustomExplodeCode = hasSnippetExplodeCode || hasCarriedExplodeCode;
  // `wf-lib/fire_seq` (px.fire_seq): one `on_fire` fires a burst. A custom
  // `on_fire` in the snippet owns the trigger, so the card is skipped then.
  // Mask comments/strings so `-- on_fire =` does not disable features.
  const fireSequence = project.fireSequence;
  const maskedSnippet = project.enableCustomLua
    ? maskLuaCode(project.customLuaSnippet || '')
    : '';
  const hasCustomOnFire = /(?:^|\n)[ \t]*on_fire\s*=/.test(maskedSnippet);
  // The bundle's own `on_fire` (M6): a hand-written trigger the editor does not
  // model. It does not stop the launch WAV, which is one report per trigger and
  // still belongs first in the handler, but it does stop our `fire_seq` burst:
  // the bundle's body is the whole trigger then, and two launches from one
  // trigger is exactly the failure the "a custom on_fire owns the key" rule
  // exists to avoid.
  const carriedOnFire = carriedHooks.has('on_fire')
    ? hookBodyOf(carriedHooks.get('on_fire')!.text)
    : null;
  const hasCarriedOnFire = !!carriedOnFire?.body.trim();
  const usesFireSequence =
    !!fireSequence?.enabled &&
    !hasCustomOnFire &&
    !hasCarriedOnFire &&
    supportsFireSequence(project);
  // Claim keys the engine reads verbatim and the editor does not model: the
  // bundle's own callbacks, written as the key itself. `on_explode`/`on_fire`
  // are not here: they are merged into the handler the editor emits.
  const verbatimHooks = carriedHookList.filter((hook) => !MERGEABLE_HOOKS.has(hook.key));
  // A sequentially fired round is launched by us (`wa.weapons.launch`), so WA's
  // fuse option never reaches it: the launch writes the record's own
  // `missile.fuse`, and a weapon that relies on the option (every grenade) keeps
  // 0 there, which explodes on the first frame. The burst carries the fuse
  // itself, read off the turn player's synchronised digit keys, so the timer
  // matches what the player picked while aiming.
  //
  // Only when the record holds no fuse: an author who pinned one (dynamite's
  // 5000, a bazooka's 9000) is left alone, and WA offers its 1-5 keys only for
  // the records that have none, so the two agree.
  const recordFuse = Math.max(
    0,
    Math.round(Number(recordField(project, 'missile.fuse', project.body.fuse_time_ms ?? 0)) || 0),
  );
  const carriesFuse =
    usesFireSequence &&
    fireSequence!.mode !== 'actors' &&
    recordFuse === 0 &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));
  // WA's fuse keys are seconds, 1 to 5, and the option starts at 3.
  const fuseFallback = 3000;
  // The firing role (`fire` in the `sb.hold` spec): the art WA draws on its two
  // firing frames, with its own sheet, strip, window and hand. The firing-state
  // sprite used to be a second hold entry handed to `px_hold_art`; the aim layer
  // owns it now, so a firing animation can stay up for more than WA's two frames.
  const usesFiringArt = !!usesHold && !!project.hold?.flashFile;
  // `keep_firing`: the held art stays on WA's repeat-fire frames (0x6A/0x6B). A
  // firearm fires several shots from one trigger, and the engine drops the hold
  // after the first, which is why a machine gun's gun and hand used to vanish
  // mid-burst. This is the aim layer's own draw now, not px_hold_art's: one
  // geometry, one clock, no second library.
  const usesFiringHold =
    !!usesHold &&
    (usesFireSequence || project.fireType === 'hitscan') &&
    !project.hold?.fireHideMain;
  // The aiming manager (`sb.hold`): the engine's `HoldSpec` has no offset, so a
  // hold with one is drawn as quads in `wa.on.draw` over the engine's aiming
  // poses, with the engine pointed at a 1x1 silent sheet while it draws. Every
  // other hold stays the engine's own table, with no extra atlas slot.
  const usesAimLayer = holdNeedsAimLayer(project);
  const usesSwing = usesAimLayer && !!project.aimClip?.enabled;
  const usesHoldLocal = usesAimLayer;
  const shotSoundPath = usesFireSequence ? customSoundPath(project, 'shot') : null;
  // A standalone launch WAV uses a filtered `WEAPON_RELEASED` listener because
  // claiming `on_fire` replaces WA's own shot dispatch. When `on_fire` is
  // already owned by `fire_seq` or carried `on_fire`, it plays inside `on_fire`
  // once per trigger instead.
  const launchSoundPath =
    !hasCustomOnFire && project.fireType !== 'melee'
      ? customSoundPath(project, 'launch')
      : null;
  const launchSoundPriority = Math.max(0, Math.round(project.customSounds?.launchPriority ?? 8));
  const launchSoundPlay = launchSoundPath
    ? `wa.sound.play(ev.worm, ${luaQuote(launchSoundPath)}, ${launchSoundPriority})`
    : null;
  const launchInOnFire = !!launchSoundPlay && (usesFireSequence || hasCarriedOnFire);
  const usesStandaloneLaunchSound = !!launchSoundPath && !usesFireSequence && !hasCarriedOnFire;
  // The effects SDK's ribbon trail follows a missile WA builds from this
  // record, so it only applies to the missile families (a strike's bombs are
  // not one: their `m.weapon` is nil).
  const ribbonTrail = project.ribbonTrail;
  const usesRibbonTrail =
    !!ribbonTrail?.enabled &&
    (project.fireType === 'power' || (project.fireType === 'drop' && project.body.fuse));
  // PX's effect manager as a live emitter (`fx.emitter`): a ring, sparks, short
  // bolts and a ribbon at a point that either rides the fired round or sits at
  // the muzzle while the turn's worm aims with this weapon. A melee claim eats
  // the trigger and has no muzzle, so it is excluded.
  const emitter = project.emitter;
  const usesEmitter = !!emitter?.enabled && project.fireType !== 'melee';
  // Trail sampling/drawing remains independent of the emitter actor.
  const emitterRibbon = usesEmitter && !!emitter?.trail?.enabled;
  // The round anchor needs a missile WA builds from this record (a placed mine
  // is a mine entity, a strike's bombs carry no `m.weapon`).
  const emitterRoundOk =
    project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse);
  const emitterAnchor: 'round' | 'muzzle' =
    emitter?.anchor === 'round' && emitterRoundOk ? 'round' : 'muzzle';
  const emitterProjectileExclusive = emitterRoundOk && !!emitter?.projectileExclusive;
  const emitterUsesAim = emitterAnchor === 'muzzle' && !emitterProjectileExclusive;
  // Handing it to the round needs a round, so a placed mine or a strike keeps
  // its emitter at the muzzle instead of leaving one following a missile that
  // will never exist.
  const emitterUsesRound =
    emitterRoundOk &&
    (emitterAnchor === 'round' || emitter?.carry !== false || emitterProjectileExclusive);
  const emitterCarries = emitterUsesAim && emitterUsesRound;
  // Anything in px_effects needs the module required and installed; the trail
  // module on its own installs itself.
  const usesEffectsSdk = usesExplosionEffect || usesEmitter || usesRibbonTrail;

  if (usesHold) {
    lines.push('local holds = require("wf-lib/holds")');
  }
  if (usesMissileSprite || usesAimLayer) {
    // WFWS's fork: flight art (primary + cluster-bit + per-behaviour) and the
    // aiming manager, which share the one module.
    lines.push(`local sb = require(${luaQuote(WFWS_BUILDER_MODULE)})`);
  }
  if (usesFireSequence) {
    lines.push('local seq = require("wf-lib/fire_seq")');
    // The aim clamp (`hold.aim_clamp`) is a limit on the fire angle too: a burst
    // whose direction comes from the live aim is launched along the clamped aim,
    // so the shot cannot leave at an angle the art cannot hold. WA's own vector
    // for a plain record shot is not ours to change.
    const shotClamp = aimClampOf(project);
    if (shotClamp) {
      const lo = Math.max(0, 0.5 - shotClamp.down / 180);
      const hi = Math.min(1, 0.5 + shotClamp.up / 180);
      lines.push(`local AIM_LO, AIM_HI = ${formatNumber(lo)}, ${formatNumber(hi)}`);
      lines.push('local function aim_clamped(a)');
      lines.push('  if a < AIM_LO then return AIM_LO end');
      lines.push('  if a > AIM_HI then return AIM_HI end');
      lines.push('  return a');
      lines.push('end');
    }
    // The worm's live aim as a unit vector: aim 0 is straight down, 1 straight
    // up, and `facing` mirrors it. `wa.math` keeps it deterministic.
    lines.push('local function seq_dir(w)');
    lines.push(`  local ang = (1 - ${shotClamp ? 'aim_clamped(w.aim)' : 'w.aim'}) * math.pi`);
    lines.push('  if w.facing < 0 then ang = 2 * math.pi - ang end');
    lines.push('  return wa.math.sin(ang), -wa.math.cos(ang)');
    lines.push('end');
  }
  if (carriesFuse) {
    // WA's fuse option lives in WA, not in the record: it is the number key the
    // player holds while aiming (1 to 5 seconds), and WA writes it into the
    // shots it fires itself. A burst we launch has to carry it, or every round
    // gets the record's timer (0, which is the fuse the grenade record holds).
    // `wa.world.keys()` is the turn player's synchronised keyboard, so every
    // peer reads the same digit on the same frame.
    lines.push('local FUSE_DEFAULT = ' + String(fuseFallback));
    lines.push('local FUSE_AIM = { [0x67] = true, [0x68] = true, [0x69] = true }');
    lines.push('local fuse_by_worm = {} -- worm id -> milliseconds the player picked');
    lines.push('local fuse_frame = -1');
    lines.push('local function fuse_of(w)');
    lines.push('  local ms = fuse_by_worm[w.id]');
    lines.push('  if ms then return ms end');
    lines.push('  return FUSE_DEFAULT');
    lines.push('end');
  }
  if (usesZap) {
    // Declared here, before the stamp helpers below: `stamp_hit` is a `local
    // function`, and Lua binds the names it uses when it is defined, so a local
    // written after it would leave the function reading a nil global.
    //
    // The module itself is required inside `install(ctx)`, not here: its file
    // reads `wa.depth` and calls `wa.assets.load` at load time, and a component
    // file may only *return its data* (`wa` is unavailable while declaring, so
    // a top-level require fails the whole bundle with "use wa in install(ctx)").
    // The arm only ever runs from a callback, long after install.
    lines.push('local zap');
  }
  if (usesTerrainStamp && terrainStamp!.onImpact) {
    // PX's 32 stamp orientations (`px_ninja_star` / `javelin` / the girder
    // launcher share it): the sheet's frame 0 points up and turns clockwise, so
    // a heading maps straight to a frame. Screen space, y down, so 8 is right
    // and 16 is down. It sits outside the callback to keep `on_explode` flat.
    lines.push('-- PX\'s 32 stamp orientations: frame 0 points up, clockwise.');
    if (usesMissileSprite) {
      // The builder gives the round a rotation of its own (a spin, a `slow`
      // cycle, a dig pose, the roam tilt), so the picture in the land should lie
      // the way the round looked, not the way it happened to be moving.
      // `sb.heading` is nil for a round the builder handed back to WA (a stock
      // sheet), and that is when the velocity is the only heading there is, so
      // the argument is a fallback chain rather than a switch. It carries the
      // world rotation only: the weapon-wide `angle` is the art's own offset and
      // would tilt a stamp whose art is authored pointing up.
      lines.push('-- A builder-drawn round bursts at the angle it was drawn at; a');
      lines.push('-- native one only has its velocity.');
      lines.push('local function stamp_orientation(vx, vy, deg)');
      lines.push('  if deg then return math.floor(deg / 11.25 + 0.5) % 32 end');
    } else {
      lines.push('local function stamp_orientation(vx, vy)');
    }
    lines.push('  local function trunc(n) return n < 0 and math.ceil(n) or math.floor(n) end');
    lines.push('  if vx == 0 then return vy > 0 and 16 or 0 end');
    lines.push('  if vy == 0 then return vx > 0 and 8 or 24 end');
    lines.push('  if vx > 0 and vy < 0 then return math.min(trunc(3 * vx / -vy), 7) end');
    lines.push('  if vx > 0 then return math.min(trunc(8 + 3 * vy / vx), 15) end');
    lines.push('  if vy > 0 then return math.min(trunc(16 + 3 * -vx / vy), 23) end');
    lines.push('  return math.min(trunc(24 + 3 * -vy / -vx), 31)');
    lines.push('end');
  }
  if (usesTerrainStamp && stampClearance > 0) {
    // The worm check runs in the callback (below), but the list walk and the
    // radius live here so `on_explode` stays one statement per feature.
    //
    // `wa.worms.all()` is WA's own live list: a worm with no health left is not
    // in it, so a corpse under the impact does not block the stamp. The test is
    // a square half-extent, the same shape PX's ninja star uses to decide
    // whether the impact hit a creature.
    lines.push('-- A worm inside the stamp would be sealed into the land.');
    lines.push(`local STAMP_CLEAR = ${stampClearance}`);
    lines.push('local function stamp_clear(x, y)');
    lines.push('  for _, w in ipairs(wa.worms.all()) do');
    lines.push('    if math.abs(w.x - x) < STAMP_CLEAR and math.abs(w.y - y) < STAMP_CLEAR then');
    lines.push('      return false');
    lines.push('    end');
    lines.push('  end');
    lines.push('  return true');
    lines.push('end');
  }
  if (usesImpactDamage) {
    // PX's javelin: pierce what is at the impact point, and stick in the land
    // only when nothing was there. `electrical_nearby` is the engine's broad
    // prefilter (the javelin scans 29 px for a 20 px test), then our own square
    // decides: the same shape `within()` uses in px_javelin.
    //
    // Graves are left out by the `false`: there is nothing there to damage.
    // `spare_shooter` keeps the worm that fired out of it, which is why a spear
    // that bursts in your hands stabs nothing (PX's javelin does the same).
    const hit = stampImpact!;
    const damage = Math.max(0, Math.round(hit.damage));
    const radius = Math.max(1, Math.min(64, Math.round(hit.radius)));
    const impulse = Math.max(0, Math.min(1, Number(hit.impulse) || 0));
    lines.push('-- Damage instead of a blast (PX\'s javelin): the round pierces what it hits.');
    lines.push(
      `local STAMP_HIT = { damage = ${damage}, radius = ${radius}, impulse = ${formatNumber(impulse)}, kind = ${luaQuote(hit.kind)}, spare_shooter = ${hit.spareShooter ? 'true' : 'false'} }`,
    );
    lines.push('local function stamp_hit(ev)');
    lines.push('  local vx, vy = ev.vx or 0, ev.vy or 0');
    lines.push('  local mine = ev.worm and ev.worm.id');
    lines.push('  local scan = STAMP_HIT.radius + 16');
    if (hit.kind === 'taze') {
      // Same arm the burst uses: the pierce is one `o:hurt`, so the hold takes
      // the worm that hurt landed on, and `retain` keeps the pierce's push for
      // the release instead of dropping it.
      lines.push('  zap.set_message_electric(20, 0, -4, true, 2)');
    }
    lines.push('  for _, o in ipairs(wa.world.electrical_nearby(ev.x, ev.y, scan, false)) do');
    lines.push('    local worm = o.kind == "worm"');
    lines.push('    if (worm or o.kind == "mine" or o.kind == "crate" or o.kind == "oil")');
    lines.push('      and not (worm and STAMP_HIT.spare_shooter and mine and o.id == mine)');
    lines.push('      and math.abs(o.x - ev.x) < STAMP_HIT.radius');
    lines.push('      and math.abs(o.y - ev.y) < STAMP_HIT.radius then');
    lines.push('      if worm then');
    lines.push('        o:hurt{ amount = STAMP_HIT.damage, vx = vx * STAMP_HIT.impulse,');
    lines.push('                 vy = vy * STAMP_HIT.impulse, kind = STAMP_HIT.kind }');
    lines.push('      else');
    lines.push('        o:hit(STAMP_HIT.damage, vx * STAMP_HIT.impulse, vy * STAMP_HIT.impulse,');
    lines.push('          STAMP_HIT.kind)');
    lines.push('      end');
    lines.push('      return true');
    lines.push('    end');
    lines.push('  end');
    lines.push('  return false');
    lines.push('end');
  }
  if (usesEffectsSdk) {
    // The claim names `trail.BEAM` and `trail.GLOW` for every weapon that
    // installs the effects SDK, not only the ones with a ribbon card: the
    // shared library draws every mod's sheets, so the whole set is claimed.
    // The module therefore has to be in scope whenever the SDK is, or a
    // burst-only weapon indexes a nil `trail` at install and fails to load.
    lines.push('local trail = require("wf-lib/effects/trail")');
  }
  if (usesEffectsSdk) {
    if (usesEmitter || usesExplosionEffect || usesRibbonTrail) {
      lines.push('local fx = require("wf-lib/effects/px_effects")');
    }
    if (silencesBlast) {
      lines.push('local blast = require("wf-lib/effects/custom_explosion")');
    }
  }
  if (usesHold || usesMissileSprite || usesRibbonTrail || usesEffectsSdk || usesFireSequence) {
    lines.push('');
  }

  // Record tables read from another bundle (`recordExtra`): the engine's own
  // key names, written back over the base record so the module's declared
  // values win and every key it does not declare keeps the `.wep`/donor value.
  // They are emitted as explicit assignments rather than a `pairs` merge: the
  // order is then fixed in the file, which is what wfcheck's `lockstep-pairs`
  // rule wants, and the result reads like the record it came from.
  const extraAssignments = project.recordExtra ? recordAssignments(project.recordExtra) : [];

  // Carried preamble (M2 of the capture plan): the module-level `require`s,
  // constants and helpers the carried hooks close over. They belong with the
  // generated requires, because they are the same kind of thing, a name a
  // callback reads at run time, and they come after them so a carried unit that
  // reads `fx` gets the file's own `fx` rather than being shadowed by a second.
  const carriedLua = project.carriedLua;
  const carriedPreamble = (carriedLua?.preamble ?? []).filter((block) => !block.disabled);
  const carriedPrologue = (carriedLua?.prologue ?? []).filter((block) => !block.disabled);
  if (carriedPreamble.length) {
    // The `not generated` markers are load-bearing, not decoration: `checkLua`
    // reads them to say a finding below is in code no panel produced, which is
    // what makes the Carried Lua panel's report about the carried code rather
    // than about the file, and what lets an author see that switching a block
    // off left a nil behind. They are comments, so the masked copies every
    // scanner uses (and therefore the carry's own comparisons) never see them.
    lines.push(NOT_GENERATED_OPEN);
    lines.push('-- Carried from the source bundle: the declarations its hooks close over.');
    for (const block of carriedPreamble) {
      lines.push(...reindentCode(block.text, ''));
    }
    lines.push(NOT_GENERATED_CLOSE);
    lines.push('');
  }

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

  // The held-art table. Computed once: with the aim layer it has to exist as a
  // local before the claim (`sb.hold` keeps the table and reads it on every
  // draw), otherwise it stays inline in the claim.
  const holdRows: string[] = [];
  // The hand art and its live placement, shared by the hold table and the firing
  // role. The engine only draws the hand in the aiming states, so the layer
  // draws it on the firing frames too or it disappears for the whole burst.
  const handRows: string[] = [];
  if (usesHold) {
    const h = project.hold;
    const handIdx = h.handType === 'lower' ? 1 : h.handType === 'upper' ? 3 : 2;
    const drawHand = h.drawHand !== false;
    handRows.push(`hand = holds.PX_HANDS[${handIdx}],`);
    handRows.push(`hand_type = ${handIdx},`);
    handRows.push(`hand_radius = ${drawHand ? (h.handRadius ?? 10) : 0.01},`);
    // The engine reads `hand_rotation` in turns of PI (`rot + PI*hand_rotation`),
    // so the panel's degrees become `1 + deg/180` the way `weap_rotation` does.
    const handDeg = h.handRotation ?? 0;
    handRows.push(
      `hand_rotation = ${
        Math.abs(handDeg) < 0.0001
          ? '1'
          : (1 + handDeg / 180).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
      },`,
    );
    handRows.push(`hand_radial_rotation = ${formatNumber(h.handRadialRotation ?? 1)},`);
    // The quad layer measures the hand's cell itself, so it needs the pixel
    // size; the engine scales each sheet natively and ignores this key. PX's
    // three hand sheets are 60x60.
    handRows.push('hand_size = 60,');
    holdRows.push(`sheet = ${luaQuote(holdSheetPath(project))},`);
    holdRows.push(`weap_radius = ${h.weapRadius ?? 6},`);
    holdRows.push(`weap_rotation = ${(1 + (h.weapRotation || 0) / 180).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')},`);
    holdRows.push(`weap_radial_rotation = ${formatNumber(h.weapRadialRotation ?? 1)},`);
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
    if (h.handScale && h.handScale !== 1) handRows.push(`hand_scale = ${h.handScale},`);
    if (!drawHand) handRows.push('draw_hand = false,');
    // The engine reads the hand keys off the claim's hold table; `sb.hold`
    // draws the same numbers from the local table.
    for (const row of handRows) holdRows.push(row);
    if (h.keepWhileFiring) holdRows.push('keep_while_firing = true,');
    if (h.thrown) holdRows.push('thrown = true,');
    if (h.putAway) holdRows.push('put_away = true,');
    // The aiming manager needs the weapon id, and the engine ignores the key.
    if (usesHoldLocal) holdRows.push('weapon = ctx.id,');
    if (usesFiringHold) holdRows.push('keep_firing = true,');
    if (usesAimLayer) {
      // The quad layer draws the cell itself, so it needs the sheet's own pixel
      // size (the engine scales the sheet natively and ignores these keys). It
      // also needs the mute: a 1x1 transparent sheet as `hold.sheets[1]`, which
      // is what `wa.weapons.hold_sheet` switches to while the quads draw.
      const fallback = defaultArtFor(project);
      const holdCells = Math.max(1, Math.round(h.sheetFrames ?? h.frames ?? 1));
      const cellW = Math.max(1, Math.round(h.sheetWidth ?? fallback.width));
      const cellH = Math.max(
        1,
        Math.round(h.sheetFile ? (h.sheetHeight ?? fallback.height) / holdCells : fallback.height),
      );
      holdRows.push(`cell_w = ${cellW},`);
      holdRows.push(`cell_h = ${cellH},`);
      if ((h.offsetX ?? 0) !== 0 || (h.offsetY ?? 0) !== 0) {
        holdRows.push(
          `offset = { x = ${formatNumber(h.offsetX ?? 0)}, y = ${formatNumber(h.offsetY ?? 0)} },`,
        );
      }
      holdRows.push(`silent_sheet = ${luaQuote(silentHoldSheetPath(project))},`);
      if ((h.handOffsetX ?? 0) !== 0 || (h.handOffsetY ?? 0) !== 0) {
        holdRows.push(
          `hand_offset = { x = ${formatNumber(h.handOffsetX ?? 0)}, y = ${formatNumber(h.handOffsetY ?? 0)} },`,
        );
      }
      // The Space swing. Data, not Lua: `sb.hold` evaluates the keys on the
      // 50 Hz clock, so the preview and the game run the same arithmetic.
      const clip = project.aimClip;
      const clipOn = !!clip?.enabled || !!project.melee?.enabled;
      // A melee strike lands on a tick of the swing and `sb.hold` only builds
      // the strike when there is a clip (`if melee_spec and clip`), so `melee`
      // with no keys used to ship a layer that registers and a Space press that
      // does nothing at all. The panel refuses to delete the last key, but an
      // imported bundle can carry an empty `swing`, so the export writes the one
      // key such a strike needs, a pose at its hit frame, and says why.
      const melee = project.melee;
      const strikes = melee?.enabled ? meleeStrikes(melee) : [];
      const keys = clip ? [...clip.keys].sort((a, b) => a.t - b.t) : [];
      const synthKey = !!melee?.enabled && keys.length === 0;
      if (synthKey) {
        keys.push({
          t: Math.max(0, strikes[0]?.frame ?? 0),
          angle: 0,
          dx: 0,
          dy: 0,
          scale: 1,
          alpha: 1,
          ease: 'out_quad',
        });
      }
      // `aim_clamp`: degrees either side of level. The layer clamps the pose it
      // draws and the aim a strike is thrown with, so a swing cannot start from
      // straight up or straight down (and a cut cannot reach there either). It
      // stands on its own: a firearm with no clip still limits its aim.
      const clamp = aimClampOf(project);
      if (clamp) {
        holdRows.push(
          `aim_clamp = { up = ${formatNumber(clamp.up)}, down = ${formatNumber(clamp.down)} },`,
        );
      }
      if (clipOn && keys.length > 0) {
        if (synthKey) {
          holdRows.push(
            '-- no aim clip keys to swing with: one pose at the strike frame, so a',
          );
          holdRows.push('-- melee weapon cannot ship a Space press that does nothing.');
        }
        holdRows.push('swing = {');
        holdRows.push(
          `  ticks = ${formatNumber(Math.max(1, clip?.ticks ?? (keys[keys.length - 1]?.t ?? 1) + 1))},`,
        );
        // `finish = "end_turn"` zeroes the turn clock when the clip ends. That is
        // what a clip-only weapon wants (it ate the fire, so nothing else would
        // end the turn), and exactly what a melee must not do: WA ends the turn
        // itself once its shot resolves, and the retreat window is the control
        // the player keeps until then.
        if (clip?.finish === 'endTurn' && !meleeGhost) {
          holdRows.push('  finish = "end_turn",');
        }
        holdRows.push('  keys = {');
        for (const key of keys) {
          const parts = [
            `t = ${formatNumber(key.t)}`,
            `angle = ${formatNumber(key.angle)}`,
            `dx = ${formatNumber(key.dx)}`,
            `dy = ${formatNumber(key.dy)}`,
            `scale = ${formatNumber(key.scale ?? 1)}`,
          ];
          if (key.frame !== undefined) parts.push(`frame = ${formatNumber(key.frame)}`);
          if (key.alpha !== undefined && key.alpha !== 1) {
            parts.push(`alpha = ${formatNumber(key.alpha)}`);
          }
          // `fade = false`: the opacity steps at this key instead of easing into
          // it, so a snap-back pose does not fade out on its way home.
          if (key.fade === false) parts.push('fade = false');
          parts.push(`ease = ${luaQuote(key.ease)}`);
          holdRows.push(`    { ${parts.join(', ')} },`);
        }
        holdRows.push('  },');
        // The ghost trail: `sb.hold` evaluates the same clip at earlier ticks,
        // so nothing is recorded and every peer draws the same smear.
        const echo = clip?.echo;
        if (echo?.enabled) {
          holdRows.push(
            `  echo = { count = ${Math.round(echo.count)}, every = ${Math.round(
              echo.every,
            )}, fade = ${formatNumber(echo.fade)}, blend = ${luaQuote(echo.blend)} },`,
          );
        }
        holdRows.push('},');
      }
      // The melee strike: the scan box the swing lands, and the hit itself. The
      // geometry and the timing stay in `sb.hold` (one clock, one formula the
      // panel's red box also uses); the weapon owns what a hit *does*, so the
      // damage, the kind and the taze module stay in this file.
      if (melee?.enabled) {
        // The strikes, in the order they land. One is the shape this file has
        // always written (`hit_frame` / `damage` / `power`), so an untouched
        // weapon's export does not change; two or more also carry a `hits`
        // table, and the first strike is still written the old way so an older
        // installed SDK lands something.
        const hitFrame = strikes[0].frame;
        const damage = Math.max(0, Math.round(strikes[0].damage));
        holdRows.push('melee = {');
        holdRows.push(`  radius = ${formatNumber(Math.max(1, melee.radius))},`);
        holdRows.push(`  width = ${formatNumber(Math.max(0, melee.width))},`);
        holdRows.push(`  follow_swing = ${melee.followSwing === false ? 'false' : 'true'},`);
        holdRows.push(`  hit_frame = ${hitFrame},`);
        if (melee.pushMode === 'fixed') {
          holdRows.push(
            `  push = { x = ${formatNumber(melee.pushVx)}, y = ${formatNumber(melee.pushVy)} },`,
          );
        } else {
          holdRows.push('  push = "aim",');
          holdRows.push(`  power = ${formatNumber(melee.pushPower)},`);
        }
        if ((strikes[0].lift ?? 0) !== 0) holdRows.push(`  lift = ${formatNumber(strikes[0].lift)},`);
        if (strikes.length > 1) {
          const rows = strikes.map((hit, index) => {
            const parts = [
              `frame = ${hit.frame}`,
              `damage = ${formatNumber(Math.max(0, Math.round(hit.damage)))}`,
            ];
            if (melee.pushMode !== 'fixed') parts.push(`power = ${formatNumber(hit.power)}`);
            // Every listed strike writes its own `lift`, zero included: a
            // missing key inherits the weapon's `lift` in `hold_melee_hits`, so
            // a strike that throws flat was thrown with the first strike's lift.
            parts.push(`lift = ${formatNumber(hit.lift ?? 0)}`);
            if (hit.vx !== undefined) parts.push(`vx = ${formatNumber(hit.vx)}`);
            if (hit.vy !== undefined) parts.push(`vy = ${formatNumber(hit.vy)}`);
            // A strike with a sound of its own: a lighter jab before the heavy
            // one. Written on the row it belongs to, so the weapon's own sound
            // stays the fallback for every strike that names none.
            const sound = hit.sound;
            if (sound?.file) {
              parts.push(`wav = ${luaQuote(meleeSoundPath(project, 'hit', index)!)}`);
            } else if ((sound?.id ?? 0) > 0) {
              parts.push(`sound = ${Math.round(sound!.id)}`);
            }
            if (sound && (sound.priority ?? 8) !== 8) {
              parts.push(`priority = ${Math.max(0, Math.round(sound.priority))}`);
            }
            return `{ ${parts.join(', ')} },`;
          });
          holdRows.push(`  hits = {`);
          for (const row of rows) holdRows.push(`    ${row}`);
          holdRows.push('  },');
        }
        // The strike's sounds. The hit sound plays where a strike lands, the miss
        // sound at the striker when it reaches nobody; the claim eats WA's fire,
        // so the record's own sound never plays and a whiff would be silent.
        // Either can be WA's own id or an uploaded WAV: a WAV wins (the same rule
        // as `fireDrawHand ?? drawHand`) and is declared in the claim's `sounds`.
        const meleeSoundRows = (role: 'hit' | 'miss', sound: MeleeSound | undefined) => {
          if (!sound) return;
          const priority = Math.max(0, Math.round(sound.priority ?? 8));
          if (sound.file) {
            holdRows.push(`  ${role}_wav = ${luaQuote(meleeSoundPath(project, role)!)},`);
          } else if ((sound.id ?? 0) !== 0) {
            holdRows.push(`  ${role}_sound = ${Math.max(0, Math.round(sound.id))},`);
          }
          // WA's own playback takes the same third argument, so one row serves
          // both kinds; the engine default is 8.
          if (priority !== 8) holdRows.push(`  ${role}_priority = ${priority},`);
        };
        meleeSoundRows('hit', melee.hitSound);
        meleeSoundRows('miss', melee.missSound);
        if (melee.oncePerTarget === false) holdRows.push('  once = false,');
        if (melee.spareShooter === false) holdRows.push('  spare_shooter = false,');
        // The only way to tell a swing that never started from one that tested
        // an empty box: the tick, the scan vector and every worm it took.
        if (melee.log) holdRows.push('  log = true,');
        // What a hit does. `sb.hold` tests the box and hands over the victim and
        // the throw; this callback is the weapon's own.
        // The fourth argument is the strike that landed (`{ frame, damage,
        // power, lift, ... }`), so a combo gives each hit its own damage; the
        // literal fallback keeps a three-argument caller (an older installed
        // SDK) landing the same hit.
        if (melee.kind === 'taze') {
          holdRows.push(
            `  hit = function(victim, vx, vy, hit) zap.hurt_electric(` +
              `victim, hit and hit.damage or ${damage}, ` +
              '{ frames = 25, push_x = vx, push_y = vy, retain = true }) end,',
          );
        } else {
          holdRows.push(
            `  hit = function(victim, vx, vy, hit) victim:hurt{ ` +
              `amount = hit and hit.damage or ${damage}, vx = vx, vy = vy } end,`,
          );
        }
        holdRows.push('},');
      }
      // A second hand on the weapon. `HoldSpec` has one hand slot, so the aim
      // layer draws this one with the engine's own hand maths; its art is its
      // own upload or, the usual case, the first hand's sheet.
      const extra = h.extraHand;
      if (extra?.enabled) {
        const rotation = (deg: number) =>
          (1 + deg / 180).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
        holdRows.push('extra_hand = {');
        const own = extraHandSheetPath(project);
        if (own) holdRows.push(`  sheet = ${luaQuote(own)},`);
        holdRows.push(`  radius = ${formatNumber(extra.radius)},`);
        holdRows.push(`  rotation = ${rotation(extra.rotation)},`);
        holdRows.push('  radial_rotation = 1,');
        holdRows.push(`  scale = ${formatNumber(extra.scale)},`);
        // The quad layer measures the cell itself; the engine ignores this key.
        // A hand cell is always 60 px, even when the uploaded PNG has transparent
        // padding or a wider canvas. Using the source width made a 100 px support
        // hand noticeably larger than WA's own 60 px hand.
        holdRows.push('  size = 60,');
        if ((extra.offsetX ?? 0) !== 0 || (extra.offsetY ?? 0) !== 0) {
          holdRows.push(
            `  offset = { x = ${formatNumber(extra.offsetX)}, y = ${formatNumber(extra.offsetY)} },`,
          );
        }
        // The firing role's own grip, written only where it differs: the
        // firing pass is its own pose, and an unset key means "the aiming
        // numbers" (`fire_draw` defaults on, so the hand does not vanish). No
        // firing pass, no firing keys.
        const hasFiringPass = usesFiringArt || usesFiringHold;
        const aimScale = extra.scale ?? 1;
        const aimOffX = extra.offsetX ?? 0;
        const aimOffY = extra.offsetY ?? 0;
        const fireOffX = extra.fireOffsetX ?? aimOffX;
        const fireOffY = extra.fireOffsetY ?? aimOffY;
        if (hasFiringPass && extra.fireDraw === false) holdRows.push('  fire_draw = false,');
        if (hasFiringPass && extra.fireRadius !== undefined) {
          holdRows.push(`  fire_radius = ${formatNumber(extra.fireRadius)},`);
        }
        if (hasFiringPass && extra.fireRotation !== undefined) {
          holdRows.push(`  fire_rotation = ${rotation(extra.fireRotation)},`);
        }
        if (hasFiringPass && extra.fireScale !== undefined && extra.fireScale !== aimScale) {
          holdRows.push(`  fire_scale = ${formatNumber(extra.fireScale)},`);
        }
        if (
          hasFiringPass &&
          (extra.fireOffsetX !== undefined || extra.fireOffsetY !== undefined) &&
          (fireOffX !== aimOffX || fireOffY !== aimOffY)
        ) {
          holdRows.push(
            `  fire_offset = { x = ${formatNumber(fireOffX)}, y = ${formatNumber(fireOffY)} },`,
          );
        }
        holdRows.push('},');
      }
      // The firing role. Its own sheet, cell, size, strip, window and hand, so
      // the aim entry and the firing entry never share a number by accident.
      if (usesFiringArt) {
        const fallback = defaultArtFor(project);
        const holdCells = Math.max(1, Math.round(h.sheetFrames ?? h.frames ?? 1));
        const holdCell = Math.min(
          h.sheetWidth ?? fallback.width,
          h.sheetFile ? (h.sheetHeight ?? fallback.height) / holdCells : fallback.height,
        );
        const fireFrames = Math.max(1, Math.round(h.fireFrames ?? 1));
        const flashW = Math.max(0, h.flashWidth ?? 0);
        const flashH = Math.max(0, h.flashHeight ?? 0);
        // The firing sheet is WA's own strip rule (`load_strip_bytes`): the
        // cell is the sheet's **width** and its height over the frame count, so
        // one frame is the whole picture (a muzzle flash is wide, not square)
        // and a strip is cut out of the height. The cell used to be forced
        // square, which drew a 113x32 flash into a 32x32 quad, squashed.
        const cellH = Math.max(1, flashH > 0 ? Math.floor(flashH / fireFrames) : holdCell);
        const cellW = Math.max(1, flashW > 0 ? flashW : cellH);
        const fireFps = Math.max(1, Number(h.fireFps) || 15);
        const fireScale = h.fireScale ?? h.scale ?? 1;
        const fireRadius = h.fireWeapRadius ?? h.weapRadius ?? 6;
        const fireRotation = h.fireWeapRotation ?? h.weapRotation ?? 0;
        const fireHandDeg = h.fireHandRotation ?? h.handRotation ?? 0;
        const fireHandScale = h.fireHandScale ?? h.handScale ?? 1;
        const fireHandIdx = h.handType === 'lower' ? 1 : h.handType === 'upper' ? 3 : 2;
        const rotation = (deg: number) =>
          (1 + deg / 180).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
        holdRows.push('fire = {');
        holdRows.push(`  sheet = ${luaQuote(flashSheetPath(project))},`);
        holdRows.push(`  cell_w = ${cellW},`);
        holdRows.push(`  cell_h = ${cellH},`);
        holdRows.push(`  scale = ${formatNumber(fireScale)},`);
        if (fireFrames > 1) {
          holdRows.push(`  frames = ${fireFrames},`);
          holdRows.push(`  anim_speed = ${formatNumber(fireFps / (1.5 * fireFrames))},`);
        }
        // Unset means one whole strip cycle (WA's own two firing frames are too
        // short to see anything else), which is the default the panel shows too.
        const fireTicks = Math.max(
          0,
          Math.round(h.fireTicks ?? Math.max(2, Math.ceil((fireFrames * 50) / fireFps))),
        );
        holdRows.push(`  ticks = ${fireTicks},`);
        if (h.fireHideMain) holdRows.push('  hide_main = true,');
        // The role's own nudge, the same channel the held art has.
        if ((h.fireOffsetX ?? 0) !== 0 || (h.fireOffsetY ?? 0) !== 0) {
          holdRows.push(
            `  offset = { x = ${formatNumber(h.fireOffsetX ?? 0)}, y = ${formatNumber(h.fireOffsetY ?? 0)} },`,
          );
        }
        holdRows.push(`  weap_radius = ${fireRadius},`);
        holdRows.push(`  weap_rotation = ${rotation(fireRotation)},`);
        holdRows.push(`  weap_radial_rotation = ${formatNumber(h.weapRadialRotation ?? 1)},`);
        holdRows.push(`  hand = holds.PX_HANDS[${fireHandIdx}],`);
        holdRows.push(`  hand_type = ${fireHandIdx},`);
        holdRows.push(`  hand_radius = ${h.fireHandRadius ?? h.handRadius ?? 10},`);
        holdRows.push(`  hand_rotation = ${rotation(fireHandDeg)},`);
        holdRows.push(`  hand_radial_rotation = ${formatNumber(h.handRadialRotation ?? 1)},`);
        holdRows.push('  hand_size = 60,');
        if (fireHandScale !== (h.handScale ?? 1)) {
          holdRows.push(`  hand_scale = ${formatNumber(fireHandScale)},`);
        }
        if ((h.fireHandOffsetX ?? 0) !== 0 || (h.fireHandOffsetY ?? 0) !== 0) {
          holdRows.push(
            `  hand_offset = { x = ${formatNumber(h.fireHandOffsetX ?? 0)}, y = ${formatNumber(h.fireHandOffsetY ?? 0)} },`,
          );
        }
        // The panel's checkbox is `fireDrawHand ?? drawHand`, so the emitted
        // key has to resolve the same way: with only the aim hand turned off,
        // the firing role used to keep drawing a hand at `hand_radius`. When the
        // aim role turned the hand off (`draw_hand = false`) and firing wants
        // it back on, write `draw_hand = true`.
        if ((h.fireDrawHand ?? h.drawHand) === false) holdRows.push('  draw_hand = false,');
        else if (h.drawHand === false && h.fireDrawHand === true) holdRows.push('  draw_hand = true,');
        holdRows.push('},');
      }
    }
  }

  // Install function
  lines.push('  install = function(ctx)');
  if (carriesFuse) {
    // A statement, so it sits above the claim rather than inside it: the fuse
    // the player picks while aiming is sampled once per 50 Hz frame, and the
    // burst reads the last pick off it.
    lines.push("    -- The fuse the player picked while aiming (WA's fuse option), sampled");
    lines.push('    -- once per 50 Hz frame: the digit keys are the turn player\'s, from the');
    lines.push('    -- lockstep keyboard, so every peer sees the same value.');
    lines.push('    wa.on.worm_message(function()');
    lines.push('      local now = wa.world.frame() or 0');
    lines.push('      if now == fuse_frame then return end');
    lines.push('      fuse_frame = now');
    lines.push('      local keys = wa.world and wa.world.keys and wa.world.keys() or nil');
    lines.push('      local digit = keys and keys.digit or nil');
    lines.push('      if digit == nil then return end');
    lines.push('      local worms = wa.worms.all()');
    lines.push('      for i = 1, #worms do');
    lines.push('        local w = worms[i]');
    lines.push('        if w.turn and w.weapon == ctx.id and FUSE_AIM[w.state_id]');
    lines.push('          and digit >= 1 and digit <= 5 then');
    lines.push('          fuse_by_worm[w.id] = digit * 1000');
    lines.push('        end');
    lines.push('      end');
    lines.push('    end, { msgs = { wa.msg.FRAME_FINISH } })');
    lines.push('');
  }
  if (usesZap) {
    // `px.electric`'s damage module uses `wa` at load (its depth, sheets and
    // loop sound), so it can only be required here. Assigning the outer local
    // is what the callbacks and `stamp_hit` read.
    lines.push('    zap = require("wf-lib/electric/damage")');
  }
  if (usesEffectsSdk) {
    // px_effects draws through a hidden driver actor, so it has to be installed
    // before a round can explode or an emitter can tick; `trail = true` also
    // installs the ribbon module the trail block below samples with.
    //
    // The burst goes in front (`wa.depth.FRONT`), not on the SDK's `EFFECTS`
    // band: in `effect` mode WA's own blast animation is drawn over that band,
    // so the ring only surfaced once the boom had played out, a second later,
    // by which time the envelope was nearly gone. Worms and the whole blast are
    // what it should cover; the smoke stays on its own band behind it.
    // Either ribbon card installs the shared sampler and draw callback.
    const sdkTrail = usesRibbonTrail || emitterRibbon;
    lines.push(
      `    fx.install{ trail = ${sdkTrail ? 'true' : 'false'}, depth = { burst = wa.depth.FRONT } }`,
    );
  }
  if (usesEmitter) {
    emitEmitterBlock(lines, emitter!, {
      anchor: emitterAnchor,
      usesAim: emitterUsesAim,
      usesRound: emitterUsesRound,
      carries: emitterCarries,
      projectileExclusive: emitterProjectileExclusive,
      roundOk: emitterRoundOk,
      keepWhileFiring: !!project.hold?.keepWhileFiring,
    });
  }
  if (usesHoldLocal) {
    // With the aiming manager the table is built by `sb.hold`, which returns the
    // engine's key set and attaches the quad layer (the aim poses, the held art
    // on WA's firing frames, and the firing role).
    lines.push(usesAimLayer ? '    local hold = sb.hold(ctx, {' : '    local hold = {');
    for (const row of holdRows) lines.push(`      ${row}`);
    lines.push(usesAimLayer ? '    })' : '    }');
  }
  // Carried prologue (M3): the install-time locals and helpers the hooks close
  // over. They go after every generated install-time statement, so a carried
  // helper that calls a library the panel installed (`fx.burst`, `zap.hurt`) runs
  // against an installed library, and before the claim, because the claim's hook
  // bodies are the only thing that needs them.
  if (carriedPrologue.length) {
    lines.push(`    ${NOT_GENERATED_OPEN}`);
    lines.push('    -- Carried from the source bundle: the install-time locals its hooks close over.');
    for (const block of carriedPrologue) {
      lines.push(...reindentCode(block.text, '    '));
    }
    lines.push(`    ${NOT_GENERATED_CLOSE}`);
    lines.push('');
  }

  lines.push(extraAssignments.length > 0 ? '    local rec = {' : '    wa.weapons.replace{');
  lines.push(`      name = ${luaQuote(project.name)},`);
  const wepPath = wepBundlePath(project);
  if (wepPath) {
    // `wep` and `copy_from` are mutually exclusive. The .wep supplies the
    // complete native record; the tables below only carry edits.
    lines.push(`      wep = ${luaQuote(wepPath)},`);
  } else if (donorKnown) {
    lines.push(`      copy_from = ${luaQuote(donor)},`);
  } else {
    lines.push(
      `      -- no copy_from: ${luaQuote(donorName)} is not one of WA's own weapons, ` +
        'and the engine refuses a bundle that names one it does not know',
    );
  }
  if (meleeGhost) {
    // A ghost that crosses a crate would collect it for the team, which is a
    // visible effect of a shot nobody asked for.
    lines.push('      collects_crates = false,');
  }
  if (usesSwing && !meleeGhost) {
    // Space plays the clip instead of firing. WA's dispatch is eaten, so
    // nothing leaves the worm; the clip's `finish` hands the turn back. A melee
    // claim does the opposite: it fires a ghost shot so WA, not the clip, owns
    // the turn (see `meleeGhost`).
    lines.push('      eat_fire = true,');
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
  // The hold sheet has to be claimed whenever something draws it as a quad,
  // not only when the author uploaded one. `wa.draw.quad{ sprite = path }`
  // resolves through the sprite-key registry that `sprites` fills, so the aim
  // layer (`sb.hold`) drew nothing at all for a hold built from the default
  // art: the engine's own copy was muted while the quads failed to resolve.
  // An uploaded sheet was claimed by accident, which is why only uploaded
  // holds swung in game.
  if (usesHold && (project.hold?.sheetFile || usesAimLayer)) {
    packSprites.push(luaQuote(holdSheetPath(project)));
  }
  if (usesHold && project.hold?.flashFile) {
    packSprites.push(luaQuote(flashSheetPath(project)));
  }
  // A quad resolves its path through the claim's registry, so the second hand
  // has to be listed here whenever it has art of its own.
  const extraHandPath = usesHold ? extraHandSheetPath(project) : null;
  if (extraHandPath) packSprites.push(luaQuote(extraHandPath));
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
    if (roamRole) packSprites.push(luaQuote(behaviorStateSheetPath(project, 'roam')));
  }
  // A shared effects library registers one draw callback per mod, so the claim
  // that has to resolve a quad need not be the mod that made the effect. List
  // every sheet `px_effects` can draw whenever this weapon installs it, not
  // only the ones this weapon switched on: the first mod's `wa.on.draw` used to
  // draw another mod's spark, and the engine refused the quad (`sprite ... is
  // not installed`) under a claim that never named the spark sheet.
  const claimSdkSheet = (name: string) => {
    if (!packSprites.includes(name)) packSprites.push(name);
  };
  if (usesRibbonTrail || emitterRibbon) {
    claimSdkSheet('trail.BEAM');
    claimSdkSheet('trail.GLOW');
  }
  if (usesExplosionEffect || usesEmitter) {
    claimSdkSheet('trail.BEAM');
    claimSdkSheet('trail.GLOW');
    claimSdkSheet('fx.SPARK');
    claimSdkSheet('fx.BLOB');
    claimSdkSheet('fx.SMOKE');
  }
  if (stampSheetPath) {
    packSprites.push(luaQuote(stampSheetPath));
  }
  // Sheets the carried code names (M6): a `wa.draw.quad{ sprite = HOLE }` can
  // only resolve a pack path the claim fills the sprite-key registry with, and
  // that is this list.
  for (const sheet of project.carriedLua?.art?.sprites ?? []) {
    if (!packSprites.includes(luaQuote(sheet))) packSprites.push(luaQuote(sheet));
  }
  if (packSprites.length > 0) {
    lines.push(`      sprites = { ${packSprites.join(', ')} },`);
  }

  // `sb.hold` draws the hold and firing sheets through `wa.draw.quad`, which
  // resolves a pack path through the same sprite-key registry the claim fills.
  // The engine already packs every `hold.sheet` into the GPU atlas by itself
  // (`apply.rs`'s `hold_sheet` test), so this is belt-and-braces: it is the key
  // PX's own fire_seq weapons pass (`params = { gpu_prefix = "sprites/" }`),
  // and it keeps the quad's path resolving if a build ever stops claiming the
  // hold sheet implicitly.
  //
  // It is skipped when the claim has art WA itself has to draw from a real slot:
  // `gpu_prefix` moves every matching path to a virtual atlas id, and a body or
  // cluster sheet needs the stock id the record points at.
  if (usesAimLayer && !strikeBodyArt && !clusterBitArt && !clusterBitHomingArt) {
    lines.push('      params = { gpu_prefix = "sprites/" },');
  }

  // Pack WAVs are declared by path in `sounds`; the engine loads them into
  // WormForge's own sample bank (WA's record sound fields take native ids).
  const packSounds: string[] = [];
  if (launchSoundPath) packSounds.push(luaQuote(launchSoundPath));
  // A melee strike's uploaded WAVs are played by the swing, so they are declared
  // like any other pack sound (the SDK resolves the path through this list).
  // Only when the claim is really emitted: the melee block lives inside the
  // hold spec, so a weapon with no hold art has nothing to play these.
  if (usesHoldLocal && project.melee?.enabled) {
    for (const role of ['hit', 'miss'] as const) {
      const path = meleeSoundPath(project, role);
      if (path) packSounds.push(luaQuote(path));
    }
    // A strike with a sample of its own declares that one too: a declared path
    // must have its file, and a file whose path is not declared is a nil sample.
    const sortedStrikes = meleeStrikes(project.melee);
    if (sortedStrikes.length > 1) {
      for (const [index, strike] of sortedStrikes.entries()) {
        if (!strike.sound?.file) continue;
        const path = meleeSoundPath(project, 'hit', index);
        if (path) packSounds.push(luaQuote(path));
      }
    }
  }
  if (usesExplosionSound) packSounds.push(luaQuote(explosionSoundPath!));
  if (usesIntervalSound) packSounds.push(luaQuote(intervalSoundPath!));
  if (shotSoundPath) packSounds.push(luaQuote(shotSoundPath));
  // WAVs the carried code plays by path: the claim's `sounds` list is the
  // registry `wa.sound.play(…, path, …)` resolves through, so a carried
  // `sounds/<mod>/zap.wav` has to be named here or the play is a nil sample.
  for (const wav of project.carriedLua?.art?.sounds ?? []) {
    if (!packSounds.includes(luaQuote(wav))) packSounds.push(luaQuote(wav));
  }
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
  // A `Kind::Sprite` record field takes a stock name or an id. The engine
  // rejects any other string outright ("is not a stock sprite") and the whole
  // install fails, so a path that reached an override (an import, a hand-edited
  // draft, a field nobody validated) must never be written. The two trail fields
  // are the exception: the engine lifts them out as claim sheets before it
  // builds the patch (`trail_image_spec`), so a path there is the intended form.
  const pathSpriteKeys = new Set(['missile.trail.sprite', 'clusters.bit.trail.sprite']);
  const isSpriteField = (key: string) => /(?:^|\.)(?:sprite|sprite_\d+)$/.test(key);
  const looksLikePackPath = (value: unknown) =>
    typeof value === 'string' && /\.(?:png|gif|bmp)$/i.test(value);
  const droppedSpritePaths: string[] = [];
  const override = (key: string): any => {
    const value = project.recordOverrides[key];
    if (value === undefined) return undefined;
    if (baseline && same(value, baseOverrides[key])) return undefined;
    if (isSpriteField(key) && !pathSpriteKeys.has(key) && looksLikePackPath(value)) {
      if (!droppedSpritePaths.includes(key)) droppedSpritePaths.push(key);
      return undefined;
    }
    return value;
  };
  const overrideTouched = (...keys: string[]) => keys.some((key) => override(key) !== undefined);
  const action = meleeGhost
    ? 'none'
    : project.action || (body.bounce_pct > 0 ? 'bounce' : body.homing !== 'off' ? 'homing' : 'none');
  const actionChanged = meleeGhost || !baseline || action !== baseline.action;
  // The action groups share one native slab (+0xA8..+0xD0): a bounce sound at
  // 0xB4 is the homing trail's sprite, a dig sound at 0xB0 is the homing
  // animation, and so on. Switching the action (or starting from a donor whose
  // own action is not ours) therefore has to write the *whole* destination
  // group, or the donor's leftovers come back as another feature's value -- a
  // stock grenade's bounce sound 113 turned into a homing trail drawing
  // `oildrum4`. `fullGroup` also covers a fresh `copy_from`, where the donor's
  // slab is simply unknown.
  const fullGroup = actionChanged;
  // A roaming animal's ground pose. WA animates the record `sprite` while the
  // animal walks and `sheep.flight_1/2` only once it flies, so the walk is NOT
  // flight art and must not be zeroed blindly. It can only draw when it names a
  // stock sprite: an imported Project X record holds PX's own numbers (34464 on
  // the Super Queen Bee, 713 on its sheep), which WA masks to a pack slot
  // nothing was installed at and draws as nothing at all. `0` then means the
  // builder draws the walk from its own sheet (`sb.flight{ walk = … }` is only
  // written when WA can draw it, and identifies the primary with it).
  const roamWalkPose =
    action === 'roam'
      ? roamWalkPoseId(project.recordOverrides['missile.sprite'] ?? baseOverrides['missile.sprite'])
      : 0;
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
  const burst = meleeGhost ? 'nothing' : project.burst || (body.cluster ? 'clusters' : 'nothing');
  const burstChanged = meleeGhost || !baseline || burst !== baseline.burst;
  const clustletTouched = (Object.keys(body.clustlet) as (keyof ClustletConfig)[]).some(clustletChanged);
  // Whole-group tests compare key by key: `same` is a JSON text compare, so two
  // tables with the same values in a different key order looked "touched" and
  // the generator wrote a group nobody had edited. Only ever over-emission, but
  // "an untouched import emits nothing" should not depend on key order.
  const sameGroup = (a: unknown, b: unknown) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return same(a, b);
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  };
  const fireTouched = !baseline || !sameGroup(project.fireConfig, baseline.fireConfig);
  const roamTouched = !baseline || !sameGroup(project.roamConfig, baseline.roamConfig);
  const digTouched = !baseline || !sameGroup(project.digConfig, baseline.digConfig);
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
  // A melee's retreat window **is** its ghost's lifetime: WA gives the turn back
  // when the last shot dies or the retreat runs out, whichever comes first, so
  // two different numbers would end the turn at the earlier of them. The donor
  // carries its own retreat in `recordOverrides`, which the diff then drops as
  // inherited, so the test is on the *emitted* value and not on the key.
  const ghostWindowMs = meleeGhost
    ? Math.max(500, Math.round(Number(override('handling.retreat') ?? 5000)))
    : 0;
  if (meleeGhost && override('handling.retreat') === undefined) {
    // 5 s covers the swing and a walk-back without leaving a turn hanging on an
    // invisible projectile. An author's own `handling.retreat` wins, and the
    // fuse below moves with it.
    handlingRows.push('        retreat = 5000,');
  }
  if (handlingRows.length > 0) {
    lines.push('      handling = {');
    lines.push(...handlingRows);
    lines.push('      },');
  }

  // `fires.subtype` (+0x34) is emitted together with `launch_power_pct` /
  // `creates_projectile` in the single `fires` table below so Lua never
  // sees two `fires =` keys in the claim table.
  const rawFiresSubtype = override('fires.subtype') ?? project.specialSubtype;
  const firesSubtype =
    rawFiresSubtype !== undefined && Number.isFinite(Number(rawFiresSubtype))
      ? Number(rawFiresSubtype)
      : undefined;
  const firesSubtypeChanged =
    firesSubtype !== undefined && (!baseline || firesSubtype !== baseline.specialSubtype);

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
    if (!carriedHooks.has('on_select')) {
      lines.push('      on_select = { cursor = true },');
    }
  } else if (
    project.fireType === 'power' ||
    // A melee claim borrows a power record for its aim phase (the Sheep
    // Launcher's), so it carries `missile` edits like any projectile: the ghost
    // shot is one (see `meleeGhost`).
    meleeGhost ||
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
      silencesBlast ||
      meleeGhost
    ) {
      lines.push('        explosion = {');
      if (silencesBlast || meleeGhost) {
        // The custom explosion in `on_explode` does the damage, push and
        // crater; a power here would blast a second time. A melee ghost has no
        // blast at all: its damage is the strike's `hit` callback.
        lines.push('          power = 0,');
        lines.push('          push_pct = 0,');
      } else if (powerChanged) lines.push(`          power = ${body.damage},`);
      if (!silencesBlast && !meleeGhost && pushPct !== undefined) {
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
    if (meleeGhost) {
      // The ghost has to outlive the retreat. WA hands the turn over the moment
      // the shot it fired is gone, so a missile that dies on contact with the
      // ground at the worm's feet ends the turn a frame after the swing and the
      // retreat window is never seen. A nonzero `fuse` is also WA's "timed, not
      // impact detonated" switch, so the ghost lives exactly the window and
      // then pops harmlessly (`power = 0`, no sound), which is the moment the
      // turn ends anyway.
      lines.push(`        fuse = ${ghostWindowMs},`);
    } else if (fuseChanged) {
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
    // A ghost makes no noise of its own: the strike's own hit and miss samples
    // are the weapon's voice, and WA's launch, flight and blast sounds belong to
    // the record it borrowed the aim phase from.
    const explosionSoundEnabled = meleeGhost ? false : override('missile.explosion_sound.enabled');
    const explosionSound = meleeGhost ? undefined : override('missile.explosion_sound.sound');
    const explosionSoundBefore = meleeGhost ? undefined : override('missile.explosion_sound.before');
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
    if (meleeGhost) {
      // Nothing to draw: the shot is a carrier for WA's firing flow, not a thing.
      lines.push('        sprite = 0,');
    } else if (builderOn && !(action === 'roam' && roamWalkPose !== 0)) {
      // The builder classifies a missile as the primary only when `m.sprite` is
      // zero at first sight (a cluster bit carries its record's own bit sprite).
      // This write is unconditional: an imported `.wep` baseline or a
      // `missile.sprite` override must not leave WA's sprite in place, or the
      // primary would classify as a cluster bit and draw small.
      //
      // Roaming is the exception, and only while its walk pose can draw: the
      // record `sprite` is what WA animates on the ground, so it is kept and
      // its id is handed to the builder (`walk = <id>`) to identify the primary
      // with. With no usable pose the sprite is zeroed and the builder draws the
      // walk from its own sheet too.
      lines.push('        sprite = 0,');
      zeroedSprite = true;
    } else if (spriteOverride !== undefined) {
      if (spriteOverride === 0 || spriteOverride === '0') {
        lines.push('        sprite = 0,');
        zeroedSprite = true;
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
      zeroedSprite = true;
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
    const alarmWorms = meleeGhost ? false : override('missile.alarm_worms');
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
    if (meleeGhost) {
      // No trail either: `sprite = 0` is the engine's "no trail" value.
      lines.push('        trail = { sprite = 0 },');
    } else if (missileTrailArt) {
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

    const impactParticles = meleeGhost ? false : override('missile.impact_particles');
    if (impactParticles !== undefined) {
      lines.push(`        impact_particles = ${impactParticles ? 'true' : 'false'},`);
    }

    const flightSound = meleeGhost ? 0 : override('missile.flight_sound');
    if (flightSound !== undefined) {
      lines.push(`        flight_sound = ${flightSound},`);
    }
    const launchSound = meleeGhost ? 0 : override('missile.launch_sound');
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
    // When switching action groups (`fullGroup`), read the project's values
    // directly instead of subtracting stale dummy bytes from the old action's
    // baseline slab, while still guarding pack sprite paths.
    const groupVal = (key: string): any => {
      if (!fullGroup) return override(key);
      const value = project.recordOverrides[key];
      if (value === undefined) return undefined;
      if (isSpriteField(key) && !pathSpriteKeys.has(key) && looksLikePackPath(value)) {
        if (!droppedSpritePaths.includes(key)) droppedSpritePaths.push(key);
        return undefined;
      }
      return value;
    };
    if (action === 'bounce' && bounceTouched) {
      lines.push('        bounce = {');
      if (fullGroup || bodyChanged('bounce_pct')) {
        lines.push(`          bounciness = ${body.bounce_pct ?? 0},`);
      }
      // Every other field of the group is written in full on an action change:
      // each one shares its slot with the previous action's field (see
      // `fullGroup`).
      const groupInt = (key: string, name: string, fallback = 0) => {
        const v = groupVal(key);
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

      const bounceExplosionBias = groupVal('missile.bounce.explosion.bias');
      const bounceExplosionPush = groupVal('missile.bounce.explosion.push_pct');
      const bounceExplosionPower = groupVal('missile.bounce.explosion.power');
      const bounceExplosionVariation = groupVal('missile.bounce.explosion.variation');
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
          lines.push(`            push_pct = ${bounceExplosionPush ?? 100},`);
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
      const bounceHits = luaMaskTable(groupVal('missile.bounce.hits'));
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
            ? (groupVal('missile.homing.sprite') ?? 0)
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
      const homingAnimation = groupVal('missile.homing.animation');
      if (fullGroup || homingAnimation !== undefined) {
        lines.push(`          animation = ${homingAnimation ?? 0},`);
      }

      const homingTrailSprite = groupVal('missile.homing.trail.sprite');
      const homingTrailPower = groupVal('missile.homing.trail.power');
      const homingTrailSpeed = groupVal('missile.homing.trail.speed');
      const homingTrailBubbles = groupVal('missile.homing.trail.bubbles_per_second');
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
        const hts = fullGroup ? (homingTrailSprite ?? 0) : homingTrailSprite;
        if (hts !== undefined) {
          if (hts === 0 || hts === '0' || hts === '') {
            lines.push('            sprite = 0,');
          } else if (!isNaN(Number(hts))) {
            lines.push(`            sprite = ${Number(hts)},`);
          } else {
            lines.push(`            sprite = ${luaQuote(String(hts))},`);
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
      (fullGroup || roamTouched || !!roamFlightState || !!gasState)
    ) {
      const r = project.roamConfig;
      const roamStart = lines.length;
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
      // `flight_1`/`flight_2` live in `sheep`, so a record whose only roam
      // difference is those made `roamTouched` true while no `roam` row
      // followed. An empty group writes nothing and made a re-export differ
      // from the export it came from (the sheep test), so it is dropped.
      if (lines.length === roamStart + 2) lines.splice(roamStart, 2);
    } else if (
      action === 'dig' &&
      project.digConfig &&
      // `fullGroup` (an action switch): the donor's slab held another action's
      // values, so the group has to be written even where our own value is the
      // default -- otherwise `action = "dig"` reaches the engine with no `dig`
      // table at all.
      (zeroMainDig || fullGroup || digTouched || (digState?.scope === 'main' && !!digState))
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
      //
      // In WA, `flight_1 = 0` disables Super Sheep takeoff on Space press (WA
      // uses non-zero as a capability check). We use unassigned sentinel 699: it
      // passes that check and draws nothing, so the builder's own sheet is the
      // only art once the animal is airborne.
      const flightOne = builderOwnsRoamFlight
        ? ROAM_FLY_SENTINEL
        : roamFlightState?.assigned.roam_flight_1 !== undefined
          ? roamFlightState.assigned.roam_flight_1
          : roamFlightOne;
      const flightTwo = builderOwnsRoamFlight
        ? ROAM_FLY_SENTINEL
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

        const bitNeedsMarker = builderOn && burst === 'clusters';
        if (bitNeedsMarker) {
          // The builder's classifier reads `m.sprite` at first sight; a zero
          // bit sprite would classify as the primary. Keep a real stock id and
          // one sheet id (`sprite_count` counts ids, not frames). The id must
          // also differ from a roaming animal's walk pose: that pose is the one
          // nonzero sprite that means "primary".
          const raw = String(c.sprite ?? '');
          const numeric = Number(raw);
          const unusable =
            !raw ||
            raw === '0' ||
            raw.includes('/') ||
            (Number.isFinite(numeric) && numeric === 0) ||
            (roamWalkPose !== 0 && roamWalkPoseId(c.sprite) === roamWalkPose);
          if (unusable) {
            // `cluster` (53) is the fallback marker when the walk pose is
            // `clustlet` (54) itself: equal ids would make every bit the primary.
            lines.push(`          sprite = "${roamWalkPose === 54 ? 'cluster' : 'clustlet'}",`);
          } else if (clustletChanged('sprite') || bitRoleActive) {
            if (!isNaN(numeric) && numeric > 0) lines.push(`          sprite = ${numeric},`);
            else lines.push(`          sprite = ${luaQuote(raw)},`);
          }
          if (bitRoleActive) {
            lines.push('          sprite_count = 1,');
          }
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
          'bounce_power',
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
          const bitRoamStart = lines.length;
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
          // Same rule as the round's group: the animal's flying sheets are not
          // rows here, so a difference only in those must not leave `{}`.
          if (lines.length === bitRoamStart + 2) lines.splice(bitRoamStart, 2);
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
  const isMissileFamily =
    project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse);
  const firesRows: string[] = [];
  if (firesSubtypeChanged) {
    firesRows.push(`        subtype = ${firesSubtype},`);
  }
  const firesFields = isMissileFamily
    ? ['launch_power_pct', 'creates_projectile']
    : ['creates_projectile'];
  firesRows.push(...nativeGroupRows('fires', firesFields));
  if (firesRows.length === 1 && firesSubtypeChanged) {
    lines.push(`      fires = { subtype = ${firesSubtype} },`);
  } else if (firesRows.length > 0) {
    lines.push('      fires = {');
    lines.push(...firesRows);
    lines.push('      },');
  }
  const gateSubtype = firesSubtype ?? project.specialSubtype;
  const NATIVE_GROUPS: { group: string; fields: string[]; allow: boolean }[] = [
    { group: 'arrow', fields: ['damage'], allow: project.fireType === 'arrow' },
    {
      group: 'baseball_bat',
      fields: ['damage', 'knockback_scale'],
      allow: project.fireType === 'special' && gateSubtype === 2,
    },
    {
      group: 'fire_punch',
      fields: ['damage', 'knockback'],
      allow: project.fireType === 'special' && gateSubtype === 1,
    },
    {
      group: 'drill',
      fields: ['duration_ms'],
      allow: project.fireType === 'special' && gateSubtype === 8,
    },
    {
      group: 'jet_pack',
      fields: ['fuel'],
      allow: project.fireType === 'special' && gateSubtype === 23,
    },
    {
      group: 'parachute',
      fields: ['wind_pct'],
      allow: project.fireType === 'special' && gateSubtype === 12,
    },
    {
      group: 'utility',
      fields: ['effect'],
      allow: project.fireType === 'special' && gateSubtype === 19,
    },
  ];
  for (const { group, fields, allow } of NATIVE_GROUPS) {
    if (!allow) continue;
    const rows = nativeGroupRows(group, fields);
    if (rows.length === 0) continue;
    lines.push(`      ${group} = {`);
    lines.push(...rows);
    lines.push('      },');
  }

  // Hold Art
  if (usesHold) {
    lines.push('      worm_sprites = holds.PX_POSTURE,');
    if (usesHoldLocal) {
      // The table itself is declared before the claim (`sb.hold` builds it
      // there, and the claim reads the same values the layer draws with).
      lines.push('      hold = hold,');
    } else {
      lines.push('      hold = {');
      for (const row of holdRows) lines.push(`        ${row}`);
      lines.push('      },');
    }
  } else if (zeroedSprite && !wepPath && donorKnown && POSE_BY_SPRITE_DONORS.has(donorName)) {
    // The record's sprite is 0, so WA gives the worm nothing to hold: it takes
    // the donor's pose instead. Hold art has its own posture and skips this.
    lines.push(`      hold_as = ${luaQuote(donor)},`);
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
  // `on_fire`: one handler per trigger, built from three slots in this order:
  // the launch WAV (ours, one report per trigger), the `fire_seq` burst (ours),
  // and the body a bundle carried in (M6, the Conductor's whole weapon). The key
  // is single-valued, so the three have to share one function or one of them
  // replaces the others.
  const onFire: string[] = [];
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
    onFire.push('      -- Sequential fire (`wf-lib/fire_seq`): one trigger, a burst.');
    if (!live) {
      // Lock the aim to the moment the trigger was pulled.
      onFire.push('        local dx, dy = seq_dir(ev.worm)');
    }
    const call = f.mode === 'actors' ? 'fire_sequential_actor' : 'fire_seq_mis';
    onFire.push(`        seq.${call}{`);
    if (f.mode !== 'actors') {
      onFire.push('          weapon = ctx.id,');
    }
    onFire.push('          owner = ev.worm,');
    if (f.cancelOnWeaponChange || f.mode === 'actors') {
      // Actors have no default: without it the burst ends on the first tick.
      onFire.push('          cancel_weapon = ctx.id,');
    }
    onFire.push(`          count = ${count}, delay = ${delay},`);
    if (f.mode === 'actors') {
      if (f.actorSprite.trim()) {
        onFire.push(`          sprite = ${luaQuote(f.actorSprite.trim())},`);
      }
      onFire.push(
        `          gravity = ${f.actorGravity ? 'true' : 'false'}, collide = ${
          f.actorCollide ? 'true' : 'false'
        }, persist = ${f.actorPersist ? 'true' : 'false'},`,
      );
    }
    if (f.spreadX > 0 || f.spreadY > 0) {
      onFire.push(`          spread = { x = ${spreadX}, y = ${spreadY} },`);
    }
    if (f.standoff > 0) {
      onFire.push(`          standoff = ${standoff},`);
    }
    if (carriesFuse) {
      // `launch` merges this over the slot's record, so the burst's rounds get
      // the player's fuse instead of the record's (which is 0 for a grenade).
      onFire.push('          missile = { fuse = fuse_of(ev.worm) },');
    }
    if (live) {
      onFire.push(`          x = function(i, w) return w.x${offX} end,`);
      onFire.push(`          y = function(i, w) return w.y${offY} end,`);
      onFire.push(`          vx = function(i, w) local dx = seq_dir(w) return dx * ${speed} end,`);
      onFire.push(`          vy = function(i, w) local _, dy = seq_dir(w) return dy * ${speed} end,`);
    } else {
      onFire.push(`          x = ev.worm.x${offX}, y = ev.worm.y${offY},`);
      onFire.push(`          vx = dx * ${speed}, vy = dy * ${speed},`);
    }
    if (shotSound) {
      const every = shotSound.every;
      const guard = every > 1 ? `if i % ${every} == 0 then ` : '';
      const close = every > 1 ? ' end' : '';
      onFire.push(
        `          on_shot = function(i, w) ${guard}wa.sound.play(w, ${luaQuote(
          shotSound.path,
        )}, ${shotSound.priority})${close} end,`,
      );
    }
    onFire.push('        }');
  }
  if (hasCarriedOnFire && carriedOnFire) {
    // The parameter alias goes **inside** the region: `hookBodyOf` cuts from the
    // signature to the last `end`, so a line written before the marker comes back
    // as part of the body next time and the marker would drift below it.
    onFire.push(`        ${NOT_GENERATED_OPEN}`);
    if (carriedOnFire.param !== 'ev') {
      onFire.push(`        local ${carriedOnFire.param} = ev`);
    }
    onFire.push(...reindentCode(carriedOnFire.body, '        '));
    onFire.push(`        ${NOT_GENERATED_CLOSE}`);
  }
  // The emitter is never written here on purpose: a claim `on_fire` replaces
  // WA's shot (the engine's CreateWeaponProjectile hook returns before WA builds
  // the missile), so an emitter that only handed itself to a round from this
  // handler fired nothing at all. The round latch is the `missile_frame`
  // registration above, which runs on the round WA did build.
  if (onFire.length > 0) {
    lines.push('      on_fire = function(ev)');
    if (launchInOnFire) {
      lines.push(`        ${launchSoundPlay} -- the launch WAV, once per trigger`);
    }
    lines.push(...onFire);
    lines.push('      end,');
  }

  // Claim hooks the editor does not model: the value is written as the key it
  // was (`on_click`, `on_done`, `on_place`, `on_transport`, `on_select`), because
  // nothing here merges into them.
  for (const hook of verbatimHooks) {
    // `reindentCode`, not a blind prefix: a re-import reads the body back with the
    // indentation the last export gave it, so a blind prefix would add six more
    // spaces every round trip.
    const [head, ...body] = hook.text.split('\n');
    if (hook.key === 'on_select' && project.fireType === 'cursor' && project.teleport) {
      lines.push(`      on_select = { cursor = true, on = ${head.trim()}`);
      if (body.length > 0) lines.push(...reindentCode(body.join('\n'), '      '));
      lines.push('      },');
      continue;
    }
    lines.push(`      ${hook.key} = ${head.trim()}`);
    if (body.length > 0) lines.push(...reindentCode(body.join('\n'), '      '));
    lines.push('      ,');
  }

  // Unified explosion hook: merges effects-SDK burst, custom WAV, and custom Lua logic.
  // The claim's `on_explode` runs before WA's own blast, which is the frame PX draws on:
  // `effect` mode leaves the native blast alone, `blast` mode has already
  // silenced it in the record above, so the custom explosion does the damage,
  // push, crater and sound and then draws the same burst.
  const hasExplodeHook =
    usesExplosionEffect ||
    usesExplosionSound ||
    hasCustomExplodeCode ||
    usesImpactDamage ||
    usesTerrainStamp;
  if (hasExplodeHook) {
    const parts = [
      usesExplosionEffect ? 'effects-SDK burst' : '',
      usesExplosionSound ? 'custom WAV' : '',
      hasCarriedExplodeCode ? "the bundle's on_explode" : '',
      hasSnippetExplodeCode ? 'custom Lua logic' : '',
      usesImpactDamage ? 'impact damage' : '',
      usesTerrainStamp ? 'terrain stamp' : '',
    ].filter(Boolean).join(' + ');
    lines.push(`      -- Explosion hook: merged ${parts}.`);
    lines.push('      on_explode = { on = function(ev)');
    // A project saved before this field existed means "every explosion", which
    // is what the hook did then.
    const fxTarget = explosionEffect?.target ?? 'all';
    if (usesExplosionEffect && fxTarget !== 'all') {
      // Which explosion is this? A cluster bit is a missile of the same weapon,
      // so "the round" and "its frags" are told apart by the flight builder's
      // identity (`sb.role`), which it decided on the missile's first frame and
      // keeps past the despawn. One claim hook covers the burst, the custom WAV
      // and any custom `on_explode` in the snippet, so the choice is made once
      // here, before all of them.
      if (builderOn) {
        lines.push('        local explode_role = sb.role and ev.missile and sb.role(ev.missile) or nil');
        lines.push(
          fxTarget === 'main'
            ? '        if explode_role == "bit" then return end'
            : '        if explode_role ~= "bit" then return end',
        );
      } else {
        lines.push(
          `        -- the burst is set to the ${fxTarget === 'main' ? 'round only' : 'cluster bits only'},`,
          '        -- which needs the flight builder to tell them apart: with it off this runs for every round.',
        );
      }
    }
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
        // PX's SetRainbowMode on the manager (`CalculateRainbow`): one clock
        // colour for every pass of the burst.
        if (e.rainbow) rows.push(`${indent}rainbow = true,`);
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

      if (usesElectricBlast) {
        // PX's electric damage (`set_message_electric`, custom_taze.c): arm the
        // hurt, and the module tazes each worm the blast takes health from.
        // `retain` hands the hold the knockback WA gives the worm, so the push
        // is re-applied on release instead of being lost to the hold. A custom
        // blast delivers a hit of the scripted `taze` kind, so it takes the hit
        // arm; WA's own blast is a blast-kind hurt, and its arm is scoped to
        // this shooter and only lasts a couple of frames.
        lines.push(
          e.mode === 'blast'
            ? '        zap.set_message_electric(20, 0, -4, true)'
            : '        zap.set_message_electric_missile(20, ev.worm, 2)',
        );
      }
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
        // The hit kind the blast sends. `taze` is the scripted electric kind
        // (`crates/game/src/hit_kind.rs`): WA takes it as a Prod hit, but a
        // `wa.on.hit` handler sees "taze", which is how PX's electric weapons
        // recognise their own damage. Only the custom blast can name a kind.
        // The hold itself is the `zap` table above: the taze kind alone changes
        // nothing about the worm.
        if (e.damageType === 'electric') {
          blastRows.push('          kind = "taze",');
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
    // The bundle's own body goes first and the author's snippet after it: both
    // run inside the one handler, and both can still `return` early to skip the
    // stamp below. Each keeps its own parameter name.
    if (hasCarriedExplodeCode && carriedExplode) {
      if (carriedExplode.param !== 'ev') {
        lines.push(`        local ${carriedExplode.param} = ev`);
      }
      lines.push(`        ${NOT_GENERATED_OPEN}`);
      for (const line of reindentCode(carriedExplode.body, '        ')) lines.push(line);
      lines.push(`        ${NOT_GENERATED_CLOSE}`);
    }
    if (hasSnippetExplodeCode) {
      if (parsedLua.paramName !== 'ev') {
        lines.push(`        local ${parsedLua.paramName} = ev`);
      }
      // The markers are not decoration: `checkLua` reads them to say that a
      // finding below is in a block the editor did not generate, which is the
      // difference between "a name nothing declares fails at load" and a snippet
      // that may define it elsewhere. `customExplodeBody` drops them again on a
      // re-import, so they never nest.
      lines.push(`        ${NOT_GENERATED_OPEN}`);
      for (const line of reindentCode(parsedLua.onExplodeBody, '        ')) {
        lines.push(line);
      }
      lines.push(`        ${NOT_GENERATED_CLOSE}`);
    }
    if (usesImpactDamage) {
      // A hit is the whole point of a pierce, so the stamp is skipped when the
      // round found something: this is PX's javelin `return`, and it also keeps
      // a worm that survived the hit from being buried. The explanation rides on
      // the same line on purpose: `customExplodeBody` drops the statement, and a
      // comment of its own would be left behind in the author's custom Lua.
      lines.push(
        '        if stamp_hit(ev) then return end -- a hit means no stamp: the round pierced it',
      );
    }
    if (usesTerrainStamp) {
      // Last on purpose: a custom `on_explode` that returns early (PX's ninja
      // star does, so it never sticks into a worm) must skip the stamp too.
      //
      // `ev.vx`/`ev.vy` are the round's speed as it bursts (`weapon_emit`'s
      // speed, `ENT_SPEED_X/Y`) and are absent for a mine, which has no flight
      // velocity, hence `or 0`, which keeps a real zero because 0 is truthy
      // in Lua. A mine therefore wants the fixed angle.
      const frame = terrainStamp!.onImpact
        ? usesMissileSprite
          ? // `sb.heading` only exists in wfws.sdk 0.7.0+. A weapon can be loaded
            // against an older installed copy of the library (the bundle ships its
            // own, but a shared `Mods/wf-lib/wfws_sdk` may win), and calling a
            // missing field would abort the whole callback, losing the stamp and
            // the burst with it. Guarded, it falls back to the velocity heading.
            'stamp_orientation(ev.vx or 0, ev.vy or 0, sb.heading and sb.heading(ev.missile))'
          : 'stamp_orientation(ev.vx or 0, ev.vy or 0)'
        : String(stampFrameForAngle(terrainStamp!.fixedAngle));
      const stampRows = (indent: string) => {
        lines.push(`${indent}wa.land.stamp{`);
        lines.push(`${indent}  sprite = ${luaQuote(stampSheetPath)},`);
        lines.push(`${indent}  frame = ${frame},`);
        lines.push(`${indent}  x = ev.x, y = ev.y,`);
        lines.push(
          `${indent}  buried = { soften = ${Math.min(
            32,
            Math.max(1, Math.round(terrainStamp!.soften)),
          )}, blend = ${luaQuote(terrainStamp!.blend === 'dither' ? 'dither' : 'mix')} },`,
        );
        if (terrainStamp!.trueColour) lines.push(`${indent}  true_colour = true,`);
        lines.push(`${indent}}`);
      };
      if (stampClearance > 0) {
        // Sealing a worm under the picture is worse than losing the stamp.
        lines.push('        if stamp_clear(ev.x, ev.y) then');
        stampRows('          ');
        lines.push('        end');
      } else {
        stampRows('        ');
      }
    }
    lines.push('      end },');
  }

  // Say out loud what the sprite-field guard dropped: a silently missing value
  // reads as "the editor forgot my edit", which is worse than a warning.
  if (droppedSpritePaths.length > 0) {
    lines.push(
      `    -- Dropped: ${droppedSpritePaths.join(', ')} held a bundle path. A record`,
      '    -- sprite field takes a stock name or an id; pack art goes in the claim',
      '    -- (`sprite`, `cluster.sprite`) or a trail field, which the engine lifts.',
    );
  }

  if (extraAssignments.length > 0) {
    lines.push('    }');
    lines.push('    -- Values the source bundle declared, over the base record.');
    lines.push(...extraAssignments);
    lines.push('    wa.weapons.replace(rec)');
  } else {
    lines.push('    }');
  }


  if (usesStandaloneLaunchSound) {
    lines.push('    -- Launch sound: played on WA release message so we do not claim `on_fire`');
    lines.push('    -- (claiming `on_fire` replaces WA\'s own shot).');
    lines.push('    local LAUNCH_SOUND = {');
    lines.push(`      path = ${luaQuote(launchSoundPath!)},`);
    lines.push(`      priority = ${launchSoundPriority},`);
    lines.push('    }');
    lines.push('    wa.on.worm_message(function(worm)');
    lines.push('      if worm.turn and worm.weapon == ctx.id then');
    lines.push('        wa.sound.play(worm, LAUNCH_SOUND.path, LAUNCH_SOUND.priority)');
    lines.push('      end');
    lines.push('    end, { msgs = { wa.msg.WEAPON_RELEASED } })');
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
    if (m.pingpong && m.frames > 1) {
      lines.push('      pingpong = true,');
    }
    if (m.animSpeed !== undefined && m.animSpeed !== 1.0) {
      lines.push(`      anim_speed = ${formatNumber(m.animSpeed)},`);
    }
    if (m.spinRate !== undefined && m.spinRate !== 1.0) {
      lines.push(`      spin = ${formatNumber(m.spinRate)},`);
    }
    if (m.scale !== undefined && m.scale !== 1.0) {
      lines.push(`      scale = ${formatNumber(m.scale)},`);
    }
    if (m.mirror === false) {
      lines.push('      mirror = false,');
    }
    if (m.z !== undefined && m.z !== 5.0) {
      lines.push(`      z = ${formatNumber(m.z)},`);
    }
    // Weapon-wide builder parameters: one size multiplier for every role's
    // sheet, a rotation offset for art that does not point up, and an x/y nudge
    // for art whose pivot is not its centre.
    if (m.size !== undefined && m.size !== 1) {
      lines.push(`      size = ${formatNumber(m.size)},`);
    }
    if (m.angle) {
      lines.push(`      angle = ${formatNumber(m.angle)},`);
    }
    if (m.offsetX || m.offsetY) {
      lines.push(
        `      offset = { x = ${formatNumber(m.offsetX ?? 0)}, y = ${formatNumber(m.offsetY ?? 0)} },`,
      );
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
      if (bitHomingBuilder) {
        lines.push('      bits = {');
        lines.push(`        sheet = ${luaQuote(missileFlightSheetPath(project))},`);
        for (const row of roleArtRows(m, '        ')) lines.push(row);
        lines.push('        homing = {');
        lines.push(
          `          sheet = ${luaQuote(behaviorStateSheetPath(project, 'homing_bit'))},`,
        );
        lines.push(homingWindowRow(project.body.clustlet, '          '));
        for (const row of roleArtRows(project.behaviorArt!.homing_bit!, '          ')) {
          lines.push(row);
        }
        lines.push('        },');
        lines.push('      },');
      } else {
        lines.push('      bits = "inherit",');
      }
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

    // `anim = "roam"`: the tilt preset. A roaming animal walks with no velocity
    // of its own, so `track` freezes its heading on the ground; the builder
    // points it along the velocity and clamps that to `up`/`down` degrees from
    // `rest`, where it sits when the animal stops. Not emitted at the defaults.
    if (m.roamTilt) {
      const tilt = m.roamTilt;
      const defaultTilt = DEFAULT_ROAM_TILT;
      if (
        tilt.up !== defaultTilt.up ||
        tilt.down !== defaultTilt.down ||
        tilt.rest !== defaultTilt.rest
      ) {
        lines.push(
          `      tilt = { up = ${formatNumber(tilt.up)}, down = ${formatNumber(tilt.down)}, rest = ${formatNumber(tilt.rest)} },`,
        );
      }
    }

    // A roaming animal walks until the turn's player presses Space, then
    // flies. The builder owns that state (the record's `sheep.flight_1/2` are
    // zeroed above), and `roam` tells it what WA itself is drawing.
    //
    // `walk` is the record sprite WA animates on the ground: with it the builder
    // leaves the animal to WA until the takeoff, and it doubles as the identity
    // signal for the primary (that sprite is not zeroed then, so `m.sprite == 0`
    // alone cannot identify it). `fly` is the sentinel `sheep.flight_1` carries,
    // which WA moves into the render slot as it takes off, an exact takeoff
    // signal that does not depend on catching the key press.
    if (project.action === 'roam') {
      const roamArt = project.behaviorArt?.roam;
      if (roamRole && roamArt) {
        // Its own role: the animal is still WA's until Space (`walk` is the
        // pose WA draws; `fly` is the id WA moves into the render slot at the
        // takeoff). Both are optional, a record whose walk pose cannot draw
        // gets `fly` only and the builder animates the ground itself.
        lines.push('      roam = {');
        lines.push(`        sheet = ${luaQuote(behaviorStateSheetPath(project, 'roam'))},`);
        for (const row of roleArtRows(roamArt, '        ')) lines.push(row);
        if (roamWalkPose !== 0) {
          lines.push(`        walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL},`);
        } else {
          lines.push(`        fly = ${ROAM_FLY_SENTINEL},`);
        }
        lines.push('      },');
      } else if (roamWalkPose !== 0) {
        lines.push(`      roam = { walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL} },`);
      } else {
        lines.push('      roam = true,');
      }
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

  // Effects-SDK ribbon trail (`wf-lib/effects/trail`): PX's effect manager
  // samples the round's position on game frames and draws a tapering ribbon,
  // so its colour, widths and length are ours to choose. Attached on the
  // round's first missile frame, exactly as the PX ports do (famas, megashark,
  // px_ninja_star): WA fires this record itself, so there is no
  // `wa.weapons.launch` id to hand `trail.add`.
  //
  // Written after `sb.flight` on purpose: both register `wa.on.missile_frame`,
  // and the engine runs a mod's handlers in registration order, so the builder
  // has to decide a missile's identity before this hook asks `sb.role` for it.
  // The cluster bits are the case that proved it: a bit used to ask on its
  // first frame, get nil, and fall back to a guess that said "not a bit".
  //
  // The builder can only answer "bit" when it owns the bit art. A cluster
  // weapon whose builder leaves the bits to WA calls every frag `main`, so the
  // PX heuristic is the better answer there; every other case (a fire sequence,
  // a second round) is exactly what `sb.role` exists for.
  const builderIdentity =
    builderOn && (project.burst !== 'clusters' || bitBuilderMode(project) !== null);
  if (usesRibbonTrail) {
    const t = ribbonTrail!;
    const { r, g, b } = hexToRgb(t.color);
    const max = Math.max(2, Math.round(t.max));
    const every = Math.max(1, Math.round(t.every));
    const vanish = Math.max(1, Math.round(t.vanish));
    // `fx.install{ trail = true }` above installs the shared sampler and draw hook.
    lines.push('    local TRAIL = {');
    lines.push(`      max = ${max}, every = ${every}, vanish = ${vanish},`);
    lines.push(`      core_w = ${formatNumber(Math.max(0, t.coreWidth))},`);
    lines.push(`      glow_w = ${formatNumber(Math.max(0, t.glowWidth))},`);
    // PX's own lateral jitter (`noise`, a reach arc's crackle) and its hue
    // cycle. A zero jitter and no rainbow is the straight ribbon it always was,
    // so an old project emits the keys it needs and nothing else.
    if (t.noise > 0) lines.push(`      noise = ${formatNumber(Math.max(0, t.noise))},`);
    if (t.rainbow) lines.push('      rainbow = true,');
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
    if (t.target !== 'all') {
      // Which part of the missile is this? The flight builder decides it once,
      // on first sight (`sb.role`), and that is the exact answer when it is
      // installed. Without it the only available test is the PX one: cluster
      // bits are born where their parent died, while its ribbon is still
      // shedding points, so a first-seen round with a ribbon already live for
      // this weapon is a bit. The live ids are an array: `pairs` order is not
      // lockstep-safe (wfcheck's lockstep-pairs).
      if (t.target === 'bit' && !builderIdentity) {
        lines.push('    -- Bits only, and the builder owns no bit art (or is off): nothing on this');
        lines.push('    -- build can tell a frag from the round, so `trail_is_bit` has no live');
        lines.push('    -- ribbon to compare against and no missile is trailed.');
      }
      lines.push('    local trailed = {}');
      lines.push('    local function trail_live()');
      lines.push('      for i = 1, #trailed do');
      lines.push('        if trail.has(trailed[i]) then return true end');
      lines.push('      end');
      lines.push('      return false');
      lines.push('    end');
      lines.push('    local function trail_is_bit(m)');
      // `sb` is a local the builder's own `require` declares, so it only exists
      // when the builder is on for this weapon. Nothing to read off it
      // otherwise, and wfcheck is right that naming it would be an undefined
      // global: the PX heuristic is the whole answer then.
      if (builderIdentity) {
        lines.push('      local role = sb.role and sb.role(m.id)');
        lines.push('      if role ~= nil then return role ~= "main" end');
      }
      lines.push('      return trail_live()');
      lines.push('    end');
    }
    lines.push('    local seen = {}');
    lines.push('    wa.on.missile_frame(function(m)');
    lines.push('      if m.weapon ~= ctx.id or m.phase ~= "pre" then return end');
    lines.push('      if seen[m.id] then return end');
    if (builderIdentity) {
      // A burst listed on the round's last frame is left undecided for one
      // frame on purpose (the round may have survived as another shot), so the
      // answer is nil here for exactly that frame. Wait for it: deciding now
      // is what cost the cluster bits their ribbon. An older installed library
      // has no `sb.role` at all, and the PX heuristic below is its answer.
      lines.push('      if sb.role and sb.role(m.id) == nil then return end');
    }
    lines.push('      seen[m.id] = true');
    if (t.target === 'main') {
      lines.push('      if trail_is_bit(m) then return end');
    } else if (t.target === 'bit') {
      lines.push('      if not trail_is_bit(m) then return end');
    }
    if (t.target === 'all') {
      lines.push('      trail.add(m.id, trail_worm(), TRAIL)');
    } else {
      lines.push('      if trail.add(m.id, trail_worm(), TRAIL) then trailed[#trailed + 1] = m.id end');
    }
    lines.push('    end)');
    lines.push('');
  }

  // `wa.on.*` registrations a bundle carried (M6). Additive by construction
  // (`dispatch::hook_list` runs every handler), so they are written verbatim and
  // in the bundle's own order, after everything this editor installs: a carried
  // `draw` that reads a table the claim built, or a `worm_message` whose filter
  // is part of the call, has to find the install done. Their filters come with
  // them, because `bind_on` accepts options for `worm_message` and a dropped
  // filter would run the handler on every message.
  const carriedRegistrations = (project.carriedLua?.registrations ?? []).filter(
    (registration) => !registration.disabled,
  );
  if (carriedRegistrations.length > 0) {
    lines.push(`    ${NOT_GENERATED_OPEN}`);
    lines.push('    -- Carried from the source bundle: its own `wa.on` hooks.');
    for (const registration of carriedRegistrations) {
      for (const line of reindentCode(registration.text, '    ')) lines.push(line);
    }
    lines.push(`    ${NOT_GENERATED_CLOSE}`);
    lines.push('');
  }

  lines.push('  end,');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * One weapon's part of a bundle manifest: its dependency list, its `mod_icon`
 * (when it uploaded one) and the text of its `[[components]]` block plus the
 * `[sprites]` sections its art needs. The bundle header belongs to the pack, not
 * to the weapon, so `generatePackToml` owns it.
 */
export interface WeaponManifestPart {
  dependencies: string[];
  modIcon?: string;
  /** Starts with a blank line, so it reads the same wherever it is placed. */
  block: string;
}

/**
 * Resolve the list of `require(...)` targets allowed for `checkLua(..., { availableRequires })`
 * given a bundle's declared `dependencies` and any bundle-local `.lua` modules.
 *
 * Known SDK modules whose owning bundle is missing from `dependencies` are always
 * excluded so `undeclared-require` catches them even when unrelated third-party
 * dependencies are declared; modules from unrecognized external dependencies are
 * permitted through unless they match an un-declared known SDK prefix.
 *
 * The tables live in `src/data/sdkModules.ts`, which the carry reads too: one
 * list, because the two copies had already disagreed with the installed
 * libraries (`px.electric` exports `taze_mine`, not `hold`).
 */
export function availableRequiresForCheck(
  luaSource: string,
  dependencies: string[],
  localModules: string[] = [],
): string[] {
  const depSet = new Set(dependencies);
  const allowed = new Set<string>(localModules);
  for (const dep of depSet) {
    for (const mod of SDK_MODULE_EXPORTS[dep] ?? []) allowed.add(mod);
  }
  const hasExternalDep = [...depSet].some((dep) => !(dep in SDK_MODULE_EXPORTS));
  if (hasExternalDep) {
    const reqPattern = /(?:^|[^A-Za-z0-9_.])require(?:\s*\(\s*|\s+)["']([^"']+)["']/g;
    const maskedLua = maskLuaCode(luaSource);
    let m: RegExpExecArray | null;
    while ((m = reqPattern.exec(luaSource)) !== null) {
      const reqWordAt = m.index + m[0].indexOf('require');
      if (maskedLua.slice(reqWordAt, reqWordAt + 7) !== 'require') continue;
      const target = m[1];
      const owner = SDK_MODULE_PREFIXES.find((entry) => target.startsWith(entry.prefix));
      if (!owner || depSet.has(owner.id)) allowed.add(target);
    }
  }
  return [...allowed];
}

/**
 * The automatic library dependencies a weapon's enabled panels require, with
 * human-readable reasons for the Dependencies panel and the single list for
 * `mod.toml`.
 */
export function autoDependenciesForProject(
  project: WeaponProject,
): { id: string; reason: string }[] {
  const usesHold = !!(project.hold && project.hold.enabled);
  const usesWfws = usesWfwsBuilder(project) || holdNeedsAimLayer(project);
  const usesElectricMelee = !!project.melee?.enabled && project.melee.kind === 'taze';
  const stampSheet = supportsTerrainStamp(project) ? terrainStampPath(project) : null;
  const usesRibbonTrail =
    !!project.ribbonTrail?.enabled &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));
  const explodesNatively = project.fireType === 'power' || project.fireType === 'drop';
  const usesExplosionEffect = !!project.explosionEffect?.enabled && explodesNatively;
  const usesEmitter = !!project.emitter?.enabled && project.fireType !== 'melee';
  const usesElectricBlast =
    usesExplosionEffect && project.explosionEffect!.damageType === 'electric';
  const stampImpact = project.terrainStamp?.impact;
  const usesElectricImpact =
    !!stampImpact?.enabled &&
    !!project.terrainStamp?.enabled &&
    supportsTerrainStamp(project) &&
    stampImpact.kind === 'taze';
  const hasCarriedOnFire = (project.carriedLua?.hooks ?? []).some(
    (h) => !h.disabled && h.key === 'on_fire' && hookBodyOf(h.text).body.trim().length > 0,
  );
  const usesFireSequence =
    !!project.fireSequence?.enabled &&
    !(
      project.enableCustomLua &&
      /(?:^|\n)[ \t]*on_fire\s*=/.test(maskLuaCode(project.customLuaSnippet || ''))
    ) &&
    !hasCarriedOnFire &&
    supportsFireSequence(project);

  const out: { id: string; reason: string }[] = [];
  if (usesHold) out.push({ id: 'wf.sdk', reason: 'hold art builder' });
  if (usesWfws) {
    out.push({
      id: 'wfws.sdk',
      reason: usesWfwsBuilder(project) ? 'flight sprite builder' : 'aim layer',
    });
  }
  if (usesRibbonTrail) out.push({ id: 'effects.sdk', reason: 'ribbon trail' });
  if (usesExplosionEffect) out.push({ id: 'effects.sdk', reason: 'explosion burst' });
  if (usesEmitter) out.push({ id: 'effects.sdk', reason: 'emitter' });
  if (usesElectricBlast) out.push({ id: 'px.electric', reason: 'electric blast taze' });
  if (usesElectricImpact) out.push({ id: 'px.electric', reason: 'electrical pierce taze' });
  if (usesElectricMelee) out.push({ id: 'px.electric', reason: 'electrical melee strike' });
  if (usesFireSequence) out.push({ id: 'px.fire_seq', reason: 'sequential fire' });
  return out;
}

/**
 * The stock slot a weapon replaces on the panel.
 *
 * The slot drives two things that must agree: the component's `default_position`
 * and the profile's `stock.<slot>` line. An empty slot placed the component on
 * `F1` (the first position, the Bazooka) while the profile said `stock.`, so the
 * two halves of one export disagreed and a re-import moved the weapon to the
 * Bazooka. The record the weapon copies is the honest fallback, because a weapon
 * always replaces something; `grenade` only when nothing else is known.
 */
export function effectiveSlot(project: WeaponProject): string {
  return project.slot || project.based_on || 'grenade';
}

export function weaponManifestPart(project: WeaponProject): WeaponManifestPart {
  const modFolder = sanitizeModFolder(project.id);
  const pos = getStockPanelPosition(effectiveSlot(project));
  const icon = project.customIconFile ? `sprites/${modFolder}/icon.png` : (project.panel_icon || effectiveSlot(project));
  const usesHold = project.hold && project.hold.enabled;
  const bitMode = bitBuilderMode(project);
  const behaviorStates = resolveBehaviorStates(project);
  const stampSheet =
    supportsTerrainStamp(project) ? terrainStampPath(project) : null;
  const lines: string[] = [];

  const dependencies: string[] = [];
  for (const entry of autoDependenciesForProject(project)) {
    if (!dependencies.includes(entry.id)) dependencies.push(entry.id);
  }
  // Extra library bundles the author asked for (they may be used from the
  // custom Lua snippet, or by a component this editor does not model).
  for (const dependency of project.extraDependencies || []) {
    const id = (dependency || '').trim();
    if (id && !dependencies.includes(id)) dependencies.push(id);
  }
  const modIcon = project.customIconFile ? `sprites/${modFolder}/icon.png` : undefined;

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

  // `[[components.options]]` belong to the component above them: they are the
  // settings `ctx.option(key)` reads, and an undeclared read is a load error
  // (`"<id> has no option <key>"`), so an imported weapon's list is written back
  // exactly, in declaration order.
  for (const option of project.options ?? []) {
    const key = (option.key || '').trim();
    if (!key) continue;
    lines.push('');
    lines.push('[[components.options]]');
    lines.push(`key = ${luaQuote(key)}`);
    lines.push(`type = ${luaQuote(option.kind || 'bool')}`);
    if (option.label) lines.push(`label = ${luaQuote(option.label)}`);
    if (option.description) lines.push(`description = ${luaQuote(option.description)}`);
    if (option.kind === 'choice') {
      const choices = option.choices ?? [];
      if (choices.length > 0) lines.push(`choices = [${choices.map(luaQuote).join(', ')}]`);
      // `default` is what the profile falls back to, so it has to be one of the
      // choices; an import that lost it falls back to the first.
      const fallback = typeof option.default === 'string' ? option.default : (choices[0] ?? '');
      lines.push(`default = ${luaQuote(fallback)}`);
      if (option.fromBool) lines.push(`from_bool = [${option.fromBool.map(luaQuote).join(', ')}]`);
    } else if (option.kind === 'int') {
      lines.push(`min = ${option.min ?? 0}`);
      lines.push(`max = ${option.max ?? 1}`);
      lines.push(`default = ${typeof option.default === 'number' ? option.default : (option.min ?? 0)}`);
    } else {
      lines.push(`default = ${option.default === true ? 'true' : 'false'}`);
    }
    if (option.data) lines.push('data = true');
  }

  for (const [featureId, table] of Object.entries(project.suggests ?? {})) {
    if (!table || typeof table !== 'object') continue;
    const entries = Object.entries(table).filter(([, value]) => value !== undefined);
    if (entries.length === 0) continue;
    lines.push('');
    lines.push(`[components.suggests.${luaQuote(featureId)}]`);
    const tomlScalar = (value: unknown): string | null => {
      if (typeof value === 'string') return luaQuote(value);
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (Array.isArray(value)) {
        const items = value.map(tomlScalar).filter((item): item is string => item !== null);
        return `[${items.join(', ')}]`;
      }
      return null;
    };
    for (const [key, value] of entries) {
      const rendered = tomlScalar(value);
      if (rendered !== null) lines.push(`${key} = ${rendered}`);
    }
  }

  // Sprites declarations
  const emitted = new Set<string>();
  if (primaryBuilderOn(project)) {
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
      lines.push(`fps = ${asset?.fps || 15}`);
      lines.push(`play = ${luaQuote(asset?.play || 'loop')}`);
    }
  }

  // Timed homing sheets (`homing` / `bits.homing` art).
  const tomlFlags = wfwsRoleFlags(project);
  for (const [owned, key] of [
    [tomlFlags.homing, 'homing'] as const,
    [tomlFlags.bitHoming, 'homing_bit'] as const,
    [tomlFlags.roam, 'roam'] as const,
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

  // The terrain stamp's strip: 32 cells, frame 0 up and clockwise. `frames` is
  // the only key it needs -- nothing animates it, the frame is the argument --
  // but the engine slices by it, and a declared path must be a file the ZIP
  // carries (see `modExporter`).
  if (stampSheet && !emitted.has(stampSheet)) {
    emitted.add(stampSheet);
    const stampFrames = Math.max(
      1,
      Math.round(project.terrainStamp?.sheet?.frames || STAMP_FRAMES),
    );
    lines.push('');
    lines.push(`[sprites.${luaQuote(stampSheet)}]`);
    lines.push(`frames = ${stampFrames}`);
  }

  // The hold picture's cell count, which is not always what the hold plays: the
  // engine slices by this declaration and only picks an index with `hold.frames`
  // (`worm_hold.rs`), so a 20-frame strip held on one frame (`hold.frames = 1`,
  // PX's buffalo) still has to be declared as 20 cells or all of it is squeezed
  // into the cell.
  const holdCells = Math.max(1, Math.round(project.hold?.sheetFrames ?? project.hold?.frames ?? 1));
  if (usesHold && holdCells > 1) {
    const sheetPath = holdSheetPath(project);
    emitted.add(sheetPath);
    lines.push('');
    lines.push(`[sprites.${luaQuote(sheetPath)}]`);
    lines.push(`frames = ${holdCells}`);
    lines.push(`fps = ${project.hold.fps || 15}`);
    lines.push('play = "loop"');
  }

  // The firing sheet is a strip too, and the layer walks it by `fire.frames`.
  // Without the declaration the engine slices by its own rule (height / width),
  // which disagrees with a typed frame count: a 60x240 sheet typed as 8 frames
  // would be cut into 4, and every quad would show half of one cell.
  const fireStripFrames = Math.max(1, Math.round(project.hold?.fireFrames ?? 1));
  if (usesHold && project.hold?.flashFile && fireStripFrames > 1) {
    const sheetPath = flashSheetPath(project);
    if (!emitted.has(sheetPath)) {
      emitted.add(sheetPath);
      lines.push('');
      lines.push(`[sprites.${luaQuote(sheetPath)}]`);
      lines.push(`frames = ${fireStripFrames}`);
      lines.push(`fps = ${Math.max(1, Number(project.hold.fireFps) || 15)}`);
      lines.push('play = "loop"');
    }
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
  return { dependencies, modIcon, block: lines.join('\n') };
}

/** Path of the bundle's own icon inside the pack, avoiding weapon icon collisions. */
export function packIconBundlePath(pack: PackProject): string | undefined {
  if (!pack.iconFile) return undefined;
  const folder = sanitizeModFolder(pack.id);
  const collides = pack.weapons.some(
    (weapon) =>
      !!weapon.customIconFile &&
      sanitizeModFolder(weapon.id).toLowerCase() === folder.toLowerCase(),
  );
  return collides ? `sprites/${folder}/mod_icon.png` : `sprites/${folder}/icon.png`;
}

/** The bundle header and every weapon's block: one file, N components. */
export function generatePackToml(pack: PackProject): string {
  const parts = pack.weapons.map(weaponManifestPart);
  const lines: string[] = [
    `id = ${luaQuote(pack.id)}`,
    `name = ${luaQuote(pack.name)}`,
    `version = ${luaQuote(pack.version || '0.1.0')}`,
    `author = ${luaQuote(pack.author || 'WormForge Creator')}`,
    'api_version = 4',
    'format_version = 2',
  ];

  // One dependency list for the bundle: the union of what its weapons need, in
  // the order they first ask for it. A library installs once per bundle, so a
  // second mention is the same dependency.
  const dependencies: string[] = [];
  for (const part of parts) {
    for (const dependency of part.dependencies) {
      if (!dependencies.includes(dependency)) dependencies.push(dependency);
    }
  }
  if (dependencies.length > 0) {
    lines.push(`dependencies = [${dependencies.map(luaQuote).join(', ')}]`);
  }
  // The bundle's one icon. An uploaded file is written into the bundle's own
  // folder and named by `mod_icon`; without one the first weapon's icon stands
  // in, and a bundle with neither is legal (the mod loader shows initials).
  const packIconPath = packIconBundlePath(pack);
  const modIcon = packIconPath || pack.modIcon || parts.find((part) => part.modIcon)?.modIcon;
  if (modIcon) lines.push(`mod_icon = ${luaQuote(modIcon)}`);
  if (pack.replaces?.length) {
    lines.push(`replaces = [${pack.replaces.map(luaQuote).join(', ')}]`);
  }

  // Each block starts and ends with a blank line, because on its own it is the
  // whole manifest's tail (the blank before `[[components]]` and the one after
  // its last sprite). Between two blocks that would be two blank lines, so the
  // leading one is dropped from every block but the first: a pack of one is then
  // the single-weapon manifest, byte for byte.
  parts.forEach((part, index) => {
    const blockLines = part.block.split('\n');
    if (index > 0 && blockLines[0] === '') blockLines.shift();
    lines.push(...blockLines);
  });
  return lines.join('\n');
}

/** A single weapon is a pack of one, with its own id and name. */
export function singleWeaponPack(project: WeaponProject): PackProject {
  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    description: project.description,
    weapons: [project],
  };
}

export function generateModToml(project: WeaponProject): string {
  return generatePackToml(singleWeaponPack(project));
}

/** The option values a profile has to carry: only the ones the player changed. */
function changedOptions(project: WeaponProject): WeaponOptionConfig[] {
  return (project.options ?? []).filter(
    (option) => option.key && option.value !== undefined && option.value !== option.default,
  );
}

export function generateProfileToml(project: WeaponProject): string {
  return generatePackProfile(singleWeaponPack(project));
}

/**
 * The one profile a pack places: a line per weapon, a line per stock slot they
 * replace, infinite ammo where a weapon asked for it, and the option values that
 * differ from their declared defaults (the engine stores a default as no value,
 * so writing it back would freeze what a manifest change should still own).
 *
 * The engine puts each weapon on the first free position after its
 * `default_position` and leaves a weapon that does not fit **off the panel** while
 * still installing it, so a pack larger than the 70 slots is legal and nothing is
 * silently dropped here.
 */
export function generatePackProfile(pack: PackProject): string {
  // A profile of one weapon describes that weapon, which is what
  // `generateProfileToml` always wrote; a bundle of several describes itself.
  const description =
    pack.description ||
    (pack.weapons.length === 1 ? pack.weapons[0].description : '') ||
    `${pack.name} test profile.`;
  const lines: string[] = [
    `description = ${luaQuote(description)}`,
    '',
    '[weapons]',
  ];
  // One key per line: a weapon id is unique by construction, but two weapons can
  // replace the **same stock slot** (two projectiles both on the Grenade), and a
  // repeated key is not a table entry, it is a TOML error.
  const placed = new Set<string>();
  for (const project of pack.weapons) {
    // The same slot the manifest names (`effectiveSlot`), so the two halves of
    // one export cannot disagree about where the weapon is.
    for (const key of [project.id, `stock.${effectiveSlot(project)}`]) {
      if (placed.has(key)) continue;
      placed.add(key);
      lines.push(`${luaQuote(key)} = true`);
    }
  }
  for (const key of ['stock.ninja_rope', 'stock.skip_go']) {
    if (placed.has(key)) continue;
    placed.add(key);
    lines.push(`${luaQuote(key)} = true`);
  }
  lines.push('');

  for (const project of pack.weapons) {
    if (project.defaults.ammo !== -1) continue;
    lines.push(`[weapon_settings.${luaQuote(project.id)}]`);
    lines.push('ammo = -1');
    lines.push('');
  }

  for (const project of pack.weapons) {
    const changed = changedOptions(project);
    if (changed.length === 0) continue;
    lines.push(`[options.${luaQuote(project.id)}]`);
    for (const option of changed) {
      const value = option.value;
      lines.push(
        `${luaQuote(option.key)} = ${
          typeof value === 'boolean' ? (value ? 'true' : 'false') : typeof value === 'number' ? String(value) : luaQuote(String(value))
        }`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
