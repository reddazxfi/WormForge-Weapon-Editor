/**
 * A tolerant reader for Lua *data*, not Lua code.
 *
 * Foreign bundles (PX's ports, the test pack, anything installed) describe a
 * weapon with table literals: `weapon.record = { missile = { ... } }`,
 * `wa.weapons.replace{ ... }`, `return { defaults = { ... } }`. We only need
 * those literals -- never to evaluate a function, follow a `require`, or run
 * arithmetic -- so this reads every table it can see and skips everything else
 * (function bodies, calls, expressions) without failing.
 *
 * Output shape: a plain object per table, keys as strings. A table's positional
 * entries land under `"1"`, `"2"`, … so `{ "a", "b" }` reads back as
 * `{ "1": "a", "2": "b" }`; nothing in a weapon record uses those, and it keeps
 * one type for the whole tree.
 */

export type LuaValue = string | number | boolean | null | LuaTable;
export interface LuaTable {
  [key: string]: LuaValue;
}

export interface LuaScan {
  /** `a.b = { … }` assignments, by dotted path (`weapon.record`, `defaults`). */
  assignments: Record<string, LuaTable>;
  /** `a.b{ … }` / `a.b({ … })` call tables, by dotted path (`wa.weapons.replace`). */
  calls: Record<string, LuaTable>;
  /**
   * `a.b(x)` where the argument is a name rather than a literal:
   * `wa.weapons.replace` -> `record`. The table is then looked up by that name,
   * which is how a module that assembles its record in a local is read.
   */
  callRefs: Record<string, string>;
  /** The file's `return { … }` table, if it has one. */
  returned?: LuaTable;
}

interface Token {
  kind: 'name' | 'string' | 'number' | 'punct';
  value: string;
  line: number;
  /** Byte offset in the source, so a caller can slice the exact literal. */
  at: number;
}

const LONG_BRACKET = /^\[(=*)\[/;

function tokenize(code: string): { tokens: Token[]; diagnostics: string[] } {
  const tokens: Token[] = [];
  const diagnostics: string[] = [];
  let i = 0;
  let line = 1;

  const push = (kind: Token['kind'], value: string, at = i) =>
    tokens.push({ kind, value, line, at });

  /** `[==[ ... ]==]` at `i`: returns the body, or null when it is not one. */
  const readLongBracket = (): string | null => {
    const m = LONG_BRACKET.exec(code.slice(i, i + 12));
    if (!m) return null;
    const close = `]${m[1]}]`;
    const start = i + m[0].length;
    const end = code.indexOf(close, start);
    const body = code.slice(start, end < 0 ? code.length : end);
    line += (code.slice(i, end < 0 ? code.length : end + close.length).match(/\n/g) || []).length;
    i = end < 0 ? code.length : end + close.length;
    return body;
  };

  while (i < code.length) {
    const c = code[i];

    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }

    // Comments: `--` line, `--[[ … ]]` / `--[==[ … ]==]` block.
    if (c === '-' && code[i + 1] === '-') {
      const save = i;
      i += 2;
      const block = readLongBracket();
      if (block !== null) continue;
      i = save + 2;
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }

    // Strings: quoted, or `[[ … ]]`.
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      let out = '';
      i += 1;
      while (i < code.length) {
        const ch = code[i];
        if (ch === '\\') {
          const next = code[i + 1];
          const escapes: Record<string, string> = {
            n: '\n',
            t: '\t',
            r: '\r',
            '\\': '\\',
            '"': '"',
            "'": "'",
            '0': '\0',
          };
          out += escapes[next] ?? next ?? '';
          i += 2;
          continue;
        }
        if (ch === quote) {
          i += 1;
          break;
        }
        if (ch === '\n') line += 1;
        out += ch;
        i += 1;
      }
      push('string', out, start);
      continue;
    }
    if (c === '[') {
      const start = i;
      const long = readLongBracket();
      if (long !== null) {
        push('string', long, start);
        continue;
      }
    }

    // Numbers: 12, 0.5, .5, 1e3, 0xFF, 255+
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      const rest = code.slice(i);
      const hex = /^0[xX][0-9a-fA-F]+/.exec(rest);
      const num = hex ?? /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(rest);
      if (num) {
        push('number', num[0]);
        i += num[0].length;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(c)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(i))![0];
      push('name', name);
      i += name.length;
      continue;
    }

    if ('{}[]=,;.:()+-*/%^#<>~'.includes(c)) {
      push('punct', c);
      i += 1;
      continue;
    }

    // Anything else (`\`, `&`, `|` …) is not Lua data we care about.
    diagnostics.push(`unexpected character ${JSON.stringify(c)} on line ${line}`);
    i += 1;
  }

  return { tokens, diagnostics };
}

/** Block keywords, so a skipped value can find the `end` that closes it. */
const OPENERS = new Set(['function', 'if', 'for', 'while', 'do', 'repeat']);

