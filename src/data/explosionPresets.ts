import type { ExplosionEffectConfig, ExplosionPreset } from '../types/weapon';

/**
 * Starting points for the effects SDK's bursting explosion. The names and
 * numbers come from PX's own calls:
 *
 * - `electric` — `createElectricExplosion` (effects_methods.c): ring + squashed
 *   lens, re-buffered at frame 16, blue smoke. What the electric mine draws.
 * - `pyro` — PX's `do_explosion_particles(..., 130, 130, 255)`: a round blue
 *   circle with flares and no smoke (PyroMan's blue blast).
 * - `ember` — `createEffectExplosion(20, 30, 0.1, 200, 150, 90, ...)`, the
 *   short flat ring a digging clustlet leaves behind.
 */
export const EXPLOSION_PRESETS: Record<
  ExplosionPreset,
  { label: string; hint: string; patch: Partial<ExplosionEffectConfig> }
> = {
  electric: {
    label: 'Electric',
    hint: 'PX electric explosion: ring + lens, re-buffered, blue smoke',
    patch: {
      // PX's own radius for a custom explosion: `(damage + 2) * 2`
      // (`lib/custom_explosion.lua`), so a 45-damage blast draws a 94 px ring.
      // The electric mine's 56-damage blast is 116 px, which is the size the
      // in-game screenshot shows.
      radius: 94,
      color: '#6496dc',
      thickness: 15,
      core: 0,
      noise: 1.1,
      duration: 18,
      fade: 0.55,
      grow: 3,
      live: 24,
      segments: 25,
      ellipseX: 1.25,
      ellipseY: 0.45,
      rebuffer: true,
      smoke: true,
    },
  },
  pyro: {
    label: 'Pyro blue',
    hint: 'Round blue circle, no smoke (PyroMan blast)',
    patch: {
      radius: 30,
      color: '#8282ff',
      thickness: 8,
      core: 0,
      noise: 1.1,
      duration: 15,
      fade: 0.55,
      grow: 2,
      live: 20,
      segments: 40,
      ellipseX: 1,
      ellipseY: 1,
      rebuffer: false,
      smoke: false,
    },
  },
  ember: {
    label: 'Digging ember',
    hint: 'Short flat orange ring, no smoke',
    patch: {
      radius: 20,
      color: '#c8965a',
      thickness: 30,
      core: 0,
      noise: 0.1,
      duration: 10,
      fade: 0.7,
      grow: 0,
      live: 12,
      segments: 20,
      ellipseX: 1,
      ellipseY: 1,
      rebuffer: false,
      smoke: false,
    },
  },
};

/** The `App.tsx` / imported-project default: off, electric-looking numbers. */
export const DEFAULT_EXPLOSION_EFFECT: ExplosionEffectConfig = {
  enabled: false,
  mode: 'effect',
  damage: 45,
  push: 90,
  hole: 45,
  sound: 'default',
  damageType: 'blast',
  preset: 'electric',
  ...EXPLOSION_PRESETS.electric.patch,
} as ExplosionEffectConfig;
