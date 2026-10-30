/**
 * The PlainUI formatter.
 *
 * Design choice: the formatter works from the token stream, not from the AST, so comments and
 * blank lines survive. It normalises exactly three things — indentation, the spaces between
 * tokens, and runs of blank lines — and it never reorders anything.
 *
 * Guarantees, both covered by tests:
 *   1. idempotent: format(format(x)) === format(x);
 *   2. meaning-preserving: parsing the formatted source yields the same tree as the original.
 */

import { DiagnosticBag } from './diagnostics.ts';
import { type Comment, type Token, tokenize } from './lexer.ts';
import { type SourceFile, lineCount, sourceFile } from './source.ts';

export interface FormatResult {
  readonly text: string;
  /** True when the formatter changed anything. */
  readonly changed: boolean;
  /** True when the file did not lex, so it was returned untouched. */
  readonly skipped: boolean;
}

const INDENT = '    ';

/** Binary operators that breathe. */
const SPACED = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
  '+=',
  '-=',
  '*=',
  '/=',
]);

/** Lines on which `=` is spaced (`state a = 1`); everywhere else it is tight (`gap=8`). */
const SPACED_EQ_FIRST = new Set(['state', 'set']);

/** Tokens after which an operator must be unary. */
const OPERATOR_LIKE_KEYWORDS = new Set(['in', 'if', 'elif', 'else', 'for', 'on', 'set', 'slot', 'state', 'import']);

interface LineInfo {
  level: number;
  extra: number;
}

