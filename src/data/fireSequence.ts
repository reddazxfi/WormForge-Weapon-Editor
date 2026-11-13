import type { FireSequenceConfig, WeaponProject } from '../types/weapon';

/**
 * `wf-lib/fire_seq` fires a burst from one `on_fire`. It needs a weapon whose
 * `on_fire` the engine runs: a missile, a thrown weapon, a gun or a special.
 * An air strike's munitions are created by the strike entity, so its slot never
 * fires and the burst would never start.
 */
export function supportsFireSequence(project: WeaponProject): boolean {
  if (project.fireType === 'cursor' && !project.teleport) return false;
  return true;
}

export const DEFAULT_FIRE_SEQUENCE: FireSequenceConfig = {
  enabled: false,
  mode: 'missiles',
  count: 8,
  delay: 4,
  speed: 14,
  standoff: 24,
  spreadX: 0,
  spreadY: 0,
  offsetX: 0,
  offsetY: -3,
  liveAim: true,
  cancelOnWeaponChange: true,
  actorSprite: '',
  actorGravity: false,
  actorCollide: false,
  actorPersist: false,
};
