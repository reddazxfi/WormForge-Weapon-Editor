/**
 * The inverse of the generator's record emission: a bundle's Lua record tables
 * become the editor's typed fields.
 *
 * Every key the generator can write is read back here, so an imported weapon
 * shows its real values in the panels instead of the donor's. Anything the
 * mapper does not know is left in `recordExtra` and still emitted verbatim, so
 * a record can never lose a field just because the editor has no control for
 * it yet.
 *
 * The reader is destructive on purpose: `take()` removes what it consumed, and
 * whatever is left at the end is the unknown tail.
 */
import type {
  BodyConfig,
  ClustletConfig,
  CollisionMask,
  DigActionConfig,
  FirePayloadConfig,
  HomingKind,
  MissileAction,
  BurstPayload,
  RoamActionConfig,
  WeaponProject,
} from '../../types/weapon';
import type { LuaTable, LuaValue } from './luaTable';

const isTable = (value: LuaValue | undefined): value is LuaTable =>
  !!value && typeof value === 'object';

const clone = (value: LuaTable): LuaTable => {
  const out: LuaTable = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = isTable(entry) ? clone(entry) : entry;
  }
  return out;
};

/** Reads a record table, deleting what it consumes. */
class Tape {
  private data: LuaTable;

  constructor(record: LuaTable) {
    this.data = clone(record);
  }

  take(...path: string[]): LuaValue | undefined {
    let node: LuaTable | undefined = this.data;
    for (let i = 0; i < path.length - 1; i += 1) {
      const next: LuaValue | undefined = node?.[path[i]];
      if (!isTable(next)) return undefined;
      node = next;
    }
    const key = path[path.length - 1];
    if (!node || !(key in node)) return undefined;
    const value = node[key];
    delete node[key];
    this.prune(path);
    return value;
  }

  /** Reads without consuming. */
  peek(...path: string[]): LuaValue | undefined {
    let node: LuaTable | undefined = this.data;
    for (const key of path) {
      const next: LuaValue | undefined = node?.[key];
      if (!isTable(next)) return next;
      node = next;
    }
    return node;
  }

  /** Drops parents that the takes left empty, so `remaining` is only real data. */
  private prune(path: string[]): void {
    for (let length = path.length - 1; length >= 1; length -= 1) {
      let node: LuaTable | undefined = this.data;
      for (let i = 0; i < length - 1; i += 1) {
        const next: LuaValue | undefined = node?.[path[i]];
        if (!isTable(next)) return;
        node = next;
      }
      const key = path[length - 1];
      const child = node?.[key];
      if (isTable(child) && Object.keys(child).length === 0) delete node![key];
      else return;
    }
  }

  get remaining(): LuaTable | undefined {
    return Object.keys(this.data).length > 0 ? this.data : undefined;
  }
}

