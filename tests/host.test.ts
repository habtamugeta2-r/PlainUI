/**
 * Typed interop: `import "../data.dart" as data:` and the block under it.
 *
 * A `.pui` file has always been able to call the host, and the language deliberately does not
 * require declaring the host — `log("…")` keeps working. What a surface adds is *checkability*: the
 * names it declares are checked at every call site, and a qualified call says which module it
 * means, so a typo stops being a Dart error somewhere in the generated output.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateHtml } from '../src/codegen/html.ts';
import { compileSource } from '../src/project/compile.ts';
import { formatText } from '../src/tooling/format.ts';

const DATA_SURFACE = [
  'import "../data.dart" as data:',
  '',
  '    loadTasks(filter: String) -> Future<List<String>>',
  '    loadSlowThenFast() -> Future<List<String>>',
  '    count(word: String, pad: int = 0) -> int',
  '    formatCount(count: int) -> String',
  '    AppLogo(size: double = 24)',
  '',
].join('\n');

function compile(text: string) {
  const result = compileSource(text, { path: 'home.pui' });
  return {
    ...result,
    // The preview renders whatever the source contains; it never calls the host.
    html: result.ok ? generateHtml(result.analysis).code : undefined,
  };
}

function file(...body: readonly string[]): string {
  return [DATA_SURFACE, 'screen Home:', '', '    state note: String = ""', '', ...body, ''].join('\n');
}

/** Codes, minus the "declared but unused" chatter that every fixture would otherwise collect. */
const IGNORED = new Set(['PUI2404', 'PUI2405']);

function codes(text: string): string[] {
  return compile(text)
    .diagnostics.map((diagnostic) => diagnostic.code)
    .filter((code) => !IGNORED.has(code));
}

