/**
 * Golden files.
 *
 * Each `tests/golden/*.pui` is compiled to `tests/golden/expected/*.pui.dart` and rendered to
 * `tests/golden/expected/*.pui.html`. The expected files are the review surface: a change in the
 * generated code has to show up as a diff in review, not as a quietly different build.
 *
 * Run with UPDATE_GOLDENS=1 to rewrite them:
 *
 *     UPDATE_GOLDENS=1 npm test
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { generateHtml } from '../src/codegen/html.ts';
import { check } from '../src/analysis/check.ts';
import { formatText } from '../src/tooling/format.ts';
import { parse } from '../src/frontend/parser.ts';
import { compileOne } from '../src/project/project.ts';
import { sourceFile } from '../src/frontend/source.ts';
import { checkDartStructure } from './dart-syntax.ts';

const GOLDEN_DIR = 'tests/golden';
const EXPECTED_DIR = join(GOLDEN_DIR, 'expected');
const OUT_DIR = EXPECTED_DIR;
const UPDATE = process.env['UPDATE_GOLDENS'] === '1';

const goldenFiles = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith('.pui'))
  .sort();

assert.ok(goldenFiles.length > 0, 'tests/golden has no .pui files');

function compare(expectedPath: string, actual: string): void {
  if (UPDATE) {
    writeFileSync(expectedPath, actual, 'utf8');
    return;
  }
  let expected: string;
  try {
    expected = readFileSync(expectedPath, 'utf8');
  } catch {
    assert.fail(`${expectedPath} is missing — run UPDATE_GOLDENS=1 npm test`);
  }
  assert.equal(
    actual,
    expected,
    `${expectedPath} is out of date.\n` +
      'If the change is intended, run UPDATE_GOLDENS=1 npm test and review the diff.\n',
  );
}

for (const name of goldenFiles) {
  const stem = name.replace(/\.pui$/, '');
  const path = join(GOLDEN_DIR, name);

  test(`golden ${name} is formatted`, () => {
    const text = readFileSync(path, 'utf8');
    const result = formatText(path, text);
    assert.equal(result.skipped, false);
    assert.equal(result.changed, false, `${path} is not in canonical form — run plainui format`);
  });

  test(`golden ${name} compiles to Dart`, () => {
    const text = readFileSync(path, 'utf8');
    const file = compileOne(path, text, { outDir: OUT_DIR });

    assert.deepEqual(
      file.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
      [],
      'golden sources must compile without errors',
    );
    assert.ok(file.code !== undefined, 'expected generated Dart');

    // Structural sanity: a fixture cannot lock in unbalanced braces or misplaced children.
    assert.deepEqual(checkDartStructure(file.code!), []);

    compare(join(EXPECTED_DIR, `${name}.dart`), file.code!);
  });

  test(`golden ${name} renders to HTML`, () => {
    const text = readFileSync(path, 'utf8');
    const source = sourceFile(path, text);
    const parsed = parse(source);
    const analysis = check(source, parsed.program, {});
    assert.equal(analysis.bag.hasErrors, false);

    const html = generateHtml(analysis.analysis).code;
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>\n$/);
    compare(join(EXPECTED_DIR, `${name}.html`), html);
  });
}

test('every expected file belongs to a golden source', () => {
  const expected = readdirSync(EXPECTED_DIR);
  const stems = new Set(goldenFiles.map((name) => name.replace(/\.pui$/, '')));
  for (const name of expected) {
    const stem = name.replace(/\.pui\.(dart|html)$/, '');
    assert.ok(stems.has(stem), `${EXPECTED_DIR}/${name} has no matching .pui source`);
  }
});
