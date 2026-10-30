import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFile } from '../src/frontend/source.ts';
import { migrateTypes } from '../src/tooling/migrate.ts';

test('migration rewrites old primitive spellings only inside type annotations', () => {
  const input = [
    '// String and int in a comment stay as written',
    'import "../data.dart" as data:',
    '    load(name: String, count: int) -> Future<List<double>>',
    '',
    'component Label(title: String, enabled: bool = true):',
    '    text "String int double bool"',
    '    text title',
    '',
    'screen Home:',
    '    state count: int = 0',
    '    derived total: double = count * 2',
    '    text "${count}"',
    '',
  ].join('\n');
  const result = migrateTypes(sourceFile('home.pui', input));
  assert.equal(result.changed, true);
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.text, /load\(name: Text, count: Int\) -> Future<List<Float>>/);
  assert.match(result.text, /component Label\(title: Text, enabled: Bool = true\)/);
  assert.match(result.text, /state count: Int = 0/);
  assert.match(result.text, /derived total: Float = count \* 2/);
  assert.match(result.text, /\/\/ String and int in a comment stay as written/);
  assert.match(result.text, /text "String int double bool"/);
  assert.match(result.text, /"\$\{count\}"/);
  assert.equal(migrateTypes(sourceFile('home.pui', result.text)).changed, false);
});

test('migration does not modify syntactically invalid input', () => {
  const result = migrateTypes(sourceFile('broken.pui', 'screen Home:\n    column gap=\n'));
  assert.equal(result.changed, false);
  assert.equal(result.text, 'screen Home:\n    column gap=\n');
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error'), true);
});
