/**
 * The claim-table hooks and the keys the editor regenerates, as data.
 *
 * A claim key is **single-valued**: `on_explode`, `on_fire`, `on_click` and the
 * rest are one function each, and a second write replaces the first instead of
 * adding to it (AGENTS.md section 2). So the editor and an imported bundle
 * cannot both own one, which is why the reader has to say what it dropped
 * (`unmodelledClaimKeys`) and why carrying these bodies is a merge problem
 * rather than a copy (`reqs/custom_code_import_plan.md`).
 *
 * `wa.on.*` handlers are the opposite: the engine keeps a list and runs every
 * entry, so those are carried, never merged. They are listed separately
 * (`WA_ON_EVENTS`), because what decides how one must be carried is its options
 * argument, not its body.
 *
 * The counts are the installed corpus (255 weapon modules under
 * `WormForge/Mods`, SDKs and `lib/` folders excluded, from
 * `bun run tools/scan_mods.ts`). They decided the order of the carrying work:
 * `on_fire` and `on_explode` are the two that matter, `on_proximity` and
 * `on_select` are in the engine's key set and appear nowhere.
 */
export const CLAIM_HOOKS = [
  { key: 'on_fire', count: 42, takes: 'ev: x, y, weapon, worm, missile?, vx?, vy?' },
  { key: 'on_explode', count: 38, takes: 'ev: x, y, weapon, worm, missile?, vx?, vy?' },
  { key: 'on_click', count: 10, takes: 'ev: x, y, worm (the clicked point, before the shot is spent)' },
  { key: 'on_shot', count: 5, takes: 'ev, the shot a `fire_seq` burst takes' },
  { key: 'on_done', count: 2, takes: 'ev, when the round is finished' },
  { key: 'on_place', count: 1, takes: 'ev, the placed object' },
  { key: 'on_transport', count: 1, takes: 'ev, the teleported worm' },
  { key: 'on_proximity', count: 0, takes: 'ev, a worm near the round' },
  { key: 'on_select', count: 0, takes: 'a table of behaviours, not a function' },
] as const;

export type ClaimHookKey = (typeof CLAIM_HOOKS)[number]['key'];

export const CLAIM_HOOK_KEYS: readonly ClaimHookKey[] = CLAIM_HOOKS.map((hook) => hook.key);

/**
 * Claim keys the import already carries, so reporting them as "not carried"
 * would be a lie.
 *
 * `on_explode` is carried into the custom Lua box: `customExplodeBody` keeps the
 * part of the body that is not one of the editor's own calls. `on_fire` is
 * deliberately absent, because only the `fire_seq` burst inside it is modelled;
 * the caller passes it in `absorbed` once that burst has been reconstructed, so
 * an author's own hand-written `on_fire` is reported instead of vanishing.
 */
export const CLAIM_KEYS_CARRIED = ['on_explode'] as const;

/**
 * Claim keys that hold data rather than a callback, all regenerated from a panel
 * or from the record mapper: the sheets, the sounds, the hold table, the donor.
 */
export const CLAIM_KEYS_MODELLED = [
  'name',
  'copy_from',
  'wep',
  'panel_icon',
  'panel_icons',
  'icon',
  'sprites',
  'sprite_overrides',
  'sounds',
  'params',
  'truecolor',
  'cluster',
  'sprite',
  'sheep_sprites',
  'worm_sprites',
  'worm_sprites_animate',
  'worm_sprites_toggle',
  'worm_sprites_team_tint',
  'gpu_worm_sprites',
  'worm_art',
  'mole_dig_rotation',
  'hold',
  'hold_as',
  'fires',
] as const;

/**
 * Claim behaviour flags (`spec/lua_sdk/verbs.md`) that affect runtime selection,
 * firing or cave availability without carrying a callback body or record table.
 * The generator does not re-emit these keys on Claim, so imports surface them.
 */
export const CLAIM_FLAG_KEYS = [
  'actor',
  'eat_fire',
  'click_finish',
  'click',
  'fire_repeat',
  'stock_fire_choice',
  'airborne',
  'available_in_caves',
  'is_weapon',
] as const;

/**
 * The engine's `wa.on.*` events, and the one fact that decides how a carried
 * registration must be carried: **only `worm_message` takes options, and only
 * `body_move` takes `kinds`** (`api.rs`'s `bind_on`: any other second argument is
 * an error at load). So a carried `worm_message` without its `msgs` filter still
 * loads and runs on every message instead of the one it was written for, which is
 * the quiet failure this column exists for.
 *
 * `count` is the installed corpus (the same 255 modules as above).
 * `gravity_before`, `gravity_after`, `oil_explode` and `skim` are bound by the
 * engine and appear in none of them.
 */
export interface WaOnEvent {
  event: string;
  /** What the handler is called with (`dispatch.rs`, event by event). */
  takes: string;
  /** The options table the engine accepts as the second argument, if any. */
  options?: { key: 'msgs' | 'kinds'; shape: string; note: string };
  count: number;
}

export const WA_ON_EVENTS: readonly WaOnEvent[] = [
  {
    event: 'worm_message',
    takes: 'worm (returning "eat" swallows the message)',
    options: {
      key: 'msgs',
      shape: '{ msgs = { wa.msg.FIRE_WEAPON } }',
      note: 'at least one message number; without it the handler runs on every message',
    },
    count: 59,
  },
  {
    event: 'missile_frame',
    takes: 'm: x, y, vx, vy, msg, phase, weapon, sprite, collision_mask',
    count: 34,
  },
  { event: 'draw', takes: 'nothing (per viewer; nothing can be read back)', count: 30 },
  { event: 'turn_start', takes: 'event: worm, active (absent when the worm died first)', count: 20 },
  { event: 'turn_end', takes: 'event: worm, active', count: 14 },
  { event: 'hurt', takes: 'event: worm, from, attacker, by, amount (may return a new amount)', count: 7 },
  { event: 'hud', takes: 'nothing', count: 6 },
  { event: 'death', takes: 'event: worm, cause', count: 4 },
  { event: 'contact', takes: 'worm, other, kind', count: 3 },
  { event: 'weapon_grant', takes: 'event: worm, weapon, source', count: 3 },
  { event: 'turn_cleanup', takes: 'event: worm, active', count: 3 },
  { event: 'turn_retreat', takes: 'event: worm, active', count: 2 },
  {
    event: 'body_move',
    takes: 'body (a worm, missile, mine, crate, oil, grave or arrow about to move)',
    options: {
      key: 'kinds',
      shape: '{ kinds = { "worm", "missile" } }',
      note: 'every kind when omitted: correctness is the same, the cost is not',
    },
    count: 2,
  },
  { event: 'gravity_before', takes: 'motion: x, y, vx, vy (before stock gravity)', count: 0 },
  { event: 'gravity_after', takes: 'motion: x, y, vx, vy (after gravity, wind and damping)', count: 0 },
  { event: 'oil_explode', takes: 'event: x, y', count: 0 },
  { event: 'skim', takes: 'event: x, y', count: 0 },
];

export const WA_ON_EVENT_NAMES: readonly string[] = WA_ON_EVENTS.map((entry) => entry.event);

/** The events whose second argument the engine accepts, in one lookup. */
export const WA_ON_EVENTS_WITH_OPTIONS: ReadonlySet<string> = new Set(
  WA_ON_EVENTS.filter((entry) => entry.options).map((entry) => entry.event),
);