class Reader {
  private i = 0;
  constructor(
    private tokens: Token[],
    start = 0,
  ) {
    this.i = start;
  }

  get position(): number {
    return this.i;
  }

  seek(index: number): void {
    this.i = index;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }
  next(): Token | undefined {
    return this.tokens[this.i++];
  }
  atEnd(): boolean {
    return this.i >= this.tokens.length;
  }
  isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === 'punct' && token.value === value;
  }
  isName(value: string, offset = 1): boolean {
    const token = this.peek(offset);
    return token?.kind === 'name' && token.value === value;
  }

  /** `a.b[c]` at the cursor -> `a.b.c` (indexes only when they are a plain name). */
  dottedPath(): string | null {
    if (this.peek()?.kind !== 'name') return null;
    const parts = [this.next()!.value];
    for (;;) {
      if (this.isPunct('.')) {
        this.next();
        const name = this.next();
        if (name?.kind !== 'name') return null;
        parts.push(name.value);
        continue;
      }
      if (this.isPunct('[') && this.peek(1)?.kind === 'string' && this.isPunct(']', 2)) {
        this.next();
        parts.push(this.next()!.value);
        this.next();
        continue;
      }
      break;
    }
    return parts.join('.');
  }

  /**
   * Reads `{ … }` into an object. Values that are not data (calls, functions,
   * arithmetic) are skipped and stored as `null`, so one odd field cannot lose
   * the rest of the record.
   */
  table(): LuaTable {
    const out: LuaTable = {};
    if (!this.isPunct('{')) return out;
    this.next();
    let positional = 1;

    while (!this.atEnd() && !this.isPunct('}')) {
      // `key = value` or `[expr] = value`
      let key: string | null = null;
      const save = this.i;

      if (this.isPunct('[')) {
        this.next();
        const name = this.peek();
        if (name?.kind === 'string' || name?.kind === 'number') {
          this.next();
          if (this.isPunct(']') && this.isPunct('=', 1)) {
            this.next();
            this.next();
            key = name.value;
          } else {
            this.i = save;
          }
        } else {
          this.i = save;
        }
      } else if (this.peek()?.kind === 'name' && this.isPunct('=', 1)) {
        key = this.next()!.value;
        this.next(); // =
      }

      const value = this.value();
      if (value !== SKIP) {
        out[key ?? String(positional++)] = value;
      } else if (key !== null) {
        out[key] = null;
      }

      if (this.isPunct(',') || this.isPunct(';')) this.next();
    }
    if (this.isPunct('}')) this.next();
    return out;
  }

  /** A single value. Returns SKIP for anything that is not literal data. */
  value(): LuaValue | typeof SKIP {
    const token = this.peek();
    if (!token) return SKIP;

    if (token.kind === 'punct' && token.value === '{') return this.table();
    if (token.kind === 'string') {
      this.next();
      return token.value;
    }
    if (token.kind === 'number') {
      this.next();
      return Number(token.value);
    }
    if (token.kind === 'name') {
      if (token.value === 'true') {
        this.next();
        return true;
      }
      if (token.value === 'false') {
        this.next();
        return false;
      }
      if (token.value === 'nil') {
        this.next();
        return null;
      }
      // `function(…) … end`, `require("x")`, `f(x)`, a bare identifier: none of
      // it is data. Skip it without failing.
      this.skipExpression();
      return SKIP;
    }
    if (token.kind === 'punct' && token.value === '-' && this.peek(1)?.kind === 'number') {
      this.next();
      const number = this.next()!;
      return -Number(number.value);
    }
    this.skipExpression();
    return SKIP;
  }

  /** Advance past one expression: a balanced call, a function block, or a run. */
  skipExpression(): void {
    let depth = 0;
    let blockDepth = 0;
    while (!this.atEnd()) {
      const token = this.peek()!;
      const isBlockWord = token.kind === 'name' && OPENERS.has(token.value);
      if (depth === 0 && blockDepth === 0) {
        // A value that ended at a separator or the end of the table.
        if (token.kind === 'punct' && [',', ';', '}'].includes(token.value)) return;
      }
      if (token.kind === 'punct') {
        if ('([{'.includes(token.value)) depth += 1;
        else if (')]}'.includes(token.value)) {
          if (depth === 0) return;
          depth -= 1;
        }
      } else if (isBlockWord) {
        if (token.value === 'do' || token.value === 'function' || token.value === 'if') {
          blockDepth += 1;
        }
      } else if (token.kind === 'name' && token.value === 'end' && blockDepth > 0) {
        blockDepth -= 1;
        this.next();
        if (blockDepth === 0 && depth === 0) return;
        continue;
      } else if (token.kind === 'name' && token.value === 'until' && blockDepth > 0) {
        blockDepth -= 1;
      }
      this.next();
    }
  }
}

