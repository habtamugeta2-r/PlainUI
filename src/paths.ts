/**
 * POSIX path helpers.
 *
 * The compiler core must run in Node *and* in the browser (the playground), and it only ever
 * deals with project-relative paths, so it uses these instead of `node:path`.
 */

export function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

export function normalizePath(path: string): string {
  const absolute = isAbsolute(path);
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined.length === 0 ? '.' : joined;
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  return normalized.slice(0, index);
}

export function basename(path: string, stripExtension = false): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  const base = index < 0 ? normalized : normalized.slice(index + 1);
  if (!stripExtension) return base;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

export function extensionOf(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/** Join path segments, resolving `..` and `.` but never escaping a relative root. */
export function joinPath(...segments: string[]): string {
  const filtered = segments.filter((segment) => segment.length > 0);
  if (filtered.length === 0) return '.';
  return normalizePath(filtered.join('/'));
}

/** Relative path from directory `from` to path `to`, both project-relative. */
export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split('/').filter((p) => p.length > 0 && p !== '.');
  const toParts = normalizePath(to).split('/').filter((p) => p.length > 0 && p !== '.');
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common += 1;
  const ups = fromParts.length - common;
  const rest = toParts.slice(common);
  const parts = [...Array<string>(ups).fill('..'), ...rest];
  if (parts.length === 0) return '.';
  return parts.join('/');
}

/** Import specifier for a Dart file: always explicit about the local `./` form. */
export function dartImportSpecifier(fromFile: string, toFile: string): string {
  const rel = relativePath(dirname(fromFile), toFile);
  return rel.startsWith('../') ? rel : `./${rel}`;
}

/** camelCase form of a file stem, so `app_state.dart` can be referenced as `appState`. */
export function camelCase(stem: string): string {
  return stem.replace(/[-_.]+(.)/g, (_, ch: string) => ch.toUpperCase()).replace(/^(.)/, (ch) => ch.toLowerCase());
}
