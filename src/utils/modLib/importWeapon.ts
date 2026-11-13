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
import { readBundleFeatures, unmodelledClaimKeys } from './importFeatures';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../../data/defaults';
import { stockDonor, stockDonorBaseline } from '../../data/stockDonors';
import type { LuaTable } from './luaTable';
import type { ModFile, ModWeapon } from './scan';

export interface BundleImport {
  project: Partial<WeaponProject>;
  /** What the import did, for the toast and the panel. */
  notes: string[];
  /**
   * Replace the whole project instead of merging into the open one: an import
   * starts a new weapon, so the previous one's art, effects and builder
   * settings must not leak into it.
   */
  replaceProject: boolean;
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

export async function importBundleWeapon(
  weapon: ModWeapon,
  files: ModFile[],
): Promise<BundleImport> {
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

  let donorBaseline: WeaponProject['donorBaseline'];
  if (!project.useWepFile) {
    // `copy_from` asks the engine for the donor's own record, so the donor's
    // decoded values are the starting point *and* the diff baseline. A record
    // that declares a handful of fields therefore exports those fields only.
    const donorRecord = stockDonor(donor) ?? {};
    donorBaseline = stockDonorBaseline(donor);
    project = {
      ...donorRecord,
      slot: donor,
      based_on: donor,
      fireType: fireTypeOf(weapon.record) ?? donorRecord.fireType,
      useWepFile: false,
      wepFile: undefined,
      wepFileName: undefined,
      wepBaseline: undefined,
      donorBaseline,
    };
    notes.push(
      donorRecord.body
        ? `base record: stock.${donor}`
        : `base record: stock.${donor} (no decoded donor, editor defaults)`,
    );
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

  // Features live outside the record: the held art table, the `sb.flight`
  // roles, the ribbon trail, the explosion burst and hooks, the `fire_seq`
  // burst, custom WAVs and the claim's own sheets. The reader attaches the
  // bundle's files, so a re-export writes the same art and samples.
  const moduleText = files.find((file) => file.path === weapon.modulePath)?.text ?? '';
  const bitAction =
    mapped.body.clustlet.bit_action ??
    (mapped.body.clustlet.homing !== 'off'
      ? 'homing'
      : mapped.body.clustlet.contact === 'bounce'
        ? 'bounce'
        : 'none');
  const features = await readBundleFeatures({
    weapon,
    files,
    moduleText,
    mappedPackArt: mapped.packArt,
    digging:
      mapped.action === 'dig' || (mapped.burst === 'clusters' && bitAction === 'dig'),
  });
  notes.push(...features.notes);
  const unmodelled = unmodelledClaimKeys(weapon.source);
  if (unmodelled.length > 0) {
    notes.push(`not carried: ${unmodelled.join(', ')}`);
  }

  return {
    replaceProject: true,
    project: {
      ...project,
      ...features.project,
      id,
      name,
      description:
        weapon.description ?? `${name}, read from ${weapon.bundleName} (${weapon.bundleId}).`,
      author: weapon.author ?? 'WormForge Author',
      panel_icon: features.project.panel_icon ?? project.panel_icon ?? donor,
      // A bundle import starts a new weapon, so only the module's own defaults
      // apply; the open/project baseline must not supply crate or retreat
      // settings the bundle never declared.
      defaults: {
        ammo: 1,
        delay: 0,
        crateChance: 0,
        crateType: 'weapon',
        afterUse: '',
        ...defaultsFrom(weapon.defaults),
      },
      body: mapped.body,
      action: mapped.action,
      burst: mapped.burst,
      roamConfig: mapped.roamConfig,
      digConfig: mapped.digConfig,
      fireConfig: mapped.fireConfig,
      recordOverrides: mapped.recordOverrides,
      recordExtra: mapped.recordExtra,
      teleport: mapped.teleport ?? project.teleport,
      // The decoded `.wep` is the diff base; without one the donor is.
      wepBaseline: baseline,
      donorBaseline,
      // The module's own callbacks are not carried (`features.project` only
      // extracts the custom part of `on_explode`); anything else would need
      // that bundle's libraries to run.
      enableCustomLua: features.project.enableCustomLua ?? false,
      customLuaSnippet: features.project.customLuaSnippet ?? '',
    },
    notes,
  };
}
