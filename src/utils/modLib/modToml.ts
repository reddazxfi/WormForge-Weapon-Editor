/**
 * Just enough TOML for a bundle manifest.
 *
 * `mod.toml` uses scalar keys, string arrays (`dependencies`), `[[components]]`
 * array-of-tables and `[sprites."path"]` sub-tables. Nothing here needs dates,
 * floats or inline tables, and a line it cannot read is skipped rather than
 * failing the whole bundle -- a manifest we mis-read is worse than one we
 * partly read, because the components are what matter.
 */

export type TomlValue = string | number | boolean | string[] | Record<string, unknown>;

export interface TomlDocument {
  /** Top-level scalars and arrays, plus `components` as an array of tables. */
  values: Record<string, TomlValue>;
  /** `[[components]]` blocks, in file order. */
  components: Record<string, TomlValue>[];
  /** `[sprites."path"]` sub-tables, keyed by the sprite path. */
  spriteDecls: Record<string, Record<string, TomlValue>>;
  /** Every `[section]` seen, so callers can tell an unknown manifest apart. */
  sections: string[];
}

function unquote(raw: string): string {
  const text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    const body = text.slice(1, -1);
    // Only the escapes a manifest realistically holds.
    return body.replace(/\\(["'\\nt])/g, (_, ch: string) =>
      ch === 'n' ? '\n' : ch === 't' ? '\t' : ch,
    );
  }
  return text;
}

function parseValue(raw: string): TomlValue {
  const text = raw.trim();
  if (text.startsWith('[')) {
    // `["a", "b"]`, possibly spread over lines (the caller joined them).
    const body = text.replace(/^\[/, '').replace(/\]$/, '');
    const items: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (const ch of body) {
      if (quote) {
        current += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === ',') {
        if (current.trim()) items.push(unquote(current));
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) items.push(unquote(current));
    return items;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return unquote(text);
}

/** `[[components]]`, `[sprites."a/b.png"]`, `[profile]` -> path segments. */
function splitSection(header: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of header) {
    if (quote) {
      if (ch === quote) {
        segments.push(current);
        current = '';
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '.') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

export function parseToml(source: string): TomlDocument {
  const doc: TomlDocument = { values: {}, components: [], spriteDecls: {}, sections: [] };
  let component: Record<string, TomlValue> | null = null;
  let spritePath: string | null = null;
  let spriteTable: Record<string, TomlValue> | null = null;
  // A `key = [ …` value can wrap; keep appending until the brackets close.
  let pending: { key: string; text: string } | null = null;

  const assign = (key: string, value: TomlValue) => {
    if (component) component[key] = value;
    else if (spriteTable) spriteTable[key] = value;
    else doc.values[key] = value;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+/, '');

    if (pending) {
      pending.text += ` ${line.trim()}`;
      if ((pending.text.match(/\[/g) || []).length <= (pending.text.match(/\]/g) || []).length) {
        assign(pending.key, parseValue(pending.text));
        pending = null;
      }
      continue;
    }

    if (!line || line.startsWith('#')) continue;

    const arrayHeader = /^\[\[(.+?)\]\]/.exec(line);
    if (arrayHeader) {
      const path = splitSection(arrayHeader[1]);
      doc.sections.push(path.join('.'));
      if (path[0] === 'components') {
        component = {};
        spriteTable = null;
        spritePath = null;
        doc.components.push(component);
      }
      continue;
    }

    const tableHeader = /^\[(.+?)\]\s*(?:#.*)?$/.exec(line);
    if (tableHeader) {
      const path = splitSection(tableHeader[1]);
      doc.sections.push(path.join('.'));
      component = null;
      spritePath = path[0] === 'sprites' && path.length > 1 ? path.slice(1).join('.') : null;
      spriteTable = spritePath ? {} : null;
      if (spritePath && spriteTable) doc.spriteDecls[spritePath] = spriteTable;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    // A dotted key belongs to a sub-table we do not model (`components.suggests`).
    if (!key || key.includes('.')) continue;

    const valueText = line.slice(eq + 1).trim();
    if (valueText.startsWith('[') && !valueText.includes(']')) {
      pending = { key, text: valueText };
      continue;
    }
    assign(key, parseValue(valueText));
  }

  return doc;
}
