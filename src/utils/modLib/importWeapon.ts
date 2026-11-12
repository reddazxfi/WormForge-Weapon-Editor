/**
 * Turning a bundle weapon into an editor project.
 *
 * The order is the engine's own: a bundled `.wep` is the base record (the same
 * thing the `.wep` importer decodes), and the tables the module declares are
 * edits on top of it. A module with no `.wep` starts from its `copy_from`
 * donor instead, and its declared tables are the whole record.
 *
 * The declared tables are carried as `recordExtra` and emitted verbatim, so the
 * export is faithful before the typed editor fields know about every key. Full
 * mapping into the panels is the next step; until then the panels show the
 * `.wep`/donor values and the export still writes what the bundle declared.
 */
import type { WeaponProject } from '../../types/weapon';
import { parseWepBinary } from '../wepParser';
import { withWfwsPrefix } from '../weaponId';
import type { LuaTable } from './luaTable';
import type { ModFile, ModWeapon } from './scan';

export interface BundleImport {
  project: Partial<WeaponProject>;
  /** What the import did, for the toast and the panel. */
  notes: string[];
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** `defaults = { ammo = { round_start = -1 }, delay = 0, … }` -> our fields. */
function defaultsFrom(table: LuaTable | undefined): Partial<WeaponProject['defaults']> {
  if (!table) return {};
  const out: Partial<WeaponProject['defaults']> = {};
  const ammo = table.ammo as LuaTable | undefined;
  const roundStart = num(ammo?.round_start);
  if (roundStart !== undefined) out.ammo = roundStart;
  const delay = num(table.delay);
  if (delay !== undefined) out.delay = delay;
  const crate = table.crate as LuaTable | undefined;
  const chance = num(crate?.chance_pct);
  if (chance !== undefined) out.crateChance = chance;
  const crateType = str(crate?.type);
  if (crateType === 'weapon' || crateType === 'utility' || crateType === 'super') {
    out.crateType = crateType;
  }
  const afterUse = str(table.after_use);
  if (afterUse === 'end' || afterUse === 'retreat' || afterUse === 'continue') {
    out.afterUse = afterUse;
  }
  return out;
}

/** Which fire family a record's own tables describe. */
function fireTypeOf(record: LuaTable | undefined): WeaponProject['fireType'] {
  if (!record) return 'power';
  if (record.gun) return 'hitscan';
  if (record.mine) return 'drop';
  if (record.strike) return 'cursor';
  return 'power';
}

export function importBundleWeapon(weapon: ModWeapon, files: ModFile[]): BundleImport {
  const notes: string[] = [];
  const name = weapon.name || weapon.componentId;
  const id = withWfwsPrefix(name);
  const donor = weapon.copyFrom?.replace(/^stock\./, '') ?? 'grenade';

  const wepFile = weapon.wepPath ? files.find((file) => file.path === weapon.wepPath) : undefined;
  let project: Partial<WeaponProject> = {};

  if (wepFile?.bytes) {
    const fileName = weapon.wepPath!.split('/').pop() || 'weapon.wep';
    const bytes = wepFile.bytes;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = parseWepBinary(buffer as ArrayBuffer, fileName);
    if (decoded.success) {
      project = { ...decoded.projectState };
      project.useWepFile = true;
      project.wepFileName = fileName;
      project.wepFile = new File([bytes as BlobPart], fileName, { type: 'application/octet-stream' });
      notes.push(`record from ${fileName}`);
    } else {
      notes.push(`could not decode ${fileName}: ${decoded.error ?? 'unknown error'}`);
    }
  }

  if (!project.useWepFile) {
    project = {
      ...project,
      slot: donor,
      based_on: donor,
      fireType: fireTypeOf(weapon.record),
      useWepFile: false,
      wepFile: undefined,
      wepFileName: undefined,
      wepBaseline: undefined,
    };
    notes.push(`base record: stock.${donor}`);
  }

  const record = weapon.record;
  const missile = record?.missile as LuaTable | undefined;
  const action = str(missile?.action);
  const burst = str(missile?.burst);

  return {
    project: {
      ...project,
      id,
      name,
      description:
        weapon.description ?? `${name}, read from ${weapon.bundleName} (${weapon.bundleId}).`,
      author: weapon.author ?? 'WormForge Author',
      panel_icon: project.panel_icon ?? donor,
      defaults: { ...(project.defaults ?? ({} as WeaponProject['defaults'])), ...defaultsFrom(weapon.defaults) },
      action: (action as WeaponProject['action']) ?? project.action,
      burst: (burst as WeaponProject['burst']) ?? project.burst,
      // The module's own tables, emitted over the base record.
      recordExtra: record && Object.keys(record).length > 0 ? record : undefined,
      // A bundle import never carries the module's Lua code: its callbacks
      // reference that bundle's own libraries.
      enableCustomLua: false,
      customLuaSnippet: '',
    },
    notes,
  };
}
