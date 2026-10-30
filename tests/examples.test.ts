/**
 * The examples are documentation that is executed. Every `examples/<name>` is compiled here, and
 * the seams that a reader would notice are checked too: host imports point at files that exist,
 * `main.dart` imports the generated file, and the output is structurally sane Dart.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { compileProject } from '../src/project/project.ts';
import { basename, extensionOf } from '../src/project/paths.ts';
import { checkDartStructure } from './dart-syntax.ts';

const EXAMPLES = 'examples';

interface ExampleProject {
  readonly name: string;
  readonly dir: string;
  readonly srcDir: string;
  readonly outDir: string;
}

function discover(): ExampleProject[] {
  return readdirSync(EXAMPLES)
    .filter((entry) => existsSync(join(EXAMPLES, entry, 'plainui.config.json')))
    .sort()
    .map((name) => {
      const dir = join(EXAMPLES, name);
      const config = JSON.parse(readFileSync(join(dir, 'plainui.config.json'), 'utf8')) as {
        srcDir?: string;
        outDir?: string;
      };
      return {
        name,
        dir,
        srcDir: config.srcDir ?? 'lib/ui',
        outDir: config.outDir ?? 'lib/generated',
      };
    });
}

function sources(project: ExampleProject): { path: string; text: string }[] {
  const root = join(project.dir, project.srcDir);
  const found: { path: string; text: string }[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (existsSync(full) && extensionOf(full) === '.pui') {
        found.push({
          path: `${project.srcDir}/${basename(full)}`.replace(/\\/g, '/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  visit(root);
  return found;
}

const projects = discover();

test('there is at least one example', () => {
  assert.ok(projects.length >= 2, 'expected a few example projects');
});

for (const project of projects) {
  test(`example ${project.name} compiles`, () => {
    const inputs = sources(project);
    assert.ok(inputs.length >= 1, `${project.name} has no .pui sources`);

    const result = compileProject(inputs, { outDir: project.outDir });
    assert.deepEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      [],
      `${project.name} must compile without errors`,
    );
    assert.equal(result.ok, true);

    for (const file of result.files) {
      assert.ok(file.code !== undefined);
      assert.deepEqual(checkDartStructure(file.code!), [], `${file.outputPath} is not structurally valid Dart`);
      // The generated file must be named after its source, in the configured output directory.
      assert.equal(file.outputPath?.startsWith(`${project.outDir}/`), true);
      assert.equal(file.outputPath?.endsWith(`${basename(file.source.path)}.dart`), true);
    }
  });

  test(`example ${project.name} imports files that exist`, () => {
    for (const source of sources(project)) {
      for (const match of source.text.matchAll(/^import "([^"]+)"/gm)) {
        const path = match[1]!;
        if (path.startsWith('package:') || path.startsWith('dart:')) continue;
        if (path.endsWith('.pui')) continue; // checked by the compiler
        const absolute = join(project.dir, project.srcDir, path);
        assert.equal(existsSync(absolute), true, `${source.path} imports ${path}, which does not exist`);
      }
    }
  });

  test(`example ${project.name} is wired up from main.dart`, () => {
    const mainPath = join(project.dir, 'lib/main.dart');
    assert.equal(existsSync(mainPath), true, `${project.name} needs a lib/main.dart`);
    const main = readFileSync(mainPath, 'utf8');

    const screens = sources(project)
      .flatMap((source) => [...source.text.matchAll(/^screen ([A-Z]\w*)/gm)].map((match) => match[1]!));

    assert.ok(screens.length >= 1, `${project.name} declares no screen`);
    for (const screen of screens) {
      assert.match(main, new RegExp(`\\b${screen}\\b`), `main.dart never uses ${screen}`);
    }

    const imports = [...main.matchAll(/^import '([^']+)'/gm)].map((match) => match[1]!);
    const generatedImport = imports.find((path) => path.includes('generated/'));
    assert.ok(generatedImport !== undefined, 'main.dart must import the generated widget');

    // Assert the wiring, not the state of the working tree: `npm run examples` may not have run
    // yet, and a test that depends on build order fails in CI (it did). The compiler is asked
    // which file it will write, and that path is what `main.dart` must import.
    const outputs = compileProject(sources(project), { outDir: project.outDir }).files.map((file) => file.outputPath);
    const imported = `lib/${generatedImport}`;
    assert.equal(
      outputs.includes(imported),
      true,
      `main.dart imports ${generatedImport}, but the compiler writes ${outputs.join(', ')}`,
    );
  });
}

test('generated example output is not committed', () => {
  const ignored = readFileSync('.gitignore', 'utf8');
  assert.match(ignored, /examples\/\*\*\/lib\/generated\//);
});
