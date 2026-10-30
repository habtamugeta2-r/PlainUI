/**
 * `plainui watch` is the one command a unit test cannot call in-process: it only returns when it
 * is interrupted. This test spawns it, edits a file, and waits for the rebuild to land — the
 * behaviour, not the implementation.
 */

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { watchForChanges } from '../src/tooling/watch.ts';

const root = mkdtempSync(join(tmpdir(), 'plainui-watch-'));
after(() => rmSync(root, { recursive: true, force: true }));

const HOME = ['screen Home:', '', '    text "first"', ''].join('\n');

// Node's test runner marks every child with NODE_TEST_CONTEXT; a Node child that inherits it
// reports to the runner instead of behaving like a normal process.
const spawnEnv = { ...process.env };
delete spawnEnv['NODE_TEST_CONTEXT'];

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('watch rebuilds when a source file changes', { timeout: 30_000 }, async () => {
  writeFileSync(join(root, 'plainui.config.json'), '{ "srcDir": "lib/ui", "outDir": "lib/generated" }\n', 'utf8');
  mkdirSync(join(root, 'lib/ui'), { recursive: true });
  writeFileSync(join(root, 'lib/ui/home.pui'), HOME, 'utf8');

  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'src/tooling/cli.ts', 'watch', root],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });

  try {
    await waitFor(() => output.includes('watching') && output.includes('1 written'), 'the first build');
    const generated = join(root, 'lib/generated/home.pui.dart');
    assert.equal(existsSync(generated), true);
    assert.match(readFileSync(generated, 'utf8'), /Text\("first"\)/);

    writeFileSync(join(root, 'lib/ui/home.pui'), ['screen Home:', '', '    text "second"', ''].join('\n'), 'utf8');

    await waitFor(() => output.includes('change detected'), 'the change to be noticed');
    await waitFor(
      () => existsSync(generated) && readFileSync(generated, 'utf8').includes('Text("second")'),
      'the rebuilt output',
    );
    assert.match(readFileSync(generated, 'utf8'), /Text\("second"\)/);
  } finally {
    child.kill('SIGINT');
    await new Promise((resolve) => child.on('exit', resolve));
  }
});

test('watchForChanges reports .pui edits and ignores everything else', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plainui-watch-unit-'));
  try {
    writeFileSync(join(dir, 'home.pui'), 'screen Home:\n', 'utf8');

    const seen: string[][] = [];
    const watcher = watchForChanges({
      roots: [dir],
      onChange: (changed) => seen.push([...changed]),
      debounceMs: 10,
    });
    try {
      assert.ok(['recursive', 'per-directory', 'polling'].includes(watcher.mode), `unexpected mode ${watcher.mode}`);

      writeFileSync(join(dir, 'home.pui'), 'screen Home:\n    text "hi"\n', 'utf8');
      await waitFor(() => seen.length > 0, 'the first change');

      const first = seen[0]!;
      assert.equal(first.some((path) => path.endsWith('home.pui')), true, `expected home.pui, got ${first.join(', ')}`);

      const before = seen.length;
      writeFileSync(join(dir, 'notes.txt'), 'not a source file\n', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(seen.length, before, 'a .txt file should not trigger a rebuild');
    } finally {
      watcher.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('watch sees a file created in a new directory', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plainui-watch-new-'));
  try {
    writeFileSync(join(dir, 'plainui.config.json'), '{ "srcDir": "lib/ui", "outDir": "lib/generated" }\n', 'utf8');
    mkdirSync(join(dir, 'lib/ui'), { recursive: true });
    writeFileSync(join(dir, 'lib/ui/home.pui'), HOME, 'utf8');

    const child = spawn(process.execPath, ['--experimental-strip-types', 'src/tooling/cli.ts', 'watch', dir], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    });

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });

    try {
      await waitFor(() => output.includes('watching'), 'the watcher to start');
      mkdirSync(join(dir, 'lib/ui/parts'), { recursive: true });
      writeFileSync(join(dir, 'lib/ui/parts/header.pui'), 'component Header():\n    text "head"\n', 'utf8');

      await waitFor(
        () => existsSync(join(dir, 'lib/generated/header.pui.dart')),
        'the new file to be compiled',
      );
    } finally {
      child.kill('SIGINT');
      // A child that already exited never emits `exit` again, so the wait has a floor as well.
      await Promise.race([new Promise((resolve) => child.on('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ['recursive', 'per-directory', 'polling'] as const) {
  test(`watchForChanges reports edits in ${mode} mode`, { timeout: 20_000 }, async () => {
    // The fallbacks matter: a project on a network filesystem gets polling, and a platform without
    // recursive watching gets one watcher per directory. Both are exercised deliberately here.
    const dir = mkdtempSync(join(tmpdir(), `plainui-watch-${mode}-`));
    const previous = process.env['PLAINUI_WATCH_MODE'];
    process.env['PLAINUI_WATCH_MODE'] = mode;
    try {
      writeFileSync(join(dir, 'home.pui'), 'screen Home:\n', 'utf8');
      const seen: string[][] = [];
      const watcher = watchForChanges({ roots: [dir], onChange: (changed) => seen.push([...changed]), debounceMs: 10 });
      try {
        assert.equal(watcher.mode, mode);
        writeFileSync(join(dir, 'home.pui'), 'screen Home:\n    text "hi"\n', 'utf8');
        await waitFor(() => seen.length > 0, `the change in ${mode} mode`);
        assert.ok(seen[0]!.some((path) => path.endsWith('home.pui')));
      } finally {
        watcher.close();
      }
    } finally {
      if (previous === undefined) delete process.env['PLAINUI_WATCH_MODE'];
      else process.env['PLAINUI_WATCH_MODE'] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('an edit made while the first build is running is not lost', { timeout: 30_000 }, async () => {
  // The watcher starts before the first compile, so a save that lands during it must still be
  // picked up. With polling the baseline snapshot is taken at startup, which made this a real
  // miss rather than a theoretical one.
  const dir = mkdtempSync(join(tmpdir(), 'plainui-watch-race-'));
  try {
    writeFileSync(join(dir, 'plainui.config.json'), '{ "srcDir": "lib/ui", "outDir": "lib/generated" }\n', 'utf8');
    mkdirSync(join(dir, 'lib/ui'), { recursive: true });
    writeFileSync(join(dir, 'lib/ui/home.pui'), HOME, 'utf8');

    const child = spawn(process.execPath, ['--experimental-strip-types', 'src/tooling/cli.ts', 'watch', dir], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      output += chunk;
    });

    try {
      // No waiting: edit immediately, while the first build is still starting.
      writeFileSync(join(dir, 'lib/ui/home.pui'), ['screen Home:', '', '    text "edited immediately"', ''].join('\n'), 'utf8');
      const generated = join(dir, 'lib/generated/home.pui.dart');
      const compiled = (): boolean =>
        existsSync(generated) && readFileSync(generated, 'utf8').includes('edited immediately');
      try {
        await waitFor(compiled, 'the immediate edit to be compiled');
      } catch (error) {
        assert.fail(`${(error as Error).message}\n--- watcher output ---\n${output}`);
      }
    } finally {
      child.kill('SIGINT');
      // A child that already exited never emits `exit` again, so the wait has a floor as well.
      await Promise.race([new Promise((resolve) => child.on('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
