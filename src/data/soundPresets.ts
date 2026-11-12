import type { CustomSoundsConfig } from '../types/weapon';

/**
 * Custom WAV playback. WA's record fields take native sample ids, so a pack
 * sound is declared in the claim's `sounds` list and played by path:
 * `wa.sound.play(target, "sounds/<mod>/<role>.wav", priority)`.
 *
 * - The explosion sound runs in the claim's `on_explode`, before WA's blast.
 * - The interval sound is ticked from `wa.on.missile_frame`; Lua has no handle
 *   to a flying missile's emitter, so the firing worm is the emitter (whose
 *   turn it is, else any living worm) and the voice is positioned there.
 */
export const DEFAULT_CUSTOM_SOUNDS: CustomSoundsConfig = {
  explosionEnabled: false,
  explosionPriority: 10,
  shotEnabled: false,
  shotEvery: 1,
  shotPriority: 8,
  intervalEnabled: false,
  intervalMs: 400,
  intervalDelayMs: 0,
  intervalLimit: 0,
  intervalPriority: 8,
};

/**
 * Voice priorities. WormForge keeps 64 custom voices and a higher priority may
 * replace an older lower one; WA's own positional attenuation still applies.
 */
export const SOUND_PRIORITIES = [
  { value: 4, label: 'Quiet (4) — gives way first' },
  { value: 8, label: 'Normal (8) — the engine default' },
  { value: 10, label: 'Loud (10) — cuts ambient voices' },
  { value: 16, label: 'Lead (16) — only other leads cut it' },
] as const;

/** Quick interval presets: milliseconds between plays, and the first delay. */
export const INTERVAL_PRESETS = [
  { label: 'Beep 2/s', every: 500, delay: 0, limit: 0 },
  { label: 'Tick 5/s', every: 200, delay: 0, limit: 0 },
  { label: 'Motor 10/s', every: 100, delay: 0, limit: 0 },
  { label: 'One-shot at 1 s', every: 200, delay: 1000, limit: 1 },
] as const;
