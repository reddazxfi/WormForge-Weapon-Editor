# AGENTS.md, WormForge Weapon Studio

This file is the hand-off memory for anyone (human or agent) maintaining this
repository. It records what the app does, how it is wired, the engine rules the
UI has to obey, the validation recipes, and the mistakes already paid for.

**Canonical location:** `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor`
(this repository). The older copy at
`...\Worm-Forge-Lua-Editor\WormForgeWeaponEditor` is a duplicate and must not be
edited.

---

## 0. Read this first: the engine is turn based and lockstep

Worms Armageddon is a turn-based game, and WormForge runs it as a deterministic
lockstep simulation. Everything below follows from that, so start here:

- **One worm acts at a time.** It has the turn, its player's keyboard is the only
  input, and `wa.world.keys()` is that player's synchronised state (`space`,
  `digit`, the arrows), identical on every peer. There is no second shot, no
  second swing and no second aim in flight at the same time: a worm cannot fire
  while another fires, and the turn's worm is the only one pressing anything.
- **Do not write code for what cannot happen.** Two worms swinging at once, two
  peers disagreeing, an input arriving out of order: none of it is possible, and
  handling it costs clarity and hides real bugs. A per-worm map of "who is
  swinging" was never needed; the turn's worm is the swing.
- **Never make a simulation decision from anything but synchronised state**: the
  frame count (`wa.world.frame()`), the keys, the world. Not the render rate
  (`wa.on.draw` runs per viewer and must only draw), not a random number, not wall
  time, not anything a peer could see differently.
- **Decide on a frame, once, and let it play out.** A duration is a number of 50 Hz
  ticks from a stored start frame, so every peer and every replay plays the same
  frames. That is why a clip is data (`clip_pose(t)`) and why a custom animation
  takes the worm and owns its own clock instead of watching WA's state machine.
- **What a turn can really do to you**: end, kill the worm, drop the weapon, or
  change the panel, and everything must settle before the next turn. Those are
  the interruptions worth handling, and they are all observable from the
  simulation.

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
│  │  ├─ HoldPreview.tsx       # hold builder (3-col) + 6-slot flight art builder (canvas)
│  │  ├─ FlightRoleEditor.tsx  # legacy role cards (superseded by HoldPreview hotbar)
│  │  ├─ PackSpriteUpload.tsx  # upload for trail / cluster-bit pack art
│  │  ├─ EffectsCards.tsx      # ribbon trail + explosion burst cards
│  │  ├─ TerrainStampCard.tsx  # wa.land.stamp card (bake, angle, buried, strip preview)
│  │  ├─ ExplosionPreview.tsx  # 50 Hz px_effects burst preview (canvas)
│  │  ├─ EmitterCard.tsx       # fx.emitter card: anchor, reach, ring, ribbon
│  │  ├─ EmitterPreview.tsx    # 50 Hz fx.emitter playback on the muzzle and the round
│  │  ├─ RibbonTrailPreview.tsx # 50 Hz trail.lua playback
│  │  ├─ BundleDependencies.tsx # extra mod.toml dependencies panel
│  │  ├─ WepImportModal.tsx    # .wep drop zone and decode summary
│  │  ├─ CarriedLuaPanel.tsx    # the imported bundle's code, one switch per block
│  │  ├─ LuaPreviewModal.tsx   # generated Lua / mod.toml / profile
│  │  └─ ProjectileSimulation.tsx # RETIRED, unused; do not re-enable
│  ├─ data/
│  │  ├─ recordTabs.tsx        # section ids/labels/icons shared by nav
│  │  ├─ recordSchema.ts       # field tables used by the editor
│  │  ├─ explosionPresets.ts   # PX electric / pyro / ember burst presets
│  │  ├─ emitter.ts            # PX effect-manager presets, defaults, family gates
│  │  ├─ spriteBuilder.ts      # WFWS role defaults, state ids, availability
│  │  └─ stockWeapons.ts       # stock donors, slots, panel positions
│  ├─ types/weapon.ts          # WeaponProject and all record types
│  ├─ utils/
│  │  ├─ wepParser.ts          # .wep -> WeaponProject (+ wepBaseline)
│  │  ├─ luaGenerator.ts       # WeaponProject -> Lua + mod.toml + profile
│  │  ├─ luaCheck.ts           # the carried-code rules (wfcheck's ids/severities)
│  │  ├─ luaText.ts            # masker, block scan, not-generated markers
│  │  ├─ modExporter.ts        # JSZip bundle writer
│  │  ├─ defaultArt.ts         # default hold/flight art selection
│  │  ├─ placeholderSprites.ts # procedural fallback art (only if a fetch fails)
│  │  ├─ assetUrl.ts           # BASE_URL-safe public asset paths
│  │  └─ sheetTint.ts          # white-on-black sheet tinting, shared by the previews
│  ├─ utils/modLib/            # reading installed bundles
│  │  ├─ scan.ts / loadFiles.ts / modToml.ts / luaTable.ts
│  │  ├─ mapRecord.ts / importFeatures.ts / importWeapon.ts
│  │  ├─ splitModule.ts        # preamble, install statements, registrations, hooks
│  │  ├─ ownOutput.ts          # our own emitted registrations, by signature
│  │  └─ carryClosure.ts       # the declarations carried code closes over (M2/M3)
│  ├─ data/luaHooks.ts         # single-valued claim hooks + wa.on event registry
│  └─ index.css                # Tailwind v4 theme tokens, focus, scrollbars
├─ public/assets/              # logo, mark, worm sheets, default sprites,
│                              #   effects/ (the SDK sheets the previews draw)
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

`App.tsx` owns one `PackProject` (the bundle), one `activeIndex`, and the active
weapon as a derived value, so **every panel still takes a single
`WeaponProject`** and nothing below `App` knows how many weapons there are:
`project = pack.weapons[activeIndex]`, `updateProject(patch)` applies the patch
(and the donor re-base) to that weapon and writes it back through
`withWeapon(pack, index, next)`.

- **A bundle of one weapon is that weapon.** `syncPackToSoleWeapon` keeps the
  pack's id, name, author and version equal to the weapon's while it is alone, so
  the export stays `<weapon>.zip` with `<weapon>/mod.toml` and the single-weapon
  ZIP is byte-identical to what it was before packs existed (measured on two real
  PX weapons). From the second weapon on the bundle has its own identity, edited
  in the **Bundle Settings** card, and `mod.toml` carries one `[[components]]`
  block per weapon.
- **The pack rail** (`PackRail.tsx`, under the sidebar project card, and
  `WeaponSwitcher`, a select in the mobile bar) lists the bundle in manifest
  order: select a weapon, add a blank one, add one from installed mods (the mod
  browser in append mode, whose button then says *Add to bundle*), duplicate,
  move up/down, remove. A bundle always keeps one weapon, so remove is disabled at
  one.
- **Ids are allocated once** (`src/utils/pack.ts`): `newWeaponId` names a new
  weapon `<packId>.<slug>` and bumps **inside the folder segment** (`rocket_2`,
  never `rocket.2`, which would be folder `2` and could collide with another
  weapon's `2`). `retargetWeaponArt` moves the art a weapon declares by path
  (`hold.sheet`, `missileSprite.sheet`, `customSprites`, the carried art) into the
  new folder, so a duplicate cannot end up naming the original's sheet.
- **The Code tab is per bundle**: one Lua view at a time (the same weapon
  selector), while `mod.toml` and the profile come from `generatePackToml` /
  `generatePackProfile` whenever the pack holds more than one weapon. `Export
  Mod` calls `exportPackZip(pack)`; a pack of one is the same call.
- Navigation state lives beside it:
- `activeTab: 'editor' | 'hold' | 'effects' | 'code'` (hotkeys `1` / `2` / `3` /
  `4`, ignored while typing in an input/textarea/select);
- `activeSubTab: RecordTabId` (the record sections). Since the redesign it is
  owned by the **workbench tab bar inside `RecordEditor`**, the sidebar and the
  mobile bar are workspace navigation only and no longer list record sections.
  `recordTabs.tsx` defines the ids, labels, hints and icons;
  `visibleRecordTabs(burst, bitAction, fireType, teleport, bodyFuse)` returns the
  tab set that applies to the weapon family: projectile/dynamite and air strike
  get Physics (or Strike & Bombs) · Missile Action · Explodes Into · Sprites &
  Trail · Lua Script, while a mine, teleport tool, firearm, flame stream, arrow,
  melee tool (`fireType: 'melee'`, whose page is the Melee Strike card) or
  special tool gets only its own setup page plus Lua Script. There is no
  "Fine Tuning" tab: its rare fields live where they apply, blast bias,
  damage randomness, random flight wobble and collision outline under
  **Blast Shaping & Random Motion** in Physics & Blast, the pre-explosion
  warning under **Pre-Explosion Warning Sound** there, and the homing sprite /
  animation / trail under **Homing Art & Trail** inside Missile Action's homing
  block (the bounce extras were already in its Bounce Settings).
  When the family changes, `App` moves `activeSubTab` to the first visible tab.
- **Explodes Into owns the payload as one page with three inner views**
  (Ejection & Bit Physics · Bit Targets · Bit Action) instead of the old
  `burst_bit_*` sub-tabs; the selected bit action (bounce/homing/roam/dig) is
  rendered inside the Bit Action view. `bitActionOf()` is the single bit-action
  expression. The other tabs stay exclusive, do not mix the two models.
- Collision targets belong to Missile Action: `Detonates On Contact` is always
  shown, `Bounces Off` only while the action is bounce.
- The **Effects & Libraries** workspace (`EffectsWorkspace.tsx`) is where every
  claim hook and library bundle lives, not a record section: the ribbon trail
  (with its 50 Hz `RibbonTrailPreview`), the explosion burst with its
  `ExplosionPreview` canvas, the custom WAVs, the sequential-fire card and the
  **Terrain Stamp** card (`wa.land.stamp`, no library bundle), as one workbench
  tab bar filtered by weapon family. It shows an empty state for
  families with no claim-owned round or blast (guns, arrows, sprays, specials,
  air strikes) and a "More libraries" note for anything not modelled yet. A new
  library gets a tab here instead of a record tab.
- `isDark` with `localStorage['wf_theme_v2']`; **light is the default** unless a
  stored value says dark. `index.html` applies the stored class before paint.
- modals: `.wep` import and the inline bundle-code view.

`Sidebar.tsx` is the desktop navigation (logo, live project card with copyable
ID, the four workspace buttons, import/export, theme toggle); `MobileBar`
replaces it below `lg`.

The **Bundle Settings** card is the manifest's own fields: the bundle icon, and
from the second weapon on the bundle id, name, author and version. A bundle of
one **is** that weapon (`syncPackToSoleWeapon`), so those four are the ones on
the Weapon Loadout card and this card says so in one line instead of showing a
second set of boxes for the same values (they used to be disabled, and the value
the pack re-derived from the weapon won anyway, so typing in them did nothing).
`profileName`, `replaces` and the profile description live only here.

`recordTabs.tsx` is the single source of section ids, labels, hints and icons.

`RecordEditor.tsx` is controlled: it receives `activeSubTab` and renders only
that section, plus the workbench tab bar that selects it.

Weapon identity and the five defaults live in `WeaponSettings.tsx`, rendered
above the workbench on the record page as one **Weapon Loadout** card (icon,
name, id, author, description · weapon type, base template, inventory slot ·
start ammo, turn delay, crate chance, crate pool, after firing), with turn
handling in a drawer. There is no separate `weapon` section any more.

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

# and, beside the weapon folder in the exported ZIP (`Mods/wf-lib/`):
wf-lib/wfws_sdk/           # always, the flight/aim builder the export names
wf-lib/effects_sdk/        # only when the weapon requires wf-lib/effects/...
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

**`ctx.option` settings** are `[[components.options]]` blocks that belong to the
component above them (`components.rs`'s `OptionDecl`: `key`, `type` of `bool` /
`int` / `choice`, `label`, `description`, `default`, `min`, `max`, `choices`,
`from_bool`, `data`). The **value** is not in the manifest: the profile stores it
under `[options."<component id>"]`, and a value equal to the declared default is
stored as *no* value at all. `ctx.option(key)` raises `"<id> has no option
<key>"` for a key the manifest does not declare, so it is a load contract and the
generator writes an imported weapon's declarations back in order. `data = true`
is `int` only and makes the option the weapon data field of the same key (PX's
`placement_range`). The exporter writes the option table only for values that
differ from the default:

```toml
[[components.options]]
key = "direction"
type = "choice"
choices = ["straight", "opposite", "random"]
default = "straight"

# profiles/<Weapon Name>.toml, only when the player changed it
[options."author.weapon"]
"direction" = "opposite"
```

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

**Emission is diff-based.** With `useWepFile`, compare against `wepBaseline`;
without it, only emit values that differ from the stock donor. An untouched
import must emit no record tables.

- **A template has to be one of WA's own weapons.** The engine refuses the whole
  bundle for `stock.<unknown>` (`stock.famas: a template is one of WA's own
  weapons`), so every weapon in it dies, not just that one. `generateLuaCode`
  writes no `copy_from` and a comment saying why when the slot is not in
  `stockDonors.json`, and `gen_test_pack.ts` refuses to write a pack whose slots
  are not all real before it writes a byte.
- **The baseline must be the donor the claim copies.** `copy_from` supplies the
  donor's whole record, so diffing against a different donor skips every value
  the two share: `WepBaseline.slot` pins a baseline to its donor,
  `stockDonorBaseline()` sets it, and the generator re-derives it when they
  disagree. `App.updateProject` re-bases the record on a donor change
  (`utils/donorRebase.ts`) and keeps the author's edits. `tools/check_copyfrom.ts`
  guards both halves. A donor missing from `stockDonors.json` writes the whole
  record rather than inheriting one nobody can diff.
- **Actions and bursts are exclusive**: `none`/`bounce`/`homing`/`roam`/`dig`, and
  `nothing`/`clusters`/`fire`. `missile.ends_on_contact` and `missile.bounce.hits`
  are independent masks; `bounce.hits` is emitted only for bounce.
- **Collision masks**: `worms` (0x3C) may not combine with
  `worms_normal/acting/jumping/roping` (the in-game "overlapping worm selections"
  crash). The UI expands or clears the shortcut; the generator expands `worms`
  to the individual flags.
- **The action groups share one native slab** (+0xA8..+0xD0, e.g. a Grenade's
  `bounce.sound` 113 at +0xB4 is also `homing.trail.sprite`), so switching the
  action writes the destination group in full (`fullGroup`, `clustletChanged`);
  a diff of only the changed keys lets the donor's numbers leak through and drew
  oil-drum frames as a homing trail. An untouched `.wep` still emits nothing.
- **A group with no rows is not written.** The roam group's `flight_1`/`flight_2`
  live in the record's `sheep` table, so a record whose only roam difference was
  those made `roamTouched` true with no row to write and emitted `roam = { }`
  (which writes nothing, and made a re-export differ from the export it came
  from). The round's group and the cluster bit's group both drop an empty body.
- **An empty `slot` is the donor's slot.** `effectiveSlot(project)` (`slot`, else
  the `copy_from` donor, else `grenade`) is used by the component's
  `default_position` **and** the profile's `stock.<slot>` line, so the two halves
  of one export cannot disagree. `stock.` placed a weapon nowhere while the
  manifest put it on `F1` (the Bazooka), and a re-import kept it there.
- Clustlets carry `clusters.bit.action` (`impact`/`bounce`/`homing`/`roam`/`dig`);
  the groups share slots too, so only the active one is decoded or emitted.
- Stock values are readable from PX's scheme:
  `python tools/px_scheme_weps.py "<WA+PX>/PXSchemes/default.pxs" OUT --all`
  (in `WormForgeNew`) writes one `.wep` per slot.

**Dependencies** are added per feature: `wf.sdk` (holds), `wfws.sdk` (the flight
builder and `sb.hold`), `effects.sdk` (ribbon trail and burst), `px.fire_seq`
(sequential fire), `px.electric` (taze: burst, pierce or melee), plus
`project.extraDependencies`. Never add a feature to `effects.sdk`: a new SDK
version would have to reach every author.

### The flight sprite builder (`project.missileSprite`, `bitFlight`, `behaviorArt`)

The editor ships `spec/lua_sdk/wfws_sdk/` (id `wfws.sdk`), exporting
`wf-lib/wfws_sprite_builder` and depending on `wf.sdk` for `wf-lib/holds`.

- `require("wf-lib/wfws_sprite_builder")` whenever the primary builder is on.
  Air strikes are excluded: their munitions have no placed missile.
