/**
 * Project-level compilation.
 *
 * A `.pui` file is rarely alone: screens import host libraries and other `.pui` files, and the
 * generated Dart must have imports that are valid from *its* location, not from the source's.
 * This module owns that bookkeeping. It is pure: it takes file contents and returns file
 * contents, so the CLI can read from disk and the playground can read from `localStorage`.
 */

import type { ComponentDecl, Program, ScreenDecl, TokenDecl } from '../frontend/ast.ts';
import { check, type CheckOptions } from '../analysis/check.ts';
import { generateFlutter } from '../codegen/flutter.ts';
import type { Diagnostic } from '../analysis/diagnostics.ts';
import { DiagnosticBag } from '../analysis/diagnostics.ts';
import { parse } from '../frontend/parser.ts';
import { basename, camelCase, dartImportSpecifier, dirname, extensionOf, joinPath, normalizePath } from './paths.ts';
import { sourceFile, type SourceFile } from '../frontend/source.ts';
import { hashText } from './hash.ts';
import { COMPILER_VERSION } from './compile.ts';
import { ROUTES_FILE, generateRoutes, projectUsesNavigation, type RouteSource } from '../codegen/routes.ts';

export interface SourceInput {
  readonly path: string;
  readonly text: string;
}

export interface ProjectOptions extends CheckOptions {
  /** Directory (project-relative) for generated files. */
  readonly outDir?: string;
  readonly compilerVersion?: string;
  /**
   * Reuse the checking and generation results of files whose inputs have not changed. `watch`
   * passes one so a save recompiles one file instead of the project; a cold build passes none.
   */
  readonly cache?: ProjectCache;
}

/** What a cache entry holds: the diagnostics and, when the file compiled, its Dart. */
export interface CachedResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly outputPath?: string;
  readonly code?: string;
}

/**
 * A memo of per-file results, keyed by a fingerprint of everything that can change them.
 *
 * Deliberately dumb: no eviction, no timestamps, no file watching. The CLI owns one for the
 * lifetime of a `watch` session; everything else creates none and behaves exactly as before.
 */
export class ProjectCache {
  /** One entry per source file: a save replaces the previous result instead of accumulating. */
  private readonly entries = new Map<string, { key: string; result: CachedResult }>();
  hits = 0;
  misses = 0;

  get(path: string, key: string): CachedResult | undefined {
    const found = this.entries.get(path);
    if (found === undefined || found.key !== key) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return found.result;
  }

  set(path: string, key: string, result: CachedResult): void {
    this.entries.set(path, { key, result });
  }

  /** Number of files remembered — bounded by the size of the project, not by the number of saves. */
  get size(): number {
    return this.entries.size;
  }
}

