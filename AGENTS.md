# AGENTS.md — WormForge Weapon Studio

This file is the hand-off memory for anyone (human or agent) maintaining this
repository. It records what the app does, how it is wired, the engine rules the
UI has to obey, the validation recipes, and the mistakes already paid for.

**Canonical location:** `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor`
(this repository). The older copy at
`...\Worm-Forge-Lua-Editor\WormForgeWeaponEditor` is a duplicate and must not be
edited.

---

## 1. What this is

A React 19 + TypeScript + Tailwind v4 editor for **WormForge** (Worms
Armageddon modding engine) weapons. It can:

- import a Project X `.wep` binary and decode the native 0x1D0 record;
- edit identity, donor/slot, defaults, flight physics, missile actions, burst
  payloads, collision masks, Lua callbacks, gun/mine/strike fields;
- build the worm **hold art** preview and the 50 Hz **flight sprite** preview;
- export a complete WormForge bundle (`mod.toml`, weapon Lua, profile, sprites,
  optional `.wep`);
- run as a web app (GitHub Pages), a local Express + Vite app, or a Tauri v2
  desktop app.

The companion **code editor** app lives in `...\Worm-Forge-Lua-Editor` and is a
different project. Do not modify it from this repository.

---

## 2. Repository layout

```text
.
├─ src/
│  ├─ App.tsx                  # state, theme, hotkeys, page shell
│  ├─ components/
│  │  ├─ Sidebar.tsx           # desktop sidebar + mobile bar
│  │  ├─ WeaponSettings.tsx    # identity / donor / slot / icon / defaults
│  │  ├─ RecordEditor.tsx      # the record sections
│  │  ├─ HoldPreview.tsx       # hold + flight art builders (canvas)
│  │  ├─ FlightRoleEditor.tsx  # WFWS bit / behaviour-state role cards
│  │  ├─ PackSpriteUpload.tsx  # upload for trail / cluster-bit pack art
│  │  ├─ EffectsCards.tsx      # ribbon trail + explosion burst cards
│  │  ├─ ExplosionPreview.tsx  # 50 Hz px_effects burst preview (canvas)
│  │  ├─ BundleDependencies.tsx # extra mod.toml dependencies panel
│  │  ├─ WepImportModal.tsx    # .wep drop zone and decode summary
│  │  ├─ LuaPreviewModal.tsx   # generated Lua / mod.toml / profile
│  │  └─ ProjectileSimulation.tsx # RETIRED, unused; do not re-enable
│  ├─ data/
│  │  ├─ recordTabs.tsx        # section ids/labels/icons shared by nav
│  │  ├─ recordSchema.ts       # field tables used by the editor
│  │  ├─ explosionPresets.ts   # PX electric / pyro / ember burst presets
│  │  ├─ spriteBuilder.ts      # WFWS role defaults, state ids, availability
│  │  └─ stockWeapons.ts       # stock donors, slots, panel positions
│  ├─ types/weapon.ts          # WeaponProject and all record types
│  ├─ utils/
│  │  ├─ wepParser.ts          # .wep -> WeaponProject (+ wepBaseline)
│  │  ├─ luaGenerator.ts       # WeaponProject -> Lua + mod.toml + profile
│  │  ├─ modExporter.ts        # JSZip bundle writer
│  │  ├─ defaultArt.ts         # default hold/flight art selection
│  │  ├─ placeholderSprites.ts # procedural fallback art (only if a fetch fails)
│  │  └─ assetUrl.ts           # BASE_URL-safe public asset paths
│  └─ index.css                # Tailwind v4 theme tokens, focus, scrollbars
├─ public/assets/              # logo, mark, worm sheets, default sprites
├─ spec/                       # source art: banner, backdrop, default_*.png
│  └─ lua_sdk/                 # SDK sources: effects_sdk, wfws_sdk (WFWS builder)
├─ src-tauri/                  # Tauri v2 desktop project
├─ example_mods_*/, wep_Formatting/  # reference bundles and .wep samples
├─ lua-weapons.md, weapon-records.md # engine docs snapshots
├─ wf_weapon_editor_notes.md   # detailed engineering log (read for history)
└─ .github/workflows/deploy.yml # GitHub Pages deployment
```

---

## 3. Commands

```powershell
bun install            # dependencies (bun.lock is committed)
bun run dev            # Express + Vite, http://localhost:3000
bun run lint           # tsc --noEmit
bun run build          # vite build -> dist/
bun run preview        # preview dist
bun run tauri:dev      # desktop dev
bun run tauri:build    # desktop installer
```

Visible Windows launchers: `start-weapon-editor.bat` (full server) and
`start-weapon-editor-vite-only.bat` (UI on 5175). Background shells are not
visible to the user; use the `.bat` files when they need to open the app.

Vite config uses **`base: './'`** so the same build works on GitHub Pages, the
Tauri webview and `file://`-style roots. Resolve every `public/` path through
`assetUrl()`; never hardcode `/assets/...` in JSX.

Environment used during development: Windows 11, PowerShell 7, Bun 1.4.x,
Node 26.x, Vite 8.3.x, React 19.3.x, Tailwind 4.3.x, TypeScript 7.0.x.

---

## 4. Application architecture

`App.tsx` owns the single `WeaponProject` and all navigation state:

- `activeTab: 'editor' | 'hold' | 'effects' | 'code'` (hotkeys `1` / `2` / `3` /
  `4`, ignored while typing in an input/textarea/select);
- `activeSubTab: RecordTabId` (the record sections, shared with the sidebar and
  mobile `<select>`); `recordTabs.tsx` nests a section under another with
  `parent`. Collision Bitmask sits under Missile Action, and Burst Payload owns
  Bit Behaviour, Bit Collision and one entry per bit action (Bit Bounce/Homing/
  Roam/Dig). The parent row still selects its own tab and a chevron opens/closes
  the children (sidebar `openGroups`, open by default); the mobile picker
  prefixes children with `—`.
