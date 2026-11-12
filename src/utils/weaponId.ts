/**
 * Every bundle this editor writes lives under one namespace.
 *
 * The editor can read other installed mods (`px.*`, `wf.sdk`, …), so its own
 * ids must never collide with one of theirs: the prefix is fixed and only the
 * part after the dot is editable. `sanitizeModFolder` already uses the last
 * segment, so the folder name is unaffected by the prefix.
 */
export const WFWS_PREFIX = 'wfws.';

/** The editable part of an id: everything after the last dot. */
export function weaponIdSuffix(id: string | undefined): string {
  const raw = (id ?? '').trim();
  if (!raw) return '';
  const parts = raw.split('.');
  return parts[parts.length - 1] || '';
}

/** `suffix` -> `wfws.suffix`, slugged the way the id field always was. */
export function withWfwsPrefix(suffix: string): string {
  const slug = suffix
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${WFWS_PREFIX}${slug || 'weapon'}`;
}

/** True when the id is already in the editor's namespace. */
export function hasWfwsPrefix(id: string | undefined): boolean {
  return (id ?? '').toLowerCase().startsWith(WFWS_PREFIX);
}
