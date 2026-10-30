/**
 * Where a PlainUI project is, and which files belong to it.
 *
 * This used to live inside `src/cli.ts`. The language server needs exactly the same answers as
 * `plainui build` — the same root, the same `srcDir`, the same exclusions — and two copies of
 * "walk up until you find a config" is how a build and an editor start disagreeing about which
 * files exist.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { extensionOf, normalizePath, relativePath } from './paths.ts';
import type { SourceInput } from './project.ts';
import { targetIds, type TargetId } from '../targets/index.ts';

export interface Config {
  readonly srcDir: string;
  readonly outDir: string;
  readonly exclude: readonly string[];
  /**
   * Targets every file in this project must port to (decision C2). One entry — the default — means
   * "this is a Flutter project". Two means the syntax is on a diet: a construct one of them
   * delivers only partly is `PUI2502`, reported in the file that uses it.
   */
  readonly targets: readonly TargetId[];
}

export const DEFAULT_CONFIG: Config = {
  srcDir: 'lib/ui',
  outDir: 'lib/generated',
  exclude: [],
  targets: ['flutter'],
};

export interface ResolvedProject {
  readonly config: Config;
  /** Directories or files to read sources from. */
  readonly roots: string[];
  /** Directory that project-relative paths are resolved against. */
  readonly root: string;
}

/** Nearest `plainui.config.json` at or above `start`, or `undefined`. */
export function findConfigPath(start: string, explicit?: string): string | undefined {
  if (explicit !== undefined) return resolve(explicit);
  let directory = resolve(start);
  for (let depth = 0; depth < 20; depth += 1) {
    const candidate = join(directory, 'plainui.config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

export function loadConfig(path: string | undefined): Config {
  if (path === undefined || !existsSync(path)) return DEFAULT_CONFIG;
  let raw: Partial<Config> & { target?: string; targets?: unknown };
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config> & { target?: string; targets?: unknown };
  } catch (error) {
    throw new Error(`invalid configuration in ${path}: ${(error as Error).message}`);
  }
  return {
    srcDir: typeof raw.srcDir === 'string' ? raw.srcDir : DEFAULT_CONFIG.srcDir,
    outDir: typeof raw.outDir === 'string' ? raw.outDir : DEFAULT_CONFIG.outDir,
    exclude: Array.isArray(raw.exclude) ? raw.exclude.filter((x): x is string => typeof x === 'string') : [],
    targets: targetsFrom(raw, path),
  };
}

/**
 * `"targets": ["flutter", "html"]`, or the older single `"target": "flutter"`.
 *
 * A target named here that this compiler cannot emit is a configuration mistake, and the message
 * lists the ones it knows: finding the typo through a `PUI2502` six screens later is worse.
 */
function targetsFrom(raw: { target?: string; targets?: unknown }, path: string): readonly TargetId[] {
  const declared =
    raw.targets === undefined ? (raw.target === undefined ? undefined : [raw.target]) : raw.targets;
  if (declared === undefined) return DEFAULT_CONFIG.targets;
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== 'string')) {
    throw new Error(`invalid configuration in ${path}: "targets" must be an array of target ids`);
  }
  if (declared.length === 0) {
    throw new Error(`invalid configuration in ${path}: "targets" is empty; name at least one target`);
  }
  const known = targetIds();
  for (const entry of declared as string[]) {
    if (!known.includes(entry as TargetId)) {
      throw new Error(`unsupported target "${entry}" in ${path} (known: ${known.join(', ')})`);
    }
  }
  return [...new Set(declared as TargetId[])];
}

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.dart_tool',
  'build',
  'dist',
  '.idea',
  '.vscode',
  'ios',
  'android',
  'macos',
  'windows',
  'linux',
  'web',
]);

export interface DiscoverOptions {
  /** Called for a root that does not exist. `plainui build` warns; the language server is silent. */
  readonly onMissingRoot?: (root: string) => void;
}

/** Every `.pui` file under `roots`, sorted, minus excluded directories. */
export function discoverSources(roots: readonly string[], config: Config, options: DiscoverOptions = {}): string[] {
  const found = new Set<string>();
  const visit = (path: string): void => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const name = basename(path);
      if (SKIP_DIRECTORIES.has(name)) return;
      if (config.exclude.some((pattern) => path.includes(pattern))) return;
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (extensionOf(path) === '.pui') found.add(path);
  };
  for (const root of roots) {
    if (!existsSync(root)) {
      options.onMissingRoot?.(root);
      continue;
    }
    visit(root);
  }
  return [...found].sort();
}

/** Reads sources from disk, with paths relative to the project root. */
export function toInputs(files: readonly string[], root: string): SourceInput[] {
  return files.map((file) => ({
    path: normalizePath(relativePath(normalizePath(root), normalizePath(file))),
    text: readFileSync(file, 'utf8'),
  }));
}

export interface ResolveProjectOptions {
  readonly paths: readonly string[];
  readonly configPath?: string;
  readonly cwd?: string;
}

/**
 * Work out which project a command is operating on.
 *
 * The rules, in order:
 *   1. `--config` names the configuration file;
 *   2. otherwise the nearest `plainui.config.json` at or above the working directory wins, and
 *      its directory becomes the project root (so `plainui build` works from a subdirectory);
 *   3. with no configuration at all, the working directory is the root;
 *   4. a single explicit path that contains its own configuration is a project of its own, which
 *      is what makes `plainui build examples/counter` behave the way a reader expects.
 */
export function resolveProject(options: ResolveProjectOptions): ResolvedProject {
  const cwd = options.cwd ?? '.';
  const configPath = findConfigPath(cwd, options.configPath);

  let config = loadConfig(configPath);
  let root = configPath === undefined ? resolve(cwd) : dirname(configPath);
  const roots = options.paths.length > 0 ? options.paths.map((path) => resolve(path)) : [resolve(root, config.srcDir)];

  if (options.paths.length === 1 && options.configPath === undefined) {
    const target = roots[0]!;
    const base = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
    const ownConfig = join(base, 'plainui.config.json');
    if (ownConfig !== configPath && existsSync(ownConfig)) {
      config = loadConfig(ownConfig);
      root = base;
    } else if (base !== root && !base.startsWith(root + sep)) {
      // A path outside the project: treat it as its own root.
      root = base;
    }
  }

  const resolvedRoots = options.paths.length > 0 ? roots : [resolve(root, config.srcDir)];
  return { config, roots: resolvedRoots, root };
}
