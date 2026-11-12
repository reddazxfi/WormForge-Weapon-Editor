export type FireType = 'power' | 'hitscan' | 'drop' | 'cursor' | 'special' | 'arrow' | 'spray';

export type MissileAction = 'none' | 'homing' | 'bounce' | 'roam' | 'dig';
export type BurstPayload = 'nothing' | 'clusters' | 'fire';
export type HomingKind = 'off' | 'lock' | 'dodge' | 'avoid';
export type HandType = 'lower' | 'mid' | 'upper';
export type CrateType = 'weapon' | 'utility' | 'super';
export type AfterUseOption = '' | 'end' | 'retreat' | 'continue';

export interface CollisionMask {
  land?: boolean;
  worms?: boolean;
  worms_normal?: boolean;
  worms_acting?: boolean;
  worms_jumping?: boolean;
  worms_roping?: boolean;
  worms_frozen?: boolean;
  worms_frozen_moving?: boolean;
  canisters?: boolean;
  mines?: boolean;
  crates?: boolean;
  donor_cards?: boolean;
  graves?: boolean;
  missiles?: boolean;
  arrows?: boolean;
  objects?: boolean;
  water?: boolean;
  extra_bits?: number;
}

/**
 * The cluster child is a full missile body (`clusters.bit.*`), not just a
 * damage number.  Its fields mirror the primary missile body, including the
 * action-specific bounce/homing groups and the ejection parameters.
 */
export interface ClustletConfig {
  sprite: string;
  sprite_count: number;
  count: number;
  angle: number;
  spread: number;
  power: number;
  power_variation: number;
  damage: number;
  trail: string;
  contact: 'impact' | 'bounce';
  bounce_explode: boolean;
  bounce_power: number;
  bounces: number;
  fuse: number;
  proximity: number;
  homing: 'off' | 'lock' | 'dodge';
  homing_arm_ms: number;
  homing_time_ms: number;
  gravity_pct: number;
  wind_pct: number;
  bounciness: number;

  /** The child's full action (`clusters.bit.action`). */
  bit_action?: 'none' | 'bounce' | 'homing' | 'roam' | 'dig';
  /** Roaming child body, when `bit_action === 'roam'`. */
  roam?: RoamActionConfig;
  /** Digging child body, when `bit_action === 'dig'`. */
  dig?: DigActionConfig;

  // Body fields shared by every child action.
  animation?: number;
  trail_power?: number;
  trail_speed?: number;
  trail_bubbles?: number;
  speed_pct?: number;
  countdown_ms?: number;
  flight_sound?: number;
  explosion_sound_enabled?: boolean;
  explosion_sound?: number;
  explosion_sound_before?: number;
  explode_on_space?: boolean;
  ends_on_contact?: CollisionMask;
  explosion_bias?: number;
  explosion_push_pct?: number;
  explosion_variation?: number;

  // Bounce action (`clusters.bit.bounce.*`).
  bounce_hits?: CollisionMask;
  bounce_terrain_keep_speed_pct?: number;
  bounce_sound?: number;
  bounce_contact_sides?: number;
  bounce_extra_reverse_chance_pct?: number;
  bounce_explosion_bias?: number;
  bounce_explosion_push_pct?: number;
  bounce_explosion_variation?: number;

  // Homing action (`clusters.bit.homing.*`).
  homing_sprite?: number;
  homing_animation?: number;
  homing_trail_sprite?: number;
  homing_trail_power?: number;
  homing_trail_speed?: number;
  homing_trail_bubbles?: number;
}

export interface BodyConfig {
  sprite: string;
  damage: number;
  gravity_pct: number;
  wind_pct: number;
  bounce_pct: number;
  fuse: boolean;
  fuse_time_ms: number;
  /** Native `countdown` timer (0x88), independent of `fuse` (0x8C). */
  countdown_ms: number;
  homing: HomingKind;
  homing_arm_ms: number;
  homing_time_ms: number;
  cluster: boolean;
  custom_cluster: boolean;
  custom_site: 'explode' | 'launch';
  proximity: number;
  arm_delay_ms: number;
  trigger_delay_ms: number;
  detect_mask: number;
  clustlet: ClustletConfig;
}

