/**
 * Serves the playground.
 *
 *     npm run playground          # http://localhost:4173
 *     PORT=8080 npm run playground
 *
 * The bundle is built on demand: the first request for /dist/app.js builds it, and later
 * requests rebuild when any source file is newer than the bundle. That keeps the playground
 * honest — it always runs the compiler in this checkout.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve('.');
const WEB_DIR = join(ROOT, 'web');
const BUNDLE = join(WEB_DIR, 'dist/app.js');
const PORT = Number(process.env['PORT'] ?? 4173);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

/** Source files whose change should trigger a rebuild. */
function sourceStamp(): number {
  let newest = 0;
  const visit = (path: string): void => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (path.includes(`${sep}dist`)) return;
      for (const entry of ['index.html', 'app.ts', 'examples.ts', 'style.css', 'dist']) {
        const child = join(path, entry);
        if (existsSync(child)) visit(child);
      }
      return;
    }
    if (path.endsWith('.js')) return;
    newest = Math.max(newest, stats.mtimeMs);
  };
  visit(WEB_DIR);
  for (const dir of ['src']) {
    const base = join(ROOT, dir);
    const walk = (path: string): void => {
      const stats = statSync(path);
      if (stats.isDirectory()) {
        for (const entry of readdirSync(path)) walk(join(path, entry));
        return;
      }
      if (path.endsWith('.ts')) newest = Math.max(newest, stats.mtimeMs);
    };
    if (existsSync(base)) walk(base);
  }
  return newest;
}

let builtAt = 0;

async function ensureBundle(force = false): Promise<void> {
  const stamp = sourceStamp();
  if (!force && existsSync(BUNDLE) && builtAt >= stamp) return;

  const started = Date.now();
  await build({
    entryPoints: [join(WEB_DIR, 'app.ts')],
    outfile: BUNDLE,
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
  });
  mkdirSync(dirname(BUNDLE), { recursive: true });
  builtAt = Date.now();
  console.log(`built web/dist/app.js in ${Date.now() - started} ms`);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const target = normalize(join(WEB_DIR, pathname));
  if (!target.startsWith(WEB_DIR + sep) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  const send = (): void => {
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(target).pipe(response);
  };

  if (pathname === '/dist/app.js') {
    void ensureBundle()
      .then(send)
      .catch((error: unknown) => {
        console.error(error);
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`build failed: ${(error as Error).message}`);
      });
    return;
  }

  send();
});

await ensureBundle(true).catch((error: unknown) => {
  console.error('initial build failed:', (error as Error).message);
  process.exitCode = 1;
});

// `--build-only` is what CI and `npm run build` use: build the bundle, serve nothing.
if (process.argv.includes('--build-only')) {
  process.exit(process.exitCode ?? 0);
}

server.listen(PORT, HOST, () => {
  console.log(`PlainUI playground: http://localhost:${PORT}`);
  console.log(`  serving ${WEB_DIR}`);
  console.log('  edit the source pane, or any file in src/, and reload to pick up changes');
});
