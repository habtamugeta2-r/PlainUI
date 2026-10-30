/**
 * The playground is a thin shell around the compiler, but "thin" still means the HTML, the
 * bundle and the examples have to agree with each other. These tests check the seams that a
 * browser would otherwise only reveal by breaking:
 *
 *   - every element id the script looks up exists in the markup;
 *   - the browser bundle builds and pulls in nothing from Node;
 *   - every bundled example compiles cleanly and is already formatted.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { build } from 'esbuild';

import { check } from '../src/check.ts';
import { formatText } from '../src/format.ts';
import { parse } from '../src/parser.ts';
import { compileOne } from '../src/project.ts';
import { sourceFile } from '../src/source.ts';
import { generateHtml } from '../src/codegen/html.ts';
import { EXAMPLES } from '../web/examples.ts';

const WEB = 'web';
const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const app = readFileSync(join(WEB, 'app.ts'), 'utf8');

const markupIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!));

test('every element the script looks up exists in the markup', () => {
  const lookups = new Set<string>([
    ...[...app.matchAll(/\$\s*<[^>]*>\('([^']+)'\)/g)].map((match) => match[1]!),
    ...[...app.matchAll(/\$('([^']+)')/g)].map((match) => match[1]!),
    ...[...app.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]!),
  ]);

  assert.ok(lookups.size >= 5, 'expected the script to look up several elements');
  const missing = [...lookups].filter((id) => !markupIds.has(id));
  assert.deepEqual(missing, [], `index.html has no element with these ids: ${missing.join(', ')}`);
});

test('the markup has no ids the script never uses, apart from tab panels', () => {
  const used = new Set<string>([
    ...[...app.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!),
    ...[...app.matchAll(/\$\((?:"|')([^"']+)(?:"|')\)/g)].map((match) => match[1]!),
  ]);
  const staticIds = [...markupIds].filter((id) => !id.startsWith('panel-') && !['source', 'highlight', 'gutter', 'status', 'diagnostics', 'preview', 'dart', 'html', 'examples'].includes(id));
  const unused = staticIds.filter((id) => !used.has(id) && !html.includes(`data-tab="${id}"`));
  assert.deepEqual(unused, [], `index.html declares ids the script never uses: ${unused.join(', ')}`);
});

test('the page loads the bundle and the stylesheet, and both exist', () => {
  assert.match(html, /<script src="\.\/dist\/app\.js"><\/script>/);
  assert.match(html, /href="\.\/style\.css"/);
  assert.match(readFileSync(join(WEB, 'style.css'), 'utf8'), /\.tok-keyword/);
  // No inline script: the playground must stay readable to a strict content security policy.
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
});

test('the browser bundle builds and imports nothing from Node', async () => {
  const result = await build({
    entryPoints: [join(WEB, 'app.ts')],
    write: false,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    metafile: true,
    logLevel: 'silent',
  });

  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.length > 5, 'expected the bundle to pull in the compiler');

  const nodeOnly = inputs.filter((path) => /^node:/.test(path) || path.startsWith('scripts/'));
  assert.deepEqual(nodeOnly, [], 'the playground must not bundle Node code');

  const output = result.outputFiles?.[0]?.text ?? '';
  assert.ok(output.length > 40_000, 'bundle looks suspiciously small');
  assert.doesNotMatch(output, /require\("node:/);
  // The compiler front end and both generators should be in there.
  assert.match(output, /GENERATED FILE/);
  assert.match(output, /<!doctype html>/);
});

test('every example compiles, is formatted, and previews', () => {
  assert.ok(EXAMPLES.length >= 2);
  const ids = new Set<string>();

  for (const example of EXAMPLES) {
    assert.equal(ids.has(example.id), false, `duplicate example id ${example.id}`);
    ids.add(example.id);

    const file = compileOne(`examples/${example.id}.pui`, example.source);
    assert.deepEqual(
      file.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      [],
      `${example.id} must compile with no diagnostics`,
    );
    assert.ok((file.code ?? '').length > 0);

    const formatted = formatText(`${example.id}.pui`, example.source);
    assert.equal(formatted.changed, false, `${example.id} is not in canonical form`);
    assert.equal(formatted.skipped, false);

    const source = sourceFile(`${example.id}.pui`, example.source);
    const parsed = parse(source);
    const analysis = check(source, parsed.program, {});
    const preview = generateHtml(analysis.analysis).code;
    assert.match(preview, /<main class="pui-root"/);
  }
});

test('the examples picker offers every example', () => {
  assert.match(app, /EXAMPLES/);
  assert.match(html, /id="examples"/);
});