export function formatSource(source: SourceFile): FormatResult {
  const probe = new DiagnosticBag(source);
  const { tokens, comments } = tokenize(source, probe);
  if (probe.hasErrors) return { text: source.text, changed: false, skipped: true };

  const commentByLine = new Map<number, Comment>();
  for (const comment of comments) commentByLine.set(comment.line, comment);

  const tokensByLine = new Map<number, Token[]>();
  const infoByLine = new Map<number, LineInfo>();

  let level = 0;
  let inLogicalLine = false;
  let logicalLevel = 0;
  let logicalColumn = 0;

  for (const token of tokens) {
    if (token.kind === 'eof') break;
    if (token.kind === 'indent') {
      level += 1;
      continue;
    }
    if (token.kind === 'dedent') {
      level = Math.max(0, level - 1);
      continue;
    }
    if (token.kind === 'newline') {
      inLogicalLine = false;
      continue;
    }
    if (!inLogicalLine) {
      inLogicalLine = true;
      logicalLevel = level;
      logicalColumn = token.col - 1;
    }
    if (!infoByLine.has(token.line)) {
      infoByLine.set(token.line, { level: logicalLevel, extra: Math.max(0, token.col - 1 - logicalColumn) });
    }
    const bucket = tokensByLine.get(token.line);
    if (bucket === undefined) tokensByLine.set(token.line, [token]);
    else bucket.push(token);
  }

  const lines: string[] = [];
  const total = lineCount(source);
  let previousBlank = false;

  const infoFor = (line: number): LineInfo => {
    const own = infoByLine.get(line);
    if (own !== undefined) return own;
    // Comment-only or blank line: borrow the indentation of the nearest token line.
    for (let next = line + 1; next <= total; next++) {
      const info = infoByLine.get(next);
      if (info !== undefined) return info;
    }
    for (let previous = line - 1; previous >= 1; previous--) {
      const info = infoByLine.get(previous);
      if (info !== undefined) return info;
    }
    return { level: 0, extra: 0 };
  };

  for (let line = 1; line <= total; line++) {
    const lineTokens = tokensByLine.get(line);
    const comment = commentByLine.get(line);

    if (lineTokens === undefined || lineTokens.length === 0) {
      if (comment !== undefined) {
        const info = infoFor(line);
        lines.push(INDENT.repeat(info.level) + comment.text.trim());
        previousBlank = false;
        continue;
      }
      if (lines.length === 0) continue;
      if (previousBlank) continue;
      lines.push('');
      previousBlank = true;
      continue;
    }

    const info = infoFor(line);
    const body = formatTokens(lineTokens);
    const trailing = comment === undefined ? '' : `  ${comment.text.trim()}`;
    lines.push(INDENT.repeat(info.level) + ' '.repeat(info.extra) + body + trailing);
    previousBlank = false;
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const text = `${lines.join('\n')}\n`;
  return { text, changed: text !== source.text, skipped: false };
}

/** Format a file by path and text. */
export function formatText(path: string, text: string): FormatResult {
  return formatSource(sourceFile(path, text));
}

interface TokenMeta {
  unary: boolean;
  inType: boolean;
  ternaryColon: boolean;
}

function analyse(tokens: readonly Token[]): TokenMeta[] {
  const meta: TokenMeta[] = [];
  let expectOperand = true;
  let inType = false;
  let depth = 0;
  let angle = 0;
  let ternaryPending = false;

  for (const token of tokens) {
    const unary = expectOperand && token.kind === 'op' && (token.value === '-' || token.value === '!');
    const ternaryColon = token.value === ':' && ternaryPending;
    meta.push({ unary, inType, ternaryColon });

    if (token.kind === 'op') {
      if (token.value === '(' || token.value === '[') depth += 1;
      else if (token.value === ')' || token.value === ']') depth = Math.max(0, depth - 1);

      if (token.value === ':') {
        if (ternaryColon) ternaryPending = false;
        else inType = true;
      } else if (token.value === '?') {
        if (!inType) ternaryPending = true;
      } else if (token.value === '=') {
        inType = false;
      } else if (inType && token.value === '<') {
        angle += 1;
      } else if (inType && token.value === '>') {
        angle = Math.max(0, angle - 1);
      } else if (inType && angle === 0 && (token.value === ',' || token.value === ')')) {
        inType = false;
      }
    }

    expectOperand =
      (token.kind === 'op' && ![')', ']', '}'].includes(token.value)) ||
      (token.kind === 'keyword' && OPERATOR_LIKE_KEYWORDS.has(token.value));
  }
  return meta;
}

function formatTokens(tokens: readonly Token[]): string {
  const spacedEquals = tokens[0]!.kind === 'keyword' && SPACED_EQ_FIRST.has(tokens[0]!.value);
  const meta = analyse(tokens);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (i > 0 && needsSpace(tokens[i - 1]!, token, meta[i - 1]!, meta[i]!, spacedEquals)) out += ' ';
    out += token.value;
  }
  return out;
}

function needsSpace(previous: Token, token: Token, previousMeta: TokenMeta, meta: TokenMeta, spacedEquals: boolean): boolean {
  const prev = previous.value;
  const cur = token.value;

  if (previousMeta.unary) return false;
  if (prev === '(' || prev === '[' || prev === '{') return false;
  if (cur === ')' || cur === ']' || cur === '}') return false;
  if (cur === ',') return false;
  if (prev === ',') return true;
  if (cur === '.' || prev === '.') return false;

  // Ternary colons breathe; block and named-argument colons bind to the name before them.
  if (cur === ':') return meta.ternaryColon;
  if (prev === ':') return true;

  // `=` is decided before brackets, so `state items = [1]` keeps its space while `padding=[8]`
  // stays tight.
  if (cur === '=' || prev === '=') return spacedEquals;
  if (cur === '(' || cur === '[') return false;

  // Inside a type annotation, generics and nullability stay tight: List<String>, int?
  if (meta.inType && (cur === '<' || prev === '<' || cur === '>' || prev === '>')) return false;
  if (meta.inType && (cur === '?' || prev === '?')) return false;

  if (cur === '?' || prev === '?') return true;
  if (meta.unary) return true;
  if (SPACED.has(cur) || SPACED.has(prev)) return true;

  return true;
}
