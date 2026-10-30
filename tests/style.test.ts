/**
 * Styles and shadows.
 *
 * A style is a bundle of properties, and it comes in two halves: text properties that only mean
 * something where text is drawn, and surface properties that decorate any element. Both halves have
 * to reach both targets, with one precedence rule — the element's own property wins.
 *
 * These tests are about the *rule*, not the bytes: the bytes are `tests/golden/style.pui`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { compileOne } from '../src/project/project.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { formatText } from '../src/tooling/format.ts';

function dart(source: string): string {
  const result = compileOne('style.pui', source);
  assert.deepEqual(
    result.diagnostics.map((d) => `${d.code} ${d.message}`),
    [],
    `expected no diagnostics, got:\n${result.diagnostics.map((d) => d.code + ' ' + d.message).join('\n')}`,
  );
  return result.code ?? '';
}

function html(source: string): string {
  const file = sourceFile('style.pui', source);
  const result = check(file, parse(file).program, {});
  return generateHtml(result.analysis).code;
}

const THEME = ['theme App:', '    color surface = #ffffff', '    color ink = #0f172a', '    space md = 16', '    radius card = 12', ''].join('\n');

test('a surface style decorates an element that does not draw text', () => {
  const source = [
    THEME,
    'style panel:',
    '    background=surface',
    '    radius=card',
    '    padding=md',
    '    border=1',
    '    borderColor=ink',
    '',
    'screen Home:',
    '    column style=panel:',
    '        text "x"',
    '',
  ].join('\n');

  const dartCode = dart(source);
  assert.match(dartCode, /Container\(/);
  assert.match(dartCode, /color: Color\(0xFFFFFFFF\)/);
  assert.match(dartCode, /BorderRadius\.circular\(12\)/);
  assert.match(dartCode, /EdgeInsets\.all\(16\)/);

  const htmlCode = html(source);
  assert.match(htmlCode, /background: #ffffff/);
  assert.match(htmlCode, /border-radius: 12px/);
  assert.match(htmlCode, /padding: 16px/);
});

test('a property on the element wins over the same property in its style', () => {
  const source = [
    THEME,
    'style panel:',
    '    background=surface',
    '    padding=md',
    '',
    'screen Home:',
    '    card style=panel background=ink padding=8:',
    '        text "x"',
    '',
  ].join('\n');

  const dartCode = dart(source);
  assert.doesNotMatch(dartCode, /color: Color\(0xFFFFFFFF\)/);
  assert.match(dartCode, /color: Color\(0xFF0F172A\)/);
  assert.match(dartCode, /EdgeInsets\.all\(8\)/);

  const htmlCode = html(source);
  assert.match(htmlCode, /background: #0f172a/);
  assert.match(htmlCode, /padding: 8px/);
  assert.doesNotMatch(htmlCode, /padding: 16px/);
});

test('a text style applies on text, and its text properties do not leak onto a box', () => {
  const source = [
    THEME,
    'style price:',
    '    size=20',
    '    weight=bold',
    '    color=ink',
    '',
    'screen Home:',
    '    column style=price padding=md:',
    '        text "x"',
    '',
  ].join('\n');

  // Text properties in a style on a non-text element are an error, not a silent no-op.
  assert.ok(check(sourceFile('style.pui', source), parse(sourceFile('style.pui', source)).program, {}).bag.diagnostics.some((d) => d.code === 'PUI2373'));

  const textOnly = [
    THEME,
    'style price:',
    '    size=20',
    '    weight=bold',
    '',
    'screen Home:',
    '    text "x" style=price',
    '',
  ].join('\n');
  const dartCode = dart(textOnly);
  assert.match(dartCode, /fontSize: 20/);
  assert.match(dartCode, /fontWeight: FontWeight\.w700/);
  assert.match(html(textOnly), /font-size: 20px/);
});

test('a shadow token lowers to BoxShadow in Dart and box-shadow in CSS', () => {
  const source = [
    'theme App:',
    '    color surface = #ffffff',
    '    radius card = 12',
    '    shadow soft = [0, 2, 8, #1f000000]',
    '',
    'style raised:',
    '    background=surface',
    '    radius=card',
    '    shadow=soft',
    '',
    'screen Home:',
    '    card style=raised:',
    '        text "x"',
    '',
  ].join('\n');

  const dartCode = dart(source);
  assert.match(dartCode, /static const BoxShadow soft = BoxShadow\(/);
  assert.match(dartCode, /boxShadow: \[BoxShadow\(/);
  assert.match(dartCode, /blurRadius: 8/);

  const htmlCode = html(source);
  assert.match(htmlCode, /box-shadow: 0px 2px 8px rgba\(0, 0, 0, 0\.122\)/);
});

test('a shadow can be written inline, and defaults its colour', () => {
  const source = ['screen Home:', '    card shadow=[0, 4, 12]:', '        text "x"', ''].join('\n');
  assert.match(dart(source), /color: Color\(0x1F000000\)/);
  assert.match(html(source), /box-shadow: 0px 4px 12px rgba\(15, 23, 42, 0\.12\)/);
});

test('a style wraps a component call in both targets', () => {
  const source = [
    THEME,
    'style panel:',
    '    background=surface',
    '    padding=md',
    '',
    'component Badge(label: Text):',
    '    text label',
    '',
    'screen Home:',
    '    Badge("new") style=panel',
    '',
  ].join('\n');

  const dartCode = dart(source);
  assert.match(dartCode, /padding: const EdgeInsets\.all\(16\)/);
  assert.match(dartCode, /Badge\(label: "new"\)/);
  assert.match(html(source), /class="pui-component"[^>]*background: #ffffff/);
});

test('a style name is a name, so it does not have to be a declared variable', () => {
  const source = [THEME, 'style panel:', '    padding=md', '', 'screen Home:', '    card style=panel:', '        text "x"', ''].join('\n');
  const result = compileOne('style.pui', source);
  assert.deepEqual(result.diagnostics.map((d) => d.code), []);
});

test('styles and shadow tokens are formatted and survive a round trip', () => {
  const source = [
    'theme App:',
    '    shadow soft = [0, 2, 8, #1f000000]',
    '    color ink = #0f172a',
    '',
    'style panel:',
    '    background=#ffffff',
    '    shadow=soft',
    '',
    'screen Home:',
    '    card style=panel:',
    '        text "x"',
    '',
  ].join('\n');
  const formatted = formatText('style.pui', source).text;
  assert.match(formatted, /shadow soft = \[0, 2, 8, #1f000000\]/);
  // Formatting is idempotent, and the result still compiles.
  assert.equal(formatText('style.pui', formatted).text, formatted);
  assert.deepEqual(compileOne('style.pui', formatted).diagnostics.map((d) => d.code), []);
});

test('the preview target keeps text styles on buttons', () => {
  // The preview used to drop a style on a button: the variant's own typography won.
  const source = [
    THEME,
    'style loud:',
    '    size=18',
    '    weight=bold',
    '',
    'screen Home:',
    '    button "Go" style=loud',
    '',
  ].join('\n');
  const htmlCode = html(source);
  assert.match(htmlCode, /font-size: 18px/);
  assert.match(htmlCode, /font-weight: 700/);
});

test('a shadow cannot be a variable, and a colour token cannot fill the slot', () => {
  const variable = ['screen Home:', '    state glow: Text = "x"', '    card shadow=glow:', '        text "x"', ''].join('\n');
  const file = sourceFile('style.pui', variable);
  const diagnosis = check(file, parse(file).program, {}).bag.diagnostics.find((d) => d.code === 'PUI2110');
  assert.ok(diagnosis !== undefined, 'expected PUI2110 for a shadow that is not a list');
  assert.match(diagnosis.hint ?? '', /shadow cannot be a variable/);
});

test('the shadow slot rejects the wrong shape, and a colour token cannot fill it', () => {
  const bad = ['theme App:', '    color brand = #2563eb', '', 'screen Home:', '    card shadow=brand:', '        text "x"', ''].join('\n');
  const file = sourceFile('style.pui', bad);
  const codes = check(file, parse(file).program, {}).bag.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('PUI2304') || codes.includes('PUI2110'), `expected a shadow shape/category error, got ${codes.join(', ')}`);
});