const SKIP = Symbol('skip');

/**
 * Every top-level table the file spells, by the name it is given. Anything the
 * reader cannot follow is skipped, so a bundle written in a style we have never
 * seen still yields what it can.
 */
export function scanLua(code: string): LuaScan {
  const { tokens } = tokenize(code);
  const reader = new Reader(tokens);
  const scan: LuaScan = { assignments: {}, calls: {}, callRefs: {} };

  while (!reader.atEnd()) {
    const token = reader.peek()!;

    if (token.kind === 'name' && token.value === 'return') {
      // Read the returned table with a throwaway reader and only step past
      // `return` here: a module's `return { install = function() … end }`
      // hides the record inside the function body, and the linear pass below
      // has to walk into it.
      const at = reader.position;
      if (new Reader(tokens, at + 1).isPunct('{')) {
        const sub = new Reader(tokens, at + 1);
        scan.returned = sub.table();
      }
      reader.next();
      continue;
    }

    if (token.kind === 'name') {
      const path = reader.dottedPath();
      if (path) {
        // `a.b = { … }`
        if (reader.isPunct('=') && reader.isPunct('{', 1)) {
          reader.next();
          scan.assignments[path] = reader.table();
          continue;
        }
        // `a.b{ … }` -- table-call sugar, as `wa.weapons.replace{ … }` uses.
        if (reader.isPunct('{')) {
          scan.calls[path] = reader.table();
          continue;
        }
        // `a.b({ … })` -- the same call with its table in parentheses.
        if (reader.isPunct('(') && reader.isPunct('{', 1)) {
          reader.next();
          scan.calls[path] = reader.table();
          continue;
        }
        // `a.b(table_name)` -- the table is a local or an earlier assignment.
        if (reader.isPunct('(')) {
          const save = reader.position;
          reader.next();
          const ref = reader.dottedPath();
          if (ref && reader.isPunct(')')) scan.callRefs[path] = ref;
          else reader.seek(save);
          continue;
        }
      }
      continue;
    }

    reader.next();
  }

  return scan;
}

/** First table found among the given assignment paths. */
export function firstTable(scan: LuaScan, ...paths: string[]): LuaTable | undefined {
  for (const path of paths) {
    for (const [key, table] of Object.entries(scan.assignments)) {
      if (key === path || key.endsWith(`.${path}`)) return table;
    }
  }
  return undefined;
}

/**
 * The table literal passed to a call, with its source text.
 *
 * `scanLua` deliberately skips function bodies when it reads a table, so a
 * call inside a callback (`fx.burst{ … }` in `on_explode`) is invisible to it.
 * This searches the token stream for the call itself instead, then reads the
 * first `{ … }` argument: `wa.weapons.replace{…}`, `fx.burst{…}`, or
 * `sb.flight(ctx, {…})` all resolve. `text` is the literal, kept because some
 * of the generator's values are expressions (`vx = function(i, w) … * 14 end`)
 * that are not table data.
 */
export function readCallTable(
  code: string,
  path: string,
): { table: LuaTable; text: string } | undefined {
  const { tokens } = tokenize(code);
  const parts = path.split('.');

  for (let i = 0; i < tokens.length; i += 1) {
    let j = i;
    let matches = true;
    for (let p = 0; p < parts.length; p += 1) {
      if (tokens[j]?.kind !== 'name' || tokens[j].value !== parts[p]) {
        matches = false;
        break;
      }
      j += 1;
      if (p < parts.length - 1) {
        if (!(tokens[j]?.kind === 'punct' && tokens[j].value === '.')) {
          matches = false;
          break;
        }
        j += 1;
      }
    }
    if (!matches) continue;

    // Walk the call's arguments to the first table. Parentheses nest, so
    // `sb.flight(ctx, { … })` is found at the argument level, not inside a
    // nested call before it.
    let k = j;
    let depth = 0;
    while (k < tokens.length) {
      const token = tokens[k];
      if (token.kind === 'punct') {
        if (token.value === '(') depth += 1;
        else if (token.value === ')') {
          if (depth === 0) break;
          depth -= 1;
        } else if (token.value === '{' && depth <= 1) break;
      }
      k += 1;
    }
    if (!(tokens[k]?.kind === 'punct' && tokens[k].value === '{')) continue;

    const reader = new Reader(tokens, k);
    const table = reader.table();
    const end = tokens[reader.position - 1];
    const closer = end?.kind === 'punct' && end.value === '}' ? 1 : 0;
    return {
      table,
      text: code.slice(tokens[k].at, (end?.at ?? tokens[k].at) + closer),
    };
  }
  return undefined;
}

/** Depth-first walk over plain objects (used by the record flattener). */
export function isTable(value: LuaValue | undefined): value is LuaTable {
  return !!value && typeof value === 'object';
}
