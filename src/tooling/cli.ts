#!/usr/bin/env node
/**
 * The `plainui` command line interface.
 *
 * Commands: build, check, format, watch, init, ast, tokens, explain, widgets.
 * See docs/04-cli.md for the full reference and exit codes.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CODES, DiagnosticBag, formatDiagnostic, summarize, toJsonDiagnostic, type Diagnostic } from '../analysis/diagnostics.ts';
import { formatText } from './format.ts';
import { describeTokens, tokenize } from '../frontend/lexer.ts';
import { ProjectCache, compileProject } from '../project/project.ts';
import {
  discoverSources,
  resolveProject as resolveProjectIn,
  toInputs,
  type Config,
  type ResolvedProject,
} from '../project/workspace.ts';
import { basename, extensionOf, normalizePath, relativePath } from '../project/paths.ts';
import { targetById, type Target } from '../targets/index.ts';
import { parse } from '../frontend/parser.ts';
import { renderAst } from './debug.ts';
import { sourceFile } from '../frontend/source.ts';
import { WIDGETS, eventsFor, propsFor, widgetsByGroup } from '../analysis/widgets/registry.ts';
import { COMPILER_VERSION } from '../project/compile.ts';
import { PHASES, TODO, currentItem, currentPhase, itemsOf, progressOf, type PhaseId } from './todo.ts';
import { watchForChanges } from './watch.ts';
import { runLanguageServer } from './lsp.ts';

// ---------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------

interface Args {
  readonly command: string;
  readonly paths: string[];
  readonly flags: Map<string, string | true>;
}

const FLAGS_WITH_VALUE = new Set(['--out', '--config', '--target', '--port', '--phase']);

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

/** Report a failure that has a catalogue entry, in the same shape as a diagnostic. */
function fail(code: 'PUI3003' | 'PUI4001' | 'PUI4002' | 'PUI4003' | 'PUI4004', message: string): void {
  const info = CODES[code];
  warn(`${paint('error', 31)}${paint(`[${code}]`, 2)}: ${message}`);
  if (info.fix !== undefined) warn(`  = hint: ${info.fix}`);
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
// Commands
// ---------------------------------------------------------------------------------------------

/** Source discovery with the CLI's warning for a root that does not exist. */
function sourcesOf(roots: readonly string[], config: Config): string[] {
  return discoverSources(roots, config, {
    onMissingRoot: (root) => warn(`plainui: no such file or directory: ${root}`),
  });
}

/** Adapt the CLI's parsed flags to the workspace resolver. */
function resolveProject(args: Args): ResolvedProject {
  const explicit = args.flags.get('--config');
  return resolveProjectIn({
    paths: args.paths,
    ...(typeof explicit === 'string' ? { configPath: explicit } : {}),
  });
}

async function commandBuild(args: Args, cache?: ProjectCache): Promise<number> {
  const project = resolveProject(args);
  const outDir = typeof args.flags.get('--out') === 'string' ? (args.flags.get('--out') as string) : project.config.outDir;
  const { roots, root } = project;
  const files = sourcesOf(roots, project.config);

  if (files.length === 0) {
    fail('PUI4001', `no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }

  const inputs = toInputs(files, root);
  const before = cache === undefined ? undefined : { hits: cache.hits, misses: cache.misses };
  const requiredTargets = targetsOf(project.config);
  const result = compileProject(
    inputs,
    cache === undefined ? { outDir, requiredTargets } : { outDir, cache, requiredTargets },
  );
  if (cache !== undefined && ui.verbose && before !== undefined) {
    const hits = cache.hits - before.hits;
    const misses = cache.misses - before.misses;
    if (hits + misses > 0) say(`  cache: ${hits} reused, ${misses} recompiled (${cache.size} entries)`);
  }
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

  // The route table is a project file, written beside the per-file output and checked the same way.
  const projectFiles = result.routes === undefined ? [] : [result.routes];
  for (const file of [...result.files, ...projectFiles]) {
    if (file.outputPath === undefined || file.code === undefined) continue;
    // `resolve` keeps an absolute --out absolute and treats the default as project-relative.
    const absolute = resolve(root, file.outputPath);
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
    try {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, file.code, 'utf8');
    } catch (error) {
      fail('PUI3003', `could not write ${file.outputPath}: ${(error as Error).message}`);
      return 1;
    }
    written += 1;
    if (ui.verbose) say(`  wrote ${file.outputPath}`);
  }

  if (args.flags.has('--check')) {
    if (stale.length > 0) {
      fail('PUI4004', `${stale.length} generated file(s) are out of date: ${stale.join(', ')}`);
      return 3;
    }
    const checkedCount = result.files.length + projectFiles.length;
    say(`plainui: ${checkedCount} file(s) up to date${warnings > 0 ? `, ${warnings} warning(s)` : ''}`);
    return 0;
  }

  say(
    `plainui: ${result.files.length + projectFiles.length} compiled, ${written} written, ${unchanged} unchanged` +
      (errors > 0 ? `, ${errors} error(s)` : '') +
      (warnings > 0 ? `, ${warnings} warning(s)` : ''),
  );
  return 0;
}

async function commandCheck(args: Args): Promise<number> {
  const { config, roots, root } = resolveProject(args);
  const files = sourcesOf(roots, config);
  if (files.length === 0) {
    fail('PUI4001', `no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }
  const result = compileProject(toInputs(files, root), { outDir: config.outDir, requiredTargets: targetsOf(config) });
  printDiagnostics(result.diagnostics);
  if (!ui.json) say(`plainui: ${files.length} file(s) checked — ${summarize(result.diagnostics)}`);
  return result.ok ? 0 : 1;
}

async function commandFormat(args: Args): Promise<number> {
  const { config, roots } = resolveProject(args);
  const files = sourcesOf(roots, config);
  if (files.length === 0) {
    fail('PUI4001', `no .pui files found (looked in ${roots.join(', ')})`);
    return 1;
  }

  const checkOnly = args.flags.has('--check');
  const toStdout = args.flags.has('--stdout');
  const unformatted: string[] = [];
  let changed = 0;

  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    const result = formatText(file, original);
    if (result.skipped) {
      warn(`plainui: ${relativePath(process.cwd(), file)}: left untouched because it does not parse`);
      continue;
    }
    if (!result.changed) continue;

    changed += 1;
    if (toStdout) {
      process.stdout.write(result.text);
      continue;
    }
    if (checkOnly) {
      unformatted.push(relativePath(process.cwd(), file));
      continue;
    }
    writeFileSync(file, result.text, 'utf8');
    if (ui.verbose) say(`  formatted ${relativePath(process.cwd(), file)}`);
  }

  if (toStdout) return 0;

  if (checkOnly) {
    if (unformatted.length > 0) {
      fail('PUI4003', `${unformatted.length} file(s) need formatting: ${unformatted.join(', ')}`);
      return 3;
    }
    say(`plainui: ${files.length} file(s) already formatted`);
    return 0;
  }

  say(`plainui: ${changed === 0 ? 'already formatted' : `${changed} file(s) formatted`} (${files.length} checked)`);
  return 0;
}

async function commandWatch(args: Args): Promise<number> {
  const { config, roots, root } = resolveProject(args);
  const sourceCount = sourcesOf(roots, config).length;
  // One cache for the whole session: a save recompiles the saved file, not the project.
  const cache = new ProjectCache();

  say(`plainui: watching ${sourceCount} file(s) — press Ctrl+C to stop`);

  return await new Promise<number>((resolvePromise) => {
    let building = false;
    let queued = false;

    /**
     * Runs a build, or queues exactly one if a build is already running.
     *
     * `changed` is null for the initial build, which is also started through this gate: watching
     * begins *before* the first compile, so an edit made while it runs is a change, not a silent
     * miss. Polling made that concrete — its baseline snapshot is taken when the watcher starts, so
     * anything written between "watching" and the snapshot was invisible.
     */
    const build = (changed: readonly string[] | null): void => {
      if (building) {
        queued = true;
        return;
      }
      building = true;
      const stamp = new Date().toLocaleTimeString();
      const first = changed?.[0] ?? '';
      if (changed !== null) {
        const where = changed.length > 1 ? `${changed.length} files` : relativePath(process.cwd(), first);
        say(`\n[${stamp}] change detected — ${where}`);
      }
      void commandBuild(args, cache).then((code) => {
        building = false;
        if (changed !== null && code === 0) say(`[${stamp}] build ok — waiting for changes`);
        if (queued) {
          queued = false;
          build(changed === null ? [] : [first]);
        }
      });
    };

    // Generated output is not input: watching it would make every build trigger the next one.
    const outDir = resolve(root, config.outDir);
    const watcher = watchForChanges({
      roots,
      onChange: (changed) => build(changed),
      isRelevant: (path) => path.endsWith('.pui') || path.endsWith('plainui.config.json'),
      ignore: (path) => path === outDir || path.startsWith(`${outDir}/`),
    });

    if (process.argv.includes('--verbose')) say(`plainui: using ${watcher.mode} watching`);

    build(null);

    const stop = (): void => {
      watcher.close();
      say('\nplainui: stopped');
      resolvePromise(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

/**
 * The language server speaks JSON-RPC on stdin/stdout, so it must not print anything else there.
 * `--verbose` logging goes to stderr, which LSP reserves for `window/logMessage`.
 */
async function commandLsp(): Promise<number> {
  return await runLanguageServer({
    input: process.stdin,
    output: process.stdout,
    cwd: process.cwd(),
    log: (message) => process.stderr.write(`plainui lsp: ${message}\n`),
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

/**
 * `plainui next` — the roadmap, printed.
 *
 * The table in `src/tooling/todo.ts` is the source of truth for what is done and what is next, so
 * the answer to "what now?" is a command instead of a conversation. `--json` is there because the
 * most useful consumer of a roadmap is a script.
 */
function commandNext(args: Args): number {
  const phaseArg = args.flags.get('--phase');
  const phaseId = typeof phaseArg === 'string' ? phaseArg : undefined;
  const showDone = args.flags.has('--all');
  const json = args.flags.has('--json');

  if (phaseId !== undefined && !PHASES.some((phase) => phase.id === phaseId)) {
    warn(`plainui: unknown phase "${phaseId}"`);
    warn(`plainui: phases are ${PHASES.map((phase) => phase.id).join(', ')}`);
    return 2;
  }

  const phases = PHASES.filter((phase) => phaseId === undefined || phase.id === phaseId);
  const now = currentItem();

  if (json) {
    const payload = {
      now:
        now === undefined
          ? null
          : {
              id: now.id,
              title: now.title,
              phase: now.phase,
              size: now.size,
              status: now.status,
              acceptance: now.acceptance,
              touches: now.touches,
            },
      phases: phases.map((phase) => ({
        id: phase.id,
        title: phase.title,
        ...(phase.gate === undefined ? {} : { gate: phase.gate }),
        ...progressOf(phase.id),
        items: itemsOf(phase.id)
          .filter((item) => showDone || item.status !== 'done')
          .map((item) => ({
            id: item.id,
            title: item.title,
            size: item.size,
            status: item.status,
            acceptance: item.acceptance,
            touches: item.touches,
          })),
      })),
      total: TODO.length,
      done: TODO.filter((item) => item.status === 'done').length,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const current = currentPhase();
  if (now !== undefined && phaseId === undefined) {
    const phase = current === undefined ? '' : ` (${current.title})`;
    say(`plainui: next — ${now.title}${phase}`);
    say(`  ${now.acceptance}`);
    say(`  touches: ${now.touches.join(', ')}`);
    say('');
  }

  const marks: Record<string, string> = { done: '✔', next: '▸', todo: '·' };
  const idWidth = Math.max(...TODO.map((item) => item.id.length));

  for (const phase of phases) {
    const { done, total } = progressOf(phase.id);
    const items = itemsOf(phase.id).filter((item) => showDone || item.status !== 'done');
    say(`${phase.title} — ${done}/${total}`);
    for (const item of items) {
      const mark = marks[item.status] ?? '·';
      const id = item.id.padEnd(idWidth);
      say(`  ${mark} ${id}  ${item.size.padEnd(2)}  ${item.title}`);
    }
    if (items.length === 0) say(`  ${done === total ? 'nothing left in this phase' : 'nothing here yet'}`);
    say('');
  }

  const remaining = TODO.filter((item) => item.status !== 'done').length;
  say(`${TODO.length - remaining} of ${TODO.length} done — ${remaining} to go. \`plainui next --all\` shows finished items.`);
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
  lsp        language server on stdin/stdout (editors)
  format     rewrite files in canonical form       [--check] [--stdout]
  init       create plainui.config.json and lib/ui/home.pui
  ast        print the parsed tree of a file
  tokens     print the token stream of a file
  explain    describe a diagnostic code (or list them all)
  widgets    list every built-in element
  next       print the roadmap: what is done, what is next   [--all] [--phase id] [--json]

Global options:
  --help, --version, --json, --quiet, --verbose, --no-color

Examples:
  plainui build                       # uses plainui.config.json
  plainui build lib/ui                # compile a directory
  plainui check .                     # validate the whole project
  plainui format --check              # verify formatting without writing
  plainui explain PUI2001
  plainui next                        # what to work on, and how to know it is finished
  plainui next --json                 # the same, for a script

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
      case 'lsp':
        return await commandLsp();
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
      case 'next':
        return commandNext(args);
      default:
        warn(`plainui: unknown command "${args.command}"`);
        help();
        return 2;
    }
  } catch (error) {
    fail('PUI4002', (error as Error).message);
    return 2;
  }
}

// Running `plainui widgets | head` should not crash with EPIPE.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
});

/**
 * Run when executed directly (not when imported by tests).
 *
 * Comparing the resolved entry point with this module covers the cases a name check got wrong:
 * `node_modules/.bin/plainui` is a symlink whose name is `plainui`, not `cli.js`, so a regex on the
 * file name made the installed CLI print nothing and exit 0.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

/** The targets a project promises to port to, as `Target` records the checker can ask. */
function targetsOf(config: Config): Target[] {
  return config.targets.flatMap((id) => {
    const target = targetById(id);
    return target === undefined ? [] : [target];
  });
}
