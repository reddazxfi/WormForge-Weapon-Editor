# WormForge Weapon Studio — Engineering Notes (API 4.0)

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

## 2026-11-09 — sprite-builder animations and separate collision masks

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

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx vite build` — succeeds.
- Generated Lua for a custom fast-spin missile checked with `wfcheck --stdin`
  — no findings.

### Follow-up: builder-off must not touch the stock missile

`missileSprite.hideStock` defaults to `true`, and the old generator applied it
even when `missileSprite.enabled` was false. Every weapon therefore emitted
`missile.sprite = 0`, hiding WA's missile sprite with no follower to replace it.
The record now only reads `hideStock` / `stockSprite` when the builder is
enabled. A builder-off project inherits the donor's sprite untouched.

## 2026-11-09 — .wep import no longer rewrites the weapon

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

## 2026-11-09 — clustlet actions and the remaining .wep body values

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
  the `missile` and `clusters` blocks through the existing missile path — the
  engine shifts the names itself — and the `strike` header is emitted in the
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
- `spec/default_grenade.png` (46x46) and `spec/default_blue_zook.png` (32x32)
  are copied to `public/assets/defaults/` and used whenever no hold/flight
  sheet has been uploaded. `src/utils/defaultArt.ts` picks the grenade or the
  bazooka from the donor/slot (`fireType === "hitscan"` counts as barrel), loads
  the same file for the builder preview, and writes it as `hold.png` /
  `missile.png` (stacked for `frames`) on export. The procedural canvas art
  remains only as a fallback if the image cannot load.
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
  appear in the record's `bit.sprite` — `record_table` would read it as a sprite
  name.
- Trail emission: `missile.trail.sprite` and `clusters.bit.trail.sprite` take
  the path directly (`trail_image_spec` in `lua-host/src/api.rs` copies the
  trail table, sets `sprite = 0`, loads the sheet as an extra sheet, and the
  engine patches the native id at install). Both were already diff-based; the
  pack path is the only reason the clusters block is entered on an otherwise
  untouched `.wep` import.
- Mod export: `modExporter` writes each uploaded file and `generateModToml`
  declares `[sprites."<path>"]` with `frames` (PNG only — the engine rejects
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
consecutive sprite **ids**, not frames — bit i draws
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