export interface FileResult {
  readonly source: SourceFile;
  readonly program: Program;
  /** Generated output path, absent when compilation failed. */
  readonly outputPath?: string;
  readonly code?: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** A generated file that belongs to the project rather than to one source file. */
export interface ProjectFile {
  readonly outputPath: string;
  readonly code: string;
}

export interface ProjectResult {
  readonly ok: boolean;
  readonly files: readonly FileResult[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The route table, present when the project navigates. `plainui build` writes it beside the
   * per-file output, and `--check` compares it like any other generated file.
   */
  readonly routes?: ProjectFile;
}

const DEFAULT_OUT_DIR = 'lib/generated';

export function outputPathFor(sourcePath: string, outDir = DEFAULT_OUT_DIR): string {
  return joinPath(outDir, `${basename(sourcePath)}.dart`);
}

export function compileProject(inputs: readonly SourceInput[], options: ProjectOptions = {}): ProjectResult {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const version = options.compilerVersion ?? COMPILER_VERSION;

  const sources = new Map<string, SourceFile>();
  for (const input of inputs) {
    const path = normalizePath(input.path);
    sources.set(path, sourceFile(path, input.text));
  }

  const parsed = new Map<string, { program: Program; bag: DiagnosticBag }>();
  for (const [path, source] of sources) {
    parsed.set(path, parse(source));
  }

  // Global declaration names, for duplicate detection across files.
  const declaredNames = new Map<string, string>();
  for (const [path, entry] of parsed) {
    for (const decl of entry.program.decls) {
      if (decl.kind === 'Style' || decl.kind === 'Theme') continue;
      if (!declaredNames.has(decl.name)) declaredNames.set(decl.name, path);
    }
  }

  interface ImportResolution {
    readonly plainuiComponents: Map<string, ComponentDecl>;
    /** Screens declared by imported files: navigation follows imports, like components do. */
    readonly plainuiScreens: Map<string, ScreenDecl>;
    readonly plainuiEdges: Map<string, string>; // import path as written -> target source path
    readonly hostRoots: Set<string>;
    /** Design tokens declared by imported files: a theme is shared by importing it. */
    readonly plainuiTokens: Map<string, TokenDecl>;
  }

  const resolutions = new Map<string, ImportResolution>();

  for (const [path, entry] of parsed) {
    const components = new Map<string, ComponentDecl>();
    const screens = new Map<string, ScreenDecl>();
    const edges = new Map<string, string>();
    const hostRoots = new Set<string>();
    const tokens = new Map<string, TokenDecl>();

    for (const imp of entry.program.imports) {
      if (extensionOf(imp.path) === '.pui') {
        const target = normalizePath(joinPath(dirname(path), imp.path));
        edges.set(imp.path, target);
        const targetEntry = parsed.get(target);
        if (targetEntry === undefined) {
          entry.bag.error({
            code: 'PUI3001',
            message: `cannot find "${imp.path}"`,
            span: imp.pathSpan,
            hint: `resolved to ${target}, which is not part of this compilation`,
          });
          continue;
        }
        for (const decl of targetEntry.program.decls) {
          if (decl.kind === 'Component') components.set(decl.name, decl);
          if (decl.kind === 'Screen') screens.set(decl.name, decl);
          if (decl.kind === 'Theme') {
            for (const token of decl.tokens) if (!tokens.has(token.name)) tokens.set(token.name, token);
          }
        }
      } else {
        const stem = basename(imp.path, true);
        hostRoots.add(stem);
        hostRoots.add(camelCase(stem));
      }
    }

    resolutions.set(path, {
      plainuiComponents: components,
      plainuiScreens: screens,
      plainuiEdges: edges,
      hostRoots,
      plainuiTokens: tokens,
    });
  }

  // ---- cache ------------------------------------------------------------------------------
  // A file's result depends on its own text, on the text of the .pui files it imports (their
  // component declarations shape the analysis), and on the project-wide table of declared names
  // (which drives duplicate and shadowing checks). Anything else in the project is irrelevant,
  // which is why editing one widget body does not invalidate the other 299 files.
  const cache = options.externalComponents === undefined ? options.cache : undefined;
  const cacheKeys = new Map<string, string>();
  const cachedResults = new Map<string, CachedResult | undefined>();
  if (cache !== undefined) {
    const nameTable = [...declaredNames]
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([name, file]) => `${name}@${file}`)
      .join('|');
    const namesHash = hashText(nameTable);
    for (const [path, entry] of parsed) {
      const resolution = resolutions.get(path)!;
      const imports = entry.program.imports
        .map((imp) => {
          const target = resolution.plainuiEdges.get(imp.path);
          const targetText = target === undefined ? '' : sources.get(target)?.text ?? '';
          return `${imp.path}=>${target ?? ''}:${hashText(targetText)}`;
        })
        .sort()
        .join('|');
      const key = hashText(
        [version, outDir, path, sources.get(path)!.text, namesHash, imports].join('\u0000'),
      );
      cacheKeys.set(path, key);
      cachedResults.set(path, cache.get(path, key));
    }
  }

  // ---- validate ---------------------------------------------------------------------------
  const checked = new Map<string, ReturnType<typeof check>>();
  for (const [path, entry] of parsed) {
    if (cachedResults.get(path) !== undefined) continue;
    const source = sources.get(path)!;
    const resolution = resolutions.get(path)!;
    const result = check(source, entry.program, {
      externalComponents: resolution.plainuiComponents,
      externalScreens: resolution.plainuiScreens,
      externalTokens: resolution.plainuiTokens,
      hostRoots: resolution.hostRoots,
      externalNames: new Map([...declaredNames].filter(([name, file]) => file !== path)),
    });
    entry.bag.merge(result.bag);
    checked.set(path, result);
  }

