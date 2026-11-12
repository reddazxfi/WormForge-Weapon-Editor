/**
 * Dev-only: read every bundle under a Mods folder (and the generated test pack)
 * with the editor's bundle reader, and report what it could and could not parse.
 *
 *   bun run tools/scan_mods.ts [modsFolder]
 *
 * Folders and `.zip` archives are both walked; `.7z` is not (no reader for it).
 * Output is a summary per bundle plus the weapons that failed, so a PX-style
 * bundle that hides its records behind `weapons/index.lua` shows up as a number
 * rather than a silent zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';

const TEXT = /\.(lua|toml)$/i;

async function readFolder(root: string): Promise<ModFile[]> {
  const files: ModFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!TEXT.test(entry.name)) continue;
      const path = relative(root, full).split(sep).join('/');
      files.push({ path, text: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return files;
}

async function readZip(path: string): Promise<ModFile[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const files: ModFile[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !TEXT.test(name)) continue;
    files.push({ path: name, text: await entry.async('string') });
  }
  return files;
}

async function collect(root: string): Promise<ModFile[]> {
  const files: ModFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith('.zip')) {
        // Zips nest their own bundle root; keep paths inside the archive.
        void readZip(full).then((inner) => {
          for (const file of inner) files.push({ ...file, path: `${entry.name}/${file.path}` });
        });
      }
    }
  };

  const stat = statSync(root);
  if (stat.isFile()) return readZip(root);
  walk(root);
  files.push(...(await readFolder(root)));
  // Zips are read asynchronously above; give them a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return files;
}

const root = process.argv[2] ?? 'D:/Worms Armageddon/WormForge/Mods';
const packRoot = 'test_pack/wftest_pack';

const all: ModFile[] = [];
for (const source of [root, packRoot]) {
  try {
    const files = await collect(source);
    for (const file of files) all.push({ ...file, path: `${source === packRoot ? 'test' : 'mods'}/${file.path}` });
  } catch (error) {
    console.log(`skip ${source}: ${(error as Error).message}`);
  }
}

const bundles = readBundles(all);
const weapons = readWeapons(bundles, all);

console.log(`files: ${all.length}, bundles: ${bundles.length}, weapons: ${weapons.length}\n`);

let withRecord = 0;
for (const bundle of bundles) {
  const own = weapons.filter((weapon) => weapon.bundleId === bundle.id);
  if (own.length === 0) continue;
  const ok = own.filter((weapon) => weapon.record).length;
  withRecord += ok;
  console.log(
    `${bundle.id.padEnd(24)} ${String(ok).padStart(3)}/${String(own.length).padStart(3)} records` +
      `  deps: ${bundle.dependencies.join(', ') || '-'}`,
  );
}

console.log(`\nweapons with a record: ${withRecord}/${weapons.length}`);
const failed = weapons.filter((weapon) => !weapon.record);
for (const weapon of failed.slice(0, 15)) {
  console.log(`  MISS ${weapon.componentId}: ${weapon.error}${weapon.modulePath ? ` (${weapon.modulePath})` : ''}`);
}
if (failed.length > 15) console.log(`  … ${failed.length - 15} more`);

// One worked example, so the shapes are visible.
const sample =
  weapons.find((weapon) => weapon.componentId === 'px.banana_express') ??
  weapons.find((weapon) => weapon.record);
if (sample?.record) {
  const record = sample.record;
  console.log(`\nsample ${sample.componentId} from ${sample.modulePath}`);
  console.log(`  copy_from: ${sample.copyFrom ?? '-'}`);
  console.log(`  keys: ${Object.keys(record).join(', ')}`);
  const missile = record.missile as Record<string, unknown> | undefined;
  if (missile) console.log(`  missile keys: ${Object.keys(missile).join(', ')}`);
  console.log(`  sprite: ${JSON.stringify(missile?.sprite)} burst: ${JSON.stringify(missile?.burst)}`);
  if (sample.defaults) console.log(`  defaults: ${JSON.stringify(sample.defaults)}`);
}
