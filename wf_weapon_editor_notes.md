# WormForge Weapon Studio, Engineering Notes (API 4.0)

### Cluster bits ask the builder a frame too early

The bits-only ribbon trail was reported from play: the round flew bare as
intended, and so did every cluster bit. The identity was not wrong, the timing
was. `sb.flight` and the ribbon trail both register `wa.on.missile_frame`, the
engine appends handlers to a list and calls them in registration order, and the
generator wrote the trail hook **before** the `sb.flight` call. On a missile's
first frame the trail therefore asked `sb.role(m.id)` before the builder had seen
it, got `nil`, and its fallback read that as "not a bit" (`trail_live()` is false
when the round itself was never trailed), marked the id `seen`, and never asked
again. The two test-pack weapons that cover the feature (WF 51 bits-only trail,
WF 52 round-only burst) also had a builder with no bit role, so every frag
answered `main` and neither case could have passed in game.

Two changes, both required:

- **The trail hook is emitted after `sb.flight`**, so the identity is already
  there when it asks on the first frame (no missing first segment on the round).
- **The hook waits when the answer is `nil`** instead of falling back. A burst
  listed on the round's last frame is left undecided for one frame on purpose
  (the same frame can be a fire sequence's second shot), so the hook returns
  without marking the missile seen and asks again next frame. The PX fallback
  now only runs when the installed library has no `sb.role`, or when the builder
  owns the round art but leaves the bits to WA and therefore calls every frag
  `main`, where it is the better answer available.

WF 51 and WF 52 now give the builder a bit role (`bitFlight`), and the README's
`sb.role` section says the ordering rule out loud. The trail card also says when
Cluster Bits cannot be told apart (builder off, no bit art, or no cluster burst),
instead of looking configured and drawing nothing. `check_generator_edges` pins
the emission order, the wait line and both fallbacks; `tools/lua/harness_trail_bits.py`
drives the generated WF 51 file through the real builder and trail with a
`missile_frame` list dispatched in order, and fails on the bits when the wait line
is deleted.

### An export now carries the effects SDK it was built against

The library used to be a dependency and nothing more: `dependencies =
["effects.sdk"]` plus a hope that the player's copy was 0.4.2. It usually is
not, and the difference shows up as silence rather than an error: 0.3.5 threw
on `spark = true` and took the whole `on_explode` with it, the ring rotation and
the reach direction did not exist, and an explicit `reach = false` came back on
with the preset's bolt count. Shipping an update to every player by hand does
not scale, so the export ships it: `src/data/effectsSdk.ts` holds the manifest
and the three Lua modules as `?raw` imports of `spec/lua_sdk/effects_sdk/`, and
the sheets the manifest declares are those same `spec/` PNGs, resolved as URLs
and fetched as bytes when the ZIP is written. Nothing is copied into `public/`.

Three rules make it safe:

- **Only when the file requires it.** `usesEffectsSdk(luaCode)` looks for
  `wf-lib/effects/`, which the generator writes for a trail, a burst, a blast
  replacement, an emitter or a carried helper. A plain weapon ships no library
  (a stock-grenade export is 11 files, 8 of them the builder).
- **The catalogue's own folder.** `wf-lib/effects_sdk/` is where the mod loader
  installs the pack, so extracting over an existing copy rewrites it in place
  instead of creating a second bundle. That matters more than it sounds: the
  engine builds `by_id` over every installed manifest and refuses a duplicate id
  outright (`bundle effects.sdk is installed more than once; keep one copy`), so
  a differently named copy would take the player's whole mod list down, not just
  this weapon.
- **The art travels with the declarations.** A `[sprites]` entry whose file is
  missing fails the install, and the emitter draws its spark and glow through
  `fx.SPARK`/`fx.BLOB`, which are those entries. So the sheets the manifest
  declares (four draw sheets and the ten-frame spark, about 16 KB) are written
  whenever the library is, from the SDK's own files: the light way to satisfy
  the engine, not a second copy of PX's art in the repo.

What it does not solve: a player who already has `effects.sdk` in a *different*
folder still ends up with two copies, and the loader says so. Ours lands on the
catalogue path, so the normal case (installed from the catalogue, updated by
unpacking an export) is one copy with our code in it.

### The identity was computed and thrown away

The builder has classified every missile since the bit role landed: on the one
frame where the answer exists (`m.sprite` before it is zeroed, `m.is_bit`, or a
`roles` match), it decides `main` or `bit` and caches it per `m.id`. Every other
consumer then guessed again, differently: the ribbon trail used PX's live-ribbon
heuristic ("a first-seen round with a ribbon already running is a bit"), the
editor's own UI offered only "main or every part", and an explosion burst had no
choice at all.

`sb.role(id)` publishes the answer, and keeps it past the despawn the way
`sb.heading` does, because a claim `on_explode` runs around the frame the missile
leaves. With it:

- `ribbonTrail.target` is `main` / `bit` / `all`, and the generated hook asks
  `sb.role` first, falling back to the PX heuristic only when the builder is not
  installed for that weapon. The generated Lua names `sb` only when the builder
  declared it: wfcheck correctly calls an undeclared `sb` an undefined global, so
  the same code that reads the identity has to know whether it exists.
- `explosionEffect.target` is `all` / `main` / `bit`, a guard at the top of the
  merged claim `on_explode`. One claim hook carries the burst, the custom WAV,
  any custom `on_explode` and the terrain stamp (which is appended last so a
  custom early `return` skips it), so the choice is made once, before all of
  them, and the card says so. With the builder off nothing can tell the parts apart, so the
  hook runs for every explosion and the Lua carries a comment saying why.

Two boundaries worth remembering. The identity is **per missile id and per
weapon**: `sb.role` answers `nil` for a missile this builder never classified
(another weapon, or one it left to WA), and the trail's fallback is what runs
then. And the memory is bounded at 256 ids, like `drawn_by`, so a very long
session can forget a very old round; a `nil` role falls back rather than
dropping the effect, which is the right way round for both consumers.

### The second hand was the size of the gun

`extra_hand.size` is the quad layer's cell, and it fell back to the *hold
sheet's* width when the hand had no art of its own:

    size = extra.sheetWidth or h.sheetWidth or 60

The second hand then draws at that many pixels (`x_half = size * scale * base /
2`), so a weapon with a 128 px hold sheet drew a 128 px support hand while the
preview, which draws the reused PX hand sheet at its natural 60, showed the right
size. The cell is a **hand** cell: 60 px, the engine's own `hand_size`, unless the
hand uploaded its own art, in which case its own sheet size is what the preview
draws too.

### A key can step its opacity

`alpha` interpolated between keys, so a clip whose last pose returns the weapon
to the worm faded out on the way there and back in at the end. `fade = false` on
a key is the frame rule applied to opacity: hold the previous key's alpha for the
segment, land on this key's value at the key. Both halves read it (`evalClip` and
`clip_pose`), the generator writes it only where it is set, the importer reads it
back, and the key table has its own Fade column. WF 47's return key is
`alpha = 0.6, fade = false`, so the cut is visible and the return is not.

## Overview & Architecture
This application is a modern, full-featured TypeScript & React replacement for the legacy/stale WormForge weapon creator.

### Core Goals & Capabilities
1. **Full API 4.0 & format_version 2 Compliance**:
   - Modern `wa.weapons.replace{ ... }` component return structure with `defaults = { ammo, delay, crate, ... }` and `install = function() ... end`.
   - Mod layout with `mod.toml`, `weapons/<mod_name>.lua`, and `profiles/<Profile Name>.toml`.
   - `[sprites."path"]` declarations for custom imported sprites with `fps`, `frames`, `play`.
   - `dependencies = ["wf.sdk"]` automatically declared when `hold` / `holds.PX_POSTURE` is utilized.

2. **Project X `.wep` Binary Importer**:
   - Parses the binary header (`0x06, 0xDD, 0xBB, 0x5A`).
   - Reads strings at `0x1E4` (name length prefix + Latin-1 characters).
   - Extracts 0x1D0 bytes weapon record slab (`0x04` to `0x1D4`).
   - Decodes all firing methods, missile/bounce/homing/cluster parameters, gun hitscan, and mine proximity settings.
   - Computes differences against stock weapon records (`stock.<slot>`) to generate clean, minimal Lua tables without boilerplate noise.

3. **Authentic Worms Armageddon Physics & Clustlet Simulator**:
   - Map: Loaded directly from `spec/pre_weapon_preview.png` (300x300 native authentic WA terrain chunk).
   - Worm placement: Anchor at `(187x, 164y)` standing on the cliff ledge facing right (per spec).
   - 50 Hz fixed-timestep physics loop (`TICK_RATE = 50`, `dt = 20ms` accumulator):
     - Base stock gravity: `WA_GRAVITY_BASE_TICK = 0x3d70 / 0x10000 ≈ 0.23999 px/tick²` (`CM+0x22c` from `wa_engine_reverse_engineered`).
     - Scaled by `(bodyConfig.gravity_pct / 100)`.
     - Full power throw speed: `WA_THROW_MAX_SPEED_TICK = 24 px/tick` (1200 px/s).
     - Scaled by `(launchPowerPct / 100)`.
     - Launch spawn offset: `WA_THROW_SPAWN_OFFSET = 24 px` along aim direction from worm release origin.
     - Environment wind: `windForce = 0.04 * (bodyConfig.wind_pct / 100) * (windPct / 100)`.
   - Terrain pixel mask & collision:
     - Real-time 300x300 alpha mask evaluation.
     - Continuous sub-stepping along `(vx, vy)` vector to prevent tunneling through thin terrain.
     - 5x5 neighborhood gradient surface normal reflection: `v' = (v - 2(v · n)n) * bounciness * keep_speed`.
     - Immediate impact detonation if `action !== 'bounce'` or `ends_on_contact.land`.
   - Real-time crater excavation:
     - Blasts dynamic craters out of the terrain canvas with `destination-out`.
     - Radius formula: `r = min(45, max(6, power * 0.45))`.
     - Updates the cached collision mask in real-time.
     - "Reset Map" button instantly restores the pristine `pre_weapon_preview.png` terrain.
   - Clustlet scatter & secondary explosions:
     - When `burst === 'clusters'` (or `bodyConfig.cluster`), emits `clustletConfig.count` clustlet bodies.
     - Upward spread fan centered at `-π/2` with `spread` degrees.
     - Clustlets inherit launch power, gravity %, bounciness, and fuse.
     - Clustlets bounce against remaining terrain and detonate into secondary craters.
   - Spreading incendiary fire:
     - When `burst === 'fire'`, emits flames with `burn_time_ms`, resting ground decay, and scorch marks.
   - Interactive mouse controls:
     - Click and drag directly on the canvas to adjust elevation angle and charge power.
     - Real-time trajectory prediction arc.
     - Zoom toggle: 1x (300px), 2x (600px), 3x (900px) with `image-rendering: pixelated`.

4. **Worm Hold & Sprite Builder Preview (Native Assets)**:
   - Uses genuine Worms Armageddon posture strip (`aim.png`, 32 frames of 60x60) and authentic hand radius textures (`hand_rad_lower.png`, `hand_rad.png`, `hand_rad_upper.png`).
   - Angles scrub from 0 (aimed low/down) to 16 (horizontal level) to 31 (aimed straight up).
   - Real-time weapon positioning math: `x = cx - sin(angle) * weapRadius`, `y = cy + cos(angle) * weapRadius`, `angle + weapRotation`, with hand blitted atop matching `handType`.
   - Supports 2x, 3x, 4x, 5x pixelated zoom and horizontal flip (Left/Right facing).
   - Generates modern single-sheet PNG output with `holds.PX_POSTURE` and `dependencies = ["wf.sdk"]` (no legacy GIF conversions).

5. **Missile Action Mutually Exclusive Architecture**:
   - Per `weapon-records.md`, `action` is a single selector: `"none" | "bounce" | "homing" | "roam" | "dig"`.
   - Prevents table collisions: only the selected action emits its table in Lua (`bounce = { ... }`, `homing = { ... }`, `roam = { ... }`, or `dig = { ... }`).
   - Burst payloads (`"nothing" | "clusters" | "fire"`) are distinct from actions and configure either pure blast, native clustlet scatter, or fire spreading generations.

6. **Projectile / Missile Artwork & Flight Sprite Builder (`px_sprite_builder.lua`)**:
   - Custom 32x32 PNG icon upload with instant preview and export to `sprites/<mod_name>/icon.png`.
   - Dedicated **Missile Flight Sprite Builder** section on the Hold & Sprite Builder tab directly beneath the worm posture preview.
   - Emits `missile_sprite = { sheet = "...", anim = "...", frames = ..., anim_speed = ..., spin = ..., scale = ..., mirror = ..., hide = true }` and `mod.toml` sprite declarations.
   - Exact implementation of `px_sprite_builder.lua` (`sb.flight`):
     - `ANIM_TYPE`:
       - `track` (2): points along trajectory velocity vector (`-wa.math.atan(vx, vy) - math.pi`)
       - `rotation` (3): speed-based dynamic rotation turn (`prev_rot + spin * 0.5 * (vx * 0.15 + abs(vy) * 0.01 * sign(vx))`)
       - `slow` (1): steady spin turn with `ANIM_SPEED.slow = 0.5`
       - `medium` (1): steady spin turn with `ANIM_SPEED.medium = 0.8`
       - `fast` (1): steady spin turn with `ANIM_SPEED.fast = 1.35`
       - `none` (5): fixed upright angle (`rot = 0`)
     - Cyclical frame animation (`M.cyclical_frame`): `phase = phase + anim_speed * 30 / 1000`, wraps at 0.99, `frame = floor(phase * num_frames) % num_frames`.
     - Facing mirroring: `b.facing = mirror and (vx < 0 and -1 or 1) or 1`.
     - Stock hiding: `hide = true` (`m.sprite = 0` hides native Worms Armageddon missile graphic).
   - Interactive Live Canvas preview:
     - Parabolic Arc flight simulation, circular orbit, and static velocity vector modes.
     - Play/Pause toggle, speed scrubber, angle adjustment, and pixelated zoom (2x to 6x).
     - 1-click test presets: Chilli Bomb (Tumble), Shadow Bolt (Track), Girder Launcher (Fast Spin), Bazooka Rocket.

7. **Gated Custom Lua Callbacks**:
   - Custom callbacks (`on_explode`, simulation hooks) are explicitly gated behind an unchecked-by-default checkbox (`enableCustomLua`).
   - Built-in templates:
     - Moon Grenade (excavating 3 craters in the ground below burst)
     - Chilli Bomb (scripted 5-child upward scatter launcher via `wa.weapons.launch`)
   - When disabled, no extraneous callback tables are emitted in the generated Lua file.

8. **Mod Pack Exporter (Zip)**:
   - Exports complete ZIP archive matching WormForge directory layout:
     ```text
     <mod_name>/
       mod.toml
       weapons/<mod_name>.lua
       weapon/<mod_name>.lua (alias)
       weapons.lua (alias)
       profiles/<Weapon Name>.toml
       profile/<Weapon Name>.toml (alias)
       sprites/<mod_name>/
         icon.png (if custom)
         hold.png (if custom hold art)
         missile.png (if custom flight art)
     ```
   - Ready to drop into `WormForge/Mods/` next to `wf-lib`.

9. **Decluttered & Professional UI Layout**:
   - Clean top navigation with three modes:
     - `1`: Weapon Record (Identity, Firing Archetypes, Record Schema)
     - `2`: Hold & Sprite Builder (Worm posture, hold art, missile flight preview)
     - `3`: Bundle Code (Interactive viewer for `weapons/*.lua`, `mod.toml`, `profiles/*.toml`)
   - Breadcrumb status bar with icon thumbnail, 1-click copyable ID badge, donor/slot/action/payload pills, and API 4.0 status.
   - Clean, non-cluttered cards, accessible typography, dark/light theme toggle.

10. **Gemini Antigravity Agent Integration (Interactions API)**:
   - Fullstack architecture with Express `server.ts` mounting Vite in development.
   - Server-side endpoint `POST /api/antigravity` calling `@google/genai` Interactions API:
     - Uses `agent: "antigravity-preview-09-2026"` in a remote sandboxed environment.
     - Intelligent fallback to `gemini-3.8-flash` via Interactions API if agent sandbox quotas or permissions are reached.
     - Synthesizes valid WormForge API 4.0 weapon record schemas, enforces single-action and burst constraints, and generates custom Lua simulation callbacks when requested.
     - Client UI (`GeminiAntigravityModal.tsx`) displays proof of work (agent reasoning, tool steps) and allows 1-click assimilation into the editor.

## 2026-11-09, sprite-builder animations and separate collision masks

**Scope correction:** the code-editor work (`Worm-Forge-Lua-Editor` parser /
`undefined-global`) is out of scope until the weapon editor is finished. The
two code-editor edits made earlier were reverted with `git checkout --`; that
app is untouched again.

### Missile flight animation (luaGenerator.ts)