- The burst sub-tabs are **navigation helpers over one page**, not separate
  views: every payload section is rendered together (selector, ejection, bit
  behaviour, bit collision, the selected action group, fire payload), and
  clicking a child scrolls to its `id` (`RecordEditor`'s `activeSubTab` effect).
  `visibleRecordTabs(burst, bitAction)` in `recordTabs.tsx` hides the bit
  sections unless the payload is clusters and an action entry unless that action
  is selected; `bitActionOf()` is the single bit-action expression. Other tabs
  (Flight, Action, …) stay exclusive — do not mix the two models.
- The **Effects & Libraries** workspace (`EffectsWorkspace.tsx`) is where every
  claim hook and library bundle lives, not a record section: the ribbon trail,
  the explosion burst with its `ExplosionPreview` canvas, the custom WAVs and
  the sequential-fire card. It shows an empty state for families with no
  claim-owned round or blast (guns, arrows, sprays, specials, air strikes) and a
  "More libraries" note for anything not modelled yet. A new library gets a card
  here instead of a record tab.
- `isDark` with `localStorage['wf_theme_v2']`; **light is the default** unless a
  stored value says dark. `index.html` applies the stored class before paint.
- modals: `.wep` import and the inline bundle-code view.

`Sidebar.tsx` is the desktop navigation (logo, live project card with copyable
ID, workspace buttons, record sections, import/export, theme toggle).
`MobileBar` replaces it below `lg`. `recordTabs.tsx` is the single source of
section ids, labels, hints and icons.

`RecordEditor.tsx` is controlled: it receives `activeSubTab` and renders only
that section. Do not reintroduce its old internal tab bar.

The old top `Header.tsx` and `GeminiAntigravityModal.tsx` were deleted. There is
no Gemini/Antigravity route or `@google/genai` dependency; do not add them back.

---

## 5. Domain model: WormForge bundles

A bundle is a folder under `WormForge/Mods/`:

```text
<mod_folder>/
  mod.toml
  weapons/<mod_folder>.lua
  profiles/<Weapon Name>.toml
  weps/<file>.wep          # only when the imported .wep is used
  sprites/<mod_folder>/
    icon.png               # only when a custom icon was uploaded
    hold.png               # whenever hold art is enabled
    missile.png            # whenever custom flight art is enabled
```

`mod.toml` essentials:

```toml
id = "author.weapon"
name = "Weapon Name"
version = "0.1.0"
author = "..."
api_version = 4
format_version = 2
dependencies = ["wf.sdk", "wfws.sdk"]   # holds + flight builder, as needed

[[components]]
id = "author.weapon"
type = "weapon"
name = "Weapon Name"
description = "..."
entry = "weapons/<mod_folder>.lua"
icon = "stock_icon_or_sprites/<mod>/icon.png"
default_position = { row = "F2", column = 1 }
```

The weapon Lua is `wa.weapons.replace{ ... }` inside `install = function(ctx)`.
`copy_from = "stock.<slot>"` and `wep = "weps/<file>.wep"` are **mutually
exclusive**: a `.wep` supplies the whole native record and the Lua tables are
only edits.

The `api_version = 4` / `format_version = 2` numbers are required by the engine
even though the UI must not display the phrase "API 4.0".

---

## 6. `.wep` importer (`wepParser.ts`)

- Magic: `[0x06, 0xDD, 0xBB, 0x5A]`.
- Display name: Latin-1 at `0x1E4`.
- Record slab: `0x1D0` bytes starting at byte 4.
- **Air strikes:** `record.rs` applies `STRIKE_SHIFT = 0x14` to every `body`
  field. Decode/emit `missile.*`, `clusters.*` and `clusters.bit.*` through
  `shiftOffsets(rawOffsets, -0x14)`; `strike.*` stays at its own offsets
  (`strike.plane` at `0x38`). `missile.burst`/`project.burst` follow the shift.
- The importer infers a donor and summary from the record, then builds a
  `WeaponProject`. The decoded snapshot is kept as **`wepBaseline`** (body,
  clustlet, action, burst, overrides, fire config). The generator diffs against
  it, so an untouched import emits no override tables and an edited import emits
  only the changed values.
- Numeric writers use `??` (not `||`) so a decoded `0` is preserved.
- Import UI defaults to **"Use .wep weapon file" checked**; in that mode the
  export writes `wep = "weps/<file>.wep"` plus the original file, and record
  edits still appear as overrides.
- `.wep` filenames lie (`teleport.wep` can decode as "Super Tele"). Trust the
  decoded fields, not the name.

Reference implementation: `WormForgeNew/crates/weapons/src/record.rs`,
`tools/record_fields.py`, `tools/embed_weps.py`.

---

## 7. Generator rules (`luaGenerator.ts`)

- Emission is **diff-based**: with `useWepFile`, compare against
  `wepBaseline`; without it, only emit values that differ from the stock donor.
- `missile.ends_on_contact` and `missile.bounce.hits` are independent masks.
  `bounce.hits` is emitted only when `action = "bounce"`.
- Collision masks: `worms` (0x3C) may **not** be combined with
  `worms_normal/acting/jumping/roping`. The UI expands/clears the shortcut
  safely; the generator expands `worms` to individual flags when individual
  flags are present. Combining them caused the in-game "overlapping worm
  selections" crash.
- Actions (`none`, `bounce`, `homing`, `roam`, `dig`) and burst modes
  (`nothing`, `clusters`, `fire`) are exclusive.
- **The action groups share one native slab (+0xA8..+0xD0), so switching the
  action has to write the destination group in full** (`fullGroup`, and
  `clustletChanged` for the bits). A stock Grenade's `bounce.sound` is 113 at
  +0xB4, which is `homing.trail.sprite`: converting the grenade to homing left
  113 there, and WA drew `oildrum4` frames as the homing trail (with the oil
  drum's own particle physics). The overlaps are
  `0xA8` bounce/roam hits + impact-particles bit, `0xAC` bounce.bounciness /
  homing.sprite / roam.flight_hits, `0xB0` bounce.terrain_keep_speed /
  homing.animation / roam.walk_speed / dig.sound, `0xB4` bounce.sound /
  homing.trail.sprite / roam.step_height / dig.dive_sprite, `0xB8` bounce.
  contact_sides / homing.trail.power / roam.edge_jump.angle / dig.sprite_1, and
  so on through `0xD0`. Writing the group from the editor's own values (the
  same numbers the panels show, zeros for "off") makes the slab deterministic;
  a diff-based write of only the changed keys is what let the donor's numbers
  leak through. An untouched `.wep` import still emits nothing (`fullGroup` is
  `!baseline || action !== baseline.action`).
- Stock action values can be read from PX's default scheme:
  `python tools/px_scheme_weps.py "<WA+PX>/PXSchemes/default.pxs" OUT --all`
  (in `WormForgeNew`) writes one `.wep` per slot; e.g. Homing Missile has
  `homing.trail.sprite = 131, power 50, speed 100, bubbles 50, animation 2`,
  and the Grenade's 0xB4 is 113.
- Clustlets carry `clusters.bit.action` (`impact`/`bounce`/`homing`/`roam`/
  `dig`). The groups share native slots, so decode/emit only the active group.
- `dependencies = ["wf.sdk"]` is added for hold art (it exports
  `wf-lib/holds`), and `wfws.sdk` for the flight builder; `effects.sdk` is added
  for the ribbon trail (it exports `wf-lib/effects/trail` and its beam/glow
  sheets).
- **WFWS flight builder (`project.missileSprite`, `bitFlight`, `behaviorArt`).**
  The editor ships its own builder bundle, `spec/lua_sdk/wfws_sdk/` (id
  `wfws.sdk`), exporting `wf-lib/wfws_sprite_builder`; it depends on `wf.sdk`
  for `wf-lib/holds`. Emission:
  - `require("wf-lib/wfws_sprite_builder")` whenever the primary builder is on
    (air strikes are excluded: their munitions have no placed missile).
  - **`sprite = 0` is unconditional on the primary** while the builder is on:
    it is how WA's own draw is hidden, and a `.wep` baseline or a
    `missile.sprite` override must not survive.
  - **Identity is "zero means cluster bit"** (`wfws_sprite_builder.lua`,
    `classify`). WA copies a missile's flight sprite from its fire params and a
    cluster bit's params are the *parent's* copy, so the primary carries the
    record `sprite` and the bits are the zero ones — the opposite of the field
    name. It only applies when a `bits` table is configured (`inherit` or no
    bits = everything is the primary). `is_bit` overrides it; a future `m.bit`
    (MissileEntity+0x150 pellet flag) is used first when the engine passes it.
    `log = true` prints the first three frames of each missile
    (`id`, `sprite`, `ident`) to settle it from the log; the Hold page's WFWS
    section has a **Log Identity** checkbox that emits it (`missileSprite.logIdentity`).
  - `bits = { sheet, anim, cyclical, anim_speed, spin, scale, mirror, z }` for
    the bit role, `bits = "inherit"` for the primary art, and no `bits` key for
    native WA bits. When the bit builder owns the bits, the generator forces
    `clusters.bit.sprite` to a stock id (`clustlet`) if it was 0/empty and writes
    `sprite_count = 1`, and it **skips** the claim `cluster = { sprite, … }`
    declaration (the builder hides that sheet anyway).
  - **Digging is not a state and has no sheet.** Whenever the builder owns the
    flight art and the record digs (`action = "dig"`, or a cluster bit whose
    action is dig), the generator writes `dig.dive_sprite` and `dig.sprite_1..3`
    as 0 — WA's mole frames (158-161) and PX's `wsvr/wsvru/wsvrd/wsvb`
    (245-248) would otherwise draw under our sheet — and passes `dig = true` to
    `sb.flight`. The builder then probes the terrain four times across the
    heading (two hits = digging, PX's Bunker Buster test, 3 frames of
    hysteresis) and cycles the role's own sheet while the round is in the land,
    heading locked. A `native` dig role leaves the record's indexes alone (only
    an author-set nonzero id is written, never a zero) and passes no `dig`.
    `dig.dive_sprite` is not art to upload: the flight sheet is the dig
    animation.
  - **Homing is timed, not detected.** The generator passes the record's own
    numbers as `homing = { arm, time, sheet, anim, … }` (primary) or
    `bits.homing = { … }` (cluster bits) and zeroes `missile.homing.sprite`
    (0xAC) / `clusters.bit.homing.sprite` (0x170) while the builder owns that
    art; the builder swaps to the sheet while `arm <= age*20 < arm+time` (50 Hz,
    so one frame is 20 ms; `time = 0` runs until the round lands/blasts).
  - **Roaming gas belongs to whichever record roams.** The Skunk proves the case:
  its bits are the animals, so `clusters.bit.roam.gas` carries the real numbers
  (`start_delay_ms = 1`, `poison_power = 5`, `animal_sprite = 174` = `skunk2`)
  while the primary's group is unused. Both the Roam and Bit Roam sections show
  it with a stock-sprite picker, and the Hold page's roam card repeats the pose
  choice.
