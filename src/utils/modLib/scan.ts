/**
 * Reads installed bundles: `mod.toml` manifests, their weapon components, and
 * the Lua module each weapon keeps its record in.
 *
 * The input is a flat map of bundle-relative paths to text, so the same code
 * serves a folder the user picked, a ZIP, and the Tauri filesystem walk. PX's
 * ports are the reason this is defensive: one bundle can hold a hundred
 * weapons, every weapon can share one `components/weapon.lua` entry, and the
 * real module is found through `weapons/index.lua` rather than the manifest.
 */

import { parseToml, type TomlDocument } from './modToml';
import { scanLua, firstTable, isTable, type LuaTable } from './luaTable';

export interface ModFile {
  /** Bundle-relative, `/`-separated (`wf-lib/px/weapons/banana_express.lua`). */
  path: string;
  /** Source text for `.lua` / `.toml`; empty for a binary entry. */
  text: string;
  /** Raw bytes, for a bundled `.wep` the module points at. */
  bytes?: Uint8Array;
}

export interface ModComponent {
  id: string;
  name: string;
  type: string;
  entry: string;
  icon?: string;
  description?: string;
  row?: string;
  column?: number;
}

export interface ModBundle {
  /** Folder the manifest sits in, `''` for the root of what was opened. */
  dir: string;
  manifestPath: string;
  id: string;
  name: string;
  version: string;
  author?: string;
  dependencies: string[];
  components: ModComponent[];
  /** `[sprites."…"]` declarations, keyed by the bundle-relative path. */
  spriteDecls: Record<string, Record<string, unknown>>;
  /** Files in this bundle, relative to `dir`. */
  files: string[];
}

export interface ModWeapon {
  bundleId: string;
  bundleName: string;
  /** The bundle's `author`, used as the imported project's credit. */
  author?: string;
  componentId: string;
  name: string;
  description?: string;
  icon?: string;
  /** Bundle-relative path of the Lua module the record was read from. */
  modulePath: string;
  /** The record tables (`missile`, `clusters`, `handling`, …). */
  record?: LuaTable;
  /**
   * The module's whole spec table, before it was filtered to the record groups:
   * claim-level keys (`sprites`, `hold`, `sounds`, callbacks) included. Used by
   * the audit to see what a bundle declares that the editor does not model.
   */
  source?: LuaTable;
  /** `defaults` (ammo, delay, crate) when the module spells a table. */
  defaults?: LuaTable;
  /** `copy_from = "stock.grenade"`, when the module names a donor. */
  copyFrom?: string;
  /** Claim-level art paths, when the module declares them. */
  sprite?: string;
  clusterSprite?: string;
  /**
   * Bundle-relative `.wep` the module names (`wep = "X.wep"`). Its record is
   * the weapon's base, and the declared Lua tables are edits on top -- the same
   * relationship the editor's own `useWepFile` mode has.
   */
  wepPath?: string;
  /** Every `.wep` filename the module mentions, when none could be matched. */
  wepNames?: string[];
  /** Why the record could not be read, when it could not. */
  error?: string;
}

const dirOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
};

const joinPath = (dir: string, rel: string): string =>
  (dir ? `${dir}/` : '') + rel.replace(/^\.?\//, '');

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** `weapons/index.lua`'s `["px.banana_express"] = "weapons/banana_express"`. */
function readWeaponIndex(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  const pattern = /\[\s*["']([^"']+)["']\s*\]\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) map[match[1]] = match[2];
  return map;
}

function componentFrom(table: Record<string, unknown>): ModComponent | null {
  const id = typeof table.id === 'string' ? table.id : '';
  if (!id) return null;
  const position = table.default_position as Record<string, unknown> | undefined;
  return {
    id,
    name: typeof table.name === 'string' ? table.name : id,
    type: typeof table.type === 'string' ? table.type : 'weapon',
    entry: typeof table.entry === 'string' ? table.entry : '',
    icon: typeof table.icon === 'string' ? table.icon : undefined,
    description: typeof table.description === 'string' ? table.description : undefined,
    row: typeof position?.row === 'string' ? position.row : undefined,
    column: typeof position?.column === 'number' ? position.column : undefined,
  };
}

/** Every `mod.toml` in the file map, as bundles. */
export function readBundles(files: ModFile[]): ModBundle[] {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const bundles: ModBundle[] = [];

  for (const file of files) {
    if (!/(^|\/)mod\.toml$/.test(file.path)) continue;
    const doc: TomlDocument = parseToml(file.text);
    const id = typeof doc.values.id === 'string' ? doc.values.id : '';
    if (!id) continue;

    const dir = dirOf(file.path);
    const prefix = dir ? `${dir}/` : '';
    const components = doc.components
      .map(componentFrom)
      .filter((component): component is ModComponent => component !== null);

    bundles.push({
      dir,
      manifestPath: file.path,
      id,
      name: typeof doc.values.name === 'string' ? doc.values.name : id,
      version: typeof doc.values.version === 'string' ? doc.values.version : '',
      author: typeof doc.values.author === 'string' ? doc.values.author : undefined,
      dependencies: Array.isArray(doc.values.dependencies)
        ? (doc.values.dependencies as string[])
        : [],
      components,
      spriteDecls: doc.spriteDecls,
      files: files
        .filter((entry) => entry.path.startsWith(prefix))
        .map((entry) => entry.path.slice(prefix.length)),
    });
    void byPath;
  }

  return bundles.sort((a, b) => a.id.localeCompare(b.id));
}

