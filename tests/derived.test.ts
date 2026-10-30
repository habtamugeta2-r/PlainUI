/**
 * `derived`: a value that is computed, not stored.
 *
 * The point of the construct is what it makes impossible. A stored "computed" field can be stale if
 * someone forgets to update it, and can be written directly; a getter can be neither. These tests
 * pin the getter, the type inference that gives it a type, and every way a derived value can be
 * defined wrongly — above all a cycle, which would be a stack overflow in the generated getter.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateHtml } from '../src/codegen/html.ts';
import { compileSource } from '../src/project/compile.ts';
import { formatText } from '../src/tooling/format.ts';

function compile(text: string) {
  const result = compileSource(text, { path: 'derived.pui' });
  return { ...result, html: result.ok ? generateHtml(result.analysis).code : undefined };
}

function screen(...body: readonly string[]): string {
  return ['screen Home:', '', '    state count: int = 1', '    state label: String = "x"', '', ...body, ''].join('\n');
}

const IGNORED = new Set(['PUI2404', 'PUI2405']);

function errors(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
    .filter((code) => !IGNORED.has(code));
}

function warnings(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => diagnostic.code)
    .filter((code) => !IGNORED.has(code));
}

function hints(text: string): string {
  return compile(text)
    .diagnostics.map((diagnostic) => `${diagnostic.message} ${diagnostic.hint ?? ''}`)
    .join(' | ');
}

/** The generated getters, as `type name => body`. */
function getters(text: string): string[] {
  const code = compile(text).code ?? '';
  return [...code.matchAll(/^ {2}(.+?) get (\w+) => (.+);$/gm)].map((match) => `${match[1]} ${match[2]} => ${match[3]}`);
}

// ---------------------------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------------------------

test('a derived value parses next to the state it reads', () => {
  const result = compile(screen('    derived doubled = count * 2', '', '    column:', '', '        text "${doubled}"'));
  assert.deepEqual(errors(screen('    derived doubled = count * 2', '', '    column:', '', '        text "${doubled}"')), []);
  const decl = result.program.decls[0]!;
  assert.ok(decl.kind === 'Screen');
  assert.deepEqual(decl.derived.map((item) => item.name), ['doubled']);
  assert.equal(decl.derived[0]!.typeText, undefined);
  assert.deepEqual(decl.body.map((node) => node.kind), ['Element']);
});

test('the formatter spaces the declaration and stays stable', () => {
  const messy = screen('    derived doubled=count*2', '', '    column:', '', '        text "${doubled}"');
  const once = formatText('derived.pui', messy).text;
  assert.match(once, /derived doubled = count \* 2/);
  assert.equal(formatText('derived.pui', once).text, once);
});

// ---------------------------------------------------------------------------------------------
// The generated getter
// ---------------------------------------------------------------------------------------------

test('a derived value compiles to a getter, not a field', () => {
  const code = compile(screen('    derived doubled = count * 2', '', '    column:', '', '        text "${doubled}"')).code!;
  assert.match(code, /int get doubled => count \* 2;/);
  assert.match(code, /\/\/\/ `derived doubled` — computed on every read, never stored\./);
  // Nothing is stored: no field, no initialiser, no place for a stale value to live.
  assert.doesNotMatch(code, /int doubled/);
  assert.doesNotMatch(code, /^ {2}\w+ doubled = /m);
});

test('the type is inferred from the expression when it is not written', () => {
  const page = screen(
    '    derived doubled = count * 2',
    '    derived half = count / 2',
    '    derived big = count > 10',
    '    derived shout = label + "!"',
    '    derived pair = [count, count]',
    '',
    '    column:',
    '',
    '        text "${doubled}${half}${big}${shout}${pair}"',
  );
  assert.deepEqual(errors(page), []);
  assert.deepEqual(getters(page), [
    'int doubled => count * 2',
    // Dart's `/` is double division, even between two ints.
    'double half => count / 2',
    'bool big => count > 10',
    'String shout => label + "!"',
    'List<int> pair => [count, count]',
  ]);
});

test('a written type is kept, and checked against the expression', () => {
  const good = screen('    derived label2: String = "n=${count}"', '', '    column:', '', '        text label2');
  assert.deepEqual(errors(good), []);
  assert.match(compile(good).code!, /String get label2 => "n=\$\{count\}";/);

  const bad = screen('    derived wrong: String = count + 1', '', '    column:', '', '        text wrong');
  assert.deepEqual(errors(bad), ['PUI2353']);
  assert.match(hints(bad), /String|int/);
});