function errors(text: string): string[] {
  return compile(text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
    .filter((code) => !IGNORED.has(code));
}

/** The set of distinct host codes, for the cases that legitimately produce more than one of them. */
function uniqueErrors(text: string): string[] {
  return [...new Set(errors(text))];
}

function hints(text: string): string {
  return compile(text)
    .diagnostics.map((diagnostic) => `${diagnostic.message} ${diagnostic.hint ?? ''}`)
    .join(' | ');
}

const tap = (...lines: readonly string[]): string =>
  file('    column:', '', '        button "Go":', '            on tap:', ...lines.map((line) => `                ${line}`));

// ---------------------------------------------------------------------------------------------
// The syntax
// ---------------------------------------------------------------------------------------------

test('a surface parses into declarations on the import', () => {
  const result = compile(file('    text note'));
  assert.deepEqual(result.diagnostics, []);

  const imports = result.analysis.program.imports;
  assert.equal(imports.length, 1);
  assert.equal(imports[0]!.alias, 'data');
  assert.deepEqual(
    imports[0]!.surface?.map((decl) => `${decl.kind}:${decl.name}`),
    ['HostFn:loadTasks', 'HostFn:loadSlowThenFast', 'HostFn:count', 'HostFn:formatCount', 'HostWidget:AppLogo'],
  );
});

test('the formatter keeps a surface stable', () => {
  const messy = [
    'import "../data.dart" as data:',
    '',
    '    loadTasks(filter:String)->Future<List<String>>',
    '    AppLogo(size:double=24)',
    '',
    'screen Home:',
    '',
    '    column:',
    '',
    '        AppLogo(size:24)',
    '',
  ].join('\n');
  const once = formatText('home.pui', messy).text;
  assert.match(once, /loadTasks\(filter: String\) -> Future<List<String>>/);
  assert.match(once, /AppLogo\(size: double=24\)/);
  assert.equal(formatText('home.pui', once).text, once);
  // The formatted text still compiles to the same tree: the formatter never changes meaning.
  assert.deepEqual(compile(once).diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
});

// ---------------------------------------------------------------------------------------------
// Declared calls are checked
// ---------------------------------------------------------------------------------------------

test('a declared call is checked instead of passed through', () => {
  assert.deepEqual(errors(tap('log(data.count("a", 2))')), []);
  assert.deepEqual(errors(file('    state n: int = count("a")', '', '    text "${n}"')), []);
  assert.deepEqual(errors(tap('log(data.formatCount(3))')), []);
});

test('an unqualified call works when only one module declares the name', () => {
  const text = file('    task tasks: List<String> = loadTasks("")', '', '    column:', '', '        text "${tasks.value.length}"');
  assert.deepEqual(errors(text), []);
});

test('a host widget call is checked against its declared parameters', () => {
  assert.deepEqual(errors(file('    column:', '', '        AppLogo(size: 32)')), []);
  assert.deepEqual(errors(file('    column:', '', '        AppLogo()')), []);
  assert.deepEqual(errors(file('    column:', '', '        AppLogo(size: "big")')), ['PUI2343']);
  assert.deepEqual(errors(file('    column:', '', '        AppLogo(nope: 1)')), ['PUI2342']);
});

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

test('a name the surface does not declare is an error, with a suggestion', () => {
  const text = tap('log(data.loadTask(""))');
  assert.deepEqual(errors(text), ['PUI2340']);
  assert.match(hints(text), /loadTasks/);
});

test('argument count, names and types are part of the contract', () => {
  assert.deepEqual(errors(tap('log(data.count())')), ['PUI2341']);
  assert.match(hints(tap('log(data.count())')), /needs "word"/);
  assert.deepEqual(errors(tap('log(data.count("a", 1, 2))')), ['PUI2341']);
  assert.deepEqual(errors(tap('log(data.count("a", "b"))')), ['PUI2343']);
  assert.deepEqual(errors(tap('log(data.count(wrod: "a"))')), ['PUI2341', 'PUI2342']);
  assert.match(hints(tap('log(data.count(wrod: "a"))')), /word/);
});

test('an asynchronous function cannot be used as a value', () => {
  assert.deepEqual(errors(tap('log(data.loadTasks(""))')), ['PUI2344']);
  assert.match(hints(tap('log(data.loadTasks(""))')), /await/);
  // With await it is a value again, and inside a task it is awaited by the loader.
  assert.deepEqual(errors(tap('log(await data.loadTasks(""))')), []);
  assert.deepEqual(errors(file('    task tasks: List<String> = data.loadTasks("")', '', '    column:', '', '        text "${tasks.value.length}"')), []);
});

test('the value a host call produces is checked where it lands', () => {
  assert.deepEqual(errors(file('    state n: int = count("a")', '', '    text "${n}"')), []);
  assert.deepEqual(errors(file('    state label: int = formatCount(3)', '', '    text "${label}"')), ['PUI2343']);
  assert.deepEqual(errors(tap('set note = count("a")')), ['PUI2343']);
  assert.deepEqual(errors(file('    task numbers: List<String> = formatCount(1)', '', '    column:', '', '        text "${numbers.value.length}"')), ['PUI2343']);
});

test('two modules declaring one name need a qualifier', () => {
  const text = [
    'import "../data.dart" as data:',
    '',
    '    count(word: String) -> int',
    '',
    'import "../other.dart" as other:',
    '',
    '    count(word: String) -> int',
    '',
    'screen Home:',
    '',
    '    column:',
    '',
    '        button "Go":',
    '            on tap: log(count("a"))',
    '',
  ].join('\n');
  assert.deepEqual(errors(text), ['PUI2345']);
  assert.match(hints(text), /data\.count|other\.count/);
});

test('a qualified call needs a surface to be qualified with', () => {
  const text = ['import "../data.dart"', '', 'screen Home:', '', '    column:', '', '        button "Go":', '            on tap: data.loadTasks("")', ''].join('\n');
  assert.deepEqual(errors(text), ['PUI2347']);
  // A method on a value that happens to be named like an import is not a qualified call.
  const value = ['import "../data.dart"', '', 'screen Home:', '', '    state client: Object = makeClient()', '', '    column:', '', '        button "Go":', '            on tap: client.loadTasks("")', ''].join('\n');
  assert.deepEqual(errors(value), []);
});

test('a surface that cannot mean anything is refused', () => {
  const exposedPui = ['import "other.pui" as other:', '', '    helper(x: String)', '', 'screen Home:', '', '    text "x"', ''].join('\n');
  assert.deepEqual(uniqueErrors(exposedPui), ['PUI2346']);

  const anonymous = ['import "../data.dart":', '', '    helper(x: String)', '', 'screen Home:', '', '    text "x"', ''].join('\n');
  assert.deepEqual(errors(anonymous), ['PUI2346']);

  const duplicate = [
    'import "../data.dart" as data:',
    '',
    '    helper(x: String)',
    '    helper(x: String)',
    '',
    'screen Home:',
    '',
    '    text "x"',
    '',
  ].join('\n');
  assert.deepEqual(uniqueErrors(duplicate), ['PUI2346']);

  const untyped = ['import "../data.dart" as data:', '', '    helper(x)', '', 'screen Home:', '', '    column:', '', '        button "Go":', '            on tap: helper("a")', ''].join('\n');
  assert.deepEqual(uniqueErrors(untyped), ['PUI2346']);

  const widgetWithReturn = ['import "../data.dart" as data:', '', '    AppLogo(size: double) -> double', '', 'screen Home:', '', '    text "x"', ''].join('\n');
  assert.deepEqual(uniqueErrors(widgetWithReturn), ['PUI2346']);

  // A lowercase declaration without a return type is a function that returns nothing: the case of
  // the name is what makes it a constructor, exactly as it is for elements.
  const voidFunction = ['import "../data.dart" as data:', '', '    appLogo(size: double)', '', 'screen Home:', '', '    column:', '', '        button "Go":', '            on tap: appLogo(2)', ''].join('\n');
  assert.deepEqual(uniqueErrors(voidFunction), []);
});

test('a near miss in an undeclared call is a warning, not silence', () => {
  const text = tap('loadTask("")');
  assert.deepEqual(errors(text), []);
  assert.deepEqual(codes(text), ['PUI2410']);
  assert.match(hints(text), /loadTasks/);
  // A name that resembles nothing declared stays silent: the host is allowed to provide more.
  assert.deepEqual(codes(tap('log("hi")')), []);
});

// ---------------------------------------------------------------------------------------------
// Generated Dart
// ---------------------------------------------------------------------------------------------

test('a qualified source call produces a prefixed import', () => {
  const code = compile(file('    task tasks: List<String> = data.loadTasks("")', '', '    column:', '', '        text "${tasks.value.length}"')).code!;
  assert.match(code, /import '\.\.\/data\.dart';/);
  assert.match(code, /import '\.\.\/data\.dart' as data;/);
  assert.match(code, /await data\.loadTasks\(""\)/);
});

test('an unqualified call keeps the plain import, because a prefix would hide the rest', () => {
  const code = compile(file('    task tasks: List<String> = loadTasks("")', '', '    column:', '', '        text "${tasks.value.length}"')).code!;
  assert.match(code, /import '\.\.\/data\.dart';/);
  assert.doesNotMatch(code, /as data;/);
  assert.match(code, /await loadTasks\(""\)/);
});

test('the preview does not need the surface, and does not lose the content', () => {
  const text = file('    task tasks: List<String> = data.loadTasks("")', '', '    column:', '', '        text note', '', '        AppLogo(size: 32)');
  const compiled = compile(text);
  assert.deepEqual(errors(text), []);
  const html = compiled.html!;
  assert.match(html, /pui-root/);
  assert.match(html, /AppLogo/);
});
