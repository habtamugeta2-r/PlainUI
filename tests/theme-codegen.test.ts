/**
 * Design tokens, at the target level: what a token reference becomes in Dart and in HTML.
 *
 * Tokens are resolved by the compiler, so both targets must agree on the value of `md` while
 * publishing it in the way their ecosystem expects: `AppTokens.md` in Dart, `--pui-md` in CSS.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { compileOne, compileProject } from '../src/project/project.ts';
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

test('tokens resolve at their use sites, and the palette is emitted once', () => {
  const result = compile(
    [
      THEME,
      'style title: size=32 weight=bold color=brand',
      '',
      'screen Home:',
      '',
      '    column padding=md gap=sm:',
      '        text "Hello" style=title',
      '        text "Danger" color=danger',
      '',
    ].join('\n'),
  );
  assert.equal(result.code !== undefined, true, JSON.stringify(result.diagnostics));
  const code = result.code!;

  // The palette, as data host code can reach.
  assert.match(code, /abstract final class AppTokens \{/);
  assert.match(code, /static const Color brand = Color\(0xFF2563EB\);/);
  assert.match(code, /static const double md = 16;/);
  // ... and applied to Flutter's own widgets.
  assert.match(code, /abstract final class AppTheme \{/);
  assert.match(code, /primary: AppTokens\.brand/);
  assert.match(code, /surface: AppTokens\.surface/);
  assert.match(code, /onSurface: AppTokens\.ink/);
  assert.match(code, /error: AppTokens\.danger/);

  // Use sites are literals, so generated trees stay const.
  assert.match(code, /const TextStyle _puiStyleTitle = TextStyle\(/);
  assert.match(code, /padding: const EdgeInsets\.all\(16\)/);
  assert.match(code, /SizedBox\(height: 8\)/);
  assert.match(code, /Image|Color\(0xFFDC2626\)/);
  // No token name survives into the Dart.
  assert.doesNotMatch(code, /\bmd\b(?=,)/);
});

test('a token reference works in the HTML preview, which also publishes CSS variables', () => {
  const text = [
    THEME,
    'screen Home:',
    '',
    '    column padding=md:',
    '        text "Hello" color=brand',
    '',
  ].join('\n');
  const file = sourceFile('theme.pui', text);
  const { program } = parse(file);
  const analysis = check(file, program, {}).analysis;
  const html = generateHtml(analysis).code;

  assert.match(html, /--pui-brand: #2563eb;/);
  assert.match(html, /--pui-md: 16px;/);
  assert.match(html, /padding: 16px/);
  assert.match(html, /color: #2563eb/);
});

test('tokens are visible in styles declared above the theme', () => {
  const result = compile(
    ['style title: size=24 color=brand', '', THEME, 'screen Home:', '', '    text "Hi" style=title', ''].join('\n'),
  );
  assert.equal(result.code !== undefined, true, JSON.stringify(result.diagnostics));
  assert.match(result.code!, /color: Color\(0xFF2563EB\)/);
});

test('tokens work in multi-value padding', () => {
  const result = compile(
    [THEME, 'screen Home:', '    column padding=[md, sm]:', '        text "x"', ''].join('\n'),
  );
  assert.equal(result.code !== undefined, true, JSON.stringify(result.diagnostics));
  assert.match(result.code!, /EdgeInsets\.symmetric\(vertical: 16, horizontal: 8\)/);
});

test('a theme is shared by importing the file that declares it', () => {
  const result = compileProject([
    { path: 'lib/ui/theme.pui', text: THEME },
    {
      path: 'lib/ui/home.pui',
      text: ['import "theme.pui"', '', 'screen Home:', '', '    column padding=md:', '        text "x"', ''].join('\n'),
    },
  ]);
  assert.deepEqual(codes(result.diagnostics), []);
  const home = result.files.find((file) => file.source.path === 'lib/ui/home.pui');
  assert.ok(home?.code !== undefined, 'expected generated Dart for home.pui');
  assert.match(home.code, /EdgeInsets\.all\(16\)/);
});