- **Roaming is not a state at all.** WA draws the walking pose from the record
    `sprite`, the two flying sheets from `sheep.flight_1/2` and the gas pose from
    `roam.gas.animal_sprite`, so the editor emits `sheep_sprites = { a, b }` for
    two uploaded sheets (the engine installs them and writes the two fields after
    the record tables, which is why a numeric `sheep.flight_*` row is skipped
    when both are present). The gas pose stays the numeric record field.
    **Each flying sheet is a rotation strip, not a pose:** WA turns the animal to
    its flight direction by picking a frame, exactly like its own `spsheep1/2`
    and PX's Ghost Sheep (`ghstshp1/2.png` = 60×1920 = 32 cells of 60×60, frame
    0 up, clockwise). The two sheets are the cape-sway animation WA alternates
    while you steer. `RoamSheetField` has **Rotate into strip** (bakes 16/32/64
    frames from one upload) and a frame count for a strip uploaded as-is; the
    generator declares `frames` in `mod.toml` so the engine slices it.
    **The flight builder can own this state.** With `sb.flight` on for a roam
    record the generator keeps the record `sprite` (WA's walking pose), zeroes
    `sheep.flight_1/2` instead, and passes `roam = true`; the builder draws
    nothing until the turn player's synchronized Space press (a sheep never
    takes off without it) and then draws and animates its own frames. `m.sprite`
    is normal-flight art only: zeroing it for roam would delete the walk and
    would not affect `sheep.flight_*`. While the builder owns the state the two
    `sheep_sprites` uploads are dormant (not installed or declared).
    PX's sheep editor shows five sprites: flying / flying 2 are
    `sheep.flight_1/2` (0xE0/0xE4), farting is `roam.gas.animal_sprite` (0xDC),
    and taking off / during flight are 0xE8/0xEC — two sheep sprite fields WA
    reads that `record::fields()` still does not name, so the editor cannot
    write them (PX fills them with its own ids: 76 and `0x10000 + 77`). That is
    an engine field to add, not a generator omission.
  - **Weapon-wide builder parameters.** `size` multiplies every role's own
    `scale` (primary, cluster bits, each behaviour sheet), and `angle` is a
    rotation offset in degrees for art that does not point up, added in the
    drawn frame and negated on a mirrored sheet. Both come from the Hold page's
    **Builder Parameters** card (`MissileSpriteConfig.size` / `.angle`) and only
    reach the builder, never the record. There is **no glow**: WA glows only
    the natives whitelisted in `wa.assets.load{ wa_sprites }`, and a pack sheet
    has no glow copy.
  - `states = { { scope, sig, sheet/native, … } }` is **legacy**: `sig` assumed
    WA writes behaviour sprites into `m.sprite`, which it does not (that field is
    the flight sprite only). Nothing in the editor emits a state any more —
    `resolveBehaviorStates` skips every role (dig, homing, homing_bit) — and the
    builder keeps the key only for bundles that pass one by hand.
  - The primary sheet, `bit_flight.png` and `state_<key>.png` are listed in the
    claim `sprites` and declared in `mod.toml`; the exporter writes the uploaded
    file or the default missile art, so a declared path always exists.
  - The editor UI is `HoldPreview.tsx` → **WFWS role art** (`FlightRoleEditor`
    cards): bit mode and one row per available behaviour, each with native /
    builder / inherit, upload, animation, frames/FPS/anim speed/spin/scale/depth,
    and the resolved `sig` ids.
  - Behaviour art requires the primary builder; with it off the rows are stored
    but not emitted. Strikes have no builder path at all.
  - Known limits: a state does not automatically revert when WA stops writing
    its sprite (the last signal wins); a state swap respawns the follower, so a
    one-frame flicker is possible; inert cluster pellets are drawn by the engine
    as particles (`particles.rs::inert_pellet`), never become MissileEntitys, and
    therefore get no builder art at all.
