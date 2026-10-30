// Bundles the CLI into a single executable file: dist/cli.js.
//
// The sources import each other with explicit `.ts` extensions so that Node can run them directly
// with --experimental-strip-types during development. esbuild rewrites those specifiers for the
// published bundle, which is why this script exists instead of a plain `tsc` emit.

import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const result = await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

// Prepend the shebang ourselves: esbuild places a banner after its own opening newline, which
// makes the first line of the bundle empty and the file unusable as an executable.
const bundle = readFileSync('dist/cli.js', 'utf8').replace(/^(?:#!.*\n)+/, '');
writeFileSync('dist/cli.js', `#!/usr/bin/env node\n${bundle}`, 'utf8');
chmodSync('dist/cli.js', 0o755);

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`dist/cli.js  ${(bytes / 1024).toFixed(1)} KiB`);