const RECORD_KEYS = ['missile', 'clusters', 'handling', 'gun', 'mine', 'strike'];
/**
 * The groups the engine reads as the native record, in spec order. The flat
 * family groups (`fires`, `arrow`, `fire_punch`, …) are record fields too, not
 * claim keys, so they are carried as well.
 */
const RECORD_GROUPS = [
  ...RECORD_KEYS,
  'fires',
  'arrow',
  'baseball_bat',
  'fire_punch',
  'drill',
  'jet_pack',
  'parachute',
  'utility',
];

/** True when a table looks like a weapon record rather than a config blob. */
function looksLikeRecord(table: LuaTable | undefined): boolean {
  if (!table) return false;
  return RECORD_KEYS.some((key) => isTable(table[key]));
}

/** The first table anywhere in the scan that has a record's shape. */
function findRecordLike(scan: ReturnType<typeof scanLua>): LuaTable | undefined {
  const candidates: LuaTable[] = [
    ...Object.values(scan.assignments),
    ...Object.values(scan.calls),
  ];
  const returned = scan.returned;
  if (returned) {
    if (looksLikeRecord(returned)) return returned;
    for (const value of Object.values(returned)) {
      if (isTable(value)) candidates.push(value);
    }
  }
  // A module that keeps the record in `weapon.definition` or a local is common
  // in PX's ports; the shape is the only reliable signal.
  return candidates.find(looksLikeRecord);
}

/** `require("lib/x")` targets, in file order. */
function requiresOf(text: string): string[] {
  const out: string[] = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) out.push(match[1]);
  return out;
}

/** The record tables a weapon module spells, whichever style it uses. */
function readRecord(text: string): {
  record?: LuaTable;
  source?: LuaTable;
  defaults?: LuaTable;
  copyFrom?: string;
  sprite?: string;
  clusterSprite?: string;
  wepNames: string[];
} {
  const scan = scanLua(text);

  // `wa.weapons.replace{ … }` is the editor's own shape and PX's `record` is
  // the same nesting, so both land in one place.
  // `wa.weapons.replace{ … }`, `wa.weapons.replace({ … })`, or
  // `wa.weapons.replace(record)` with the table built in a local first.
  const ref = scan.callRefs['wa.weapons.replace'];
  const replace =
    scan.calls['wa.weapons.replace'] ?? (ref ? firstTable(scan, ref) : undefined);
  const assigned = firstTable(scan, 'record', 'weapon.record');
  const returned = scan.returned;
  const returnedRecord = isTable(returned?.record) ? (returned!.record as LuaTable) : undefined;

  const source =
    replace ?? assigned ?? returnedRecord ?? (looksLikeRecord(returned) ? returned : undefined) ?? findRecordLike(scan);
  const defaults = isTable(returned?.defaults)
    ? (returned!.defaults as LuaTable)
    : firstTable(scan, 'defaults', 'weapon.defaults');

  // A `.wep` filename is a string literal ending in `.wep` anywhere in the
  // module; PyroMan builds the path by concatenation (`M.WEP .. o.wep`), so the
  // literal is the file name on its own and the folder is matched later.
  const wepNames = Array.from(text.matchAll(/["']([^"']+\.wep)["']/gi)).map((match) => match[1]);
  if (!source) return { defaults, wepNames };

  // Only the native record groups survive: a bundle's `wa.weapons.replace{ … }`
  // table also carries claim-level keys (`sprites`, `hold`, `params`,
  // `worm_sprites`, `sounds`, callbacks), and those name art that lives in that
  // bundle. Writing them into an exported weapon would point at files we do not
  // copy, and the install would fail.
  // The claim-level keys are read from the source first -- they are not record
  // fields but they say which donor the weapon builds on and what art it names.
  const copyFrom = typeof source.copy_from === 'string' ? source.copy_from : undefined;
  const sprite = typeof source.sprite === 'string' ? source.sprite : undefined;
  const cluster = isTable(source.cluster) ? (source.cluster as LuaTable) : undefined;
  const clusterSprite =
    cluster && typeof cluster.sprite === 'string' ? cluster.sprite : undefined;

  const record: LuaTable = {};
  for (const group of RECORD_GROUPS) {
    if (source[group] !== undefined) record[group] = source[group];
  }

  return { record, source, defaults, copyFrom, sprite, clusterSprite, wepNames };
}

