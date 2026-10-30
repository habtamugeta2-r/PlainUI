/**
 * The public API is a promise: everything below is what an embedder may rely on.
 *
 * This test exists because `src/index.ts` is a list of re-exports, and a list can drift — a rename
 * inside the compiler would leave the entry point exporting a name that no longer exists (caught by
 * `tsc`), or silently stop exporting something useful (not caught by anything else).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import * as api from '../src/index.ts';

test('the public API exposes the compiler surface', () => {
  const expected = [
    'CODES',
    'COMPILER_VERSION',
    'ProjectCache',
    'UNIVERSAL_PROPS',
    'WIDGETS',
    'WIDGET_TAGS',
    'check',
    'compileOne',
    'compileProject',
    'compileSource',
    'formatText',
    'generateFlutter',
    'generateHtml',
    'outputPathFor',
    'parse',
    'sourceFile',
    'toJsonDiagnostic',
    'tokenize',
    'widgetSpec',
  ];
  for (const name of expected) {
    assert.ok(name in api, `src/index.ts should export ${name}`);
  }
});

test('the public API is enough to compile, format and inspect', () => {
  const source = ['screen Home:', '', '    state count: int = 0', '    text count', ''].join('\n');

  const result = api.compileOne('lib/ui/home.pui', source);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.code?.includes('class Home extends StatefulWidget'));
  assert.equal(result.outputPath, 'lib/generated/home.pui.dart');

  const project = api.compileProject([{ path: 'lib/ui/home.pui', text: source }], { outDir: 'lib/generated' });
  assert.equal(project.ok, true);
  assert.equal(project.files.length, 1);

  const formatted = api.formatText('lib/ui/home.pui', 'screen  Home:\n  text   "x"\n');
  assert.equal(formatted.text, 'screen Home:\n    text "x"\n');

  const broken = api.compileSource('screen Home:\n    colum:\n        text "x"\n', { path: 'lib/ui/home.pui' });
  assert.equal(broken.ok, false);
  const unknown = broken.diagnostics.find((diagnostic) => diagnostic.code === 'PUI2001');
  assert.ok(unknown, 'expected PUI2001');
  assert.match(unknown.hint ?? '', /column/);
});

test('the widget catalogue is readable from the API', () => {
  assert.ok(api.WIDGET_TAGS.length >= 20);
  const text = api.widgetSpec('text');
  assert.ok(text);
  assert.equal(text.tag, 'text');
  assert.ok(api.UNIVERSAL_PROPS.some((prop) => prop.name === 'padding'));
  assert.ok('PUI2001' in api.CODES);
});
