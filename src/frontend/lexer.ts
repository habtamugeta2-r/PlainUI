/**
 * The PlainUI lexer.
 *
 * It is indentation-aware: whitespace at the start of a line is not trivia, it is structure.
 * The lexer emits `indent` / `dedent` / `newline` tokens in the Python tradition, so the parser
 * can work on a flat stream without ever looking at columns.
 *
 * The indentation rules (docs/01-language-spec.md §1.1) exist because indentation languages
 * fail in known ways — see docs/00-research.md §1.4. In short:
 *
 *   - tabs are legal, and count as 4 columns;
 *   - mixing tabs and spaces inside one indentation run is an error, not a guess;
 *   - the indent width is inferred per file, so 2-space files work;
 *   - a dedent must land on a column that an enclosing block actually used;
 *   - indentation is only meaningful when we are not inside brackets (continuation).
 */

import { DiagnosticBag } from '../analysis/diagnostics.ts';
import { type SourceFile, type Span, indentColumns, positionAt } from './source.ts';

export type TokenKind =
  | 'ident'
  | 'keyword'
  | 'number'
  | 'string'
  | 'color'
  | 'op'
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'invalid'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** Raw source text of the token (for strings, including the quotes). */
  readonly value: string;
  readonly span: Span;
  readonly line: number;
  readonly col: number;
}

export interface Comment {
  readonly text: string;
  readonly span: Span;
  readonly line: number;
  readonly col: number;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly comments: readonly Comment[];
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  'import',
  'screen',
  'component',
  // NOTE: `style` is deliberately *not* a keyword. It is a contextual keyword recognised by the
  // parser at the top level, because `style=heading` is a universal property. Lexing it as a
  // keyword would make the most common property in the language unparseable.
  'state',
  'on',
  'set',
  'if',
  'elif',
  'else',
  'for',
  'in',
  'slot',
  'true',
  'false',
  'null',
  'await',
]);

