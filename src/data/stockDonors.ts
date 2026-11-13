/**
 * One decoded stock record per panel slot — the record a `copy_from` donor
 * supplies.
 *
 * PX's default scheme, extracted one `.wep` per slot
 * (`python tools/px_scheme_weps.py <scheme>.pxs OUT --all`), decoded here into
 * `stockDonors.json` by `bun run tools/gen_stock_donors.ts`.
 *
 * Two uses:
 *
 * - a bundle weapon whose Lua declares only a few fields inherits the rest from
 *   its donor, so the editor needs those values to show and to diff against;
 * - the editor's own default project is the stock Grenade, so a fresh weapon
 *   starts from WA's real record instead of a preset.
 *
 * With `copy_from = "stock.<slot>"` the engine applies the donor itself, so the
 * baseline lets the generator write only what actually differs — a weapon that
 * declares `missile.explosion.power` exports one number, not a whole record.
 */
import type { WepBaseline, WeaponProject } from '../types/weapon';
import donors from './stockDonors.json';

export type StockDonor = Partial<WeaponProject>;

const TABLE = donors as Record<string, StockDonor>;

/** The decoded record for a stock slot, or undefined when it is not known. */
export function stockDonor(slot: string | undefined): StockDonor | undefined {
  if (!slot) return undefined;
  return TABLE[slot.toLowerCase()];
}

/** The donor as a diff baseline (`WepBaseline`), so the generator can diff. */
export function stockDonorBaseline(slot: string | undefined): WepBaseline | undefined {
  const donor = stockDonor(slot);
  if (!donor?.body || !donor.action) return undefined;
  return {
    slot: slot?.toLowerCase(),
    body: { ...donor.body, clustlet: { ...donor.body.clustlet } },
    action: donor.action,
    burst: donor.burst ?? 'nothing',
    recordOverrides: { ...(donor.recordOverrides ?? {}) },
    missileSprite: {
      enabled: false,
      mode: 'stock',
      stockSprite: 'grenade',
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
    },
    roamConfig: {
      ...(donor.roamConfig ?? {
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
        hits: {},
        flight_hits: {},
      }),
    },
    digConfig: {
      ...(donor.digConfig ?? { sound: 90, dive_sprite: 0, sprite_1: 0, sprite_2: 0, sprite_3: 0 }),
    },
    fireConfig: {
      ...(donor.fireConfig ?? {
        spread_delay_ms: 30,
        burn_time_ms: 1500,
        spread_generations: 10,
        decay_mode: 'resting',
      }),
    },
    specialSubtype: donor.specialSubtype ?? 0,
  };
}

/** Record fields of a donor, ready to spread over a project. */
export function stockDonorRecord(slot: string | undefined): StockDonor {
  return stockDonor(slot) ?? {};
}

/** Every slot the table knows, for diagnostics. */
export const STOCK_DONOR_SLOTS = Object.keys(TABLE).sort();
