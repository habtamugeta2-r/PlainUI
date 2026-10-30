/**
 * Source files, spans and positions.
 *
 * A span is a half-open range of character offsets into `SourceFile.text`. Everything else in
 * the compiler (tokens, AST nodes, diagnostics) points back into the original text this way, so
 * errors can always be rendered against the exact `.pui` the developer wrote.
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Position {
  /** 1-based. */
  readonly line: number;
  /** 1-based, counted in UTF-16 code units. */
  readonly col: number;
}

export interface SourceFile {
  /** Path used in diagnostics and in generated banners (posix separators). */
  readonly path: string;
  /** Normalised text: CRLF/CR collapsed to LF, always ending with a newline. */
  readonly text: string;
  /** Offset of the first character of each line. `lineStarts[0] === 0`. */
  readonly lineStarts: readonly number[];
}

export function normalizeText(text: string): string {
  let out = text.replace(/\r\n?/g, '\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export function sourceFile(path: string, text: string): SourceFile {
  const normalized = normalizeText(text);
  const lineStarts: number[] = [0];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return { path, text: normalized, lineStarts };
}

/** Number of lines, excluding the phantom empty line created by a trailing newline. */
export function lineCount(file: SourceFile): number {
  return Math.max(1, file.lineStarts.length - (file.text.endsWith('\n') ? 1 : 0));
}

export function positionAt(file: SourceFile, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, file.text.length));
  // Binary search for the greatest lineStart <= clamped.
  let lo = 0;
  let hi = file.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (file.lineStarts[mid]! <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: clamped - file.lineStarts[lo]! + 1 };
}

export function lineOf(file: SourceFile, offset: number): number {
  return positionAt(file, offset).line;
}

/** Offset of the first character of `line` (1-based). */
export function lineStart(file: SourceFile, line: number): number {
  return file.lineStarts[Math.max(0, Math.min(line - 1, file.lineStarts.length - 1))]!;
}

/** Offset just past the last character of `line`, excluding the newline. */
export function lineEnd(file: SourceFile, line: number): number {
  const next = file.lineStarts[line];
  if (next === undefined) return file.text.length;
  let end = next - 1;
  if (end > 0 && file.text.charCodeAt(end - 1) === 13) end -= 1;
  return Math.max(lineStart(file, line), end);
}

/** Text of `line` (1-based) without its newline. */
export function lineText(file: SourceFile, line: number): string {
  return file.text.slice(lineStart(file, line), lineEnd(file, line));
}

export function textOf(file: SourceFile, span: Span): string {
  return file.text.slice(span.start, span.end);
}

export function span(start: number, end: number): Span {
  return { start, end };
}

export function joinSpans(a: Span, b: Span): Span {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

export function spanContains(outer: Span, inner: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Indentation columns for a leading whitespace run. A tab advances to the next multiple of
 * `tabWidth`, matching how editors with `tabstop=4` render it.
 */
export function indentColumns(whitespace: string, tabWidth = 4): number {
  let col = 0;
  for (const ch of whitespace) {
    if (ch === '\t') col += tabWidth - (col % tabWidth);
    else col += 1;
  }
  return col;
}

export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}
