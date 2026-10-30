import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagnosticBag } from '../src/analysis/diagnostics.ts';
import { tokenize } from '../src/frontend/lexer.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { codes, hasError } from './helpers.ts';

function lex(text: string) {
  const file = sourceFile('test.pui', text);
  const bag = new DiagnosticBag(file);
  const result = tokenize(file, bag);
  return { bag, ...result, file };
}

/** Structural token shape, with values, for compact assertions. */
function shape(text: string): string[] {
  const { tokens } = lex(text);
  return tokens
    .filter((t) => t.kind !== 'eof')
    .map((t) => (t.kind === 'indent' ? '>' : t.kind === 'dedent' ? '<' : t.kind === 'newline' ? '|' : `${t.kind}:${t.value}`));
}

test('emits indent, newline and dedent around a block', () => {
  assert.deepEqual(shape('screen Home:\n    text "hi"\n'), [
    'keyword:screen',
    'ident:Home',
    'op::',
    '|',
    '>',
    'ident:text',
    'string:"hi"',
    '|',
    '<',
  ]);
});

test('blank lines and comment-only lines do not affect indentation', () => {
  const text = ['screen Home:', '', '    // a comment', '', '    text "a"', '', '    text "b"', ''].join('\n');
  assert.deepEqual(shape(text), [
    'keyword:screen',
    'ident:Home',
    'op::',
    '|',
    '>',
    'ident:text',
    'string:"a"',
    '|',
    'ident:text',
    'string:"b"',
    '|',
    '<',
  ]);
  assert.equal(lex(text).bag.diagnostics.length, 0);
});

test('infers indent width, so two-space files are fine', () => {
  const text = 'screen Home:\n  column:\n    text "a"\n';
  assert.deepEqual(shape(text), [
    'keyword:screen',
    'ident:Home',
    'op::',
    '|',
    '>',
    'ident:column',
    'op::',
    '|',
    '>',
    'ident:text',
    'string:"a"',
    '|',
    '<',
    '<',
  ]);
  assert.equal(lex(text).bag.diagnostics.length, 0);
});

test('reports mixed tabs and spaces in one indentation run', () => {
  const { bag } = lex('screen Home:\n \ttext "a"\n');
  assert.ok(hasError(bag, 'PUI1005'), 'expected PUI1005');
});

test('tabs are legal on their own and count as four columns', () => {
  const { bag } = lex('screen Home:\n\ttext "a"\n\ttext "b"\n');
  assert.equal(bag.diagnostics.length, 0);
});

test('reports a dedent that lands between block levels', () => {
  const text = ['screen Home:', '    column:', '        text "a"', '      text "b"', ''].join('\n');
  const { bag } = lex(text);
  assert.ok(hasError(bag, 'PUI1004'), 'expected PUI1004');
  assert.match(bag.diagnostics[0]!.hint ?? '', /column 1, column 5/);
});

test('reports indentation without a block opener', () => {
  const { bag } = lex('screen Home:\n    text "a"\n        text "b"\n');
  assert.ok(hasError(bag, 'PUI1003'), 'expected PUI1003');
});

test('reports indentation on the first line', () => {
  const { bag } = lex('    screen Home:\n');
  assert.ok(hasError(bag, 'PUI1003'));
});

test('brackets continue the logical line', () => {
  const text = ['screen Home:', '    text format(', '        a,', '        b,', '    )', ''].join('\n');
  const result = shape(text);
  assert.equal(result.filter((t) => t === '|').length, 2, 'one newline for screen, one for text');
  assert.equal(lex(text).bag.diagnostics.length, 0);
});

test('unclosed bracket is reported at the opening bracket', () => {
  const { bag } = lex('screen Home:\n    text format(a,\n');
  assert.ok(hasError(bag, 'PUI1016'));
});

test('lexes colour literals and keeps # out of comments', () => {
  const { tokens, bag } = lex('text "a" color=#0a7d33 bg=#fff\n');
  assert.equal(bag.diagnostics.length, 0);
  assert.deepEqual(
    tokens.filter((t) => t.kind === 'color').map((t) => t.value),
    ['#0a7d33', '#fff'],
  );
});

test('rejects malformed colour literals', () => {
  const { bag } = lex('text "a" color=#12345\n');
  assert.ok(hasError(bag, 'PUI1012'));
});

test('comments are captured with their spans and stripped from the token stream', () => {
  const { tokens, comments } = lex('text "a" // trailing\n// own line\n');
  assert.equal(comments.length, 2);
  assert.equal(comments[0]!.text, '// trailing');
  assert.ok(!tokens.some((t) => t.value.includes('trailing')));
});

test('strings may contain // and escaped quotes', () => {
  const { tokens, bag } = lex('text "https://example.com" \ntext "say \\"hi\\""\n');
  assert.equal(bag.diagnostics.length, 0);
  assert.deepEqual(
    tokens.filter((t) => t.kind === 'string').map((t) => t.value),
    ['"https://example.com"', '"say \\"hi\\""'],
  );
});

test('reports unterminated strings', () => {
  const { bag } = lex('text "oops\n');
  assert.ok(hasError(bag, 'PUI1002'));
});

test('string interpolation with braces and nested quotes is one token', () => {
  const { tokens, bag } = lex('text "a ${b(c, "d")} e"\n');
  assert.equal(bag.diagnostics.length, 0);
  assert.equal(tokens.filter((t) => t.kind === 'string').length, 1);
});

test('keywords are distinguished from identifiers', () => {
  const { tokens } = lex('state count = 1\n');
  assert.deepEqual(
    tokens.filter((t) => t.kind === 'keyword').map((t) => t.value),
    ['state'],
  );
});

test('a line ending in ":" opens a block; a line ending in an expression does not', () => {
  const { bag } = lex('column:\n    text "a"\ntext "b"\n');
  assert.equal(bag.diagnostics.length, 0, JSON.stringify(codes(bag.diagnostics)));
});

test('operators are lexed longest-first', () => {
  const { tokens } = lex('set a = b >= c && d != e\n');
  assert.deepEqual(
    tokens.filter((t) => t.kind === 'op').map((t) => t.value),
    ['=', '>=', '&&', '!='],
  );
});

test('invalid characters are reported once and do not stop lexing', () => {
  const { bag, tokens } = lex('text "a" $ 1\n');
  assert.ok(hasError(bag, 'PUI1001'));
  assert.ok(tokens.some((t) => t.kind === 'number' && t.value === '1'));
});

test('tokens carry 1-based line and column positions', () => {
  const { tokens } = lex('screen Home:\n    text "hi"\n');
  const text = tokens.find((t) => t.value === 'text')!;
  assert.equal(text.line, 2);
  assert.equal(text.col, 5);
});
