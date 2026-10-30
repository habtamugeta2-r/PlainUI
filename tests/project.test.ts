/**
 * Project compilation: imports across files, generated import paths, and the project-level
 * diagnostics that only make sense once more than one file is compiled together.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { compileOne, compileProject, outputPathFor } from '../src/project.ts';
import type { Diagnostic } from '../src/diagnostics.ts';

const codes = (diagnostics: readonly Diagnostic[]): string[] => diagnostics.map((d) => d.code);

const SHELL = [
  'component Shell(title: String, children: List<Widget>):',
  '    card padding=16:',
  '        text title',
  '        slot',
  '',
].join('\n');

const HOME = ['import "shell.pui"', '', 'screen Home:', '    Shell("hi"):', '        text "child"', ''].join('\n');

test('output paths are named after the source file', () => {
  assert.equal(outputPathFor('lib/ui/home.pui'), 'lib/generated/home.pui.dart');
  assert.equal(outputPathFor('app/home.pui', 'lib/dart'), 'lib/dart/home.pui.dart');
});

test('a component imported from another file compiles in both files', () => {
  const result = compileProject([
    { path: 'lib/ui/home.pui', text: HOME },
    { path: 'lib/ui/shell.pui', text: SHELL },
  ]);

  assert.deepEqual(codes(result.diagnostics), []);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.files.map((file) => file.outputPath),
    ['lib/generated/home.pui.dart', 'lib/generated/shell.pui.dart'],
  );

  const home = result.files[0]!.code!;
  assert.match(home, /import 'shell\.pui\.dart';/);
  assert.match(home, /title: "hi"/);
  assert.match(home, /children: <Widget>\[/);
  assert.match(home, /Text\("child"\)/);

  const shell = result.files[1]!.code!;
  assert.match(shell, /class Shell extends StatelessWidget/);
  assert.match(shell, /List<Widget> children/);
  assert.doesNotMatch(shell, /import 'shell\.pui\.dart'/);
});

test('components in the same file keep working without an import', () => {
  const result = compileProject([
    {
      path: 'lib/ui/page.pui',
      text: ['component Chip(label: String):', '    text label', '', 'screen Page:', '    Chip("x")', ''].join('\n'),
    },
  ]);
  assert.equal(result.ok, true);
  assert.match(result.files[0]!.code!, /Chip\(label: "x"\)/);
});

test('host imports are re-based from the source directory to the output directory', () => {
  const source = ['import "../widgets/app_logo.dart"', '', 'screen Home:', '    AppLogo()', ''].join('\n');

  const flat = compileProject([{ path: 'lib/ui/home.pui', text: source }]);
  assert.equal(flat.ok, true);
  assert.match(flat.files[0]!.code!, /^import '\.\.\/widgets\/app_logo\.dart';$/m);

  const deep = compileProject([{ path: 'lib/ui/home.pui', text: source }], { outDir: 'lib/generated/ui' });
  assert.match(deep.files[0]!.code!, /^import '\.\.\/\.\.\/widgets\/app_logo\.dart';$/m);
});

test('package and dart imports are passed through untouched', () => {
  const result = compileProject([
    {
      path: 'lib/ui/home.pui',
      text: ['import "package:go_router/go_router.dart"', 'import "dart:math"', '', 'screen Home:', '    text "x"', ''].join('\n'),
    },
  ]);
  assert.equal(result.ok, true);
  assert.match(result.files[0]!.code!, /^import 'package:go_router\/go_router\.dart';$/m);
  assert.match(result.files[0]!.code!, /^import 'dart:math';$/m);
});

test('an imported host library makes its top level names available', () => {
  const text = ['import "../state/app_state.dart"', '', 'screen Home:', '    text appState.name', ''].join('\n');

  const withImport = compileProject([{ path: 'lib/ui/home.pui', text }]);
  assert.deepEqual(codes(withImport.diagnostics), []);

  const withoutImport = compileProject([
    { path: 'lib/ui/home.pui', text: ['screen Home:', '    text appState.name', ''].join('\n') },
  ]);
  assert.equal(withoutImport.ok, false);
});

test('an import that points nowhere is reported with the resolved path', () => {
  const result = compileProject([
    { path: 'lib/ui/home.pui', text: ['import "missing.pui"', '', 'screen Home:', '    text "x"', ''].join('\n') },
  ]);
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find((d) => d.code === 'PUI3001');
  assert.ok(diagnostic !== undefined);
  assert.match(diagnostic.message, /missing\.pui/);
  assert.match(diagnostic.hint ?? '', /lib\/ui\/missing\.pui/);
  assert.equal(result.files[0]!.code, undefined);
});

test('a capitalised element that is not imported is treated as a host widget', () => {
  const result = compileProject([
    { path: 'lib/ui/home.pui', text: ['screen Home:', '    Shell("hi"):', '        text "child"', ''].join('\n') },
    { path: 'lib/ui/shell.pui', text: SHELL },
  ]);

  // Uppercase names fall back to host Dart widgets, so this compiles — with a warning that says
  // so — and the single child is passed as `child:` rather than as a component's `children:`.
  assert.equal(result.ok, true);
  assert.deepEqual(codes(result.diagnostics), ['PUI2406']);
  const home = result.files[0]!.code!;
  assert.doesNotMatch(home, /import 'shell\.pui\.dart';/);
  assert.match(home, /Shell\("hi", child: Text\("child"\)\)/);
});

test('the same name in two files is a project level error', () => {
  const result = compileProject([
    { path: 'lib/ui/a.pui', text: 'screen Home:\n    text "a"\n' },
    { path: 'lib/ui/b.pui', text: 'screen Home:\n    text "b"\n' },
  ]);
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find((d) => d.code === 'PUI3101');
  assert.ok(diagnostic !== undefined);
  assert.match(diagnostic.message, /Home/);
  assert.match(diagnostic.message, /a\.pui/);
});

test('two sources that would generate the same file are rejected', () => {
  const result = compileProject([
    { path: 'lib/ui/home.pui', text: 'screen Home:\n    text "a"\n' },
    { path: 'lib/other/home.pui', text: 'screen Other:\n    text "b"\n' },
  ]);
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find((d) => d.code === 'PUI3102');
  assert.ok(diagnostic !== undefined);
  assert.match(diagnostic.message, /lib\/generated\/home\.pui\.dart/);
});

test('styles are file local', () => {
  const result = compileProject([
    { path: 'lib/ui/a.pui', text: ['style heading:', '    size=24', '', 'screen A:', '    text "a" style=heading', ''].join('\n') },
    { path: 'lib/ui/b.pui', text: ['screen B:', '    text "b" style=heading', ''].join('\n') },
  ]);
  assert.equal(result.ok, true);

  const a = result.files[0]!.code!;
  assert.match(a, /const TextStyle _puiStyleHeading = TextStyle\(fontSize: 24\);/);
  assert.match(a, /Text\("a", style: _puiStyleHeading\)/);

  // `heading` is also a Flutter theme style, so file B falls back to it instead of borrowing A's.
  const b = result.files[1]!.code!;
  assert.doesNotMatch(b, /_puiStyleHeading/);
  assert.match(b, /Theme\.of\(context\)\.textTheme\.headlineSmall/);
});

test('an unknown style name is an error', () => {
  const file = compileOne('lib/ui/a.pui', 'screen A:\n    text "x" style=nosuchstyle\n');
  assert.equal(file.code, undefined);
  assert.ok(file.diagnostics.some((d) => d.code === 'PUI2302'));
});

test('nothing is generated when any file has an error', () => {
  const result = compileProject([
    { path: 'lib/ui/good.pui', text: 'screen Good:\n    text "ok"\n' },
    { path: 'lib/ui/bad.pui', text: 'screen Bad:\n    nosuch:\n        text "x"\n' },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.files.every((file) => file.code === undefined && file.outputPath === undefined));
});

test('compilation is deterministic', () => {
  const inputs = [
    { path: 'lib/ui/home.pui', text: HOME },
    { path: 'lib/ui/shell.pui', text: SHELL },
  ];
  const byPath = (files: readonly { source: { path: string }; code?: string }[]): [string, string | undefined][] =>
    files.map((file) => [file.source.path, file.code] as [string, string | undefined]).sort((a, b) => a[0].localeCompare(b[0]));

  const first = byPath(compileProject(inputs).files);
  const second = byPath(compileProject([...inputs].reverse()).files);
  assert.deepEqual(first, second);
  assert.equal(compileProject(inputs).files[0]!.code, first.find(([path]) => path === 'lib/ui/home.pui')![1]);
});

test('compileOne is the single file convenience wrapper', () => {
  const file = compileOne('lib/ui/home.pui', 'screen Home:\n    text "hi"\n');
  assert.equal(file.source.path, 'lib/ui/home.pui');
  assert.equal(file.outputPath, 'lib/generated/home.pui.dart');
  assert.match(file.code!, /class Home extends StatelessWidget/);
  assert.deepEqual(file.diagnostics, []);

  const broken = compileOne('x.pui', 'screen Home:\n');
  assert.equal(broken.code, undefined);
  assert.ok(broken.diagnostics.length > 0);
});