export interface HoldConfig {
  enabled: boolean;
  sheet: string;
  sheetFile?: File;
  sheetPreview?: string;
  handType: HandType;
  handRadius: number;
  weapRadius: number;
  weapRotation: number;
  scale: number;
  handScale: number;
  frames: number;
  fps: number;
  animate: boolean;
  drawHand: boolean;
  keepWhileFiring: boolean;
  thrown: boolean;
  putAway: boolean;
  handRad: number;
  handRadLower: number;
  handRadUpper: number;
}

export interface WeaponDefaults {
  ammo: number; // -1 for infinite
  delay: number;
  crateChance: number;
  crateType: CrateType;
  afterUse: AfterUseOption;
}

export interface CustomSpriteAsset {
  purpose: 'missile' | 'clustlet' | 'hold' | 'trail' | 'icon' | 'plane';
  name: string;
  path: string;
  file?: File;
  previewUrl: string;
  frames: number;
  fps: number;
  play: 'loop' | 'pingpong';
}

/**
 * Native record art that also accepts a pack-relative image during weapon
 * installation (weapon-records.md, "Sprites and other declarations"): the
 * weapon's own body sheet (`sprite`, the only art path for an air strike's
 * munition), `missile.trail.sprite`, `cluster.sprite`,
 * `cluster.homing_sprite` and `clusters.bit.trail.sprite`. Unlike
 * `CustomSpriteAsset`, the bundle path is derived at export time from the
 * weapon id, so renaming the weapon cannot leave the declaration pointing at
 * an old folder.
 */
export type PackArtSlot =
  | 'missile_trail'
  | 'cluster_sprite'
  | 'cluster_homing_sprite'
  | 'cluster_trail'
  | 'strike_sprite';

export interface PackArtAsset {
  file?: File;
  fileName?: string;
  previewUrl?: string;
  /** Vertical PNG frames, declared in mod.toml `[sprites."path"]`. */
  frames: number;
  fps: number;
  play: 'loop' | 'once' | 'pingpong';
  /** The untouched upload, kept so a rotation sheet can be rebuilt. */
  sourceFile?: File;
  sourceName?: string;
  /** Frames of the generated rotation sheet; unset for a plain upload. */
  rotationFrames?: number;
}

/**
 * The effects SDK's ribbon trail (`wf-lib/effects/trail`), attached to a weapon's
 * own projectile. Unlike `missile.trail.*` (the native stock particle trail this
 * record inherits), this is drawn by Lua from sampled positions, so its colour,
 * widths and length are free.
 */
/**
 * One sheet the engine installs as a WA sprite for a roaming animal. WA picks
 * between the two fields and rotates the flying art itself, so a sheet is a
 * rotation strip: one cell per direction (`frames` in mod.toml slices them).
 */
export interface RoamSheetAsset {
  file?: File;
  fileName?: string;
  preview?: string;
  /** Vertical frames in the sheet (32 = a full turn, WA's `airmisl` order). */
  frames?: number;
  /** Set when the app baked the rotation strip from `sourceFile`. */
  rotationFrames?: number;
  /** The single frame a rotation sheet was built from, for "use original". */
  sourceFile?: File;
  sourceName?: string;
}

/**
 * The two flying sheets a roaming animal alternates while it is steered
 * (`sheep_sprites`, written to the record's `sheep.flight_1` / `sheep.flight_2`).
 * WA draws the walking pose from the record body and the gas pose from
 * `roam.gas.animal_sprite`, so those stay record fields.
 */
export interface RoamSheetsConfig {
  flight1: RoamSheetAsset;
  flight2: RoamSheetAsset;
}

export interface RibbonTrailConfig {
  enabled: boolean;
  /** Points kept behind the round (`max`). */
  max: number;
  /** Sample a point every N game frames (`every`). */
  every: number;
  /** Driver frames between shed points while fading (`vanish`). */
  vanish: number;
  /** Core ribbon width in pixels (`core_w`). */
  coreWidth: number;
  /** Glow pass width in pixels (`glow_w`); 0 draws the core only. */
  glowWidth: number;
  /** Hex colour, e.g. `#ff8800` (`r`, `g`, `b`). */
  color: string;
  /** Attach to the primary round only, or to its cluster bits as well. */
  target: 'main' | 'all';
}

