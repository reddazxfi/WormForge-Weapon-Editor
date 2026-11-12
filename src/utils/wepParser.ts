import {
  WeaponProject,
  FireType,
  HomingKind,
  MissileAction,
  BurstPayload,
  CollisionMask,
  RoamActionConfig,
  DigActionConfig,
} from '../types/weapon';
import { COLLISION_FLAGS } from '../data/recordSchema';
import { decodeRecordId } from '../data/stockSprites';
import { withWfwsPrefix } from './weaponId';

export interface WepParseResult {
  success: boolean;
  name: string;
  fireType: FireType;
  inferredDonor: string;
  rawOffsets: Record<number, number>;
  projectState: Partial<WeaponProject>;
  summary: string[];
  error?: string;
  /** The original file, kept when the bundle should use `wep = "..."`. */
  wepFile?: File;
  wepFileName?: string;
}

const WEP_TAG = [0x06, 0xdd, 0xbb, 0x5a];
const WEAPON_ENTRY_SIZE = 0x1d0;
const STRINGS_AT = 0x1e4;

// Stock sprite ids used by the cluster-bit fields. Unknown ids are kept as
// their numeric string so the generator can still write the exact value.
const CLUSTLET_SPRITE_NAMES: Record<number, string> = {
  48: 'missile',
  53: 'cluster',
  54: 'clustlet',
  645: 'missile_2',
  649: 'cluster_2',
  650: 'clustlet_2',
};
const TRAIL_SPRITE_NAMES: Record<number, string> = {
  507: 'skdsmoke',
  609: 'smklt25',
  610: 'smklt50',
  611: 'smklt75',
  612: 'smklt100',
};
// WA packs a 16.16 phase beside an id, so a scheme can hold `0x10000 + id`
// (the Mole Bomb's dig sound is 65574 = 38). Decode before naming.
const recNum = (value: number): number => decodeRecordId(value).id;
const spriteName = (id: number, names: Record<number, string>): string => {
  const n = recNum(id);
  return n === 0 ? '' : names[n] ?? String(n);
};

// `record.rs` keeps the impact-particle flag in the same word as the
// `bounce.hits` mask (`1 << 30`).
const IMPACT_PARTICLES = 1 << 30;

// Stock missile bodies. The API also accepts the aliases `bazooka`, `homing`,
// `pigeon` and `mine` (see `gfx::stock_sprite_id`), so decode to those names.
const MISSILE_SPRITE_NAMES: Record<number, string> = {
  45: 'mine',
  48: 'bazooka',
  50: 'grenade',
  51: 'banana',
  52: 'mortar',
  53: 'cluster',
  58: 'homing',
  78: 'dynamite',
  175: 'pigeon',
  653: 'sheep',
};

// Decode a native collision word into the named mask the record editor uses.
// The composite `worms` shortcut is skipped so every worm state keeps its own
// checkbox; unknown bits survive in `extra_bits`.
function maskFromBits(bits: number): CollisionMask {
  const value = bits >>> 0;
  const mask: CollisionMask = {};
  let known = 0;
  for (const [key, bit] of Object.entries(COLLISION_FLAGS)) {
    if (key === 'worms' || !bit) continue;
    if ((value & bit) === bit) {
      (mask as Record<string, boolean | number>)[key] = true;
      known |= bit;
    }
  }
  const extra = value & ~known & 0xffffffff;
  if (extra !== 0) mask.extra_bits = extra >>> 0;
  return mask;
}

/** Re-key a word table by `delta`, so a shifted body can be read with the
 *  unshifted offsets. A strike's munition body starts 0x14 bytes further in
 *  (`record.rs` STRIKE_SHIFT); cluster bits shift with it. */
function shiftOffsets(
  src: Record<number, number>,
  delta: number
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(src)) out[Number(key) + delta] = value;
  return out;
}

function readInt32LE(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) return 0;
  return view.getInt32(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) return 0;
  return view.getUint32(offset, true);
}

/**
 * `utility.effect` values, in the engine's order
 * (`crates/weapons/src/record.rs` `UTILITY_EFFECTS`). Index 8 is the
 * placeholder PX uses while Lua supplies the effect.
 */
const UTILITY_EFFECTS = [
  'low_gravity',
  'fast_walk',
  'laser_sight',
  'invisibility',
  'damage_x2',
  'crate_spy',
  'double_turn_time',
  'crate_shower',
  'scripted',
] as const;

