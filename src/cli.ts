#!/usr/bin/env node
/**
 * The `plainui` command line interface.
 *
 * Commands: build, check, format, watch, init, ast, tokens, explain, widgets.
 * See docs/04-cli.md for the full reference and exit codes.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CODES, DiagnosticBag, formatDiagnostic, summarize, toJsonDiagnostic, type Diagnostic } from './diagnostics.ts';
import { formatText } from './format.ts';
import { describeTokens, tokenize } from './lexer.ts';
import { compileProject, type SourceInput } from './project.ts';
import { basename, extensionOf, normalizePath, relativePath } from './paths.ts';
import { parse } from './parser.ts';
import { renderAst } from './debug.ts';
import { sourceFile } from './source.ts';
import { WIDGETS, eventsFor, propsFor, widgetsByGroup } from './widgets/registry.ts';
import { COMPILER_VERSION } from './compile.ts';

// ---------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------

interface Args {
  readonly command: string;
  readonly paths: string[];
  readonly flags: Map<string, string | true>;
}

const FLAGS_WITH_VALUE = new Set(['--out', '--config', '--target', '--port']);

function parseArgs(argv: readonly string[]): Args {
  const paths: string[] = [];
  const flags = new Map<string, string | true>();
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument.startsWith('--')) {
      const [name, inlineValue] = argument.split('=', 2) as [string, string | undefined];
      if (FLAGS_WITH_VALUE.has(name) && inlineValue === undefined) {
        const value = argv[i + 1];
        if (value !== undefined && !value.startsWith('--')) {
          flags.set(name, value);
          i += 1;
          continue;
        }
        flags.set(name, true);
        continue;
      }
      flags.set(name, inlineValue ?? true);
      continue;
    }
    if (argument.startsWith('-') && argument.length > 1) {
      flags.set(argument, true);
      continue;
    }
    if (command === '') command = argument;
    else paths.push(argument);
  }
  return { command, paths, flags };
}

// ---------------------------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------------------------

const supportsColor = (): boolean =>
  process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb';

interface Ui {
  readonly color: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly json: boolean;
}

let ui: Ui = { color: supportsColor(), quiet: false, verbose: false, json: false };

function say(message = ''): void {
  if (!ui.quiet) process.stdout.write(`${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function paint(text: string, code: number): string {
  return ui.color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'info' && !ui.verbose) continue;
    const file = diagnostic.file;
    if (file === undefined) {
      warn(`${diagnostic.code}: ${diagnostic.message}`);
      continue;
    }
    if (ui.json) {
      process.stdout.write(`${JSON.stringify(toJsonDiagnostic(diagnostic, file))}\n`);
    } else {
      // Human readable diagnostics go to stderr so that stdout stays usable as data
      // (`plainui ast file.pui > tree.txt` should not be polluted by warnings).
      process.stderr.write(`${formatDiagnostic(diagnostic, file, { color: ui.color })}\n\n`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------------------------

interface Config {
  readonly srcDir: string;
  readonly outDir: string;
  readonly exclude: readonly string[];
}

const DEFAULT_CONFIG: Config = { srcDir: 'lib/ui', outDir: 'lib/generated', exclude: [] };

function findConfigPath(start: string, explicit?: string): string | undefined {
  if (explicit !== undefined) return resolve(explicit);
  let directory = resolve(start);
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(directory, 'plainui.config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function loadConfig(path: string | undefined): Config {
  if (path === undefined || !existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config> & { target?: string };
    if (raw.target !== undefined && raw.target !== 'flutter') {
      throw new Error(`unsupported target "${raw.target}" (only "flutter" is implemented)`);
    }
    return {
      srcDir: typeof raw.srcDir === 'string' ? raw.srcDir : DEFAULT_CONFIG.srcDir,
      outDir: typeof raw.outDir === 'string' ? raw.outDir : DEFAULT_CONFIG.outDir,
      exclude: Array.isArray(raw.exclude) ? raw.exclude.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch (error) {
    throw new Error(`PUI4002: invalid configuration in ${path}: ${(error as Error).message}`);
  }
}

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.dart_tool', 'build', 'dist', '.idea', '.vscode', 'ios', 'android', 'macos', 'windows', 'linux', 'web']);

function discoverSources(roots: readonly string[], config: Config): string[] {
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
      warn(`plainui: no such file or directory: ${root}`);
      continue;
    }
    visit(root);
  }
  return [...found].sort();
}

function toInputs(files: readonly string[], root: string): SourceInput[] {
  return files.map((file) => ({
    path: normalizePath(relativePath(normalizePath(root), normalizePath(file))),
    text: readFileSync(file, 'utf8'),
  }));
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

function resolveRoot(args: Args, config: Config): { roots: string[]; root: string } {
  const explicit = args.paths.length > 0 ? args.paths.map((path) => resolve(path)) : [resolve(config.srcDir)];
  let common = resolve('.');
  for (const path of explicit) {
    if (!existsSync(path)) continue;
    const base = statSync(path).isDirectory() ? path : dirname(path);
    if (base.length < common.length) common = base;
  }
  return { roots: explicit, root: common };
}

async function commandBuild(args: Args): Promise<number> {
  const configPath = findConfigPath('.', typeof args.flags.get('--config') === 'string' ? (args.flags.get('--config') as string) : undefined);
  const config = loadConfig(configPath);
  const outDir = typeof args.flags.get('--out') === 'string' ? (args.flags.get('--out') as string) : config.outDir;
  const { roots, root } = resolveRoot(args, config);
  const files = discoverSources(roots, config);

  if (files.length === 0) {
    warn(`plainui: no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }

  const inputs = toInputs(files, root);
  const result = compileProject(inputs, { outDir });
  printDiagnostics(result.diagnostics);

  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length;

  if (!result.ok) {
    warn(`plainui: ${summarize(result.diagnostics)} — no files were written`);
    return 1;
  }

  let written = 0;
  let unchanged = 0;
  const stale: string[] = [];

  for (const file of result.files) {
    if (file.outputPath === undefined || file.code === undefined) continue;
    const absolute = join(root, file.outputPath);
    if (args.flags.has('--check')) {
      const existing = existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
      if (existing !== file.code) stale.push(file.outputPath);
      continue;
    }
    const existing = existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
    if (existing === file.code) {
      unchanged += 1;
      continue;
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.code, 'utf8');
    written += 1;
    if (ui.verbose) say(`  wrote ${file.outputPath}`);
  }

  if (args.flags.has('--check')) {
    if (stale.length > 0) {
      warn(`plainui: ${stale.length} generated file(s) are out of date: ${stale.join(', ')}`);
      return 3;
    }
    say(`plainui: ${result.files.length} file(s) up to date${warnings > 0 ? `, ${warnings} warning(s)` : ''}`);
    return 0;
  }

  say(
    `plainui: ${result.files.length} compiled, ${written} written, ${unchanged} unchanged` +
      (errors > 0 ? `, ${errors} error(s)` : '') +
      (warnings > 0 ? `, ${warnings} warning(s)` : ''),
  );
  return 0;
}

async function commandCheck(args: Args): Promise<number> {
  const configPath = findConfigPath('.', typeof args.flags.get('--config') === 'string' ? (args.flags.get('--config') as string) : undefined);
  const config = loadConfig(configPath);
  const { roots, root } = resolveRoot(args, config);
  const files = discoverSources(roots, config);
  if (files.length === 0) {
    warn(`plainui: no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }
  const result = compileProject(toInputs(files, root), { outDir: config.outDir });
  printDiagnostics(result.diagnostics);
  if (!ui.json) say(`plainui: ${files.length} file(s) checked — ${summarize(result.diagnostics)}`);
  return result.ok ? 0 : 1;
}

async function commandFormat(args: Args): Promise<number> {
  const configPath = findConfigPath('.', typeof args.flags.get('--config') === 'string' ? (args.flags.get('--config') as string) : undefined);
  const config = loadConfig(configPath);
  const roots = args.paths.length > 0 ? args.paths.map((path) => resolve(path)) : [resolve(config.srcDir)];
  const files = discoverSources(roots, config);
  if (files.length === 0) {
    warn(`plainui: no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }

  const checkOnly = args.flags.has('--check');
  const toStdout = args.flags.has('--stdout');
  let changed = 0;

  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    const result = formatText(file, original);
    if (result.skipped) {
      warn(`plainui: ${file}: not formatted because it does not parse`);
      continue;
    }
    if (!result.changed) continue;
    changed += 1;
    if (toStdout) {
      process.stdout.write(result.text);
      continue;
    }
    if (toStdout) return 0;

  if (checkOnly) {
      warn(`plainui: ${relativePath(process.cwd(), file)} is not formatted`);
      continue;
    }
    writeFileSync(file, result.text, 'utf8');
    if (ui.verbose) say(`  formatted ${relativePath(process.cwd(), file)}`);
  }

  if (toStdout) return 0;

  if (checkOnly) {
    if (changed > 0) {
      warn(`plainui: ${changed} file(s) need formatting`);
      return 3;
    }
    say(`plainui: ${files.length} file(s) already formatted`);
    return 0;
  }

  say(`plainui: ${changed === 0 ? 'already formatted' : `${changed} file(s) formatted`} (${files.length} checked)`);
  return 0;
}

const WATCH_INTERVAL_MS = 250;

async function commandWatch(args: Args): Promise<number> {
  const configPath = findConfigPath('.', typeof args.flags.get('--config') === 'string' ? (args.flags.get('--config') as string) : undefined);
  const config = loadConfig(configPath);
  const { roots, root } = resolveRoot(args, config);

  const snapshot = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const file of discoverSources(roots, config)) {
      const stats = statSync(file);
      map.set(file, `${stats.mtimeMs}:${stats.size}`);
    }
    return map;
  };

  let previous = snapshot();
  say(`plainui: watching ${previous.size} file(s) — press Ctrl+C to stop`);
  await commandBuild(args);

  return await new Promise<number>((resolvePromise) => {
    const timer = setInterval(() => {
      let next: Map<string, string>;
      try {
        next = snapshot();
      } catch {
        return;
      }
      let dirty = next.size !== previous.size;
      if (!dirty) {
        for (const [file, stamp] of next) {
          if (previous.get(file) !== stamp) {
            dirty = true;
            break;
          }
        }
      }
      if (!dirty) return;
      previous = next;
      const stamp = new Date().toLocaleTimeString();
      say(`\n[${stamp}] change detected`);
      void commandBuild(args).then((code) => {
        if (code === 0) say(`[${stamp}] build ok — waiting for changes`);
      });
    }, WATCH_INTERVAL_MS);

    const stop = (): void => {
      clearInterval(timer);
      say('\nplainui: stopped');
      resolvePromise(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

async function commandInit(args: Args): Promise<number> {
  const directory = resolve(args.paths[0] ?? '.');
  const configPath = join(directory, 'plainui.config.json');
  const homePath = join(directory, 'lib/ui/home.pui');

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `${JSON.stringify({ srcDir: 'lib/ui', outDir: 'lib/generated', target: 'flutter' }, null, 2)}\n`,
      'utf8',
    );
    say(`created ${relativePath(process.cwd(), configPath)}`);
  } else {
    say(`${relativePath(process.cwd(), configPath)} already exists — left untouched`);
  }

  if (!existsSync(homePath)) {
    mkdirSync(dirname(homePath), { recursive: true });
    writeFileSync(
      homePath,
      [
        'screen Home:',
        '',
        '    state count: int = 0',
        '',
        '    column padding=24 gap=16 main=center:',
        '',
        '        text "PlainUI" style=display',
        '        text count style=heading',
        '',
        '        button "Add one":',
        '            on tap:',
        '                set count = count + 1',
        '',
      ].join('\n'),
      'utf8',
    );
    say(`created ${relativePath(process.cwd(), homePath)}`);
  } else {
    say(`${relativePath(process.cwd(), homePath)} already exists — left untouched`);
  }

  say('');
  say('Next:');
  say('  1. plainui build        # writes lib/generated/home.pui.dart');
  say("  2. import 'generated/home.pui.dart';  // use Home() like any widget");
  return 0;
}

async function commandAst(args: Args): Promise<number> {
  const path = args.paths[0];
  if (path === undefined) {
    warn('plainui: ast needs a file');
    return 2;
  }
  const text = readFileSync(resolve(path), 'utf8');
  const { program, bag } = parse(sourceFile(path, text));
  process.stdout.write(renderAst(program));
  if (bag.diagnostics.length > 0) {
    printDiagnostics(bag.sorted());
    return bag.hasErrors ? 1 : 0;
  }
  return 0;
}

async function commandTokens(args: Args): Promise<number> {
  const path = args.paths[0];
  if (path === undefined) {
    warn('plainui: tokens needs a file');
    return 2;
  }
  const text = readFileSync(resolve(path), 'utf8');
  const file = sourceFile(path, text);
  const bag = new DiagnosticBag(file);
  process.stdout.write(describeTokens(tokenize(file, bag).tokens));
  printDiagnostics(bag.sorted());
  return 0;
}

function commandExplain(args: Args): number {
  const code = args.paths[0];
  if (code === undefined) {
    say('Diagnostic codes:');
    for (const key of Object.keys(CODES)) {
      say(`  ${key}  ${CODES[key as keyof typeof CODES].title}`);
    }
    return 0;
  }
  const entry = CODES[code as keyof typeof CODES];
  if (entry === undefined) {
    warn(`plainui: unknown diagnostic code "${code}"`);
    return 2;
  }
  say(`${code}: ${entry.title}`);
  say('');
  say(entry.description);
  if (entry.fix !== undefined) {
    say('');
    say(`Fix: ${entry.fix}`);
  }
  return 0;
}

function commandWidgets(): number {
  for (const group of widgetsByGroup()) {
    say(paint(`${group.group}`, 1));
    for (const spec of group.specs) {
      say(`  ${spec.tag.padEnd(12)} ${spec.summary}`);
      const args = spec.args.map((a) => a.name).join(', ');
      if (args.length > 0) say(`               arguments: ${args}`);
      const props = propsFor(spec).map((p) => p.name).join(', ');
      if (props.length > 0) say(`               properties: ${props}`);
      say(`               events: ${eventsFor(spec).join(', ')}`);
    }
  }
  say('');
  say(`${WIDGETS.size} built-in elements. See docs/07-reference.md for details.`);
  return 0;
}

function help(): void {
  say(`plainui ${COMPILER_VERSION} — a small language for describing Flutter interfaces

Usage:
  plainui <command> [paths...] [options]

Commands:
  build      compile .pui files to Dart            [--out dir] [--check] [--config file]
  check      validate without writing anything     [--json] [--verbose]
  watch      rebuild whenever a .pui file changes
  format     rewrite files in canonical form       [--check] [--stdout]
  init       create plainui.config.json and lib/ui/home.pui
  ast        print the parsed tree of a file
  tokens     print the token stream of a file
  explain    describe a diagnostic code (or list them all)
  widgets    list every built-in element

Global options:
  --help, --version, --json, --quiet, --verbose, --no-color

Examples:
  plainui build                       # uses plainui.config.json
  plainui build lib/ui                # compile a directory
  plainui check .                     # validate the whole project
  plainui format --check              # verify formatting without writing
  plainui explain PUI2001

Exit codes: 0 ok · 1 diagnostics · 2 usage/configuration · 3 out of date (check modes)`);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  ui = {
    color: supportsColor() && !args.flags.has('--no-color'),
    quiet: args.flags.has('--quiet'),
    verbose: args.flags.has('--verbose'),
    json: args.flags.has('--json') || args.command === 'check' && args.flags.has('--json'),
  };

  if (args.flags.has('--version') || args.command === 'version') {
    say(COMPILER_VERSION);
    return 0;
  }
  if (args.flags.has('--help') || args.command === 'help' || args.command === '') {
    help();
    return 0;
  }

  try {
    switch (args.command) {
      case 'build':
        return await commandBuild(args);
      case 'check':
        return await commandCheck(args);
      case 'format':
        return await commandFormat(args);
      case 'watch':
        return await commandWatch(args);
      case 'init':
        return await commandInit(args);
      case 'ast':
        return await commandAst(args);
      case 'tokens':
        return await commandTokens(args);
      case 'explain':
        return commandExplain(args);
      case 'widgets':
        return commandWidgets();
      default:
        warn(`plainui: unknown command "${args.command}"`);
        help();
        return 2;
    }
  } catch (error) {
    warn(`plainui: ${(error as Error).message}`);
    return 2;
  }
}

// Running `plainui widgets | head` should not crash with EPIPE.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
});

// Run when executed directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[/\\])(?:cli\.m?js|cli\.ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
