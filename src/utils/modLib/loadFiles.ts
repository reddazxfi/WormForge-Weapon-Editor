/**
 * Getting bundle text into the page.
 *
 * Everything runs in the browser's own file APIs, so the same code works on
 * GitHub Pages, in the Vite dev server and inside the Tauri webview: a folder
 * picker (`webkitdirectory`) yields every file with its path, and a dropped or
 * chosen `.zip` is read with the JSZip the exporter already depends on.
 *
 * A native path read (`@tauri-apps/plugin-fs`) would avoid the extra click, but
 * that package is not a dependency yet; the folder picker opens Tauri's native
 * dialog too, so the flow is identical either way.
 */
import JSZip from 'jszip';
import type { ModFile } from './scan';

const TEXT_FILE = /\.(lua|toml)$/i;
/** A bundled `.wep` is the weapon's base record, so it is read as bytes. */
const BINARY_FILE = /\.wep$/i;

function pathOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

/** Files worth reading out of a picker's selection. */
export function textFilesOf(list: FileList | File[] | null): File[] {
  if (!list) return [];
  return Array.from(list).filter(
    (file) => TEXT_FILE.test(file.name) || BINARY_FILE.test(file.name),
  );
}

export async function readFileTexts(list: FileList | File[] | null): Promise<ModFile[]> {
  const files = textFilesOf(list);
  const out: ModFile[] = [];
  for (const file of files) {
    const path = pathOf(file).split('\\').join('/');
    if (BINARY_FILE.test(file.name)) {
      out.push({ path, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      out.push({ path, text: await file.text() });
    }
  }
  return out;
}

export async function readZipTexts(file: File): Promise<ModFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: ModFile[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const path = name.split('\\').join('/');
    if (TEXT_FILE.test(name)) out.push({ path, text: await entry.async('string') });
    else if (BINARY_FILE.test(name))
      out.push({ path, text: '', bytes: await entry.async('uint8array') });
  }
  return out;
}

/** A dropped item can be a zip or a folder; both end up as `ModFile[]`. */
export async function readDroppedItems(items: DataTransferItemList): Promise<ModFile[]> {
  const out: ModFile[] = [];

  const walkEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (!file) return;
      if (/\.zip$/i.test(file.name)) {
        out.push(...(await readZipTexts(file)));
        return;
      }
      const path = entry.fullPath.replace(/^\//, '');
      if (BINARY_FILE.test(file.name)) {
        out.push({ path, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
        return;
      }
      if (!TEXT_FILE.test(file.name)) return;
      out.push({ path, text: await file.text() });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child);
    }
  };

  for (const item of Array.from(items)) {
    // `getAsEntry` is only valid while the drop event is being handled, so it
    // has to be called before any `await`.
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      await walkEntry(entry);
      continue;
    }
    const file = item.getAsFile();
    if (!file) continue;
    if (/\.zip$/i.test(file.name)) out.push(...(await readZipTexts(file)));
    else if (BINARY_FILE.test(file.name)) {
      out.push({ path: file.name, text: '', bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (TEXT_FILE.test(file.name)) out.push({ path: file.name, text: await file.text() });
  }

  return out;
}