- **Ribbon trail (`project.ribbonTrail`).** The effects SDK samples the round on
  game frames and draws a tapering ribbon, so colour (`r,g,b` from a hex UI
  colour), `core_w`/`glow_w`, `max`, `every` and `vanish` are free. Emission:
  `require("wf-lib/effects/trail")`, `trail.install()`, `trail.BEAM`/`trail.GLOW`
  in the claim's `sprites`, and a `wa.on.missile_frame` hook that adds the trail
  on a round's first `pre` frame (WA fires the record itself, so there is no
  `launch` id, as in px_ninja_star/famas/megashark). Target `main` skips cluster
  bits (they appear where the parent died while its ribbon is still fading);
  `all` trails a whole burst. Live trail ids are kept in an array, never with
  `pairs` (wfcheck `lockstep-pairs`). Only missile families get the card: strike
  bombs have no `m.weapon`, so their rounds cannot be matched this way.
- **Sequential fire (`project.fireSequence`, `px.fire_seq`).** `wf-lib/fire_seq`
  fires a burst from one `on_fire`: the first shot leaves immediately, a hidden
  timer actor fires the rest `delay` frames apart and holds WA's
  `shots_fired`/`shots_to_fire` at 0/1, so the worm stays in its firing pose
  until the last shot. The generator emits `require("wf-lib/fire_seq")`, a
  module-level `seq_dir(w)` (aim 0 down, 1 up, mirrored by `facing`, through
  `wa.math`), `fires = { subtype = 4 }` (WA's repeat-fire pose; without it WA
  leaves the fire method after the first shot) and
  `on_fire = function(ev) seq.fire_seq_mis{...} end` (or
  `fire_sequential_actor` for Lua actors). Keys: `weapon`, `owner`,
  `cancel_weapon`, `count`, `delay`, `spread`, `standoff`, `x`/`y`/`vx`/`vy`
  (functions of `(i, w)` when live aim is on, plain numbers locked at the
  trigger otherwise) and `on_shot` for the uploaded shot WAV. `dependencies`
  gains `px.fire_seq`. A custom Lua `on_fire` owns the trigger, so the card is
  skipped then (the UI says so). Air strikes are excluded: their munitions are
  created by the strike entity, so the slot never fires.
