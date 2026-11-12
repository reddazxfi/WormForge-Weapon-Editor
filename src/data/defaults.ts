/**
 * The record defaults a project starts from.
 *
 * `App.tsx` builds its initial project from these, and the bundle importer uses
 * them as the base when a module ships no `.wep`: a record that declares only
 * some fields then keeps sane values for the rest instead of writing
 * `undefined` into the export.
 */
import type {
  BodyConfig,
  ClustletConfig,
  DigActionConfig,
  FirePayloadConfig,
  RoamActionConfig,
} from '../types/weapon';

export const DEFAULT_CLUSTLET: ClustletConfig = {
  sprite: 'clustlet',
  sprite_count: 1,
  count: 3,
  angle: 0,
  spread: 60,
  power: 20,
  power_variation: 0,
  damage: 15,
  trail: 'smklt25',
  contact: 'bounce',
  bounce_explode: true,
  bounce_power: 15,
  bounces: 0,
  fuse: 2500,
  proximity: 0,
  homing: 'off',
  homing_arm_ms: 1000,
  homing_time_ms: 8000,
  gravity_pct: 40,
  wind_pct: 100,
  bounciness: 25,
};

export const DEFAULT_BODY: BodyConfig = {
  sprite: 'grenade',
  damage: 20,
  gravity_pct: 35,
  wind_pct: 100,
  bounce_pct: 15,
  fuse: true,
  fuse_time_ms: 3000,
  countdown_ms: 3000,
  homing: 'off',
  // WA's own homing records use arm 0-1500 ms and time 2000-5000; 0/0 means no
  // guidance at all, which is what a project used to carry by accident.
  homing_arm_ms: 1000,
  homing_time_ms: 8000,
  cluster: true,
  custom_cluster: false,
  custom_site: 'explode',
  proximity: 25,
  arm_delay_ms: 3000,
  trigger_delay_ms: 2000,
  detect_mask: 0,
  clustlet: { ...DEFAULT_CLUSTLET },
};

export const DEFAULT_ROAM: RoamActionConfig = {
  walk_speed: 2,
  step_height: 4,
  terrain_offset: -10,
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
};

export const DEFAULT_DIG: DigActionConfig = {
  sound: 90,
  dive_sprite: 0,
  sprite_1: 0,
  sprite_2: 0,
  sprite_3: 0,
};

export const DEFAULT_FIRE: FirePayloadConfig = {
  spread_delay_ms: 30,
  burn_time_ms: 1500,
  spread_generations: 10,
  decay_mode: 'resting',
};