/**
 * Every weapon component in the given bundles, with its record read.
 *
 * A component's `entry` is often one shared file (`components/weapon.lua`) that
 * dispatches through `weapons/index.lua`, so the module is resolved per weapon:
 * the index first, then `weapons/<id after the dot>.lua`, then the component's
 * own name. A unique entry is read directly.
 */
export function readWeapons(bundles: ModBundle[], files: ModFile[]): ModWeapon[] {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const weapons: ModWeapon[] = [];

  for (const bundle of bundles) {
    const weaponComponents = bundle.components.filter((component) => component.type === 'weapon');
    const entryCounts = new Map<string, number>();
    for (const component of weaponComponents) {
      entryCounts.set(component.entry, (entryCounts.get(component.entry) ?? 0) + 1);
    }

    // `weapons/index.lua` (or any file that maps ids to modules) for this bundle.
    let index: Record<string, string> = {};
    for (const file of bundle.files) {
      if (!/\.lua$/.test(file)) continue;
      const text = byPath.get(joinPath(bundle.dir, file));
      if (!text) continue;
      if (file.endsWith('index.lua') || /\[\s*["'][\w.-]+["']\s*\]\s*=\s*["']weapons\//.test(text)) {
        index = { ...index, ...readWeaponIndex(text) };
      }
    }

    for (const component of weaponComponents) {
      const suffix = component.id.split('.').pop() ?? component.id;
      const candidates: string[] = [];
      const indexed = index[component.id];
      if (indexed) candidates.push(indexed);
      candidates.push(`weapons/${suffix}`);
      candidates.push(`weapons/${slug(component.name)}`);
      if (component.entry && (entryCounts.get(component.entry) ?? 0) === 1) {
        candidates.unshift(component.entry.replace(/\.lua$/, ''));
      }

      let modulePath = '';
      let text = '';
      for (const candidate of candidates) {
        const path = joinPath(bundle.dir, `${candidate.replace(/\.lua$/, '')}.lua`);
        const found = byPath.get(path);
        if (found !== undefined) {
          modulePath = path;
          text = found;
          break;
        }
      }

      const base: ModWeapon = {
        bundleId: bundle.id,
        bundleName: bundle.name,
        author: bundle.author,
        componentId: component.id,
        name: component.name,
        description: component.description,
        icon: component.icon,
        modulePath,
      };

      if (!text) {
        weapons.push({ ...base, error: 'no Lua module found for this component' });
        continue;
      }

      let parsed = readRecord(text);
      let modulePathForRecord = modulePath;
      // A module can hand the record to a library (`lib/px_ninja_star.lua`).
      // Follow its local requires one level deep, which is where PX's ports put
      // the `wa.weapons.replace{ … }` call instead of the weapon file.
      if (!parsed.record) {
        const seen = new Set<string>([modulePath]);
        const queue = requiresOf(text).map((target) => ({ target, depth: 0 }));
        while (queue.length > 0 && !parsed.record) {
          const { target, depth } = queue.shift()!;
          const candidate = joinPath(bundle.dir, `${target.replace(/\.lua$/, '')}.lua`);
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          const source = byPath.get(candidate);
          if (source === undefined) continue;
          const next = readRecord(source);
          if (next.record) {
            parsed = next;
            modulePathForRecord = candidate;
            break;
          }
          if (depth < 1) {
            for (const nested of requiresOf(source)) {
              queue.push({ target: nested, depth: depth + 1 });
            }
          }
        }
      }

      // A `.wep` the module names: match it against the bundle's own files by
      // base name, because the path may be assembled by concatenation.
      const wepNames = [
        ...parsed.wepNames,
        ...(modulePathForRecord !== modulePath
          ? Array.from((byPath.get(modulePathForRecord) ?? '').matchAll(/["']([^"']+\.wep)["']/gi)).map(
              (match) => match[1],
            )
          : []),
      ];
      let wepPath = '';
      for (const name of wepNames) {
        const wanted = name.split(/[\/]/).pop()!.toLowerCase();
        const found = bundle.files.find(
          (file) => file.toLowerCase().endsWith('.wep') && file.toLowerCase().endsWith(`/${wanted}`) ||
            file.toLowerCase() === wanted,
        );
        if (found) {
          wepPath = joinPath(bundle.dir, found);
          break;
        }
      }

      weapons.push({
        ...base,
        ...parsed,
        modulePath: parsed.record ? modulePathForRecord : modulePath,
        wepPath: wepPath || undefined,
        wepNames: wepNames.length > 0 ? wepNames : undefined,
        error:
          parsed.record || wepPath
            ? undefined
            : wepNames.length > 0
              ? 'the record is in a .wep file that is not in this bundle'
              : 'no record table in the module',
      });
    }
  }

  return weapons;
}

/** `{ missile: { sprite: 51 } }` -> `{ 'missile.sprite': 51 }`, for previews. */
export function flattenRecord(table: LuaTable | undefined, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!table) return out;
  for (const [key, value] of Object.entries(table)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTable(value)) Object.assign(out, flattenRecord(value, path));
    else out[path] = value;
  }
  return out;
}
