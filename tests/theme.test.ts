/**
 * Design tokens, at the language level: `theme App:` and every rule about referencing a token.
 *
 * The interesting part is not that a token turns into a value — it is that a token is a *value*
 * with a category, so a spacing token where a colour belongs has to fail, and so does assigning
 * to one. The generated output is pinned in `theme-codegen.test.ts`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { compileOne } from '../src/project/project.ts';
import { formatSource } from '../src/tooling/format.ts';
import { renderAst } from '../src/tooling/debug.ts';
import { codes } from './helpers.ts';

const THEME = [
  'theme App:',
  '',
  '    color brand = #2563eb',
  '    color surface = #ffffff',
  '    color ink = #0f172a',
  '    color danger = #dc2626',
  '    space sm = 8',
  '    spacing md = 16',
  '    radius card = 12',
  '',
].join('\n');

function compile(text: string, path = 'theme.pui') {
  return compileOne(path, text);
}

function errors(text: string): string[] {
  const result = compile(text);
  return result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
}

test('a theme parses into typed tokens, in source order', () => {
  const file = sourceFile('theme.pui', THEME);
  const { program, bag } = parse(file);
  assert.deepEqual(codes(bag.diagnostics), []);
  const theme = program.decls.find((decl) => decl.kind === 'Theme');
  assert.ok(theme !== undefined, 'expected a Theme decl');
  assert.equal(theme.name, 'App');
  assert.deepEqual(
    theme.tokens.map((token) => `${token.category}:${token.name}`),
    ['color:brand', 'color:surface', 'color:ink', 'color:danger', 'space:sm', 'space:md', 'radius:card'],
  );
  // `spacing` is an alias for `space`, but the source spelling is remembered for `plainui ast`.
  assert.equal(theme.tokens[5]!.categoryText, 'spacing');
});

test('a spacing token in a colour slot is an error, not odd output', () => {
  assert.deepEqual(errors(['screen Home:', '    text "x" color=md', '', THEME].join('\n')), ['PUI2304']);
});

test('a colour token in a spacing slot is an error', () => {
  assert.deepEqual(errors([THEME, 'screen Home:', '    column padding=brand:', '        text "x"', ''].join('\n')), [
    'PUI2304',
  ]);
});

test('token values have one shape per category', () => {
  const bad = ['theme App:', '    color brand = 16', '    space md = #ffffff', '    radius card = "x"', ''].join('\n');
  assert.deepEqual(errors(bad), ['PUI2306', 'PUI2306', 'PUI2306']);
});

test('a duplicate token, or a second theme, is reported where it is written', () => {
  const duplicate = ['theme App:', '    color brand = #2563eb', '    space brand = 16', ''].join('\n');
  assert.deepEqual(errors(duplicate), ['PUI2305']);

  const twoThemes = [THEME, THEME].join('\n');
  assert.deepEqual(errors(twoThemes), ['PUI2307']);
});

test('a token cannot be assigned, and state cannot shadow one', () => {
  const assigned = [
    THEME,
    'screen Home:',
    '',
    '    button "x":',
    '        on tap:',
    '            set md = 4',
    '',
  ].join('\n');
  assert.deepEqual(errors(assigned), ['PUI2114']);

  const shadowed = [THEME, 'screen Home:', '', '    state md: int = 4', '', '    text "x"', ''].join('\n');
  assert.deepEqual(errors(shadowed), ['PUI2309']);
});

test('an unknown token is an ordinary unknown identifier, with the token list to choose from', () => {
  const result = compile([THEME, 'screen Home:', '    column padding=large:', '        text "x"', ''].join('\n'));
  const unknown = result.diagnostics.find((d) => d.code === 'PUI2005');
  assert.ok(unknown !== undefined, 'expected PUI2005');
  assert.match(unknown.hint ?? '', /design token/, 'the hint should point at tokens when the file has a theme');
});

test('the formatter spaces token lines and leaves style properties tight', () => {
  const input = ['theme App:', '  color brand=#2563eb', '  space md=16', 'style title: size=32 color=brand', ''].join('\n');
  const formatted = formatSource(sourceFile('theme.pui', input));
  assert.equal(
    formatted.text,
    ['theme App:', '    color brand = #2563eb', '    space md = 16', 'style title: size=32 color=brand', ''].join('\n'),
  );
  // Idempotent, like the rest of the formatter.
  assert.equal(formatSource(sourceFile('theme.pui', formatted.text)).changed, false);
});

test('plainui ast shows the theme as declared', () => {
  const file = sourceFile('theme.pui', THEME);
  const { program } = parse(file);
  const rendered = renderAst(program);
  assert.match(rendered, /theme App/);
  assert.match(rendered, /color brand = #2563eb/);
  assert.match(rendered, /spacing md = 16/);
});
