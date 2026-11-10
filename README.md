# WormForge Weapon Studio

> Modern TypeScript & React Weapon Studio and Record Architect for **WormForge**.  
> Import legacy Project X `.wep` files, configure weapon records, preview PX hold art and 50 Hz missile flight sprites, and export ready-to-play mod packages.

Maintenance and hand-off notes live in [AGENTS.md](AGENTS.md).

---

## Features

- **Current WormForge bundle format**:
  - Automatically exports modern `wa.weapons.replace{ ... }` component specifications.
  - Generates complete bundle layout with `mod.toml`, `weapons/<mod_name>.lua`, and `profiles/<Profile Name>.toml`.
  - Automatically declares `dependencies = ["wf.sdk"]` when using `holds.PX_POSTURE`.
- **Project X `.wep` Binary Importer**:
  - Parses binary header `[0x06, 0xDD, 0xBB, 0x5A]`, Latin-1 name strings at `0x1E4`, and 0x1D0 bytes weapon record slabs.
  - Computes minimal diffs against stock templates (`stock.<slot>`) to prevent boilerplate noise.
  - Reads an air strike's munition body from the strike slab (`record.rs` `STRIKE_SHIFT = 0x14`): `strike.*` (plane, count, spacing, speed, sound, munition) plus the full `missile.*` body and the `clusters.*` / `clusters.bit.*` child body, exactly like a thrown missile's clustlets.
- **Hold & Sprite Builder Preview**:
  - Uses the PX posture strip (`aim.png`, 32 frames of 60×60) and hand radius textures (`hand_rad_lower.png`, `hand_rad.png`, `hand_rad_upper.png`) from `wf.sdk`.
  - Before a PNG is uploaded, the preview and the exported bundle use the stock-style `spec/default_grenade.png` or `spec/default_blue_zook.png` (chosen from the donor), so a bundle never points at a missing sprite.
  - Hold geometry is the engine's `worm_hold.rs` math verbatim: aim 0 is down, 31 is up, `weap_radius`/`weap_rotation`/`weap_radial_rotation` and the hand offsets, plus the put-away swing and shrink.
  - The `spec/pre_weapon_preview.png` landscape is the preview backdrop, with 1x–5x pixelated zoom and a true left/right facing flip.
- **50 Hz Missile Flight Sprite Preview**:
  - Reimplements `px_sprite_builder.lua`'s `sb.flight` animation at a fixed 50 Hz game frame: `track`, `rotation`, `slow`/`medium`/`fast`, `none`, `cyclical` frames, `anim_speed`, `spin`, `mirror` and `scale`.
  - No terrain or collision simulation: the old Launch Simulator tab was retired because its collision loop could lock the renderer.
- **Modern Asset Workflow**:
  - 32×32 PNG icon importer and exporter (saved to `sprites/<mod_name>/icon.png`).
  - Single-sheet PNG hold artwork with `holds.PX_POSTURE` (no legacy GIF conversions).
  - Pack art for the record sprite fields the engine accepts an image in: the primary trail (`missile.trail.sprite`), the cluster bit sheet (`cluster.sprite`), the homing bit sheet (`cluster.homing_sprite`), the cluster bit trail (`clusters.bit.trail.sprite`) and the weapon's own body sheet (`sprite`) — the last one is the only way to give an **air strike** its munition art, since the sprite builder has no primary missile to follow. Uploaded PNG/GIF files are written into `sprites/<mod_name>/` and declared in `mod.toml`.
  - Rotation sheets: bake a single projectile frame into a full 360° direction strip (16/32/64 frames, frame 0 pointing up and turning clockwise, WA's airmisl order) with the record's native animation set to follow the flight direction.
- **Desktop Application (Tauri v2)**:
  - Native Windows desktop application with system menus, file dialogs, and native performance.

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) v20+
- [Rust toolchain](https://www.rust-lang.org/) (for Tauri desktop builds)

### Web Development
```bash
# 1. Install dependencies
bun install

# 2. Run local development server
bun run dev

# 3. Build for production (web / dist)
bun run build
```

### Windows quick start
Double-click **`start-weapon-editor.bat`** in this folder. It opens a visible
console, installs dependencies if needed, starts the Express + Vite dev server
on <http://localhost:3000>, and opens your browser when the port is ready.
Keep the console window open; press `Ctrl+C` to stop it.

If the Express server cannot start, use **`start-weapon-editor-vite-only.bat`**
instead. It serves the UI alone on <http://localhost:5175>.

---

## Desktop App (Tauri v2)

The application is fully configured for **Tauri v2** desktop builds:

```bash
# Run desktop app in development mode
bun run tauri dev

# Build standalone Windows installer / executable (.msi / .exe)
bun run tauri build
```

The desktop binary will be output to `src-tauri/target/release/`.

---

## GitHub Deployment

### GitHub Pages
The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the app and publishes `dist/` to GitHub Pages on every push to `main` (and from **Actions** > **Deploy Weapon Studio to GitHub Pages** > **Run workflow**).

1. Push this repository to GitHub.
2. Go to **Settings** > **Pages** and set **Source** to **GitHub Actions**. This must be done once by hand: the workflow does not create the Pages site for you.
3. If the repository is private, GitHub Pages requires a paid plan (Pro/Team/Enterprise); otherwise make the repository public.
4. Push to `main` again, or re-run the workflow from the **Actions** tab.

The site is served at `https://<user>.github.io/<repo>/`.

`vite.config.ts` uses `base: './'`, so the build works from any repository subpath, and `assetUrl()` resolves the logo and default sprites the same way in the dev server, Pages and the Tauri webview.

### Tauri Desktop Builds
The `src-tauri/` project is included, so desktop installers can be built locally with `bun run tauri build`. There is no desktop release workflow in this repository yet.

---

## Hotkeys

| Key | Action |
|---|---|
| `1` | Switch to **Weapon Record** |
| `2` | Switch to **Hold & Sprite Builder** |
| `3` | Switch to **Bundle Code Preview** |

---

## Mod Layout Output
When clicking **Export Mod (.zip)**, the archive contains:
```text
<mod_name>/
  mod.toml
  weapons/<mod_name>.lua
  profiles/<Weapon Name>.toml
  weps/<file>.wep (only when "Use .wep weapon file" is enabled)
  sprites/<mod_name>/
    icon.png (if custom)
    hold.png (when hold art is enabled; the default Grenade/Bazooka art is written until you upload a sheet)
    missile.png (when custom flight art is enabled; the default Grenade/Bazooka art is written until you upload a sheet)
    trail.png / bit.png / bit_homing.png / bit_trail.png / body.png (only for the pack-art slots you uploaded)
```
Drop the extracted folder into `WormForge/Mods/` next to `wf-lib/` and launch Worms Armageddon!
