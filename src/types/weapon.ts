export type FireType =
  | 'power'
  | 'hitscan'
  | 'drop'
  | 'cursor'
  | 'special'
  | 'arrow'
  | 'spray'
  | 'melee';

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

/**
 * The aiming clip (`project.aimClip`), see `src/data/aimClip.ts`. It is the
 * data behind `sb.hold`'s `swing`: keyframes over 50 Hz ticks that a Space press
 * plays on the held art, on top of whatever pose the engine's aim maths gives.
 */
import type { AimClipConfig } from '../data/aimClip';

export type { AimClipConfig, AimClipKey, ClipEase } from '../data/aimClip';

export interface HoldConfig {
  enabled: boolean;
  sheet: string;
  sheetFile?: File;
  sheetPreview?: string;
  /** Pixel size of the uploaded hold image; the aim layer needs the cell. */
  sheetWidth?: number;
  sheetHeight?: number;
  /**
   * Firing-state sprite (`hold.flash`): drawn over the worm on WA's firing
   * states, at the gun's muzzle. `flashFrames` is its lifetime in 50 Hz ticks
   * (`frames` + 1 on screen), while `flashOut`/`flashSide`/`flashScale` are
   * relative to the weapon's own pivot, rotation, and scale (`weap_scale`).
   */
  flashFile?: File;
  flashPreview?: string;
  flashWidth?: number;
  flashHeight?: number;
  flashFrames?: number;
  flashOut?: number;
  flashSide?: number;
  flashScale?: number;
  handType: HandType;
  handRadius: number;
  weapRadius: number;
  weapRotation: number;
  /**
   * Where around the worm the art hangs, in turns of PI: the engine places the
   * weapon at `rot + PI * weap_radial_rotation` and the hand at
   * `rot - PI * hand_radial_rotation` (`worm_hold.rs`). 1 is the baseline both
   * the editor used to write and PX's own weapons mostly use, and 0 puts the
   * arm on the other side of the worm, which is why a hold can carry a negative
   * `weapRadius` and still point forward. PX ships 0.5, 0.22 and 0, so an
   * import that dropped these moved the art a half turn.
   */
  weapRadialRotation?: number;
  handRadialRotation?: number;
  scale: number;
  handScale: number;
  frames: number;
  /**
   * Cells in the hold picture, when they are not what the hold plays.
   *
   * The engine slices the PNG by the `[sprites]` declaration (`gpu_frame`) and
   * uses `frames` only to pick an index (`(phase * frames) as u32`), so a
   * 20-frame strip held as a single frame is `frames = 1` over a 20-cell sheet,
   * which is exactly what Project X's Buffalo of Lies does: the animal in hand is
   * frame 0 of its run cycle and the charging actors walk the strip themselves.
   * The editor's own uploads hold one picture per play frame, so the two numbers
   * agree and this stays unset; only an import can tell them apart.
   */
  sheetFrames?: number;
  fps: number;
  animate: boolean;
  drawHand: boolean;
  keepWhileFiring: boolean;
  thrown: boolean;
  putAway: boolean;
  handRad: number;
  handRadLower: number;
  handRadUpper: number;
  /**
   * Extra hand rotation in degrees, on top of the engine's `hand_rotation = 1`
   * (a half turn). `HoldSpec` has the field, so this one needs no quad layer.
   */
  handRotation?: number;
  /**
   * The hand art nudged inside its own cell, in sheet pixels, scaled with
   * `hand_scale` (the hand's counterpart of `offsetX/offsetY`). `HoldSpec` has
   * no hand offset, so a non-zero value also forces `sb.hold`'s quad layer.
   */
  handOffsetX?: number;
  handOffsetY?: number;
  /**
   * Geometry for the firing sheet, when it should differ from the held art.
   * Unset (the default) means "the same as the aiming art", which is what PX's
   * FAMAS sheet relies on; the Firing tab's Copy button snapshots the aim
   * numbers here so they can be changed without touching the aim pose.
   */
  fireWeapRadius?: number;
  fireWeapRotation?: number;
  fireScale?: number;
  /**
   * The firing sheet nudged inside its own cell, in sheet pixels, scaled with
   * `fireScale`: the role's counterpart of `offsetX/offsetY`. The firing role
   * is always drawn by the quad layer, so it costs nothing extra.
   */
  fireOffsetX?: number;
  fireOffsetY?: number;
  /**
   * The firing sheet's own hand, the counterpart of `handRadius` /
   * `handRotation` / `handScale` / `handOffsetX/Y`. The layer draws the hand on
   * WA's firing frames from the role's own table, so a sheet whose grip differs
   * from the held art can move it without moving the aiming hand. Unset means
   * "the aim hand", which is the usual case.
   */
  fireHandRadius?: number;
  fireHandRotation?: number;
  fireHandScale?: number;
  fireHandOffsetX?: number;
  fireHandOffsetY?: number;
  /** Keep the hand on the firing frames, or hide it for this sheet only. */
  fireDrawHand?: boolean;
  /**
   * The firing sheet's own strip: how many frames it holds and the rate they
   * play at. The engine auto-slices a vertical PNG whose height divides by its
   * width, so a 36x72 upload is two 36x36 frames; the upload sets this from the
   * image, and the layer walks it on the 50 Hz clock.
   */
  fireFrames?: number;
  fireFps?: number;
  /**
   * How long the firing sheet stays up, in 50 Hz ticks, counted from the first
   * of WA's two firing frames. WA's own firing states are two frames, so 0
   * means "only WA's frames" (a one-frame flash); a longer window is what lets
   * a multi-frame firing animation actually play. A gap of more than one frame
   * between two firing states is a new shot and restarts the strip.
   */
  fireTicks?: number;
  /**
   * Hide the held weapon while the firing sheet shows. `keep_firing` otherwise
   * fills WA's firing frames with the held art, and `keep_while_firing` makes
   * the engine draw it there, so without this the gun sits under the firing
   * sheet.
   */
  fireHideMain?: boolean;
  /**
   * The held art nudged inside its own cell, in sheet pixels, scaled with
   * `weap_scale` (the aim counterpart of `MissileSpriteConfig.offsetX/Y`).
   * The engine's `HoldSpec` has no offset, so a non-zero value moves the hold
   * to `sb.hold`'s quad layer: the engine is pointed at a 1x1 silent sheet
   * while the quads draw and gets everything else (walking, put-away, the
   * fire pose) back.
   */
  offsetX?: number;
  offsetY?: number;
  /**
   * A second hand on the weapon: a rifle's support hand on the foregrip, the
   * off hand on a two-handed blade. `HoldSpec` has exactly one hand slot, so
   * this one is drawn by `sb.hold`'s quad layer with the engine's own hand
   * maths (`rot - PI*radial_rotation`, rotation `rot + PI*rotation`), its own
   * radius, scale and cell nudge. With no sheet of its own it reuses the first
   * hand's art, which is the usual case (PX's `PX_HANDS` sheet).
   */
  extraHand?: ExtraHandConfig;
  /**
   * Keep the aim inside a sane part of WA's 180 degree sweep (`aim_clamp` in the
   * `sb.hold` spec). Straight up and straight down are where a swing looks
   * worst: the held art leaves its cell and a cut fired vertically reads as
   * noise, which is why WA's own bat pipes its aim. `up`/`down` are degrees
   * either side of level (0.5), so `up = 60` reaches 60 degrees above level.
   *
   * `worm.aim` and `worm.aim_target` are read-only, but `worm:input{ aim }` writes
   * the same target WA's own aim control writes, so the layer writes the clamped
   * aim every frame (one native write, only while out of range): the crosshair,
   * the swing, a melee strike and WA's own fire vector all stop at the limit.
   * WA adds at most one of its own aim steps (180/128 of a degree) after the
   * write, and the draw the layer paints is clamped exactly.
   */
  aimClamp?: AimClampConfig;
}

