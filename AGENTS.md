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
│  │  ├─ RecordEditor.tsx      # the eight record sections
│  │  ├─ HoldPreview.tsx       # hold + flight art builders (canvas)
│  │  ├─ PackSpriteUpload.tsx  # upload for trail / cluster-bit pack art
│  │  ├─ WepImportModal.tsx    # .wep drop zone and decode summary
│  │  ├─ LuaPreviewModal.tsx   # generated Lua / mod.toml / profile
│  │  └─ ProjectileSimulation.tsx # RETIRED, unused; do not re-enable
│  ├─ data/
│  │  ├─ recordTabs.tsx        # section ids/labels/icons shared by nav
│  │  ├─ recordSchema.ts       # field tables used by the editor
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

- `activeTab: 'editor' | 'hold' | 'code'` (hotkeys `1` / `2` / `3`, ignored
  while typing in an input/textarea/select);
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
dependencies = ["wf.sdk"]   # only when holds / sb.flight are used

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
- Clustlets carry `clusters.bit.action` (`impact`/`bounce`/`homing`/`roam`/
  `dig`). The groups share native slots, so decode/emit only the active group.
- `dependencies = ["wf.sdk"]` is added when hold art or the PX flight builder is
  used; `effects.sdk` is added for the ribbon trail (it exports
  `wf-lib/effects/trail` and its beam/glow sheets).
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

The flight preview runs at a fixed 50 Hz, uses `ANIM_TYPE` tables from
`px_sprite_builder.lua`, mirrors when `vx < 0`, and draws the sprite at the
weapon pivot. The retired `ProjectileSimulation.tsx` had a terrain/collision
loop that could lock the renderer; leave it unused.

**Default art:** when no PNG is uploaded, `defaultArtFor(project)` picks
`spec/default_grenade.png` or `spec/default_blue_zook.png` from the donor/slot
(barrel donors and `fireType === 'hitscan'` get the bazooka, everything else the
grenade). The files are copied to `public/assets/defaults/`; the preview loads
them and `modExporter` writes the same pixels as `hold.png`/`missile.png`
(stacked for `frames`). `placeholderSprites.ts` is only a fallback if the fetch
fails. `hold.sheet` is **required** by `lua-host/src/api.rs`, so a bundle must
never declare it without writing the file.

---

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
- Any `customSprites` entries are written at their declared paths.
- `mod.toml` declares `[sprites."sprites/<mod>/missile.png"]` for custom flight
  art and `[sprites."sprites/<mod>/hold.png"]` when the hold sheet has more than
  one frame (`frames`, `fps`, `play = "loop"`).
- Profile name sanitizes `\\ / : * ? " < > |`.
- Uploaded pack art (`project.packArt`) is written as
  `sprites/<mod>/trail.png`, `bit.png`, `bit_homing.png`, `bit_trail.png` and
  `body.png` (`.gif` keeps its extension) and declared in `mod.toml` with
  `frames` (PNG only), `fps` and `play`. The path is rebuilt from the current
  weapon id on every export (`packArtPath`), so renaming cannot leave a stale
  folder. `packArtPath` returns null for `cluster_homing_sprite` on a strike
  (see `packArtSlotApplies`).

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

It writes one bundle with 20 components, one profile ("WF Test Pack") and all
art derived from `spec/default_grenade.png` (single frame for the sprite builder,
32/16-frame rotation strips for bits, a 4-frame strip for native trails). Each
test carries its intent, expected result and failure symptom in
`test_pack/README.md`; the profile places them on 20 distinct stock slots with
infinite ammo.

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
9. **Zero is a value.** Use `??` when reading/writing record numbers.
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
- GitHub Pages workflow, `.gitignore`, Pages-subpath smoke test.

Likely next steps:

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