/**
 * The effects SDK's `px_effects` burst: PX's electric-explosion ring plus its
 * squashed lens, drawn for a fixed number of game frames.
 */
export type ExplosionPreset = 'electric' | 'pyro' | 'ember';

/**
 * `effect` keeps WA's own blast and draws the burst on top of it (an `on_explode`
 * hook); `blast` silences WA's blast and runs the SDK's custom explosion.
 */
export type ExplosionMode = 'effect' | 'blast';

/**
 * A WAV uploaded into the bundle and played by path. WA's record sound fields
 * take native sample ids only, so a custom sound is declared in the claim's
 * `sounds` list and played with `wa.sound.play(target, path, priority)`.
 */
export interface CustomSoundAsset {
  file?: File;
  fileName?: string;
  /** Object URL for the UI's `<audio>` preview. */
  previewUrl?: string;
  /** Bytes, shown in the UI as a sanity check (the engine caps a WAV at 32 MiB). */
  size?: number;
}

/**
 * Custom pack WAVs. `explosion` plays once from the claim's `on_explode`; the
 * `interval` sound plays while the round flies, from `wa.on.missile_frame`.
 * WormForge resolves the paths from this bundle at load (`sounds = {...}`).
 */
export interface CustomSoundsConfig {
  explosionEnabled: boolean;
  explosion?: CustomSoundAsset;
  /** One WAV per shot of a `fire_seq` burst (`on_shot`). */
  shotEnabled: boolean;
  shot?: CustomSoundAsset;
  /** Play on every Nth shot; 1 is every shot. */
  shotEvery: number;
  shotPriority: number;
  /** Higher priorities replace lower ones in a full voice pool. */
  explosionPriority: number;
  intervalEnabled: boolean;
  interval?: CustomSoundAsset;
  /** Game frames between plays, from the UI's milliseconds at 50 Hz. */
  intervalMs: number;
  /** Delay before the first play, in milliseconds. */
  intervalDelayMs: number;
  /** Plays before it stops; 0 keeps it going for the whole flight. */
  intervalLimit: number;
  intervalPriority: number;
}

/**
 * `wf-lib/fire_seq` (`px.fire_seq`): one `on_fire` fires a burst. The first shot
 * leaves immediately; a hidden timer actor fires the rest `delay` frames apart
 * and holds WA's shot counters, so the worm stays in its firing pose.
 */
export interface FireSequenceConfig {
  enabled: boolean;
  /** Real WA missiles (`fire_seq_mis`) or Lua actors (`fire_sequential_actor`). */
  mode: 'missiles' | 'actors';
  /** Total shots per trigger pull, the first one included. */
  count: number;
  /** Frames between shots (50 Hz). */
  delay: number;
  /** Launch speed in px/frame along the worm's aim. */
  speed: number;
  /** Pixels along each shot's velocity, so it does not start inside the worm. */
  standoff: number;
  /** Random velocity jitter, ± per axis. */
  spreadX: number;
  spreadY: number;
  /** Spawn offset from the worm, in pixels. */
  offsetX: number;
  offsetY: number;
  /** Read aim again for every shot (functions of `(i, w)`) instead of locking it. */
  liveAim: boolean;
  /** End the burst when the worm stops holding this weapon. */
  cancelOnWeaponChange: boolean;
  /** `fires = { subtype = 4 }`: WA's repeat-fire pose, so the worm keeps aiming. */
  repeatFirePose: boolean;
  /** Actors mode: the spawned sheet and its physics. */
  actorSprite: string;
  actorGravity: boolean;
  actorCollide: boolean;
  actorPersist: boolean;
}

