import JSZip from 'jszip';
import { WeaponProject } from '../types/weapon';
import { WFWS_SDK_MOD_TOML, WFWS_SPRITE_BUILDER_LUA } from '../data/wfwsSdk';
import {
  generateLuaCode,
  generateModToml,
  generateProfileToml,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  customSoundPath,
  missileFlightSheetPath,
  packArtPath,
  PACK_ART_SLOTS,
  sanitizeModFolder,
  wepBundlePath,
} from './luaGenerator';
import {
  bitBuilderMode,
  primaryBuilderOn,
  resolveBehaviorStates,
} from '../data/spriteBuilder';
import {
  createDefaultHoldSheet,
  createDefaultMissileSheet,
} from './defaultArt';

export async function exportModZip(project: WeaponProject): Promise<Blob> {
  const zip = new JSZip();
  const modFolder = sanitizeModFolder(project.id);
  const profileName = (project.name || modFolder).replace(/[\\/:*?"<>|]/g, '_');

  const luaCode = generateLuaCode(project);
  const modToml = generateModToml(project);
  const profileToml = generateProfileToml(project);

  // The layout from the mod tutorial: mod.toml and profiles/ have fixed names,
  // and mod.toml's `entry` (weapons/<folder>.lua, see generateModToml) says where
  // the weapon's Lua is. Nothing else reads weapon/, profile/ or a root
  // weapons.lua, so none of those copies are written.
  zip.file(`${modFolder}/mod.toml`, modToml);
  zip.file(`${modFolder}/weapons/${modFolder}.lua`, luaCode);
  zip.file(`${modFolder}/profiles/${profileName}.toml`, profileToml);

  // The original Project X record, when the weapon is declared with `wep`
  // instead of `copy_from`. The engine reads it relative to the bundle root.
  const wepPath = wepBundlePath(project);
  if (wepPath && project.wepFile) {
    zip.file(`${modFolder}/${wepPath}`, project.wepFile);
  }

  // Custom Icon
  if (project.customIconFile) {
    zip.file(`${modFolder}/sprites/${modFolder}/icon.png`, project.customIconFile);
  }

  // Hold Art Sheet. The generated Lua always declares hold.sheet, so an
  // enabled hold without an upload ships the default Bazooka/Grenade art
  // instead of a path to a missing file (which fails at load).
  if (project.hold && project.hold.enabled) {
    const holdBlob = project.hold.sheetFile
      ? project.hold.sheetFile
      : await createDefaultHoldSheet(project, project.hold.frames);
    zip.file(`${modFolder}/sprites/${modFolder}/hold.png`, holdBlob);
  }

  // Missile/Projectile Sprite Sheet (custom mode always declares the sheet).
  if (primaryBuilderOn(project)) {
    const missileBlob = project.missileSprite.sheetFile
      ? project.missileSprite.sheetFile
      : await createDefaultMissileSheet(
          project,
          project.missileSprite.anim || 'rotation',
          project.missileSprite.frames
        );
    zip.file(
      `${modFolder}/${missileFlightSheetPath(project)}`,
      missileBlob
    );
  }

  // WFWS builder roles. A builder row without an upload ships the same default
  // art as the primary, so a declared path never points at a missing file.
  if (primaryBuilderOn(project)) {
    if (bitBuilderMode(project) === 'builder') {
      const bitBlob = project.bitFlight.sheetFile
        ? project.bitFlight.sheetFile
        : await createDefaultMissileSheet(
            project,
            project.bitFlight.anim || 'rotation',
            project.bitFlight.frames
          );
      zip.file(`${modFolder}/${bitFlightSheetPath(project)}`, bitBlob);
    }
    for (const state of resolveBehaviorStates(project)) {
      if (state.art.mode !== 'builder') continue;
      const stateBlob = state.art.sheetFile
        ? state.art.sheetFile
        : await createDefaultMissileSheet(
            project,
            state.art.anim || 'rotation',
            state.art.frames
          );
      zip.file(
        `${modFolder}/${behaviorStateSheetPath(project, state.def.key)}`,
        stateBlob
      );
    }
  }

  // Uploaded record art (trails, cluster bit sheets). The Lua and mod.toml
  // point at this exact path, so the file is always written when it is declared.
  for (const slot of PACK_ART_SLOTS) {
    const asset = project.packArt?.[slot];
    const path = packArtPath(project, slot);
    if (asset?.file && path) {
      zip.file(`${modFolder}/${path}`, asset.file);
    }
  }

  // Custom WAVs the claim plays by path. The Lua's `sounds` list and the file
  // written here are one contract: a declared path must exist at load.
  for (const role of ['explosion', 'interval'] as const) {
    const path = customSoundPath(project, role);
    const asset = role === 'explosion' ? project.customSounds?.explosion : project.customSounds?.interval;
    if (path && asset?.file) {
      zip.file(`${modFolder}/${path}`, asset.file);
    }
  }

  // Any other custom sprite assets
  for (const cs of Object.values(project.customSprites)) {
    if (cs.file) {
      zip.file(`${modFolder}/${cs.path}`, cs.file);
    }
  }

  // Bundle the wfws.sdk library alongside every export so the weapon's
  // `dependencies = ["wfws.sdk"]` resolves locally without an online install.
  zip.file('wfws_sdk/mod.toml', WFWS_SDK_MOD_TOML);
  zip.file('wfws_sdk/lib/wfws_sprite_builder.lua', WFWS_SPRITE_BUILDER_LUA);

  return await zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