The old generator emitted a top-level `missile_sprite = { ... }` table. The
engine does not read that table, so flight animations did nothing. It also
mapped the sprite-builder `anim` (`track` / `rotation` / `slow` / `medium` /
`fast`) onto `missile.animation` (WA's native selector), and emitted
`spin = true` (a boolean) where `px_sprite_builder.lua` does arithmetic on
`spin`. That is a runtime error, not just a wrong value.

Now the generator emits the real `wf-lib/px_sprite_builder` call:

```lua
local sb = require("wf-lib/px_sprite_builder")
...
wa.weapons.replace{
  sprites = { "sprites/<mod>/missile.png" },
  ...
}
sb.flight(ctx, {
  weapon = ctx.id,
  sheet = "sprites/<mod>/missile.png",
  anim = "fast",
  cyclical = 8,
  anim_speed = 3.0,
  mirror = false,
})
```

- `anim` stays PX's `ANIM_TYPE` string; it is no longer written to the
  record's native `animation`.
- `cyclical` is the sheet frame count (`frames > 1`).
- `spin` is always a number (`spinRate`), never `true`.
- `missile.animation` is emitted only when the user sets it explicitly.
- The flight sheet is registered through `wa.weapons.replace`'s `sprites`
  field, as the SDK README requires.
- `mod.toml` declares `dependencies = ["wf.sdk"]` when either the hold or the
  flight sprite builder is enabled.
- The Hold tab's generated-code preview now shows the `sb.flight` call.

### Separate collide / bounce flags

`missile.ends_on_contact` (what stops the projectile) and
`missile.bounce.hits` (extra targets the bounce action reacts to) are now two
independent grids in the Collision tab. The generator emits both as named
boolean tables; `bounce.hits` is written inside the `bounce` table only when
Action is Bounce, matching `weapon-records.md`.

Also emitted now: `missile.speed_pct`, `missile.alarm_worms`, and the
`ends_on_contact` table (the old generator dropped it entirely).

### Validation

- `npx tsc --noEmit -p tsconfig.json`, clean.
- `npx vite build`, succeeds.
- Generated Lua for a custom fast-spin missile checked with `wfcheck --stdin`
, no findings.

### Follow-up: builder-off must not touch the stock missile

`missileSprite.hideStock` defaults to `true`, and the old generator applied it
even when `missileSprite.enabled` was false. Every weapon therefore emitted
`missile.sprite = 0`, hiding WA's missile sprite with no follower to replace it.
The record now only reads `hideStock` / `stockSprite` when the builder is
enabled. A builder-off project inherits the donor's sprite untouched.

## 2026-11-09, .wep import no longer rewrites the weapon

### What was breaking

`parseWepBinary` was reading missile-body offsets for every family, and several
of those offsets were wrong even for missiles:

- `damage` and `push_pct` were swapped (`0x50` is push, `0x54` is power).
- `gravity`/`wind`/`bounce` used `0x70`/`0x74`/`0x78`; the missile body has
  them at `0x84`/`0x7C`/`0xAC`.
- Cluster bit power/gravity/wind/bounce used pre-shift offsets; the bit slab is
  `+0xC4` (`power 0x118`, `gravity 0x148`, `wind 0x140`, `bounce 0x170`).
- Guns, mines, strikes and specials were decoded with missile offsets, so an
  imported gun wrote missile damage/gravity over the gun record.
- `handleApplyWepImport` merged the previous project's `recordOverrides` and
  custom Lua into the imported weapon, so old edits survived the import.

### The .wep path

`WeaponProject` now carries:

```ts
useWepFile?: boolean;
wepFile?: File;
wepFileName?: string;
wepBaseline?: WepBaseline;
```

When `useWepFile` is true, `generateLuaCode` emits:

```lua
wa.weapons.replace{
  wep = "weps/petrol_bomb.wep",
  ...
}
```

instead of `copy_from` (the engine refuses both together). `modExporter` writes
the original file to `<mod>/weps/<file>.wep`. The import modal defaults the new
"Use .wep weapon file" checkbox to on, and `WeaponSettings` exposes the same
toggle so it can be switched later without re-importing.

The decoded model is stored as `wepBaseline`. The generator compares the live
editor fields against it and emits only actual edits as named overrides. An
untouched .wep therefore inherits its complete native record; changing damage,
gravity, action, bounce, clustlets, etc. in the editor still works because the
changed field is written on top of the file. This also preserves zero values
(e.g. a 0-damage record) by using `??` instead of `||` in the record writers.

### Other record fixes

- The parser now classifies `(fire type, method)` exactly as
  `Family::of` does: gun, arrow, spray, mine, strike, special, missile.
- `arrow`, `spray` and `special` no longer receive invalid `missile = {...}`
  tables.
- `handling = { shots, retreat, remember_selection, available_in_caves,
  ends_turn }` is emitted from record overrides.
- Importing a weapon resets stale `recordOverrides`, custom Lua and the custom
  Lua toggle instead of merging them into the new weapon.

### Validation

- `tsc --noEmit` clean; `vite build` succeeds.
- All 43 `.wep` files under `WormForge-mods` parse successfully.
- Generated Lua for a .wep import, a gun fallback and a mine fallback passes
  `wfcheck --stdin` with no findings.
- Playwright: import `petrol_bomb.wep`, apply, verify `wep = "weps/..."` and no
  `copy_from`; uncheck/re-check the settings toggle; export the ZIP and confirm
  `weps/petrol_bomb.wep` is inside.

## 2026-11-09, clustlet actions and the remaining .wep body values

The cluster submunition was previously hard-coded to a single body: `bit`
only carried damage/gravity/wind/bounciness/fuse, its action was inferred from
the parent, and bounce explosion power reused the bit damage. Imported records
lost `clusters.bit` action, bounces, trail, sprite count, emission angle and
power variation because the parser never decoded them.

### Clusters (`clusters` / `clusters.bit`)

- Added an explicit `clusters.bit.action` choice: Impact (`none`), Bounce or
  Homing. Homing overrides contact and emits `bit.homing = { kind, arm, time }`.
- `bit.bounce` now carries independent `bounciness`, `max_bounces` and
  `explosion.power`; the bounce blast no longer reuses `bit.explosion.power`.
- Added `clusters.angle`, `clusters.power_variation_pct`,
  `clusters.bit.sprite_count`, `bit.trail.sprite` and the full bit sprite id.
- The `.wep` parser decodes the child body at `+0xC4`:
  `0x120` sprite_count, `0x124` sprite, `0x12C` trail, `0x140` wind,
  `0x148` gravity, `0x150` fuse, `0x168` action, `0x188` homing kind,
  `0x18C` homing arm / bounce explosion power, `0x190` homing time,
  `0x194` max bounces. Bounce explosion power and homing arm share `0x18C`,
  selected by the bit action.
- Generator writes `sprite_count` and uses `bounce_power` for
  `bit.bounce.explosion.power`.

### Advanced record tab

Added a new **Advanced** sub-tab under Weapon Record with fields that `.wep`
files carry but the editor did not expose:

- `missile.explosion.bias`, `missile.explosion.variation`,
  `missile.random_motion`, `missile.collision_shape`.
- `missile.explosion_sound = { enabled, sound, before }`.
- Bounce: `contact_sides`, `extra_reverse_chance_pct`,
  `bounce.explosion = { bias, push_pct, power, variation }`, `sound`.
- Homing: `homing.sprite`, `homing.animation`, and
  `homing.trail = { sprite, power, speed, bubbles_per_second }`.

The parser now decodes all of these (including `missile.sprite`,
`missile.animation`, `missile.flight_sound`, `missile.launch_sound`,
`missile.ends_on_contact`, `missile.bounce.hits`, `missile.impact_particles`,
`missile.alarm_worms` and the dry trail). Numeric collision words are converted
to the named masks with unknown bits preserved in `extra_bits`, so the
baseline diff stays faithful and an imported `.wep` is not rewritten unless the
user edits a field.

### Validation

- `tsc --noEmit` clean; `vite build` succeeds.
- `wfcheck --stdin` reports no findings for:
  - cluster bit in impact, bounce and homing modes;
  - the Advanced tab with edited variation/random-motion/contact-sides values;
  - `petrol_bomb.wep` with a changed bit bounce and `random_motion`.
- Playwright confirmed the imported advanced values (e.g. `security_grenade.wep`
  → bias 10, collision shape 2, contact sides 8, bounce sound 113) and that
  editing one field emits only that override.

### Gun, mine and strike fields

The **Gun / Mine Specifics** tab now covers the rest of those families instead
of only bullets/spread/proximity/count:

- Gun: `shot_interval_ms`, `burst_size`, `burst_spread_deg`, `hits`,
  `explosion = { bias, push_pct, variation }`, `impact_effect`.
- Mine: `arm`, `fuse`, `detects`, `explosion = { bias, push_pct }`.
- Strike: `spacing`, `munition_speed` (fraction, raw / 100), `plane_sound`,
  `munition` (mines/missiles).

The parser decodes the matching offsets and the generator only writes changed
fields, so imported `.wep` records stay untouched until edited.

Validation: `wfcheck --stdin` passes an edited `uzi.wep` (shot interval/burst),
`freeze.wep` (mine arm/explosion push) and `napalm_strike.wep`
(spacing/munition speed).

## 2026-11-10 - hold facing, full clustlet body, roam/dig, fuse vs countdown

- Hold preview: the native aim sheet is left-facing, so the preview now flips
  the posture inside the cell to match the engine's `facing = +1` right-facing
  composition; the whole cell is still mirrored for the left-facing pose. The
  default `weap_radius` moved from `8` to `-8`, which puts the weapon on the
  forward side of a right-facing worm (PX's convention).
- Bounce: the primary missile now exposes "Explode on Bounce" plus
  `bounce.explosion.{power,push_pct,bias,variation}` in the Bounce tab.
- Clustlet is now a full child missile body. Added `bit.animation`,
  `bit.trail.{power,speed,bubbles_per_second}`, `bit.speed_pct`,
  `bit.countdown`, `bit.flight_sound`, `bit.explosion_sound`,
  `bit.explode_on_space`, `bit.ends_on_contact`, `bit.explosion.{bias,push_pct,
  variation}`, the complete `bit.bounce` group (hits, terrain keep, sound,
  contact sides, extra reverse, max bounces, contact explosion) and the
  complete `bit.homing` group (sprite, animation, arm, time, trail).
- Cluster bits also expose the full roam and dig bodies
  (`clusters.bit.roam` / `.dig`), decoded from the same `+0xC4` slab, so the
  mole and skunk launchers keep their child action and every value.
- Bounce and homing share the `+A8..+D0` body slots. The parser now decodes
  only the active action's group, so switching actions cannot inherit bytes
  from the other group. Same for the clustlet child body at `+0xC4`.
- Roam now exposes `edge_jump.{angle_deg,speed,sound}`,
  `jump.{angle_deg,speed,sound}`, `gas.{start_delay_ms,poison_power,
  animal_sprite}`, `hits`, `flight_hits` and the top-level `sheep.flight_1/2`
  art. Only changed roam fields are emitted.
- Dig now exposes `sound`, `dive_sprite`, `sprite_1..3`; only changed fields
  are emitted.
- `fuse` (`0x8C`) and `countdown` (`0x88`) are separate UI fields and separate
  Lua writes; editing one no longer changes the other.
- Validation: `tsc --noEmit` clean, `vite build` succeeds, all 50 `.wep` files
  in `WormForge-mods` + `wep_Formatting` parse, and `wfcheck --stdin` passes
  generated clustlet bounce/homing/impact, roam, dig, primary-bounce and
  switched-homing bundles. Playwright verified the hold at aim 0/8/16/24/31 in
  both facings, the clustlet bounce/homing diff-only emission, the roam import
  (skunk launcher) and switching a bounce import to homing (arm 1000/time 8000).

## 2026-11-10 - mask overlap fix (`worms` vs individual groups)

In-game error on the exported ringgrenade bundle:

```
weapon px.ringgrenade: install: missile.bounce.hits: overlapping worm selections;
use worms or its individual groups
```

Cause: the collision grid let `worms` (native shortcut bits `0x3C`) and the
individual groups it stands for be selected together. `lua-host`'s
`record_table.rs` rejects any two named targets whose bits intersect, and the
saved project had exactly that state.

- `RecordEditor.tsx`: every mask toggle now goes through `toggleMaskValue`.
  Selecting `worms` clears the four overlapping groups (normal/acting/jumping/
  roping) and leaves the frozen groups alone (they are separate bits); turning
  the shortcut off only clears `worms`. Selecting a group while the shortcut is
  on expands the shortcut into its groups first, so unchecking one keeps the
  rest. Applies to `ends_on_contact`, `bounce.hits`, the clustlet grids, roam
  `hits`/`flight_hits`, gun `hits` and mine `detects`.
- `luaGenerator.ts`: `luaMaskTable` is now conflict-free too. If a mask still
  carries both forms (legacy project), it expands `worms` into its member groups
  instead of dropping it, so the emitted bitmask keeps its meaning.
- Patched the installed `D:\Worms Armageddon\WormForge\Mods\ringgrenade\weapons\
  ringgrenade.lua` by removing the redundant `worms = true` (every group was
  already listed, so the bitmask is unchanged); `wfcheck` passes.
- Validation: `tsc --noEmit` clean, `vite build` succeeds. Generated masks now
  read `hits = { worms_normal, worms_acting, worms_jumping, worms_roping, land }`
  for the conflicting case.
- Also fixed a related grid bug: `ends_on_contact` has inherited defaults, but
  the toggle started from the raw override (usually empty), so the first click
  replaced the defaults with a single bit. `maskGrid` now toggles the mask it is
  displaying.

## 2026-11-10 - air strike sub-munition body (`clusters.bit`)

Air strikes are missile records shifted by `record.rs` `STRIKE_SHIFT = 0x14`:
every `body` field (the whole `missile.*` table, `clusters.*` and
`clusters.bit.*`) resolves 0x14 bytes further in, while `strike.*` stays at its
own offsets. The editor previously only decoded `strike.count/spacing/
munition_speed/plane_sound/munition`, so the plane's actual munition body (and
its clustlet submunitions) was invisible and never emitted.

- `wepParser.ts`: the missile body decoder now runs for `isMissile || isStrike`
  and reads through `bodyRaw = shiftOffsets(rawOffsets, -0x14)` for strikes, so
  the same named offsets decode both families. That covers `missile.*`
  (explosion, gravity/wind, fuse/countdown, sprite/animation, trail, action
  groups, sounds) and `clusters.*` + the full `clusters.bit.*` child body. The
  strike header now also decodes `strike.plane` (0x38, the plane sprite) and
  `project.burst` / `body.cluster` follow `missile.burst` at 0xF0+0x14.
  Verified against `tools/record_fields.py`/`embed_weps.py` in WormForgeNew and
  the PX records under `myre/pxl_extracted`.
- `luaGenerator.ts`: strikes (`fireType === 'cursor'`, not teleport) now emit
  the `missile` and `clusters` blocks through the existing missile path, the
  engine shifts the names itself, and the `strike` header is emitted in the
  same branch, now including `plane`. Teleport remains `on_select`.
- `RecordEditor.tsx`: the Gun / Mine / Strike tab gained `strike.plane`
  (`Plane Sprite`). The cluster submunition UI (Burst Payload -> Clusters ->
  bit body) now appears for strikes too, with the imported values.
- Validation: `tsc --noEmit` clean, `vite build` succeeds. All 95 strike `.wep`
  files under `WormForgeNew/myre` parse; untouched `.wep` imports emit no
  missile/clusters/strike tables, and edits emit only the changed values.
  Playwright imported PX's Mortar Strike: clusters count 5 / spread 40 / bit
  bounciness 50, strike plane 86 / count 4 / spacing 30 / speed 1 / sound 52;
  rebuild emits the full shifted record, "Use .wep weapon file" emits only
  `wep = "weps/Mortar_Strike_wep.wep"` until a field is edited. `wfcheck`
  passes the rebuilt, edited and .wep bundles.

## UI redesign: sidebar studio layout

The top tab bar was replaced with a persistent sidebar, the app now opens in
light mode, and the branding comes from the mod loader artwork.

- Layout: `src/components/Sidebar.tsx` holds the logo, a live project card
  (icon, name, copyable ID, base/slot/action/burst chips), the three workspace
  entries (Weapon Record / Hold & Sprite Builder / Bundle Code, hotkeys 1/2/3)
  and, while editing, the eight record sections. The record subtabs moved out
  of `RecordEditor.tsx` so the sidebar and the editor share one state in
  `App.tsx` (`activeSubTab`). `src/data/recordTabs.tsx` is the single list of
  sections and icons used by the sidebar, the mobile bar and the editor.
- Mobile: below `lg` the sidebar is replaced by `MobileBar` (logo, project,
  import/export/theme actions, three workspace buttons and a section
  `<select>`), so no navigation is lost on a phone.
- Theme: light is the default regardless of the OS preference; only a stored
  `wf_theme_v2` value overrides it. `index.html` applies the stored dark class
  before first paint and `App.tsx` keeps the `theme-color` meta in sync.
- Branding: `spec/modloader_banner.png` was cropped to
  `public/assets/wormforge-logo.png` (327x57 wordmark) and
  `public/assets/wormforge-mark.png` (49x49 gear mark, also the favicon).
  The emerald accent was replaced by a forge-red palette (`--color-forge-*` in
  `src/index.css`, sampled from the logo) and the neutral scale moved from
  `neutral-*` to `stone-*` for a warmer, less blue-grey UI.
- Accessibility: skip link to `#main`, `aria-current` on navigation, labelled
  icon-only buttons, visible `:focus-visible` ring, `prefers-reduced-motion`
  support, and semantic buttons/selects instead of clickable divs.
- Removed: `Header.tsx`, `GeminiAntigravityModal.tsx`, the `/api/antigravity`
  route in `server.ts`, and the `@google/genai` + `dotenv` dependencies. The
  server now only mounts Vite (dev) or `dist/` (production).
- Removed every visible "API 4.0" label (header, bundle footer, project
  settings badge, import modal copy, parser description, meta tags, README).
  The engineering notes keep the historical wording.
- Validation: `tsc --noEmit` clean, `vite build` succeeds, Playwright renders
  all three workspace tabs in light and dark with no console errors at
  1440x1100 and 390x844.

## Export fix: placeholder hold / flight sheets

While testing the redesigned export path, the default project (hold art
enabled, no PNG uploaded) produced `hold.sheet = "sprites/<mod>/hold.png"`
with no `hold.png` in the ZIP. `lua-host/src/api.rs` requires `hold.sheet` and
loads it with `load_pack_sheet`, so that bundle fails at load. The custom
missile path had the same problem when `mode = "custom"` had no sheet.

- `src/utils/placeholderSprites.ts` renders the builder's generic art to real
  PNGs: 60x60 hold cells (stacked for `frames`) and 32x32 flight cells that
  reproduce `renderProceduralMissile` for `rotation`, `track` and the default
  spin style.
- `modExporter.ts` writes the uploaded sheet when present and the placeholder
  otherwise, so every declared sprite exists in the archive and what the
  builder previews is what the bundle contains. The hold preview placeholder
  also moved from the old emerald colours to the forge palette.
- Verified: default export contains `sprites/moon_grenade/hold.png` (60x60);
  upload-then-remove missile art contains `missile.png` (32x32) plus
  `sb.flight`; `wfcheck --format pretty` reports no findings on both.

## Hold animation speed and default art

- `worm_hold.rs` advances `phase` by `anim_speed * 0.03` once per 50 Hz game
  frame, so a sheet plays `1.5 * frames * anim_speed` frames per second. The
  builder's field was labelled "Animation FPS" but emitted the FPS straight as
  `anim_speed`, so 15 FPS over 4 frames played at 90 FPS in game.
  `luaGenerator.ts` now converts the entered FPS with
  `anim_speed = fps / (1.5 * frames)`, emits `anim_speed` whenever `frames > 1`,
  and drops the old `animate = true` key (it is not part of the engine's
  `HoldSpec`). The panel labels the field "In-game FPS" and shows the emitted
  multiplier under it; the preview timer already used the true FPS, so it now
  matches the game.
- `spec/holyhandgrenade.png` (64x64, drawn by hand for this project) is copied
  to `public/assets/defaults/default_hand_grenade.png` and used whenever no
  hold/flight sheet has been uploaded. `src/utils/defaultArt.ts` loads that same
  file for the builder preview and writes it as `hold.png` / `missile.png`
  (stacked for `frames`) on export. The procedural canvas art remains only as a
  fallback if the image cannot load.

  There used to be two fallbacks, `spec/default_grenade.png` (46x46) and
  `spec/default_blue_zook.png` (32x32), picked from the donor: a grenade for
  throwables, the blue bazooka for barrel weapons. Both were cut from WA's own
  sprites, so every untouched export shipped Team17 pixels, and the disclaimer
  had to say so. One hand-drawn sprite replaced them; the donor pick went with
  it, because a placeholder has no reason to be family-accurate. The two old
  files were deleted outright: the dev test pack now bakes its role sheets from
  `spec/famas.png` and `spec/fire_famas.png` (the author's own gun and muzzle
  flash), so neither the app nor the test pack needs a Team17 sheet for a
  placeholder.
- `src/utils/assetUrl.ts` centralises `BASE_URL` resolution so the logo and the
  default art also work from the GitHub Pages subpath and the Tauri webview
  (`base: "./"`), not just from the dev server root.
- Verified: default project previews the grenade and exports `hold.png`
  (46x46); a bazooka donor previews the blue zook and exports `hold.png`
  (32x32); 4 frames at 15 FPS emits `frames = 4` and `anim_speed = 2.5`.

## Pack art for trails and cluster bits

`weapon-records.md` ("Sprites and other declarations") says the record's sprite
fields take stock names or numeric ids, but installation also accepts a pack
image in four places: `missile.trail.sprite`, `clusters.bit.trail.sprite`,
`cluster.sprite` and `cluster.homing_sprite`. The editor could not import any of
them, which made a whole class of bundled art unreachable.

- `WeaponProject.packArt` (`PackArtSlot` + `PackArtAsset`) holds an uploaded
  PNG/GIF plus the mod.toml sheet timing (`frames`, `fps`, `play`). The bundle
  path is never stored: `packArtPath(project, slot)` rebuilds
  `sprites/<mod folder>/<stem>.<png|gif>` from the current weapon id, so
  renaming a weapon cannot leave a stale folder (the bug the hold sheet had).
- Claim emission: `cluster = { sprite = "...", homing_sprite = "..." }` is
  written next to `panel_icon` when those sheets exist. The engine loads the
  sheet and writes the installed id into `clusters.bit.sprite` (or the strike's
  cluster sprite) and the cluster render timer, which is why the path must not
  appear in the record's `bit.sprite`, `record_table` would read it as a sprite
  name.
- Trail emission: `missile.trail.sprite` and `clusters.bit.trail.sprite` take
  the path directly (`trail_image_spec` in `lua-host/src/api.rs` copies the
  trail table, sets `sprite = 0`, loads the sheet as an extra sheet, and the
  engine patches the native id at install). Both were already diff-based; the
  pack path is the only reason the clusters block is entered on an otherwise
  untouched `.wep` import.
- Mod export: `modExporter` writes each uploaded file and `generateModToml`
  declares `[sprites."<path>"]` with `frames` (PNG only, the engine rejects
  `frames` on a GIF), `fps` and `play`.
- UI: `PackSpriteUpload.tsx` is reused in the Sprite tab (primary trail) and the
  Burst tab (bit sheet, bit trail, homing bit sheet, the last one inside the bit
  homing group). Uploading a primary trail also enables the trail and fills in
  power 25 / speed 250, mirroring the existing Enable Trail checkbox.
- Verified: `tsc --noEmit` and `vite build` clean; `wfcheck --format pretty`
  reports no findings for a hand-built bundle and for a Playwright export with
  all four slots uploaded; the `.wep`-baseline path emits only the trail tables
  plus the two claims.

## Cluster bit animation and `bit.sprite_count`

Answering "does a bit sheet need 32 frames?": no. 32 is only the fallback length
`sprite::actor_loop_delta` assumes for an unknown *stock* sheet; sprite 54
(`clustlet`) is 6 frames. A pack sheet installed as a native sprite gets
`phase_delta = 0x10000 * fps / (frames * 50)`, and `sprite::advance_loop` runs
on every missile `MSG_FRAME_FINISH`, so the strip loops at the FPS declared in
`mod.toml` whatever its frame count is. A 1-frame sheet is simply still art.
Even without `frames`, the engine slices a square-cell vertical strip, and our
`fps` / `play = "loop"` declaration supplies the looping the raw loader omits.

The trap next to it is `clusters.bit.sprite_count` (0x120): it counts
consecutive sprite **ids**, not frames, bit i draws
`bit.sprite + (i-1) % sprite_count` (MissileEntity ctor 0x507E70). The editor
called it "Sprite Frame Count", so a `.wep` import with 4 (e.g. a weapon whose
bits used four different sprites) would send bits 2..4 to the neighbouring WA
slots (55 petrolbm, 56 hgrenade, …) once a pack sheet was installed at one id.
- `RecordEditor` now labels it "Bit Sprite Run" and explains the id run.
- Uploading a bit sheet sets `sprite_count = 1`, since the bundle installs one
  sheet as one id.
- `bit.animation` / `homing.animation` copy no longer says "native frame count";
  it is WA's animation *type* (0 normal, 1 spins the sprite, PX +0x64).

## Air strike art and rotation sheets

PX's own weapons (`WormForgeNew/mods/px/weapons/`) answered how strikes get art:
`homing_air_strike.lua` sets only `sprite = ART.."flight.png"`, and
`thumper_nade_strike.lua` adds `cluster = { sprite = ... }` on a
`copy_from = "stock.carpet_bomb"` record. Both are claim-level declarations; the
engine has no sprite-builder path for a strike because `sb.flight` follows a
placed weapon's missile and a strike fires created munitions.

Confirmed in `crates/engine/src/apply.rs` / `crates/game/src/weapon.rs`:
- claim `sprite` -> `retarget_strike_sprite_id` (0x74), which also moves the
  strike's homing sprite (0xC0) and cluster sprite (0x138) when they shared the
  stock body;
- `cluster.sprite` -> `set_strike_cluster_sprite_id` (0x138) on a strike;
- `clusters.bit.trail.sprite` and `missile.trail.sprite` -> `record::offset`,
  which applies STRIKE_SHIFT;
- `cluster.homing_sprite` -> `set_cluster_render_timer`, which writes entry+0x170
  with **no** strike shift. The shifted slot is 0x184, so on a fire type 3
  record it would overwrite another cluster field. `packArtSlotApplies()` now
  refuses that slot on strikes (`packArtPath` returns null: no Lua claim, no
  mod.toml entry, no file), and the homing-bit card explains the gap. A strike's
  munition homing art comes from the claim `sprite` instead.

Sheet convention, from the pack's own comment and the art: PX's 32 frames laid
left to right pointing right and anticlockwise were rotated into a vertical
strip, top to bottom, pointing up and clockwise (`flight.png` is 60x1920 = 32
frames of 60x60). `missile.animation` / `clusters.bit.animation` select where the
frame's animation value comes from: 0 the timer, 1 the missile's spin, 2 the
flight direction (PX also uses 3, 5 and 6), and WA picks the frame from that
value - the sheet carries the rotation. The decoded `hairstrike_WEAP.wep` has the
munition body sprite at 0x74 and `animation = 2` at 0x78.

New in the editor:
- `packArt.strike_sprite` -> `sprites/<mod>/body.png` + claim `sprite`, shown on
  the Indices & Particles tab only for a strike record.
- `src/utils/rotateSheet.ts` bakes a single frame into a full 360° strip: cell
  padded to `ceil(hypot(w,h))` so diagonal frames keep their corners, frame i at
  `i*2pi/N` clockwise, vertical PNG. `PackSpriteUpload` regenerates it from the
  kept source upload (16/32/64 frames) and sets the record's native animation to
  2 on rotate; "Use original frame" restores the single frame.
- Verified: Playwright run on a Cursor Strike export produced `body.png`
  46x1472 (32 frames) and `bit.png` 46x736 (16 frames), `mod.toml` declared both
  frame counts, the Lua had `sprite`, `cluster = { sprite }`, `animation = 2`
  and `sprite_count = 1`, no `homing_sprite`, and `wfcheck --format pretty`
  reported no findings for that bundle and for a hand-built strike bundle.

## Animation type numbers (`missile.animation`, `bit.animation`)

The field is not a frame count; it picks where the drawn frame's animation
value comes from (the sheet supplies the frames). The numbers were settled by
experiment: seven byte-identical grenade records were made in PX's weapon editor
and only the animation type changed
(`wep_Formatting/grenade_animtypes/`, fire type 1 / subtype 2 / method 3,
sprite 50). Every file differs from `cycle.wep` at exactly one dword - file
0x68, record +0x64:

| value | PX's name | behaviour |
|---|---|---|
| 0 | Horiz. velocity | frames follow the horizontal speed, mirrored when flying left |
| 1 | Cycle | spins through the sheet (WA's grenade) |
| 2 | Track movement | faces the flight direction (WA's bazooka) |
| 3 | Track speed | PX's speed-tracking mode |
| 4 | Slow cycle | 0.5x cycle |
| 5 | Faster cycle | 0.8x cycle |
| 6 | Fast cycle | 1.35x cycle |

PX's editor lists them in that same order, so the dropdown order *is* the enum;
the 0.5 / 0.8 / 1.35 rates are its `ANIM_SPEED` table for slow / medium / fast.
Real records agree where they are common: grenades and Fire Orbs = 1, bazookas
and rockets = 2, pigeon and the ball weapons = 3, gravedigger / thumper bits = 5,
rollers and drills = 6.

Two traps that produced wrong earlier guesses here:
- WormForge's debris port (`crates/engine/src/particles.rs:452`) switches on a
  value it calls `anim_kind` with 0 = timer, 2 = direction, 3 = horizontal
  speed, 1 = spin. That numbering is not this record field's, so do not read the
  enum off it (it also confirms that the debris code is not the reference for
  documentation).
- PX's `WeapSprite` has its own type numbers (`track = 2, rotation = 3,
  slow/medium/fast = 1, none = 5`); those are its drawing modes, not `+0x64`.

The editor shows the field as a labelled select (`MISSILE_ANIM_TYPES` in
`src/data/recordSchema.ts`) for `missile.animation`, `missile.homing.animation`,
`clusters.bit.animation` and `clusters.bit.homing.animation`, with a "keep the
imported value" entry for `.wep` values outside 0-6. The generated rotation
sheets set 2 (track movement); a hand-authored cycle sheet uses 1 or 4-6.


## Effects-SDK ribbon trail on the main projectile

`spec/lua_sdk/effects_sdk/libs/trail.lua` is PX's effect-manager trail: it
samples a round's position on game frames and the engine draws a tapering ribbon
through those points. `px_ninja_star`, `famas`, `megashark`,
`fire_while_holding_megashark` and `ripper_star` all use it the same way:
`trail.install()` in the claim, `trail.BEAM`/`trail.GLOW` in `sprites`, attach on
the round's first missile frame (or on the id `wa.weapons.launch` returns), and
`trail.drop(id)` at the impact. The SDK is its own library bundle
(`effects.sdk`, exports `wf-lib/effects/trail`).

New in the editor (`project.ribbonTrail`, card on Indices & Particles):
- knobs are the module's own: `max` (points), `every` (frames per point),
  `vanish` (frames between shed points while fading), `core_w`, `glow_w` and a
  hex colour converted to `r,g,b`; presets cover PX's bullet numbers
  (12/2/2/8/13/white), a thin line and a long green streak.
- generated Lua emits `dependencies = ["effects.sdk"]` in mod.toml,
  `local trail = require("wf-lib/effects/trail")`, `trail.install()`, the two
  SDK sheets in the claim's `sprites`, and a `wa.on.missile_frame` hook that
  adds the trail on a round's first `pre` frame with a `TRAIL` table.
- the hook finds an owner the way the SDK does (turn worm, else any living
  worm), because WA fires the record itself and there is no `launch` id.
- **Cluster bits.** Target `main` remembers the live ids in an array and skips a
  round whose first frame arrives while one of them still has a ribbon: bits are
  born where the parent died, while its ribbon is still shedding points. Target
  `all` trails every round of the burst instead. The ids are iterated with
  `ipairs`, not `pairs`, so wfcheck's `lockstep-pairs` stays quiet.
- **Scope.** Only missile families (`power`, and `drop` with a fuse) show the
  card. A strike's bombs and crate bombs have no `m.weapon`, so a strike cannot
  be matched by weapon id; mines/actors (taze_mine's use) need sampling from the
  actor's own frame, which is a different hook and not built yet.
- Verified: generated Lua has the require/install/hook and no `pairs`;
  mod.toml lists `effects.sdk`; `wfcheck --format pretty` reports no findings;
  Playwright applies the presets and the colour/width fields, and the Code view
  shows the emitted `TRAIL` values.

## In-game behaviour test pack (`tools/gen_test_pack.ts`)

Forty components in one bundle, one profile, all art from the `spec/` sheets,
one sheet per role so a wrong role is obvious in the match: the held gun and the
role sheets come from `famas.png` and `fire_famas.png`, the homing bit from the
oil drum's 20-cell strip, the roaming animal from the sheep. The script has a
tiny PNG codec (8-bit RGBA decode/encode, no dependencies) and bakes 360°
rotation strips with the same convention as `src/utils/rotateSheet.ts`, so a pack
can be thrown into `WormForge/Mods/` and the engine behaviours checked in one
match.

Coverage: sprite-builder track/rotation and builder+homing, stock sprite 50 as
the baseline, claim `sprite` with animation 1/2, cluster bit sheets with
animation 1/2/5 and `sprite_count = 1`, native trail pack art (missile and bit),
effects-SDK ribbon trail (main and every-round, incl. a roam animal), strikes
(claim body still/directional, strike cluster bits, homing strike art), and a
fire payload. Each entry in `test_pack/README.md` states its intent, expected
result and failure symptom.

Output is git-ignored. `bun run tools/gen_test_pack.ts` regenerates it; `wfcheck
--format pretty test_pack/wftest_pack` is clean for all 20 Lua files.

## UI: nested record sections and the dead native-trail card

- `recordTabs.tsx` tabs can carry `parent`. Collision Bitmask now sits under
  Missile Action (`parent: 'action'`), which also tidies the sidebar and the
  mobile picker (`, Collision Bitmask`). The parent row is still a normal button
  that selects its own tab; a chevron on its right toggles the children
  (`aria-expanded`), open by default through the sidebar's `openGroups` state.
  This is the shape to reuse for Clusters/Air strike if they grow sub-sections.
- The native trail card was unusable: "Enable Trail" and every preset called
  `updateOverride` several times in one handler, and each call spread the same
  `project.recordOverrides` prop, so only the final key survived. The checkbox
  therefore unchecked itself and every trail field stayed disabled (presets left
  a stray `sprite` write). Added `updateOverrides(patch)` that merges all keys in
  one `onChange`; the checkbox now writes enabled + power/speed/sprite together
  and the presets write their four values. Verified in the browser: enable
  checks, fields un-disable with 25/250/smoke, "Spark Emitter" gives 40/180/
  sparks, and the generated Lua contains the `trail = { sprite = "sparks", ... }`
  block.

## Burst Payload split into sections

The clusters editor was one enormous page. It is now a parent plus five
children in `recordTabs.tsx` (same `parent` mechanism as Collision Bitmask):

- `burst`, payload selector (plain / clusters / fire), cluster ejection numbers
  and the fire payload fields;
- `burst_bit`, "Bit Behaviour": bit action selector, sprite/trail, damage,
  gravity, speed, fuse, sounds and pack art;
- `burst_bit_collision`, "Bit Collision": the bit's `ends_on_contact` grid;
- `burst_bit_bounce`, `burst_bit_homing`, `burst_bit_roam`, `burst_bit_dig`, one
  entry per bit action.

Those entries are **navigation helpers, not separate views**: the whole burst
page stays on screen (selector, ejection numbers, behaviour, collision, the
matching action group, fire payload) and a child click scrolls to its `id`. Only
the sections that apply are rendered: bit sections need `burst = "clusters"`,
and an action entry/section appears only while `bit.action` is that action
(`visibleRecordTabs` + `bitActionOf` in `recordTabs.tsx`). Verified in the
browser: no bit entries for a plain payload, Bit Behaviour/Collision plus only
Bit Bounce for a bouncing bit, the page shows behaviour + collision + bounce
together, clicking Bit Collision scrolls to the grid, and switching the bit
action to homing swaps the nav entry and the section.

## 2026-11-10, effects-SDK explosion burst, Effects section and bundle dependencies

The editor could draw a ribbon trail but not the other half of the effects SDK:
PX's explosion burst (`wf-lib/effects/px_effects`, the electric mine's blast).
The port lives in `spec/lua_sdk/effects_sdk/libs/px_effects.lua` and the original
C is `wapx-scipts/utils_red/px_effects.c` (`DrawExplosion`, `DrawEllipse`,
`BufferChange`); the installed reference is
`WormForge/Mods/wf-lib/px_electric/weapons/electric_mine.lua`.

### Generator

`project.explosionEffect` (`ExplosionEffectConfig`) emits a claim
`on_explode` hook:

- `effect` mode keeps WA's blast and calls `fx.burst{ … }` at `ev.x`/`ev.y`.
- `blast` mode zeroes the record's own blast (`missile.explosion.power` and
  `push_pct`; `mine.explosion.*` on a mine) and calls
  `blast.explode{ damage, push, hole, sound, owner = ev.worm, effect = { … } }`.
  That helper does the falloff blast, crater and burst (the SDK's
  `custom_explosion`).
- `fx.install{ trail = <ribbon enabled> }` runs before `wa.weapons.replace`;
  the claim's `sprites` list `trail.BEAM`, `trail.GLOW` and `fx.SMOKE` when
  smoke is on. `effects.sdk` is added to `mod.toml`.
- The burst spec is the module's own fields: `radius`, `r/g/b`, `thickness`,
  `noise`, `duration`, `fade`, `grow`, `live`, `segments` (0 = radius × 1.2),
  `ellipse = { x, y }`, `smoke` (a tinted smoke table, or `false`) and
  `rebuffer` (frame 16, noise ≥ 1.8, fade -0.85).
- **Families:** `power` and `drop` only. A strike's bombs are built by
  `AirStrikeEntity::release_missile` from the strike's own record copy, so
  `missile_boom::weapon_of` has no slot to match and `on_explode` never fires;
  offering the card on a `cursor` record would lie.
- **Unified callback merge:** When a custom Lua snippet declares `on_explode`,
  `parseCustomLua` safely extracts its body while preserving other callbacks (`on_place`,
  `on_proximity`). The generator merges the custom sound (`wa.sound.play`), the effects-SDK
  burst (`fx.burst` or `blast.explode`), and the user's custom logic into a single
  unified `on_explode = { on = function(ev) ... end }` callback. The parser runs in bounded
  linear time (< 0.01 ms) with strict loop guards to prevent any typing lag or stalls.

### UI

- New **Effects** section (`effects` in `recordTabs.tsx`), one page with the two
  cards from `EffectsCards.tsx`; the ribbon trail card moved there from Indices
  & Trail. Families with no claim-owned round/blast get an explanatory empty
  state.
- `ExplosionEffectCard` exposes enable, the two modes, the three PX presets,
  colour, radius/thickness/noise/duration/fade/grow/live/segments/ellipse,
  smoke and re-buffer; `blast` mode adds damage, push, crater and sound
  (`default` random 69–71, `none`, or an id). Presets fill the numbers and any
  manual edit marks the preset `custom`.
- `ExplosionPreview.tsx` replays the burst at 50 Hz on a canvas with
  deterministic noise (Park-Miller hash), the frame-16 re-buffer, the outer ring
  and the squashed lens (four additive ribbon passes) plus the smoke particles.
  It is an approximation of `wa.draw.ribbon` with the beam/glow sheets, not a
  pixel copy.

### Bundle dependencies

- `project.extraDependencies` is merged into `mod.toml` `dependencies` after the
  automatic `wf.sdk`/`effects.sdk` entries (deduped).
- The Bundle Code page now starts with `BundleDependencies.tsx`: read-only
  "Required by this bundle" chips (with the feature that caused each), manual
  ids with remove buttons, a validated input and `effects.sdk`/`wf.sdk`
  shortcuts. Ids resolve from `Mods/`; nothing is vendored into the ZIP.

### Validation

- `bun run lint`, `bun run build` clean.
- `tools/gen_test_pack.ts` now writes 22 tests; **21 Explosion Blast** (bazooka,
  blast mode, electric preset) and **22 Explosion Overlay** (mine, effect mode,
  pyro preset) cover both paths. `wfcheck --format pretty test_pack/wftest_pack`
  reports no findings for all 22 Lua files.
- Playwright: the Effects section renders both cards; enabling + the Electric
  preset draws on the preview canvas; switching to Replace WA blast reveals the
  damage/push/crater/sound fields and the generated Lua has `blast.explode`,
  `power = 0` and `fx.install`; effect mode emits `fx.burst{` and `fx.SMOKE`;
  the dependency panel lists `effects.sdk` automatically, accepts `px.electric`,
  and `mod.toml` contains both. The mobile picker lists Effects.

## 2026-11-11, WFWS flight builder: our own bundle, bit and behaviour art

PX's `px_sprite_builder` draws exactly one sheet for the primary missile. What
the weapon editor needed was more: cluster bits with their own art, and art that
changes when a missile starts homing, digging, roaming or gassing. That is now a
bundle of our own, `spec/lua_sdk/wfws_sdk/` (id `wfws.sdk`), exporting
`wf-lib/wfws_sprite_builder`. It is a library (no components), depends on
`wf.sdk` for `wf-lib/holds`, and keeps `sb.PX_POSTURE` / `sb.PX_HANDS`.

### The two gates in the builder

- **Identity**, decided on a missile's first sight and cached per id: `is_bit`
  (default `m.sprite ~= 0`), an optional `roles` list, otherwise the primary.
- **State**, re-evaluated every `pre` phase: `states = { { scope, sig | when,
  sheet …, native = true } }`. `sig` is matched against the last nonzero
  `m.sprite` seen *before* the module zeroes it, so a one-off write by WA still
  signals the state. First match wins; no match falls back to the identity art.
- `native = true` hands the missile back (and restores the last signal id if our
  earlier zero stuck). A state swap despawns the follower and spawns a new one,
  which is where the documented one-frame flicker comes from.

### Generator contract

- `require("wf-lib/wfws_sprite_builder")` whenever the primary builder is on.
  Air strikes are excluded: their munitions come from the strike's own record
  copy and have no placed missile to follow.
- `sprite = 0` is **unconditional** on the primary while the builder is on, it
  is the classifier, not a cosmetic toggle. A `.wep` baseline or a
  `missile.sprite` override must not survive. With an untouched `.wep` import
  and the builder off, the emitted Lua is still just `wep = "weps/<file>.wep"`;
  turning the builder on adds exactly `missile.sprite = 0`, the `sprites` claim
  entry and the `sb.flight` call.
- `bits = { sheet, anim, cyclical, anim_speed, spin, scale, mirror, z }` for the
  bit role, `bits = "inherit"` to give the bits the primary art, no key at all
  for native WA bits. While the bit builder owns the bits the generator forces
  `clusters.bit.sprite = "clustlet"` when the field is 0/empty and writes
  `sprite_count = 1` (ids, not frames), and it **skips** the claim
  `cluster = { sprite, homing_sprite }` declaration: the builder hides the
  installed sheet anyway.
- `states` carries `scope` (`main`/`bit`), `sig` (a number or a list) and either
  a `sheet` with the shared flight keys or `native = true`. Only behaviours the
  current action/burst really has are offered (`homing`, `homing_bit`, `dig`,
  `roam_flight`, `gas`); `inherit` emits nothing.
- The sentinel ids live in the record's own sprite fields:
  `missile.homing.sprite`, `clusters.bit.homing.sprite`, `dig.dive_sprite` +
  `sprite_1..3`, `sheep.flight_1/2`, `roam.gas.animal_sprite`. `resolveBehaviorStates`
  reuses an existing nonzero, non-colliding id and otherwise assigns the next
  free one from 245 up (stock bodies and the bit marker are reserved), then the
  generator writes that id into the record. Digest: WA may write *any* of the
  four dig fields into `m.sprite`, so all four become signals.
- `mod.toml` gains `wfws.sdk` and `[sprites."sprites/<mod>/bit_flight.png"]` /
  `state_<key>.png` declarations; the exporter writes the uploaded sheet or the
  default missile art, so a declared path always exists.

### Why not poll Space/Enter

The alternative on the table was to read the fire key and a 3-of-4 terrain ray
test from Lua. Not needed: WA already writes the behaviour's sprite id into
`m.sprite`, for the primary and for each bit separately. Using that signal
means no per-frame input polling and no timers, and the art follows the engine's
own state machine. The one gap is dig, where WA may draw `sprite_1..3` without
writing them into `m.sprite`; if in-game testing shows that, a `when` callback
(or the spacebar timing) is the fallback, the builder already accepts `when`.

### UI

`HoldPreview.tsx` gains **WFWS role art**: a cluster-bit card (native / builder /
inherit primary) and one card per available behaviour, each with upload,
animation type, frames/FPS/anim speed/spin/scale/depth, mirror, and the resolved
`sig` chip. The cards are disabled until the primary builder is on (they are
emitted inside that call). `FlightRoleEditor.tsx` is the shared card. The
"Hide Stock Sprite" checkbox became a static note, since the zero is forced.
`RecordEditor`'s claim sheets warn when the bit builder hides them, and the
Bundle Code dependency panel adds `wfws.sdk` automatically.

### Validation

- `bun run lint`, `bun run build`.
- `spec/lua_sdk/wfws_sdk` and the generated pack: `wfcheck --format pretty`
  reports no findings (25 components).
- Test pack gained **24 Builder Bits** (builder bit sheet, claim cluster sheet
  skipped) and **25 Builder State** (homing state sheet), and now writes
  `bit_flight.png` / `state_*.png` next to `missile.png`.
- Exported bundle (moon grenade, bit + homing-state roles): `mod.toml` declares
  all three sheets, the ZIP contains them, `wfcheck` clean.
- Playwright: role cards render, the resolved `sig` id appears, and the Bundle
  Code Lua contains the require, `sprite = 0`, `bits = {` and `states = {`.
- Still to verify in game: `m.sprite` writable/restorable from `pre`; whether WA
  writes behaviour sprites once or every frame; dig; the swap flicker; roam
  `pre` while grounded.

## 2026-11-11, WFWS fix pass 1: identity flip and probe-driven digging

The spb misidentified the two roles and treated digging as a sprite state. Both
are now settled from how WA actually works.

### Identity: zero means cluster bit

WA copies a missile's flight sprite (`m.sprite`, MissileEntity+0x2EC) from its
fire params at construction. A cluster bit's fire params are the **parent's
copy** (`CreateClusters` passes the parent's own copy at +0x15C), so the primary
is the missile carrying the record `sprite` and the bits are the ones reading 0.
The builder's old `m.sprite ~= 0` test therefore drew the bit sheet on the
primary and the primary sheet on the bits.

`classify` is now `is_bit = bit_art and (m.sprite == 0)`. `bit_art` is true only
when a `bits` table is configured: with `inherit` or no bits every missile is the
primary, so a plain weapon cannot classify as a bit and (with the bit role
NATIVE) draw nothing. `is_bit` still overrides, and a future `m.bit`
(MissileEntity+0x150, "non-zero for a cluster bit") is preferred when present.
`log = true` prints the first three frames of each missile (`id`, `sprite`,
`ident`) so the convention can be read straight out of the log; the Hold page's
WFWS section has a **Log Identity** checkbox (`missileSprite.logIdentity`) that
emits it, so the game log can settle the flip in one match.

### Digging: no art of its own

The weapon does not write behaviour sprites into `m.sprite`, and a digging
record's art is the separate `dig.dive_sprite` / `dig.sprite_1..3` fields (WA's
mole 158-161; PX's Gravler points them at `wsvr/wsvru/wsvrd/wsvb` = 245-248 and
replaces those stock sheets with `sprite_overrides`). A weapon also cannot start
digging later: the action is fixed when the record is installed, so "digging" is
only terrain contact changing the animation.

- Generator: with the builder owning the flight art and the record digging
  (`missile.action = "dig"`, or a cluster bit with `bit.action = "dig"`), the four
  indexes are written as 0, this is what removes the mole (or a `wsv*` frame)
  from under the sheet, and `sb.flight` gets `dig = true`. A `native` dig role
  leaves them alone: only an author-set nonzero id is written, never a zero.
- Builder: four `wa.land.solid` probes across the heading (6 px ahead, ±3 px
  spread, two hits = digging, 3 frames of hysteresis). While digging it locks the
  heading and cycles the role's own sheet (`cyclical_frame`), ignoring
  turn/spin types. No `sig`, no state sheet, no `mole_dig_rotation`.
- `resolveBehaviorStates` skips `dig`, so it can no longer mint a 245+ sentinel or
  a `state_dig.png`; the Hold page's digging card keeps only the mode choice
  (native vs the flight sheet) and explains itself.

### Exports ship the spec copy

`src/data/wfwsSdk.ts` was a hand copy of the SDK files that the ZIP shipped, so
edits to `spec/lua_sdk/wfws_sdk/` never reached an export. It now imports both
files with Vite's `?raw`, one source of truth.
- The ZIP writes the library to `wf-lib/wfws_sdk/` (where `wf.sdk` and
  `effects.sdk` live) instead of a folder at the archive root.

### Validation

- `wfcheck --format pretty spec/lua_sdk/wfws_sdk` and the regenerated 26-weapon
  test pack (WF 26 Builder Dig added): no findings.
- `bun run lint`, `bun run build`.
- Generated Lua checked for all three shapes: dig + builder (four zeros, `dig =
  true`, no `states`), dig + native role (no zero rows, no `dig = true`), cluster
  bits with dig (bit indexes zeroed, `dig = true`).

## 2026-11-11, WFWS fix pass 2: timed homing, roaming fields, `wf-lib` install

### Homing is a window, not a signal

WA arms a missile `arm` ms after it is fired and steers it for `time` ms (`0`
runs until it lands or blasts), both straight from the record (`homing.arm`
0xC8, `homing.time` 0xCC). The game is a 50 Hz lockstep, so the builder counts
its own frames (`age * 20 ms`) and swaps to the homing sheet inside that window:

```lua
homing = { arm = 800, time = 6000, sheet = "…/state_homing.png", anim = "rotation" }
bits = { sheet = "…/bit_flight.png", homing = { arm = 400, time = 3000, sheet = "…" } }
```

The generator zeroes `missile.homing.sprite` (0xAC) / `clusters.bit.homing.sprite`
(0x170) while the builder owns that art, so WA's own homing sprite cannot draw
under the sheet. `wfwsRoleFlags` is the single source for which roles are owned,
used by the Lua, `mod.toml` and the exporter, the three cannot disagree about a
sheet. `resolveBehaviorStates` no longer produces homing/homing-bit states.

### Roaming is record fields, not state art

WA draws a roaming animal from three separate places: the walking pose from the
record `sprite`, `sheep.flight_1`/`flight_2` while it is steered, and
`roam.gas.animal_sprite` while it farts. The old `roam_flight`/`gas` state rows
were removed; in their place the Hold page uploads the two flying sheets and the
generator emits `sheep_sprites = { a, b }` (the engine installs both as WA
sprites and writes the record fields after the record tables, so the numeric
`sheep.flight_*` rows are skipped when both are present). `roamSheetPaths`
returns null unless *both* sheets exist, because the engine requires exactly two.

**The sheets are rotation strips.** WA turns the flying animal to its heading by
picking a frame from the sheet, and alternates the two fields for the cape sway.
Its own art is 32 cells of direction (frame 0 up, clockwise), as is PX's Ghost
Sheep `ghstshp1/2.png` (60x1920). Each upload's card therefore has **Rotate into
strip** (16/32/64 frames from one frame, via `buildRotationSheet`) plus a frame
count for a strip uploaded as-is, and `generateModToml` declares `frames` so the
engine slices it. A single-pose upload is drawn as one cell and never turns.

**The flight builder can own the flying state.** `sprite` is normal-flight art
only, so zeroing it for a roam record deletes WA's walking pose and does not
touch the flown art (`sheep.flight_1/2`). With the builder on, the generator
therefore keeps `sprite`, zeroes `sheep.flight_1/2`, and passes `roam = true`.
The builder draws nothing while the animal walks and starts its sheet on the
turn player's synchronized Space press (`wa.world.keys().space`; a sheep never
takes off without it), which is the same frame on every peer. The two
`sheep_sprites` uploads stay in the project but are neither installed nor
declared while the builder owns the state.

### `wfws.sdk` ships under `wf-lib/`

Library bundles live in `Mods/wf-lib/` (`wf-lib/sdk` = `wf.sdk`,
`wf-lib/effects_sdk` = `effects.sdk`), so the export writes
`wf-lib/wfws_sdk/mod.toml` and `wf-lib/wfws_sdk/lib/wfws_sprite_builder.lua`
instead of a folder at the ZIP root. Unpacking into `Mods/` now lands the bundle
where the dependency resolver looks.

### Validation

- `bun run lint`, `bun run build`.
- `wfcheck --format pretty spec/lua_sdk/wfws_sdk` and the regenerated 27-weapon
  test pack (**WF 27 Roam Sheets** added): no findings.
- Generated Lua checked for homing builder / homing native / bit homing (arm and
  time from the record, `homing.sprite = 0`, sheet claimed and declared) and for
  roam with both sheets / one sheet (`sheep_sprites` + `frames` declarations, or
  nothing).

### Homing window fix: the values were 0, not 1000

A homing weapon showed the homing sheet from launch and never steered. The
generated Lua had `homing = { arm = 0, time = 0 }`: the primary homing inputs
were `value={body.homing_arm_ms || 1000}` / `homing_time_ms || 8000`, and the
initial project stored 0/0, so the fields *displayed* 1000/8000 while the
project (and the export) carried zero. `arm = 0` starts the builder's window at
launch, and WA's `time = 0` leaves the missile unguided (no stock homing record
has one, `myre`'s 15 homing records use arm 0-1500 ms, time 2000-5000).

Fixed: the `App.tsx` defaults are 1000/8000, the inputs read `?? 1000` / `?? 8000`
so a real 0 is visible, and the duration field says what 0 means. Test 25's
expectation now describes the timed swap (flight art → homing art at 800 ms →
back at 6800 ms).

### Trail sprite: names must be real stock sprites

`missile.trail.sprite = "smoke"` broke the install:
`sprites entry 'smoke' must be a pack PNG/GIF or frame folder`. The engine's
`trail_image_spec` keeps a value only when it is a *stock* sprite name
(`gfx::stock_sprite_id`); everything else is read as a bundle path and loaded.
The editor's own trail defaults and presets were the source, `smoke`, `sparks`,
`fire_smoke`, and one was written as soon as the trail was enabled.

- WA's sprite table is now vendored as `src/data/stockSprites.ts` (694 entries
  from `crates/gfx/src/stock_ids.rs`) with `stockSpriteId`, `stockSpriteName`,
  `resolveStockSprite` and a short `TRAIL_SPRITES` picker list.
- Presets/enable default: `smklt25` (WA's own trail sprite, 609), `firehit`
  (sparks), `smkdrk20` (dark smoke). The sprite field has a datalist and shows
  the resolved `name (#id)`; an unknown value gets a red note and the export
  falls back to `smklt25` instead of emitting a name the engine would treat as a
  path (the same fallback protects `clusters.bit.trail.sprite`).
- The "weird, gravity-free particles" were this: a wrong id (`113`) in the trail
  field is `oildrum4`, WA's oil-drum frame, emitted as trail puffs. The field
  now names the id it resolved.

### Action switching wrote only half a group

The action groups sit in one shared native slab (+0xA8..+0xD0). Converting the
stock Grenade (action bounce) to homing wrote `homing = { kind, arm, time,
sprite }` and left the rest of the group to the donor, so:

| offset | grenade (bounce) | homing reads it as |
|---|---|---|
| 0xAC | bounciness 0 | homing.sprite |
| 0xB0 | terrain_keep_speed 100 | homing.animation |
| 0xB4 | **sound 113** | **homing.trail.sprite** |
| 0xB8 | contact_sides 8 | homing.trail.power |
| 0xBC | extra_reverse 0 | homing.trail.speed |
| 0xC0 | explosion.bias 0 | homing.trail.bubbles |
| 0xC4 | explosion.push 0 | homing.kind |
| 0xC8 | explosion.power 0 | homing.arm |
| 0xCC | explosion.variation 0 | homing.time |

`113` is `oildrum4`, so the homing missile trailed oil-drum frames with the oil
drum's particle physics. Values taken from PX's `default.pxs` with
`WormForgeNew/tools/px_scheme_weps.py`.

Fix: `fullGroup` (`!baseline || action !== baseline.action`) makes every field of
the active group be written from the editor's own values, with the panel's
defaults where a field is unset (`bounce.terrain_keep_speed_pct` 75, everything
else 0), and `clustletChanged` includes a bit action switch for the cluster-bit
groups. Untouched `.wep` imports still emit nothing. A `dig` role also writes its
sound on a switch (0xB0 is `homing.animation` there), and bounce writes
`hits = {}` so a donor's mask does not come along (the mask write preserves the
`impact_particles` bit that shares 0xA8).

### Record ids carry a 16.16 phase (roam, dig, sounds)

WA packs a 16.16 phase beside a sprite value, so schemes store `0x10000 + id`.
Unpacked from PX's `default.pxs` (`WormForgeNew/tools/px_scheme_weps.py`):

| record | offset | raw | id |
|---|---|---|---|
| super_sheep / aqua_sheep | 0xEC (`sheep` sprite) | 65613 = 0x1004D | 77 |
| dynamite | 0x90 flight sound | 65602 | 66 |
| magic_bullet | 0x90 | 65598 | 62 |
| mole_bomb | 0x90 | 65575 | 39 |
| old_woman | 0x90 | 65601 | 65 |
| salvation_army | 0x90 | 65597 | 61 |
| skunk | 0x90 | 65578 | 42 |
| PX's own notes | `sound.soundIndex` | 0x10042 | 66 ("hisses") |

`sprite::draw_phase` and `DisplayGfx__BlitSprite` (0x56B080) mask the value to
its low 16 bits, so the id is the remainder and the high word is a phase, not
part of the id. The parser now decodes before naming (`decodeRecordId`), which
stops 65613 from reaching a record table the engine cannot draw, and the
`StockSpriteInput` says when a file spelled an id that way.

### Roam phase: what WA actually draws

PX's sheep editor lists five sprites. Mapped against the record
(`super_sheep`/`aqua_sheep` both):

| PX label | record | value |
|---|---|---|
| flying | `sheep.flight_1` 0xE0 | 154 / 156 (`spsheep1` / `aquashp1`) |
| flying 2 | `sheep.flight_2` 0xE4 | 155 / 157 (`spsheep2` / `aquashp2`) |
| taking off | 0xE8 | 76 (`vasebit2`) |
| during flight | 0xEC | 65613 = sprite 77 + phase |
| farting | `roam.gas.animal_sprite` 0xDC | 0 |

Only the first two are named by `record::fields()`, so `sheep_sprites` is the
only bundle path there. 0xE8/0xEC are sheep sprite fields WA reads that the
engine does not name yet, an engine field to add (phase 6 of the plan), not
something the generator can emit.

The Skunk is the reverse case worth knowing: its primary action is roam but the
gas numbers live on the clustlet (`clusters.bit.roam.gas` = delay 1 ms, poison
5, `animal_sprite` 174 = `skunk2`, bits 1× `skunk1` at 173). The editor shows the
gas group in both places with a stock picker, and the Hold page's roam card
shows the same pose choice next to the two `sheep_sprites` uploads.

### Effects & Libraries workspace, and sequential fire

The Effects cards moved out of the record sections into a fourth workspace tab
(`EffectsWorkspace.tsx`, hotkey 3; Bundle Code is now 4). It hosts the ribbon
trail, the explosion burst, the custom WAVs and the new sequential-fire card,
plus a "More libraries" note: a library that needs a claim hook or a bundle gets
a card there instead of a record tab.

`wf-lib/fire_seq` (`px.fire_seq`, PX's Ripper Star / Megashark / FAMAS base) is
now a card. The generator emits:

```lua
local seq = require("wf-lib/fire_seq")
local function seq_dir(w) ... end          -- aim 0 down, 1 up, mirrored by facing
...
      fires = { subtype = 4 },             -- WA's repeat-fire pose
      on_fire = function(ev)
        seq.fire_seq_mis{ weapon = ctx.id, owner = ev.worm, cancel_weapon = ctx.id,
          count = 12, delay = 3, spread = { x = 0.3, y = 0.3 }, standoff = 24,
          x = function(i, w) return w.x end, y = function(i, w) return w.y - 3 end,
          vx = function(i, w) local dx = seq_dir(w) return dx * 14 end,
          vy = function(i, w) local _, dy = seq_dir(w) return dy * 14 end }
      end,
```

- `fires = { subtype = 4 }` is the minigun's repeat-fire pose. Without it WA
  leaves the fire method after the first shot, so the burst's held counters
  never keep the worm in its firing animation (the toxic_thrower sets it for the
  same reason).
- Live aim emits `x`/`y`/`vx`/`vy` as functions of `(i, w)`; with it off the
  direction is computed once from `ev.worm` and passed as numbers, which locks
  the aim to the trigger pull.
- `fire_sequential_actor` has no default `cancel_weapon`, so the generator always
  emits it in actor mode; without it the burst ends on the timer's first tick.
- The shot WAV is a third custom-sound role (`sounds/<mod>/shot.wav`), played
  from `on_shot(i, w)` every Nth shot.
- A custom Lua `on_fire` owns the trigger, so the card is skipped and says so.
  Air strikes are excluded: their munitions are created by the strike entity, so
  the slot never fires.

**Held art during the burst: `px_hold_art`.** The engine draws `spec.hold` on
the firing frames only while `h.firing` is set, and that flag comes from the
turn's fire message; `fire_seq` repeats the shot from its own timer, so from the
second shot the held sheet blinks on every other frame (0x6A/0x6B). The
`px.fire_seq` bundle exports `wf-lib/px_hold_art`, which redraws exactly those
two states through `wa.on.draw`. With hold art on, the generator now emits:

```lua
local hold_art = require("wf-lib/px_hold_art")
...
    local hold = {                       -- the same table the claim gets
      sheet = "sprites/<mod>/hold.png", ...,
      weapon = ctx.id,                   -- px_hold_art's key (engine ignores it)
      size = 32.2,                       -- cell px * weap_scale
    }
    wa.weapons.replace{ ..., hold = hold, ... }
    hold_art.add(hold)
```

`size` is the sheet's pixel cell: an upload's width / (`height ÷ frames`), else
the default art's 46 (grenade) or 32 (bazooka), multiplied by `weap_scale`
because the helper has no scale key (a wrong size is what made the pump draw at
2x). Hold uploads now store `sheetWidth`/`sheetHeight`; imported projects fall
back to the default art's. The hold sheet is packed into the GPU atlas by
`apply.rs` automatically (its `hold_sheet` test matches `hold.sheet` /
`hold.hand` / `hold.flash.sheet`), so `params.gpu_prefix` is not needed for the
quad to resolve. The claim emits `params = { gpu_prefix = "sprites/" }` anyway,
matching PX's own fire_seq weapons (megashark/famas) as a belt-and-braces for
the sprite-key registry; it is skipped when the claim also carries a body or
cluster sheet, since the prefix would move those off their real WA slot.

Test pack **WF 29 Sequential Fire** (mortar, 12 shells, 3-frame delay, live aim)
and **WF 31 Sequential Hold** (held grenade, 0.7 scale, 6 shells) cover it;
`wfcheck` is clean on the 31-weapon pack.

### Weapon-wide sprite-builder parameters: `size` and `angle`

Two knobs that belong to the weapon, not to a role: one multiplier for every
sheet the builder draws (primary, cluster bits, each behaviour sheet) and a
rotation offset for art that does not point up. They live on
`MissileSpriteConfig` and are emitted on the `sb.flight` call only, never into
the record:

```lua
sb.flight(ctx, {
  sheet = "sprites/<mod>/missile.png", anim = "track",
  size = 1.6,      -- multiplies each role's own `scale`
  angle = -90,     -- added to the drawn rotation
  ...
})
```

- `size` is a multiplier, not an absolute: a role's `scale` and `size`
  compound, so a bit sheet can stay smaller than the primary.
- `angle` is applied in the drawn frame and negated on a mirrored sheet
  (`b.facing < 0`), because the mirror flips the rotated sprite about the
  vertical axis; without the negation a `-90` sheet points up on one side.
  Tracked art keeps tracking, it just gains the offset.
- The Hold page shows both under **Builder Parameters**, and the flight preview
  applies them (rotation offset before the facing flip, scale on the draw), so
  what the preview shows is what the builder draws.

**Glow is not part of this.** WA glows only the natives it whitelists in
`wa.assets.load{ wa_sprites }` (its own full-colour copies plus half-resolution
glow sheets); a pack sheet has no glow copy, so `a:gfx{ tint, blend = "add" }`
on a follower actor would only tint the pack art, not bloom it. Left out on
purpose.

Test pack **WF 30 Builder Size Angle** (grenade, `size = 1.6`, `angle = -90`)
covers both.

### Reading installed mods

A reader for bundles that are already installed, so their records and the
editor's own WFWS features can be inspected and imported without decoding a
`.wep`. It lives in `src/utils/modLib/`:

- `luaTable.ts`, a Lua **data** reader, not an evaluator. It walks a file's
  tokens and keeps every table literal it can see: `a.b = { … }`,
  `a.b{ … }`, `a.b({ … })`, `a.b(name)` (the table looked up by that name) and
  the file's `return { … }`. Function bodies are skipped *as values*, but the
  linear pass still walks through them, because `return { install = function()
  wa.weapons.replace{ … } end }` is exactly how this editor's own bundles are
  written. Non-literal values (calls, arithmetic, functions) become `null`
  rather than aborting, so one odd field cannot lose a record.
- `modToml.ts`, scalars, string arrays, `[[components]]` and
  `[sprites."path"]`, tolerant of anything it does not model.
- `scan.ts`, `readBundles` finds every `mod.toml` in a file map (nested
  bundles like `wf-lib/px` included) and `readWeapons` resolves each weapon
  component to its Lua module: the component's own entry when it is unique,
  else `weapons/index.lua` (PX's ports share one `components/weapon.lua` and
  map ids to modules there), else `weapons/<id after the dot>.lua`. When a
  module has no record it follows that module's `require("lib/…")` one level
  deep, PX's Ninja Star keeps its `wa.weapons.replace{ … }` in
  `lib/px_ninja_star.lua`. A record is recognised by its shape (`missile`,
  `clusters`, `handling`, `gun`, `mine`, `strike`) as a last resort, which
  catches `weapon.definition` and locals.
- `loadFiles.ts`, folder picker (`webkitdirectory`, which also opens Tauri's
  native dialog), `.zip` through the JSZip the exporter already uses, and
  dropped folders/files through `webkitGetAsEntry`. Nothing is uploaded.
  `.lua`/`.toml`/`.wep` are read eagerly; PNG/GIF/WAV entries are listed with a
  lazy reader (`bytesOf`) so a whole `Mods/` tree can be opened without reading
  every sheet up front.

`ModBrowserModal` (sidebar → **Read installed mods**, also the mobile bar) shows
the bundles, filters their weapons, and prints the flattened record of the
selected one with **Copy tables** / **Copy id**.

Corpus check (`bun run tools/scan_mods.ts`, folders and `.zip`):

| source | weapons | records read |
| --- | --- | --- |
| `D:/Worms Armageddon/WormForge/Mods` | 262 | 240 |
| of which `px.ports` | 92 | 83 |

The 22 misses are `example.tools` (70 components that place stock weapons and
Keep no Lua record), the Holdable Uzi template (no record yet) and a handful of
PX weapons whose record lives in a `.wep` file (`pyro.replace` passes
`wep = "…wep"`), reading those means handing the bundled `.wep` to the
existing decoder, which is the natural next step.

The editor's own ids are now namespaced: `weaponId.ts` fixes the `wfws.` prefix
and the ID field edits only the part after the dot, so an id can never collide
with a mod the reader shows (`px.*`, `wf.sdk`, …). `sanitizeModFolder` already
used the last segment, so export folder names are unchanged.

### Importing a bundle weapon: the `.wep` first, the declared tables over it

`readWeapons` now also resolves a bundled `.wep`: any string literal ending in
`.wep` in the weapon module (or in the `lib/` module it defers to) is matched
against the bundle's own files by base name, because PyroMan assembles it by
concatenation (`M.WEP .. o.wep`, with the literal in the weapon file). Result:
41 of the dev machine's 262 weapons carry a `.wep`, and `px.pyroman_grenades`
went from 0/7 to 7/7 readable even though those modules declare no record at
all.

`importBundleWeapon` then builds the project the way the engine would load it:

1. `.wep` found → `parseWepBinary` decodes it, and the import keeps the file
   (`useWepFile`, `wepFile`, `wepFileName`) so the export writes
   `wep = "weps/<file>.wep"` plus the original bytes, exactly like a `.wep`
   import. `wepBaseline` is the decoded record, so untouched typed fields emit
   nothing.
2. No `.wep` → the base is `copy_from = "stock.<donor>"` and the declared tables
   are the whole record.
3. `defaults` (ammo/delay/crate/after_use) map into the project's `defaults`;
   `missile.action` / `missile.burst` map to `action` / `burst`.

The module's tables are carried as **`recordExtra`** and emitted over the base
record, so the export is faithful before the typed panels know every key:

```lua
    local rec = {
      name = "Banana Express",
      copy_from = "stock.grenade",
      ...
    }
    -- Values the source bundle declared, over the base record.
    rec.missile = rec.missile or {}
    rec.missile.animation = 1
    rec.missile.bounce = rec.missile.bounce or {}
    rec.missile.bounce.bounciness = 60
    ...
    wa.weapons.replace(rec)
```

Explicit assignments, not a `pairs` merge: the order is fixed in the file
(wfcheck's `lockstep-pairs` note), parents are guarded so a group the generated
record never created still exists, and the output reads like the record it came
from. Only the native record groups are carried (`missile`, `clusters`,
`handling`, `gun`, `mine`, `strike`, `sheep`): a bundle's
`wa.weapons.replace{ … }` also holds claim keys (`sprites`, `hold`, `params`,
`worm_sprites`, `sounds`, callbacks) that name art inside *that* bundle, and
writing those into an export would point at files we do not copy.

A bundle's Lua code is not carried as a snippet: its callbacks require that
bundle's own libraries. The exception is the custom part of `on_explode`, which
the editor already merges with its own burst/sound when exporting; the reader
strips the generated `fx.burst` / `blast.explode` / sound lines and keeps the
rest. Full mapping of `recordExtra` into the typed panels is the next step;
until then the panels show the `.wep`/donor values while the export writes the
real record.

### Importing the editor's own features, not just the record

The record tables were only half of a WFWS bundle: its hold art, sprite builder,
trail, explosion burst, sequential fire and WAVs live outside them, as claim
keys or calls inside `install` and its callbacks. `importFeatures.ts` is the
inverse of the generator's feature emission:

- **`hold`** (claim key, or the pre-claim `local hold` table `px_hold_art`
  needs): `hand_type` back to lower/mid/upper, `weap_rotation` back from PX's
  `1 + degrees/180`, `weap_scale` to the hold scale, and `anim_speed` back to
  the in-game FPS (`fps = anim_speed × 1.5 × frames`, the inverse of the
  generator's conversion). The sheet is read from the bundle and attached, and
  its PNG/GIF header supplies `sheetWidth`/`sheetHeight` for `px_hold_art.size`.
- **`sb.flight`** (`readCallTable`, which finds the table argument even though
  `on_explode`'s function body is skipped by the data reader): primary sheet,
  `bits` (builder/inherit/native), `bits.homing`, `homing`, `dig`, and the
  weapon-wide `size`/`angle`/`log`. Role sheets and their `anim`, `cyclical`,
  `anim_speed`, `spin`, `scale`, `mirror` and `z` come back onto the role cards.
  Digging is inferred: `dig = true` means builder, no key on a digging record
  means native (otherwise the generator would start emitting `dig = true`).
- **Ribbon trail**: the `TRAIL` table, colour from `r/g/b`, and `target` from the
  presence of the live-id guard (`trail_live`).
- **Explosion burst**: `fx.burst{ … }` (overlay) or `blast.explode{ … }` (blast),
  with every burst field, `damage`/`push`/`hole`/`sound`, the positional
  `ellipse`, and the named preset matched back from the numbers.
- **Sequential fire**: `seq.fire_seq_mis` / `fire_sequential_actor`, including
  the fields the table reader cannot see because they are expressions
  `vx = function … * 14`, `x`/`y` offsets, and `on_shot`'s path, priority and
  every-Nth guard.
- **WAVs, sheets and dependencies**: the claim `sounds` paths and `on_shot`,
  `sprites` / `cluster` / `sprite` / `sheep_sprites` styles, the icon, and any
  manifest dependency that is not one of the four the generator adds. The files
  are attached as `File`s, so a re-export writes the same pixels and samples.
- The custom `on_explode` body survives (minus the generated burst/sound lines),
  and `unmodelledClaimKeys()` names function-valued claim keys the reader still
  cannot carry, so the import can say what it skipped instead of silently
  dropping it.

`tools/check_mod_import.ts` round-trips all 31 weapons in the generated test
pack and asserts these values and their files, then regenerates each weapon and
checks the feature calls survive.

Two bugs the round-trip exposed:

- The test pack declared `state_homing.png` in the claim's `sprites` and in
  `mod.toml` but only wrote files for the legacy `states` list, so a timed
  homing role shipped a declared path that did not exist. `gen_test_pack.ts`
  now walks `wfwsRoleFlags` as well. A declared path is a load-time contract, in
  the test pack as much as in an export.
- A bundle import inherited the *open* project's `defaults`, so re-exporting
  WF 29 (whose module declares only `ammo`) added `crate = { chance_pct = 15 }`
  and `after_use = "retreat"` from whatever was on screen. A bundle import now
  starts from neutral defaults and applies only the module's own table.

### Full mapping: a bundle's record tables become the editor's fields

`src/utils/modLib/mapRecord.ts` is the inverse of the generator's record
emission. It reads a bundle's `missile` / `clusters` / `handling` / `gun` /
`mine` / `strike` tables into the typed model, so an imported weapon shows its
real values in the panels instead of the donor's:

| record | editor |
| --- | --- |
| `missile.explosion.power` | `body.damage` |
| `missile.gravity_pct` / `wind_pct` | `body.gravity_pct` / `wind_pct` |
| `missile.fuse` / `countdown` | `body.fuse` + `fuse_time_ms` / `countdown_ms` |
| `missile.sprite` | `body.sprite` **and** `recordOverrides['missile.sprite']` (the generator writes the override) |
| `missile.action` / `burst` | `action` / `burst` |
| `missile.bounce.bounciness` | `body.bounce_pct` |
| `missile.homing.kind/arm/time` | `body.homing` / `homing_arm_ms` / `homing_time_ms` |
| `missile.roam.*` / `dig.*` | `roamConfig` / `digConfig` |
| `missile.fire.*` | `fireConfig` |
| `clusters.count/angle/spread/launch_power_pct` | `body.clustlet.count/angle/spread/power` |
| `clusters.bit.*` | `body.clustlet.*` (action, sprite, trail, explosion, bounce, homing, roam, dig) |
| `mine.proximity/arm/fuse` | `body.proximity` / `arm_delay_ms` / `trigger_delay_ms` |
| `mine.explosion.power` | `body.damage` |
| `sheep.flight_1/2` | `roamConfig.flight_1/2` |
| everything else | `recordOverrides['<group>.<field>']` |

Three rules the mapper has to get right, all learned from the corpus:

- **A group implies its action.** PX's records often declare `bounce` / `homing`
  / `roam` / `dig` fields without naming `missile.action`; the engine's
  `refuse` only compares them when both are known, and the slab the fields land
  in is read *as* the action. So a record carrying `roam` means `action = roam`,
  and the same inference runs for `clusters.bit.action`. Likewise a record with
  a `clusters` table is a cluster burst, and a `mine` group means
  `body.fuse = false` (the generator picks the `mine` group over `missile` on
  exactly that test).
- **A trail path is claim art.** `missile.trail.sprite` /
  `clusters.bit.trail.sprite` may hold a bundle path
  (`sprites/tele_arrow/trail.png`); that goes to `packArt.missile_trail` /
  `packArt.cluster_trail`, not into a stock-sprite override, which would fall
  back to `smklt25`.
- **Unknown fields are kept.** The reader is destructive (`take()` deletes what
  it consumed), and whatever is left inside a group it did consume is put back
  under the same path in `recordExtra`, a clustlet's `random_motion` or
  `impact_particles` has no panel, but it still reaches the export.

`importBundleWeapon` now also keeps the decoded `.wep` as the diff base
(`wepBaseline`) while the mapped values are the project, so a `.wep`-backed
weapon exports `wep = "weps/<file>.wep"` plus only the edits its module
declared. `App.handleApplyWepImport` honours a supplied baseline
(`parsed.wepBaseline ?? …`).

Corpus round trip (`import → generate → read the generated Lua back → compare
with the source tables`): **130 of 152** readable weapons reproduce every
declared field exactly; the rest differ only in inert trail fields (a record
with `trail.sprite = 0` draws nothing, so its power/speed are dropped) and in
values the Lua reader cannot follow (a call or a function, stored as `null`).

### Per-donor presets, and a plain Grenade default

A bundle weapon usually declares a handful of fields and lets `copy_from` do the
rest. That worked badly before: with no `.wep` the editor had no baseline, so
the generator wrote *every* typed field, and the open project was the Moon
Grenade preset, so a sparse import inherited gravity 35%, damage 20 and a
crater-cutting `on_explode` it never asked for.

Two pieces fix it:

- **`src/data/stockDonors.json`**, one decoded record per panel slot, 70 of
  them, from PX's default scheme (`python tools/px_scheme_weps.py <scheme>.pxs
  OUT --all`, then `bun run tools/gen_stock_donors.ts [folder]`). It holds the
  record fields only: `body`, `action`, `burst`, `fireType`, `specialSubtype`
  and `recordOverrides`. `body.sprite` is taken from
  `recordOverrides['missile.sprite']`, because the parser's `body.sprite` is a
  family guess ("missile" for anything that is not a mine/gun/timed explosive)
  while the record's real id is decoded into the override, the same rule the
  bundle importer follows.
- **`project.donorBaseline`**, the donor as a `WepBaseline`. The generator now
  picks its baseline with `useWepFile ? wepBaseline : donorBaseline`, so with
  `copy_from` the donor's record is the diff base: untouched fields are left to
  the engine and only real edits are written. An untouched new project exports

  ```lua
  wa.weapons.replace{
    name = "Grenade",
    copy_from = "stock.grenade",
    panel_icon = "grenade",
  }
  ```

  (three lines), and an imported Chilli Bomb writes its 16 real edits instead of
  a whole record built from the previous weapon's preset.

The importer also reads `copy_from` from the *source* table before filtering it
to record groups, so a bundle that keeps it beside `weapon.definition`
(`chilli_bomb` → `stock.super_banana`, `wfws.toxic_thrower` → `stock.mortar`)
gets the right donor instead of the Grenade default.

`INITIAL_PROJECT` is now WA's Grenade, built from that donor table, with hold
art, the sprite builder, effects, sounds and custom Lua all switched off. A
bundle import sets `replaceProject` so it starts from that project instead of
merging into whatever was open, the previous weapon's art and builder settings
used to leak into the new one.

### Re-basing the donor (a stale baseline silently ate edits)

The diff design above has a sharp edge that bit a real weapon: the baseline
describes *one* donor, but nothing tied it to the donor the claim copies. The
"Based On" picker (and the Fire Archetype buttons, which set `based_on` to their
own default donor) only changed the string, so a project kept the previous
donor's record in its panels and in `donorBaseline` while `copy_from` named the
new one.

That is not just stale panels. Every value the two donors happen to share looked
"unchanged" to the generator and was never written, so the engine's own donor
value survived. A Mortar re-based from the Grenade is the clean example: the
Grenade's `burst` is `nothing` and its `push_pct` is 100, the Mortar's are
`clusters` and 0. The author turned the Mortar's clustlets off and set its push
to 100, both were skipped, and the weapon still spawned clustlets with no
knockback.

Two changes, one for the state and one as a backstop:

- **`utils/donorRebase.ts` → `rebaseToDonor(project, donor)`**, called from
  `App.updateProject` whenever `based_on` actually changes. It starts from the
  new donor's decoded record and re-applies the author's edits: a field equal to
  the *old* donor was inherited and takes the new donor's value, a field that
  differed was edited and is kept (same rule for `recordOverrides`, where a key
  the new donor does not declare and nobody edited is dropped rather than
  written onto the new record).
- **`WepBaseline.slot`.** `stockDonorBaseline` records which donor it decoded.
  The generator honours a stored baseline only when its slot matches
  `project.based_on`, and otherwise re-derives it from `stockDonors.json`. An
  unknown donor yields no baseline, so the whole record is written instead of
  silently inheriting a donor nobody can diff against.

`bun run tools/check_copyfrom.ts` is the regression check: an untouched donor
writes no record tables, the Mortar case writes `burst = "nothing"` and
`push_pct = 100` on both a correct and a stale baseline, and a re-base adopts
the new donor while keeping edited fields. Not covered yet: switching `based_on`
to a donor of another *family* still leaves `fireType` alone (the archetype
buttons set both), so the panels and the claim can name different record shapes.


Round trip with the stricter check (donor record + emitted diffs + `rec.*`
leftovers vs. the declared tables): **88 of 115** donor-based weapons reproduce
every declared field exactly. The rest are behaviourally identical: an inert
trail (`sprite = 0`, so its power/speed draw nothing), a `strike` group on a
missile-family record (the engine only reads `strike` for strike weapons, and
PX's ports keep one beside the missile for the plane variant), or a `clusters`
table on a record whose `burst` is not clusters.

### Record audit: every field the engine names, and what the editor could not say

`bun run tools/audit_records.ts [ModsFolder]` is the audit. Four passes:

1. **Coverage**, every *record* group `crates/weapons/src/record.rs` names,
   checked against what the editor can express. Claim-level keys (`sprites`,
   `hold`, `sounds`, callbacks) are deliberately not imported: they name art
   inside the source bundle.
2. **Invariants**, `worms` beside its own constituent groups (the engine
   refuses it), a burst without its table, a record sprite field holding a path,
   a sprite name that is not stock.
3. **Implicit behaviour**, 28 stock slots whose native behaviour implies a
   shape, checked against the decoded donors: the sheep roams and does not gas,
   the skunk's *bits* gas, the petrol bomb spreads fire, the mole bomb walks and
   burrows (WA's record is `action = "roam"`, as PX's Gravler port declares),
   the utilities toggle their own effect, the drill has a duration, and so on.
4. **The editor's own output**, import each corpus weapon, generate its Lua,
   and check the record the engine would end up with (donor + emitted diffs):
   action/group agreement, burst/table agreement, mask conflicts, sprite
   validity, `sprite_count`, homing windows, armed-but-harmless gas, and that
   `fires.launch_power_pct` survives the round trip.

What it found, and what changed:

- **`fires.*` was not modelled at all.** `launch_power_pct` is the missile
  launch power (0 is the engine's "charged" sentinel, not "no power") and PX's
  ports set it on nearly every weapon; `creates_projectile` is the firing flag.
  Both are decoded, mapped, emitted and editable now. `fires.type` / `method` /
  `subtype` stay out of the model: the archetype and `specialSubtype` own them,
  and the mapper consumes them so they cannot leak into `recordExtra` and
  override the archetype's subtype.
- **The family groups were missing**: `arrow.damage`, `baseball_bat.damage` /
  `knockback_scale`, `fire_punch.damage` / `knockback`, `drill.duration_ms`,
  `jet_pack.fuel`, `parachute.wind_pct` and `utility.effect`. All are decoded,
  mapped, emitted and shown in the record page's **Family Specifics** tab, with
  a subtype selector that reveals the matching group. `utility.effect` covers
  the eight native turn utilities plus `scripted`.
- **`clusters.bit.sprite_count = 0` divides by zero.** The engine's own note on
  `c_sprite_count` says a record that makes bits must set it. Two PX ports
  declare 0; the generator now floors it at 1 (the builder path already did).
- **`copy_from` was dropped before it could be read** (fixed earlier in this
  session): bundles that keep it beside `weapon.definition` now get the right
  donor.

Still not modelled, on purpose: `projectile` (a separate launch record) and
`raw` (offset writes), plus the claim-level keys. `fires.type`/`method` are not
editable, changing the archetype is the supported way to change the family.

### The explosion preview draws the SDK's own sheets

The burst preview used to stroke two plain polygons, which read as a generic
line: no sharp core, no halo, and the ring was sized to fit the canvas instead
of to the game's pixels. It now draws what `px_effects.lua` draws:

- **The sheets.** `beam.png` (a thin bright band with a small halo) and
  `beam_glow.png` (a soft wide band) are the SDK's own art, copied from
  `spec/lua_sdk/effects_sdk/sprites/px_effects/` into `public/assets/effects/`
  and loaded through `assetUrl()`. `cloud.png` is the SDK's smoke sheet
  (`fx.SMOKE`), so the smoke uses it too. `glow.png` is the SDK's `fx.glow`
  (the mine's pulsing glow), not part of the burst, so it is not shipped.
- **The blend.** The game draws them with `wa.draw.ribbon{ blend = "add" }`, and
  the art is white-on-black, so the preview tints a copy of each sheet by the
  effect colour (`multiply`) and composites with `lighter`. The black
  background adds nothing.
- **The ribbon.** Each polygon edge becomes one textured quad stretched along
  the edge, with no overlap: the sheets are uniform along their length, so
  adjacent quads tile seamlessly, and an overlap would double the additive
  brightness into a bright bar at every joint (the first attempt looked like a
  chain of crosses).
- **The size.** The game draws in pixels, so the preview is **1:1 by default**
  (`Fit` is there for radii larger than the canvas) and the readout shows the
  live radius. The electric preset's radius is PX's own formula,
  `(damage + 2) * 2` (`lib/custom_explosion.lua`), so a 45-damage blast is a
  94 px ring, the old preset's 30 px was why the preview looked small next to
  the in-game screenshot (the electric mine's 56-damage blast is 116 px).

## 2026-11-12, Hold builder polish, firing flash sync, 6-role hotbar & underground `dig` overrides

### Hold Art Builder layout, `weap_scale`, radius parity & `draw_hand` fallback

- **Compact 3-column layout** in `HoldPreview.tsx` Section 1: left column
  for hand controls (Draw Hand, single-button **Hand Type** cycler, Hand Scale,
  Hand Radius), center column for the 600×600 canvas + Worm Posture (`0–31`) +
  Flip button, right column for Launchable/Throwable, Weapon Radius/Rotation,
  Scale Multiplier (`weap_scale`), Put-Away / Keep-While-Firing toggles, and
  inline muzzle flash controls. Multi-frame hold sheets loop continuously
  whenever `frames > 1`.
- **`weap_scale` & firing flash alignment (`resolvedHoldFlash`)**:
  - `hold.scale` now scales both the preview weapon draw and emits
    `weap_scale = ...` in Lua.
  - Because WormForge evaluates `hold.flash` (`out`, `side`, `scale`) relative to
    the worm centre rather than the weapon pivot, `resolvedHoldFlash(hold)` in
    `luaGenerator.ts` resolves the weapon's `weapRadius`, `weapRotation`, and
    `weap_scale` into both the live canvas preview and the exported Lua `flash`
    table, while `importFeatures.ts` inverts the transform back into local
    weapon coordinates on bundle import.
- **Radius parity & `draw_hand = false` engine bug workaround**:
  - Raised the negative limit on both **Weapon Radius** and **Hand Radius**
    sliders from `-10` to `-35` px so both sides match (`-35..35` px).
  - Because WormForge still draws the hand even with `draw_hand = false`,
    `luaGenerator.ts` emits `hand_radius = 0.01,` alongside `draw_hand = false,`
    whenever **Draw Hand** is unchecked while leaving the user's `hold.handRadius`
    value intact in UI state (`importFeatures.ts` restores `fallback.handRadius`
    when loading `draw_hand = false` with `hand_radius = 0.01`).

### Section 2 Flight Sprite Builder: 6-role hotbar & underground `dig = { ... }` overrides

- **6-slot hotbar** (`Main`, `Home`, `Bits`, `HomeBit`, `Sheep`, `Dig`):
  replaces the old stacked `FlightRoleEditor` cards with role icon tabs from
  `spec/` (`normal.png`, `hmissil1.png`, `clusters.png`, `homing_clustlets.png`,
  `sspsheep1.png`, `dig.png`), greying out roles that do not apply to the
  current weapon configuration. Multi-frame super-sheets slice and preview cleanly
  across roles.
- **Underground `dig` animation & transform overrides**:
  - `wfws_sprite_builder.lua`: `dig_settings` and `M.flight` now accept optional
    `anim`, `anim_speed`, `spin`, `cyclical`, `scale` (multiplied by `size`),
    `mirror`, `z`, and `sheet` inside `dig = { ... }`. When the 4 nose terrain
    probes detect solid land (`digging == true`), those overrides take effect
    without despawning/respawning the follower actor when sharing the owning
    sheet, reverting cleanly in open air.
  - `M.spin_turn` now multiplies by `(active_spin or 1.0)` so `Spin Rate`
    scales `slow`/`medium`/`fast` fixed spins as well as `rotation` ("Speed
    Tumble"), and pure vertical digging (`vx == 0, vy != 0`) uses a tiny
    `eff_vx = 0.001` fallback in both Lua and the 50 Hz React preview so drills
    and saws keep spinning straight up/down.
  - `luaGenerator.ts` keeps `dig = true,` at defaults (`anim = "track"`,
    `frames <= 1`, `animSpeed = 1`, `spinRate = 1`, `scale = 1`, `mirror = true`,
    `z = 5`) and emits `dig = { ... }` with only customized keys when overridden;
    `importFeatures.ts` imports both forms.


### Missile vs cluster bit, without spawn order

The builder used to classify a roaming weapon's rounds by spawn order: the
first missile for the weapon was the primary and every later one a bit. It
looked right on a single animal, and broke the moment one trigger made several
rounds, a sequential `fire_seq` burst drew every shot after the first with bit
art, and so would a herd fire.

The identity has to come from the record. `m.sprite` is `MISSILE_RENDER_SPRITE`
(+0x2EC), the field WA blits, and WA's missile constructor picks the record half
with the pellet index (`MISSILE_SHOOT_PELLET`, +0x150): a fired round takes
`missile.sprite` (the generator writes 0 while the builder owns the art, so
`m.sprite == 0`), and a cluster bit takes `clusters.bit.sprite` (kept nonzero,
`clustlet` when the record has nothing usable). A nonzero value at first sight
is therefore a bit, whatever order it appeared in. (The old note in `AGENTS.md`
claiming the bits were the zero ones had it backwards.) The engine's own pellet
flag, if it is ever exposed as `m.bit`, is used first.

One exception: a roaming animal whose walk pose WA draws natively. There the
record `sprite` holds that pose, so it is the one nonzero `m.sprite` that is the
primary. The generator passes its id as `walk` and the classifier skips it.

### A roaming walk pose that cannot draw

The Super Queen Bee showed the other half of it. Its PX record points
`missile.sprite` at `34464`, a *Project X* sprite number; WA masks a record id
to its low 16 bits and reads it as a pack slot, and nothing is installed there,
so the queen drew nothing at all while it walked (the flown art did appear after
takeoff, because that is the builder's). `roamWalkPoseId()` now accepts only a
stock id (1..799, packs are assigned slots from 800 up) or a stock name, so:

- a stock pose (`sheepwlk`) is kept, WA animates it, and its id goes to
  `sb.flight{ walk = … }`;
- anything else is written as `sprite = 0` and the builder draws the walk as
  well: upright, cycling the owning role's frames, switching to the configured
  (track/spin) pose on the Space press.

The same run turned up a generator gap the audit had been reporting: switching
the action to `dig` or `roam` while every value of the destination group already
equalled the *donor's* (unused) values emitted `action = "dig"` with no `dig`
table at all. Those two branches now include `fullGroup`, like the bounce and
homing groups already did.

### Roam: the animation is the same on the ground and in the air

The first version of the builder-drawn walk forced the animal upright while WA
still had it walking (no `track`, no `spin`), on the theory that a walking
animal does not point its nose along the ground. In practice that reads as "the
main missile has no track animation": the Super Queen Bee stays upright for the
whole ground phase and only starts tracking once the turn player takes off, so
the weapon looks broken even though nothing is. The pose is no longer special-
cased, `track`/`rotation`/the frame cycle are exactly the role's own.

The `roam` option became a table to carry the ids: `roam = { walk = 153, fly =
699 }`. `walk` is the stock ground pose WA draws (and the one nonzero
`m.sprite` that means *primary*), `fly` is the sentinel in `sheep.flight_1`
that WA moves into the render slot at the takeoff, an exact takeoff signal
that does not depend on catching the Space press. A weapon whose ground pose
cannot draw passes `roam = true` and the builder owns the animal from frame 1.

### Test-pack art is per role now

Every test used to draw the same grenade, so a test that rendered the wrong
role looked plausible. The pack now uses `spec/` sheets, one per role: the
bazooka for the held art and the primary's homing window, `wicestnd` for the
flight sheet and the digging spin, the grenade for cluster bits, the drum for
the homing *bit* (its own 20-cell strip at 20 fps, `frames` declared), and
`sspsheep1` for roaming, which points up-left, so WF 28's `angle = 45` is what
stands it up and the sheet is a live test of the angle modifier. The PNG reader
in the tool grew palette support for it (most `spec/` sheets are colour type 3).

### The firing sprite is a hold entry (PX's FAMAS), not an overlay

`hold.flash` is the engine's own overlay: `{ sheet, out, side, scale, frames }`
with the offsets pre-resolved against the gun, a fixed frame (the sheet is loaded
as one cell) and only `frames + 1` lit ticks. It drifts from the gun the moment
the hold's radius, rotation or scale changes, which is why it never looked 1:1.

The FAMAS does it differently and more simply: a *second hold entry* whose sheet
is drawn by `px_hold_art` in WA's firing states, with the worm's live aim,
facing and radius. The editor now emits exactly that, the same
`weap_radius`/`weap_rotation`/`weap_radial_rotation`, its own sheet,
`size = cell × weap_scale`, and calls `hold_art.add(firing)` after the claim.
The card keeps only the upload: there is nothing to place. `px.fire_seq` is the
dependency (it exports the helper) and the sheet is claimed in `sprites`.
`flashOut`/`flashSide`/`flashScale`/`flashFrames` survive only to read a bundle
written by the old code.

### Weapon & Panel, tappable tooltips

The identity/placement card sat above every record page. It is now the
`weapon` section of the record nav (`recordTabs.tsx`), rendered by `App`
instead of `RecordEditor`.

Most field explanations are `title` attributes, which no phone can show.
`TooltipTap` mounts one listener for the app: a tap on any `[title]` opens the
text in a bubble, moving the attribute to `data-tip-tap` while it is open (so
the native tooltip cannot appear on top), swallowing a `<label>` tap so the input
does not take focus, and leaving real controls alone.

### `anim = "roam"`: the walking preset

WA walks a roaming animal itself, with no velocity, so `track` holds the last
heading and the animal looks dead on the ground. The new builder animation
points the art along the velocity, clamped to `tilt = { up, down, rest }` degrees
of the rest angle (a shortest-signed delta, so a heading across the wrap point
still limits on the near side) and returns `rest` below 0.05 px/frame. The three
angles are weapon-wide (`MissileSpriteConfig.roamTilt`, like `size`/`angle`) and
the Hold page's **Roam Tilt** card edits them. The flight preview gained a
**Walk** mode: the animal ambles with no velocity (art at rest), then hops, up
leaning back, down leaning forward.

### Record values, donors and the launch power

Two separate bugs made every weapon look the same:

1. `stockDonors.json` predated the `.wep` `fires.*` decode, so no donor carried
   `fires.launch_power_pct` at all, and the panel fell back to its hardcoded
   `?? 100`, a grenade could never charge. The table is regenerated (70 slots,
   grenade 0, mortar 100, super sheep 5) and `recordField()` now reads the
   author's override, then the donor's (or the imported file's) value, then a
   fallback, for 19 record fields.
2. The donor switch was fine in the model (a Mortar really did show damage 15
   and push 0), but the stale donor numbers hid it: everything looked constant.
   `rebaseToDonor` still keeps an author's own edits and adopts the new donor's
   values for the rest.

## 2026-11-13 - Roam tilt in game, the Sheep slot's own preview and params

### The roam tilt rested upright in game

`anim = "roam"` was documented as "the art leans `up`/`down` around `rest` and
sits at `rest` when slow". The editor's `DEFAULT_ROAM_TILT.rest` became 90 (a
sheet that points up lies flat for a side-on walk), but the builder's fallback
still read `tilt.rest or 0.0`. At the default no `tilt` table is emitted, so the
game rested at 0 degrees (upright) while the preview showed 90 - the exact
"implementation is wrong in game" symptom.

The builder now defaults to `rest = 90`, and the flight behaviour is right:

- **On the ground** (`grounded`) it holds `rest` and lets the art lean at most
  `up` above / `down` below it while the animal steps. The ground heading is
  measured right-facing, because `facing` mirrors the sheet; using the signed
  `vx` made every leftward step read as a steep climb.
- **In the air** it tracks the velocity exactly like `track`. The old clamp
  applied in the air too, so a flying animal never pointed where it flew. The
  ground clamp is only the walk.
- The `up`/`down` sides were swapped (a positive delta runs clockwise, which is
  the nose *down*); `up` now limits the raised side.

`roam_angle` takes `grounded` and the previous angle, and the caller passes
`roam and ident == main and not flying`. The takeoff gate now runs for every
roam missile (it used to need a stock walk pose), so a builder-drawn walk also
switches to air tracking on Space, and the role table always carries `fly` for
the render-slot signal.

### The Sheep slot's own art was not previewed, and its params touched Slot 1

The hotbar's Sheep slot gained `behaviorArt.roam` (own sheet vs the round's
sheet), but `activeRolePreviewCfg` had no roam branch: it fell through to
`missile`. `secondarySheetPreview` also returned the primary's preview whenever
the builder was on. So selecting the Sheep slot showed the *primary* sheet with
the *roam* animation/scale - which read as "the sheep's params override the main
weapon's".

- The preview config now returns the roam role in Builder mode (and the round's
  row in "Round's sheet"), and the role sheet loader loads `roam.sheetPreview`.
  The canvas falls back to the default missile art for a builder roam with no
  upload, like the exporter does.
- `updateActiveRoleParams` always writes a secondary role's own row; the roam
  slot in "Round's sheet" mode is read-only (its values are Slot 1's) and a
  stray edit can no longer write `missile`.
- The `sb.flight` snippet shows `roam = { sheet, ... }` (or `walk`/`fly`, or
  `roam = true`) exactly as the generator will.

Verified with Playwright on WF 35: the Sheep tab shows `state_roam.png`, the
snippet has the role table and keeps the primary `anim = "track"`, dragging the
Sheep's Role Scale to 2x leaves the Main tab at 1x, and the two tabs' canvases
differ in static mode (the sheep sheet is drawn).

### Test pack

WF 34 now documents the tracked air pose and the 90 degree walk rest; WF 35
(**Roam Own Sheet**) covers the role's own `state_roam.png`, and
`tools/check_mod_import.ts` asserts the role round-trips and that the primary
`track` stays at the top level. 35 weapons; `wfcheck` and every check script are
clean.

### The mirrored walk was upside down

The 90 degree rest was right, but the leftward walk came out belly-up. The
engine's `mirror_x` flips the sheet about its *own* vertical axis while keeping
the rotation (see `crates/render/src/geom.rs`: "mirroring swaps the source
columns rather than the geometry, so a mirrored sprite keeps its rotation"). For
an upright missile that is invisible, but a walking pose lies flat, so a bare
mirror is a top-to-bottom flip.

The first attempt stopped mirroring and only turned the pose
(`drawn = -drawn`, `facing = 1`). That is not a mirror either: it is a
180-degree-different rotation, so the animal still read upside down relative to
the other side. The working form is a **true horizontal mirror**:

- the heading is measured right-facing (`abs(vx)`), so a leftward step is not a
  climb;
- the sheet is mirrored (`b.facing = -1`);
- the whole drawn angle is negated (`drawn = -(deg(rot) + angle)`), offset
  included. `R(-theta) * mirror` is exactly `H * R(theta)`.

`roam_side` keeps the side through a straight drop (`vx == 0`), and the 50 Hz
preview carries the same `roamLeft` side and draws the same
`rotate(-rot - angle)` + mirrored image. Without that preview mirror the canvas
showed the pure-rotation flip while the game looked right.

### The held hand vanished during a burst, and the firing sheet stayed on

`px_hold_art` redrew the gun on WA's 0x6A/0x6B frames but never the hand, which
the engine only draws in the aiming states, so the worm held nothing from the
second shot of a burst. The helper now draws the hand with `worm_hold::place`'s
own math (`rot_h = rot - PI * hand_radial_rotation`, the same facing mirror on
`dx` and on the drawn angle) from the keys the hold table already carries, plus
a presentation-only `hand_size = 60` (the cell of PX's three hand sheets) since
it draws explicit quads. `holds.PX_HANDS` stays the source of the sheet.

The firing sheet was also wrong in two ways. It was added on top of the hold for
the *whole* burst, because a burst keeps WA in its firing states for its length,
so the flash read as the gun. And it was added without the hand. The generator
now marks it `flash = true` and hands it the weapon's own sequencer table
(`shots = seq.shot_at`), not a `require`, because an exported library module is
instanced per pack and the helper's instance would see a different table than
the one firing the weapon. `fire_seq` writes that mark on every shot (the first
one included); the helper draws the flash for the two frames after a mark and
for the first draw that follows one, so a skipped simulation frame cannot
swallow a flash entirely. A single-shot weapon needs no mark: its 0x6A/0x6B pair
*is* the shot.

`hold_art.add(hold)` is now skipped when the engine already draws the sheet
itself (`keep_while_firing` without a burst): both would draw the gun, and the
helper only knows frame 0 of an animated strip. WF 36 (**Sequential Flash**)
covers hold + flash on a burst; WF 32's firing sheet is the ice sprite now, so a
flash that sticks or never lights is visible. 36 weapons.

### The explosion ring was drawn under WA's own blast

`fx.install` left the burst on the effects SDK's `EFFECTS` band (`0xC0000`).
`wa.depth` documents that band as *behind* worms, objects and WA's own effects,
so in `effect` mode (where the record's native blast still plays) the ring sat
under WA's explosion animation. By the time the boom played out, around a
second, the burst's `1 - timer/duration` envelope had already dropped close to
zero, which is exactly the "appears about a second late" report. The generator
now passes `depth = { burst = wa.depth.FRONT }` to `fx.install` (the nearest band
WA's front water still covers); the smoke keeps its own band behind the ring, and
`blast` mode is unaffected because there is no native boom to hide behind.

The same config also exposed a real geometry gap: the preview honoured a `core`
key (the Core slider) that the SDK had no key for, so a sharp core line existed
only on the site. `BURST_KEYS`/`burst_state`/`draw_burst` now read `core` as the
sharp pass's half-width (floored at 1.25 half, 2.5 px full) for both the ring and
the lens, and fall back to PX's `0.9 x thickness` / `1 x thickness` derivation
when it is absent or zero, every existing bundle draws exactly as before.
`effects.sdk` 0.3.5.

### Porting the Gemini Hydrogen redesign (branch `redesign/hydrogen-port`)

The redesign zip was cut from an older tree, so porting it file-by-file silently
removed two of the fixes that had already shipped: its `RecordEditor` had its own
local `UnitNumberInput` (the pre-draft version) and its `WeaponSettings` had the
`withWfwsPrefix(e.target.value)` id handler. Both were re-applied on top of the
new layout rather than merged the other way round.

- `RecordEditor`'s `UnitNumberInput` is now a thin styling wrapper over
  `useNumberDraft` from `NumberInput.tsx`, so the burst/effects/sequence cards
  that import it from there get the draft behaviour too. The 14 remaining raw
  `<input type="number">` fields in `RecordEditor` (dig, cluster, trail, spread)
  became `NumberInput`; the three native sound-id boxes deliberately stayed raw
  because clearing them means "inherit", not zero.
- `WeaponSettings` keeps `idDraft`, so clearing the id keeps the last one instead
  of writing `wfws.weapon`.
- `Crate Weight` is `Crate Chance`: the engine's `defaults.crate.chance_pct` is a
  percentage, not a relative weight.

Layout decisions worth keeping: the sidebar is workspace navigation only (one
navigation, one `aria-current`), the family-scoped tab bar lives inside
`RecordEditor`, and the mines/guns/arrows/specials pages carry only the groups
their family can actually reach, a mine has no custom art (`mine.rs` hardcodes
`mineon`/`mineoff`) and a hitscan weapon has no missile body.

### Fine Tuning was a junk drawer, so it is gone

The redesign's sixth tab held four unrelated leftovers under "Fine Tuning". They
moved next to the thing they change: `missile.explosion.bias` / `.variation`,
`missile.random_motion` and `missile.collision_shape` to **Blast Shaping &
Random Motion** in Physics & Blast, `missile.explosion_sound.*` to
**Pre-Explosion Warning Sound** there, and `missile.homing.sprite` / `.animation`
/ `.trail.*` into Missile Action's homing block as **Homing Art & Trail** (which
was previously a "Homing sprite & trail →" jump into the other tab). The bounce
extras it duplicated were already in Bounce Settings, so nothing was lost.
Projectile and strike weapons now have five tabs.

### Terrain stamp: `wa.land.stamp` is a verb, not a library

Sticking a weapon into the land is WA's own girder routine, so the editor needs
no bundle for it, only `wa.land.stamp{ sprite, frame, x, y, buried }` inside the
claim's `on_explode`. The frame is an **index into a pre-rotated strip**, which is
why the card bakes instead of rotating at runtime: 32 cells, frame 0 the
untouched upload pointing up, turning clockwise, exactly the PX
`orientation(vx, vy)` arithmetic that the ninja star, the javelin and the girder
launcher all carry.

What the engine actually enforces (read before changing the pipeline):
`spawn.rs::bind_land` takes `sprite` (a name, resolved through the claim's
`sprites`, a bundle path works), an optional `frame` (default 0), `x`/`y`
required, `buried = { soften = 1..32, blend = "dither"|"mix" }` and
`true_colour` (`true` or `{ blend }`). `sprite.rs::terrain_frames` keeps the
source pixels of a sheet only when **every** frame is 1..256 px, so a 200×200
upload padded to a 283 px diagonal cell makes the whole sheet unstampable and
`land.stamp` answers "frame out of range or sheet exceeds 256x256". The baker
therefore scales to fit (`maxCell`) rather than rejecting, and the card turns
canvas smoothing off: terrain is written where a pixel is at least half opaque, so
a blurred edge loses the tips of thin art.

Ordering is the part that bites. `on_explode` runs **before** WA's own blast, so a
native explosion carves its crater after the stamp is already in the land and
wipes it. Only the effects-SDK blast replacement (`blast.explode`, which zeroes
`missile.explosion.power`/`push_pct` and cuts the crater inside the callback)
leaves a stamp visible. The card warns and points at the burst tab rather than
switching the mode itself: flipping to `blast` changes damage, push and crater
radius, which is the author's decision, not a side effect of enabling a stamp.

The stamp goes **last** in the merged callback, after the custom WAV, the burst
and the author's own Lua, because the PX ports scan for a worm and `return`
before stamping (the star is not supposed to stick into a creature). Emitting it
first would have made every port stamp anyway.

### Copy rules: commas, not em dashes

A sweep replaced every em dash in the sources, the SDK docs and the hand-off
files with commas (about 230 of them). The reasons are practical rather than
stylistic: the character is easy to introduce by accident, some editors render
it as a wide bar in a mono font, and it survives copy-paste between the JSX copy,
the Lua comments and the markdown worse than a comma does. A dash at the end of a
line was dropped rather than joined to the next line, because in a block comment
that would have pulled the next line's ` * ` prefix into the sentence.

### Zoom buttons on both previews

The flight preview had a `2x..6x` preset row, which is not how anyone reads
sprite size. It is now `-`, a percentage and `+`: `missileZoom / 4` is WA's own
pixel size, so the readout is a percentage of game pixels, the middle button
resets to 100%, and the steps are whole `missileZoom` units (25%) so the number
lands on round values. The oil-drum reference already divided by 4, which is why
100% is the setting that matches the drum's "1x" label.

The aiming preview got the same bar (`aimZoom`, 50% to 400% in 25% steps), where
100% is the framing the reference art was laid out for: the scene is a 300 px map
drawn at `VIEW_SCALE = 2`, so the multiplier rides on top of that. The one thing
that is easy to get wrong is the origin: scaling a fixed scene from (0, 0) pushes
the worm out of the canvas as soon as you zoom in, so the transform translates by
`WORM_X * VIEW_SCALE * (1 - zoom)` first and the worm stays where it sits at
100%. Scales below 100% show the sky and hill around it, which is useful for
checking the stance against the map.

### Tap-to-read tooltips: the component was never mounted

`TooltipTap.tsx` existed, was documented as "mounted once in App", and was not
rendered anywhere, so on a phone every help icon was dead: a `title` attribute
has no touch equivalent and nothing else was listening. Mounting it was most of
the fix. The rest came out of testing on a 390 px viewport:

- the first tap on a help icon *inside a checkbox card's label* also toggled the
  checkbox, because label activation rides on the click, not the pointerdown that
  the handler could cancel (`preventDefault` there only stops the focus). The
  click is now swallowed once, in the capture phase.
- tapping the checkbox itself opened the card's tip, since `closest('[title]')`
  resolved to the label around it. A tap that starts on a real control is now
  the control's, and no tip opens.
- the help glyph was a 14 px target, which is a coin toss with a thumb. The
  clickable span carries `-m-1.5 p-1.5`, so it is 26 px without moving the icon.
- **the label's own text must keep its activation.** The first version swallowed
  it for every label, which made a checkbox card look dead on a phone: the words
  are the big target a thumb hits, not the 14 px box. It is only cancelled for a
  titled element *inside* a label (the help icon beside the text). On a touch
  screen a label tap now toggles or focuses *and* opens the bubble, because a
  finger has no hover; with a mouse it only activates, since the native tooltip
  already showed the text.

### Frames must divide the height, or the loader drops the sheet

The engine's sheet slicing is `height / frames`, so a strip whose height is not a
multiple of the declared frame count has no rectangle for its last frame. The
loader gives up on the image rather than rounding, `initgraphic` fails, and the
symptom in game is a weapon whose sprite simply never appears, with nothing in
the editor having complained. The math is one `%`, so the editor does it while
the author is still looking at the sheet: `frameFit` returns the floored cell,
the remainder and the frame counts that do divide, and the warning offers both
fixes (crop to the nearest divisible height, or change the count). It is a
warning, not a block: a sheet can be finished elsewhere, and the number is the
author's.

Three places need it because three features declare a frame count:
`sprites."…" frames` in `mod.toml` (pack art, roam strips, builder sheets), the
hold sheet's `frames`, and the builder's `cyclical`. The hold sheet already
stores its pixel size on upload (`px_hold_art` needs the cell), so that check is
synchronous; everything else measures the preview object URL once.

### PingPong: reversing a sheet without a second sheet

Animation strips in PX loop, which is all a spinning wheel needs. Anything that
opens and closes (a jaw, a piston, a hook that swings out and back) is a single
strip on screen, so landing directly from the last frame on the first looks like
a snap. The builder now takes `pingpong = true` and maps the cycle index over a
`2n-2` span: `cyclical = 6` gives 0,1,2,3,4,5,4,3,2,1. The phase still runs
`anim_speed * 30/1000` per 50 Hz tick and wraps at 0.99, so one forwards-and-back
pass takes exactly as long as one loop did, `anim_speed` keeps its meaning, and
neither endpoint is drawn twice. `M.cyclical_frame` grew a fourth argument rather
than a second function, so an existing three-argument call (a bundle written
before this existed) loops as it always did.

Two details that are easy to get wrong: the key is only emitted when
`frames > 1` (one frame has nothing to reverse, and emitting it would be a lie in
the Lua), and the editor's 50 Hz preview had to copy the same mapping, otherwise
the canvas and the game disagree the moment somebody ticks the box. The control
is a checkbox whose whole explanation lives in the tooltip, because the card is a
four-column grid and a paragraph would push the generated-Lua box off-screen.

### Impact damage: why the blast has to go

PX's javelin does not explode. It scans `wa.world.electrical_nearby(x, y, 29,
false)` for a worm, mine, crate or oil drum within 20 px, throws the target along
the spear (`vx / 4`) and hits it (`hurt(20)` for a worm, `hit(20, vx / 2, vy / 2,
"bullet")` for an object), then `return`s so nothing is stamped. Our card carries
the same shape with the numbers exposed (`STAMP_HIT`), and hits *everything*
damageable inside the square, graves are left out by the `false`, and
`spare_shooter` keeps the firing worm out of it, so a spear that bursts in your
hands stabs nothing.

The important half is in the record: leaving `explosion.power` alone means WA blasts
*after* the callback, so the target takes the pierce **and** a blast, and the
crater it carves erases the stamp that was just written. Turning the option on
therefore zeroes `missile.explosion.power` / `push_pct` exactly as the burst
card's `blast` mode does (`silencesBlast`), which is the documented "no
explosion" record (`missile = { explosion = { power = 0 } }`). With no blast there
is also no crater, so the stamp survives, the burst card's `blast` mode and this
option are two ways of settling the same problem (a crater drawn over the stamp),
not layers to stack.

`kind` is the engine's list, not a free string: `hit_kind_arg` accepts
`hit_kind::NATIVE` (`prod, fire, drill, bullet, kamikaze, dragon_ball,
baseball_bat, blow_torch, fire_punch, arrow, percent`) plus the scripted `taze`,
and anything else fails the bundle at load. **`blast` is not a kind**, a blast is
what a hit event *is*, not a name a pack can send, which reads like a typo until
you hit it. Importing reads `STAMP_HIT` even when there is no stamp call, so a
pure pierce bundle re-exports with the stamp still off.

A stamp rewrites terrain, so a worm standing at the impact point is buried in it
with no way out, WA offers no "push the worm out" for a stamp. The emitted call
is therefore guarded by `if stamp_clear(ev.x, ev.y) then … end`, a square
half-extent (`STAMP_CLEAR`, default 12 px, `0` disables) walked over
`wa.worms.all()`, the same shape PX's ninja star tests before it sticks. The
worm list is WA's live one, so a corpse does not block the stamp. Importing has
to strip the guard with the call: `customExplodeBody` skips a balanced
`if`/`end` block, because removing only the `wa.land.stamp{ … }` table would
leave a dangling `then` in the author's custom body.

Two smaller traps: `ev.vx`/`ev.vy` are the speed the missile bursts with
(`weapon_emit` passes `ENT_SPEED_X/Y`), and they are **absent for a mine**, which
is why the emitted frame reads `stamp_orientation(ev.vx or 0, ev.vy or 0)` and why
mines are out of scope for this card for now. And a fixed angle is stored in
degrees (0 = up, clockwise) but emitted as a frame: `90° → 8`. The importer has to
convert back with plain `frame × 11.25`, piping the frame through
`stampFrameForAngle` again "converted" 8 to 8, which re-exported as frame 1.

Gating is by family, not by record group: a girder launcher is an ordinary missile
that stamps instead of blasting, so `power` is the gate. Strikes never reach the
hook at all (their munitions are built from the strike's own record copy), and a
mine has no impact heading.

### Electrical blast damage: arm the hurt, do not patch the library

`blast.explode` takes a `kind`, and `"taze"` is the scripted electric kind
(`crates/game/src/hit_kind.rs`). WA applies it as a Prod hit, but a `wa.on.hit`
handler sees `"taze"`, which is how PX's electric weapons recognise their own
damage and chain. So the burst card's custom hit values carry an
Explosive/Electrical toggle, and only the custom blast names a kind; `effect`
mode leaves WA's own hit untouched, and the native record has no field for it.

The first version of this stopped there, and the user's report was right: the
worms took a blast and nothing tazed. WA has no electric hit kind (not one of the
eleven 0x4B kinds), so a name cannot electrocute anything. The first fix added
PX's second pass to `effects.sdk`'s `custom_explosion` and handed it the taze
module as `zap`. It worked, and it was the wrong trade: `effects.sdk` is
installed on every author's machine, so a pass added there only takes effect once
every one of them has the new copy, and the editor would quietly ship a bundle
that does less for anyone who has not updated.

`px.electric` already solves this, and packs already depend on it. Its damage
module is installed as `wf-lib/electric/damage`, and its whole job is to taze a
hurt that already happened:

- `zap.set_message_electric(frames, push_x, push_y, retain, window)` arms the
  next hit for 8 frames; `wa.on.hurt`'s `post` then tazes every worm that lost
  health. `retain` captures the worm's velocity, which is the knockback the blast
  gives it, and re-applies it on release, so a tazed blast still throws the worm.
  That is PX's `TazeArtificial`.
- `zap.set_message_electric_missile(frames, owner, window)` does the same for a
  blast-kind hurt, scoped to that shooter's blast. It is what lets an *overlay*
  burst taze at all: `on_explode` runs before WA's own blast (`missile_boom.rs`'s
  `boom_hook` calls the callback, then jumps to WA's detonate), so the arm is in
  place when the native blast lands.

So the generator declares `local zap`, assigns it inside `install(ctx)`, adds one
arm line at the top of `on_explode`, and declares `px.electric` in `mod.toml`.
Nothing else changes: `custom_explosion` keeps the `kind` argument and stays the
version everyone already has, and the taze sheets and loop sound come from
`px.electric`'s namespace instead of the weapon's `sprites`.

**The require has to be inside `install`, and that cost a bundle.** The first cut
wrote `local zap = require("wf-lib/electric/damage")` at the top of the weapon,
next to `px_effects` and `trail`, and it failed the whole component:

```
ERROR mod loader: the weapons' defaults can't be read: weapon wfws.hydrogen_bait:
wa.depth while declaring: a component's file only returns its data; use wa in install(ctx)
  [string "lib/electric_damage.lua"]:25: in main chunk
ERROR overlay failed: no overlay (InitGraphic did not run)
```

A component file is data: the engine parses it before `wa` exists, so a
module-level `require` of anything that touches `wa` at load takes the bundle
down with it (`electric_damage.lua` line 25 is `local DEPTH = wa.depth and …`,
plus a `wa.assets.load` just below). The fix is the ordinary Lua pattern: declare
`local zap` at module level so the module-level helpers (`stamp_hit`) capture the
upvalue when they are defined, and assign it on the first line of
`install(ctx)`. Every arm runs from a callback, long after install, so the value
is always there by then. `px_electric`'s own Electric Mine does the same thing for
the same reason (`weapons/electric_mine.lua`: "electric_damage reads wa at load,
so it must wait for install"), which is the reference to copy rather than a
workaround. The other modules the generator requires do not touch
`wa` while loading, which is why they were fine at module level; a new one has to
be checked before it joins them.

Two details are easy to get wrong. The arm window is frames, not events, so it is
short on purpose (8 by default, 2 in effect mode): a weapon that arms and then
does not blast in that window simply does not taze, which beats an arm that
survives until some later explosion and tazes the wrong worm. And the taze
releases with the captured velocity, so passing `retain` matters: without it the
worm is dropped with PX's small default pop and the blast's knockback vanishes
into the hold.

The javelin's pierce (`terrainStamp.impact`) is the same hurt in a different
clothes: `o:hurt{ amount, vx, vy, kind }` with `kind = "taze"`, one target per
call. It had the same bug for the same reason, so `stamp_hit` arms its own hit
(`zap.set_message_electric(20, 0, -4, true, 2)`) before it walks the targets. The
ordering trap is Lua's, not the generator's: `stamp_hit` is a `local function`,
and Lua binds a function's upvalues when it is *defined*, so the
`local zap = require("wf-lib/electric/damage")` line has to be emitted before it.
Written after, the function reads a nil global and the weapon errors on the
first pierce. `check_mod_import` asserts the position for exactly that reason.
An electrical pierce needs no burst and no stamp sheet: the arm, the module and
the dependency are the whole feature.

**The card's damage timing is a pair, not one checkbox.** The first version put a
lone "Pierce Targets" switch in the section header, and turning it off was
supposed to mean "the record's own blast does the damage", which nothing on the
card said. It is now two boxes side by side, `Pierce Targets` and `On Explosion`,
the same boolean with one inverted, so exactly one is always ticked and the
alternative is visible. Clicking the ticked one does nothing (a pair, not two
switches), and the unticked box explains itself in its own tooltip.

**The stamp follows the round that was drawn, not the velocity that carried
it.** PX's helper only ever had the burst speed: the right answer for a native
sheet (WA rotates that from the flight direction) and the wrong one for a
builder round, because a spinning saw, a `slow` cycle, a digging animal or a
tilted roamer is drawn at an angle of its own. The picture in the land disagreed
with what the player had just been watching.

`wfws_sprite_builder` now keeps the world rotation it drew each missile at
(`remember_drawn`, keyed by the lockstep `m.id` that `ev.missile` also carries)
and exports `M.heading(missile_id)`; the generator emits
`stamp_orientation(ev.vx or 0, ev.vy or 0, sb.heading(ev.missile))` when the
builder owns the flight art, and a `nil` heading falls through to the old
octants. Three details are load-bearing:

- the cached angle is the **world** rotation, not the drawn one, because `angle`
  is the correction that makes off-axis art travel correctly and the stamp's art
  is authored pointing up;
- the cache is bounded at 256 entries rather than cleared per missile, because
  the explosion callback can run in the frame the follower actor goes away;
- the lookup is a *fallback chain*, not a switch, so a round the builder handed
  back to WA (a native sheet) still stamps from its velocity.

WF 44 covers it with `anim = "slow"`: the arrow lands at whatever angle the spin
had reached instead of following the trajectory, and two alike shots differ.

**The first version of WF 44 did not stamp at all**, and the cause was the
library, not the stamp: the test pack did not ship `wf-lib/wfws_sdk/`, so the
weapons resolved the builder from the copy installed in `Mods/`, which was 0.6.0
and had no `M.heading`. `sb.heading(ev.missile)` was a call on a nil field, the
error aborted the whole `on_explode`, and the blast survived only because it runs
first. Two fixes, both kept: `gen_test_pack.ts` now writes the editor's own SDK
folders into the pack (the exporter always did), and the generated call is
guarded with `sb.heading and sb.heading(ev.missile)` so an older shared copy
degrades to the velocity heading instead of killing the callback. A missing
optional field must never be able to take a weapon's blast with it.

`impact.enabled` now defaults to true, and the reason that is safe is a second
change: **the pierce rides the card's own Enable Stamp checkbox**
(`usesImpactDamage` requires `terrainStamp.enabled` too). The user found the
first version's trap first hand: ticking Pierce Targets took a weapon's blast away
even with the stamp card switched off, which is the kind of thing that reads as a
bug in the weapon rather than a setting. The pierce is part of the same
`on_explode` claim as the stamp, so gating it on the card is also the honest
model, and a ticked-but-inert checkbox now shows an amber note instead of doing
nothing.

That gate is what makes the default harmless: `DEFAULT_TERRAIN_STAMP` is shared by
every new project, by `App`'s starter weapon and by `gen_test_pack`'s `makeOp`, so
without it a fresh weapon, and all 43 test weapons, would pierce with their blast
zeroed. A card with the box on and no picture is still a pure pierce: the damage
and the `wa.land.stamp` call are separate, and the exporter only writes
`stamp.png` when there is a baked strip. That forced one more UI change: the
`Enable Stamp` checkbox used to be disabled until a sprite was uploaded, which
would have made the pure pierce unreachable from the card, so it is now disabled
only when there is neither a sheet nor a piecing intent. Its tooltip follows:
with a sprite it writes the stamp, without one it is the switch for the damage
alone. Bundle import sets `enabled: true` when
it reads a `STAMP_HIT`, so a pierce-only bundle keeps its damage on re-export.


## Builder offset, phase 1 of the melee plan

`reqs/aim_spb/IMPLEMENTATION_PLAN.md` breaks the melee work into seven phases:
offsets and fading echoes first, then the unified `sb.hold`, then the swing clip
and its hit box. Phase 1 is the offset, because it is small, it touches every
role, and the swing needs it as a base transform.

**`offset = { x, y }` is a third weapon-wide builder knob, beside `size` and
`angle`**, and it is deliberately expressed in **sheet pixels**: the art nudged
inside its own cell, then scaled with the art (`size` times the role's own
`scale`) by `resolve`. That is the only frame in which one number is right at
every scale, and it is the same frame the author sees in the preview.

Two properties come with that choice, and both are load-bearing:

- **it turns with the drawn angle.** `drawn` (`angle` included, and negated for
  a left-facing roam pose) rotates the offset pair, so a `track` sheet's `y`
  is "along the nose" and its `x` is "across it". A screen-space offset would
  have made the same number mean a different thing at every aim;
- **it mirrors with the side.** `x` is negated when the follower is mirrored, as
  the engine flips the sheet about its own vertical axis before rotating. Without
  it a left-firing rocket's art would jump to the other side of the round.

Everything happens on the follower actor's position (`b.x`/`b.y`), which is
`collide = false`, gravity-free and never read by the simulation, so the round's
path is untouched. The dig override table copies `ox`/`oy` too, because its sheet
is the same cell.

WF 45 draws a `size = 2` bazooka sheet with `offset = { x = 6, y = -6 }` under
`anim = "none"`, which is 12 px up and 12 px to the firing side of the actual
flight path, mirrored when fired the other way. The import check asserts the
`offset` line both survives the import and is emitted again on re-export.

## The aiming manager, `sb.hold`, and the hold offset

The engine draws the held weapon itself (`crates/engine/src/worm_hold.rs`) from
the claim's `hold =` table, which is why hold art costs no Lua at all. It has no
offset field, though, and the aiming plan needs one (and, later, keyframed
swings on the same quad), so `wfws.sdk` 0.8.0 gained `sb.hold`.

**The engine stays the base.** `sb.hold(ctx, spec)` copies only the keys
`HoldSpec` reads (`HOLD_KEYS`) into the table it returns, so a hold with no
Lua-only feature returns exactly what the generator used to write inline. The
quad layer attaches only when `M.hold_needs_lua(spec)` says the engine cannot
express the spec, which today means a non-zero `offset` (`draw_mode` can force
either way, and `clip`/`echo`/`swing` are reserved for the later phases). So an
unoffset weapon is pixel-identical to before, with no draw hook and no extra
atlas slot, and `holdNeedsAimLayer(project)` in the generator is the same test
the exporter and the UI's **Atlas Mode** line read.

**The takeover is a mute, not a replacement.** `wa.weapons.hold_sheet(weapon, n)`
switches which of the claim's held sheets the engine draws; the module appends a
1x1 transparent `silent.png` to `hold.sheets` (loaded by the claim itself, so no
`sprites` entry and no `mod.toml` line) and points the engine at it **only while
a worm aims with the weapon**, restoring sheet 0 the moment nobody does. That is
what keeps the walk pose, WA's put-away retreat and the fire pose the engine's:
PX's aiming has no put-away animation of its own, and `px_hold_art` still covers
the repeat-fire frames. `gpu::collect_draws` runs the Lua hooks *before*
`worm_hold::draw_holds`, so the swap is in effect in the same frame and no frame
draws both copies. The swap is `pcall`ed because a refused one (the weapon not
placed yet) would otherwise drop every quad for the frame.

**The geometry is the engine's, line for line.** The aim branch of
`draw_holds`: `rot = (1 - aim) * PI`, `rot_w = rot + PI * weap_radial_rotation`,
`rot_h = rot - PI * hand_radial_rotation`, the weapon at `rot_w` x `weap_radius`
and the hand at `rot_h` x `hand_radius`, both mirrored by `facing`; the drawn
angle `(PI - PI*aim - PI*(1 - weap_rotation)) * facing` with
`static = { weap, hand }` in turns of PI overriding it; the 20-frame
`grow(counter - 1)` draw-out, first frame deliberately blank; the frame from
`floor(phase * frames)` on the engine's own `phase += anim_speed * 0.03` clock.
The clock is advanced **once per `wa.world.frame()`**, never per rendered frame,
because the render rate is not the game's. The mirror is the corner order (the
engine's `SPRITE_MIRROR_X` flips the sheet about its own vertical axis before
rotating), and every quad carries `visibility = worm` so Invisibility and the
ghost tint stay the engine's, including "an invisible unrevealed team draws
nothing".

**The offset is measured like `weap_radius`.** Sheet pixels, scaled by
`weap_scale` (the aim counterpart of the flight builder's `size`), turned with
the drawn angle, `x` negated on the mirrored side. Positive Y is down the sheet,
toward the grip, so it simply adds to the radius the engine already uses. The
preview translates inside its rotated `scale` frame, which is the same
transform, so the two agree at every angle (checked at 24 px in both axes).

Validation: `bun run lint`, `bun run build`, `gen_test_pack` (46 weapons),
`check_mod_import` (46, including the WF 46 round trip and the "a centred hold
keeps the engine draw" negative case), `audit_records`, `check_copyfrom`,
`wfcheck` on the test pack and on a real export ("no findings"), and a
Playwright pass over the new Offset card and the aim canvas. What is left to
the in-game pass: the acceptance test, that WF 46 looks identical to an
unoffset hold in grow-in, scale, walk pose and put-away, with only the nudge
differing.

## The Space swing, and the aim page's second face

**`project.aimClip` is data, not Lua.** A clip is a list of keys over 50 Hz
ticks, each holding an angle, a `dx`/`dy` in the hold offset's sheet-pixel
frame, a size, an optional strip frame and alpha, and the easing that reaches
it. `src/data/aimClip.ts` holds the keys, the easing set and `evalClip`, and
`wfws_sprite_builder` carries the same arithmetic as `M.clip_pose`. That
duplication is the price of one source of truth across two languages, and it is
the whole reason the clip is keyframes rather than author Lua: the preview can
run exactly what the game runs.

**The simulation decides when; the draw decides how it looks.** The Space edge
is `wa.world.keys().space`, the turn player's synchronised keyboard, read in a
`FRAME_FINISH` worm message once per 50 Hz frame. The start tick is stored per
weapon and worm, the pose is `clip_pose(now - start)`, and the draw only reads
it. Deciding in `wa.on.draw` would put the trigger on the renderer's clock,
which is not the game's and differs between machines; the same reasoning made
the hold counter advance once per `wa.world.frame()`.

**A swing owns Space.** WA's `FireWeapon` dispatch is eaten (`eat_fire = true`),
so nothing leaves the worm: no projectile, no ammo change, no WA shot. That
leaves turn flow to the clip, so `finish = "end_turn"` calls
`wa.world.set_turn_clock(0)` when the last tick passes. `finish = "none"` is for
a weapon whose hit box or custom `on_fire` ends the shot itself, which is where
the melee plan's next phase goes.

**Alpha needed no blend mode.** `wa.draw.quad` takes 0xAARRGGBB and
`gpu.rs::quad_tint` premultiplies it, so a key below 1 simply fades the art. The
hand carries the clip's `dx`/`dy` so it stays with the weapon, but keeps its own
rotation: a swing should move the grip, not bend the arm.

The aim page itself is now two tabs over one canvas: **Aim & Swing** (the sheet,
the hand, the offsets, the clip) and **Firing Frames** (the FAMAS sheet and its
**Placement** card). The canvas has a **SPACE** pill, and the real key works
while the page is open, because the preview should behave like the game it is
previewing. **Copy aiming parameters** snapshots the aim radius, rotation and
scale into the firing entry so they can be changed without moving the gun;
unset is "inherit", which is PX's own case and writes no numbers.

**A machine gun's hand.** A firearm fires several shots from one trigger, and
the engine's hold needs `h.firing` for the firing states, which a repeat-fire
burst does not keep set: the gun and the hand vanished from the second shot.
`usesHoldArt` now also holds for `fireType === 'hitscan'`, so `px_hold_art`
fills WA's repeat-fire frames with the same sheet, the same hand and the same
geometry. `px.fire_seq` ships the helper, so that is the dependency.

Validation: lint, build, 47 test weapons, `check_mod_import` 47/47 (WF 47 round
trips the clip's keys, `eat_fire` and the quad layer), `audit_records`,
`check_copyfrom`, `wfcheck` on the pack and on an export, and a Playwright pass
over the tabs, the number boxes driving their sliders, the hand dials, the
the SPACE pill and the real key both moving the art mid-clip.

## The quad layer was drawing nothing for holds built from the default art

First in-game pass on WF 46/47: the weapon held its art but never swung, while
the author's own exported grenade (uploaded hold + firing sheet) swung fine, and
importing the test bundle into the editor previewed correctly. That split looked
like an engine fault and was not: it was the claim.

`wa.draw.quad{ sprite = "sprites/<mod>/hold.png" }` resolves a pack path through
the sprite-key registry, and `apply.rs` only `remember_key`s the sheets in the
claim's `params.extra_sheets`, which is what the `sprites` list fills. A hold
sheet named only by `hold.sheet` is loaded by the engine for its own native draw
but never gets a key, so the quad throws "sprite ... is not installed" inside
`wa.on.draw`. The exception aborts the callback before `hold_mute` runs, so the
engine kept drawing its own sheet: a static hold, no swing, no error on screen.
An uploaded sheet was claimed by accident (the generator adds
`holdSheetPath` to `sprites` when `hold.sheetFile` exists), which is exactly why
only uploaded holds ever swung in game.

The generator now claims the hold sheet whenever `holdNeedsAimLayer` is true, not
only when a file was uploaded, and takes `params = { gpu_prefix = "sprites/" }`
on the same terms as `px_hold_art`'s (skipped when a body or cluster sheet needs
WA's real slot). `check_mod_import` asserts the line for WF 46 and WF 47 so the
regression cannot come back quietly.

## The firing sheet is an animation, not a sticker

The Firing Frames tab was a copy of the aim tab: it inherited the placement and
drew a single frame. It is now its own art with its own numbers. Uploading a
sheet snapshots the aim radius, rotation and scale into `fireWeapRadius` /
`fireWeapRotation` / `fireScale`, so the tab is independent from the moment it
exists (unset still means "inherit", which is what an imported FAMAS bundle
carries, and writes no numbers). `fireFrames` and `fireFps` belong to it too.

The frame count comes from the image, because WA's `load_strip_bytes` slices a
vertical PNG whose height divides by its width, and the panel should show the
frames the game will actually blit: a 36x72 upload is two 36x36 cells. The
generator slices the cell as `flashHeight / fireFrames` instead of the smaller
side, and emits `frames` plus `anim_speed = fps / (1.5 x frames)`, which
`px_hold_art`'s `gun_frame` already walks on the 50 Hz clock (one frame every
`50 / fps` ticks). The preview does the same: it draws one cell and steps it
while the firing state is lit, and one Test fire runs a whole cycle, because a
muzzle flash's 3-tick lifetime is shorter than a single frame at 15 fps. Before
this the canvas drew the entire strip squashed into one quad, so a two-frame
sheet previewed as both frames at once and never appeared to animate.

## A number box narrower than its own text paints nothing

`HoldDial`'s exact-value box was `w-[74px]`. The unit suffix takes about 30px and
the input's own `px-3` padding 24px, which left 9px of content box, and an
`<input>` clips its text to that box: `2` and `1` showed, but `15`, `-8` and
`-12` painted as an empty white cell while the slider and the project value were
both correct. Every aim dial had it, including the new frames and frame-rate
pair. The box is `w-[92px]` with `!px-2` now. Playwright reads `inputValue()`,
so a probe passes while the screen shows nothing: read the pixels, not the DOM.

## The aiming phase is two roles now, and the firing one is a real role

The Firing Frames tab started as a header with two sliders bolted to the bottom
of a panel, which is not how any other role in this editor works: the flight
builder gives every sprite role its own complete control set, and the aiming
phase has exactly two roles. So the section is a tab panel whose three columns
swap with the tab, and each tab is one role end to end:

- **Aim & Swing**: held sheet, `frames`/`fps`, the hand (scale, radius,
  rotation, offset), the weapon (radius, rotation, scale, offset), put-away,
  keep-while-firing, the Space clip, and a canvas that runs the clip and plays
  the SPACE pill and the real key.
- **Firing Frames**: firing sheet, its own strip, its own hand
  (`fireHandRadius`/`fireHandRotation`/`fireHandScale`/`fireDrawHand`) and its
  own placement (`fireWeapRadius`/`fireWeapRotation`/`fireScale`), and a canvas
  that draws the 0x6A/0x6B frames with the strip looping, so the tab shows the
  animation instead of a still and needs no Test button.

The middle column (canvas, worm posture, flip) stays shared because it is the
same worm in both cases; only the role's numbers change. Uploading a firing
sheet snapshots the aim numbers into the `fire*` fields, so the role is
independent from the moment it exists, and **Follow the aim** puts it back to
inheriting them (unset writes no keys, which is PX's FAMAS case).

Two things had to move into the generator with it: the hand rows of the firing
entry are now the role's own (before, they were the aim hand copied wholesale),
and `hand_scale` is emitted for the role. `size` remains the cell times the
firing scale, because the helper has no `weap_scale`; the importer reads that
scale back as `size / cell`, where the cell is the sheet's height divided by the
declared frames. Rotations are written with six decimals now: four turned a
typed 15 degrees into 14.994 on the way back in.

The test pack's firing strip had to become a real strip too. It wrote
`fire_famas.png` (one 100x100 cell) while declaring two frames, so the sheet
would not slice at load and the importer measured a different cell than the
generator had used. WF 32 now ships a stacked two-cell sheet, owns every number
of its role, and `check_mod_import` asserts all of them plus the emitted table.

## The firing role moved into `sb.hold`, and `px_hold_art` is gone

WA's firing states are exactly two frames (0x6A/0x6B). The engine draws
`hold.sheet` there only while `h.firing` is set, and only the turn's fire
message sets that, so:

- a burst lost the gun from the second shot (that is what `px_hold_art` was
  patched in for: a second hold entry with a pixel `size` key, its own hand
  redraw, and `shots`/`flash` marks);
- a firing sheet could only ever appear for as long as those two frames lasted,
  which is why a strip with `frames = 4` showed one frame and vanished. The
  window was the missing concept, not the animation.

Both are the aiming layer's job now, because it already draws the held art as
quads from `wa.on.draw` with the engine's own geometry:

- **`keep_firing = true`** on the `sb.hold` spec keeps the held art on
  WA's firing frames: the same quads as the aim pose, at full size (the engine's
  20-frame `grow()` belongs to the aiming counter, so reusing it would draw the
  gun tiny), with the strip on the firing clock. `hold_needs_lua` returns true
  for it, so `holdNeedsAimLayer` has to agree: a firearm (`hitscan`) and an
  enabled fire sequence now put the layer on. That is the trade for dropping a
  second library from every hold.
- **`fire = { ... }`** is the firing role: `sheet`, `cell_w`/`cell_h`, `scale`,
  `frames`, `anim_speed`, `ticks`, `hide_main`, its own `weap_radius`,
  `weap_rotation`, `weap_radial_rotation` and its own hand. `ticks` is the
  window in 50 Hz frames from the first firing frame; unset means one whole
  strip cycle, `0` means "WA's frames only" (the old behaviour), and a gap wider
  than one tick rewinds the strip, so each shot in a burst replays it.
  `hide_main` skips the aim draw and mutes the engine while the role shows,
  which is the "the firing art replaces the gun" case.

The generator writes `keep_firing` instead of
`local hold_art = require("wf-lib/px_hold_art")` + `hold_art.add(hold)`, so a
hold's dependency set is `wf.sdk` + `wfws.sdk`; `px.fire_seq` is the sequencer's
bundle only. `tools/check_mod_import.ts` asserts both the emitted
`keep_firing`/`fire` table and the absence of `px_hold_art`.

The preview follows: the Firing Frames tab hides the main weapon when
`fireHideMain` is set (the gun, the default art and the placeholder all skip),
and the sheet's window defaults to the same one-cycle number the generator uses
(`ceil(frames * 50 / fps)`), shown in the **Show For** dial so the number on
screen is the number in game.

## One layout for both hold roles

The Aim and Firing tabs were the same editor with a different set of knobs, but
they did not look like it: the aim column had scale, radius, rotation and an
offset pair, the firing column had radius, rotation, scale and no offset at all,
and the firing sheet lived in its own card while the held sheet had a bar above
the tabs. Reading one and then the other meant hunting for the same number
twice.

They now run the same four blocks in the same order, which is how the flight
builder gives every sprite role its complete control set:

1. the role's sheet (one upload row, swapped with the tab),
2. its animation (`frames` / `fps` / current frame),
3. its placement (radius, rotation, scale),
4. its offset (X/Y, plus one line about which draw is in use).

The hand column mirrors the same order: Draw Hand, Hand Type, hand scale,
hand radius, hand rotation, hand offset. Only the behaviour block differs, and
that is because the two roles really are different: the aim tab has
Launchable/Throwable, put-away, keep-while-firing and the Space clip, the firing
tab has Show For, Hide Main Weapon and the copy/follow-aim note.

The firing role gained the two channels it was missing, `fireOffsetX` /
`fireOffsetY` and `fireHandOffsetX` / `fireHandOffsetY`, emitted as
`offset = { x, y }` and `hand_offset = { x, y }` inside the `fire` table and
drawn by `hold_draw_fire` the way `hold_draw_aim` draws the held art's: in sheet
pixels, scaled with the role's own `scale` (its `hand_scale` for the hand),
turned with the drawn angle and mirrored with the side. Unlike the held art's
offset it needs no extra layer, because the fire role is a quad role already.
`Copy aiming parameters` copies them too, and `hasFireGeometry` counts them, so
`Follow the aim` appears once a role owns one.

The upload row swapped with the tab is the other half of "the two tabs are the
same editor": the held sheet is no longer a bar above the tab bar with the
firing sheet buried in a column card. The enable pill stays above the tabs,
because it gates both roles.

## A sequential burst carries the player's fuse

A grenade record keeps `missile.fuse` (0x8C) at **0**: WA never reads it for a
grenade, because the fuse is a WA *option*, the 1-5 seconds the player picks with
the number keys while aiming, and WA writes that number into the shot
description when it fires. A sequential burst does not go through WA's fire path
at all: `wf-lib/fire_seq` calls `wa.weapons.launch`, whose shoot description
takes the fuse from `missile.fuse` (0 when absent). So every round of a burst
exploded on its first frame, whatever the weapon panel said.

The engine offers no verb for the selected option, so the pack reads the keys
itself, which is exactly what they are: `wa.world.keys().digit` is the digit the
turn player holds, taken from the lockstep input, so every peer samples the same
value on the same frame. For a missile-family sequence (a `power` record, or a
`drop` one with a fuse; not the actor mode, which builds no missile) the
generator now emits:

- `FUSE_DEFAULT`, the record's own `missile.fuse` when it has one (dynamite's
  5000, a bazooka's 9000) and 3000 otherwise, WA's default grenade fuse;
- `FUSE_AIM = { 0x67, 0x68, 0x69 }`, the three aiming states;
- a per-worm `fuse_by_worm` table and `fuse_of(w)`;
- inside `install`, a `wa.on.worm_message(..., { msgs = { wa.msg.FRAME_FINISH } })`
  sampler: once per 50 Hz frame, if a worm is the turn's and aims this weapon,
  `digit 1..5` becomes `digit * 1000`;
- `missile = { fuse = fuse_of(ev.worm) }` in the launch table, which
  `record_table::launch_patches` turns into the fire params' fuse
  (`FIRE_FUSE`, 0x50 relative, absolute 0x8C) and the engine copies into the
  shot (`SHOOT_FUSE`).

The tracker is only emitted when the record's own `missile.fuse` is **0**, which
is exactly the set of weapons WA offers its fuse keys for; an author who pinned a
timer (dynamite's 5000, a bazooka's 9000) keeps it, and `launch` plays the
record. The effective value is read through `recordField` (`missile.fuse`), so a
donor's or a `.wep`'s timer counts as the record's. The sampler is a statement,
so it sits at the top of `install()`, above the claim, not inside the
`wa.weapons.replace{ ... }` table where the burst's own keys live.

The Firing Sequence card says so under its numbers, with the fallback it will
use, because "the fuse is not the record's" is exactly the kind of thing an
author needs to know before reporting it as a bug. `tools/check_mod_import.ts`
asserts the launch key, the tracker and the fallback on WF 29.

## The ghost trail

A swing on a down-the-line camera reads as a teleport: the blade leaves the aim
pose and appears somewhere else. The trail is the fix, and the cheap way to
build it is the property the clip already has: `clip_pose` is a pure function of
the tick, so a ghost is the same clip evaluated at an earlier tick, not a
recorded history.

`swing.echo = { count, every, fade, blend }`, inside the clip's own table:

- ghost `k` is `clip_pose(t - k * every)` at `fade ^ k`, drawn from the farthest
  to the nearest so the live art lands on its own smear;
- `count` is clamped to 1..8 and `every` to at least one tick;
- `blend = "add"` is the usual choice (a blade glows), `"alpha"` is there for
  sheets with real transparency;
- the hand is left out. It is anchored to the worm, and a smear of it reads as a
  bug rather than as motion. That is what `hold_draw_aim`'s `weapon_only` flag
  is for, and the firing pass uses the same flag to keep the aim hand from being
  drawn twice.

`HOLD_QUAD` is one reused table, so `hold_quad` now writes `blend` on **every**
call. A ghost that left `add` behind would have made the live art additive too,
which looks like a bloom over the whole weapon instead of a trail behind it.

No `wa.draw.quads` grouped path: one quad per ghost keeps the draw pool small
and the code obvious, and eight is the cap. A "bake onto black" action was in the
plan and is not needed: a ghost is the same sheet at an earlier pose, so a matte
would only lose pixels.

The preview draws the same formula (`echoPoses`), with `lighter` for `add`, so
the smear in the panel is the smear in the game.

## A second hand on the weapon

`HoldSpec` has one `hand` slot, so a support hand (a foregrip, the off hand on a
two-handed blade) is the aim layer's, on the same terms as the hold offset:

`hold.extra_hand = { sheet?, radius, rotation, radial_rotation, scale, size,
offset }`, using the engine's own hand maths (`rot - PI*radial_rotation` for the
position, `rot + PI*rotation` for the drawn angle), its own art or the first
hand's sheet, the swing's `dx`/`dy` carried with the weapon, and no hand on the
echo ghosts or the firing pass. It forces the layer, and an uploaded sheet is
claimed in `sprites` like the hold sheet, because `wa.draw.quad` resolves through
that registry.

Writing it exposed a bug in the layer's own hand: it was placed at
`grow(counter) * weap_scale * scale * hand_scale` while the engine places the
hand at `grow(counter) * hand_scale`. `draw_holds` always draws `config.hand`,
whatever sheet the weapon is pointed at, so on any weapon with `weap_scale` != 1
the layer drew a second, larger hand on top of the engine's. Both the layer and
the preview now use the engine's rule. A nudged hand (`hand_offset`, or a clip's
`dx`/`dy`) still moves off the engine's copy, which is the layer's one visible
limit and needs an engine-side hand mute to fix properly.

The preview also draws the firing sheet **before** its hand now, which is the
order `sb.hold` uses (the `fire` role, then the hand on top): the hand was
appearing behind the gun on the Firing Frames tab.

## The squashed firing sheet and the stubborn hand

Two bugs in the firing role, both invisible in the panel and obvious in game.

**The cell was forced square.** The generator computed the firing cell as
`min(width, height)` when the sheet had one frame, so a 113x32 muzzle flash was
drawn into a 32x32 quad: the game squashed it horizontally, while the preview
(the browser) drew the sheet's real shape and looked right. The cell is the
sheet's own cell, `cell_w = width` and `cell_h = height / frames`, which is WA's
`load_strip_bytes` rule read the other way: one frame is the whole picture, and
a strip is cut out of the height. A typed frame count that no longer divides the
height evenly is the `SheetFrameWarning`'s job to refuse, not the cell's.

**The firing hand ignored the aim hand's switch.** The panel's checkbox is
`fireDrawHand ?? drawHand`, so with only the aiming hand turned off the box
showed off, the preview hid the hand, and the generator wrote nothing, because it
tested `fireDrawHand === false` alone. `sb.hold`'s firing pass then drew the hand
at `hand_radius`. It now resolves the same way the panel does.

Same pass, one more gap: a multi-frame firing sheet was never declared in
`mod.toml`, so the engine sliced it by its own height / width rule while the Lua
walked it by `fire.frames`. They agree for a square strip and disagree the
moment an author types a different count, which shows as a half-cell jumping
inside the quad. The declaration is written whenever `fireFrames > 1`, from the
same numbers the Lua uses, and the test pack writes the file and the declaration
from one place (`spriteDecls`).

## Melee: the aiming phase is the attack

A bat or an axe has no projectile: the food chain in WA is aim, Space, swing,
and a hit that happens when the weapon is in front of a worm. `swing` (the aim
clip) already gave the editor the animation, so the strike became the third
consumer of the same clock rather than a simulation of its own:
`project.melee` emits `melee = { … }` into the `sb.hold` spec, and the swing loop
- which already ticks once per 50 Hz frame and already knows the tick since the
Space press - tests a box on the frame `hit_frame` names.

**The box is the worm's aim, full stop.** `worm.aim` is WA's sweep (0 straight
down, 0.5 level, 1 straight up) and `worm.facing` is the side, so the direction
is `(facing * sin(aim*PI), cos(aim*PI))`, world y down, and the clip's angle turns
it when `follow_swing`. Nothing about the art belongs in it: `weap_radius` moves
the picture, `weap_rotation` turns the sheet, and a weapon whose art is nudged
one pixel or rotated twenty degrees still points where the worm aims. `log = true`
prints `aim` and FireAngle (`worm.aim_target`, degrees) at the press, so the one
input the box reads is visible in the log.

Two earlier answers read the art instead, and both were wrong:

**Where the art points, not where it sits.** `worm_hold.rs`
draws the hold at `PI * (weap_rotation - aim)`, and hold art points up in its own
cell (`PX hold art points up natively`), so the barrel is `(sin, -cos)` of that
angle, mirrored with the side; `follow_swing` turns it by the clip's angle at the
hit frame exactly as the drawn angle is.

Two wrong answers cost two in-game passes, and both came from the art's *offset*.
The first box used the engine's placement `(sin rot_w, -cos rot_w) * weap_radius`
and was 180 degrees out for a negative radius (the editor's own default, `-8`, its
grip above the pivot), so it multiplied by the sign of the radius. That fixed the
default and broke every positive radius: `weap_radius` moves the picture, it says
nothing about which way the weapon points, and WF 50 (radius `4`) needed the
striker's back turned to the target to land a hit. The radius is gone from the
formula now. The preview draws the same vector in red from the worm's map pivot
in the offscreen's right-facing convention with one horizontal flip for the side,
which is the engine's `facing`, and `tools/lua/harness_melee.py` checks all three
aim directions (front, down, up) so a fourth answer cannot slip in.

**Determinism, and one hit per swing.** `wa.worms.all()` is a deterministic list,
so the victim set and order are identical on every peer; `once` (default on)
records each victim in `ws.melee_hit`, which resets on the Space edge and not on
a timer, so a long animation cannot hit the same worm twice and a wiggle cannot
hit it once per frame. `spare_shooter` (default on) skips the worm that swung.

**What a hit does stays in the weapon.** The library hands over `(victim, vx,
vy)` and the emitted callback calls `victim:hurt{ amount, vx, vy }`, or
`zap.hurt_electric(victim, damage, { frames, push_x, push_y, retain })` for
`kind = "taze"` - the same `px.electric` module the burst and the pierce use, so
an electrical strike tazes without WA learning a new kind. The call is `pcall`ed
so a broken weapon cannot take the 50 Hz message down with it.

Two gaps worth knowing: `hold_needs_lua` had to learn `melee` or a centred hold
would take the engine path and never register the strike at all, and
`stopOnTerrain` plus a dedicated swing WAV are still unmodelled - the record's
own `fires` sound plays, which covers the family in practice.

**Ticks commit on blur now.** The clip's keys are sorted by `t`, so typing the
`1` of "16" re-sorted the table and remounted the row being typed in between two
keystrokes, and the box the author was in jumped to a different key. `KeyTickInput`
keeps a draft and commits on Enter/blur (Escape cancels), and the rows are keyed
by position so a commit cannot remount the row underneath them.

## Why no swing ever played, and why the strike never landed

The first melee build ran the swing inside the hold's own draw and simulation
passes, which are gated on `w.weapon == the weapon` **and** an aim state (0x67 to
0x69). Two consequences, both fatal and both invisible from the panel:

- WA's Baseball Bat is `fireType = 4, subtype = 2`, and a special melee subtype
  resolves the hit inside one native frame. The worm never sits in an aim state
  long enough for the sampler to see the Space edge, so the clip never started:
  no animation, and no strike either because the strike is a tick of that clip.
- Even when a clip did start, the next frame's state test cleared `ws.swing` the
  moment WA moved the worm out of its aim pose. That is the "it stops the
  animation if a different state is detected" report: any frame count longer
  than WA's own two firing frames played for a frame and was cancelled, and a
  `hit_frame` past that frame never landed.

Both are the same mistake: WA's worm state was being used as the animation's
clock. A swing is a **custom animation**, so the pack has to own the worm for it.
The sampler now reads the synchronised Space edge for the turn's own worm on
`FRAME_FINISH`, calls `worm:take{ turn = "freeze" }` and runs the clip from
`wa.world.frame() - start` until `ticks`, whatever WA's state machine is doing.
The take also eats WA's fire (nothing is launched, `eat_fire` is belt and braces)
and stops the turn timer, so a long swing cannot run the turn out. The aim and
facing at the press are latched for the whole clip, the art draws at full size
(the 20-frame aim draw-out belongs to aiming, not to a cut), and at the end the
worm is handed back with `worm:release(0, 0)` before `finish = "end_turn"` ends
the turn.

Two smaller bugs surfaced in the same pass:

- The press edge was read for **any** worm with the weapon selected, and the keys
  are the turn player's: a second worm of the team that still had the weapon from
  a past turn swung with someone else's press. The sampler now requires `w.turn`.
- `ws.space` was only latched while a swing was running, so after the first cut
  the latch stayed `true` for ever and no second swing could ever start. It is
  latched every frame now, which is what "one press, one swing" means.

The base record changed with it. The bat's subtype is the reason the worm never
animates, so the editor's melee option defaults to the **Sheep Launcher**
(`stock.sheep_launcher`), a power record: WA gives the worm a real aim phase and
a firing pipeline, the claim eats the fire, and the pack's clip is the only
animation that plays.

## Handles never compare equal, so the swing drew nothing

`wa.worms.all()` hands out a **new** `WormHandle` userdata per call and the
engine defines no `__eq`, so the handle stored when the swing started never
compared equal to the one in the next frame's list. The draw pass asked
`st.worm == w`, the answer was always false, and the clip fell back to WA's aim
pose: the worm froze (the take worked, the strike landed) and not one frame of
the animation appeared. The comparison is the stable `worm.id` (team * 16 +
index) now, next to the `o.id == w.id` the strike already used.

A second in-game pass played the clip and still dealt no damage. The strike's
arithmetic was no longer the open question, its inputs were (`worm.x`/`y` in
pixels, `worm.aim` 0..1, `worm.facing`, the victim's `hp`), so three things
changed. The hit landed on `tick == hit_frame`, which loses the strike outright if
one frame's message is missed: it is `tick >= hit_frame` with a latch now, still
one hit per swing. The clip ended when `w.weapon` stopped being ours, so a
selection WA moves during a taken swing cut the animation to two frames: only the
swing's worm dying ends it now, and the quads draw on the swing alone. And
`log = true` reports every worm's `along`/`across` with the reason it was skipped,
so an empty box names its own cause instead of only saying nothing was hit.

That bug is why `tools/lua/harness_melee.py` exists: it loads the real module
against a fake `wa` (with a fresh handle per `wa.worms.all()` call), presses
Space and walks the clip, so the swing's start, draw, hit and release are checked
without starting Worms Armageddon.

## One picture, one sheet: the export's atlas

Every role declares its own sheet path: `hold.png`, `missile.png`,
`bit_flight.png`, `state_homing.png`, `state_homing_bit.png`, `state_roam.png`,
`sheep_flight1/2.png`, plus the pack art and the stamp. When an author uploads
nothing, all of them resolve to the same fallback art, so an untouched export
carried six copies of one 64x64 PNG. WA binds every declared sheet into the
match's atlas, so that was six atlas slots and six ids for one picture: no visual
difference, real GPU cost, and an id per role that looked like six different
sheets in the log.

`src/utils/sheetDedupe.ts` groups the sheets the exporter is about to write,
keeps one file per group and rewrites the generated Lua and `mod.toml` to the kept
path. Two sheets share a file only when the bytes are identical **and** `mod.toml`
slices them into the same frame count: the declaration carries `frames`, and the
engine cuts a strip by it, so the same picture cut into 4 cells and 1 cell are two
different sheets. Two details mattered:

- the alias is keyed by the **bundle-relative** path (`sprites/<mod>/hold.png`),
  which is what the Lua and `mod.toml` name. Keying it by the ZIP path
  (`<mod>/sprites/...`) matched nothing and wrote one file while declaring
  another, which is a bundle that fails at load.
- the rewrite replaces whole **quoted** tokens, longest path first, because
  `state_homing.png` is a prefix of `state_homing_bit.png`.

The three layout files are written after the aliasing, so the paths they name are
the files the ZIP carries.

The first version grouped by the frame count alone, and a mod that used one
picture for three roles with different `sb.flight` speeds broke: `mod.toml` ended
up with **two** `[sprites."sprites/<mod>/hold.png"]` tables (`fps = 15` and
`fps = 11`), which is invalid TOML, so the engine lost the declaration and
`wa.on.draw` failed with "error converting Lua nil to table". Two lessons:

- the grouping key is the **whole declaration** for a strip (frames, fps, play),
  because one path carries one speed; two roles that want the same picture at
  different speeds are two sheets. `sb.flight`/`sb.hold` params are Lua and do not
  count, which is the case that *can* share.
- a one-frame sheet has nothing to animate, so its `fps`/`play` are inert and it
  shares with any other one-frame copy. That is the fallback-art case, and it is
  where the atlas win lives.

`collapseSpriteSections` now de-dupes by **header**, not by body, so a repeated
table can never reach the engine whatever produced it, and the claim `sprites`
list is compacted so an aliased role does not list the kept path twice.
`tools/check_sheet_dedupe.ts` covers both failures.

## Turn based, so one swing at a time

WA is turn based and WormForge runs it as deterministic lockstep, which decides
what a pack has to be careful about and, more usefully, what it does not. One worm
acts, its player's keys are the only input, and those keys are the same on every
peer. The swing sampler started out with a per-worm table and an "is anyone else
swinging" question that has no answer worth writing: the turn's worm is the
swing, so it keeps one state per weapon (`swing_of[entry]`) and asks for the worm
with `worm.turn`. Anything that could not happen (two worms firing at once, peers
disagreeing, an input out of order) is not handled, and the things a turn really
does (it ends, the worm dies, the weapon is dropped) are.

The rest follows from the same premise: every decision comes from synchronised
state (the frame count, the keys, the world), never from the render rate or a
random, and a duration is a number of 50 Hz ticks from a stored start frame. That
is why the clip is data (`clip_pose(t)`) and why a custom animation takes the worm
instead of watching WA's state machine. `AGENTS.md` opens with it now, so a fresh
reader starts from the right model.

## The aim clamp: WA's sweep has two bad ends

The last 30 degrees at either end of WA's 180 degree sweep are where a held
weapon looks worst: the art leaves its cell, the hand crosses the worm's face,
and a cut aimed straight down reads as noise. WA's own bat pipes its aim for
exactly that reason, and the first version of this feature could not: the only
things it could touch were our own draw, the swing's latched aim and a
`px.fire_seq` burst's launch vector. A plain record shot still went where the
player pointed, which is not what "cannot use that angle" means.

`worm.aim` / `worm.aim_target` are read-only, so the second thought was that WA's
aim is untouchable. It is not: **`worm:input{ aim = degrees }`** writes the very
value `control_aim` writes (+0x24C, PX's FireAngle). `docs/agent/lua-worms.md`
says so and names the trick (Core utilities' Fast aim), and `physics::worm_input`
is two writes and a message loop. The only question is *when*, because WA steps
the target 180/128 of a degree a frame while an aim key is held: the clamp has to
run every frame, after the player's key and before the shot.

`wa.on.body_move(fn, { kinds = { "worm" } })` is that hook: it runs before WA's
per-body step, once per worm per frame, inside the simulation context
(`dispatch::with_lua` -> `sim_context::with_sim`), which is what `worm:input`
requires. So `hold_install_aim_clamp` clamps the turn's worm's target while it
holds this weapon and the aim is out of range. WA still steps the target once
after the write, so the aim can sit one step (1.41 degrees) past the limit and
never further: the drawn aim eases to it, the fired vector comes from it, and the
layer paints its own pose at exactly the limit.

What that leaves for the layer is the parts a native write cannot do: the exact
drawn pose (`hold_clamp_aim`), the aim a swing is latched with, the strike's
reach, and a fallback for an engine build without `body_move`. It is also why
the clamp forces the quads.

Two things were paid for here. The first is that the engine always draws its own
hand, at WA's aim, so a clamped layer showed two hands past the limit; `M.hold`
parks it at `hand_radius = 0.01` (lesson 18's fallback, used for real) and the
layer draws the clamped one. The second is that the clamp was first emitted
inside the `swing` block, so a firearm with no clip got a clamp that reached
nothing: it stands on its own now, and `WF 54` is the firearm case beside
`WF 53`'s swing case. `harness_melee.py` walks the native path too: the fake
`wa` gained `wa.on.body_move` and `worm:input`, WA's own aim step, and four
checks that the target stalls at the limit, that an unclamped weapon still
reaches straight up, and that the drawn aim follows.

## One bad template kills the whole bundle

`copy_from = "stock.famas"` reads like an ordinary donor name, and the engine
answers `stock.famas: a template is one of WA's own weapons, stock.<name>`, then
`overlay failed: no overlay (InitGraphic did not run)`: the bundle does not
install, so **every** weapon in it is gone. A test pack with 54 weapons went down
because one entry named a firearm family rather than a slot (`uzi` is the
firearm donor; `famas` is a PX weapon, not a stock slot, and the editor's
FAMAS figure is only firing art).

Two guards came out of it. `gen_test_pack.ts` checks every entry's slot against
`stockDonors.json` before writing anything, so a typo fails in the console
instead of in the game. `generateLuaCode` no longer writes a template it cannot
vouch for: an unknown slot emits no `copy_from` and one comment saying why, and
the weapon takes its own slot's record. `tools/check_generator_edges.ts` holds
both halves (a real donor is still written, an unknown one is not).

## The throw is the aim vector too

The scan box and the push are the same vector, which is worth stating because the
box once read the art and the throw never did: `push = "aim"` hands
`hit(victim, vx, vy)` the scan vector times `push power`, with `lift` subtracted
from y (world y is down, so a positive lift throws up), and `push = { x, y }` is
the author's literal throw and still gets `lift`. So a level strike throws
`(power, -lift)`, a straight-down one `(0, power - lift)`, and neither knows what
`weap_radius` or `weap_rotation` say.

The `and/or` shape it used to have (`m.push_aim and (vx * m.power) or m.fvx`) was
safe by accident of Lua's truthiness (only `nil` and `false` are falsy, so a zero
component stays zero), which is the reason it survived: in most languages that
expression silently swaps in the fixed numbers on exactly the frames that throw
straight up or level. It is an explicit `if` now, and `harness_melee.py` pins both
throws so a future edit cannot change what a hit hands over.

## A swing can land several strikes, and a whiff has to be heard

The strike was one hit on one frame, which is a bat, not a combo. `melee.hits` is
a list now: each entry has its own `frame`, `damage`, `power` (or `vx`/`vy`) and
`lift`, all tested with the same box, each latched once per worm, each following
the clip's angle at its own frame. One strike still exports the old way
(`hit_frame` / `damage` / `power`), so an untouched weapon's file does not change;
two or more also carry `hits = { ... }`, with the first strike repeated in the old
keys so an older installed SDK lands something.

The `hit` callback gets the strike that landed as its fourth argument
(`hit and hit.damage or 26`), which is how one callback serves three hits without
a closure per strike, and why a three-argument caller still works.

The sounds came with it. A melee claim eats WA's fire, so the record's own sound
never plays: a swing that came off nothing was silent, which reads as a bug in
game. `hit_sound` now plays where a strike lands (at the worm it took) and
`miss_sound` at the striker when it takes nobody, once per strike either way.
`wa.sound.play(target, id)` is WA's own native playback, localised at the target,
so 96 is the same whiff the bat makes; `pcall`ed, because the verb is newer than
some engine builds and a missing sound must not cost the strike.

## The launch WAV, and the three hooks it cannot use

The record's `missile.launch_sound` is a native sample id: WA plays it itself,
and nothing in a pack can replace it. `customSounds.launch` is the file half of
the same idea, and it rides the claim's `on_fire`, i.e. the frame WA fires the
weapon. One play per trigger, on the firing worm's emitter, priority the author
picks.

Three cases shaped the emission:

- **Sequential fire already owns `on_fire`.** The play goes at the top of the
  handler `px.fire_seq` needs, before `seq.fire_seq_mis{`, so a three-round burst
  reports the trigger once instead of once per shot. A second `on_fire` key would
  have been the later one only.
- **An author's own `on_fire` owns the key.** Emitting ours as well would write
  the field twice, so the generated play is skipped and the card says so; the WAV
  is still written, and their handler can call `wa.sound.play` itself.
- **A melee claim never reaches `on_fire`.** `eat_fire` eats WA's fire dispatch
  and the swing takes the worm on Space, so the card is offered for every family
  but melee; the strike sounds cover that one.

The import side needed a new discriminator: the launch play and the explosion
play are the same shape (`wa.sound.play(ev.worm, path, n)`). The generated file
name answers it for our own bundles (`launch.wav`); for a hand-written one the
nearest enclosing hook before the play (`on_fire` or `on_explode`) does.

## Melee is a family of one, and its sounds can be yours

Two follow-ups to the strike work.

**Import.** A melee weapon's record is an ordinary power one (the Sheep
Launcher), so `fireTypeOf` read it as a projectile and the imported weapon lost
its Melee Strike page and its claim semantics. The record cannot answer it; the
claim's own `melee` table can, so `importWeapon` sets `fireType: 'melee'` when it
finds one. In the panel the same conclusion became a switch: melee is not one of
WA's fire types, and offering it in the Weapon Type select read like a fourth
kind of projectile. It is now a `Melee strike` switch beside the select, which
also clears `melee.enabled` when the author picks a real WA type, because a melee
table left enabled on a projectile would still eat WA's fire.

**Sounds.** The strike sound was a native id only. `MeleeSound` is `{ id, file?,
priority }` now: the id plays when nothing is uploaded, the file when it is, and
the file wins, exactly like `fire_draw` over `draw_hand`. The WAVs are declared
in the claim's `sounds` list (so the SDK resolves them like any pack sound) and
written as `sounds/<mod>/melee_hit.wav` and `melee_miss.wav`. One play per
strike, at the first worm it took or at the striker when it took nobody, and the
priority is the third argument `wa.sound.play` takes either way.

## The compiler's rules, in the editor, before the code is carried

Importing a real bundle loses its code, and the one kind of code that survives
(`on_explode`'s body) can survive broken: the Pulsar export carried
`aura[ev.missile] = nil` while the `aura` table stayed behind, so `on_explode`
threw on every blast. Carrying code needs a checker first, which is where the
work started rather than with the carrying, because a carried body nobody
validated is worse than a dropped one.

`src/utils/luaCheck.ts` reads Lua the way `wfcheck` does, without running it, and
uses the compiler's rule ids so a finding means the same thing in both tools:
`lockstep-rng` (`math.random/sin/cos/atan`, an error with the rewrite to
`wa.random`/`wa.math.*` offered, and `math.random()` deliberately not rewritten
because `wa.random()` is the raw 32-bit draw), `lockstep-pairs`, `module-wa`
(a `wa` read outside every function body, lesson 21), `undefined-global`,
`lua-ast`, `lua-nul`, `lua-size`, `undeclared-require`. `wa.on.draw` and
`wa.on.hud` bodies are exempt from the lockstep rules, as the engine words it.

Three surfaces: the custom Lua box (with Fix buttons), the generated file in
Bundle & Export, and an imported module (its findings become an import note). The
first pass needed four rounds of false positives before it was quiet: anonymous
function parameters (`function(fire)`), `for i = 1, n` (the backslash-b before `=`
never matched), the `h` of `0xFF000000`, and `require` arguments, which are
blank in the masked copy and have to be read from the original text. It is now
zero findings on the 55-weapon pack, both SDKs and the three real modules, and
exactly one on the Pulsar re-export, which is the real bug.

## Checked against the compiler, not against our own tests

The first version of `luaCheck.ts` was validated by its own cases, which is the
one dataset that cannot tell you the rules are wrong. So it was diffed against
the two implementations that already exist: `compiler-cli/src/checks.rs` (the
`wfcheck` the repo already runs, on the real Lua 5.4 AST via full_moon) and
`src/services/parser.ts` (the app's baseline, which wins `mergeDiagnostics`).
Same inputs, same files, both sides, rule by rule.

On the code this editor writes, they agreed from the start: 61 of 61 files in
`test_pack/wftest_pack` and `spec/lua_sdk` produced an identical rule set. On the
engine's own `mods/examples` they did not, and every difference was ours.

**Severities were wrong in three places.** `wfcheck` reports `math.cos/sin/atan`
as a *warning* (the sandbox leaves them working; the C library result may differ
per machine, which is a risk, not a crash), `pairs()` as *info*, and
`undefined-global` as a *warning*. We had error, warning, error. The visible
damage was the import summary, which counted `severity === 'error'` as
"blocking": an imported paint-only draw file reported two blocking problems that
the compiler calls advisories. `LuaFinding` has `info` now, and the card renders
three bands.

**The draw band was too wide and too shallow.** Only trig is presentation, and
`math.random` is nil in the sandbox rather than merely unsafe, so it raises even
from `wa.on.draw`. We muted everything in there, which hid a real error on
`stress.lua`. The band's roots were also found by searching forward for the next
`function` keyword after `wa.on.draw(`, which swallowed whatever function
happened to be defined below the registration (and missed a real `math.sin`).
Roots are function literals now, and a local helper called from inside the band
joins it transitively, which is the engine's own rule: a draw callback nearly
always delegates to a `sheet()` helper, and refusing to follow it was reporting
the engine's own packs as broken.

**Three shapes of valid Lua were reported as broken**, all found on real files:
`self` inside `function M:heal()` (bound implicitly, flagged as an undefined
global on every method of the audit harness), `arg` (a harness global missing
from our ambient list), and a bare `do ... end` inside a loop, which the block
counter read as the loop's own `do` and then called the file uncompilable.
Labels were reported as undefined names because `goto` was ignored. `bit32` was
in the ambient list; Lua 5.4 has no `bit32`, so listing it silenced a real typo.

The block counter was the worst of them, because `scanBlockEnd` is shared with
`parseCustomLua`: a bare `do` could end an `on_explode` body at the wrong `end`.
It consumes a loop header's `do` with a pending flag now, instead of asking
whether the text before the `do` mentions a `for`.

Two smaller ones: the global dedupe re-read its own message (`split('`')[1]`) to
find the name, so rewording a message would silently merge every later finding
into the first one, and the Fix button rewrote trig inside the draw band, where
there was no finding to fix.

What is left is deliberate. `wa-namespace-typo`, `worm-api`, `spec-key-typo` and
the `handle-union` notice need `engine_data.rs` (generated from the pinned engine)
and a real AST; a 449-line scan must not pretend to those, so it simply says
nothing and `wfcheck` stays the authority. After the pass: 61/61 on the pack
again, 14 of 15 on `mods/examples` (the one left is `wa-namespace-typo`), and the
custom Lua box verified in the browser: `math.random(1, 6)` reads as one blocking
issue with a working Fix, `pairs` as an advisory, trig in a draw body and `self`
in a method as nothing at all.

## The sprite-builder audit: five fixes, two findings that did not hold

`reqs/audit_wfws_sprite_builder_2026-11-16.md` reported seven "A" findings
against `wfws.sdk` 0.16.0. Checked against the SDK and the engine Rust before
touching anything, five held, two did not, and one of the five was in the wrong
file.

**A3 (a stale swing handle can act on another worm) does not hold.** `WormHandle`
carries the body uid it was built with and `get()` returns 0 once that uid is
gone, precisely so a freed handle cannot read the body WA put there instead
("it split online games", `actor.rs`). So `sw.hp` is 0, the swing's existing
`if st.start and not live` block clears it, and the release is a no-op. The
audit's open item 1 was a question; the answer was in the constructor.

**A7 (a spawn with no owner throws) does not hold either.** `runtime_spawn` maps
a nil owner to team 0 (`spawn.rs`: `Value::Nil => (inherit_owner.unwrap_or(0),
false)`). `missile_frame` sets no spawn owner, so `owner = owner or
current_worm()` landing nil costs the follower a team, not an error. The
sentence it cites ("a spawn without an owner errors") is stale in
`docs/agent/lua-world.md`; `owner = "none"` is still the clearer intent.

**A4 was the generator's.** `hold_melee_hits` is
`h.lift ~= nil and tonumber(h.lift) or spec.lift`, and 0 is truthy in Lua, so an
explicit `lift = 0` already passed through. What dropped it was
`if (hit.lift !== 0)` in `luaGenerator.ts`: a combo whose second strike throws
flat inherited the first strike's lift. Every listed strike writes its own
`lift` now, zero included; the single-strike keys still omit a zero.

**A6 was reachable only by import.** `melee` with no clip keys left a layer that
registers and a Space press that does nothing. The key table refuses to delete
the last key, so the panel cannot make it; an imported bundle with an empty
`swing` can. The export now writes one pose at the strike frame (with a comment
saying why), and the SDK logs once when a hand-written bundle asks for a strike
with no clip.

**A2 needed a different clock than the audit proposed.** The leak is real:
`gone` is the follower's brain, so a missile that never gets one (a stock walk
pose, a `states` entry with `native`, a roam primary before takeoff) keeps its
per-missile entries for the match. The first patch keyed the sweep on `age[id]`
and could never fire, because those are exactly the paths that return before
`age` advances. It uses `wa.world.frame()` now, with first sightings queued in
age order and the head dropped after a second when no follower owns it: one
fresh classification, never a growing table. `harness_flight.py` pins both
halves (swept, and not swept with a follower).

**A5 was declined after a question worth asking.** The firing pose reads `w.aim`
raw while the held art is drawn through `hold_clamp_aim`. But the clamp is a
native write in `body_move`, before WA's body step, so `w.aim` is already the
clamped target plus at most one WA aim step; and in the case the audit cites
(the write refused) the round genuinely leaves at the raw aim, so clamping the
firing art would draw a shot the engine does not take. It gets a comment instead
of a fix.

Landed as `wfws.sdk` 0.16.1: A2, B11 (`bits = "inherit"` keeps the identity, so
`sb.role` answers `"bit"` for a frag drawn from the primary's sheet), the A6
install log and the A1 hardening (a `wa.msg` guard before the swing's
`worm_message` filter, so a build without it cannot fail the whole install).

Validation: `lint`, `build`, `check_generator_edges` (two new cases),
`check_mod_import` (55/55), `check_copyfrom`, `check_sheet_dedupe`,
`check_lua_rules`, `audit_records`, `wfcheck` on the re-generated pack and on
`spec/lua_sdk`, `harness_melee.py`, `harness_flight.py` (13 checks).

## Carrying a bundle's Lua: the plan, checked against real bundles (M0)

`reqs/custom_code_import_plan.md` was reviewed against the four bundles the
machine actually has (`conductor`, `pulsar`, `railgun`, `vortex`) and then
against the whole installed corpus (47 bundles, 336 components, 255 weapon
modules outside the SDKs). The plan holds, with corrections that changed the
work order.

**The evidence is a spectrum, not one case.** `railgun` was authored with this
editor's generator, and its round trip is exact: trail (`max = 64`, `core_w` and
`glow_w` 40), interval sound (`every = 10`, `limit = 1`, priority 16) and blast
(`damage = 50`, `push = 150`, `hole = 40`) all come back byte for byte, because
its two `wa.on.missile_frame` handlers *are* the trail and interval-sound
features. `pulsar` is the same base plus hand-written handlers, so the modelled
parts survive and the `aura` line survives without its table. `vortex` is
hand-written from scratch: 119 lines out of 325, `on_explode` reduced to a call
to a `start_vortex` that nothing declares, and `wa.on.draw`, which draws the
hole, gone. `conductor` is a handgun whose whole weapon is its `on_fire` (65
lines, not the 190 the plan guessed): the export is a plain handgun with custom
hold art. So the rule is **generated code survives, hand-written code does not**,
and the plan's risk class is the plausible export (a grenade with a purple
burst) rather than the obviously broken one.

**`unmodelledClaimKeys` was quieter than it looked, in the wrong places.** It does
report `on_click` (PX's `marked_for_death` imports with `not carried: on_click`);
the silent keys were `on_fire` (in the "handled" list, carried nowhere) and
`on_explode` (handled, partly carried). The corpus also priced the plan: 76
modules with a claim hook, 97 with a `wa.on.*` registration, **118** whose hook
bodies close over module-level names and **20** over install-level ones (M2 and
M3, sized), 58 registrations carrying a `msgs` filter as their second argument,
and 58 hook bodies reading a name the generator also declares, of which two bind
a *different* module under it (`sb = require("wf-lib/seq-spb")` in the gas pump,
`zap = require("lib/electric_damage")` in PX's electric mine).

**M0 shipped (report-only, no carrying).** `src/data/luaHooks.ts` now holds the
hook keys and the corpus counts that ordered them, with the claim keys the panels
regenerate. On top of it:

- an imported `on_fire` is reported as not carried unless the `fire_seq` burst
  inside it was rebuilt (`unmodelledClaimKeys(source, absorbed)`), so the
  editor's own weapons stay quiet and the Conductor's weapon stops vanishing in
  silence;
- a module with no readable `copy_from` says so instead of quietly becoming a
  Grenade with 42 donor fields (`px.ports`, 97 records, builds its claim table at
  load through `lib/weapon.merge`);
- an imported sound role with nowhere to play is reported, which is how the
  Conductor's `shot` WAV was being dropped (the `shot` role is the fire
  sequence's `on_shot`, and a single-shot handgun has none);
- the custom `on_explode` body is wrapped in `NOT_GENERATED_OPEN`/`CLOSE` and
  `checkLua` tags findings inside as `notGenerated`, which `LuaFindings` shows as
  a `custom` chip with an explanation and the export toast repeats. The wording
  says "the editor did not generate this" rather than "carried from a bundle",
  because at M0 the field is shared: an import fills the box and an author types
  in it. The severity stays `wfcheck`'s.

Two bugs fell out of doing it. `customExplodeBody` scanned the raw text for the
block's `end`, so a comment containing the word "end" (the first version of the
close marker) closed the body early and left a dangling `--` in the snippet; it
scans the masked copy now, like `parseCustomLua` always did, which also fixes a
body with `"end"` in a string. And the marker had to be dropped on re-import, or
a second export nested them.

**PX-style bundles stay out of scope, provably.** A module whose claim table is
assembled at load (`weapon.definition()` returning `lib/weapon.merge(...)`) has
no claim literal, no `copy_from` literal and no hook literal in the file, so
carrying it would mean carrying PX's `lib/` graph. The plan now says so, which is
why the reader's misses there are expected rather than bugs.

Validation: `lint`, `build`, `check_lua_rules` (57 cases, the four marker regions
included), `check_generator_edges` (one marker pair, around the body, none
without a custom body), `check_mod_import` (55/55 plus the `on_fire`/absorbed
cases), `check_copyfrom`, `check_sheet_dedupe`, `audit_records`, `wfcheck` on the
re-generated pack (56 files, no findings), and a Playwright pass over Bundle &
Export showing `1 warning, 1 in code the editor did not generate` with the
`CUSTOM` chip.

## M1: the hook registry and the module splitter

M0 made the loss visible; M1 reads the file the loss is in. Two pieces, neither of
which emits anything.

**`src/data/luaHooks.ts`** is now the registry. `CLAIM_HOOKS` gains what each key
receives (`actor.rs`'s `weapon_emit` builds one table per fire/explode:
`x, y, weapon, worm`, plus `missile`/`vx`/`vy`), and `WA_ON_EVENTS` lists all 17
events the engine binds with their argument shapes and corpus counts. The fact
worth having in data rather than in a comment is `api.rs`'s `bind_on`: **only
`worm_message` takes an options table, and only `body_move` takes `kinds`**; every
other event errors on a second argument ("wa.on.{name} takes only a function").
`worm_message_msgs` then requires `msgs` to be a non-empty list of numbers. So a
carried `worm_message` whose filter was dropped still *loads* and runs on every
message, which is the quiet failure M6 has to avoid, and the registry now says so
in the same place the carrying code will read.

**`src/utils/modLib/splitModule.ts`** reads a module the way the engine loads it:
the preamble (module-level requires, constants, helpers), the install body's own
statements (the install-time locals and the registrations), every `wa.on.*` call
with its **whole argument list** split into handler and options, and the claim
hook bodies. It is the input M2, M3 and M5 need, and it already pays for itself as
an import note: `module code: 14 module-level declaration(s), 24 install
statement(s), 2 wa.on registration(s), 1 claim hook(s)` for the Conductor, `24,
25, 2, 1` for vortex.

Two bugs were found by writing its own tests, and both are the same mistake
`customExplodeBody` had:

- the statement scan ended a statement at the first newline, which cut
  `local x = function() … end` and every multi-line table in half, and a file with
  no trailing newline could not be closed at all (`return { … }` at EOF returned
  -1). Brackets *and* blocks now have to be closed, and EOF closes a balanced
  statement;
- the argument split only counted brackets, so the commas inside
  `wa.on.draw(function() for i = #bolts, 1, -1 do … end end)` were read as
  argument separators: the conductor's `draw` registration came out with two
  arguments and an options table of `1, -1 do local b = bolts[i] …`. The same
  `Depth` bookkeeping now serves the statement scan and the argument split, which
  is why the corpus check for "every option it passes is one the engine accepts"
  passes on all four bundles.

`tools/check_lua_hooks.ts` pins 56 cases: the registry's invariants, the editor's
own module shape, the Conductor's filtered registration, PX's
`function M.install(ctx)` form, bodies that contain `end` in a comment, `"end"` in
a string and a nested function, the four real bundles (registration and hook
counts, and the conductor's `msgs` filter), and all 55 generated weapons (each
splits with no notes; every file that contains `wa.on.` yields a registration and
every event is one the engine binds). No fixtures were vendored from other
authors' mods: the shapes are built inline and the real bundles are read from
`Mods/` when they are there.

Validation: `lint`, `build`, `check_lua_hooks` (56), `check_lua_rules` (57),
`check_generator_edges`, `check_mod_import` (55/55), `check_copyfrom`,
`check_sheet_dedupe`, `audit_records`, `wfcheck` on the pack.

## M1.5: recognising this editor's own output

The plan's open questions 2 and 3 were about doubling: once M6 carries
`wa.on.*` registrations, a bundle this editor wrote would arrive with its own
ribbon-trail sweep and interval-sound ticker, and those are exactly what the
ribbon trail and interval sound cards already emit. Carrying both means two
ribbons and two sounds from one import.

`src/utils/modLib/ownOutput.ts` answers the question the decision needs, from the
text: did this editor write this block. Three signatures, each one true only of
our emission and each requiring the side table the generator writes with it, so a
weapon that merely follows missiles is not claimed:

- **ribbon trail**: `missile_frame` calling `trail.add(m.id, trail_worm(), TRAIL)`
  with `local TRAIL = {` in the install body (and `trail_is_bit` when the target
  is not `main`);
- **interval sound**: `missile_frame` ticking `sound_ticks[m.id]` and playing
  `SOUND.path`, with `local SOUND = { path = … }`;
- **fuse sampler**: `worm_message` filtered to `FRAME_FINISH`, writing
  `fuse_by_worm[w.id]` from the keyboard digit, with `FUSE_DEFAULT` above it (a
  module-level declaration, which is why the signature spans the preamble and the
  install body).

The near misses are the test cases: a hand-written `missile_frame` that plays a
WAV on a timer, a `FRAME_FINISH` handler with no fuse table, and a `trail.add(`
call with no `TRAIL` table all stay foreign.

The import summary now separates the two halves instead of counting them:

```
Pulsar    wa.on handlers: 2 rebuilt from the panels (ribbon trail, interval sound); 1 not modelled (missile_frame)
Railgun   wa.on handlers: 2 rebuilt from the panels (ribbon trail, interval sound)
Vortex    wa.on handlers: 1 rebuilt from the panels (ribbon trail); 1 not modelled (draw)
Conductor wa.on handlers: 2 not modelled (draw, worm_message)
```

The pack invariant is the strong one: all 8 registrations across the 55 generated
weapons are recognised, so the editor never writes a handler it cannot identify.
That is `tools/check_lua_hooks.ts` (68 checks now) plus 9 assertions in
`check_mod_import.ts` that no test-pack weapon reports a handler as unmodelled.

One gap is left on purpose, and the plan records it: a recognised block whose card
is switched off in the import (a hand-written fuse sampler beside a custom
`on_fire` is the real case) is still reported as rebuilt, and the export would drop
it. Choosing between "carried" and "regenerated" is M6's decision, because M6 is
where carrying exists.

Validation: `lint`, `build`, `check_lua_hooks` (68), `check_mod_import` (55/55),
`check_lua_rules`, `check_generator_edges`, `check_copyfrom`,
`check_sheet_dedupe`, `audit_records`, `wfcheck` on the pack.

## M2 and M3: carrying a hook's closure

The plan's M2 (preamble) and M3 (install locals) turned out to be one milestone.
Carrying a module's preamble with no hook that reads it is dead code, and carrying
an install-time local without the module constant it reads is a nil at run time.
The unit is the **closure of the hook body this editor actually carries today**,
`on_explode`.

Vortex is the case that sized the work. Its `on_explode` is one line,
`start_vortex(ev.x, ev.y, ev.worm)`, and the chain under it is:

```
start_vortex -> tick -> pull -> steer
                    -> scatter
                    -> finish
                    -> play_at
                    -> vortices, END_AT, BLAST_AT, DAMAGE, BLAST_RADIUS,
                       TERRAIN, REACH, CAPTURE, SPEED_MIN/MAX, TURN_MIN/MAX
```

Eight install helpers and twelve module constants. Pulsar needs one install table
(`aura`). Railgun and the Conductor need nothing, for different reasons: railgun's
`on_explode` is the editor's own, and the Conductor's code is `on_fire`, which
waits for M6.

`src/utils/modLib/carryClosure.ts` resolves free names with `luaCheck`'s own
reader (`freeNames`, the new `editorAmbient: false` option: a carried block's `fx`
is the bundle's, not ours), install body first, preamble second, source order, and
emits survivors twice: the preamble before `return {`, the prologue at the end of
`install` before the claim.

Four hazards, all found by writing the check first:

1. **Shadowing.** Every one of the four bundles declares `fx`, `trail`, `sb` or
   `zap`, and the generator declares its own. Same module: drop the carried block
   (the generated local serves both). Different module: rename to `<name>_bundle`
   across all carried text, because a shadowed `fx` is a callback that silently
   does nothing. The rename runs on the masked copy, so `"fx"` in a sound path and
   `a.fx` survive untouched.
2. **Our own output carries back.** WF 37/39/43/44 (the stamp weapons) re-imported
   with their generated `local STAMP_HIT` / `local function stamp_hit` carried as
   foreign code, because the hook body reads them and the export declares them. A
   block whose text is **identical** to something the export writes is dropped;
   that also makes the round trip idempotent, which is the property the check
   pins.
3. **A bare assignment is not a declaration.** Pulsar declares `local zap` at
   module level and assigns `zap = require("wf-lib/electric/damage")` inside
   `install` (lesson 21's shape). Carrying only the assignment writes a global, so
   the resolver follows it out to the `local` that owns it.
4. **The bundle's art does not travel with its code.** The ZIP ships
   `sprites/<mod>/` and nothing else, so a carried
   `sprite = "sprites/vortex/hold.png"` names a folder the export does not have.
   Only the folder segment is rewritten: the file names are the author's, and a
   file the export does not write is a missing-art error with the path in it,
   which is the failure mode we want.

Lockstep maths is rewritten rather than blocked, and through the same
`fixLockstepRng` the custom Lua box's Fix button uses, so there is one mapping in
the editor: `math.random` to `wa.random`, `math.sin/cos/atan` to `wa.math.*`. The
float form `math.random()` has no equivalent (`wa.random()` is the raw 32-bit
draw) and is reported instead of silently changed.

Carried `require`s also bring their dependency: `effects.sdk`, `px.electric`,
`wf.sdk`, `wfws.sdk`, `px.fire_seq`, added to `extraDependencies` because a
manifest line the import never saw is what makes a carried require resolve.

Result, measured: vortex exports with `start_vortex` declared, no dangling name,
and `wfcheck` clean; its black hole runs and still cannot draw (`wa.on.draw` is
M6's), which the import summary says instead of leaving a plausible purple burst.
Pulsar exports with `aura` declared, so the hook no longer writes to a nil.

`bun run tools/check_carried_lua.ts` pins 43 cases: the closure shapes, the
lockstep rewrites, the float form, a dangling name, an unclosed block refused, the
rename with a string saying `fx` left alone, same-module dedupe, the art-path move,
the dependency map, the four real bundles (counts, no dangling name, round-trip
identity, one header per export) and the 55 test-pack weapons carrying nothing of
their own.

## M5 and M6: the hook has its own slot, and the hole gets its draw

M5 was a deceptively small item on the plan: "the carried `on_explode` merge".
Yesterday an imported bundle's `on_explode` body was stuffed into the author's
`customLuaSnippet` box, which meant the next export could not tell the two apart,
the panel showed a snippet nobody wrote, and `customExplodeBody` (which strips our
own generated lines on a re-import) was rewriting the bundle's code as if it were
ours.

The fix is a second list. `project.carriedLua.hooks` holds `{ key, text, line }`
for every claim hook nothing models, and the generator inlines it at the top of
the one handler it emits for that key, each region wrapped in `NOT_GENERATED_*`
markers with its own `local <param> = ev`. Pulsar's export is the proof:

```lua
on_explode = { on = function(ev)
  if ev.worm then wa.sound.play(ev.worm, "sounds/pulsar/explosion.wav", 10) end
  zap.set_message_electric(20, 0, -4, true)
  blast.explode{ ... }
  -- not generated by the editor: custom Lua, or a hook an imported bundle carried in
  if ev.missile then aura[ev.missile] = nil end
  -- end not generated
end },
```

One key. The author's box stays empty, so an author can still add their own line to
the same callback without touching what the bundle brought.

M6 then had three parts, and only the first was the one the plan named:

**`on_fire`.** Same merge, same order: the launch-WAV play, the `fire_seq` burst,
then the carried body. The Conductor is the whole reason: its weapon *is* a
65-line hand-written gun in `on_fire`, with its own bolt geometry, its own
`wa.actors.spawn` calls and a `wa.on.draw` that paints them. Nothing in the panels
models a crossbow bolt, so the honest answer is to carry the code and its chain.
That chain is 14 prologue and 12 preamble blocks (`bolt_end`, `draw_bolt`,
`step_bolts`, `BOLT`, `BEAM_FRAMES`).

One trap: a bundle's `on_fire` that is *only*
`wa.sound.play(ev.worm, "sounds/<mod>/launch.wav", …)` is this editor's own
output, written by the Custom WAV card. The importer recognises that shape and
does not carry it, or the re-export would play the launch sample twice.

**Registrations.** `ownOutputOf` (M1.5) already separates our three signatures from
everything else, so the carry is `ownOutputOf(split).foreign`, written verbatim
after everything the editor installs, reindented by four, options table included.
That last word is the part that matters: `wa.on.worm_message` is the only event
that takes `msgs` and `wa.on.body_move` the only one that takes `kinds`, and an
event given the wrong second argument fails at load. The Conductor's
`{ msgs = { wa.msg.FIRE_WEAPON } }` survives because it is *text*, not something
the importer re-derives.

**Art.** The one part the plan understated. Vortex's `start_vortex` draws its black
hole through `wa.draw.quad{ sprite = HOLE }`, and carrying the code without the
sheet would have produced a weapon whose whole point was invisible. Four separate
things had to be true, and each was a bug until it was:

1. the path is rewritten with the code (`sprites/vortex/blackhole.png` becomes
   `sprites/vortex_grenade/blackhole.png`, folder segment only);
2. the file is in the ZIP (bytes identical to the source, checked with a hash);
3. it is *declared*, with the source bundle's own `[sprites."…"]` table: vortex's
   sheet is a 15-frame rotation strip, so `frames = 15, fps = 10` has to survive.
   Matched by file name, because by then the path has already moved;
4. it is in the claim's `sprites` list, because `wa.draw.quad` resolves a pack path
   through the sprite-key registry that list fills.

`carryClosure` now returns `paths: { source, target }[]` rather than a count, so
the importer can load each file from where it actually was. A path that is
*already* the export's own (which is what a re-import sees) is recorded too: without
it, the second pass would find no move, forget the sheet and quietly drop it.

Measured after M6, with `wfcheck` on each export:

| bundle | carried | registrations | wfcheck |
| --- | --- | --- | --- |
| vortex | 12 prologue, 21 preamble | `draw` + our trail | no findings |
| pulsar | 7 prologue | `missile_frame` (aura) + our 2 | one `handle-union` note |
| conductor | 14 prologue, 12 preamble | `draw`, `worm_message` | one `handle-union` note |
| railgun | nothing | our 2 | no findings |

`bun run tools/check_carried_lua.ts` is 59 cases now and pins the three things that
would silently regress: the author's snippet stays empty, the export writes one
`on_explode` key, and each carried registration appears once, so the export is
exactly ours plus theirs, never ours twice.

Two smaller lessons, both paid for in this pass:

- **A test that reads a bundle as text loses its WAVs.** The round-trip check read
  every exported file with `readFileSync(full, 'utf8')`, which turned
  `interval.wav` into mojibake with no `bytes`. Pulsar's interval sound feature
  was then off on the second import, `sound_worm` became an orphan and got carried
  as a new block, and the check reported a round-trip mismatch that was entirely
  the harness's fault. Art has to be read as bytes, in the harness as in the app.
- **`maskLuaCode` has to keep a string's quotes.** With the whole literal blanked,
  `local HOLE = "sprites/vortex/blackhole.png"` and the next line's `local FRAMES =
  15` became one declaration, and vortex's `FRAMES` came back as an unresolved
  name. One character of fix (`"` on each side), and the closure resolved again.

## The emitter: PX's effect manager as something that lives in the world

The effects SDK could already draw a burst at a point (`fx.burst`), a ring at a
point (`fx.ring`) and a ribbon behind a round (`trail`). What it could not do is
*stay*: PX's `CEffectManager` is an object with a position, a target it follows
and a lifetime, and the three weapons that use it in Project X (the red saw's
three rings around the flying disc, the electric mine's thunder, the marked-for-
death bolt) are all the same object with different tables. So the new feature is
`fx.emitter`, not three presets, and the editor's card edits one table.

**An emitter is an actor, and actors need a brain and an owner.** `wa.actors.spawn`
refuses a zero handle, and `wa.on.draw` must not decide anything (§0), so the
driver's own `on` brain is the whole simulation of it: sample the anchor, move the
ring, age the bolts, remove the parts whose clock ran out, and despawn when
nothing is left. Drawn in `draw`, moved in the brain. Because the ring is an
`fx.ring` with a `follow` closure, the ring needed no code of its own: the anchor
closure the emitter passes down is the same one the card configures. The one gap
was a ring given no anchor, which then stood still while the emitter walked away
from it; a ring with no `follow` now gets a closure over its emitter that returns
`nil` once the emitter is dead, so it follows and it dies with it. That was a real
bug found by the harness, not by reading.

**Turn-based, so one emitter is enough.** There is no "which worm's emitter" table:
the muzzle emitter is moved only while `w.turn and w.weapon == ctx.id`, so the
second worm's aim never touches the first one's ring. The plan for a per-worm map
was dropped for the reason §0 gives: it cannot happen.

**The anchor has to be able to give up.** A round emitter follows the newest
missile of this weapon, latched by `m.id` (counted up, never reused, identical on
every peer), and its closure returns nothing once that missile is gone, which ends
the emitter through the ordinary path. `round` is refused where WA has no missile
of ours: a placed mine is a mine entity, and a strike's bombs are built from the
strike's own record copy with no `m.weapon` (lesson 14's twin). The card greys the
switch and the generator falls back to `muzzle` rather than writing an anchor that
would never fire.

**The muzzle emitter is the aim clamp's hook again.** `wa.on.body_move` is the
per-frame worm hook the clamp already installs, and the fire angle is the same
one the melee box uses: `(facing * sin(aim*PI), cos(aim*PI))`, with `worm.aim`
WA's 0..1 sweep. PX's `curDist` is the offset along it. Nothing here reads the
held art's `weap_radius`, so an emitter cannot end up behind the worm the way the
melee box once did.

**A gesture the editor writes must be a gesture it recognises.** The generated
`body_move` registration and the `on_fire` hand-off are new output shapes, and
`ownOutput.ts` has no way to tell them from a bundle's own code by accident, so
the emitter is a fourth `OwnFeature`: a `body_move` handler that calls
`emitter_muzzle(`/`emitter_for(` in a module that declares `local function
emitter_for(`. Without it, importing an exported emitter weapon carried the hook
back as foreign code and the export shipped two emitters fighting over one ring.

**Rainbow is a colour, not a shader.** PX's `SetRainbowMode` walks the hue round
the clock; the SDK does the same through `HueToRGBLocal` (centred at 180 so the
colour never passes through black), and the clock is the simulation's frame
counter. The trap was the sines: `trail.lua`'s hue helper had used `math.sin`,
which wfcheck bans and which can differ between machines. It runs through
`wa.math.sin` now, and the ribbon can also run the hue *along* its length rather
than only with time, which is what makes a rainbow look like a rainbow instead of
a flashing ribbon.

**Noise is a fixed table, not a random.** A crackling trail has to wobble the same
way on every peer, so `noise` displaces each point along the ribbon's normal from a
257-entry table built once at load and indexed by the point, never a call made
while drawing: same table, same look, no lockstep risk, and it costs nothing per
frame. The arcs and bursts in `px_effects` do use a generator, but one seeded once
from `wa.random` (the engine's synced generator) and drawn from afterwards, so the
sequence is still identical on both machines.

Two things the UI had to get right and one it does not: the emitter's own
`rainbow` reaches every part that does not set one (PX has a single switch, and an
author who ticks it means all of it), an emission is only written when a panel
value differs from the default so an untouched card emits nothing, and the ring's
`ellipse` is stored as plain multipliers rather than the SDK's two circumferences,
because that is the number a person can reason about.

`python tools/lua/harness_effects.py` is the dev harness (lupa, so it is not part
of `bun run lint`): 20 checks over the SDK with a fake `wa`, including the ring
following a moved anchor, the ellipse being wider than it is tall, both bursts, the
thunder bolt, the death cascade and the trail's noise bending off the chord. Two of
them failed on the first run, which is the point: the ring did not follow, and the
"one driver" assertion was counting the trail's own driver as a second emitter.

## A preview has to play the library, not draw a picture of it

The emitter card shipped with a still SVG "sketch": a ring polyline, two bowed
lines for the bolts, a circle for the spark. Every number was in the right place
and it still told an author nothing, because nothing an effect does is a
position. A crackle is *timing* (bolts on a cooldown, a spark on its own 10-frame
cycle), the ring is *spin and jitter*, and the difference between the two presets
is that thunder is one bolt every 30 to 110 frames that grows in two frames, holds
three and fades over twenty, while electric is two bolts every 13 to 51 that arc
out and vanish. None of that is drawable as a still.

So the sketch was replaced by `EmitterPreview`, which is `ExplosionPreview`'s and
`RibbonTrailPreview`'s pattern applied to the third effects feature: a canvas, a
50 Hz interval, the SDK's own maths and sheets, and a scene that shows the thing
in the situation the card describes. The scene is the interesting part. A muzzle
emitter lives on a worm's fire angle, so the preview draws WA's own aim strip
(`assets/worm/aim.png`, 32 frames from straight down to straight up, the same
sheet the hold preview draws) and sweeps it, places the emitter at the generator's
own muzzle formula (`dx * offsetX + dy * offsetY`, so the preview and the Lua
cannot drift apart), and then fires the round and hands the emitter over. The
round is a plain ballistic arc that ends on the ground, which is where the emitter
dies, ring and all, and where the ribbon starts shedding.

Three things came out of building it, all of them real:

- **A ring with no anchor of its own did not follow its emitter.** `fx.emitter`
  passes `o.follow` down to `fx.ring`, and the muzzle emitter has no `follow`
  (it is moved by `move_to`), so the ring sat where it was created while the
  emitter walked away. The harness caught it and the fix is the obvious one: a
  ring with no `follow` gets a closure over its emitter that returns its position
  and returns `nil` once it is dead, so the ring follows *and* dies with it.
- **`carry` on a family that never fires a missile left an emitter behind.**
  `emitterCarries` only asked whether `carry` was on, not whether the record
  produces a round, so a placed mine wrote the hand-off, and `emitter_round`
  then returned the launch point for the rest of the match because no missile of
  the weapon would ever appear. The generator now requires `emitterRoundOk`, the
  card disables the switch, and `check_generator_edges.ts` pins it.
- **A tinted sheet cannot be rebuilt per frame.** The explosion and trail
  previews tint one copy per colour, which is fine when the colour is a panel
  value. Rainbow changes it every frame, and a tinted canvas per frame is a
  garbage churn the render loop cannot afford. The emitter preview caches tint
  by sheet and colour in a `Map` with a cap, so a rainbow pass reuses the copies
  it already made as the hue comes back around.

The preview is also how the panel's own numbers were sanity checked: `Fit` is the
default because a 30 px ring is a dot on a desktop canvas, `1x` is one canvas
pixel per game pixel, and the readout names the ring's radius in game pixels, so
"26 px" in the card and "26 px" in the game are the same claim.

## The emitter that drew nothing: a boolean where a table belonged

The first in-game run of WF 56 drew nothing at all, and the log said why in one
line:

```
ERROR on_fire: runtime error: [string "libs/px_effects.lua"]:71:
  attempt to index a boolean value (local 'src')
  [string "libs/px_effects.lua"]:787: in field 'emitter'
  [string "weapons/56_emitter_ring.lua"]:57: in upvalue 'emitter_start'
```

`fx.emitter` reads `spark`, `glow`, `reach`, `trail` and `ring` as *override*
tables, so `copy(spark, o.spark, SPARK_KEYS)` handed the boolean `true` to
`merge`, which indexed it. The generator writes `spark = true` because that is
what the flag means, and the library is the wrong place to insist otherwise: a
non-table override is "no overrides, use the preset". `merge` now returns the
destination unchanged for anything that is not a table. Two lessons, both
cheap to state and expensive to learn:

- **A preview that fakes the library only proves the fake.** The harness passed
  because it built its emitter with `lua_table('{ ... }')` and never wrote
  `spark = true`. The fix is not only the guard but `harness_emitter_weapon.py`,
  which loads the *generated* weapon file, installs it, moves the worm, fires and
  checks that a ring pass was drawn, and which fails with the exact in-game
  message when the guard is reverted.
- **Two flags can share a name and mean different things.** `fx.install{
  trail = ... }` gates the *module*, not the round's card: it is what calls
  `trail.install()`, and that is the hook that draws a ribbon. The generator was
  writing `trail = usesRibbonTrail`, so an emitter with its own ribbon sampled
  points and never painted them. It now passes `true` when either card wants a
  ribbon.

The same run asked for one more thing: the ring's bend should follow the round.
`ring.track = true` makes the SDK point the ellipse at `wa.math.atan(vy, vx)` of
whatever the ring rides (the emitter hands its velocity down through the follow
closure), with the author's `angle` as an offset. The spin is not applied while
tracking, because the heading is written every frame and the two would fight; the
card disables the Spin box and says so, and the preview mirrors the rule, so a
grenade's lens visibly turns through its arc.

### One library, several mods: the draw callback had to belong to each of them

`px_effects` is required once and keeps one set of effect lists, which is what
lets the hidden driver tick everybody. The first `fx.install` also registered the
only `wa.on.draw`, so that mod's sprite claim had to resolve every sheet any
other mod's effect drew. A burst-only weapon drew the all-features weapon's
spark under its own claim and the engine refused the quad: `sprite
'wf-lib/effects/sprites/px_effects/spark' is not installed`. The fix has two
halves, because either one alone still leaves a hole:

- `effects.sdk` 0.4.2 tags each created effect with `wa._mod`, registers a draw
  callback per installing mod, and draws only its own. A mod without a spark
  sheet can no longer be asked to draw one.
- Every generated weapon that installs `fx` claims the entire shared sheet set
  (`trail.BEAM`, `trail.GLOW`, `fx.SPARK`, `fx.BLOB`, `fx.SMOKE`), not just the
  features it enabled. The emitter's own spark and glow were never claimed at
  all, so its first draw failed even alone.

The re-export also exposed a hand-edit in the installed `effects_sdk/mod.toml`:
`[sprites."sprites/px_effects/spark/]` (a missing quote) made the whole library
manifest invalid, and the engine reported it as `library dependency effects.sdk
is not installed` for every bundle that used it. The spec copy was already
correct; the installed one is now the same 0.4.2 file.

### The emitter's hand-off was eating the shot

The emitter used to arm its hand-off from the claim's `on_fire`: the tube stayed
on the aim until Space, then the handler was supposed to retarget it to the round
WA built. It never did, because a claim `on_fire` is not a notification. The
engine hooks `CreateWeaponProjectile` and, when the slot has an `on_fire`, calls
it and returns **before** WA makes the missile (`actor::create_proj_hook`), so
the weapon fired nothing and the emitter had nothing to follow. It stayed at the
muzzle for the rest of the match. PX's own railgun does not have this problem:
its `FireFinal` calls `super` first and then reads the last object.

Two rules now:

- **The emitter writes no `on_fire`.** The round WA builds is discovered from
  `wa.on.missile_frame`: the first missile with `m.weapon == ctx.id` is the
  round, its `m.id` is latched, and the emitter either moves there (a muzzle
  emitter with `carry`) or is created there (`round`). The follower answers from
  the cached position (`EMITTER_AT`) and returns nil once the cache is stale, so
  the SDK ends the emitter. The SDK marks it dead, and the next round's first
  frame re-arms the latch.
- **The aiming effect runs on `FRAME_FINISH`, not `body_move`.** `body_move`
  only runs for a body WA is stepping, so a worm standing still to aim never
  moved the effect; the firing recoil was the first frame that did, which is why
  it looked like Space created it. The `FRAME_FINISH` worm message runs for every
  worm every frame, and the gate is the weapon being out: `w.aiming` (ready,
  charging, pre-firing) or the firing/fired states.

The harness now asserts the claim has no `on_fire` and that the effect ends with
the round, because either half alone regresses silently: a hand-off in `on_fire`
looks right in the file and fires nothing in the game.

The same trap is latent in the launch WAV role: when no other feature writes
`on_fire`, the generator writes a handler that only plays the sound, which also
suppresses WA's shot. It has not bitten the test pack yet (no generated weapon
there uses a launch WAV), and the fix is the same shape: play it from a filtered
`worm_message` on `wa.msg.WEAPON_RELEASED`, not from `on_fire`.

### Emitter follow-up: multi-round tracking, `FRAME_FINISH` scan, and `keepWhileFiring`

Three live-game findings finished shaking out the emitter hand-off:

- **`wa.on.worm_message` must scan `wa.worms.all()` rather than trust its argument.**
  When the muzzle tracker moved from `body_move` to `FRAME_FINISH`, reading
  `w.turn` off the callback parameter left `w.turn` nil and the aim emitter
  never appeared at all. Switching back to `wa.on.body_move` proved why the old
  comment existed: standing still to aim never steps the worm's body, so the
  aim emitter only appeared on Space recoil or walking. Deduplicating once per
  tick with `EMITTER_FRAME = wa.world.frame()` and scanning `wa.worms.all()` for
  the living turn worm (`c.turn and (c.hp == nil or c.hp > 0)`, the same
  pattern `wfws_sprite_builder.lua` and the fuse sampler already use) brings
  the emitter up immediately while standing still to aim.
- **One emitter per fired round (`EMITTER_ROUNDS[m.id]`), separate from the muzzle aim emitter.**
  Keeping a single `EMITTER`, `EMITTER_ROUND`, `EMITTER_AT`, and `EMITTER_CARRIED`
  per weapon meant firing 10 grenades (e.g. a `fire_seq` burst or multi-shot)
  only gave the first grenade an emitter, and stealing `EMITTER` + setting
  `EMITTER_CARRIED` killed the muzzle aim emitter on the first shot.
  `px_effects` already supports any number of concurrent emitters with unique
  negative trail keys, so `emitEmitterBlock` now stores per-missile state in
  `EMITTER_ROUNDS[m.id]` with an individual `emitter_round(id)` follower that
  clears its slot and returns `nil` when frames stop arriving, while the muzzle
  aim emitter stays independent.
- **Muzzle visibility follows Hold's `keepWhileFiring`.**
  When `project.hold.keepWhileFiring` is false (e.g. a thrown grenade), the
  muzzle emitter gates on `w.aiming` only so it disappears once the worm enters
  the throw/firing states; when `keepWhileFiring` is true, it gates on
  `w.aiming or w.state == "firing" or w.state == "fired"` so it stays through
  firing frames too. `ownOutput.ts` recognizes both `EMITTER_ROUNDS` and legacy
  `EMITTER_ROUND`, as well as both `FRAME_FINISH` and `body_move` muzzle handlers.
- **Radial muzzle offset (`radialAngle`) and facing-symmetric side offset (`offsetY`).**
  Added `radialAngle` (degrees, added to `(w.aim or 0.5) * math.pi`) to
  `EmitterConfig`, `EmitterCard`, `EmitterPreview`, `luaGenerator`, and
  `importFeatures` so muzzle placement sweeps radially around the worm along a
  tilted aim arm (`Muzzle Radius` + `Radial Angle`) rather than only a flat
  coordinate offset, and fixed `offsetY` across the radial arm to use
  `(w.facing * c, -s)` so positive side offsets sit above the barrel on both
  left and right facings.
- **Ring rotation spins the entire effect, not the rays (`px_effects.c` angle math).**
  `px_effects.c` (`UpdateAndDraw`, `DrawSpinFX`, `DrawRingFX`, `DrawThinSpinFX`)
  computes `(uX, uY) = (cos * circumference, sin * circumferenceSin)` first and
  rotates the whole shape by `(cosRot, sinRot)` (`px = x + (uX * cosRot - uY *
  sinRot) * totalRadius`), while leaving `DrawReachPoint` reach rays unrotated
  in world space. Both `px_effects.lua` (`draw_ring`) and `EmitterPreview.tsx`
  previously added `st.angle` before multiplying by `ex, ey`, which only slid
  points along an axis-aligned ellipse; both now rotate `(ux, uy)` by
  `(cos_rot, sin_rot)` after ellipse scaling.
- **Projectile Exclusive, Owner Fire-Angle Ring Tracking (`followFireAngle`), and Pure Positional Offsets (`posX`, `posY`).**
  - `projectileExclusive` (`projectile_exclusive = true` in `emitter_for`) disables muzzle aiming emission completely (`wa.on.worm_message` and `emitter_muzzle` are omitted) while keeping `wa.on.missile_frame` / `EMITTER_ROUNDS` active so the emitter only appears once projectiles are launched (placed mines/strikes without weapon projectiles still fall back to muzzle).
  - `followFireAngle` (default `true`, opt-out via `follow_fire_angle = false`) rotates the ring/ellipse angle (`EMITTER.ring.angle` during aiming with accumulated `EMITTER_SPIN` when `ring.speed ~= 0`, plus `spec.ring.angle` at projectile spawn when `!ring.track`) along `emitter_fire_angle(w)` (`wa.math.atan(wa.math.cos(fa), w.facing * wa.math.sin(fa))`), using `effects.sdk` 0.4.2's `e.ring.angle` field directly without modifying the SDK bundle.
  - `posX` and `posY` add pure Cartesian offsets (`+/- w.facing * posX` on muzzle, `+/- posX` on rounds, and `+/- posY` without aim-angle trig), omitting aim trig from `emitter_muzzle` completely when radial offsets (`offsetX`, `offsetY`, `radialAngle`) are zero; `importFeatures` and `EmitterPreview` round-trip and preview all three options.

### Reach direction, shared color and independent ribbons

Reach bolts now have a deterministic `direction` (screen degrees, 0 right and 90
 down) and `spread` (total angular width), and the preview uses those same values.
The top-level emitter RGB is applied in the SDK to sparks, glow, reach and the
emitter's ribbon unless rainbow is active; importing reads that color even when
the reach table is disabled. Reach is an independent panel state: `reach = false`
means off, while a reach table with `count = 0` remains enabled but produces no
bolts. The importer and generator edge checks pin both forms, direction/spread,
and color.

The projectile ribbon and emitter ribbon are also separate features. Either one
requests `fx.install{ trail = true }`, which installs the SDK sampler and draw
callback once. Only the projectile trail feature emits `trail.add` and its
missile tracking code. The generator no longer emits an extra `trail.install()`
for that projectile feature, avoiding duplicate/incorrect install behavior when
the effect SDK is shared across weapons.

## M7: the panel, and the two leaks the pack weapons found

The last milestone on the import plan was the one that makes the carrying
reviewable: a list of what an import took out of a bundle, with a switch each.

`CarriedLuaPanel.tsx` sits on Bundle & Export, above the dependencies card, and
renders nothing for a weapon with no carried code. One row per block in emission
order, each with its kind, what it declares or which event it is, what pulled it
in (`read by cell, CLOSE_START`), its line count, its requires, and the code behind
a `Show the code` disclosure. One switch per row, `role="switch"` because a thumb
has to hit it. Switching a block off sets `disabled` on it: the text stays in the
project, the generator stops emitting it, and switching it back restores it, which
is a property worth having because the alternative (deleting) makes an author
re-import to undo a mistake.

The useful part is not the list, it is that the validator reads the same file. The
generator now wraps every carried region in the `not generated` markers (preamble,
install locals, registrations, merged hook bodies), which buys one thing: a finding
inside carried code is tagged `custom`, so the panel can show the findings that are
about what arrived and nothing else. Switch vortex's `HOLE` off and the panel says
`HOLE is read but nothing declares it` on line 299, in red, with the chip, in the
same second. Before the markers only the merged hook bodies were marked, and a
dangling name inside a carried registration was invisible to the panel while being
perfectly real in the file.

The import summary became one line, because the shape matters when something goes
missing: `carried: 1 hook (on_explode), 1 registration (wa.on.draw), 33
declarations, 1 require, 2 sheets`. Counts of what arrived, named, plus the art
that came with it.

### The test pack grew two weapons, and they paid for themselves

`WF 57 Carried Hurt` is a `wa.on.hurt` handler and the `label_for` helper local it
closes over: zapping a worm with any electric weapon from the pack logs
`WF 57 carried hurt saw N electric`. `WF 58 Carried Merge` is one claim key with
three owners (the burst, a carried `on_explode` body, the author's own snippet
body) and the terrain stamp last, in that order.

They found two bugs that no real bundle had:

- **A bundle whose only foreign code is a registration never carried it.** The
  closure carry was gated on the claim-hook list, so a weapon with a `wa.on.hurt`
  and no hook of its own imported as "1 not modelled (hurt)" and exported without
  it, silently. The gate now includes the registrations. Pulsar never caught this
  because it has a hook as well.
- **`customExplodeBody` stripped two kinds of line that were not necessarily
  ours.** First, any `if ev.worm then wa.sound.play(...) end`, which is our
  custom-WAV play but is also exactly how a bundle plays a stock sample: WF 58's
  carried body and the author's body both vanished, and what came back was a hook
  made of two comments. It now needs the claim to declare
  `sounds/<mod>/explosion.wav` *and* the line to be exactly the card's shape.
  Second, the burst's target guard (`local explode_role = sb.role …` and its
  `return`), which is generated from the burst card's Target select: on every
  `main`/`bit` burst weapon it came back as the bundle's body, so `WF 52` carried
  a hook that was two lines of our own code. Both are stripped only when the
  feature was recognised as ours. A body that turns out to be comments only is now
  not carried at all.

The one case the plan wanted in the pack that did not go in: a carried body reading
a name nothing declares. Shipping it would break the pack's "wfcheck finds nothing"
invariant, which is worth more than a weapon that is meant to fail. It lives in
`check_carried_lua` (text) and was verified in the app instead.

### The effects harness was measuring the wrong ring

`tools/lua/harness_effects.py` asserted that a quarter turn draws the ellipse
vertically by taking the first 23-point loop in the frame. With the second
(tracking) emitter alive, that loop was the first emitter's, so the assertion
failed while the SDK was correct. `ring_pass(near)` now selects the loop at the
emitter's own position: the test measures rotation rather than draw order.

### `extra_hand.size` was a pixel cell, and three weapons passed a percentage

The second hand kept coming back "huge". It was a units bug in the weapon tables,
not in the layer: `hold_draw_extra_hand` draws the sheet into
`(x.size or 60) * base * scale` game pixels, so `size = 90` is a 90 px hand next
to the first hand's 60 px cell, 1.5x even at `scale = 1` (the Conductor had 90,
railgun 100, jackhammer 120). The nudge is `(gx + pose.dx) * xsize` with
`xsize = base * scale`, exactly the first hand's rule, so using `size` as a
resize knob also walked the hand off the grip: the art grew around the quad
centre while the nudge stayed put.

`wfws.sdk` 0.16.2 makes an unset `size` follow the weapon's `hand_size`, so
`scale = 1` means "the same size as the first hand" on any cell, and the docs
now say the cell is a length in pixels and `scale` is the envelope knob. The
editor never had the bug: it writes `hand_size = 60` and `size = 60` and has no
field for either, so an import normalises a foreign 90 back to 60.

The uploaded support hand is a separate question, still open: PX's `hand_rad`
puts a 9x8 px fist inside its 60 px sheet, and the quad maps the whole uploaded
canvas into that cell, so a hand that fills a 100 px PNG draws at about 6.7x the
game's hand even at `size = 60, scale = 1`. Fitting an upload to that footprint
needs the scale floor well below 0.5, or a bake into the 60 px cell.

### A burst-only weapon shipped a claim it could not read

`wfcheck` was clean and the pack imported 58/58, yet nine test weapons failed at
load in game:

    weapon wftest.21_explosion_blast: install: runtime error: ...:15: attempt to
    index a nil value (global 'trail')

The claim names the shared effects sheets by module (`sprites = { trail.BEAM,
trail.GLOW, fx.SPARK, ... }`), and the generator only emitted
`local trail = require("wf-lib/effects/trail")` when the *ribbon* or the emitter
was on. Making the emitter ribbon independent of the projectile trail narrowed
that condition, so every burst-only weapon (21, 22, 37, 38, 41, 42, 44, 52, 58)
named a sheet through a module it had not required. The require now follows
`usesEffectsSdk`, the same condition that decides the claim, which is also how
`fx` and `blast` are gated.

Two guards came out of it:

- `check_generator_edges` builds a burst, a blast, a ribbon and an emitter and
  asserts that any file naming `trail.*`, `fx.*` or `blast.explode` declares
  that module. It matches the module's own members, not the bare prefix, so a
  `sprites/x/trail.png` pack path cannot make it demand a require.
- `trail` is gone from `luaCheck`'s editor-ambient list. It was there because
  the generator names the sheets by module, and that exemption is exactly what
  kept the generated-file view from saying `undefined-global: trail`. The list
  now only holds names a file can legitimately read without a local.

The pack was regenerated and reinstalled. Every weapon that names `trail.` now
has the local, and `wfcheck` on the pack is still clean, which is worth
remembering: this class of failure is a nil index at install, not a syntax
error, so only the game (or a harness that installs the weapon) sees it.

## L0 and L1: the reader learns the engine's own module rules

The wf-lib import plan opened with a number that turned out to be wrong, and
measuring it is what produced L0.

The first reading said `px_buffalo` could not load: it requires
`wf-lib/px_sprite_builder` and ships that library at `lib/px_sprite_builder.lua`,
while `lua-host/src/modules.rs` resolves a `wf-lib/` name only through a declared
dependency's `[exports]`. The second half is true. The first is not: the bundle
declares `dependencies = ["wf.sdk"]`, and `wf.sdk` (`Mods/wf-lib/sdk`, exports
`wf-lib/px_sprite_builder`, `wf-lib/holds`, `wf-lib/parkour`, `wf-lib/own_time`,
`wf-lib/tooltip`, `wf-lib/lightning`) provides it. The `lib/` copy is dead weight.
The plan now says so, and `tools/scan_mods.ts` prints the legacy shape
(`localLibraryRequires`) only when nothing in the selection exports the name,
with the note that a `wf-lib/` name resolves only *inside* the selection: scan
one bundle alone and every dependency looks missing.

L1 is the reader's module discovery, and the corpus is what shaped it:

- **`entry` is the module the engine runs, shared or not.** The old rule took an
  `entry` only when one weapon component used it, which lost
  `px.bunker_buster` and `px.super_bunker_buster`: two components over one module
  that tells them apart by `ctx.id`. The rule is now "the index, then the entry,
  then the guesses", and a shared *loader* entry simply has no record so the
  search continues.
- **A require resolves in the calling module's bundle.** `wf-lib/sdk/parkour.lua`
  requires plain `own_time`, which lives beside it in `wf-lib/sdk`, not in the
  weapon's bundle. Resolving every name against the weapon's bundle reported
  `own_time` missing; `resolverFor(bundleOf(path))` is what fixed it, and it is
  the engine's own rule (`make_require` passes the provider's folder).
- **A record handed to a library is normal**, not a miss: 16 weapons in `Mods/`
  build their claim in `lib/…` (`px_bunker`, `px_security_grenade`,
  `px_ninja_star`), so `resolvedVia: 'require'` names the library and
  `modulePath` is where the record was read.
- **The index is found by shape, not by filename.** A `["<id>"] = "<module>"` map
  is any `.lua` in the bundle, and the dotted key is the filter that keeps a
  `["hit"] = "sounds/hit.wav"` table from being read as one.

After it: 347 weapons over 52 bundle roots, routes `entry 243 / index 77 /
require 16 / lib 1 / weapons-id 1 / miss 9`, and **zero unresolved requires**.
The 9 misses are honest: four keep their claim in a module-level
`local weapon = { definition = … }` (L3 reads that), four name a `.wep` that is
not in the bundle, one (`holdable_uzi`) keeps a whole-bundle loader in
`code/mod.lua`.

Two smaller things came out of the same pass:

- `parseToml` treated `[[components.options]]` as a new `[[components]]` block, so
  a manifest's options became a phantom component with no id and the options were
  lost. They now attach to the component above them, along with
  `[[components.weapon_options]]` and `[components.suggests."<feature>"]`, and
  `[exports]` has its own map instead of landing in the scalars.
- `ctx.option` is an **error** for a key the component does not declare, and the
  option's value lives in the profile (`[options."<id>"]`), not the manifest. The
  L0 report splits reads into "declared nowhere" (a load failure) and "declared
  on another component" (`spawn_map_bees`/`bee_amount`, read in `lib/bee.lua`
  whose options belong to a feature), which is the distinction L4 has to keep.
- The mod browser now prints `record: weps/x.wep` for a claim that only names a
  `.wep`; the two bunker weapons used to be unreadable and now import with 47
  fields mapped, 35 declarations carried, and an export `wfcheck` is clean on.

Guard: `bun run tools/check_module_scan.ts`, 47 cases (every shape above, the
option blocks, `[exports]`, option reads, the miss message, and an ordinary
`["name"] = "value"` table not being an index), plus the installed corpus.

## M2 and M3, finished: a scope is a block, not a level

The closure carry shipped with two fixed levels, the module preamble and the
install body, because the bundles it was built against (vortex, pulsar, the
Conductor, the railgun) declare everything in one of them. The corpus disagreed:
`px.ports` is 89 weapons whose state lives inside `function weapon.setup()`, often
in a `do … end` block inside that, and whose hooks are registered from there, so
44 of the 89 carried names nothing declares. A carried hook reading a nil is a
callback that raises the moment a missile explodes, which is worse than not
carrying it at all.

Four things were wrong, and each was measurable:

- **The scope walk started from the wrong list.** It began at the install body's
  statements, so a registration inside `weapon.setup` matched no block and the
  chain came back with a single level. `splitModule` now starts from the install
  body when the offset is in it and from the file's own top-level statements
  otherwise, and `bodyRegion` recurses into `function`, `repeat`, `do`, `for`,
  `while` and a one-branch `if` (never a table: `return { on_explode = function …
  end }` would read the hook's body as a scope of the hook).
- **A block did not count its own statement list.** `local SWIM_CAP = 2.5` sits
  beside `local function swim_push` that reads it, and the chain for `swim_push`
  began one level *above* that list, so the constant was invisible. `LuaBlock`
  gained `scope` (the list it belongs to) and the resolve prepends it.
- **A registration seed had no free names at all.** `freeNames` runs the
  checker's `undefined-global` rule, and the checker reads a bare call as one
  expression, so `wa.on.worm_message(function(w) swim_push(w) end, { … })`
  reported nothing inside the callback. Every registration carried zero
  declarations and the weapons only resolved through their claim hooks.
  `bodyFreeNames` also scans the function literals in the seed: it splits on the
  `function` keyword, takes `scanBlockEnd` (which answers the offset the closer
  *starts* at, so the slice has to add `end`) and unions the names.
- **One require written twice looked like a collision.** PX opens both
  `weapon.definition` and `weapon.setup` with `local shared =
  require("lib/shared")`, and the clash rule (two `local`s of one name) refused
  the second, which then reported `shared` as undeclared. Identical text is one
  binding now and the first copy serves both; two genuinely different locals of
  one name are still one carried and one reported.

Measured after the four: `px.ports` 0 of 89 weapons with an unresolved name, and
across all 280 installed weapons with a record only four remain (`px.famas`,
`px.famas_offset` and `px.megashark_hold` read `lib/fire_seq.lua`;
`cursors.cursor` reads `lib/cursor.lua`). Those are the next milestone, not a
regression: a bundle-local library module is a second scope, not a name in the
weapon's own module, and `reqs/wflib_weapon_import_plan.md` treats it as L2.

Two smaller corrections came with it. `importFeatures` rebuilds a bundle's
`on_explode` from the author's lines and stamps `line: 0`, so the hook scope was
looked up by a line number that could never match; the module's own chain is used
when the module has that hook. And `MODULE_DEPENDENCIES` gained `wf.sdk`'s
`[exports]` (`wf-lib/own_time`, `wf-lib/shared`, `wf-lib/parkour`,
`wf-lib/tooltip`, `wf-lib/lightning`, `wf-lib/px_sprite_builder`), because a
carried PX weapon opens with `require("wf-lib/own_time")` and the export was
reporting it as unshipped while writing no `wf.sdk` dependency.

The one thing to remember while editing these files: a patch script that writes
`\b` into a regex through a shell heredoc can turn it into a raw **0x08 byte**, so
`/^\s*local\b/` lands as `local` followed by a backspace and matches nothing at
all. Eleven of them landed in `splitModule.ts` and one in `carryClosure.ts`, and
every one failed silently: `bodyRegion` never recognised a function, so the scope
walk stopped at one level. Printing `grep -c $'\x08'` over `src/` is the check,
and it costs a second.

## L2 was not what the plan said, and L4 is the options

The wf-lib plan sized L2 (library scope) at 43 of `px.ports`' 89 weapons reading
names their own module does not declare, and expected to carry declarations out
of `lib/` modules. Measuring them one at a time said otherwise, twice:

- **A hook written inside another hook.** PX's `fire_seq` burst passes `on_shot`
  and `on_done` as values in the options table of the call `on_fire` makes, so
  each closes over `on_fire`'s own locals (`famas`' `fired`/`last`, the
  megashark's `ammo`/`shots`). `splitModule` recorded them as claim hooks and the
  carry hoisted them to the claim table, out of the scope they were written in.
  They are `split.nestedHooks` now: skipped as seeds, named in the summary, and
  carried inside the parent's text, where their closure still exists.
- **The install header is a scope.** `lib/cursor.lua` is shaped
  `function M.install(ctx, spec)`; `spec` is a parameter the caller supplies, so
  it is not a statement in any block and the walk could not name it. The header
  is the outermost scope of everything inside `install` now, and an unresolved
  name that matches one of its parameters is reported with the function and its
  line: `` `spec` is a parameter of `M.install(ctx, spec)` on line 2: the caller
  supplies it, so the body is not carried ``.

After both, 279 of the 280 installed weapons carry their whole closure and the
last one is refused with that sentence. Nothing in the corpus reads a file-level
local from a `lib/` module, so the pass the plan described would have had nothing
to carry. What a library *is* for a project is a runtime dependency:
`lib/shared.lua` is five lines that return `{}` and the weapons attach to it from
other modules, so vendoring it would ship an empty table and carrying the
defining module is importing another weapon. The carried `require` stays and the
summary names it as unshipped (or maps it to `wf.sdk` when that exports the
name).

L4 landed as the options half of `ctx` configuration, which is the part a writer
can be faithful about:

- `WeaponProject.options` holds the **declarations** from
  `[[components.options]]`, in order, and no value: the profile owns the value.
- The generator writes the blocks back after the component (an undeclared
  `ctx.option` key is a load error, so losing one is worse than not editing it)
  and writes `[options."<id>"]` into the profile **only** for values that differ
  from the declared default, which is what the engine's own `set_option` stores.
- The Weapon Loadout card has a **Weapon Options** drawer: a checkbox, a number
  with the declared range, or a select over the choices, with the declared
  default, the kind and `ctx.option("key")` printed beside it, and a `data` chip
  for an option that is also a weapon data field (PX's `placement_range`).
- The manifest the editor writes reads back through `readBundles` as the same
  options, which is the cheap proof that the writer and the reader agree, and the
  buffalo's `direction` option round-trips through the browser, the export and
  `wfcheck`.

The lesson worth keeping: the plan's estimates were a guess about *why* names
were missing, and two measurements replaced it with two scope defects in the
weapon's own module. A milestone list should be re-measured before it is built,
not after.

## Pack export, P0 to P2: one emitter, and a ZIP that did not move

The pack plan's first line was the whole point of P0: a second emitter is how a
pack export drifts from a single one. So `exportModZip` was not edited, it was
**consumed**: `src/utils/packExporter.ts` now holds `weaponBundlePart(project)`
and `emitPackFiles(pack, libraries, fetchBytes)`, and `modExporter.ts` is a
wrapper where `exportModZip(project)` is `exportZip(singleWeaponPack(project))`.

Two things had to move for that to be honest:

- **The libraries became arguments.** `wfwsSdk.ts` and `effectsSdk.ts` use Vite's
  `?raw` and `import.meta.glob`, so anything importing the exporter was a browser
  module: Bun threw `import.meta.glob is not a function` before a single check ran.
  Passing `PackLibraries` in, and the `fetch` the effects sheets need, makes the
  emitter a pure function of its inputs. The app wrapper supplies the `spec/` text;
  the check reads the same two files off disk.
- **The `.wep` path needed a folder.** Art was already per weapon, because every
  path is `sprites/<sanitizeModFolder(id)>/…` and a pack's ids are namespaced, so
  four weapons wrote four folders without a line of change. `weps/` is bundle
  level, so two weapons built from a `.wep` both called `weapon.wep` were one file
  and the second export handed one weapon the other's record. `packSlug` names the
  folder for a pack of more than one and stays unset for a single weapon, which is
  what keeps the single ZIP byte-identical.

Parity was measured twice, because "the generator did not change" is not the same
as "the bytes did not change": a script diffed old and new generators over the 58
test weapons (0 manifest diffs, 0 profile diffs), and then two real PX weapons were
imported through the UI and exported before and after the extraction (`swim_suit`
9 entries, `javelin` 8, zero differences in paths or hashes).

`validateBundle` runs last and refuses a duplicated id, an `entry` with no file, or
a declared `[sprites."…"]` with no file, naming the offender: one bad component
takes the whole bundle down at load, so a pack must not be how an author finds out
which weapon did it. `checkLua` is deliberately not a gate yet: a single export
lets an author export with findings today, and turning that into a refusal as a
side effect of pack work would be a behaviour change nobody asked for.

`tools/check_pack_roundtrip.ts` (31 cases) closes the loop in memory: a pack of one
matches the single-weapon generators, a three-weapon pack writes three components,
the unioned dependencies and one profile, the emitted map reads back through
`readBundles`/`readWeapons` as the pack plus its library bundle with both weapons
and a record each, `importBundleWeapon` gives both weapons back, and a broken pack
is refused by name. The UI (P4, `weapons[]` in `App`) is the next block, and it is
the one that makes any of this visible to an author.

## P4: the bundle becomes visible, and two bugs the browser found

The pack work had one visible seam left: `App` held a `WeaponProject`, so all the
emitter could do was write a pack of one. P4 replaced the state, not the panels:
one `PackProject` and one `activeIndex`, with `project` derived and `updateProject`
writing back through `withWeapon`. Nothing below `App.tsx` changed, which is why
`LuaPreviewModal` only had to learn two optional props.

The rules that needed deciding, and how they were decided:

- **A bundle of one is that weapon.** `syncPackToSoleWeapon` copies the weapon's
  id, name, author and version onto the pack while it is alone. That is what keeps
  a single-weapon export byte-identical, and it is why the Bundle Settings card
  shows a sentence instead of fields at one weapon: anything typed there would be
  overwritten by the next edit of the weapon.
- **Ids are allocated once.** A weapon joining a pack keeps its id unless its art
  folder would collide, and the bump stays inside the folder segment
  (`rocket_2`), because `wfws.pack.rocket.2` would be folder `2` and two such
  weapons would write into one folder.
- **A duplicate moves its art.** Six places store a sprite path as text; five of
  them had to be rewritten or the copy would name the original's sheet and the two
  weapons would draw each other's art. `retargetWeaponArt` is that rewrite.

Two bugs the browser found that the checks had not:

1. **A duplicated `[weapons]` key.** Two pack weapons replacing the same stock slot
   (both on the Grenade) wrote `"stock.grenade" = true` twice. TOML does not allow
   a repeated key, and `wfcheck` reads Lua, not the profile, so nothing caught it.
   The profile now dedupes the paragraph `[weapons]`.
2. **A pack of one lost the profile description.** `generatePackProfile` described
   itself as `<bundle name> test profile.` while the old single-weapon generator
   used the weapon's own `description`. One line of diff in a ZIP that was supposed
   to be identical, which is exactly what the byte comparison against
   `old_exporter_swim.zip` is for: it went back to 0 differences.

Verified in Edge on real bundles: swim suit imported, a blank weapon added (rail,
Bundle Settings card, mobile switcher), the bundle id changed to `swim_pack` and the
export read as `swim_pack/mod.toml` with two components, per-weapon art folders and
one profile; then the rail's import button appended the PX Javelin, and that pack
exported as `swim_suit/` with `sprites/swim_suit/`, `sprites/javelin/`,
`weps/javelin/prod.wep`, two components, one profile, `wfcheck` clean, and the
editor's own reader gave two weapons back with their records. Removing the second
weapon put the bundle back to being one weapon, card and all.

## P5: a bundle reads back as a bundle, and the 97-weapon benchmark

Writing was the easy half. Reading a whole bundle back means answering three
questions at once, and each one bit:

1. **Which id does the imported weapon get?** Keeping the source's ids verbatim is
   right for our own bundles and wrong for everyone else's: `px.ports` ships 97
   components whose ids are `px.port`, `px.banana_express`, and exporting a second
   bundle that claims any of them is refused, because the installed one already
   has them. So a bundle whose weapons already live under its own id is kept (a
   pack the editor wrote re-imports as itself, and its art folders do not move) and
   any other bundle takes a **copy of its own id** as the namespace
   (`px.ports_import.port`).
2. **Which panel slot does it replace?** A component's `default_position` is
   exactly that, and the editor's manifest reader could not see it: `parseValue`
   had arrays and scalars but no inline tables, so
   `default_position = { row = "F2", column = 1 }` arrived as one string and every
   imported weapon fell back to its donor's slot. Adding inline tables to the TOML
   reader (with `splitTopLevel`, so a comma inside a string or a nested table is
   not a separator) and `stockSlotForPosition` as the inverse of
   `getStockPanelPosition` fixed the whole pack at once.
3. **When does the one-weapon rule apply?** `withWeapon` syncs a bundle of one to
   its only weapon, which is what keeps single exports identical. Applied per
   weapon during an import it renamed the bundle to the *first* weapon's id, and
   the pack lost the id its manifest declared. The import now collects the weapons
   and syncs once, at the end.

The benchmark is the reason this was worth doing: the installed `wf-lib/px` bundle
(the Highlander-split PX ports) holds 97 components, 89 with a readable record.
Read as a pack: 89 weapons as `px.ports_import.*` in about a second. Exported: `ports/`
with 89 components, 89 modules, **22** sheet declarations (the pack-wide dedupe
earning its keep), one profile with every weapon on its own stock slot,
`wfcheck` 0 errors and 0 warnings (11 informational `pairs()` notes, which are the
carried PX code's own loops and an advisory the compiler gives).

Two things the screenshots caught: the rail grew without a bound and pushed the
workspace navigation off a 1000 px window (it now scrolls inside the sidebar at
38 vh), and the export toast printed bare line numbers for a bundle of 89 weapons.
It now names the weapons: "carried code in Laser Gun (line 33); Kamikaze Rocket
(line 82); Nuke Rocket (line 193) and 4 more weapon(s) reads names nothing
declares".

## P3 and P6: the export refuses, and the fixture that proves the round trip

P3's other half is `checkLua` inside `validateBundle`, and the decision worth
recording is where the line went: **only `error` findings refuse.** An error is a
file that raises at load (`lockstep-rng`, `undeclared-require`, `module-wa`,
`lua-ast`, `lua-nul`, `lua-size`), and one of those takes every other component of
the bundle with it, so shipping one is never what the author meant. A warning or
an advisory is a judgement call the author already had before packs existed: it
was a toast and a `LuaFindings` row, and it stays one. Pinned in
`check_pack_roundtrip.ts`: a custom `on_explode` using `math.random` refuses the
export with the weapon's name, the line and the rule; an id outside `wfws.` is
refused; one sheet declared twice is refused.

P6 is `tools/check_pack_fixture.ts`, and its assertion is the strongest one there
is: **import, export, re-import, export writes the same bytes**, file by file,
digest against digest. In-memory cases only prove the rules for the shapes they
were told about; this one reads art and code off disk, and the difference showed
up in the first run.

The 58-shape test pack came back with 14 changed files and three real importer
defects, all the same mistake. The claim's `sprites` list is every sheet the claim
needs, and the export's sheet dedupe points identical bytes at **one** file, so a
path's *name* can belong to another weapon's role:

- WF 46's hold sheet is byte-identical to another weapon's default art and became
  `sprites/04_claim_track/body.png`. Read back by name, `body` is the strike art
  slot, so the re-export invented `sprite = <path>` and, because the generator
  skips `params` when the claim owns body art, **lost**
  `params = { gpu_prefix = "sprites/" }`, the line without which the aim layer's
  `wa.draw.quad` cannot resolve a pack path.
- WF 25's builder bit sheet, shared under the name `bit.png`, came back as stock
  cluster art: a `cluster = { sprite = … }` the weapon never had.

The fix is structural, not a name list: a path a **role already owns** is that
role's art. The owned set is built from the claim (the hold and flight sheets,
`customSprites`, the carried art) *and* from every sheet the `sb.hold`,
`sb.flight` and `wa.land.stamp` calls name, and only a path no role claims is
classified by file name. That alone took 14 diffs to 1.

The last one was `on_fire`, and it was emission, not import: `hookBodyOf` cuts
from the signature to the last `end`, so the `local fire = ev` line written
**before** the `not generated` marker came back as part of the body, and the
marker drifted below it on the next export. The alias now goes inside the region.
The same class of thing hit a hook that is written verbatim (`on_click`): a blind
`      ` prefix re-indented the body on every round trip, so it grew six spaces
each time; `reindentCode` normalises it instead. And a bundle **this editor wrote**
already carries the `not generated` markers, so a re-import keeps them and the
next export wraps them again: two extra comment lines per trip.
`stripNotGeneratedMarkers` drops them first, which is the same rule
`customExplodeBody` already followed for the author's snippet.

With those, the 58-shape pack and `px_pyroman_grenades` are byte identical, and so
are `wf-lib/utilities` (23 carried blocks, its own `on_click` and four
registrations) and `wf-lib/marked_for_death`. `wfcheck` runs on each written
bundle in the check: nothing for the test pack, **no errors** for the foreign
ones, since a bundle another author wrote may carry warnings of its own.

Two bundles are reported as **skipped by name** rather than silently passing:
`wf-lib/px_fire_seq` and `wf-lib/mole_shopper` build fallback art with a canvas,
and Bun has no `document`. `createSilentSheet` was the same problem until it
stopped needing one: a 1x1 transparent PNG is 70 constant bytes, and the
canvas was only ever a slower way to produce them. The first constant I wrote had
a bad IDAT CRC (decoded fine in the browser, would have failed a strict decoder),
so the fixture's bytes are CRC-checked now.

The fixture also states each bundle in one line, because a check that prints
nothing on success is a check nobody trusts: `test pack: 58 weapons, 80 files, 3
carried block(s), byte identical`.

## The bundle id is the namespace, and the import carries no promises

`wfws.` was a hardcoded mod id: `src/utils/weaponId.ts` fixed the prefix, both id
fields edited only the segment after the last dot, and the export validator
refused anything outside it. That made every author's work live in the editor's
namespace, which is not the engine's rule and not the author's choice. The engine
only wants **unique ids**, so the convention became the author's: the bundle id is
the namespace, and a weapon of a bundle lives under it (`lucia.arsenal.rocket`).
That is derived, not fixed, and it is still what keeps an id off an installed mod:
the installed bundle's own id is unique, so its namespace is taken.

- `weaponId.ts` now answers three questions and fixes nothing: `slugId`,
  `isUnderNamespace(id, bundleId)` and `copyNamespace(bundleId)`. `ID_MAX` is the
  engine's 64. The one constant left is `DEFAULT_ID_NAMESPACE` (`wfws`), a
  **default value** for work that has no bundle yet (a new project, a decoded
  `.wep`, a weapon a module leaves unnamed), never a rule.
- Both id fields edit the **whole** id. The weapon card keeps the bundle's
  namespace as a hint instead of a lock: an id outside it gets a note saying so,
  because the engine will load it and an installed mod might already own it.
- `validateBundle` refuses an id outside the bundle's id, naming both, instead of
  refusing anything outside `wfws.`. A bundle of one is still its weapon, so
  equality counts.
- Renaming the bundle id renames its weapons with it (`renamespaceWeapons`). Without
  that, the card would produce a pack the validator then refuses, for a reason the
  card cannot show. Only the prefix moves, so every art folder, which is the last
  segment, stays put; a weapon that was never under the old id is left alone.
- An imported bundle that does **not** already live under its own id takes a copy of
  it: `px.ports` becomes `px.ports_import`, and its `px.port` becomes
  `px.ports_import.port`. The source author's namespace survives and the export
  cannot claim the installed bundle's ids. A bundle that does live under its own id
  (every bundle this editor wrote) is kept verbatim, which is what makes a
  re-import idempotent.

The browser found one thing the design missed: `copyNamespace` first appended
`.import` to the whole id, so `px_pyroman_grenades` exported as a folder called
`import/` (the folder is the **last** segment) and every imported pack would have
landed in the same one. The marker goes on that segment instead
(`px_pyroman_grenades_import`), and the fixture's seven-weapon PX pack re-exports
as `pyroman_grenades_import/` with `wfcheck` clean.

The import disclaimer says what the capability really is. Carried code does not come
back guaranteed: it is written from the editor's own file, so indentation, where
helpers sit, and anything the reader could not resolve can differ or be left out.
The mod browser says so before you import, the Carried Lua panel says so again next
to the switches, and both point at the exported Lua as the thing to read before
shipping.

## The saw with no aura: `wa._mod` is a component, not a bundle

A player report, two weapons, one cause. The electric saws had lost their aura and
`Marked for Death` drew no thunder, and nothing in any check noticed, because both
are invisible and neither raises an error.

`effects.sdk` 0.4.2 gave the effect manager one draw callback per installing mod,
so a library required once no longer painted another mod's spark under a claim that
named no spark sheet. The key for that was `wa._mod`. But `wa._mod` is the
**component**: the engine sets it from `ctx.mod_id`, which is `d.component.id`, and
uses it for `[fog]`, the relative sprite paths and the binds. Sheets, though, are
claimed and resolved per **bundle** (`plan.sprites.get(&d.component.bundle)`, and
`resolve_key` falls back to `resolve_in_mates`, the bundle's other selected
components). So the filter was keyed one level too deep, and a bundle whose first
weapon calls `fx.install` and whose second makes an effect got one callback that
painted only the first weapon's effects.

That is exactly the shape of the PX ports. `px.saw` is one bundle with
`px.saw_grenade`, `px.saw_place` and the `px.saw_random` feature: the thrown saw
drew its ring, the placed and random ones drew nothing. `px.curse_of_death` is one
bundle with four weapons: `px.death_mark` installed the library and drew its
thunder, and `px.marked_for_death` created an emitter that no callback ever
painted. A debug harness could not see it, because a harness runs one mod.

Two fake-runtime harnesses proved each end first: the saw's ring and the curse's
thunder both draw correctly against the installed library when `wa._mod` is one
constant, and a ring created with an empty `wa._mod` is drawn by nobody. Then the
manifest settled it, one component per weapon, and one line of the game log
(`[px.death_mark] curse thunder: ready`) showed the library had installed fine.

0.4.3 keeps the installer list in install order and adopts: an effect made by a
component that never installed is assigned to the installer sharing the longest id
prefix with it (`px.saw_place` against `px.saw_grenade`), once, in install order so
every peer picks the same one, with a log line naming both. An id with nothing in
common is left alone and reported rather than lost in silence. Foreign painting is
still impossible: an effect is assigned to exactly one callback, never two.

The editor's own output never hit this, because a weapon is one component. But the
catalogue it reads is full of multi-weapon bundles, so the library cannot assume
one, and `tools/lua/harness_effects.py` now asserts the whole rule: the installer's
own effect painted by one callback, a sibling's adopted by that same callback and
painted once, a feature component's too, and an unrelated id painted by none.

## 2026-11-18, bits are timed, not read from m.sprite

`banana_cluster` shipped a cluster grenade whose **main** missile drew the
clustlet art and whose bits drew nothing recognisable: the builder still
classified by `m.sprite ~= 0`. That test was wrong for this record. WA's render
slot is not the pellet index: a round whose own `missile.sprite` is zero can
carry `clusters.bit.sprite` there, and the actual bit flag
(`MissileEntity+0x150`) is not exposed to Lua. The "flip" in the 2026-11-11 note
(`m.sprite == 0` is a bit) is the same guess read the other way and is equally
unreliable.

`classify` now uses the one signal that follows how WA builds a burst:

- the first missile of the weapon is the round;
- a missile first seen within `bit_window` frames (default 5) of the round's
  last sighting **and** within `bit_radius` (default 64 px) of the round's last
  position is a bit;
- a missile fired while another round is still in the air, or away from the
  dead round, is another round (a fire sequence), not a bit.

The bits are constructed by `CreateClusters` at the round's own position in its
detonation, so both conditions hold for every frag and for no muzzle shot. The
first missile needs no `m.sprite` exception, including a roaming animal WA
walks itself. `is_bit` still overrides, and a future `m.bit` is preferred when
a build exposes it. `tools/lua/harness_flight.py` now pins the banana case (a
round carrying `clustlet` is a round, its follow-up missiles are bits), the
fire-sequence case (a second live round is not a frag), and the position rule.

The generator still forces a stock `clusters.bit.sprite` (`clustlet`) and
`sprite_count = 1` when the builder owns the bits: a bit needs a real sprite id
for WA to construct it, even though the builder replaces the draw.

---

## 2026-11-18, installed corpus round trip: six import/export defects

`tools/audit_bundles.ts` is the wider net behind `check_pack_fixture`: every
installed bundle is read, exported, read back and exported again, compared by
digest. It started at three export failures and five unstable bundles; it now
reports 36 bundles and 169 weapons with 33 byte-identical, one stable once its
donor is named (the `copy_from`-at-load case), two that need a library, and
nothing failed. The findings:

- **The SDK module table named a module the library does not export.**
  `SDK_MODULE_EXPORTS` (as it then was, in `luaGenerator`) listed
  `wf-lib/electric/hold` and omitted `wf-lib/electric/taze_mine`; the installed
  `px.electric` exports `damage` and `taze_mine`, and three bundles require
  `taze_mine`. `validateBundle` refused the **Conductor** and the **Pulsar** for
  code that loads in game. The carry had a second copy of the same facts. Both
  now read `src/data/sdkModules.ts`, measured against the installed manifests and
  every `require("wf-lib/…")` in the corpus (`wf-lib/sdk` was listed too, and no
  library exports it).
- **`importBundlePack` retargeted art the wrong way.** On an id change it moved
  art from the *wanted* id's folder to the current one, but the art had been
  built from the single-weapon import's id. `wfws.vortex` (component id = bundle
  id) exported declarations for `sounds/vortex_grenade/` while writing
  `sounds/vortex/`, and the export was refused by name. It now moves from the
  project's own folder to the adopted id's folder.
- **Hooks and registrations were transformed on their own, and their art paths
  were thrown away.** `carriedPaths` collected only the carried blocks, so the
  Conductor's `FIRE_WEAPON` registration played `sounds/conductor/shot.wav` after
  its path had been moved, while the claim's `sounds` list stayed empty and the
  file was written undeclared. The paths from each hook/registration transform
  now join `carriedPaths`.
- **An empty `roam = { }` made a re-export differ from its source.** `flight_1`/
  `flight_2` live in `sheep`, so a record whose only roam difference was those
  set `roamTouched` with no row to write; the header and closer were still
  emitted. A group with no rows is dropped, for the round and for its bits.
- **An empty slot exported `"stock." = true` and placed the weapon on `F1`.** The
  manifest resolved `''` to the Bazooka's position while the profile named
  nothing, so one weapon of `example.tools` moved to the Bazooka on re-import.
  `effectiveSlot(project)` (slot, else donor, else grenade) is now shared by the
  manifest and the profile.
- **A whole-bundle import discarded the reason its export would refuse.**
  `ModBrowserModal` toasted a weapon count only, and `importBundlePack` reduced
  per-weapon notes to `N note(s)`. `BundleImport.blocking` and
  `PackImport.warnings` now carry the load-blocking sentences (an unshipped
  carried `require`, a blocking Lua finding, an undeclared `ctx.option`) to a
  dismissible alert above the page header; the single-weapon import puts them in
  its toast.

`check_pack_fixture` now names the four library-dependent bundles as skips and
lists the module they need; refusing them is the correct answer for a standalone
export, and the new warning is what tells the author which bundle to add.

## 2026-11-19, the buffalo's names, the javelin's arm and a sound per strike

Four reports, one cause between them: a value that the panel *showed* and the
export *wrote* were not the same number, or a name the module wrote was never
resolved. All four came out of reading real bundles rather than in-memory shapes.

- **The buffalo's sheet, icon and sounds were dropped.** `px_buffalo` writes
  `local SHEET = "sprites/buffalo/buffalo.png"`, `local ICON = "…/icon.png"`,
  `local SND = "sounds/buffalo/"` and then `hold = { sheet = SHEET }`,
  `panel_icon = ICON`, `sprites = { SHEET }`, `sounds = { SND .. "start.wav", … }`.
  The table reader keeps literals only, so every one of those fields came back
  empty: the import had no hold sheet, no icon and no sounds, and the flight art
  was whatever the fallback happened to be. `luaStrings.ts` now collects
  `local NAME = "…"` chains to a fixed point, follows `..` concatenation and fills
  only the missing fields of the table the reader kept (and only when that table
  is the file's `wa.weapons.replace` call, its `record` assignment or its
  `return`, so one weapon's paths cannot land on another's art). The buffalo now
  arrives with its sheet, its icon, its four WAVs, `weap_radial_rotation = 0.22`
  and `hand_radial_rotation = -0.13`.
- **Its sounds were still lost after that**, one layer down: the *carried* code
  plays them (`SND .. "start.wav"` inside `on_fire`), and the path rewrite moved
  the folder prefix in the text without attaching or declaring a single file.
  `rewriteBundlePaths` now records a prefix move with its trailing slash and
  `importWeapon` expands it into that folder's PNG/GIF/WAV files. Before, the
  export named `sounds/buffalo_of_lies/start.wav` in the claim and wrote nothing.
- **The javelin's radius read as +11.8 when it is -11.8.** The generator and the
  preview both hard-coded `weap_radial_rotation = 1` / `hand_radial_rotation = 1`,
  but `worm_hold.rs` places the weapon at `rot + PI*weap_radial_rotation` and the
  hand at `rot - PI*hand_radial_rotation`, and PX ships 0, 0.22, -0.13. With the
  radial term fixed at a half turn, a negative radius drew the art where a
  positive one would, so the panel's -11.8 and the preview only agreed at +10.
  Both are authored fields now (a dial each, `hold.weapRadialRotation` /
  `handRadialRotation`), read on import when they differ from the fallback.
- **A combo can sound like a combo.** `MeleeConfig.hitSound` played the same
  sample for every strike, so a light jab was heard as the heavy finisher.
  `MeleeHit.sound` (`sound` / `wav` / `priority` on the row) is played by the SDK
  as `hit.audio or m.hit_audio`, the weapon's sample remains the fallback for the
  rows that name none, and each strike's WAV is a file of its own
  (`melee_hit<n>.wav` for strike n). `meleeStrikes()` carries the field through, which is the
  half that mattered: the panel, the generator and the preview all read the table
  from it, so a normaliser that rebuilt the rows without `sound` silently made
  every strike of a combo play the weapon's one sound.

Two more from the same pass, both `reqs/wflib_weapon_import_plan.md`:

- **L3, the record is data.** `local weapon = { definition = { … } }` already
  reached the claim candidates, but the *text* of that table was never found, so
  the names inside it did not resolve. `claimTextOf(..., 'definition', 'field')`
  finds the literal's braces on the masked copy (`matchingBrace`), and a
  `definition = function()` is still code, not data. `check_module_scan.ts` 3b
  pins the record, its `copy_from` and its resolved `hold.sheet`.
- **L5, art.** A folder of per-frame PNGs (`sprites/i_bomb/body/00.png`) is what
  the engine reads natively (`load_png_sequence`, file-name order), so the import
  joins it into one strip in a canvas and uses the count as the role's `frames`
  when the bundle declared none; a headless run says so instead of importing the
  fallback sheet. `fps` comes from the bundle's `[sprites."…"]` declaration, and a
  hold sheet's declared `fps` becomes `anim_speed = fps / (1.5 * frames)` when the
  claim names none.

**The bundle icon is `mod_icon`, and it is one per bundle.** It is uploaded in the
Bundle Settings card (now mounted for a pack of one as well, since that card is
where the bundle's own icon lives), written once at
`sprites/<bundle>/icon.png`, named by the manifest, and read back on import into
the pack along with `replaces`. Two rules keep it honest: a bundle with no
uploaded icon falls back to its first weapon's panel icon, and a bundle with
neither writes no `mod_icon` at all (the mod loader draws initials). And a
`mod_icon` that names a **weapon's** own icon is not adopted as bundle art, which
is a bug this work created and then removed: adopting it copied the file into the
bundle folder and rewrote the line, so `wf-lib/utilities` stopped round-tripping
byte for byte.

## 2026-11-20: a hold's cells are not its frames, and one identity per mod

Two reports, one of them a real defect hiding behind what looked like a quirk.

**"The SPB reads the buffalo as if it had 1 frame".** The Buffalo of Lies says
`hold = { sheet = "sprites/buffalo/buffalo.png", frames = 1 }` over a picture
`mod.toml` declares as `frames = 20`, and that is not a mistake: `worm_hold.rs`
computes `frame = (phase * hold.frames) as u32` and `gpu.rs`'s `enqueue_hold`
clamps it against the **sheet's** own count from `sprite::gpu_frame`, so the held
bull is cell 0 of a 20-cell run cycle and the charging animals walk the strip
themselves through `wa.actors` and `a:frame(frame)`. Read the two numbers as
"cells in the picture" and "cells the hold plays". The editor had one number, so
three things were wrong:

- the export declared `hold.png` only when `hold.frames > 1`, which for the
  buffalo meant no declaration at all, so the engine sliced the 20-cell strip as
  one cell and the whole run cycle was squeezed into the held art. This is the
  defect: an imported bundle exported a different weapon from the one it read;
- the aiming preview sliced the picture by `hold.frames` for the same reason, so
  the bull in hand looked like a column of tiny buffaloes;
- nothing in the panel said the picture and the play count disagreed.

`HoldConfig.sheetFrames` is the picture's cell count, set by the import from the
bundle's `[sprites]` declaration when it differs from `hold.frames` (and never by
the editor, whose uploads hold exactly the frames they play). It feeds three
places: the manifest declaration (`frames = max(sheetFrames ?? frames)`), the
preview's slice (`cellHeight = height / cells`, index from `hold.frames`), and
the `SheetFrameWarning` divisibility test, which is about the declared cells. The
Hold card prints one line when the two disagree. The exported buffalo now
declares `frames = 20` for `hold.png` with `frames` absent from the claim table,
which is what PX ships, and `wfcheck` stays clean.

**"Why can't I change the name, id, version and author of a mod?"** Because the
four boxes in Bundle Settings were disabled while the bundle held one weapon, and
the value `syncPackToSoleWeapon` re-derived from that weapon won anyway, so even
an enabled box would have been overwritten. Making them write through to the
weapon worked and was the wrong answer: it was the same four values twice on one
page. A bundle of one **is** that weapon, so the four fields are now hidden and
the card says in one line that they are the ones on the Weapon Loadout card
above, with the weapon's name and id spelled out. From the second weapon on the
card shows them and they are the manifest's, which is what the 60-weapon test
pack and the Code tab's `mod.toml` confirm. `profileName`, `replaces` and the
profile description stay, since they exist nowhere else.

## 2026-11-21: a melee weapon fires, and the shot is a ghost

The melee claim swallowed the trigger. `eat_fire` is not a cosmetic flag:
`fire_weapon_click_only_eat` sees it and returns 1 before WA builds anything, so
the worm was only marked active (no projectile, no ammo taken, no launch step, no
retreat), and the clip then zeroed the turn clock with `finish = "end_turn"`. The
turn therefore ended at the end of the animation whether or not the record wanted
it, and the weapon cost no ammo for a shot it never took. The user called it out
exactly: "the melee arbitrarily ends turn whether or not it should".

WA ends a turn when a projectile is built (`after_use` + the retreat window,
0x55D490), so the fix is to build one and make it a **ghost**:

    missile = {
      sprite = 0, trail = { sprite = 0 }, action = "none", burst = "nothing",
      explosion = { power = 0, push_pct = 0 },
      explosion_sound = { enabled = false }, launch_sound = 0, flight_sound = 0,
      impact_particles = false, alarm_worms = false,
    },
    handling = { retreat = 5000 },

Nothing leaves the worm that a player can see, hear or feel, and WA takes the
ammo, plays its own launch step and ends the turn by its own rules. `retreat =
5000` is the control the player keeps after the shot, long enough for the swing
and short enough not to sit on an invisible projectile; an author's own
`handling.retreat` (Turn Handling) wins, and `finish = "end_turn"` is no longer
written for a melee clip (the Hold page says so next to the select).

`collects_crates = false` rides with it, because a ghost crossing a crate
would otherwise collect it for the team. `meleeGhost` in `luaGenerator.ts` is the
single test, and it also puts `'melee'`
into the missile-family emission: a melee project borrows a power record for its
aim phase (the Sheep Launcher's), so its `missile` table is a real one. The art
needed nothing: the swing already mutes the engine's held art to `silent.png`
while it draws the clip (`hold_mute`, set from the draw pass), so a ghost shot
running WA's firing state cannot draw a second copy of the weapon.

**Two things were still wrong, and the first report said so** ("its wrong, still
ends turn"):

1. `handling` was never written. The donor's own retreat (3000) arrives in
   `recordOverrides` and the diff drops it as inherited, so testing the *key* for
   `undefined` skipped the 5000. The test is on the emitted `override()` value.
2. **The ghost never fired.** `worm:take` eats a taken worm's fire messages
   (`physics::fire_allowed` answers only what the holder allowed), and the swing
   took the worm with `turn = "freeze"` and no `fire`, so the Space press was
   swallowed before WA ever built the shot, took the ammo or ran the retreat.
   `wfws.sdk` 0.16.5 passes `fire = true`: WA's own dispatch then decides, and a
   clip-only claim still eats the shot there (`eat_fire`), so nothing changed for
   one that never wanted a shot.

With the shot really fired, its **lifetime is the retreat**: WA hands the turn over
when the shot it fired is gone or the retreat runs out, whichever comes first, so a
ghost that detonated on contact at the worm's feet still ended the turn a frame
after the swing. The record now writes `fuse = 5000` beside `retreat = 5000` (a
nonzero `fuse` is WA's "timed, not impact detonated" switch), and the author's own
`handling.retreat` moves both numbers together. It pops harmlessly, invisibly, at
the moment the turn ends anyway.

`check_mod_import.ts` pins the three halves (no `eat_fire`, the ghost rows, no
`finish`), the WF 50 entry in `test_pack/README.md` states what a player should
see, and `wfcheck` stays clean on all 61 files.

## 2026-11-20: a thrown builder weapon aims with full hands (`hold_as`)

In game, WF 33 Builder Bit Homing (a Cluster Bomb) aimed with empty hands. The
builder writes `missile.sprite = 0` so WA never draws the stock round, and WA
picks a thrown weapon's held pose from that same sprite (`Weapon__hold_sheet`,
0x51C060): only the stock grenade, banana, cluster, petrol bomb and holy grenade
sprites give one. Keeping the sprite and hiding the round with `m.sprite = 0` in
`missile_frame` was ruled out by the engine side: WA draws a launched missile once
before its first `missile_frame`, so the stock round would show for a frame at the
throw.

wkLua 1.0.0 adds `hold_as = "stock.<weapon>"` on `replace`, which aims a weapon in
that stock weapon's pose (PX's ports moved to it in px.ports 0.20.85). The
generator now writes it whenever the builder zeroes the sprite, the weapon has no
hold art of its own and no melee swing, and the record's own sprite (the author's
unless it is the builder's zero, else the donor's, resolved by name or id) is one
of the five. In the test pack that is WF 05, 24, 33 (`stock.cluster_bomb`) and
WF 30 (`stock.grenade`); a Bazooka, Homing Pigeon, Super Sheep or Ming Vase donor
gets none, because none of those sprites gives a pose. The importer reads
`hold_as` into `project.holdAs`, which the generator writes back as it came.
