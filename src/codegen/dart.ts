/**
 * Small helpers for emitting Dart source. Kept separate from the Flutter generator so that a
 * future Kotlin/TypeScript emitter can borrow the indentation utilities without the semantics.
 */

export function indentCode(code: string, spaces: number): string {
  if (spaces <= 0) return code;
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line, index) => (index === 0 || line.length === 0 ? line : pad + line))
    .join('\n');
}

/** Indent every line, including the first. */
export function indentAll(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

export function isMultiline(code: string): boolean {
  return code.includes('\n');
}

/**
 * `Name(arg, arg)` or, when that does not fit on one line, a trailing-comma multi-line form.
 * The output is deterministic: same input, same bytes.
 */
export function dartCall(name: string, args: readonly string[], childrenList?: { key: string; items: readonly string[] }): string {
  const parts: string[] = [...args];
  if (childrenList !== undefined) {
    parts.push(listArgument(childrenList.key, childrenList.items));
  }
  if (parts.length === 0) return `${name}()`;
  const singleLine = parts.every((part) => !isMultiline(part)) && name.length + parts.join(', ').length < 68;
  if (singleLine) return `${name}(${parts.join(', ')})`;
  return `${name}(\n${parts.map((part) => indentAll(part, 2)).join(',\n')},\n)`;
}

/** `children: <Widget>[ ... ]` — with typed list literal, as Flutter code normally reads. */
export function listArgument(key: string, items: readonly string[]): string {
  if (items.length === 0) return `${key}: <Widget>[]`;
  return `${key}: <Widget>[\n${items.map((item) => `${indentAll(item, 2)},`).join('\n')}\n]`;
}

/** A named argument, only included when the value exists. */
export function arg(name: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`${name}: ${value}`];
}

export function namedArg(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${name}: ${value}`;
}

/** Escape a PlainUI string literal body for Dart, keeping `${...}` interpolation intact. */
export function dartString(raw: string): string {
  return raw;
}

/** Wrap a compound expression in parentheses when it needs them. */
export function paren(code: string): string {
  if (/^[A-Za-z0-9_.$]+$/.test(code)) return code;
  if (code.startsWith('(') && code.endsWith(')')) return code;
  return `(${code})`;
}

/** Identifiers that can be used as part of a generated name. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

export function capitalize(name: string): string {
  return name.length === 0 ? '' : name.charAt(0).toUpperCase() + name.slice(1);
}

/** A block of statements, indented two spaces, without the surrounding braces. */
export function indentedBlock(statements: readonly string[]): string {
  if (statements.length === 0) return '';
  return statements.map((statement) => indentCode(statement, 2)).join('\n');
}
