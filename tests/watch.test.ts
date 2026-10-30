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

const root = mkdtempSync(join(tmpdir(), 'plainui-watch-'));
after(() => rmSync(root, { recursive: true, force: true }));

const HOME = ['screen Home:', '', '    text "first"', ''].join('\n');

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
    ['--experimental-strip-types', 'src/cli.ts', 'watch', root],
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
