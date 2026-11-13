import type { WepBaseline, WeaponProject } from '../types/weapon';

/**
 * The value a record field will have once the bundle loads.
 *
 * `copy_from` supplies the donor's whole record and a `.wep` supplies the whole
 * native record, so a field the author never touched is **not** the editor's
 * default: it is whatever that donor or file carries. Showing a hardcoded
 * fallback (`?? 100` on the launch power made every weapon look like it
 * launched at 100% and could not charge) both lies about the weapon and writes
 * that lie into the record the first time the field is edited.
 *
 * Order: the author's override, the baseline the export diffs against (the
 * donor for `copy_from`, the decoded file for a `.wep`), then the caller's
 * default for a field neither names.
 */
export function recordField(project: WeaponProject, path: string, fallback: unknown): any {
  const own = project.recordOverrides?.[path];
  if (own !== undefined) return own;
  const base: WepBaseline | undefined = project.useWepFile
    ? project.wepBaseline
    : project.donorBaseline;
  const inherited = base?.recordOverrides?.[path];
  return inherited !== undefined ? inherited : fallback;
}
