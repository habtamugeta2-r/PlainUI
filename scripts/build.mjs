// Builds the two published artefacts:
//
//   dist/cli.js    a single executable bundle (shebang, chmod 755) behind the `plainui` bin
//   dist/index.js  the public API as one ESM bundle, for `import { compileOne } from ...`
//   dist/types/    .d.ts files, post-processed so their relative imports point at .js
//
// The sources import each other with explicit `.ts` extensions so Node can run them directly with
// --experimental-strip-types during development. esbuild rewrites those specifiers in the bundle,
// and `tsc` does not rewrite them in declarations — hence the fix-up pass at the end, which is
// what makes the published types usable at all.

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from 'esbuild';

mkdirSync('dist', { recursive: true });

async function bundle(entry, outfile) {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
  });
  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  return { bytes };
}

const cli = await bundle('src/tooling/cli.ts', 'dist/cli.js');

// Prepend the shebang ourselves: esbuild places a banner after its own opening newline, which
// makes the first line of the bundle empty and the file unusable as an executable.
const cliBundle = readFileSync('dist/cli.js', 'utf8').replace(/^(?:#!.*\n)+/, '');
writeFileSync('dist/cli.js', `#!/usr/bin/env node\n${cliBundle}`, 'utf8');
chmodSync('dist/cli.js', 0o755);

const api = await bundle('src/index.ts', 'dist/index.js');

// Declarations. `rewriteRelativeImportExtensions` covers emitted JavaScript, not .d.ts, so the
// specifiers are fixed up below.
execFileSync(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.types.json'], {
  stdio: 'inherit',
});

let rewritten = 0;
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      visit(full);
      continue;
    }
    if (!entry.endsWith('.d.ts')) continue;
    const text = readFileSync(full, 'utf8');
    const fixed = text.replace(/(from\s+|import\()(['"])(\.[^'"]*)\.ts\2/g, '$1$2$3.js$2');
    if (fixed !== text) {
      writeFileSync(full, fixed, 'utf8');
      rewritten += 1;
    }
  }
};
visit('dist/types');

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(`dist/cli.js    ${kib(cli.bytes)}`);
console.log(`dist/index.js  ${kib(api.bytes)}`);
console.log(`dist/types/    ${rewritten} declaration file(s) rewritten to .js specifiers`);