const int = (value: LuaValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const bool = (value: LuaValue | undefined): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const text = (value: LuaValue | undefined): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const mask = (value: LuaValue | undefined): CollisionMask | undefined =>
  isTable(value) ? (value as CollisionMask) : undefined;

const homingKind = (value: LuaValue | undefined): HomingKind | undefined =>
  value === 'lock' || value === 'dodge' || value === 'off' || value === 'avoid'
    ? value
    : undefined;

/** `roam` / `clusters.bit.roam` -> `RoamActionConfig`. */
function readRoam(table: LuaTable | undefined, base: RoamActionConfig): RoamActionConfig {
  if (!table) return base;
  const tape = new Tape(table);
  const edge = tape.take('edge_jump');
  const jump = tape.take('jump');
  const gas = tape.take('gas');
  const edgeTable = isTable(edge) ? edge : undefined;
  const jumpTable = isTable(jump) ? jump : undefined;
  const gasTable = isTable(gas) ? gas : undefined;
  return {
    ...base,
    walk_speed: int(tape.take('walk_speed')) ?? base.walk_speed,
    step_height: int(tape.take('step_height')) ?? base.step_height,
    terrain_offset: int(tape.take('terrain_offset')) ?? base.terrain_offset,
    hits: mask(tape.take('hits')) ?? base.hits,
    flight_hits: mask(tape.take('flight_hits')) ?? base.flight_hits,
    edge_jump_angle_deg: int(edgeTable?.angle_deg) ?? base.edge_jump_angle_deg,
    edge_jump_speed: int(edgeTable?.speed) ?? base.edge_jump_speed,
    edge_jump_sound: int(edgeTable?.sound) ?? base.edge_jump_sound,
    jump_angle_deg: int(jumpTable?.angle_deg) ?? base.jump_angle_deg,
    jump_speed: int(jumpTable?.speed) ?? base.jump_speed,
    jump_sound: int(jumpTable?.sound) ?? base.jump_sound,
    gas_start_delay_ms: int(gasTable?.start_delay_ms) ?? base.gas_start_delay_ms,
    gas_poison_power: int(gasTable?.poison_power) ?? base.gas_poison_power,
    gas_animal_sprite: int(gasTable?.animal_sprite) ?? base.gas_animal_sprite,
  };
}

/** `dig` / `clusters.bit.dig` -> `DigActionConfig`. */
function readDig(table: LuaTable | undefined, base: DigActionConfig): DigActionConfig {
  if (!table) return base;
  const tape = new Tape(table);
  return {
    ...base,
    sound: int(tape.take('sound')) ?? base.sound,
    dive_sprite: int(tape.take('dive_sprite')) ?? base.dive_sprite,
    sprite_1: int(tape.take('sprite_1')) ?? base.sprite_1,
    sprite_2: int(tape.take('sprite_2')) ?? base.sprite_2,
    sprite_3: int(tape.take('sprite_3')) ?? base.sprite_3,
  };
}

/** `missile.fire` -> `FirePayloadConfig`. */
function readFire(table: LuaTable | undefined, base: FirePayloadConfig): FirePayloadConfig {
  if (!table) return base;
  const tape = new Tape(table);
  const decay = tape.take('decay_mode');
  return {
    ...base,
    spread_delay_ms: int(tape.take('spread_delay_ms')) ?? base.spread_delay_ms,
    burn_time_ms: int(tape.take('burn_time_ms')) ?? base.burn_time_ms,
    spread_generations: int(tape.take('spread_generations')) ?? base.spread_generations,
    decay_mode: decay === 'on_hit' || decay === 'resting' ? decay : base.decay_mode,
  };
}

export interface MappedRecord {
  body: BodyConfig;
  action: MissileAction;
  burst: BurstPayload;
  roamConfig: RoamActionConfig;
  digConfig: DigActionConfig;
  fireConfig: FirePayloadConfig;
  recordOverrides: Record<string, unknown>;
  /** Keys the mapper does not model, still emitted verbatim. */
  recordExtra?: LuaTable;
  /** Trail sheets the record points at inside its own bundle. */
  packArt: Partial<Record<'missile_trail' | 'cluster_trail', string>>;
  /** `on_select = { cursor = true }` on a cursor record. */
  teleport?: boolean;
}

/**
 * Maps a bundle's record tables onto the editor's model, over `base` (the
 * decoded `.wep` when the module ships one, else the editor's defaults).
 */
export function mapRecord(
  record: LuaTable | undefined,
  base: {
    body: BodyConfig;
    action: MissileAction;
    burst: BurstPayload;
    roamConfig: RoamActionConfig;
    digConfig: DigActionConfig;
    fireConfig: FirePayloadConfig;
    recordOverrides: Record<string, unknown>;
  },
): MappedRecord {
  const overrides: Record<string, unknown> = { ...base.recordOverrides };
  const body: BodyConfig = { ...base.body, clustlet: { ...base.body.clustlet } };
  let action = base.action;
  let burst = base.burst;
  let roamConfig = { ...base.roamConfig };
  let digConfig = { ...base.digConfig };
  let fireConfig = { ...base.fireConfig };
  let teleport: boolean | undefined;

  if (!record) {
    return {
      body,
      action,
      burst,
      roamConfig,
      digConfig,
      fireConfig,
      recordOverrides: overrides,
      packArt: {},
    };
  }

  const tape = new Tape(record);
  const set = (key: string, value: unknown) => {
    if (value !== undefined) overrides[key] = value;
  };

  // Fields inside a group the mapper consumed but does not model (a clustlet's
  // `random_motion`, say) are put back under the same path, so `recordExtra`
  // still carries them and the export stays faithful.
  const leftovers: LuaTable = {};
  const keep = (path: string[], remaining: LuaTable | undefined) => {
    if (!remaining) return;
    let node = leftovers;
    for (const key of path.slice(0, -1)) {
      const next = node[key];
      if (!isTable(next)) node[key] = {};
      node = node[key] as LuaTable;
    }
    const last = path[path.length - 1];
    const existing = node[last];
    node[last] = isTable(existing) ? { ...existing, ...remaining } : remaining;
  };

  /** A pack path in a trail field is claim art, not a stock sprite id. */
  const packArt: Partial<Record<'missile_trail' | 'cluster_trail', string>> = {};
  const trailValue = (value: LuaValue | undefined): string | undefined => {
    const raw = text(value);
    if (raw === undefined) return undefined;
    return raw;
  };

  // ---- handling -----------------------------------------------------------
  const handling = tape.take('handling');
  if (isTable(handling)) {
    const h = new Tape(handling);
    set('handling.remember_selection', bool(h.take('remember_selection')));
    set('handling.available_in_caves', bool(h.take('available_in_caves')));
    set('handling.shots', int(h.take('shots')));
    set('handling.ends_turn', bool(h.take('ends_turn')));
    set('handling.retreat', int(h.take('retreat')));
    keep(['handling'], h.remaining);
  }

  // ---- gun ----------------------------------------------------------------
  const gun = tape.take('gun');
  if (isTable(gun)) {
    const g = new Tape(gun);
    const damage = int(g.take('damage'));
    if (damage !== undefined) body.damage = damage;
    set('gun.bullets', int(g.take('bullets')));
    set('gun.spread_deg', int(g.take('spread_deg')));
    set('gun.shot_interval_ms', int(g.take('shot_interval_ms')));
    set('gun.burst_size', int(g.take('burst_size')));
    set('gun.burst_spread_deg', int(g.take('burst_spread_deg')));
    set('gun.impact_effect', int(g.take('impact_effect')));
    set('gun.hits', mask(g.take('hits')));
    const explosion = g.take('explosion');
    if (isTable(explosion)) {
      const e = new Tape(explosion);
      set('gun.explosion.bias', int(e.take('bias')));
      set('gun.explosion.push_pct', int(e.take('push_pct')));
      set('gun.explosion.variation', int(e.take('variation')));
      keep(['gun', 'explosion'], e.remaining);
    }
    keep(['gun'], g.remaining);
  }

  // ---- mine ---------------------------------------------------------------
  const mine = tape.take('mine');
  if (isTable(mine)) {
    const m = new Tape(mine);
    // A mine is a drop with no fuse: the generator picks the `mine` group over
    // `missile` on exactly that test.
    body.fuse = false;
    const proximity = int(m.take('proximity'));
    if (proximity !== undefined) body.proximity = proximity;
    const arm = int(m.take('arm'));
    if (arm !== undefined) body.arm_delay_ms = arm;
    const fuse = int(m.take('fuse'));
    if (fuse !== undefined) body.trigger_delay_ms = fuse;
    set('mine.detects', mask(m.take('detects')));
    const explosion = m.take('explosion');
    if (isTable(explosion)) {
      const e = new Tape(explosion);
      const power = int(e.take('power'));
      if (power !== undefined) body.damage = power;
      set('mine.explosion.bias', int(e.take('bias')));
      set('mine.explosion.push_pct', int(e.take('push_pct')));
      keep(['mine', 'explosion'], e.remaining);
    }
    keep(['mine'], m.remaining);
  }

  // ---- strike -------------------------------------------------------------
  const strike = tape.take('strike');
  if (isTable(strike)) {
    const s = new Tape(strike);
    set('strike.count', int(s.take('count')));
    set('strike.spacing', int(s.take('spacing')));
    set('strike.munition_speed', int(s.take('munition_speed')));
    set('strike.plane', text(s.take('plane')));
    set('strike.plane_sound', int(s.take('plane_sound')));
    const munition = s.take('munition');
    if (munition === 'mines' || munition === 0) set('strike.munition', 'mines');
    else if (munition === 'missiles' || munition === 2) set('strike.munition', 'missiles');
    else set('strike.munition', munition);
    keep(['strike'], s.remaining);
  }

  // ---- missile ------------------------------------------------------------
  const missile = tape.take('missile');
  if (isTable(missile)) {
    const m = new Tape(missile);

    const explosion = m.take('explosion');
    if (isTable(explosion)) {
      const e = new Tape(explosion);
      const power = int(e.take('power'));
      if (power !== undefined) body.damage = power;
      set('missile.explosion.push_pct', int(e.take('push_pct')));
      set('missile.explosion.bias', int(e.take('bias')));
      set('missile.explosion.variation', int(e.take('variation')));
    }

    const gravity = int(m.take('gravity_pct'));
    if (gravity !== undefined) body.gravity_pct = gravity;
    const wind = int(m.take('wind_pct'));
    if (wind !== undefined) body.wind_pct = wind;

    const fuse = int(m.take('fuse'));
    if (fuse !== undefined) {
      body.fuse = fuse > 0;
      body.fuse_time_ms = fuse;
    }
    const countdown = int(m.take('countdown'));
    if (countdown !== undefined) body.countdown_ms = countdown;

    set('missile.explode_on_space', bool(m.take('explode_on_space')));

    const explosionSound = m.take('explosion_sound');
    if (isTable(explosionSound)) {
      const s = new Tape(explosionSound);
      set('missile.explosion_sound.enabled', bool(s.take('enabled')));
      set('missile.explosion_sound.sound', int(s.take('sound')));
      set('missile.explosion_sound.before', int(s.take('before')));
    }

    const sprite = text(m.take('sprite'));
    if (sprite !== undefined) {
      // `missile.sprite` is written from the override (the panel's sprite field
      // and the decoded `.wep` both live there); `body.sprite` mirrors it for
      // the record page.
      body.sprite = sprite;
      set('missile.sprite', sprite === '0' ? 0 : sprite);
    }
    set('missile.animation', int(m.take('animation')));
    set('missile.speed_pct', int(m.take('speed_pct')));
    set('missile.random_motion', int(m.take('random_motion')));
    set('missile.collision_shape', int(m.take('collision_shape')));
    set('missile.alarm_worms', bool(m.take('alarm_worms')));
    set('missile.ends_on_contact', mask(m.take('ends_on_contact')));

    const trail = m.take('trail');
    if (isTable(trail)) {
      const t = new Tape(trail);
      const trailSprite = trailValue(t.take('sprite'));
      if (trailSprite && trailSprite.includes('/')) {
        // A bundle path is claim art: the engine loads the sheet and writes its
        // id into the record field, so it belongs in `packArt`, not in a
        // stock-sprite override (which would fall back to `smklt25`).
        packArt.missile_trail = trailSprite;
        overrides['missile.trail.enabled'] = true;
      } else {
        overrides['missile.trail.enabled'] = trailSprite !== undefined && trailSprite !== '0';
        set('missile.trail.sprite', trailSprite);
      }
      set('missile.trail.power', int(t.take('power')));
      set('missile.trail.speed', int(t.take('speed')));
      set('missile.trail.bubbles_per_second', int(t.take('bubbles_per_second')));
    }

    set('missile.impact_particles', bool(m.take('impact_particles')));
    set('missile.flight_sound', int(m.take('flight_sound')));
    set('missile.launch_sound', int(m.take('launch_sound')));

    const actionValue = m.take('action');
    if (
      actionValue === 'none' ||
      actionValue === 'bounce' ||
      actionValue === 'homing' ||
      actionValue === 'roam' ||
      actionValue === 'dig'
    ) {
      action = actionValue;
    } else {
      // PX's records often declare an action's fields without naming the
      // action: the engine's `refuse` only compares them when both are known,
      // and the slab the fields land in is read *as* the action. A record that
      // carries `roam`/`dig`/`homing`/`bounce` therefore means that action.
      const groups = missile as LuaTable;
      const has = (name: string) => isTable(groups[name]);
      if (has('roam')) action = 'roam';
      else if (has('dig')) action = 'dig';
      else if (has('bounce')) action = 'bounce';
      else if (has('homing')) action = 'homing';
    }

    const bounce = m.take('bounce');
    if (isTable(bounce)) {
      const b = new Tape(bounce);
      const bounciness = int(b.take('bounciness'));
      if (bounciness !== undefined) body.bounce_pct = bounciness;
      set('missile.bounce.terrain_keep_speed_pct', int(b.take('terrain_keep_speed_pct')));
      set('missile.bounce.max_bounces', int(b.take('max_bounces')));
      set('missile.bounce.sound', int(b.take('sound')));
      set('missile.bounce.contact_sides', int(b.take('contact_sides')));
      set('missile.bounce.extra_reverse_chance_pct', int(b.take('extra_reverse_chance_pct')));
      set('missile.bounce.hits', mask(b.take('hits')));
      const explosion = b.take('explosion');
      if (isTable(explosion)) {
        const e = new Tape(explosion);
        set('missile.bounce.explosion.bias', int(e.take('bias')));
        set('missile.bounce.explosion.push_pct', int(e.take('push_pct')));
        set('missile.bounce.explosion.power', int(e.take('power')));
        set('missile.bounce.explosion.variation', int(e.take('variation')));
      }
    }

    const homing = m.take('homing');
    if (isTable(homing)) {
      const h = new Tape(homing);
      const kind = homingKind(h.take('kind'));
      if (kind) body.homing = kind;
      const arm = int(h.take('arm'));
      if (arm !== undefined) body.homing_arm_ms = arm;
      const time = int(h.take('time'));
      if (time !== undefined) body.homing_time_ms = time;
      set('missile.homing.sprite', text(h.take('sprite')));
      set('missile.homing.animation', int(h.take('animation')));
      const trail = h.take('trail');
      if (isTable(trail)) {
        const t = new Tape(trail);
        set('missile.homing.trail.sprite', text(t.take('sprite')));
        set('missile.homing.trail.power', int(t.take('power')));
        set('missile.homing.trail.speed', int(t.take('speed')));
        set('missile.homing.trail.bubbles_per_second', int(t.take('bubbles_per_second')));
      }
    }

    const roam = m.take('roam');
    if (isTable(roam)) roamConfig = readRoam(roam, roamConfig);

    const dig = m.take('dig');
    if (isTable(dig)) digConfig = readDig(dig, digConfig);

    const burstValue = m.take('burst');
    if (burstValue === 'nothing' || burstValue === 'clusters' || burstValue === 'fire') {
      burst = burstValue;
    } else if (isTable(record.clusters)) {
      // A record that declares cluster bits is a cluster burst, whether or not
      // it names the burst (the engine reads `clusters` only for that burst).
      burst = 'clusters';
    } else if (isTable(m.peek('fire'))) {
      burst = 'fire';
    }
    const fire = m.take('fire');
    if (isTable(fire)) fireConfig = readFire(fire, fireConfig);
    keep(['missile'], m.remaining);
  }

  // ---- clusters -----------------------------------------------------------
  const clusters = tape.take('clusters');
  if (isTable(clusters)) {
    const c = new Tape(clusters);
    const clustlet: ClustletConfig = { ...body.clustlet };
    const count = int(c.take('count'));
    if (count !== undefined) clustlet.count = count;
    const angle = int(c.take('angle'));
    if (angle !== undefined) clustlet.angle = angle;
    const spread = int(c.take('spread'));
    if (spread !== undefined) clustlet.spread = spread;
    const power = int(c.take('launch_power_pct'));
    if (power !== undefined) clustlet.power = power;
    const variation = int(c.take('power_variation_pct'));
    if (variation !== undefined) clustlet.power_variation = variation;

    const bit = c.take('bit');
    if (isTable(bit)) {
      const b = new Tape(bit);
      const bitAction = b.take('action');
      if (
        bitAction === 'none' ||
        bitAction === 'bounce' ||
        bitAction === 'homing' ||
        bitAction === 'roam' ||
        bitAction === 'dig'
      ) {
        clustlet.bit_action = bitAction;
      } else {
        // Same inference as the primary record's action.
        const bitTables = bit as LuaTable;
        const hasBit = (name: string) => isTable(bitTables[name]);
        if (hasBit('roam')) clustlet.bit_action = 'roam';
        else if (hasBit('dig')) clustlet.bit_action = 'dig';
        else if (hasBit('homing')) clustlet.bit_action = 'homing';
        else if (hasBit('bounce')) clustlet.bit_action = 'bounce';
      }
      const sprite = text(b.take('sprite'));
      if (sprite !== undefined) clustlet.sprite = sprite;
      const spriteCount = int(b.take('sprite_count'));
      if (spriteCount !== undefined) clustlet.sprite_count = spriteCount;
      const animation = int(b.take('animation'));
      if (animation !== undefined) clustlet.animation = animation;

      const trail = b.take('trail');
      if (isTable(trail)) {
        const t = new Tape(trail);
        const trailSprite = trailValue(t.take('sprite'));
        if (trailSprite && trailSprite.includes('/')) {
          packArt.cluster_trail = trailSprite;
        } else if (trailSprite !== undefined) {
          clustlet.trail = trailSprite === '0' ? 'none' : trailSprite;
        }
        const trailPower = int(t.take('power'));
        if (trailPower !== undefined) clustlet.trail_power = trailPower;
        const trailSpeed = int(t.take('speed'));
        if (trailSpeed !== undefined) clustlet.trail_speed = trailSpeed;
        const trailBubbles = int(t.take('bubbles_per_second'));
        if (trailBubbles !== undefined) clustlet.trail_bubbles = trailBubbles;
      }

      const explosion = b.take('explosion');
      if (isTable(explosion)) {
        const e = new Tape(explosion);
        const damage = int(e.take('power'));
        if (damage !== undefined) clustlet.damage = damage;
        const bias = int(e.take('bias'));
        if (bias !== undefined) clustlet.explosion_bias = bias;
        const push = int(e.take('push_pct'));
        if (push !== undefined) clustlet.explosion_push_pct = push;
        const expVariation = int(e.take('variation'));
        if (expVariation !== undefined) clustlet.explosion_variation = expVariation;
      }

      const speed = int(b.take('speed_pct'));
      if (speed !== undefined) clustlet.speed_pct = speed;
      const gravity = int(b.take('gravity_pct'));
      if (gravity !== undefined) clustlet.gravity_pct = gravity;
      const wind = int(b.take('wind_pct'));
      if (wind !== undefined) clustlet.wind_pct = wind;
      const countdown = int(b.take('countdown'));
      if (countdown !== undefined) clustlet.countdown_ms = countdown;
      const fuse = int(b.take('fuse'));
      if (fuse !== undefined) clustlet.fuse = fuse;
      const flightSound = int(b.take('flight_sound'));
      if (flightSound !== undefined) clustlet.flight_sound = flightSound;

      const explosionSound = b.take('explosion_sound');
      if (isTable(explosionSound)) {
        const s = new Tape(explosionSound);
        const enabled = bool(s.take('enabled'));
        if (enabled !== undefined) clustlet.explosion_sound_enabled = enabled;
        const sound = int(s.take('sound'));
        if (sound !== undefined) clustlet.explosion_sound = sound;
        const before = int(s.take('before'));
        if (before !== undefined) clustlet.explosion_sound_before = before;
      }

      const explodeOnSpace = bool(b.take('explode_on_space'));
      if (explodeOnSpace !== undefined) clustlet.explode_on_space = explodeOnSpace;
      const endsOnContact = mask(b.take('ends_on_contact'));
      if (endsOnContact !== undefined) clustlet.ends_on_contact = endsOnContact;

      const bounce = b.take('bounce');
      if (isTable(bounce)) {
        const bo = new Tape(bounce);
        const bounciness = int(bo.take('bounciness'));
        if (bounciness !== undefined) clustlet.bounciness = bounciness;
        const keep = int(bo.take('terrain_keep_speed_pct'));
        if (keep !== undefined) clustlet.bounce_terrain_keep_speed_pct = keep;
        const sound = int(bo.take('sound'));
        if (sound !== undefined) clustlet.bounce_sound = sound;
        const sides = int(bo.take('contact_sides'));
        if (sides !== undefined) clustlet.bounce_contact_sides = sides;
        const reverse = int(bo.take('extra_reverse_chance_pct'));
        if (reverse !== undefined) clustlet.bounce_extra_reverse_chance_pct = reverse;
        const bounces = int(bo.take('max_bounces'));
        if (bounces !== undefined) clustlet.bounces = bounces;
        const hits = mask(bo.take('hits'));
        if (hits !== undefined) clustlet.bounce_hits = hits;
        const explosion = bo.take('explosion');
        if (isTable(explosion)) {
          const e = new Tape(explosion);
          const power = int(e.take('power'));
          if (power !== undefined) {
            clustlet.bounce_explode = power > 0;
            clustlet.bounce_power = power;
          }
          const bias = int(e.take('bias'));
          if (bias !== undefined) clustlet.bounce_explosion_bias = bias;
          const push = int(e.take('push_pct'));
          if (push !== undefined) clustlet.bounce_explosion_push_pct = push;
          const expVariation = int(e.take('variation'));
          if (expVariation !== undefined) clustlet.bounce_explosion_variation = expVariation;
        }
      }

      const homing = b.take('homing');
      if (isTable(homing)) {
        const h = new Tape(homing);
        const kind = homingKind(h.take('kind'));
        // The clustlet's own field is the narrower `off | lock | dodge`.
        if (kind === 'off' || kind === 'lock' || kind === 'dodge') clustlet.homing = kind;
        const sprite = text(h.take('sprite'));
        if (sprite !== undefined) clustlet.homing_sprite = Number(sprite) || 0;
        const animation = int(h.take('animation'));
        if (animation !== undefined) clustlet.homing_animation = animation;
        const arm = int(h.take('arm'));
        if (arm !== undefined) clustlet.homing_arm_ms = arm;
        const time = int(h.take('time'));
        if (time !== undefined) clustlet.homing_time_ms = time;
        const trail = h.take('trail');
        if (isTable(trail)) {
          const t = new Tape(trail);
          const sprite = int(t.take('sprite'));
          if (sprite !== undefined) clustlet.homing_trail_sprite = sprite;
          const power = int(t.take('power'));
          if (power !== undefined) clustlet.homing_trail_power = power;
          const speed = int(t.take('speed'));
          if (speed !== undefined) clustlet.homing_trail_speed = speed;
          const bubbles = int(t.take('bubbles_per_second'));
          if (bubbles !== undefined) clustlet.homing_trail_bubbles = bubbles;
        }
      }

      const roam = b.take('roam');
      if (isTable(roam)) {
        clustlet.roam = readRoam(roam, clustlet.roam ?? roamConfig);
      }
      const dig = b.take('dig');
      if (isTable(dig)) {
        clustlet.dig = readDig(dig, clustlet.dig ?? digConfig);
      }
      const contact = b.take('contact');
      if (contact === 'impact' || contact === 'bounce') clustlet.contact = contact;
      keep(['clusters', 'bit'], b.remaining);
    }
    keep(['clusters'], c.remaining);

    body.clustlet = clustlet;
  }

  // ---- sheep (roaming flight art) -----------------------------------------
  const sheep = tape.take('sheep');
  if (isTable(sheep)) {
    const s = new Tape(sheep);
    roamConfig = {
      ...roamConfig,
      flight_1: int(s.take('flight_1')) ?? roamConfig.flight_1,
      flight_2: int(s.take('flight_2')) ?? roamConfig.flight_2,
    };
  }

  // ---- native family groups ----------------------------------------------
  // `fires`, `arrow`, `baseball_bat`, `fire_punch`, `drill`, `jet_pack`,
  // `parachute` and `utility` are flat tables of scalars. They go straight into
  // the overrides, which is where the panels and the generator read them.
  const NATIVE_GROUPS: Record<string, string[]> = {
    fires: ['launch_power_pct', 'creates_projectile'],
    arrow: ['damage'],
    baseball_bat: ['damage', 'knockback_scale'],
    fire_punch: ['damage', 'knockback'],
    drill: ['duration_ms'],
    jet_pack: ['fuel'],
    parachute: ['wind_pct'],
    utility: ['effect'],
  };
  // `fires.type` / `method` / `subtype` are the family and behaviour selectors:
  // the archetype (`fireType`) and `specialSubtype` own them, so they are
  // consumed and dropped rather than left in `recordExtra`, where they would be
  // written after the record and override the archetype's own subtype.
  const SELECTORS: Record<string, string[]> = {
    fires: ['type', 'method', 'subtype'],
  };
  for (const [group, fields] of Object.entries(NATIVE_GROUPS)) {
    const table = tape.take(group);
    if (!isTable(table)) continue;
    const g = new Tape(table);
    for (const field of fields) {
      const value = g.take(field);
      if (value !== undefined && value !== null) overrides[`${group}.${field}`] = value;
    }
    for (const field of SELECTORS[group] ?? []) g.take(field);
    keep([group], g.remaining);
  }

  // ---- on_select (a cursor record's teleport flag) ------------------------
  const onSelect = tape.take('on_select');
  if (isTable(onSelect) && onSelect.cursor === true) teleport = true;

  const remaining = tape.remaining;
  const recordExtra: LuaTable = { ...(remaining ?? {}) };
  for (const [key, value] of Object.entries(leftovers)) {
    const existing = recordExtra[key];
    recordExtra[key] = isTable(existing) && isTable(value) ? { ...existing, ...value } : value;
  }

  return {
    body,
    action,
    burst,
    roamConfig,
    digConfig,
    fireConfig,
    recordOverrides: overrides,
    recordExtra: Object.keys(recordExtra).length > 0 ? recordExtra : undefined,
    packArt,
    teleport,
  };
}