/** Longest-first so that `>=` wins over `>`. */
const OPERATORS: readonly string[] = [
  '...',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '+=',
  '-=',
  '*=',
  '/=',
  '=>',
  '..',
  '=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '?',
  ':',
  '.',
  ',',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
];

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHex(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

export function tokenize(file: SourceFile, bag: DiagnosticBag): LexResult {
  const text = file.text;
  const tokens: Token[] = [];
  const comments: Comment[] = [];

  /** Column of each open block; index 0 is always column 0. */
  const indentStack: number[] = [0];
  /** Bracket nesting depth of the current logical line. */
  let depth = 0;
  /** Opening brackets of the current logical line, for unclosed-bracket reporting. */
  const openers: { ch: string; span: Span }[] = [];
  /** True when the previous logical line ended with `:`. */
  let prevOpenedBlock = false;
  let lineStart = true;
  let i = 0;

  const tok = (kind: TokenKind, value: string, start: number, end: number): Token => {
    const pos = positionAt(file, start);
    return { kind, value, span: { start, end }, line: pos.line, col: pos.col };
  };

  const push = (kind: TokenKind, value: string, start: number, end: number): void => {
    tokens.push(tok(kind, value, start, end));
  };

  /** Emit a zero-width structural token at `offset`. */
  const pushStructural = (kind: TokenKind, offset: number): void => {
    push(kind, '', offset, offset);
  };

  const finishLogicalLine = (end: number): void => {
    const last = tokens[tokens.length - 1];
    const openedBlock = last !== undefined && last.kind === 'op' && last.value === ':';
    if (depth === 0) {
      pushStructural('newline', end);
      prevOpenedBlock = openedBlock;
    }
  };

  const handleIndent = (cols: number, offset: number, run: string): void => {
    if (run.includes(' ') && run.includes('\t')) {
      bag.error({
        code: 'PUI1005',
        message: 'indentation mixes tabs and spaces',
        span: { start: offset - run.length, end: offset },
        hint: 'Use only spaces (recommended) or only tabs for indentation.',
      });
    }
    const top = indentStack[indentStack.length - 1]!;
    if (cols > top) {
      if (!prevOpenedBlock) {
        bag.error({
          code: 'PUI1003',
          message: `this line is indented deeper than the previous line, but the previous line does not open a block`,
          span: { start: offset - run.length, end: offset },
          hint: `indent to column ${top + 1}, or add ":" to the line above if it should open a block`,
        });
        // Do not pretend a block was opened; treat the line as a sibling so that a single bad
        // line does not cascade into a screenful of errors.
        return;
      }
      indentStack.push(cols);
      pushStructural('indent', offset);
      return;
    }
    if (cols === top) return;

    while (indentStack.length > 1 && indentStack[indentStack.length - 1]! > cols) {
      indentStack.pop();
      pushStructural('dedent', offset);
    }
    const now = indentStack[indentStack.length - 1]!;
    if (now !== cols) {
      const expected = [...new Set(indentStack)].sort((a, b) => a - b);
      bag.error({
        code: 'PUI1004',
        message: `this line dedents to column ${cols + 1}, which is not the start of any enclosing block`,
        span: { start: offset - run.length, end: offset },
        hint: `use ${expected.map((c) => `column ${c + 1}`).join(', ')}`,
      });
      indentStack.push(cols);
      pushStructural('indent', offset);
    }
  };

  while (i < text.length) {
    if (lineStart) {
      lineStart = false;

      let j = i;
      let run = '';
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) {
        run += text[j];
        j += 1;
      }

      // Blank line: no tokens, no indentation effect.
      if (j >= text.length || text[j] === '\n') {
        i = j >= text.length ? text.length : j + 1;
        lineStart = true;
        continue;
      }

      // Comment-only line: ignored for indentation (like Python), but remembered for tooling.
      if (text[j] === '/' && text[j + 1] === '/') {
        const nl = text.indexOf('\n', j);
        const end = nl < 0 ? text.length : nl;
        const pos = positionAt(file, j);
        comments.push({ text: text.slice(j, end), span: { start: j, end }, line: pos.line, col: pos.col });
        i = nl < 0 ? text.length : nl + 1;
        lineStart = true;
        continue;
      }

      if (depth === 0) handleIndent(indentColumns(run), j, run);
      i = j;
      continue;
    }

    const ch = text[i]!;

    if (ch === '\n') {
      finishLogicalLine(i);
      i += 1;
      lineStart = true;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }

    // Comment to end of line.
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      const pos = positionAt(file, i);
      comments.push({ text: text.slice(i, end), span: { start: i, end }, line: pos.line, col: pos.col });
      i = end;
      continue;
    }

    if (ch === '"') {
      const start = i;
      let k = i + 1;
      let closed = false;
      while (k < text.length) {
        const c = text[k]!;
        if (c === '\\') {
          k += 2;
          continue;
        }
        if (c === '\n') break;
        if (c === '"') {
          closed = true;
          k += 1;
          break;
        }
        // Skip over `${ ... }` interpolation, which may itself contain strings and braces.
        if (c === '$' && text[k + 1] === '{') {
          let braces = 0;
          k += 1;
          while (k < text.length) {
            const d = text[k]!;
            if (d === '"') {
              k += 1;
              while (k < text.length && text[k] !== '"') {
                if (text[k] === '\\') k += 1;
                k += 1;
              }
            } else if (d === '{') braces += 1;
            else if (d === '}') {
              braces -= 1;
              if (braces === 0) {
                k += 1;
                break;
              }
            }
            k += 1;
          }
          continue;
        }
        k += 1;
      }
      if (!closed) {
        bag.error({
          code: 'PUI1002',
          message: 'unterminated string',
          span: { start, end: Math.max(start + 1, Math.min(k, text.length)) },
          hint: 'strings cannot span lines; add the closing quote',
        });
      }
      push('string', text.slice(start, k), start, k);
      i = k;
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      let k = i;
      while (k < text.length && isDigit(text[k]!)) k += 1;
      if (text[k] === '.' && isDigit(text[k + 1] ?? '')) {
        k += 1;
        while (k < text.length && isDigit(text[k]!)) k += 1;
      }
      const raw = text.slice(start, k);
      if ((raw.match(/\./g) ?? []).length > 1) {
        bag.error({ code: 'PUI1011', message: `invalid number "${raw}"`, span: { start, end: k } });
      }
      push('number', raw, start, k);
      i = k;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      let k = i;
      while (k < text.length && isIdentPart(text[k]!)) k += 1;
      const raw = text.slice(start, k);
      push(KEYWORDS.has(raw) ? 'keyword' : 'ident', raw, start, k);
      i = k;
      continue;
    }

    if (ch === '#') {
      const start = i;
      let k = i + 1;
      while (k < text.length && isHex(text[k]!)) k += 1;
      const digits = k - start - 1;
      if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) {
        bag.error({
          code: 'PUI1012',
          message: `invalid colour "#${text.slice(start + 1, k)}"`,
          span: { start, end: k },
          hint: 'use #RGB, #RRGGBB or #AARRGGBB',
        });
      }
      push('color', text.slice(start, k), start, k);
      i = k;
      continue;
    }

    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
    if (op !== undefined) {
      const start = i;
      const end = i + op.length;
      if (OPENERS[op] !== undefined) {
        depth += 1;
        openers.push({ ch: op, span: { start, end } });
      } else if (op === ')' || op === ']' || op === '}') {
        const opener = openers.pop();
        if (opener === undefined || OPENERS[opener.ch] !== op) {
          bag.error({
            code: 'PUI1016',
            message: `unexpected closing "${op}"`,
            span: { start, end },
            hint: opener === undefined ? 'there is no open bracket here' : `"${opener.ch}" was opened but not closed`,
          });
        }
        depth = Math.max(0, depth - 1);
      }
      push('op', op, start, end);
      i = end;
      continue;
    }

    bag.error({
      code: 'PUI1001',
      message: `invalid character "${ch}"`,
      span: { start: i, end: i + 1 },
      hint: 'characters that are not part of the language must be inside a string',
    });
    push('invalid', ch, i, i + 1);
    i += 1;
  }

  for (const opener of openers) {
    bag.error({
      code: 'PUI1016',
      message: `unclosed "${opener.ch}"`,
      span: opener.span,
      hint: `add "${OPENERS[opener.ch]}" on the same logical line`,
    });
  }

  // Close every block that is still open.
  if (depth === 0) {
    if (tokens.length > 0 && tokens[tokens.length - 1]!.kind !== 'newline') pushStructural('newline', text.length);
    while (indentStack.length > 1) {
      indentStack.pop();
      pushStructural('dedent', text.length);
    }
  }
  pushStructural('eof', text.length);

  return { tokens, comments };
}

/** Debug helper: a compact, line-annotated dump of the token stream. */
export function describeTokens(tokens: readonly Token[]): string {
  const out: string[] = [];
  let line = -1;
  for (const token of tokens) {
    if (token.line !== line) {
      line = token.line;
      out.push(`\n${String(line).padStart(4)} |`);
    }
    const label = token.kind === 'newline' ? '↵' : token.kind === 'indent' ? '→' : token.kind === 'dedent' ? '←' : token.value;
    out.push(` ${token.kind}:${JSON.stringify(label)}`);
  }
  return out.join('').trim() + '\n';
}
