import type {
  BehaviorArtKey,
  FlightRoleArt,
  WeaponProject,
} from '../types/weapon';

/**
 * Defaults for the extra WFWS builder roles. The primary round keeps its own
 * `MissileSpriteConfig` because it owns the preview canvas; bits and behaviour
 * states only need the flight fields.
 */
export const DEFAULT_ROLE_ART: FlightRoleArt = {
  mode: 'native',
  anim: 'rotation',
  frames: 1,
  fps: 15,
  animSpeed: 1,
  spinRate: 1,
  scale: 1,
  mirror: true,
  z: 5,
};

/** Digging defaults to Probe (`builder`) mode with `track` rotation. */
export const DEFAULT_DIG_ROLE_ART: FlightRoleArt = {
  ...DEFAULT_ROLE_ART,
  mode: 'builder',
  anim: 'track',
};

export interface BehaviorArtDef {
  key: BehaviorArtKey;
  label: string;
  /** Which identity layer the state applies to. */
  scope: (project: WeaponProject) => 'main' | 'bit';
  /** The record field(s) whose sprite id is the state signal. */
  record: string;
  description: string;
}

/** The cluster bit's action, from the same expression the editor uses. */
export function bitActionOf(project: WeaponProject): string {
  const c = project.body.clustlet;
  return (
    c.bit_action ??
    (c.homing !== 'off' ? 'homing' : c.contact === 'bounce' ? 'bounce' : 'none')
  );
}

/**
 * Behaviour rows and the record field each one's art comes from.
 *
 * Digging is listed for the UI but is not a state any more: `resolveBehaviorStates`
 * skips it. A digging record names no art of its own (the generator zeroes
 * `dig.dive_sprite` / `sprite_1..3`) and the builder cycles the flight sheet
 * while its terrain probes say the nose is in the land.
 */
export const BEHAVIOR_ART_DEFS: BehaviorArtDef[] = [
  {
    key: 'homing',
    label: 'Homing flight',
    scope: () => 'main',
    record: 'missile.homing.sprite',
    description: 'Art used once the primary round starts steering towards a target.',
  },
  {
    key: 'homing_bit',
    label: 'Homing cluster bit',
    scope: () => 'bit',
    record: 'clusters.bit.homing.sprite',
    description: 'Art used by a cluster bit after it arms and starts steering.',
  },
  {
    key: 'dig',
    label: 'Digging',
    scope: (project) => (project.action === 'dig' ? 'main' : 'bit'),
    record: 'dig.dive_sprite / sprite_1..3 (zeroed)',
    description:
      'No art of its own: the record dig sprites are zeroed and the builder cycles the flight sheet while terrain probes say the round is digging.',
  },
];

// A roaming animal is not a state role: WA draws its walking pose (record
// `sprite`), its two flying sheets (`sheep_sprites` -> `sheep.flight_1/2`) and
// its gas pose (`roam.gas.animal_sprite`) from separate fields, so the Hold
// page's roam card uploads the two flying sheets instead of swapping art on a
// signal. See `roamSheetPaths` in luaGenerator.

/** The behaviour rows that make sense for the current action and payload. */
export function availableBehaviorArt(project: WeaponProject): BehaviorArtDef[] {
  const bitAction = bitActionOf(project);
  const clusters = project.burst === 'clusters';
  return BEHAVIOR_ART_DEFS.filter((def) => {
    switch (def.key) {
      case 'homing':
        return project.action === 'homing';
      case 'homing_bit':
        return clusters && bitAction === 'homing';
      case 'dig':
        return project.action === 'dig' || (clusters && bitAction === 'dig');
      default:
        return false;
    }
  });
}

/** Stock names the bit classifier and collision check need to know as ids. */
const STOCK_SPRITE_IDS: Record<string, number> = {
  mine: 45,
  missile: 48,
  bazooka: 48,
  grenade: 50,
  banana: 51,
  mortar: 52,
  cluster: 53,
  clustlet: 54,
  homing: 58,
  dynamite: 78,
  pigeon: 175,
  sheep: 653,
};

/** The sprite id a cluster bit reports at first sight (the bit marker). */
export function bitMarkerId(project: WeaponProject): number {
  const raw = project.body?.clustlet?.sprite;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  return STOCK_SPRITE_IDS[String(raw || '').toLowerCase()] ?? 54;
}

export type AssignedField =
  | 'homing_sprite'
  | 'bit_homing_sprite'
  | 'dig_dive'
  | 'dig_1'
  | 'dig_2'
  | 'dig_3'
  | 'roam_flight_1'
  | 'roam_flight_2'
  | 'gas_sprite';

