/**
 * The CLI is tested through `main()` with captured stdio, so the tests cover the same code path
 * a user runs — including exit codes and the files left on disk.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';

import { main } from '../src/tooling/cli.ts';
import { COMPILER_VERSION } from '../src/project/compile.ts';

const scratch = mkdtempSync(join(tmpdir(), 'plainui-cli-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

async function run(args: readonly string[], cwd = scratch): Promise<Run> {
  let out = '';
  let err = '';
  const originalCwd = process.cwd();
  process.chdir(cwd);
  type Write = typeof process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as Write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as Write;
  try {
    const code = await main(args);
    return { code, out, err };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    process.chdir(originalCwd);
  }
}

let counter = 0;
function project(files: Record<string, string>): string {
  counter += 1;
  const directory = join(scratch, `p${counter}`);
  mkdirSync(directory, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(directory, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, text, 'utf8');
  }
  return directory;
}

const HOME = [
  'screen Home:',
  '',
  '    state count: int = 0',
  '',
  '    column padding=24:',
  '        text "PlainUI"',
  '        text count',
  '',
].join('\n');

// ------------------------------------------------------------------------------------------------

test('init writes a config and a starter screen, and keeps existing files', async () => {
  const directory = join(scratch, 'init');
  mkdirSync(directory, { recursive: true });

  const first = await run(['init'], directory);
  assert.equal(first.code, 0);
  assert.match(first.out, /created plainui\.config\.json/);
  assert.equal(existsSync(join(directory, 'plainui.config.json')), true);
  assert.equal(existsSync(join(directory, 'lib/ui/home.pui')), true);

  writeFileSync(join(directory, 'lib/ui/home.pui'), 'screen Mine:\n    text "kept"\n', 'utf8');
  const second = await run(['init'], directory);
  assert.equal(second.code, 0);
  assert.match(second.out, /already exists — left untouched/);
  assert.match(readFileSync(join(directory, 'lib/ui/home.pui'), 'utf8'), /kept/);
});

test('build writes Dart next to the configured output directory', async () => {
  const directory = project({ 'plainui.config.json': '{ "srcDir": "lib/ui" }\n', 'lib/ui/home.pui': HOME });

  const first = await run(['build'], directory);
  assert.equal(first.code, 0);
  assert.match(first.out, /1 compiled, 1 written, 0 unchanged/);

  const dart = readFileSync(join(directory, 'lib/generated/home.pui.dart'), 'utf8');
  assert.match(dart, /GENERATED FILE/);
  assert.match(dart, /class Home extends StatefulWidget/);

  const second = await run(['build'], directory);
  assert.equal(second.code, 0);
  assert.match(second.out, /1 compiled, 0 written, 1 unchanged/);
});

test('build --out overrides the output directory', async () => {
  const directory = project({ 'lib/ui/home.pui': HOME });
  const result = await run(['build', 'lib/ui', '--out', 'lib/dart'], directory);
  assert.equal(result.code, 0);
  assert.equal(existsSync(join(directory, 'lib/dart/home.pui.dart')), true);
});

test('build reports errors and writes nothing', async () => {
  const directory = project({ 'lib/ui/broken.pui': 'screen Home:\n    nonsuch:\n        text "x"\n' });
  const result = await run(['build', 'lib/ui'], directory);
  assert.equal(result.code, 1);
  assert.match(result.err, /error/);
  assert.match(result.err, /PUI2001/);
  assert.match(result.err, /no files were written/);
  assert.equal(existsSync(join(directory, 'lib/generated/broken.pui.dart')), false);
});

test('build --check exits 3 when the generated file is stale', async () => {
  const directory = project({ 'lib/ui/home.pui': HOME });
  assert.equal((await run(['build', 'lib/ui'], directory)).code, 0);
  assert.equal((await run(['build', 'lib/ui', '--check'], directory)).code, 0);

  writeFileSync(join(directory, 'lib/generated/home.pui.dart'), '// hand edited\n', 'utf8');
  const stale = await run(['build', 'lib/ui', '--check'], directory);
  assert.equal(stale.code, 3);
  assert.match(stale.err, /out of date/);
});

test('check exits 0 on clean input and 1 on errors', async () => {
  const clean = project({ 'lib/ui/home.pui': HOME });
  const ok = await run(['check', 'lib/ui'], clean);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /no problems/);

  const broken = project({ 'lib/ui/home.pui': 'screen Home:\n    text\n' });
  const bad = await run(['check', 'lib/ui'], broken);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /PUI2/);
});

test('--json emits one machine readable object per diagnostic', async () => {
  const directory = project({ 'lib/ui/home.pui': 'screen Home:\n    nonsuch:\n        text "x"\n' });
  const result = await run(['check', 'lib/ui', '--json'], directory);
  assert.equal(result.code, 1);
  const lines = result.out.trim().split('\n').filter((line) => line.startsWith('{'));
  assert.ok(lines.length >= 1, `expected JSON diagnostics, got: ${result.out}`);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(typeof parsed['code'], 'string');
  assert.equal(parsed['severity'], 'error');
  assert.equal((parsed['start'] as { line: number }).line, 2);
  assert.equal(typeof parsed['file'], 'string');
});

test('format rewrites files, --check reports and --stdout prints', async () => {
  const sloppy = 'screen  Home:\n      text   "hi"   style=heading\n';
  const directory = project({ 'lib/ui/home.pui': sloppy });

  const check = await run(['format', 'lib/ui', '--check'], directory);
  assert.equal(check.code, 3);
  assert.match(check.err, /PUI4003/);
  assert.match(check.err, /need formatting/);

  const printed = await run(['format', 'lib/ui', '--stdout'], directory);
  assert.equal(printed.code, 0);
  assert.equal(printed.out, 'screen Home:\n    text "hi" style=heading\n');

  const written = await run(['format', 'lib/ui'], directory);
  assert.equal(written.code, 0);
  assert.equal(readFileSync(join(directory, 'lib/ui/home.pui'), 'utf8'), 'screen Home:\n    text "hi" style=heading\n');
  assert.equal((await run(['format', 'lib/ui', '--check'], directory)).code, 0);
});

test('format leaves files that do not parse untouched', async () => {
  const broken = 'screen Home:\n    text "unterminated\n';
  const directory = project({ 'lib/ui/home.pui': broken });
  const result = await run(['format', 'lib/ui'], directory);
  assert.equal(result.code, 0);
  assert.match(result.err, /does not parse/);
  assert.equal(readFileSync(join(directory, 'lib/ui/home.pui'), 'utf8'), broken);
});

test('components can live in another file', async () => {
  const directory = project({
    'lib/ui/home.pui': ['import "shell.pui"', '', 'screen Home:', '    Shell("hi"):', '        text "child"', ''].join('\n'),
    'lib/ui/shell.pui': [
      'import "shell.dart"',
      '',
      'component Shell(title: String, children: List<Widget>):',
      '    card padding=16:',
      '        text title',
      '        slot',
      '',
    ].join('\n'),
    'lib/ui/shell.dart': 'class Shell {}\n',
  });
  const result = await run(['build', 'lib/ui'], directory);
  assert.equal(result.code, 0, result.err);
  const home = readFileSync(join(directory, 'lib/generated/home.pui.dart'), 'utf8');
  assert.match(home, /import 'shell\.pui\.dart';/);
  assert.match(home, /Shell\(/);
  assert.match(home, /title: "hi"/);
});

test('usage and introspection commands', async () => {
  const version = await run(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.out.trim(), COMPILER_VERSION);

  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /plainui <command>/);

  const unknown = await run(['nonsense']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command/);

  const explain = await run(['explain', 'PUI2001']);
  assert.equal(explain.code, 0);
  assert.match(explain.out, /Unknown element/);

  const missing = await run(['explain', 'PUI9999']);
  assert.equal(missing.code, 2);

  const widgets = await run(['widgets']);
  assert.equal(widgets.code, 0);
  assert.match(widgets.out, /column/);
  assert.match(widgets.out, /built-in elements/);
});

test('ast and tokens describe a single file', async () => {
  const directory = project({ 'lib/ui/home.pui': HOME });
  const ast = await run(['ast', 'lib/ui/home.pui'], directory);
  assert.equal(ast.code, 0);
  assert.match(ast.out, /screen Home/);

  const tokens = await run(['tokens', 'lib/ui/home.pui'], directory);
  assert.equal(tokens.code, 0);
  assert.match(tokens.out, /screen/);

  const missing = await run(['ast']);
  assert.equal(missing.code, 2);
});

test('a missing directory is reported instead of crashing', async () => {
  const directory = project({});
  const result = await run(['build', 'nowhere'], directory);
  assert.equal(result.code, 1);
  assert.match(result.err, /no such file or directory/);
});

test('a path that holds its own configuration is treated as its own project', async () => {
  const outer = project({ 'plainui.config.json': '{ "srcDir": "lib/ui" }\n' });
  const inner = join(outer, 'packages/app');
  const config = join(inner, 'plainui.config.json');
  mkdirSync(join(inner, 'lib/ui'), { recursive: true });
  writeFileSync(config, '{ "srcDir": "lib/ui", "outDir": "lib/generated" }\n', 'utf8');
  writeFileSync(join(inner, 'lib/ui/home.pui'), HOME, 'utf8');

  // Run from the outer project, build the inner one by path.
  const result = await run(['build', 'packages/app'], outer);
  assert.equal(result.code, 0, result.err);
  assert.equal(existsSync(join(inner, 'lib/generated/home.pui.dart')), true);
  assert.equal(existsSync(join(outer, 'lib/generated/home.pui.dart')), false);
});

test('running from a subdirectory uses the configuration above it', async () => {
  const directory = project({ 'plainui.config.json': '{ "srcDir": "lib/ui" }\n', 'lib/ui/home.pui': HOME });
  const result = await run(['build'], join(directory, 'lib/ui'));
  assert.equal(result.code, 0, result.err);
  assert.equal(existsSync(join(directory, 'lib/generated/home.pui.dart')), true);
});

test('an absolute --out is used as given', async () => {
  const directory = project({ 'lib/ui/home.pui': HOME });
  const out = join(scratch, 'absolute-out');
  const result = await run(['build', 'lib/ui', '--out', out], directory);
  assert.equal(result.code, 0, result.err);
  assert.equal(existsSync(join(out, 'home.pui.dart')), true);
});

test('an invalid configuration is reported', async () => {
  const directory = project({ 'plainui.config.json': '{ "target": "android" }\n', 'lib/ui/home.pui': HOME });
  const result = await run(['build', 'lib/ui'], directory);
  assert.equal(result.code, 2);
  assert.match(result.err, /unsupported target/);
});

test('the relative path helper used by the CLI is stable', () => {
  assert.equal(relative('/a/b', '/a/b/c/d.pui'), 'c/d.pui');
});

test('the CLI runs when invoked through a bin symlink', () => {
  // `node_modules/.bin/plainui` is a symlink whose name is not `cli.js`. An earlier guard compared
  // the file name, so the installed CLI printed nothing and exited 0 — invisible to every test
  // that called main() directly.
  const dir = mkdtempSync(join(tmpdir(), 'plainui-bin-'));
  try {
    const link = join(dir, 'plainui');
    symlinkSync(join(process.cwd(), 'src/tooling/cli.ts'), link);
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    const result = spawnSync(process.execPath, ['--experimental-strip-types', link, '--version'], {
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), COMPILER_VERSION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