export interface AimClampConfig {
  enabled: boolean;
  /** Degrees above level the art may be drawn at, 0 to 90. */
  up: number;
  /** Degrees below level, 0 to 90. */
  down: number;
}

/** How the strike throws its victim. */
export type MeleePushMode = 'aim' | 'fixed';

/** The hit kind the strike hands to `worm:hurt`. */
export type MeleeKind = 'normal' | 'taze';

/**
 * One strike of a melee swing. A swing can land several (a three-hit combo), each
 * on its own tick of the clip, with its own damage and throw. The box is the same
 * for every hit: reach, arc and side are the weapon's.
 */
export interface MeleeHit {
  /** 50 Hz tick of the swing; `0` lands on the press itself. */
  frame: number;
  damage: number;
  /** Throw along the aim, in WA's hurt speed (px/frame). */
  power: number;
  /** Upward lift on top of the throw (px/frame, positive is up). */
  lift: number;
  /** The literal throw, in `fixed` push mode only. Unset: the weapon's own. */
  vx?: number;
  vy?: number;
  /**
   * This strike's own sound, where it lands. Unset plays the weapon's
   * `hitSound`, which is what a combo whose strikes sound alike needs; a lighter
   * first strike is the reason the row exists: the claim eats WA's fire, so the
   * swing is heard only through these.
   */
  sound?: MeleeSound;
}