test('a derived value may read one declared further down, and the type follows', () => {
  const page = screen(
    '    derived label2 = "total ${doubled}"',
    '    derived doubled = count * 2',
    '',
    '    column:',
    '',
    '        text label2',
  );
  assert.deepEqual(errors(page), []);
  assert.deepEqual(getters(page), ['String label2 => "total ${doubled}"', 'int doubled => count * 2']);
});

test('a derived value can read parameters and tasks', () => {
  const parameterised = [
    'screen Detail(id: String, count: int):',
    '',
    '    derived title = "Item ${id}"',
    '',
    '    column:',
    '',
    '        text title',
    '        text "${count}"',
    '',
  ].join('\n');
  assert.deepEqual(errors(parameterised), []);
  assert.deepEqual(getters(parameterised), ['String title => "Item ${id}"']);

  const tasks = [
    'screen Items:',
    '',
    '    task items: List<String> = loadItems()',
    '',
    '    derived count = items.value.length',
    '    derived busy = items.loading',
    '    derived failure = items.error',
    '',
    '    column:',
    '',
    '        text "${count}${busy}"',
    '        if failure != null:',
    '            text failure',
    '',
  ].join('\n');
  assert.deepEqual(errors(tasks), []);
  assert.deepEqual(getters(tasks), [
    'int count => (_items ?? const <String>[]).length',
    'bool busy => _itemsLoading',
    'String? failure => _itemsError',
  ]);
});

test('a screen with only derived values stays stateless', () => {
  const text = ['screen Plain:', '', '    derived greeting = "hi"', '', '    column:', '', '        text greeting', ''].join('\n');
  const code = compile(text).code!;
  assert.match(code, /class Plain extends StatelessWidget \{/);
  assert.match(code, /String get greeting => "hi";/);
});

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

test('a derived value cannot be assigned', () => {
  const text = screen('    derived doubled = count * 2', '', '    column:', '', '        text "${doubled}"', '', '        button "Go":', '            on tap: set doubled = 5');
  assert.deepEqual(errors(text), ['PUI2350']);
  assert.match(hints(text), /computed|derived/);
});

test('a derived cycle is an error, including through a string', () => {
  const direct = screen('    derived a = a + 1', '', '    column:', '', '        text "${a}"');
  assert.deepEqual(errors(direct), ['PUI2351']);

  const through = screen('    derived a = b + 1', '    derived b = a + 1', '', '    column:', '', '        text "${a}"');
  assert.deepEqual(errors(through), ['PUI2351']);
  assert.match(hints(through), /a → b → a|b → a → b/);

  // The identifier is inside a string interpolation, which the lexer sees as text.
  const interpolation = screen('    derived a = "${b}"', '    derived b = "${a}"', '', '    column:', '', '        text a');
  assert.deepEqual(errors(interpolation), ['PUI2351']);
});

test('derived belongs at the top level', () => {
  const nested = screen('    column:', '', '        derived doubled = count * 2', '', '        text "${doubled}"');
  assert.ok(errors(nested).includes('PUI2352'), errors(nested).join(', '));
});

test('a derived value nothing reads is a warning', () => {
  const text = screen('    derived unused = count * 2', '', '    column:', '', '        text label');
  assert.deepEqual(warnings(text), ['PUI2411']);
  assert.deepEqual(errors(text), []);
});

test('a derived name competes with state, tasks and tokens', () => {
  const duplicate = screen('    derived count = 1', '', '    column:', '', '        text "${count}"');
  assert.ok(errors(duplicate).includes('PUI2003'), errors(duplicate).join(', '));

  const reserved = ['screen Home:', '', '    derived class = 1', '', '    column:', '', '        text "${class}"', ''].join('\n');
  assert.ok(errors(reserved).includes('PUI2012'), errors(reserved).join(', '));
});

test('an action is not an expression', () => {
  const awaits = screen('    derived now = await loadNow()', '', '    column:', '', '        text "${now}"');
  assert.ok(errors(awaits).includes('PUI2112'), errors(awaits).join(', '));

  const navigates = screen('    derived where = navigate Detail(id: "1")', '', '    column:', '', '        text "${where}"');
  assert.ok(errors(navigates).length > 0, 'navigation in a derived value must not be silent');
});

// ---------------------------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------------------------

test('the preview evaluates derived values instead of dropping them', () => {
  const text = ['screen Home:', '', '    state count: int = 3', '', '    derived doubled = count * 2', '    derived label = "Total: ${doubled}"', '', '    column:', '', '        text label', ''].join('\n');
  const html = compile(text).html!;
  assert.match(html, /Total: 6/);
});
