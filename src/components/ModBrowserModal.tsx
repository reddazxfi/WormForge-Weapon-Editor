import { useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  FileArchive,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Package,
  Copy,
  Download,
  ChevronRight,
} from 'lucide-react';
import { readBundles, readWeapons, flattenRecord, type ModBundle, type ModWeapon } from '../utils/modLib/scan';
import { readDroppedItems, readFileTexts, readZipTexts } from '../utils/modLib/loadFiles';
import { importBundleWeapon } from '../utils/modLib/importWeapon';
import type { WeaponProject } from '../types/weapon';

interface Props {
  onClose: () => void;
  showToast: (message: string) => void;
  /** Applies an imported weapon to the editor's project. */
  onImport: (project: Partial<WeaponProject> & { replaceProject?: boolean }) => void;
}

type Phase = 'idle' | 'reading' | 'ready' | 'error';

/**
 * Reads bundles that are already installed: their `mod.toml`, their weapon
 * components, and the record tables each weapon keeps in Lua.
 *
 * Nothing here writes to the editor's project. It is a reader: pick a folder (a
 * whole `Mods/` tree, a bundle, or a `.zip`), see what was understood, and copy
 * a record or an id out. PX's ports are the hard case -- one entry file can
 * serve a hundred weapons, and the record may sit behind `weapons/index.lua`, a
 * `lib/` module, or a `.wep` file -- so the panel reports what it could not read
 * instead of hiding it.
 */
