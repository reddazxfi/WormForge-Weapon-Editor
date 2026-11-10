import {
  BodyConfig,
  ClustletConfig,
  DigActionConfig,
  PackArtSlot,
  RoamActionConfig,
  WeaponProject,
} from '../types/weapon';
import { getStockPanelPosition } from '../data/stockWeapons';
import { COLLISION_FLAGS } from '../data/recordSchema';

export function sanitizeModFolder(id: string): string {
  const parts = id.trim().split('.');
  const last = parts[parts.length - 1] || 'custom_weapon';
  return last.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'custom_weapon';
}

function luaQuote(str: string): string {
  return JSON.stringify(str);
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
  const usesMissileSprite = missileSpriteEnabled && project.missileSprite.mode === 'custom';

  if (usesHold) {
    lines.push('local holds = require("wf-lib/holds")');
  }
  if (usesMissileSprite) {
    lines.push('local sb = require("wf-lib/px_sprite_builder")');
  }
  if (usesHold || usesMissileSprite) {
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

  // Install function
  lines.push('  install = function(ctx)');
  lines.push('    wa.weapons.replace{');
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
  if (clusterBitArt) clusterArt.push(`sprite = ${luaQuote(clusterBitArt)}`);
  // `cluster.homing_sprite` is applied with `set_cluster_render_timer`, which
  // writes entry+0x170 with no strike shift. `packArtPath` refuses it on a fire
  // type 3 record (see `packArtSlotApplies`), so this is safe for every family.
  if (clusterBitHomingArt) {
    clusterArt.push(`homing_sprite = ${luaQuote(clusterBitHomingArt)}`);
  }
  if (clusterArt.length > 0) {
    lines.push(`      cluster = { ${clusterArt.join(', ')} },`);
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
  const packSprites: string[] = [];
  if (usesHold && project.hold?.sheetFile) {
    packSprites.push(holdSheetPath(project));
  }
  if (usesMissileSprite) {
    packSprites.push(`sprites/${modFolder}/missile.png`);
  }
  if (packSprites.length > 0) {
    lines.push(`      sprites = { ${packSprites.map(luaQuote).join(', ')} },`);
  }

  // Fire type specific properties
  const body = project.body;
  // With an imported .wep the file is the record. Compare against the decoded
  // baseline so untouched fields are inherited and only real edits are written.
  const baseline = project.useWepFile ? project.wepBaseline : undefined;
  const baseBody = baseline?.body;
  const baseOverrides = baseline?.recordOverrides || {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const bodyChanged = <K extends keyof BodyConfig>(key: K) =>
    !baseline || !same(body[key], baseBody?.[key]);
  const clustletChanged = <K extends keyof ClustletConfig>(key: K) =>
    !baseline || !same(body.clustlet[key], baseBody?.clustlet[key]);
  const roamChanged = <K extends keyof RoamActionConfig>(key: K) =>
    !baseline || !same(project.roamConfig?.[key], baseline.roamConfig?.[key]);
  const digChanged = <K extends keyof DigActionConfig>(key: K) =>
    !baseline || !same(project.digConfig?.[key], baseline.digConfig?.[key]);
  const override = (key: string): any => {
    const value = project.recordOverrides[key];
    if (value === undefined) return undefined;
    if (baseline && same(value, baseOverrides[key])) return undefined;
    return value;
  };
  const overrideTouched = (...keys: string[]) => keys.some((key) => override(key) !== undefined);
  const action = project.action || (body.bounce_pct > 0 ? 'bounce' : body.homing !== 'off' ? 'homing' : 'none');
  const actionChanged = !baseline || action !== baseline.action;
  const burst = project.burst || (body.cluster ? 'clusters' : 'nothing');
  const burstChanged = !baseline || burst !== baseline.burst;
  const clustletTouched = (Object.keys(body.clustlet) as (keyof ClustletConfig)[]).some(clustletChanged);
  const fireTouched = !baseline || !same(project.fireConfig, baseline.fireConfig);
  const roamTouched = !baseline || !same(project.roamConfig, baseline.roamConfig);
  const digTouched = !baseline || !same(project.digConfig, baseline.digConfig);

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
        !baseline ||
        bodyChanged('damage') ||
        mineExplosionBias !== undefined ||
        mineExplosionPush !== undefined
      ) {
        lines.push('        explosion = {');
        if (!baseline || bodyChanged('damage')) {
          lines.push(`          power = ${body.damage ?? 50},`);
        }
        if (mineExplosionBias !== undefined) {
          lines.push(`          bias = ${mineExplosionBias},`);
        }
        if (mineExplosionPush !== undefined) {
          lines.push(`          push_pct = ${mineExplosionPush},`);
        }
        lines.push('        },');
      }
      lines.push('      },');
    }
  } else if (project.fireType === 'cursor' && project.teleport) {
    lines.push('      on_select = { cursor = true },');
  } else if (project.fireType === 'special') {
    // Special subtypes have per-subtype layouts; only the selector is generic.
    if (!baseline || project.specialSubtype !== baseline.specialSubtype) {
      lines.push(`      fires = { subtype = ${project.specialSubtype} },`);
    }
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
      explosionVariation !== undefined
    ) {
      lines.push('        explosion = {');
      if (powerChanged) lines.push(`          power = ${body.damage},`);
      if (pushPct !== undefined) lines.push(`          push_pct = ${pushPct},`);
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
    if (spriteOverride !== undefined) {
      if (spriteOverride === 0 || spriteOverride === '0') {
        lines.push('        sprite = 0,');
      } else if (!isNaN(Number(spriteOverride))) {
        lines.push(`        sprite = ${Number(spriteOverride)},`);
      } else {
        lines.push(`        sprite = ${luaQuote(String(spriteOverride))},`);
      }
    } else if (
      missileSpriteEnabled &&
      project.missileSprite?.hideStock &&
      (!baseline || !same(project.missileSprite?.hideStock, baseline.missileSprite?.hideStock))
    ) {
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
      const trSprite = project.recordOverrides['missile.trail.sprite'] ?? 'smoke';
      if (!isNaN(Number(trSprite))) {
        lines.push(`          sprite = ${Number(trSprite)},`);
      } else {
        lines.push(`          sprite = ${luaQuote(String(trSprite))},`);
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
      if (actionChanged || bodyChanged('bounce_pct')) {
        lines.push(`          bounciness = ${body.bounce_pct ?? 0},`);
      }
      const keepSpeed = override('missile.bounce.terrain_keep_speed_pct');
      if (keepSpeed !== undefined) {
        lines.push(`          terrain_keep_speed_pct = ${keepSpeed},`);
      }
      const maxBounces = override('missile.bounce.max_bounces');
      if (maxBounces !== undefined) lines.push(`          max_bounces = ${maxBounces},`);
      const bounceSound = override('missile.bounce.sound');
      if (bounceSound !== undefined) lines.push(`          sound = ${bounceSound},`);
      const contactSides = override('missile.bounce.contact_sides');
      if (contactSides !== undefined) {
        lines.push(`          contact_sides = ${contactSides},`);
      }
      const extraReverse = override('missile.bounce.extra_reverse_chance_pct');
      if (extraReverse !== undefined) {
        lines.push(`          extra_reverse_chance_pct = ${extraReverse},`);
      }

      const bounceExplosionBias = override('missile.bounce.explosion.bias');
      const bounceExplosionPush = override('missile.bounce.explosion.push_pct');
      const bounceExplosionPower = override('missile.bounce.explosion.power');
      const bounceExplosionVariation = override('missile.bounce.explosion.variation');
      if (
        bounceExplosionBias !== undefined ||
        bounceExplosionPush !== undefined ||
        bounceExplosionPower !== undefined ||
        bounceExplosionVariation !== undefined
      ) {
        lines.push('          explosion = {');
        if (bounceExplosionBias !== undefined) {
          lines.push(`            bias = ${bounceExplosionBias},`);
        }
        if (bounceExplosionPush !== undefined) {
          lines.push(`            push_pct = ${bounceExplosionPush},`);
        }
        if (bounceExplosionPower !== undefined) {
          lines.push(`            power = ${bounceExplosionPower},`);
        }
        if (bounceExplosionVariation !== undefined) {
          lines.push(`            variation = ${bounceExplosionVariation},`);
        }
        lines.push('          },');
      }

      // `bounce.hits` is the bounce action's own target selection. It is added
      // to `ends_on_contact`, never a replacement for it.
      const bounceHits = luaMaskTable(override('missile.bounce.hits'));
      if (bounceHits !== null) {
        lines.push(`          hits = ${bounceHits},`);
      }
      lines.push('        },');
    } else if (
      action === 'homing' &&
      (actionChanged ||
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

      const homingSprite = override('missile.homing.sprite');
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
      if (homingAnimation !== undefined) {
        lines.push(`          animation = ${homingAnimation},`);
      }

      const homingTrailSprite = override('missile.homing.trail.sprite');
      const homingTrailPower = override('missile.homing.trail.power');
      const homingTrailSpeed = override('missile.homing.trail.speed');
      const homingTrailBubbles = override('missile.homing.trail.bubbles_per_second');
      if (
        homingTrailSprite !== undefined ||
        homingTrailPower !== undefined ||
        homingTrailSpeed !== undefined ||
        homingTrailBubbles !== undefined
      ) {
        lines.push('          trail = {');
        if (homingTrailSprite !== undefined) {
          if (homingTrailSprite === 0 || homingTrailSprite === '0' || homingTrailSprite === '') {
            lines.push('            sprite = 0,');
          } else if (!isNaN(Number(homingTrailSprite))) {
            lines.push(`            sprite = ${Number(homingTrailSprite)},`);
          } else {
            lines.push(`            sprite = ${luaQuote(String(homingTrailSprite))},`);
          }
        }
        if (homingTrailPower !== undefined) {
          lines.push(`            power = ${homingTrailPower},`);
        }
        if (homingTrailSpeed !== undefined) {
          lines.push(`            speed = ${homingTrailSpeed},`);
        }
        if (homingTrailBubbles !== undefined) {
          lines.push(`            bubbles_per_second = ${homingTrailBubbles},`);
        }
        lines.push('          },');
      }
      lines.push('        },');
    } else if (action === 'roam' && project.roamConfig && roamTouched) {
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
        if (roamChanged('gas_animal_sprite')) {
          lines.push(`            animal_sprite = ${r.gas_animal_sprite ?? 0},`);
        }
        lines.push('          },');
      }
      lines.push('        },');
    } else if (action === 'dig' && project.digConfig && digTouched) {
      const d = project.digConfig;
      lines.push('        dig = {');
      if (digChanged('sound')) lines.push(`          sound = ${d.sound ?? 90},`);
      if (digChanged('dive_sprite')) {
        lines.push(`          dive_sprite = ${d.dive_sprite ?? 0},`);
      }
      if (digChanged('sprite_1')) lines.push(`          sprite_1 = ${d.sprite_1 ?? 0},`);
      if (digChanged('sprite_2')) lines.push(`          sprite_2 = ${d.sprite_2 ?? 0},`);
      if (digChanged('sprite_3')) lines.push(`          sprite_3 = ${d.sprite_3 ?? 0},`);
      lines.push('        },');
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
    const sheepTouched =
      !baseline ||
      !same(
        {
          flight_1: project.roamConfig?.flight_1,
          flight_2: project.roamConfig?.flight_2,
        },
        {
          flight_1: baseline.roamConfig?.flight_1,
          flight_2: baseline.roamConfig?.flight_2,
        }
      );
    if (action === 'roam' && project.roamConfig && sheepTouched) {
      lines.push('      sheep = {');
      lines.push(`        flight_1 = ${project.roamConfig.flight_1 ?? 0},`);
      lines.push(`        flight_2 = ${project.roamConfig.flight_2 ?? 0},`);
      lines.push('      },');
    }

    // Clusters block. `clusters.bit` is the child missile body, so it takes
    // the same action groups as `missile` (bounce/homing), not just a damage
    // number. The `.wep` importer decodes the child action at 0x168.
    if (burst === 'clusters' && (burstTouched || clustletTouched || clusterBitTrailArt)) {
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
      const baseBitAction =
        baseCluster?.bit_action ??
        (baseCluster?.homing !== 'off'
          ? 'homing'
          : baseCluster?.contact === 'bounce'
            ? 'bounce'
            : 'none');
      const bitActionChanged = !baseline || bitAction !== baseBitAction;
      const bitRoamChanged = (key: keyof RoamActionConfig) =>
        clustletChanged('bit_action') || !same(c.roam?.[key], baseCluster?.roam?.[key]);
      const bitDigChanged = (key: keyof DigActionConfig) =>
        clustletChanged('bit_action') || !same(c.dig?.[key], baseCluster?.dig?.[key]);

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

      if (bitTouched || bitActionChanged || clusterBitTrailArt) {
        lines.push('        bit = {');
        if (bitActionChanged) lines.push(`          action = ${luaQuote(bitAction)},`);

        if (clustletChanged('sprite')) {
          const s = c.sprite;
          if (s === '' || s === '0') lines.push('          sprite = 0,');
          else if (!isNaN(Number(s))) lines.push(`          sprite = ${Number(s)},`);
          else lines.push(`          sprite = ${luaQuote(String(s))},`);
        }
        if (clustletChanged('sprite_count')) {
          lines.push(`          sprite_count = ${c.sprite_count ?? 0},`);
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
          } else if (!isNaN(Number(t))) {
            lines.push(`            sprite = ${Number(t)},`);
          } else {
            lines.push(`            sprite = ${luaQuote(t)},`);
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
          (clustletChanged('homing') ||
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
          if (clustletChanged('homing_sprite')) {
            lines.push(`            sprite = ${c.homing_sprite ?? 0},`);
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
          c.dig &&
          (clustletChanged('bit_action') || clustletChanged('dig'))
        ) {
          const d = c.dig;
          lines.push('          dig = {');
          if (bitDigChanged('sound')) lines.push(`            sound = ${d.sound ?? 90},`);
          if (bitDigChanged('dive_sprite')) {
            lines.push(`            dive_sprite = ${d.dive_sprite ?? 0},`);
          }
          if (bitDigChanged('sprite_1')) {
            lines.push(`            sprite_1 = ${d.sprite_1 ?? 0},`);
          }
          if (bitDigChanged('sprite_2')) {
            lines.push(`            sprite_2 = ${d.sprite_2 ?? 0},`);
          }
          if (bitDigChanged('sprite_3')) {
            lines.push(`            sprite_3 = ${d.sprite_3 ?? 0},`);
          }
          lines.push('          },');
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

  // Hold Art
  if (usesHold) {
    const h = project.hold;
    const handIdx = h.handType === 'lower' ? 1 : h.handType === 'upper' ? 3 : 2;
    const sheetPath = holdSheetPath(project);

    lines.push('      worm_sprites = holds.PX_POSTURE,');
    lines.push('      hold = {');
    lines.push(`        sheet = ${luaQuote(sheetPath)},`);
    lines.push(`        hand = holds.PX_HANDS[${handIdx}],`);
    lines.push(`        hand_type = ${handIdx},`);
    lines.push(`        hand_radius = ${h.handRadius ?? 10},`);
    lines.push('        hand_rotation = 1,');
    lines.push('        hand_radial_rotation = 1,');
    lines.push(`        weap_radius = ${h.weapRadius ?? -8},`);
    lines.push(`        weap_rotation = ${(1 + (h.weapRotation || 0) / 180).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')},`);
    lines.push('        weap_radial_rotation = 1,');
    if (h.frames > 1) {
      lines.push(`        frames = ${h.frames},`);
      // worm_hold.rs advances `phase` by anim_speed * 0.03 on every 50 Hz
      // game frame, so one full cycle takes 0.667 / anim_speed seconds and the
      // sheet shows 1.5 * frames * anim_speed frames per second. The builder
      // asks for that real in-game FPS; convert it to the engine multiplier
      // here so the number on screen is what the game plays.
      const fps = Math.max(1, Number(h.fps) || 15);
      const animSpeed = fps / (1.5 * h.frames);
      if (Math.abs(animSpeed - 1) > 0.0005) {
        lines.push(`        anim_speed = ${formatNumber(animSpeed)},`);
      }
    }
    if (h.handScale && h.handScale !== 1) lines.push(`        hand_scale = ${h.handScale},`);
    if (!h.drawHand) lines.push('        draw_hand = false,');
    if (h.keepWhileFiring) lines.push('        keep_while_firing = true,');
    if (h.thrown) lines.push('        thrown = true,');
    if (h.putAway) lines.push('        put_away = true,');
    lines.push('      },');
  }

  // Custom Lua callback (only when checkbox is explicitly enabled)
  if (project.enableCustomLua && project.customLuaSnippet && project.customLuaSnippet.trim()) {
    lines.push('      -- Custom weapon callbacks');
    lines.push(
      project.customLuaSnippet
        .split('\n')
        .map((l) => (l ? `      ${l}` : ''))
        .join('\n')
    );
  }

  lines.push('    }');

  // px_sprite_builder draws the flight sheet with a follower actor and hides
  // WA's missile (`m.sprite = 0`). Its `anim` is PX's ANIM_TYPE, not the
  // record's native `animation`; the two are deliberately kept apart.
  if (usesMissileSprite) {
    const m = project.missileSprite!;
    lines.push('    sb.flight(ctx, {');
    lines.push('      weapon = ctx.id,');
    lines.push(`      sheet = ${luaQuote(`sprites/${modFolder}/missile.png`)},`);
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
  const usesMissileSprite =
    !!project.missileSprite?.enabled && project.missileSprite.mode === 'custom';
  const usesSdk = usesHold || usesMissileSprite;

  const lines: string[] = [
    `id = ${luaQuote(project.id)}`,
    `name = ${luaQuote(project.name)}`,
    `version = ${luaQuote(project.version || '0.1.0')}`,
    `author = ${luaQuote(project.author || 'WormForge Creator')}`,
    'api_version = 4',
    'format_version = 2',
  ];

  if (usesSdk) {
    lines.push('dependencies = ["wf.sdk"]');
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
    const missilePath = `sprites/${modFolder}/missile.png`;
    emitted.add(missilePath);
    lines.push('');
    lines.push(`[sprites.${luaQuote(missilePath)}]`);
    if (project.missileSprite.frames > 1) lines.push(`frames = ${project.missileSprite.frames}`);
    lines.push(`fps = ${project.missileSprite.fps || 15}`);
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