/**
 * A strike's sound: one of WA's own sample ids, or an uploaded PCM WAV that wins
 * over it (the same rule as the firing art's `fireDrawHand ?? drawHand`). A WAV
 * is played by bundle path, declared in the claim's `sounds` list, and needs no
 * stock sample slot.
 */
export interface MeleeSound {
  /** Native WA sample id, `0` for silent. Ignored while a file is set. */
  id: number;
  /** Uploaded WAV, played by path instead of `id`. */
  file?: CustomSoundAsset;
  /** Voice priority (4 quiet, 8 the engine default, 10 loud, 16 lead). */
  priority: number;
}

export interface MeleeConfig {
  enabled: boolean;
  /** Reach along the weapon, in px from the worm's body. */
  radius: number;
  /** Half-width across that reach, in px: the swing's arc. */
  width: number;
  /**
   * Scan along the drawn swing angle at the hit frame instead of the aim pose.
   * A cut through an arc then sweeps the box with the art, which is what makes
   * an overhead swing reach an overhead worm.
   */
  followSwing: boolean;
  /**
   * The strikes, in the order they land (the SDK sorts them by frame). Empty or
   * unset means the single hit described by `hitFrame` / `damage` / `pushPower`
   * / `lift`, which is also what this file wrote before combos existed: a weapon
   * that never touches the table exports exactly what it used to.
   */
  hits?: MeleeHit[];
  /** 50 Hz ticks after the Space press at which the box lands. */
  hitFrame: number;
  damage: number;
  kind: MeleeKind;
  /** `aim` throws away from the worm along the weapon, `fixed` uses vx/vy. */
  pushMode: MeleePushMode;
  /** `aim` mode: the shove, in px per frame (WA's `hurt` speed). */
  pushPower: number;
  /** `fixed` mode: the literal `hurt` speed. */
  pushVx: number;
  pushVy: number;
  /** Upward lift added to either mode, in px per frame (positive = up). */
  lift: number;
  /**
   * Played where a strike lands (`wa.sound.play` at the first worm it took), and
   * the whiff played at the striker when it takes nobody: a swing that comes off
   * the art is heard at all only because the claim eats WA's fire, so the
   * record's own sound never plays.
   */
  hitSound: MeleeSound;
  /** WA's whiff is 96, the grenade throw and the bat's miss. */
  missSound: MeleeSound;
  /** Hit each worm once per swing, not once per frame the box is live. */
  oncePerTarget: boolean;
  /** Leave the firing worm out of its own strike. */
  spareShooter: boolean;
  /**
   * Print the swing and the strike to the log (`wa.log`): the hit tick, the scan
   * vector, and every worm the box took. It is the only way to tell a swing that
   * never started from one that started and tested nothing.
   */
  log: boolean;
}

