/**
 * The capability matrix (decision C2).
 *
 * `"targets"` in `plainui.config.json` is a promise: every file in the project ports to every
 * target named there. This test is the promise's evidence — the matrix is computed, not asserted by
 * hand, and the table below records what each example proves today. When a construct gains a
 * lowering in a target, the table changes on purpose rather than by accident.
 *
 * A file can be blocked for two different reasons, and the codes keep them apart:
 *   PUI2501  the *build* target cannot express the construct at all
 *   PUI2502  the build target can, but one of the promised targets cannot (or only partly)
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { extensionOf } from '../src/project/paths.ts';
import { compileProject } from '../src/project/project.ts';
import { DEFAULT_CONFIG, loadConfig } from '../src/project/workspace.ts';
import { FLUTTER_TARGET, HTML_TARGET } from '../src/targets/index.ts';

const EXAMPLES = 'examples';

interface Example {
  readonly name: string;
  readonly srcDir: string;
  readonly inputs: readonly { path: string; text: string }[];
}

function examples(): Example[] {
  return readdirSync(EXAMPLES)
    .filter((entry) => existsSync(join(EXAMPLES, entry, 'plainui.config.json')))
    .sort()
    .map((name) => {
      const dir = join(EXAMPLES, name);
      const config = JSON.parse(readFileSync(join(dir, 'plainui.config.json'), 'utf8')) as {
        srcDir?: string;
      };
      const srcDir = config.srcDir ?? 'lib/ui';
      return {
        name,
        srcDir,
        inputs: readdirSync(join(dir, srcDir))
          .filter((file) => extensionOf(file) === '.pui')
          .map((file) => ({ path: `${srcDir}/${file}`, text: readFileSync(join(dir, srcDir, file), 'utf8') })),
      };
    });
}

/** The capabilities an example is blocked on when Flutter and the preview are both promised. */
function blockedOn(example: Example): { capabilities: string[]; codes: string[] } {
  const result = compileProject(example.inputs, { requiredTargets: [FLUTTER_TARGET, HTML_TARGET] });
  const codes = new Set<string>();
  const capabilities = new Set<string>();
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.code !== 'PUI2501' && diagnostic.code !== 'PUI2502') continue;
    codes.add(diagnostic.code);
    const named = /(?:supports|does not support) ([a-z-]+)$/.exec(diagnostic.message)?.[1];
    if (named !== undefined) capabilities.add(named);
    const needs = /needs ([a-z-]+), which/.exec(diagnostic.message)?.[1];
    if (needs !== undefined) capabilities.add(needs);
  }
  return { capabilities: [...capabilities].sort(), codes: [...codes].sort() };
}

/**
 * What the examples prove. `[]` means the project ports to Flutter *and* a static page; anything
 * else names the capabilities that stop it, exactly as a reader of the error would see them.
 */
const MATRIX: Record<string, string[]> = {
  async: ['host-surfaces', 'tasks'],
  counter: ['effects'],
  demo: ['effects', 'forms', 'host-surfaces', 'list-identity', 'navigation', 'tasks'],
  forms: ['forms'],
  gallery: [],
  navigation: ['list-identity', 'navigation'],
  todo: ['list-identity'],
};

test('the matrix covers every example, and every example in the matrix exists', () => {
  const names = examples().map((example) => example.name);
  assert.deepEqual(Object.keys(MATRIX).sort(), names);
});

for (const example of examples()) {
  test(`matrix: ${example.name}`, () => {
    const blocked = blockedOn(example);
    assert.deepEqual(blocked.capabilities, MATRIX[example.name], `${example.name} ports differently than the matrix says`);

    if (blocked.capabilities.length === 0) {
      assert.deepEqual(blocked.codes, [], `${example.name} should compile for both targets`);
      assert.equal(compileProject(example.inputs, {}).ok, true);
    } else {
      // The promise is broken by *portability*, never by the build target: Flutter is full everywhere.
      assert.deepEqual(blocked.codes, ['PUI2502'], `${example.name} must fail on portability, not on the build target`);
    }
  });
}

test('the portable example says so in its own config', () => {
  // `gallery` is the example a reader can point at: no effects, no tasks, no forms, no host calls,
  // so it is the one project that names two targets and still builds.
  const config = loadConfig(join(EXAMPLES, 'gallery', 'plainui.config.json'));
  assert.deepEqual(config.targets, ['flutter', 'html']);
});

test('a project that names a target it cannot have fails at load, not six files later', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plainui-targets-'));
  const write = (name: string, body: string): string => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  const bad = write('bad.json', JSON.stringify({ targets: ['flutter', 'swiftui'] }));
  assert.throws(() => loadConfig(bad), /unsupported target "swiftui" in .*bad\.json \(known: flutter, html\)/);

  const empty = write('empty.json', JSON.stringify({ targets: [] }));
  assert.throws(() => loadConfig(empty), /"targets" is empty/);

  const notArray = write('notarray.json', JSON.stringify({ targets: 'flutter' }));
  assert.throws(() => loadConfig(notArray), /"targets" must be an array/);

  // The older single-target spelling still works, and both forms deduplicate.
  const single = write('single.json', JSON.stringify({ target: 'html' }));
  assert.deepEqual(loadConfig(single).targets, ['html']);
  const duplicate = write('duplicate.json', JSON.stringify({ targets: ['flutter', 'flutter'] }));
  assert.deepEqual(loadConfig(duplicate).targets, ['flutter']);

  // No config at all is a Flutter project, not a portable one.
  assert.deepEqual(DEFAULT_CONFIG.targets, ['flutter']);
});

test('a required target only changes the verdict when it is actually promised', () => {
  const input = [{ path: 'lib/ui/counter.pui', text: 'screen Counter:\n\n    state count: int = 0\n\n    effect on count:\n        print("tick")\n\n    text "Hi"\n' }];
  assert.equal(compileProject(input, {}).ok, true);
  assert.equal(compileProject(input, { requiredTargets: [FLUTTER_TARGET] }).ok, true);
  const portable = compileProject(input, { requiredTargets: [FLUTTER_TARGET, HTML_TARGET] });
  assert.equal(portable.ok, false);
  assert.match(portable.diagnostics.map((d) => d.message).join('\n'), /"effect" is not portable: HTML preview does not support effects/);
});
