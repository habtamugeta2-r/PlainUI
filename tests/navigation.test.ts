/**
 * Navigation: `screen Detail(id: String)`, `navigate Detail(id: x)` and `back()`.
 *
 * Navigation is where a UI language usually gives up and hands you the host framework's router.
 * PlainUI keeps it a construct instead, which buys three things these tests pin down: the target is
 * checked (a screen you cannot import is a screen you cannot open), the arguments are checked
 * against the target's parameter list, and the output is a real `Navigator.push` rather than a
 * stringly-typed route name.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check } from '../src/analysis/check.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { parse } from '../src/frontend/parser.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { compileProject, compileOne } from '../src/project/project.ts';
import { ROUTES_FILE } from '../src/codegen/routes.ts';
import { codes } from './helpers.ts';

const DETAIL = [
  'screen Detail(id: String, title: String = "Task"):',
  '',
  '    column:',
  '',
  '        text title',
  '        text "${id}"',
  '',
  '        button "Back":',
  '            on tap: back()',
  '',
].join('\n');

const HOME = [
  'screen Home:',
  '',
  '    column:',
  '',
  '        button "One":',
  '            on tap: navigate Detail(id: "1")',
  '',
].join('\n');

function errors(text: string): string[] {
  return compileOne('nav.pui', text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

function hints(text: string): string[] {
  return compileOne('nav.pui', text)
    .diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.hint ?? '');
}

function oneScreen(body: readonly string[]): string {
  return ['screen Home:', '', ...body, ''].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

test('a screen takes parameters, which become its constructor', () => {
  const file = sourceFile('detail.pui', DETAIL);
  const { program, bag } = parse(file);
  assert.deepEqual(codes(bag.diagnostics), []);
  const screen = program.decls.find((decl) => decl.kind === 'Screen');
  assert.ok(screen !== undefined && screen.kind === 'Screen');
  assert.deepEqual(
    screen.params.map((param) => [param.name, param.typeText]),
    [
      ['id', 'String'],
      ['title', 'String'],
    ],
  );

  const code = compileOne('detail.pui', DETAIL).code!;
  assert.match(code, /const Detail\(\{super\.key, required this\.id, this\.title = "Task"\}\);/);
  assert.match(code, /final String id;/);
  assert.match(code, /final String title;/);
});

test('a parameter is a field the tree reads, and `widget.` inside state', () => {
  const stateless = compileOne('detail.pui', DETAIL).code!;
  assert.match(stateless, /Text\(title\)/);

  const stateful = compileOne(
    'list.pui',
    ['screen Listing(kind: String):', '', '    state items: List<String> = []', '', '    column:', '', '        text kind', ''].join('\n'),
  ).code!;
  assert.match(stateful, /Text\(widget\.kind\)/);
  assert.match(stateful, /final String kind;/);
});

// ---------------------------------------------------------------------------------------------
// The generated push
// ---------------------------------------------------------------------------------------------

test('navigate emits a typed push, not a route name', () => {
  const code = compileOne(
    'home.pui',
    [
      'screen Home:',
      '',
      '    column:',
      '',
      '        button "Open":',
      '            on tap: navigate Detail(id: "42")',
      '',
      DETAIL,
    ].join('\n'),
  ).code!;

  assert.match(code, /Navigator\.push\(/);
  assert.match(code, /MaterialPageRoute<void>\(/);
  assert.match(code, /builder: \(_\) => Detail\(id: "42"\)/);
  // No route strings, no `pushNamed`: the screen's own constructor is the route.
  assert.doesNotMatch(code, /pushNamed|settings\.name/);
});

test('back() pops, and tolerates being the first screen', () => {
  const code = compileOne('detail.pui', DETAIL).code!;
  assert.match(code, /Navigator\.maybePop\(context\)/);
});

test('navigation inside an if is emitted inside the branch', () => {
  const code = compileOne(
    'home.pui',
    oneScreen([
      '    state signedIn: bool = false',
      '',
      '    column:',
      '',
      '        button "Go":',
      '            on tap:',
      '                if signedIn:',
      '                    navigate Detail(id: "1")',
      '                else:',
      '                    back()',
      '',
      DETAIL,
    ]),
  ).code!;
  assert.match(code, /if \(signedIn\) \{/);
  assert.match(code, /Navigator\.push\(/);
  assert.match(code, /Navigator\.maybePop\(context\);/);
});

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

test('an unknown screen is reported where it is written', () => {
  assert.deepEqual(errors(oneScreen(['    column:', '', '        button "Go":', '            on tap: navigate Missing()'])), [
    'PUI2320',
  ]);
  assert.match(hints(oneScreen(['    column:', '', '        button "Go":', '            on tap: navigate Missing()'])).join(' '), /Detail|screens in scope|declare one/);
});

test('navigating to a component says so, instead of pretending it is unknown', () => {
  const text = [
    'component Row1(text: String):',
    '',
    '    text text',
    '',
    'screen Home:',
    '',
    '    column:',
    '',
    '        button "Go":',
    '            on tap: navigate Row1()',
    '',
  ].join('\n');
  assert.deepEqual(errors(text), ['PUI2320']);
  assert.match(hints(text).join(' '), /is a component; navigate takes a screen/);
});

test('required arguments must be supplied, and only declared ones may be', () => {
  assert.deepEqual(errors(oneScreen(['    column:', '', '        button "Go":', '            on tap: navigate Detail()', '', DETAIL])), [
    'PUI2322',
  ]);
  assert.deepEqual(
    errors(oneScreen(['    column:', '', '        button "Go":', '            on tap: navigate Detail(id: "1", nope: 2)', '', DETAIL])),
    ['PUI2322'],
  );
});

test('argument types are checked against the parameter', () => {
  assert.deepEqual(errors(oneScreen(['    column:', '', '        button "Go":', '            on tap: navigate Detail(id: 5)', '', DETAIL])), [
    'PUI2110',
  ]);
});

test('navigation outside an event handler is refused', () => {
  // A value position: building a tree must not navigate.
  const text = oneScreen(['    column:', '', '        text navigate Detail(id: "1")', '', DETAIL]);
  assert.ok(errors(text).includes('PUI2321'), `expected PUI2321, got ${errors(text).join(', ')}`);

  // Assigning the result of a navigation is the same mistake in another shape.
  const assigned = oneScreen([
    '    state go: String = ""',
    '',
    '    column:',
    '',
    '        button "Go":',
    '            on tap: set go = navigate Detail(id: "1")',
    '',
    DETAIL,
  ]);
  assert.ok(errors(assigned).includes('PUI2321'), `expected PUI2321, got ${errors(assigned).join(', ')}`);
});

test('back() takes no arguments', () => {
  assert.deepEqual(errors(oneScreen(['    column:', '', '        button "Go":', '            on tap: back(1)'])), ['PUI2323']);
});

// ---------------------------------------------------------------------------------------------
// Across files, and the route table
// ---------------------------------------------------------------------------------------------

function project(): ReturnType<typeof compileProject> {
  return compileProject(
    [
      { path: 'lib/ui/detail.pui', text: DETAIL },
      { path: 'lib/ui/home.pui', text: ['import "detail.pui"', '', HOME].join('\n') },
    ],
    { outDir: 'lib/generated' },
  );
}

test('a screen in an imported file is a navigation target, and is imported by the output', () => {
  const result = project();
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    [],
  );
  const home = result.files.find((file) => file.source.path === 'lib/ui/home.pui')!;
  assert.match(home.code!, /import 'detail\.pui\.dart';/);
  assert.match(home.code!, /builder: \(_\) => Detail\(id: "1"\)/);
});

test('a screen that is not imported is not reachable', () => {
  const result = compileProject(
    [
      { path: 'lib/ui/detail.pui', text: DETAIL },
      { path: 'lib/ui/home.pui', text: HOME }, // no import
    ],
    { outDir: 'lib/generated' },
  );
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    ['PUI2320'],
  );
});

test('the project gets a route table when it navigates', () => {
  const result = project();
  assert.ok(result.routes !== undefined);
  assert.equal(result.routes.outputPath, `lib/generated/${ROUTES_FILE}`);
  const routes = result.routes.code;
  assert.match(routes, /final Map<String, Widget Function\(Map<String, Object\?>\)> puiRoutes/);
  assert.match(routes, /'Detail': \(args\) => Detail\(id: args\['id'\]! as String, title: args\['title'\] as String\? \?\? "Task"\)/);
  assert.match(routes, /'Home': \(args\) => const Home\(\)/);
  // Deterministic: the project's source order decides nothing.
  assert.ok(routes.indexOf("'Detail'") < routes.indexOf("'Home'"));
});

test('a project that does not navigate gets no route table', () => {
  const result = compileProject(
    [{ path: 'lib/ui/home.pui', text: oneScreen(['    column:', '', '        text "No navigation here"']) }],
    { outDir: 'lib/generated' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.routes, undefined);
});

test('screens with a non-literal default keep it instead of casting nothing', () => {
  const result = compileProject(
    [
      { path: 'lib/ui/a.pui', text: 'screen A(seed: int = someHostValue):\n\n    column:\n\n        text "${seed}"\n' },
      { path: 'lib/ui/b.pui', text: 'import "a.pui"\n\nscreen B:\n\n    column:\n\n        button "Go":\n            on tap: navigate A()\n' },
    ],
    { outDir: 'lib/generated' },
  );
  assert.equal(result.ok, true, result.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  assert.match(result.routes!.code, /'A': \(args\) => const A\(\)/);
  assert.match(result.routes!.code, /keeps its default for "seed"/);
});

// ---------------------------------------------------------------------------------------------
// HTML preview
// ---------------------------------------------------------------------------------------------

test('the preview holds every screen and links between them', () => {
  const file = sourceFile('nav.pui', [DETAIL, HOME].join('\n'));
  const { program } = parse(file);
  const analysis = check(file, program, {}).analysis;
  const html = generateHtml(analysis).code;

  assert.match(html, /<section class="pui-page" id="pui-screen-Detail" data-screen="Detail">/);
  assert.match(html, /<section class="pui-page" id="pui-screen-Home" data-screen="Home">/);
  // navigate → a link to the target, back() → a link to the screen the preview opened on.
  assert.match(html, /<a class="pui-button" href="#pui-screen-Detail"/);
  assert.match(html, /href="#pui-screen-Detail"/);
  // No JavaScript: the stack is the document's own :target state.
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /\.pui-page:target \{ display: block; \}/);
  // A parameter has no value in a preview, so its slot is marked rather than invented.
  assert.match(html, /\{id\}/);
});

test('a single screen that does not navigate renders exactly as before', () => {
  const file = sourceFile('one.pui', oneScreen(['    column:', '', '        text "Hello"']));
  const { program } = parse(file);
  const analysis = check(file, program, {}).analysis;
  const html = generateHtml(analysis).code;
  assert.doesNotMatch(html, /<section/);
  assert.match(html, /<main class="pui-root" data-screen="Home">/);
});