export interface ExtraHandConfig {
  enabled: boolean;
  /** Uploaded art for the second hand; unset reuses the first hand's sheet. */
  file?: File;
  preview?: string;
  /** The uploaded sheet's pixel size, so the quad layer knows its cell. */
  sheetWidth?: number;
  sheetHeight?: number;
  /** Distance from the worm along its aim, in px (`hand_radius`). */
  radius: number;
  /** Degrees; the generator writes `1 + deg/180`, the engine's turn unit. */
  rotation: number;
  scale: number;
  /** The art nudged inside its own cell, in sheet pixels, scaled by `scale`. */
  offsetX: number;
  offsetY: number;
  /**
   * The firing role's own grip, the counterpart of `fireHandRadius` and
   * friends: the firing pass is its own pose, so the support hand can sit
   * somewhere else on the firing sheet. Unset means "the aiming numbers",
   * which is the usual case (`fireEnabled` stays on).
   */
  fireRadius?: number;
  fireRotation?: number;
  fireScale?: number;
  fireOffsetX?: number;
  fireOffsetY?: number;
  /** Keep the second hand on the firing frames. Unset means yes. */
  fireDraw?: boolean;
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
  /** Playback rate from `[sprites."..."]` (`fps`), defaulting to 15 on emit. */
  fps?: number;
  /** Playback loop mode from `[sprites."..."]`. */
  play?: 'loop' | 'pingpong';
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
  /**
   * Lateral jitter in pixels (`noise`). The ribbon is displaced along the
   * local normal by a fixed noise table, which is how PX's arcs crackle; 0 is
   * a straight trail.
   */
  noise: number;
  /** Cycle the hue along the ribbon (`rainbow`), PX's SetRainbowMode. */
  rainbow: boolean;
  /** Hex colour, e.g. `#ff8800` (`r`, `g`, `b`). */
  color: string;
  /**
   * Which missiles of the weapon get the ribbon: the fired round, its cluster
   * bits, or both. `bit` is the round's complement, which is what a weapon that
   * wants a ribbon only on its frags asks for.
   */
  target: 'main' | 'bit' | 'all';
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
 * What the custom blast's damage reads as to whoever is hit. `electric` sends
 * the scripted `taze` kind (`crates/game/src/hit_kind.rs`), which WA receives as
 * a Prod hit but `wa.on.hit` sees as electric, that is how PX's electric
 * weapons tell their hits apart.
 */
export type ExplosionDamageType = 'blast' | 'electric';

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
  /**
   * Played once where WA fires the weapon (`on_fire`), so the pack's own launch
   * report replaces nothing and needs no stock sample slot. The record's
   * `missile.launch_sound` is the native-id counterpart and still plays when it
   * is set, so this is the file half of the same idea.
   */
  launchEnabled: boolean;
  launch?: CustomSoundAsset;
  launchPriority: number;
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
  /** Actors mode: the spawned sheet and its physics. */
  actorSprite: string;
  actorGravity: boolean;
  actorCollide: boolean;
  actorPersist: boolean;
}

