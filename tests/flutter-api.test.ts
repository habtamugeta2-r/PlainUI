/**
 * The generator promises ordinary, current Flutter: nothing deprecated, and a banner that says
 * which Flutter generation the file targets. There is no Flutter SDK in this environment, so the
 * analyzer cannot be the guard — this is: every line the compiler emits, including the examples,
 * is checked against a list of APIs Flutter has deprecated.
 *
 * `flutter-verify.yml` runs the real `dart analyze`; this test catches the same class of mistake
 * without a toolchain, and it costs milliseconds.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { compileSource } from '../src/project/compile.ts';
import { compileProject } from '../src/project/project.ts';

/** APIs removed or deprecated in Flutter 3.x, with what to write instead. */
const DEPRECATED: readonly (readonly [RegExp, string])[] = [
  [/\bwithOpacity\b/, 'use withValues(alpha: …) — withOpacity was deprecated in 3.27'],
  [/\btextScaleFactor\b/, 'read MediaQuery.textScalerOf(context) instead'],
  [/\bRaisedButton\b/, 'RaisedButton was removed in Flutter 3 — use ElevatedButton'],
  [/\bFlatButton\b/, 'FlatButton was removed in Flutter 3 — use TextButton'],
  [/\bOutlineButton\b/, 'OutlineButton was removed in Flutter 3 — use OutlinedButton'],
  [/\bWillPopScope\b/, 'WillPopScope was removed — use PopScope'],
  [/\bMediaQuery\.of\(context\)\.textScaleFactor\b/, 'MediaQuery.textScalerOf exists for this'],
];

function sourcesIn(dir: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourcesIn(full));
    } else if (entry.endsWith('.pui')) {
      found.push({ path: full.replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

function generatedSamples(): { name: string; code: string }[] {
  const samples: { name: string; code: string }[] = [];

  for (const source of sourcesIn('tests/golden')) {
    if (source.path.includes('/expected/')) continue;
    const result = compileSource(source.text, { path: source.path });
    assert.ok(result.code, `${source.path} should compile: ${result.diagnostics.map((d) => d.code).join(', ')}`);
    samples.push({ name: source.path, code: result.code });
  }

  for (const example of readdirSync('examples')) {
    const srcDir = join('examples', example, 'lib/ui');
    let files: { path: string; text: string }[];
    try {
      files = sourcesIn(srcDir);
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    const result = compileProject(files, { outDir: 'lib/generated' });
    for (const file of result.files) {
      if (file.code !== undefined) samples.push({ name: `${example}/${file.source.path}`, code: file.code });
    }
  }

  return samples;
}

test('generated Dart avoids deprecated Flutter APIs', () => {
  const samples = generatedSamples();
  assert.ok(samples.length >= 5, `expected several generated files, got ${samples.length}`);

  for (const sample of samples) {
    for (const [pattern, advice] of DEPRECATED) {
      // The banner line mentions APIs by name; only the code below it matters.
      const body = sample.code.split('\n').filter((line) => !line.startsWith('//')).join('\n');
      assert.doesNotMatch(body, pattern, `${sample.name} emits a deprecated API: ${advice}`);
    }
  }
});

test('every generated file declares the Flutter generation it targets', () => {
  for (const sample of generatedSamples()) {
    assert.match(sample.code, /^\/\/ Target: Flutter 3\.10\+ \/ Dart 3\./m, `${sample.name} has no target line`);
    assert.match(sample.code, /^\/\/ GENERATED FILE - DO NOT EDIT\.$/m, `${sample.name} has no do-not-edit banner`);
  }
});
