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
import { mapRecord } from './mapRecord';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../../data/defaults';
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

/**
 * Which fire family a record's own tables describe. `missile` is checked before
 * `strike`: PX's records often keep a `strike` group beside the missile body
 * (the same weapon fired from a plane), and the missile is the weapon itself.
 */
function fireTypeOf(record: LuaTable | undefined): WeaponProject['fireType'] {
  if (!record) return 'power';
  if (record.gun) return 'hitscan';
  if (record.mine) return 'drop';
  if (record.missile) return 'power';
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
  /** The decoded `.wep` before the module's edits, so the export writes only them. */
  let baseline: WeaponProject['wepBaseline'];

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
      // Snapshot the decoded record: the module's tables are edits on top, and
      // the generator diffs against this so only those edits are written.
      baseline = {
        body: { ...(project.body as WeaponProject['body']) },
        action: project.action as WeaponProject['action'],
        burst: project.burst as WeaponProject['burst'],
        recordOverrides: { ...(project.recordOverrides ?? {}) },
        missileSprite: { ...(project.missileSprite as WeaponProject['missileSprite']) },
        roamConfig: { ...(project.roamConfig as WeaponProject['roamConfig']) },
        digConfig: { ...(project.digConfig as WeaponProject['digConfig']) },
        fireConfig: { ...(project.fireConfig as WeaponProject['fireConfig']) },
        specialSubtype: project.specialSubtype ?? 1,
      };
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

  // The module's tables become the typed fields, so the panels show the real
  // weapon. Whatever the mapper does not model stays in `recordExtra` and is
  // still emitted verbatim.
  const mapped = mapRecord(weapon.record, {
    // A `.wep` supplies the base record; without one the editor's defaults do,
    // so a record that declares only some fields still exports complete values.
    body: (project.body ?? { ...DEFAULT_BODY, clustlet: { ...DEFAULT_BODY.clustlet } }) as WeaponProject['body'],
    action: (project.action ?? 'none') as WeaponProject['action'],
    burst: (project.burst ?? 'nothing') as WeaponProject['burst'],
    roamConfig: (project.roamConfig ?? { ...DEFAULT_ROAM }) as WeaponProject['roamConfig'],
    digConfig: (project.digConfig ?? { ...DEFAULT_DIG }) as WeaponProject['digConfig'],
    fireConfig: (project.fireConfig ?? { ...DEFAULT_FIRE }) as WeaponProject['fireConfig'],
    recordOverrides: { ...(project.recordOverrides ?? {}) },
  });
  if (weapon.record) {
    const mappedKeys = Object.keys(mapped.recordOverrides).length;
    notes.push(`${mappedKeys} record fields mapped`);
  }

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
      body: mapped.body,
      action: mapped.action,
      burst: mapped.burst,
      roamConfig: mapped.roamConfig,
      digConfig: mapped.digConfig,
      fireConfig: mapped.fireConfig,
      recordOverrides: mapped.recordOverrides,
      recordExtra: mapped.recordExtra,
      // A trail sheet the record points at inside its own bundle: the engine
      // loads it and writes its id into the record field, so it is claim art.
      packArt: {
        ...(project.packArt ?? {}),
        ...Object.fromEntries(
          Object.entries(mapped.packArt).map(([slot, path]) => [
            slot,
            { fileName: path.split('/').pop(), frames: 1, fps: 15, play: 'loop' },
          ]),
        ),
      },
      teleport: mapped.teleport ?? project.teleport,
      // The decoded `.wep` is the diff base; without one the donor is.
      wepBaseline: baseline,
      // A bundle import never carries the module's Lua code: its callbacks
      // reference that bundle's own libraries.
      enableCustomLua: false,
      customLuaSnippet: '',
    },
    notes,
  };
}
