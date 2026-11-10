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

export type MissileAnimType = 'track' | 'rotation' | 'slow' | 'medium' | 'fast' | 'none';

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
  roamConfig: RoamActionConfig;
  digConfig: DigActionConfig;
  fireConfig: FirePayloadConfig;
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