- **Explosion burst (`project.explosionEffect`).** `px_effects`' electric ring +
  squashed lens, drawn from a claim `on_explode` (the engine emits it before
  WA's own blast). `effect` mode keeps the native blast; `blast` mode zeroes
  `missile.explosion.power`/`push_pct` (or `mine.explosion.*`) and lets
  `custom_explosion.explode` supply damage, push, crater and sound. Emits
  `require("wf-lib/effects/px_effects")` (+ `custom_explosion` in blast mode),
  `fx.install{ trail = … }` before the claim, `trail.BEAM`/`trail.GLOW` and
  `fx.SMOKE` when smoke is on. Applies to `power` and `drop` (missile or mine)
  only: an **air strike's bombs are built from the strike's own record copy and
  have no weapon-table slot**, so `missile_boom::weapon_of` cannot map them and
  `on_explode` never fires. When a custom Lua `on_explode` exists in the snippet,
  `parseCustomLua` safely extracts its body and merges it with the explosion burst
  and custom sound into a single `on_explode = { on = function(ev) ... end }` callback.
- Hold geometry is emitted in PX units:
  `weap_rotation = 1 + degrees/180`, `hand_rotation = 1`,
  `weap_radial_rotation = 1`, `hand_radial_rotation = 1`.
- **Hold animation:** `worm_hold.rs` does
  `phase += anim_speed * 0.03` once per 50 Hz game frame, so the sheet plays
  `1.5 × frames × anim_speed` frames per second. The UI asks for the real
  in-game FPS and the generator emits
  `anim_speed = fps / (1.5 × frames)`. There is **no `animate` key** in
  `HoldSpec`; do not emit it.
- **Flight animation:** PX `anim` (`track`, `rotation`, `slow`, `medium`,
  `fast`, `none`) is an `ANIM_TYPE`, not the native `missile.animation`. It only
  goes to `sb.flight`. `cyclical` carries the frame count; `spin` is numeric.
  The PX phase is `anim_speed * 30/1000` per 50 Hz tick, and `track` uses
  `atan2(vy, vx) + PI/2` because PX sheets point up.
- `missile.animation` is the native WA animation id and is unrelated to PX
  `anim`.
- **A record id can carry `0x10000`.** WA packs a 16.16 phase beside a sprite
  value, and schemes store `0x10000 + id`: PX's sheep record holds `0x1004D`
  (sprite 77), its Mole Bomb's flight sound is 65575 (39) and the Skunk's 65578
  (42). WA masks a sprite value to its low 16 bits (`sprite::draw_phase`,
  `DisplayGfx__BlitSprite`), so the id is the remainder. `decodeRecordId()` in
  `src/data/stockSprites.ts` strips it and `wepParser` applies it to every
  sprite and sound read (inside `spriteName`, plus the numeric dig, roam, gas,
  sheep and sound fields); the export writes the plain id back. A flagged number
  written straight into a record draws nothing.
- **Pack art on record sprite fields.** `missile.trail.sprite` and
  `clusters.bit.trail.sprite` accept a bundle path inside the record tables;
  the engine loads the sheet for that weapon and writes its installed id into
  the native field. `cluster.sprite`, `cluster.homing_sprite` and the weapon's
  own `sprite` are claim-level declarations (`cluster = { sprite, homing_sprite }`,
  `sprite = "..."`): the engine installs the sheet and writes the id at install
  (`clusters.bit.sprite` / strike cluster 0x138, cluster render timer, strike
  body 0x74 — `retarget_strike_sprite_id` also carries the body sheet into the
  strike's homing sprite 0xC0 and cluster sprite 0x138 when they shared it). A
  path must never be written into the record's `bit.sprite`, which only takes
  stock names or numeric ids. Uploads live in `project.packArt` and are emitted
  through `packArtPath()`; an untouched `.wep` import still emits no tables,
  except the one trail path that has to reach the record.
- **Air strikes have no sprite-builder path.** `sb.flight` follows a placed
  weapon's missile, and a strike fires created munitions, so its art is the
  claim `sprite` (PX's `homing_air_strike` / `thumper_nade_strike` do exactly
  this). Natively drawn sheets carry the rotation themselves, in WA's airmisl
  order: a vertical strip, frame 0 up, clockwise, 32 frames for a full turn;
  `missile.animation = 2` picks the frame from the flight direction and `1`
  walks it with the missile's spin. `PackSpriteUpload`'s rotation sheet builds
  that strip from a single frame (padded square cell, `frames` declared).
- **No `cluster.homing_sprite` on strikes.** The engine applies it with
  `set_cluster_render_timer`, which writes entry+0x170 with no strike shift;
  the shifted slot is 0x184, so a fire type 3 record would have another cluster
  field overwritten. `packArtSlotApplies()` refuses it there and the UI shows
  the gap instead of the upload card.

---

## 8. Hold and flight preview math (`HoldPreview.tsx`)

The hold preview mirrors `worm_hold.rs`:

- worm cell 60×60; the 32-frame `aim.png` posture strip is flipped inside the
  cell so the worm faces the weapon;
- `rot = (1 - aim) * PI`; `rot_w = rot + PI`; weapon at
  `(cx + sin(rot_w)*weap_radius, cy - cos(rot_w)*weap_radius)`;
  `weap_angle = rot + weap_rotation`;
- hand at `rot_h = rot - PI` with `hand_radius`; put-away follows the 20-frame
  `0x65/0x66` retreat and `0x6A/0x6B` fire poses; `thrown` skips put-away;
- the scene is composed at 60×60 and drawn at 2× on the landscape.

The flight preview runs at a fixed 50 Hz, uses the `ANIM_TYPE` tables the
builder itself uses, mirrors when `vx < 0`, and draws the sprite at the weapon
pivot. The bit and behaviour role cards below it share the same flight keys.
The retired `ProjectileSimulation.tsx` had a terrain/collision loop that could
lock the renderer; leave it unused.

**Default art:** when no PNG is uploaded, `defaultArtFor(project)` picks
`spec/default_grenade.png` or `spec/default_blue_zook.png` from the donor/slot
(barrel donors and `fireType === 'hitscan'` get the bazooka, everything else the
grenade). The files are copied to `public/assets/defaults/`; the preview loads
them and `modExporter` writes the same pixels as `hold.png`/`missile.png`
(stacked for `frames`). `placeholderSprites.ts` is only a fallback if the fetch
fails. `hold.sheet` is **required** by `lua-host/src/api.rs`, so a bundle must
never declare it without writing the file.

---

## 8a. Reading other mods (`src/utils/modLib/`)

The editor can read installed bundles, so a weapon from `Mods/` can be
inspected without a `.wep`. `ModBrowserModal` (sidebar → **Read installed
mods**, also the mobile bar) takes a folder, a `.zip` or a drop and lists every
bundle, its weapon components and the record tables each one keeps in Lua.

- `luaTable.ts` reads Lua **data** only: table literals from `a.b = { … }`,
  `a.b{ … }`, `a.b({ … })`, `a.b(name)` and `return { … }`. Function bodies are
  skipped as values but still walked through, because this editor's own
  bundles put `wa.weapons.replace{ … }` inside `install = function(ctx)`.
  Anything that is not a literal becomes `null` instead of failing the file.
- `modToml.ts` reads the manifest (scalars, `dependencies`, `[[components]]`,
  `[sprites."…"]`).
- `scan.ts` finds nested bundles by their own `mod.toml` and resolves each
  weapon component to its module: its own entry when unique, else
  `weapons/index.lua`, else `weapons/<id after the dot>.lua`; then one level of
  `require("lib/…")`. A table is accepted as a record by shape (`missile`,
  `clusters`, `handling`, `gun`, `mine`, `strike`) when nothing names it.
- `loadFiles.ts` is the web-safe input: `webkitdirectory`, JSZip, and
  `webkitGetAsEntry` drops; `.lua`/`.toml` as text, `.wep` as bytes. A native
  path read would need `@tauri-apps/plugin-fs`, which is not a dependency.
- A module can name a `.wep` (`wep = "X.wep"`, sometimes assembled as
  `M.WEP .. o.wep`): the literal is matched against the bundle's own files by
  base name, so 41 of 262 weapons on the dev machine resolve one.
- `importWeapon.ts` builds a project the way the engine loads a bundle: the
  `.wep` first (`parseWepBinary`, `useWepFile` + the file kept for export), else
  `copy_from = "stock.<donor>"`; then the module's declared tables are carried
  as **`recordExtra`**. `defaults` map to the project's defaults, and
  `missile.action` / `missile.burst` to `action` / `burst`. The bundle's Lua
  code is never carried (`enableCustomLua = false`) — its callbacks require
  that bundle's own libraries.
- **Full mapping** (`mapRecord.ts`) is the inverse of the generator's emission:
  `missile`/`clusters`/`handling`/`gun`/`mine`/`strike` become the typed fields
  (`body`, `clustlet`, `roamConfig`, `digConfig`, `fireConfig`, `action`,
  `burst`) and everything else becomes `recordOverrides`. Three rules:
  a declared group implies its action (`roam`/`dig`/`homing`/`bounce`, and the
  same for `clusters.bit.action`), a `clusters` table implies the cluster burst,
  and a `mine` group means `body.fuse = false` (the generator picks `mine` over
  `missile` on that test). A trail value that is a bundle path goes to
  `packArt.missile_trail` / `packArt.cluster_trail`, never into a stock-sprite
  override. Fields the mapper does not model are put back under their group in
  `recordExtra`, so nothing is lost. `importBundleWeapon` keeps the decoded
  `.wep` as `wepBaseline` while the mapped values are the project, so a
  `.wep`-backed weapon exports the file plus only its module's edits
  (`App.handleApplyWepImport` honours `parsed.wepBaseline`).
- **`recordExtra` emission** (`luaGenerator`): only the six native record groups
  (`missile`, `clusters`, `handling`, `gun`, `mine`, `strike`) are carried; a
  bundle's spec table also holds claim keys (`sprites`, `hold`, `params`,
  `worm_sprites`, sounds, callbacks) that name art inside *that* bundle. The
  values are written as explicit `rec.<path> = …` assignments with guarded
  parents (`rec.missile = rec.missile or {}`) after a `local rec = { … }`
  record, then `wa.weapons.replace(rec)` — never a `pairs` merge, which wfcheck
  reports as `lockstep-pairs`. Full mapping of these values into the typed
  panels is the next step.
- Corpus: `bun run tools/scan_mods.ts [ModsFolder]` — 240 of 262 weapons read
  from the dev machine. Misses are stock-copy examples, templates, and records
  that only exist in a bundled `.wep`.
- **Per-donor presets** (`src/data/stockDonors.json`): one decoded record per
  panel slot, 70 of them, from PX's default scheme
  (`python tools/px_scheme_weps.py <scheme>.pxs OUT --all` then
  `bun run tools/gen_stock_donors.ts [folder]`). `body.sprite` comes from
  `recordOverrides['missile.sprite']` — the parser's `body.sprite` is a family
  guess, the record's real id is in the override. `project.donorBaseline` is the
  donor as a `WepBaseline`, and the generator picks
  `useWepFile ? wepBaseline : donorBaseline`, so a `copy_from` weapon diffs
  against the donor and writes only its real edits (an untouched new project
  exports three lines). A bundle import sets `replaceProject`, so it starts from
  the default Grenade project instead of inheriting the open weapon's art.

Ids are namespaced: `src/utils/weaponId.ts` fixes `wfws.` and the ID field
edits the suffix only, so no id can collide with a mod the reader shows.

## 9. UI and design system

- Tailwind v4, no component library. The layout is Chakra-dashboard-inspired but
  deliberately stays on Tailwind; do not migrate to Chakra without a concrete
  reason.
- `src/index.css` defines the forge palette (`--color-forge-50…950`, sampled
  from the mod loader logo), `stone` neutrals, fonts (Plus Jakarta Sans,
  Chakra Petch for headings, IBM Plex Mono), global `:focus-visible`, native
  control `accent-color`, reduced-motion handling and thin scrollbars.
- **No emerald/green theme accents.** The only green left is art (e.g. the
  grenade stem). Do not reintroduce `emerald-*`/`green-*` utility classes.
- Light mode is the default. The toggle persists `wf_theme_v2`; `index.html`
  applies it before paint and `App.tsx` keeps `theme-color` in sync.
- Branding: `public/assets/wormforge-logo.png` (327×57 wordmark) and
  `wormforge-mark.png` (49×49, also the favicon), cropped from
  `spec/modloader_banner.png`.
- Record sprite fields use `StockSpriteInput` (`src/components/StockSpriteInput.tsx`):
  a text box plus the stock table's datalist, the resolved `name (#id)` hint, a
  red warning for text the engine would read as a bundle path, and the
  `0x10000 + id` explanation when a file spelled an id that way. Use it for every
  record sprite field instead of a bare number or text input.
- Accessibility conventions already in place: skip link, `aria-current` on nav,
  labelled icon-only buttons, labelled form controls, semantic
  `button`/`select`, `aria-live` toast, `prefers-reduced-motion`. Keep them.
- Do not display "API 4.0" in UI copy. Say "WormForge format" or "WormForge
  bundle".

---

## 10. Export contract (`modExporter.ts`)

- `mod.toml`, `weapons/<mod>.lua`, `profiles/<Name>.toml` are always written.
- `weps/<file>.wep` is written only when `useWepFile` is on.
- `sprites/<mod>/icon.png` when a custom icon exists.
- `sprites/<mod>/body.png` when the weapon's own sheet (`sprite`) is uploaded —
  the only art path for an air strike's munition.
- `sprites/<mod>/hold.png` whenever hold art is enabled: uploaded sheet if
  present, otherwise the default art (never a dangling path).
- `sprites/<mod>/missile.png` whenever custom flight art is enabled: uploaded
  sheet, otherwise the default art.
- `sprites/<mod>/bit_flight.png` when the WFWS bit role is set to Builder, and
  `sprites/<mod>/state_homing.png` / `state_homing_bit.png` when the homing role
  is set to Builder (`wfwsRoleFlags`). Uploaded sheet if present, otherwise the
  default missile art. Digging writes no state sheet (the flight sheet is the
  dig animation), and roaming uses `sheep_sprites` unless the builder owns the
  flown art, in which case `missile.png` is that art.
- `sprites/<mod>/sheep_flight1.png` / `sheep_flight2.png` when both roaming
  sheets are uploaded (`sheep_sprites` needs exactly two) and the flight builder
  is off — a builder sheet owns the flying state instead. They are rotation
  strips, so `mod.toml` declares their `frames` (the sheet is sliced into that
  many direction cells).
- Any `customSprites` entries are written at their declared paths.
- `mod.toml` declares `[sprites."sprites/<mod>/missile.png"]` for custom flight
  art, the bit, homing-state and roaming-sheep sheets above, and
  `[sprites."sprites/<mod>/hold.png"]` when the hold sheet has more than one
  frame (`frames`, `fps`, `play = "loop"`).
- Profile name sanitizes `\\ / : * ? " < > |`.
- Uploaded pack art (`project.packArt`) is written as
  `sprites/<mod>/trail.png`, `bit.png`, `bit_homing.png`, `bit_trail.png` and
  `body.png` (`.gif` keeps its extension) and declared in `mod.toml` with
  `frames` (PNG only), `fps` and `play`. The path is rebuilt from the current
  weapon id on every export (`packArtPath`), so renaming cannot leave a stale
  folder. `packArtPath` returns null for `cluster_homing_sprite` on a strike
  (see `packArtSlotApplies`).
- `mod.toml` `dependencies` merges the features' own entries (`wf.sdk` for
  holds, `wfws.sdk` for the flight builder, `effects.sdk` for effects,
  `px.fire_seq` for sequential fire) with
  `project.extraDependencies` (deduped). The Bundle Code page's
  `BundleDependencies` panel edits that list; other bundles are resolved from
  `Mods/` at load.