export interface ResolvedBehaviorState {
  def: BehaviorArtDef;
  art: FlightRoleArt;
  scope: 'main' | 'bit';
  /** Ids matched against the last nonzero `m.sprite`. */
  sig: number[];
  /** Record ids the generator has to write (empty when the record already has them). */
  assigned: Partial<Record<AssignedField, number>>;
}

/** The record sprite fields that carry a behaviour's `m.sprite` signal. */
interface SignalField {
  field: AssignedField;
  value: number;
}

function signalFields(project: WeaponProject, def: BehaviorArtDef): SignalField[] {
  const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  switch (def.key) {
    case 'homing':
      return [
        {
          field: 'homing_sprite',
          value: num(project.recordOverrides?.['missile.homing.sprite']),
        },
      ];
    case 'homing_bit':
      return [
        { field: 'bit_homing_sprite', value: num(project.body?.clustlet?.homing_sprite) },
      ];
    case 'dig': {
      const bit = def.scope(project) === 'bit';
      const dig = bit ? project.body?.clustlet?.dig : project.digConfig;
      // WA may write any of the four dig frames into m.sprite, so all of them
      // are signals and each needs a distinct id.
      return [
        { field: 'dig_dive', value: num(dig?.dive_sprite) },
        { field: 'dig_1', value: num(dig?.sprite_1) },
        { field: 'dig_2', value: num(dig?.sprite_2) },
        { field: 'dig_3', value: num(dig?.sprite_3) },
      ];
    }
    case 'roam_flight':
      return [
        { field: 'roam_flight_1', value: num(project.roamConfig?.flight_1) },
        { field: 'roam_flight_2', value: num(project.roamConfig?.flight_2) },
      ];
    case 'gas':
      return [
        { field: 'gas_sprite', value: num(project.roamConfig?.gas_animal_sprite) },
      ];
    default:
      return [];
  }
}

/**
 * Resolve the configured behaviour states and assign a distinct id to every
 * record field that has none (or would collide with another state). The
 * builder only needs nonzero, unique signals; the ids are real Gfx.dir ids in
 * the 245+ range, away from the stock bodies and the bit marker.
 */
export function resolveBehaviorStates(project: WeaponProject): ResolvedBehaviorState[] {
  // States are drawn by the same `sb.flight` call as the primary sheet; without
  // the primary builder there is no call to hang them on.
  if (!primaryBuilderOn(project)) return [];
  const used = new Set<number>([bitMarkerId(project)]);
  // Reserve the stock bodies so a forced id can never look like a bit.
  for (const id of Object.values(STOCK_SPRITE_IDS)) used.add(id);

  let nextId = 245;
  const takeId = (): number => {
    while (used.has(nextId)) nextId += 1;
    const id = nextId;
    used.add(id);
    nextId += 1;
    return id;
  };

  const out: ResolvedBehaviorState[] = [];
  for (const def of availableBehaviorArt(project)) {
    // These roles have their own route now, so none of them is a `sig` state:
    // dig is probe-driven (the builder animates the flight sheet in the dirt),
    // and homing is timed (`arm`/`time` ms). Keeping them here would write a
    // sentinel id into a record sprite field again.
    if (def.key === 'dig' || def.key === 'homing' || def.key === 'homing_bit') continue;
    const art = project.behaviorArt?.[def.key];
    if (!art || art.mode === 'inherit') continue;
    const sig: number[] = [];
    const assigned: Partial<Record<AssignedField, number>> = {};
    for (const signal of signalFields(project, def)) {
      if (signal.value > 0 && !used.has(signal.value)) {
        used.add(signal.value);
        sig.push(signal.value);
      } else {
        const id = takeId();
        assigned[signal.field] = id;
        sig.push(id);
      }
    }
    if (sig.length === 0) sig.push(takeId());
    out.push({ def, art, scope: def.scope(project), sig, assigned });
  }
  return out;
}

/** True when the primary flight builder is on (bits and states hang off it). */
export function primaryBuilderOn(project: WeaponProject): boolean {
  // An air strike has no placed missile for the builder to follow: its
  // munitions are built from the strike's own record copy. Keep the native
  // 32-frame route there.
  if (project.fireType === 'cursor' && !project.teleport) return false;
  return !!project.missileSprite?.enabled && project.missileSprite.mode === 'custom';
}

/** The bit role, or null when the builder should leave WA's bits alone. */
export function bitBuilderMode(project: WeaponProject): 'builder' | 'inherit' | null {
  if (!primaryBuilderOn(project) || project.burst !== 'clusters') return null;
  const mode = project.bitFlight?.mode;
  return mode === 'builder' || mode === 'inherit' ? mode : null;
}

/** True when the WFWS builder has anything to do. */
export function usesWfwsBuilder(project: WeaponProject): boolean {
  return (
    primaryBuilderOn(project) ||
    bitBuilderMode(project) === 'builder' ||
    resolveBehaviorStates(project).length > 0
  );
}