- **`sprite = 0` is unconditional on the primary** while the builder is on: it is
  how WA's own draw is hidden, and neither a `.wep` baseline nor a
  `missile.sprite` override may survive it. The one exception is a roaming animal
  whose walk pose WA can draw (`roamWalkPoseId()`), which is kept and passed back
  as `roam = { walk, fly }`.
- **That zero costs the worm its hands** on a thrown or placed donor: WA picks
  their pose by the record's sprite (`Weapon__hold_sheet`), and 0 gives none. So
  wherever the missile table writes `sprite = 0` for a real shot, a `copy_from`
  claim from a donor in `POSE_BY_SPRITE_DONORS` also writes `hold_as =
  "stock.<donor>"`, the engine's field that lends a stock weapon's pose (1.0.0).
  Hold art skips it: `worm_sprites = holds.PX_POSTURE` draws the posture. Keeping
  the sprite and hiding the round with `m.sprite = 0` instead shows the stock round
  for one frame at the throw, since WA draws a launched missile before its first
  `missile_frame` (cluster bits are not affected). An older DLL ignores `hold_as`.
- **Identity is decided by the burst, not by `m.sprite`** (`classify`): the first
  missile of the weapon is the round; a missile that first appears within
  `bit_window` frames (default 5) after the round was last seen and at the
  round's last position (`bit_radius`, default 64 px) is one of its bits. A
  cluster burst builds its bits in the round's own detonation, at the round's
  position, while a fire-sequence shot leaves the muzzle and is another round.
  A missile at a round seen on that same frame waits one frame, when the round
  has either survived or gone, because the engine can list the burst before it
  drops the round. `m.sprite` is WA's render slot and not the pellet index: a
  round that hides its own art can carry the cluster sprite there (a cluster
  grenade's main missile came out with `clustlet`), which is what made the old
  `m.sprite ~= 0` test classify the main as a bit. The pellet flag
  (`MissileEntity+0x150`) is not exposed to Lua. `is_bit` overrides the test; a
  future `m.bit` is used first. `log = true` prints the first three frames of
  each missile (Hold page: **Log Identity**).
- `bits = { sheet, anim, cyclical, anim_speed, spin, scale, mirror, z }` for the
  bit role, `bits = "inherit"` for the primary art, no `bits` for native WA bits.
  When the builder owns the bits the generator forces a stock
  `clusters.bit.sprite` (`clustlet`) if it was empty, writes `sprite_count = 1`
  (it counts sprite ids, not frames) and skips the claim `cluster = { sprite }`.
- **`anim = "roam"` is the walking preset.** WA walks a roaming animal with no
  velocity of its own, so on the ground the art holds `rest` (90° by default, a
  sheet that points up lies flat for a side-on walk) and leans at most `up`/`down`
  (`MissileSpriteConfig.roamTilt`); in the air it tracks the velocity like
  `track`. The ground heading uses `abs(vx)` and a leftward walk is a true
  horizontal mirror (`facing = -1` **and** the drawn angle negated, or the animal
  comes out belly-up). The builder keeps the side in `roam_side` through a
  straight drop; the 50 Hz preview mirrors the same way. The role's own sheet may
  own the state (`behaviorArt.roam`): `roam = { sheet, anim, …, walk, fly }`,
  otherwise `roam = { walk, fly }` or `roam = true` and `missile.png` is the art.
- **Digging is not a state and has no sheet.** When the record digs (`action =
  "dig"` or a dig bit) the generator zeroes `dig.dive_sprite` and
  `dig.sprite_1..3` (WA's mole frames would draw under our sheet) and emits
  `dig = true` or `dig = { anim, cyclical, anim_speed, spin, scale, mirror, z }`.
  The builder probes the terrain four times across the heading (two hits = digging,
  PX's Bunker Buster test, 3 frames of hysteresis) and applies those overrides to
  the owning sheet while underground, reverting in open air. `dig.dive_sprite` is
  not art to upload: the flight sheet is the dig animation. A `native` dig role
  leaves the record alone (only a nonzero author id is written) and passes no
  `dig`.
- **Homing is timed, not detected**: `homing = { arm, time, sheet, anim, … }`
  (primary) or `bits.homing = { … }`, and `missile.homing.sprite` /
  `clusters.bit.homing.sprite` are zeroed. The sheet swaps while
  `arm <= age*20 < arm+time` (50 Hz; `time = 0` runs until the round lands).
- **Roaming gas belongs to whichever record roams.** The Skunk's bits are the
  animals, so `clusters.bit.roam.gas` carries the real numbers while the primary's
  group is unused. Both Roam and Bit Roam show it with a stock-sprite picker.
- **Roaming is not a state at all.** WA draws the walking pose from the record
  `sprite`, the two flying sheets from `sheep.flight_1/2` and the gas pose from
  `roam.gas.animal_sprite`. `sheep_sprites = { a, b }` installs two uploaded
  sheets (the numeric rows are skipped when both are present); each is a
  **rotation strip**, not a pose (frame 0 up, clockwise, like `spsheep1/2`), so
  `RoamSheetField` has **Rotate into strip** and a frame count, declared in
  `mod.toml`. With `sb.flight` on for a roam record the generator zeroes
  `sheep.flight_1/2` to the unassigned sentinel 699 (**not** 0: WA reads a zero
  `flight_1` as "cannot fly" and the Space press would do nothing) and passes
  `roam`. A sheep never takes off without Space (`wa.world.keys().space`, the
  turn player's synchronised keyboard).
- **Weapon-wide parameters**: `size` multiplies every role's `scale`, `angle` is a
  rotation offset in degrees (negated on a mirrored sheet), and `offset = { x, y }`
  nudges the art inside its cell in **sheet pixels**, scaled with the art, turned
  with the drawn angle and mirrored with the side. A role's own `offset` wins. The
  follower is `collide = false`, so the round itself never moves. There is no
  glow: WA glows only the natives whitelisted in `wa.assets.load{ wa_sprites }`.
- **`bits = "inherit"` keeps the identity** (`wfws.sdk` 0.16.2): a frag drawn
  from the primary's sheet is still a `bit`, so `sb.role` answers `"bit"` and an
  effect with `target = "bit"` attaches to a frag rather than to the round too.
  Identity is not the sheet. The generator never writes `inherit`, so this only
  reaches hand-written bundles.
- **Per-missile state is bounded**: `gone` (the follower's brain) is what clears
  `kind`, `sig`, `active`, `age`, the dig and roam latches, so a missile that
  never gets a follower (a stock walk pose WA draws itself, a `states` entry with
  `native`, a roam primary before takeoff) had nothing to clear it and its
  entries outlived the match. First sightings are queued in age order and the
  head is dropped once it is a second old with no follower, which costs one fresh
  classification and never a growing table. The clock is `wa.world.frame()`, not
  `age[id]`: those paths return before `age` advances, so it would never fire.
- `states = { { scope, sig, … } }` is **legacy** (`sig` assumed WA writes
  behaviour sprites into `m.sprite`, which it does not). Nothing emits it;
  `resolveBehaviorStates` skips every role.
- Every sheet the layer names is claimed in `sprites` and declared in `mod.toml`,
  and the exporter writes it (uploaded or `defaultArt`), so a declared path always
  exists. Behaviour art requires the primary builder; strikes have no builder path
  at all.
- **A state switch keeps its follower** (`wfws.sdk` 0.16.6): `a:look(sheet)`
  swaps the sheet on the same actor, so the engine's tweening keeps its history
  and the switch frame moves like any other. A respawn had no history and held
  for one frame. A new follower (launch, a split) still holds one frame, which
  only a native missile-art verb can remove. With no turn worm the follower is
  `owner = "none"` (a spawn without an owner errors, and the round flew bare),
  and a burst bit waiting its one undecided frame has WA's sprite hidden, or
  the stock clustlet showed for that frame.
- Known limits: a state does not revert when WA stops writing its sprite; inert
  cluster pellets are drawn as particles and never become missiles, so they get
  no builder art.
- UI: `HoldPreview.tsx` section 2, a 6-role hotbar (`Main`, `Home`, `Bits`,
  `HomeBit`, `Sheep`, `Dig`; unavailable slots greyed) with mode
  (`Native`/`Builder`/`Inherit`/`Probe`), upload, super-sheet slicing, animation,
  frames/anim speed/spin/scale/depth.

### Effects

- **Ribbon trail (`project.ribbonTrail`)**: `require("wf-lib/effects/trail")`,
  `trail.install()`, `trail.BEAM`/`trail.GLOW` in `sprites`, and a
  `wa.on.missile_frame` hook that adds the trail on a round's first `pre` frame
  (WA fires the record itself, so there is no launch id). Colour, widths, `max`,
  `every` and `vanish` are free. **`target` is `main` / `bit` / `all`**: the
  round, its cluster bits, or every missile of the weapon. With the flight
  builder on, the answer is `sb.role(m.id)` (the builder's own classifier,
  cached past the despawn), so a bit is a bit and not a guess; without it the
  PX heuristic answers: a first-seen round that is born into a live ribbon for
  this weapon is a bit (`trail_is_bit`), which is why the generated Lua never
  names `sb` unless the builder is on for that weapon (wfcheck is right that it
  would be an undefined global). **The trail hook is written after `sb.flight`,
  and it waits when the answer is still `nil`**: both register
  `wa.on.missile_frame` and the engine runs a mod's handlers in registration
  order, so the builder has to decide first; and a burst listed on the round's
  last frame is left undecided for one frame on purpose (the round may have
  survived as another shot), so the hook retries next frame instead of falling
  back. That fallback read an undecided bit as "not a bit" and every cluster bit
  flew bare, which is why `tools/lua/harness_trail_bits.py` and a case in
  `check_generator_edges` pin both halves. **A builder that owns the round art
  but leaves the bits to WA answers `main` for every frag**, so a cluster weapon
  in that state uses the PX live-ribbon test instead: Main Round still skips the
  bits, and Cluster Bits still draws nothing, which the card says. Live trail
  ids go in an array, never `pairs` (wfcheck `lockstep-pairs`). Only missile
  families get the card: a strike's munitions have no `m.weapon`. `noise` (px)
  jitters each point along the ribbon's normal from a fixed 257-entry table
  indexed by the point, so every peer wobbles identically and the wobble stays
  put as the ribbon moves; `rainbow` cycles the hue along the ribbon and with the
  simulation clock (PX's `SetRainbowMode`, the SDK's `HueToRGBLocal`, centred at
  180 so no hue passes through black).
- **Explosion burst (`project.explosionEffect`)**: `px_effects`' ring plus
  squashed lens from a claim `on_explode` (the engine emits it before WA's blast).
  `effect` mode keeps the native blast; `blast` mode zeroes
  `missile.explosion.power`/`push_pct` (or `mine.explosion.*`) and lets
  `custom_explosion.explode` supply damage, push, crater and sound. **`target`
  is `all` / `main` / `bit`**, a guard at the top of the merged hook, so the
  burst, the custom explosion WAV, any custom `on_explode` Lua **and the terrain
  stamp** all follow it (it is one claim callback, and the card says so). It reads `sb.role(ev.missile)`, the builder's
  identity; with the builder off the hook runs for every explosion and says so
  in a comment, because nothing can tell the parts apart. `fx.install{
  trail = …, depth = { burst = wa.depth.FRONT } }` before the claim: on the SDK's
  `EFFECTS` band an `effect` burst draws under WA's blast and only surfaced after
  the boom. `thickness` is a PX **half**-width (the SDK doubles it); an explicit
  `core` replaces the derived pass. Applies to `power` and `drop` only: a strike's
  bombs have no weapon-table slot, so `on_explode` never fires for them (lesson
  20). A custom Lua `on_explode` is parsed and merged with the burst and the sound
  into one callback.
- **Emitter (`project.emitter`)**: PX's `CEffectManager` as a live actor
  (`fx.emitter`), drawn by the SDK's hidden driver: a spark, a glow, short reach
  bolts, an optional ring and an optional ribbon at one point. **`anchor` is
  `muzzle` or `round`.** Reach bolts accept `direction` in screen degrees (0 right,
  90 down) and `spread` as a total angular range around it. A top-level emitter
  `color` tints the spark, glow, reach and ribbon unless rainbow is on. A *muzzle* emitter is moved from a
  `wa.on.worm_message` filtered to `FRAME_FINISH` (deduplicated once per 50 Hz
  tick via `EMITTER_FRAME = wa.world.frame()` and scanning `wa.worms.all()` for
  the living turn worm rather than reading the callback parameter or using
  `body_move`, since `body_move` only fires when WA steps a moving body and
  made standing-still aim wait for Space recoil, while `worm_message` does not
  reliably pass a worm table with `.turn`),  at PX's `curDist` radial distance (`offsetX`), optional `radialAngle` (degrees
  added to `(w.aim or 0.5) * math.pi` so the muzzle arm sweeps radially around
  the worm), facing-symmetric perpendicular `offsetY` (`w.facing * c * Y,
  -s * Y`) along the fire angle (`worm.aim` is WA's 0..1 sweep and `worm.facing`
  the side, the same vector the held art is drawn at), and pure Cartesian
  positional offsets `(posX, posY)` (`w.facing * posX` on the muzzle, `posX` on
  rounds, and `posY` without aim-angle trig). Setting `projectileExclusive`
  disables the muzzle aim emitter completely (`wa.on.worm_message` and
  `emitter_muzzle` are omitted) so the effect only appears on fired projectiles
  for missile-capable families (placed mines/strikes still fall back to
  muzzle). Its muzzle visibility gate
  follows Hold's **Keep While Firing** (`project.hold.keepWhileFiring`):
  `w.aiming` only when off (so thrown grenades drop the muzzle emitter as soon
  as they enter firing/throw), or `w.aiming or w.state == "firing" or w.state ==
  "fired"` when on.
  Round emitters are tracked independently from the muzzle aim emitter:
  when `anchor == "round"`, `carry`, or `projectileExclusive` is on, `wa.on.missile_frame` tracks each
  fired round by `m.id` in `EMITTER_ROUNDS[m.id]` with its own `emitter_round(id)`
  closure (`wa.world.frame() - p.seen > 3` cleans up `EMITTER_ROUNDS[id]` and
  returns `nil`), so firing multiple grenades in flight (e.g. `fire_seq` or
  multi-shot) spawns one emitter per round without removing or stealing the
  muzzle aim emitter. `round` needs a missile WA builds from the record, so a
  placed mine (a mine entity) and a strike (its bombs have no `m.weapon`) fall
  back to `muzzle`. **The emitter writes no `on_fire`**: a claim `on_fire`
  replaces WA's shot (the engine's `CreateWeaponProjectile` hook returns before
  WA builds the missile), so the hand-off that used to live there left the worm
  firing nothing at all. The round tracker is the `missile_frame` registration,
  which runs on every missile WA did build. The ring can be
  bent (`ellipse = { x, y }`, PX's `circumference`/`circumferenceSin`), spun and
  tapered (`thin`), and it rides the emitter when it has no `follow` of its own.
  By default (**`followFireAngle`**, opt-out via `follow_fire_angle = false`),
  the ring's angle follows the owner worm's world fire angle
  `emitter_fire_angle(w)` (`wa.math.atan(wa.math.cos(fa), w.facing * wa.math.sin(fa))`)
  live on `EMITTER.ring.angle` during aiming (plus accumulated `EMITTER_SPIN`
  when `ring.speed ~= 0`) and initializes projectile `spec.ring.angle` at
  spawn when `ring.track` is off (since `ring.track` overrides the angle along
  velocity every frame). Matching `px_effects.c` (`cosRot = cos(currentAngle)`, `sinRot =
  sin(currentAngle)`), `draw_ring` in both `px_effects.lua` and `EmitterPreview`
  computes `(ux, uy) = (cos(u) * ex, sin(u) * ey)` first and then applies the 2D
  rotation `(ux * cos_rot - uy * sin_rot, ux * sin_rot + uy * cos_rot)` so `angle`
  / `speed` / `track` / `followFireAngle` spin the entire ring/ellipse rather
  than sliding sample points around an axis-aligned oval; reach rays (`DrawReachPoint` / `draw_arc`)
  remain unrotated in world space.
  `rainbow` on the emitter reaches every part that does not set one, as PX's
  single manager switch does. Import/export round-trips reach direction, spread,
  the emitter RGB, and the distinction between disabled reach and an enabled
  reach with zero bolts. `carry` needs a round to be spawned for, so the
  generator also requires `emitterRoundOk`: a placed mine with `carry` on used to
  write the round tracker, and its emitter could never follow a mine entity.
  **The generated `FRAME_FINISH` (and legacy `body_move`) and `missile_frame`
  registrations are this editor's own output**: `ownOutput.ts` recognises them
  (both `EMITTER_ROUNDS` and legacy `EMITTER_ROUND`), or a re-import would carry
  them as foreign code and ship duplicate emitters.
  **Emitter and projectile ribbons are independent**: either needs the SDK's
  `fx.install{ trail = true }` hook, but only the projectile trail card emits
  `trail.add` for missiles. The generator sets that one install flag when either
  trail is enabled and does not separately call `trail.install()`. **The module
  itself is required whenever the SDK is installed**, not only when a ribbon is
  on, because the claim names `trail.BEAM`/`trail.GLOW` for every weapon that
  installs `fx` (the shared sheet set). A burst-only weapon without that local
  indexed a nil `trail` at install and the whole weapon failed to load
  (`attempt to index a nil value (global 'trail')`). `trail` is therefore not in
  `luaCheck`'s editor-ambient list: an emitted file must declare what it reads.
  `spark`/`glow` are written as booleans, so the SDK's `merge` must
  treat a non-table override as "no overrides": indexing it threw
  (`attempt to index a boolean value (local 'src')`), took the whole `on_fire`
  down and drew nothing at all. That is what `effects.sdk` 0.3.5 does, so an
  emitter bundle needs **0.4.3**; an export ships that copy at
  `wf-lib/effects_sdk/` (§10) instead of trusting whatever the player has, while
  a hand-written bundle, or a weapon shipped without the editor, still installs
  it from the catalogue. **0.4.2 also isolates the draw callback
  per mod**: the library is required once, so one `wa.on.draw` used to draw every
  mod's effects under the mod that installed it first, and the engine refused a
  spark whose sheet that claim never named (`sprite ... is not installed`). Each
  install now registers its own callback and draws only effects tagged with its
  `wa._mod`, and every generated weapon that installs `fx` claims the whole
  shared sheet set (`trail.BEAM`, `trail.GLOW`, `fx.SPARK`, `fx.BLOB`,
  `fx.SMOKE`), not only the features it switched on.
  **That per-mod key is a component, not a bundle, and 0.4.3 is what a bundle
  with more than one weapon needed**: `wa._mod` is the *component* (the engine
  sets it from `ctx.mod_id` = `d.component.id`, and uses it for `[fog]`, the
  relative sprite paths and the binds), while sheets are claimed and resolved
  per *bundle* (`plan.sprites.get(&bundle)`, `resolve_key` falling back to the
  bundle's "mates"). So a bundle that calls `fx.install` once from its first
  weapon, and makes an effect from its second, registered one callback that
  painted only the first weapon's effects: PX's `px.saw_place` and
  `px.saw_random` saws had no aura and `px.marked_for_death` drew no thunder,
  while `px.saw_grenade` and `px.death_mark` were fine, and nothing logged,
  because an effect no callback paints is not an error. `fx.install` now keeps
  the installer list in install order, and an effect made by a component that
  never installed is assigned to the installer sharing the longest id prefix
  with it (the same bundle's component for every catalogue naming scheme), once,
  with one log line; an id with nothing in common is left alone and reported.
  The editor's own weapons are one component per bundle, so nothing it writes
  changed, and a bundle can still be exact by calling `fx.install{}` from each
  component.
  `ring.track` (the card's **Track Heading**) writes `track = true`, and the SDK
  then points the bend along `wa.math.atan(vy, vx)` of the thing it rides, which
  is what makes a lens ring face the direction of travel; `angle` becomes an
  offset and `speed` is not applied, because the heading is rewritten every frame.
  The card's **What It Draws** panel is `EmitterPreview`, a 50 Hz playback of the
  SDK's own maths and sheets: the worm's aim strip sweeps the fire angle, the
  emitter rides the muzzle at `(offsetX, radialAngle, offsetY) + (posX, posY)`,
  skips aiming frames when `projectileExclusive` is active, rotates the ring by
  `followFireAngle`, `on_fire` hands
  it to a ballistic round, and the bolts grow on the preset's cooldowns while
  the ring spins and the ribbon samples. It is the only way to see the
  difference between the presets (thunder strikes once from below and holds;
  electric crackles twice), and it lives next to the card rather than in a
  separate preview page because the numbers being edited are what it plays.
- **Damage Type: Electrical** works through `px.electric`, never the SDK. WA has
  no electric hit kind (`kind = "taze"` alone is the Prod), so the generator
  declares `local zap` at module level, assigns it inside `install`, and arms the
  hit: `zap.set_message_electric(20, 0, -4, true)` before `blast.explode{ kind =
  "taze" }`, or `zap.set_message_electric_missile(20, ev.worm, 2)` in `effect`
  mode. The pierce and the melee strike arm their own hits the same way.
- **Custom WAVs (`project.customSounds`)**: PCM files declared in the claim's
  `sounds` list and played by path, so no stock sample slot is used. Four roles:
  `launch` (`on_fire`, once per trigger, the file counterpart of the record's own
  `missile.launch_sound`), `explosion` (merged into `on_explode`), `interval`
  (ticked from `wa.on.missile_frame`) and `shot` (the sequential-fire burst's
  `on_shot`). A launch WAV rides whichever `on_fire` the weapon has: sequential
  fire already owns that key, so the play goes at the top of its handler (one
  report per trigger, not per shot). An author's own `on_fire` owns the key, so
  the play is not emitted (the card says so), and a melee weapon sounds its
  strikes instead (`melee.hitSound` / `missSound`) because the shot it fires is a
  ghost with no launch sound of its own.
- **Terrain stamp (`project.terrainStamp`)**: `wa.land.stamp` burns a picture into
  the land where the round bursts. It is a built-in verb, so no dependency. The
  card bakes the upload into **32 cells, frame 0 up, clockwise**
  (`buildRotationSheet`, `maxCell: 256`, no smoothing), because the engine keeps
  stampable frames of 1..256 px. Emission: the strip in `sprites`,
  `mod.toml` `frames = 32`, and one `wa.land.stamp{ sprite, frame, x, y, buried }`
  **appended last** to the merged `on_explode`. `frame` reads `ev.vx`/`ev.vy` (nil
  for a mine, hence `or 0`); with the flight builder on it reads
  `sb.heading and sb.heading(ev.missile)` instead (the drawn world angle, guarded
  because `M.heading` arrived in 0.7.0). **Order matters**: WA's own blast runs
  after the callback and its crater erases the stamp, so only `blast` mode
  survives; the card warns, never silently switches. With
  `wormClearance` > 0 (default 12) a `stamp_clear(x, y)` walk over
  `wa.worms.all()` wraps the call, so a worm is never sealed into the land.
  **Impact damage (`terrainStamp.impact`, PX's javelin)** makes the round pierce:
  `STAMP_HIT` plus `stamp_hit(ev)`, which walks
  `wa.world.electrical_nearby(x, y, radius+16, false)` and hits every damageable
  body inside the square; it zeroes the record's own blast (`silencesBlast`) and
  rides the card's `enabled`, so switching the pierce on can never silently take a
  blast away. It needs no sheet. Valid `kind`s are the engine's native list plus
  `taze`, which arms `zap` (the `local zap` declaration must come before
  `stamp_hit`, and the require must be inside `install`). Card: **Pierce Targets**
  and **On Explosion** are one switch, never both unticked. Only a `power` record
  is offered (a mine has no impact heading).

### The aim layer (`sb.hold`)

`HoldSpec` has no offset, no second hand and no firing window, so a hold that
needs any of them is drawn by `wfws.sdk`'s quad layer instead of the engine.

- `holdNeedsAimLayer(project)` is the single gate (a non-zero `hold.offsetX/Y`,
  `handOffset`, `aimClip`, `melee`, `extraHand`, a firing sheet, or
  `fireType === 'hitscan'` / a fire sequence for `keep_firing`): it decides the
  generator's `sb.hold` call, the exporter's `silent.png`, the `wfws.sdk`
  dependency and the UI's **Atlas Mode** line. A centred hold keeps the engine's
  draw and re-exports byte-identical.
- **The sheet must be claimed** (`holdSheetPath`, plus `params = { gpu_prefix =
  "sprites/" }`): `wa.draw.quad` resolves pack paths through the sprite-key
  registry that the claim `sprites` list fills, so a hold named only by
  `hold.sheet` throws "sprite ... is not installed" while the engine's own draw is
  muted, and the weapon never swings. Same for `hand2.png` and any role sheet.
- **The mute is `wa.weapons.hold_sheet(weapon, n)`** pointing at a 1x1 transparent
  `silent.png` (appended to `hold.sheets`, no `sprites` entry needed) only while a
  worm aims with the weapon. `collect_draws` runs the Lua hooks before
  `worm_hold::draw_holds`, so the swap lands in the same frame; the swap is
  `pcall`ed.
- **The quads copy `worm_hold.rs`**: the weapon at
  `rot_w = rot + PI*weap_radial_rotation` x `weap_radius`, the hand at
  `rot_h = rot - PI*hand_radial_rotation`, drawn angle
  `(PI - PI*aim - PI*(1 - weap_rotation)) * facing` (mirrored by corner order),
  `static = { weap, hand }`, the 20-frame `grow(counter - 1)` draw-out (the first
  aim frame is deliberately blank), and the frame from
  `phase += anim_speed * 0.03`, advanced once per `wa.world.frame()` and never per
  rendered frame. Every quad carries `visibility = worm`, so Invisibility is the
  engine's.
- **`offset` is in sheet pixels**, scaled with the art by `weap_scale`, turned
  with the drawn angle and mirrored with the side; positive Y is down the sheet,
  toward the grip. `hand_offset` is the same nudge for the hand.
- **The layer's hand is the engine's**: `grow(counter) * hand_scale`, no
  `weap_scale` and no clip `scale`, because `draw_holds` always draws
  `config.hand`. A `weap_scale`-sized hand showed as a second hand. A nudged hand
  (`hand_offset`, a clip's `dx`/`dy`) does move off the engine's copy, which is
  the layer's one visible limit.
- **`aim_clamp`** (`hold.aimClamp`, degrees either side of level, default 60) stops
  the aim short of the ends of WA's 180 degree sweep, where the held art leaves
  its cell and a cut aimed vertically reads as noise. WA's own bat pipes its aim
  for the same reason. `worm.aim` and `worm.aim_target` are read-only, but
  **`worm:input{ aim = degrees }` writes the same target WA's `control_aim`
  writes** (+0x24C, PX's FireAngle), and `wa.on.body_move` is the per-frame
  simulation hook for worms, so `hold_install_aim_clamp` clamps WA's own aim:
  the crosshair, the fired vector and the drawn pose all stop at the limit. The
  write runs before WA's body step, so WA adds at most one of its own aim steps
  (180/128 of a degree, the figure `docs/agent/lua-worms.md` gives) after it: the
  target can sit that one step past the limit, never further. It is one native
  write, only while the aim is out of range, and one Lua call per worm per frame
  for the hook. The layer does the rest: `hold_clamp_aim` draws the pose at
  exactly the limit, a Space press latches the clamped aim so the swing and a
  melee strike go along it, and a `fireSequence`'s `seq_dir` launches the burst
  along it (`AIM_LO`/`AIM_HI` plus `aim_clamped`), which also covers the first
  frame after selection, before the native write lands. The clamp is what forces
  the quads (`holdNeedsAimLayer`, `M.hold_needs_lua`), so an engine without
  `body_move` still gets the drawn clamp and one log line. The engine's hand is
  parked at `hand_radius = 0.01` while a clamp is on, because the layer draws the
  clamped hand and the engine would draw its own at WA's aim, which showed as two
  hands past the limit. The preview clamps the same way (`aimDrawn`) and leaves
  the worm's posture strip on the real aim, exactly as in game.
- **`extra_hand`** (`hold.extraHand`) is the layer's, since `HoldSpec` has one
  hand slot: the engine's own maths, a **60 px hand cell** (never the uploaded
  PNG canvas size, which could draw a 100 px support hand) and its own art or
  the first hand's sheet, scaled to that cell in preview and in game, the
  swing's `dx`/`dy` carried with the weapon, no hand on the echo ghosts or the
  firing pass, and its own firing grip (`fire_radius`/`fire_rotation`/
  `fire_scale`/`fire_offset`/`fire_draw`) which falls back per key to the aiming
  grip. **`extra_hand.size` is that cell in pixels, not a percentage** (a
  `size = 90` was a 90 px hand, 1.5x the first hand), and `scale` is the only
  size knob, the first hand's `hand_scale`; since `wfws.sdk` 0.16.2 an unset
  `size` follows the weapon's `hand_size`, and `offset` is multiplied by
  `scale` alone, like the first hand's `hand_offset`, so resizing the cell never
  moves the grip. The editor writes `hand_size = 60` and `size = 60` and has no
  field for either, so its own output cannot reach a non-60 cell.
- **`fire` role** (`hold.flashFile`): the sheet WA draws on its two firing frames
  is its own role (`sheet`, `cell_w`/`cell_h`, `scale`, `frames` + `anim_speed`,
  `ticks`, `hide_main`, its own `weap_radius`/`weap_rotation` and hand). The cell
  is the sheet's own shape (`cell_w = width`, `cell_h = height / frames`), never
  forced square, and a strip (`frames > 1`) must be declared in `mod.toml` or the
  engine slices it by height / width. `ticks` is the window in 50 Hz frames from
  the first firing frame; unset means one cycle, `0` means WA's frames only.
  `fireDrawHand ?? drawHand` is the hand rule, in the panel and the generator. It
  reads `w.aim` **raw**, not `hold_clamp_aim`: the native clamp writes the aim in
  `body_move`, before WA's body step, so the value is already inside the limit
  (one step of slack), and on a build where that write is refused the round
  really does leave at the raw aim, which is the pose worth drawing.
- **One swing at a time** (`swing_of[entry]`): WA is turn based, so the sampler
  asks for the worm with `worm.turn` and keeps one swing per weapon, not a map per
  worm and not a "another worm is swinging" case (`§0`).
- **`swing` (the Space clip)**: `swing = { ticks, finish, keys }` where a key is
  `t, angle, dx, dy, scale, frame, alpha, fade, ease` and `fade = false` steps
  the opacity at that key instead of easing into it (a return home must not fade
  on the way). Data not Lua:
  `M.clip_pose` is a pure function of the tick. The edge is
  `wa.world.keys().space` in a `FRAME_FINISH` worm message, never `wa.on.draw`.
  **The swing takes the worm** (`worm:take{ turn = "freeze", fire = true }`) and
  runs the clip from `wa.world.frame() - start` until `ticks`, so WA's worm states
  are not its clock, the art draws for every tick at full size, and the aim/facing
  at the press are latched. **`fire = true` is load-bearing**: the engine eats a
  taken worm's `FireWeapon` and `ReleaseWeapon` (`physics::fire_allowed` unless
  `take` allowed it), so a take without it silently swallowed the press and WA
  never fired the melee's ghost, never took the ammo and never ran its own
  retreat. A clip-only claim still eats the shot at dispatch (`eat_fire`), so
  allowing it changes nothing for one that did not ask for a shot. At the end `worm:release(0, 0)`, then `finish = "end_turn"`
  sets the turn clock to 0. A swing owns Space, so a clip-only claim gets
  `eat_fire`; a **melee** claim does not, because it fires a ghost shot and WA
  ends the turn itself (see the melee bullet below).
- **`swing.echo`** (ghost trail): `echo = { count, every, fade, blend }` draws
  `clip_pose(t - k*every)` at `fade^k`, farthest first. Nothing is recorded, the
  hand is excluded (`weapon_only`), and `blend` is written on the shared quad
  table every call or an additive ghost leaks into the live draw.
- **Melee strike (`fireType: 'melee'`, `project.melee`)**: the aiming phase is the
  attack, and on the clip's `hit_frame` the swing loop tests a box against
  `wa.worms.all()`.
  **The weapon fires; the shot is a ghost.** A melee claim used to say `eat_fire`,
  which swallows `FireWeapon` in `fire_weapon_click_only_eat` (the worm is only
  marked active): no projectile, no ammo taken, no launch step, no retreat, and
  the clip then zeroed the turn clock itself, so the turn ended whether or not the
  record asked for it. WA ends a turn when a projectile is built (`after_use` plus
  the retreat window, `0x55D490`), so the record now fires an **invisible ghost**
  and WA owns the turn: `sprite = 0`, `trail = { sprite = 0 }`,
  `action = "none"`, `burst = "nothing"`, `explosion = { power = 0, push_pct = 0 }`,
  no launch/flight/blast sound, no impact particles, no alarm, and
  `handling = { retreat = 5000 }` and `fuse = 5000` unless the author set a retreat
  (Turn Handling). **The two numbers are one number**: WA hands the turn over when
  the shot it fired is gone or the retreat runs out, so a ghost that detonated on
  contact at the worm's feet ended the turn a frame after the swing and the window
  was never seen. A nonzero `fuse` is also WA's "timed, not impact detonated"
  switch, so the ghost lives exactly the window and then pops harmlessly, which is
  the moment the turn ends anyway.
  Nothing leaves the worm a player can see or feel; the strike's own `hit` /
  `hitSound` / `missSound` is the weapon's voice, and `collects_crates = false`
  keeps the ghost from picking up a crate it crosses. `project.melee.enabled` is the
  one test (`meleeGhost` in `luaGenerator`), and it also stops the clip writing
  `finish = "end_turn"`: a clip-only weapon ate the fire, so its `finish` is what
  ends the turn, while a melee must not. The 5 s retreat is the control the player
  keeps until the ghost dies or Space is pressed. Geometry in `src/data/melee.ts`, read by
  the red box on the aim preview, the SDK and the test pack: the scan is **the
  worm's own aim and nothing else**. `worm.aim` is WA's sweep (0 straight down,
  0.5 level, 1 straight up) and `worm.facing` is the side, so the direction is
  `(facing * sin(aim*PI), cos(aim*PI))` in world space (y down); the clip's angle
  at the hit frame turns it when `follow_swing`. The held art's `weap_radius` and
  `weap_rotation` are drawing controls: moving a pivot or turning a sheet does not
  change where the worm points, and using either is what pointed the box at the
  striker's back (once through the radius sign, once through the sheet's own
  angle). `radius` is the reach, `width` the half-arc, and the near edge starts
  3 px behind the worm. `spare_shooter` and
  `once` default on, reset per Space press. The throw is the same aim vector:
  `push = "aim"` (the default) hands `hit` `(vx, vy)` = the scan vector times
  `push power`, with `lift` subtracted from y (world y is down, so a positive
  lift throws up); `push = { x, y }` is the author's literal throw and still gets
  `lift`. No `weap_radius`, no `weap_rotation`, nothing from the art. What a hit
  does is the weapon's own `hit` callback (`victim:hurt{ amount, vx, vy }`, or
  `zap.hurt_electric` for `taze`, `pcall`ed). The hit lands on the first tick at or past `hit_frame`
  with a `st.struck` latch (`>=`, not `==`), so a frame whose message never
  arrives cannot cost the swing its hit and it still lands once. Once the swing
  has taken its worm only that worm dying ends it early: a selection WA drifts
  mid-clip does not cut the animation, and the quads draw on `swinging` alone.
  `log = true` prints the swing's start (tick, position, weapon, aim, facing),
  **every** worm with its `along`/`across` and why it was skipped, the hit frame
  and the swing's end. A press no layer can use logs
  `[wfws] Space pressed at tick N, but no hold layer has an entry for weapon …`.
  The card is the record page's **Melee Strike** tab (`MeleeCard.tsx`). **The base
  record is the Sheep Launcher (`stock.sheep_launcher`, not WA's bat)**: a special
  melee subtype resolves its whole hit in one native frame, so its worm never
  animates, while a power record gives the worm a real aim phase for the swing to
  take over. Not modelled: `stopOnTerrain`.
- **Melee is a claim, not a WA fire type**, so it is not in the Weapon Type
  select: `WeaponSettings` has a **Melee strike** switch (`#ws-melee-toggle`)
  beside it, which sets `fireType: 'melee'` and the Sheep Launcher donor, and
  turning it off returns to the family the weapon last was and clears
  `melee.enabled` (a melee table left enabled on a projectile would still eat
  WA's fire). Picking a WA type in the select clears it the same way. The record
  tables cannot say "melee" (a melee weapon's record is an ordinary power one),
  so the claim's own `melee` table is what `importWeapon.ts` reads: without that
  an imported swing came back as a projectile.
- **Melee needs the swing**: `sb.hold` builds the strike only when there is a
  clip, and the swing loop is the only thing that reads Space, so `melee` with no
  keys was a weapon whose Space press did nothing at all. The panel refuses to
  delete the last key, but an imported bundle can carry an empty `swing`, so when
  a project has melee enabled and no keys the generator writes one pose at the
  strike frame and says so in the file; the SDK logs once for a hand-written
  bundle that skips it.
- **Every listed strike writes its own `lift`, zero included**: `hold_melee_hits`
  reads a missing `lift` as the weapon's, so a combo whose second strike throws
  flat was thrown with the first strike's lift. The single-strike keys still
  omit a zero (`hit_frame` / `damage` / `power` / `lift`), which is the shape an
  untouched weapon exports.
- **A strike sound is an id or a WAV** (`MeleeSound { id, file?, priority }`,
  `hitSound` / `missSound`): the native id when nothing is uploaded, the file
  when there is (`hit_wav` / `miss_wav`, declared in the claim's `sounds` and
  written as `sounds/<mod>/melee_hit.wav` / `melee_miss.wav`), so a hit or a
  whiff can be the author's own sample. The file wins, as `fire_draw` does, and
  the id box is parked while it is set. The default whiff is WA's 96, the
  grenade throw and the bat's miss; a strike lands one play per strike either
  way, at the first worm it took or at the striker when it took nobody.
- **A combo strike can carry its own sound** (`MeleeHit.sound`): the row writes
  `sound` / `wav` / `priority` and the SDK plays `hit.audio or m.hit_audio`, so a
  light jab before a heavy finisher is heard as light and then heavy while every
  row that names none keeps the weapon's `hitSound`. Its WAV is a file of its own,
  `melee_hit<n>.wav` for strike *n* (so `melee_hit1.wav` for the first), declared
  in `sounds` like the other melee samples. `meleeStrikes()` carries the field through: the panel, the
  generator and the preview all read the table from it, and a normaliser that
  rebuilt the rows without it is what made every strike of a combo play the
  weapon's one sound.
- Keyframe ticks commit on blur (`KeyTickInput`), because the keys are sorted by
  `t` and writing the `1` of "16" re-sorted the table mid-typing.

### Animation values

- **Hold**: `worm_hold.rs` does `phase += anim_speed * 0.03` once per 50 Hz frame,
  so a sheet plays `1.5 * frames * anim_speed` frames per second. The UI asks for
  the in-game FPS and the generator emits `anim_speed = fps / (1.5 * frames)`.
  There is no `animate` key in `HoldSpec`.
- **Flight**: PX `anim` (`track`, `rotation`, `slow`, `medium`, `fast`, `none`) is
  an `ANIM_TYPE`, unrelated to the native `missile.animation`. It only goes to
  `sb.flight`; `cyclical` is the frame count, `spin` numeric, the phase advances by
  `anim_speed * 30/1000` per tick, and `track` uses `atan2(vy, vx) + PI/2` (PX
  sheets point up). `pingpong = true` walks `0..n-1` and back (`span = 2n-2`),
  emitted only when `frames > 1`; `M.cyclical_frame` takes it as a fourth argument
  so three-argument bundles still loop.
- `missile.animation` is the native WA animation id: 0 horiz. velocity, 1 cycle,
  2 track movement, 3 track speed, 4 slow cycle, 5 faster cycle, 6 fast cycle. The
  frame count always comes from the art.

### Record ids and art slots

- **`sb.role(id)` is the one answer to "which part of the missile is this"**
  (`wfws.sdk` 0.16.2): the classifier's `main` / `bit` / role name, kept past the
  despawn like `sb.heading`, so an `on_explode` can ask which part burst. The
  ribbon trail's `target` and the burst's `target` read it instead of guessing
  from `m.sprite` again.
- **A record id can carry `0x10000`** (WA packs a 16.16 phase). `decodeRecordId()`
  strips it, `wepParser` applies it to every sprite and sound read, and the export
  writes the plain id back; a flagged number written straight into a record draws
  nothing.
- `missile.trail.sprite` and `clusters.bit.trail.sprite` accept a bundle path
  inside the record tables (the engine installs the sheet and writes the id).
  `cluster.sprite`, `cluster.homing_sprite` and the weapon's own `sprite` are
  **claim-level** declarations. A path must never go into `clusters.bit.sprite`,
  which only takes stock names or ids.
- **Air strikes have no sprite-builder path**: their art is the claim `sprite`,
  natively drawn with WA's `airmisl` rotation order (`load_strip_bytes`: vertical
  strip, frame 0 up, clockwise, 32 frames for a turn; `animation = 2` picks the
  frame from the flight direction). `PackSpriteUpload`'s rotation sheet builds that
  strip from one frame.
- **No `cluster.homing_sprite` on strikes**: the engine applies it with
  `set_cluster_render_timer`, which writes entry+0x170 with no strike shift (the
  shifted slot is 0x184, another cluster field). `packArtSlotApplies()` refuses it
  and the UI shows the gap.
- A firearm's held art keeps drawing through its burst: `keep_firing = true` for
  `fireType === 'hitscan'` and for a fire sequence, which is `px_hold_art`'s job
  absorbed into `sb.hold`. The aim layer has to be on for those weapons.
- **Sequential fire (`project.fireSequence`, `px.fire_seq`)**: one `on_fire` fires
  a burst; the first shot leaves at once, a hidden timer fires the rest `delay`
  frames apart and holds `shots_fired`/`shots_to_fire` at 0/1 so the worm keeps
  its firing pose. Emits `require("wf-lib/fire_seq")`, a module-level
  `seq_dir(w)`, `fires = { subtype = 4 }` and `on_fire = function(ev) … end`
  (or `fire_sequential_actor`). Keys: `weapon`, `owner`, `cancel_weapon`, `count`,
  `delay`, `spread`, `standoff`, coordinates (functions of `(i, w)` when live aim
  is on) and `on_shot`. **The fuse rides the launch**: when the record's own
  `missile.fuse` is 0 the generator emits `FUSE_DEFAULT = 3000`, `FUSE_AIM`, a
  per-worm table and a `FRAME_FINISH` sampler on `wa.world.keys().digit` (the turn
  player's synchronised keyboard), and `missile = { fuse = fuse_of(ev.worm) }` in
  the launch table; a record with a pinned timer emits none of it. A custom
  `on_fire` owns the trigger, so the card is skipped then. Strikes are excluded.
- Hold geometry is emitted in PX units: `weap_rotation = 1 + degrees/180`,
  `hand_rotation = 1`, and `weap_scale` carries the scale. Both radius sliders span
  `-35..35` px. **`weap_radial_rotation` and `hand_radial_rotation` are authored
  fields** (`hold.weapRadialRotation` / `handRadialRotation`, default 1, turns of
  PI): `worm_hold.rs` places the weapon at `rot + PI*weap_radial_rotation` and the
  hand at `rot - PI*hand_radial_rotation`, and PX ships 0, 0.22, -0.13, so
  hard-coding 1 turned the art a half turn and made the javelin's
  `weap_radius = -11.8` read as +11.8. The importer reads both (only when they
  differ from the fallback) and the panel has a dial for each, so a bundle
  round-trips its arm position.
- **A hold's cells are not its frames.** `worm_hold.rs` computes
  `frame = (phase * hold.frames) as u32` and `gpu.rs`'s `enqueue_hold` clamps it
  against `sprite::gpu_frame(sheet)`, the count the `[sprites]` declaration sets,
  so `hold.frames` only picks an index into a strip the manifest slices. PX's
  Buffalo of Lies is the case that shows it: a 20-cell run cycle held on frame 0
  (`hold = { sheet = ..., frames = 1 }` over `[sprites] frames = 20`), with the
  charging animals walked by the bundle's own `wa.actors` code.
  `HoldConfig.sheetFrames` carries the picture's cell count when the two differ
  (the import sets it from the declaration, the editor's own uploads never need
  it), and it is what `mod.toml` declares (`frames = max(sheetFrames ?? frames)`),
  what the preview slices, and what the divisibility warning checks. Without it
  the export declared the 20-cell strip as one cell and the held art was the whole
  strip squeezed into the cell.
- **Engine bug fallback**: `draw_hand = false` still draws the hand, so the
  generator also emits `hand_radius = 0.01` with it (the project keeps the
  author's `hold.handRadius`; the importer restores it).

---

## 8. Hold and flight preview math (`HoldPreview.tsx`)

The aiming preview has the same **-, `%`, +** zoom bar over the canvas
(`aimZoom`, a multiplier on the scene's own 2x: 100% is the framing the reference
art was laid out for). It scales about the worm's own map point, so a close look
frames the hand and the held sprite rather than pushing them off the canvas.

The hold preview mirrors `worm_hold.rs`:

- worm cell 60×60; the 32-frame `aim.png` posture strip is flipped inside the
  cell so the worm faces the weapon;
- the held sheet is sliced by its own cell count
  (`hold.sheetFrames ?? hold.frames`, the number `mod.toml` declares) and the
  frame index comes from `hold.frames`, which is what the engine does: one cell of
  a 20-cell strip is one buffalo, not the whole strip squeezed into the cell. The
  Hold card says which is which when the two numbers differ;
- `rot = (1 - aim) * PI`; `rot_w = rot + PI * weapRadialRotation` (1 is the
  engine's default); weapon at
  `(cx + sin(rot_w)*weap_radius, cy - cos(rot_w)*weap_radius)`;
  `weap_angle = rot + weap_rotation`;
- hand at `rot_h = rot - PI * handRadialRotation` with `hand_radius`; put-away
  follows the 20-frame `0x65/0x66` retreat and `0x6A/0x6B` fire poses; `thrown`
  skips put-away;
- the scene is composed at 60×60 and drawn at 2× on the landscape.

The flight preview runs at a fixed 50 Hz, uses the `ANIM_TYPE` tables the
builder itself uses, mirrors when `vx < 0`, and draws the sprite at the weapon
pivot. Its playback bar has **-, `%`, +** zoom buttons (`missileZoom`, where
`MISSILE_ZOOM_1X = 4` is WA's own pixel size and the middle button resets, so
100% means game pixels; the oil-drum reference divides by the same 4). The
`%` readout replaced an older `2x..6x` preset row. The bit and behaviour role cards below it share the same flight keys.
The retired `ProjectileSimulation.tsx` had a terrain/collision loop that could
lock the renderer; leave it unused.

**Default art:** when no PNG is uploaded, `defaultArtFor(project)` returns the
one hand-drawn sprite (`spec/holyhandgrenade.png`, 64x64, copied to
`public/assets/defaults/default_hand_grenade.png`), whatever the donor or fire
type is. The preview loads it and `modExporter` writes the same pixels as
`hold.png`/`missile.png` (stacked for `frames`). `placeholderSprites.ts` is only
a fallback if the fetch fails. **It is drawn for this project on purpose:** the
old grenade/bazooka fallbacks were cut from WA's art, so every untouched export
carried Team17 pixels. An export now contains only what the author uploaded plus
this sprite, which is what the footer disclaimer and `README.md` promise.

`hold.sheet` is **required** by `lua-host/src/api.rs`, so a bundle must never
declare it without writing the file.

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
  `readCallTable(code, "fx.burst")` finds a table passed to a call even inside a
  callback the table reader skipped, and returns the literal text too (some of
  the generator's values are expressions, like `vx = function … * 14 end`).
- `modToml.ts` reads the manifest (scalars, `dependencies`, `[[components]]`,
  `[sprites."…"]`, `[exports]`, the `[[components.options]]` /
  `[[components.weapon_options]]` / `[components.suggests."<feature>"]` blocks
  that belong to the component above them, which used to become phantom
  components and lose every option, and **inline tables**:
  `default_position = { row = "F2", column = 1 }` is the panel slot a weapon
  replaces, and reading it as one string is why an imported pack put every weapon
  on its donor's slot. `splitTopLevel` keeps a comma inside a string or a nested
  table from splitting a value; `ModWeapon.row`/`column` carry the position and
  `stockSlotForPosition` turns it back into a stock slot).
- `scan.ts` finds nested bundles by their own `mod.toml` and resolves each
  weapon component to its module **the way the engine's loader does** (L1 of
  `reqs/wflib_weapon_import_plan.md`): the bundle's own `["<id>"] = "<module>"`
  index first, wherever that file lives, then the component's `entry` (shared or
  not: it is the module the engine runs, and `px.bunker_buster` /
  `px.super_bunker_buster` are two components over one module that tells them
  apart by `ctx.id`), then `weapons/<id after the dot>`, `weapons/<name>`, the
  same under `wf-lib/<namespace>/` and `lib/`. `resolvedVia` says which one
  worked and a miss lists every candidate it looked in. A `require` is resolved
  by the engine's rules and **in the calling module's bundle**: a plain name is
  bundle-relative, `wf-lib/<name>` is a declared dependency's `[exports]` entry
  (`lua-host/src/modules.rs`), and a module a library exports resolves its own
  requires in the library's bundle (what `wf-lib/sdk/parkour.lua` requiring
  `own_time` needs). The legacy shape (a `wf-lib/` name satisfied by the bundle's
  own `lib/`, which is what `px_buffalo` ships) is followed for reading and
  reported in `localLibraryRequires`, because the current engine refuses it. A
  table is accepted as a record by shape (`missile`, `clusters`, `handling`,
  `gun`, `mine`, `strike`) when nothing names it.
- `loadFiles.ts` is the web-safe input: `webkitdirectory`, JSZip, and
  `webkitGetAsEntry` drops; `.lua`/`.toml` as text, `.wep` as bytes. PNG/GIF/WAV
  entries are listed with a **lazy** reader (`bytesOf`), because a whole `Mods/`
  tree can hold far more art than an import needs. A native path read would need
  `@tauri-apps/plugin-fs`, which is not a dependency.
- A module can name a `.wep` (`wep = "X.wep"`, sometimes assembled as
  `M.WEP .. o.wep`): the literal is matched against the bundle's own files by
  base name, so 41 of 262 weapons on the dev machine resolve one.
- **A claim table written with names is read as names** (`luaStrings.ts`). The
  table reader keeps literals only, so `local SHEET = "sprites/x/hold.png"` then
  `hold = { sheet = SHEET }` read back empty and the weapon lost its sheet, its
  icon and every sound path (`px_buffalo` is written this way). `stringConstants`
  collects `local NAME = "…"` chains to a fixed point, `resolveStringExpr` follows
  `..` concatenation, and `resolveTableStrings` fills only the fields that are
  missing, recursing into nested tables. It runs on the table the reader **kept**,
  and only when that table is the file's `wa.weapons.replace` call, its `record`
  assignment or its `return` table, so one weapon's paths cannot land on another's
  art.
- **The record can be data** (`definition = { … }`): `scan.ts` already treated
  `definition` / `weapon.definition` as claim candidates, and `claimTextOf(...,
  'definition', 'field')` finds the literal's braces inside
  `local weapon = { definition = { … } }` (masked copy plus `matchingBrace`, so a
  comment or a string saying `{` cannot open it), which is what lets the names
  inside it resolve. A `definition = function()` stays code and is not read as
  data.
- **`mod_icon` and `replaces` are bundle-level and are read**: `ModBundle.modIcon`
  becomes the pack's `iconFile` (see §10) and `ModBundle.replaces` the pack's
  `replaces`, because a re-export that dropped the list would change what
  installing the bundle does. A `mod_icon` that names one of the weapons' own
  icons is not adopted: it is the fallback the manifest wrote, and taking it as
  bundle art broke byte-identical re-export.
- **A sprite folder is a strip** (`sprites/i_bomb/body/00.png`, 32 files, and
  `mod.toml` declaring `frames = 1`). The engine reads a folder natively as one
  strip in file-name order (`load_png_sequence`, `crates/gfx/src/lib.rs`), and the
  import joins it in a canvas (`frameFolderFiles` + `composeFrameFolder`) and uses
  the file count as the role's `frames` when the bundle declared none, for the
  hold sheet, pack art, roaming sheets and builder roles alike. Without a canvas
  (a headless run) the import says `N PNG frames in a folder, not joined without a
  browser` rather than writing the fallback sheet and calling it art.
- `importWeapon.ts` builds a project the way the engine loads a bundle: the
  `.wep` first (`parseWepBinary`, `useWepFile` + the file kept for export), else
  `copy_from = "stock.<donor>"`; then the module's declared tables are carried
  as **`recordExtra`**. `defaults` map to the project's defaults (a bundle
  import starts from neutral defaults, not the open project's), and
  `missile.action` / `missile.burst` to `action` / `burst`.
- **The module's own code is checked, not yet carried.** `importWeapon.ts` runs
  `checkLua(moduleText, { mode: 'module' })` and reports the counts in the import
  summary (`lua: 2 findings, 2 blocking (lockstep-rng, module-wa)`, or
  `nothing blocking` when every finding is a warning or an advisory). What a
  bundle's callbacks *do* is still dropped, and the summary now names what it
  dropped instead of staying quiet (M0 of `reqs/custom_code_import_plan.md`):
  - `on_fire` is reported as **not carried** unless the sequential-fire burst
    inside it was rebuilt as the `fireSequence` feature, because only that part
    is modelled. The Conductor's hand-written `on_fire` is its whole weapon, so
    the note is the difference between a silent loss and a stated one.
    `unmodelledClaimKeys(source, absorbed)` takes the absorbed keys; the data
    lives in `src/data/luaHooks.ts` with the corpus counts that ordered the work.
  - a module whose `copy_from` is not a literal (PX builds its claim table at
    load: `require("lib/weapon").merge(record, {…})`) says so, instead of
    quietly starting the record from `stock.grenade` and exporting that name.
  - a sound role with nowhere to play is reported: `shot` rides the
    sequential-fire burst's `on_shot`, so a single-shot handgun with a `shot`
    WAV (the Conductor) had it dropped without a word, and `launch` plays from
    `on_fire` instead.
  The plan for carrying the rest, and the merge rules for the single-valued
  hooks, is `reqs/custom_code_import_plan.md` (M0, M1 and M1.5 delivered; M2/M3
  and M5 to M7 open).
- **A claim `sprites` path a role already owns is that role's art**
  (`importFeatures.ts`). The list holds every sheet the claim needs, and the
  export's sheet dedupe points identical bytes at **one** file, so a path's name
  can belong to another weapon's role: a hold sheet shared under `body.png` came
  back as the weapon's strike art (which then suppressed
  `params = { gpu_prefix = "sprites/" }`, and the aim layer's `wa.draw.quad`
  stopped resolving a pack path), and a builder bit sheet named `bit.png` came
  back as stock cluster art. The owned set is built from the claim itself (the
  hold and flight sheets, `customSprites`, carried art) **and** from every sheet
  the `sb.hold` / `sb.flight` / `wa.land.stamp` calls name, and only a path no role
  claims is classified by file name. Found by
  `tools/check_pack_fixture.ts`, not by an in-memory case.
- **The module's structure is read, not guessed** (`splitModule.ts`, M1 of the
  plan): the preamble (module-level requires, constants and helpers), the install
  body's own statements (the install-time locals and the registrations), every
  `wa.on.*` call **with its options table**, and the claim hook bodies. It emits
  nothing; the import summary uses it for an inventory line (`module code: 14
  module-level declaration(s), 24 install statement(s), 2 wa.on registration(s), 1
  claim hook(s)` for the Conductor), which is how "the record came across and the
  code did not" stops being a suspicion. Two rules make it trustworthy:
  - the scan runs on `maskLuaCode`'s copy, so a comment saying `end` or a string
    saying `"end"` cannot close a block (a real bug in `customExplodeBody`), and
    every offset is the original's, so the text it hands back is verbatim;
  - brackets **and** blocks have to be closed before a newline ends a statement
    or a comma splits an argument. Without the block half, the commas in
    `wa.on.draw(function() for i = 1, n do … end end)` split the body into a bogus
    second argument, which is what made a registration look like it had options.
  The registry it reads is `src/data/luaHooks.ts`: `CLAIM_HOOKS` (the
  single-valued keys, with what each receives) and `WA_ON_EVENTS` (every event
  the engine binds, what it takes, and the one fact that decides how a carried
  registration must be moved: **only `worm_message` takes `msgs` and only
  `body_move` takes `kinds`**, `api.rs`'s `bind_on`; any other second argument is
  an error at load, so a carried `worm_message` without its filter still loads and
  runs on every message).
  `WA_ON_EVENT_NAMES` is the list `tools/check_lua_hooks.ts` checks every real
  registration against.
- **This editor's own output is recognised** (`ownOutput.ts`, M1.5 of the plan):
  `ownOutputOf(split)` splits a module's registrations into the ones the generator
  wrote and the ones nothing models. The three signatures are the generator's and
  only its own: the ribbon trail's `trail.add(m.id, trail_worm(), TRAIL)` with a
  `local TRAIL = {` table, the interval sound's `sound_ticks[m.id]` and
  `SOUND.path` with a `local SOUND = { path = … }`, and the fuse sampler's
  `FRAME_FINISH` handler writing `fuse_by_worm[w.id]` under `FUSE_DEFAULT`. A
  hand-written `missile_frame` that plays a WAV on a timer is **not** ours: the
  signature is what keeps every trail-like weapon anyone wrote from being claimed.
  The import summary reports both halves (`wa.on handlers: 2 rebuilt from the panels
  (ribbon trail, interval sound); 1 not modelled (missile_frame)`), which is the
  input M6 needs: a recognised block is regenerated from its card, a foreign one is
  carried or refused.
- **Features** (`importFeatures.ts`) are the inverse of the generator's feature
  emission, for the bundles this editor writes (the WFWS corpus): the `hold`
  table (`sheet`/`hand_type`/`weap_rotation` reversed to degrees/`weap_scale`/
  `anim_speed` back to FPS), the `sb.flight` argument (primary sheet, `bits`,
  `bits.homing`, `homing`, `dig`, `size`/`angle`/`log`), the `TRAIL` table and
  its `target`, `fx.burst` / `blast.explode` (mode, damage/push/hole/sound and
  every burst field, preset matched back), `seq.fire_seq_mis` /
  `fire_sequential_actor` (including the expression fields `vx`/`x`/`y`), custom
  WAVs and their priorities/timing, the claim `sprites`/`cluster`/`sprite`/
  `sheep_sprites` sheets, `wa.land.stamp` (mode from the `frame` expression,
  angle back as degrees, `buried.soften`/`blend`, `true_colour`, the worm
  clearance from `STAMP_CLEAR`, the impact table from `STAMP_HIT`, and the strip
  attached with its declared `frames`), the custom part of `on_explode`, and any
  manifest
  dependency that is not one of the four automatic ones. The sheets and WAVs are
  read from the bundle and attached as `File`s, so a re-export writes the same
  art instead of the defaults. `unmodelledClaimKeys()` reports function-valued
  claim keys the reader does not carry (a bundle's own callbacks).
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
- **`recordExtra` emission** (`luaGenerator`): only the native record groups
  (`missile`, `clusters`, `handling`, `gun`, `mine`, `strike`, `sheep`) are
  carried; a bundle's spec table also holds claim keys (`sprites`, `hold`,
  `params`, `worm_sprites`, sounds, callbacks) that name art inside *that*
  bundle. The values are written as explicit `rec.<path> = …` assignments with
  guarded parents (`rec.missile = rec.missile or {}`) after a `local rec = { … }`
  record, then `wa.weapons.replace(rec)`, never a `pairs` merge, which wfcheck
  reports as `lockstep-pairs`. Full mapping of these values into the typed
  panels is the next step.
- **Carried Lua (`project.carriedLua`, `modLib/carryClosure.ts`)**: an imported
  bundle's code is carried, not dropped. Three lists, all written verbatim after
  one `transform`: `hooks` (the claim hooks nothing models, so `on_explode`,
  `on_fire` and any other key the editor has no handler for), `registrations`
  (every `wa.on.*` call `ownOutputOf` does not recognise) and `art` (the sheet
  and WAV paths the carried text names). A body is never carried alone; its
  **closure** is (M2 and M3 of the plan). The hook's free names are resolved
  against the scopes it sits in, innermost first, transitively and in source
  order, so vortex arrives with `start_vortex`, `tick`, `pull`, `scatter`,
  `play_at`, `vortices` and the constants they read, pulsar with `aura`, and the
  Conductor with `bolt_end`, `draw_bolt`, `step_bolts`, `BOLT` and
  `BEAM_FRAMES`. **A scope is a block, not a level**: PX declares a weapon's
  state inside `function weapon.setup() … do … end` and registers its hooks from
  there (`swim_suit`, `hang_glider`, `portal_gun`, `nuke_rocket`), so
  `splitModule` records the chain of statement lists containing each registration
  and each claim hook (`LuaBlock.scope` is the list a block belongs to,
  `enclosing` the lists outside it), and `bodyRegion` recurses into `function`,
  `do`, `for`, `while`, a `repeat` and an `if` with one branch but never into a
  table, because a `return { on_explode = function … end }` would read the hook's
  own body as a scope of the hook. Before that walk 44 of PX's 89 weapons carried
  names nothing declares; now none does. A seed's free names also include the
  ones **inside the function literals it hands to `wa.on.*`**, since the checker
  reads `wa.on.worm_message(function(w) … end, opts)` as one call and reported
  nothing inside the callback. One declaration reached twice (a `local shared =
  require("lib/shared")` in both `weapon.definition` and `weapon.setup`) is one
  binding and is carried once; only two genuinely different locals of one name
  clash, and the second is refused with a note. **A hook written inside another
  hook is not a claim key**: PX's `fire_seq` burst passes `on_shot`/`on_done` in
  the options table of the call `on_fire` makes, so they read `on_fire`'s locals,
  and hoisting one to the claim table read them as nils; `split.nestedHooks`
  marks them, `importWeapon` skips them as seeds and names them in the summary,
  and they travel inside the parent's text. **A name that is a parameter** of the
  enclosing function (`function M.install(ctx, spec)` in `lib/cursor.lua`) is
  reported with the function and its line instead of "nothing declares it",
  because the caller supplies it and there is nothing to carry. The emission is two regions: the preamble before
  `return {` (with the generated requires, because these are the same kind of
  thing) and the prologue at the end of `install`, before the claim, so a carried
  helper that calls `fx.burst` runs against an installed library.

  Where each list lands (M5 and M6):
  - **`on_explode` is merged, not replaced**: one handler holds the custom WAV
    play, the effects-SDK burst and the carried body, in that order, each inside
    its own `local <param> = ev` and `NOT_GENERATED_*` markers. The author's
    snippet stays the author's (`enableCustomLua` is not switched on by an
    import), so the two never fight over the key. **`on_fire` is the same merge**:
    launch WAV, `fire_seq` burst, carried body. A bundle's `on_fire` that is only
    the launch-WAV play is this editor's own output and is not carried.
  - **A hook nothing merges is written verbatim** (`on_click`, `on_done`,
    `on_select`, `on_place`, `on_transport`): `key = function(…) … end`, re-indented
    with `reindentCode`, never by prefixing every line: a re-import reads the body
    back with the indentation the last export gave it, so a blind prefix added six
    spaces per round trip.
  - **A round trip is byte-identical** (`tools/check_pack_fixture.ts`), and three
    rules exist for it alone. A re-import drops this editor's own
    `not generated` markers before the body is wrapped again
    (`stripNotGeneratedMarkers`), or a weapon written here gained two comment lines
    every time. An `on_fire`/`on_explode` parameter alias (`local fire = ev`) is
    written **inside** the region: `hookBodyOf` cuts from the signature to the last
    `end`, so a line outside came back as part of the body and the marker drifted
    below it.
  - **A registration carries its filter**: only `worm_message` takes `msgs` and
    only `body_move` takes `kinds`, so the options table is part of the text, not
    re-derived (the Conductor's `{ msgs = { wa.msg.FIRE_WEAPON } }` survives).
    Registrations are written after everything the editor installs, reindented.
  - **Every carried region is a `not generated` region**: the preamble, the
    install locals, the registrations and the merged hook bodies are each written
    between `NOT_GENERATED_OPEN`/`CLOSE`. They are comments, so the masked copies
    every scanner uses never see them (and the carry's own same-text comparison
    is unaffected), and they are what lets `checkLua` tag a finding as being in
    code no panel produced. The Carried Lua panel reports exactly those.
  - **Art is declared where the export writes it**: `carryClosure` returns
    `paths: { source, target }[]` for every art literal it rewrites, the importer
    loads each from `source` into `customSprites[target]` (with the source
    bundle's own `[sprites."…"]` declaration, matched by file name, so a rotation
    strip keeps its `frames`) or into `carriedLua.art.soundFiles`, and the
    generator appends `art.sprites` to the claim's `sprites` list and `art.sounds`
    to `sounds`, because a pack path only resolves through the sprite-key
    registry those lists fill. A path that is already the export's own is recorded
    too, or a re-import would forget the sheet and drop it from the next ZIP.
    **Hooks and registrations are transformed on their own**, so the `paths` that
    call returns count as well: the Conductor's `FIRE_WEAPON` registration plays
    `sounds/conductor/shot.wav`, and reading only the carried blocks rewrote the
    path without attaching or declaring the sample (an empty `sounds` list and an
    undeclared WAV).

  Four rules make it safe, and each has a case in `tools/check_carried_lua.ts`:
  - **Scope**: a module-level block cannot see an install local or `ctx`, so a
    preamble helper that reads `ctx` is reported instead of carried into a nil.
  - **One binding, one declaration**: a bundle's `local fx = require(...)` is
    dropped when the export binds `fx` to the same module (the generated local
    serves both) and **renamed** to `fx_bundle` when it binds a different one,
    since a shadowed `fx` is a callback that silently does nothing. A block the
    export writes **identically** is dropped too (`squash`ed comparison against
    the generated file): that is what keeps `stamp_hit`/`STAMP_HIT` from being
    carried back into our own output, and what makes a re-import idempotent.
    A bare `x = …` also pulls in the `local x` it assigns, which is pulsar's
    `local zap` + `zap = require(...)` (lesson 21's shape).
  - **Lockstep maths is rewritten, never blocked**: `fixLockstepRng` (the custom
    Lua box's own mapping) turns `math.random` into `wa.random` and
    `math.sin/cos/atan` into `wa.math.*`; the float form `math.random()` has no
    equivalent, so it is reported instead. The hook body and its declarations go
    through the same `transform`, so the names always agree.
  - **Art moves with the code**: the ZIP only ships `sprites/<mod>/` and
    `sounds/<mod>/`, so `sprites/vortex/hold.png` in carried text becomes
    `sprites/<exported folder>/hold.png` (folder segment only, a file name is the
    author's). **A folder reference names its files**: `local SND =
    "sounds/buffalo/"` then `SND .. "start.wav"` is a prefix, not a file, so the
    move is recorded with its trailing slash and `importWeapon` expands it into
    every PNG/GIF/WAV of that folder, attaching and declaring each under the
    export's folder. Rewriting the prefix alone left the buffalo's four samples
    attached to nothing and undeclared while the claim played paths the zip did
    not carry. A `require` of a module the export does not ship is named, and a
    shipped one adds its dependency to the manifest (`effects.sdk`,
    `px.electric`, `wf.sdk`, `wfws.sdk`, `px.fire_seq`).
  What is refused: a block whose `end`/brackets do not close (`lua-ast`), because
  a half-copied helper is a nil call with extra steps. What is still *not* carried:
  a `wa.on.*` that `ownOutputOf` recognises as ours, whose panel was switched off
  in the import. The block is reported as rebuilt and the export drops it,
  because carrying it would double the feature.

  **The panel** (`src/components/CarriedLuaPanel.tsx`, Bundle & Export) lists every
  carried block, one row each, with the code read-only behind a disclosure and one
  switch per row (`disabled` on the block: the text stays in the project, the
  export stops writing it). The validator's findings inside a carried region sit
  at the top of the list, so switching a declaration off and leaving the block
  below it reading a nil is visible in one place rather than in the file.

  **Measured on the installed corpus** (`Mods/`, 280 weapons with a record): the
  closure is complete for 276 of them. The four left read names a **bundle-local
  library module** declares (`px.famas` and `px.megashark_hold` in
  `lib/fire_seq.lua`, `cursors.cursor` in `lib/cursor.lua`), which is L2 of
  `reqs/wflib_weapon_import_plan.md`: a carried `lib/…` module is a second scope,
  not a name in the weapon's own module. A carried `require` of a module the
  export does not ship is named in the import summary (`carried
  require("lib/shared") is not shipped by the export: add the bundle that
  provides it to Dependencies, or the export fails at load`), and one of a name
  `wf.sdk` exports (`wf-lib/own_time`, `wf-lib/shared`, `wf-lib/parkour`,
  `wf-lib/tooltip`, `wf-lib/lightning`, `wf-lib/px_sprite_builder`) adds `wf.sdk`
  to the manifest instead.
- Module discovery and `ctx` configuration (no server, exits 1 on a failure):

```powershell
bun run tools/check_module_scan.ts
```

77 cases on `src/utils/modLib/scan.ts` and `modToml.ts`: the shared loader entry
with an index (`px.ports`), two components over one real module, a record handed
to a library (`lib/px_bunker.lua`), **a record written as data**
(`local weapon = { definition = { … } }`, read with its `copy_from` and its
`hold.sheet` resolved from a module constant, which is L3), a weapon module under
`lib/`, `wf-lib/` resolved through a dependency's `[exports]`, the legacy
own-`lib/` shape, a cross-bundle plain `require`, option blocks attaching to the
component above them (and not becoming phantom components), `[exports]` staying
out of the scalars, `ctx.option` reads, the miss message, an ordinary
`["name"] = "value"` table not being mistaken for an index, and the **manifest
round trip** (the options the generator writes read back as the same keys, kinds,
ranges, choices, defaults and `data` flags, with no option block becoming a
phantom component). Then the
installed corpus when it is mounted:
`px.ports`' 97 weapon components with 89 records, the index and library routes
both present, no unresolved `require` anywhere, the two components over one
module, and the buffalo's `ctx.option("direction")`.

The measurement tool behind it is `bun run tools/scan_mods.ts [ModsFolder]` (L0):
per bundle, the route each module was found by, the records handed to a library,
every `require` nothing in the selection provides (a `wf-lib/<name>` only
resolves inside the selection), the legacy `wf-lib/` -> own `lib/` shape, and
every `ctx.option` read against the declared options, split into "declared
nowhere" and "declared on another component" (`ctx.option` raises for a key the
component does not declare, so the first is a load failure).

**Record audit**: `bun run tools/audit_records.ts [ModsFolder]`, coverage of
  every record group `record.rs` names, engine invariants (mask conflicts, burst
  without its table, sprite fields holding paths), 28 stock-slot behaviour
  expectations against the decoded donors, and the editor's own output
  (import → generate → check the record the engine would end up with). Keep it
  at zero findings.
- **Native family groups** (`fires`, `arrow`, `baseball_bat`, `fire_punch`,
  `drill`, `jet_pack`, `parachute`, `utility`) are flat scalar tables: decoded
  by the parser, mapped into `recordOverrides`, emitted by the generator's
  `NATIVE_GROUPS` loop, and edited in the record page's **Family Specifics**
  tab. `fires.type`/`method`/`subtype` are selectors the archetype and
  `specialSubtype` own, the mapper consumes them so they cannot leak into
  `recordExtra` and override the archetype. `clusters.bit.sprite_count` is
  floored at 1: the engine divides by it.
- Corpus: `bun run tools/scan_mods.ts [ModsFolder]`, 240 of 262 weapons read
  from the dev machine. Misses are stock-copy examples, templates, and records
  that only exist in a bundled `.wep`.
- **A whole bundle reads as a pack** (`importPack.ts`, P5 of
  `reqs/pack_export_plan.md`): `importBundlePack(bundle, weapons, files)` runs every
  weapon component through `importBundleWeapon` and assembles one `PackProject`.
  Three rules: a bundle whose weapons already live under its own id is kept
  verbatim (so a pack the editor wrote re-imports as itself), any other bundle is
  namespaced under a **copy of its own id** (`copyNamespace`: `px.ports` becomes
  `px.ports_import`, and its `px.port` becomes `px.ports_import.port`, because the
  installed bundle already claims `px.port` and two bundles may not claim one
  weapon id), which keeps the source author's namespace instead of pushing it into
  one of ours. The component's
  `default_position` becomes the project's `slot`, so each weapon stays on the
  panel slot the author chose, and its stock `icon` becomes `panel_icon`. A folder
  collision bumps the id (`adoptWeaponId`) and `retargetWeaponArt` moves that
  weapon's declared art with it, **from the folder the single-weapon import chose**
  to the adopted id's folder: the reverse (from the wanted id) put the vortex's
  WAV and hole sheet in a folder nothing wrote. The one-weapon rule is applied
  **once**, at the end: applied per weapon it renamed the bundle to the first
  weapon's id.
- **An import says what the export will refuse** (`BundleImport.blocking`,
  `PackImport.warnings`). A carried `require` no bundle ships, a blocking Lua
  finding and an undeclared `ctx.option` all mean the emitted module raises at
  load, and `validateBundle` refuses it by weapon and rule. The single-weapon
  import puts them in its toast; a whole-bundle import (eighty-nine weapons have no
  room in a toast) keeps them in a dismissible alert above the page header. The
  per-weapon `notes` stay one line each, because an import summary is what
  arrived, not a transcript.
- **The SDK module table is one file** (`src/data/sdkModules.ts`): the modules each
  library bundle exports and the dependency that provides each, read by the carry
  (`dependencyForModule`) and the export validator (`availableRequiresForCheck`)
  alike. Two copies had drifted from the installed manifests, so the Conductor and
  the Pulsar were refused for `require("wf-lib/electric/taze_mine")`, a module
  `px.electric` does export (it does not export `hold`, which the table claimed).
  Measured on the installed `wf-lib/px` bundle: 89 records read, imported as
  `px.ports_import.*` in about a second, exported as one `ports/` bundle with 89
  components, 22 deduped sheet declarations, one profile placing all 89 on their
  own slots, `wfcheck` 0 errors and 0 warnings (11 informational `pairs()` notes
  from the carried PX code).
- **A panel shows the value the record will have, not the editor's default.**
  `recordField(project, 'path', fallback)` (`src/utils/recordField.ts`) returns
  the author's override, else what the donor (or the imported `.wep`) carries,
  else the fallback. `copy_from` supplies the donor's whole record, so a field
  nobody touched is the donor's, `fires.launch_power_pct` used to be shown as
  100 for every weapon (a grenade could not charge), which was the *fallback*
  talking, not the record. `stockDonors.json` was also stale: it predated the
  `.wep` `fires.*` decode, so no donor carried a launch power at all. Regenerate
  it whenever the parser learns a field (`bun run tools/gen_stock_donors.ts`).
- **Per-donor presets** (`src/data/stockDonors.json`): one decoded record per
  panel slot, 70 of them, from PX's default scheme
  (`python tools/px_scheme_weps.py <scheme>.pxs OUT --all` then
  `bun run tools/gen_stock_donors.ts [folder]`). `body.sprite` comes from
  `recordOverrides['missile.sprite']`, the parser's `body.sprite` is a family
  guess, the record's real id is in the override. `project.donorBaseline` is the
  donor as a `WepBaseline`, and the generator picks
  `useWepFile ? wepBaseline : donorBaseline`, so a `copy_from` weapon diffs
  against the donor and writes only its real edits (an untouched new project
  exports three lines). A bundle import sets `replaceProject`, so it starts from
  the default Grenade project instead of inheriting the open weapon's art.

**The bundle id is the namespace.** `src/utils/weaponId.ts` fixes nothing: it
answers "is this id under that bundle" (`isUnderNamespace`) and derives the
namespace a copy takes (`copyNamespace`), and both id fields edit the **whole**
id. A weapon in a bundle lives under the bundle's id (`lucia.arsenal.rocket`),
which is what keeps it off an installed mod (that bundle's id is unique, so its
namespace is taken), and `validateBundle` refuses an id outside it by name.
Renaming the bundle id renames its weapons with it (`renamespaceWeapons`), since
an old prefix would be refused for a reason the card cannot show. The one fixed
value left is `DEFAULT_ID_NAMESPACE` (`wfws`): a **default** for work with no
bundle yet (a new project, a decoded `.wep`, a weapon a module leaves unnamed),
never a rule, and one keystroke away from whatever the author wants. The weapon
card shows that namespace as a hint rather than a lock: an id outside the bundle's
gets an amber note (`nothing keeps it from colliding with an installed mod`), and
the export refuses it by name. The **bundle** id field edits the whole id, and a
rename moves the weapons that lived under the old prefix with it.

## 9. UI and design system

- Tailwind v4, no component library. The layout is Chakra-dashboard-inspired but
  deliberately stays on Tailwind; do not migrate to Chakra without a concrete
  reason.
- `src/index.css` defines the forge palette (`--color-forge-50…950`, sampled
  from the mod loader logo), `stone` neutrals, fonts (Plus Jakarta Sans,
  Chakra Petch for headings, IBM Plex Mono), global `:focus-visible`, native
  control `accent-color`, reduced-motion handling and thin scrollbars.
- **No em dashes.** The copy uses commas instead (an earlier pass rewrote every
  one in `src/`, `spec/`, `tools/` and the docs). Keep new text that way; an
  em dash also mangles easily in JSX and differs between editors.
- **Credits and disclaimer live in the page footer** (`App.tsx`, a `<details>`
  under the mod path) and in `README.md`: Worms Armageddon and the stock art the
  page shows (sprite-builder tab icons, frozen worm preview, terrain preview
  backdrop) are Team17's, the fallback flight art is hand-drawn, the tool is
  unofficial, what an export contains is stated, and what an author builds is
  their responsibility. Keep both copies in step.
- **No emerald/green theme accents.** The only green left is art (e.g. the
  grenade stem). Do not reintroduce `emerald-*`/`green-*` utility classes.
- **Three accent families carry meaning**, introduced by the redesign: `forge`
  (the brand terracotta) for primary actions, physics and blast; `amber` for
  action/payload states (Missile Action, Explodes Into, cursor teleport, timed
  dynamite, import `.wep`); `sky` for art and setup (Sprites & Trail, Firearm
  Specs, Tool & Setup, Mine Setup, Read installed mods). Workspace icons follow
  the same split. Red (`rose`/`red-*`) is reserved for warnings and destructive
  actions; Export is `forge-600`, not red.
- Light mode is the default. The toggle persists `wf_theme_v2`; `index.html`
  applies it before paint and `App.tsx` keeps `theme-color` in sync.
- Branding: `public/assets/wormforge-logo.png` (327×57 wordmark) and
  `wormforge-mark.png` (49×49, also the favicon), cropped from
  `spec/modloader_banner.png`.
- **Weapon identity is the Weapon Loadout card**, not a record section: icon,
  name/id/description, author, fire archetype, donor, slot, position and the five
  defaults live in `WeaponSettings.tsx`, rendered above the workbench on the
  record page. The record sections are chosen by the workbench tab bar, not by
  the sidebar. A weapon that declares `[[components.options]]` (an import from a
  bundle, or one an author adds) gets a **Weapon Options** drawer under those
  fields (`WeaponOptionsPanel.tsx`): one row per option with its label,
  `ctx.option("key")`, the declared default and kind, and a control by kind
  (checkbox, number with the declared range, select over `choices`). A `data =
  true` option carries a `data` chip, because it is the weapon data field of the
  same key as well as a setting. The header says what will be written:
  `N changed, written to the profile as [options."<id>"]`.
- **Tooltips are tappable** (`TooltipTap.tsx`, mounted once in `App` next to the
  toast; it was written but never mounted at one point, which left every help
  icon dead on a phone). Most explanations are `title` attributes, which a phone
  can never show: a tap on any element with a `title` opens the same text in a
  bubble. The attribute is moved to `data-tip-tap` while open so the native
  tooltip cannot double up. A tap that lands on a real control (`button`,
  `input`, `select`, `textarea`, `a`) is the control's own, so a checkbox still
  toggles. A titled element *inside* a label (the help icon beside a label's
  text) is the tip's own target, so the label's activation is cancelled: the
  pointer event only stops the focus, so the click that follows is swallowed
  once in the capture phase. A `<label>`'s own text keeps its activation, because
  a thumb aims at the words to tick a box or focus a field; on a touch screen the
  bubble opens as well (there is no hover), and with a mouse it does not (the
  native tooltip covers it, and a bubble on every click is noise). The help icons
  themselves carry `-m-1.5 p-1.5`, a 26 px target instead of the 14 px glyph.
- **A declared frame count must divide the sheet's height.** The engine slices a
  vertical strip as `height / frames` and refuses an image that leaves a
  remainder (`initgraphic` fails, so the sprite never loads). `SheetFrameWarning`
  (`src/components/SheetFrameWarning.tsx`, math in `src/utils/sheetFrames.ts`)
  says so next to the control that sets the count, and suggests both fixes: crop
  to the nearest divisible height or pick a frame count that divides. It is wired
  into the flight role card (an uploaded strip, measured from the preview URL),
  the roam strips, the pack-art upload (a declared `frames`) and the hold sheet
  (which stores `sheetWidth`/`sheetHeight` on upload, so no measuring is needed).
  Default art is stacked by `defaultArt.ts` and can never trip it.
- **A `.wep`-backed weapon's record is the file, not a table.** A bundle's claim
  that only names `wep = "weps/x.wep"` has no record groups to show, so the mod
  browser prints `record: <that path>` instead of `0 fields`.
- **A live effect gets a 50 Hz canvas, not a sketch.** `RibbonTrailPreview`,
  `ExplosionPreview` and `EmitterPreview` all play the library's own maths at
  WA's 20 ms tick against its own sheets (`beam.png`, `beam_glow.png`, the glow
  blob, the ten-frame spark), tinted through `sheetTint.ts` and composited
  additively, with the game's own pixel size available as an `1x` toggle next to
  `Fit`. A static SVG of the same numbers told an author nothing about motion,
  timing or brightness, which is what an effect is.
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

## 10. Export contract (`modExporter.ts`, `packExporter.ts`)

**There is one emitter, and a single-weapon export is a pack of one.**
`src/utils/packExporter.ts` holds the whole of it: `weaponBundlePart(project)`
(everything one weapon contributes: its Lua, its plain files, its sheet sources)
and `emitPackFiles(pack, libraries, fetchBytes)`, which returns the finished file
map keyed by path inside the ZIP. `modExporter.ts` is the thin app wrapper:
`exportModZip(project)` is `exportZip(singleWeaponPack(project))` and
`exportPackZip(pack)` is the same call with N weapons.

- **The two library bundles are arguments, not imports.** `wf-lib/wfws_sdk/` and
  `wf-lib/effects_sdk/` come in as text (`PackLibraries`), which keeps the emitter
  free of Vite's `?raw` so `tools/check_pack_roundtrip.ts` can run it. Measured
  parity: `swim_suit` and `javelin` exported before and after the extraction are
  the same 9 and 8 entries with zero byte differences.
- **A pack is one `mod.toml`, N `[[components]]`, one profile.** `generatePackToml`
  writes the bundle header, the **union** of every weapon's dependencies
  (first-seen order, once each), `mod_icon` from the pack or the first weapon that
  has one, and each weapon's own component block (`id`, `entry`, `icon`,
  `default_position`, `options`). `generatePackProfile` writes one `[weapons]`
  with every weapon and every stock slot, `ammo = -1` where asked, and
  `[options."<id>"]` for changed values only.
- **The bundle has one icon** (`PackProject.iconFile`/`iconPreview`): `mod_icon`
  names a single file, so an uploaded bundle icon is written once at
  `sprites/<bundle folder>/icon.png` and `generatePackToml` points `mod_icon` at it.
  With none, the first weapon's uploaded panel icon stands in; with neither, no
  `mod_icon` is written and the mod loader shows the name's initials. On import
  `ModBundle.modIcon` is read back into the pack (and `replaces` with it), except
  when it names one of the bundle's **weapons'** own icons: that is the fallback
  the manifest wrote, and adopting it as bundle art copied the file and changed
  the line, which broke byte-identical re-export on `wf-lib/utilities`.
- **Art is per weapon already**: every path is
  `sprites/<sanitizeModFolder(id)>/…`, so a namespaced `<packId>.<slug>` id names
  its own folder and a pack of one is the layout it always was. `dedupeSheets`
  runs **once over the whole pack** (the union of every weapon's sheets against the
  combined manifest), then the alias is applied to each weapon's Lua and once to
  `mod.toml`, so two weapons on the fallback art are one file.
- **`weps/` is the one exception** (`WeaponProject.packSlug`): one bundle has one
  `weps/`, so two weapons built from a `.wep` both called `weapon.wep` used to be
  one file and one of them loaded the other's record. The emitter sets `packSlug`
  for a pack of more than one and `wepBundlePath` writes `weps/<slug>/<file>`; a
  single weapon leaves it unset.
- **`validateBundle` runs last** and refuses with one error that names every
  offender, because one bad component fails the whole bundle at load. Structure: a
  duplicated weapon id, an id outside `wfws.` (it would collide with an installed
  bundle), an `entry` with no file, a declared `[sprites."…"]` with no file, and a
  path declared twice (a repeated table is a TOML error, and the engine then loses
  the declaration and `wa.on.draw` fails with a nil). Code: every weapon's generated
  module through `checkLua`, where **only `error` findings refuse**
  (`lockstep-rng`, `undeclared-require`, `module-wa`, `lua-ast`, `lua-nul`,
  `lua-size`), because only those files raise at load; the message names the
  weapon, the line and the rule. A warning or an advisory stays a toast: an
  author's `pairs()` is their call, and gating on it would refuse bundles that load
  and play today.
- `mod.toml`, `weapons/<mod>.lua`, `profiles/<Name>.toml` are always written.
- `wf-lib/wfws_sdk/` (`mod.toml` + `lib/wfws_sprite_builder.lua`) is always
  written beside the weapon folder: the export names that dependency.
- `wf-lib/effects_sdk/` (`mod.toml`, three `libs/*.lua` and the sheets its
  `[sprites]` table names) whenever the generated Lua requires
  `wf-lib/effects/...`, so the bundle carries the library version it was built
  against. See the paragraph after this list for what it must contain and why.
- `weps/<file>.wep` is written only when `useWepFile` is on.
- `sprites/<mod>/icon.png` when a custom icon exists.
- `sprites/<mod>/body.png` when the weapon's own sheet (`sprite`) is uploaded:
  the only art path for an air strike's munition, and the sheet an imported claim
  names as its `sprite` (`sprite = ART .. "body"`, a folder the import joins into
  one 32-frame strip). The card is shown for any weapon that carries one, not only
  for a strike, or the sheet would be invisible to its author.
- `sprites/<mod>/hold.png` whenever hold art is enabled: uploaded sheet if
  present, otherwise the default art (never a dangling path).
- `sprites/<mod>/missile.png` whenever custom flight art is enabled: uploaded
  sheet, otherwise the default art.
- `sprites/<mod>/bit_flight.png` when the WFWS bit role is set to Builder, and
  `sprites/<mod>/state_homing.png` / `state_homing_bit.png` / `state_roam.png`
  when the homing or roaming role is set to Builder (`wfwsRoleFlags`). Uploaded
  sheet if present, otherwise the default missile art. Digging writes no state
  sheet (the flight sheet is the dig animation), and roaming without an own
  sheet uses `sheep_sprites` unless the builder owns the flown art, in which
  case `missile.png` is that art.
- `sprites/<mod>/sheep_flight1.png` / `sheep_flight2.png` when both roaming
  sheets are uploaded (`sheep_sprites` needs exactly two) and the flight builder
  is off, a builder sheet owns the flying state instead. They are rotation
  strips, so `mod.toml` declares their `frames` (the sheet is sliced into that
  many direction cells).
- Any `customSprites` entries are written at their declared paths, which is how a
  carried bundle's own sheets travel (an imported `HOLE`/`STAMP`/`fx` sheet lands
  in `customSprites` at `sprites/<mod>/…`, declared with the source bundle's
  `frames`/`fps`/`play`).
- `sounds/<mod>/<file>.wav` for any `carriedLua.art.soundFiles` entry, a WAV a
  carried block plays by path that is not one of the four roles above. The
  claim's `sounds` list is written from `carriedLua.art.sounds` for the same
  reason: a declared path must exist at load, and a path that exists must be
  declared.
- `mod.toml` declares `[sprites."sprites/<mod>/missile.png"]` for custom flight
  art, the bit, homing-state and roaming-sheep sheets above, and
  `[sprites."sprites/<mod>/hold.png"]` when the hold picture has more than one
  **cell** (`frames`, `fps`, `play = "loop"`). The cell count is
  `max(hold.sheetFrames ?? hold.frames)`: the engine slices the PNG by the
  declaration (`gpu_frame`) and uses `hold.frames` only to pick an index, so PX's
  Buffalo of Lies (a 20-cell run cycle held on frame 0, `frames = 1`) has to keep
  `frames = 20` here or all 20 cells are squeezed into one.
- Profile name sanitizes `\\ / : * ? " < > |`.
- Uploaded pack art (`project.packArt`) is written as
  `sprites/<mod>/trail.png`, `bit.png`, `bit_homing.png`, `bit_trail.png` and
  `body.png` (`.gif` keeps its extension) and declared in `mod.toml` with
  `frames` (PNG only), `fps` and `play`. The path is rebuilt from the current
  weapon id on every export (`packArtPath`), so renaming cannot leave a stale
  folder. `packArtPath` returns null for `cluster_homing_sprite` on a strike
  (see `packArtSlotApplies`).
- The terrain stamp strip (`project.terrainStamp`) is written as
  `sprites/<mod>/stamp.png` and declared with `frames = 32`, the frame count is
  what makes the engine slice the 32 direction cells, and nothing animates it, so
  `fps`/`play` are not needed. `mod.toml` and the ZIP are written from the same
  `terrainStampPath()` test, so a declared path always exists.
- Uploaded WAVs (`project.customSounds`) are written as
  `sounds/<mod>/launch.wav`, `explosion.wav`, `interval.wav` and `shot.wav` whenever the role
  is enabled and has a file. The claim's `sounds` list, the `on_explode` play
  call and `fire_seq`'s `on_shot` path are the same contract: a declared path
  must exist at load.
- `mod.toml` `dependencies` merges the features' own entries (`wf.sdk` for
  holds, `wfws.sdk` for the flight builder, `effects.sdk` for effects,
  `px.fire_seq` for sequential fire, `effects.sdk` for the ribbon trail, the
  explosion burst and the emitter) with
  `project.extraDependencies` (deduped). The Bundle Code page's
  `BundleDependencies` panel edits that list; other bundles are resolved from
  `Mods/` at load.
- **One file per picture (`src/utils/sheetDedupe.ts`).** The exporter collects
  every sheet it is about to write, groups the ones whose bytes are identical
  **and** whose `mod.toml` declaration agrees, keeps the first path of each group
  and rewrites the generated Lua and `mod.toml` to it (whole quoted tokens only,
  so `state_homing.png` cannot rewrite `state_homing_bit.png`; the claim
  `sprites` list is compacted so a role does not repeat the kept path). The
  fallback art is the common case: a weapon whose hold, missile, bit, homing and
  roam art are all unuploaded used to bind six identical sheets under six ids,
  which is six atlas slots for one picture.
  **A declaration is `frames` plus, for a strip, `fps` and `play`**, and one path
  carries one of each, so two roles that want the same picture at different
  speeds are two sheets: merging them retimes one, and merging them while keeping
  both declarations leaves a repeated `[sprites."…"]` table, which is invalid
  TOML (the engine loses the declaration and `wa.on.draw` fails with "error
  converting Lua nil to table"). A **one-frame** sheet has nothing to animate, so
  it shares whatever `fps`/`play` it was declared with: that is what makes the
  fallback art one file. Different `sb.flight`/`sb.hold` params are Lua, not a
  declaration, and do not stop two roles sharing one picture.
  `bun run tools/check_sheet_dedupe.ts` guards the grouping, the rewrite and the
  one-declaration-per-file rule.
- The one exception is the editor's own `wfws.sdk`: every export also ships it at
  `wf-lib/wfws_sdk/` (`mod.toml` + `lib/wfws_sprite_builder.lua`), the folder
  library bundles live in next to `wf-lib/sdk` and `wf-lib/effects_sdk`, so a ZIP
  unpacked into `Mods/` already has it. Both files are imported from
  `spec/lua_sdk/wfws_sdk/` with Vite's `?raw`, so there is no copy to keep in
  sync.
- **`effects.sdk` ships too when the weapon requires it** (`src/data/effectsSdk.ts`,
  `usesEffectsSdk(luaCode)`): a weapon whose ribbon trail, burst, emitter or
  carried code names `wf-lib/effects/...` gets the whole library bundle at
  `wf-lib/effects_sdk/` next to the weapon folder in the same ZIP, so unpacking
  into `Mods/` satisfies the dependency with the version the file was generated
  against. That is 0.4.3: an older copy threw on a boolean `spark` override or
  dropped the reach direction, the shared colour and the ring rotation, and the
  emitter needs those. The manifest, `libs/px_effects.lua`, `libs/trail.lua` and
  `libs/custom_explosion.lua` are `?raw` from `spec/lua_sdk/effects_sdk/`; the
  sheets its `[sprites]` table declares (beam, beam glow, glow blob, cloud and
  the ten-frame spark) are the same `spec/` PNGs the previews load, fetched as
  bytes at export time, so no art is copied into `public/` and a manifest never
  names a file the ZIP lacks. The folder is the catalogue's own, so extracting
  over an installed copy updates it in place rather than leaving a second bundle
  with the same id, which the engine refuses (`bundle effects.sdk is installed
  more than once; keep one copy`). A weapon with no effects feature ships no
  library, which is what keeps a plain export small.

---

## 11. Validation recipes

Each script prints its own case list, so this section names the command and the
invariant it protects rather than repeating every case. Run one to see its detail.

Run these before saying a change is done:

```powershell
bun run lint   # src/ must have 0 errors
bun run build
```

Test pack for engine behaviour (dev only, output is git-ignored):

```powershell
bun run tools/gen_test_pack.ts   # -> test_pack/wftest_pack/ + test_pack/README.md
```

The pack ships the editor's own `wf-lib/wfws_sdk/` (copied from `spec/`, like an
export does), so its weapons run against the version they were generated for
instead of an older installed copy of the library.

It writes one bundle with 60 components, one profile ("WF Test Pack") and art
derived from `spec/` sheets, one per role (the sprite builder, cluster bits, the
homing window, the homing bit, the roaming animal, native trails, the emitter,
the aim layer, the swing, the melee strike, the aim clamp on a swing and on a
firearm). **Each entry's intent, expected result and failure
symptom live in `test_pack/README.md`**: read it instead of guessing what a number
is for, and keep it in step when a test changes. The profile places every weapon
on a distinct stock slot with infinite ammo.

Stock record values (PX's default scheme, from `WormForgeNew`):

```powershell
python tools/px_scheme_weps.py "I:/Games/WA 3.6.31.0 + Project X by 0rang3/PXSchemes/default.pxs" OUT --all
```

Each slot's `.wep` is the record that slot plays with; the action slab is at
+0xA8..+0xD0 (`crates/weapons/src/record.rs`).

`copy_from` diff check (no server, exits 1 on a failure):

```powershell
bun run tools/check_copyfrom.ts
```

It builds donor-based projects and asserts that an untouched donor emits no
record tables, that a Mortar with its clustlets off and a 100% push writes
`burst = "nothing"` + `push_pct = 100` (with a correct *and* a stale baseline),
that re-basing a donor keeps the author's edits while adopting the new
donor's record, and that a builder round on a thrown or placed donor writes
`hold_as` (none on a bazooka, none under hold art).

Sheet dedupe check (no server, exits 1 on a failure):

```powershell
bun run tools/check_sheet_dedupe.ts
```

It asserts the grouping (identical bytes and the same frame count share a file, a
differently sliced strip does not), that aliases rewrite whole quoted paths only,
and that one declaration survives per file.

Pack emitter and round trip (no server, exits 1 on a failure):

```powershell
bun run tools/check_pack_roundtrip.ts
```

78 cases on `src/utils/packExporter.ts`, `src/utils/pack.ts`, `importPack.ts` and
the pack generators: a pack of one is manifest-for-manifest and
profile-for-profile the single-weapon output; a three-weapon pack writes three
components with their own entries, the unioned dependency list once each, one
profile placing all three, and the changed option under that weapon's id; the
emitted map reads back through `readBundles`/`readWeapons` with every declared
path present and both weapons recoverable, and two `.wep` weapons write two records
each named by its own Lua. A foreign bundle is namespaced under a copy of its own
id (`px.ports` becomes `px.ports_import`, `px.port` becomes `px.ports_import.port`)
while an editor-written bundle keeps the ids it declares, and a slug already used
bumps. `validateBundle` is pinned both ways: a duplicated weapon id, an id outside
the namespace, a declared path with no file, a sheet declared twice, and generated
code that raises at load (`math.random` in a hook) are refused **by name and rule**.
The pack's own rules are pinned too: the id bump stays inside the folder segment, a
duplicate moves every path it declares into its own folder, one weapon gives the
bundle its identity while two keep it, a bundle never drops below one weapon, a
shared stock slot is listed once, and `mod_icon` is written once (a bundle with
none writes no line).

Pack fixture (no server, exits 1 on a failure; the test pack is generated first):

```powershell
bun run tools/gen_test_pack.ts
bun run tools/check_pack_fixture.ts
```

26 cases that take **art and code off disk** and assert the strongest property
available: import, export, re-import, export writes **the same bytes**, file by
file, digest against digest. The fixture is the 60 test-pack components (80 files,
one instance of every shape the editor emits) plus five installed bundles:
`wf-lib/utilities` round-trips, `px_pyroman_grenades` and
`wf-lib/marked_for_death` need a module only their own bundle ships, and
`wf-lib/px_fire_seq` / `wf-lib/mole_shopper` need the browser canvas for fallback
art. Each round trip also runs `wfcheck`: **nothing** for the test pack, **no
errors** for a foreign bundle (another author may carry warnings of its own, and
only an error takes a bundle down at load). Carried-block counts are compared
before and after, so the carry is stable and not merely present. A skip is always
named, never silent: Bun has no `document`, so a bundle whose fallback art must be
painted is reported; and a bundle whose carried code requires a module only the
source ships is skipped **with the module named**, because refusing is the correct
answer and the import warning tells the author which bundle to add. This net caught
the three importer defects described in §8a (one root cause: the claim `sprites`
list classified by file name while sheet dedupe can point one role's sheet at
another weapon's file).

Every installed bundle, round trip (no server, exits 1 on a failure):

```powershell
bun run tools/audit_bundles.ts [ModsFolder]
```

36 bundles and 169 weapons read, exported, read back and exported again, compared
by digest. Last run: **33 byte-identical, 1 stable once its donor is named, 2 that
need a library, 0 failed**. The donor case is `example.tools`, whose module builds
its claims at load and names no `copy_from`, so the tool asserts the **second**
export equals a third; the library cases are `px_pyroman_grenades`
(`lib/pyro_flight`) and `px.laser_reflect` (`lib/laser`). This is the net that
caught the four defects in §8a's import bullets and the empty groups in §7.

Hook registry and module splitting (no server, exits 1 on a failure):

```powershell
bun run tools/check_lua_hooks.ts
```

68 cases on `splitModule.ts`, `ownOutput.ts` and `luaHooks.ts`: the editor's own
module shape (preamble requires, install statements, a multi-line claim), the
Conductor's filtered `wa.on.worm_message`, PX's `function M.install` form, and
bodies built to look like closers (a comment saying `end`, a string saying `"end"`,
a nested function, a `local x = function() … end`), plus the three own-output
signatures and a hand-written near miss. On the four real bundles when D: is
mounted (skipped otherwise) it pins their registration and hook counts and which
registrations are ours; on every generated test-pack weapon it asserts each splits
with no notes, every event is one the engine binds, and **every registration is
recognised**, because the editor must never write a handler it cannot identify.

Carried Lua (M2, M3, M5 and M6, no server, exits 1 on a failure):

```powershell
bun run tools/check_carried_lua.ts
```

92 cases on `carryClosure.ts` and the carried-hook emission: the transitivity and
source order of a hook's closure (the helper it calls, the helper that helper
calls, the module constant, the table it appends to), the lockstep rewrites
(`math.random` to `wa.random`, trig to `wa.math.*`, the float form reported rather
than rewritten), a hook calling a name nothing declares, a block with an unclosed
`if` refused, a bundle module renamed around the export's own `fx` (a string saying
`fx` is left alone), one `require` carried once, the art paths moved to the export
folder, and the dependency a carried `require` needs. Five cases cover the **scope
walk**: a registration inside `function weapon.setup()` carries the helper it calls,
the state beside it in the same `do … end`, the constant beside that, and what the
helper closes over one block up; one `local shared = require("lib/shared")` written
in both `weapon.definition` and `weapon.setup` is carried once; two *different*
locals of one name are one carried and one reported. On the real bundles it asserts
the exported file has no dangling name, one `on_explode` key, each registration
written once, and that export then re-import returns the carried code identical;
on the 60 generated weapons it carries exactly what it started with and nothing of
ours. Run it for the case list.

Carried-code rules (no server, exits 1 on a failure):

```powershell
bun run tools/check_lua_rules.ts
```

`src/utils/luaCheck.ts` reads Lua the way `wfcheck` does, without running it. The
rule ids **and their severities** are the compiler's (`compiler-cli/src/checks.rs`),
because the same finding must land in the same console filter in both tools:
`lockstep-rng` is an **error** for `math.random`/`math.randomseed` (the sandbox
nils them) and a **warning** for `math.cos/sin/atan` (they run, but can differ per
machine); `lockstep-pairs` is **info** on the bare `pairs()` call only (`next` is
not a finding); `undefined-global` is a **warning**, **info** when an `or` fallback
already covers the nil. Four ids are this editor's own because they are about how a
*bundle* loads rather than about Lua: `module-wa` (a `wa` read outside every
function body, lesson 21), `undeclared-require`, `lua-nul` and `lua-size`.

The render band mutes only trig: roots are the function **literals** handed to
`wa.on.draw`/`wa.on.hud`, a local helper they call by name is render context
transitively, `pairs` still decides what is drawn, and `math.random` raises
anywhere. `luaGlobals.ts` is the one ambient list (`arg` in, `bit32`/`unpack` out),
plus the names the generator puts in scope (`sb`, `ctx`, `zap`, `seq_dir`,
`stamp_*`, the `AIM_*` bounds); an implicit `self`, a `goto` label and
`local x <const>` count as declarations. The engine-API rules
(`wa-namespace-typo`, `worm-api`, `spec-key-typo`, `handle-union`) need the engine
dump and a real AST, so they stay `wfcheck`'s job: this checker says nothing rather
than guessing.

It runs on the custom Lua box (one Fix per mechanical rewrite), on the generated
file in Bundle & Export (a complete file, so `undefined-global` is exact there) and
on an imported module (whose errors are blocking). A finding inside code the editor
did not generate is tagged `notGenerated`: the generator wraps a custom `on_explode`
body in `NOT_GENERATED_OPEN`/`CLOSE` (`src/utils/luaText.ts`), because an undefined
global there is a certain load failure rather than the maybe an author snippet can
be. `LuaFindings` shows the tag as a `custom` chip, and `customExplodeBody` drops
the markers on re-import so they never nest. The shared text helpers
(`maskLuaCode`, `scanBlockEnd`, `notGeneratedLineRanges`) are why a comment saying
`end` cannot cut a body short; `scanBlockEnd` consumes a `for`/`while` header's `do`
so a nested bare `do` cannot close the loop early.

The SDK and layer harnesses need `python -m pip install lupa`, so they are not part
of the repo's checks; each exits 1 on a failure, and each has a mutation that makes
it fail, which is why it exists:

```powershell
python tools/lua/harness_melee.py            # the swing and the strike box
python tools/lua/harness_flight.py           # missile_frame, both phases
python tools/lua/harness_effects.py          # px_effects + trail, frame by frame
python tools/lua/harness_emitter_weapon.py   # generated wftest.56 through the SDK
python tools/lua/harness_trail_bits.py       # generated wftest.51, ordered handlers
```

`harness_effects` drives the emitter's ring (anchor follow, a tracking ring turning
its bend to the owner's heading and ignoring the spin, `spark = true` accepted
rather than indexed, rainbow tied to the simulation clock), the emitter dying with
its round, and the trail's noise bending the ribbon off the chord.
`harness_emitter_weapon` asserts the generated claim carries **no `on_fire`** and
that nothing is left on the map afterwards: reverting the `merge` guard fails it
with the exact in-game error, and writing the hand-off back into `on_fire` fails
the no-`on_fire` case. `harness_trail_bits` dispatches `missile_frame` in
registration order, the way the engine does, and asserts the round stays bare, that
a burst listed on the round's last frame attaches nothing yet, and that the five
bits get their ribbons: deleting the generator's wait line fails it on the bits.
`harness_flight` covers the per-missile sweep (a walking animal WA draws is
re-classified once a second, a round with a follower never), the
`bits = "inherit"` identity, and the timed classifier (`bit_window`/`bit_radius`).
`harness_melee` walks the swing frame by frame (aim draw, Space take, clip with the
worm in a plain standing state, the hit, the release) and pins the box geometry WF
59/60 exercise in game: the `along`/`across` culls, a rising cut (a **negative**
clip angle, since the drawn angle is clockwise on screen and world y is down)
reaching overhead only with `follow_swing`, and a handle freshly made per
`wa.worms.all()` call because `worm.id` is the only stable comparison.

WFWS bundle import check (no server, exits 1 on a failure):

```powershell
bun run tools/gen_test_pack.ts
bun run tools/check_mod_import.ts
```

It imports every test weapon and asserts each feature comes back with its files and
its values: held art and scale, the `sb.flight` roles with `size`/`angle`/`offset`,
trail and target, both explosion modes with every burst field and the preset,
`fire_seq`, custom WAVs, pack sheets, roaming strips, the stamp (mode, angle,
`soften`/`blend`/`true_colour`, impact with the record's blast zeroed), the
electric bursts' `damageType` with their `zap` require and dependency, the clip
with its echoes, the second hand with its own sheet, and the melee strike with its
`hit` callback. It then regenerates each weapon and checks the original calls
survived: **a feature with no inverse in `importFeatures.ts` fails here**, which is
the point. One in-memory case pins the hold's **cell** count: a claim holding
`frames = 1` over a sheet the manifest declares as 20 comes back as `frames = 1`
plus `sheetFrames = 20`, and the export declares `frames = 20` for the picture.

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
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\myre`, 766 real `.wep` files
- `...\myre\pxl_extracted\cweps\weapons`, strike examples

UI smoke test (Playwright is installed in a scratch folder):

```js
const { chromium } = require('playwright-core');
// executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// scratch scripts: C:\\Users\\lucia\\AppData\\Local\\Temp\\wf_pw
```

There are several `input[type=file]` elements now (icon upload, the import modal,
one per pack-art slot, the hold and firing sheets), so select them by their own
control or panel, or use the file-chooser flow:

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
4. **`hold.sheet` is mandatory**, and every declared path must exist. A hold block
   without a real file fails at load, and `mod.toml` may not name a file the ZIP
   does not carry (walk `wfwsRoleFlags` too, not only the legacy `states`).
5. **`anim_speed` is a multiplier, not FPS** (`fps / (1.5 * frames)`), and
   `animate` is not an engine key.
6. **PX `anim` is not native `animation`.** Different tables, different meanings.
7. **A record sprite field takes a stock name or an id, never free text** (the
   engine treats anything else as a bundle path and fails the install). The field
   shows the resolved `name (#id)`; the trail presets write real ids
   (`smklt25`/`firehit`/`smkdrk20`, not `smoke`).
8. **Zero is a value.** Use `??` when reading and writing record numbers, never
   `||` in a controlled numeric input.
9. **Diff against a baseline, and only the donor's own baseline** (§7). An
   untouched import emits nothing; a rough diff against the wrong donor skips
   real edits.
10. **`base: './'` means no absolute asset URLs.** Resolve through `assetUrl()`.
11. **The old copies are stale.** Only edit this repository.
12. **The retired `ProjectileSimulation.tsx` can lock the renderer.** Leave it
    unused.
13. **One handler, one `onChange`.** A second call spreads the same `project` and
    undoes the first (this made the native trail checkbox look dead). Use
    `updateOverrides(patch)` for multi-key edits.
14. **A claim `on_explode` needs a weapon-table slot.** An air strike's bombs are
    built from the strike's own record copy, so the hook never fires for them.
15. **Bits are timed, not read from `m.sprite`.** A cluster bit is built by the
    round's burst, at the round's position, in the frames right after it stops
    being seen; `m.sprite` is WA's render slot (the main can carry `clustlet`)
    and the pellet flag is not exposed. A bit still needs a nonzero stock sprite
    (`clustlet`, `sprite_count = 1`) so WA constructs it. Behaviour
    state ids must be distinct, real and positive (245+), and never a negative id.
16. **`copy_from` diffs must use that donor's baseline** (§7, check 9).
17. **Feature import inverts the generator, not the engine.** Lua expressions
    (`vx = function … end`, `x = ev.worm.x - 3`) are recovered from
    `readCallTable`'s literal text, files come from the bundle through
    `bytesOf`, and an unrecognised callback is reported (`unmodelledClaimKeys`)
    instead of guessed. A new generator feature needs its inverse and a case in
    `tools/check_mod_import.ts`, or a re-export drops it silently.
18. **Engine quirk: `draw_hand = false` still draws the hand** until the engine is
    fixed, hence the `hand_radius = 0.01` fallback (§7).
19. **A stamp call is deleted only when it is ours.** `customExplodeBody` strips
    the generated `wa.land.stamp{ … }` block only after `readCallTable` matched
    its shape; a hand-written stamp is the author's Lua.
20. **`stampAngleForFrame` returns degrees, not a frame.** Frame 8 (90°) once
    re-exported as frame 1 because the value was converted twice.
21. **A module that reads `wa` while it loads cannot be required at module
    level.** A component file only returns its data: declare `local zap` at module
    level where a function needs it as an upvalue, assign it inside `install`.
    Check a new module with `grep -n '^wa\.' <module>.lua` first.
22. **Use `bun run` (not `npx tsx`) for the check scripts**, which import
    `src/utils/` and hit Vite's `import.meta.env`.
23. **WA's worm states are not an animation clock.** A custom animation the pack
    owns (a swing, a vehicle) has to take the worm (`worm:take`) and drive itself
    from `wa.world.frame()` (§7). Gating on an aim or firing state played one
    frame and stopped.
24. **Two worm handles never compare equal.** `wa.worms.all()` builds a new
    userdata per call and the engine defines no `__eq`, so a stored handle is
    not `==` to the next frame's. Keep the handle for the calls you have to make
    and compare `worm.id` (team * 16 + index). `st.worm == w` made the melee clip
    run, hit and release with nothing drawn (lesson 23's twin failure).
25. **`wa._mod` is the component, not the bundle.** Sheets are claimed and
    resolved per bundle (a component resolves a sibling's sheet), but `_mod` names
    the weapon whose install is running, so anything keyed by it inside a shared
    library splits a multi-weapon bundle in two. That is how `effects.sdk` 0.4.2
    lost every effect a bundle's second weapon made (the saw's aura on a placed
    saw, the death mark's thunder) without one error line: an effect that no
    callback paints is simply not drawn. When the key is a draw callback, either
    install from every component or adopt the stray ones (0.4.3 does, by longest
    id prefix, and says so).

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


## 15. Current status

Feature complete for the families it models: `.wep` decode, the record workbench,
hold art (aim and firing roles, offsets, swing clip, ghost trail, second hand),
melee strikes, the WFWS flight builder (primary, bits, timed homing, dig, roam),
ribbon trail, explosion burst, the effect emitter, terrain stamp with impact,
sequential fire, custom WAVs, pack art, the bundle reader (records, this editor's
own features, and the code it does not model with its closure and art), the
exporter and the pack bundle. `wfws.sdk` 0.16.6 and `effects.sdk` 0.4.3 ship
inside every export that needs them.

Where the work stands. The detail lives in the file named beside each line, so this
section only says what is done and what is left:

- **Pack export** (`reqs/pack_export_plan.md`, §10): P0 to P6 delivered. One
  `emitPackFiles` for one weapon or N, one `mod.toml` with N components, one
  profile, pack-wide sheet dedupe, `validateBundle` refusing by weapon and rule.
  `check_pack_fixture` and `audit_bundles` are the byte-level net (§11).
- **Bundle reader** (`reqs/wflib_weapon_import_plan.md`): L0, L1, L2, L3, L4
  (options) and L5 (art) delivered. On the installed corpus, 279 of 280 weapons
  read a complete closure and the last is refused by name; `px.ports`' 89 records
  import and re-export as one bundle with `wfcheck` clean. The one item left is the
  rest of L4: `ctx.placed`, `ctx.weapons` and `ctx.data` are reported as unmodelled
  in carried code, because they describe a match and not a weapon.
- **Carried code** (`reqs/custom_code_import_plan.md`): M0 to M7 shipped. A bundle
  round-trips with its hooks, registrations, closure and art intact and no block
  doubled, and the Carried Lua panel can switch a block off.
- **Melee and the swing**: the ghost-shot change is the current edge, described in
  §7. The claim lets WA fire and end the turn, `worm:take{ fire = true }` keeps the
  press, and `retreat` plus `fuse` are one number.

Waiting on a person for:

- in-game passes over the later test weapons (WF 29 fuse, WF 31/32/36 firing art,
  WF 37-45 stamp and pierce, WF 46-50 aim layer, clip and melee, WF 53/54 aim
  clamp, WF 56 emitter, WF 59/60 melee geometry), each entry's expected result and
  failure symptom in `test_pack/README.md`;
- a review of the redesign branch on a phone, then a merge or a rebase;
- the GitHub remote and Pages (§12).

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