  // Output path collisions across the project.
  const usedOutputs = new Map<string, string>();
  for (const path of parsed.keys()) {
    const output = outputPathFor(path, outDir);
    const previous = usedOutputs.get(output);
    if (previous !== undefined) {
      parsed.get(path)!.bag.error({
        code: 'PUI3102',
        message: `"${path}" and "${previous}" would both generate ${output}`,
        span: { start: 0, end: 0 },
        hint: 'give the source files different names, or set a different outDir',
      });
    }
    usedOutputs.set(output, path);
  }

  const allDiagnostics: Diagnostic[] = [];
  const files: FileResult[] = [];
  let ok = true;

  for (const [path, entry] of parsed) {
    const source = sources.get(path)!;
    const diagnostics = cachedResults.get(path)?.diagnostics ?? entry.bag.sorted();
    allDiagnostics.push(...diagnostics);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) ok = false;
    files.push({ source, program: entry.program, diagnostics });
  }

  if (!ok) {
    // Errors are cached too: while a file is broken, every save in another file would otherwise
    // re-analyse it.
    if (cache !== undefined) {
      for (const file of files) {
        const key = cacheKeys.get(file.source.path);
        if (key !== undefined) cache.set(file.source.path, key, { diagnostics: file.diagnostics });
      }
    }
    return { ok, files: files.map((file) => ({ ...file })), diagnostics: allDiagnostics };
  }

  // ---- generate ---------------------------------------------------------------------------
  const generated: FileResult[] = [];
  for (const [path, entry] of parsed) {
    const source = sources.get(path)!;
    const resolution = resolutions.get(path)!;
    const outputPath = outputPathFor(path, outDir);
    const cached = cachedResults.get(path);

    const code = cached?.code ?? generateFlutter(checked.get(path)!.analysis, source, {
      compilerVersion: version,
      sourcePath: path,
      resolvePlainuiImport: (importPath: string): string => {
        const target = resolution.plainuiEdges.get(importPath);
        if (target === undefined) return importPath;
        return dartImportSpecifier(outputPath, outputPathFor(target, outDir));
      },
      rebaseImport: (importPath: string): string => {
        const target = normalizePath(joinPath(dirname(path), importPath));
        return dartImportSpecifier(outputPath, target);
      },
    }).code;

    generated.push({
      source,
      program: entry.program,
      outputPath,
      code,
      diagnostics: cached?.diagnostics ?? entry.bag.sorted(),
    });
  }

  if (cache !== undefined) {
    for (const file of generated) {
      const key = cacheKeys.get(file.source.path);
      if (key !== undefined) {
        cache.set(file.source.path, key, { diagnostics: file.diagnostics, outputPath: file.outputPath, code: file.code });
      }
    }
  }

  // ---- routes ------------------------------------------------------------------------------
  // One file for the whole project, because a route table is a project-level fact. It is written
  // only when something navigates, so projects that do not navigate keep exactly the files they
  // had before.
  const routesPath = joinPath(outDir, ROUTES_FILE);
  let routes: ProjectFile | undefined;
  if (projectUsesNavigation([...parsed.values()].map((entry) => entry.program))) {
    const routeSources: RouteSource[] = [];
    for (const file of generated) {
      if (file.outputPath === undefined) continue;
      for (const decl of file.program.decls) {
        if (decl.kind !== 'Screen') continue;
        routeSources.push({
          path: file.source.path,
          screen: decl,
          importSpecifier: dartImportSpecifier(routesPath, file.outputPath),
        });
      }
    }
    routes = {
      outputPath: routesPath,
      code: generateRoutes(routeSources, { compilerVersion: version, outputPath: routesPath, routesPath }),
    };
  }

  return { ok, files: generated, diagnostics: allDiagnostics, ...(routes === undefined ? {} : { routes }) };
}

/** Convenience for single-file use in tests and the playground. */
export function compileOne(path: string, text: string, options: ProjectOptions = {}): FileResult {
  const result = compileProject([{ path, text }], options);
  const file = result.files[0];
  if (file === undefined) throw new Error('compileProject returned no files');
  return file;
}