export function ModBrowserModal({ onClose, showToast, onImport }: Props) {
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof readFileTexts>>>([]);
  const [bundles, setBundles] = useState<ModBundle[]>([]);
  const [weapons, setWeapons] = useState<ModWeapon[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<string>('');
  const [selectedWeapon, setSelectedWeapon] = useState<ModWeapon | null>(null);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);

  const ingest = async (files: Awaited<ReturnType<typeof readFileTexts>>) => {
    if (files.length === 0) {
      setPhase('error');
      setError('No `.lua` or `mod.toml` files in what was chosen.');
      return;
    }
    setPhase('reading');
    setFileCount(files.length);
    setFiles(files);
    try {
      const foundBundles = readBundles(files);
      const foundWeapons = readWeapons(foundBundles, files);
      setBundles(foundBundles);
      setWeapons(foundWeapons);
      setSelectedBundle(foundBundles[0]?.id ?? '');
      setSelectedWeapon(null);
      setPhase('ready');
    } catch (err) {
      setPhase('error');
      setError((err as Error).message);
    }
  };

  const onFolder = async (list: FileList | null) => {
    if (!list) return;
    await ingest(await readFileTexts(list));
  };

  const onZip = async (file: File | undefined) => {
    if (!file) return;
    await ingest(await readZipTexts(file));
  };

  const bundleWeapons = useMemo(() => {
    const inBundle = weapons.filter((weapon) => weapon.bundleId === selectedBundle);
    const needle = query.trim().toLowerCase();
    if (!needle) return inBundle;
    return inBundle.filter(
      (weapon) =>
        weapon.componentId.toLowerCase().includes(needle) ||
        weapon.name.toLowerCase().includes(needle),
    );
  }, [weapons, selectedBundle, query]);

  const readCount = weapons.filter((weapon) => weapon.record).length;
  const flat = selectedWeapon ? flattenRecord(selectedWeapon.record) : {};
  const flatKeys = Object.keys(flat).sort();

  /** The record as the editor's own `recordOverrides` lines, for a quick copy. */
  const recordLua = useMemo(() => {
    if (!selectedWeapon?.record) return '';
    const lines: string[] = [];
    const walk = (table: Record<string, unknown>, path: string, indent: string) => {
      for (const [key, value] of Object.entries(table)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          lines.push(`${indent}${key} = {`);
          walk(value as Record<string, unknown>, `${path}${key}.`, `${indent}  `);
          lines.push(`${indent}},`);
        } else {
          lines.push(`${indent}${key} = ${JSON.stringify(value)},`);
        }
      }
    };
    walk(selectedWeapon.record as Record<string, unknown>, '', '  ');
    return lines.join('\n');
  }, [selectedWeapon]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied`);
    } catch {
      showToast('Clipboard is not available here');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-stone-200 dark:border-stone-800">
          <div>
            <h2 className="font-heading text-sm font-bold text-stone-900 dark:text-white uppercase tracking-wide flex items-center gap-2">
              <Package className="w-4 h-4 text-forge-500" />
              Read installed mods
            </h2>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
              Pick a `Mods/` folder, one bundle, or a `.zip`. Bundles, their weapon
              components and the record tables in their Lua are read here; nothing is imported
              into the project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:border-forge-500"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Choose Mods folder
          </button>
          <button
            type="button"
            onClick={() => zipRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:border-forge-500"
          >
            <FileArchive className="w-3.5 h-3.5" />
            Choose a .zip
          </button>
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onFolder(e.target.files)}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
          <input
            ref={zipRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => void onZip(e.target.files?.[0])}
          />
          {phase === 'ready' && (
            <span className="ml-auto text-[11px] font-mono text-stone-500 dark:text-stone-400">
              {fileCount} files · {bundles.length} bundles · {weapons.length} weapons ·{' '}
              <span className={readCount === weapons.length ? 'text-forge-600' : 'text-amber-600'}>
                {readCount} records
              </span>
            </span>
          )}
          {phase === 'idle' && (
            <span className="ml-auto text-[11px] text-stone-400">
              folder or zip, read locally — nothing is uploaded
            </span>
          )}
        </div>

        {phase === 'idle' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void (async () => {
                const files = await readDroppedItems(e.dataTransfer.items);
                await ingest(files);
              })();
            }}
            className={`m-5 flex-1 min-h-[220px] grid place-items-center rounded-xl border-2 border-dashed text-center px-6 transition-colors ${
              dragging
                ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/20'
                : 'border-stone-300 dark:border-stone-700'
            }`}
          >
            <div className="space-y-1.5">
              <Package className="w-8 h-8 mx-auto text-stone-400" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Drop a mod folder or `.zip` here
              </div>
              <p className="text-[11px] text-stone-500 max-w-sm">
                `D:\Worms Armageddon\WormForge\Mods` works as a whole: nested bundles like
                `wf-lib/px` are found by their own `mod.toml`.
              </p>
            </div>
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex-1 grid place-items-center text-xs text-stone-500">Reading…</div>
        )}

        {phase === 'error' && (
          <div className="m-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/20 p-4 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {phase === 'ready' && (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[15rem_1fr] divide-y md:divide-y-0 md:divide-x divide-stone-200 dark:divide-stone-800">
            <div className="overflow-y-auto max-h-[26vh] md:max-h-none">
              {bundles.map((bundle) => {
                const own = weapons.filter((weapon) => weapon.bundleId === bundle.id);
                const ok = own.filter((weapon) => weapon.record).length;
                return (
                  <button
                    key={`${bundle.manifestPath}`}
                    type="button"
                    onClick={() => {
                      setSelectedBundle(bundle.id);
                      setSelectedWeapon(null);
                      setQuery('');
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 transition-colors ${
                      selectedBundle === bundle.id
                        ? 'bg-forge-50 dark:bg-forge-950/30'
                        : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                    }`}
                  >
                    <div className="text-[11px] font-mono text-stone-500 truncate">{bundle.id}</div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                      {bundle.name}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      {own.length === 0 ? 'no weapons' : `${ok}/${own.length} records`}
                      {bundle.dependencies.length > 0 && ` · ${bundle.dependencies.join(', ')}`}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex flex-col">
              <div className="px-3 py-2 border-b border-stone-200 dark:border-stone-800 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-stone-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter weapons by id or name"
                  aria-label="Filter weapons"
                  className="flex-1 bg-transparent text-xs text-stone-800 dark:text-stone-200 focus:outline-hidden"
                />
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-stone-200 dark:divide-stone-800">
                <div className="overflow-y-auto max-h-[30vh] sm:max-h-none">
                  {bundleWeapons.length === 0 && (
                    <p className="p-4 text-[11px] text-stone-500">
                      No weapon components in this bundle.
                    </p>
                  )}
                  {bundleWeapons.map((weapon) => (
                    <button
                      key={weapon.componentId}
                      type="button"
                      onClick={() => setSelectedWeapon(weapon)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-stone-100 dark:border-stone-800/60 ${
                        selectedWeapon?.componentId === weapon.componentId
                          ? 'bg-forge-50 dark:bg-forge-950/30'
                          : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                      }`}
                    >
                      {weapon.record ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-forge-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                          {weapon.name}
                        </span>
                        <span className="block text-[10px] font-mono text-stone-400 truncate">
                          {weapon.componentId}
                        </span>
                      </span>
                      <ChevronRight className="w-3 h-3 text-stone-300 shrink-0" />
                    </button>
                  ))}
                </div>

                <div className="overflow-y-auto p-3 space-y-2">
                  {!selectedWeapon && (
                    <p className="text-[11px] text-stone-500">
                      Pick a weapon to see the record tables the reader found.
                    </p>
                  )}
                  {selectedWeapon && (
                    <>
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                          {selectedWeapon.name}
                        </div>
                        <div className="text-[10px] font-mono text-stone-500 break-all">
                          {selectedWeapon.componentId}
                        </div>
                        <div className="text-[10px] font-mono text-stone-400 break-all">
                          {selectedWeapon.modulePath || '—'}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-stone-500 pt-1">
                          {selectedWeapon.copyFrom && <span>donor: {selectedWeapon.copyFrom}</span>}
                          {selectedWeapon.sprite && <span>sprite: {selectedWeapon.sprite}</span>}
                          {selectedWeapon.clusterSprite && (
                            <span>cluster: {selectedWeapon.clusterSprite}</span>
                          )}
                          <span>{flatKeys.length} fields</span>
                        </div>
                      </div>

                      {!selectedWeapon.record && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          {selectedWeapon.error}. A record kept in a `.wep` file, or built at
                          runtime from a helper’s arguments, cannot be read as tables.
                        </p>
                      )}

                      {selectedWeapon.record && (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const { project, notes, replaceProject } = importBundleWeapon(
                                  selectedWeapon,
                                  files,
                                );
                                onImport({ ...project, replaceProject });
                                showToast(
                                  `Imported ${selectedWeapon.name}${notes.length > 0 ? ` — ${notes.join(', ')}` : ''}`,
                                );
                                onClose();
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-forge-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-forge-700"
                            >
                              <Download className="w-3 h-3" />
                              Import into editor
                            </button>
                            <button
                              type="button"
                              onClick={() => void copy(recordLua, 'Record tables')}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-700 px-2 py-1 text-[10px] font-semibold text-stone-700 dark:text-stone-200 hover:border-forge-500"
                            >
                              <Copy className="w-3 h-3" />
                              Copy tables
                            </button>
                            <button
                              type="button"
                              onClick={() => void copy(selectedWeapon.componentId, 'Id')}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-300 dark:border-stone-700 px-2 py-1 text-[10px] font-semibold text-stone-700 dark:text-stone-200 hover:border-forge-500"
                            >
                              <Copy className="w-3 h-3" />
                              Copy id
                            </button>
                          </div>
                          <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 max-h-64 overflow-y-auto">
                            <table className="w-full text-[10px] font-mono">
                              <tbody>
                                {flatKeys.map((key) => (
                                  <tr key={key} className="border-b border-stone-100 dark:border-stone-800/60">
                                    <td className="px-2 py-0.5 text-stone-500 align-top">{key}</td>
                                    <td className="px-2 py-0.5 text-stone-800 dark:text-stone-200 break-all">
                                      {JSON.stringify(flat[key])}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