export function parseWepBinary(buffer: ArrayBuffer, fileName: string): WepParseResult {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 + WEAPON_ENTRY_SIZE) {
    return {
      success: false,
      name: '',
      fireType: 'power',
      inferredDonor: 'bazooka',
      rawOffsets: {},
      projectState: {},
      summary: [],
      error: 'File is too small to be a valid .wep binary (requires at least 468 bytes).',
    };
  }

  // Check tag
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== WEP_TAG[i]) {
      return {
        success: false,
        name: '',
        fireType: 'power',
        inferredDonor: 'bazooka',
        rawOffsets: {},
        projectState: {},
        summary: [],
        error: `Invalid .wep magic tag (expected [0x06, 0xDD, 0xBB, 0x5A], found [${Array.from(bytes.slice(0, 4)).map(b => '0x' + b.toString(16).toUpperCase()).join(', ')}]).`,
      };
    }
  }

  const view = new DataView(buffer);

  // Extract display name at 0x1E4
  let weaponName = fileName.replace(/\.wep$/i, '').replace(/_/g, ' ');
  if (bytes.length >= STRINGS_AT + 4) {
    const strLen = readUint32LE(view, STRINGS_AT);
    if (strLen > 0 && strLen < 256 && STRINGS_AT + 4 + strLen <= bytes.length) {
      const nameBytes = bytes.slice(STRINGS_AT + 4, STRINGS_AT + 4 + strLen);
      // Decode Latin-1
      let decoded = '';
      for (let i = 0; i < nameBytes.length; i++) {
        decoded += String.fromCharCode(nameBytes[i]);
      }
      decoded = decoded.trim();
      if (decoded.length > 0) {
        weaponName = decoded;
      }
    }
  }

  // Record slab is bytes 4 to 4 + 0x1D0
  // Offsets inside record slab are relative to slab start (0x04)
  const slabOffset = 4;
  const rawOffsets: Record<number, number> = {};
  for (let off = 0; off < WEAPON_ENTRY_SIZE; off += 4) {
    rawOffsets[off] = readInt32LE(view, slabOffset + off);
  }

  const fireTypeRaw = rawOffsets[0x30] ?? 0;
  const fireMethod = rawOffsets[0x38] ?? 0;
  const subtype = rawOffsets[0x34] ?? 0;
  const shots = rawOffsets[0x14] ?? 1;
  const retreat = rawOffsets[0x1c] ?? 3000;

  // Family selection mirrors `Family::of` in `crates/weapons/src/record.rs`.
  // The old parser read missile offsets for every family, so an imported gun
  // or mine got missile damage/gravity/bounce values written over it.
  const isGun = fireTypeRaw === 1 && fireMethod === 2;
  const isArrow = fireTypeRaw === 1 && fireMethod === 4;
  const isSpray = fireTypeRaw === 1 && fireMethod === 1;
  const isMine = fireTypeRaw === 2 && fireMethod === 1;
  const isStrike = fireTypeRaw === 3;
  const isSpecial = fireTypeRaw === 4;
  const isMissile = !isGun && !isArrow && !isSpray && !isMine && !isStrike && !isSpecial;

  let damage = 0;
  let pushPct = 100;
  let gravityPct = 100;
  let windPct = 100;
  let bouncePct = 0;
  let speedPct = 100;
  let countdownMs = 0;
  let fuseMs = 0;
  let explodeOnSpace = false;
  let missileAction = 0;
  let homingKindRaw = 0;
  let homingArm = 0;
  let homingTime = 0;
  let burstRaw = 0;
  let clusterCount = 0;
  let clusterAngle = 0;
  let clusterSpread = 0;
  let clusterPower = 0;
  let clusterPowerVariation = 0;
  let cDamage = 0;
  let cGravityPct = 100;
  let cWindPct = 100;
  let cBouncePct = 0;
  let cFuse = 0;
  let cAction = 0;
  let cBounces = 0;
  let cBounceExplode = false;
  let cBouncePower = 0;
  let cHomingKind = 0;
  let cHomingArm = 0;
  let cHomingTime = 0;
  let cTrail = '';
  let cSprite = 54;
  let cSpriteCount = 0;
  let cAnimation = 0;
  let cTrailPower = 0;
  let cTrailSpeed = 0;
  let cTrailBubbles = 0;
  let cSpeedPct = 100;
  let cCountdown = 0;
  let cFlightSound = 0;
  let cExplosionSoundEnabled = false;
  let cExplosionSound = 0;
  let cExplosionSoundBefore = 0;
  let cExplodeOnSpace = false;
  let cEndsOnContact = 0;
  let cExplosionBias = 0;
  let cExplosionPush = 100;
  let cExplosionVariation = 0;
  let cBounceHits = 0;
  let cBounceKeep = 75;
  let cBounceSound = 0;
  let cBounceContactSides = 0;
  let cBounceExtraReverse = 0;
  let cBounceExplosionBias = 0;
  let cBounceExplosionPush = 100;
  let cBounceExplosionVariation = 0;
  let cHomingSprite = 0;
  let cHomingAnimation = 0;
  let cHomingTrailSprite = 0;
  let cHomingTrailPower = 0;
  let cHomingTrailSpeed = 0;
  let cHomingTrailBubbles = 0;
  let cBitAction: 'none' | 'bounce' | 'homing' | 'roam' | 'dig' = 'none';
  let cRoam: RoamActionConfig | undefined;
  let cDig: DigActionConfig | undefined;
  let mineProx = 0;
  let mineArm = 0;
  let mineFuse = 0;
  let mineMask = 0;
  let mineExplosionBias = 0;
  let mineExplosionPush = 100;
  let gunBullets = 0;
  let gunSpread = 0;
  let gunShotInterval = 0;
  let gunBurstSize = 0;
  let gunBurstSpread = 0;
  let gunHits = 0;
  let gunExplosionBias = 0;
  let gunExplosionPush = 100;
  let gunExplosionVariation = 0;
  let gunImpactEffect = 0;
  let strikeCount = 0;
  let strikePlane = 0;
  let strikeSpacing = 0;
  let strikeMunitionSpeed = 0;
  let strikePlaneSound = 0;
  let strikeMunition = 0;

  // Advanced missile-body values (kept for the record editor's Advanced tab).
  let explosionBias = 0;
  let explosionVariation = 0;
  let randomMotion = 0;
  let flightSound = 0;
  let explosionSoundEnabled = false;
  let explosionSound = 0;
  let explosionSoundBefore = 0;
  let launchSound = 0;
  let collisionShape = 0;
  let alarmWorms = false;
  let endsOnContact = 0;
  let impactParticles = false;
  let bounceHits = 0;
  let trailSprite = '';
  let trailPower = 0;
  let trailSpeed = 0;
  let trailBubbles = 0;
  let missileSprite = '';
  let missileAnimation = 0;
  let bounceKeep = 75;
  let bounceSound = 0;
  let bounceContactSides = 0;
  let bounceExtraReverse = 0;
  let bounceExplosionBias = 0;
  let bounceExplosionPush = 100;
  let bounceExplosionPower = 0;
  let bounceExplosionVariation = 0;
  let maxBounces = 0;
  let homingSprite = '';
  let homingAnimation = 0;
  let homingTrailSprite = '';
  let homingTrailPower = 0;
  let homingTrailSpeed = 0;
  let homingTrailBubbles = 0;
  let digSound = 0;
  let digDiveSprite = 0;
  let digSprite1 = 0;
  let digSprite2 = 0;
  let digSprite3 = 0;
  let roamWalkSpeed = 0;
  let roamStepHeight = 0;
  let roamEdgeAngle = 0;
  let roamEdgeSpeed = 0;
  let roamEdgeSound = 0;
  let roamJumpAngle = 0;
  let roamJumpSpeed = 0;
  let roamJumpSound = 0;
  let roamTerrainOffset = 0;
  let roamGasStart = 0;
  let roamGasPoison = 0;
  let roamGasSprite = 0;
  let roamFlight1 = 0;
  let roamFlight2 = 0;
  let roamHits = 0;
  let roamFlightHits = 0;

  // A strike carries the same munition body 0x14 bytes further into the
  // record (`record.rs` STRIKE_SHIFT). Shift the word table so the decoder
  // below reads named offsets identically for missiles and strikes; the
  // cluster-bit body shifts with it.
  const bodyRaw = isStrike ? shiftOffsets(rawOffsets, -0x14) : rawOffsets;
  if (isMissile || isStrike) {
    // Missile body offsets (`record.rs` BODY).
    damage = bodyRaw[0x54] ?? 0;
    pushPct = bodyRaw[0x50] ?? 100;
    gravityPct = bodyRaw[0x84] ?? 100;
    windPct = bodyRaw[0x7c] ?? 100;
    speedPct = bodyRaw[0x78] ?? 100;
    countdownMs = bodyRaw[0x88] ?? 0;
    fuseMs = bodyRaw[0x8c] ?? 0;
    explodeOnSpace = (bodyRaw[0xa0] ?? 0) !== 0;
    missileAction = bodyRaw[0xa4] ?? 0;
    burstRaw = bodyRaw[0xf0] ?? 0;

    // Header fields shared with the record editor's Advanced tab.
    collisionShape = bodyRaw[0x3c] ?? 0;
    alarmWorms = (bodyRaw[0x44] ?? 0) !== 0;
    endsOnContact = bodyRaw[0x48] ?? 0;
    explosionBias = bodyRaw[0x4c] ?? 0;
    explosionVariation = bodyRaw[0x58] ?? 0;
    missileSprite = spriteName(bodyRaw[0x60] ?? 0, MISSILE_SPRITE_NAMES);
    missileAnimation = bodyRaw[0x64] ?? 0;
    trailSprite = spriteName(bodyRaw[0x68] ?? 0, TRAIL_SPRITE_NAMES);
    trailPower = bodyRaw[0x6c] ?? 0;
    trailSpeed = bodyRaw[0x70] ?? 0;
    trailBubbles = (bodyRaw[0x74] ?? 0) / 4; // Kind::Fraction(1, 4)
    randomMotion = bodyRaw[0x80] ?? 0;
    flightSound = recNum(bodyRaw[0x90] ?? 0);
    explosionSoundEnabled = (bodyRaw[0x94] ?? 0) !== 0;
    explosionSound = recNum(bodyRaw[0x98] ?? 0);
    explosionSoundBefore = recNum(bodyRaw[0x9c] ?? 0);
    const impactWord = bodyRaw[0xa8] ?? 0;
    impactParticles = (impactWord & IMPACT_PARTICLES) !== 0;
    // Bounce and homing share the +A8..+D0 body slots. Decode only the active
    // group so switching actions cannot inherit bytes belonging to the other.
    if (missileAction === 2) {
      bounceHits = impactWord & ~IMPACT_PARTICLES;
      bouncePct = bodyRaw[0xac] ?? 0;
      bounceKeep = bodyRaw[0xb0] ?? 75;
      bounceSound = recNum(bodyRaw[0xb4] ?? 0);
      bounceContactSides = bodyRaw[0xb8] ?? 0;
      bounceExtraReverse = bodyRaw[0xbc] ?? 0;
      bounceExplosionBias = bodyRaw[0xc0] ?? 0;
      bounceExplosionPush = bodyRaw[0xc4] ?? 100;
      bounceExplosionPower = bodyRaw[0xc8] ?? 0;
      bounceExplosionVariation = bodyRaw[0xcc] ?? 0;
      maxBounces = bodyRaw[0xd0] ?? 0;
    } else if (missileAction === 1) {
      homingSprite = spriteName(bodyRaw[0xac] ?? 0, MISSILE_SPRITE_NAMES);
      homingAnimation = bodyRaw[0xb0] ?? 0;
      homingTrailSprite = spriteName(bodyRaw[0xb4] ?? 0, TRAIL_SPRITE_NAMES);
      homingTrailPower = bodyRaw[0xb8] ?? 0;
      homingTrailSpeed = bodyRaw[0xbc] ?? 0;
      homingTrailBubbles = (bodyRaw[0xc0] ?? 0) / 4;
      homingKindRaw = bodyRaw[0xc4] ?? 0;
      homingArm = bodyRaw[0xc8] ?? 0;
      homingTime = bodyRaw[0xcc] ?? 5000;
    }
    if (missileAction === 4) {
      // DigAction shares the +B0..+C0 body slots with bounce/homing.
      digSound = recNum(bodyRaw[0xb0] ?? 0);
      digDiveSprite = bodyRaw[0xb4] ?? 0;
      digSprite1 = bodyRaw[0xb8] ?? 0;
      digSprite2 = bodyRaw[0xbc] ?? 0;
      digSprite3 = bodyRaw[0xc0] ?? 0;
    }
    if (missileAction === 3) {
      // RoamAction shares the same body slots. Walk speed is raw/50 px/frame;
      // jump speeds are raw*3/50 px/frame (native 6*n/100).
      roamHits = (bodyRaw[0xa8] ?? 0) & ~IMPACT_PARTICLES;
      roamFlightHits = bodyRaw[0xac] ?? 0;
      roamWalkSpeed = (bodyRaw[0xb0] ?? 0) / 50;
      roamStepHeight = bodyRaw[0xb4] ?? 0;
      roamEdgeAngle = bodyRaw[0xb8] ?? 0;
      roamEdgeSpeed = ((bodyRaw[0xbc] ?? 0) * 3) / 50;
      roamEdgeSound = recNum(bodyRaw[0xc0] ?? 0);
      roamJumpAngle = bodyRaw[0xc4] ?? 0;
      roamJumpSpeed = ((bodyRaw[0xc8] ?? 0) * 3) / 50;
      roamJumpSound = recNum(bodyRaw[0xcc] ?? 0);
      roamTerrainOffset = bodyRaw[0xd0] ?? 0;
      roamGasStart = bodyRaw[0xd4] ?? 0;
      roamGasPoison = bodyRaw[0xd8] ?? 0;
      roamGasSprite = recNum(bodyRaw[0xdc] ?? 0);
      roamFlight1 = recNum(bodyRaw[0xe0] ?? 0);
      roamFlight2 = recNum(bodyRaw[0xe4] ?? 0);
    }
    launchSound = recNum(bodyRaw[0xf4] ?? 0);
    clusterCount = bodyRaw[0xf8] ?? 5;
    clusterAngle = bodyRaw[0x104] ?? 0;
    clusterSpread = bodyRaw[0x108] ?? 45;
    clusterPower = bodyRaw[0xfc] ?? 0;
    clusterPowerVariation = bodyRaw[0x100] ?? 0;
    // `clusters.bit.*` mirrors the whole body at +0xC4 (record.rs BIT_SHIFT).
    // The bounce and homing groups overlap, so only the active action's bytes
    // are decoded; the other group keeps its API defaults.
    cAction = bodyRaw[0x168] ?? 0;
    cBitAction =
      cAction === 2
        ? 'bounce'
        : cAction === 1
          ? 'homing'
          : cAction === 3
            ? 'roam'
            : cAction === 4
              ? 'dig'
              : 'none';
    cEndsOnContact = bodyRaw[0x10c] ?? 0;
    cExplosionBias = bodyRaw[0x110] ?? 0;
    cExplosionPush = bodyRaw[0x114] ?? 100;
    cDamage = bodyRaw[0x118] ?? 30;
    cExplosionVariation = bodyRaw[0x11c] ?? 0;
    cSprite = bodyRaw[0x124] ?? 54;
    cAnimation = bodyRaw[0x128] ?? 0;
    cTrail = spriteName(bodyRaw[0x12c] ?? 0, TRAIL_SPRITE_NAMES);
    cTrailPower = bodyRaw[0x130] ?? 0;
    cTrailSpeed = bodyRaw[0x134] ?? 0;
    cTrailBubbles = (bodyRaw[0x138] ?? 0) / 4;
    cSpeedPct = bodyRaw[0x13c] ?? 100;
    cWindPct = bodyRaw[0x140] ?? 100;
    cGravityPct = bodyRaw[0x148] ?? 100;
    cCountdown = bodyRaw[0x14c] ?? 0;
    cFuse = bodyRaw[0x150] ?? 5000;
    cFlightSound = recNum(bodyRaw[0x154] ?? 0);
    cExplosionSoundEnabled = (bodyRaw[0x158] ?? 0) !== 0;
    cExplosionSound = recNum(bodyRaw[0x15c] ?? 0);
    cExplosionSoundBefore = recNum(bodyRaw[0x160] ?? 0);
    cExplodeOnSpace = (bodyRaw[0x164] ?? 0) !== 0;
    cSpriteCount = bodyRaw[0x120] ?? 0;
    if (cAction === 2) {
      const bounceWord = bodyRaw[0x16c] ?? 0;
      cBounceHits = bounceWord & ~IMPACT_PARTICLES;
      cBouncePct = bodyRaw[0x170] ?? 0;
      cBounceKeep = bodyRaw[0x174] ?? 75;
      cBounceSound = recNum(bodyRaw[0x178] ?? 0);
      cBounceContactSides = bodyRaw[0x17c] ?? 0;
      cBounceExtraReverse = bodyRaw[0x180] ?? 0;
      cBounceExplosionBias = bodyRaw[0x184] ?? 0;
      cBounceExplosionPush = bodyRaw[0x188] ?? 100;
      cBouncePower = bodyRaw[0x18c] ?? 0;
      cBounceExplosionVariation = bodyRaw[0x190] ?? 0;
      cBounces = bodyRaw[0x194] ?? 0;
      cBounceExplode = cBouncePower > 0;
    } else if (cAction === 1) {
      cHomingSprite = bodyRaw[0x170] ?? 0;
      cHomingAnimation = bodyRaw[0x174] ?? 0;
      cHomingTrailSprite = bodyRaw[0x178] ?? 0;
      cHomingTrailPower = bodyRaw[0x17c] ?? 0;
      cHomingTrailSpeed = bodyRaw[0x180] ?? 0;
      cHomingTrailBubbles = (bodyRaw[0x184] ?? 0) / 4;
      cHomingKind = bodyRaw[0x188] ?? 0;
      cHomingArm = bodyRaw[0x18c] ?? 0;
      cHomingTime = bodyRaw[0x190] ?? 5000;
    } else if (cAction === 3) {
      // RoamAction child body: same layout as `missile.roam`, shifted by 0xC4.
      cRoam = {
        walk_speed: (bodyRaw[0x174] ?? 0) / 50,
        step_height: bodyRaw[0x178] ?? 0,
        terrain_offset: bodyRaw[0x194] ?? 0,
        edge_jump_angle_deg: bodyRaw[0x17c] ?? 0,
        edge_jump_speed: ((bodyRaw[0x180] ?? 0) * 3) / 50,
        edge_jump_sound: recNum(bodyRaw[0x184] ?? 0),
        jump_angle_deg: bodyRaw[0x188] ?? 0,
        jump_speed: ((bodyRaw[0x18c] ?? 0) * 3) / 50,
        jump_sound: recNum(bodyRaw[0x190] ?? 0),
        gas_start_delay_ms: bodyRaw[0x198] ?? 0,
        gas_poison_power: bodyRaw[0x19c] ?? 0,
        gas_animal_sprite: recNum(bodyRaw[0x1a0] ?? 0),
        flight_1: 0,
        flight_2: 0,
        hits: maskFromBits((bodyRaw[0x16c] ?? 0) & ~IMPACT_PARTICLES),
        flight_hits: maskFromBits(bodyRaw[0x170] ?? 0),
      };
    } else if (cAction === 4) {
      // DigAction child body: same layout as `missile.dig`.
      cDig = {
        sound: recNum(bodyRaw[0x174] ?? 0),
        dive_sprite: recNum(bodyRaw[0x178] ?? 0),
        sprite_1: recNum(bodyRaw[0x17c] ?? 0),
        sprite_2: recNum(bodyRaw[0x180] ?? 0),
        sprite_3: recNum(bodyRaw[0x184] ?? 0),
      };
    }
  } else if (isMine) {
    mineProx = rawOffsets[0x3c] ?? 25;
    mineArm = rawOffsets[0x40] ?? 3000;
    mineMask = rawOffsets[0x44] ?? 0;
    mineFuse = rawOffsets[0x48] ?? 2000;
    mineExplosionBias = rawOffsets[0x4c] ?? 0;
    mineExplosionPush = rawOffsets[0x50] ?? 100;
    pushPct = mineExplosionPush;
    damage = rawOffsets[0x54] ?? 0;
  } else if (isGun) {
    gunBullets = rawOffsets[0x3c] ?? 0;
    gunShotInterval = rawOffsets[0x40] ?? 0;
    gunSpread = rawOffsets[0x44] ?? 0;
    gunBurstSize = rawOffsets[0x48] ?? 0;
    gunBurstSpread = rawOffsets[0x4c] ?? 0;
    gunHits = rawOffsets[0x50] ?? 0;
    gunExplosionBias = rawOffsets[0x54] ?? 0;
    gunExplosionPush = rawOffsets[0x58] ?? 100;
    gunExplosionVariation = rawOffsets[0x60] ?? 0;
    gunImpactEffect = rawOffsets[0x64] ?? 0;
    pushPct = gunExplosionPush;
    damage = rawOffsets[0x5c] ?? 0;
  } else if (isArrow) {
    damage = rawOffsets[0x3c] ?? 0;
  }
  if (isStrike) {
    // Strike header. A strike keeps its plane sprite where other fire types
    // keep the fire method (`record.rs` STRIKE_PLANE); the munition body
    // (damage/push/gravity/...) was decoded above from the shifted slab,
    // exactly as for a missile.
    strikePlane = rawOffsets[0x38] ?? 0;
    strikeCount = rawOffsets[0x3c] ?? 0;
    strikeSpacing = rawOffsets[0x40] ?? 0;
    // `strike.munition_speed` is a fraction: raw / 100.
    strikeMunitionSpeed = (rawOffsets[0x44] ?? 0) / 100;
    strikePlaneSound = recNum(rawOffsets[0x48] ?? 0);
    strikeMunition = rawOffsets[0x4c] ?? 0;
  }
  // Special subtypes have their own per-subtype layouts; the .wep path keeps
  // the native record intact, and the fallback uses the donor.

  // Classify fireType & donor
  let fireType: FireType = 'power';
  let inferredDonor = 'bazooka';
  const summary: string[] = [];

  if (isGun) {
    fireType = 'hitscan';
    inferredDonor = gunBullets > 1 || gunSpread > 0 ? 'shotgun' : 'uzi';
    summary.push(`Identified Hitscan weapon (${inferredDonor} donor)`);
  } else if (isArrow) {
    fireType = 'arrow';
    inferredDonor = 'longbow';
    summary.push('Identified Arrow weapon (Longbow donor)');
  } else if (isSpray) {
    fireType = 'spray';
    inferredDonor = 'flame_thrower';
    summary.push('Identified Spray weapon (Flame Thrower donor)');
  } else if (isMine) {
    fireType = 'drop';
    inferredDonor = 'mine';
    summary.push('Identified Proximity Mine weapon (Mine donor)');
  } else if (isStrike) {
    fireType = 'cursor';
    inferredDonor = 'air_strike';
    summary.push('Identified Air Strike cursor weapon (Air Strike donor)');
  } else if (isSpecial) {
    fireType = 'special';
    inferredDonor = 'fire_punch';
    summary.push(`Identified Special weapon (subtype ${subtype}, Fire Punch panel donor)`);
  } else if (missileAction === 1) {
    if (homingKindRaw === 2) {
      inferredDonor = 'magic_bullet';
      summary.push('Identified Dodge Homing projectile (Magic Bullet donor)');
    } else {
      inferredDonor = 'homing_missile';
      summary.push('Identified Lock-on Homing missile (Homing Missile donor)');
    }
  } else if (burstRaw === 1) {
    inferredDonor = 'cluster_bomb';
    summary.push('Identified Cluster Bomb (Cluster Bomb donor)');
  } else if (fuseMs > 0) {
    if (bouncePct >= 60) {
      inferredDonor = 'banana_bomb';
      summary.push('Identified Bouncy Bomb (Banana Bomb donor)');
    } else {
      inferredDonor = 'grenade';
      summary.push('Identified Timed Grenade (Grenade donor)');
    }
  } else {
    inferredDonor = 'bazooka';
    summary.push('Identified Direct Ballistic Rocket (Bazooka donor)');
  }

  if (isMissile || isStrike) {
    summary.push(`Explosion power: ${damage}, push ${pushPct}%`);
    summary.push(`Gravity: ${gravityPct}%, Wind: ${windPct}%`);
    if (bouncePct > 0) summary.push(`Bounciness Boost: ${bouncePct}`);
    if (fuseMs > 0) summary.push(`Fuse Time: ${fuseMs}ms`);
    if (burstRaw === 1) {
      summary.push(`Clusters: ${clusterCount} bits, ${clusterSpread}° spread, ${cDamage} bit damage`);
    }
    if (explodeOnSpace) summary.push('Detonates on Space enabled');
    if (isStrike) summary.push(`Strike: ${strikeCount} munition(s)`);
  } else if (isGun) {
    summary.push(`Gun: ${gunBullets || 1} bullet(s), ${gunSpread}° spread, ${damage} damage`);
  } else if (isMine) {
    summary.push(`Mine: proximity ${mineProx}, arm ${mineArm}ms, fuse ${mineFuse}ms, ${damage} damage`);
  } else if (isArrow) {
    summary.push(`Arrow damage: ${damage}`);
  }

  let homingKind: HomingKind = 'off';
  if (homingKindRaw === 1) homingKind = 'lock';
  else if (homingKindRaw === 2) homingKind = 'dodge';

  let action: MissileAction = 'none';
  if (isMissile || isStrike) {
    action =
      missileAction === 1
        ? 'homing'
        : missileAction === 2
        ? 'bounce'
        : missileAction === 3
        ? 'roam'
        : missileAction === 4
        ? 'dig'
        : 'none';
  }

  let burst: BurstPayload = 'nothing';
  if (isMissile || isStrike) {
    burst = burstRaw === 1 ? 'clusters' : burstRaw === 2 ? 'fire' : 'nothing';
  }

  const recordOverrides: Record<string, any> = {};

  // Firing header (`fires.*`). `launch_power_pct` is the missile launch power;
  // 0 is the engine's "charged" sentinel, not "no power". `type`/`method` are
  // the family selectors and stay out of the model: the archetype owns them.
  if (isMissile) {
    recordOverrides['fires.launch_power_pct'] = rawOffsets[0x40] ?? 0;
  }
  recordOverrides['fires.creates_projectile'] = (rawOffsets[0x20] ?? 0) !== 0;

  // Family-specific native parameters. Each group belongs to one family or one
  // special subtype (`crates/weapons/src/record.rs`), so only the matching one
  // is decoded -- the others share the same offsets.
  if (isArrow) {
    recordOverrides['arrow.damage'] = rawOffsets[0x3c] ?? 0;
  }
  if (isSpecial) {
    if (subtype === 1) {
      recordOverrides['fire_punch.damage'] = rawOffsets[0x38] ?? 0;
      recordOverrides['fire_punch.knockback'] = (rawOffsets[0x40] ?? 0) / 10;
    } else if (subtype === 2) {
      recordOverrides['baseball_bat.damage'] = rawOffsets[0x38] ?? 0;
      recordOverrides['baseball_bat.knockback_scale'] = (rawOffsets[0x3c] ?? 0) / 10;
    } else if (subtype === 8) {
      recordOverrides['drill.duration_ms'] = rawOffsets[0x44] ?? 0;
    } else if (subtype === 12) {
      recordOverrides['parachute.wind_pct'] = rawOffsets[0x38] ?? 0;
    } else if (subtype === 19) {
      recordOverrides['utility.effect'] = UTILITY_EFFECTS[rawOffsets[0x3c] ?? 0] ?? 'low_gravity';
    } else if (subtype === 23) {
      recordOverrides['jet_pack.fuel'] = rawOffsets[0x38] ?? 0;
    }
  }

  if (isMissile || isStrike) {
    // Keep every decoded body value in the model. The generator compares
    // against `wepBaseline` and only writes the ones the user changes, so
    // decoding them here makes the editor faithful without rewriting the
    // imported `.wep`.
    recordOverrides['missile.explosion.push_pct'] = pushPct;
    recordOverrides['missile.explosion.bias'] = explosionBias;
    recordOverrides['missile.explosion.variation'] = explosionVariation;
    recordOverrides['missile.speed_pct'] = speedPct;
    recordOverrides['missile.random_motion'] = randomMotion;
    recordOverrides['missile.collision_shape'] = collisionShape;
    recordOverrides['missile.alarm_worms'] = alarmWorms;
    recordOverrides['missile.ends_on_contact'] = maskFromBits(endsOnContact);
    recordOverrides['missile.impact_particles'] = impactParticles;
    recordOverrides['missile.sprite'] = missileSprite;
    recordOverrides['missile.animation'] = missileAnimation;
    recordOverrides['missile.flight_sound'] = flightSound;
    recordOverrides['missile.launch_sound'] = launchSound;
    recordOverrides['missile.explosion_sound.enabled'] = explosionSoundEnabled;
    recordOverrides['missile.explosion_sound.sound'] = explosionSound;
    recordOverrides['missile.explosion_sound.before'] = explosionSoundBefore;
    recordOverrides['missile.explode_on_space'] = explodeOnSpace;
    if (trailSprite || trailPower || trailSpeed || trailBubbles) {
      recordOverrides['missile.trail.enabled'] = true;
      recordOverrides['missile.trail.sprite'] = trailSprite;
      recordOverrides['missile.trail.power'] = trailPower;
      recordOverrides['missile.trail.speed'] = trailSpeed;
      recordOverrides['missile.trail.bubbles_per_second'] = trailBubbles;
    }
    recordOverrides['missile.bounce.hits'] = maskFromBits(bounceHits);
    recordOverrides['missile.bounce.terrain_keep_speed_pct'] = bounceKeep;
    recordOverrides['missile.bounce.sound'] = bounceSound;
    recordOverrides['missile.bounce.contact_sides'] = bounceContactSides;
    recordOverrides['missile.bounce.extra_reverse_chance_pct'] = bounceExtraReverse;
    recordOverrides['missile.bounce.explosion.bias'] = bounceExplosionBias;
    recordOverrides['missile.bounce.explosion.push_pct'] = bounceExplosionPush;
    recordOverrides['missile.bounce.explosion.power'] = bounceExplosionPower;
    recordOverrides['missile.bounce.explosion.variation'] = bounceExplosionVariation;
    recordOverrides['missile.bounce.max_bounces'] = maxBounces;
    recordOverrides['missile.homing.sprite'] = homingSprite;
    recordOverrides['missile.homing.animation'] = homingAnimation;
    recordOverrides['missile.homing.trail.sprite'] = homingTrailSprite;
    recordOverrides['missile.homing.trail.power'] = homingTrailPower;
    recordOverrides['missile.homing.trail.speed'] = homingTrailSpeed;
    recordOverrides['missile.homing.trail.bubbles_per_second'] = homingTrailBubbles;
  }
  if (isMine) {
    recordOverrides['mine.detects'] = maskFromBits(mineMask);
    recordOverrides['mine.explosion.bias'] = mineExplosionBias;
    recordOverrides['mine.explosion.push_pct'] = mineExplosionPush;
  }
  if (isGun) {
    recordOverrides['gun.bullets'] = gunBullets;
    recordOverrides['gun.spread_deg'] = gunSpread;
    recordOverrides['gun.shot_interval_ms'] = gunShotInterval;
    recordOverrides['gun.burst_size'] = gunBurstSize;
    recordOverrides['gun.burst_spread_deg'] = gunBurstSpread;
    recordOverrides['gun.hits'] = maskFromBits(gunHits);
    recordOverrides['gun.explosion.bias'] = gunExplosionBias;
    recordOverrides['gun.explosion.push_pct'] = gunExplosionPush;
    recordOverrides['gun.explosion.variation'] = gunExplosionVariation;
    recordOverrides['gun.impact_effect'] = gunImpactEffect;
  }
  if (isStrike) {
    recordOverrides['strike.plane'] = strikePlane;
    recordOverrides['strike.count'] = strikeCount;
    recordOverrides['strike.spacing'] = strikeSpacing;
    recordOverrides['strike.munition_speed'] = strikeMunitionSpeed;
    recordOverrides['strike.plane_sound'] = strikePlaneSound;
    recordOverrides['strike.munition'] = strikeMunition;
  }
  if (shots > 0) recordOverrides['handling.shots'] = shots;
  if (retreat > 0) recordOverrides['handling.retreat'] = retreat;

  // The editor's own namespace is fixed: a decoded `.wep` becomes a `wfws.`
  // bundle, never one that could look like a mod it reads.
  const cleanId = withWfwsPrefix(weaponName);

  const projectState: Partial<WeaponProject> = {
    id: cleanId,
    name: weaponName,
    description: `Project X port of ${weaponName} for WormForge.`,
    slot: inferredDonor,
    based_on: inferredDonor,
    fireType,
    specialSubtype: subtype,
    panel_icon: inferredDonor,
    defaults: {
      ammo: 3,
      delay: 0,
      crateChance: 0,
      crateType: 'weapon',
      afterUse: retreat > 0 ? 'retreat' : 'end',
    },
    body: {
      sprite: isMine ? 'mine' : isGun ? 'uzi' : isMissile && fuseMs > 0 ? 'dynamite' : 'missile',
      damage,
      gravity_pct: gravityPct,
      wind_pct: windPct,
      bounce_pct: bouncePct,
      fuse: isMissile || isStrike ? fuseMs > 0 : false,
      fuse_time_ms: isMissile || isStrike ? fuseMs : 0,
      countdown_ms: isMissile || isStrike ? countdownMs : 0,
      homing: homingKind,
      // Only the active action's bytes are decoded, so a non-homing base gets
      // the editor's sensible homing defaults when the user switches action.
      // A real homing record keeps 0 (immediate steering / no duration).
      homing_arm_ms: missileAction === 1 ? homingArm : 1000,
      homing_time_ms: missileAction === 1 ? homingTime : 8000,
      cluster: (isMissile || isStrike) && burstRaw === 1,
      custom_cluster: false,
      custom_site: 'explode',
      proximity: mineProx,
      arm_delay_ms: mineArm,
      trigger_delay_ms: mineFuse,
      detect_mask: mineMask,
      clustlet: {
        sprite: spriteName(cSprite, CLUSTLET_SPRITE_NAMES) || 'clustlet',
        sprite_count: cSpriteCount,
        count: clusterCount,
        angle: clusterAngle,
        spread: clusterSpread,
        power: clusterPower,
        power_variation: clusterPowerVariation,
        damage: cDamage,
        trail: cTrail,
        contact: cAction === 2 ? 'bounce' : 'impact',
        bounce_explode: cBounceExplode,
        bounce_power: cBouncePower,
        bounces: cBounces,
        fuse: cFuse,
        proximity: 0,
        homing: cAction === 1 ? (cHomingKind === 2 ? 'dodge' : 'lock') : 'off',
        homing_arm_ms: cAction === 1 ? cHomingArm : 1000,
        homing_time_ms: cAction === 1 ? cHomingTime : 8000,
        gravity_pct: cGravityPct,
        wind_pct: cWindPct,
        bounciness: cBouncePct,
        bit_action: cBitAction,
        roam: cRoam,
        dig: cDig,
        animation: cAnimation,
        trail_power: cTrailPower,
        trail_speed: cTrailSpeed,
        trail_bubbles: cTrailBubbles,
        speed_pct: cSpeedPct,
        countdown_ms: cCountdown,
        flight_sound: cFlightSound,
        explosion_sound_enabled: cExplosionSoundEnabled,
        explosion_sound: cExplosionSound,
        explosion_sound_before: cExplosionSoundBefore,
        explode_on_space: cExplodeOnSpace,
        ends_on_contact: maskFromBits(cEndsOnContact),
        explosion_bias: cExplosionBias,
        explosion_push_pct: cExplosionPush,
        explosion_variation: cExplosionVariation,
        bounce_hits: maskFromBits(cBounceHits),
        bounce_terrain_keep_speed_pct: cBounceKeep,
        bounce_sound: cBounceSound,
        bounce_contact_sides: cBounceContactSides,
        bounce_extra_reverse_chance_pct: cBounceExtraReverse,
        bounce_explosion_bias: cBounceExplosionBias,
        bounce_explosion_push_pct: cBounceExplosionPush,
        bounce_explosion_variation: cBounceExplosionVariation,
        homing_sprite: cHomingSprite,
        homing_animation: cHomingAnimation,
        homing_trail_sprite: cHomingTrailSprite,
        homing_trail_power: cHomingTrailPower,
        homing_trail_speed: cHomingTrailSpeed,
        homing_trail_bubbles: cHomingTrailBubbles,
      },
    },
    action,
    burst,
    digConfig:
      action === 'dig'
        ? {
            sound: digSound,
            dive_sprite: digDiveSprite,
            sprite_1: digSprite1,
            sprite_2: digSprite2,
            sprite_3: digSprite3,
          }
        : undefined,
    roamConfig:
      action === 'roam'
        ? {
            walk_speed: roamWalkSpeed,
            step_height: roamStepHeight,
            terrain_offset: roamTerrainOffset,
            edge_jump_angle_deg: roamEdgeAngle,
            edge_jump_speed: roamEdgeSpeed,
            edge_jump_sound: roamEdgeSound,
            jump_angle_deg: roamJumpAngle,
            jump_speed: roamJumpSpeed,
            jump_sound: roamJumpSound,
            gas_start_delay_ms: roamGasStart,
            gas_poison_power: roamGasPoison,
            gas_animal_sprite: roamGasSprite,
            flight_1: roamFlight1,
            flight_2: roamFlight2,
            hits: maskFromBits(roamHits),
            flight_hits: maskFromBits(roamFlightHits),
          }
        : undefined,
    enableCustomLua: false,
    missileSprite: {
      enabled: false,
      mode: 'stock',
      stockSprite: inferredDonor,
      sheet: '',
      anim: 'rotation',
      frames: 1,
      fps: 15,
      animSpeed: 1.0,
      spinRate: 1.0,
      scale: 1.0,
      mirror: true,
      z: 5.0,
      animate: false,
      spin: false,
      hideStock: false,
    },
    recordOverrides,
  };

  return {
    success: true,
    name: weaponName,
    fireType,
    inferredDonor,
    rawOffsets,
    projectState,
    summary,
  };
}