export interface ExplosionEffectConfig {
  enabled: boolean;
  mode: ExplosionMode;
  /**
   * Which explosions this hook runs for: every missile of the weapon, the
   * fired round only, or its cluster bits only. The hook is one claim
   * `on_explode`, so the burst, the custom explosion WAV and any custom
   * `on_explode` Lua in the snippet ride the same choice.
   */
  target: 'all' | 'main' | 'bit';
  /** Custom-explosion fields, used by `blast` mode only. */
  damage: number;
  push: number;
  /** Crater radius; 0 leaves the terrain alone. */
  hole: number;
  /** `default` is PX's random 69-71 blast, `none` is silent, a number is a WA id. */
  sound: 'default' | 'none' | number;
  /** Hit kind the custom blast sends: `blast` (plain) or `electric` (taze). */
  damageType: ExplosionDamageType;
  /** Shape/colour preset the numbers below started from. */
  preset: ExplosionPreset | 'custom';
  /** Ring radius in game pixels. */
  radius: number;
  color: string;
  /** Cycle the hue while the burst lives (`rainbow`). */
  rainbow: boolean;
  /** Beam half-width of both passes (`thickness`). */
  thickness: number;
  /**
   * Sharp core pass width in game pixels. `0` derives it from `thickness` the
   * way the SDK does (`0.9 × thickness`); the floor is 2.5 px, below which the
   * beam texture's bright band stops reading as a line.
   */
  core: number;
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

/**
 * A ring the emitter draws (`fx.ring`): PX's type 2 effect manager. It can be
 * squashed into an ellipse ("bent") and spun, so a railgun's ring reads as a
 * projectile travelling with the round rather than a flat blast.
 */
export interface EmitterRingConfig {
  enabled: boolean;
  radius: number;
  segments: number;
  /** Radial jitter in pixels. */
  noise: number;
  /** Spin per game frame, in degrees (the generator converts to radians). */
  speed: number;
  /** Start angle in degrees, clockwise. */
  angle: number;
  coreWidth: number;
  glowWidth: number;
  /** Taper the pass to a point at both ends (PX's thin spin). */
  thin: boolean;
  /** Ellipse radii multipliers; 1, 1 is a circle. */
  ellipseX: number;
  ellipseY: number;
  /**
   * Point the bend along the owner's heading (`atan2(vy, vx)`) instead of a fixed
   * start angle, so a lens ring faces where the round is going. `angle` becomes
   * an offset from that heading and `speed` is not applied while tracking.
   */
  track: boolean;
  color: string;
  rainbow: boolean;
}

/** The emitter's own ribbon (`fx.emitter{ trail = ... }`). */
export interface EmitterTrailConfig {
  enabled: boolean;
  max: number;
  every: number;
  noise: number;
  coreWidth: number;
  glowWidth: number;
  color: string;
  rainbow: boolean;
}

/**
 * PX's effect manager as a live emitter (`fx.emitter`). It is a hidden actor
 * that draws sparks, a glow and short reach bolts, optionally a ring and a
 * ribbon, at a point that follows the fired round or the worm's aim.
 */
export interface EmitterConfig {
  enabled: boolean;
  /** `round` rides the fired projectile; `muzzle` sits at the worm's aim. */
  anchor: 'round' | 'muzzle';
  /**
   * Muzzle only: once the round exists, the emitter follows it instead of the
   * worm, which is how PX hands its aiming effect to the spawned missile.
   */
  carry: boolean;
  /**
   * Disable the emitter while aiming so it only spawns on fired projectiles,
   * even when `anchor` is `muzzle`.
   */
  projectileExclusive?: boolean;
  /**
   * Opt-out (default true): align the effect's rotation angle (ring/ellipse)
   * with the owner's fire angle while aiming and at launch.
   */
  followFireAngle?: boolean;
  /** Radial distance along the muzzle arm, in pixels (`curDist`). */
  offsetX: number;
  /** Perpendicular offset across the muzzle arm, in pixels (+ sits above barrel). */
  offsetY: number;
  /** Radial angle offset from the worm's fire angle, in degrees (+ tilts up). */
  radialAngle?: number;
  /** Pure Cartesian X offset in pixels without aim-angle rotation (mirrored by worm facing on muzzle). */
  posX?: number;
  /** Pure Cartesian Y offset in pixels without aim-angle rotation (+ is down in world px). */
  posY?: number;
  /** Which reach preset the numbers below started from. */
  preset: 'electric' | 'thunder';
  spark: boolean;
  glow: boolean;
  /** Short bolts that jump out every cooldown (`reach`). */
  reach: boolean;
  /** Direction of reach bolts in screen coordinates, 0 right, 90 down, -90 up. */
  reachDirection?: number;
  /** Total angular spread around `reachDirection`; 360 sends rays in every direction. */
  reachSpread?: number;
  reachCount: number;
  reachDistance: number;
  reachSpeed: number;
  reachCurve: 'px' | 'arc' | 'bezier' | 'line';
  reachBulge: number;
  reachNoise: number;
  reachSegments: number;
  reachCoreWidth: number;
  reachGlowWidth: number;
  color: string;
  ring: EmitterRingConfig;
  trail: EmitterTrailConfig;
  /** Colour every part from the hue clock, PX's SetRainbowMode. */
  rainbow: boolean;
}

/**
 * `wa.land.stamp`, burns the round's picture into the terrain when it explodes
 * (the ninja star / javelin / girder pattern). The engine stamps one frame out
 * of a vertical strip: frame 0 points up and the strip turns clockwise, so the
 * upload is baked into 32 cells by `buildRotationSheet`.
 */
/**
 * The hit kinds a scripted hit may name (`crates/game/src/hit_kind.rs`): the
 * eleven kinds WA itself sends, plus the scripted `taze` (sent to WA as the
 * Prod's kind). `percent` is the Battle Axe's: damage means that percentage of
 * the worm's health. `blast` is **not** a kind, a blast is what a hit event is,
 * not a name a pack may send.
 */
export type StampHitKind =
  | 'bullet'
  | 'fire'
  | 'drill'
  | 'arrow'
  | 'prod'
  | 'percent'
  | 'taze';

/**
 * PX's javelin behaviour: the round **pierces** whatever is at the impact point
 * (a worm, a mine, a crate, an oil drum) instead of exploding, and sticks in the
 * land only when it hit nothing. The record's own blast is zeroed, so this
 * table is where the damage comes from.
 */
export interface TerrainStampImpactConfig {
  enabled: boolean;
  /** Damage dealt to whatever is at the impact point (HP, or % for `percent`). */
  damage: number;
  /** Half-extent of the square the target is looked for in, in px. */
  radius: number;
  /** Knockback given to the target, as a fraction of the round's speed (0..1). */
  impulse: number;
  /** The kind the hit is reported as (and what WA is told for objects). */
  kind: StampHitKind;
  /** Spare the worm that fired: PX's javelin does, so a spear in your hands stabs nothing. */
  spareShooter: boolean;
}

export interface TerrainStampConfig {
  enabled: boolean;
  /** The baked 32-frame strip. `file` is what the exporter writes; `sourceFile`
   *  is the single up-pointing upload, kept so the strip can be rebuilt. */
  sheet?: PackArtAsset;
  /** Pick the frame from the impact velocity's heading. */
  onImpact: boolean;
  /** Fixed angle in degrees, 0 = up, clockwise. Emitted as a frame 0..31. */
  fixedAngle: number;
  /** 1..32 px, `buried.soften`. */
  soften: number;
  /** `buried.blend`: `dither` is the engine default, `mix` blends into the land. */
  blend: 'dither' | 'mix';
  /** `true_colour`: burn the sprite's own colours in instead of mapping them to
   *  the terrain palette (which is what makes a stamp read as carved land). */
  trueColour: boolean;
  /**
   * Half-extent of the square around the impact point the stamp refuses to fill
   * when a worm is inside it (px). A worm sealed under the picture cannot get
   * out, so the round simply leaves the terrain alone there. `0` stamps over
   * worms. Worms with no health left are not listed by `wa.worms.all()`.
   */
  wormClearance: number;
  /** Damage everything at the impact point instead of blasting (PX's javelin). */
  impact: TerrainStampImpactConfig;
}

export type MissileAnimType =
  | 'track'
  | 'rotation'
  | 'slow'
  | 'medium'
  | 'fast'
  | 'none'
  /** Roaming animal: the art points along the velocity, clamped to a tilt range
   *  and resting at a fixed angle when the animal has no speed (on the ground). */
  | 'roam';

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
  /**
   * Play the strip forwards then backwards instead of looping it. Only means
   * anything with more than one frame, and it is what art authored to reverse
   * itself needs (a piston, a swinging hook, an opening jaw).
   */
  pingpong?: boolean;
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
export type BehaviorArtKey =
  | 'homing'
  | 'homing_bit'
  | 'dig'
  | 'roam'
  | 'roam_flight'
  | 'gas';

export interface MissileSpriteConfig {
  enabled: boolean;
  mode: 'stock' | 'custom';
  stockSprite: string;
  sheet: string;
  sheetFile?: File;
  sheetPreview?: string;
  anim: MissileAnimType;
  frames: number;
  /** Forwards then backwards instead of a hard loop (see `FlightRoleArt`). */
  pingpong?: boolean;
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
  /**
   * The art nudged inside its own cell, in sheet pixels, emitted as
   * `offset = { x, y }` on the `sb.flight` call. Scaled with the art (by `size`
   * and the role's own `scale`), turned with the drawn angle and mirrored with
   * the side, so an off-centre pivot stays correct at every heading.
   */
  offsetX?: number;
  offsetY?: number;
  /**
   * The `anim = "roam"` preset: how far the art may tilt away from `rest`, in
   * degrees. A roaming animal walks with no velocity, `track` would leave it
   * pointing at the last heading, so the builder points it along the velocity
   * only while it moves, clamps that to `±up`/`-down` from `rest`, and sits at
   * `rest` when it stops. Emitted as `tilt` on the `sb.flight` call.
   */
  roamTilt?: { up: number; down: number; rest: number };
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
  /**
   * The stock donor this baseline was decoded from, for a `copy_from` base.
   * Unset for a `.wep` baseline (the file is its own base). The generator only
   * honours a donor baseline whose slot still matches the claim's `copy_from`,
   * so a donor change can never be diffed against the previous donor.
   */
  slot?: string;
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
  /**
   * The Space swing played on the held art (`sb.hold`'s `swing`). A fresh
   * project carries it disabled, so the panel has numbers to show.
   */
  aimClip?: AimClipConfig;
  /**
   * The melee strike: the box the swing scans, the tick it lands on and how the
   * victim is thrown. Drawn and simulated from one geometry (the aim pose plus
   * the clip's angle at that tick), so the red box in the preview is the box the
   * game tests.
   */
  melee?: MeleeConfig;
  /**
   * `hold_as = "stock.<weapon>"` on the claim: the stock weapon whose held pose
   * the worm aims this one in. Set by an import that carried one; otherwise the
   * generator derives it (`holdAsFor`), so a thrown weapon whose record sprite
   * the builder zeroes still aims with full hands.
   */
  holdAs?: string;
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
  /**
   * PX's effect manager as a live emitter: a ring, sparks, bolts and a ribbon
   * at a point that follows the muzzle or the fired round (`fx.emitter`).
   * Optional, so an older saved project needs no migration.
   */
  emitter?: EmitterConfig;
  /** `wa.land.stamp`: the round's picture burned into the terrain. Optional for
   *  older projects, which need no migration. */
  terrainStamp?: TerrainStampConfig;
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
  /**
   * Declarations carried from an imported bundle: the module-level preamble
   * (requires, constants, helpers, M2 of `reqs/custom_code_import_plan.md`) and
   * the install-time locals (M3) that the carried hooks close over. Emitted
   * verbatim: the preamble before `return {`, the prologue at the end of
   * `install` and before the claim, so a hook body that calls `start_vortex`
   * finds it. Optional, so an older saved project needs no migration.
   */
  carriedLua?: CarriedLua;
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
  /**
   * The weapon's folder inside a **pack** of more than one weapon. One bundle has
   * one `weps/` folder, so two weapons built from a `.wep` both called
   * `weapon.wep` would write one file and one of them would load the other's
   * record. The pack emitter sets this and `wepBundlePath` names the folder; a
   * single-weapon export leaves it unset, so today's ZIP stays byte-identical.
   * The art paths already carry the weapon's own slug (`sprites/<slug>/`), which
   * is why only `weps/` needs this.
   */
  packSlug?: string;
  wepBaseline?: WepBaseline;
  /**
   * The `copy_from` donor's own decoded record. With no `.wep` the engine
   * applies the donor itself, so this is the diff baseline: untouched fields
   * are left to it and only real edits are written.
   */
  donorBaseline?: WepBaseline;
  /**
   * The weapon's `ctx.option` settings (`[[components.options]]`). A bundle's
   * module reads them and `ctx.option` is an **error** for a key the manifest
   * does not declare, so an imported weapon's list is passed through and edited,
   * never dropped.
   */
  options?: WeaponOptionConfig[];
  /**
   * `[components.suggests."<feature>"]` tables from an imported manifest,
   * passed through untouched on export.
   */
  suggests?: Record<string, Record<string, unknown>>;
}

/**
 * One `[[components.options]]` entry (`components.rs`, `OptionDecl`). `value` is
 * the player's choice; the manifest carries `default`, so a value equal to the
 * default is not written to the profile at all.
 */
export interface WeaponOptionConfig {
  key: string;
  /** `bool`, `int` or `choice`; the engine refuses anything else. */
  kind: string;
  label?: string;
  description?: string;
  default?: boolean | number | string;
  value?: boolean | number | string;
  /** For `choice` only. */
  choices?: string[];
  /** For `int` only. */
  min?: number;
  max?: number;
  /** A `choice` the profile may also write as `true`/`false`. */
  fromBool?: [string, string];
  /** `data = true`: on a weapon, the option is its weapon data field too. */
  data?: boolean;
}

/**
 * A bundle holding one or more weapons (`reqs/pack_export_plan.md`).
 *
 * The engine puts every component of a bundle in **one Lua environment**
 * (`declare_all` keys `envs` by bundle), so a pack shares its module cache, its
 * `[sprites]` table and its dependency list, while each `[[components]]` block
 * claims its own weapon. A single-weapon export is this shape with one element in
 * `weapons` and the weapon's own id as the pack id, which is what keeps today's
 * ZIPs identical.
 *
 * The weapon ids inside a pack are namespaced `<packId>.<slug>`: `id` is unique
 * across every installed bundle, and every art path is derived from the last id
 * segment, so the slug is also the weapon's folder inside the pack.
 */
export interface PackProject {
  /** Bundle id, e.g. `wfws.arsenal`. */
  id: string;
  /** Bundle name, shown by the mod loader. */
  name: string;
  author: string;
  version: string;
  description?: string;
  /** Bundle ids this pack takes over. */
  replaces?: string[];
  /** The one profile the export writes; defaults to the pack name. */
  profileName?: string;
  /**
   * The bundle icon, uploaded (or carried from an imported bundle). One per
   * bundle: `mod_icon` in `mod.toml` names a single file the mod loader shows,
   * and the folder is `sprites/<bundle slug>/icon.png`.
   */
  iconFile?: File;
  iconPreview?: string;
  /**
   * The `mod_icon` path in the manifest. An uploaded `iconFile` always wins and
   * points this at its own file; with none, the first weapon's icon is used, and
   * a bundle carrying neither is fine (the mod loader shows initials).
   */
  modIcon?: string;
  weapons: WeaponProject[];
}

/** A `wa.on.*` call carried verbatim, filter included. */
export interface CarriedLuaRegistration {
  /** The event, without the `wa.on.` prefix. */
  event: string;
  /** The whole call, `wa.on.draw(function() ... end)` and its options table. */
  text: string;
  /** 1-based line in the source module. */
  line: number;
  /**
   * Switched off in the Carried Lua panel: the block stays in the project (so
   * switching it back on restores the text) and is not written to the export.
   * A disabled block can leave the ones above it reading a nil, which is why
   * the panel shows the validator's report next to the list.
   */
  disabled?: boolean;
}

export interface CarriedLuaArt {
  /** Sprite paths the carried code names, already moved to the export's folder. */
  sprites: string[];
  /** Sound paths the carried code plays, already moved to the export's folder. */
  sounds: string[];
  /** A sound the export does not write under a role, carried as its own file. */
  soundFiles?: { path: string; file: File }[];
}

/** One declaration carried out of a bundle, verbatim apart from its rewrites. */
export interface CarriedLuaBlock {
  /** `preamble` sits at module level, `prologue` at the top of the install body. */
  origin: 'preamble' | 'prologue';
  text: string;
  /** Names it declares, so a re-import can rebuild the closure without guessing. */
  declares: string[];
  /** Bundle module ids it requires. */
  requires: string[];
  /** 1-based line in the source module, for the panel and the notes. */
  line: number;
  /** The names that pulled it into the closure. */
  neededBy: string[];
  /** Switched off in the Carried Lua panel; the export writes it again when on. */
  disabled?: boolean;
}

/** A claim hook carried from a bundle, as the function literal it was. */
export interface CarriedLuaHook {
  /** The engine's claim key: `on_explode`, `on_fire`, `on_click`, ... */
  key: string;
  /** The literal, verbatim (`function(ev) ... end` or `{ on = function(ev) ... end }`). */
  text: string;
  /** 1-based line in the source module, for the notes and the panel. */
  line: number;
  /** Switched off in the Carried Lua panel; the export writes it again when on. */
  disabled?: boolean;
}

export interface CarriedLua {
  preamble: CarriedLuaBlock[];
  prologue: CarriedLuaBlock[];
  /**
   * Claim hooks the bundle has and the editor does not model (M5/M6). The
   * mergeable ones (`on_explode`, `on_fire`) are inlined into the handler the
   * editor emits, between its `before` and `after` parts; the rest are written as
   * the claim key itself.
   */
  hooks?: CarriedLuaHook[];
  /** `wa.on.*` calls carried verbatim, in the bundle's order (M6). */
  registrations?: CarriedLuaRegistration[];
  /** Bundle art the carried code names, so the claim lists and the zip carry it. */
  art?: CarriedLuaArt;
  /** Names a carried block reads that nothing in the bundle declares. */
  unresolved: string[];
  /** The bundle it came from, for the import summary. */
  origin?: string;
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