export interface ExplosionEffectConfig {
  enabled: boolean;
  mode: ExplosionMode;
  /** Custom-explosion fields, used by `blast` mode only. */
  damage: number;
  push: number;
  /** Crater radius; 0 leaves the terrain alone. */
  hole: number;
  /** `default` is PX's random 69-71 blast, `none` is silent, a number is a WA id. */
  sound: 'default' | 'none' | number;
  /** Shape/colour preset the numbers below started from. */
  preset: ExplosionPreset | 'custom';
  /** Ring radius in game pixels. */
  radius: number;
  color: string;
  /** Beam half-width of both passes (`thickness`). */
  thickness: number;
  noise: number;
  /** Frames the envelope takes to fade (`duration`). */
  duration: number;
  /** Envelope lost per frame (`fade`). */
  fade: number;
  /** Radius growth over the whole envelope (`grow`). */
  grow: number;
  /** Frames the effect exists at all (`live`). */
  live: number;
  /** Points around the ring; 0 derives them from the radius. */
  segments: number;
  ellipseX: number;
  ellipseY: number;
  /** Re-noise and recolour halfway through, as the electric explosion does. */
  rebuffer: boolean;
  smoke: boolean;
}

export type MissileAnimType = 'track' | 'rotation' | 'slow' | 'medium' | 'fast' | 'none';

/**
 * One extra role the WFWS builder draws. The primary round keeps its own
 * `MissileSpriteConfig` (it also owns the preview canvas); cluster bits and
 * per-behaviour art use this smaller shape.
 *
 * `native` hands the missile back to WA, `builder` draws this sheet, and
 * `inherit` reuses the identity art already in force (the parent round for a
 * bit, the identity art for a behaviour).
 */
export interface FlightRoleArt {
  mode: 'native' | 'builder' | 'inherit';
  sheetFile?: File;
  sheetPreview?: string;
  anim: MissileAnimType;
  frames: number;
  fps: number;
  animSpeed: number;
  spinRate: number;
  scale: number;
  mirror: boolean;
  z: number;
}

/**
 * Flight states a missile moves in and out of. `homing` and `homing_bit` are
 * separate so a bit can get its own art; `dig`, `roam_flight` and `gas` read
 * their sentinel ids from the record's own sprite fields.
 */
export type BehaviorArtKey = 'homing' | 'homing_bit' | 'dig' | 'roam_flight' | 'gas';

export interface MissileSpriteConfig {
  enabled: boolean;
  mode: 'stock' | 'custom';
  stockSprite: string;
  sheet: string;
  sheetFile?: File;
  sheetPreview?: string;
  anim: MissileAnimType;
  frames: number;
  fps: number;
  animSpeed: number;
  spinRate: number;
  scale: number;
  mirror: boolean;
  z: number;
  animate: boolean;
  spin: boolean;
  hideStock: boolean;
  /**
   * Weapon-wide builder parameters (PX's sprite builder has no equivalent):
   * one scale multiplier for every role's sheet -- primary, bits, states --
   * and a rotation offset in degrees for art that does not point up. Emitted
   * as `size` / `angle` on the `sb.flight` call.
   */
  size?: number;
  angle?: number;
  /** Emit `log = true` in `sb.flight`: one log line per missile's first
   *  frames with what the identity test saw. A debugging aid. */
  logIdentity?: boolean;
}

export interface RoamActionConfig {
  walk_speed: number;
  step_height: number;
  terrain_offset: number;
  edge_jump_angle_deg: number;
  edge_jump_speed: number;
  edge_jump_sound: number;
  jump_angle_deg: number;
  jump_speed: number;
  jump_sound: number;
  gas_start_delay_ms: number;
  gas_poison_power: number;
  gas_animal_sprite: number;
  flight_1: number;
  flight_2: number;
  hits: CollisionMask;
  flight_hits: CollisionMask;
}

export interface DigActionConfig {
  sound: number;
  dive_sprite: number;
  sprite_1: number;
  sprite_2: number;
  sprite_3: number;
}

export interface FirePayloadConfig {
  spread_delay_ms: number;
  burn_time_ms: number;
  spread_generations: number;
  decay_mode: 'resting' | 'on_hit';
}

/**
 * The editor model as it was decoded from an imported `.wep`. When the project
 * uses the `.wep` file, fields still equal to this baseline are not emitted:
 * the file stays the source of truth, and only actual edits become named
 * overrides. See `luaGenerator.ts`.
 */