- The one exception is the editor's own `wfws.sdk`: every export also ships it at
  `wf-lib/wfws_sdk/` (`mod.toml` + `lib/wfws_sprite_builder.lua`), the folder
  library bundles live in next to `wf-lib/sdk` and `wf-lib/effects_sdk`, so a ZIP
  unpacked into `Mods/` already has it. Both files are imported from
  `spec/lua_sdk/wfws_sdk/` with Vite's `?raw`, so there is no copy to keep in
  sync.

---

## 11. Validation recipes

Run these before saying a change is done:

```powershell
bun run lint
bun run build
```

Test pack for engine behaviour (dev only, output is git-ignored):

```powershell
bun run tools/gen_test_pack.ts   # -> test_pack/wftest_pack/ + test_pack/README.md
```

It writes one bundle with 22 components, one profile ("WF Test Pack") and all
art derived from `spec/default_grenade.png` (single frame for the sprite builder,
32/16-frame rotation strips for bits, a 4-frame strip for native trails). Each
test carries its intent, expected result and failure symptom in
`test_pack/README.md`; the profile places them on distinct stock slots with
infinite ammo. Tests 21/22 cover the explosion burst in `blast` mode (a
bazooka) and `effect` overlay mode (a mine).

Stock record values (PX's default scheme, from `WormForgeNew`):

```powershell
python tools/px_scheme_weps.py "I:/Games/WA 3.6.31.0 + Project X by 0rang3/PXSchemes/default.pxs" OUT --all
```

Each slot's `.wep` is the record that slot plays with; the action slab is at
+0xA8..+0xD0 (`crates/weapons/src/record.rs`).

Compiler check (lives in the code-editor repo):

```powershell
& 'C:\Users\lucia\Documents\GitHub\Worm-Forge-Lua-Editor\compiler-cli\wfcheck.exe' --format pretty '<bundle folder>'
```

The engine sources and sample records used to verify field mappings:

- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\weapons\src\record.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\lua-host\src\api.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\lua-host\src\record_table.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\engine\src\worm_hold.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\tools\record_fields.py`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\tools\embed_weps.py`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\docs\agent\lua-weapons.md`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\myre` — 766 real `.wep` files
- `...\myre\pxl_extracted\cweps\weapons` — strike examples

UI smoke test (Playwright is installed in a scratch folder):

```js
const { chromium } = require('playwright-core');
// executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// scratch scripts: C:\\Users\\lucia\\AppData\\Local\\Temp\\wf_pw
```

Gotcha: the record page has two `input[type=file]` elements (icon upload and
the modal). Use the file-chooser flow:

```js
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByText(/Drag & drop a/).click(),
]);
await chooser.setFiles('...\\weapon.wep');
```

Pages/subpath smoke test: serve `dist/` under a fake `/repo/` prefix and check
the logo and default sprites return 200 (this catches absolute-path mistakes
that `vite preview` at `/` hides).

---

## 12. Deployment

- `.github/workflows/deploy.yml` builds with Bun, runs `bun run lint` and
  `bun run build`, uploads `dist/` and deploys with
  `actions/deploy-pages@v4`.
- It triggers on pushes to `main` and `workflow_dispatch`.
- Pages must be enabled once by hand: **Settings → Pages → Source: GitHub
  Actions**. `configure-pages` deliberately does **not** use `enablement: true`;
  that made the action try to create the Pages site with the workflow token and
  fail with *"Resource not accessible by integration"* on repos where the token
  cannot create it. If the repo is private, Pages needs a paid plan or the repo
  must be public.
- Site URL: `https://<user>.github.io/<repo>/`. The relative base means the repo
  name does not have to match anything in the config.
- There is no desktop release workflow.

---

## 13. Hard-won lessons

1. **Never trust `.wep` filenames.** Decode and inspect the fields.
2. **Strike shift is real.** Everything in the `body` is 0x14 further for air
   strikes; `strike.*` is not.
3. **Collision masks can crash the game.** `worms` + individual worm flags =
   "overlapping worm selections". Expand or clear the shortcut, never emit both.
4. **`hold.sheet` is mandatory.** A hold block without a real file fails at
   load; always write `hold.png` (uploaded or default art).
5. **`anim_speed` is a multiplier, not FPS.** Use
   `fps / (1.5 × frames)`; the old direct emission made sheets play ~6× too fast.
6. **`animate` is not an engine key.** It was removed from the generated Lua.
7. **PX `anim` ≠ native `animation`.** Keep them separate.
8. **`.wep` and `copy_from` cannot coexist.** Branch on `wepBundlePath`.
9a. **A record sprite field takes a stock *name* or an id, never free text.**
    The engine resolves names from WA's sprite table (`crates/gfx/src/
    stock_ids.rs`, vendored as `src/data/stockSprites.ts`) and treats anything
    else as a bundle path, so a made-up name fails the whole install
    ("sprites entry 'smoke' must be a pack PNG/GIF or frame folder"). The trail
    presets used to write `smoke`/`sparks`/`fire_smoke`; they now write
    `smklt25`/`firehit`/`smkdrk20`, the export falls back to `smklt25` for an
    unknown value, and the field shows the resolved name and id (`113` =
    `oildrum4`, which is how a wrong "particle" id turns into oil-drum frames).
9. **Zero is a value.** Use `??` when reading/writing record numbers — and
   never `||` in a controlled numeric input. `value={body.homing_arm_ms || 1000}`
   displayed 1000 while the project stored 0, so exports silently carried
   `arm = 0, time = 0`; a zero `homing.time` leaves the missile unguided (no
   stock homing record has one: arms are 0-1500 ms, times 2000-5000). The same
   trap hid the builder's homing window, which starts at `arm`.
10. **Diff against `wepBaseline`.** Untouched imports must emit no tables.
11. **`base: './'` means no absolute asset URLs.** Use `assetUrl()`.
12. **The old copies are stale.** Only edit this repository.
13. **The retired simulator can lock the renderer.** Do not re-enable it.
14. **Labels must be associated with controls.** Several existing fields use
    plain `<label>` without `htmlFor`; improve them when touching that UI.
15. **Two file inputs exist on the record page.** Use the file chooser in tests.
    (There are more now: one per pack-art slot. Select them by order within the
    active tab, or by the `pack-art-<slot>-*` / upload button they belong to.)
16. **Record sprite fields are not all path-capable.** Only `missile.trail.sprite`
    and `clusters.bit.trail.sprite` take a bundle path inside a record table;
    body and cluster bit art go through the claim-level `sprite`,
    `cluster.sprite` and `cluster.homing_sprite`. Writing a path into
    `bit.sprite` is read as a sprite name and fails at load. The strike
    homing-bit sheet (`cluster.homing_sprite`) is refused on strikes: the
    engine writes that render timer without the +0x14 strike shift.
17. **`clusters.bit.sprite_count` counts sprite ids, not frames.** Bit i draws
    `bit.sprite + (i-1) % sprite_count` (MissileEntity ctor); with one pack
    sheet it must be 1 or bits 2..n pull in the neighbouring WA sprites. Frame
    count comes from the sheet itself (stock `clustlet` is 6; 32 is only the
    fallback for an unknown stock sheet). Custom sheets loop at the declared
    `fps` because `phase_delta` + `advance_loop` drive `animation_phase`.
18. **`animation` values are behaviour, not frame counts.** PX's editor names
    them in value order: 0 horiz. velocity, 1 cycle, 2 track movement,
    3 track speed, 4 slow cycle (0.5x), 5 faster cycle (0.8x), 6 fast cycle
    (1.35x). Verified by seven otherwise identical grenade records differing
    only at record +0x64 (`wep_Formatting/grenade_animtypes/`). The sheet's
    frame count always comes from the art. Do not document these from
    WormForge's debris port (`particles.rs` switches on a differently-numbered
    `anim_kind`) or from PX's `WeapSprite` type numbers, which are not the
    record's values. Details in the notes file.
19. **One handler, one `onChange`.** `updateOverride` spreads the
    `project.recordOverrides` prop, so calling it twice in a row keeps only the
    last key (this made the native trail checkbox look dead: it enabled the
    trail and then overwrote that write with the preset fields). Use
    `updateOverrides(patch)` for multi-key edits. The same staleness applies to
    any `onChange` object built from `project` rather than from previous state.
20. **A claim `on_explode` needs a weapon-table slot.** Missiles and mines are
    mapped to their slot by `missile_boom::weapon_of`; an air strike builds its
    bombs from the strike's own record copy, so the hook never fires for them.
    Do not offer effects on a `cursor` (strike) record.
21. **The primary's `sprite = 0` is a classifier, not a cosmetic toggle.** The
    WFWS builder calls any missile with a nonzero `m.sprite` at first sight a
    cluster bit. A `.wep` baseline or a `missile.sprite` override must not keep
    the native sprite when the builder is on, or the primary draws bit art.
    **Roaming is the exception:** there `sprite` is WA's walking pose, `m.sprite`
    is not what draws the flown animal, and zeroing it deletes the walk while
    the flying art (`sheep.flight_1/2`) still draws. For roam the generator
    zeroes the two `sheep` fields instead and passes `roam = true`.
22. **A bit needs a nonzero stock sprite.** If `clusters.bit.sprite` is 0/empty,
    every bit classifies as the primary. The generator forces `clustlet` and
    `sprite_count = 1`; `sprite_count` counts sprite ids, not frames.
23. **Behaviour state ids must be distinct and real.** They are written into
    `missile.homing.sprite`, `clusters.bit.homing.sprite`, `dig.dive_sprite` /
    `sprite_1..3`, `sheep.flight_1/2` and `roam.gas.animal_sprite`, and matched
    against the last nonzero `m.sprite`. Assign 245+, avoid the bit marker and
    stock bodies, and never use a negative id (record dwords are signed).
24. **A sheep never takes off without Space.** The builder's `roam = true` waits
    for the turn player's synchronized `wa.world.keys().space` edge, then owns
    the flown art; before that WA draws the walk from `sprite`. The press is
    lockstep input, so every peer starts the animation on the same frame — use
    it instead of guessing from velocity or position.

---

## 14. Out of scope / deferred

- The **code editor** app (`...\Worm-Forge-Lua-Editor`) is a separate project
  and is managed separately. Do not change it while working here.
- `wfcheck` false positives are deferred to the code-editor effort; do not
  silence warnings or hide findings in this repo.
- No Gemini/Antigravity integration; no "API 4.0" UI labels.
- Tauri release CI is not set up (local `bun run tauri:build` works).
- The stale `metadata.json` (AI Studio) was intentionally not copied here.

---

## 15. Current status (as of the last hand-off)

Done and validated:

- Modern WormForge bundle export (mod.toml, Lua, profile, sprites, `.wep`).
- Full `.wep` decode, including air-strike shifted missile/clusters/bit bodies
  and `strike.plane`.
- Clustlet bodies for impact/bounce/homing/roam/dig, advanced missile fields,
  gun/mine/strike fields, collision masks.
- Hold builder (PX posture/hand, put-away, thrown, keep-while-firing) and 50 Hz
  flight preview.
- Sidebar UI, light default, forge palette, WormForge logo, mobile layout,
  accessibility pass; Gemini/Antigravity and "API 4.0" copy removed.
- Default Grenade/Bazooka art used by previews and exports; no dangling sheets.
- In-game hold FPS conversion (`anim_speed`) and honest UI copy.
- Effects tab: ribbon trail (moved from Indices & Trail) and the effects-SDK
  explosion burst with a 50 Hz preview; Bundle Code page lists auto and manual
  `mod.toml` dependencies.
- WFWS flight builder: its own `wfws.sdk` library bundle, primary + cluster-bit
  roles, and per-behaviour state art (homing, homing bit, dig, roam flight, gas)
  with record signal ids, exporter sheets and `mod.toml` declarations.
- GitHub Pages workflow, `.gitignore`, Pages-subpath smoke test.

Likely next steps:

- Task 3 in `reqs/wfws_builder_findings.md`: harden `gen_test_pack.ts`
  (generated `mod.toml`/profile, distinct art per state, golden snapshots, new
  builder cases).
- Task 4: `fire_seq` integration.
- Add the GitHub remote and publish Pages.
- Keep `wf_weapon_editor_notes.md` updated with any engine behaviour discovered.
- If a field is added, update: type → parser → generator → editor UI → notes.
- Optional: Tauri release workflow; associate the remaining plain labels.

---

## 16. Maintenance rules

- Match the existing style: Tailwind + `stone`/`forge`, comments that explain
  engine math, no new UI framework.
- Keep the generator **diff-based** and the parser **zero-safe**.
- Every behaviour change needs: `bun run lint`, `bun run build`, a `wfcheck`
  pass on an exported bundle, and a Playwright check for UI changes.
- Update this file, `README.md` and `wf_weapon_editor_notes.md` when behaviour or
  contracts change. The notes file is the detailed history; this file is the
  operating manual.
- Commit to this repository. Do not copy changes back to the old
  `Worm-Forge-Lua-Editor\WormForgeWeaponEditor` folder.