export interface WepBaseline {
  body: BodyConfig;
  action: MissileAction;
  burst: BurstPayload;
  recordOverrides: Record<string, any>;
  missileSprite: MissileSpriteConfig;
  roamConfig: RoamActionConfig;
  digConfig: DigActionConfig;
  fireConfig: FirePayloadConfig;
  specialSubtype: number;
}

export interface WeaponProject {
  id: string; // e.g. "my_pack.heavy_bazooka"
  name: string;
  description: string;
  version: string;
  author: string;
  slot: string; // panel replacement slot e.g. "bazooka"
  based_on: string; // donor weapon e.g. "stock.bazooka"
  fireType: FireType;
  specialSubtype: number;
  teleport: boolean;
  panel_icon: string; // stock name or custom path
  customIconFile?: File;
  customIconPreview?: string;
  defaults: WeaponDefaults;
  body: BodyConfig;
  action: MissileAction; // Single mutually exclusive missile action: none | bounce | homing | roam | dig
  burst: BurstPayload; // Single payload: nothing | clusters | fire
  missileSprite: MissileSpriteConfig;
  /** Cluster-bit art: native WA sheet, the WFWS builder, or the primary art. */
  bitFlight: FlightRoleArt;
  /** Per-behaviour art for the WFWS builder, keyed by the state it matches. */
  behaviorArt: Partial<Record<BehaviorArtKey, FlightRoleArt>>;
  roamConfig: RoamActionConfig;
  /** The roaming animal's two flying sheets (`sheep_sprites`). Optional so an
   *  older saved project (or a scratch script) needs no migration. */
  roamSheets?: RoamSheetsConfig;
  digConfig: DigActionConfig;
  fireConfig: FirePayloadConfig;
  /** Effects-SDK ribbon trail for this weapon's projectile. */
  ribbonTrail: RibbonTrailConfig;
  /** Effects-SDK explosion burst, added to or replacing WA's own blast. */
  explosionEffect: ExplosionEffectConfig;
  /** `wf-lib/fire_seq` burst from one `on_fire`. Optional for older projects. */
  fireSequence?: FireSequenceConfig;
  /** Uploaded WAVs played with `wa.sound.play` (blast and flight interval). */
  customSounds: CustomSoundsConfig;
  /** Extra library bundles (`effects.sdk`, …) the exported mod.toml depends on. */
  extraDependencies: string[];
  hold: HoldConfig;
  /** Uploaded PNG/GIF art for the record fields that accept pack paths. */
  packArt: Partial<Record<PackArtSlot, PackArtAsset>>;
  customSprites: Record<string, CustomSpriteAsset>;
  // Arbitrary named record overrides (e.g. "missile.explosion.push_pct": 120)
  recordOverrides: Record<string, any>;
  // Custom Lua toggle and code additions (e.g. on_explode callback)
  enableCustomLua: boolean;
  customLuaSnippet?: string;
  // Imported Project X `.wep`. `wep` and `copy_from` are mutually exclusive;
  // when `useWepFile` is true the generator emits `wep = "weps/<file>.wep"`
  // and the exporter copies the original file into the bundle.
  /**
   * Record tables read from another bundle's Lua, emitted verbatim over the
   * base record (a bundled `.wep` or the donor). The engine's own key names, so
   * a foreign record round-trips before the typed fields know every key.
   */
  recordExtra?: Record<string, unknown>;
  useWepFile?: boolean;
  wepFile?: File;
  wepFileName?: string;
  wepBaseline?: WepBaseline;
}

export interface SimulationWorm {
  x: number;
  y: number;
  aimAngleDeg: number; // 0 to 180 (or -90 to +90)
  facing: 1 | -1;
  powerPct: number; // 0 to 100
}

export interface SimulationParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  type: 'smoke' | 'fire' | 'spark' | 'bubble';
}

export interface SimulationProjectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isClustlet: boolean;
  color: string;
  fuseRemainingMs: number;
  bouncesRemaining: number;
  active: boolean;
  homingTarget?: { x: number; y: number };
  homingState?: 'drift' | 'homing';
  homingTimerMs?: number;
}
